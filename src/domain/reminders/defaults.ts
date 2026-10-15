import type { RemindersData } from './types';

export const emptyReminders = (): RemindersData => ({
  prefs: { enabled: false, leadMinutes: 10, quiet: { on: true, from: '22:00', to: '07:00' }, snoozeMinutes: 10, modules: { movement: true, meals: true, learning: true, wellbeing: true } },
  snoozed: {}, shown: {},
});
