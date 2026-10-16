// Sections and the one shared plan, in a real browser. Needs the dev server (npm run dev) and Chromium (CHROME_PATH).
//
//  A  a person who wants no cleaning plan: onboarding, Today, planning an activity, completing it, undoing it, its history
//  B  Settings: switching sections, the "keep one on" rule, daily time, allowances, Today's layout
//  C  a saved v2 file: opens straight into the app (no onboarding), shows the introduction once, turns on only what their goals point at
//  D  honesty on Today: planned time over the day's minutes, and overlapping fixed times, are reported and nothing is moved
//  E  layout and accessibility of the new screens at every width
import { auditPage, BASE, entriesOf, launch, loadDemo, DEMOS, newContext, runner, stored, WIDTHS, watch } from './lib.mjs';

const { check, step, done } = runner('sections');
const errors = [];
const browser = await launch();
const click = (page, t, o) => page.getByRole('button', { name: t, ...o }).first().click();
const NOW = new Date(2026, 9, 5, 8, 15); // a Monday
const TODAY = '2026-10-05';
const saved = (page) => page.waitForTimeout(700); // the app saves a moment after a change
const text = (page) => page.evaluate(() => document.querySelector('main')?.innerText ?? '');

const mk = async (size = { w: 390, h: 844, mobile: true }) => {
  const ctx = await newContext(browser, size);
  const page = await ctx.newPage();
  watch(page, errors, `${size.w}`);
  await page.clock.setFixedTime(NOW);
  return { ctx, page };
};

const plan = async (page, { name, minutes, once = true, time, kind, section }) => {
  await page.getByRole('button', { name: 'Plan an activity' }).first().click();
  await page.waitForSelector('role=dialog[name="Plan an activity"]');
  await page.fill('#a-name', name);
  if (section && (await page.getByRole('radio', { name: section, exact: true }).count())) await page.getByRole('radio', { name: section, exact: true }).click();
  if (kind) await page.getByRole('radio', { name: kind }).click();
  if (once) await page.getByRole('radio', { name: 'One day' }).click();
  if (time) await page.fill('#a-time', time);
  await page.fill('#a-min', String(minutes));
  await page.getByRole('button', { name: 'Add to my plan' }).click();
  await page.waitForSelector('role=dialog', { state: 'detached' });
};

// ───────────── A ─────────────
{
  const { ctx, page } = await mk();
  await page.goto(BASE); await page.evaluate(() => localStorage.clear()); await page.reload();
  await step('A onboarding without cleaning: choose Movement and Meals only', async () => {
    await click(page, 'Build my plan');
    await page.waitForSelector('text=What do you want help with');
    // nothing is pre-selected for a new person
    check('no section is pre-selected', (await page.getByRole('checkbox', { checked: true }).count()) === 0);
    await page.getByRole('checkbox', { name: /^Movement/ }).click();
    await page.getByRole('checkbox', { name: /^Meals & shopping/ }).click();
    await click(page, 'Continue');
    // no home questions: straight to time
    await page.waitForSelector('text=How much time can you give your plan each day');
    await page.getByRole('radio', { name: '20 minutes' }).click();
    await page.getByRole('radio', { name: '4', exact: true }).click();
    await click(page, 'Continue');
    await click(page, 'Skip');
    await page.waitForSelector('text=Ready when you are');
    await click(page, 'Build my plan');
    await page.waitForSelector('text=Good', { timeout: 9000 });
  }, page);
  await step('A the saved data has no cleaning plan and the two sections on', async () => {
    await saved(page);
    const d = await stored(page);
    check('schema v3', d.version === 3);
    check('focus is empty, not defaulted to home', Array.isArray(d.preferences.focus) && d.preferences.focus.length === 0, JSON.stringify(d.preferences.focus));
    check('sections on', d.modules.enabled.movement && d.modules.enabled.meals && !d.modules.enabled.learning);
    check('onboarding complete', d.onboardingComplete === true);
    const t = await text(page);
    check('Today does not talk about cleaning', !/\bclean(ing|ed)?\b/i.test(t.replace(/CleanFlow/g, '')), t.slice(0, 200));
  }, page);
  await step('A the section pages exist for what was chosen, and only that', async () => {
    await page.goto(BASE + '#/more');
    const t = await text(page);
    check('Movement and Meals are listed', /Movement/.test(t) && /Meals & shopping/.test(t));
    check('Learning is not', !/Learning & hobbies/.test(t));
    check('Home is not offered as a place', !/Rooms, people, pets/.test(t));
    await page.goto(BASE + '#/learning');
    check('a switched-off section says so', /switched off/.test(await text(page)));
  }, page);
  await step('A plan an activity for today in Movement', async () => {
    await page.goto(BASE + '#/movement?tab=plan');
    await page.waitForSelector('text=Nothing planned yet');
    await plan(page, { name: 'Morning stretch', minutes: 10 });
    check('it is listed in its section', /Morning stretch/.test(await text(page)));
    await saved(page);
    const d = await stored(page);
    check('stored once, in Movement, for today', d.activities.length === 1 && d.activities[0].module === 'movement' && d.activities[0].schedule.date === TODAY, JSON.stringify(d.activities));
  }, page);
  await step('A it is on Today, completes once, undoes, completes again', async () => {
    await page.goto(BASE + '#/today');
    const card = page.locator('article.task', { hasText: 'Morning stretch' });
    await card.waitFor();
    check('shown as planned by the person, not as a priority', /Planned by you/.test(await card.innerText()));
    await card.getByRole('button', { name: /Mark Morning stretch complete/ }).click();
    await page.waitForSelector('.toast button:has-text("Undo")');
    await saved(page);
    check('one entry', (await entriesOf(page)).filter((e) => e.taskId.startsWith('act:')).length === 1);
    await page.locator('.toast button:has-text("Undo")').last().click();
    await saved(page);
    check('undo removes exactly that entry', (await entriesOf(page)).length === 0);
    await card.getByRole('button', { name: /Mark Morning stretch complete/ }).click();
    await saved(page);
    const es = (await entriesOf(page)).filter((e) => e.taskId.startsWith('act:'));
    check('one record again, in the fitness area', es.length === 1 && es[0].domain === 'fitness', JSON.stringify(es));
  }, page);
  await step('A its section shows the same completion, and not-recorded stays separate from skipped', async () => {
    await page.goto(BASE + '#/movement?tab=plan');
    await page.waitForSelector('text=Morning stretch');
    const t = await text(page);
    check('history says done', /1 done/.test(t), t.slice(0, 300));
    check('nothing is called skipped', !/skipped/.test(t));
  }, page);
  await ctx.close();
}

// ───────────── B ─────────────
{
  const { ctx, page } = await mk({ w: 1024, h: 800, mobile: false });
  await page.goto(BASE); await page.evaluate(() => localStorage.clear()); await page.reload();
  await loadDemo(page, DEMOS.beginner);
  await step('B Settings lists every section with a switch, in plain words', async () => {
    await page.goto(BASE + '#/settings');
    await page.waitForSelector('#sections');
    for (const n of ['Home & cleaning', 'Movement', 'Meals & shopping', 'Learning & hobbies', 'Wellbeing']) check(`switch: ${n}`, (await page.getByRole('switch', { name: n }).count()) === 1);
    check('daily time says what it covers and what it does not', /does not.* count eating, sleeping or drinking water/.test((await page.locator('#sections').innerText()).replace(/\s+/g, ' ')));
  }, page);
  await step('B a section turns on and appears in the sidebar; off hides it and keeps its data', async () => {
    await page.getByRole('switch', { name: 'Learning & hobbies' }).check().catch(() => {}); // already on for this demo (its goal is study)
    await page.getByRole('switch', { name: 'Movement' }).check();
    await page.waitForSelector('aside a[href="#/movement"]');
    await page.goto(BASE + '#/movement?tab=plan');
    await plan(page, { name: 'Gentle walk', minutes: 15 });
    await page.goto(BASE + '#/settings');
    await page.getByRole('switch', { name: 'Movement' }).uncheck();
    await saved(page);
    check('gone from the sidebar', (await page.locator('aside a[href="#/movement"]').count()) === 0);
    check('its plan is still saved', (await stored(page)).activities.some((a) => a.name === 'Gentle walk'));
    await page.getByRole('switch', { name: 'Movement' }).check();
    await page.goto(BASE + '#/movement?tab=plan');
    check('and back when switched on again', /Gentle walk/.test(await text(page)));
  }, page);
  await step('B the last section cannot be switched off', async () => {
    await page.goto(BASE + '#/settings');
    await page.getByRole('switch', { name: 'Movement' }).uncheck();
    await saved(page);
    const learning = page.getByRole('switch', { name: 'Learning & hobbies' });
    // Learning is now the only section on (this person has no cleaning plan): the switch refuses, and says why
    await learning.click({ force: true });
    await page.waitForSelector('.toast');
    check('says why', /Keep at least one section on/.test((await page.locator('.toast').allInnerTexts()).join(' ')));
    check('it stays on', await learning.isChecked());
    await saved(page);
    const d = await stored(page);
    check('saved data agrees', d.modules.enabled.learning === true);
  }, page);
  await step("B Today's layout controls appear only when there is more than one card", async () => {
    check('a single card needs no layout controls', (await page.getByRole('heading', { name: "Today's layout" }).count()) === 0);
    await page.getByRole('switch', { name: 'Meals & shopping' }).check();
    await page.getByRole('heading', { name: "Today's layout" }).waitFor();
    await page.getByRole('button', { name: 'Move Meals up' }).click();
    await saved(page);
    const d = await stored(page);
    check('the order is saved', d.modules.order[0] === 'meals' && d.modules.order[1] === 'plan', JSON.stringify(d.modules.order));
    await page.getByRole('button', { name: 'Hide', exact: true }).click();
    await saved(page);
    check('a card can be hidden', (await stored(page)).modules.hidden.join() === 'meals');
    check('the plan card has no hide button, the hidden one offers Show', (await page.getByRole('button', { name: 'Hide', exact: true }).count()) === 0 && (await page.getByRole('button', { name: 'Show', exact: true }).count()) === 1);
  }, page);
  await ctx.close();
}

// ───────────── C ─────────────
{
  const { ctx, page } = await mk({ w: 1024, h: 800, mobile: false });
  await page.goto(BASE); await page.evaluate(() => localStorage.clear()); await page.reload();
  await loadDemo(page, DEMOS.student);
  await step('C rewrite the saved file as a v2 install would have it, then reload', async () => {
    await page.evaluate(() => {
      const d = JSON.parse(localStorage.getItem('cleanflow:v1'));
      d.version = 2; delete d.modules; delete d.activities; d._rev = (d._rev ?? 0) + 5;
      localStorage.setItem('cleanflow:v1', JSON.stringify(d));
    });
    await page.reload();
    await page.waitForSelector('text=Habits & routine', { timeout: 9000 });
    check('no onboarding', (await page.getByText('What do you want help with').count()) === 0);
  }, page);
  await step('C migrated: version 3, sections only where a goal pointed, introduction shown once', async () => {
    await page.waitForTimeout(800);
    const d = await stored(page);
    check('v3 on disk after the first save', d.version === 3, String(d.version));
    check('study goal -> Learning on, the rest off', d.modules.enabled.learning === true && !d.modules.enabled.meals && !d.modules.enabled.water, JSON.stringify(d.modules.enabled));
    check('the introduction is waiting', d.modules.introSeen === false);
    check('their history is intact', d.sessions.length > 0);
    await page.waitForSelector('[data-testid="sections-intro"]');
    check('the sidebar has Learning', (await page.locator('aside a[href="#/learning"]').count()) === 1);
    await click(page, 'Not now');
    await page.reload();
    await page.waitForSelector('text=Habits & routine');
    check('the introduction does not come back', (await page.locator('[data-testid="sections-intro"]').count()) === 0);
  }, page);
  await ctx.close();
}

// ───────────── D ─────────────
{
  const { ctx, page } = await mk();
  await page.goto(BASE); await page.evaluate(() => localStorage.clear()); await page.reload();
  await loadDemo(page, DEMOS.beginner);
  await step('D a planned activity longer than the day: the overage is said plainly and nothing is removed', async () => {
    await page.evaluate(() => {
      const d = JSON.parse(localStorage.getItem('cleanflow:v1'));
      d.modules = { enabled: { movement: true, meals: false, water: false, learning: false, wellbeing: false }, order: ['plan', 'meals', 'water', 'checkin'], hidden: [], caps: {}, introSeen: true };
      d.preferences.sessionMinutes = 15; d._rev += 3;
      localStorage.setItem('cleanflow:v1', JSON.stringify(d));
    });
    await page.reload();
    await page.goto(BASE + '#/movement?tab=plan');
    await page.waitForSelector('text=Plan an activity');
    await plan(page, { name: 'Long bike ride', minutes: 45 });
    await page.goto(BASE + '#/today');
    const over = page.locator('[data-testid="over-budget"]');
    await over.waitFor();
    const t = await over.innerText();
    check('says how far over', /over your 15-minute day/.test(t), t);
    check('names it as something they planned', /Long bike ride/.test(t) && /planned/.test(t));
    check('says nothing was removed', /Nothing you planned was removed/.test(t));
    check('the activity is on Today', (await page.locator('article.task', { hasText: 'Long bike ride' }).count()) === 1);
  }, page);
  await step('D two fixed activities that overlap are reported, and both stay where the person put them', async () => {
    await page.goto(BASE + '#/movement?tab=plan');
    await plan(page, { name: 'Yoga class', minutes: 60, time: '18:00', kind: 'At a set time' });
    await plan(page, { name: 'Pilates', minutes: 45, time: '18:30', kind: 'At a set time' });
    await page.goto(BASE + '#/today');
    const c = page.locator('[data-testid="conflicts"]');
    await c.waitFor();
    const t = await c.innerText();
    check('says they overlap and nothing was moved', /overlap/.test(t) && /Nothing was moved/.test(t), t);
    await saved(page);
    const d = await stored(page);
    check('times untouched', d.activities.find((a) => a.name === 'Yoga class').time === '18:00' && d.activities.find((a) => a.name === 'Pilates').time === '18:30');
  }, page);
  await ctx.close();
}

// ───────────── E ─────────────
for (const size of WIDTHS) {
  const { ctx, page } = await mk(size);
  await page.goto(BASE); await page.evaluate(() => localStorage.clear()); await page.reload();
  await loadDemo(page, DEMOS.beginner);
  await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('cleanflow:v1'));
    d.modules = { enabled: { movement: true, meals: true, water: false, learning: true, wellbeing: true }, order: ['plan', 'meals', 'water', 'checkin'], hidden: [], caps: { movement: 30 }, introSeen: false };
    d.activities = [{ id: 'a1', module: 'movement', kind: 'fixed', name: 'Evening walk with a very long name that has to wrap properly on a narrow phone screen', minutes: 30, schedule: { kind: 'weekly', weekdays: [0, 1, 2, 3, 4, 5, 6] }, time: '18:30', startDate: '2026-09-01', endDate: null, ref: null, intensity: 'gentle', difficulty: 1, note: '', createdAt: '2026-09-01T08:00:00.000Z', archived: false }];
    d._rev += 3; localStorage.setItem('cleanflow:v1', JSON.stringify(d));
  });
  await page.reload();
  for (const r of ['today', 'movement', 'settings', 'more']) {
    await step(`E ${r} at ${size.w}px: no overflow, names for every control, valid ARIA`, async () => {
      await page.evaluate((x) => (location.hash = '#/' + x), r); await page.waitForTimeout(350);
      const a = await page.evaluate(auditPage);
      check('no horizontal overflow', a.docOverflow <= 0 && a.wide.length === 0, JSON.stringify(a.wide));
      check('bottom bar fits', a.navOverflow === 0);
      check('every control is named', a.unnamed.length === 0, a.unnamed.join(' '));
      check('ARIA states match roles', a.badAria.length === 0, a.badAria.join(' '));
      check('headings do not skip a level', a.skips.length === 0);
    }, page);
  }
  await step(`E the planning sheet fits at ${size.w}px`, async () => {
    await page.evaluate(() => (location.hash = '#/movement?tab=plan')); await page.waitForTimeout(250);
    await page.getByRole('button', { name: 'Plan an activity' }).first().click();
    await page.waitForSelector('role=dialog');
    await page.waitForTimeout(400); // the sheet slides in for a moment; measure it once it has settled
    const box = await page.locator('[role=dialog]').boundingBox();
    check('inside the viewport', box.x >= -1 && box.x + box.width <= size.w + 1, JSON.stringify(box));
    const foot = await page.getByRole('button', { name: 'Add to my plan' }).boundingBox();
    check('the save button is reachable', foot.y + foot.height <= size.h + 1 && foot.y >= 0, JSON.stringify(foot));
    await page.keyboard.press('Escape');
  }, page);
  await ctx.close();
}

await browser.close();
done(errors);
