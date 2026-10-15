import type { HealthData } from './types';

export const emptyHealth = (): HealthData => ({ prefs: { enabled: false, read: { steps: false, exercise: false, water: false } }, daily: {}, lastSync: null });
