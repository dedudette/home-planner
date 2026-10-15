import type { ISODate } from '../types';

/**
 * Health data from Apple Health or Health Connect, read-only. It is kept apart from what the person logs in CleanFlow: it never
 * completes a planned activity, never uses up the day's minutes, never edits the water log, and never goes to the AI. It is shown next
 * to the person's own records, labelled with where it came from, and it can be removed with one tap.
 */
export type HealthMetric = 'steps' | 'exercise' | 'water';
export const HEALTH_METRICS: readonly HealthMetric[] = ['steps', 'exercise', 'water'];
export type HealthPlatformName = 'healthkit' | 'health-connect';

export interface HealthPrefs {
  /** Whether the person asked for this. It is never, by itself, a claim that anything is connected. */
  enabled: boolean;
  /** What to read. All off until chosen. */
  read: Record<HealthMetric, boolean>;
}

export interface ImportedWorkout {
  /** The platform's own id, so the same workout is never stored twice. */
  id: string;
  type: string;
  minutes: number;
  startAt: string;
  source: string;
}

export interface DayHealth {
  steps?: number;
  exerciseMinutes?: number;
  waterMl?: number;
  workouts?: ImportedWorkout[];
  platform: HealthPlatformName;
  /** When this day was last read. */
  at: string;
}

export interface HealthData {
  prefs: HealthPrefs;
  daily: Record<ISODate, DayHealth>;
  lastSync: string | null;
}

/** What the person is told about the connection. Worked out from what the device reports, never from the switch. */
export type HealthStatus =
  | { s: 'off' }
  | { s: 'web' }                                  // a browser: there is no health service to talk to
  | { s: 'unavailable'; reason: string }          // a phone without the health service (or too old)
  | { s: 'needs-permission' }                     // asked for, not yet allowed
  | { s: 'partial'; allowed: HealthMetric[]; missing: HealthMetric[] }
  | { s: 'connected'; allowed: HealthMetric[]; lastSync: string | null }
  | { s: 'error' };

export const MAX_HEALTH_DAYS = 120;
