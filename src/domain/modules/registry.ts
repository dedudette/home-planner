import type { Domain, LifeFocus, TimeOfDay } from '../types';
import { ACTIVITY_MODULES, MODULE_IDS, TODAY_CARDS, type ActivityModule, type ModuleId, type ModulesState, type TodayCard } from './types';

/**
 * One place that says what each section is called, what it is for, which area of life its planned items belong to and where it lives.
 * Navigation, Settings, onboarding and the planner all read this, so a section is described once.
 */
export interface ModuleInfo {
  id: ModuleId;
  label: string;
  /** One line shown where the person chooses sections. */
  blurb: string;
  /** Hash route of the section's page. */
  path: string;
  /** The area of life its planned activities appear under in the planner. */
  domain?: Domain;
}

export const MODULES: Record<ModuleId, ModuleInfo> = {
  movement: { id: 'movement', label: 'Movement', blurb: 'Walks, stretching and workouts at your own level', path: 'movement', domain: 'fitness' },
  meals: { id: 'meals', label: 'Meals & shopping', blurb: 'Plan meals, keep recipes and build shopping lists', path: 'meals', domain: 'meals' },
  water: { id: 'water', label: 'Water', blurb: 'Log what you drink, if you want to', path: 'wellbeing' },
  learning: { id: 'learning', label: 'Learning & hobbies', blurb: 'Reading, music, crafts, languages and anything you want to try', path: 'learning', domain: 'learning' },
  wellbeing: { id: 'wellbeing', label: 'Wellbeing', blurb: 'Check-ins, journaling, breathing and wind-down routines', path: 'wellbeing', domain: 'mind' },
};

/** Sections that have a working page in this build. A section is offered to people only once it is real. */
export const AVAILABLE_MODULES: readonly ModuleId[] = ['movement', 'meals', 'water', 'learning', 'wellbeing'];

export const ACTIVITY_LABEL: Record<ActivityModule, string> = {
  movement: 'Movement', meals: 'Meals & cooking', learning: 'Learning & hobbies', wellbeing: 'Wellbeing',
};

export const CARD_LABEL: Record<TodayCard, string> = { plan: "Today's plan", meals: 'Meals', water: 'Water', checkin: 'Check-in' };

/** The module a planned task counts toward. Generated habits are mapped by their area of life; areas with no section have none. */
export const moduleOfDomain = (d: Domain | undefined): ActivityModule | undefined => {
  switch (d) {
    case 'fitness': return 'movement';
    case 'meals': return 'meals';
    case 'learning': return 'learning';
    case 'breathing': case 'mind': case 'sleep': return 'wellbeing';
    default: return undefined;
  }
};

/** What a person who already used the app gets. A section is switched on only where a goal they already chose clearly points at it. */
export const defaultModulesFor = (focus: readonly LifeFocus[], introSeen: boolean): ModulesState => ({
  enabled: {
    movement: focus.includes('active') || focus.includes('healthy'),
    meals: false,
    water: false,
    learning: focus.includes('study'),
    wellbeing: focus.includes('selfcare') || focus.includes('morning') || focus.includes('evening'),
  },
  order: [...TODAY_CARDS],
  hidden: [],
  caps: {},
  introSeen,
});

/** Every section off. A brand-new person chooses their own. */
export const emptyModules = (): ModulesState => ({
  enabled: { movement: false, meals: false, water: false, learning: false, wellbeing: false },
  order: [...TODAY_CARDS], hidden: [], caps: {}, introSeen: true,
});

export const anyModuleOn = (m: ModulesState): boolean => MODULE_IDS.some((id) => m.enabled[id]);
export const activityModulesOn = (m: ModulesState): ActivityModule[] => ACTIVITY_MODULES.filter((id) => m.enabled[id]);

/** The Today cards that exist for this person right now, in their order, minus the ones they hid. */
export const visibleCards = (m: ModulesState): TodayCard[] => {
  const exists = (c: TodayCard) => c === 'plan' || (c === 'meals' && m.enabled.meals) || (c === 'water' && m.enabled.water) || (c === 'checkin' && m.enabled.wellbeing);
  return m.order.filter((c) => exists(c) && (c === 'plan' || !m.hidden.includes(c)));
};

/** A time of day for a clock time, so a fixed activity lands in the same Now / Later / Evening groups as everything else. */
export const timeOfDayFor = (time: string | null | undefined): TimeOfDay => {
  if (!time) return 'anytime';
  const h = Number(time.slice(0, 2));
  if (!Number.isFinite(h)) return 'anytime';
  return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
};

export const isClock = (v: unknown): v is string => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
export const clockMinutes = (t: string): number => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
export const clockLabel = (t: string): string => {
  const m = clockMinutes(t);
  const h = Math.floor(m / 60), mm = m % 60;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(mm).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
};
