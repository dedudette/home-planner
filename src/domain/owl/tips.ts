import type { AppData, ISODate } from '../types';
import { DEFAULT_APPEARANCE } from '../appearance/types';
import type { ModuleId } from '../modules/types';

/**
 * What the owl says when no AI is involved: short pointers to things the app can already do, chosen by simple rules from what the
 * person has and has not set up. The rules are plain and visible here; there is no model behind a tip, and it is labelled that way
 * on screen so it is never mistaken for an AI answer. A tip that is dismissed stays dismissed.
 */
export type TipPlace = 'today' | 'movement' | 'meals' | 'wellbeing' | 'learning' | 'settings';

export interface TipAction { label: string; route?: string; sheet?: 'shopGen' | 'interestForm' | 'workoutForm' }
export interface OwlTip { id: string; place: TipPlace[]; title: string; body: string; action?: TipAction; when: (d: AppData, today: ISODate) => boolean }

const on = (d: AppData, m: ModuleId): boolean => d.modules.enabled[m];
const anyPlannedKind = (d: AppData): boolean => d.activities.some((a) => !a.archived);

export const TIPS: OwlTip[] = [
  {
    id: 'plan-yourself', place: ['today'], title: 'You decide what goes in your day',
    body: 'Pick a workout, a dish or a hobby in its own section and plan it for a day. It joins today\'s list, and nothing is scheduled for you.',
    when: (d) => d.onboardingComplete && (on(d, 'movement') || on(d, 'meals') || on(d, 'learning') || on(d, 'wellbeing')) && !anyPlannedKind(d),
  },
  {
    id: 'first-workout', place: ['movement'], title: 'Try one short workout',
    body: 'Every workout has an easier version, and you can stop at any point. What you did is what gets logged.',
    when: (d) => on(d, 'movement') && d.movement.log.length === 0,
  },
  {
    id: 'water-goal', place: ['wellbeing', 'today'], title: 'A water goal is optional',
    body: 'You can log a glass with one tap. If you would like a goal of your own, you can set one; the app never picks a number for you.',
    when: (d) => on(d, 'water') && d.water.goalMl === null && d.water.entries.length > 0,
  },
  {
    id: 'shop-list', place: ['meals', 'today'], title: 'Turn your meal plan into a shopping list',
    body: 'The list adds up the ingredients for the meals you planned, and you can edit every line before you shop.',
    when: (d) => on(d, 'meals') && d.meals.plan.length > 0 && d.shopping.lists.length === 0,
    action: { label: 'Make a shopping list', sheet: 'shopGen' },
  },
  {
    id: 'discover', place: ['learning'], title: 'Not sure what to try?',
    body: 'Discover suggests a few small things to try from your time, budget and where you are. They are only ideas.',
    when: (d) => on(d, 'learning') && d.interests.items.length === 0,
    action: { label: 'Look at ideas', route: 'learning?tab=discover' },
  },
  {
    id: 'look', place: ['settings', 'today'], title: 'You can change how the app looks',
    body: 'Colours, text size, spacing and movement are all in Settings, and the app can follow your device\'s light or dark setting.',
    when: (d) => d.onboardingComplete && d.sessions.length >= 3 && JSON.stringify({ ...d.appearance, owl: true }) === JSON.stringify(DEFAULT_APPEARANCE),
    action: { label: 'Open Settings', route: 'settings' },
  },
];

export const dismissKey = (id: string): string => `owl:${id}`;

/** The one tip to show in a place, or null. At most one at a time, and never when the owl is switched off. */
export const nextTip = (d: AppData, place: TipPlace, today: ISODate): OwlTip | null => {
  if (!d.appearance.owl) return null;
  return TIPS.find((t) => t.place.includes(place) && !(dismissKey(t.id) in d.dismissedInsights) && t.when(d, today)) ?? null;
};
