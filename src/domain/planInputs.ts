import { generatePlan, type Plan } from './engine';
import { anyModuleOn } from './modules/registry';
import type { AppData, Preferences } from './types';

/**
 * The one way the plan is generated from saved data. Preferences are read as they are, with a single derived flag saying whether any
 * section is on (see `Preferences.sections`). Nothing a person plans or logs inside a section changes how cleaning is generated:
 * their cleaning plan only changes when their own home or preferences do.
 */
export const planPrefs = (d: Pick<AppData, 'preferences' | 'modules'>): Preferences =>
  anyModuleOn(d.modules) ? { ...d.preferences, sections: true } : d.preferences;

export const planOf = (d: Pick<AppData, 'home' | 'preferences' | 'modules' | 'plan'>): Plan => generatePlan(d.home, planPrefs(d), d.plan);
