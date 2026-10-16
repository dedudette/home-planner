import { describe, expect, it } from 'vitest';
import { historyKnownFrom } from '../src/domain/behaviour';
import { addDays } from '../src/domain/dates';
import { computeInsights, needsFreshStart, type Insight } from '../src/domain/learning';
import { PROGRESSION, progressionReadiness } from '../src/domain/progression';
import { computeProgress } from '../src/domain/progress';
import { isLife } from '../src/domain/scoring';
import { dayPlan, plannedRemaining, projectRemaining, todayPlan } from '../src/domain/view';
import type { AppData, RoomKind, SessionEntry, Task } from '../src/domain/types';
import { reducer } from '../src/state/reducer';
import { day, doIt, entriesOf, mk, open, seeAll, stampOn, viewAt, withEnergy } from './behaviourHelpers';
import { TODAY } from './helpers';

const ins = (d: AppData): Insight[] => computeInsights(viewAt(d));
const ids = (d: AppData) => ins(d).map((i) => i.id);
const homeTasks = (d: AppData) => viewAt(d).tasks.filter((t) => !isLife(t) && !t.habit && !t.part);
const longOne = (d: AppData): Task => ({ ...homeTasks(d)[0], minutes: 45 });
const longOther = (d: AppData): Task => ({ ...homeTasks(d)[1], minutes: 45 });
/** A person doing something (`skip`, `complete`...) on each of the given day offsets, one entry a day. */
const onDays = (d: AppData, task: Task, offsets: number[], type: 'TASK_COMPLETE' | 'TASK_SKIP' | 'TASK_SNOOZE', hour = 10, energy?: 'low' | 'ok'): AppData =>
  offsets.reduce((acc, off) => {
    const date = day(off);
    const a = energy ? withEnergy(acc, energy, date, 7) : acc;
    return doIt(a, type, task, date, hour, {}, `e-${type}-${task.id}-${task.minutes}-${date}`);
  }, d);
const FORBIDDEN = /usually just means|does not fit your life|never happens|too big for this week|you are (lazy|unmotivated)|motivat|because you|your fault|failed|failure|depress|anxi|disorder|lack of/i;

describe('a new user with no history', () => {
  it('gets no suggestions and no fresh-start card on day one; and an honest one once days pass with nothing logged', () => {
    const d = mk(['home', 'discipline'], { sessionMinutes: 30 }, 0);
    expect(ins(d)).toEqual([]);
    expect(needsFreshStart(viewAt(d)).show).toBe(false);
    const later = { ...d, plan: { ...d.plan, startDate: day(-5) } };
    expect(ins(later)).toEqual([]);
    expect(needsFreshStart(viewAt(later))).toMatchObject({ show: true, daysAway: 5, neverLogged: true });
  });
});

describe('opening the app is not doing something, and not opening it is not skipping', () => {
  it('a person who opens the app every day and logs nothing gets no skip-based suggestions: no completion is not a skip', () => {
    let d = mk(['home', 'discipline'], { sessionMinutes: 30 });
    for (let i = -9; i <= 0; i++) { d = open(d, day(i)); d = seeAll(d, day(i)); }
    expect(ins(d)).toEqual([]);
    // the card that offers a fresh start says nothing was LOGGED; it does not claim they were away
    const f = needsFreshStart(viewAt(d));
    expect(f.show).toBe(true);
    expect(f.neverLogged).toBe(true);
  });

  it('after one old entry, the fresh start counts days since something was logged, whether or not the app was opened', () => {
    let d = mk(['home', 'discipline'], { sessionMinutes: 30 });
    d = doIt(d, 'TASK_COMPLETE', homeTasks(d)[0], day(-8));
    for (let i = -7; i <= 0; i++) d = open(d, day(i));
    expect(needsFreshStart(viewAt(d))).toMatchObject({ show: true, daysAway: 8, neverLogged: false });
  });

  it('several days when the app was not opened change nothing either', () => {
    let d = mk(['home', 'discipline'], { sessionMinutes: 30 });
    d = open(d, day(-14)); d = open(d, day(-13)); d = open(d, day(0));
    expect(ins(d)).toEqual([]);
  });

  it('tasks the planner left out (too little time) are not skips and create no suggestion, however often it happens', () => {
    let d = mk(['home', 'discipline', 'morning', 'evening'], { sessionMinutes: 10 });
    for (let i = -12; i <= 0; i++) { d = open(d, day(i)); d = seeAll(d, day(i)); }
    expect(d.exposures.some((e) => (e.left ?? []).length > 0)).toBe(true);
    expect(entriesOf(d)).toHaveLength(0);
    expect(ins(d)).toEqual([]);
  });
});

describe('repeated explicit skips', () => {
  it('three skips of one task on three different days offer ways to make it easier, with the numbers behind it', () => {
    const d0 = mk(['home'], { sessionMinutes: 60 });
    const t = homeTasks(d0)[0];
    const d = onDays(d0, t, [-3, -2, -1], 'TASK_SKIP');
    const i = ins(d).find((x) => x.id === `skip:${t.id}`)!;
    expect(i.code).toBe('skip-streak');
    expect(i.evidence).toMatchObject({ streak: 3, days: 3, windowDays: 28 });
    expect(i.actions.map((a) => a.id)).toContain('smaller');
  });

  it('three skips on one day (a double tap, or two tabs) are not a pattern', () => {
    const d0 = mk(['home'], { sessionMinutes: 60 });
    const t = homeTasks(d0)[0];
    let d = d0;
    for (let k = 0; k < 3; k++) d = doIt(d, 'TASK_SKIP', t, day(-1), 9 + k, {}, `tab-${k}`);
    expect(ids(d)).not.toContain(`skip:${t.id}`);
  });

  it('doing the task in between resets the run; snoozes and moves are not skips', () => {
    const d0 = mk(['home'], { sessionMinutes: 60 });
    const t = homeTasks(d0)[0];
    let d = onDays(d0, t, [-4, -3], 'TASK_SKIP');
    d = onDays(d, t, [-2], 'TASK_COMPLETE');
    d = onDays(d, t, [-1], 'TASK_SKIP');
    expect(ids(d)).not.toContain(`skip:${t.id}`);
    const s = onDays(d0, t, [-3, -2, -1], 'TASK_SNOOZE');
    expect(ids(s)).not.toContain(`skip:${t.id}`);
  });

  it('REGRESSION: the old counter on the task never expired, so skips from long ago made a task "stuck" forever', () => {
    const d0 = mk(['home'], { sessionMinutes: 60 });
    const t = homeTasks(d0)[0];
    const stale: AppData = { ...d0, taskStates: { ...d0.taskStates, [t.id]: { skipStreak: 9, skipTotal: 9 } } };
    expect(ids(stale)).not.toContain(`skip:${t.id}`);
    const old = onDays(d0, t, [-60, -59, -58], 'TASK_SKIP');
    expect(ids(old)).not.toContain(`skip:${t.id}`);
  });

  it('skips on days the person declared low energy are not read as "this task is too big"', () => {
    const d0 = mk(['home'], { sessionMinutes: 60 });
    const t = homeTasks(d0)[0];
    expect(ids(onDays(d0, t, [-3, -2, -1], 'TASK_SKIP', 10, 'low'))).not.toContain(`skip:${t.id}`);
    expect(ids(onDays(d0, t, [-3, -2, -1], 'TASK_SKIP', 10, 'ok'))).toContain(`skip:${t.id}`);
    // two low days and two ordinary days: only the ordinary ones count, and that is two
    let mixed = onDays(d0, t, [-4, -3], 'TASK_SKIP', 10, 'low');
    mixed = onDays(mixed, t, [-2, -1], 'TASK_SKIP', 10, 'ok');
    expect(ids(mixed)).not.toContain(`skip:${t.id}`);
  });

  it('energy declared at the time stays with the entry, even if the person feels better afterwards', () => {
    const d0 = mk(['home'], { sessionMinutes: 60 });
    const t = homeTasks(d0)[0];
    let d = onDays(d0, t, [-3, -2, -1], 'TASK_SKIP', 10, 'low');
    d = withEnergy(d, 'high', day(-1), 20);
    expect(entriesOf(d).every((e) => e.energy === 'low' || e.date === day(-1))).toBe(true);
    expect(ids(d)).not.toContain(`skip:${t.id}`);
  });

  it('a task that is no longer in the plan produces no suggestion', () => {
    const d0 = mk(['home'], { sessionMinutes: 60 });
    const t = homeTasks(d0)[0];
    const d = reducer(onDays(d0, t, [-3, -2, -1], 'TASK_SKIP'), { type: 'TASK_PATCH', id: t.id, patch: { hidden: true } });
    expect(ids(d)).not.toContain(`skip:${t.id}`);
  });
});

describe('longer cleaning jobs are skipped', () => {
  it('four skips on four days offer shorter pieces, and say how many days', () => {
    const d0 = mk(['home'], { sessionMinutes: 60 });
    const d = onDays(d0, longOne(d0), [-4, -3, -2, -1], 'TASK_SKIP');
    const i = ins(d).find((x) => x.id === 'shorter')!;
    expect(i.evidence).toMatchObject({ missed: 4, days: 4 });
    expect(i.body).toMatch(/skipped or snoozed 4/);
  });

  it('a timer stopped early is effort, not a skip; a move is planning, not a skip', () => {
    const d0 = mk(['home'], { sessionMinutes: 60 });
    const t = longOne(d0);
    let d = d0;
    for (const off of [-4, -3, -2, -1]) d = reducer(d, { type: 'TASK_STOP', task: t, stamp: stampOn(day(off), 9), minutes: 12, entryId: `st${off}` });
    expect(ids(d)).not.toContain('shorter');
    let m = d0;
    for (const off of [-4, -3, -2, -1]) m = reducer(m, { type: 'TASK_MOVE', task: t, to: day(off + 2), stamp: stampOn(day(off), 9), entryId: `mv${off}` });
    expect(ids(m)).not.toContain('shorter');
  });

  it('REGRESSION: long walks or study blocks that were skipped are not evidence for splitting CLEANING into pieces', () => {
    const d0 = mk(['home', 'active', 'study'], { sessionMinutes: 60 });
    const life = viewAt(d0).tasks.find((t) => isLife(t) && !t.challenge)!;
    const d = onDays(d0, { ...life, minutes: 45 }, [-4, -3, -2, -1], 'TASK_SKIP');
    expect(ids(d)).not.toContain('shorter');
  });

  it('the same skips on low-energy days are not counted, and one bad afternoon is not a pattern', () => {
    const d0 = mk(['home'], { sessionMinutes: 60 });
    expect(ids(onDays(d0, longOne(d0), [-4, -3, -2, -1], 'TASK_SKIP', 10, 'low'))).not.toContain('shorter');
    let oneDay = d0;
    for (let k = 0; k < 4; k++) oneDay = doIt(oneDay, 'TASK_SKIP', longOne(d0), day(-1), 9 + k, {}, `one-${k}`);
    expect(ids(oneDay)).not.toContain('shorter');
  });

  it('never suggests going below what the day already allows', () => {
    const d0 = mk(['home'], { sessionMinutes: 10 });
    expect(ids(onDays(d0, longOne(d0), [-4, -3, -2, -1], 'TASK_SKIP'))).not.toContain('shorter');
  });
});

describe('rooms that are going smoothly', () => {
  const roomWith = (d: AppData, n: number): { kind: RoomKind; tasks: Task[] } => {
    for (const kind of ['bathroom', 'kitchen', 'bedroom', 'living', 'laundry'] as RoomKind[]) {
      const tasks = viewAt(d).tasks.filter((t) => t.roomKind === kind && !isLife(t));
      if (tasks.length >= n) return { kind, tasks };
    }
    throw new Error('no room with enough tasks');
  };

  it('four completions on four different days, no skips: says so in facts and promises nothing', () => {
    const d0 = mk(['home'], { sessionMinutes: 60 });
    const { kind, tasks } = roomWith(d0, 4);
    let d = d0;
    tasks.slice(0, 4).forEach((t, i) => { d = doIt(d, 'TASK_COMPLETE', t, day(-i - 1), 9, {}, `r${i}`); });
    const i = ins(d).find((x) => x.id === `steady:${kind}`)!;
    expect(i).toBeTruthy();
    expect(i.evidence).toMatchObject({ done: 4, days: 4 });
    expect(i.title).not.toMatch(/working/);
    expect(i.body).toMatch(/Nothing about your plan will change/);
    expect(i.body).not.toMatch(/exactly as it is/);
  });

  it('REGRESSION: four parts of one job done on one afternoon are not a steady routine', () => {
    const d0 = mk(['home'], { sessionMinutes: 10 });
    const withParts = ['bathroom', 'kitchen', 'bedroom', 'living', 'laundry'].map((k) => viewAt(d0).tasks.filter((t) => t.roomKind === k && t.part && !isLife(t))).find((ts) => ts.length >= 4)!;
    let d = d0;
    withParts.slice(0, 4).forEach((t, i) => { d = doIt(d, 'TASK_COMPLETE', t, day(-1), 9 + i, {}, `p${i}`); });
    expect(ids(d).filter((x) => x.startsWith('steady:'))).toEqual([]);
  });

  it('split tasks finished across several days do count, once per day they were done', () => {
    const d0 = mk(['home'], { sessionMinutes: 10 });
    const withParts = ['bathroom', 'kitchen', 'bedroom', 'living', 'laundry'].map((k) => ({ k, ts: viewAt(d0).tasks.filter((t) => t.roomKind === k && t.part && !isLife(t)) })).find((x) => x.ts.length >= 4)!;
    let d = d0;
    withParts.ts.slice(0, 4).forEach((t, i) => { d = doIt(d, 'TASK_COMPLETE', t, day(-i - 1), 9, {}, `q${i}`); });
    expect(ids(d)).toContain(`steady:${withParts.k}`);
  });

  it('Just 5 minutes and the reset sequence are not the room\'s routine', () => {
    const d0 = mk(['home'], { sessionMinutes: 60 });
    const { kind, tasks } = roomWith(d0, 4);
    let d = d0;
    tasks.slice(0, 4).forEach((t, i) => { d = reducer(d, { type: 'TASK_COMPLETE', task: t, stamp: stampOn(day(-i - 1), 9), via: 'reset', entryId: `rs${i}` }); });
    expect(ids(d)).not.toContain(`steady:${kind}`);
  });

  it('a skip or a snooze in the room withholds it, and shown-but-undone tasks withhold it too', () => {
    const d0 = mk(['home'], { sessionMinutes: 60 });
    const { kind, tasks } = roomWith(d0, 5);
    let d = d0;
    tasks.slice(0, 4).forEach((t, i) => { d = doIt(d, 'TASK_COMPLETE', t, day(-i - 1), 9, {}, `s${i}`); });
    expect(ids(d)).toContain(`steady:${kind}`);
    expect(ids(doIt(d, 'TASK_SNOOZE', tasks[4], day(-1), 12))).not.toContain(`steady:${kind}`);
  });
});

describe('a smooth room is judged against what was shown, where that is known', () => {
  const week = () => {
    let d = mk(['home'], { sessionMinutes: 60 });
    for (let i = -6; i <= -1; i++) { d = open(d, day(i)); d = seeAll(d, day(i)); }
    return d;
  };
  const kitchenOn = (d: AppData, off: number) => (d.exposures.find((e) => e.date === day(off))?.items ?? []).map((i) => viewAt(d).byId.get(i.taskId)).filter((t): t is Task => !!t && t.roomKind === 'kitchen' && !isLife(t));

  it('four completions on four days are not "going smoothly" when many more kitchen tasks were shown and left undone', () => {
    let d = week();
    const done = [-4, -3, -2, -1].map((off) => ({ off, t: kitchenOn(d, off)[0] })).filter((x) => x.t);
    expect(done).toHaveLength(4);
    for (const { off, t } of done) d = doIt(d, 'TASK_COMPLETE', t, day(off), 9, {}, `ft-${off}`);
    const shown = [-6, -5, -4, -3, -2, -1].reduce((n, off) => n + kitchenOn(d, off).length, 0);
    expect(shown).toBeGreaterThanOrEqual(5);
    expect(4 / shown).toBeLessThan(0.6);
    expect(ids(d)).not.toContain('steady:kitchen');
  });

  it('the same room is called steady once most of what was shown was done', () => {
    let d = week();
    for (const off of [-6, -5, -4, -3, -2, -1]) for (const t of kitchenOn(d, off)) d = doIt(d, 'TASK_COMPLETE', t, day(off), 9, {}, `all-${off}-${t.id}`);
    expect(ids(d)).toContain('steady:kitchen');
  });

  it('where nothing is known about what was shown (older data), the activity rule alone decides', () => {
    let d = week();
    const done = [-4, -3, -2, -1].map((off) => ({ off, t: kitchenOn(d, off)[0] }));
    for (const { off, t } of done) d = doIt(d, 'TASK_COMPLETE', t, day(off), 9, {}, `ol-${off}`);
    const legacy: AppData = { ...d, exposures: [] };
    expect(ids(legacy)).toContain('steady:kitchen');
  });
});

describe('history that was removed to save space is not read as a quiet stretch', () => {
  const trimmed = (d: AppData, through: number): AppData => ({ ...d, retention: [{ at: `${TODAY}T00:00:00.000Z`, removedSessions: 5, removedEntries: 9, removedThrough: day(through), oldestKept: day(through + 1) }] });
  const withBoth = () => {
    const d0 = mk(['home'], { sessionMinutes: 60 });
    const t = homeTasks(d0)[0];
    let d = onDays(d0, t, [-3, -2, -1], 'TASK_SKIP');                  // a run of skips on one task
    d = onDays(d, longOther(d0), [-4, -3, -2, -1], 'TASK_SKIP');     // and long jobs skipped
    return { d, t };
  };

  it('with nothing removed, both suggestions are made', () => {
    const { d, t } = withBoth();
    expect(historyKnownFrom(d)).toBeNull();
    expect(ids(d)).toEqual(expect.arrayContaining([`skip:${t.id}`, 'shorter']));
  });

  it('while a window reaches into the removed history it is not read, and each window is judged on its own length', () => {
    const { d, t } = withBoth();
    // removed through five days ago: the 21-day and the 28-day windows both reach into it
    expect(historyKnownFrom(trimmed(d, -5))).toBe(day(-4));
    expect(ids(trimmed(d, -5))).not.toContain('shorter');
    expect(ids(trimmed(d, -5))).not.toContain(`skip:${t.id}`);
    // removed through 24 days ago: the 21-day window is whole again, the 28-day one is not
    expect(ids(trimmed(d, -24))).toContain('shorter');
    expect(ids(trimmed(d, -24))).not.toContain(`skip:${t.id}`);
    // removed through 40 days ago: neither window reaches it
    expect(ids(trimmed(d, -40))).toEqual(expect.arrayContaining([`skip:${t.id}`, 'shorter']));
  });

  it('a room is not called steady from a window that is missing days, and no step up is offered from one either', () => {
    const d0 = mk(['home'], { sessionMinutes: 60 });
    const tasks = viewAt(d0).tasks.filter((t) => t.roomKind === 'kitchen' && !isLife(t));
    let d = d0;
    tasks.slice(0, 4).forEach((t, i) => { d = doIt(d, 'TASK_COMPLETE', t, day(-i - 1), 9, {}, `k${i}`); });
    expect(ids(d)).toContain('steady:kitchen');
    expect(ids(trimmed(d, -2))).not.toContain('steady:kitchen');
  });
});

/** Scheduled life habits, one per day on each of `days`: the real shape of an entry the app writes for a planned habit. */
const habit = (date: string, outcome: SessionEntry['outcome'] = 'completed', over: Partial<SessionEntry> = {}): SessionEntry => ({
  id: `h-${date}-${outcome}-${Math.abs(Object.keys(over).join('').length)}`, at: `${date}T09:00:00.000Z`, date, taskId: 'life-1', name: 'Stretch', roomKind: 'home', roomName: 'Mind', category: 'Mind',
  plannedMinutes: 5, actualMinutes: outcome === 'completed' ? 5 : 0, outcome, via: 'plan', domain: 'mind', ...over,
});
const steady = (n: number, over: Partial<SessionEntry> = {}) => Array.from({ length: n }, (_, i) => habit(addDays(TODAY, -(i + 1)), 'completed', { id: `s${i}`, taskId: `life-${i % 3}`, ...over }));
const since21 = addDays(TODAY, -30);

describe('a step up is the only suggestion that adds work, and it is guarded', () => {
  it('steady scheduled habits over three weeks are ready; Just 5 minutes and rough-day steps do not count towards it', () => {
    expect(progressionReadiness(steady(21), TODAY, since21, 1).readyToStepUp).toBe(true);
    expect(progressionReadiness(steady(21, { via: 'five' }), TODAY, since21, 1).readyToStepUp).toBe(false);
    const rough = steady(21).map((e, i) => ({ ...e, taskId: `rough:${i}` }));
    expect(progressionReadiness(rough, TODAY, since21, 1).readyToStepUp).toBe(false);
    const five = steady(21).map((e, i) => ({ ...e, taskId: `five:${i}` }));
    expect(progressionReadiness(five, TODAY, since21, 1).readyToStepUp).toBe(false);
  });

  it('held back, with the reason, when today is low energy or three of the last seven days were', () => {
    expect(progressionReadiness(steady(21), TODAY, since21, 1, { lowEnergyToday: true })).toMatchObject({ readyToStepUp: false, heldBack: 'low-energy' });
    expect(progressionReadiness(steady(21), TODAY, since21, 1, { lowEnergyDays: PROGRESSION.maxLowEnergyDays })).toMatchObject({ readyToStepUp: false, heldBack: 'low-energy' });
    expect(progressionReadiness(steady(21), TODAY, since21, 1, { lowEnergyDays: PROGRESSION.maxLowEnergyDays - 1 }).readyToStepUp).toBe(true);
  });

  it('held back when most of what was shown was left undone, but only once ten days of that are known', () => {
    const mostlyUndone = { habits: 40, completed: 10, days: PROGRESSION.minSeenDays };
    expect(progressionReadiness(steady(21), TODAY, since21, 1, { seen: mostlyUndone })).toMatchObject({ readyToStepUp: false, heldBack: 'low-follow-through' });
    expect(progressionReadiness(steady(21), TODAY, since21, 1, { seen: { ...mostlyUndone, days: PROGRESSION.minSeenDays - 1 } }).readyToStepUp).toBe(true);   // too little to judge
    expect(progressionReadiness(steady(21), TODAY, since21, 1, { seen: { habits: 40, completed: 30, days: 14 } }).readyToStepUp).toBe(true);
    expect(progressionReadiness(steady(21), TODAY, since21, 1, { seen: null }).readyToStepUp).toBe(true);                                        // imported/older data: falls back to the activity rule
  });

  it('held back when the window is missing history, and never from the nothing-removed case', () => {
    expect(progressionReadiness(steady(21), TODAY, since21, 1, { knownFrom: addDays(TODAY, -5) })).toMatchObject({ readyToStepUp: false, heldBack: 'history-trimmed' });
    expect(progressionReadiness(steady(21), TODAY, since21, 1, { knownFrom: addDays(TODAY, -40) }).readyToStepUp).toBe(true);
    expect(progressionReadiness(steady(21), TODAY, since21, 1, { knownFrom: null }).readyToStepUp).toBe(true);
  });

  it('through the real insight: not offered on a declared low-energy day, offered otherwise, and accepting is the person\'s call', () => {
    const d0 = mk(['home', 'discipline'], { sessionMinutes: 30 }, -30);
    const life = viewAt(d0).tasks.find((t) => isLife(t) && !t.challenge)!;
    let d = d0;
    for (let i = 1; i <= 21; i++) d = doIt(d, 'TASK_COMPLETE', life, day(-i), 9, {}, `up${i}`);
    d = { ...d, preferences: { ...d.preferences, levelSince: day(-30) } };
    const up = ins(d).find((x) => x.id === 'level-up');
    expect(up).toBeTruthy();
    expect(up!.actions.map((a) => a.id)).toEqual(['level-up', 'dismiss']);     // asks; never applies itself
    expect(d.preferences.lifeLevel ?? 1).toBe(1);
    expect(ids(withEnergy(d, 'low', TODAY, 8))).not.toContain('level-up');
  });
});

describe('an easier stretch is offered only on enough decisions, over enough days', () => {
  const skips = (n: number, days: number, level = 2) => ({
    es: Array.from({ length: n }, (_, i) => habit(addDays(TODAY, -(1 + (i % days))), 'skipped', { id: `k${i}`, taskId: `life-${i}` })),
    level: level as 1 | 2 | 3,
  });
  it('eight skips on one afternoon are a bad afternoon, not a pattern', () => {
    const { es, level } = skips(8, 1);
    expect(progressionReadiness(es, TODAY, addDays(TODAY, -12), level).readyToEaseOff).toBe(false);
  });
  it('eight skips over at least four days are', () => {
    const { es, level } = skips(8, PROGRESSION.easeMinDecisionDays);
    expect(progressionReadiness(es, TODAY, addDays(TODAY, -12), level).readyToEaseOff).toBe(true);
    expect(progressionReadiness(es, TODAY, addDays(TODAY, -12), level, { knownFrom: addDays(TODAY, -3) }).readyToEaseOff).toBe(false);   // window incomplete
  });
  it('no level to go back to at level 1, and Just 5 minutes taps are not decisions about the routines', () => {
    const { es } = skips(8, 4);
    expect(progressionReadiness(es, TODAY, addDays(TODAY, -12), 1).readyToEaseOff).toBe(false);
    expect(progressionReadiness(es.map((e) => ({ ...e, via: 'five' as const })), TODAY, addDays(TODAY, -12), 2).readyToEaseOff).toBe(false);
  });
});

describe('imported older data and two tabs', () => {
  it('older entries without surface/planned/part still produce the same insights as new ones', () => {
    const d0 = mk(['home'], { sessionMinutes: 60 });
    const t = homeTasks(d0)[0];
    let d = onDays(d0, t, [-3, -2, -1], 'TASK_SKIP');
    d = { ...d, sessions: d.sessions.map((s) => ({ ...s, entries: s.entries.map((e) => { const { surface, planned, part, fromDue, ...legacy } = e; void surface; void planned; void part; void fromDue; return legacy as SessionEntry; }) })) };
    expect(entriesOf(d).every((e) => e.surface === undefined && e.planned === undefined)).toBe(true);
    expect(ids(d)).toContain(`skip:${t.id}`);
  });

  it('with no display records at all (imported), the step up falls back to the activity rule and says nothing about what was seen', () => {
    const d0 = mk(['home', 'discipline'], { sessionMinutes: 30 }, -30);
    const life = viewAt(d0).tasks.find((t) => isLife(t) && !t.challenge)!;
    let d = d0;
    for (let i = 1; i <= 21; i++) d = doIt(d, 'TASK_COMPLETE', life, day(-i), 9, {}, `im${i}`);
    d = { ...d, exposures: [], preferences: { ...d.preferences, levelSince: day(-30) } };
    const up = ins(d).find((x) => x.id === 'level-up')!;
    expect(up).toBeTruthy();
    expect(up.evidence).not.toHaveProperty('seenHabits');
  });

  it('the same skip arriving from two tabs (same entry id) counts once; two real skips on the same day are one day', () => {
    const d0 = mk(['home'], { sessionMinutes: 60 });
    const t = homeTasks(d0)[0];
    let d = d0;
    for (const off of [-3, -2, -1]) {
      d = doIt(d, 'TASK_SKIP', t, day(off), 9, {}, `dup-${off}`);
      d = doIt(d, 'TASK_SKIP', t, day(off), 9, {}, `dup-${off}`);       // the other tab, same action
    }
    expect(entriesOf(d).filter((e) => e.outcome === 'skipped')).toHaveLength(3);
    const i = ins(d).find((x) => x.id === `skip:${t.id}`)!;
    expect(i.evidence).toMatchObject({ streak: 3, days: 3 });
  });
});

describe('what the suggestions say, and what they may change', () => {
  const everything = (): Insight[] => {
    const d0 = mk(['home', 'discipline'], { sessionMinutes: 60 }, -30);
    const t = homeTasks(d0)[0];
    const life = viewAt(d0).tasks.find((x) => isLife(x) && !x.challenge)!;
    let d = onDays(d0, t, [-3, -2, -1], 'TASK_SKIP');
    d = onDays(d, longOther(d0), [-4, -3, -2, -1], 'TASK_SKIP');
    for (let i = 1; i <= 21; i++) d = doIt(d, 'TASK_COMPLETE', life, day(-i), 9, {}, `w${i}`);
    d = { ...d, preferences: { ...d.preferences, levelSince: day(-30) } };
    const tasks = viewAt(d).tasks.filter((x) => x.roomKind === 'kitchen' && !isLife(x) && x.id !== t.id);
    tasks.slice(0, 4).forEach((x, i) => { d = doIt(d, 'TASK_COMPLETE', x, day(-i - 5), 9, {}, `kk${i}`); });
    return ins(d);
  };

  it('every suggestion carries a code, evidence, and a way to say no; none explains or diagnoses', () => {
    const all = everything();
    expect(all.map((i) => i.id)).toEqual(expect.arrayContaining(['shorter', 'level-up']));
    for (const i of all) {
      expect(i.code, i.id).toBeTruthy();
      expect(Object.keys(i.evidence ?? {}).length, i.id).toBeGreaterThan(0);
      expect(i.actions.some((a) => a.id === 'dismiss'), i.id).toBe(true);
      expect(`${i.title} ${i.body}`, i.id).not.toMatch(FORBIDDEN);
    }
  });

  it('only the step up adds work: every other action is a smaller step, or a no', () => {
    const REDUCING = ['shorter', 'smaller', 'less-often', 'move', 'remove', 'keep', 'dismiss', 'level-down'];
    for (const i of everything()) {
      const ids = i.actions.map((a) => a.id);
      if (i.id === 'level-up') expect(ids, i.id).toEqual(['level-up', 'dismiss']);
      else for (const a of ids) expect(REDUCING, `${i.id}: ${a}`).toContain(a);
    }
  });

  it('accepting "shorter" makes the pieces smaller; the day\'s time is not raised and the plan still fits it', () => {
    const d0 = mk(['home'], { sessionMinutes: 60 });
    const before = todayPlan(viewAt(d0));
    const d1 = reducer(d0, { type: 'SET_SESSION_CAP', minutes: 20, stamp: stampOn(TODAY) });
    const after = todayPlan(viewAt(d1));
    const pieces = (p: typeof before) => [...p.focus, ...p.life, ...p.catchUp].filter((i) => !isLife(i.task)).map((i) => i.task.minutes);
    expect(after.totalBudget).toBe(before.totalBudget);
    expect(Math.max(...pieces(after))).toBeLessThanOrEqual(Math.max(...pieces(before)));
    const spent = [...after.focus, ...after.life, ...after.catchUp].reduce((n, i) => n + i.task.minutes, 0);
    expect(spent).toBeLessThanOrEqual((after.totalBudget ?? Infinity) + after.overBy);
  });
});

describe('progress counts follow what the day could hold', () => {
  it('the remaining count over a week is what was fitted into the days, not everything that is due', () => {
    const d = mk(['home', 'morning', 'evening'], { sessionMinutes: 10 });
    const v = viewAt(d);
    const end = addDays(TODAY, 6);
    const dates = Array.from({ length: 7 }, (_, i) => addDays(TODAY, i));
    const fittedSum = dates.reduce((n, x) => n + dayPlan(v, x).tasks.length, 0);
    const deferredSum = dates.reduce((n, x) => n + dayPlan(v, x).deferred.length, 0);
    expect(deferredSum).toBeGreaterThan(0);                                   // the budget really does leave things out
    expect(plannedRemaining(v, TODAY, end)).toBe(fittedSum);
    expect(plannedRemaining(v, TODAY, end)).toBeLessThan(fittedSum + deferredSum);
    expect(plannedRemaining(v, TODAY, end)).toBeLessThanOrEqual(projectRemaining(v, TODAY, end));
    // today's own plan agrees with the per-day count it is summed from
    const t = todayPlan(v);
    expect(dayPlan(v, TODAY).tasks.length).toBe(t.focus.length + t.catchUp.length + t.life.length);
    expect(computeProgress(v).weekPlanned).toBeLessThanOrEqual(computeProgress(v).weekDone + projectRemaining(v, TODAY, end));
  });
});
