import type { LifeTemplate } from './lifeCatalog';
import type { LifeFocus } from './types';

/**
 * What it takes for a task to genuinely serve a goal.
 *
 * A template lists the goals that *pull it in* (`focus`), which is generous: "Read 5 pages" is tagged focus, study, phone and
 * evening. That is fine for ranking, but it is not coverage. Every goal therefore has an explicit rule here, in plain words, saying
 * what counts. A task counts as the goal's **primary** cover only when it is tagged for the goal, passes the goal's rule, and its
 * step is long enough (and, for "tiny habit" goals, short enough) to mean something. A task that is tagged for the goal but fails
 * the rule is **supporting**: it is shown, with the reason it is not enough on its own, and the goal still counts as deferred
 * when nothing primary fits.
 */

export type CoverRole = 'primary' | 'supporting';

export interface GoalRule {
  /** What counts, as a sentence the user can read ("Moves your body for 5 minutes or more"). */
  means: string;
  /** Smallest step, in minutes, that is a real attempt at the goal rather than a gesture. */
  min: number;
  /** Largest step that still counts (only for goals about *tiny* habits). */
  max?: number;
  /** Is this template really about the goal? */
  primary: (t: LifeTemplate) => boolean;
}

const idIn = (...ids: string[]) => (t: LifeTemplate) => ids.includes(t.id);
const MOVING = ['Walking', 'Lower body', 'Upper body', 'Core', 'Cardio', 'Workouts'];

export const GOAL_RULES: Record<Exclude<LifeFocus, 'home'>, GoalRule> = {
  active: {
    means: 'Moves your body for 5 minutes or more',
    min: 5,
    primary: (t) => t.domain === 'fitness' && MOVING.includes(t.sub),
  },
  discipline: {
    means: 'A daily commitment you keep whether or not you feel like it',
    min: 2,
    primary: idIn('s-make-bed', 'm-top3', 'a-plan-tomorrow', 'm-focus', 'l-study', 'l-practice', 'l-project', 'd-phone-free', 'f-walk'),
  },
  morning: {
    means: 'A step in a morning routine that starts the day on purpose',
    min: 2,
    // Brushing your teeth is a morning step, but it is what everyone does anyway, so it is not an improvement to the routine.
    primary: (t) => !!t.routine && t.time === 'morning' && t.id !== 'c-teeth',
  },
  evening: {
    means: 'A step in an evening routine that winds down or sets up tomorrow',
    min: 1,
    primary: (t) => !!t.routine && t.time === 'evening' && t.id !== 'c-teeth-night',
  },
  focus: {
    means: 'Sets your priorities or protects a block of focused time',
    min: 3,
    primary: idIn('m-focus', 'm-top3', 'l-project', 'l-study', 'd-phone-free'),
  },
  phone: {
    means: 'A real break from the phone (5 minutes or more), or fewer things pulling you to it',
    min: 5,
    primary: idIn('d-phone-free', 'd-social-break', 'd-nophone-bed', 'd-nophone-morning', 'd-notifications'),
  },
  selfcare: {
    means: 'Looks after your body or your calm',
    min: 1,
    primary: (t) => ['care', 'breathing'].includes(t.domain) || t.sub === 'Journaling' || idIn('f-stretch', 'f-recovery', 'f-mobility', 'f-dance', 'o-outside', 'o-daylight', 'o-park')(t),
  },
  study: {
    means: 'Studies or practises a skill for 5 minutes or more',
    min: 5,
    primary: (t) => t.domain === 'learning',
  },
  organize: {
    means: 'Keeps your plans, money, documents or digital clutter in order',
    min: 1,
    primary: (t) => t.domain === 'admin' || t.sub === 'Tidying' || t.sub === 'Planning',
  },
  healthy: {
    means: 'Moves, eats well, gets daylight or protects your sleep',
    min: 1,
    // Hygiene is not "healthy routines" in the sense the goal describes (movement, meals, daylight, sleep).
    primary: (t) => t.domain === 'fitness' || (t.domain === 'care' && ['Meals', 'Nutrition'].includes(t.sub)) || idIn('o-outside', 'o-daylight', 'o-park', 's-bedtime', 's-dim', 's-read', 'b-sleep', 'd-nophone-bed')(t),
  },
  consistent: {
    means: 'A tiny habit you repeat every single day',
    min: 1,
    max: 15,
    // Daily hygiene is already habitual for most people; "consistency" is about building something new.
    primary: (t) => t.freq === 'daily' && t.sub !== 'Hygiene' && t.sub !== 'Grooming',
  },
};

/** Smallest step (in minutes) that counts as really doing it. */
export const meaningfulMinutes = (f: LifeFocus): number => (f === 'home' ? 1 : GOAL_RULES[f].min);

/** Is the template itself the sort of task the goal is about (ignoring how long this step is)? */
export const isPrimary = (f: LifeFocus, t: LifeTemplate): boolean => (f === 'home' ? false : GOAL_RULES[f].primary(t));

export interface CoverExplanation { role: CoverRole; why: string }

/**
 * How a chosen task relates to a goal, and why, in words. `null` when the template is not even tagged for the goal.
 * Without `minutes` only the template is judged.
 */
export const explainCover = (f: LifeFocus, t: LifeTemplate, minutes?: number): CoverExplanation | null => {
  if (f === 'home' || !t.focus.includes(f)) return null;
  const rule = GOAL_RULES[f];
  if (!rule.primary(t)) return { role: 'supporting', why: `Related to this goal, but not directly about it. What counts here: "${rule.means}".` };
  if (minutes !== undefined && minutes < rule.min) return { role: 'supporting', why: `Too short to count on its own (${minutes} min; it takes ${rule.min}). What counts here: "${rule.means}".` };
  if (minutes !== undefined && rule.max !== undefined && minutes > rule.max) return { role: 'supporting', why: `Longer than a tiny habit (${minutes} min; the limit is ${rule.max}). What counts here: "${rule.means}".` };
  return { role: 'primary', why: `${rule.means}.` };
};

/**
 * Does this candidate genuinely serve the goal at the given length?
 * Morning/evening goals need a routine task whose own time of day matches (brushing teeth in the morning does not serve an
 * evening goal, whatever its tags say).
 */
export const servesGoal = (f: LifeFocus, x: { t: LifeTemplate; matches: LifeFocus[] }, minutes?: number): boolean =>
  x.matches.includes(f) && explainCover(f, x.t, minutes)?.role === 'primary';
