import type { WaterData } from '../water/types';
import type { WellbeingData } from './types';

export const emptyWater = (): WaterData => ({ goalMl: null, unit: 'ml', entries: [] });
export const emptyWellbeing = (): WellbeingData => ({ checkins: [], journal: [] });
