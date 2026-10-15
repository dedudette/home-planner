import type { ActivityModule } from '../modules/types';
import type { ISODate } from '../types';

/**
 * Reminders for what the person planned. Four different things are kept apart on purpose, and the app says which one it is making:
 *   a notification   a message from this app (or from the browser while the app is open). It can be snoozed, and it is cancelled when
 *                    the activity is done, moved, archived or deleted.
 *   a calendar event an entry in the person's calendar app, made by downloading a file. After that it belongs to the calendar, and
 *                    the app can no longer change or cancel it.
 *   an Apple Reminder  an item in the Reminders app. Not made by this app (see docs/native-integrations.md).
 *   an alarm         a clock alarm that rings through silent mode. Not made by this app.
 *
 * A reminder is never a thing of its own: it is derived each time from the plan, one per occurrence (this activity on this day), so
 * there is nothing to forget to delete.
 */
export interface QuietHours { on: boolean; /** 'HH:MM' */ from: string; /** 'HH:MM' */ to: string }

export interface ReminderPrefs {
  /** The master switch. Off until the person turns it on. */
  enabled: boolean;
  /** Minutes before the planned time. 0 means at the time. */
  leadMinutes: number;
  quiet: QuietHours;
  snoozeMinutes: number;
  /** Which sections remind by default. An individual activity can still say otherwise. */
  modules: Record<ActivityModule, boolean>;
}

export interface RemindersData {
  prefs: ReminderPrefs;
  /** "Remind me again" for one occurrence: its key and when. Old ones are dropped when they pass. */
  snoozed: Record<string, string>;
  /** Occurrences the person already saw a reminder for in this app, so a reminder is shown once. */
  shown: Record<string, string>;
}

/** What to do about an activity's reminder: follow the defaults, turn it off, or a lead time of its own (minutes before, 0-180). */
export type ActivityReminder = 'off' | number;

export type Suppressed = 'off' | 'no-time' | 'quiet-hours' | 'past' | 'section-off';

/** One reminder: this activity, on this day. */
export interface ReminderOccurrence {
  /** `${activityId}@${date}` */
  key: string;
  /** A stable whole number for the platform's notification id. */
  nid: number;
  activityId: string;
  date: ISODate;
  /** When it should fire, as an ISO instant. */
  at: string;
  /** The planned time of day, 'HH:MM'. */
  time: string;
  title: string;
  body: string;
  /** Null when it will be sent. */
  suppressed: Suppressed | null;
}
