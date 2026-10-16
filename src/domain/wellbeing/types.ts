import type { ISODate } from '../types';

/**
 * Wellbeing: self-reported check-ins, a private journal, and routines. What a person writes is theirs: nothing here is analysed for a
 * condition, nothing diagnoses, and nothing in a journal or a check-in note is ever sent anywhere unless the person chooses to share it.
 */
export type CheckinEnergy = 'low' | 'ok' | 'high';

export interface Checkin {
  id: string;
  date: ISODate;
  at: string;
  /** Matches the day's energy setting that adjusts Today's list. Null: not said. */
  energy: CheckinEnergy | null;
  /** 1 (very low) to 5 (very good), or null: not said. */
  mood: 1 | 2 | 3 | 4 | 5 | null;
  note: string;
}

export interface JournalEntry { id: string; date: ISODate; at: string; title: string; text: string }

export interface WellbeingData { checkins: Checkin[]; journal: JournalEntry[] }
