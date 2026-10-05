import { describe, expect, it } from 'vitest';
import { deriveContext } from '../src/domain/context';
import { computeInsights } from '../src/domain/learning';
import { LIFE_DOMAINS, LIFE_TEMPLATES, SAFETY_LINE } from '../src/domain/lifeCatalog';
import { roughDayTasks, servesGoal } from '../src/domain/life';
import { resetSequence, timeBox } from '../src/domain/modes';
import { pickJustFive } from '../src/domain/micro';
import { computeProgress } from '../src/domain/progress';
import { isLife } from '../src/domain/scoring';
import { checkTasks } from '../src/domain/supplies';
import type { AppData, LifeFocus, Preferences, Task } from '../src/domain/types';
import { availableRoomModes, groupVisual, quickWins, roomTasks, sectionTasks, todayPlan } from '../src/domain/view';
import { reducer } from '../src/state/reducer';
import { normalizeAppData } from '../src/storage/repository';
import { custom, demo, plan, TODAY, view } from './helpers';

const withPrefs = (focus: LifeFocus[], prefs: Partial<Preferences> = {}, type: 'apartment' | 'studio' | 'house' = 'apartment'): AppData =>
  custom(type, {}, {}, { focus, sessionMinutes: 15, daysPerWeek: 7, style: 'daily', ...prefs });
const lifeTasks = (d: AppData) => plan(d).tasks.filter(isLife);
const scheduled = (d: AppData) => lifeTasks(d).filter((t) => !t.challenge);
const stamp = { now: `${TODAY}T18:00:00.000Z`, today: TODAY };

describe('life catalog integrity', () => {
  it('has a rich catalog across every domain with unique ids', () => {
    expect(LIFE_TEMPLATES.length).toBeGreaterThanOrEqual(80);
    expect(new Set(LIFE_TEMPLATES.map((t) => t.id)).size).toBe(LIFE_TEMPLATES.length);
    for (const d of LIFE_DOMAINS) expect(LIFE_TEMPLATES.filter((t) => t.domain === d).length, d).toBeGreaterThanOrEqual(5);
  });
  it('every template is well formed and every ladder is ordered', () => {
    for (const t of LIFE_TEMPLATES) {
      expect(t.steps.length, t.id).toBeGreaterThan(0);
      expect(t.focus.length, t.id).toBeGreaterThan(0);
      expect(t.ladder.length, t.id).toBeGreaterThan(0);
      t.ladder.forEach((s, i) => {
        expect(s.minutes, `${t.id} step ${i}`).toBeGreaterThan(0);
        if (i > 0) { expect(s.level).toBeGreaterThanOrEqual(t.ladder[i - 1].level); expect(s.minutes).toBeGreaterThanOrEqual(t.ladder[i - 1].minutes); }
      });
    }
  });
  it('has no duplicate task names (progression ladders replace near-duplicates)', () => {
    const names = LIFE_TEMPLATES.flatMap((t) => t.ladder.map((s) => s.name.toLowerCase()));
    expect(new Set(names).size).toBe(names.length);
  });
  it('covers the requested example tasks', () => {
    const names = LIFE_TEMPLATES.flatMap((t) => t.ladder.map((s) => s.name.toLowerCase())).join('|');
    for (const needle of ['5-minute walk', '30-minute walk', 'wall push-ups', 'push-ups', 'plank', 'jumping jacks', 'mountain climbers', 'dance workout', 'box breathing', '4–6 slow breathing', 'breathing before sleep', 'grounding', 'take a shower', 'brush your teeth', 'skincare', 'drink a glass of water', 'eat a proper breakfast', "top 3 priorities", '5-minute journal', 'read 5 pages', '25-minute focused', 'clean your downloads', 'no-phone morning', 'check your calendar', 'pay a bill', 'study for 10 minutes', 'practice singing', 'practice an instrument', 'visit a park', 'water plants', 'start your bedtime routine', 'dim the lights', 'set your alarm', 'read instead of scrolling']) {
      expect(names, needle).toContain(needle);
    }
  });
  it('fitness and breathing tasks always carry a safety line and make no medical claims', () => {
    for (const t of lifeTasks(withPrefs(['active', 'selfcare', 'discipline'], { fitnessLevel: 'advanced', lifeLevel: 3 }))) {
      if (t.domain === 'fitness' || t.domain === 'breathing') expect(t.substeps[t.substeps.length - 1]).toBe(SAFETY_LINE[t.domain]);
    }
    const text = JSON.stringify(LIFE_TEMPLATES).toLowerCase();
    for (const bad of ['cure', 'treat anxiety', 'treats ', 'heal your', 'diagnos', 'therapy']) expect(text.includes(bad), bad).toBe(false);
  });
});

describe('focus selection', () => {
  it('home-only users get no life tasks (existing behaviour preserved)', () => {
    for (const id of ['A', 'B', 'C', 'D'] as const) expect(lifeTasks(demo(id))).toHaveLength(0);
  });
  it('life tasks only come from the chosen focus areas', () => {
    const d = withPrefs(['study']);
    const domains = new Set(lifeTasks(d).map((t) => t.domain));
    expect([...domains].every((x) => ['learning', 'mind', 'admin'].includes(x!))).toBe(true);
    expect(domains.has('fitness')).toBe(false);
    expect(domains.has('breathing')).toBe(false);
  });
  it('no home tasks when home is not selected, and no cleaning questions are needed', () => {
    const p = plan(withPrefs(['discipline', 'active']));
    expect(p.tasks.some((t) => !isLife(t))).toBe(false);
    expect(p.stats.recurringCount).toBe(0);
  });
  it('selecting home + life keeps cleaning and adds habits within a shared time budget', () => {
    const p = plan(withPrefs(['home', 'organize'], { sessionMinutes: 60, daysPerWeek: 4 }));
    expect(p.tasks.some((t) => !isLife(t))).toBe(true);
    expect(p.tasks.some(isLife)).toBe(true);
    expect(p.stats.weeklyMinutes).toBeLessThanOrEqual(p.stats.weeklyCapacity * 0.65 + 1);
  });
  it('old saved data without a focus field behaves as the home-cleaning app', () => {
    const raw = JSON.parse(JSON.stringify(demo('B')));
    delete raw.preferences.focus; delete raw.preferences.lifeLevel; delete raw.preferences.fitnessLevel; delete raw.preferences.equipment;
    const d = normalizeAppData(raw)!;
    expect(d.preferences.focus).toEqual(['home']);
    expect(plan(d).tasks.filter(isLife)).toHaveLength(0);
    expect(deriveContext(d.home, { ...d.preferences, focus: [] as LifeFocus[] }).focus.has('home')).toBe(true);
  });
});

describe('manageable, progressive recommendations', () => {
  it('15 minutes, beginner, discipline + fitness → a handful of small tasks inside 15 minutes a day', () => {
    const d = demo('E');
    const s = scheduled(d);
    expect(s.length).toBeGreaterThanOrEqual(3);
    expect(s.length).toBeLessThanOrEqual(5);
    const names = s.map((t) => t.name);
    expect(names).toContain('Make your bed');
    expect(names.some((n) => /walk/i.test(n))).toBe(true);
    expect(s.find((t) => /walk/i.test(t.name))!.minutes).toBeLessThanOrEqual(10);
    // the real daily load, measured on the actual Today screen for a full week
    for (let i = 0; i < 7; i++) {
      const day = new Date(`${TODAY}T12:00:00`); day.setDate(day.getDate() + i);
      const iso = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
      const t = todayPlan(view(d, iso));
      expect(t.lifeMinutes, iso).toBeLessThanOrEqual(15.75);
      expect(t.life.length).toBeLessThanOrEqual(6);
    }
  });
  it('60 minutes + home organization → home tasks like dishes, room reset, vacuum and desk', () => {
    const d = demo('F');
    const names = plan(d).tasks.filter((t) => !isLife(t)).map((t) => t.name.toLowerCase()).join('|');
    for (const n of ['do the dishes', '10-minute room reset', 'vacuum', 'clear and wipe your desk']) expect(names).toContain(n);
  });
  it('never an overwhelming list: scheduled life tasks are capped, whatever the focus', () => {
    const all: LifeFocus[] = ['active', 'discipline', 'morning', 'evening', 'focus', 'phone', 'selfcare', 'study', 'organize', 'healthy', 'consistent'];
    for (const minutes of [5, 10, 15, 30, 60, 90]) {
      const s = scheduled(withPrefs(all, { sessionMinutes: minutes }));
      expect(s.length, `${minutes} min`).toBeLessThanOrEqual(8);
      expect(s.reduce((a, t) => a + (t.frequency === 'daily' ? t.minutes : 0), 0)).toBeLessThanOrEqual(minutes * 1.05 + 0.5);
    }
  });
  it('more time yields a fuller plan', () => {
    const f: LifeFocus[] = ['active', 'discipline', 'study'];
    const small = scheduled(withPrefs(f, { sessionMinutes: 10 })).length;
    const big = scheduled(withPrefs(f, { sessionMinutes: 60 })).length;
    expect(big).toBeGreaterThan(small);
  });
  it('level 1 gets short versions; higher level gets longer ones; the next step is an optional challenge', () => {
    const walk = (lvl: 1 | 2 | 3) => lifeTasks(withPrefs(['active'], { sessionMinutes: 60, lifeLevel: lvl, fitnessLevel: 'intermediate' })).find((t) => t.templateId === 'f-walk' && !t.challenge)!;
    expect(walk(1).minutes).toBeLessThanOrEqual(walk(2).minutes);
    expect(walk(2).minutes).toBeLessThanOrEqual(walk(3).minutes);
    const d = withPrefs(['active'], { sessionMinutes: 60, lifeLevel: 1 });
    const ch = lifeTasks(d).filter((t) => t.challenge);
    expect(ch.length).toBeGreaterThan(0);
    for (const c of ch) { expect(c.startDate).toBeNull(); expect(c.level!).toBeGreaterThan(1); }
    // challenges never appear on Today, in sections like daily/weekly, or in time-boxed plans
    const v = view(d);
    expect(todayPlan(v).life.some((i) => i.task.challenge)).toBe(false);
    expect(sectionTasks(v, 'daily').some((t) => t.challenge)).toBe(false);
    expect(sectionTasks(v, 'challenge').length).toBe(ch.length);
    expect(timeBox(v, 120).tasks.some((t) => t.challenge)).toBe(false);
  });
  it('routines are grouped by time of day', () => {
    const v = view(withPrefs(['morning', 'evening'], { sessionMinutes: 30 }));
    const r = sectionTasks(v, 'routine');
    expect(r.length).toBeGreaterThan(2);
    expect(r.every((t) => t.routine)).toBe(true);
    expect(new Set(r.map((t) => t.timeOfDay)).size).toBeGreaterThanOrEqual(2);
    const order = ['morning', 'afternoon', 'evening', 'anytime'];
    expect(r.map((t) => order.indexOf(t.timeOfDay!))).toEqual([...r.map((t) => order.indexOf(t.timeOfDay!))].sort((a, b) => a - b));
  });
  it('quick wins include small life tasks', () => {
    expect(quickWins(view(demo('E'))).every((t) => t.minutes <= 10)).toBe(true);
  });
});

describe('fitness safety and personalization', () => {
  const fitness = (lvl: Preferences['fitnessLevel'], eq: Preferences['equipment'], lifeLevel: 1 | 2 | 3 = 3) =>
    lifeTasks(withPrefs(['active'], { fitnessLevel: lvl, equipment: eq, sessionMinutes: 90, lifeLevel })).filter((t) => t.domain === 'fitness');
  it('beginners never get hard or vigorous exercises, even as challenges', () => {
    for (const t of fitness('beginner', 'none')) {
      expect(t.difficulty, t.name).toBe(1);
      expect(t.beginner, t.name).toBe(true);
      expect(t.intensity, t.name).not.toBe('vigorous');
    }
  });
  it('no equipment means no equipment-dependent tasks; basic equipment unlocks them', () => {
    expect(fitness('advanced', 'none').every((t) => t.equipment === 'none')).toBe(true);
    expect(fitness('advanced', 'basic').some((t) => t.equipment === 'basic')).toBe(true);
  });
  it('higher fitness levels unlock harder options; every fitness task states intensity', () => {
    const adv = fitness('advanced', 'none');
    expect(adv.some((t) => t.difficulty === 3 || t.intensity === 'vigorous')).toBe(true);
    for (const t of adv) { expect(t.intensity).toBeTruthy(); expect(t.minutes).toBeLessThanOrEqual(30); }
  });
  it('low energy removes vigorous exercise', () => {
    const t = lifeTasks(withPrefs(['active'], { fitnessLevel: 'advanced', energy: 'low', sessionMinutes: 90, lifeLevel: 3 }));
    expect(t.some((x) => x.intensity === 'vigorous')).toBe(false);
  });
  it('exercise volumes stay modest: no single exercise task asks for more than 30 minutes', () => {
    for (const t of LIFE_TEMPLATES.filter((x) => x.domain === 'fitness')) for (const s of t.ladder) expect(s.minutes, s.name).toBeLessThanOrEqual(30);
  });
});

describe('isolation from the home features', () => {
  const d = demo('F');
  const v = view(d);
  it('room mode, reset sequence, deep clean and supplies only use home tasks', () => {
    expect(availableRoomModes(v).length).toBeGreaterThan(0);
    for (const k of availableRoomModes(v)) expect(roomTasks(v, k).some(isLife)).toBe(false);
    expect(resetSequence(d).flatMap((s) => s.tasks).some(isLife)).toBe(false);
    expect(sectionTasks(v, 'deep').some(isLife)).toBe(false);
    expect(sectionTasks(v, 'reset').some(isLife)).toBe(false);
    expect(checkTasks(roomTasks(v, 'kitchen'), []).ready.concat(checkTasks(roomTasks(v, 'kitchen'), []).missing).some((x) => isLife(x.task))).toBe(false);
  });
  it('life tasks do not eat into the home cleaning budget on Today', () => {
    const t = todayPlan(v);
    expect(t.focus.some((f) => isLife(f.task))).toBe(false);
    expect(t.life.every((f) => isLife(f.task))).toBe(true);
    const home = t.focus.filter((f) => !f.task.habit).reduce((s, f) => s + f.task.minutes, 0);
    expect(home).toBeLessThanOrEqual(t.budget * 1.1 + 1);
  });
  it('domain filter works for plan sections', () => {
    expect(sectionTasks(v, 'daily', 'admin').every((t) => t.domain === 'admin')).toBe(true);
    expect(sectionTasks(v, 'daily', 'home').every((t) => (t.domain ?? 'home') === 'home')).toBe(true);
  });
  it('"I only have X minutes" mixes home and life tasks and still respects the time', () => {
    for (const m of [10, 30, 60]) {
      const r = timeBox(v, m);
      expect(r.total).toBeLessThanOrEqual(m);
    }
    expect(timeBox(view(demo('E')), 30).tasks.every(isLife)).toBe(true);
  });
  it('Just 5 Minutes respects focus: life micro-tasks for life users, no cleaning for non-home users', () => {
    const e = pickJustFive(demo('E'))!;
    expect(isLife(e)).toBe(true);
    expect(e.minutes).toBe(5);
    expect(e.name).not.toMatch(/trash|dishes|counter|vacuum/i);
    const home = pickJustFive(demo('B'))!;
    expect(isLife(home)).toBe(false);
  });
});

describe('completion, progression and the rough-day reset', () => {
  it('completing a life task is tracked by area and keeps it off Today', () => {
    const d0 = demo('E');
    const task = todayPlan(view(d0)).life[0].task;
    const d = reducer(d0, { type: 'TASK_COMPLETE', task, stamp, via: 'checkoff' });
    expect(d.sessions[0].entries[0].domain).toBe(task.domain);
    const t = todayPlan(view(d));
    expect(t.life.some((i) => i.task.id === task.id)).toBe(false);
    const p = computeProgress(view(d));
    expect(p.tasksCompleted).toBe(1);
    expect(p.areas.map((a) => a.domain)).toContain(task.domain);
    expect(p.rooms).toHaveLength(0); // life work never shows up as a "room"
  });
  it('daily life tasks recur every day, including on non-cleaning days', () => {
    const d = withPrefs(['discipline'], { style: 'weekend', daysPerWeek: 2 });
    const wed = '2026-10-07';
    expect(todayPlan(view(d, wed)).life.length).toBeGreaterThan(0);
  });
  it('rough-day reset is tiny, gentle and never tracked as scheduled plan work', () => {
    const d0 = demo('E');
    const rough: Task[] = roughDayTasks(deriveContext(d0.home, d0.preferences));
    expect(rough.length).toBeGreaterThanOrEqual(3);
    expect(rough.reduce((s, t) => s + t.minutes, 0)).toBeLessThanOrEqual(12);
    expect(rough.every((t) => t.intensity !== 'vigorous' && t.id.startsWith('rough:'))).toBe(true);
    const d = reducer(d0, { type: 'TASK_COMPLETE', task: rough[0], stamp, via: 'plan' });
    expect(Object.keys(d.taskStates).some((k) => k.startsWith('rough:'))).toBe(false);
    expect(d.sessions[0].entries[0].outcome).toBe('completed');
  });
  it('offers a step up after steady habits, and an easier stretch after many skips (never silently)', () => {
    let d = demo('E');
    const tasks = todayPlan(view(d)).life.map((i) => i.task);
    for (let i = 0; i < 14; i++) {
      const day = new Date(`${TODAY}T12:00:00`); day.setDate(day.getDate() - i - 1);
      const iso = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
      for (const t of tasks) d = reducer(d, { type: 'TASK_COMPLETE', task: t, stamp: { today: iso, now: `${iso}T18:00:00.000Z` }, via: 'checkoff' });
    }
    const up = computeInsights(view(d)).find((i) => i.id === 'level-up');
    expect(up).toBeTruthy();
    expect(d.preferences.lifeLevel).toBe(1); // untouched until the user agrees
    const leveled = reducer(d, { type: 'SET_PREFS', patch: { lifeLevel: 2 }, stamp });
    expect(scheduled(leveled).map((t) => t.minutes).reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(scheduled(d).map((t) => t.minutes).reduce((a, b) => a + b, 0));

    let e: AppData = { ...demo('E'), preferences: { ...demo('E').preferences, lifeLevel: 2 } };
    const t2 = todayPlan(view(e)).life.map((i) => i.task);
    for (let i = 0; i < 4; i++) for (const t of t2) e = reducer(e, { type: 'TASK_SKIP', task: t, stamp: { today: TODAY, now: `${TODAY}T1${i}:00:00.000Z` } });
    expect(computeInsights(view(e)).some((i) => i.id === 'level-down')).toBe(true);
  });
  it('custom tasks can belong to any area', () => {
    const ct = { id: 'c9', domain: 'fitness' as const, name: 'Yoga with a friend', roomId: 'other', frequency: 'weekly' as const, minutes: 20, priority: 'MEDIUM' as const, notes: '', startDate: TODAY, createdAt: TODAY };
    const d = reducer(demo('E'), { type: 'CUSTOM_SAVE', task: ct });
    const t = view(d).byId.get('c9')!;
    expect(t.domain).toBe('fitness');
    expect(t.roomName).toBe('Fitness');
  });
  it('focus can be edited later and the plan adapts', () => {
    const d = reducer(demo('B'), { type: 'SET_PREFS', patch: { focus: ['home', 'phone'] }, stamp });
    const p = plan(d);
    expect(p.tasks.some((t) => t.domain === 'digital')).toBe(true);
    expect(p.tasks.some((t) => !isLife(t))).toBe(true);
  });
});

// ───────────────────────── Fix: routine goals must be served by the task's real time of day ─────────────────────────

describe('morning / evening goal coverage', () => {
  const routine = (d: AppData, when: 'morning' | 'evening') =>
    scheduled(d).filter((t) => t.routine && t.timeOfDay === when && t.domain !== 'home');

  it('a morning task that merely lists "evening" among its goals does not satisfy the evening goal', () => {
    const teeth = LIFE_TEMPLATES.find((t) => t.id === 'c-teeth')!;
    expect(teeth.focus).toContain('evening'); // the trap: it is tagged for evening…
    expect(teeth.time).toBe('morning'); // …but it is a morning task
    expect(servesGoal('evening', { t: teeth, matches: ['evening'] })).toBe(false);
    expect(servesGoal('morning', { t: teeth, matches: ['morning'] })).toBe(true);
    const planTomorrow = LIFE_TEMPLATES.find((t) => t.id === 'a-plan-tomorrow')!;
    expect(servesGoal('evening', { t: planTomorrow, matches: ['evening'] })).toBe(true);
    expect(servesGoal('evening', { t: planTomorrow, matches: [] })).toBe(false); // must also match the user's goals
  });

  it('selecting the evening routine goal always yields a genuine evening LIFE habit, at every time budget', () => {
    for (const minutes of [5, 8, 10, 15, 20, 30, 60]) {
      const d = withPrefs(['evening'], { sessionMinutes: minutes });
      const evening = routine(d, 'evening');
      expect(evening.length, `${minutes} min`).toBeGreaterThanOrEqual(1);
      for (const t of evening) { expect(isLife(t)).toBe(true); expect(t.challenge).toBeUndefined(); expect(t.frequency).toBe('daily'); }
      // not by raising the budget: the real daily load stays inside the budget
      const load = scheduled(d).filter((t) => t.frequency === 'daily').reduce((a, t) => a + t.minutes, 0);
      expect(load, `${minutes} min`).toBeLessThanOrEqual(minutes * 1.05 + 0.01);
    }
  });

  it('it shows up on Today, as an evening task', () => {
    const d = withPrefs(['evening'], { sessionMinutes: 10 });
    const t = todayPlan(view(d));
    expect(t.life.some((i) => i.task.timeOfDay === 'evening' && i.task.routine)).toBe(true);
  });

  it('the exact scenario from the UI review: home + active + discipline + morning + evening + focus, 30 min', () => {
    const d = withPrefs(['home', 'active', 'discipline', 'morning', 'evening', 'focus'], { sessionMinutes: 30, daysPerWeek: 7, style: 'several-short' });
    expect(plan(d).stats.lifeDayBudget).toBe(12); // budget is NOT increased to make room
    expect(routine(d, 'evening').length).toBeGreaterThanOrEqual(1);
    expect(routine(d, 'morning').length).toBeGreaterThanOrEqual(1);
    expect(scheduled(d).reduce((a, t) => a + (t.frequency === 'daily' ? t.minutes : 0), 0)).toBeLessThanOrEqual(12.6);
  });

  it('morning and evening together are both served even on a very small budget', () => {
    for (const minutes of [5, 10]) {
      const d = withPrefs(['morning', 'evening', 'active', 'study', 'focus'], { sessionMinutes: minutes });
      expect(routine(d, 'morning').length, `morning @${minutes}`).toBeGreaterThanOrEqual(1);
      expect(routine(d, 'evening').length, `evening @${minutes}`).toBeGreaterThanOrEqual(1);
    }
  });

  it('selected goals are covered before optional filler (every non-home goal has a serving task)', () => {
    const goals: LifeFocus[] = ['active', 'phone', 'study', 'selfcare', 'evening'];
    const d = withPrefs(goals, { sessionMinutes: 20 });
    const chosen = scheduled(d);
    for (const g of goals) {
      const served = chosen.some((t) => LIFE_TEMPLATES.find((x) => x.id === t.templateId)!.focus.includes(g) && (g !== 'evening' || (t.routine && t.timeOfDay === 'evening')));
      expect(served, g).toBe(true);
    }
  });

  it('without the evening goal nothing forces evening tasks (behaviour is goal-driven)', () => {
    const d = withPrefs(['study'], { sessionMinutes: 20 });
    expect(routine(d, 'evening').some((t) => t.templateId === 'a-plan-tomorrow')).toBe(false);
  });
});

// ───────────────────────── Fix: Make the bed stays a daily morning habit ─────────────────────────

describe('morning routine keeps "Make the bed" daily', () => {
  const bed = (d: AppData) => plan(d).tasks.find((t) => t.templateId === 'br-bed' && t.roomId === 'bedroom-1')!;
  const tight = { sessionMinutes: 10, daysPerWeek: 3, style: 'several-short' as const };

  it('with a morning goal and a home plan it is a daily habit, even under a tight cleaning budget', () => {
    const b = bed(withPrefs(['home', 'morning'], tight));
    expect(b.frequency).toBe('daily');
    expect(b.habit).toBe(true);
    expect(b.cadence).toEqual({ kind: 'days', days: [0, 1, 2, 3, 4, 5, 6] });
    expect(b.timeOfDay).toBe('morning');
    expect(b.routine).toBe(true);
    expect(b.backlog).toBeFalsy();
  });

  it('it appears on Today on a day that is not a cleaning day', () => {
    const d = withPrefs(['home', 'morning'], tight);
    const tue = '2026-10-06'; // 3 days/week → Mon/Wed/Sat, so Tuesday is a rest day
    const t = todayPlan(view(d, tue));
    expect(t.isActiveDay).toBe(false);
    expect(t.focus.some((f) => f.task.id === bed(d).id)).toBe(true);
  });

  it('it also survives the "essentials only" lean mode', () => {
    const b = bed(withPrefs(['home', 'morning'], { ...tight, style: 'only-necessary' }));
    expect(b).toBeTruthy();
    expect(b.frequency).toBe('daily');
  });

  it('without a morning goal nothing changes: the bed is still an ordinary, fit-to-time task', () => {
    const d = withPrefs(['home'], tight);
    const b = bed(d);
    expect(b.habit).toBe(false);
    expect(b.reason).not.toMatch(/morning routine/i);
    // existing demo plans are untouched
    for (const id of ['A', 'B', 'C', 'D'] as const) {
      expect(plan(demo(id)).tasks.find((t) => t.templateId === 'br-bed' && t.roomId === 'bedroom-1')?.habit ?? false).toBe(false);
    }
  });

  it('the rest of the weekly scheduling still works: other home tasks are still fitted, stretched or parked', () => {
    const p = plan(withPrefs(['home', 'morning'], tight));
    expect(p.stats.weeklyMinutes).toBeLessThanOrEqual(p.stats.weeklyCapacity);
    expect(p.tasks.find((t) => t.templateId === 'b-toilet')!.frequency).toBe('weekly'); // essentials unchanged
    expect(p.tasks.filter((t) => !isLife(t) && t.templateId !== 'br-bed' && t.frequency === 'daily' && !t.habit).every((t) => t.templateId)).toBe(true);
    expect(p.stats.stretched + p.stats.backlogCount).toBeGreaterThan(0); // fitting logic still ran
  });

  it('only the user\'s own bed is protected in a shared apartment', () => {
    const p = plan(custom('shared', {}, { bedrooms: 3 }, { focus: ['home', 'morning'], sessionMinutes: 10, daysPerWeek: 3, style: 'several-short' }));
    expect(p.tasks.filter((t) => t.templateId === 'br-bed')).toHaveLength(1);
  });
});

// ───────────────────────── Fix: routine group headers have fixed icons ─────────────────────────

describe('plan group header visuals', () => {
  const v = view(withPrefs(['morning', 'evening', 'active'], { sessionMinutes: 30 }));
  it('Routines groups use their own time-of-day visual, whatever the first task is', () => {
    const r = sectionTasks(v, 'routine');
    expect(r.length).toBeGreaterThan(2);
    for (const t of r) expect(groupVisual('routine', t)).toEqual({ kind: 'time', time: t.timeOfDay });
    // same time of day, different domains → same visual
    const morning = r.filter((t) => t.timeOfDay === 'morning');
    const domains = new Set(morning.map((t) => t.domain));
    expect(domains.size).toBeGreaterThanOrEqual(1);
    expect(new Set(morning.map((t) => JSON.stringify(groupVisual('routine', t)))).size).toBe(1);
    // and a home task and a life task in the same evening group still map to the same icon
    const homeEvening = { ...r.find((t) => t.timeOfDay === 'morning')!, domain: 'home' as const, roomKind: 'kitchen' as const, timeOfDay: 'evening' as const };
    const lifeEvening = { ...homeEvening, domain: 'mind' as const, roomKind: 'home' as const };
    expect(groupVisual('routine', homeEvening)).toEqual(groupVisual('routine', lifeEvening));
    expect(groupVisual('routine', homeEvening)).toEqual({ kind: 'time', time: 'evening' });
  });
  it('other sections keep room / area icons', () => {
    const life = lifeTasks(withPrefs(['active']))[0];
    expect(groupVisual('weekly', life)).toEqual({ kind: 'domain', domain: life.domain });
    const home = plan(demo('B')).tasks.find((t) => t.roomKind === 'bathroom')!;
    expect(groupVisual('weekly', home)).toEqual({ kind: 'room', room: 'bathroom' });
  });
});
