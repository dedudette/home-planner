import { identify } from './ingredients';
import { familyOf, formatAmount, round, scaleAmount, sumAmounts, type Family } from './units';
import { SHOP_CATEGORIES, type MealEntry, type Recipe, type ShopCategory, type ShoppingItem, type ShoppingList, type ShoppingSource, type Unit } from './types';
import type { AppData, ISODate } from '../types';
import { recipeOf } from './planner';

/**
 * Shopping arithmetic. All of it happens here, in plain code: scaling a recipe to the servings planned, giving every ingredient one
 * identity, adding only amounts that can honestly be added, and keeping everything else as its own line.
 */

export const CATEGORY_LABEL: Record<ShopCategory, string> = {
  produce: 'Fruit and vegetables', 'dairy-eggs': 'Dairy and eggs', 'meat-fish': 'Meat and fish', bakery: 'Bakery', pantry: 'Dry goods', tinned: 'Tins and jars', frozen: 'Frozen',
  spices: 'Herbs and spices', 'oils-sauces': 'Oils, sauces and stock', drinks: 'Drinks', household: 'Household', other: 'Other',
};

interface Contribution { key: string; name: string; category: ShopCategory; optional: boolean; qty: number | null; unit: Unit | null; source: ShoppingSource }

/** The lines one meal adds to a shopping list: its recipe's ingredients scaled to the servings planned. */
export const contributions = (entry: MealEntry, recipe: Recipe): Contribution[] => {
  const factor = entry.servings / Math.max(1, recipe.servings);
  return recipe.ingredients.map((ing) => {
    const id = identify(ing.name);
    // "A pinch" is a way of seasoning, not something anyone buys by the pinch: the line says what is needed and no number.
    const amount = ing.unit === 'pinch' ? { qty: null, unit: null } : scaleAmount({ qty: ing.qty, unit: ing.unit }, factor);
    return {
      key: id.key, name: id.name, category: id.category, optional: !!ing.optional, qty: amount.qty, unit: amount.unit,
      source: { entryId: entry.id, recipe: recipe.name, date: entry.date, qty: amount.qty, unit: amount.unit },
    };
  });
};

const COUNTED: Unit[] = ['piece', 'clove', 'can', 'bunch', 'pack', 'slice'];

const groupId = (key: string, optional: boolean, family: Family) => `g:${key}|${optional ? 'opt' : 'req'}|${family}`;

/**
 * Build the generated lines for a set of meals. Same ingredient, same kind of unit: one line with the amounts added. Different
 * kinds of unit (grams against pieces, or a cup against grams) stay separate, because converting needs the density of the food.
 * Optional ingredients are their own lines so they are never quietly counted as needed. An ingredient that appears with no amount
 * ("salt, to taste") joins another line for the same ingredient instead of making a second, empty one.
 */
export const generateItems = (parts: { entry: MealEntry; recipe: Recipe }[], pantry: string[] = []): ShoppingItem[] => {
  const groups = new Map<string, Contribution[]>();
  for (const p of parts) {
    for (const c of contributions(p.entry, p.recipe)) {
      const id = groupId(c.key, c.optional, c.qty === null ? 'none' : familyOf(c.unit));
      groups.set(id, [...(groups.get(id) ?? []), c]);
    }
  }
  // fold amount-less lines into a sibling line of the same ingredient and optionality
  for (const [id, cs] of [...groups]) {
    if (!id.endsWith('|none')) continue;
    const sibling = [...groups.keys()].find((k) => k !== id && k.startsWith(id.slice(0, id.length - 'none'.length)));
    if (!sibling) continue;
    groups.set(sibling, [...(groups.get(sibling) as Contribution[]), ...cs]);
    groups.delete(id);
  }
  const items: ShoppingItem[] = [];
  for (const [id, cs] of groups) {
    const raw = sumAmounts(cs.map((c) => ({ qty: c.qty, unit: c.unit })));
    // Nobody buys 0.75 of a can or 5.75 cloves of garlic: counted things are rounded up to whole ones, once, on the total (each meal's
    // own scaled amount stays exact under "needed for"). Measured amounts (g, ml, spoons) are left as they are.
    const total = raw.qty !== null && raw.unit !== null && COUNTED.includes(raw.unit) ? { qty: Math.ceil(raw.qty - 1e-9), unit: raw.unit } : raw;
    items.push({
      id, key: cs[0].key, name: cs[0].name, qty: total.qty, unit: total.unit, category: cs[0].category, optional: cs[0].optional, checked: false,
      atHome: pantry.includes(cs[0].key), manual: false, edited: false, note: '', sources: cs.map((c) => c.source),
    });
  }
  return sortItems(items);
};

export const sortItems = (items: ShoppingItem[]): ShoppingItem[] =>
  [...items].sort((a, b) => SHOP_CATEGORIES.indexOf(a.category) - SHOP_CATEGORIES.indexOf(b.category) || a.name.localeCompare(b.name) || Number(a.optional) - Number(b.optional));

/** "4 egg" reads as "4 eggs": a counted ingredient is pluralised after a number above one. Names already plural are left alone. */
export const pluralName = (name: string, qty: number | null, unit: Unit | null): string => {
  if (unit !== 'piece' || qty === null || qty <= 1) return name;
  const words = name.split(' ');
  const w = words[words.length - 1];
  if (/s$/.test(w) && !/ss$/.test(w)) return name;
  const plural = /[^aeiou]o$/.test(w) ? `${w}es` : /[^aeiou]y$/.test(w) ? `${w.slice(0, -1)}ies` : /(s|x|ch|sh)$/.test(w) ? `${w}es` : `${w}s`;
  return [...words.slice(0, -1), plural].join(' ');
};

export const itemText = (i: Pick<ShoppingItem, 'qty' | 'unit' | 'name'>): string => {
  const amt = formatAmount(i.qty, i.unit);
  return amt ? `${amt} ${pluralName(i.name, i.qty, i.unit)}` : i.name;
};

// ───────────────────────── meals in a date range ─────────────────────────

/** Meals that bring ingredients to a list: planned with a recipe, not skipped, not a leftover (a batch is bought once, with its first meal). */
export const shoppableEntries = (plan: MealEntry[], from: ISODate, to: ISODate): MealEntry[] =>
  plan.filter((e) => e.date >= from && e.date <= to && e.status !== 'skipped' && (e.ref.kind === 'recipe' || e.ref.kind === 'dish')).sort((a, b) => a.date.localeCompare(b.date) || a.slot.localeCompare(b.slot));

// ───────────────────────── when the meal plan changes ─────────────────────────

export type ItemChange =
  | { kind: 'add'; item: ShoppingItem }
  | { kind: 'remove'; item: ShoppingItem; kept: boolean }
  | { kind: 'qty'; item: ShoppingItem; from: number | null; to: number | null }
  | { kind: 'sources'; item: ShoppingItem };

export interface ProposedUpdate { signature: string; changes: ItemChange[]; next: ShoppingItem[] }

const fnv = (s: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
};

const sourcesKey = (s: ShoppingSource[]) => s.map((x) => `${x.entryId}:${x.qty}:${x.unit}`).sort().join(',');

export const signatureOf = (fresh: ShoppingItem[]): string => fnv(fresh.map((i) => `${i.id}=${i.qty}${i.unit ?? ''}@${sourcesKey(i.sources)}`).join(';'));

/**
 * What would change if this list were rebuilt from the meal plan as it is now. Nothing is changed here: the person is shown the
 * differences and decides. Manual items are never touched, purchased lines stay purchased, quantities the person edited are kept,
 * and a line the person already bought is never silently removed.
 * Returns null when the plan and the list agree, or when the person already chose to ignore exactly this change.
 */
export const proposeUpdate = (list: ShoppingList, fresh: ShoppingItem[]): ProposedUpdate | null => {
  const signature = signatureOf(fresh);
  const generated = list.items.filter((i) => !i.manual);
  const freshById = new Map(fresh.map((i) => [i.id, i]));
  const changes: ItemChange[] = [];
  const next: ShoppingItem[] = list.items.filter((i) => i.manual);

  for (const cur of generated) {
    const f = freshById.get(cur.id);
    if (!f) {
      // Gone from the plan. If it was already bought, it stays (with a note); otherwise it goes.
      if (cur.checked) { next.push({ ...cur, note: cur.note || 'You already bought this. No meal needs it now.' }); changes.push({ kind: 'remove', item: cur, kept: true }); }
      else changes.push({ kind: 'remove', item: cur, kept: false });
      continue;
    }
    const qtyChanged = !cur.edited && (cur.qty !== f.qty || cur.unit !== f.unit);
    if (qtyChanged) {
      changes.push({ kind: 'qty', item: cur, from: cur.qty, to: f.qty });
      const more = cur.checked && cur.unit === f.unit && cur.qty !== null && f.qty !== null && f.qty > cur.qty ? f.qty - cur.qty : 0;
      next.push({ ...cur, qty: f.qty, unit: f.unit, sources: f.sources, note: more ? `The plan now needs ${formatAmount(round(more), f.unit)} more than you bought.` : cur.note });
    } else if (sourcesKey(cur.sources) !== sourcesKey(f.sources)) {
      changes.push({ kind: 'sources', item: cur });
      next.push({ ...cur, sources: f.sources });
    } else next.push(cur);
  }
  const have = new Set(generated.map((i) => i.id));
  for (const f of fresh) if (!have.has(f.id)) { next.push(f); changes.push({ kind: 'add', item: f }); }

  if (!changes.length || list.ignored === signature) return null;
  return { signature, changes, next: sortItems(next) };
};

// ───────────────────────── sharing ─────────────────────────

/** Plain text a person can paste into Notes, Messages or Reminders, or print. Items already at home are listed apart. */
export const exportText = (list: ShoppingList): string => {
  const lines: string[] = [list.name];
  const buy = list.items.filter((i) => !i.atHome);
  const home = list.items.filter((i) => i.atHome);
  for (const cat of SHOP_CATEGORIES) {
    const here = sortItems(buy.filter((i) => i.category === cat));
    if (!here.length) continue;
    lines.push('', CATEGORY_LABEL[cat]);
    for (const i of here) lines.push(`${i.checked ? '[x]' : '[ ]'} ${itemText(i)}${i.optional ? ' (optional)' : ''}${i.note ? ` - ${i.note}` : ''}`);
  }
  if (home.length) { lines.push('', 'Already at home'); for (const i of sortItems(home)) lines.push(`- ${itemText(i)}`); }
  return lines.join('\n');
};

// ───────────────────────── a list against the plan as it is now ─────────────────────────


/**
 * The meals a list is currently built from: everything in its date range except what the person left out when making it, or, for a
 * list made from hand-picked meals without a range, just those meals. A meal whose dish was since deleted brings nothing and is counted.
 */
export const listEntries = (d: Pick<AppData, 'meals'>, list: ShoppingList): { entries: MealEntry[]; missing: number } => {
  const pool = list.range
    ? shoppableEntries(d.meals.plan, list.range.from, list.range.to).filter((e) => !list.skipped.includes(e.id))
    : d.meals.plan.filter((e) => list.entryIds.includes(e.id) && e.status !== 'skipped' && (e.ref.kind === 'recipe' || e.ref.kind === 'dish'));
  const entries = pool.filter((e) => recipeOf(d, e.ref));
  return { entries, missing: pool.length - entries.length };
};

/** The generated lines for a list from the meal plan as it is now. Compare with the list itself using `proposeUpdate`. */
export const freshItemsFor = (d: Pick<AppData, 'meals' | 'shopping'>, list: ShoppingList): { items: ShoppingItem[]; entryIds: string[]; missing: number } => {
  const { entries, missing } = listEntries(d, list);
  const parts = entries.map((entry) => ({ entry, recipe: recipeOf(d, entry.ref) as Recipe }));
  return { items: generateItems(parts, d.shopping.pantry), entryIds: entries.map((e) => e.id), missing };
};
