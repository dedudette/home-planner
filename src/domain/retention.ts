import type { AppData, CleaningSession, ISODate, RetentionNote } from './types';

/**
 * How much history the app keeps, and how it lets go of the rest.
 *
 * Browser storage is about 5 million characters per site (measured at 5.00 M in Chromium; other browsers are similar or smaller),
 * shared by the saved data, up to three safety backups, and the timer. Real history grows by roughly 500 characters per logged
 * action (about 1.2 M a year at a busy pace), so the limit is reached after a few years of daily use. Counting entries would hide
 * that: what matters is characters.
 *
 * A safety backup stores the data as an escaped string, about 12% bigger than the data. So the numbers are chosen to keep one full
 * backup possible: 1.9 M of data + 2.1 M of backup fit in 5 M with room to spare; 3.0 M of data does not, and at that point saving
 * itself is within a year of failing.
 *
 *   SOFT   Settings starts suggesting a download. Nothing is removed.
 *   HARD   The app asks to compact: it offers a full download first, then keeps the NEWEST history and removes the oldest, because
 *          recent behaviour is what any future analysis needs most.
 *   TARGET Where compaction aims: a full backup fits again, and there is a year or more of growth before the next question.
 *
 * Nothing is ever dropped silently: compaction leaves a `RetentionNote` in the data itself (so any later analysis knows the history
 * starts at a certain date) and the person is told at the time.
 */
export const SOFT_CHARS = 2_200_000;
export const HARD_CHARS = 3_000_000;
export const TARGET_CHARS = 1_900_000;
/** Room kept for the note that compaction itself adds. */
const NOTE_MARGIN = 1_000;
/** Notes older than the newest few add nothing; this just keeps the list bounded. */
export const MAX_NOTES = 20;

export type StorageLevel = 'ok' | 'large' | 'full';

export const storageLevel = (chars: number): StorageLevel => (chars >= HARD_CHARS ? 'full' : chars >= SOFT_CHARS ? 'large' : 'ok');

export const serializedSize = (d: AppData): number => JSON.stringify(d).length;

export interface Compaction {
  data: AppData;
  removedSessions: number;
  removedEntries: number;
  /** Everything on or before this date was removed. */
  removedThrough: ISODate | null;
  /** The oldest date that is still there. */
  oldestKept: ISODate | null;
  chars: number;
}

const entryCount = (ss: CleaningSession[]) => ss.reduce((n, s) => n + s.entries.length, 0);

/**
 * Keep the newest sessions that fit in `target` characters (the rest of the data counts too), always at least the newest one.
 * Pure: the same data and target give the same result, so replaying it onto a merged state is safe.
 */
export const compactHistory = (data: AppData, target = TARGET_CHARS, at = new Date().toISOString()): Compaction => {
  const total = serializedSize(data);
  if (total <= target || data.sessions.length <= 1) {
    return { data, removedSessions: 0, removedEntries: 0, removedThrough: null, oldestKept: data.sessions[0]?.date ?? null, chars: total };
  }
  const sessions = [...data.sessions].sort((a, b) => (a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : 0));
  const room = target - serializedSize({ ...data, sessions: [] }) - NOTE_MARGIN;
  let used = 0;
  let keepFrom = sessions.length - 1;
  for (let i = sessions.length - 1; i >= 0; i--) {
    used += JSON.stringify(sessions[i]).length + 1;
    if (used > room && i < sessions.length - 1) break;
    keepFrom = i;
  }
  const kept = sessions.slice(keepFrom);
  const removed = sessions.slice(0, keepFrom);
  if (!removed.length) return { data, removedSessions: 0, removedEntries: 0, removedThrough: null, oldestKept: kept[0]?.date ?? null, chars: total };
  const removedThrough = removed.reduce((m, s) => (s.date > m ? s.date : m), removed[0].date);
  const note: RetentionNote = {
    at, removedSessions: removed.length, removedEntries: entryCount(removed), removedThrough, oldestKept: kept[0].date,
  };
  const next: AppData = { ...data, sessions: kept, retention: [...data.retention, note].slice(-MAX_NOTES) };
  return { data: next, removedSessions: removed.length, removedEntries: note.removedEntries, removedThrough, oldestKept: kept[0].date, chars: serializedSize(next) };
};

/** A plain-English line for a retention note, shown wherever the history is described. */
export const describeRetention = (n: RetentionNote): string =>
  `${n.removedEntries} older ${n.removedEntries === 1 ? 'entry' : 'entries'} (up to ${n.removedThrough}) ${n.removedEntries === 1 ? 'was' : 'were'} removed to keep saving working. Your history starts ${n.oldestKept}.`;
