/**
 * CleanFlow data model.
 *
 * Everything the app persists lives in `AppData`. The cleaning plan itself is
 * *derived* (see engine.ts) from Home + Preferences, so editing a home never
 * requires migrating stored tasks. User behaviour (completions, skips,
 * reschedules) is stored separately and keyed by stable task ids.
 */

import type { MealsData, ShoppingData } from './meals/types';
import type { ActivityKind, ActivityModule, ActivityRef, ModulesState, PlannedActivity } from './modules/types';

export type ISODate = string; // 'YYYY-MM-DD' in the user's local time

// ───────────────────────── Home ─────────────────────────

export type HomeType =
  | 'apartment' | 'studio' | 'house' | 'townhouse' | 'duplex' | 'dorm' | 'shared' | 'other';

export type SizeBand =
  | 'u25' | '25-40' | '41-60' | '61-80' | '81-100' | '101-130' | '131-160' | '161-200' | '200+' | 'unknown';

export type SizeLevel = 'none' | 'small' | 'medium' | 'large';
export type GarageSize = 'none' | '1-car' | '2-car' | 'large';

export interface RoomCounts {
  bedrooms: number;
  bathrooms: number;
  livingRooms: number;
  kitchens: number;
  diningRooms: number;
  offices: number;
  laundryRooms: number;
  hallways: number;
  storageRooms: number;
  balcony: SizeLevel;
  garage: GarageSize;
  basement: SizeLevel;
  attic: SizeLevel;
}

export type PetType = 'dog' | 'cat' | 'rabbit' | 'small' | 'bird' | 'fish' | 'reptile' | 'other';
export type PetChoice = 'none' | 'dog' | 'cat' | 'both' | 'other';
export type PetAccess = 'indoor' | 'outdoor';
export type PetFeature = 'litter' | 'feeding' | 'beds' | 'crates' | 'toys';

export interface PetProfile {
  choice: PetChoice;
  types: PetType[];
  count: number; // 1..3 (3 = "3+")
  access: PetAccess[];
  features: PetFeature[];
}

export type Cleanliness =
  | 'quite-clean' | 'mostly-clean' | 'little-messy' | 'quite-messy' | 'very-messy' | 'overwhelming' | 'long-time';

export type ProblemArea =
  | 'dishes' | 'laundry' | 'floors' | 'dust' | 'bathroom' | 'kitchen' | 'bedroom' | 'living-room'
  | 'clutter' | 'trash' | 'pet-hair' | 'kitchen-surfaces' | 'refrigerator' | 'windows' | 'organization' | 'other';

/** A user-defined extra space (sunroom, craft room, ...). */
export interface ExtraRoom { id: string; name: string }

export interface Home {
  type: HomeType | null;
  customType: string;
  sizeBand: SizeBand | null;
  exactSizeM2: number | null;
  rooms: RoomCounts;
  roomsTouched: boolean; // user edited counts manually -> don't overwrite with type defaults
  floors: number;
  extraRooms: ExtraRoom[];
  adults: number;
  children: number;
  pets: PetProfile;
  cleanliness: Cleanliness | null;
  problemAreas: ProblemArea[];
  problemOther: string;
}

// ───────────────────────── Preferences ─────────────────────────

export type CleaningStyle =
  | 'daily' | 'weekly-session' | 'several-short' | 'weekend' | 'only-necessary' | 'app-decides';

export type Energy = 'very-low' | 'low' | 'medium' | 'high' | 'very-high' | 'varies';

export type Blocker =
  | 'where-to-start' | 'overwhelming' | 'distracted' | 'forget' | 'procrastinate' | 'lose-motivation'
  | 'no-time' | 'tired' | 'clutter' | 'too-many-things' | 'dont-know-frequency' | 'other';

export type Goal =
  | 'consistent' | 'under-control' | 'less-overwhelm' | 'daily-routine' | 'weekly-routine' | 'guests'
  | 'deep-clean' | 'declutter' | 'less-time' | 'easier' | 'habits' | 'recover' | 'moving' | 'event' | 'other';

export interface Preferences {
  style: CleaningStyle | null;
  sessionMinutes: number | null; // 5..90
  daysPerWeek: number | null; // 1..7
  daysTouched: boolean;
  energy: Energy | null;
  blockers: Blocker[];
  goals: Goal[];
  /** Learned: shrink chunk size below what the user asked for. */
  learnedSessionCap: number | null;
  /** What to improve. Always contains at least 'home' for data created before the life layer existed. */
  focus: LifeFocus[];
  fitnessLevel: FitnessLevel;
  equipment: EquipmentNeed;
  /** Progressive discipline: 1 = tiny steps, 3 = fuller habits. Raised/lowered only with the user's consent. */
  lifeLevel: LifeLevel;
  /** Date the current level started. Progression is judged over the time spent at a level, never before. */
  levelSince: ISODate | null;
  /**
   * DERIVED, never stored: set only by `planPrefs` when at least one section (movement, meals…) is on. It lets a person who wants
   * no cleaning plan and no generated habits still have a day to plan, instead of being given a home they did not ask for.
   */
  sections?: boolean;
}

export interface User { id: string; name: string; createdAt: string; demo: boolean }

// ───────────────────────── Rooms & tasks ─────────────────────────

export type RoomKind =
  | 'kitchen' | 'bathroom' | 'bedroom' | 'living' | 'dining' | 'office' | 'hallway' | 'laundry'
  | 'storage' | 'balcony' | 'garage' | 'basement' | 'attic' | 'other' | 'home';

export interface Room {
  id: string;
  kind: RoomKind;
  name: string;
  floor: number; // 0-based floor index; basement = -1, attic = 99 (outside floors)
  areaM2: number;
  zone: string;
  /** Studio/dorm main rooms double as bedroom + living room. */
  sleeps?: boolean;
  virtual?: boolean;
}

// ───────────────────────── Life domains ─────────────────────────

/** Where a task lives. 'home' is the original cleaning plan; the rest are the personal-discipline layer. */
export type Domain =
  | 'home' | 'fitness' | 'breathing' | 'care' | 'mind' | 'digital' | 'admin' | 'learning' | 'outdoor' | 'sleep' | 'meals';
export type LifeDomain = Exclude<Domain, 'home'>;

/** What the user wants to improve. Chosen in onboarding, multi-select. */
export type LifeFocus =
  | 'home' | 'active' | 'discipline' | 'morning' | 'evening' | 'focus' | 'phone' | 'selfcare' | 'study'
  | 'organize' | 'healthy' | 'consistent';

export type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'anytime';
export type Intensity = 'gentle' | 'moderate' | 'vigorous';
export type EquipmentNeed = 'none' | 'basic';
export type FitnessLevel = 'beginner' | 'intermediate' | 'advanced';
export type LifeLevel = 1 | 2 | 3;

export type Frequency =
  | 'daily' | 'twice-weekly' | 'weekly' | 'biweekly' | 'monthly' | 'seasonal' | 'deep' | 'once';

export type Priority = 'URGENT' | 'HIGH' | 'MEDIUM' | 'LOW';
export type Difficulty = 1 | 2 | 3;
export type Tier = 'maintenance' | 'reset' | 'deep';

export type ResetPhase = 'trash' | 'dishes' | 'laundry' | 'clutter' | 'surfaces' | 'bathroom' | 'floors';

export type Cadence =
  | { kind: 'days'; days: number[] } // fixed weekdays (0 = Sunday)
  | { kind: 'every'; every: number } // every N days from an anchor date
  | { kind: 'once' };

export interface Task {
  id: string;
  templateId: string | null; // null for custom tasks
  name: string;
  roomId: string;
  roomKind: RoomKind;
  roomName: string;
  category: string;
  minutes: number;
  difficulty: Difficulty;
  frequency: Frequency;
  cadence: Cadence;
  priority: Priority;
  score: number; // 0..100, drives sorting inside a priority level
  impact: number; // 1..10 visible/hygiene payoff, drives "I only have X minutes"
  reason: string;
  substeps: string[];
  tinySteps: string[]; // ultra-small version for overwhelm mode
  tier: Tier;
  phase?: ResetPhase;
  habit: boolean; // essential tiny daily habit, kept even on non-cleaning days
  quickWin: boolean;
  zone: string;
  floor: number;
  startDate: ISODate | null; // first scheduled date; null = unscheduled (deep clean backlog)
  part?: { index: number; of: number };
  needs: SupplyNeed[];
  custom?: boolean;
  notes?: string;
  topics: ProblemArea[];
  /** Pushed out of the weekly plan to respect the user's time budget. */
  backlog?: boolean;

  // ── Life-layer metadata (all optional; home tasks only set `domain`) ──
  domain?: Domain;
  subcategory?: string;
  description?: string;
  tags?: string[]; // focus areas such as 'core', 'lower-body', 'cardio'
  equipment?: EquipmentNeed;
  intensity?: Intensity;
  lowImpact?: boolean; // joint-friendly option
  beginner?: boolean; // suitable for a complete beginner
  setting?: 'indoor' | 'outdoor' | 'either';
  timeOfDay?: TimeOfDay;
  routine?: boolean; // belongs to a morning / afternoon / evening routine
  repeatable?: boolean; // can sensibly be done more than once a day
  level?: LifeLevel; // progression step
  challenge?: boolean; // above the user's current level: optional, never scheduled automatically
  /** Goals this task was chosen for (life tasks). Recorded on log entries for later analysis. */
  matches?: LifeFocus[];

  // ── Planned activities (workouts, meal prep, learning, routines). Set only on tasks built from a PlannedActivity. ──
  /** The PlannedActivity this task is. Its id is `act:<activityId>`; there is exactly one identity and one completion record. */
  activityId?: string;
  module?: ActivityModule;
  kind?: ActivityKind;
  /** The person scheduled this themselves, so the planner never drops it for time. Energy and safety rules still apply. */
  userPlanned?: boolean;
  /** 'HH:MM' for a fixed activity. */
  time?: string | null;
  /** Shown instead of the frequency label, for example "Mon, Wed, Fri". */
  scheduleLabel?: string;
  /** Last date this can be due. After it the task is no longer offered (a fixed activity on a past date is not carried forward). */
  expires?: ISODate;
  /** What the activity points at in its own section (a workout, a recipe…). */
  ref?: ActivityRef | null;
}

export interface CustomTask {
  id: string;
  /** Defaults to 'home'. For other domains `roomId` is ignored. */
  domain?: Domain;
  name: string;
  roomId: string; // room id or 'other'
  frequency: Frequency; // 'once' allowed
  minutes: number;
  priority: Priority;
  notes: string;
  startDate: ISODate;
  createdAt: string;
}

// ───────────────────────── Schedule ─────────────────────────

/** Per-task user state (the "Schedule" for a task). All fields optional. */
export interface TaskState {
  anchor?: ISODate; // overrides plan startDate as the series alignment
  due?: ISODate | null; // current open occurrence; undefined = use plan default
  lastDone?: ISODate;
  doneCount?: number;
  skipStreak?: number;
  skipTotal?: number;
  done?: boolean; // one-time tasks
  hidden?: boolean;
  override?: { minutes?: number; frequency?: Frequency; smaller?: boolean };
}

export type EntryOutcome = 'completed' | 'skipped' | 'snoozed' | 'moved' | 'stopped';
export type EntryVia = 'checkoff' | 'timer' | 'five' | 'timebox' | 'reset' | 'plan';
/**
 * Where the action was taken. `via` says how (a tick, a timer, "Just 5 minutes"…) and is ambiguous across screens ('plan' covers
 * skips from Today, Plan and Schedule alike), so this says which screen or sheet it came from. Absent on older entries: unknown.
 */
export type EntrySurface = 'today' | 'plan' | 'schedule' | 'progress' | 'home' | 'supplies' | 'settings' | 'more' | 'detail' | 'timebox' | 'five' | 'reset' | 'rough' | 'timer' | 'movement' | 'meals' | 'learning' | 'wellbeing' | 'other';
/**
 * How the task related to the day's planner decision at the moment of the action:
 *  selected    the planner had put it on the day's list
 *  left-out    the planner had left it out of the day's list (for the reason recorded in that day's `left`)
 *  not-planned the planner had not considered it for the day (a Quick win browsed in the Plan, Just 5 minutes, a reset step…)
 * Absent: there was no decision record for that day (older data), so the relation is unknown. It is never guessed.
 */
export type EntryPlanned = 'selected' | 'left-out' | 'not-planned';

export interface SessionEntry {
  id: string;
  at: string; // ISO timestamp
  date: ISODate;
  taskId: string;
  name: string;
  roomKind: RoomKind;
  roomName: string;
  category: string;
  plannedMinutes: number;
  actualMinutes: number;
  outcome: EntryOutcome;
  via: EntryVia;
  domain?: Domain;

  // ── Analytics foundation (all optional: entries written before v2 simply lack them) ──
  templateId?: string | null;
  level?: LifeLevel;
  difficulty?: Difficulty;
  intensity?: Intensity;
  /** The time of day the task was planned for (not when it was done). */
  timeOfDay?: TimeOfDay;
  /** Local hour (0-23) when the action happened. `at` is UTC, so this is what makes time-of-day analysis possible. */
  localHour?: number;
  /** Minutes behind UTC, as `Date.getTimezoneOffset()` reports it. Lets analysis cope with travel. */
  tzOffsetMin?: number;
  goals?: LifeFocus[];
  planVersion?: string;
  energy?: 'low' | 'ok' | 'high';
  /**
 * The due date of the occurrence this action answers (for completions and skips), or where the task was due before the move or
 * snooze. Null when the task has no schedule of its own (Just 5 minutes, rough-day steps). Absent on older entries: unknown.
 */
  fromDue?: ISODate | null;
  /** For moves and snoozes: where the task is due now. */
  toDue?: ISODate | null;
  surface?: EntrySurface;
  planned?: EntryPlanned;
  /** For a task that was split into parts: which part. The parts have their own task ids, so each part is one occurrence. */
  part?: { index: number; of: number };
}

/** A "bout" of cleaning: entries less than 45 minutes apart belong together. */
export interface CleaningSession {
  id: string;
  date: ISODate;
  startedAt: string;
  endedAt: string;
  entries: SessionEntry[];
}

export interface PlanMeta {
  startDate: ISODate;
  resetCount: number;
}

export interface ResetRun { startedAt: string; doneIds: string[]; finishedAt?: string }

// ───────────────────────── Supplies ─────────────────────────

export type SupplyNeed =
  | 'all-purpose' | 'dish-soap' | 'glass' | 'toilet' | 'bathroom' | 'floor' | 'cloth' | 'sponge'
  | 'vacuum' | 'broom' | 'mop' | 'bags' | 'laundry' | 'degreaser' | 'descaler' | 'gloves' | 'lint-roller'
  | 'duster' | 'brush';

export type SupplyCategory =
  | 'all-purpose' | 'dish-soap' | 'glass' | 'bathroom' | 'toilet' | 'floor' | 'degreaser' | 'disinfectant'
  | 'bleach' | 'descaler' | 'vinegar' | 'baking-soda' | 'laundry' | 'cloths' | 'tools' | 'bags' | 'other';

export interface Supply {
  id: string;
  product: string;
  category: SupplyCategory;
  room: RoomKind | 'any';
  quantity: string;
  notes: string;
  /** Specific needs a "tools" supply covers (vacuum, mop, ...). */
  tools?: SupplyNeed[];
}

// ───────────────────────── Progress (derived) ─────────────────────────

export interface Progress {
  tasksCompleted: number;
  minutesCleaned: number;
  streak: number;
  bestStreak: number;
  sessions: number;
  weekDone: number;
  weekPlanned: number;
  monthDone: number;
  monthPlanned: number;
  last7: { date: ISODate; minutes: number; tasks: number }[];
  weeks: { label: string; tasks: number; minutes: number }[];
  rooms: { kind: RoomKind; name: string; tasks: number; minutes: number }[];
  /** Life-layer areas (fitness, mind, …). Home work stays in `rooms`. */
  areas: { domain: LifeDomain; name: string; tasks: number; minutes: number }[];
  roomsRefreshedThisWeek: number;
}

// ───────────────────────── Aggregate root ─────────────────────────

export type EnergyLevel = 'low' | 'ok' | 'high';
export interface DayEnergy { date: ISODate; level: EnergyLevel }

/**
 * A task the planner SELECTED for a day (it is on the day's list). It is not the same as "the person saw it": see `seenAt`.
 *
 * Contract 2 (the current one) separates three different facts that were once blurred into "exposure":
 *  1. SELECTED by the planner: this record's `items`, each with the time (`selectedAt`) and the energy declared at that moment.
 *  2. LEFT OUT by the planner: the record's `left`, each with the reason, decided at that moment. Never an exposure.
 *  3. SEEN: `seenAt`, set only when the Today screen actually rendered the task while the page was visible (a task in a collapsed
 *     group is seen only once the group is opened).
 * Records written before contract 2 have no `contract`: what they list was planned, whether it was seen is unknown, their
 * 'extra' items were left out for an unrecorded reason, and `shownAt` is the time it was planned, not displayed.
 */
export interface ExposureItem {
  taskId: string;
  templateId: string | null;
  domain: Domain;
  minutes: number;
  difficulty: Difficulty;
  /** Where the planner put it. 'extra' only appears in records written before contract 2, where it meant "left out". */
  kind: 'focus' | 'life' | 'extra' | 'catchUp';
  /** Contract 2: when the planner selected it, and the energy the person had declared at that moment. Immutable. */
  selectedAt?: string;
  /** Contract 2: when it was first rendered on the Today screen while the page was visible. Absent = not seen (as far as recorded). */
  seenAt?: string;
  /** Before contract 2 this was called "shown" but meant "planned". Kept so old data round-trips; read it as `selectedAt`. */
  shownAt?: string;
  energy?: EnergyLevel;
  level?: LifeLevel;
  intensity?: Intensity;
  timeOfDay?: TimeOfDay;
  goals?: LifeFocus[];
}

/** Why the planner left a due task out of a day's list. These are the planner's decisions, never the person's. */
export type PlannerExclusion = 'not-enough-time' | 'low-energy-day' | 'not-a-cleaning-day';

/** A task that was due and considered but not put on the day's list. It is NOT an exposure: the person may never have seen it. */
export interface LeftOutItem {
  taskId: string;
  templateId: string | null;
  domain: Domain;
  minutes: number;
  difficulty: Difficulty;
  reason: PlannerExclusion;
  /** When the planner decided this, the energy declared then, and the day's minutes then (the three things the reason depends on). */
  at: string;
  energy: EnergyLevel;
  budget: number;
  /** When the person opened the "left out" list and it was rendered. Absent = never revealed. */
  seenAt?: string;
  level?: LifeLevel;
  intensity?: Intensity;
  timeOfDay?: TimeOfDay;
  goals?: LifeFocus[];
}

/**
 * What the planner decided for a day, recorded when the app is first opened (visible) that day. Contract 2 records exist for every
 * day the app was visible, even a day with nothing planned, so a day with no record is a day it was not opened (see behaviour.ts).
 *
 * Do not read "no completion" as "skipped": a skip is something the person did (an entry with outcome 'skipped'); a task that was
 * seen and has no entry simply has no recorded action.
 *
 * What "energy" means in an exposure, because it can change during a day:
 *  - `ExposureItem.energy`  the energy the person had declared at the moment THAT task was first shown. An immutable fact about the
 *                            exposure: a task shown on a high-energy morning stays "shown at high energy" even if the evening is low.
 *  - `ExposureRecord.energy` the energy when the day was first opened (the first exposure). Also immutable.
 *  - `energyChanges`        every later change, in order, so the whole day's energy can be replayed.
 *  - `SessionEntry.energy`  the energy at COMPLETION, recorded on the log entry.
 * Comparing the first with the last is how "did they do hard things on low days?" is answered; none of them is ever overwritten.
 */
export interface ExposureRecord {
  date: ISODate;
  /** 2 = the current contract described above. Absent = written before it (display and exclusion reasons unknown). */
  contract?: 2;
  recordedAt: string;
  planVersion: string;
  activeDay: boolean;
  energy: EnergyLevel;
  energyChanges?: { at: string; level: EnergyLevel }[];
  tzOffsetMin: number;
  budgetMinutes: number;
  items: ExposureItem[];
  /** Contract 2: due tasks the planner left out, with the reason, decided at that moment. Each (task, reason) is recorded once. */
  left?: LeftOutItem[];
}

/** A snapshot of the inputs the plan was generated from, so a behaviour change is never confused with a plan change. */
export interface PlanVersion {
  id: string;
  at: string;
  /** Goals the plan could not serve when it was generated, with why (minutes, cap, safety, context, none). Absent on older versions. */
  deferredGoals?: { goal: LifeFocus; reason: GoalDeferReason; needMinutes?: number }[];
  focus: LifeFocus[];
  lifeLevel: LifeLevel;
  fitnessLevel: FitnessLevel;
  sessionMinutes: number | null;
  daysPerWeek: number | null;
}

/** Everything a future recommender needs to learn from: what was shown, why, and what the user did with it. */
export type RecommendationEventKind = 'shown' | 'accepted' | 'dismissed';
export interface RecommendationEvent {
  id: string;
  at: string;
  date: ISODate;
  localHour: number;
  kind: RecommendationEventKind;
  recommendationId: string;
  /** Machine-readable reason, e.g. 'skip-streak' or 'level-up'. */
  code: string;
  /** The numbers behind the reason (counts, windows), so the explanation can be reproduced. */
  evidence?: Record<string, number | string>;
  action?: string;
  planVersion: string;
}

/**
 * Why a goal is not in the plan, decided at the point where it stopped being possible:
 *  - budget : the tasks that would serve it do not fit in the minutes the day has (or what the other goals left)
 *  - cap    : there is room in minutes but the plan already holds as many habits as it should
 *  - safety : every task for it is ruled out by the user's fitness level or energy
 *  - context: the tasks need something the user has not got (equipment, an outdoor space…)
 *  - none   : nothing in the catalogue serves it at the user's current level
 */
export type GoalDeferReason = 'budget' | 'cap' | 'safety' | 'context' | 'none';

/** A task in the plan that relates to a goal, and exactly how. */
export interface CoverTask {
  taskId: string;
  name: string;
  minutes: number;
  /** primary: really about the goal and long enough to count. supporting: related, but not enough on its own. */
  role: 'primary' | 'supporting';
  /** Why it counts, or why it is only supporting, in plain words. */
  why: string;
}

/** Whether a selected goal got a real task in the plan. Never faked: deferred goals say why. */
export interface GoalCoverage {
  goal: LifeFocus;
  status: 'covered' | 'deferred';
  /** The primary tasks only. A goal is covered exactly when this is non-empty. */
  taskIds: string[];
  /** Every task in the plan related to the goal, primary first. */
  cover: CoverTask[];
  reason?: GoalDeferReason;
  needMinutes?: number;
}

/** A record that old history was removed, so "no data before this date" is never mistaken for "no activity". */
export interface RetentionNote {
  at: string;
  removedSessions: number;
  removedEntries: number;
  /** Everything on or before this date was removed. */
  removedThrough: ISODate;
  oldestKept: ISODate;
}

export interface AppData {
  version: 3;
  user: User;
  home: Home;
  preferences: Preferences;
  onboardingComplete: boolean;
  plan: PlanMeta;
  taskStates: Record<string, TaskState>;
  customTasks: CustomTask[];
  sessions: CleaningSession[];
  supplies: Supply[];
  resetRun: ResetRun | null;
  fiveRecent: string[];
  dismissedInsights: Record<string, ISODate>;
  dayEnergy: DayEnergy | null;
  lastOpened: ISODate | null;
  // ── Analytics foundation (v2) ──
  exposures: ExposureRecord[];
  energyLog: Record<ISODate, EnergyLevel>;
  planVersions: PlanVersion[];
  recEvents: RecommendationEvent[];
  /** Every time history was compacted to fit in storage. Lets any later analysis know where the data really starts. */
  retention: RetentionNote[];
  // ── Sections beyond cleaning (v3) ──
  modules: ModulesState;
  /** Everything the person planned in a section: the same planner, the same Today, one identity each. */
  activities: PlannedActivity[];
  meals: MealsData;
  shopping: ShoppingData;
}
