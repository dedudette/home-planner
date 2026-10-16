import type { AppData } from '../domain/types';
import { AVAILABLE_MODULES, MODULES } from '../domain/modules/registry';
import type { ModuleId } from '../domain/modules/types';
import { I, type IconType } from '../ui/icons';

/**
 * What the app's navigation contains for this person. One list, read by the desktop sidebar, the mobile More menu and the page title,
 * so a section is either everywhere it should be or nowhere.
 */
export interface NavItem { path: string; label: string; icon: IconType; sub: string }

export const SECTION_ICON: Record<ModuleId, IconType> = { movement: I.dumbbell, meals: I.pot, water: I.drop, learning: I.cap, wellbeing: I.heart };

/** The four always-there places, in the bottom bar. Everything else lives in sections (sidebar) and More (phone). */
export const PRIMARY: NavItem[] = [
  { path: 'today', label: 'Today', icon: I.sun, sub: 'Everything planned for today' },
  { path: 'plan', label: 'Plan', icon: I.list, sub: 'What is in your plan and how often' },
  { path: 'schedule', label: 'Schedule', icon: I.calDays, sub: 'The week and month ahead' },
  { path: 'progress', label: 'Progress', icon: I.chart, sub: 'A record of what you did, not a scorecard' },
];

export const homeOn = (d: Pick<AppData, 'preferences'>): boolean => d.preferences.focus.includes('home');

/** Sections the person turned on, in a fixed order. Water has no page of its own: it lives in Wellbeing. */
export const sectionsFor = (d: Pick<AppData, 'preferences' | 'modules'>): NavItem[] => {
  const on = d.modules.enabled;
  const out: NavItem[] = [];
  out.push(homeOn(d)
    ? { path: 'home', label: 'Home', icon: I.home, sub: 'Rooms, people, pets and preferences' }
    : { path: 'home', label: 'My goals', icon: I.flame, sub: "What you're improving, your daily time and energy" });
  if (homeOn(d)) out.push({ path: 'supplies', label: 'Supplies', icon: I.package, sub: 'What you own and what you can clean with it' });
  if (on.movement && AVAILABLE_MODULES.includes('movement')) out.push({ path: 'movement', label: MODULES.movement.label, icon: SECTION_ICON.movement, sub: MODULES.movement.blurb });
  if (on.meals && AVAILABLE_MODULES.includes('meals')) out.push({ path: 'meals', label: MODULES.meals.label, icon: SECTION_ICON.meals, sub: MODULES.meals.blurb });
  if (on.learning && AVAILABLE_MODULES.includes('learning')) out.push({ path: 'learning', label: MODULES.learning.label, icon: SECTION_ICON.learning, sub: MODULES.learning.blurb });
  const water = on.water && AVAILABLE_MODULES.includes('water');
  const wellbeing = on.wellbeing && AVAILABLE_MODULES.includes('wellbeing');
  if (wellbeing || water) out.push({ path: 'wellbeing', label: wellbeing ? MODULES.wellbeing.label : 'Water', icon: wellbeing ? SECTION_ICON.wellbeing : SECTION_ICON.water, sub: wellbeing && water ? 'Check-ins, journaling, breathing, wind-down and water' : wellbeing ? MODULES.wellbeing.blurb : MODULES.water.blurb });
  return out;
};

export const SETTINGS_ITEM: NavItem = { path: 'settings', label: 'Settings', icon: I.settings, sub: 'Sections, appearance, backup and reset' };
