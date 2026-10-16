import { addDays } from '../dates';
import { discoverInterests } from '../interests/discover';
import type { DiscoverAnswers } from '../interests/types';
import { allRecipes, mealMinutes, suggestRecipes } from '../meals/planner';
import { MEAL_SLOTS, type MealSlot } from '../meals/types';
import { allWorkouts, suggestWorkouts, workoutMinutes } from '../movement/planner';
import { dayEnergyOf } from '../safety';
import type { AppData, ISODate } from '../types';
import { clean } from './text';
import { LIMITS, type AssistRequest, type Candidate } from './types';

/**
 * Building a request. Every candidate is chosen HERE, with the person's own settings applied on this device (diet, allergens, dislikes,
 * equipment, what they would rather not do, rest days, today's energy). Those settings are not sent: only the names, minutes and tags of
 * what already passed. So the model cannot suggest something the person filtered out, because it never sees it.
 */
export interface Built { request: AssistRequest; /** Plain-language lines for the "what will be sent" preview. */ preview: string[]; /** What stays on the device. */ kept: string[] }

const SAFE = (s: string) => (clean(s) ?? '').replace(/[<>{}`\\]/g, '').slice(0, LIMITS.name);
const tag = (s: string) => SAFE(s).slice(0, LIMITS.tag);
/** Tags that would repeat a setting the person chose (their diet, a budget wish). Their filtering already happened here, so they are not sent. */
const SETTING_TAGS = new Set(['vegan', 'vegetarian', 'pescatarian', 'inexpensive', 'gluten-free', 'dairy-free', 'nut-free', 'halal', 'kosher']);
const sendable = (tags: string[]) => tags.filter((t) => !SETTING_TAGS.has(t.toLowerCase())).slice(0, LIMITS.tags).map(tag).filter(Boolean);
const HINT = 'The options you send are already narrowed by these, so the list can hint at them';

export interface MealsOptions { days: ISODate[]; slots: MealSlot[]; wish: string; includeOwnDishes: boolean }

export const buildMealsRequest = (d: AppData, o: MealsOptions): Built => {
  const slots = o.slots.length ? o.slots : MEAL_SLOTS.filter((s) => d.meals.prefs.slots[s].on && s !== 'snack').slice(0, 3);
  const recipes = allRecipes(d).filter((r) => o.includeOwnDishes || r.source === 'starter');
  const bySlot = slots.map((s) => suggestRecipes(recipes, d.meals.prefs, { slot: s }));
  const seen = new Map<string, Candidate>();
  // Round-robin across the slots so one meal type does not use up all the room.
  for (let i = 0; seen.size < LIMITS.candidates && bySlot.some((xs) => i < xs.length); i++) {
    for (const xs of bySlot) {
      const s = xs[i];
      if (!s || seen.size >= LIMITS.candidates || seen.has(s.recipe.id)) continue;
      seen.set(s.recipe.id, { id: s.recipe.id, name: SAFE(s.recipe.name), minutes: mealMinutes(s.recipe), tags: sendable(s.recipe.tags), slots: s.recipe.slots.filter((x) => slots.includes(x)) });
    }
  }
  const candidates = [...seen.values()].filter((c) => (c.slots?.length ?? 0) > 0);
  const maxItems = Math.min(LIMITS.items, o.days.length * slots.length);
  const request: AssistRequest = { v: 1, feature: 'meals', days: o.days.slice(0, LIMITS.days), slots, maxItems: Math.max(1, maxItems), wish: (clean(o.wish) ?? '').slice(0, LIMITS.wish), candidates };
  return {
    request,
    preview: [`${request.days.length} day${request.days.length === 1 ? '' : 's'} and these meals: ${slots.join(', ')}`, `${candidates.length} recipe${candidates.length === 1 ? '' : 's'}, with name, minutes and tags only`, ...(request.wish ? [`Your note: "${request.wish}"`] : [])],
    kept: ['Your diet, allergen and dislike settings (applied here, not sent)', 'Your household size', 'Everything you have eaten or logged', HINT],
  };
};

export interface MovementOptions { today: ISODate; days: number; maxItems: number; maxMinutes: number | null; wish: string; includeOwn: boolean }

export const buildMovementRequest = (d: AppData, o: MovementOptions): Built => {
  const rest = new Set(d.movement.restDays);
  const days: ISODate[] = [];
  for (let i = 0; i < 14 && days.length < Math.min(LIMITS.days, o.days); i++) {
    const day = addDays(o.today, i);
    if (!rest.has(new Date(`${day}T12:00:00`).getDay())) days.push(day);
  }
  const list = allWorkouts(d).filter((w) => o.includeOwn || w.source === 'starter');
  const energy = dayEnergyOf(d, o.today);
  const hits = suggestWorkouts(list, d.movement.prefs, { maxMinutes: o.maxMinutes ?? undefined }, energy).slice(0, 24);
  const candidates: Candidate[] = hits.map((h) => ({ id: h.workout.id, name: SAFE(h.workout.name), minutes: workoutMinutes(h.workout), tags: [tag(h.workout.type), tag(h.workout.level)].filter(Boolean) }));
  const request: AssistRequest = { v: 1, feature: 'movement', days, slots: [], maxItems: Math.max(1, Math.min(o.maxItems, days.length || 1)), wish: (clean(o.wish) ?? '').slice(0, LIMITS.wish), candidates };
  return {
    request,
    preview: [`${days.length} day${days.length === 1 ? '' : 's'} (your rest days left out), at most ${request.maxItems} session${request.maxItems === 1 ? '' : 's'}`, `${candidates.length} workout${candidates.length === 1 ? '' : 's'}, with name, minutes, kind and level only`, ...(request.wish ? [`Your note: "${request.wish}"`] : [])],
    kept: ['Your rest days, equipment and what you would rather not do (applied here, not sent)', "Today's energy (applied here, not sent)", 'Everything you logged', HINT],
  };
};

export const buildLearningRequest = (d: AppData, a: DiscoverAnswers, wish: string): Built => {
  const found = discoverInterests(d, a);
  const candidates: Candidate[] = [];
  for (const s of found) {
    const st = s.interest.starters[0];
    if (!st || candidates.length >= 12) continue;
    candidates.push({ id: `${s.interest.id}:${st.id}`, name: SAFE(`${s.interest.name}: ${st.title}`), minutes: st.minutes, tags: [tag(s.interest.category), tag(s.interest.budget), tag(s.interest.setting)].filter(Boolean) });
  }
  const request: AssistRequest = { v: 1, feature: 'learning', days: [], slots: [], maxItems: 3, wish: (clean(wish) ?? '').slice(0, LIMITS.wish), candidates };
  return {
    request,
    preview: [`${candidates.length} idea${candidates.length === 1 ? '' : 's'} from the built-in list, with name, minutes and a few tags`, ...(request.wish ? [`Your note: "${request.wish}"`] : [])],
    kept: ['Your interests, sessions, books, notes and links', 'Your time, budget and place answers (applied here, not sent)', HINT],
  };
};
