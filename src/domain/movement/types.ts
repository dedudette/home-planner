import type { ISODate } from '../types';

/**
 * Movement: an exercise catalogue, workouts built from it, a guided session, and a record of what was actually done.
 *
 * Boundaries that are part of the design:
 *  - Minutes live in ONE place, the log entry the app already keeps for everything (`SessionEntry`). A whole workout is one entry with
 *    its real duration; the exercises inside it carry no minutes at all, so nothing can be counted twice.
 *  - Nothing here sets a weight, calorie or body goal, and nothing raises difficulty by itself. The app may OFFER a step up or down; the
 *    person chooses.
 *  - Pain is never something to push through. A session can end because of it, and then nothing is escalated.
 */

export const MOVE_TYPES = ['walking', 'mobility', 'gentle', 'strength', 'stretching', 'dance'] as const;
export type MoveType = (typeof MOVE_TYPES)[number];

export const MOVE_LEVELS = ['beginner', 'intermediate', 'advanced'] as const;
export type MoveLevel = (typeof MOVE_LEVELS)[number];

/** Things a person may have. "Nothing" is always fine: every browsable choice has a no-equipment version. */
export const MOVE_EQUIPMENT = ['mat', 'chair', 'wall', 'light-weights', 'resistance-band', 'stairs'] as const;
export type MoveEquip = (typeof MOVE_EQUIPMENT)[number];

/** What an exercise asks of the body, so a person can say what they would rather not do. */
export const MOVE_DEMANDS = ['jumping', 'kneeling', 'floor', 'wrist-load', 'standing-balance', 'deep-bend'] as const;
export type MoveDemand = (typeof MOVE_DEMANDS)[number];

export interface Exercise {
  id: string;
  name: string;
  type: MoveType;
  level: MoveLevel;
  intensity: 'gentle' | 'moderate' | 'vigorous';
  impact: 'low' | 'high';
  needs: MoveEquip[];
  demands: MoveDemand[];
  /** Counted in repetitions or held/moved for a time. */
  mode: 'reps' | 'timed';
  /** Used to estimate how long a set of reps takes. */
  secPerRep: number;
  /** What to do, in order. Clear enough to follow without seeing a picture. */
  how: string[];
  /** A real alternative for when this is too much. Always present. */
  easier: string;
  /** A way to make it a little harder, offered only if the person asks. Never applied automatically. */
  harder?: string;
}

export interface WorkoutBlock {
  /** A catalogue exercise... */
  exerciseId?: string;
  /** ...or one the person named themselves (a custom workout). */
  name?: string;
  sets: number;
  reps?: number;
  seconds?: number;
  restSeconds: number;
}

export interface Workout {
  id: string;
  name: string;
  type: MoveType;
  level: MoveLevel;
  blurb: string;
  blocks: WorkoutBlock[];
  /** A gentler workout to offer on a low-energy day or when this feels like too much. */
  easierId?: string;
  source: 'starter' | 'personal';
}

export type Felt = 'easy' | 'right' | 'hard' | 'pain';

export interface LoggedExercise {
  exerciseId: string | null;
  name: string;
  status: 'done' | 'skipped' | 'easier';
  /** What was done, if the person said. No minutes here: the workout's minutes are the log entry's. */
  setsDone: number | null;
  repsDone: number | null;
}

export interface WorkoutLog {
  /** The id of the SessionEntry that holds this workout's minutes. */
  entryId: string;
  workoutId: string | null;
  name: string;
  date: ISODate;
  at: string;
  felt: Felt | null;
  exercises: LoggedExercise[];
  note: string;
}

export const AVOIDS = ['jumping', 'kneeling', 'floor', 'wrist-load', 'standing-balance'] as const;
export type MoveAvoid = (typeof AVOIDS)[number];

export interface MovementPrefs {
  equipment: MoveEquip[];
  /** Types the person likes; used only to put them first. */
  likes: MoveType[];
  /** Things the person would rather not do. Anything that asks for one is hidden from suggestions. */
  avoid: MoveAvoid[];
  /** True: only low-impact movement is suggested. */
  lowImpactOnly: boolean;
}

export interface MovementGoals {
  sessionsPerWeek: number | null;
  minutesPerWeek: number | null;
  /** In the person's own words. Kept as written. */
  note: string;
}

export interface MovementData {
  prefs: MovementPrefs;
  goals: MovementGoals;
  /** Weekdays (0 = Sunday) the person declared rest days. */
  restDays: number[];
  custom: Workout[];
  favourites: string[];
  log: WorkoutLog[];
}
