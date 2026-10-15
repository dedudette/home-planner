import { addDays } from '../dates';
import { activityHistory } from '../modules/activities';
import type { PlannedActivity } from '../modules/types';
import type { AppData, ISODate } from '../types';
import type { ReminderOccurrence, ReminderPrefs, Suppressed } from './types';

/**
 * Which reminders exist, worked out from the plan every time it is asked. There is no stored list to fall out of step: an activity that
 * is done, skipped, moved, archived or deleted simply stops being a "scheduled" occurrence, and whatever was set up for it is
 * cancelled by comparing what should exist with what does (`diffSchedule`).
 */
export const HORIZON_DAYS = 7;
const MAX = 120;

export const clockMinutes = (hhmm: string): number | null => {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  return h <= 23 && mi <= 59 ? h * 60 + mi : null;
};

/** A local wall-clock time on a date, minus some minutes, as an instant. A time the clocks skip (spring forward) lands an hour later. */
export const localInstant = (date: ISODate, hhmm: string, minusMinutes = 0): Date => {
  const [y, mo, d] = date.split('-').map(Number);
  const m = clockMinutes(hhmm) ?? 0;
  return new Date(y, mo - 1, d, 0, m - minusMinutes, 0, 0);
};

/** Is a local time of day inside the quiet window? A window that crosses midnight (22:00 to 07:00) is handled. */
export const inQuietHours = (minutesOfDay: number, q: ReminderPrefs['quiet']): boolean => {
  if (!q.on) return false;
  const from = clockMinutes(q.from), to = clockMinutes(q.to);
  if (from === null || to === null || from === to) return false;
  return from < to ? minutesOfDay >= from && minutesOfDay < to : minutesOfDay >= from || minutesOfDay < to;
};

const hash = (s: string): number => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0) % 2147483647; };

export const occurrenceKey = (activityId: string, date: ISODate): string => `${activityId}@${date}`;

/** Lead time for one activity: its own, or the default. Null when it has asked for none. */
export const leadFor = (a: PlannedActivity, prefs: ReminderPrefs): number | null => (a.remind === 'off' ? null : typeof a.remind === 'number' ? a.remind : prefs.leadMinutes);

/**
 * Every occurrence in the next `horizonDays` days, each with whether it will be sent and, if not, why. Returns nothing while reminders
 * are switched off. Stable ids: the same occurrence always gets the same notification number.
 */
export const planReminders = (d: AppData, now: Date, horizonDays = HORIZON_DAYS, today?: ISODate): ReminderOccurrence[] => {
  const prefs = d.reminders.prefs;
  if (!prefs.enabled) return [];
  const t0 = today ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const end = addDays(t0, horizonDays);
  const out: ReminderOccurrence[] = [];
  const used = new Set<number>();
  for (const a of d.activities) {
    if (a.archived) continue;
    for (const occ of activityHistory(d, a, t0, end, t0)) {
      if (occ.state !== 'scheduled') continue; // done, skipped or moved: nothing to remind about
      const key = occurrenceKey(a.id, occ.date);
      const snoozedTo = d.reminders.snoozed[key];
      const lead = leadFor(a, prefs);
      let why: Suppressed | null = null;
      let at = a.time ? localInstant(occ.date, a.time, lead ?? 0) : null;
      if (a.remind === 'off') why = 'off';
      else if (!a.time) why = 'no-time';
      else if (typeof a.remind !== 'number' && !prefs.modules[a.module]) why = 'section-off';
      // "Remind me again" is the person's own choice, so it stands even where the section's default is off. It moves this occurrence's
      // reminder to the snoozed time, which then comes due (and is shown once) like any other.
      const again = snoozedTo ? Date.parse(snoozedTo) : Number.NaN;
      if (a.time && a.remind !== 'off' && !Number.isNaN(again) && at && again > at.getTime()) { at = new Date(again); why = null; }
      if (!why && at && inQuietHours(at.getHours() * 60 + at.getMinutes(), prefs.quiet)) why = 'quiet-hours';
      if (!why && at && at.getTime() <= now.getTime()) why = 'past';
      let nid = hash(key);
      while (used.has(nid)) nid = (nid + 1) % 2147483647;
      used.add(nid);
      out.push({
        key, nid, activityId: a.id, date: occ.date, at: (at ?? localInstant(occ.date, a.time ?? '00:00')).toISOString(), time: a.time ?? '', title: a.name,
        body: a.time ? `Planned for ${a.time}${a.minutes ? ` · ${a.minutes} min` : ''}` : '', suppressed: why,
      });
      if (out.length >= MAX) return out.sort((x, y) => x.at.localeCompare(y.at));
    }
  }
  return out.sort((x, y) => x.at.localeCompare(y.at));
};

/** The ones that will actually be sent. */
export const outgoing = (xs: ReminderOccurrence[]): ReminderOccurrence[] => xs.filter((x) => x.suppressed === null);

export interface ScheduledRecord { key: string; at: string }

/**
 * What to change on the device so it matches the plan: set up what is missing or moved, and cancel what no longer belongs (done, moved,
 * archived, deleted, turned off, now in quiet hours). Running it twice in a row does nothing the second time.
 */
export const diffSchedule = (desired: ReminderOccurrence[], scheduled: Record<number, ScheduledRecord>): { add: ReminderOccurrence[]; remove: number[] } => {
  const want = new Map(desired.map((x) => [x.nid, x]));
  const add = desired.filter((x) => { const s = scheduled[x.nid]; return !s || s.key !== x.key || s.at !== x.at; });
  const remove = Object.keys(scheduled).map(Number).filter((id) => !want.has(id));
  return { add, remove };
};

/** Drops "remind me again" times that have passed, so the list does not grow. */
export const pruneSnoozed = (snoozed: Record<string, string>, now: Date): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(snoozed)) if (Date.parse(v) > now.getTime() - 24 * 3600 * 1000) out[k] = v;
  return out;
};

/**
 * In-app: reminders whose time came in the last `windowMinutes` minutes and that have not been shown yet. `shown` holds, per occurrence,
 * the time of the reminder that was last shown, so a snoozed reminder (a later time) is due again when that later time comes. The app uses this while it is
 * open, where it can say so itself, whether or not the browser or phone is allowed to show a notification.
 */
export const dueNow = (plan: ReminderOccurrence[], shown: Record<string, string>, now: Date, windowMinutes = 90): ReminderOccurrence[] =>
  plan.filter((x) => { const t = Date.parse(x.at); return x.suppressed === 'past' && (shown[x.key] ?? '') < x.at && t <= now.getTime() && now.getTime() - t < windowMinutes * 60 * 1000; });
