import { MAX_MEALS } from '../storage/mealsSchema';
import type { MealEntry, MealPrefs, MealSlot, MealSlotSetting, MealStatus, Recipe, ShoppingItem, ShoppingList } from '../domain/meals/types';
import type { AppData } from '../domain/types';

/**
 * Meals, recipes and shopping. Pure and idempotent: replaying an action gives the same data. Nothing here computes shopping amounts
 * (that is domain/meals/shopping.ts, whose result arrives as plain data in the action) and nothing touches the person's log.
 */
export type MealsAction =
  | { type: 'MEALS_PREFS'; patch: Partial<Omit<MealPrefs, 'slots'>> }
  | { type: 'MEALS_SLOT'; slot: MealSlot; patch: Partial<MealSlotSetting> }
  | { type: 'MEAL_SAVE'; entry: MealEntry }
  | { type: 'MEAL_DELETE'; id: string }
  | { type: 'MEAL_STATUS'; id: string; status: MealStatus; at: string | null }
  | { type: 'DISH_SAVE'; dish: Recipe }
  | { type: 'DISH_DELETE'; id: string }
  | { type: 'FAVOURITE'; id: string; on: boolean }
  | { type: 'SHOP_CREATE'; list: ShoppingList }
  | { type: 'SHOP_DELETE'; id: string }
  | { type: 'SHOP_RENAME'; id: string; name: string }
  | { type: 'SHOP_ITEM_SAVE'; listId: string; item: ShoppingItem }
  | { type: 'SHOP_ITEM_DELETE'; listId: string; itemId: string }
  | { type: 'SHOP_ITEM_CHECK'; listId: string; itemId: string; checked: boolean }
  | { type: 'SHOP_ITEM_HOME'; listId: string; itemId: string; atHome: boolean }
  | { type: 'SHOP_APPLY'; listId: string; next: ShoppingItem[]; entryIds: string[] }
  | { type: 'SHOP_IGNORE'; listId: string; signature: string }
  | { type: 'PANTRY'; key: string; on: boolean };

const upsert = <T extends { id: string }>(xs: T[], x: T): T[] => (xs.some((y) => y.id === x.id) ? xs.map((y) => (y.id === x.id ? x : y)) : [...xs, x]);

const withList = (d: AppData, id: string, f: (l: ShoppingList) => ShoppingList): AppData => {
  const cur = d.shopping.lists.find((l) => l.id === id);
  if (!cur) return d;
  const next = f(cur);
  return next === cur ? d : { ...d, shopping: { ...d.shopping, lists: d.shopping.lists.map((l) => (l.id === id ? next : l)) } };
};

const withItem = (d: AppData, listId: string, itemId: string, f: (i: ShoppingItem) => ShoppingItem): AppData =>
  withList(d, listId, (l) => (l.items.some((i) => i.id === itemId) ? { ...l, items: l.items.map((i) => (i.id === itemId ? f(i) : i)) } : l));

export const mealsReducer = (d: AppData, a: MealsAction): AppData => {
  switch (a.type) {
    case 'MEALS_PREFS': return { ...d, meals: { ...d.meals, prefs: { ...d.meals.prefs, ...a.patch } } };
    case 'MEALS_SLOT': return { ...d, meals: { ...d.meals, prefs: { ...d.meals.prefs, slots: { ...d.meals.prefs.slots, [a.slot]: { ...d.meals.prefs.slots[a.slot], ...a.patch } } } } };
    case 'MEAL_SAVE': {
      const plan = upsert(d.meals.plan, a.entry).slice(-MAX_MEALS.plan);
      const id = a.entry.ref.kind === 'recipe' || a.entry.ref.kind === 'dish' ? a.entry.ref.id : null;
      const recents = id ? [id, ...d.meals.recents.filter((x) => x !== id)].slice(0, 12) : d.meals.recents;
      return { ...d, meals: { ...d.meals, plan, recents } };
    }
    case 'MEAL_DELETE': return d.meals.plan.some((e) => e.id === a.id) ? { ...d, meals: { ...d.meals, plan: d.meals.plan.filter((e) => e.id !== a.id) } } : d;
    case 'MEAL_STATUS': {
      const cur = d.meals.plan.find((e) => e.id === a.id);
      if (!cur || (cur.status === a.status && cur.statusAt === a.at)) return d;
      return { ...d, meals: { ...d.meals, plan: d.meals.plan.map((e) => (e.id === a.id ? { ...e, status: a.status, statusAt: a.status === 'planned' ? null : a.at } : e)) } };
    }
    case 'DISH_SAVE': return { ...d, meals: { ...d.meals, dishes: upsert(d.meals.dishes, { ...a.dish, source: 'personal' as const }).slice(-MAX_MEALS.dishes) } };
    case 'DISH_DELETE': {
      if (!d.meals.dishes.some((x) => x.id === a.id)) return d;
      return { ...d, meals: { ...d.meals, dishes: d.meals.dishes.filter((x) => x.id !== a.id), favourites: d.meals.favourites.filter((x) => x !== a.id), recents: d.meals.recents.filter((x) => x !== a.id) } };
    }
    case 'FAVOURITE': {
      const has = d.meals.favourites.includes(a.id);
      if (has === a.on) return d;
      return { ...d, meals: { ...d.meals, favourites: a.on ? [...d.meals.favourites, a.id] : d.meals.favourites.filter((x) => x !== a.id) } };
    }
    case 'SHOP_CREATE': return d.shopping.lists.some((l) => l.id === a.list.id) ? d : { ...d, shopping: { ...d.shopping, lists: [...d.shopping.lists, a.list].slice(-MAX_MEALS.lists) } };
    case 'SHOP_DELETE': return d.shopping.lists.some((l) => l.id === a.id) ? { ...d, shopping: { ...d.shopping, lists: d.shopping.lists.filter((l) => l.id !== a.id) } } : d;
    case 'SHOP_RENAME': return withList(d, a.id, (l) => ({ ...l, name: a.name.trim().slice(0, 80) || l.name }));
    case 'SHOP_ITEM_SAVE': return withList(d, a.listId, (l) => ({ ...l, items: upsert(l.items, a.item).slice(0, MAX_MEALS.itemsPerList) }));
    case 'SHOP_ITEM_DELETE': return withList(d, a.listId, (l) => (l.items.some((i) => i.id === a.itemId) ? { ...l, items: l.items.filter((i) => i.id !== a.itemId) } : l));
    case 'SHOP_ITEM_CHECK': return withItem(d, a.listId, a.itemId, (i) => (i.checked === a.checked ? i : { ...i, checked: a.checked }));
    case 'SHOP_ITEM_HOME': return withItem(d, a.listId, a.itemId, (i) => (i.atHome === a.atHome ? i : { ...i, atHome: a.atHome }));
    case 'SHOP_APPLY': return withList(d, a.listId, (l) => ({ ...l, items: a.next, entryIds: a.entryIds, ignored: null }));
    case 'SHOP_IGNORE': return withList(d, a.listId, (l) => (l.ignored === a.signature ? l : { ...l, ignored: a.signature }));
    case 'PANTRY': {
      const has = d.shopping.pantry.includes(a.key);
      if (has === a.on) return d;
      return { ...d, shopping: { ...d.shopping, pantry: a.on ? [...d.shopping.pantry, a.key] : d.shopping.pantry.filter((x) => x !== a.key) } };
    }
    default: return d;
  }
};
