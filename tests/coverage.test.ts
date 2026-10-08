import { describe, expect, it } from 'vitest';
import { deriveContext } from '../src/domain/context';
import { explainCover, GOAL_RULES, isPrimary, servesGoal } from '../src/domain/goals';
import { generatePlan } from '../src/domain/engine';
import { blockedReason, buildLifeTasks, failureReason, maxLifeTasks } from '../src/domain/life';
import { LIFE_TEMPLATES, type LifeTemplate } from '../src/domain/lifeCatalog';
import { FOCUS_OPTIONS } from '../src/domain/options';
import { isLife } from '../src/domain/scoring';
import type { AppData, GoalDeferReason, LifeFocus, Preferences } from '../src/domain/types';
import { custom, TODAY } from './helpers';

const ALL_GOALS = FOCUS_OPTIONS.map((f) => f.value).filter((f) => f !== 'home') as LifeFocus[];
const tpl = (id: string) => LIFE_TEMPLATES.find((t) => t.id === id)!;
const prefs = (focus: LifeFocus[], mins: number, extra: Partial<Preferences> = {}): AppData =>
  custom('apartment', {}, {}, { focus, sessionMinutes: mins, daysPerWeek: 7, style: 'daily', ...extra });
const planFor = (d: AppData) => generatePlan(d.home, d.preferences, { startDate: TODAY, resetCount: 0 });

describe('every goal has an explicit rule, and the rule decides what counts', () => {
  it('there is a rule, in words, for every goal', () => {
    for (const g of ALL_GOALS) {
      const r = GOAL_RULES[g as keyof typeof GOAL_RULES];
      expect(r, g).toBeTruthy();
      expect(r.means.length).toBeGreaterThan(15);
      expect(r.min).toBeGreaterThanOrEqual(1);
    }
  });

  // [goal, template, minutes, expected role]. Positive and negative cases for every goal: a task tagged for a goal is not thereby cover.
  const CASES: [LifeFocus, string, number, 'primary' | 'supporting'][] = [
    ['active', 'f-walk', 5, 'primary'], ['active', 'f-full-body', 12, 'primary'], ['active', 'f-squats', 3, 'supporting'], ['active', 'f-stretch', 10, 'supporting'], ['active', 'o-outside', 15, 'supporting'],
    ['discipline', 's-make-bed', 2, 'primary'], ['discipline', 'm-top3', 3, 'primary'], ['discipline', 'c-water', 1, 'supporting'], ['discipline', 'b-breath', 5, 'supporting'],
    ['morning', 's-make-bed', 2, 'primary'], ['morning', 'o-daylight', 5, 'primary'], ['morning', 'c-teeth', 2, 'supporting'], ['morning', 'a-prep-tomorrow', 5, 'supporting'],
    ['evening', 'a-plan-tomorrow', 5, 'primary'], ['evening', 's-dim', 1, 'primary'], ['evening', 'c-teeth-night', 2, 'supporting'],
    ['focus', 'm-focus', 10, 'primary'], ['focus', 'm-top3', 3, 'primary'], ['focus', 'b-breath', 5, 'supporting'], ['focus', 'm-read', 10, 'supporting'], ['focus', 'd-notifications', 10, 'supporting'],
    ['phone', 'd-phone-free', 5, 'primary'], ['phone', 'd-social-break', 15, 'primary'], ['phone', 'd-notifications', 10, 'primary'], ['phone', 'd-nophone-bed', 1, 'supporting'], ['phone', 'd-photos', 15, 'supporting'], ['phone', 'm-read', 10, 'supporting'],
    ['selfcare', 'c-water', 1, 'primary'], ['selfcare', 'b-breath', 5, 'primary'], ['selfcare', 'm-journal', 5, 'primary'], ['selfcare', 'f-walk', 10, 'supporting'], ['selfcare', 'l-learn-new', 10, 'supporting'],
    ['study', 'l-study', 5, 'primary'], ['study', 'l-practice', 10, 'primary'], ['study', 'm-read', 10, 'supporting'], ['study', 'm-focus', 10, 'supporting'],
    ['organize', 'a-budget', 20, 'primary'], ['organize', 'd-desktop', 5, 'primary'], ['organize', 'm-top3', 3, 'primary'], ['organize', 's-clothes', 3, 'supporting'],
    ['healthy', 'f-walk', 5, 'primary'], ['healthy', 'o-outside', 5, 'primary'], ['healthy', 'c-breakfast', 10, 'primary'], ['healthy', 'c-teeth', 2, 'supporting'], ['healthy', 'c-shower', 10, 'supporting'], ['healthy', 's-make-bed', 2, 'supporting'],
    ['consistent', 'c-water', 1, 'primary'], ['consistent', 'm-top3', 3, 'primary'], ['consistent', 'l-study', 10, 'primary'], ['consistent', 'c-teeth', 2, 'supporting'], ['consistent', 'l-study', 20, 'supporting'], ['consistent', 'o-plants', 5, 'supporting'],
  ];
  for (const [goal, id, minutes, role] of CASES) {
    it(`${goal}: "${id}" at ${minutes} min is ${role}`, () => {
      const t = tpl(id);
      expect(t, `unknown template ${id}`).toBeTruthy();
      const e = explainCover(goal, t, minutes);
      expect(e, `${id} must at least be tagged for ${goal}`).toBeTruthy();
      expect(e!.role).toBe(role);
      expect(e!.why.length).toBeGreaterThan(10);
      expect(servesGoal(goal, { t, matches: [goal] }, minutes)).toBe(role === 'primary');
    });
  }

  it('a task that is not even tagged for a goal is never related to it', () => {
    expect(explainCover('study', tpl('c-water'), 5)).toBeNull();
    expect(explainCover('phone', tpl('f-walk'), 10)).toBeNull();
    expect(isPrimary('study', tpl('m-read'))).toBe(false);
  });
});

describe('goal coverage in a real plan: every goal on its own, at every budget', () => {
  const BUDGETS = [5, 10, 15, 30, 60, 90];
  for (const goal of ALL_GOALS) {
    it(`"${goal}" alone: covered means a primary task is in the plan, deferred means none is and a reason is given`, () => {
      for (const mins of BUDGETS) for (const home of [false, true]) {
        const p = planFor(prefs(home ? ['home', goal] : [goal], mins));
        const g = p.goalCoverage.find((x) => x.goal === goal)!;
        const where = `${goal} ${mins}m ${home ? 'home+' : ''}life`;
        const planTasks = p.tasks.filter((t) => isLife(t) && !t.challenge);
        const primaryInPlan = planTasks.filter((t) => servesGoal(goal, { t: tpl(t.templateId!), matches: t.matches ?? [] }, t.minutes));
        if (g.status === 'covered') {
          expect(g.taskIds.length, where).toBeGreaterThan(0);
          expect(g.cover.filter((c) => c.role === 'primary').map((c) => c.taskId).sort(), where).toEqual([...g.taskIds].sort());
          for (const c of g.cover) {
            expect(planTasks.some((t) => t.id === c.taskId), `${where}: ${c.taskId} is in the plan`).toBe(true);
            expect(c.why.length).toBeGreaterThan(10);
            expect(c.minutes).toBe(planTasks.find((t) => t.id === c.taskId)!.minutes);
            expect(c.name).toBe(planTasks.find((t) => t.id === c.taskId)!.name);
          }
          // every primary really meets the rule's minimum
          for (const c of g.cover.filter((x) => x.role === 'primary')) expect(c.minutes, where).toBeGreaterThanOrEqual(GOAL_RULES[goal as keyof typeof GOAL_RULES].min);
        } else {
          expect(primaryInPlan.map((t) => t.name), `${where}: marked deferred but a primary task is in the plan`).toEqual([]);
          expect(g.taskIds).toEqual([]);
          expect(['budget', 'cap', 'safety', 'context', 'none']).toContain(g.reason);
          // whatever else is related is shown as supporting, never primary
          expect(g.cover.every((c) => c.role === 'supporting'), where).toBe(true);
        }
      }
    });

    it(`"${goal}" alone is covered once the day is long enough`, () => {
      for (const mins of [30, 60, 90]) {
        const g = planFor(prefs([goal], mins)).goalCoverage.find((x) => x.goal === goal)!;
        expect(g.status, `${goal} at ${mins} min (${g.reason})`).toBe('covered');
      }
    });
  }

  it('combinations: one record per goal, no goal is covered by a supporting task, and totals add up', () => {
    let seed = 11; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    for (let i = 0; i < 300; i++) {
      const n = 2 + Math.floor(rnd() * 9);
      const focus = [...new Set(Array.from({ length: n }, () => ALL_GOALS[Math.floor(rnd() * ALL_GOALS.length)]))];
      const mins = BUDGETS[Math.floor(rnd() * BUDGETS.length)];
      const home = rnd() < 0.5;
      const p = planFor(prefs(home ? ['home', ...focus] : focus, mins, { fitnessLevel: (['beginner', 'intermediate', 'advanced'] as const)[Math.floor(rnd() * 3)], energy: rnd() < 0.2 ? 'low' : 'medium' }));
      expect(p.goalCoverage.map((g) => g.goal).sort()).toEqual([...focus].sort());
      for (const g of p.goalCoverage) {
        if (g.status === 'covered') expect(g.cover.some((c) => c.role === 'primary')).toBe(true);
        else expect(g.cover.some((c) => c.role === 'primary')).toBe(false);
      }
      // the plan's habits never add up to more than the habit share of the day
      const lifeDaily = p.stats.lifeDailyMinutes;
      expect(lifeDaily).toBeLessThanOrEqual(p.lifeBudget);
    }
  });

  it('a daily-habit goal is never "covered" by one rare task', () => {
    for (const mins of [10, 30, 60]) {
      const p = planFor(prefs(ALL_GOALS, mins));
      const c = p.goalCoverage.find((g) => g.goal === 'consistent')!;
      if (c.status !== 'covered') continue;
      for (const id of c.taskIds) expect(p.tasks.find((t) => t.id === id)!.frequency).toBe('daily');
    }
  });
});

describe('deferred goals say the real reason, decided where the goal stopped being possible', () => {
  const ctxFor = (d: AppData) => deriveContext(d.home, d.preferences);
  const synthetic = (over: Partial<LifeTemplate>): LifeTemplate => ({
    id: 'x-test', domain: 'fitness', sub: 'Cardio', focus: ['active'], freq: 'daily', impact: 5, base: 50, description: 'd', reason: 'r', steps: ['go'],
    ladder: [{ level: 1, minutes: 10, name: 'Test move' }], ...over,
  } as LifeTemplate);

  it('budget: the task that would serve it is longer than the minutes the day has, and the number needed is reported', () => {
    const p = planFor(prefs(['home', 'study'], 5)); // 5-minute day shared with cleaning: 2 minutes for habits, study needs 5
    const g = p.goalCoverage[0];
    expect(g.status).toBe('deferred');
    expect(g.reason).toBe('budget');
    expect(g.needMinutes).toBe(5);
  });

  it('cap: the minutes were there, but the plan already holds as many habits (or habits of one kind) as it should', () => {
    const p = planFor(prefs(['healthy', 'organize', 'focus'], 10));
    const g = p.goalCoverage.find((x) => x.goal === 'focus')!;
    expect(g.status).toBe('deferred');
    expect(g.reason).toBe('cap');
    expect(p.tasks.filter((t) => isLife(t) && !t.challenge).length).toBeLessThanOrEqual(maxLifeTasks(p.lifeBudget));
  });

  it('the two checks are kept apart: minutes are blamed first, and the cap only when the minutes were there', () => {
    expect(failureReason(true, true)).toBeNull();
    expect(failureReason(false, true)).toBe('budget');
    expect(failureReason(true, false)).toBe('cap');
    expect(failureReason(false, false)).toBe('budget');
  });

  it('safety: every task is ruled out by the person\'s level or energy', () => {
    const d = prefs(['active'], 30, { fitnessLevel: 'beginner', energy: 'low' });
    const hard = synthetic({ difficulty: 3, intensity: 'vigorous', beginner: false });
    expect(blockedReason('active', ctxFor(d), [hard]).reason).toBe('safety');
  });

  it('context: its tasks need equipment the person does not have, or a place they do not have', () => {
    const d = prefs(['active'], 30, { equipment: 'none' });
    expect(blockedReason('active', ctxFor(d), [synthetic({ equipment: 'basic' })]).reason).toBe('context');
    expect(blockedReason('active', ctxFor(d), [synthetic({ when: () => false })]).reason).toBe('context');
  });

  it('none: nothing in the catalogue is the right kind of task for the goal at the person\'s level', () => {
    const d = prefs(['active'], 30);
    expect(blockedReason('active', ctxFor(d), []).reason).toBe('none');
    // a real task exists but its only step is a "gesture" shorter than the goal's minimum
    expect(blockedReason('active', ctxFor(d), [synthetic({ ladder: [{ level: 1, minutes: 2, name: 'Tiny' }] })]).reason).toBe('none');
  });

  it('the reason is the furthest obstacle: a usable-but-too-long option beats an unusable one', () => {
    const d = prefs(['active'], 30, { equipment: 'none' });
    const r = blockedReason('active', ctxFor(d), [synthetic({ equipment: 'basic', id: 'x-a' }), synthetic({ id: 'x-b', ladder: [{ level: 1, minutes: 25, name: 'Long' }] })]);
    expect(r.reason).toBe('budget');
    expect(r.need).toBe(25);
  });

  it('every real deferral across many plans carries one of the five reasons, and "budget" always names a number', () => {
    const seen = new Set<GoalDeferReason>();
    let seed = 5; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    for (let i = 0; i < 200; i++) {
      const focus = [...new Set(Array.from({ length: 1 + Math.floor(rnd() * 11) }, () => ALL_GOALS[Math.floor(rnd() * ALL_GOALS.length)]))];
      const p = planFor(prefs(rnd() < 0.5 ? ['home', ...focus] : focus, [5, 10, 15, 30, 60, 90][Math.floor(rnd() * 6)]));
      for (const g of p.goalCoverage) if (g.status === 'deferred') {
        seen.add(g.reason!);
        if (g.reason === 'budget') expect(g.needMinutes).toBeGreaterThan(0);
      }
    }
    expect(seen.has('budget')).toBe(true);
  });

  it('buildLifeTasks and generatePlan agree on coverage', () => {
    const d = prefs(['active', 'study', 'phone'], 30);
    const c = ctxFor(d);
    expect(buildLifeTasks(c, TODAY).coverage.map((g) => [g.goal, g.status])).toEqual(planFor(d).goalCoverage.map((g) => [g.goal, g.status]));
  });
});
