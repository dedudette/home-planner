import type { ISODate } from '../types';

/**
 * Water. A log, nothing more: the app has no universal target (needs differ between people, climates, activity and health, and the app
 * cannot know), never praises drinking more than a person's own goal, and never turns a day with no entries into a zero or a failure.
 */
export type WaterUnit = 'ml' | 'floz' | 'cup';

export interface WaterEntry { id: string; date: ISODate; at: string; ml: number }

export interface WaterData {
  /** The person's own daily goal in ml, or null for none. The app never suggests one. */
  goalMl: number | null;
  unit: WaterUnit;
  entries: WaterEntry[];
}
