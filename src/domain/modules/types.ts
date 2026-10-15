import type { ISODate, Intensity } from '../types';

/**
 * Sections beyond home cleaning. Home is not listed here on purpose: whether cleaning is on is already `preferences.focus.includes('home')`,
 * and a second copy of that fact could disagree with it.
 */
export const MODULE_IDS = ['movement', 'meals', 'water', 'learning', 'wellbeing'] as const;
export type ModuleId = (typeof MODULE_IDS)[number];

/** Sections that can own planned activities. Water is tracking only: it never takes minutes from the day. */
export const ACTIVITY_MODULES = ['movement', 'meals', 'learning', 'wellbeing'] as const;
export type ActivityModule = (typeof ACTIVITY_MODULES)[number];

/** The cards Today can show, in the order the person chose. */
export const TODAY_CARDS = ['plan', 'meals', 'water', 'checkin'] as const;
export type TodayCard = (typeof TODAY_CARDS)[number];

export interface ModulesState {
  enabled: Record<ModuleId, boolean>;
  /** Always a permutation of TODAY_CARDS. */
  order: TodayCard[];
  /** Cards the person hid. The plan card cannot be hidden. */
  hidden: TodayCard[];
  /** Optional daily allowance per category, in minutes. Never a requirement: a missing key means no allowance was set. */
  caps: Partial<Record<ActivityModule, number>>;
  /** The one-time "new sections" introduction for people who had the app before sections existed. */
  introSeen: boolean;
}

/**
 * What kind of commitment an activity is.
 *  fixed     has a clock time the person chose. The planner never moves it; two fixed items that overlap are shown as a conflict.
 *  flexible  planned for a day, any time. Counts against the day's minutes.
 *  optional  an idea the person wants to keep in view. Never counted, never due, never an obligation.
 */
export type ActivityKind = 'fixed' | 'flexible' | 'optional';

export type ActivitySchedule =
  | { kind: 'weekly'; weekdays: number[] } // 0 = Sunday; all seven is "every day"
  | { kind: 'once'; date: ISODate };

/** What an activity points at in its own section. The activity keeps its own identity; the reference only says where its content lives. */
export interface ActivityRef { kind: 'workout' | 'recipe' | 'interest' | 'routine' | 'none'; id: string }

/**
 * One planned thing in the one shared plan. Workouts, meal prep, learning and hobby sessions and wellbeing routines are all this, so
 * an activity is scheduled once, shown wherever it belongs, and has exactly one completion record (the same log entry cleaning uses).
 */
export interface PlannedActivity {
  id: string;
  module: ActivityModule;
  kind: ActivityKind;
  name: string;
  minutes: number;
  schedule: ActivitySchedule;
  /** 'HH:MM' local time. Required for fixed activities, optional otherwise. */
  time: string | null;
  startDate: ISODate;
  endDate: ISODate | null;
  ref: ActivityRef | null;
  intensity: Intensity;
  difficulty: 1 | 2 | 3;
  note: string;
  createdAt: string;
  archived: boolean;
}

/** What a section can pre-fill when it opens the planning form (for example a workout, with its own name, minutes and intensity). */
export type ActivityDefaults = Partial<Pick<PlannedActivity, 'module' | 'name' | 'minutes' | 'ref' | 'intensity' | 'difficulty' | 'kind' | 'time' | 'note' | 'schedule'>>;
