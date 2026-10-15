import { clockMinutes, defaultModulesFor, isClock } from '../domain/modules/registry';
import {
  ACTIVITY_MODULES, MODULE_IDS, TODAY_CARDS, type ActivityKind, type ActivityRef, type ActivitySchedule, type ActivityModule, type ModulesState, type PlannedActivity, type TodayCard,
} from '../domain/modules/types';
import type { ISODate, LifeFocus } from '../domain/types';
import { bool, Ctx, date, intn, isObj, isoStamp, keepFirst, list, oneOf, oneOfOrNull, str } from './primitives';

/**
 * Validation for the data added in schema v3. Same principles as schema.ts: never throw, repair what can be understood, count and
 * report what cannot, and never invent history.
 */

export const MAX_MODULE = { activities: 400 };

const KINDS: readonly ActivityKind[] = ['fixed', 'flexible', 'optional'];
const REF_KINDS: readonly ActivityRef['kind'][] = ['workout', 'recipe', 'interest', 'routine', 'none'];
const INTENSITIES = ['gentle', 'moderate', 'vigorous'] as const;

export const validateModules = (raw: unknown, legacyFocus: readonly LifeFocus[], c: Ctx): ModulesState => {
  if (!isObj(raw)) {
    // A save from before sections existed. Turn on only what a goal they already chose clearly points at, and show the introduction once.
    if (raw !== undefined) c.note('Your section settings were unreadable and were set from your goals.');
    return defaultModulesFor(legacyFocus.length ? legacyFocus : ['home'], false);
  }
  const en = isObj(raw.enabled) ? raw.enabled : {};
  const enabled = Object.fromEntries(MODULE_IDS.map((id) => [id, bool(en[id], false)])) as ModulesState['enabled'];
  const seen = new Set<TodayCard>();
  const order: TodayCard[] = [];
  for (const x of Array.isArray(raw.order) ? raw.order : []) if (typeof x === 'string' && (TODAY_CARDS as readonly string[]).includes(x) && !seen.has(x as TodayCard)) { seen.add(x as TodayCard); order.push(x as TodayCard); }
  for (const x of TODAY_CARDS) if (!seen.has(x)) order.push(x);
  const hidden = list(raw.hidden, TODAY_CARDS).filter((x) => x !== 'plan');
  const caps: ModulesState['caps'] = {};
  if (isObj(raw.caps)) for (const m of ACTIVITY_MODULES) { const v = raw.caps[m]; if (typeof v === 'number' && Number.isFinite(v) && v >= 5) caps[m] = intn(v, 30, 5, 600); }
  return { enabled, order, hidden, caps, introSeen: bool(raw.introSeen, true) };
};

const validateSchedule = (raw: unknown, fallbackDate: ISODate): ActivitySchedule => {
  if (isObj(raw) && raw.kind === 'weekly' && Array.isArray(raw.weekdays)) {
    const days = [...new Set(raw.weekdays.filter((d): d is number => typeof d === 'number' && Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b);
    if (days.length) return { kind: 'weekly', weekdays: days };
  }
  if (isObj(raw) && raw.kind === 'once' && date(raw.date)) return { kind: 'once', date: raw.date as ISODate };
  // A schedule that cannot be read is not guessed at as "every day": the activity becomes a one-off on its start date.
  return { kind: 'once', date: fallbackDate };
};

export const validateActivities = (raw: unknown, today: ISODate, c: Ctx): PlannedActivity[] => {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) { c.note('Your planned activities were unreadable and were reset.'); return []; }
  const out: PlannedActivity[] = [];
  const ids = new Set<string>();
  for (const a of keepFirst(raw, MAX_MODULE.activities, c, 'planned activities')) {
    const module = isObj(a) ? oneOfOrNull(a.module, ACTIVITY_MODULES) : null;
    if (!isObj(a) || typeof a.id !== 'string' || !module || !str(a.name).trim() || ids.has(a.id)) { c.dropped++; continue; }
    ids.add(a.id);
    const startDate = date(a.startDate) ?? today;
    const time = isClock(a.time) ? a.time : null;
    let kind = oneOf(a.kind, KINDS, 'flexible');
    // A fixed activity is defined by its clock time. Without one it cannot be fixed, so it is kept as a flexible one.
    if (kind === 'fixed' && !time) kind = 'flexible';
    const refKind = isObj(a.ref) ? oneOfOrNull(a.ref.kind, REF_KINDS) : null;
    out.push({
      id: a.id.slice(0, 60), module: module as ActivityModule, kind, name: str(a.name, '', 80).trim(), minutes: intn(a.minutes, 15, 1, 480),
      schedule: validateSchedule(a.schedule, startDate), time, startDate, endDate: date(a.endDate),
      ref: refKind && isObj(a.ref) && typeof a.ref.id === 'string' ? { kind: refKind, id: a.ref.id.slice(0, 80) } : null,
      intensity: oneOf(a.intensity, INTENSITIES, 'gentle'), difficulty: intn(a.difficulty, 1, 1, 3) as 1 | 2 | 3,
      note: str(a.note, '', 300), createdAt: isoStamp(a.createdAt, `${startDate}T00:00:00.000Z`), archived: bool(a.archived),
    });
  }
  return out;
};

export { clockMinutes };
