import type { LifeTemplate } from './lifeCatalog';
import type { LifeFocus } from './types';

/**
 * What it takes for a task to genuinely serve a goal.
 *
 * A template lists the goals that *pull it in* (`focus`), which is generous: "Read 5 pages" is tagged focus, study, phone and
 * evening. That is fine for ranking, but it is not coverage. A goal counts as covered only when a chosen task is really about it
 * (`isPrimary`), is tagged for it, and is long enough to mean something (`MEANINGFUL_MIN`).
 */

const idIn = (...ids: string[]) => (t: LifeTemplate) => ids.includes(t.id);

const PRIMARY: Partial<Record<LifeFocus, (t: LifeTemplate) => boolean>> = {
  active: (t) => t.domain === 'fitness',
  discipline: (t) => t.base >= 50,
  focus: idIn('m-focus', 'm-top3', 'l-project', 'l-study', 'b-box', 'd-phone-free'),
  phone: (t) => t.domain === 'digital',
  selfcare: (t) => ['care', 'breathing', 'outdoor'].includes(t.domain) || t.sub === 'Journaling' || idIn('f-stretch', 'f-recovery', 'f-dance')(t),
  study: (t) => t.domain === 'learning',
  organize: (t) => t.domain === 'admin' || t.sub === 'Tidying' || t.sub === 'Planning',
  healthy: (t) => ['fitness', 'outdoor', 'sleep', 'care'].includes(t.domain),
  consistent: (t) => t.freq === 'daily',
};

/** Smallest step (in minutes) that counts as really doing it. Everything else counts from one minute. */
export const MEANINGFUL_MIN: Partial<Record<LifeFocus, number>> = { active: 5, study: 5, focus: 5 };

export const meaningfulMinutes = (f: LifeFocus): number => MEANINGFUL_MIN[f] ?? 1;

export const isPrimary = (f: LifeFocus, t: LifeTemplate): boolean => {
  if (f === 'morning' || f === 'evening') return !!t.routine && t.time === f;
  const rule = PRIMARY[f];
  return rule ? rule(t) : t.focus.includes(f);
};

/**
 * Does this candidate genuinely serve the goal at the given length?
 * Morning/evening goals need a routine task whose own time of day matches (brushing teeth in the morning does not serve an
 * evening goal, whatever its tags say).
 */
export const servesGoal = (f: LifeFocus, x: { t: LifeTemplate; matches: LifeFocus[] }, minutes?: number): boolean => {
  if (!x.matches.includes(f) || !isPrimary(f, x.t)) return false;
  return minutes === undefined || minutes >= meaningfulMinutes(f);
};
