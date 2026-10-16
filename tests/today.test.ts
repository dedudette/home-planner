import { describe, expect, it } from 'vitest';
import { appDataForDemo } from '../src/domain/demo';
import { addDays } from '../src/domain/dates';
import { generatePlan } from '../src/domain/engine';
import { isLife } from '../src/domain/scoring';
import type { AppData, LifeFocus, Preferences } from '../src/domain/types';
import { bucketLife, buildView, phaseOfHour, todayPlan, type DueItem } from '../src/domain/view';
import { custom, plan, TODAY, view } from './helpers';

const fnv = (s: string) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(16).padStart(8, '0'); };
const mix = (focus: LifeFocus[], prefs: Partial<Preferences> = {}): AppData =>
  custom('apartment', {}, {}, { focus, sessionMinutes: 30, daysPerWeek: 5, style: 'several-short', ...prefs });

describe('Now / Later / Evening', () => {
  it('maps the hour to a part of the day, with late night still counting as evening', () => {
    const table: [number, string][] = [[0, 'evening'], [4, 'evening'], [5, 'morning'], [9, 'morning'], [11, 'morning'], [12, 'afternoon'], [16, 'afternoon'], [17, 'evening'], [22, 'evening'], [23, 'evening']];
    for (const [h, p] of table) expect(phaseOfHour(h), `${h}:00`).toBe(p);
  });

  const items = (focus: LifeFocus[], hour: number) => {
    const t = todayPlan(view(mix(focus, { sessionMinutes: 45 })));
    return { t, b: bucketLife(t.life, hour) };
  };
  const tod = (i: DueItem) => i.task.timeOfDay ?? 'anytime';

  it('REGRESSION: in the morning an evening routine is tucked under "this evening", never shown as a current task', () => {
    const { t, b } = items(['morning', 'evening', 'discipline'], 8);
    expect(t.life.some((i) => tod(i) === 'evening')).toBe(true); // the plan does contain evening habits…
    expect(b.now.some((i) => tod(i) === 'evening')).toBe(false); // …but they are not presented as "now"
    expect(b.evening.every((i) => tod(i) === 'evening')).toBe(true);
    expect(b.evening.length).toBeGreaterThan(0);
    expect(b.now.every((i) => tod(i) === 'morning' || tod(i) === 'anytime')).toBe(true);
  });

  it('in the evening, evening routines are now and the morning ones are quietly "earlier"', () => {
    const { b } = items(['morning', 'evening', 'discipline'], 20);
    expect(b.now.some((i) => tod(i) === 'evening')).toBe(true);
    expect(b.earlier.every((i) => tod(i) === 'morning' || tod(i) === 'afternoon')).toBe(true);
    expect(b.evening).toHaveLength(0);
    expect(b.later).toHaveLength(0);
  });

  it('afternoon items wait as "later" in the morning and become "now" at 2 pm', () => {
    const t = todayPlan(view(mix(['study', 'discipline'], { sessionMinutes: 45 })));
    expect(t.life.some((i) => tod(i) === 'afternoon')).toBe(true);
    expect(bucketLife(t.life, 9).later.length).toBeGreaterThan(0);
    expect(bucketLife(t.life, 14).now.some((i) => tod(i) === 'afternoon')).toBe(true);
  });

  it('"anytime" habits are always available, and every habit lands in exactly one bucket at every hour', () => {
    const t = todayPlan(view(mix(['morning', 'evening', 'study', 'active', 'phone'], { sessionMinutes: 60 })));
    for (let h = 0; h < 24; h++) {
      const b = bucketLife(t.life, h);
      expect(b.now.length + b.later.length + b.evening.length + b.earlier.length, `${h}:00`).toBe(t.life.length);
      expect(new Set([...b.now, ...b.later, ...b.evening, ...b.earlier].map((i) => i.task.id)).size).toBe(t.life.length);
      for (const i of t.life) if (tod(i) === 'anytime') expect(b.now.includes(i), `${h}:00`).toBe(true);
    }
  });
});

describe('the daily time promise is honest', () => {
  const week = (d: AppData) => Array.from({ length: 7 }, (_, i) => { const day = addDays(TODAY, i); return todayPlan(buildView(d, plan(d), day)); });

  it('REGRESSION: a 30-minute day with cleaning and habits plans about 30 minutes, not 45', () => {
    // before: cleaning budget (30) + habits (12) on top of each other, up to 45 minutes
    const d = mix(['home', 'discipline', 'morning', 'evening'], { sessionMinutes: 30, daysPerWeek: 7, style: 'daily' });
    for (const t of week(d)) {
      expect(t.totalBudget).toBe(30);
      expect(t.totalPlanned, `planned ${t.totalPlanned} of ${t.totalBudget}`).toBeLessThanOrEqual(30);
    }
  });

  it('holds across many configurations: what is planned never exceeds the promise', () => {
    for (const mins of [20, 30, 45, 60, 90]) for (const days of [3, 5, 7]) for (const focus of [['home', 'discipline'], ['home', 'study', 'evening'], ['home', 'active', 'morning', 'phone']] as LifeFocus[][]) {
      for (const t of week(mix(focus, { sessionMinutes: mins, daysPerWeek: days }))) {
        expect(t.overBy).toBe(0);
        expect(t.totalPlanned, `${mins}m ${days}d ${focus}`).toBeLessThanOrEqual(t.totalBudget);
      }
    }
  });

  it('habit-only users get exactly the time they asked for', () => {
    const d = mix(['discipline', 'study'], { sessionMinutes: 30, daysPerWeek: 7 });
    for (const t of week(d)) {
      expect(t.totalBudget).toBe(30);
      expect(t.totalPlanned).toBeLessThanOrEqual(30);
    }
  });

  it('the cleaning list is sized to cleaning\'s share, so the two never add up to more than the day', () => {
    const d = mix(['home', 'discipline', 'morning'], { sessionMinutes: 30, daysPerWeek: 7, style: 'daily' });
    for (const t of week(d)) { expect(t.budget).toBe(18); expect(t.plannedMinutes).toBeLessThanOrEqual(18); }
  });

  it('on a rest day only the basics remain, and the promise says so', () => {
    const d = mix(['home', 'discipline'], { sessionMinutes: 30, daysPerWeek: 2 });
    const rest = week(d).find((t) => !t.isActiveDay)!;
    // Cleaning shrinks to the daily basics, so the promise is smaller than a cleaning day's, and still holds.
    expect(rest.budget).toBeLessThan(18);
    expect(rest.totalBudget).toBeLessThan(30);
    expect(rest.totalPlanned).toBeLessThanOrEqual(rest.totalBudget);
    expect(rest.focus.every((f) => f.task.habit)).toBe(true);
  });

  it('low energy shrinks the whole promise, not just cleaning', () => {
    const d = { ...mix(['home', 'discipline'], { sessionMinutes: 30, daysPerWeek: 7, style: 'daily' }), dayEnergy: { date: TODAY, level: 'low' as const } };
    expect(todayPlan(view(d)).totalBudget).toBe(18);
  });

  it('REGRESSION: cleaning jobs are cut to cleaning\'s share when habits are on, so one job cannot eat the whole day', () => {
    const both = plan(mix(['home', 'discipline'], { sessionMinutes: 45 }));
    const only = plan(mix(['home'], { sessionMinutes: 45 }));
    expect(both.chunkLimit).toBeLessThan(only.chunkLimit);
    expect(both.chunkLimit).toBeLessThanOrEqual(Math.round(45 * 0.6));
  });
});

describe('home-cleaning without habits stays pinned', () => {
  // Fingerprints of home-only plans and a week of Today screens. They were deliberately regenerated when the daily budget became exact
  // (cleaning jobs are now sized to fit the day beside the daily basics, and Today never exceeds the promise). Any other drift fails here.
  const GOLDEN: Record<string, [string, string]> = {
    A: ['17b848e8', '8b98c2ec'], B: ['3d177abb', '200b8845'], C: ['40646c0c', 'abcd4c23'], D: ['fd688e61', 'e82b0576'],
  };
  for (const id of ['A', 'B', 'C', 'D'] as const) {
    it(`demo ${id}: plan and a week of Today screens are unchanged`, () => {
      const d = appDataForDemo(id, { today: TODAY });
      const p = generatePlan(d.home, d.preferences, d.plan);
      const planHash = fnv(JSON.stringify(p.tasks.map((t) => [t.id, t.name, t.minutes, t.frequency, t.startDate, t.cadence, t.score, !!t.backlog, t.habit])));
      const days: unknown[] = [];
      for (const hist of [false, true]) for (let off = 0; off < 7; off++) {
        const today = addDays(TODAY, off);
        const dd = appDataForDemo(id, { today, withHistory: hist });
        const t = todayPlan(buildView(dd, generatePlan(dd.home, dd.preferences, dd.plan), today));
        days.push([t.focus.map((x) => x.task.id), t.extra.map((x) => x.task.id), t.catchUp.map((x) => x.task.id), t.budget, t.plannedMinutes, t.isActiveDay]);
      }
      expect([planHash, fnv(JSON.stringify(days))]).toEqual(GOLDEN[id]);
      expect(p.tasks.some(isLife)).toBe(false);
    });
  }
});

describe('life-only plans contain no cleaning', () => {
  it('has no home tasks, no reset sequence entries and no backlog', () => {
    const d = mix(['active', 'evening'], { sessionMinutes: 20 });
    const p = plan(d);
    expect(p.tasks.every(isLife)).toBe(true);
    expect(p.lifeActive).toBe(true);
    expect(p.stats.backlogCount).toBe(0);
    expect(view(d).tasks.every(isLife)).toBe(true);
  });
  it('still lets someone add their own cleaning task without it being swallowed', () => {
    const d = { ...mix(['discipline']), customTasks: [{ id: 'c1', domain: 'home' as const, name: 'Water the plants', roomId: 'other', frequency: 'once' as const, minutes: 5, priority: 'MEDIUM' as const, notes: '', startDate: TODAY, createdAt: TODAY }] };
    const t = todayPlan(view(d));
    expect([...t.focus, ...t.extra].some((i) => i.task.id === 'c1')).toBe(true);
  });
});

describe('home routines follow the same time of day rules as habits', () => {
  const hours = [0, 6, 8, 12, 15, 18, 21, 23];
  const tod = (i: DueItem) => i.task.timeOfDay ?? 'anytime';
  const home = (d: AppData) => todayPlan(view(d)).focus;

  // A home with routines tied to a time of day: the evening dish reset and tidy, and (with the morning goal) making the bed.
  const data = () => mix(['home', 'morning', 'evening'], { sessionMinutes: 60, daysPerWeek: 7, style: 'daily' });

  it('the plan really has timed home routines to test with', () => {
    const f = home(data());
    expect(f.some((i) => tod(i) === 'evening')).toBe(true);
    expect(f.some((i) => tod(i) === 'anytime')).toBe(true);
  });

  it('REGRESSION: at 8:00 an evening home routine is tucked under "this evening", never a current task; at 20:00 it is current', () => {
    const f = home(data());
    const am = bucketLife(f, 8);
    expect(am.now.some((i) => tod(i) === 'evening')).toBe(false);
    expect(am.evening.some((i) => tod(i) === 'evening')).toBe(true);
    expect(bucketLife(f, 20).now.some((i) => tod(i) === 'evening')).toBe(true);
  });

  it('a morning home routine is not offered as a current action in the afternoon or at night, but is never lost', () => {
    const f = home(data());
    const morning = f.filter((i) => tod(i) === 'morning');
    for (const h of [12, 15, 18, 21, 23, 0]) {
      const b = bucketLife(f, h);
      expect(b.now.some((i) => tod(i) === 'morning'), `${h}:00`).toBe(false);
      if (morning.length) expect(b.earlier.some((i) => tod(i) === 'morning'), `${h}:00`).toBe(true);
    }
    if (morning.length) expect(bucketLife(f, 6).now.some((i) => tod(i) === 'morning')).toBe(true);
  });

  it('every home task lands in exactly one bucket at every hour, and untimed cleaning is always "now"', () => {
    const f = home(data());
    for (const h of hours) {
      const b = bucketLife(f, h);
      const all = [...b.now, ...b.later, ...b.evening, ...b.earlier];
      expect(all.length, `${h}:00`).toBe(f.length);
      expect(new Set(all.map((i) => i.task.id)).size).toBe(f.length);
      for (const i of f) if (tod(i) === 'anytime') expect(b.now.includes(i), `${h}:00 ${i.task.name}`).toBe(true);
    }
  });

  it('home-only users with no timed routines see no change at any hour', () => {
    const f = todayPlan(view(mix(['home'], { sessionMinutes: 30, daysPerWeek: 7, style: 'daily' }))).focus.filter((i) => tod(i) === 'anytime');
    for (const h of hours) expect(bucketLife(f, h).now).toHaveLength(f.length);
  });
});
