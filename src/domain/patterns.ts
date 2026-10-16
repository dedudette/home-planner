import { dayStatus, historyKnownFrom, MIN_PATTERN_DAYS, summarizeWindow, type UnknownWhy } from './behaviour';
import { addDays, daysInRange } from './dates';
import type { AppData, ISODate } from './types';

/**
 * "Your patterns": a read-only summary of what the app recorded over a recent window.
 *
 * It adds no model of its own. Every number comes from `summarizeWindow` / `dayStatus` in behaviour.ts, which is the one place that
 * decides what seen, no action, not opened and unknown mean. What this file adds is only the choice of window, the grouping for
 * display, and the rule for when there is too little known to say anything.
 *
 *  - Counts cover days that have a display record (contract 2). Days recorded before display tracking are counted apart, as unknown.
 *  - "Seen with no recorded action" is the absence of an entry. It is not a skip, a failure, or anything about the person.
 *  - Days whose history was removed to save space are counted apart and never read as quiet.
 */

export const PATTERN_WINDOWS = [7, 14, 28] as const;
export type PatternWindow = (typeof PATTERN_WINDOWS)[number];

export type EvidenceStrength = 'limited' | 'moderate' | 'good';

/** When there is enough known to read anything at all, and how much weight it can carry. These are app choices, not statistics. */
export const PATTERN_RULES = {
  /** Distinct days the app was opened (the same three-day floor the skip-streak and steady-room insights use). */
  minOpenedDays: MIN_PATTERN_DAYS,
  /** Tasks that were actually shown on Today. */
  minSeenTasks: 5,
  moderateOpenedDays: 7,
  moderateSeenTasks: 15,
  goodOpenedDays: 14,
  goodSeenTasks: 40,
} as const;

/** The one definition of "enough": used by the page, by the AI request, and by the server that checks the request. */
export const evidenceFor = (openedDays: number, seenTasks: number): { sufficient: boolean; strength: EvidenceStrength | null } => {
  const R = PATTERN_RULES;
  if (openedDays < R.minOpenedDays || seenTasks < R.minSeenTasks) return { sufficient: false, strength: null };
  if (openedDays >= R.goodOpenedDays && seenTasks >= R.goodSeenTasks) return { sufficient: true, strength: 'good' };
  if (openedDays >= R.moderateOpenedDays && seenTasks >= R.moderateSeenTasks) return { sufficient: true, strength: 'moderate' };
  return { sufficient: true, strength: 'limited' };
};

export interface PatternDay { date: ISODate; status: 'opened' | 'acted' | 'not-opened' | 'unknown'; why?: UnknownWhy }

export interface AreaCounts { seen: number; completed: number; noAction: number }

export interface Patterns {
  windowDays: PatternWindow;
  from: ISODate;
  to: ISODate;
  days: { list: PatternDay[]; opened: number; acted: number; notOpened: number; unknown: number };
  /** Tasks recorded as shown on Today (days with a display record only), and what is on file for them. */
  seen: { tasks: number; completed: number; skipped: number; snoozed: number; moved: number; stopped: number; noAction: number; pendingToday: number; actionsRemoved: number };
  /** Selected for a day, but not recorded as shown on Today (for example in a group that stayed closed). */
  notShown: number;
  /** Selected on days recorded before display tracking: whether they were shown is unknown, so they are not counted anywhere else. */
  displayUnknown: number;
  areas: { home: AreaCounts; habits: AreaCounts };
  leftOut: { notEnoughTime: number; lowEnergyDay: number; notACleaningDay: number; reasonNotRecorded: number };
  history: { knownFrom: ISODate | null; daysRemovedInWindow: number };
  evidence: { sufficient: boolean; strength: EvidenceStrength | null; missing: ('opened-days' | 'seen-tasks')[] };
}

const area = (d: AppData, from: ISODate, to: ISODate, home: boolean): AreaCounts => {
  const s = summarizeWindow(d, from, to, (f) => f.seen === true && (f.domain === 'home') === home);
  return { seen: s.selected, completed: s.completed, noAction: s.seenNoAction };
};

export const computePatterns = (d: AppData, today: ISODate, windowDays: PatternWindow): Patterns => {
  const from = addDays(today, -(windowDays - 1));
  const list: PatternDay[] = daysInRange(from, today).map((date) => {
    const s = dayStatus(d, date, today);
    return s.kind === 'unknown' ? { date, status: 'unknown', why: s.why } : { date, status: s.kind };
  });
  const count = (k: PatternDay['status']) => list.filter((x) => x.status === k).length;
  const days = { list, opened: count('opened'), acted: count('acted'), notOpened: count('not-opened'), unknown: count('unknown') };

  const seen = summarizeWindow(d, from, today, (f) => f.seen === true);
  const notShown = summarizeWindow(d, from, today, (f) => f.seen === false).selected;
  const displayUnknown = summarizeWindow(d, from, today, (f) => f.seen === 'unknown').selected;

  const known = historyKnownFrom(d);
  const daysRemovedInWindow = known ? list.filter((x) => x.date < known && x.date >= d.plan.startDate).length : 0;

  const ev = evidenceFor(days.opened, seen.selected);
  const missing: Patterns['evidence']['missing'] = [];
  if (days.opened < PATTERN_RULES.minOpenedDays) missing.push('opened-days');
  if (seen.selected < PATTERN_RULES.minSeenTasks) missing.push('seen-tasks');

  return {
    windowDays, from, to: today, days,
    seen: { tasks: seen.selected, completed: seen.completed, skipped: seen.skipped, snoozed: seen.snoozed, moved: seen.moved, stopped: seen.stopped, noAction: seen.seenNoAction, pendingToday: seen.seenPending, actionsRemoved: seen.seenActionsUnknown },
    notShown, displayUnknown,
    areas: { home: area(d, from, today, true), habits: area(d, from, today, false) },
    leftOut: { notEnoughTime: seen.leftOut['not-enough-time'], lowEnergyDay: seen.leftOut['low-energy-day'], notACleaningDay: seen.leftOut['not-a-cleaning-day'], reasonNotRecorded: seen.leftOut.unknown },
    history: { knownFrom: known, daysRemovedInWindow },
    evidence: { ...ev, missing },
  };
};
