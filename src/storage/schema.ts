import { emptyAppData } from '../domain/appdata';
import { emptyHome, emptyPreferences } from '../domain/context';
import {
  BLOCKERS, CLEANLINESS, ENERGY, EQUIPMENT_OPTIONS, FITNESS_LEVELS, FOCUS_OPTIONS, GARAGE_SIZES, GOALS, HOME_TYPES, PET_CHOICES,
  PET_FEATURES, PET_TYPES, PROBLEM_AREAS, SIZE_BANDS, SIZE_LEVELS, STYLES, SUPPLY_CATEGORIES,
} from '../domain/options';
import type {
  AppData, CleaningSession, CustomTask, Domain, ExposureItem, ExposureRecord, Frequency, ISODate, LifeFocus, LifeLevel,
  PlanVersion, Priority, RecommendationEvent, RoomCounts, SessionEntry, Supply, TaskState, TimeOfDay,
} from '../domain/types';

/**
 * Schema validation and migration for saved data.
 *
 * Principles:
 *  - Never throw, and never throw data away that can be understood. Bad fields are repaired; bad list items are dropped and counted.
 *  - Data that is *not recognisable* returns null so the caller keeps the original bytes untouched (recovery screen) instead of
 *    replacing them with an empty app.
 *  - Data written by a newer version of the app is read as far as this version understands it, and flagged so it is backed up
 *    before anything overwrites it.
 */

export const SCHEMA_VERSION = 2;

export interface ValidationResult {
  data: AppData;
  /** Human-readable notes about what had to be repaired. */
  repairs: string[];
  /** List items that could not be understood and were left out. */
  dropped: number;
  /** The version found in the file (1 when the file predates versioning). */
  foundVersion: number;
  fromFuture: boolean;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const values = <T extends string>(opts: readonly { value: T }[]): readonly T[] => opts.map((o) => o.value);

const DOMAINS: readonly Domain[] = ['home', 'fitness', 'breathing', 'care', 'mind', 'digital', 'admin', 'learning', 'outdoor', 'sleep'];
const FREQS: readonly Frequency[] = ['daily', 'twice-weekly', 'weekly', 'biweekly', 'monthly', 'seasonal', 'deep', 'once'];
const PRIOS: readonly Priority[] = ['URGENT', 'HIGH', 'MEDIUM', 'LOW'];
const OUTCOMES = ['completed', 'skipped', 'snoozed', 'moved', 'stopped'] as const;
const VIAS = ['checkoff', 'timer', 'five', 'timebox', 'reset', 'plan'] as const;
const ROOM_KINDS = ['kitchen', 'bathroom', 'bedroom', 'living', 'dining', 'office', 'hallway', 'laundry', 'storage', 'balcony', 'garage', 'basement', 'attic', 'other', 'home'] as const;
const TODS: readonly TimeOfDay[] = ['morning', 'afternoon', 'evening', 'anytime'];
const INTENSITIES = ['gentle', 'moderate', 'vigorous'] as const;
const ENERGY_LEVELS = ['low', 'ok', 'high'] as const;

const MAX = { sessions: 5000, entriesPerSession: 400, customTasks: 500, supplies: 300, exposures: 120, planVersions: 60, recEvents: 400, taskStates: 5000 };

class Ctx {
  repairs: string[] = [];
  dropped = 0;
  note(msg: string) { if (!this.repairs.includes(msg)) this.repairs.push(msg); }
}

const str = (v: unknown, d = '', max = 500): string => (typeof v === 'string' ? v.slice(0, max) : d);
const bool = (v: unknown, d = false): boolean => (typeof v === 'boolean' ? v : d);
const num = (v: unknown, d: number, lo = -Infinity, hi = Infinity): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};
const intn = (v: unknown, d: number, lo: number, hi: number) => Math.round(num(v, d, lo, hi));
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], d: T): T => (typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : d);
const oneOfOrNull = <T extends string>(v: unknown, allowed: readonly T[]): T | null => (typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : null);
const list = <T extends string>(v: unknown, allowed: readonly T[]): T[] =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is T => typeof x === 'string' && (allowed as readonly string[]).includes(x)))] : [];
const strList = (v: unknown, max = 200): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, max) : []);

/** True for a real calendar date in YYYY-MM-DD form. */
export const isISODate = (v: unknown): v is ISODate => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number);
  const dt = new Date(y, m - 1, d, 12);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
};
const date = (v: unknown): ISODate | null => (isISODate(v) ? v : null);
const isoStamp = (v: unknown, fallback: string): string => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : fallback);

// ───────────────────────── sections ─────────────────────────

const validateHome = (raw: unknown, c: Ctx): AppData['home'] => {
  const d = emptyHome();
  if (!isObj(raw)) { if (raw !== undefined) c.note('Home details were unreadable and were reset.'); return d; }
  const r = isObj(raw.rooms) ? raw.rooms : {};
  const rooms: RoomCounts = {
    bedrooms: intn(r.bedrooms, d.rooms.bedrooms, 0, 12), bathrooms: intn(r.bathrooms, d.rooms.bathrooms, 0, 10), livingRooms: intn(r.livingRooms, d.rooms.livingRooms, 0, 8),
    kitchens: intn(r.kitchens, d.rooms.kitchens, 0, 5), diningRooms: intn(r.diningRooms, d.rooms.diningRooms, 0, 5), offices: intn(r.offices, d.rooms.offices, 0, 6),
    laundryRooms: intn(r.laundryRooms, d.rooms.laundryRooms, 0, 5), hallways: intn(r.hallways, d.rooms.hallways, 0, 8), storageRooms: intn(r.storageRooms, d.rooms.storageRooms, 0, 6),
    balcony: oneOf(r.balcony, values(SIZE_LEVELS), 'none'), garage: oneOf(r.garage, values(GARAGE_SIZES), 'none'),
    basement: oneOf(r.basement, values(SIZE_LEVELS), 'none'), attic: oneOf(r.attic, values(SIZE_LEVELS), 'none'),
  };
  const p = isObj(raw.pets) ? raw.pets : {};
  const choice = oneOf(p.choice, PET_CHOICES.map((x) => x.value), 'none');
  const extra = Array.isArray(raw.extraRooms)
    ? raw.extraRooms.flatMap((x) => (isObj(x) && typeof x.id === 'string' ? [{ id: x.id.slice(0, 40), name: str(x.name, 'Extra space', 40) }] : [])).slice(0, 12)
    : [];
  return {
    type: oneOfOrNull(raw.type, values(HOME_TYPES)), customType: str(raw.customType, '', 40), sizeBand: oneOfOrNull(raw.sizeBand, values(SIZE_BANDS)),
    exactSizeM2: typeof raw.exactSizeM2 === 'number' && raw.exactSizeM2 >= 8 && raw.exactSizeM2 <= 2000 ? Math.round(raw.exactSizeM2) : null,
    rooms, roomsTouched: bool(raw.roomsTouched), floors: intn(raw.floors, 1, 1, 4), extraRooms: extra,
    adults: intn(raw.adults, 1, 1, 12), children: intn(raw.children, 0, 0, 12),
    pets: {
      choice, types: list(p.types, values(PET_TYPES)), count: intn(p.count, 1, 1, 3),
      access: list(p.access, ['indoor', 'outdoor'] as const).length ? list(p.access, ['indoor', 'outdoor'] as const) : ['indoor'],
      features: list(p.features, values(PET_FEATURES)),
    },
    cleanliness: oneOfOrNull(raw.cleanliness, values(CLEANLINESS)), problemAreas: list(raw.problemAreas, values(PROBLEM_AREAS)), problemOther: str(raw.problemOther, '', 60),
  };
};

const validatePrefs = (raw: unknown, c: Ctx): AppData['preferences'] => {
  const d = emptyPreferences();
  if (!isObj(raw)) { if (raw !== undefined) c.note('Preferences were unreadable and were reset.'); return d; }
  let focus = list(raw.focus, values(FOCUS_OPTIONS));
  if (!focus.length) {
    // Saves from before the life layer have no focus: they are the original home-cleaning app.
    focus = ['home'];
    if (raw.focus !== undefined && !(Array.isArray(raw.focus) && raw.focus.length === 0)) c.note('Your focus areas were unreadable, so cleaning was selected.');
  }
  return {
    style: oneOfOrNull(raw.style, values(STYLES)),
    sessionMinutes: typeof raw.sessionMinutes === 'number' && Number.isFinite(raw.sessionMinutes) ? intn(raw.sessionMinutes, 20, 5, 180) : null,
    daysPerWeek: typeof raw.daysPerWeek === 'number' && Number.isFinite(raw.daysPerWeek) ? intn(raw.daysPerWeek, 4, 1, 7) : null,
    daysTouched: bool(raw.daysTouched), energy: oneOfOrNull(raw.energy, values(ENERGY)), blockers: list(raw.blockers, values(BLOCKERS)), goals: list(raw.goals, values(GOALS)),
    learnedSessionCap: typeof raw.learnedSessionCap === 'number' && raw.learnedSessionCap > 0 ? intn(raw.learnedSessionCap, 15, 5, 90) : null,
    focus: focus as LifeFocus[], fitnessLevel: oneOf(raw.fitnessLevel, values(FITNESS_LEVELS), 'beginner'), equipment: oneOf(raw.equipment, values(EQUIPMENT_OPTIONS), 'none'),
    lifeLevel: intn(raw.lifeLevel, 1, 1, 3) as LifeLevel, levelSince: date(raw.levelSince),
  };
};

const validateTaskState = (raw: unknown): TaskState | null => {
  if (!isObj(raw)) return null;
  const s: TaskState = {};
  if (date(raw.anchor)) s.anchor = raw.anchor as ISODate;
  if (raw.due === null) s.due = null; else if (date(raw.due)) s.due = raw.due as ISODate;
  if (date(raw.lastDone)) s.lastDone = raw.lastDone as ISODate;
  if (typeof raw.doneCount === 'number') s.doneCount = intn(raw.doneCount, 0, 0, 1e6);
  if (typeof raw.skipStreak === 'number') s.skipStreak = intn(raw.skipStreak, 0, 0, 1e6);
  if (typeof raw.skipTotal === 'number') s.skipTotal = intn(raw.skipTotal, 0, 0, 1e6);
  if (raw.done === true) s.done = true;
  if (raw.hidden === true) s.hidden = true;
  if (isObj(raw.override)) {
    const o: NonNullable<TaskState['override']> = {};
    if (typeof raw.override.minutes === 'number') o.minutes = intn(raw.override.minutes, 5, 1, 480);
    if (typeof raw.override.frequency === 'string' && (FREQS as readonly string[]).includes(raw.override.frequency)) o.frequency = raw.override.frequency as Frequency;
    if (raw.override.smaller === true) o.smaller = true;
    if (Object.keys(o).length) s.override = o;
  }
  return s;
};

const validateEntry = (raw: unknown): SessionEntry | null => {
  if (!isObj(raw)) return null;
  const at = raw.at, dt = date(raw.date);
  if (typeof raw.id !== 'string' || typeof raw.taskId !== 'string' || !dt || typeof at !== 'string' || Number.isNaN(Date.parse(at))) return null;
  const outcome = oneOfOrNull(raw.outcome, OUTCOMES);
  if (!outcome) return null;
  const e: SessionEntry = {
    id: raw.id.slice(0, 60), at, date: dt, taskId: raw.taskId.slice(0, 120), name: str(raw.name, 'Task', 200),
    roomKind: oneOf(raw.roomKind, ROOM_KINDS, 'home'), roomName: str(raw.roomName, '', 80), category: str(raw.category, '', 60),
    plannedMinutes: num(raw.plannedMinutes, 0, 0, 1440), actualMinutes: num(raw.actualMinutes, 0, 0, 1440), outcome, via: oneOf(raw.via, VIAS, 'plan'),
  };
  const dom = oneOfOrNull(raw.domain, DOMAINS); if (dom) e.domain = dom;
  if (typeof raw.templateId === 'string') e.templateId = raw.templateId.slice(0, 80); else if (raw.templateId === null) e.templateId = null;
  if (raw.level === 1 || raw.level === 2 || raw.level === 3) e.level = raw.level;
  if (raw.difficulty === 1 || raw.difficulty === 2 || raw.difficulty === 3) e.difficulty = raw.difficulty;
  const inten = oneOfOrNull(raw.intensity, INTENSITIES); if (inten) e.intensity = inten;
  const tod = oneOfOrNull(raw.timeOfDay, TODS); if (tod) e.timeOfDay = tod;
  if (typeof raw.localHour === 'number') e.localHour = intn(raw.localHour, 0, 0, 23);
  if (typeof raw.tzOffsetMin === 'number') e.tzOffsetMin = intn(raw.tzOffsetMin, 0, -900, 900);
  const goals = list(raw.goals, values(FOCUS_OPTIONS)); if (goals.length) e.goals = goals as LifeFocus[];
  if (typeof raw.planVersion === 'string') e.planVersion = raw.planVersion.slice(0, 40);
  const en = oneOfOrNull(raw.energy, ENERGY_LEVELS); if (en) e.energy = en;
  if (raw.fromDue === null || date(raw.fromDue)) e.fromDue = (raw.fromDue as ISODate | null);
  if (raw.toDue === null || date(raw.toDue)) e.toDue = (raw.toDue as ISODate | null);
  return e;
};

const validateSessions = (raw: unknown, c: Ctx): CleaningSession[] => {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) { c.note('Your history list was unreadable and was reset.'); return []; }
  const out: CleaningSession[] = [];
  const seen = new Set<string>();
  let lost = 0;
  for (const s of raw.slice(0, MAX.sessions)) {
    if (!isObj(s) || !Array.isArray(s.entries)) { lost++; continue; }
    const entries: SessionEntry[] = [];
    for (const e of s.entries.slice(0, MAX.entriesPerSession)) {
      const v = validateEntry(e);
      if (!v || seen.has(v.id)) { lost++; continue; }
      seen.add(v.id); entries.push(v);
    }
    if (!entries.length) { if (Array.isArray(s.entries) && s.entries.length === 0) lost++; continue; }
    const first = entries[0], last = entries[entries.length - 1];
    out.push({ id: str(s.id, `s_${first.id}`, 60), date: date(s.date) ?? first.date, startedAt: isoStamp(s.startedAt, first.at), endedAt: isoStamp(s.endedAt, last.at), entries });
  }
  c.dropped += lost;
  if (lost) c.note(`${lost} unreadable history item${lost === 1 ? ' was' : 's were'} left out.`);
  return out;
};

const validateCustom = (raw: unknown, today: ISODate, c: Ctx): CustomTask[] => {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) { c.note('Your own tasks were unreadable and were reset.'); return []; }
  const out: CustomTask[] = [];
  const ids = new Set<string>();
  for (const t of raw.slice(0, MAX.customTasks)) {
    if (!isObj(t) || typeof t.id !== 'string' || !str(t.name).trim() || ids.has(t.id)) { c.dropped++; continue; }
    ids.add(t.id);
    out.push({
      id: t.id.slice(0, 60), domain: oneOf(t.domain, DOMAINS, 'home'), name: str(t.name, '', 80).trim(), roomId: str(t.roomId, 'other', 40),
      frequency: oneOf(t.frequency, FREQS.filter((f) => f !== 'deep'), 'once'), minutes: intn(t.minutes, 10, 1, 480), priority: oneOf(t.priority, PRIOS, 'MEDIUM'),
      notes: str(t.notes, '', 300), startDate: date(t.startDate) ?? today, createdAt: str(t.createdAt, today, 40),
    });
  }
  return out;
};

const validateSupplies = (raw: unknown): Supply[] => {
  if (!Array.isArray(raw)) return [];
  const out: Supply[] = [];
  for (const s of raw.slice(0, MAX.supplies)) {
    if (!isObj(s) || typeof s.id !== 'string' || !str(s.product).trim()) continue;
    const sup: Supply = {
      id: s.id.slice(0, 60), product: str(s.product, '', 80), category: oneOf(s.category, values(SUPPLY_CATEGORIES), 'other'),
      room: oneOf(s.room, [...ROOM_KINDS, 'any'] as const, 'any'), quantity: str(s.quantity, '', 40), notes: str(s.notes, '', 200),
    };
    if (Array.isArray(s.tools)) sup.tools = s.tools.filter((x): x is NonNullable<Supply['tools']>[number] => typeof x === 'string');
    out.push(sup);
  }
  return out;
};

const validateExposure = (raw: unknown): ExposureRecord | null => {
  if (!isObj(raw) || !date(raw.date) || !Array.isArray(raw.items)) return null;
  const items: ExposureItem[] = [];
  for (const i of raw.items.slice(0, 80)) {
    if (!isObj(i) || typeof i.taskId !== 'string') continue;
    const it: ExposureItem = {
      taskId: i.taskId.slice(0, 120), templateId: typeof i.templateId === 'string' ? i.templateId.slice(0, 80) : null, domain: oneOf(i.domain, DOMAINS, 'home'),
      minutes: num(i.minutes, 0, 0, 1440), difficulty: (i.difficulty === 2 || i.difficulty === 3 ? i.difficulty : 1), kind: oneOf(i.kind, ['focus', 'life', 'extra', 'catchUp'] as const, 'focus'),
    };
    if (i.level === 1 || i.level === 2 || i.level === 3) it.level = i.level;
    const inten = oneOfOrNull(i.intensity, INTENSITIES); if (inten) it.intensity = inten;
    const tod = oneOfOrNull(i.timeOfDay, TODS); if (tod) it.timeOfDay = tod;
    const goals = list(i.goals, values(FOCUS_OPTIONS)); if (goals.length) it.goals = goals as LifeFocus[];
    items.push(it);
  }
  return {
    date: raw.date as ISODate, recordedAt: isoStamp(raw.recordedAt, `${raw.date}T00:00:00.000Z`), planVersion: str(raw.planVersion, '', 40), activeDay: bool(raw.activeDay, true),
    energy: oneOf(raw.energy, ENERGY_LEVELS, 'ok'), tzOffsetMin: intn(raw.tzOffsetMin, 0, -900, 900), budgetMinutes: num(raw.budgetMinutes, 0, 0, 1440), items,
  };
};

const validatePlanVersion = (raw: unknown): PlanVersion | null => {
  if (!isObj(raw) || typeof raw.id !== 'string') return null;
  return {
    id: raw.id.slice(0, 40), at: isoStamp(raw.at, new Date(0).toISOString()), focus: list(raw.focus, values(FOCUS_OPTIONS)) as LifeFocus[],
    lifeLevel: intn(raw.lifeLevel, 1, 1, 3) as LifeLevel, fitnessLevel: oneOf(raw.fitnessLevel, values(FITNESS_LEVELS), 'beginner'),
    sessionMinutes: typeof raw.sessionMinutes === 'number' ? intn(raw.sessionMinutes, 20, 5, 180) : null, daysPerWeek: typeof raw.daysPerWeek === 'number' ? intn(raw.daysPerWeek, 4, 1, 7) : null,
  };
};

const validateRecEvent = (raw: unknown): RecommendationEvent | null => {
  if (!isObj(raw) || typeof raw.id !== 'string' || typeof raw.recommendationId !== 'string' || !date(raw.date)) return null;
  const kind = oneOfOrNull(raw.kind, ['shown', 'accepted', 'dismissed'] as const);
  if (!kind) return null;
  const ev: RecommendationEvent = {
    id: raw.id.slice(0, 80), at: isoStamp(raw.at, `${raw.date}T00:00:00.000Z`), date: raw.date as ISODate, localHour: intn(raw.localHour, 0, 0, 23), kind,
    recommendationId: raw.recommendationId.slice(0, 120), code: str(raw.code, 'unknown', 60), planVersion: str(raw.planVersion, '', 40),
  };
  if (isObj(raw.evidence)) {
    const e: Record<string, number | string> = {};
    for (const [k, v] of Object.entries(raw.evidence).slice(0, 12)) if (typeof v === 'number' || typeof v === 'string') e[k.slice(0, 40)] = typeof v === 'string' ? v.slice(0, 80) : v;
    ev.evidence = e;
  }
  if (typeof raw.action === 'string') ev.action = raw.action.slice(0, 40);
  return ev;
};

// ───────────────────────── migrations ─────────────────────────

type Raw = Record<string, unknown>;
/** Each migration upgrades the *shape* by one version. The validator then fills in anything still missing. */
const MIGRATIONS: Record<number, (d: Raw) => Raw> = {
  // v1 → v2: analytics foundation (exposures, energy log, plan versions, recommendation events) and `levelSince`.
  1: (d) => {
    const plan = isObj(d.plan) ? d.plan : {};
    const prefs = isObj(d.preferences) ? d.preferences : {};
    return {
      ...d, version: 2,
      preferences: { ...prefs, levelSince: prefs.levelSince ?? (date(plan.startDate) ?? null) },
      exposures: d.exposures ?? [], energyLog: d.energyLog ?? {}, planVersions: d.planVersions ?? [], recEvents: d.recEvents ?? [],
    };
  },
};

export const migrate = (raw: Raw): { raw: Raw; from: number } => {
  const found = typeof raw.version === 'number' && Number.isFinite(raw.version) ? Math.floor(raw.version) : 1;
  let cur = raw;
  for (let v = Math.max(1, found); v < SCHEMA_VERSION; v++) cur = (MIGRATIONS[v] ?? ((x) => x))(cur);
  return { raw: cur, from: found };
};

/** Does this look like CleanFlow data at all? Guards against replacing a real save with defaults because of an unrelated object. */
export const looksLikeAppData = (raw: unknown): raw is Raw =>
  isObj(raw) && ['home', 'preferences', 'sessions', 'taskStates', 'user', 'onboardingComplete', 'customTasks'].some((k) => k in raw);

/**
 * Validate and repair. Returns null only when the input is not recognisable as CleanFlow data.
 * `today` is injectable for tests.
 */
export const validateAppData = (input: unknown, today?: ISODate): ValidationResult | null => {
  if (!looksLikeAppData(input)) return null;
  const { raw, from } = migrate(input);
  const c = new Ctx();
  const base = emptyAppData(today);
  const t = today ?? base.plan.startDate;
  const user = isObj(raw.user) ? raw.user : {};
  const plan = isObj(raw.plan) ? raw.plan : {};
  const planStart = date(plan.startDate) ?? t;
  if (plan.startDate !== undefined && !date(plan.startDate)) c.note('Your plan start date was unreadable and was reset to today.');

  const states: Record<string, TaskState> = {};
  if (isObj(raw.taskStates)) {
    for (const [k, v] of Object.entries(raw.taskStates).slice(0, MAX.taskStates)) { const s = validateTaskState(v); if (s) states[k] = s; else c.dropped++; }
  } else if (raw.taskStates !== undefined) c.note('Your task settings were unreadable and were reset.');

  const resetRaw = raw.resetRun;
  const energyLog: AppData['energyLog'] = {};
  if (isObj(raw.energyLog)) for (const [k, v] of Object.entries(raw.energyLog).slice(0, 800)) if (isISODate(k) && (ENERGY_LEVELS as readonly unknown[]).includes(v)) energyLog[k] = v as AppData['energyLog'][string];
  const dismissed: Record<string, ISODate> = {};
  if (isObj(raw.dismissedInsights)) for (const [k, v] of Object.entries(raw.dismissedInsights).slice(0, 200)) if (date(v)) dismissed[k.slice(0, 120)] = v as ISODate;
  const energyDay = isObj(raw.dayEnergy) && date(raw.dayEnergy.date) && (ENERGY_LEVELS as readonly unknown[]).includes(raw.dayEnergy.level)
    ? { date: raw.dayEnergy.date as ISODate, level: raw.dayEnergy.level as 'low' | 'ok' | 'high' } : null;

  const prefs = validatePrefs(raw.preferences, c);
  if (!prefs.levelSince) prefs.levelSince = planStart;

  const data: AppData = {
    version: 2,
    user: { id: str(user.id, base.user.id, 60), name: str(user.name, '', 30), createdAt: isoStamp(user.createdAt, base.user.createdAt), demo: bool(user.demo) },
    home: validateHome(raw.home, c),
    preferences: prefs,
    onboardingComplete: bool(raw.onboardingComplete),
    plan: { startDate: planStart, resetCount: intn(plan.resetCount, 0, 0, 1e4) },
    taskStates: states,
    customTasks: validateCustom(raw.customTasks, t, c),
    sessions: validateSessions(raw.sessions, c),
    supplies: validateSupplies(raw.supplies),
    resetRun: isObj(resetRaw) && typeof resetRaw.startedAt === 'string'
      ? { startedAt: resetRaw.startedAt, doneIds: strList(resetRaw.doneIds, 400), ...(typeof resetRaw.finishedAt === 'string' ? { finishedAt: resetRaw.finishedAt } : {}) } : null,
    fiveRecent: strList(raw.fiveRecent, 8),
    dismissedInsights: dismissed,
    dayEnergy: energyDay,
    lastOpened: date(raw.lastOpened),
    exposures: (Array.isArray(raw.exposures) ? raw.exposures : []).map(validateExposure).filter((x): x is ExposureRecord => !!x).slice(-MAX.exposures),
    energyLog,
    planVersions: (Array.isArray(raw.planVersions) ? raw.planVersions : []).map(validatePlanVersion).filter((x): x is PlanVersion => !!x).slice(-MAX.planVersions),
    recEvents: (Array.isArray(raw.recEvents) ? raw.recEvents : []).map(validateRecEvent).filter((x): x is RecommendationEvent => !!x).slice(-MAX.recEvents),
  };
  const found = from;
  const fromFuture = found > SCHEMA_VERSION;
  if (fromFuture) c.note('This data was saved by a newer version of CleanFlow. It was opened as far as this version understands it, and a copy was kept.');
  return { data, repairs: c.repairs, dropped: c.dropped, foundVersion: found, fromFuture };
};

/** A short, human summary used by the import confirmation. */
export const summarize = (d: AppData): { entries: number; days: number; focus: number; tasks: number; name: string } => {
  const entries = d.sessions.reduce((n, s) => n + s.entries.length, 0);
  return { entries, days: new Set(d.sessions.map((s) => s.date)).size, focus: d.preferences.focus.length, tasks: d.customTasks.length, name: d.user.name };
};

/** Does this data hold anything worth protecting before it gets replaced? */
export const hasUserData = (d: AppData): boolean => d.onboardingComplete || d.sessions.length > 0 || d.customTasks.length > 0;

