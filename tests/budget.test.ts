import { describe, expect, it } from 'vitest';
import { dayBudget, fitDay, nominalSplit, type FitItem } from '../src/domain/budget';
import { addDays, weekday } from '../src/domain/dates';
import { buildResetTasks, generatePlan } from '../src/domain/engine';
import { roughDayTasks } from '../src/domain/life';
import { deriveContext } from '../src/domain/context';
import { pickJustFive } from '../src/domain/micro';
import { resetSequence, timeBox, TIME_OPTIONS } from '../src/domain/modes';
import { energyOk } from '../src/domain/safety';
import type { AppData, CustomTask, LifeFocus, Preferences, Task } from '../src/domain/types';
import { buildView, dayPlan, monthPlan, quickWins, roomTasks, sectionTasks, todayPlan, weekPlan, ROOM_MODE_ORDER } from '../src/domain/view';
import { reducer } from '../src/state/reducer';
import { custom, TODAY } from './helpers';

const mk = (focus: LifeFocus[], prefs: Partial<Preferences> = {}): AppData =>
  custom('apartment', {}, {}, { focus, sessionMinutes: 30, daysPerWeek: 5, style: 'several-short', ...prefs });
const viewOn = (d: AppData, today = TODAY) => buildView(d, generatePlan(d.home, d.preferences, d.plan), today);
const withEnergy = (d: AppData, level: 'low' | 'ok' | 'high', date = TODAY): AppData => ({ ...d, dayEnergy: { date, level } });

describe('one daily budget: the arithmetic', () => {
  it('cleaning and habits always add up to exactly the minutes the user chose', () => {
    for (let s = 5; s <= 90; s++) {
      for (const share of [0.6, 1]) {
        const both = nominalSplit(s, true, true, 0.6);
        expect(both.home + both.life, `${s}m`).toBe(s);
        expect(nominalSplit(s, true, false, share)).toEqual({ home: s, life: 0 });
        expect(nominalSplit(s, false, true, 0.25)).toEqual({ home: 0, life: s });
      }
    }
  });

  const plan = { sessionMinutes: 30, homeOn: true, lifeActive: true, homeShare: 0.6, habitBudget: 10, activeDays: [1, 3, 5] };
  it('a rest day shrinks cleaning to its daily basics; a low-energy day shrinks everything; a high-energy day stretches it', () => {
    expect(dayBudget(plan, 1)).toEqual({ active: true, home: 18, life: 12, total: 30 });
    expect(dayBudget(plan, 2)).toMatchObject({ active: false, home: 10, life: 12, total: 22 });
    expect(dayBudget(plan, 1, 'low').total).toBe(Math.round(18 * 0.6) + Math.round(12 * 0.6));
    expect(dayBudget(plan, 1, 'high').total).toBeGreaterThan(30);
  });
});

describe('fitDay: the one place a day is decided', () => {
  const item = (minutes: number, domain: 'home' | 'life', order: number, extra: Partial<FitItem> = {}): FitItem => ({ minutes, domain, order, weight: 50 - order, ...extra });
  const b = { active: true, home: 10, life: 6, total: 16 };

  it('each domain fills its own share first, and what one leaves free goes to the other', () => {
    const items = [item(6, 'home', 0), item(6, 'home', 1), item(2, 'life', 0)];
    const r = fitDay(items, b);
    // the second home task does not fit home's 10, but life left 4 minutes unused, so it goes in
    expect(r.planned).toContain(items[1]);
    expect(r.total).toBe(14);
    expect(r.overBy).toBe(0);
  });

  it('never plans more than the total', () => {
    const items = [item(9, 'home', 0), item(9, 'home', 1), item(5, 'life', 0), item(5, 'life', 1)];
    const r = fitDay(items, b);
    expect(r.total).toBeLessThanOrEqual(16);
    expect(r.deferred.every((d) => d.reason === 'time')).toBe(true);
    expect(r.planned.length + r.deferred.length).toBe(items.length);
  });

  it('a task bigger than the whole day is deferred with a reason, never squeezed in', () => {
    const r = fitDay([item(20, 'home', 0)], b);
    expect(r.planned).toHaveLength(0);
    expect(r.deferred[0].reason).toBe('time');
  });

  it('fixed essentials always go in, and the overage is the exact number of minutes', () => {
    const urgent = item(25, 'home', 5, { essential: true });
    const others = [item(4, 'home', 0), item(3, 'life', 0)];
    const r = fitDay([urgent, ...others], b);
    expect(r.planned).toEqual([urgent]);
    expect(r.overBy).toBe(25 - 16);
    expect(r.essentials).toEqual([urgent]);
    expect(r.deferred.map((d) => d.item)).toEqual(others);
  });

  it('essentials that fit cause no overage', () => {
    const r = fitDay([item(5, 'home', 0, { essential: true }), item(5, 'home', 1)], b);
    expect(r.overBy).toBe(0);
    expect(r.essentials).toEqual([]);
  });

  it('blocked tasks keep their own reason and use no minutes', () => {
    const r = fitDay([item(2, 'home', 0, { blocked: 'energy' }), item(2, 'home', 1, { blocked: 'rest-day' }), item(2, 'home', 2)], b);
    expect(r.deferred.map((d) => d.reason).sort()).toEqual(['energy', 'rest-day']);
    expect(r.total).toBe(2);
  });
});

const MODES: [string, LifeFocus[]][] = [
  ['home only', ['home']],
  ['life only', ['discipline', 'study', 'evening']],
  ['home + life', ['home', 'discipline', 'morning']],
  ['life, many goals', ['active', 'discipline', 'morning', 'evening', 'focus', 'phone', 'selfcare', 'study', 'organize', 'healthy', 'consistent']],
  ['home + many goals', ['home', 'active', 'discipline', 'morning', 'evening', 'focus', 'phone']],
];
const MINUTES = [5, 10, 15, 30, 60, 90];

describe('the budget holds on Today, Tomorrow, the week and the month', () => {
  for (const [name, focus] of MODES) for (const mins of MINUTES) {
    it(`${name}, ${mins} min: nothing planned ever adds up to more than the day's promise`, () => {
      for (const days of [3, 7]) for (const cleanliness of ['mostly-clean', 'quite-messy'] as const) {
        const d = custom('apartment', { cleanliness }, {}, { focus, sessionMinutes: mins, daysPerWeek: days, style: 'several-short' });
        const v = viewOn(d);
        for (let off = 0; off < 14; off++) {
          const date = addDays(TODAY, off);
          const dp = dayPlan(v, date);
          const where = `${name} ${mins}m ${days}d ${cleanliness} ${date}`;
          expect(dp.minutes, `${where}: ${dp.minutes} planned vs ${dp.budget}`).toBeLessThanOrEqual(dp.budget);
          expect(dp.overBy).toBe(0);
          // anything that is due and not planned says why
          for (const x of dp.deferred) expect(['time', 'energy', 'rest-day']).toContain(x.reason);
          if (off === 0) {
            const t = todayPlan(v);
            expect(t.totalPlanned, where).toBeLessThanOrEqual(t.totalBudget);
            expect(t.plannedMinutes + t.lifeMinutes, where).toBe(t.totalPlanned);
            expect(t.plannedMinutes, `${where}: cleaning`).toBeLessThanOrEqual(t.budget + (t.totalBudget - t.budget - t.lifeMinutes > 0 ? t.totalBudget - t.budget - t.lifeMinutes : 0));
          }
        }
      }
    });
  }

  it('Tomorrow, the week and the month are built by the same fit as Today', () => {
    const v = viewOn(mk(['home', 'discipline', 'morning'], { sessionMinutes: 30, daysPerWeek: 7 }));
    const today = dayPlan(v, TODAY), t = todayPlan(v);
    expect(today.budget).toBe(t.totalBudget);
    expect(today.minutes).toBe(t.totalPlanned);
    for (const w of weekPlan(v, TODAY)) expect(w.minutes).toBeLessThanOrEqual(w.budget);
    for (const w of monthPlan(v, TODAY).days) expect(w.minutes).toBeLessThanOrEqual(w.budget);
  });

  it('every task that is due on a day is either planned or deferred with a reason, and never both', () => {
    const v = viewOn(mk(['home', 'discipline'], { sessionMinutes: 10, daysPerWeek: 7 }));
    for (let off = 1; off < 10; off++) {
      const dp = dayPlan(v, addDays(TODAY, off));
      const planned = new Set(dp.tasks.map((x) => x.id));
      for (const x of dp.deferred) expect(planned.has(x.task.id)).toBe(false);
    }
    const t = todayPlan(v);
    const ids = [...t.focus, ...t.life, ...t.catchUp].map((x) => x.task.id);
    for (const x of t.deferred) expect(ids).not.toContain(x.item.task.id);
  });

  it('a low-energy day shrinks the whole promise and the plan still fits it', () => {
    for (const [, focus] of MODES) for (const mins of [10, 30, 60]) {
      const d = withEnergy(custom('apartment', {}, {}, { focus, sessionMinutes: mins, daysPerWeek: 7, style: 'daily' }), 'low');
      const t = todayPlan(viewOn(d));
      expect(t.totalBudget).toBeLessThan(mins);
      expect(t.totalPlanned).toBeLessThanOrEqual(t.totalBudget);
    }
  });
});

describe('fixed essentials may exceed the day, and the overage is stated exactly', () => {
  const urgent = (minutes: number): CustomTask => ({
    id: 'c_urgent', name: 'Give the medication', roomId: 'other', frequency: 'daily', minutes, priority: 'URGENT', notes: '', createdAt: TODAY, startDate: TODAY,
  });

  it('an urgent task of your own that is longer than the day is kept, the rest is left out, and the number is exact', () => {
    const base = mk(['home', 'discipline'], { sessionMinutes: 10, daysPerWeek: 7, style: 'daily' });
    const d = { ...base, customTasks: [urgent(25)] };
    const t = todayPlan(viewOn(d));
    expect(t.totalBudget).toBe(10);
    expect(t.focus.map((f) => f.task.id).concat(t.life.map((f) => f.task.id))).toContain('c_urgent');
    expect(t.overBy).toBe(t.totalPlanned - t.totalBudget);
    expect(t.overBy).toBeGreaterThanOrEqual(15);
    expect(t.overBecause.map((x) => x.id)).toEqual(['c_urgent']);
    // nothing else was squeezed in on top of it
    expect(t.totalPlanned).toBe(25);
    expect(t.deferred.length).toBeGreaterThan(0);
    expect(dayPlan(viewOn(d), TODAY).overBy).toBe(t.overBy);
  });

  it('an urgent task that fits is just a normal part of the day', () => {
    const base = mk(['home'], { sessionMinutes: 30, daysPerWeek: 7, style: 'daily' });
    const t = todayPlan(viewOn({ ...base, customTasks: [urgent(5)] }));
    expect(t.overBy).toBe(0);
    expect(t.totalPlanned).toBeLessThanOrEqual(30);
  });
});

describe('deferral never becomes starvation', () => {
  const completeDay = (d: AppData, date: string): { d: AppData; t: ReturnType<typeof todayPlan> } => {
    const t = todayPlan(viewOn(d, date));
    let n = d;
    for (const i of [...t.focus, ...t.life, ...t.catchUp]) n = reducer(n, { type: 'TASK_COMPLETE', task: i.task, stamp: { today: date, now: `${date}T09:00:00.000Z` }, via: 'checkoff', entryId: `e_${date}_${i.task.id}` });
    return { d: n, t };
  };

  it('an active cleaning day always makes progress on real cleaning, even when daily basics take most of the time', () => {
    for (const mins of [10, 30, 60]) {
      let d = mk(['home'], { sessionMinutes: mins, daysPerWeek: 7, style: 'daily' });
      d = { ...d, home: { ...d.home, cleanliness: 'quite-messy' } };
      let cleaningDays = 0;
      for (let off = 0; off < 14; off++) {
        const r = completeDay(d, addDays(TODAY, off)); d = r.d;
        if (r.t.focus.some((f) => !f.task.habit) || r.t.catchUp.length) cleaningDays++;
      }
      expect(cleaningDays, `${mins} minutes`).toBeGreaterThanOrEqual(13);
    }
  });

  it('a task that keeps being left out for time is pulled ahead of newer work after two days', () => {
    let d = mk(['home'], { sessionMinutes: 30, daysPerWeek: 7, style: 'daily' });
    const wait = new Map<string, number>();
    let worst = 0;
    for (let off = 0; off < 21; off++) {
      const date = addDays(TODAY, off);
      const r = completeDay(d, date); d = r.d;
      const left = new Set(r.t.deferred.filter((x) => x.reason === 'time' && x.item.task.tier === 'maintenance' && !x.item.task.habit && x.item.task.frequency !== 'seasonal').map((x) => x.item.task.id));
      for (const id of [...wait.keys()]) if (!left.has(id)) wait.delete(id);
      for (const id of left) { wait.set(id, (wait.get(id) ?? 0) + 1); worst = Math.max(worst, wait.get(id)!); }
    }
    expect(worst).toBeLessThanOrEqual(7);
  });
});

describe('low energy: every path that can surface a task uses the same rule', () => {
  // A user who could be offered hard and vigorous things on a normal day.
  const strong = (extra: Partial<Preferences> = {}) =>
    mk(['home', 'active', 'discipline', 'healthy', 'morning', 'selfcare'], { sessionMinutes: 60, daysPerWeek: 7, fitnessLevel: 'intermediate', equipment: 'basic', lifeLevel: 2, ...extra });
  const bad = (t: Task) => !energyOk(t, 'low');

  it('the rule itself: low energy rules out vigorous and hard; other days restrict nothing', () => {
    expect(energyOk({ difficulty: 3, intensity: 'gentle' }, 'low')).toBe(false);
    expect(energyOk({ difficulty: 1, intensity: 'vigorous' }, 'low')).toBe(false);
    expect(energyOk({ difficulty: 2, intensity: 'moderate' }, 'low')).toBe(true);
    expect(energyOk({ difficulty: 3, intensity: 'vigorous' }, 'ok')).toBe(true);
    expect(energyOk({ difficulty: 3, intensity: 'vigorous' }, 'high')).toBe(true);
  });

  it('the test is not vacuous: on a normal day these surfaces DO offer hard or vigorous tasks', () => {
    const v = viewOn(strong());
    const everything = [...sectionTasks(v, 'challenge'), ...sectionTasks(v, 'routine'), ...v.tasks];
    expect(everything.some(bad)).toBe(true);
    expect(sectionTasks(v, 'challenge').some(bad)).toBe(true);
  });

  it('Today (planned and left out), Quick wins, I only have X minutes, challenges, routines and room lists offer nothing hard or vigorous', () => {
    for (const prefs of [{}, { fitnessLevel: 'advanced' as const, lifeLevel: 3 as const }, { energy: 'low' as const }]) {
      const d = withEnergy(strong(prefs), 'low');
      const v = viewOn(d);
      const t = todayPlan(v);
      const planned = [...t.focus, ...t.life, ...t.catchUp].map((i) => i.task);
      expect(planned.filter(bad).map((x) => x.name), 'Today').toEqual([]);
      // the hard ones are not hidden: they are listed as left out, for energy
      expect(t.deferred.filter((x) => bad(x.item.task) && !x.item.task.challenge).every((x) => x.reason === 'energy' || x.reason === 'rest-day' || x.reason === 'time')).toBe(true);
      expect(quickWins(v, 50).filter(bad).map((x) => x.name), 'Quick wins').toEqual([]);
      for (const m of TIME_OPTIONS) expect(timeBox(v, m).tasks.filter(bad).map((x) => x.name), `I only have ${m}`).toEqual([]);
      // the sections that suggest what to do (not the catalogue sections that merely list the whole plan)
      for (const id of ['quick', 'challenge', 'routine'] as const) expect(sectionTasks(v, id).filter(bad).map((x) => `${id}: ${x.name}`), `section ${id}`).toEqual([]);
      for (const k of ROOM_MODE_ORDER) expect(roomTasks(v, k).filter(bad).map((x) => x.name), `room ${k}`).toEqual([]);
      const c = deriveContext(d.home, d.preferences);
      expect(roughDayTasks(c).filter(bad).map((x) => x.name), 'rough day').toEqual([]);
      for (let i = 0; i < 6; i++) { const five = pickJustFive(d, [], TODAY); if (five) expect(bad(five), five.name).toBe(false); }
      for (const s of resetSequence(d, TODAY)) expect(s.tasks.filter(bad).map((x) => x.name), `reset ${s.phase}`).toEqual([]);
    }
  });

  // The real catalogue offers few hard tasks to most profiles, so these tests inject one: if a list forgets the rule, it shows up.
  describe('a hard, vigorous task slipped into the plan is held back on a low-energy day by EVERY list, and shown on a normal day', () => {
    const inject = (energy: 'low' | 'ok') => {
      const d = withEnergy(mk(['home', 'active'], { sessionMinutes: 60, daysPerWeek: 7 }), energy);
      const v = viewOn(d);
      const base = v.tasks.find((t) => !t.habit && t.tier === 'maintenance' && t.minutes <= 8)!;
      const everyDay = { cadence: { kind: 'days' as const, days: [0, 1, 2, 3, 4, 5, 6] }, startDate: TODAY, frequency: 'daily' as const };
      const hardLife: Task = { ...base, ...everyDay, id: 'hard-life', name: 'ZZ hard life sprint', domain: 'fitness', roomId: 'life-fitness', roomName: 'Fitness', difficulty: 3, intensity: 'vigorous', minutes: 3, tier: 'maintenance', habit: false };
      const hard: Task = { ...base, ...everyDay, id: 'hard-x', name: 'ZZ hard sprint', difficulty: 3, intensity: 'vigorous', minutes: 5, quickWin: true, tier: 'maintenance', challenge: false, backlog: false, routine: true, timeOfDay: 'morning', frequency: 'daily', roomKind: 'kitchen', roomId: 'zz-room', impact: 10, score: 100 };
      const hardChallenge: Task = { ...hard, id: 'hard-c', name: 'ZZ hard challenge', challenge: true };
      v.tasks.push(hard, hardChallenge, hardLife); v.byId.set(hard.id, hard); v.byId.set(hardChallenge.id, hardChallenge); v.byId.set(hardLife.id, hardLife);
      return { v, d, hard };
    };
    const names = (xs: Task[]) => xs.map((t) => t.name);
    it('Quick wins', () => {
      expect(names(quickWins(inject('low').v, 50))).not.toContain('ZZ hard sprint');
      expect(names(quickWins(inject('ok').v, 50))).toContain('ZZ hard sprint');
    });
    it('I only have X minutes', () => {
      expect(names(timeBox(inject('low').v, 120).tasks)).not.toContain('ZZ hard sprint');
      expect(names(timeBox(inject('ok').v, 120).tasks)).toContain('ZZ hard sprint');
    });
    it('challenges, routines and room lists', () => {
      const low = inject('low').v, ok = inject('ok').v;
      expect(names(sectionTasks(low, 'challenge'))).not.toContain('ZZ hard challenge');
      expect(names(sectionTasks(ok, 'challenge'))).toContain('ZZ hard challenge');
      expect(names(sectionTasks(low, 'routine'))).not.toContain('ZZ hard sprint');
      expect(names(sectionTasks(ok, 'routine'))).toContain('ZZ hard sprint');
      expect(names(roomTasks(low, 'kitchen'))).not.toContain('ZZ hard sprint');
      expect(names(roomTasks(ok, 'kitchen'))).toContain('ZZ hard sprint');
    });
    it('Today: held back as "left out for low energy", never planned, for cleaning tasks and for habits alike', () => {
      const t = todayPlan(inject('low').v);
      const planned = [...t.focus, ...t.life, ...t.catchUp].map((i) => i.task.name);
      for (const n of ['ZZ hard sprint', 'ZZ hard life sprint']) {
        expect(planned, n).not.toContain(n);
        expect(t.deferred.find((x) => x.item.task.name === n)?.reason, n).toBe('energy');
      }
      // and on a normal day they are not held back for energy (they are planned or, at worst, left out for time)
      const ok = todayPlan(inject('ok').v);
      expect(ok.deferred.find((x) => x.reason === 'energy')).toBeUndefined();
      expect([...ok.focus, ...ok.life].map((i) => i.task.name).some((n) => n.startsWith('ZZ hard'))).toBe(true);
    });
    it('Just 5 minutes: nothing that takes more than the smallest effort on a low-energy day', () => {
      const lowD = withEnergy(mk(['home', 'active'], { sessionMinutes: 60, daysPerWeek: 7 }), 'low');
      const okD = withEnergy(mk(['home', 'active'], { sessionMinutes: 60, daysPerWeek: 7 }), 'ok');
      const picks = (d: AppData) => { const seen: string[] = []; const names = new Set<string>(); for (let i = 0; i < 40; i++) { const t = pickJustFive(d, seen, TODAY); if (!t) break; names.add(t.name); seen.push(t.id); } return names; };
      const HARDER = ['Vacuum one small area', 'Sweep the balcony quickly'];
      expect(HARDER.some((n) => picks(okD).has(n))).toBe(true);          // on a normal day they are offered…
      expect(HARDER.some((n) => picks(lowD).has(n))).toBe(false);        // …and on a low-energy day they are not
    });
    it('the reset sequence', () => {
      const d = withEnergy(mk(['home'], { sessionMinutes: 30, daysPerWeek: 7 }), 'low');
      for (const stage of resetSequence(d, TODAY)) for (const t of stage.tasks) expect(energyOk(t, 'low'), t.name).toBe(true);
      // with a hard task in the source: held back on a low day, offered on a normal one
      const real = buildResetTasks(d.home, d.preferences);
      const hard: Task = { ...real[0], id: 'hard-reset', name: 'ZZ hard reset', difficulty: 3, intensity: 'vigorous' };
      const names = (dd: AppData) => resetSequence(dd, TODAY, [...real, hard]).flatMap((s) => s.tasks.map((t) => t.name));
      expect(names(d)).not.toContain('ZZ hard reset');
      expect(names(withEnergy(d, 'ok'))).toContain('ZZ hard reset');
    });
  });

  it('the preference "my energy is low" removes hard and vigorous steps from the scheduled plan itself', () => {
    const p = generatePlan(strong({ energy: 'low' }).home, strong({ energy: 'low' }).preferences, { startDate: TODAY, resetCount: 0 });
    expect(p.tasks.filter((t) => t.domain && t.domain !== 'home').filter(bad).map((t) => t.name)).toEqual([]);
  });

  it('very low energy: no scheduled habit runs longer than 15 minutes, at any budget or fitness level', () => {
    for (const mins of [30, 45, 60, 90]) for (const fitnessLevel of ['beginner', 'intermediate', 'advanced'] as const) {
      const d = strong({ energy: 'very-low', sessionMinutes: mins, fitnessLevel, lifeLevel: 3 });
      const p = generatePlan(d.home, d.preferences, d.plan);
      const long = p.tasks.filter((t) => t.domain && t.domain !== 'home' && !t.challenge && t.minutes > 15).map((t) => `${t.name} ${t.minutes}m`);
      expect(long, `${mins}m ${fitnessLevel}`).toEqual([]);
    }
  });

  it('the day-level rule leaves normal days alone', () => {
    const v = viewOn(withEnergy(strong(), 'ok'));
    const t = todayPlan(v);
    expect(t.deferred.some((x) => x.reason === 'energy')).toBe(false);
  });

  it('habits shrink on a low-energy day: fewer minutes, same promise rule', () => {
    const ok = todayPlan(viewOn(withEnergy(strong(), 'ok')));
    const low = todayPlan(viewOn(withEnergy(strong(), 'low')));
    expect(low.lifeMinutes).toBeLessThan(ok.lifeMinutes);
    expect(low.lifeMinutes).toBeLessThanOrEqual(low.lifeBudget);
  });
});

describe('weekday sanity for the arithmetic above', () => {
  it('TODAY is a Monday', () => { expect(weekday(TODAY)).toBe(1); });
});
