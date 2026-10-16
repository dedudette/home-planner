import { addDays } from './dates';
import { emptyRemoved, thinHistory, totalRemoved, trimDates, trimOtherBefore, type OtherRemoved } from './thinning';
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
  /** Detail that was thinned (totals kept). */
  thinned: { waterDays: number; exerciseDetails: number };
  /** Other history that went with the oldest days. */
  removedOther: OtherRemoved;
}

const entryCount = (ss: CleaningSession[]) => ss.reduce((n, s) => n + s.entries.length, 0);

const none = (data: AppData, total: number): Compaction => ({
  data, removedSessions: 0, removedEntries: 0, removedThrough: null, oldestKept: data.sessions[0]?.date ?? null, chars: total, thinned: { waterDays: 0, exerciseDetails: 0 }, removedOther: emptyRemoved(),
});

/**
 * Make room, in the gentlest order, and say what was done. Pure: the same data and target give the same result, so replaying it onto a
 * merged state is safe, and running it again on its own result does nothing.
 *
 *   1. thin   old water becomes one total per day and old workout records lose their exercise-by-exercise list (see thinning.ts).
 *   2. trim   if that is not enough, the oldest days of history go, in every kind of history at once, so the record starts on one
 *             date everywhere. The newest day is always kept.
 *
 * What the person wrote is never removed: the journal, their own dishes, workouts, interests, books and links, and every setting.
 */
export const compactHistory = (data: AppData, target = TARGET_CHARS, at = new Date().toISOString()): Compaction => {
  const total = serializedSize(data);
  if (total <= target) return none(data, total);
  const today = at.slice(0, 10);
  const thin = thinHistory(data, today);
  const thinned = { waterDays: thin.waterDays, exerciseDetails: thin.exerciseDetails };
  const work = thin.data;
  const limit = target - NOTE_MARGIN;
  const wasThinned = thinned.waterDays + thinned.exerciseDetails > 0;
  const sessionsSorted = [...work.sessions].sort((a, b) => (a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : 0));
  const base: AppData = { ...work, sessions: sessionsSorted };
  const finish = (next: AppData, removedSessions: CleaningSession[], removedOther: OtherRemoved, horizon: ISODate | null): Compaction => {
    const kept = next.sessions;
    const removedThrough = removedSessions.length ? removedSessions.reduce((m, x) => (x.date > m ? x.date : m), removedSessions[0].date) : horizon ? addDays(horizon, -1) : null;
    const oldestKept = kept[0]?.date ?? horizon ?? null;
    const gone = removedSessions.length > 0 || totalRemoved(removedOther) > 0;
    if (!gone && !wasThinned) return none(data, total);
    const note: RetentionNote = {
      at, removedSessions: removedSessions.length, removedEntries: entryCount(removedSessions), removedThrough: removedThrough ?? (oldestKept ? addDays(oldestKept, -1) : today), oldestKept: oldestKept ?? today,
      ...(wasThinned ? { thinned } : {}), ...(totalRemoved(removedOther) > 0 ? { removedOther } : {}),
    };
    const out: AppData = { ...next, retention: [...next.retention, note].slice(-MAX_NOTES) };
    return { data: out, removedSessions: removedSessions.length, removedEntries: note.removedEntries, removedThrough: gone ? removedThrough : null, oldestKept, chars: serializedSize(out), thinned, removedOther };
  };

  // Thinning alone may be enough.
  if (serializedSize(base) <= limit) return finish(wasThinned ? work : data, [], emptyRemoved(), null);

  const cutAt = (horizon: ISODate) => {
    const kept = base.sessions.filter((s) => s.date >= horizon);
    const o = trimOtherBefore({ ...base, sessions: kept }, horizon);
    return { data: o.data, removed: o.removed, gone: base.sessions.filter((s) => s.date < horizon) };
  };
  const dates = trimDates(base);
  if (dates.length === 0) return finish(wasThinned ? work : data, [], emptyRemoved(), null);
  // The newest day of sessions is always kept (the newest day of anything, if there are no sessions).
  const newest = base.sessions.length ? base.sessions[base.sessions.length - 1].date : dates[dates.length - 1];
  let hi = dates.lastIndexOf(newest);
  if (hi < 0) hi = dates.length - 1;
  let lo = 0;
  // The smallest cut that fits. Size only shrinks as the cut moves later, so this is a plain binary search.
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (serializedSize(cutAt(dates[mid]).data) <= limit) hi = mid; else lo = mid + 1;
  }
  const horizon = dates[lo];
  if (lo === 0) return finish(wasThinned ? work : data, [], emptyRemoved(), null);
  const cut = cutAt(horizon);
  return finish({ ...cut.data, sessions: cut.data.sessions }, cut.gone, cut.removed, horizon);
};

/** A plain-English line for a retention note, shown wherever the history is described. */
export const describeRetention = (n: RetentionNote): string => {
  const parts: string[] = [];
  if (n.removedEntries > 0) parts.push(`${n.removedEntries} older ${n.removedEntries === 1 ? 'entry' : 'entries'} (up to ${n.removedThrough}) ${n.removedEntries === 1 ? 'was' : 'were'} removed to keep saving working`);
  const o = n.removedOther;
  if (o) {
    const bits = [o.meals && `${o.meals} planned or eaten ${o.meals === 1 ? 'meal' : 'meals'}`, o.workouts && `${o.workouts} workout ${o.workouts === 1 ? 'record' : 'records'}`, o.water && `${o.water} water ${o.water === 1 ? 'entry' : 'entries'}`, o.hobbySessions && `${o.hobbySessions} hobby ${o.hobbySessions === 1 ? 'session' : 'sessions'}`, o.checkins && `${o.checkins} ${o.checkins === 1 ? 'check-in' : 'check-ins'}`, o.shoppingLists && `${o.shoppingLists} shopping ${o.shoppingLists === 1 ? 'list' : 'lists'}`].filter(Boolean);
    if (bits.length) parts.push(`${n.removedEntries > 0 ? 'along with ' : 'Removed with the oldest days: '}${bits.join(', ')}`);
  }
  const t = n.thinned;
  if (t) {
    const bits = [t.waterDays && `old water was kept as one total per day (${t.waterDays} ${t.waterDays === 1 ? 'day' : 'days'})`, t.exerciseDetails && `old workouts lost their exercise-by-exercise list (${t.exerciseDetails})`].filter(Boolean);
    if (bits.length) parts.push(`${parts.length ? 'and ' : 'To save room, '}${bits.join(' and ')}`);
  }
  const body = parts.join(', ') || 'Some old detail was reduced to keep saving working';
  return `${body.charAt(0).toUpperCase()}${body.slice(1)}. ${n.removedEntries > 0 || o ? `Your history starts ${n.oldestKept}. ` : ''}Your journal, your own recipes, workouts and interests, and your settings were not touched.`;
};
