import { describe, expect, it } from 'vitest';
import { addDays } from '../src/domain/dates';
import { computeInsights } from '../src/domain/learning';
import { PROGRESSION, progressionReadiness } from '../src/domain/progression';
import type { AppData, SessionEntry } from '../src/domain/types';
import { todayPlan } from '../src/domain/view';
import { reducer } from '../src/state/reducer';
import { demo, TODAY, view } from './helpers';

let n = 0;
const entry = (date: string, outcome: SessionEntry['outcome'] = 'completed', domain: SessionEntry['domain'] = 'mind'): SessionEntry => ({
  id: `p${n++}`, at: `${date}T09:00:00.000Z`, date, taskId: `t${n}`, name: 'x', roomKind: 'home', roomName: 'Mind', category: 'Mind', plannedMinutes: 5,
  actualMinutes: outcome === 'completed' ? 5 : 0, outcome, via: 'plan', domain,
});
/** `days` consecutive days ending yesterday, `perDay` completed habits on each. */
const streak = (days: number, perDay = 5, from = TODAY) => Array.from({ length: days }, (_, i) => addDays(from, -(i + 1))).flatMap((d) => Array.from({ length: perDay }, () => entry(d)));

describe('progression readiness', () => {
  it('REGRESSION: three days of five habits (15 completions) is NOT ready for a step up (the old rule said yes)', () => {
    const r = progressionReadiness(streak(3, 5), TODAY, addDays(TODAY, -3), 1);
    expect(r.completed).toBeGreaterThanOrEqual(12); // the old threshold would have fired
    expect(r.readyToStepUp).toBe(false);
  });

  it('still not ready after two perfect weeks: the minimum observation period has not passed', () => {
    const r = progressionReadiness(streak(14, 5), TODAY, addDays(TODAY, -14), 1);
    expect(r.activeDays).toBe(14);
    expect(r.observedDays).toBe(14);
    expect(r.readyToStepUp).toBe(false);
  });

  it('ready after three steady weeks across the week', () => {
    const r = progressionReadiness(streak(21, 3), TODAY, addDays(TODAY, -21), 1);
    expect(r.readyToStepUp).toBe(true);
    expect(r.weekdays).toBe(7);
  });

  it('counts DAYS, not tasks: lots of completions on a few days is not steadiness', () => {
    const days = [-1, -2, -3, -9, -10].map((o) => addDays(TODAY, o));
    const es = days.flatMap((d) => Array.from({ length: 20 }, () => entry(d)));
    const r = progressionReadiness(es, TODAY, addDays(TODAY, -30), 1);
    expect(r.completed).toBe(100);
    expect(r.activeDays).toBe(5);
    expect(r.readyToStepUp).toBe(false);
  });

  it('needs the habits spread over enough different weekdays', () => {
    // 15 distinct days but only Mondays-Fridays of three weeks has 15 days / 5 weekdays: exactly the minimum
    const es = Array.from({ length: 21 }, (_, i) => addDays(TODAY, -(i + 1))).filter((d) => ![0, 6].includes(new Date(`${d}T12:00:00`).getDay())).map((d) => entry(d));
    expect(progressionReadiness(es, TODAY, addDays(TODAY, -21), 1).readyToStepUp).toBe(true);
    const mondays = Array.from({ length: 4 }, (_, i) => addDays(TODAY, -7 * (i + 1))).map((d) => entry(d));
    expect(progressionReadiness(mondays, TODAY, addDays(TODAY, -30), 1).readyToStepUp).toBe(false);
  });

  it('too many skips blocks a step up even with enough days', () => {
    const es = [...streak(21, 1), ...streak(21, 1).map((e) => ({ ...e, id: `s${n++}`, outcome: 'skipped' as const }))];
    expect(progressionReadiness(es, TODAY, addDays(TODAY, -21), 1).missRatio).toBeGreaterThan(PROGRESSION.maxMissRatio);
    expect(progressionReadiness(es, TODAY, addDays(TODAY, -21), 1).readyToStepUp).toBe(false);
  });

  it('only time spent at the CURRENT level counts: history before the level changed is ignored', () => {
    const es = streak(21, 3);
    expect(progressionReadiness(es, TODAY, addDays(TODAY, -2), 2).readyToStepUp).toBe(false);
    expect(progressionReadiness(es, TODAY, addDays(TODAY, -2), 2).activeDays).toBeLessThanOrEqual(2);
  });

  it('home cleaning never counts towards habit progression', () => {
    const es = streak(21, 3).map((e) => ({ ...e, domain: 'home' as const }));
    expect(progressionReadiness(es, TODAY, addDays(TODAY, -21), 1).completed).toBe(0);
  });

  it('there is nothing above the top level, and nothing below the bottom', () => {
    expect(progressionReadiness(streak(21, 3), TODAY, addDays(TODAY, -21), 3).readyToStepUp).toBe(false);
    expect(progressionReadiness([], TODAY, addDays(TODAY, -21), 1).readyToEaseOff).toBe(false);
  });

  it('easing off needs at least ten days at the level and real evidence of struggling', () => {
    const skips = Array.from({ length: 12 }, (_, i) => entry(addDays(TODAY, -(i % 9) - 1), 'skipped'));
    expect(progressionReadiness(skips, TODAY, addDays(TODAY, -3), 2).readyToEaseOff).toBe(false);   // too soon
    expect(progressionReadiness(skips, TODAY, addDays(TODAY, -12), 2).readyToEaseOff).toBe(true);
    expect(progressionReadiness(skips, TODAY, addDays(TODAY, -12), 1).readyToEaseOff).toBe(false);  // nowhere easier to go
  });
});

describe('level clock and the suggestion itself', () => {
  it('changing the level restarts the clock; changing something else does not', () => {
    const d = demo('E');
    const up = reducer(d, { type: 'SET_PREFS', patch: { lifeLevel: 2 }, stamp: { now: `${TODAY}T10:00:00.000Z`, today: '2026-11-01' } });
    expect(up.preferences.levelSince).toBe('2026-11-01');
    const other = reducer(up, { type: 'SET_PREFS', patch: { equipment: 'basic' }, stamp: { now: `${TODAY}T10:00:00.000Z`, today: '2026-11-20' } });
    expect(other.preferences.levelSince).toBe('2026-11-01');
    const same = reducer(up, { type: 'SET_PREFS', patch: { lifeLevel: 2 }, stamp: { now: `${TODAY}T10:00:00.000Z`, today: '2026-11-25' } });
    expect(same.preferences.levelSince).toBe('2026-11-01');
  });

  it('the insight is only offered after three steady weeks, carries its evidence, and never changes the level by itself', () => {
    const d0 = demo('E');
    const task = todayPlan(view(d0)).life[0].task;
    const log = (days: number, startAt: string): AppData => {
      let d: AppData = { ...d0, plan: { ...d0.plan, startDate: startAt }, preferences: { ...d0.preferences, levelSince: startAt } };
      for (let i = 1; i <= days; i++) {
        const day = addDays(TODAY, -i);
        d = reducer(d, { type: 'TASK_COMPLETE', task, stamp: { today: day, now: `${day}T09:00:00.000Z` }, via: 'checkoff', entryId: `x${i}` });
      }
      return d;
    };
    const early = log(14, addDays(TODAY, -14));
    expect(computeInsights(view(early)).some((i) => i.id === 'level-up')).toBe(false);
    const late = log(21, addDays(TODAY, -21));
    const up = computeInsights(view(late)).find((i) => i.id === 'level-up');
    expect(up).toBeTruthy();
    expect(up!.code).toBe('level-up');
    expect(up!.evidence).toMatchObject({ windowDays: 21 });
    expect(late.preferences.lifeLevel).toBe(1);
  });
});
