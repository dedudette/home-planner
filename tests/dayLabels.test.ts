import { describe, expect, it } from 'vitest';
import { dayAriaLabel, dayEmptyNote, dayFill, dayHeadline } from '../src/domain/dayLabels';
import { addDays, startOfWeek } from '../src/domain/dates';
import type { AppData, ExposureRecord } from '../src/domain/types';
import { dayPlan, monthPlan, weekPlan } from '../src/domain/view';
import { demo, TODAY, view } from './helpers';

// TODAY is a Monday (2026-10-05): the week of Monday 5 to Sunday 11 October 2026.
const WEEK = Array.from({ length: 7 }, (_, i) => addDays(TODAY, i));
const NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const everyDay = (): AppData => { const d = demo('B', { withHistory: false }); return { ...d, preferences: { ...d.preferences, daysPerWeek: 7, sessionMinutes: 20 } }; };
const record = (date: string, o: Partial<ExposureRecord> = {}): ExposureRecord => ({
  date, contract: 2, recordedAt: `${date}T08:00:00.000Z`, planVersion: 'pv1', activeDay: true, energy: 'ok', tzOffsetMin: 0, budgetMinutes: 20,
  items: [
    { taskId: 'a', templateId: null, domain: 'home', minutes: 6, difficulty: 1, kind: 'focus', selectedAt: `${date}T08:00:00.000Z` },
    { taskId: 'b', templateId: null, domain: 'home', minutes: 4, difficulty: 1, kind: 'life', selectedAt: `${date}T08:00:00.000Z` },
  ], ...o,
});

describe('a day that has already happened is history, whatever today’s settings would plan', () => {
  for (const [i, name] of NAMES.entries()) {
    it(`on a ${name}: the ${i} earlier day(s) of this week are history and the rest are planned`, () => {
      const today = WEEK[i];
      const v = view(everyDay(), today);
      const days = weekPlan(v, startOfWeek(today));
      expect(days.map((d) => d.date)).toEqual(WEEK);
      expect(days.filter((d) => d.past).map((d) => d.date)).toEqual(WEEK.slice(0, i));
      for (const d of days.slice(0, i)) {
        expect(d).toMatchObject({ past: true, tasks: [], budget: 0, minutes: 0, overBy: 0, deferred: [], conflicts: [], recorded: null });
        expect(dayHeadline(d, false)).toBe('No saved plan');
        expect(dayHeadline(d, true)).toBe('No saved plan');                         // never "Free", never "Rest day": those describe a plan
        expect(dayEmptyNote(d, false)).toMatch(/No plan was saved for this day/);
        expect(dayFill(d)).toBeNull();
      }
      for (const d of days.slice(i)) expect(d.past).toBe(false);
      expect(days.slice(i).every((d) => d.tasks.length > 0 && d.budget > 0)).toBe(true);        // every remaining day is planned, with the promise
    });
  }

  it('today itself is not history', () => {
    const d = dayPlan(view(everyDay(), WEEK[3]), WEEK[3]);
    expect(d.past).toBe(false);
    expect(d.tasks.length).toBeGreaterThan(0);
  });

  it('a past day shows what was logged on it, and says nothing about a plan', () => {
    let data = everyDay();
    const v0 = view(data, WEEK[1]);
    const task = dayPlan(v0, WEEK[1]).tasks[0];
    data = { ...data, sessions: [{ id: 's1', date: WEEK[0], startedAt: `${WEEK[0]}T09:00:00.000Z`, entries: [{ id: 'e1', at: `${WEEK[0]}T09:10:00.000Z`, date: WEEK[0], taskId: task.id, name: task.name, roomKind: 'kitchen', roomName: 'Kitchen', category: 'x', plannedMinutes: 5, actualMinutes: 7, outcome: 'completed', via: 'checkoff' }] }] } as unknown as AppData;
    const monday = dayPlan(view(data, WEEK[1]), WEEK[0]);
    expect(monday.past).toBe(true);
    expect(monday.done.map((e) => e.name)).toEqual([task.name]);
    expect(dayHeadline(monday, false)).toBe('No saved plan');
    expect(dayAriaLabel(monday)).toMatch(/no saved plan, 1 done/);
  });
});

describe('what the planner saved on a past day is shown as saved, and is not recomputed', () => {
  it('shows the saved selection, its minutes and the promise it was made with', () => {
    const data: AppData = { ...everyDay(), exposures: [record(WEEK[0])] };
    const d = dayPlan(view(data, WEEK[2]), WEEK[0]);
    expect(d.recorded).toEqual({ planned: 2, minutes: 10, budget: 20, activeDay: true });
    expect(dayHeadline(d, false)).toBe('2 planned then · 10 min of 20 min');
    expect(dayEmptyNote(d, false)).toMatch(/as it was saved then/);
    expect(dayFill(d)).toBe(0.5);
    expect(dayAriaLabel(d)).toMatch(/2 planned then, 10 minutes/);
  });
  it('changing today’s settings afterwards changes nothing about it', () => {
    const base: AppData = { ...everyDay(), exposures: [record(WEEK[0])] };
    const changed: AppData = { ...base, preferences: { ...base.preferences, sessionMinutes: 90, daysPerWeek: 2 } };
    expect(dayPlan(view(changed, WEEK[2]), WEEK[0]).recorded).toEqual(dayPlan(view(base, WEEK[2]), WEEK[0]).recorded);
    expect(dayHeadline(dayPlan(view(changed, WEEK[2]), WEEK[0]), false)).toBe('2 planned then · 10 min of 20 min');
  });
  it('a saved rest day says so; a saved empty active day says nothing was planned; old "extra" (left-out) items are not counted as planned', () => {
    const data: AppData = { ...everyDay(), exposures: [record(WEEK[0], { activeDay: false, items: [] }), record(WEEK[1], { items: [] }), record(WEEK[2], { items: [{ taskId: 'x', templateId: null, domain: 'home', minutes: 9, difficulty: 1, kind: 'extra' }] })] };
    const v = view(data, WEEK[4]);
    expect(dayHeadline(dayPlan(v, WEEK[0]), false)).toBe('A rest day then');
    expect(dayHeadline(dayPlan(v, WEEK[1]), false)).toBe('Nothing was planned');
    expect(dayHeadline(dayPlan(v, WEEK[2]), false)).toBe('Nothing was planned');
  });
  it('only a day with a record has one: its neighbours still say "No saved plan"', () => {
    const data: AppData = { ...everyDay(), exposures: [record(WEEK[1])] };
    const days = weekPlan(view(data, WEEK[4]), WEEK[0]);
    expect(days.slice(0, 4).map((d) => dayHeadline(d, false))).toEqual(['No saved plan', '2 planned then · 10 min of 20 min', 'No saved plan', 'No saved plan']);
  });
});

describe('days that have not happened are worded as before', () => {
  it('a planned day shows its count and promise; an unplanned future day is "Free" or a "Rest day"', () => {
    const v = view(everyDay(), TODAY);
    const d = dayPlan(v, WEEK[2]);
    expect(dayHeadline(d, false)).toMatch(/^\d+ · .+ of \d+ min$/);
    expect(dayHeadline({ ...d, tasks: [] }, false)).toBe('Free');
    expect(dayHeadline({ ...d, tasks: [] }, true)).toBe('Rest day');
    expect(dayEmptyNote({ ...d, tasks: [] }, true)).toBe('A rest day, with nothing planned.');
    expect(dayEmptyNote({ ...d, tasks: [] }, false)).toBe('Nothing planned.');
    expect(dayAriaLabel(d)).toMatch(/\d+ tasks, \d+ minutes/);
    expect(dayFill(d)).toBeGreaterThan(0);
  });
  it('the month grid follows the same rule for every day', () => {
    const v = view(everyDay(), WEEK[3]);
    const m = monthPlan(v, TODAY);
    for (const d of m.days) expect(d.past).toBe(d.date < WEEK[3]);
  });
});
