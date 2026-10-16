import { addDays } from '../dates';
import type { AppData, ISODate } from '../types';
import type { Book, Interest, InterestSession } from './types';

/**
 * What was actually logged for learning and hobbies. Minutes always come from the one log entry the app keeps: a hobby session points
 * at its entry, and a planned activity linked to an interest is that interest's own entry, so nothing is counted twice and nothing is
 * counted that was not written down.
 */
const entriesById = (d: Pick<AppData, 'sessions'>) => new Map(d.sessions.flatMap((s) => s.entries).map((e) => [e.id, e]));

export interface InterestMinutes { minutes: number; sessions: number; days: number }

export const interestMinutes = (d: Pick<AppData, 'sessions' | 'interests' | 'activities'>, interestId: string | null, from: ISODate, to: ISODate): InterestMinutes => {
  const byId = entriesById(d);
  const seen = new Set<string>();
  let minutes = 0;
  const days = new Set<string>();
  const add = (entryId: string) => {
    if (seen.has(entryId)) return;
    const e = byId.get(entryId);
    if (!e || e.date < from || e.date > to || e.outcome === 'skipped') return;
    seen.add(entryId);
    minutes += e.actualMinutes;
    days.add(e.date);
  };
  for (const s of d.interests.sessions) if (interestId === null || s.interestId === interestId) add(s.entryId);
  // Completions of planned activities that point at an interest (they have no session record unless the person added one).
  const linked = new Set(d.activities.filter((a) => a.module === 'learning' && a.ref?.kind === 'interest' && (interestId === null || a.ref.id === interestId)).map((a) => `act:${a.id}`));
  if (linked.size) for (const e of byId.values()) if (linked.has(e.taskId)) add(e.id);
  return { minutes, sessions: seen.size, days: days.size };
};

export const lastSession = (d: Pick<AppData, 'interests'>, interestId: string): InterestSession | null => {
  const xs = d.interests.sessions.filter((s) => s.interestId === interestId);
  return xs.length ? xs[xs.length - 1] : null;
};

/** The last four weeks, for a quiet "this much, lately" line. Nothing logged reads as "nothing logged", not as zero effort. */
export const recent = (d: Pick<AppData, 'sessions' | 'interests' | 'activities'>, interestId: string | null, today: ISODate): InterestMinutes => interestMinutes(d, interestId, addDays(today, -27), today);

export const bookProgress = (b: Book): number | null => (b.pagesTotal && b.pagesTotal > 0 && b.pagesRead !== null ? Math.min(100, Math.round((b.pagesRead / b.pagesTotal) * 100)) : null);

export const READING_ID = 'reading';
/** The person's reading interest, if they have one. Reading sessions are logged against it. */
export const readingInterest = (d: Pick<AppData, 'interests'>): Interest | undefined => d.interests.items.find((i) => i.catalogId === READING_ID && i.status !== 'not-for-me');
