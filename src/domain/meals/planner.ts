import type { AppData, ISODate } from '../types';
import { activityTaskId } from '../modules/activities';
import { identify, normalizeName } from './ingredients';
import { STARTER_BY_ID, STARTER_RECIPES } from './recipes';
import type { Allergen, Diet, DietPref, MealEntry, MealPrefs, MealRef, MealSlot, Recipe } from './types';

/** Every recipe the person can plan: the starter ones and the dishes they wrote. */
export const allRecipes = (d: Pick<AppData, 'meals'>): Recipe[] => [...STARTER_RECIPES, ...d.meals.dishes];

export const recipeById = (d: Pick<AppData, 'meals'>, id: string): Recipe | null => STARTER_BY_ID.get(id) ?? d.meals.dishes.find((x) => x.id === id) ?? null;

/** The recipe an entry points at, or null for a free-text meal, a leftover, or a dish that was deleted. */
export const recipeOf = (d: Pick<AppData, 'meals'>, ref: MealRef): Recipe | null => (ref.kind === 'recipe' || ref.kind === 'dish' ? recipeById(d, ref.id) : null);

// ───────────────────────── what a recipe contains, from its listed ingredients ─────────────────────────

export interface RecipeCheck {
  /** The strictest diet among the ingredients the app knows. Null when it knows none of them. */
  diet: Diet | null;
  allergens: Allergen[];
  /** Ingredients the catalogue does not know. They are not checked for diet or allergens, and the app says so. */
  unchecked: string[];
}

const DIET_RANK: Record<Diet, number> = { vegan: 0, vegetarian: 1, pescatarian: 2, omnivore: 3 };

export const checkRecipe = (r: Recipe): RecipeCheck => {
  let diet: Diet | null = null;
  const allergens = new Set<Allergen>();
  const unchecked: string[] = [];
  for (const ing of r.ingredients) {
    const id = identify(ing.name);
    if (!id.known) { unchecked.push(ing.name); continue; }
    for (const a of id.allergens) allergens.add(a);
    if (id.diet && (diet === null || DIET_RANK[id.diet] > DIET_RANK[diet])) diet = id.diet;
  }
  return { diet: diet ?? (r.ingredients.length && !unchecked.length ? 'vegan' : null), allergens: [...allergens].sort(), unchecked };
};

const ALLOWED_DIETS: Record<DietPref, Diet[]> = { any: ['vegan', 'vegetarian', 'pescatarian', 'omnivore'], pescatarian: ['vegan', 'vegetarian', 'pescatarian'], vegetarian: ['vegan', 'vegetarian'], vegan: ['vegan'] };

export interface Suggestion { recipe: Recipe; check: RecipeCheck; notes: string[] }

export interface RecipeFilter { slot?: MealSlot; query?: string; tag?: string; source?: Recipe['source']; maxMinutes?: number }

/**
 * Recipes that fit what the person told us. A recipe is left out when it lists an ingredient they avoid, dislike, or that does not fit
 * their diet, or needs equipment they did not list. A recipe with ingredients the app cannot identify is left out whenever a diet or an
 * allergen filter is on, because it cannot be checked. This is a filter on listed ingredients, never a safety guarantee.
 */
export const suggestRecipes = (recipes: Recipe[], prefs: MealPrefs, f: RecipeFilter = {}): Suggestion[] => {
  const q = f.query ? normalizeName(f.query) : '';
  const dislikes = prefs.dislikes.map(normalizeName).filter(Boolean);
  const out: Suggestion[] = [];
  for (const recipe of recipes) {
    if (f.slot && !recipe.slots.includes(f.slot)) continue;
    if (f.source && recipe.source !== f.source) continue;
    if (f.tag && !recipe.tags.includes(f.tag)) continue;
    const total = recipe.prepMinutes + recipe.cookMinutes;
    if (f.maxMinutes !== undefined && total > f.maxMinutes) continue;
    if (q && !normalizeName(recipe.name).includes(q) && !recipe.ingredients.some((i) => normalizeName(i.name).includes(q)) && !recipe.tags.some((t) => normalizeName(t).includes(q))) continue;
    const check = checkRecipe(recipe);
    const filtering = prefs.diet !== 'any' || prefs.avoid.length > 0;
    if (filtering && check.unchecked.length) continue;
    if (prefs.diet !== 'any' && (check.diet === null || !ALLOWED_DIETS[prefs.diet].includes(check.diet))) continue;
    if (check.allergens.some((a) => prefs.avoid.includes(a))) continue;
    if (dislikes.length && recipe.ingredients.some((i) => !i.optional && dislikes.some((d) => normalizeName(i.name).includes(d) || identify(i.name).key === d))) continue;
    if (prefs.equipment.length && recipe.equipment.some((e) => !prefs.equipment.includes(e))) continue;
    if (prefs.maxPrepMinutes !== null && total > prefs.maxPrepMinutes) continue;
    if (prefs.simple && (recipe.ingredients.filter((i) => !i.optional).length > 8 || recipe.steps.length > 5)) continue;
    if (prefs.budgetFriendly && !recipe.tags.includes('inexpensive')) continue;
    const notes: string[] = [];
    if (check.unchecked.length) notes.push(`${check.unchecked.length} ingredient${check.unchecked.length === 1 ? '' : 's'} could not be checked`);
    out.push({ recipe, check, notes });
  }
  return out;
};

// ───────────────────────── a meal's state ─────────────────────────

/**
 * What became of a planned meal.
 *  scheduled   today or later, nothing recorded yet
 *  prepared    cooked ahead (marked, or its linked cooking session was completed)
 *  eaten       the person said they ate it
 *  skipped     the person said they did not
 *  unrecorded  the day has passed and nothing was recorded: unknown. It is not "skipped" and not "missed".
 */
export type MealState = 'scheduled' | 'prepared' | 'eaten' | 'skipped' | 'unrecorded';

export const prepDone = (d: Pick<AppData, 'sessions'>, activityId: string): boolean => {
  const id = activityTaskId(activityId);
  return d.sessions.some((s) => s.entries.some((e) => e.taskId === id && e.outcome === 'completed'));
};

export const mealState = (d: Pick<AppData, 'sessions'>, e: MealEntry, today: ISODate): MealState => {
  if (e.status === 'eaten' || e.status === 'skipped' || e.status === 'prepared') return e.status;
  if (e.prepActivityId && prepDone(d, e.prepActivityId)) return 'prepared';
  return e.date >= today ? 'scheduled' : 'unrecorded';
};

export const entriesFor = (d: Pick<AppData, 'meals'>, date: ISODate): MealEntry[] =>
  d.meals.plan.filter((e) => e.date === date).sort((a, b) => a.slot.localeCompare(b.slot) || a.id.localeCompare(b.id));

/** Leftover servings of a batch that are not yet planned to be eaten. Informational: it never blocks anything. */
export const leftoverServings = (d: Pick<AppData, 'meals'>, batch: MealEntry): number => {
  const eaten = d.meals.plan.filter((e) => e.ref.kind === 'leftover' && e.ref.of === batch.id).reduce((n, e) => n + e.servings, 0);
  return batch.servings - eaten;
};

export const mealMinutes = (r: Recipe): number => r.prepMinutes + r.cookMinutes;

