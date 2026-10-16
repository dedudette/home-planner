import {
  ALLERGENS, COOK_EQUIPMENT, MEAL_SLOTS, SHOP_CATEGORIES, UNITS,
  type DietPref, type Ingredient, type MealEntry, type MealPrefs, type MealRef, type MealSlot, type MealsData, type MealStatus, type Recipe, type ShoppingData, type ShoppingItem, type ShoppingList, type ShoppingSource,
} from '../domain/meals/types';
import { emptyMeals, emptyShopping } from '../domain/meals/defaults';
import { isClock } from '../domain/modules/registry';
import type { ISODate } from '../domain/types';
import { bool, Ctx, date, intn, isObj, isoStamp, keepNewest, list, num, oneOf, oneOfOrNull, str, strList } from './primitives';

/** Validation for meals and shopping data (schema v3). Same rules as schema.ts: repair what is readable, count and say what is not. */

export const MAX_MEALS = { dishes: 200, plan: 4000, lists: 30, itemsPerList: 400, ingredients: 60, steps: 40, sources: 30, ids: 600 };

const DIETS: readonly DietPref[] = ['any', 'vegetarian', 'vegan', 'pescatarian'];
const STATUSES: readonly MealStatus[] = ['planned', 'prepared', 'eaten', 'skipped'];

const qtyOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(100000, Math.round(v * 1000) / 1000) : null);

const validateIngredient = (raw: unknown): Ingredient | null => {
  if (!isObj(raw) || !str(raw.name).trim()) return null;
  const unit = oneOfOrNull(raw.unit, UNITS);
  const qty = qtyOrNull(raw.qty);
  const ing: Ingredient = { name: str(raw.name, '', 80).trim(), qty, unit: qty === null ? null : unit };
  if (raw.optional === true) ing.optional = true;
  if (typeof raw.note === 'string' && raw.note.trim()) ing.note = raw.note.slice(0, 80);
  return ing;
};

export const validateRecipe = (raw: unknown, c: Ctx): Recipe | null => {
  if (!isObj(raw) || typeof raw.id !== 'string' || !str(raw.name).trim()) { c.dropped++; return null; }
  const ingredients = (Array.isArray(raw.ingredients) ? raw.ingredients : []).slice(0, MAX_MEALS.ingredients).map(validateIngredient).filter((x): x is Ingredient => !!x);
  const r: Recipe = {
    id: raw.id.slice(0, 60), name: str(raw.name, '', 80).trim(), source: 'personal', servings: intn(raw.servings, 2, 1, 50), prepMinutes: intn(raw.prepMinutes, 10, 0, 1440), cookMinutes: intn(raw.cookMinutes, 20, 0, 1440),
    slots: list(raw.slots, MEAL_SLOTS), tags: strList(raw.tags, 10).map((t) => t.slice(0, 30)), equipment: list(raw.equipment, COOK_EQUIPMENT), ingredients,
    steps: strList(raw.steps, MAX_MEALS.steps).map((s) => s.slice(0, 500)),
  };
  if (!r.slots.length) r.slots = ['lunch', 'dinner'];
  if (typeof raw.kcalPerServing === 'number' && raw.kcalPerServing >= 0 && raw.kcalPerServing <= 5000) r.kcalPerServing = Math.round(raw.kcalPerServing);
  if (typeof raw.note === 'string' && raw.note.trim()) r.note = raw.note.slice(0, 300);
  return r;
};

const validatePrefs = (raw: unknown): MealPrefs => {
  const d = emptyMeals().prefs;
  if (!isObj(raw)) return d;
  const slotsRaw = isObj(raw.slots) ? raw.slots : {};
  const slots = Object.fromEntries(MEAL_SLOTS.map((s) => {
    const x = isObj(slotsRaw[s]) ? (slotsRaw[s] as Record<string, unknown>) : {};
    return [s, { on: bool(x.on, d.slots[s].on), time: isClock(x.time) ? x.time : null }];
  })) as MealPrefs['slots'];
  return {
    diet: oneOf(raw.diet, DIETS, 'any'), avoid: list(raw.avoid, ALLERGENS), dislikes: strList(raw.dislikes, 40).map((x) => x.trim().toLowerCase().slice(0, 40)).filter(Boolean),
    household: intn(raw.household, 1, 1, 12), equipment: list(raw.equipment, COOK_EQUIPMENT),
    maxPrepMinutes: typeof raw.maxPrepMinutes === 'number' && raw.maxPrepMinutes >= 5 ? intn(raw.maxPrepMinutes, 45, 5, 480) : null,
    budgetFriendly: bool(raw.budgetFriendly), simple: bool(raw.simple), slots,
  };
};

const validateRef = (raw: unknown): MealRef | null => {
  if (!isObj(raw)) return null;
  if ((raw.kind === 'recipe' || raw.kind === 'dish') && typeof raw.id === 'string' && raw.id) return { kind: raw.kind, id: raw.id.slice(0, 60) };
  if (raw.kind === 'free' && typeof raw.text === 'string') return { kind: 'free', text: raw.text.slice(0, 120) };
  if (raw.kind === 'leftover' && typeof raw.of === 'string' && raw.of) return { kind: 'leftover', of: raw.of.slice(0, 60) };
  return null;
};

const validateEntry = (raw: unknown): MealEntry | null => {
  if (!isObj(raw) || typeof raw.id !== 'string' || !date(raw.date)) return null;
  const slot = oneOfOrNull(raw.slot, MEAL_SLOTS);
  const ref = validateRef(raw.ref);
  if (!slot || !ref) return null;
  return {
    id: raw.id.slice(0, 60), date: raw.date as ISODate, slot: slot as MealSlot, ref, name: str(raw.name, ref.kind === 'free' ? ref.text : 'Meal', 120),
    servings: Math.round(num(raw.servings, 1, 0.5, 50) * 2) / 2, status: oneOf(raw.status, STATUSES, 'planned'),
    statusAt: typeof raw.statusAt === 'string' && !Number.isNaN(Date.parse(raw.statusAt)) ? raw.statusAt : null,
    prepActivityId: typeof raw.prepActivityId === 'string' ? raw.prepActivityId.slice(0, 60) : null,
    kcal: typeof raw.kcal === 'number' && raw.kcal >= 0 && raw.kcal <= 10000 ? Math.round(raw.kcal) : null, note: str(raw.note, '', 200),
  };
};

export const validateMeals = (raw: unknown, c: Ctx): MealsData => {
  const d = emptyMeals();
  if (raw === undefined) return d;
  if (!isObj(raw)) { c.note('Your meals data was unreadable and was reset.'); return d; }
  const ids = new Set<string>();
  const dishes: Recipe[] = [];
  for (const x of (Array.isArray(raw.dishes) ? raw.dishes : []).slice(0, MAX_MEALS.dishes)) {
    const r = validateRecipe(x, c);
    if (r && !ids.has(r.id)) { ids.add(r.id); dishes.push(r); } else if (r) c.dropped++;
  }
  const seen = new Set<string>();
  const plan: MealEntry[] = [];
  for (const x of Array.isArray(raw.plan) ? raw.plan : []) {
    const e = validateEntry(x);
    if (!e || seen.has(e.id)) { c.dropped++; continue; }
    seen.add(e.id); plan.push(e);
  }
  plan.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return {
    prefs: validatePrefs(raw.prefs), dishes, plan: keepNewest(plan, MAX_MEALS.plan, c, 'planned meals'),
    favourites: strList(raw.favourites, 100).map((x) => x.slice(0, 60)), recents: strList(raw.recents, 12).map((x) => x.slice(0, 60)),
  };
};

const validateSource = (raw: unknown): ShoppingSource | null => {
  if (!isObj(raw)) return null;
  const qty = qtyOrNull(raw.qty);
  return { entryId: typeof raw.entryId === 'string' ? raw.entryId.slice(0, 60) : null, recipe: str(raw.recipe, '', 80), date: date(raw.date), qty, unit: qty === null ? null : oneOfOrNull(raw.unit, UNITS) };
};

const validateItem = (raw: unknown): ShoppingItem | null => {
  if (!isObj(raw) || typeof raw.id !== 'string' || !str(raw.name).trim()) return null;
  const qty = qtyOrNull(raw.qty);
  return {
    id: raw.id.slice(0, 120), key: str(raw.key, `custom:${str(raw.name).toLowerCase()}`, 100), name: str(raw.name, '', 100).trim(), qty, unit: qty === null ? null : oneOfOrNull(raw.unit, UNITS),
    category: oneOf(raw.category, SHOP_CATEGORIES, 'other'), optional: bool(raw.optional), checked: bool(raw.checked), atHome: bool(raw.atHome), manual: bool(raw.manual), edited: bool(raw.edited),
    note: str(raw.note, '', 200), sources: (Array.isArray(raw.sources) ? raw.sources : []).slice(0, MAX_MEALS.sources).map(validateSource).filter((x): x is ShoppingSource => !!x),
  };
};

const validateList = (raw: unknown, c: Ctx): ShoppingList | null => {
  if (!isObj(raw) || typeof raw.id !== 'string') return null;
  const seen = new Set<string>();
  const items: ShoppingItem[] = [];
  for (const x of (Array.isArray(raw.items) ? raw.items : []).slice(0, MAX_MEALS.itemsPerList)) {
    const i = validateItem(x);
    if (!i || seen.has(i.id)) { c.dropped++; continue; }
    seen.add(i.id); items.push(i);
  }
  const range = isObj(raw.range) && date(raw.range.from) && date(raw.range.to) ? { from: raw.range.from as ISODate, to: raw.range.to as ISODate } : null;
  return {
    id: raw.id.slice(0, 60), name: str(raw.name, 'Shopping list', 80), createdAt: isoStamp(raw.createdAt, new Date(0).toISOString()), range,
    entryIds: strList(raw.entryIds, MAX_MEALS.ids), skipped: strList(raw.skipped, MAX_MEALS.ids), items, ignored: typeof raw.ignored === 'string' ? raw.ignored.slice(0, 40) : null,
  };
};

export const validateShopping = (raw: unknown, c: Ctx): ShoppingData => {
  const d = emptyShopping();
  if (raw === undefined) return d;
  if (!isObj(raw)) { c.note('Your shopping lists were unreadable and were reset.'); return d; }
  const ids = new Set<string>();
  const lists: ShoppingList[] = [];
  for (const x of Array.isArray(raw.lists) ? raw.lists : []) {
    const l = validateList(x, c);
    if (l && !ids.has(l.id)) { ids.add(l.id); lists.push(l); } else c.dropped++;
  }
  return { lists: keepNewest(lists, MAX_MEALS.lists, c, 'shopping lists'), pantry: [...new Set(strList(raw.pantry, 300).map((x) => x.slice(0, 100)))] };
};
