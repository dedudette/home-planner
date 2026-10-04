import type { Frequency, Priority } from './types';

/** Frequency ladder from rarest to most frequent. */
export const LADDER: Frequency[] = ['seasonal', 'monthly', 'biweekly', 'weekly', 'twice-weekly', 'daily'];

export const occurrencesPerWeek = (f: Frequency, activeDayCount: number, habit: boolean): number => {
  switch (f) {
    case 'daily': return habit ? 7 : activeDayCount;
    case 'twice-weekly': return 2;
    case 'weekly': return 1;
    case 'biweekly': return 0.5;
    case 'monthly': return 7 / 28;
    case 'seasonal': return 7 / 91;
    default: return 0;
  }
};

export const priorityOf = (score: number): Priority =>
  score >= 85 ? 'URGENT' : score >= 62 ? 'HIGH' : score >= 40 ? 'MEDIUM' : 'LOW';

/** True for tasks from the personal-discipline layer (everything that isn't home cleaning). */
export const isLife = (t: { domain?: string }): boolean => !!t.domain && t.domain !== 'home';
