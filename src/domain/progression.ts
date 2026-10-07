import { addDays, diffDays, weekday } from './dates';
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
} as const;

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
}

const isLifeEntry = (e: SessionEntry) => !!e.domain && e.domain !== 'home';

/** Pure: everything the progression decision looks at, so it can be tested, explained, and later learned from. */
export const progressionReadiness = (entries: SessionEntry[], today: ISODate, since: ISODate, level: LifeLevel): Readiness => {
  const observedDays = Math.max(0, diffDays(today, since));
  const stats = (days: number) => {
    const from = addDays(today, -days);
    const es = entries.filter((e) => isLifeEntry(e) && e.date >= from && e.date >= since && e.date <= today);
    const done = es.filter((e) => e.outcome === 'completed');
    const missed = es.filter((e) => e.outcome === 'skipped' || e.outcome === 'snoozed').length;
    const dates = [...new Set(done.map((e) => e.date))];
    return { completed: done.length, missed, activeDays: dates.length, weekdays: new Set(dates.map(weekday)).size, decisions: done.length + missed };
  };
  const w = stats(PROGRESSION.windowDays);
  const e = stats(PROGRESSION.easeWindowDays);
  const missRatio = w.decisions ? w.missed / w.decisions : 0;
  const easeRatio = e.decisions ? e.missed / e.decisions : 0;
  return {
    level, observedDays, activeDays: w.activeDays, weekdays: w.weekdays, completed: w.completed, missed: w.missed, missRatio,
    readyToStepUp: level < 3 && observedDays >= PROGRESSION.minObservationDays && w.activeDays >= PROGRESSION.minActiveDays
      && w.weekdays >= PROGRESSION.minWeekdays && missRatio <= PROGRESSION.maxMissRatio,
    readyToEaseOff: level > 1 && observedDays >= PROGRESSION.easeMinObservationDays
      && ((e.decisions >= PROGRESSION.easeMinDecisions && easeRatio >= PROGRESSION.easeMissRatio) || (e.decisions >= PROGRESSION.easeMinDecisions && e.activeDays <= PROGRESSION.easeMaxActiveDays)),
  };
};
