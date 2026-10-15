import { emptyReminders } from '../domain/reminders/defaults';
import type { RemindersData } from '../domain/reminders/types';
import { clockMinutes } from '../domain/reminders/plan';
import { bool, Ctx, intn, isObj } from './primitives';

/** Validation for reminder settings (schema v3). Times are checked, numbers clamped, and "snoozed" and "shown" are bounded and rebuilt. */
export const MAX_REMINDER_KEYS = { snoozed: 200, shown: 400 };
const KEY = /^[A-Za-z0-9_-]{1,60}@\d{4}-\d{2}-\d{2}$/;
const clock = (v: unknown, d: string): string => (typeof v === 'string' && clockMinutes(v) !== null ? v : d);

const stamps = (raw: unknown, max: number): Record<string, string> => {
  const out: Record<string, string> = {};
  if (!isObj(raw)) return out;
  for (const [k, v] of Object.entries(raw).slice(-max)) if (KEY.test(k) && typeof v === 'string' && !Number.isNaN(Date.parse(v))) out[k] = v;
  return out;
};

export const validateReminders = (raw: unknown, c: Ctx): RemindersData => {
  const d = emptyReminders();
  if (raw === undefined) return d;
  if (!isObj(raw)) { c.note('Your reminder settings were unreadable and were reset.'); return d; }
  const p = isObj(raw.prefs) ? raw.prefs : {};
  const q = isObj(p.quiet) ? p.quiet : {};
  const m = isObj(p.modules) ? p.modules : {};
  return {
    prefs: {
      enabled: bool(p.enabled, false), leadMinutes: intn(p.leadMinutes, d.prefs.leadMinutes, 0, 180), snoozeMinutes: intn(p.snoozeMinutes, d.prefs.snoozeMinutes, 1, 120),
      quiet: { on: bool(q.on, d.prefs.quiet.on), from: clock(q.from, d.prefs.quiet.from), to: clock(q.to, d.prefs.quiet.to) },
      modules: { movement: bool(m.movement, true), meals: bool(m.meals, true), learning: bool(m.learning, true), wellbeing: bool(m.wellbeing, true) },
    },
    snoozed: stamps(raw.snoozed, MAX_REMINDER_KEYS.snoozed),
    shown: stamps(raw.shown, MAX_REMINDER_KEYS.shown),
  };
};

/** An activity's own reminder choice: 'off', a lead time in minutes (0-180), or nothing (follow the defaults). */
export const validateRemind = (v: unknown): 'off' | number | undefined => (v === 'off' ? 'off' : typeof v === 'number' && Number.isFinite(v) ? intn(v, 10, 0, 180) : undefined);
