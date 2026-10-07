import type { Ctx } from './context';
import { addDays, weekday } from './dates';
import { meaningfulMinutes, servesGoal } from './goals';
import { LIFE_TEMPLATES, SAFETY_LINE, groupsOf, type LifeStep, type LifeTemplate } from './lifeCatalog';
import { DOMAIN_SHORT, FOCUS_OPTIONS } from './options';
import { occurrencesPerWeek, priorityOf } from './scoring';
import type { Cadence, GoalCoverage, ISODate, LifeDomain, LifeFocus, LifeLevel, Task } from './types';

export { servesGoal };

/**
 * Progressive-discipline engine.
 *
 *  - Only templates that serve the user's chosen focus areas are considered.
 *  - Each template contributes ONE ladder step: the largest step that fits the user's
 *    level, fitness level, equipment and the time they have.
 *  - Selection is capped by a daily time budget, so the user never gets a wall of tasks.
 *  - The next step up the ladder is offered as an optional, unscheduled challenge.
 */

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const PAIRS: [number, number][] = [[1, 4], [2, 5], [3, 6], [0, 3]];

/**
 * Minutes per day the life layer may use. This is the habits' share of the ONE daily budget the user chose: 40% when cleaning is on
 * too (cleaning has the other 60%), all of it otherwise. It is never added on top of the user's time.
 */
export const lifeDayBudget = (c: Ctx): number =>
  c.homeOn ? clamp(Math.round(c.sessionMinutes * c.lifeShare), 4, 40) : c.sessionMinutes;

/**
 * Fitness starts where the user's fitness is, not at the bottom of the ladder. The user's pace (lifeLevel) still moves it up or
 * down, so an advanced user who asks for a gentle start is one step below their fitness level, never at beginner difficulty.
 */
const FITNESS_OFFSET: Record<Ctx['fitnessLevel'], number> = { beginner: 0, intermediate: 1, advanced: 2 };
export const levelFor = (t: LifeTemplate, c: Ctx): LifeLevel =>
  (t.domain === 'fitness' ? clamp(c.lifeLevel + FITNESS_OFFSET[c.fitnessLevel], 1, 3) : c.lifeLevel) as LifeLevel;

export const maxLifeTasks = (budget: number): number => clamp(Math.round(budget / 4) + 2, 3, 8);

const FOCUS_LABEL = new Map(FOCUS_OPTIONS.map((f) => [f.value, f.label.toLowerCase()]));

interface Resolved { step: LifeStep; difficulty: 1 | 2 | 3; beginner: boolean; equipment: 'none' | 'basic' }

const resolveStep = (t: LifeTemplate, s: LifeStep): Resolved => {
  const difficulty = s.difficulty ?? t.difficulty ?? 1;
  return { step: s, difficulty, beginner: s.beginner ?? t.beginner ?? difficulty <= 1, equipment: s.equipment ?? t.equipment ?? 'none' };
};

/** Steps that are safe and sensible for this user (fitness level, equipment, energy). */
const allowedSteps = (t: LifeTemplate, c: Ctx): Resolved[] =>
  t.ladder
    .map((s) => resolveStep(t, s))
    .filter((r) => {
      if (r.equipment === 'basic' && c.equipment === 'none') return false;
      const intensity = r.step.intensity ?? t.intensity ?? 'gentle';
      if (c.energyLow && intensity === 'vigorous') return false;
      if (t.domain === 'fitness') {
        if (c.fitnessLevel === 'beginner' && (r.difficulty > 1 || !r.beginner)) return false;
        if (c.fitnessLevel === 'intermediate' && r.difficulty > 2) return false;
      }
      return true;
    });

interface Candidate {
  t: LifeTemplate;
  chosen: Resolved | null; // null: challenge-only template
  challenge: Resolved | null;
  score: number;
  matches: LifeFocus[];
}

const candidatesFor = (c: Ctx): Candidate[] => {
  const budget = lifeDayBudget(c);
  const perTask = Math.max(5, Math.floor(budget * 0.7));
  const out: Candidate[] = [];
  for (const t of LIFE_TEMPLATES) {
    const matches = t.focus.filter((f) => c.focus.has(f));
    if (!matches.length) continue;
    if (t.when && !t.when(c)) continue;
    const steps = allowedSteps(t, c);
    if (!steps.length) continue;
    const level = levelFor(t, c);
    const fit = steps.filter((r) => r.step.level <= level && r.step.minutes <= perTask);
    const chosen = fit.length ? fit[fit.length - 1] : null;
    const above = steps.filter((r) => r.step.level > level && (!chosen || r.step.minutes > chosen.step.minutes));
    const challenge = above[0] ?? null;
    if (!chosen && !challenge) continue;
    if (chosen && chosen.step.minutes > budget) continue;

    let score = t.base + matches.length * 7;
    if (c.focus.has('morning') && t.routine && t.time === 'morning') score += 8;
    if (c.focus.has('evening') && t.routine && t.time === 'evening') score += 8;
    if (chosen && chosen.step.minutes <= 5) score += 4;
    // The user said they have equipment: favour the variants that actually use it.
    if (chosen && chosen.equipment === 'basic') score += 15;
    if (c.microSteps && chosen && chosen.step.minutes > 10) score -= 6;
    out.push({ t, chosen, challenge, score, matches });
  }
  return out.sort((a, b) => b.score - a.score || a.t.id.localeCompare(b.t.id));
};

const TIMED_GOALS: LifeFocus[] = ['morning', 'evening'];

/** The smallest meaningful step that would serve this goal for this user, ignoring today's budget. Infinity when nothing could. */
const smallestNeed = (f: LifeFocus, c: Ctx): number => {
  let best = Infinity;
  for (const t of LIFE_TEMPLATES) {
    const matches = t.focus.filter((x) => c.focus.has(x));
    if (!servesGoal(f, { t, matches })) continue;
    if (t.when && !t.when(c)) continue;
    const level = levelFor(t, c);
    for (const r of allowedSteps(t, c)) if (r.step.level <= level && r.step.minutes >= meaningfulMinutes(f)) best = Math.min(best, r.step.minutes);
  }
  return best;
};

/** Weekday loads let us check that no single day exceeds the budget. */
type Loads = number[];

const daysFor = (t: LifeTemplate, loads: Loads, idx: number): { cadence: Cadence; days: number[] } => {
  switch (t.freq) {
    case 'daily': return { cadence: { kind: 'days', days: ALL_DAYS }, days: ALL_DAYS };
    case 'twice-weekly': {
      // least-loaded pair of well-spaced days; ties rotate so tasks don't all land on the same two days
      const load = (p: [number, number]) => Math.max(loads[p[0]], loads[p[1]]);
      const rotated = PAIRS.map((_, i) => PAIRS[(i + idx) % PAIRS.length]);
      const pair = rotated.reduce((best, p) => (load(p) < load(best) ? p : best), rotated[0]);
      return { cadence: { kind: 'days', days: [...pair] }, days: [...pair] };
    }
    default: {
      const pref = t.domain === 'admin' ? 0 : -1;
      const wd = [...ALL_DAYS].sort((a, b) => loads[a] - loads[b] || (a === pref ? -1 : b === pref ? 1 : 0))[0];
      const every = t.freq === 'weekly' ? 7 : t.freq === 'biweekly' ? 14 : t.freq === 'monthly' ? 28 : 7;
      return { cadence: { kind: 'every', every }, days: [wd] };
    }
  }
};

const firstOnOrAfter = (from: ISODate, wds: number[]): ISODate => {
  let d = from;
  for (let i = 0; i < 8; i++, d = addDays(d, 1)) if (wds.includes(weekday(d))) return d;
  return from;
};

const makeTask = (t: LifeTemplate, r: Resolved, matches: LifeFocus[], opts: { challenge: boolean; cadence: Cadence; start: ISODate | null }): Task => {
  const step = r.step;
  const domain = t.domain;
  const safety = SAFETY_LINE[domain];
  const base = step.steps ?? t.steps;
  const steps = safety ? [...base, safety] : base;
  const tiny = safety ? [...(t.tiny ?? base), safety] : (t.tiny ?? base);
  const goalText = matches.map((m) => FOCUS_LABEL.get(m)).filter(Boolean).slice(0, 2).join(' and ');
  const score = clamp(Math.round(t.base + matches.length * 3 - (opts.challenge ? 20 : 0)), 5, 100);
  return {
    id: `${t.id}:${opts.challenge ? 'challenge' : 'life'}`,
    templateId: t.id,
    name: step.name,
    roomId: `life-${domain}`,
    roomKind: 'home',
    roomName: DOMAIN_SHORT[domain],
    category: DOMAIN_SHORT[domain],
    minutes: step.minutes,
    difficulty: r.difficulty,
    frequency: opts.challenge ? 'once' : t.freq,
    cadence: opts.cadence,
    priority: priorityOf(score),
    score,
    impact: t.impact,
    reason: `${t.reason}${goalText ? ` Matches your goal to ${goalText}.` : ''}${opts.challenge ? ' This is a step up from your current level, so it is optional.' : ''}`,
    substeps: steps,
    tinySteps: tiny,
    tier: 'maintenance',
    habit: false,
    quickWin: step.minutes <= 5,
    zone: DOMAIN_SHORT[domain],
    floor: 0,
    startDate: opts.start,
    needs: [],
    topics: [],
    domain,
    subcategory: t.sub,
    description: step.description ?? t.description,
    tags: t.tags,
    equipment: r.equipment,
    intensity: step.intensity ?? t.intensity ?? 'gentle',
    lowImpact: step.lowImpact ?? t.lowImpact,
    beginner: r.beginner,
    setting: t.setting ?? 'either',
    timeOfDay: t.time ?? 'anytime',
    routine: !!t.routine,
    repeatable: !!t.repeatable,
    level: step.level,
    challenge: opts.challenge || undefined,
    matches: matches.length ? matches : undefined,
  };
};

export interface LifeBuild { tasks: Task[]; dayBudget: number; dailyMinutes: number; picked: number; coverage: GoalCoverage[] }

/** Build the scheduled life tasks plus a few optional challenges. */
export const buildLifeTasks = (c: Ctx, start: ISODate): LifeBuild => {
  const dayBudget = lifeDayBudget(c);
  if (!c.lifeActive) return { tasks: [], dayBudget, dailyMinutes: 0, picked: 0, coverage: [] };

  const cands = candidatesFor(c).filter((x) => x.chosen);
  const loads: Loads = new Array(7).fill(0);
  const chosen: { cand: Candidate; cadence: Cadence; days: number[] }[] = [];
  const perDomain = new Map<LifeDomain, number>();
  const cap = maxLifeTasks(dayBudget);
  const domainCap = c.focus.size <= 2 ? 5 : 3;
  const groupCount = new Map<string, number>();

  // `reserve` keeps room for goals that still need a task, so an early pick can't squeeze them out.
  const tryAdd = (cand: Candidate, reserve = 0): boolean => {
    if (chosen.length >= cap || chosen.some((x) => x.cand.t.id === cand.t.id)) return false;
    if ((perDomain.get(cand.t.domain) ?? 0) >= domainCap) return false;
    // Near-duplicates (two walks, three "planning" chores) never both make the plan.
    if (groupsOf(cand.t.id).some((g) => (groupCount.get(g.id) ?? 0) >= g.cap)) return false;
    const minutes = cand.chosen!.step.minutes;
    const { cadence, days } = daysFor(cand.t, loads, chosen.length);
    // A task occupies its whole slot on the days it lands, however rarely that is, so check full minutes.
    if (Math.max(...days.map((d) => loads[d] + minutes)) + reserve > dayBudget * 1.05) return false;
    days.forEach((d) => { loads[d] += minutes; });
    chosen.push({ cand, cadence, days });
    perDomain.set(cand.t.domain, (perDomain.get(cand.t.domain) ?? 0) + 1);
    for (const g of groupsOf(cand.t.id)) groupCount.set(g.id, (groupCount.get(g.id) ?? 0) + 1);
    return true;
  };

  // 1) Every selected goal gets a task that genuinely serves it, before any optional filler.
  //    Morning/evening goals are the most specific, so they go first; the rest follow in the order the user chose them.
  //    A goal is only "covered" by a task that is really about it and long enough to count (see goals.ts), never by a tag alone.
  const goals: LifeFocus[] = [...TIMED_GOALS.filter((f) => c.focus.has(f)), ...[...c.focus].filter((f) => f !== 'home' && !TIMED_GOALS.includes(f))];
  const served = (f: LifeFocus, x: Candidate) => servesGoal(f, x, x.chosen!.step.minutes);
  const isCovered = (f: LifeFocus) => chosen.some((x) => served(f, x.cand));
  const optionsFor = (f: LifeFocus) => cands.filter((x) => served(f, x));
  const cheapest = (f: LifeFocus) => Math.min(...optionsFor(f).map((x) => x.chosen!.step.minutes));
  for (const f of goals) {
    if (isCovered(f)) continue;
    const later = goals.filter((g) => g !== f && !isCovered(g));
    // Keep room for the cheapest way to serve each goal still waiting, so an early pick cannot squeeze them all out.
    const reserve = later.reduce((sum, g) => sum + (Number.isFinite(cheapest(g)) ? cheapest(g) : 0), 0);
    // Prefer an option that also serves another waiting goal: one task doing double duty leaves room for more goals.
    const ranked = optionsFor(f)
      .map((o) => ({ o, rank: o.score + later.filter((g) => served(g, o)).length * 6 }))
      .sort((a, b) => b.rank - a.rank)
      .map((x) => x.o);
    if (ranked.some((o) => tryAdd(o, reserve))) continue;
    // Earlier goals are higher priority: if it only fails because of the reserve, it still gets its place.
    ranked.some((o) => tryAdd(o, 0));
  }
  // 2) fill remaining room, spreading across domains
  const rest = [...cands].sort((a, b) => (b.score - (perDomain.get(b.t.domain) ?? 0) * 8) - (a.score - (perDomain.get(a.t.domain) ?? 0) * 8));
  for (const cand of rest) {
    if (chosen.length >= cap) break;
    tryAdd(cand);
  }

  const tasks: Task[] = chosen.map(({ cand, cadence, days }) => {
    const startDate = cadence.kind === 'every' ? addDays(firstOnOrAfter(start, days), cand.t.freq === 'biweekly' && chosen.length % 2 ? 7 : 0) : firstOnOrAfter(start, days);
    return makeTask(cand.t, cand.chosen!, cand.matches, { challenge: false, cadence, start: startDate });
  });

  // Optional challenges: the next rung up for tasks the user cares about. Never scheduled.
  const challenges = candidatesFor(c)
    .filter((x) => x.challenge)
    .slice(0, 12)
    .reduce<Candidate[]>((acc, x) => (acc.filter((y) => y.t.domain === x.t.domain).length >= 2 || acc.length >= 5 ? acc : [...acc, x]), []);
  for (const x of challenges) {
    tasks.push(makeTask(x.t, x.challenge!, x.matches, { challenge: true, cadence: { kind: 'once' }, start: null }));
  }

  const dailyMinutes = Math.round(
    chosen.reduce((s, { cand }) => s + cand.chosen!.step.minutes * (occurrencesPerWeek(cand.t.freq, 7, true) / 7), 0),
  );

  // Say plainly which goals got a task and which did not, and why. Nothing is covered by pretending.
  const coverage: GoalCoverage[] = goals.map((f) => {
    const by = chosen.filter((x) => served(f, x.cand));
    if (by.length) return { goal: f, status: 'covered', taskIds: by.map((x) => `${x.cand.t.id}:life`) };
    const need = smallestNeed(f, c);
    if (!Number.isFinite(need)) return { goal: f, status: 'deferred', taskIds: [], reason: 'none' };
    return { goal: f, status: 'deferred', taskIds: [], reason: chosen.length >= cap ? 'cap' : 'budget', needMinutes: need };
  });
  return { tasks, dayBudget, dailyMinutes, picked: chosen.length, coverage };
};

// ───────────────────────── "Rough day" reset ─────────────────────────

const ROUGH_ORDER = ['c-water', 'b-breath', 'b-ground', 'f-walk', 'm-brain-dump', 'm-gratitude', 'f-recovery'];

/** A tiny, forgiving set of actions for getting back on track after a bad day. Never more than ~12 minutes. */
export const roughDayTasks = (c: Ctx): Task[] => {
  const out: Task[] = [];
  let total = 0;
  for (const id of ROUGH_ORDER) {
    const t = LIFE_TEMPLATES.find((x) => x.id === id);
    if (!t || (t.when && !t.when(c))) continue;
    const step = allowedSteps(t, c)[0];
    if (!step || total + step.step.minutes > 12) continue;
    const task = makeTask(t, step, [], { challenge: false, cadence: { kind: 'once' }, start: null });
    out.push({ ...task, id: `rough:${t.id}`, frequency: 'once', reason: 'Small, gentle and enough for today. Tomorrow is a fresh start.' });
    total += step.step.minutes;
    if (out.length >= 4) break;
  }
  return out;
};
