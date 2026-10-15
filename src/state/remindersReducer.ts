import { emptyReminders } from '../domain/reminders/defaults';
import { pruneSnoozed } from '../domain/reminders/plan';
import type { ReminderPrefs } from '../domain/reminders/types';
import type { AppData } from '../domain/types';
import { validateReminders } from '../storage/remindersSchema';
import { Ctx } from '../storage/primitives';

export type RemindersAction =
  | { type: 'REMINDER_PREFS'; patch: Partial<Omit<ReminderPrefs, 'quiet' | 'modules'>> & { quiet?: Partial<ReminderPrefs['quiet']>; modules?: Partial<ReminderPrefs['modules']> } }
  | { type: 'REMINDER_SNOOZE'; key: string; until: string }
  | { type: 'REMINDER_SHOWN'; key: string; at: string }
  | { type: 'REMINDER_TIDY'; now: string };

const revalidate = (next: AppData['reminders']): AppData['reminders'] => validateReminders(next, new Ctx());

/** Reminder settings. Every change is re-checked, so a bad value can never be stored; an unchanged value changes nothing. */
export const remindersReducer = (d: AppData, a: RemindersAction): AppData => {
  const cur = d.reminders ?? emptyReminders();
  switch (a.type) {
    case 'REMINDER_PREFS': {
      const p = a.patch;
      const next = revalidate({ ...cur, prefs: { ...cur.prefs, ...p, quiet: { ...cur.prefs.quiet, ...(p.quiet ?? {}) }, modules: { ...cur.prefs.modules, ...(p.modules ?? {}) } } });
      return JSON.stringify(next.prefs) === JSON.stringify(cur.prefs) ? d : { ...d, reminders: next };
    }
    case 'REMINDER_SNOOZE': {
      if (cur.snoozed[a.key] === a.until) return d;
      return { ...d, reminders: revalidate({ ...cur, snoozed: { ...cur.snoozed, [a.key]: a.until } }) };
    }
    case 'REMINDER_SHOWN': {
      if ((cur.shown[a.key] ?? '') >= a.at) return d;
      return { ...d, reminders: revalidate({ ...cur, shown: { ...cur.shown, [a.key]: a.at } }) };
    }
    case 'REMINDER_TIDY': {
      const now = new Date(a.now);
      const snoozed = pruneSnoozed(cur.snoozed, now);
      const shown = pruneSnoozed(cur.shown, now);
      return Object.keys(snoozed).length === Object.keys(cur.snoozed).length && Object.keys(shown).length === Object.keys(cur.shown).length ? d : { ...d, reminders: { ...cur, snoozed, shown } };
    }
    default: return d;
  }
};
