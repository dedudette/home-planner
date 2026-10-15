import type { ISODate } from '../types';

/**
 * Meals, recipes and shopping.
 *
 * What this data does NOT contain, on purpose: nutrition facts, calories from a database, prices, or any claim that a recipe is safe
 * for an allergy. A person may type their own calorie number on a dish they made; the app never invents one. Allergen and diet
 * filters work from the ingredients a recipe lists and say so.
 */

export const MEAL_SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'] as const;
export type MealSlot = (typeof MEAL_SLOTS)[number];

/** Units the app can add up. Mass and volume families convert inside themselves; every other unit only merges with itself. */
export const UNITS = ['g', 'kg', 'ml', 'l', 'tsp', 'tbsp', 'cup', 'piece', 'clove', 'can', 'bunch', 'pack', 'slice', 'pinch'] as const;
export type Unit = (typeof UNITS)[number];

export const ALLERGENS = ['gluten', 'milk', 'egg', 'peanut', 'tree-nut', 'soy', 'fish', 'shellfish', 'sesame', 'mustard', 'celery', 'sulphites'] as const;
export type Allergen = (typeof ALLERGENS)[number];

/** Strictest diet an ingredient fits. A recipe's diet is the most restrictive of its ingredients, never a claim made by hand. */
export const DIETS = ['vegan', 'vegetarian', 'pescatarian', 'omnivore'] as const;
export type Diet = (typeof DIETS)[number];
export type DietPref = 'any' | 'vegetarian' | 'vegan' | 'pescatarian';

export const SHOP_CATEGORIES = ['produce', 'dairy-eggs', 'meat-fish', 'bakery', 'pantry', 'tinned', 'frozen', 'spices', 'oils-sauces', 'drinks', 'household', 'other'] as const;
export type ShopCategory = (typeof SHOP_CATEGORIES)[number];

export const COOK_EQUIPMENT = ['hob', 'oven', 'microwave', 'blender', 'slow-cooker', 'air-fryer'] as const;
export type CookEquip = (typeof COOK_EQUIPMENT)[number];

export interface Ingredient {
  /** What the recipe calls it. Matched to the ingredient catalogue by name; an unknown name is kept as typed. */
  name: string;
  qty: number | null;
  unit: Unit | null;
  optional?: boolean;
  note?: string;
}

export type RecipeSource = 'starter' | 'personal';

export interface Recipe {
  id: string;
  name: string;
  source: RecipeSource;
  servings: number;
  prepMinutes: number;
  cookMinutes: number;
  slots: MealSlot[];
  tags: string[];
  equipment: CookEquip[];
  ingredients: Ingredient[];
  steps: string[];
  /** Optional, typed by the person for a dish they made. Never filled in by the app. */
  kcalPerServing?: number;
  note?: string;
}

export interface MealSlotSetting { on: boolean; time: string | null }

export interface MealPrefs {
  diet: DietPref;
  /** Allergens the person wants recipes with a matching ingredient left out of suggestions. */
  avoid: Allergen[];
  /** Ingredient names the person does not like (lowercase, as typed). */
  dislikes: string[];
  household: number;
  equipment: CookEquip[];
  maxPrepMinutes: number | null;
  budgetFriendly: boolean;
  simple: boolean;
  slots: Record<MealSlot, MealSlotSetting>;
}

export type MealStatus = 'planned' | 'prepared' | 'eaten' | 'skipped';

export type MealRef =
  | { kind: 'recipe'; id: string }
  | { kind: 'dish'; id: string }
  /** Logged without a recipe: just what the person typed. */
  | { kind: 'free'; text: string }
  /** Eaten from an earlier batch. Adds nothing to shopping, so a batch is never bought twice. */
  | { kind: 'leftover'; of: string };

export interface MealEntry {
  id: string;
  date: ISODate;
  slot: MealSlot;
  ref: MealRef;
  /** What was planned, as written at the time, so history stays readable if a dish is later renamed or deleted. */
  name: string;
  servings: number;
  status: MealStatus;
  statusAt: string | null;
  /** A planned cooking session (an activity) for this meal. Completing that session is what makes the meal "prepared". */
  prepActivityId: string | null;
  /** Typed by the person. Never computed. */
  kcal: number | null;
  note: string;
}

export interface MealsData {
  prefs: MealPrefs;
  dishes: Recipe[];
  plan: MealEntry[];
  favourites: string[];
  recents: string[];
}

export interface ShoppingSource {
  entryId: string | null;
  recipe: string;
  date: ISODate | null;
  qty: number | null;
  unit: Unit | null;
}

export interface ShoppingItem {
  id: string;
  /** Normalised ingredient identity: the same ingredient always has the same key, however a recipe spells it. */
  key: string;
  name: string;
  qty: number | null;
  unit: Unit | null;
  category: ShopCategory;
  optional: boolean;
  checked: boolean;
  /** Already at home: not something to buy. */
  atHome: boolean;
  /** Added by the person. Never touched by a regenerate or an update. */
  manual: boolean;
  /** The person changed the quantity, so a regenerate leaves it alone. */
  edited: boolean;
  note: string;
  /** Which meal contributed how much. Empty for manual items. */
  sources: ShoppingSource[];
}

export interface ShoppingList {
  id: string;
  name: string;
  createdAt: string;
  range: { from: ISODate; to: ISODate } | null;
  /** The plan entries this list was made from. */
  entryIds: string[];
  /** Entries in the range that the person left out when making the list. A later plan change never adds these back. */
  skipped: string[];
  items: ShoppingItem[];
  /** The proposed update the person chose to ignore (a signature of the plan at that moment). Hidden until the plan changes again. */
  ignored: string | null;
}

export interface ShoppingData {
  lists: ShoppingList[];
  /** Ingredients the person always has (salt, oil…): they start as "at home" on every new list. */
  pantry: string[];
}
