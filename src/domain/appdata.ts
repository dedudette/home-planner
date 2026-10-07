import { emptyHome, emptyPreferences } from './context';
import { todayISO } from './dates';
import type { AppData } from './types';

export const emptyAppData = (today = todayISO()): AppData => ({
  version: 2,
  user: { id: `u_${Math.random().toString(36).slice(2, 10)}`, name: '', createdAt: new Date().toISOString(), demo: false },
  home: emptyHome(),
  preferences: emptyPreferences(),
  onboardingComplete: false,
  plan: { startDate: today, resetCount: 0 },
  taskStates: {},
  customTasks: [],
  sessions: [],
  supplies: [],
  resetRun: null,
  fiveRecent: [],
  dismissedInsights: {},
  dayEnergy: null,
  lastOpened: null,
  exposures: [],
  energyLog: {},
  planVersions: [],
  recEvents: [],
});

export const uid = (prefix = 'id'): string => `${prefix}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-3)}`;
