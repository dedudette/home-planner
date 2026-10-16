import { describe, expect, it } from 'vitest';
import { emptyAppData } from '../src/domain/appdata';
import { emptyMeals } from '../src/domain/meals/defaults';
import { identify, INGREDIENTS, lookupIngredient, normalizeName } from '../src/domain/meals/ingredients';
import { checkRecipe, leftoverServings, mealState, recipeById, suggestRecipes } from '../src/domain/meals/planner';
import { STARTER_BY_ID, STARTER_RECIPES } from '../src/domain/meals/recipes';
import { exportText, generateItems, itemText, pluralName, proposeUpdate, shoppableEntries, signatureOf } from '../src/domain/meals/shopping';
import type { MealEntry, Recipe, ShoppingList } from '../src/domain/meals/types';
import { familyOf, formatAmount, sumAmounts } from '../src/domain/meals/units';
import { activityToTask } from '../src/domain/modules/activities';
import { contentFor } from '../src/domain/modules/content';
import type { AppData } from '../src/domain/types';
import { reducer, type Stamp } from '../src/state/reducer';
import { validateAppData } from '../src/storage/schema';
import { TODAY } from './helpers';

const entry = (over: Partial<MealEntry> & { id: string; recipe?: string }): MealEntry => {
  const { recipe, ...rest } = over;
  return { date: TODAY, slot: 'dinner', ref: { kind: 'recipe', id: recipe ?? 'lentil-soup' }, name: recipe ?? 'Red lentil soup', servings: 4, status: 'planned', statusAt: null, prepActivityId: null, kcal: null, note: '', ...rest };
};
const parts = (entries: MealEntry[]) => entries.map((e) => ({ entry: e, recipe: STARTER_BY_ID.get((e.ref as { id: string }).id) as Recipe }));
const base = (patch: Partial<AppData['meals']> = {}): AppData => ({ ...emptyAppData(TODAY), meals: { ...emptyMeals(), ...patch } });
const stamp = (today = TODAY): Stamp => ({ now: `${today}T09:00:00.000Z`, today, hour: 9, tz: 0 });

describe('adding up amounts honestly', () => {
  it('adds inside a family and picks a sensible unit', () => {
    expect(sumAmounts([{ qty: 600, unit: 'g' }, { qty: 0.6, unit: 'kg' }])).toEqual({ qty: 1.2, unit: 'kg' });
    expect(sumAmounts([{ qty: 300, unit: 'g' }, { qty: 150, unit: 'g' }])).toEqual({ qty: 450, unit: 'g' });
    expect(sumAmounts([{ qty: 1, unit: 'tbsp' }, { qty: 2, unit: 'tbsp' }])).toEqual({ qty: 3, unit: 'tbsp' });
    expect(sumAmounts([{ qty: 1, unit: 'tbsp' }, { qty: 1, unit: 'tsp' }])).toEqual({ qty: 20, unit: 'ml' });
    expect(sumAmounts([{ qty: 700, unit: 'ml' }, { qty: 0.5, unit: 'l' }])).toEqual({ qty: 1.2, unit: 'l' });
    expect(sumAmounts([{ qty: 2, unit: 'clove' }, { qty: 3, unit: 'clove' }])).toEqual({ qty: 5, unit: 'clove' });
  });
  it('knows which units are one family and which never are', () => {
    expect(familyOf('g')).toBe(familyOf('kg'));
    expect(familyOf('ml')).toBe(familyOf('cup'));
    expect(familyOf('g')).not.toBe(familyOf('ml'));
    expect(familyOf('piece')).not.toBe(familyOf('clove'));
    expect(familyOf(null)).toBe('none');
  });
  it('a missing amount stays missing instead of becoming zero', () => {
    expect(sumAmounts([{ qty: null, unit: null }, { qty: null, unit: null }]).qty).toBeNull();
    expect(sumAmounts([{ qty: null, unit: 'g' }, { qty: 100, unit: 'g' }])).toEqual({ qty: 100, unit: 'g' });
    expect(formatAmount(null, null)).toBe('');
  });
  it('formats for reading', () => {
    expect(formatAmount(250, 'g')).toBe('250 g');
    expect(formatAmount(1.5, 'kg')).toBe('1.5 kg');
    expect(formatAmount(3, 'clove')).toBe('3 cloves');
    expect(formatAmount(1, 'clove')).toBe('1 clove');
    expect(formatAmount(2, 'piece')).toBe('2');
  });
});

describe('every ingredient has one identity', () => {
  it('folds plurals, case and wording to the same key', () => {
    const keys = ['tomato', 'Tomatoes', 'fresh tomatoes', 'ripe tomato'].map((n) => identify(n).key);
    expect(new Set(keys)).toEqual(new Set(['tomato']));
    expect(identify('spring onions').key).toBe(identify('scallion').key);
    expect(identify('red lentils').key).toBe(identify('Split Red Lentils').key);
    expect(identify('tinned chopped tomatoes').key).not.toBe(identify('tomato').key);
    expect(normalizeName('Garlic (crushed)')).toBe('garlic');
  });
  it('an unknown ingredient keeps its own stable identity and is not pretended to be checked', () => {
    const a = identify('Dragon fruit'), b = identify('dragon fruits');
    expect(a.known).toBe(false);
    expect(a.key).toBe(b.key);
    expect(a.diet).toBeNull();
    expect(a.allergens).toEqual([]);
  });
  it('catalogue names and aliases never collide on different ingredients', () => {
    const seen = new Map<string, string>();
    for (const i of INGREDIENTS) for (const n of [i.name, i.id, ...i.aliases]) {
      const k = normalizeName(n);
      expect(seen.get(k) ?? i.id, `"${n}" is claimed by ${seen.get(k)} and ${i.id}`).toBe(i.id);
      seen.set(k, i.id);
    }
  });
});

describe('the starter recipes', () => {
  it('have unique ids, real method steps and structured ingredients', () => {
    expect(new Set(STARTER_RECIPES.map((r) => r.id)).size).toBe(STARTER_RECIPES.length);
    for (const r of STARTER_RECIPES) {
      expect(r.steps.length, r.id).toBeGreaterThan(0);
      expect(r.servings, r.id).toBeGreaterThanOrEqual(1);
      expect(r.ingredients.length, r.id).toBeGreaterThan(0);
      expect(r.slots.length, r.id).toBeGreaterThan(0);
      for (const i of r.ingredients) { if (i.qty !== null) { expect(i.qty, `${r.id}/${i.name}`).toBeGreaterThan(0); expect(i.unit, `${r.id}/${i.name} has a quantity but no unit`).not.toBeNull(); } }
    }
  });
  it('use only ingredients the catalogue knows, so every one can be checked for diet and allergens', () => {
    for (const r of STARTER_RECIPES) for (const i of r.ingredients) expect(lookupIngredient(i.name), `${r.id}: "${i.name}"`).not.toBeNull();
  });
  it('carry diet tags that agree with what their ingredients actually are', () => {
    for (const r of STARTER_RECIPES) {
      const c = checkRecipe(r);
      if (r.tags.includes('vegan')) expect(c.diet, r.id).toBe('vegan');
      if (r.tags.includes('vegetarian')) expect(['vegan', 'vegetarian'], r.id).toContain(c.diet);
      if (r.tags.includes('pescatarian')) expect(c.diet, r.id).toBe('pescatarian');
      if (!r.tags.some((t) => ['vegan', 'vegetarian', 'pescatarian'].includes(t))) expect(['omnivore'], `${r.id} is untagged but ${c.diet}`).toContain(c.diet);
    }
  });
  it('are mostly inexpensive and meat-free, and there are enough of them to plan a week', () => {
    expect(STARTER_RECIPES.length).toBeGreaterThanOrEqual(20);
    expect(STARTER_RECIPES.filter((r) => r.tags.includes('vegetarian') || r.tags.includes('vegan')).length / STARTER_RECIPES.length).toBeGreaterThan(0.75);
    for (const slot of ['breakfast', 'lunch', 'dinner', 'snack'] as const) expect(STARTER_RECIPES.filter((r) => r.slots.includes(slot)).length, slot).toBeGreaterThanOrEqual(3);
  });
  it('hold no nutrition figures and no prices anywhere', () => {
    const text = JSON.stringify(STARTER_RECIPES).toLowerCase();
    for (const w of ['kcal', 'calorie', 'protein', 'carb', '£', '$', '€', 'price', 'cost']) expect(text.includes(w), w).toBe(false);
  });
});

describe('suggesting recipes from what a person told us', () => {
  const prefs = emptyMeals().prefs;
  const names = (xs: { recipe: Recipe }[]) => xs.map((x) => x.recipe.id);
  it('with nothing set, everything is offered', () => expect(suggestRecipes(STARTER_RECIPES, prefs)).toHaveLength(STARTER_RECIPES.length));
  it('a vegan diet leaves out eggs, milk, honey and fish and keeps the rest', () => {
    const out = names(suggestRecipes(STARTER_RECIPES, { ...prefs, diet: 'vegan' }));
    expect(out).toContain('lentil-soup');
    for (const id of ['scrambled-eggs-toast', 'porridge-banana', 'tuna-sweetcorn-pasta', 'chicken-veg-traybake', 'overnight-oats']) expect(out, id).not.toContain(id);
    for (const id of out) expect(checkRecipe(STARTER_BY_ID.get(id) as Recipe).diet, id).toBe('vegan');
  });
  it('vegetarian allows eggs and dairy but never meat or fish', () => {
    const out = names(suggestRecipes(STARTER_RECIPES, { ...prefs, diet: 'vegetarian' }));
    expect(out).toContain('shakshuka');
    expect(out).not.toContain('chicken-veg-traybake');
    expect(out).not.toContain('tuna-sweetcorn-pasta');
    expect(names(suggestRecipes(STARTER_RECIPES, { ...prefs, diet: 'pescatarian' }))).toContain('tuna-sweetcorn-pasta');
  });
  it('an avoided allergen removes every recipe with a matching listed ingredient', () => {
    for (const a of ['gluten', 'milk', 'egg', 'peanut', 'soy', 'fish'] as const) {
      const out = suggestRecipes(STARTER_RECIPES, { ...prefs, avoid: [a] });
      expect(out.length, a).toBeLessThan(STARTER_RECIPES.length);
      for (const s of out) expect(s.check.allergens, `${a} in ${s.recipe.id}`).not.toContain(a);
    }
    const noGluten = names(suggestRecipes(STARTER_RECIPES, { ...prefs, avoid: ['gluten'] }));
    expect(noGluten).not.toContain('tomato-garlic-pasta');
    expect(noGluten).not.toContain('scrambled-eggs-toast');
    expect(noGluten).toContain('chickpea-curry');
  });
  it('a dislike removes a recipe that needs the ingredient, but not one where it is optional', () => {
    expect(names(suggestRecipes(STARTER_RECIPES, { ...prefs, dislikes: ['mushrooms'] }))).not.toContain('veg-omelette');
    expect(names(suggestRecipes(STARTER_RECIPES, { ...prefs, dislikes: ['honey'] }))).toContain('porridge-banana');
  });
  it('equipment, time, simplicity and budget are real filters', () => {
    expect(names(suggestRecipes(STARTER_RECIPES, { ...prefs, equipment: ['hob'] }))).not.toContain('beans-baked-potato');
    expect(suggestRecipes(STARTER_RECIPES, { ...prefs, maxPrepMinutes: 15 }).every((s) => s.recipe.prepMinutes + s.recipe.cookMinutes <= 15)).toBe(true);
    expect(suggestRecipes(STARTER_RECIPES, { ...prefs, simple: true }).every((s) => s.recipe.ingredients.filter((i) => !i.optional).length <= 8)).toBe(true);
    expect(suggestRecipes(STARTER_RECIPES, { ...prefs, budgetFriendly: true }).every((s) => s.recipe.tags.includes('inexpensive'))).toBe(true);
  });
  it('a personal dish with ingredients the app cannot identify is not offered once a diet or allergen filter is on', () => {
    const mine: Recipe = { id: 'd1', name: 'Gran\'s stew', source: 'personal', servings: 2, prepMinutes: 10, cookMinutes: 30, slots: ['dinner'], tags: [], equipment: [], steps: ['Stew it.'], ingredients: [{ name: 'mystery cut', qty: 400, unit: 'g' }, { name: 'onion', qty: 1, unit: 'piece' }] };
    expect(names(suggestRecipes([mine], prefs))).toEqual(['d1']);
    expect(suggestRecipes([mine], prefs)[0].notes.join(' ')).toMatch(/could not be checked/);
    expect(suggestRecipes([mine], { ...prefs, diet: 'vegan' })).toHaveLength(0);
    expect(suggestRecipes([mine], { ...prefs, avoid: ['peanut'] })).toHaveLength(0);
  });
  it('filters by slot, search text and tag', () => {
    expect(suggestRecipes(STARTER_RECIPES, prefs, { slot: 'snack' }).every((s) => s.recipe.slots.includes('snack'))).toBe(true);
    expect(names(suggestRecipes(STARTER_RECIPES, prefs, { query: 'lentil' }))).toEqual(expect.arrayContaining(['lentil-soup', 'red-dal']));
    expect(names(suggestRecipes(STARTER_RECIPES, prefs, { tag: 'batch-friendly' }))).toContain('veggie-chili');
  });
});

describe('a shopping list built from the meal plan', () => {
  it('scales each recipe to the servings planned and adds the same ingredient across meals, with each meal named', () => {
    // lentil soup serves 4 (200 g lentils, 1 onion, 2 carrots...), chili serves 4 (1 onion...)
    const items = generateItems(parts([entry({ id: 'a', recipe: 'lentil-soup', servings: 6 }), entry({ id: 'b', recipe: 'veggie-chili', servings: 2, date: '2026-10-06' })]));
    const by = (key: string) => items.find((i) => i.key === key && !i.optional);
    expect(by('red-lentils')).toMatchObject({ qty: 300, unit: 'g' }); // 200 g x 6/4
    expect(by('onion')).toMatchObject({ qty: 2, unit: 'piece' }); // 1.5 + 0.5, exactly two
    expect(by('onion')!.sources.map((s) => s.recipe).sort()).toEqual(['Red lentil soup', 'Three-bean veg chili']);
    expect(by('onion')!.sources.map((s) => s.qty).sort()).toEqual([0.5, 1.5]);
    expect(by('carrot')).toMatchObject({ qty: 3, unit: 'piece' });
  });
  it('rounds counted things up to whole ones once, on the total, and keeps each meal\'s exact share', () => {
    const items = generateItems(parts([entry({ id: 'a', recipe: 'veggie-chili', servings: 3 })])); // beans: 2 cans x 3/4 = 1.5
    const kidney = items.find((i) => i.key === 'kidney-beans')!;
    expect(kidney).toMatchObject({ qty: 2, unit: 'can' });
    expect(kidney.sources[0].qty).toBe(1.5);
    expect(items.find((i) => i.key === 'garlic')).toMatchObject({ qty: 3, unit: 'clove' }); // 2.25 -> 3
    expect(items.find((i) => i.key === 'rice')).toMatchObject({ qty: 225, unit: 'g' }); // measured amounts are not rounded up
    expect(items.find((i) => i.key === 'ground-cumin' || i.key === 'cumin')).toMatchObject({ qty: 1.5, unit: 'tsp' });
  });
  it('keeps amounts in different kinds of unit as separate lines instead of inventing a conversion', () => {
    const items = generateItems(parts([entry({ id: 'a', recipe: 'chicken-veg-traybake', servings: 3 }), entry({ id: 'b', recipe: 'beans-baked-potato', servings: 2 })]));
    const potatoes = items.filter((i) => i.key === 'potato');
    expect(potatoes).toHaveLength(2);
    expect(potatoes.map((p) => p.unit).sort()).toEqual(['g', 'piece']);
    expect(potatoes.find((p) => p.unit === 'g')!.qty).toBe(600);
    expect(potatoes.find((p) => p.unit === 'piece')!.qty).toBe(2);
  });
  it('optional ingredients are their own lines, never quietly counted as needed', () => {
    const items = generateItems(parts([entry({ id: 'a', recipe: 'lentil-soup' })]));
    const lemon = items.filter((i) => i.key === 'lemon');
    expect(lemon).toHaveLength(1);
    expect(lemon[0].optional).toBe(true);
    // the same ingredient needed in another recipe is a separate, required line
    const both = generateItems(parts([entry({ id: 'a', recipe: 'lentil-soup' }), entry({ id: 'b', recipe: 'chickpea-salad', servings: 2 })]));
    expect(both.filter((i) => i.key === 'lemon').map((i) => i.optional).sort()).toEqual([false, true]);
  });
  it('an ingredient with no amount joins the line for the same ingredient rather than making an empty one', () => {
    const odd: Recipe = { ...(STARTER_BY_ID.get('lentil-soup') as Recipe), id: 'odd', ingredients: [{ name: 'olive oil', qty: null, unit: null }, { name: 'oil', qty: 2, unit: 'tbsp' }] };
    const items = generateItems([{ entry: entry({ id: 'x', recipe: 'odd' }), recipe: odd }]);
    expect(items.filter((i) => i.key === 'olive-oil')).toHaveLength(1);
    expect(items.find((i) => i.key === 'olive-oil')).toMatchObject({ qty: 2, unit: 'tbsp' });
  });
  it('a pinch of salt is "salt", not "1 pinch salt"', () => {
    const items = generateItems(parts([entry({ id: 'a', recipe: 'scrambled-eggs-toast', servings: 8 })]));
    expect(items.find((i) => i.key === 'salt')).toMatchObject({ qty: null, unit: null });
    expect(items.find((i) => i.key === 'black-pepper')).toMatchObject({ qty: null, unit: null });
  });
  it('ingredients the person always has start as already at home', () => {
    const items = generateItems(parts([entry({ id: 'a', recipe: 'lentil-soup' })]), ['salt', 'olive-oil']);
    expect(items.filter((i) => i.atHome).map((i) => i.key).sort()).toEqual(['olive-oil', 'salt']);
    expect(items.find((i) => i.key === 'onion')!.atHome).toBe(false);
  });
  it('a leftover meal, a free-text meal and a skipped meal add nothing; a batch is bought once', () => {
    const plan: MealEntry[] = [
      entry({ id: 'batch', recipe: 'veggie-chili', servings: 4 }),
      entry({ id: 'l1', date: '2026-10-06', ref: { kind: 'leftover', of: 'batch' }, name: 'Chili leftovers', servings: 2 }),
      entry({ id: 'free', date: '2026-10-06', slot: 'lunch', ref: { kind: 'free', text: 'Sandwich' }, name: 'Sandwich', servings: 1 }),
      entry({ id: 'skip', date: '2026-10-07', recipe: 'lentil-soup', status: 'skipped' }),
    ];
    expect(shoppableEntries(plan, TODAY, '2026-10-12').map((e) => e.id)).toEqual(['batch']);
  });
  it('picks meals in a date range only', () => {
    const plan = [entry({ id: 'a', date: '2026-10-04' }), entry({ id: 'b', date: '2026-10-05' }), entry({ id: 'c', date: '2026-10-12' }), entry({ id: 'd', date: '2026-10-13' })];
    expect(shoppableEntries(plan, '2026-10-05', '2026-10-12').map((e) => e.id)).toEqual(['b', 'c']);
  });
  it('is sorted into the order of a shop', () => {
    const items = generateItems(parts([entry({ id: 'a', recipe: 'scrambled-eggs-toast', servings: 2 })]));
    const cats = items.map((i) => i.category);
    expect(cats).toEqual([...cats].sort((x, y) => ['produce', 'dairy-eggs', 'meat-fish', 'bakery', 'pantry', 'tinned', 'frozen', 'spices', 'oils-sauces', 'drinks', 'household', 'other'].indexOf(x) - ['produce', 'dairy-eggs', 'meat-fish', 'bakery', 'pantry', 'tinned', 'frozen', 'spices', 'oils-sauces', 'drinks', 'household', 'other'].indexOf(y)));
  });
});

describe('when the meal plan changes after a list was made', () => {
  const make = (entries: MealEntry[]): ShoppingList => ({ id: 'l1', name: 'Week', createdAt: '2026-10-05T08:00:00.000Z', range: { from: TODAY, to: '2026-10-11' }, entryIds: entries.map((e) => e.id), skipped: [], items: generateItems(parts(entries)), ignored: null });
  const a = entry({ id: 'a', recipe: 'lentil-soup', servings: 4 });

  it('proposes nothing when the plan and the list agree', () => {
    const list = make([a]);
    expect(proposeUpdate(list, generateItems(parts([a])))).toBeNull();
  });
  it('shows what would change and changes nothing itself', () => {
    const list = make([a]);
    const before = JSON.stringify(list);
    const up = proposeUpdate(list, generateItems(parts([{ ...a, servings: 8 }, entry({ id: 'b', recipe: 'chickpea-curry', servings: 3 })])))!;
    expect(JSON.stringify(list)).toBe(before);
    expect(up.changes.some((c) => c.kind === 'qty' && c.item.key === 'red-lentils' && c.from === 200 && c.to === 400)).toBe(true);
    expect(up.changes.some((c) => c.kind === 'add' && c.item.key === 'chickpeas')).toBe(true);
  });
  it('keeps manual items, purchased states, home flags and edited quantities when applied', () => {
    let list = make([a]);
    const lentils = list.items.find((i) => i.key === 'red-lentils')!;
    const onion = list.items.find((i) => i.key === 'onion')!;
    list = { ...list, items: list.items.map((i) => (i.id === lentils.id ? { ...i, checked: true } : i.id === onion.id ? { ...i, qty: 5, edited: true } : i)).concat([{ id: 'm1', key: 'custom:tea', name: 'tea bags', qty: 1, unit: 'pack', category: 'drinks', optional: false, checked: true, atHome: false, manual: true, edited: false, note: '', sources: [] }]) };
    const up = proposeUpdate(list, generateItems(parts([{ ...a, servings: 8 }])))!;
    const byId = (id: string) => up.next.find((i) => i.id === id)!;
    expect(byId('m1')).toMatchObject({ manual: true, checked: true, name: 'tea bags' });
    expect(byId(lentils.id)).toMatchObject({ checked: true, qty: 400 });
    expect(byId(lentils.id).note).toMatch(/needs 200 g more than you bought/);
    expect(byId(onion.id)).toMatchObject({ qty: 5, edited: true }); // the person's own number wins
  });
  it('removes what no meal needs any more, except what was already bought', () => {
    let list = make([a, entry({ id: 'b', recipe: 'chickpea-curry', servings: 3 })]);
    const curryOnly = list.items.filter((i) => i.sources.every((s) => s.recipe === 'Chickpea and tomato curry'));
    expect(curryOnly.length).toBeGreaterThan(2);
    const bought = curryOnly.find((i) => i.key === 'chickpeas')!;
    list = { ...list, items: list.items.map((i) => (i.id === bought.id ? { ...i, checked: true } : i)) };
    const up = proposeUpdate(list, generateItems(parts([a])))!;
    expect(up.next.some((i) => i.id === bought.id && i.checked && /already bought/.test(i.note))).toBe(true);
    const gone = curryOnly.find((i) => i.key === 'rice' || i.key === 'ginger')!;
    expect(up.next.some((i) => i.id === gone.id)).toBe(false);
  });
  it('an ignored proposal stays quiet until the plan changes again', () => {
    const list = make([a]);
    const fresh = generateItems(parts([{ ...a, servings: 8 }]));
    const up = proposeUpdate(list, fresh)!;
    expect(proposeUpdate({ ...list, ignored: up.signature }, fresh)).toBeNull();
    const further = generateItems(parts([{ ...a, servings: 12 }]));
    expect(proposeUpdate({ ...list, ignored: up.signature }, further)).not.toBeNull();
    expect(signatureOf(further)).not.toBe(up.signature);
  });
  it('a change in which meal supplies an ingredient is reported even when the amount is the same', () => {
    const list = make([a]);
    const swapped = generateItems(parts([{ ...a, id: 'a2' }]));
    const up = proposeUpdate(list, swapped);
    expect(up?.changes.some((c) => c.kind === 'sources')).toBe(true);
  });
});

describe('reading a list', () => {
  it('pluralises counted ingredients after a number above one, and nothing else', () => {
    expect(pluralName('egg', 4, 'piece')).toBe('eggs');
    expect(pluralName('tomato', 3, 'piece')).toBe('tomatoes');
    expect(pluralName('bell pepper', 2, 'piece')).toBe('bell peppers');
    expect(pluralName('berry', 2, 'piece')).toBe('berries');
    expect(pluralName('chicken thighs', 6, 'piece')).toBe('chicken thighs');
    expect(pluralName('onion', 1, 'piece')).toBe('onion');
    expect(pluralName('rice', 500, 'g')).toBe('rice');
    expect(itemText({ name: 'onion', qty: 2, unit: 'piece' })).toBe('2 onions');
    expect(itemText({ name: 'rolled oats', qty: 500, unit: 'g' })).toBe('500 g rolled oats');
    expect(itemText({ name: 'salt', qty: null, unit: null })).toBe('salt');
  });
});

describe('sharing a list', () => {
  it('writes plain text grouped by aisle, with what is already at home listed apart and bought items marked', () => {
    const items = generateItems(parts([entry({ id: 'a', recipe: 'scrambled-eggs-toast', servings: 2 })]), ['salt']);
    const list: ShoppingList = { id: 'l', name: 'Breakfasts', createdAt: '', range: null, entryIds: [], skipped: [], ignored: null, items: items.map((i) => (i.key === 'bread' ? { ...i, checked: true } : i)) };
    const text = exportText(list);
    expect(text.split('\n')[0]).toBe('Breakfasts');
    expect(text).toMatch(/Dairy and eggs\n(\[ \] .+\n)*\[ \] 4 eggs\n/);
    expect(text).toMatch(/\[x\] 4 slices bread/);
    expect(text).toMatch(/Already at home\n- salt/);
    expect(text.indexOf('Dairy and eggs')).toBeLessThan(text.indexOf('Bakery'));
  });
});

describe('meal states keep planned, prepared, eaten, skipped and not recorded apart', () => {
  const d = base();
  it('is scheduled for today and later, and not recorded once the day has passed', () => {
    expect(mealState(d, entry({ id: 'a', date: TODAY }), TODAY)).toBe('scheduled');
    expect(mealState(d, entry({ id: 'a', date: '2026-10-09' }), TODAY)).toBe('scheduled');
    expect(mealState(d, entry({ id: 'a', date: '2026-10-04' }), TODAY)).toBe('unrecorded');
  });
  it('only an explicit answer makes it eaten or skipped', () => {
    expect(mealState(d, entry({ id: 'a', status: 'eaten' }), TODAY)).toBe('eaten');
    expect(mealState(d, entry({ id: 'a', date: '2026-10-01', status: 'skipped' }), TODAY)).toBe('skipped');
    expect(mealState(d, entry({ id: 'a', status: 'prepared' }), TODAY)).toBe('prepared');
  });
  it('is prepared when its linked cooking session is completed, from that one record', () => {
    let data: AppData = base({ plan: [entry({ id: 'a', prepActivityId: 'cook1' })] });
    data = { ...data, activities: [{ id: 'cook1', module: 'meals', kind: 'flexible', name: 'Cook chili', minutes: 40, schedule: { kind: 'once', date: TODAY }, time: null, startDate: TODAY, endDate: null, ref: { kind: 'recipe', id: 'veggie-chili' }, intensity: 'gentle', difficulty: 1, note: '', createdAt: `${TODAY}T08:00:00.000Z`, archived: false }] };
    expect(mealState(data, data.meals.plan[0], TODAY)).toBe('scheduled');
    const task = activityToTask(data.activities[0], contentFor(data));
    const done = reducer(data, { type: 'TASK_COMPLETE', task, stamp: stamp(), via: 'checkoff', entryId: 'e1' });
    expect(mealState(done, done.meals.plan[0], TODAY)).toBe('prepared');
    const undone = reducer(done, { type: 'UNDO', entryId: 'e1', taskId: task.id, before: null, after: done.taskStates[task.id] ?? null });
    expect(mealState(undone, undone.meals.plan[0], TODAY)).toBe('scheduled');
  });
  it('tracks leftovers of a batch without ever blocking anything', () => {
    const batch = entry({ id: 'b', recipe: 'veggie-chili', servings: 4 });
    const data = base({ plan: [batch, entry({ id: 'l1', ref: { kind: 'leftover', of: 'b' }, servings: 1 }), entry({ id: 'l2', ref: { kind: 'leftover', of: 'b' }, servings: 2 })] });
    expect(leftoverServings(data, batch)).toBe(1);
  });
  it('a cooking activity shows the recipe it points at, and still works when the recipe is gone', () => {
    const data = base();
    const act = { id: 'c', module: 'meals' as const, kind: 'flexible' as const, name: 'Cook', minutes: 30, schedule: { kind: 'once' as const, date: TODAY }, time: null, startDate: TODAY, endDate: null, ref: { kind: 'recipe' as const, id: 'shakshuka' }, intensity: 'gentle' as const, difficulty: 1 as const, note: '', createdAt: '', archived: false };
    expect(activityToTask(act, contentFor(data)).substeps).toEqual((STARTER_BY_ID.get('shakshuka') as Recipe).steps);
    expect(activityToTask({ ...act, ref: { kind: 'recipe', id: 'deleted' } }, contentFor(data)).substeps).toEqual([]);
  });
});

describe('the meals reducer', () => {
  const e1 = entry({ id: 'e1', recipe: 'shakshuka', servings: 2 });
  it('plans a meal, remembers the recipe as recent, and is safe to replay', () => {
    let d = reducer(emptyAppData(TODAY), { type: 'MEAL_SAVE', entry: e1 });
    d = reducer(d, { type: 'MEAL_SAVE', entry: e1 });
    expect(d.meals.plan).toHaveLength(1);
    expect(d.meals.recents).toEqual(['shakshuka']);
    d = reducer(d, { type: 'MEAL_SAVE', entry: entry({ id: 'e2', recipe: 'veg-omelette' }) });
    expect(d.meals.recents).toEqual(['veg-omelette', 'shakshuka']);
  });
  it('records status with its time, and planned undoes it', () => {
    let d = reducer(emptyAppData(TODAY), { type: 'MEAL_SAVE', entry: e1 });
    d = reducer(d, { type: 'MEAL_STATUS', id: 'e1', status: 'eaten', at: '2026-10-05T19:00:00.000Z' });
    expect(d.meals.plan[0]).toMatchObject({ status: 'eaten', statusAt: '2026-10-05T19:00:00.000Z' });
    d = reducer(d, { type: 'MEAL_STATUS', id: 'e1', status: 'planned', at: null });
    expect(d.meals.plan[0]).toMatchObject({ status: 'planned', statusAt: null });
  });
  it('deleting a dish keeps what was planned readable', () => {
    const dish: Recipe = { id: 'd1', name: 'My stew', source: 'personal', servings: 2, prepMinutes: 5, cookMinutes: 20, slots: ['dinner'], tags: [], equipment: [], steps: ['Stew.'], ingredients: [{ name: 'onion', qty: 1, unit: 'piece' }] };
    let d = reducer(emptyAppData(TODAY), { type: 'DISH_SAVE', dish });
    d = reducer(d, { type: 'MEAL_SAVE', entry: entry({ id: 'm', ref: { kind: 'dish', id: 'd1' }, name: 'My stew' }) });
    d = reducer(d, { type: 'FAVOURITE', id: 'd1', on: true });
    d = reducer(d, { type: 'DISH_DELETE', id: 'd1' });
    expect(d.meals.dishes).toHaveLength(0);
    expect(d.meals.favourites).toEqual([]);
    expect(d.meals.plan[0].name).toBe('My stew');
    expect(recipeById(d, 'd1')).toBeNull();
  });
  it('shopping actions are idempotent and leave other items alone', () => {
    const items = generateItems(parts([entry({ id: 'a', recipe: 'lentil-soup' })]));
    const list: ShoppingList = { id: 'l1', name: 'W', createdAt: '', range: null, entryIds: ['a'], skipped: [], items, ignored: null };
    let d = reducer(emptyAppData(TODAY), { type: 'SHOP_CREATE', list });
    d = reducer(d, { type: 'SHOP_CREATE', list });
    expect(d.shopping.lists).toHaveLength(1);
    const id = items[0].id;
    d = reducer(d, { type: 'SHOP_ITEM_CHECK', listId: 'l1', itemId: id, checked: true });
    d = reducer(d, { type: 'SHOP_ITEM_CHECK', listId: 'l1', itemId: id, checked: true });
    expect(d.shopping.lists[0].items.filter((i) => i.checked)).toHaveLength(1);
    d = reducer(d, { type: 'SHOP_ITEM_CHECK', listId: 'l1', itemId: id, checked: false });
    expect(d.shopping.lists[0].items.some((i) => i.checked)).toBe(false);
    d = reducer(d, { type: 'PANTRY', key: 'salt', on: true });
    d = reducer(d, { type: 'PANTRY', key: 'salt', on: true });
    expect(d.shopping.pantry).toEqual(['salt']);
  });
});

describe('saved meals and shopping data are validated like everything else', () => {
  it('survives a round trip and repairs bad data instead of trusting it', () => {
    const good = base({ plan: [entry({ id: 'a', recipe: 'shakshuka', servings: 2 })], favourites: ['shakshuka'] });
    const rt = validateAppData(JSON.parse(JSON.stringify(good)), TODAY)!;
    expect(rt.data.meals.plan).toEqual(good.meals.plan);
    expect(rt.dropped).toBe(0);
    const raw = JSON.parse(JSON.stringify(good));
    raw.meals.plan.push({ id: 'bad1', date: 'not a date', slot: 'dinner', ref: { kind: 'recipe', id: 'x' } }, { id: 'bad2', date: TODAY, slot: 'brunch', ref: { kind: 'recipe', id: 'x' } }, { id: 'a', date: TODAY, slot: 'dinner', ref: { kind: 'free', text: 'dup' } });
    raw.meals.prefs = { diet: 'carnivore', avoid: ['gluten', 'unicorn'], household: 400, slots: { breakfast: { on: true, time: '25:61' }, snack: { on: 'yes' } }, secret: 'x' };
    raw.shopping = { lists: [{ id: 'l', name: 'x', items: [{ id: 'i', name: 'tea', qty: -4, unit: 'barrel', category: 'nonsense' }, { id: 'i', name: 'dup' }, { name: 'no id' }], range: { from: 'x', to: 'y' } }, 'junk'], pantry: ['salt', 'salt', 5] };
    const r = validateAppData(raw, TODAY)!;
    expect(r.data.meals.plan.map((e) => e.id)).toEqual(['a']);
    expect(r.data.meals.prefs).toMatchObject({ diet: 'any', avoid: ['gluten'], household: 12 });
    expect(r.data.meals.prefs.slots.breakfast.time).toBeNull();
    expect(r.data.meals.prefs.slots.snack.on).toBe(false);
    expect('secret' in r.data.meals.prefs).toBe(false);
    const item = r.data.shopping.lists[0].items[0];
    expect(item).toMatchObject({ qty: null, unit: null, category: 'other' });
    expect(r.data.shopping.lists[0].items).toHaveLength(1);
    expect(r.data.shopping.lists[0].range).toBeNull();
    expect(r.data.shopping.pantry).toEqual(['salt']);
    expect(r.dropped).toBeGreaterThan(0);
  });
  it('an old v2 file simply has empty meals and shopping, with nothing invented', () => {
    const raw = JSON.parse(JSON.stringify(emptyAppData(TODAY))) as Record<string, unknown>;
    raw.version = 2; delete raw.meals; delete raw.shopping; raw.onboardingComplete = true;
    const r = validateAppData(raw, TODAY)!;
    expect(r.data.meals).toEqual(emptyMeals());
    expect(r.data.shopping).toEqual({ lists: [], pantry: [] });
  });
});
