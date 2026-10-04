/**
 * CleanFlow data model.
 *
 * Everything the app persists lives in `AppData`. The cleaning plan itself is
 * *derived* (see engine.ts) from Home + Preferences, so editing a home never
 * requires migrating stored tasks. User behaviour (completions, skips,
 * reschedules) is stored separately and keyed by stable task ids.
 */

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
  | 'home' | 'fitness' | 'breathing' | 'care' | 'mind' | 'digital' | 'admin' | 'learning' | 'outdoor' | 'sleep';
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

export interface DayEnergy { date: ISODate; level: 'low' | 'ok' | 'high' }

export interface AppData {
  version: 1;
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
}
