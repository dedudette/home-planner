import type { MovementData } from './types';

export const emptyMovement = (): MovementData => ({
  prefs: { equipment: [], likes: [], avoid: [], lowImpactOnly: false },
  goals: { sessionsPerWeek: null, minutesPerWeek: null, note: '' },
  restDays: [],
  custom: [],
  favourites: [],
  log: [],
});
