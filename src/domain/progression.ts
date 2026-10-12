import { addDays, diffDays, weekday } from './dates';
import { isScheduledEntry } from './behaviour';
import type { ISODate, LifeLevel, SessionEntry } from './types';

/**
 * When is someone really ready for more, or ready for less?
 *
 * The old rule ("12 completions in 14 days") fired after about three days for anyone with five habits a day: it counted tasks, not
 * days, and it did not care how long they had been at the current level. This rule looks at DISTINCT DAYS over a meaningful
 * window, and only counts time spent at the current level.
 */
export const PROGRESSION = {
  /** Look back this far. */
  windowDays: 21,
  /** Never suggest a step up before the person has been at this level this long. */
  minObservationDays: 21,
  /** Distinct days in the window with at least one completed habit (15 of 21 is about 70%). */
  minActiveDays: 15,
  /** ...spread across at least this many different weekdays, so one busy weekend does not count. */
  minWeekdays: 5,
  /** Skips and snoozes as a share of decisions. */
  maxMissRatio: 0.15,
  // easing off
  easeWindowDays: 10,
  easeMinObservationDays: 10,
  easeMinDecisions: 8,
  easeMissRatio: 0.6,
  easeMaxActiveDays: 3,
  /** Eight skips on one afternoon is a bad afternoon, not a pattern: the decisions must span at least this many days. */
  easeMinDecisionDays: 4,
  // guards on a step up
  /** Declared low-energy days in the last week at which a step up is not offered. */
  maxLowEnergyDays: 3,
  /** Needs this many days on which the scheduled habits were seen before follow-through is judged at all. */
  minSeenDays: 10,
  /** Of the scheduled habits that were seen, at least this share must have been completed. */
  minFollowThrough: 0.5,
} as const;

/** What else is known about the window, beyond the entries. Everything here is optional: when it is absent, nothing is assumed. */
export interface ReadinessContext {
  /** First date from which entries are complete (history before it was removed to save space). */
  knownFrom?: ISODate | null;
  /** Days in the last week on which the person declared low energy (and whether today is one). */
  lowEnergyDays?: number;
  lowEnergyToday?: boolean;
  /** Among the scheduled habits that were SEEN on Today in the window: how many, and how many were completed. Null when not known. */
  seen?: { habits: number; completed: number; days: number } | null;
}

export interface Readiness {
  level: LifeLevel;
  observedDays: number;
  activeDays: number;
  weekdays: number;
  completed: number;
  missed: number;
  missRatio: number;
  readyToStepUp: boolean;
  readyToEaseOff: boolean;
  /** Why a step up was held back even though the activity rule passed (so it can be explained and tested). */
  heldBack?: 'history-trimmed' | 'low-energy' | 'low-follow-through';
}

/**
 * Only the person's response to their SCHEDULED habits counts. "Just 5 minutes", the rough-day steps and the reset sequence are
 * one-off helpers: tapping them says nothing about whether the routines are the right size.
 */
const isLifeEntry = (e: SessionEntry) => !!e.domain && e.domain !== 'home' && isScheduledEntry(e);

/** Pure: everything the progression decision looks at, so it can be tested, explained, and later learned from. */
export const progressionReadiness = (entries: SessionEntry[], today: ISODate, since: ISODate, level: LifeLevel, ctx: ReadinessContext = {}): Readiness => {
  const observedDays = Math.max(0, diffDays(today, since));
  const stats = (days: number) => {
    const from = addDays(today, -days);
    const es = entries.filter((e) => isLifeEntry(e) && e.date >= from && e.date >= since && e.date <= today);
    const done = es.filter((e) => e.outcome === 'completed');
    const missed = es.filter((e) => e.outcome === 'skipped' || e.outcome === 'snoozed').length;
    const dates = [...new Set(done.map((e) => e.date))];
    const decisionDays = new Set(es.filter((x) => x.outcome === 'completed' || x.outcome === 'skipped' || x.outcome === 'snoozed').map((x) => x.date)).size;
    return { completed: done.length, missed, activeDays: dates.length, weekdays: new Set(dates.map(weekday)).size, decisions: done.length + missed, decisionDays };
  };
  const w = stats(PROGRESSION.windowDays);
  const e = stats(PROGRESSION.easeWindowDays);
  const missRatio = w.decisions ? w.missed / w.decisions : 0;
  const easeRatio = e.decisions ? e.missed / e.decisions : 0;
  const activityOk = level < 3 && observedDays >= PROGRESSION.minObservationDays && w.activeDays >= PROGRESSION.minActiveDays
    && w.weekdays >= PROGRESSION.minWeekdays && missRatio <= PROGRESSION.maxMissRatio;
  // A step up adds work, so it needs more than "did something on most days". Each guard only applies when its evidence exists.
  const trimmed = !!ctx.knownFrom && ctx.knownFrom > addDays(today, -PROGRESSION.windowDays);
  const tired = !!ctx.lowEnergyToday || (ctx.lowEnergyDays ?? 0) >= PROGRESSION.maxLowEnergyDays;
  const seen = ctx.seen;
  const lowFollow = !!seen && seen.days >= PROGRESSION.minSeenDays && seen.habits > 0 && seen.completed / seen.habits < PROGRESSION.minFollowThrough;
  const heldBack = activityOk ? (trimmed ? 'history-trimmed' : tired ? 'low-energy' : lowFollow ? 'low-follow-through' : undefined) : undefined;
  // Easing off only removes work, so it is not held back by any of these; it does need the window to be complete.
  const easeEvidence = (e.decisions >= PROGRESSION.easeMinDecisions && easeRatio >= PROGRESSION.easeMissRatio) || (e.decisions >= PROGRESSION.easeMinDecisions && e.activeDays <= PROGRESSION.easeMaxActiveDays);
  const easeTrimmed = !!ctx.knownFrom && ctx.knownFrom > addDays(today, -PROGRESSION.easeWindowDays);
  return {
    level, observedDays, activeDays: w.activeDays, weekdays: w.weekdays, completed: w.completed, missed: w.missed, missRatio,
    readyToStepUp: activityOk && !heldBack,
    readyToEaseOff: level > 1 && observedDays >= PROGRESSION.easeMinObservationDays && easeEvidence && e.decisionDays >= PROGRESSION.easeMinDecisionDays && !easeTrimmed,
    ...(heldBack ? { heldBack } : {}),
  };
};
