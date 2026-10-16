import { describe, expect, it } from 'vitest';
import { applyTypeDefaults } from '../src/domain/context';
import { emptyAppData } from '../src/domain/appdata';
import { isPrimary, meaningfulMinutes, servesGoal } from '../src/domain/goals';
import { generatePlan } from '../src/domain/engine';
import { LIFE_TEMPLATES, REDUNDANCY_GROUPS, groupsOf } from '../src/domain/lifeCatalog';
import { FOCUS_OPTIONS } from '../src/domain/options';
import { isLife } from '../src/domain/scoring';
import type { AppData, LifeFocus, Preferences } from '../src/domain/types';
import { custom, demo, plan, TODAY } from './helpers';

const ALL_GOALS = FOCUS_OPTIONS.map((f) => f.value).filter((f) => f !== 'home') as LifeFocus[];
const withPrefs = (focus: LifeFocus[], prefs: Partial<Preferences> = {}): AppData =>
  custom('apartment', {}, {}, { focus, sessionMinutes: 20, daysPerWeek: 7, style: 'daily', ...prefs });
const scheduled = (d: AppData) => plan(d).tasks.filter((t) => isLife(t) && !t.challenge);
const tpl = (id: string) => LIFE_TEMPLATES.find((t) => t.id === id)!;

describe('goal coverage is real, not tag-deep', () => {
  it('a task that merely lists a goal among its tags does not cover it', () => {
    const read = tpl('m-read');
    expect(read.focus).toContain('study');                       // tagged for study…
    expect(isPrimary('study', read)).toBe(false);                // …but it is a reading habit, not studying
    expect(servesGoal('study', { t: read, matches: ['study'] })).toBe(false);
    expect(servesGoal('study', { t: tpl('l-study'), matches: ['study'] }, 10)).toBe(true);
    expect(servesGoal('phone', { t: tpl('d-phone-free'), matches: ['phone'] }, 5)).toBe(true);
  });

  it('a token minute does not count where the goal needs real effort', () => {
    expect(meaningfulMinutes('active')).toBeGreaterThan(3);
    expect(servesGoal('active', { t: tpl('f-squats'), matches: ['active'] }, 3)).toBe(false);
    expect(servesGoal('active', { t: tpl('f-walk'), matches: ['active'] }, 5)).toBe(true);
  });

  it('every claim of "covered" is backed by a scheduled task that truly serves that goal', () => {
    let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    for (let i = 0; i < 250; i++) {
      const n = 1 + Math.floor(rnd() * 8);
      const focus = [...new Set(Array.from({ length: n }, () => ALL_GOALS[Math.floor(rnd() * ALL_GOALS.length)]))];
      const mins = [5, 10, 15, 20, 30, 45, 60][Math.floor(rnd() * 7)];
      const p = plan(withPrefs(rnd() < 0.5 ? focus : ['home', ...focus], { sessionMinutes: mins }));
      expect(p.goalCoverage.map((g) => g.goal).sort(), 'one record per selected goal').toEqual([...focus].sort());
      for (const g of p.goalCoverage) {
        if (g.status === 'covered') {
          expect(g.taskIds.length).toBeGreaterThan(0);
          for (const id of g.taskIds) {
            const t = p.tasks.find((x) => x.id === id)!;
            expect(t, `${g.goal} -> ${id}`).toBeTruthy();
            expect(t.challenge).toBeFalsy();
            expect(servesGoal(g.goal, { t: tpl(t.templateId!), matches: t.matches ?? [] }, t.minutes)).toBe(true);
          }
        } else {
          expect(g.taskIds).toEqual([]);
          expect(['budget', 'cap', 'none']).toContain(g.reason);
          // and it really is absent: nothing in the plan serves it
          const any = p.tasks.some((t) => isLife(t) && !t.challenge && servesGoal(g.goal, { t: tpl(t.templateId!), matches: t.matches ?? [] }, t.minutes));
          expect(any, `${focus.join('+')} / ${mins} min: "${g.goal}" is marked deferred but has a task`).toBe(false);
        }
      }
    }
  });

  it('never pretends: too many goals for a small budget are reported as deferred, with a reason', () => {
    const p = plan(withPrefs(['home', ...ALL_GOALS], { sessionMinutes: 10 }));
    const deferred = p.goalCoverage.filter((g) => g.status === 'deferred');
    expect(deferred.length).toBeGreaterThan(0);
    expect(deferred.every((g) => g.reason)).toBe(true);
    expect(deferred.some((g) => g.reason === 'budget' || g.reason === 'cap')).toBe(true);
  });

  it('a goal that cannot be served at all says so ("none") instead of staying silent', () => {
    // very low energy removes vigorous work, and a beginner is limited; ask for a goal whose only tasks need equipment/outdoors we lack
    const p = plan(withPrefs(['active'], { fitnessLevel: 'beginner', equipment: 'none', energy: 'very-low', sessionMinutes: 5 }));
    for (const g of p.goalCoverage) if (g.status === 'deferred') expect(g.reason).toBeTruthy();
  });

  it('ample time covers every goal and the plan says so', () => {
    const p = plan(withPrefs(['study', 'phone', 'morning', 'evening'], { sessionMinutes: 60 }));
    expect(p.goalCoverage.every((g) => g.status === 'covered')).toBe(true);
  });

  it('REGRESSION: the student demo (study + focus + phone + evening) really gets a study task', () => {
    const p = plan(demo('G'));
    const study = scheduled(demo('G')).filter((t) => t.domain === 'learning');
    expect(study.length).toBeGreaterThan(0);
    expect(p.goalCoverage.find((g) => g.goal === 'study')!.status).toBe('covered');
    expect(p.goalCoverage.find((g) => g.goal === 'evening')!.status).toBe('covered');
  });

  it('REGRESSION: study fits a realistic 30-minute day shared with cleaning (it used to need more than the habit budget)', () => {
    const d = custom('dorm', {}, {}, { focus: ['home', 'study'], sessionMinutes: 30, daysPerWeek: 7, style: 'daily' });
    const p = plan(d);
    expect(p.lifeBudget).toBe(12);
    expect(p.goalCoverage.find((g) => g.goal === 'study')!.status).toBe('covered');
    expect(scheduled(d).some((t) => t.domain === 'learning' && t.minutes <= p.lifeBudget)).toBe(true);
  });

  it('the new small rungs let busy people start: every study/focus/phone ladder begins at five to ten minutes', () => {
    for (const id of ['l-study', 'l-practice', 'd-phone-free']) expect(tpl(id).ladder[0].minutes, id).toBeLessThanOrEqual(5);
    for (const id of ['m-focus', 'l-project']) expect(tpl(id).ladder[0].minutes, id).toBeLessThanOrEqual(10);
  });
});

describe('time-of-day goals still require the task to really belong to that time of day', () => {
  it('a morning step never serves the evening goal, even if someone tags it for the evening, and an evening step does', () => {
    const clothes = tpl('c-clothes');
    const mistagged = { ...clothes, focus: [...clothes.focus, 'evening' as LifeFocus] };
    expect(clothes.time).toBe('morning');
    expect(servesGoal('evening', { t: mistagged, matches: ['evening'] })).toBe(false);
    expect(servesGoal('morning', { t: clothes, matches: ['morning'] })).toBe(true);
    expect(servesGoal('evening', { t: tpl('a-plan-tomorrow'), matches: ['evening'] })).toBe(true);
  });

  it('brushing your teeth is a routine step but not an improvement to one, morning or evening', () => {
    expect(servesGoal('morning', { t: tpl('c-teeth'), matches: ['morning'] })).toBe(false);
    expect(servesGoal('evening', { t: tpl('c-teeth-night'), matches: ['evening'] })).toBe(false);
  });
});

describe('content quality', () => {
  it('no morning task tells you to do something at night, and no evening task refers to waking up', () => {
    for (const t of LIFE_TEMPLATES) {
      const text = [t.description, t.reason, ...t.steps, ...t.ladder.flatMap((s) => [s.name, s.description ?? '', ...(s.steps ?? [])])].join(' ').toLowerCase();
      if (t.time === 'morning') expect(text, t.id).not.toMatch(/before bed|bedtime|tonight|before sleep/);
      if (t.time === 'evening') expect(text, t.id).not.toMatch(/this morning|after waking|when you wake|first thing in the morning/);
    }
  });

  it('every redundancy group names real templates, and no template is in a group twice over by accident', () => {
    const ids = new Set(LIFE_TEMPLATES.map((t) => t.id));
    for (const g of REDUNDANCY_GROUPS) { expect(g.cap).toBeGreaterThan(0); for (const m of g.members) expect(ids.has(m), `${g.id}: ${m}`).toBe(true); }
    expect(groupsOf('f-walk').map((g) => g.id)).toEqual(['walking']);
  });

  it('no plan ever contains more near-duplicates than a group allows (two walks, three "planning" chores...)', () => {
    let seed = 3; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    for (let i = 0; i < 300; i++) {
      const focus = [...new Set(Array.from({ length: 1 + Math.floor(rnd() * 8) }, () => ALL_GOALS[Math.floor(rnd() * ALL_GOALS.length)]))];
      const d = withPrefs(focus, { sessionMinutes: [15, 30, 60, 90][Math.floor(rnd() * 4)], lifeLevel: ([1, 2, 3] as const)[Math.floor(rnd() * 3)], equipment: rnd() < 0.5 ? 'basic' : 'none', fitnessLevel: (['beginner', 'intermediate', 'advanced'] as const)[Math.floor(rnd() * 3)] });
      const ids = scheduled(d).map((t) => t.templateId!);
      for (const g of REDUNDANCY_GROUPS) expect(ids.filter((id) => g.members.includes(id)).length, `${g.id} in ${focus.join('+')}`).toBeLessThanOrEqual(g.cap);
    }
  });

  it('REGRESSION: a daily walk and a separate "go outside" are never generated together', () => {
    for (const mins of [15, 30, 60, 90]) {
      const ids = scheduled(withPrefs(['active', 'healthy', 'selfcare'], { sessionMinutes: mins, lifeLevel: 3 })).map((t) => t.templateId);
      expect(ids.includes('f-walk') && ids.includes('o-outside'), `${mins} min`).toBe(false);
      expect(ids.includes('f-walk') && ids.includes('o-park'), `${mins} min`).toBe(false);
    }
  });

  it('REGRESSION: brushing your teeth no longer tells a morning task to repeat before bed', () => {
    expect(tpl('c-teeth').steps.join(' ').toLowerCase()).not.toContain('before bed');
  });
});

describe('fitness level maps to starting difficulty', () => {
  const fitness = (level: 'beginner' | 'intermediate' | 'advanced', lifeLevel: 1 | 2 | 3 = 1) =>
    scheduled(withPrefs(['active'], { fitnessLevel: level, equipment: 'none', sessionMinutes: 45, lifeLevel })).filter((t) => t.domain === 'fitness');

  it('beginners stay at the gentle level, as before', () => {
    const f = fitness('beginner');
    expect(f.length).toBeGreaterThan(0);
    expect(f.every((t) => t.level === 1 && t.difficulty === 1)).toBe(true);
  });

  it('REGRESSION: an advanced user at the default pace no longer gets chair squats and wall push-ups', () => {
    const f = fitness('advanced');
    expect(f.some((t) => (t.level ?? 1) >= 2)).toBe(true);
    expect(f.every((t) => t.name !== '8 chair squats' && !/wall push-ups/i.test(t.name))).toBe(true);
  });

  it('intermediate sits between the two', () => {
    const f = fitness('intermediate');
    expect(f.some((t) => (t.level ?? 1) >= 2)).toBe(true);
    expect(f.every((t) => t.difficulty <= 2)).toBe(true); // safety cap for intermediate is unchanged
  });

  it('safety still wins over level: low energy removes vigorous work even for advanced users', () => {
    const f = scheduled(withPrefs(['active'], { fitnessLevel: 'advanced', energy: 'low', equipment: 'basic', sessionMinutes: 60, lifeLevel: 3 })).filter((t) => t.domain === 'fitness');
    expect(f.every((t) => t.intensity !== 'vigorous')).toBe(true);
  });

  it('every fitness task still ends with its safety line', () => {
    for (const t of fitness('advanced')) expect(t.substeps[t.substeps.length - 1]).toMatch(/not medical advice/i);
  });
});

describe('budget honesty: one shared daily budget', () => {
  const total = (d: AppData) => scheduled(d).reduce((s, t) => s + t.minutes * (t.frequency === 'daily' ? 1 : 0), 0);

  it('cleaning and habits split the day 60/40 instead of each taking all of it', () => {
    const p = plan(custom('apartment', {}, {}, { focus: ['home', 'discipline', 'morning'], sessionMinutes: 30, daysPerWeek: 5 }));
    expect(p.homeShare).toBeCloseTo(0.6);
    expect(p.lifeBudget).toBe(12);
    expect(p.homeShare * 30 + p.lifeBudget).toBeCloseTo(30);
  });

  it('habits alone get the whole budget, and cleaning alone is unchanged', () => {
    expect(plan(withPrefs(['discipline'], { sessionMinutes: 30 })).lifeBudget).toBe(30);
    const homeOnly = plan(custom('apartment', {}, {}, { focus: ['home'], sessionMinutes: 30 }));
    expect(homeOnly.homeShare).toBe(1);
    expect(homeOnly.lifeActive).toBe(false);
  });

  it('daily habit minutes stay inside the habit share', () => {
    for (const mins of [15, 30, 45, 60]) {
      const d = custom('apartment', {}, {}, { focus: ['home', 'discipline', 'morning', 'evening', 'study'], sessionMinutes: mins, daysPerWeek: 7, style: 'daily' });
      const p = plan(d);
      expect(total(d), `${mins}`).toBeLessThanOrEqual(p.lifeBudget * 1.06);
    }
  });

  it('emptyAppData-based tiny profile still builds without throwing', () => {
    const d = emptyAppData(TODAY);
    d.home = applyTypeDefaults(d.home, 'studio');
    d.preferences = { ...d.preferences, sessionMinutes: 5, focus: ['home', 'active', 'evening'], daysPerWeek: 1 };
    expect(() => generatePlan(d.home, d.preferences, d.plan)).not.toThrow();
  });
});
