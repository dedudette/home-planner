import { emptyHome, emptyPreferences } from './context';
import { todayISO } from './dates';
import { emptyMeals, emptyShopping } from './meals/defaults';
import { emptyMovement } from './movement/defaults';
import { emptyWater, emptyWellbeing } from './wellbeing/defaults';
import { emptyModules } from './modules/registry';
import type { AppData } from './types';

export const emptyAppData = (today = todayISO()): AppData => ({
  version: 3,
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
  retention: [],
  modules: emptyModules(),
  activities: [],
  meals: emptyMeals(),
  shopping: emptyShopping(),
  movement: emptyMovement(),
  water: emptyWater(),
  wellbeing: emptyWellbeing(),
});

export const uid = (prefix = 'id'): string => `${prefix}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-3)}`;
