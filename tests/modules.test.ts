import { describe, expect, it } from 'vitest';
import { activityHistory, activityTaskId, activityToTask, describeSchedule, scheduledDates, summarizeHistory } from '../src/domain/modules/activities';
import { defaultModulesFor, emptyModules, visibleCards } from '../src/domain/modules/registry';
import type { PlannedActivity } from '../src/domain/modules/types';
import { planOf } from '../src/domain/planInputs';
import { dueInfo } from '../src/domain/schedule';
import type { AppData } from '../src/domain/types';
import { buildView, dayPlan, todayPlan } from '../src/domain/view';
import { reducer, type Stamp } from '../src/state/reducer';
import { validateAppData } from '../src/storage/schema';
import { custom, demo, TODAY } from './helpers';

// TODAY is a Monday (2026-10-05).
const stampAt = (today: string, hour = 9): Stamp => ({ now: `${today}T${String(hour).padStart(2, '0')}:00:00.000Z`, today, hour, tz: 0 });

const act = (over: Partial<PlannedActivity> = {}): PlannedActivity => ({
  id: 'a1', module: 'movement', kind: 'flexible', name: 'Gentle walk', minutes: 20, schedule: { kind: 'weekly', weekdays: [1, 3, 5] }, time: null,
  startDate: TODAY, endDate: null, ref: null, intensity: 'gentle', difficulty: 1, note: '', createdAt: `${TODAY}T08:00:00.000Z`, archived: false, ...over,
});

/** A cleaning-only person with a 20-minute day, plus whatever activities and sections the test gives them. */
const person = (activities: PlannedActivity[] = [], patch: Partial<AppData['modules']> = {}, prefs: Partial<AppData['preferences']> = {}): AppData => {
  const d = custom('apartment', {}, {}, { sessionMinutes: 20, focus: ['home'], ...prefs });
  return { ...d, activities, modules: { ...emptyModules(), enabled: { ...emptyModules().enabled, movement: true }, ...patch } };
};
const viewOf = (d: AppData, today = TODAY) => buildView(d, planOf(d), today);

describe('schema v3: sections and planned activities', () => {
  const legacy = (focus: string[]) => {
    const d = custom('apartment', {}, {}, { focus: focus as never });
    const raw = JSON.parse(JSON.stringify(d)) as Record<string, unknown>;
    raw.version = 2; delete raw.modules; delete raw.activities;
    return raw;
  };

  it('a v2 save migrates to v3 without losing a thing and without asking anyone to onboard again', () => {
    const d = demo('G', { withHistory: true });
    const raw = JSON.parse(JSON.stringify(d)) as Record<string, unknown>;
    raw.version = 2; delete raw.modules; delete raw.activities;
    const r = validateAppData(raw, TODAY)!;
    expect(r.foundVersion).toBe(2);
    expect(r.data.version).toBe(3);
    expect(r.data.onboardingComplete).toBe(d.onboardingComplete);
    expect(r.data.sessions).toEqual(d.sessions);
    expect(r.data.taskStates).toEqual(d.taskStates);
    expect(r.data.activities).toEqual([]);
    expect(r.dropped).toBe(0);
  });

  it('turns a section on only where a goal the person already chose points at it, and shows the introduction once', () => {
    const m = validateAppData(legacy(['home', 'active', 'study']), TODAY)!.data.modules;
    expect(m.enabled).toEqual({ movement: true, meals: false, water: false, learning: true, wellbeing: false });
    expect(m.introSeen).toBe(false);
    expect(validateAppData(legacy(['home']), TODAY)!.data.modules.enabled).toEqual(emptyModules().enabled);
  });

  it('a cleaning-only person keeps exactly the plan they had', () => {
    const before = planOf(custom('apartment', {}, {}, { focus: ['home'] }));
    const d = validateAppData(legacy(['home']), TODAY)!.data;
    expect(planOf(d).tasks.map((t) => t.id)).toEqual(before.tasks.map((t) => t.id));
    expect(planOf(d).lifeActive).toBe(false);
  });

  it('switching sections on does not change how cleaning is generated', () => {
    const base = custom('apartment', {}, {}, { focus: ['home'], sessionMinutes: 30 });
    const withSections = { ...base, modules: { ...emptyModules(), enabled: { movement: true, meals: true, water: true, learning: true, wellbeing: true } } };
    expect(planOf(withSections).tasks.map((t) => t.id)).toEqual(planOf(base).tasks.map((t) => t.id));
    expect(planOf(withSections).homeShare).toBe(planOf(base).homeShare);
  });

  it('an empty focus is real when sections exist, and still means "cleaning" for an old file without them', () => {
    const d = person([], {}, { focus: [] });
    const r = validateAppData(JSON.parse(JSON.stringify(d)), TODAY)!;
    expect(r.data.preferences.focus).toEqual([]);
    const plan = planOf(r.data);
    expect(plan.homeOn).toBe(false);
    expect(plan.lifeActive).toBe(true);
    expect(plan.tasks.filter((t) => !t.domain || t.domain === 'home')).toHaveLength(0);
    const old = legacy([]);
    expect(validateAppData(old, TODAY)!.data.preferences.focus).toEqual(['home']);
  });

  it('repairs planned activities instead of trusting them', () => {
    const good = act({ id: 'ok' });
    const raw = JSON.parse(JSON.stringify(person([good])));
    raw.activities = [
      good,
      { ...good, id: 'ok' }, // duplicate id
      { ...good, id: 'no-module', module: 'nonsense' },
      { ...good, id: 'no-name', name: '   ' },
      { ...good, id: 'fixed-no-time', kind: 'fixed', time: null },
      { ...good, id: 'bad-time', kind: 'fixed', time: '25:99' },
      { ...good, id: 'bad-schedule', schedule: { kind: 'weekly', weekdays: [9, -1] } },
      { ...good, id: 'extra', secret: 'x', minutes: 99999 },
    ];
    const r = validateAppData(raw, TODAY)!;
    const byId = Object.fromEntries(r.data.activities.map((a) => [a.id, a]));
    expect(Object.keys(byId).sort()).toEqual(['bad-schedule', 'bad-time', 'extra', 'fixed-no-time', 'ok']);
    expect(r.dropped).toBe(3);
    expect(byId['fixed-no-time'].kind).toBe('flexible');
    expect(byId['bad-time'].kind).toBe('flexible');
    expect(byId['bad-schedule'].schedule).toEqual({ kind: 'once', date: TODAY });
    expect(byId.extra.minutes).toBe(480);
    expect('secret' in byId.extra).toBe(false);
  });

  it('keeps the dashboard order a full permutation and the plan card always visible', () => {
    const raw = JSON.parse(JSON.stringify(person()));
    raw.modules = { enabled: { movement: true, bogus: true }, order: ['water', 'water', 'x', 'plan'], hidden: ['plan', 'water', 'nope'], caps: { movement: 45, meals: 2, learning: 'x' } };
    const m = validateAppData(raw, TODAY)!.data.modules;
    expect(m.order).toEqual(['water', 'plan', 'meals', 'checkin']);
    expect(m.hidden).toEqual(['water']);
    expect(m.caps).toEqual({ movement: 45 });
    expect(Object.keys(m.enabled).sort()).toEqual(['learning', 'meals', 'movement', 'water', 'wellbeing']);
  });

  it('visible cards are only those that exist and were not hidden', () => {
    const m = { ...defaultModulesFor(['home'], true), enabled: { movement: false, meals: true, water: true, learning: false, wellbeing: false }, hidden: ['water' as const] };
    expect(visibleCards(m)).toEqual(['plan', 'meals']);
  });
});

describe('a planned activity is one task with one identity', () => {
  it('its task id comes only from the activity id, and it carries its own schedule label', () => {
    const t = activityToTask(act({ id: 'x9' }));
    expect(t.id).toBe(activityTaskId('x9'));
    expect(t.activityId).toBe('x9');
    expect(t.scheduleLabel).toBe('Every Mon, Wed, Fri');
    expect(t.cadence).toEqual({ kind: 'days', days: [1, 3, 5] });
    expect(describeSchedule(act({ schedule: { kind: 'weekly', weekdays: [0, 1, 2, 3, 4, 5, 6] } }))).toBe('Every day');
  });

  it('is due only on its own weekdays, from its start date', () => {
    const d = person([act({ startDate: TODAY })]);
    const v = viewOf(d);
    const t = v.byId.get('act:a1')!;
    expect(dueInfo(t, v.states[t.id], TODAY).due).toBe(TODAY); // Monday
    expect(scheduledDates(act(), '2026-10-05', '2026-10-11')).toEqual(['2026-10-05', '2026-10-07', '2026-10-09']);
    const tue = dayPlan(viewOf(d), '2026-10-06').tasks.map((x) => x.id);
    expect(tue).not.toContain('act:a1');
    expect(dayPlan(viewOf(d), '2026-10-07').tasks.map((x) => x.id)).toContain('act:a1');
  });

  it('completing it logs exactly one entry, and doing it twice does not count twice', () => {
    let d = person([act()]);
    const task = viewOf(d).byId.get('act:a1')!;
    d = reducer(d, { type: 'TASK_COMPLETE', task, stamp: stampAt(TODAY), via: 'checkoff', entryId: 'e1' });
    d = reducer(d, { type: 'TASK_COMPLETE', task, stamp: stampAt(TODAY, 10), via: 'checkoff', entryId: 'e2' });
    const entries = d.sessions.flatMap((s) => s.entries).filter((e) => e.taskId === 'act:a1');
    expect(entries).toHaveLength(1);
    expect(entries[0].domain).toBe('fitness');
    expect(d.taskStates['act:a1'].due).toBe('2026-10-07');
  });

  it('a fixed one-off on a day gone by is not carried forward to today', () => {
    const d = person([act({ id: 'class', kind: 'fixed', time: '18:00', schedule: { kind: 'once', date: '2026-10-02' } })]);
    expect(viewOf(d).tasks.map((t) => t.id)).not.toContain('act:class');
    expect(viewOf(d).byId.has('act:class')).toBe(true);
    const flexible = person([act({ id: 'later', kind: 'flexible', schedule: { kind: 'once', date: '2026-10-02' } })]);
    expect(viewOf(flexible).tasks.map((t) => t.id)).toContain('act:later');
  });

  it('an archived activity leaves the plan but keeps its history', () => {
    let d = person([act()]);
    const task = viewOf(d).byId.get('act:a1')!;
    d = reducer(d, { type: 'TASK_COMPLETE', task, stamp: stampAt(TODAY), via: 'checkoff', entryId: 'e1' });
    d = reducer(d, { type: 'ACTIVITY_ARCHIVE', id: 'a1', archived: true });
    expect(viewOf(d).byId.has('act:a1')).toBe(false);
    expect(d.sessions.flatMap((s) => s.entries)).toHaveLength(1);
  });
});

describe('scheduled, completed, skipped and unrecorded stay different things', () => {
  it('a past scheduled day with nothing logged is unrecorded, never skipped or zero', () => {
    const a = act({ startDate: '2026-09-28' }); // Mon, Wed, Fri
    let d = person([a]);
    const task = activityToTask(a);
    d = reducer(d, { type: 'TASK_COMPLETE', task, stamp: stampAt('2026-09-28'), via: 'checkoff', entryId: 'c1', minutes: 25 } as never);
    d = reducer(d, { type: 'TASK_SKIP', task, stamp: stampAt('2026-09-30'), entryId: 's1' });
    const occ = activityHistory(d, a, '2026-09-28', '2026-10-07', TODAY);
    const state = Object.fromEntries(occ.map((o) => [o.date, o.state]));
    expect(state['2026-09-28']).toBe('completed');
    expect(state['2026-09-30']).toBe('skipped');
    expect(state['2026-10-02']).toBe('unrecorded');
    expect(state['2026-10-05']).toBe('scheduled'); // today, not over yet
    expect(state['2026-10-07']).toBe('scheduled');
    const sum = summarizeHistory(occ);
    expect(sum).toMatchObject({ completed: 1, skipped: 1, unrecorded: 1, scheduled: 2 });
    expect(sum.minutes).toBe(25);
  });
});

describe('the one shared daily plan', () => {
  it('never drops something the person scheduled for time, and says honestly how far over it is', () => {
    const d = person([act({ id: 'long', minutes: 30, schedule: { kind: 'weekly', weekdays: [1] } })]);
    const t = todayPlan(viewOf(d));
    const planned = [...t.life, ...t.focus].map((i) => i.task.id);
    expect(planned).toContain('act:long');
    expect(t.totalBudget).toBe(20);
    expect(t.overBy).toBeGreaterThanOrEqual(10);
    expect(t.overBecause.map((x) => x.id)).toContain('act:long');
  });

  it('applies the low-energy rule to a planned vigorous workout: it is left out for that reason, not forced', () => {
    const vig = act({ id: 'hiit', intensity: 'vigorous', difficulty: 3, minutes: 20, schedule: { kind: 'weekly', weekdays: [1] } });
    let d = person([vig]);
    d = reducer(d, { type: 'DAY_ENERGY', level: 'low', stamp: stampAt(TODAY) });
    const t = todayPlan(viewOf(d));
    expect([...t.life, ...t.focus].map((i) => i.task.id)).not.toContain('act:hiit');
    expect(t.deferred.find((x) => x.item.task.id === 'act:hiit')?.reason).toBe('energy');
    // a gentle one on the same day is still planned
    const gentle = person([act({ id: 'stretch', minutes: 10, schedule: { kind: 'weekly', weekdays: [1] } })]);
    const low = reducer(gentle, { type: 'DAY_ENERGY', level: 'low', stamp: stampAt(TODAY) });
    expect([...todayPlan(viewOf(low)).life].map((i) => i.task.id)).toContain('act:stretch');
  });

  it('an optional activity is shown as an option and never counted or due-pressured', () => {
    const d = person([act({ id: 'idea', kind: 'optional', minutes: 40, schedule: { kind: 'weekly', weekdays: [1] } })]);
    const t = todayPlan(viewOf(d));
    expect(t.optional.map((i) => i.task.id)).toEqual(['act:idea']);
    expect([...t.life, ...t.focus].map((i) => i.task.id)).not.toContain('act:idea');
    expect(t.deferred.map((x) => x.item.task.id)).not.toContain('act:idea');
    expect(t.overBy).toBe(0);
  });

  it('reports overlapping fixed times and does not move either', () => {
    const d = person([
      act({ id: 'yoga', kind: 'fixed', time: '18:00', minutes: 60, schedule: { kind: 'weekly', weekdays: [1] } }),
      act({ id: 'class', module: 'learning', kind: 'fixed', time: '18:30', minutes: 45, schedule: { kind: 'weekly', weekdays: [1] } }),
    ], { enabled: { ...emptyModules().enabled, movement: true, learning: true } });
    const t = todayPlan(viewOf(d));
    expect(t.conflicts.map((c) => c.kind)).toContain('overlap');
    expect([...t.life].map((i) => i.task.id)).toEqual(expect.arrayContaining(['act:yoga', 'act:class']));
    const separate = person([
      act({ id: 'yoga', kind: 'fixed', time: '18:00', minutes: 60, schedule: { kind: 'weekly', weekdays: [1] } }),
      act({ id: 'class', module: 'learning', kind: 'fixed', time: '19:00', minutes: 45, schedule: { kind: 'weekly', weekdays: [1] } }),
    ], { enabled: { ...emptyModules().enabled, movement: true, learning: true } });
    expect(todayPlan(viewOf(separate)).conflicts.filter((c) => c.kind === 'overlap')).toHaveLength(0);
  });

  it('a category allowance holds back what the planner chose, and only reports what the person chose', () => {
    // 60-minute day, movement allowance 15: the planner's own fitness habits stop at 15 min; a planned 25-minute workout stays and is reported.
    const base = custom('apartment', {}, {}, { sessionMinutes: 60, focus: ['home', 'active'], fitnessLevel: 'intermediate' });
    const withCap = { ...base, modules: { ...emptyModules(), enabled: { ...emptyModules().enabled, movement: true }, caps: { movement: 15 } } };
    const fitness = (xs: { task: { domain?: string; minutes: number } }[]) => xs.filter((i) => i.task.domain === 'fitness').reduce((n, i) => n + i.task.minutes, 0);
    const none = todayPlan(viewOf({ ...withCap, modules: { ...withCap.modules, caps: {} } }));
    expect(fitness(none.life)).toBeGreaterThan(15); // so the allowance below really has something to hold back
    const t = todayPlan(viewOf(withCap));
    expect(fitness(t.life)).toBeLessThanOrEqual(15);
    expect(t.deferred.some((x) => x.item.task.domain === 'fitness' && x.reason === 'category')).toBe(true);
    const planned = { ...withCap, activities: [act({ id: 'run', minutes: 25, schedule: { kind: 'weekly', weekdays: [1] } })] };
    const t2 = todayPlan(viewOf(planned));
    expect(t2.life.map((i) => i.task.id)).toContain('act:run');
    expect(t2.conflicts.some((c) => c.kind === 'category' && c.module === 'movement')).toBe(true);
    // the planner's own movement habits make way for what the person chose: nothing but the 25-minute workout is added to movement
    expect(t2.life.filter((i) => i.task.domain === 'fitness' && i.task.id !== 'act:run').every((i) => i.task.minutes <= 15)).toBe(true);
  });

  it('with no allowance set nothing is held back and nothing is reported', () => {
    const d = person([act({ id: 'run', minutes: 25, schedule: { kind: 'weekly', weekdays: [1] } })]);
    expect(todayPlan(viewOf(d)).conflicts.filter((c) => c.kind === 'category')).toHaveLength(0);
  });
});

describe('editing activities', () => {
  it('a rename keeps a snooze; a change of days re-derives the next date', () => {
    let d = person([act()]);
    const task = viewOf(d).byId.get('act:a1')!;
    d = reducer(d, { type: 'TASK_MOVE', task, to: '2026-10-09', stamp: stampAt(TODAY), entryId: 'm1' });
    expect(d.taskStates['act:a1'].due).toBe('2026-10-09');
    d = reducer(d, { type: 'ACTIVITY_SAVE', activity: act({ name: 'Long walk' }), today: TODAY });
    expect(d.taskStates['act:a1'].due).toBe('2026-10-09');
    d = reducer(d, { type: 'ACTIVITY_SAVE', activity: act({ name: 'Long walk', schedule: { kind: 'weekly', weekdays: [2] } }), today: TODAY });
    expect(d.taskStates['act:a1'].due).toBeUndefined();
    expect(dueInfo(viewOf(d).byId.get('act:a1')!, d.taskStates['act:a1'], TODAY).due).toBe('2026-10-06'); // next Tuesday, not Friday
  });

  it('deleting an activity removes its plan and none of its history', () => {
    let d = person([act()]);
    const task = viewOf(d).byId.get('act:a1')!;
    d = reducer(d, { type: 'TASK_COMPLETE', task, stamp: stampAt(TODAY), via: 'checkoff', entryId: 'e1' });
    d = reducer(d, { type: 'ACTIVITY_DELETE', id: 'a1' });
    expect(d.activities).toHaveLength(0);
    expect(d.taskStates['act:a1']).toBeUndefined();
    expect(d.sessions.flatMap((s) => s.entries)).toHaveLength(1);
  });

  it('turning a section off hides it and deletes nothing', () => {
    let d = person([act()]);
    d = reducer(d, { type: 'MODULE_SET', id: 'movement', on: false });
    expect(d.modules.enabled.movement).toBe(false);
    expect(d.activities).toHaveLength(1);
  });

  it('dashboard order and hiding go through the reducer as a full, valid arrangement', () => {
    let d = person();
    d = reducer(d, { type: 'MODULE_CARDS', order: ['water', 'plan'], hidden: ['plan', 'meals'] });
    expect(d.modules.order).toEqual(['water', 'plan', 'meals', 'checkin']);
    expect(d.modules.hidden).toEqual(['meals']);
  });

  it('an allowance can be set and cleared', () => {
    let d = person();
    d = reducer(d, { type: 'MODULE_CAP', module: 'movement', minutes: 40 });
    expect(d.modules.caps).toEqual({ movement: 40 });
    d = reducer(d, { type: 'MODULE_CAP', module: 'movement', minutes: null });
    expect(d.modules.caps).toEqual({});
  });
});
