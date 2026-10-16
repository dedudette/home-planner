import { nominalSplit } from './budget';
import { energyOk } from './safety';
import type { Ctx } from './context';
import { addDays, weekday } from './dates';
import { explainCover, isPrimary, servesGoal } from './goals';
import { LIFE_TEMPLATES, SAFETY_LINE, groupsOf, type LifeStep, type LifeTemplate } from './lifeCatalog';
import { DOMAIN_SHORT, FOCUS_OPTIONS } from './options';
import { occurrencesPerWeek, priorityOf } from './scoring';
import type { Cadence, CoverTask, GoalCoverage, GoalDeferReason, ISODate, LifeDomain, LifeFocus, LifeLevel, Task } from './types';

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
export const lifeDayBudget = (c: Ctx): number => nominalSplit(c.sessionMinutes, c.homeOn, c.lifeActive, c.homeShare).life;

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

/**
 * Why a step is ruled out for this user, or null when it is fine. Two different causes, because they mean different things to the
 * person: 'context' is something they could add (equipment), 'safety' is something that protects them (level, energy).
 */
const stepBlock = (t: LifeTemplate, r: Resolved, c: Ctx): 'context' | 'safety' | null => {
  if (r.equipment === 'basic' && c.equipment === 'none') return 'context';
  const intensity = r.step.intensity ?? t.intensity ?? 'gentle';
  if (c.energyLow && !energyOk({ difficulty: r.difficulty, intensity }, 'low')) return 'safety';
  if (t.domain === 'fitness') {
    if (c.fitnessLevel === 'beginner' && (r.difficulty > 1 || !r.beginner)) return 'safety';
    if (c.fitnessLevel === 'intermediate' && r.difficulty > 2) return 'safety';
  }
  return null;
};

/** Steps that are safe and sensible for this user (fitness level, equipment, energy). */
const allowedSteps = (t: LifeTemplate, c: Ctx): Resolved[] =>
  t.ladder.map((s) => resolveStep(t, s)).filter((r) => !stepBlock(t, r, c));

interface Candidate {
  t: LifeTemplate;
  chosen: Resolved | null; // null: challenge-only template
  challenge: Resolved | null;
  score: number;
  matches: LifeFocus[];
}

const candidatesFor = (c: Ctx): Candidate[] => {
  const budget = lifeDayBudget(c);
  // No single habit takes more than 70% of the habit time, and on very-low energy none runs longer than a short, gentle stretch of 15 minutes.
  const perTask = Math.min(Math.max(5, Math.floor(budget * 0.7)), c.energy === 'very-low' ? 15 : Infinity);
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

/**
 * How far the best template for a goal gets before something stops it, in order of "how close it came". The goal's deferral reason
 * is the stage the closest-to-success template reached, so the user is told the real obstacle, not a guess made afterwards.
 *   none (0) < context (1) < safety (2) < budget (3) < cap (4)
 */
/**
 * Why a candidate was turned away, given the two independent checks. Minutes come first: when both fail, more minutes would also
 * raise the cap (it grows with the habit budget), so "no room in your day" is the cause the person can act on. 'cap' is reported only
 * when the minutes were there and the plan still had as many habits (or near-duplicates, or habits of one kind) as it should.
 */
export const failureReason = (timeFits: boolean, underCap: boolean): 'budget' | 'cap' | null => (!timeFits ? 'budget' : !underCap ? 'cap' : null);

const STAGE: Record<GoalDeferReason, number> = { none: 0, context: 1, safety: 2, budget: 3, cap: 4 };

/** Why no template could even become a candidate for goal `f` for this user (before the day's minutes and the habit cap are considered). */
export const blockedReason = (f: LifeFocus, c: Ctx, templates: readonly LifeTemplate[] = LIFE_TEMPLATES): { reason: GoalDeferReason; need?: number } => {
  const st: { best: GoalDeferReason } = { best: 'none' };
  let need = Infinity;
  const consider = (r: GoalDeferReason) => { if (STAGE[r] > STAGE[st.best]) st.best = r; };
  for (const t of templates) {
    if (!t.focus.includes(f) || !isPrimary(f, t)) continue;
    if (t.when && !t.when(c)) { consider('context'); continue; }
    const resolved = t.ladder.map((s) => resolveStep(t, s));
    const blocks = resolved.map((r) => stepBlock(t, r, c));
    const open = resolved.filter((_, i) => !blocks[i]);
    if (!open.length) { consider(blocks.includes('safety') ? 'safety' : 'context'); continue; }
    const level = levelFor(t, c);
    const counts = open.filter((r) => r.step.level <= level && explainCover(f, t, r.step.minutes)?.role === 'primary');
    if (!counts.length) { consider('none'); continue; }
    const cheapest = Math.min(...counts.map((r) => r.step.minutes));
    need = Math.min(need, cheapest);
    consider('budget'); // it is a real option, so the obstacle is the minutes (or, if the caller saw it fail on the cap, that)
  }
  return { reason: st.best, need: Number.isFinite(need) && st.best === 'budget' ? need : undefined };
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

  // Why each template last failed to get in, recorded at the moment it failed. This is what a deferred goal reports.
  const failedBecause = new Map<string, 'cap' | 'budget'>();
  // `reserve` keeps room for goals that still need a task, so an early pick can't squeeze them out. Returns null on success, or the
  // reason it did not get in: 'cap' (the plan already holds as many habits as it should) or 'budget' (no room in the minutes).
  const tryAdd = (cand: Candidate, reserve = 0): 'cap' | 'budget' | null => {
    const fail = (why: 'cap' | 'budget') => { failedBecause.set(cand.t.id, why); return why; };
    if (chosen.some((x) => x.cand.t.id === cand.t.id)) return null;
    const minutes = cand.chosen!.step.minutes;
    const { cadence, days } = daysFor(cand.t, loads, chosen.length);
    // A task occupies its whole slot on the days it lands, however rarely that is, so check full minutes.
    const timeFits = Math.max(...days.map((d) => loads[d] + minutes)) + reserve <= dayBudget;
    // Near-duplicates (two walks, three "planning" chores) never both make the plan.
    const underCap = chosen.length < cap && (perDomain.get(cand.t.domain) ?? 0) < domainCap && !groupsOf(cand.t.id).some((g) => (groupCount.get(g.id) ?? 0) >= g.cap);
    const why = failureReason(timeFits, underCap);
    if (why) return fail(why);
    days.forEach((d) => { loads[d] += minutes; });
    chosen.push({ cand, cadence, days });
    perDomain.set(cand.t.domain, (perDomain.get(cand.t.domain) ?? 0) + 1);
    for (const g of groupsOf(cand.t.id)) groupCount.set(g.id, (groupCount.get(g.id) ?? 0) + 1);
    failedBecause.delete(cand.t.id);
    return null;
  };

  // 1) Every selected goal gets a task that genuinely serves it, before any optional filler.
  //    Morning/evening goals are the most specific, so they go first; the rest follow in the order the user chose them.
  //    A goal is only "covered" by a task that is really about it and long enough to count (see goals.ts), never by a tag alone.
  const goals: LifeFocus[] = [...TIMED_GOALS.filter((f) => c.focus.has(f)), ...[...c.focus].filter((f) => f !== 'home' && !TIMED_GOALS.includes(f))];
  const served = (f: LifeFocus, x: Candidate) => servesGoal(f, x, x.chosen!.step.minutes);
  const isCovered = (f: LifeFocus) => chosen.some((x) => served(f, x.cand));
  // A template's steps for this person that are no longer than its default step, longest first: when the default does not fit
  // beside the other goals, a shorter rung of the same task may (the small ladder rungs exist for exactly this).
  const stepsOf = (x: Candidate): Resolved[] =>
    allowedSteps(x.t, c).filter((r) => r.step.level <= levelFor(x.t, c) && r.step.minutes <= x.chosen!.step.minutes).sort((a, b) => b.step.minutes - a.step.minutes);
  const variantsFor = (f: LifeFocus, x: Candidate): Resolved[] => stepsOf(x).filter((r) => servesGoal(f, x, r.step.minutes));
  const optionsFor = (f: LifeFocus) => cands.filter((x) => x.matches.includes(f) && variantsFor(f, x).length > 0);
  const cheapest = (f: LifeFocus) => Math.min(...optionsFor(f).flatMap((x) => variantsFor(f, x).map((r) => r.step.minutes)));
  /** Try the option's steps from longest to shortest, all with the same reserve. */
  const addShrinking = (f: LifeFocus, o: Candidate, reserve: number): boolean =>
    variantsFor(f, o).some((r) => tryAdd(r === o.chosen ? o : { ...o, chosen: r }, reserve) === null);
  for (const f of goals) {
    if (isCovered(f)) continue;
    const later = goals.filter((g) => g !== f && !isCovered(g));
    // Keep room for the cheapest way to serve each goal still waiting, so an early pick cannot squeeze them all out.
    const reserve = later.reduce((sum, g) => sum + (Number.isFinite(cheapest(g)) ? cheapest(g) : 0), 0);
    // Prefer an option that also serves another waiting goal: one task doing double duty leaves room for more goals.
    const ranked = optionsFor(f)
      .map((o) => ({ o, rank: o.score + later.filter((g) => variantsFor(g, o).length > 0).length * 6 }))
      .sort((a, b) => b.rank - a.rank)
      .map((x) => x.o);
    if (ranked.some((o) => addShrinking(f, o, reserve))) continue;
    // Earlier goals are higher priority: if it only fails because of the reserve, it still gets its place.
    ranked.some((o) => addShrinking(f, o, 0));
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

  // Say plainly which goals got a task and which did not, and why. Nothing is covered by pretending: a goal is covered exactly when
  // a chosen task is *primary* for it (see goals.ts); related tasks are listed as supporting, with the reason they are not enough.
  const coverage: GoalCoverage[] = goals.map((f) => {
    const cover: CoverTask[] = [];
    for (const x of chosen) {
      if (!x.cand.matches.includes(f)) continue;
      const minutes = x.cand.chosen!.step.minutes;
      const e = explainCover(f, x.cand.t, minutes);
      if (e) cover.push({ taskId: `${x.cand.t.id}:life`, name: x.cand.chosen!.step.name, minutes, role: e.role, why: e.why });
    }
    cover.sort((p, q) => Number(q.role === 'primary') - Number(p.role === 'primary'));
    const primary = cover.filter((x) => x.role === 'primary');
    if (primary.length) return { goal: f, status: 'covered', taskIds: primary.map((x) => x.taskId), cover };
    // Not covered. The reason is where the closest option stopped: it never became a candidate (none / context / safety / budget),
    // or it was a candidate that was turned away (cap / budget), whichever got furthest.
    const blocked = blockedReason(f, c);
    let reason: GoalDeferReason = blocked.reason;
    let need = blocked.need;
    for (const x of optionsFor(f)) {
      const why = failedBecause.get(x.t.id);
      if (why && STAGE[why] > STAGE[reason]) { reason = why; need = x.chosen!.step.minutes; }
    }
    return { goal: f, status: 'deferred', taskIds: [], cover, reason, ...(reason === 'budget' && need !== undefined ? { needMinutes: need } : {}) };
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
