import { describe, expect, it } from 'vitest';
import { addDays, weekday } from '../src/domain/dates';
import { computeInsights, needsFreshStart } from '../src/domain/learning';
import { isResetDone, resetSequence, timeBox, TIME_OPTIONS } from '../src/domain/modes';
import { pickJustFive } from '../src/domain/micro';
import { computeProgress, streaks } from '../src/domain/progress';
import { dueInfo, markComplete, markSkip, nextOccurrenceAfter, projectDates } from '../src/domain/schedule';
import { checkTasks, coveredNeeds, supplyWarnings, STARTER_SUPPLIES } from '../src/domain/supplies';
import { elapsedMinutes, extendTimer, formatClock, pauseTimer, remainingSec, resumeTimer, startTimer, tick } from '../src/domain/timer';
import { availableRoomModes, quickWins, roomTasks, sectionTasks, todayPlan, tasksOnDate, weekPlan } from '../src/domain/view';
import { reducer, type Stamp } from '../src/state/reducer';
import type { AppData, Task } from '../src/domain/types';
import { custom, demo, plan, TODAY, view } from './helpers';

const stamp = (today = TODAY, hour = 18): Stamp => ({ today, now: `${today}T${String(hour).padStart(2, '0')}:00:00.000Z` });
const act = (d: AppData, ...as: Parameters<typeof reducer>[1][]) => as.reduce(reducer, d);

describe('timer', () => {
  const task = { id: 't', name: 'Wash dishes', roomName: 'Kitchen' };
  it('counts down, pauses, resumes and finishes', () => {
    let t = startTimer(task, 5, 0);
    expect(remainingSec(t, 0)).toBe(300);
    expect(remainingSec(t, 60_000)).toBe(240);
    t = pauseTimer(t, 60_000);
    expect(remainingSec(t, 500_000)).toBe(240); // paused time doesn't count
    t = resumeTimer(t, 500_000);
    expect(remainingSec(t, 560_000)).toBe(180);
    expect(tick(t, 560_000).status).toBe('running');
    const done = tick(t, 500_000 + 241_000);
    expect(done.status).toBe('finished');
    expect(remainingSec(done, 9e9)).toBe(0);
  });
  it('elapsed minutes ignore pauses; extend reopens a finished timer', () => {
    let t = startTimer(task, 10, 0);
    t = pauseTimer(t, 120_000);
    expect(elapsedMinutes(t, 9e6)).toBe(2);
    t = tick(startTimer(task, 1, 0), 61_000);
    expect(t.status).toBe('finished');
    const more = extendTimer(t, 5, 70_000);
    expect(more.status).toBe('running');
    expect(remainingSec(more, 70_000)).toBe(300);
    expect(formatClock(65)).toBe('01:05');
  });
});

describe('schedule rules', () => {
  const d = demo('B');
  const v = view(d);
  const weekly = v.tasks.find((t) => t.cadence.kind === 'every' && t.cadence.every === 7)!;

  it('completing moves a recurring task to its next slot and records history', () => {
    const due = dueInfo(weekly, undefined, weekly.startDate!).due!;
    const s = markComplete(weekly, undefined, due);
    expect(s.lastDone).toBe(due);
    expect(s.due! > due).toBe(true);
    expect(weekday(s.due!)).toBe(weekday(weekly.startDate!)); // stays on its weekday
  });

  it('skipping counts a streak and moves on without piling up', () => {
    let s = markSkip(weekly, undefined, TODAY);
    s = markSkip(weekly, s, TODAY);
    s = markSkip(weekly, s, TODAY);
    expect(s.skipStreak).toBe(3);
    expect(s.due! > TODAY).toBe(true);
  });

  it('one-time tasks never go overdue; they wait', () => {
    const once = view(demo('A')).tasks.find((t) => t.tier === 'reset')!;
    const info = dueInfo(once, { due: addDays(TODAY, -30) }, TODAY);
    expect(info.due).toBe(TODAY);
    expect(info.overdue).toBe(false);
  });

  it('long-missed recurring tasks roll forward instead of becoming a backlog', () => {
    const info = dueInfo(weekly, { due: addDays(TODAY, -40), anchor: weekly.startDate! }, TODAY);
    expect(info.rolled).toBe(true);
    expect(info.due! >= TODAY).toBe(true);
    expect(weekday(info.due!)).toBe(weekday(weekly.startDate!));
  });

  it('recently missed tasks are flagged overdue but within the no-rush window', () => {
    const info = dueInfo(weekly, { due: addDays(TODAY, -2) }, TODAY);
    expect(info.overdue).toBe(true);
  });

  it('projection covers future occurrences for week and month views', () => {
    const dates = projectDates(weekly, undefined, TODAY, addDays(TODAY, 60), TODAY);
    expect(dates.length).toBeGreaterThanOrEqual(7);
    expect(dates.every((x, i) => i === 0 || x > dates[i - 1])).toBe(true);
  });

  it('nextOccurrenceAfter honours weekday cadences', () => {
    expect(nextOccurrenceAfter({ kind: 'days', days: [1, 4] }, null, '2026-10-05')).toBe('2026-10-08');
    expect(nextOccurrenceAfter({ kind: 'once' }, null, TODAY)).toBeNull();
  });
});

describe('today, calendar and sections', () => {
  it('today never exceeds the session budget except for one oversized first task', () => {
    for (const id of ['A', 'B', 'C', 'D'] as const) {
      for (let i = 0; i < 14; i++) {
        const v = view(demo(id), addDays(TODAY, i));
        const t = todayPlan(v);
        const nonHabit = t.focus.filter((f) => !f.task.habit);
        const minutes = nonHabit.reduce((s, f) => s + f.task.minutes, 0);
        if (nonHabit.length > 1) expect(minutes).toBeLessThanOrEqual(t.budget * 1.1 + 1);
        if (!t.isActiveDay) expect(nonHabit).toHaveLength(0);
      }
    }
  });

  it('weekend plan has rest days with only micro-habits', () => {
    const v = view(demo('D'), '2026-10-07'); // Wednesday
    const t = todayPlan(v);
    expect(t.isActiveDay).toBe(false);
    expect(t.focus.every((f) => f.task.habit)).toBe(true);
  });

  it('week view lists 7 days and tomorrow differs from today', () => {
    const v = view(demo('C'));
    expect(weekPlan(v, TODAY)).toHaveLength(7);
    expect(tasksOnDate(v, addDays(TODAY, 1)).length).toBeGreaterThan(0);
  });

  it('plan sections partition tasks sensibly', () => {
    const v = view(demo('C'));
    expect(sectionTasks(v, 'daily').every((t) => t.frequency === 'daily')).toBe(true);
    expect(sectionTasks(v, 'weekly').every((t) => ['weekly', 'twice-weekly'].includes(t.frequency))).toBe(true);
    expect(sectionTasks(v, 'deep').every((t) => t.tier === 'deep')).toBe(true);
    expect(quickWins(v).every((t) => t.minutes <= 10)).toBe(true);
  });

  it('room mode shows only tasks for rooms the home has', () => {
    const vA = view(demo('A'));
    const modes = availableRoomModes(vA);
    expect(modes).not.toContain('garage');
    expect(modes).toContain('kitchen');
    expect(roomTasks(vA, 'bathroom').every((t) => t.roomKind === 'bathroom')).toBe(true);
    const vC = view(demo('C'));
    expect(availableRoomModes(vC)).toContain('garage');
    expect(roomTasks(vC, 'garage').length).toBeGreaterThan(0);
    // studio main room appears under bedroom
    expect(roomTasks(vA, 'bedroom').length).toBeGreaterThan(0);
  });

  it('deep clean only includes rooms the user has', () => {
    const v = view(demo('A'));
    const deep = sectionTasks(v, 'deep');
    expect(deep.length).toBeGreaterThan(5);
    expect(deep.some((t) => /garage|basement|attic/i.test(t.roomName))).toBe(false);
    expect(deep.some((t) => /oven/i.test(t.name))).toBe(true);
  });
});

describe('"I only have X minutes"', () => {
  it('never exceeds the chosen time, for every option and profile', () => {
    for (const id of ['A', 'B', 'C', 'D'] as const) {
      const v = view(demo(id));
      for (const m of TIME_OPTIONS) {
        const r = timeBox(v, m);
        expect(r.total).toBeLessThanOrEqual(m);
        expect(r.tasks.reduce((s, t) => s + Math.round(t.minutes), 0)).toBe(r.total);
        if (m >= 15) expect(r.tasks.length).toBeGreaterThan(0);
      }
    }
  });
  it('more time yields at least as much impact', () => {
    const v = view(demo('C'));
    const score = (m: number) => timeBox(v, m).tasks.reduce((s, t) => s + t.impact, 0);
    expect(score(30)).toBeGreaterThanOrEqual(score(10));
    expect(score(60)).toBeGreaterThanOrEqual(score(30));
  });
  it('prefers high-impact tasks for a very short window', () => {
    const r = timeBox(view(demo('A')), 5);
    expect(r.tasks.length).toBeGreaterThan(0);
    expect(Math.max(...r.tasks.map((t) => t.impact))).toBeGreaterThanOrEqual(7);
  });
});

describe('Just 5 Minutes and the reset sequence', () => {
  it('returns exactly one 5-minute task that fits the home', () => {
    for (const id of ['A', 'B', 'C', 'D'] as const) {
      const t = pickJustFive(demo(id))!;
      expect(t.minutes).toBe(5);
      expect(t.roomName).toBeTruthy();
    }
    const dorm = pickJustFive(custom('dorm'))!;
    expect(dorm.name).not.toMatch(/garage|basement|balcony/i);
  });
  it('varies with "do another" and respects pets', () => {
    const d = demo('B');
    const seen: string[] = [];
    for (let i = 0; i < 5; i++) { const t = pickJustFive(d, seen)!; seen.push(t.id); }
    expect(new Set(seen).size).toBe(5);
    const dog = pickJustFive(demo('A'), [])!;
    expect(dog.name).not.toMatch(/litter/i);
  });
  it('reset sequence follows trash → dishes → laundry → clutter → surfaces → bathroom → floors and adapts to the home', () => {
    const a = resetSequence(demo('A'));
    expect(a.map((s) => s.phase)).toEqual(['trash', 'dishes', 'laundry', 'clutter', 'surfaces', 'bathroom', 'floors']);
    const c = resetSequence(demo('C'));
    const floorZones = new Set(c.find((s) => s.phase === 'floors')!.tasks.map((t) => t.zone)); // covers every floor
    expect(floorZones.size).toBe(2);
    expect(c.find((s) => s.phase === 'floors')!.tasks.every((t) => t.minutes <= 20)).toBe(true);
    expect(new Set(c.find((s) => s.phase === 'bathroom')!.tasks.map((t) => t.roomId)).size).toBe(2);
    expect(new Set(a.find((s) => s.phase === 'bathroom')!.tasks.map((t) => t.roomId)).size).toBe(1);
    const dorm = resetSequence(custom('dorm', {}, { bathrooms: 0, kitchens: 0 }));
    expect(dorm.some((s) => s.phase === 'bathroom')).toBe(false);
    expect(a.reduce((s, x) => s + x.minutes, 0)).toBeLessThan(c.reduce((s, x) => s + x.minutes, 0));
  });
  it('reset completion is tracked', () => {
    let d = reducer(demo('A'), { type: 'RESET_RUN_START', stamp: stamp() });
    const first = resetSequence(d)[0].tasks[0];
    d = reducer(d, { type: 'TASK_COMPLETE', task: first, stamp: stamp(), via: 'reset' });
    expect(isResetDone(d, first.id)).toBe(true);
  });
});

describe('reducer: completing, rescheduling, resetting', () => {
  const base = demo('B');
  const v = view(base);
  const task = todayPlan(v).focus[0].task;

  it('completing a task logs a session, advances the due date and counts toward progress', () => {
    const d = act(base, { type: 'TASK_COMPLETE', task, stamp: stamp(), via: 'checkoff' });
    expect(d.sessions).toHaveLength(1);
    expect(d.taskStates[task.id].lastDone).toBe(TODAY);
    const t2 = todayPlan(view(d));
    expect(t2.focus.some((f) => f.task.id === task.id)).toBe(false);
    expect(t2.done).toHaveLength(1);
    expect(computeProgress(view(d)).tasksCompleted).toBe(1);
  });

  it('entries within 45 minutes share a session; later ones start a new one', () => {
    const t = todayPlan(v).focus;
    let d = act(base, { type: 'TASK_COMPLETE', task: t[0].task, stamp: stamp(TODAY, 18), via: 'checkoff' }, { type: 'TASK_COMPLETE', task: t[1].task, stamp: { today: TODAY, now: `${TODAY}T18:20:00.000Z` }, via: 'checkoff' });
    expect(d.sessions).toHaveLength(1);
    expect(d.sessions[0].entries).toHaveLength(2);
    d = act(d, { type: 'TASK_COMPLETE', task: t[2].task, stamp: { today: TODAY, now: `${TODAY}T21:30:00.000Z` }, via: 'checkoff' });
    expect(d.sessions).toHaveLength(2);
    expect(computeProgress(view(d)).sessions).toBe(2);
  });

  it('skip, snooze, move to tomorrow and reschedule all take the task off today without shaming', () => {
    const tasks = todayPlan(v).focus.filter((f) => !f.task.habit).map((f) => f.task);
    const [a, b, c] = tasks;
    const tomorrow = addDays(TODAY, 1);
    const d = act(base,
      { type: 'TASK_SKIP', task: a, stamp: stamp() },
      { type: 'TASK_SNOOZE', task: b, stamp: stamp() },
      { type: 'TASK_MOVE', task: c, to: tomorrow, stamp: stamp() });
    const ids = todayPlan(view(d)).focus.map((f) => f.task.id);
    for (const t of [a, b, c]) expect(ids).not.toContain(t.id);
    expect(d.taskStates[c.id].due).toBe(tomorrow);
    expect(tasksOnDate(view(d), tomorrow).map((t) => t.id)).toContain(c.id);
    expect(d.taskStates[b.id].due).toBe(addDays(TODAY, 2));
  });

  it('timer stop keeps the task due and logs effort', () => {
    const d = act(base, { type: 'TASK_STOP', task, stamp: stamp(), minutes: 3 });
    expect(d.sessions[0].entries[0].outcome).toBe('stopped');
    expect(todayPlan(view(d)).focus.some((f) => f.task.id === task.id)).toBe(true);
  });

  it('"Reset my plan" starts fresh from today and does not dump missed tasks on today', () => {
    const later = addDays(TODAY, 12);
    const dOld = base;
    const vLate = view(dOld, later);
    expect(needsFreshStart(vLate).show).toBe(true);
    const d = reducer(dOld, { type: 'RESET_PLAN', stamp: stamp(later) });
    const vNew = view(d, later);
    const t = todayPlan(vNew);
    expect(t.catchUp).toHaveLength(0);
    const minutes = t.focus.filter((f) => !f.task.habit).reduce((s, f) => s + f.task.minutes, 0);
    expect(minutes).toBeLessThanOrEqual(t.budget * 1.1 + 1);
    expect(needsFreshStart(vNew).show).toBe(false);
  });

  it('even without resetting, a long absence only shows at most 2 gentle catch-up tasks', () => {
    const t = todayPlan(view(base, addDays(TODAY, 6)));
    expect(t.catchUp.length).toBeLessThanOrEqual(2);
  });

  it('custom tasks: create, recur, complete and delete', () => {
    const ct = { id: 'c1', name: 'Water plants', roomId: 'living-1', frequency: 'weekly' as const, minutes: 5, priority: 'LOW' as const, notes: 'Fern needs more', startDate: TODAY, createdAt: TODAY };
    let d = act(base, { type: 'CUSTOM_SAVE', task: ct });
    let vv = view(d);
    const t = vv.tasks.find((x) => x.id === 'c1')!;
    expect(t.roomName).toBe('Living room');
    expect(tasksOnDate(vv, TODAY).map((x) => x.id)).toContain('c1');
    d = reducer(d, { type: 'TASK_COMPLETE', task: t, stamp: stamp(), via: 'checkoff' });
    vv = view(d);
    expect(tasksOnDate(vv, addDays(TODAY, 7)).map((x) => x.id)).toContain('c1');
    d = reducer(d, { type: 'CUSTOM_DELETE', id: 'c1' });
    expect(view(d).tasks.some((x) => x.id === 'c1')).toBe(false);
  });

  it('editing the home keeps existing tasks on their scheduled days', () => {
    const before = view(base);
    const snapshot = new Map(before.tasks.filter((t) => t.startDate).map((t) => [t.id, dueInfo(t, before.states[t.id], TODAY).due]));
    const d = reducer(base, { type: 'SET_HOME', patch: { adults: 3, children: 1 }, stamp: stamp() });
    const after = view(d);
    let same = 0; let total = 0;
    for (const t of after.tasks) {
      if (!snapshot.has(t.id)) continue;
      total++;
      if (dueInfo(t, after.states[t.id], TODAY).due === snapshot.get(t.id)) same++;
    }
    expect(total).toBeGreaterThan(20);
    expect(same / total).toBeGreaterThan(0.95);
  });

  it('changing home type applies defaults until rooms are edited by hand', () => {
    const fresh = custom('apartment', {}, {}, {});
    fresh.home.roomsTouched = false;
    const d = reducer(fresh, { type: 'SET_HOME_TYPE', homeType: 'house', stamp: stamp() });
    expect(d.home.rooms.garage).toBe('1-car');
    expect(d.home.floors).toBe(2);
    const touched = reducer(d, { type: 'SET_HOME', patch: { rooms: { ...d.home.rooms, bedrooms: 5 } }, stamp: stamp() });
    const t2 = reducer(touched, { type: 'SET_HOME_TYPE', homeType: 'apartment', stamp: stamp() });
    expect(t2.home.rooms.bedrooms).toBe(5);
  });
});

describe('learning', () => {
  it('suggests shorter sessions when long tasks keep getting skipped', () => {
    let d = demo('C');
    const long: Task = { ...view(d).tasks.find((t) => t.minutes >= 10)!, minutes: 45 };
    for (let i = 0; i < 4; i++) d = reducer(d, { type: 'TASK_SKIP', task: long, stamp: stamp(addDays(TODAY, -i)) });
    const ins = computeInsights(view(d));
    expect(ins.some((i) => i.id === 'shorter')).toBe(true);
    const applied = reducer(d, { type: 'SET_SESSION_CAP', minutes: 20, stamp: stamp() });
    expect(plan(applied).chunkLimit).toBeLessThanOrEqual(20);
  });

  it('offers four options after a task is skipped three times in a row', () => {
    let d = demo('B');
    const t = view(d).tasks.find((x) => x.cadence.kind === 'every' && x.frequency === 'weekly')!;
    for (let i = 0; i < 3; i++) d = reducer(d, { type: 'TASK_SKIP', task: t, stamp: stamp() });
    const ins = computeInsights(view(d)).find((i) => i.id === `skip:${t.id}`)!;
    expect(ins.actions.map((a) => a.id)).toEqual(expect.arrayContaining(['smaller', 'less-often', 'move', 'remove']));
    // make it smaller → half the time and tiny steps
    const smaller = reducer(d, { type: 'TASK_OVERRIDE', id: t.id, override: { smaller: true } });
    const t2 = view(smaller).byId.get(t.id)!;
    expect(t2.minutes).toBeLessThan(t.minutes);
    expect(smaller.taskStates[t.id].skipStreak).toBe(0);
    // reduce frequency
    const less = reducer(d, { type: 'TASK_OVERRIDE', id: t.id, override: { frequency: 'biweekly' } });
    expect(view(less).byId.get(t.id)!.frequency).toBe('biweekly');
    // remove
    const gone = reducer(d, { type: 'TASK_PATCH', id: t.id, patch: { hidden: true } });
    expect(view(gone).tasks.some((x) => x.id === t.id)).toBe(false);
    expect(view(gone).hidden.some((x) => x.id === t.id)).toBe(true);
  });

  it('keeps routines that go well (bathroom) and says so', () => {
    let d = demo('B');
    const bath = view(d).tasks.filter((t) => t.roomKind === 'bathroom');
    for (let i = 0; i < 5; i++) d = reducer(d, { type: 'TASK_COMPLETE', task: bath[i % bath.length], stamp: stamp(addDays(TODAY, -i)), via: 'checkoff' });
    const ins = computeInsights(view(d));
    expect(ins.some((i) => i.id === 'steady:bathroom' && i.tone === 'celebrate')).toBe(true);
  });
});

describe('progress', () => {
  it('streak forgives a single rest day but not two', () => {
    expect(streaks(['2026-10-01', '2026-10-02', '2026-10-04'], '2026-10-05').current).toBe(3);
    expect(streaks(['2026-10-01', '2026-10-02'], '2026-10-05').current).toBe(0);
    expect(streaks(['2026-10-01', '2026-10-02', '2026-10-05'], '2026-10-05').current).toBe(1);
    expect(streaks([], TODAY)).toEqual({ current: 0, best: 0 });
  });
  it('seeded history yields sensible dashboard numbers', () => {
    const d = demo('C', { withHistory: true });
    const p = computeProgress(view(d));
    expect(p.tasksCompleted).toBeGreaterThan(10);
    expect(p.minutesCleaned).toBeGreaterThan(60);
    expect(p.last7).toHaveLength(7);
    expect(p.weeks).toHaveLength(4);
    expect(p.weekPlanned).toBeGreaterThanOrEqual(p.weekDone);
    expect(p.monthPlanned).toBeGreaterThanOrEqual(p.monthDone);
    expect(p.rooms.length).toBeGreaterThan(1);
  });
  it('a brand-new user sees zeros, not NaN', () => {
    const p = computeProgress(view(demo('A')));
    expect(p.tasksCompleted).toBe(0);
    expect(p.streak).toBe(0);
    expect(Number.isFinite(p.weekPlanned)).toBe(true);
  });
});

describe('supplies', () => {
  it('warns about dangerous combinations without giving mixing instructions', () => {
    const w = supplyWarnings([
      { id: '1', product: 'Thick bleach', category: 'bleach', room: 'any', quantity: '1', notes: '' },
      { id: '2', product: 'Glass cleaner with ammonia', category: 'glass', room: 'any', quantity: '1', notes: '' },
      { id: '3', product: 'Descaler', category: 'descaler', room: 'any', quantity: '1', notes: '' },
    ]);
    expect(w.map((x) => x.id)).toEqual(expect.arrayContaining(['bleach-ammonia', 'bleach-acid']));
    for (const x of w) expect(x.text).toMatch(/never/i);
  });
  it('"what can I clean with what I have" separates ready tasks from ones missing items', () => {
    const v = view(demo('B'));
    const supplies = STARTER_SUPPLIES.map((s, i) => ({ ...s, id: String(i) }));
    const kitchen = roomTasks(v, 'kitchen').filter((t) => t.tier === 'maintenance');
    const r = checkTasks(kitchen, supplies);
    expect(r.ready.length).toBeGreaterThan(0);
    expect(r.missing.every((m) => m.missing.length > 0)).toBe(true);
    expect(coveredNeeds(supplies).has('dish-soap')).toBe(true);
    expect(checkTasks(kitchen, []).ready.length).toBeLessThan(r.ready.length);
  });
});
