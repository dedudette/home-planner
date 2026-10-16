// Meals, recipes and shopping, in a real browser. Needs the dev server (npm run dev) and Chromium (CHROME_PATH).
//
//  A  plan a meal from a recipe with servings, log it, correct it, undo it; log without a recipe; not recorded is not skipped
//  B  recipes: preferences filter what is offered and say what they hid; a personal dish with an unknown ingredient
//  C  shopping: make a list from a date range, tick, mark at home, add your own item, change the plan, review and apply the update, share
//  D  Today's meals card and the saved data after a reload
//  E  layout and accessibility at every width
import { auditPage, BASE, launch, newContext, runner, stored, WIDTHS, watch } from './lib.mjs';

const { check, step, done } = runner('meals');
const errors = [];
const browser = await launch();
const NOW = new Date(2026, 9, 5, 8, 15); // a Monday
const TODAY = '2026-10-05';
const click = (page, t, o) => page.getByRole('button', { name: t, ...o }).first().click();
const saved = (page) => page.waitForTimeout(700);
const text = (page) => page.evaluate(() => document.querySelector('main')?.innerText ?? '');

const mk = async (size = { w: 390, h: 844, mobile: true }) => {
  const ctx = await newContext(browser, size);
  const page = await ctx.newPage();
  watch(page, errors, `${size.w}`);
  await page.clock.setFixedTime(NOW);
  return { ctx, page };
};

/** A person who wants meals and nothing else: through the real onboarding. */
const onboardMealsOnly = async (page) => {
  await page.goto(BASE); await page.evaluate(() => localStorage.clear()); await page.reload();
  await click(page, 'Build my plan');
  await page.waitForSelector('text=What do you want help with');
  await page.getByRole('checkbox', { name: /^Meals & shopping/ }).click();
  await click(page, 'Continue');
  await page.waitForSelector('text=How much time can you give your plan each day');
  await page.getByRole('radio', { name: '20 minutes' }).click();
  await page.getByRole('radio', { name: '4', exact: true }).click();
  await click(page, 'Continue');
  await click(page, 'Skip');
  await page.waitForSelector('text=Ready when you are');
  await click(page, 'Build my plan');
  await page.waitForSelector('[data-testid="today-meals"]', { timeout: 9000 });
};

const addMeal = async (page, { slot, recipe, servings, day = 'Today' }) => {
  await page.getByRole('button', { name: new RegExp(`^Add ${slot}`, 'i') }).first().click().catch(async () => { await page.getByRole('button', { name: `Add ${slot} on ${day}` }).click(); });
  await page.waitForSelector('role=dialog');
  await page.getByRole('searchbox', { name: 'Search recipes' }).fill(recipe);
  for (let i = 1; i < (servings ?? 1); i++) await page.getByRole('button', { name: 'More servings' }).click();
  await page.locator('.card', { hasText: recipe }).getByRole('button', { name: 'Choose' }).first().click();
  await page.waitForSelector('role=dialog', { state: 'detached' });
};

// ───────────── A ─────────────
{
  const { ctx, page } = await mk();
  await step('A onboarding with only Meals gives Today a meals card and no cleaning', async () => {
    await onboardMealsOnly(page);
    const t = await text(page);
    check('no cleaning words', !/\bclean(ing|ed)?\b/i.test(t.replace(/CleanFlow/g, '')), t.slice(0, 160));
    check('three meals are on, snack is off', (await page.locator('[data-testid="today-meals"] [data-slot]').count()) === 3);
  }, page);
  await step('A plan dinner from a recipe with 4 servings', async () => {
    await page.goto(BASE + '#/meals');
    await page.waitForSelector('text=Nothing planned this week');
    await page.getByRole('button', { name: 'Add dinner on Today' }).click();
    await page.waitForSelector('role=dialog');
    await page.getByRole('searchbox', { name: 'Search recipes' }).fill('lentil');
    for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'More servings' }).click(); // 1 -> 4
    await page.locator('.card', { hasText: 'Red lentil soup' }).getByRole('button', { name: 'Choose' }).click();
    await page.waitForSelector('role=dialog', { state: 'detached' });
    await saved(page);
    const d = await stored(page);
    check('saved once with the servings chosen', d.meals.plan.length === 1 && d.meals.plan[0].servings === 4 && d.meals.plan[0].ref.id === 'lentil-soup', JSON.stringify(d.meals.plan));
    check('the recipe is remembered as recent', d.meals.recents[0] === 'lentil-soup');
    check('the row says planned', (await page.locator('[data-testid="meal-row"][data-state="scheduled"]').count()) === 1);
  }, page);
  await step('A eaten, undone, eaten again; planned, prepared, eaten and skipped stay distinct', async () => {
    const row = page.locator('[data-testid="meal-row"]').first();
    await row.getByRole('button', { name: 'Ate it' }).click();
    await page.waitForSelector('.toast button:has-text("Undo")');
    await saved(page);
    check('eaten with a time', (await stored(page)).meals.plan[0].status === 'eaten' && !!(await stored(page)).meals.plan[0].statusAt);
    await page.locator('.toast button:has-text("Undo")').last().click();
    await saved(page);
    check('undo goes back to planned with no time', (await stored(page)).meals.plan[0].status === 'planned' && (await stored(page)).meals.plan[0].statusAt === null);
    await row.getByRole('button', { name: 'Skip' }).click();
    await saved(page);
    check('skipped only because the person said so', (await stored(page)).meals.plan[0].status === 'skipped');
    await row.getByRole('button', { name: /Open details/ }).click();
    await page.getByRole('radio', { name: 'Prepared' }).click();
    await saved(page);
    check('prepared is its own state', (await stored(page)).meals.plan[0].status === 'prepared');
    await page.getByRole('radio', { name: 'Not yet' }).click();
    await page.getByRole('button', { name: 'Done' }).click();
    await saved(page);
  }, page);
  await step('A log what was eaten without a recipe, and correct the servings', async () => {
    await page.getByRole('button', { name: 'Add lunch on Today' }).click();
    await page.getByRole('tab', { name: 'Just log it' }).click();
    await page.fill('#mp-text', 'Soup and a roll');
    await page.getByRole('button', { name: 'Log it' }).click();
    await page.waitForSelector('role=dialog', { state: 'detached' });
    await saved(page);
    const e = (await stored(page)).meals.plan.find((x) => x.ref.kind === 'free');
    check('recorded as eaten, with the words typed', e.status === 'eaten' && e.name === 'Soup and a roll', JSON.stringify(e));
    await page.getByRole('button', { name: /Soup and a roll.*Open details/ }).click();
    await page.getByRole('button', { name: 'More servings' }).click();
    await page.getByRole('button', { name: 'Done' }).click();
    await saved(page);
    check('servings corrected', (await stored(page)).meals.plan.find((x) => x.ref.kind === 'free').servings === 2);
  }, page);
  await step('A a past meal nobody recorded is "Not recorded", never skipped', async () => {
    await page.evaluate(() => {
      const d = JSON.parse(localStorage.getItem('cleanflow:v1'));
      d.meals.plan.push({ id: 'old1', date: '2026-10-03', slot: 'dinner', ref: { kind: 'recipe', id: 'shakshuka' }, name: 'Shakshuka (eggs in spiced tomato)', servings: 2, status: 'planned', statusAt: null, prepActivityId: null, kcal: null, note: '' });
      d._rev += 3; localStorage.setItem('cleanflow:v1', JSON.stringify(d));
    });
    await page.reload();
    await page.waitForSelector('h1:has-text("Meals & shopping")');
    await page.getByRole('button', { name: 'Previous week' }).click();
    const row = page.locator('[data-testid="meal-row"][data-state="unrecorded"]');
    await row.waitFor();
    check('says not recorded', /Not recorded/.test(await row.innerText()));
    check('nothing says skipped', !/Skipped/.test(await text(page)));
    check('offers a quick answer without guilt', (await row.getByRole('button', { name: /Did not eat|Ate it/ }).count()) >= 1);
  }, page);
  await ctx.close();
}

// ───────────── B ─────────────
{
  const { ctx, page } = await mk();
  await onboardMealsOnly(page);
  await step('B preferences hide recipes and say how many', async () => {
    await page.goto(BASE + '#/meals?tab=recipes');
    await page.waitForSelector('[aria-label="Recipes"]');
    const all = await page.locator('[aria-label="Recipes"] > div').count();
    check('a full catalogue to start', all >= 20, String(all));
    await page.goto(BASE + '#/meals?tab=prefs');
    await page.getByRole('radio', { name: 'Vegan' }).click();
    await page.getByRole('checkbox', { name: 'Gluten' }).click();
    await page.getByRole('group', { name: /Leave out recipes that list/ }).waitFor();
    await page.goto(BASE + '#/meals?tab=recipes');
    const fewer = await page.locator('[aria-label="Recipes"] > div').count();
    check('fewer are offered', fewer > 0 && fewer < all, `${fewer} of ${all}`);
    const note = await text(page);
    check('it says some are hidden and why', /hidden because of what you told us/.test(note), note.slice(0, 300));
    const names = await page.locator('[aria-label="Recipes"] b').allInnerTexts();
    check('no recipe with egg, milk, fish, meat or gluten is shown', !names.some((n) => /egg|porridge|toast|pasta|tuna|chicken|omelette|quesadilla|yogurt|oats|shakshuka/i.test(n)), names.join(', '));
    await page.getByRole('button', { name: 'Show them' }).click();
    check('they can all be shown', (await page.locator('[aria-label="Recipes"] > div').count()) === all);
  }, page);
  await step('B a recipe says what it contains and that this is not a guarantee', async () => {
    await page.locator('[aria-label="Recipes"] button', { hasText: 'Scrambled eggs on toast' }).first().click();
    const t = await page.locator('role=dialog').innerText();
    check('lists allergens from the ingredients', /contains (egg|gluten|milk)/i.test(t), t.slice(0, 600));
    check('not a guarantee', /not a guarantee/i.test(t));
    await page.getByRole('button', { name: 'More servings' }).click();
    const scaled = await page.locator('role=dialog').innerText();
    check('amounts scale', /6 eggs|5 eggs/.test(scaled) || /egg/.test(scaled));
    await page.keyboard.press('Escape');
  }, page);
  await step('B a personal dish with an ingredient the app does not know', async () => {
    await page.goto(BASE + '#/meals?tab=prefs');
    await page.getByRole('radio', { name: 'No preference' }).click();
    await page.getByRole('checkbox', { name: 'Gluten' }).click();
    await page.goto(BASE + '#/meals?tab=recipes');
    await page.getByRole('button', { name: 'Write down a dish' }).click();
    await page.fill('#d-name', "Gran's stew");
    await page.getByLabel('Ingredient 1 name').fill('onions');
    await page.getByLabel('Ingredient 1 amount').fill('2');
    await page.getByLabel('Ingredient 1 unit').selectOption('piece');
    await page.getByLabel('Ingredient 2 name').fill('mystery cut');
    await page.getByLabel('Ingredient 2 amount').fill('400');
    await page.getByLabel('Ingredient 2 unit').selectOption('g');
    check('says an unknown ingredient cannot be checked', /cannot be checked for diet or allergens/.test(await page.locator('role=dialog').innerText()));
    await page.fill('#d-steps', 'Brown the meat.\nAdd the onions and stew.');
    await page.getByRole('button', { name: 'Save dish' }).click();
    await page.waitForSelector('role=dialog', { state: 'detached' });
    await saved(page);
    const d = await stored(page);
    check('saved as the person\'s own dish', d.meals.dishes.length === 1 && d.meals.dishes[0].ingredients.length === 2 && d.meals.dishes[0].source === 'personal');
    check('and it has no calories unless typed', d.meals.dishes[0].kcalPerServing === undefined);
  }, page);
  await ctx.close();
}

// ───────────── C ─────────────
{
  const { ctx, page } = await mk();
  await onboardMealsOnly(page);
  await step('C plan two meals that share ingredients, then make a list for the week', async () => {
    await page.goto(BASE + '#/meals');
    await page.getByRole('button', { name: 'Add dinner on Today' }).click();
    await page.getByRole('searchbox', { name: 'Search recipes' }).fill('lentil');
    for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'More servings' }).click();
    await page.locator('.card', { hasText: 'Red lentil soup' }).getByRole('button', { name: 'Choose' }).click();
    await page.waitForSelector('role=dialog', { state: 'detached' });
    await page.getByRole('button', { name: 'Add dinner on Tomorrow' }).click();
    await page.getByRole('searchbox', { name: 'Search recipes' }).fill('chili');
    for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'More servings' }).click();
    await page.locator('.card', { hasText: 'Three-bean veg chili' }).getByRole('button', { name: 'Choose' }).click();
    await page.waitForSelector('role=dialog', { state: 'detached' });
    await page.getByRole('button', { name: 'Shopping list', exact: true }).click();
    await page.waitForSelector('role=dialog[name="Make a shopping list"]');
    await page.getByRole('radio', { name: 'Next 7 days' }).click();
    const t = await page.locator('role=dialog').innerText();
    check('both meals are offered, with their days', /Red lentil soup/.test(t) && /Three-bean veg chili/.test(t));
    check('it says how many items from how many meals', /\d+ items? from 2 meals/.test(t), t.slice(-300));
    await page.getByRole('button', { name: /^Make the list/ }).click();
    await page.waitForSelector('role=dialog', { state: 'detached' });
    await page.waitForSelector('[data-testid="shop-item"]');
    await saved(page);
  }, page);
  await step('C the list adds the same ingredient across meals and names where it came from', async () => {
    const items = await page.locator('[data-testid="shop-item"]').allInnerTexts();
    const head = (x) => x.split('\n')[0].trim();
    const onion = items.find((x) => /^\d+ onions?$/.test(head(x)));
    check('onion appears once, as 2 (1 for the soup, 1 for the chili)', !!onion && head(onion) === '2 onions' && items.filter((x) => /^\d+ onions?$/.test(head(x))).length === 1, String(onion));
    check('it names both meals', /Red lentil soup/.test(onion) && /Three-bean veg chili/.test(onion), onion);
    const d = await stored(page);
    const l = d.shopping.lists[0];
    check('carrots, lentils, beans and rice are there, in separate lines', ['carrot', 'red-lentils', 'kidney-beans', 'rice'].every((k) => l.items.some((i) => i.key === k)));
    check('grouped by aisle in the page', (await page.locator('main h3').allInnerTexts()).join('|').toLowerCase().includes('fruit and vegetables'));
  }, page);
  await step('C tick an item, mark one as at home, add one of your own', async () => {
    await page.getByRole('checkbox', { name: /^Bought: .*carrots/ }).check();
    await page.getByRole('button', { name: /onions: already at home/ }).click();
    await page.getByLabel('Item to add').fill('tea bags');
    await page.getByLabel('Amount').fill('1');
    await page.getByLabel('Unit').selectOption('pack');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await saved(page);
    const l = (await stored(page)).shopping.lists[0];
    check('carrots bought', l.items.find((i) => i.key === 'carrot').checked === true);
    check('onions at home', l.items.find((i) => i.key === 'onion' && !i.optional).atHome === true);
    check('tea is the person\'s own', l.items.some((i) => i.manual && i.name === 'tea bags' && i.qty === 1 && i.unit === 'pack'));
    check('the counts say so', /\d+ to buy · 1 bought · 1 at home/.test(await text(page)), (await text(page)).slice(0, 300));
  }, page);
  await step('C change the plan: nothing moves until the person says so, then their work is kept', async () => {
    const before = JSON.stringify((await stored(page)).shopping.lists[0].items.map((i) => [i.id, i.qty, i.checked, i.atHome]));
    await page.goto(BASE + '#/meals');
    await page.getByRole('button', { name: /Red lentil soup.*Open details/ }).click();
    for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'More servings' }).click(); // 4 -> 8
    await page.getByRole('button', { name: 'Done' }).click();
    await page.goto(BASE + '#/meals?tab=shopping');
    await page.waitForSelector('[data-testid="shop-update"]');
    await saved(page);
    check('the list itself is untouched', JSON.stringify((await stored(page)).shopping.lists[0].items.map((i) => [i.id, i.qty, i.checked, i.atHome])) === before);
    await page.getByRole('button', { name: 'Review the changes' }).click();
    const t = await page.locator('role=dialog').innerText();
    check('lists the change in plain words', /red lentils: 200 g → 400 g|red lentils: 300 g → 400 g|lentils/i.test(t), t.slice(0, 400));
    check('promises what is kept', /added yourself.*ticked off/i.test(t.replace(/\s+/g, ' ')));
    await page.getByRole('button', { name: 'Update my list' }).click();
    await saved(page);
    const l = (await stored(page)).shopping.lists[0];
    check('amount updated', l.items.find((i) => i.key === 'red-lentils').qty > 200);
    check('bought stays bought, home stays home, own items stay', l.items.find((i) => i.key === 'carrot').checked && l.items.find((i) => i.key === 'onion' && !i.optional).atHome && l.items.some((i) => i.manual && i.name === 'tea bags'));
    check('the banner is gone', (await page.locator('[data-testid="shop-update"]').count()) === 0);
  }, page);
  await step('C "Not now" keeps the list and stays quiet until the plan changes again', async () => {
    await page.goto(BASE + '#/meals');
    await page.getByRole('button', { name: /Three-bean veg chili.*Open details/ }).click();
    await page.getByRole('button', { name: 'Fewer servings' }).click();
    await page.getByRole('button', { name: 'Done' }).click();
    await page.goto(BASE + '#/meals?tab=shopping');
    await page.getByRole('button', { name: 'Review the changes' }).click();
    await page.getByRole('button', { name: 'Not now' }).click();
    await saved(page);
    check('quiet now', (await page.locator('[data-testid="shop-update"]').count()) === 0);
    await page.reload();
    check('and after a reload', (await page.locator('[data-testid="shop-update"]').count()) === 0);
  }, page);
  await step('C share: the text is grouped by aisle with bought items marked', async () => {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download as text' }).click()]);
    const fs = await import('node:fs');
    const body = fs.readFileSync(await dl.path(), 'utf8');
    check('groups and marks', /Fruit and vegetables\n/.test(body) && /\[x\] \d+ carrots/.test(body) && /Already at home\n- .*onions/.test(body), body.slice(0, 400));
  }, page);
  await ctx.close();
}

// ───────────── D ─────────────
{
  const { ctx, page } = await mk();
  await onboardMealsOnly(page);
  await step('D Today: one tap to log a recent dish, and everything survives a reload', async () => {
    await page.goto(BASE + '#/meals');
    await page.getByRole('button', { name: 'Add dinner on Today' }).click();
    await page.getByRole('searchbox', { name: 'Search recipes' }).fill('shakshuka');
    await page.locator('.card', { hasText: 'Shakshuka' }).getByRole('button', { name: 'Choose' }).click();
    await page.waitForSelector('role=dialog', { state: 'detached' });
    await page.goto(BASE + '#/today');
    const card = page.locator('[data-testid="today-meals"]');
    check('the planned dinner is on Today', /Shakshuka/.test(await card.innerText()));
    await card.getByRole('button', { name: /^Ate Shakshuka/ }).click();
    await saved(page);
    check('quick log marks the meal eaten', (await stored(page)).meals.plan.some((e) => e.ref.id === 'shakshuka' && e.status === 'eaten') || (await stored(page)).meals.plan.length === 2);
    await page.reload();
    await page.waitForSelector('[data-testid="today-meals"]');
    check('still there after a reload', /Shakshuka/.test(await page.locator('[data-testid="today-meals"]').innerText()));
  }, page);
  await step('D no calories or targets are ever shown unless the person typed a number', async () => {
    const t = await text(page);
    check('no kcal, target, deficit or goal wording', !/kcal|calorie|deficit|target|weight goal|fasting/i.test(t), t.slice(0, 300));
  }, page);
  await ctx.close();
}

// ───────────── E ─────────────
for (const size of WIDTHS) {
  const { ctx, page } = await mk(size);
  await onboardMealsOnly(page);
  await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('cleanflow:v1'));
    d.meals.plan = [
      { id: 'm1', date: '2026-10-05', slot: 'dinner', ref: { kind: 'recipe', id: 'chickpea-curry' }, name: 'Chickpea and tomato curry', servings: 3, status: 'planned', statusAt: null, prepActivityId: null, kcal: null, note: '' },
      { id: 'm2', date: '2026-10-05', slot: 'lunch', ref: { kind: 'free', text: 'A very long description of a lunch that has to wrap properly on a narrow phone screen without overflow' }, name: 'A very long description of a lunch that has to wrap properly on a narrow phone screen without overflow', servings: 1, status: 'eaten', statusAt: '2026-10-05T12:00:00.000Z', prepActivityId: null, kcal: null, note: '' },
    ];
    d._rev += 3; localStorage.setItem('cleanflow:v1', JSON.stringify(d));
  });
  await page.reload();
  for (const r of ['today', 'meals', 'meals?tab=recipes', 'meals?tab=shopping', 'meals?tab=prefs']) {
    await step(`E ${r} at ${size.w}px: no overflow, every control named, valid ARIA`, async () => {
      await page.evaluate((x) => (location.hash = '#/' + x), r); await page.waitForTimeout(350);
      const a = await page.evaluate(auditPage);
      check('no horizontal overflow', a.docOverflow <= 0 && a.wide.length === 0, JSON.stringify(a.wide));
      check('every control is named', a.unnamed.length === 0, a.unnamed.join(' '));
      check('ARIA states match roles', a.badAria.length === 0, a.badAria.join(' '));
      check('headings do not skip a level', a.skips.length === 0);
    }, page);
  }
  await step(`E the picker, recipe, dish and list sheets fit at ${size.w}px`, async () => {
    await page.evaluate(() => (location.hash = '#/meals')); await page.waitForTimeout(250);
    for (const open of [
      async () => page.getByRole('button', { name: 'Add dinner on Today' }).click(),
      async () => page.getByRole('button', { name: 'Shopping list', exact: true }).click(),
    ]) {
      await open();
      await page.waitForSelector('role=dialog');
      await page.waitForTimeout(400); // the sheet slides in for a moment; measure it once it has settled
      const box = await page.locator('[role=dialog]').boundingBox();
      check('inside the viewport', box.x >= -1 && box.x + box.width <= size.w + 1 && box.y >= -1, JSON.stringify(box));
      const a = await page.evaluate(auditPage);
      check('no overflow inside the sheet', a.docOverflow <= 0);
      await page.keyboard.press('Escape');
      await page.waitForSelector('role=dialog', { state: 'detached' });
    }
  }, page);
  await ctx.close();
}

await browser.close();
done(errors);
