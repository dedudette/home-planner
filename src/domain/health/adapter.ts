import type { ISODate } from '../types';
import type { DayHealth, HealthMetric, HealthPlatformName, ImportedWorkout } from './types';

/**
 * What a health service must offer. The adapter asks the platform for DAILY TOTALS (its own statistics or aggregate queries) rather than
 * adding up raw samples here, because a total from the platform already accounts for the same steps being reported by a watch and a
 * phone at once. (Health Connect's documentation says exactly this for steps and other cumulative data.)
 */
export interface HealthAdapter {
  platform: HealthPlatformName;
  label: string;
  isAvailable(): Promise<{ available: boolean; reason?: string }>;
  /** Asks the platform, which shows its own permission screen. */
  requestAuthorization(read: HealthMetric[]): Promise<void>;
  /** What may be read now. On Apple's platform an app cannot tell "denied" from "no data", so this is best-effort there. */
  authorized(read: HealthMetric[]): Promise<HealthMetric[]>;
  daily(metric: HealthMetric, from: ISODate, to: ISODate): Promise<{ date: ISODate; value: number }[]>;
  workouts(from: ISODate, to: ISODate): Promise<ImportedWorkout[]>;
}

export type DayPatch = Pick<DayHealth, 'steps' | 'exerciseMinutes' | 'waterMl' | 'workouts'>;
