// The assistant, reminders and health settings, in a real browser. Needs the dev server (npm run dev) and Chromium (CHROME_PATH).
// The AI is never really called: /api/assist is answered by the test, so what is sent and what is shown can be checked exactly.
//
//  A  no AI set up: the app's own suggestion works, is labelled, is reviewed line by line, and can be undone
//  B  AI set up: nothing is sent until Send; what is sent has nothing private in it; an invented or unsafe answer never reaches the screen
//  C  movement and learning
//  D  reminders: honest status, per-activity choices, coming up, quiet hours, snooze, calendar file
//  E  health: not available in a browser, and says so
//  F  layout at every width
import { auditPage, BASE, entriesOf, launch, newContext, runner, stored, WIDTHS, watch } from './lib.mjs';

const { check, step, done } = runner('assist');
const errors = [];
const browser = await launch();
const click = (page, t, o) => page.getByRole('button', { name: t, ...o }).first().click();
const text = (page) => page.evaluate(() => document.querySelector('main')?.innerText ?? '');
const dlg = (page) => page.locator('[role=dialog]');
const go = async (page, hash) => { await page.evaluate((h) => (location.hash = '#/' + h), hash); await page.waitForTimeout(350); };
const sheet = async (page) => { await page.waitForSelector('role=dialog'); await page.waitForTimeout(420); };
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dayN = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };

const mk = async (size = { w: 390, h: 844, mobile: true }) => {
  const ctx = await newContext(browser, size);
  const page = await ctx.newPage();
  watch(page, errors, `${size.w}`);
  return { ctx, page };
};

const onboard = async (page, sections) => {
  await page.goto(BASE); await page.evaluate(() => localStorage.clear()); await page.reload();
  await click(page, 'Build my plan');
  await page.waitForSelector('text=What do you want help with');
  for (const s of sections) await page.getByRole('checkbox', { name: new RegExp(`^${s}`) }).click();
  await click(page, 'Continue');
  await page.waitForSelector('text=How much time can you give your plan each day');
  await page.getByRole('radio', { name: '30 minutes' }).click();
  await page.getByRole('radio', { name: '4', exact: true }).click();
  await click(page, 'Continue');
  await click(page, 'Skip');
  await page.waitForSelector('text=Ready when you are');
  await click(page, 'Build my plan');
  await page.waitForSelector('main h1', { timeout: 9000 });
};

/** Answers the assistant's two addresses. `ai` is a function from the posted request to a reply, or null for "not set up". */
const stub = async (page, ai) => {
  const seen = { status: 0, posts: [] };
  await page.route('**/api/assist/status', (r) => { seen.status++; return r.fulfill({ json: ai ? { available: true, provider: 'Anthropic', model: 'claude-haiku-5-5', cooldownSeconds: 5 } : { available: false } }); });
  await page.route('**/api/assist', async (r) => {
    if (r.request().method() !== 'POST') return r.fallback();
    const body = JSON.parse(r.request().postData() ?? '{}');
    seen.posts.push(body);
    const out = ai ? ai(body) : { status: 503, json: { ok: false, error: { code: 'not-configured', message: 'not set up' } } };
    return r.fulfill({ status: out.status ?? 200, json: out.json });
  });
  return seen;
};

const plannedMeals = async (page) => (await stored(page)).meals.plan;

// ───────────── A, B ─────────────
{
  const { ctx, page } = await mk();
  await onboard(page, ['Meals']);
  const seenA = await stub(page, null);

  await step('A without an AI, the app\'s own suggestion works and says what it is', async () => {
    await go(page, 'meals?tab=plan');
    await click(page, 'Suggest meals'); await sheet(page);
    const t = await dlg(page).innerText();
    check('says the AI is not set up and that the app\'s own suggestion needs no internet', /not set up here/.test(t) && /needs no internet/.test(t), t.slice(0, 300));
    check('"Ask the AI" cannot be pressed', await dlg(page).getByRole('button', { name: 'Ask the AI' }).isDisabled());
    check('the options are counted', /\d+ options? fit what you told us/.test(t));
    check('the journal, diet and health are not mentioned as sent', !/journal|mood|health/i.test(t.replace(/Journals, mood and check-ins, water and health notes are never part of this\./, '')));
    await dlg(page).getByRole('button', { name: 'Suggest with the app' }).click();
    await page.waitForSelector('[data-testid=origin]');
    check('labelled as the app\'s, not the AI\'s', /Suggested by the app, no AI/.test(await page.getByTestId('origin').innerText()));
    const n = await page.getByTestId('proposal-item').count();
    check('a proposal for the chosen days and meals', n >= 4, String(n));
    check('every line has a reason', (await page.getByTestId('proposal-item').allInnerTexts()).every((x) => /minutes in total/.test(x)));
    check('nothing was sent anywhere', seenA.posts.length === 0);
    check('and nothing was added yet', (await plannedMeals(page)).length === 0);
  }, page);

  await step('A untick lines, add the rest, and Undo removes exactly those', async () => {
    const boxes = dlg(page).getByRole('checkbox');
    const n = await boxes.count();
    await boxes.nth(0).uncheck(); await boxes.nth(1).uncheck();
    const label = await dlg(page).getByRole('button', { name: /^Add \d+ meals? to my plan/ }).innerText();
    check('the button counts what is ticked', label === `Add ${n - 2} meals to my plan`, label);
    await dlg(page).getByRole('button', { name: /^Add \d+ meals? to my plan/ }).click();
    await page.waitForTimeout(800);
    const plan = await plannedMeals(page);
    check('only the ticked meals were added', plan.length === n - 2, `${plan.length} vs ${n - 2}`);
    check('each is planned (not eaten), with a recipe and a number of servings, and no calories made up', plan.every((m) => m.status === 'planned' && m.ref.kind === 'recipe' && m.servings >= 1 && m.kcal === null));
    check('on the days offered', plan.every((m) => m.date >= dayN(0) && m.date <= dayN(4)));
    await page.locator('.toasts, [role=status]').getByRole('button', { name: 'Undo' }).first().click();
    await page.waitForTimeout(700);
    check('Undo removes exactly those meals', (await plannedMeals(page)).length === 0);
  }, page);

  await step('A approving the same suggestion twice does not double up', async () => {
    await click(page, 'Suggest meals'); await sheet(page);
    await dlg(page).getByRole('button', { name: 'Suggest with the app' }).click();
    await page.waitForSelector('[data-testid=origin]');
    await dlg(page).getByRole('button', { name: /^Add \d+ meals? to my plan/ }).click(); await page.waitForTimeout(700);
    const first = (await plannedMeals(page)).length;
    await click(page, 'Suggest meals'); await sheet(page);
    await dlg(page).getByRole('button', { name: 'Suggest with the app' }).click();
    await page.waitForSelector('[data-testid=origin]');
    await dlg(page).getByRole('button', { name: /^Add \d+ meals? to my plan/ }).click(); await page.waitForTimeout(700);
    check('the same meals are not planned again', (await plannedMeals(page)).length === first, `${first} then ${(await plannedMeals(page)).length}`);
  }, page);
  await ctx.close();
}

{
  const { ctx, page } = await mk();
  await onboard(page, ['Meals', 'Wellbeing', 'Water']);
  // things that must never leave the device
  await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('cleanflow:v1'));
    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    d.wellbeing.journal = [{ id: 'j1', date, at: now.toISOString(), title: 'SECRET-TITLE', text: 'SECRET-JOURNAL-TEXT' }];
    d.wellbeing.checkins = [{ id: 'c1', date, at: now.toISOString(), energy: 'low', mood: 2, note: 'SECRET-CHECKIN-NOTE' }];
    d.water.entries = [{ id: 'w1', date, at: now.toISOString(), ml: 777 }];
    d.health = { prefs: { enabled: true, read: { steps: true, exercise: false, water: false } }, daily: { [date]: { steps: 31337, platform: 'healthkit', at: now.toISOString() } }, lastSync: now.toISOString() };
    d.meals.prefs.diet = 'vegetarian'; d.meals.prefs.avoid = ['gluten'];
    d.meals.dishes = [{ id: 'dish_mine', name: 'SECRET-OWN-DISH', source: 'personal', servings: 2, prepMinutes: 5, cookMinutes: 5, slots: ['dinner'], tags: [], equipment: [], ingredients: [{ name: 'carrot', qty: 1, unit: 'piece' }], steps: ['x'] }];
    d._rev += 3; localStorage.setItem('cleanflow:v1', JSON.stringify(d));
  });
  await page.reload(); await page.waitForSelector('main h1');
  const good = (req) => ({
    json: {
      ok: true, meta: { provider: 'Anthropic', model: 'claude-haiku-5-5' },
      proposal: {
        feature: 'meals', note: 'A simple spread over your days.',
        items: [
          { candidateId: req.candidates[0].id, date: req.days[0], slot: req.candidates[0].slots[0], reason: `A ${req.candidates[0].minutes} minute meal.` },
          { candidateId: 'invented-restaurant-meal', date: req.days[0], slot: 'dinner', reason: 'Tasty.' },
          { candidateId: req.candidates[1].id, date: req.days[1], slot: req.candidates[1].slots[0], reason: 'High in protein and healthy.' },
          { candidateId: req.candidates[1].id, date: '2099-01-01', slot: req.candidates[1].slots[0], reason: 'Another day.' },
          { candidateId: req.candidates[1].id, date: req.days[1], slot: req.candidates[1].slots[0], reason: `A ${req.candidates[1].minutes} minute option.` },
        ],
      },
    },
  });
  const seen = await stub(page, good);

  await step('B "Ask the AI" shows exactly what would be sent, and sends nothing until Send', async () => {
    await go(page, 'meals?tab=plan');
    await click(page, 'Suggest meals'); await sheet(page);
    await page.getByLabel('A note about what you would like (optional)').fill('quick weeknights, please');
    await dlg(page).getByRole('button', { name: 'Ask the AI' }).click();
    await page.waitForSelector('text=What will be sent');
    const t = await dlg(page).innerText();
    check('says nothing has been sent yet', /Nothing has been sent yet/.test(t));
    check('shows the note, the days and the options', /quick weeknights, please/.test(t) && /recipes?, with name, minutes and tags only/.test(t));
    check('says what stays here, and that the list can hint at settings', /What stays on this device/.test(t) && /can hint at them/.test(t) && /never part of this/.test(t));
    check('says where it goes and who pays', /Anthropic/.test(t) && /billed to the provider account/.test(t));
    check('no request to the assistant was made yet', seen.posts.length === 0);
    await dlg(page).getByRole('button', { name: 'Back' }).click();
    check('Back sends nothing either', seen.posts.length === 0);
    await dlg(page).getByRole('button', { name: 'Ask the AI' }).click();
    await page.waitForSelector('text=What will be sent');
    await dlg(page).getByRole('button', { name: 'Send to the AI' }).click();
    await page.waitForSelector('[data-testid=origin]');
    check('exactly one request was sent', seen.posts.length === 1);
  }, page);

  await step('B what was sent has only candidates, days and the note: nothing private, no settings', async () => {
    const body = seen.posts[0];
    check('exactly the fixed fields', JSON.stringify(Object.keys(body).sort()) === JSON.stringify(['candidates', 'days', 'feature', 'maxItems', 'slots', 'v', 'wish']), Object.keys(body).join(','));
    const raw = JSON.stringify(body);
    check('no journal, check-in, water, health or own-dish text', !/SECRET|777|31337|steps/i.test(raw));
    check('no diet or allergen settings (and none of the diet tags)', !/vegetarian|vegan|pescatarian|gluten|allerg/i.test(raw), raw.slice(0, 300));
    check('only the built-in recipes (own dishes were not included)', body.candidates.length > 0 && body.candidates.every((c) => !/SECRET/.test(c.name) && !c.id.startsWith('dish_')));
    check('the note is there', body.wish === 'quick weeknights, please');
    check('every candidate is just id, name, minutes, tags, slots', body.candidates.every((c) => JSON.stringify(Object.keys(c).sort()) === JSON.stringify(['id', 'minutes', 'name', 'slots', 'tags'])));
  }, page);

  await step('B what the AI got wrong never reaches the screen, and what is shown is labelled as the AI\'s', async () => {
    check('labelled as an AI suggestion, with the model', /AI suggestion · claude-haiku-5-5/.test(await page.getByTestId('origin').innerText()));
    check('told to check it', /The AI can be wrong/.test(await dlg(page).innerText()));
    const items = await page.getByTestId('proposal-item').allInnerTexts();
    check('only the valid lines are shown: not the invented one, not the health claim, not the other day', items.length === 2, JSON.stringify(items));
    const t = await dlg(page).innerText();
    check('no invented meal, no health claim', !/invented|protein|healthy|Tasty/i.test(t));
    check('nothing was added by looking', (await plannedMeals(page)).length === 0);
    await dlg(page).getByRole('button', { name: /^Add \d+ meals? to my plan/ }).click(); await page.waitForTimeout(800);
    const plan = await plannedMeals(page);
    check('the two approved meals are in the plan, with the recipes\' own names', plan.length === 2 && plan.every((m) => m.ref.kind === 'recipe' && m.name.length > 2));
  }, page);

  await step('B an answer that cannot be checked is shown as nothing, calmly, and changes nothing', async () => {
    const page2 = page;
    await page2.unroute('**/api/assist');
    await page2.route('**/api/assist', (r) => (r.request().method() === 'POST' ? r.fulfill({ json: { ok: true, proposal: null, notice: 'unreliable', meta: { provider: 'Anthropic', model: 'claude-haiku-5-5' } } }) : r.fallback()));
    const before = (await plannedMeals(page2)).length;
    await click(page2, 'Suggest meals'); await sheet(page2);
    await dlg(page2).getByRole('button', { name: 'Ask the AI' }).click();
    await page2.waitForSelector('text=What will be sent');
    await dlg(page2).getByRole('button', { name: 'Send to the AI' }).click();
    await page2.waitForSelector('text=could not be checked');
    check('says so, plainly', /none of it is shown. Nothing was changed/.test(await dlg(page2).innerText()));
    check('nothing changed', (await plannedMeals(page2)).length === before);
    await dlg(page2).getByRole('button', { name: 'Close', exact: true }).last().click();
  }, page);

  await step('B a limit or an error from the server is shown in its own calm words, with nothing changed', async () => {
    await page.unroute('**/api/assist');
    await page.route('**/api/assist', (r) => (r.request().method() === 'POST' ? r.fulfill({ status: 429, json: { ok: false, error: { code: 'cooldown', message: 'Please wait 12 seconds before asking again.', retryAfterSeconds: 12 } } }) : r.fallback()));
    await page.waitForTimeout(5200);
    await click(page, 'Suggest meals'); await sheet(page);
    await dlg(page).getByRole('button', { name: 'Ask the AI' }).click();
    await page.waitForSelector('text=What will be sent');
    await dlg(page).getByRole('button', { name: 'Send to the AI' }).click();
    await page.waitForSelector('[role=alert]');
    check('the server\'s words', /Please wait 12 seconds/.test(await dlg(page).locator('[role=alert]').innerText()));
    check('the app\'s own suggestion is still offered', await dlg(page).getByRole('button', { name: 'Suggest with the app' }).isEnabled());
    await page.keyboard.press('Escape');
  }, page);
  await ctx.close();
}

// ───────────── C ─────────────
{
  const { ctx, page } = await mk();
  await onboard(page, ['Movement', 'Learning']);
  await stub(page, null);
  await step('C movement: the app\'s own plan skips rest days, never puts two sessions on a day, and adds ordinary planned workouts', async () => {
    await go(page, 'movement?tab=setup');
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    await page.getByRole('checkbox', { name: names[tomorrow.getDay()] }).click();
    await go(page, 'movement?tab=plan');
    await click(page, 'Plan my movement'); await sheet(page);
    await dlg(page).getByRole('button', { name: 'Suggest with the app' }).click();
    await page.waitForSelector('[data-testid=origin]');
    const dates = await page.getByTestId('proposal-item').locator('input[type=checkbox]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
    check('three sessions by default', dates.length === 3, JSON.stringify(dates));
    check('no two on one day', new Set(dates.map((x) => x.split(', ').slice(1).join(', '))).size === dates.length, JSON.stringify(dates));
    check('none on the rest day', !dates.some((x) => x.includes(tomorrow.toLocaleDateString(undefined, { weekday: 'long' }).slice(0, 3)) && /Tomorrow/.test(x)), JSON.stringify(dates));
    await dlg(page).getByRole('button', { name: /^Add \d+ sessions? to my plan/ }).click(); await page.waitForTimeout(800);
    const d = await stored(page);
    check('three planned workouts, each one day, with the workout\'s own minutes', d.activities.length === 3 && d.activities.every((a) => a.module === 'movement' && a.schedule.kind === 'once' && a.ref?.kind === 'workout' && a.minutes >= 1));
    check('none on the declared rest day', !d.activities.some((a) => a.schedule.date === dayN(1)));
    const text2 = await text(page);
    check('they show in the plan', d.activities.every((a) => text2.includes(a.name)));
  }, page);

  await step('C learning: ideas only open or add on your say-so', async () => {
    await go(page, 'learning?tab=discover');
    await click(page, 'Ideas to try'); await sheet(page);
    check('says it uses the Discover answers', /uses your answers on the Discover tab/.test(await dlg(page).innerText()));
    await dlg(page).getByRole('button', { name: 'Suggest with the app' }).click();
    await page.waitForSelector('[data-testid=origin]');
    const n = await page.getByTestId('proposal-item').count();
    check('up to three ideas', n >= 1 && n <= 3, String(n));
    check('nothing was added by looking', (await stored(page)).interests.items.length === 0);
    await dlg(page).getByRole('button', { name: 'Add to my interests' }).first().click(); await page.waitForTimeout(600);
    check('adding one adds exactly one, as "trying it out"', (await stored(page)).interests.items.length === 1 && (await stored(page)).interests.items[0].status === 'exploring');
    await dlg(page).getByRole('button', { name: 'Try it' }).first().click(); await sheet(page);
    check('"Try it" opens the first try', /You will need|You need nothing/.test(await dlg(page).innerText()));
    await page.keyboard.press('Escape');
  }, page);
  await ctx.close();
}

// ───────────── D ─────────────
{
  const { ctx, page } = await mk();
  await ctx.grantPermissions([], { origin: BASE });
  await onboard(page, ['Movement']);
  const at = new Date(); at.setHours(at.getHours() + 3, 30, 0, 0);
  const hh = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
  const sameDay = iso(at) === dayN(0);
  await page.evaluate(({ date, time }) => {
    const d = JSON.parse(localStorage.getItem('cleanflow:v1'));
    const mkAct = (id, name, t, extra = {}) => ({ id, module: 'movement', kind: t ? 'fixed' : 'flexible', name, minutes: 30, schedule: { kind: 'once', date }, time: t, startDate: date, endDate: null, ref: null, intensity: 'gentle', difficulty: 1, note: 'Bring water, a hat; and a slash', createdAt: new Date().toISOString(), archived: false, ...extra });
    d.activities = [mkAct('r1', 'Evening walk', time), mkAct('r2', 'No time planned', null), mkAct('r3', 'Quiet one', '23:30'), mkAct('r4', 'Turned off one', time, { remind: 'off' })];
    d._rev += 3; localStorage.setItem('cleanflow:v1', JSON.stringify(d));
  }, { date: iso(at), time: hh });
  await page.reload(); await page.waitForSelector('main h1');

  await step('D reminders start off, and the screen says what that means', async () => {
    await go(page, 'settings'); await page.waitForSelector('[data-testid=reminders]');
    check('off by default', (await stored(page)).reminders.prefs.enabled === false);
    check('says nothing will remind you', /Off\. Nothing will remind you/.test(await page.getByTestId('reminder-status').innerText()));
    check('does not list upcoming reminders while off', (await page.getByTestId('upcoming').count()) === 0);
  }, page);

  await step('D turning them on says what a browser can and cannot do, and never claims more', async () => {
    await page.getByRole('switch', { name: 'Remind me about things I planned' }).click();
    await page.waitForTimeout(700);
    const t = await page.getByTestId('reminder-status').innerText();
    check('says reminders appear while CleanFlow is open, and not when it is closed', /inside CleanFlow while it is open/.test(t) && /cannot reach you when it is closed/.test(t), t);
    check('does not say it will work when closed', !/even when CleanFlow is closed/.test(t));
    check('saved', (await stored(page)).reminders.prefs.enabled === true);
  }, page);

  await step('D coming up: each planned time, and why one is not sent', async () => {
    const items = await page.getByTestId('upcoming').allInnerTexts();
    const all = items.join('\n');
    check('the evening walk is listed with a reminder time', !sameDay || /Evening walk/.test(all) && /Reminder at/.test(all), all);
    check('no time means no reminder, and says so', /No time planned[\s\S]*No time set, so no reminder/.test(all.replace(/\n/g, ' ')) || !sameDay, all);
    check('quiet hours are named', /Quiet one[\s\S]*Not sent: quiet hours/.test(all.replace(/\n/g, ' ')) || !sameDay, all);
    check('turned off for one activity', /Turned off one[\s\S]*Reminder turned off for this one/.test(all.replace(/\n/g, ' ')) || !sameDay, all);
  }, page);

  await step('D lead time, quiet hours and snooze are settings that stick, and a bad time is not stored', async () => {
    const rem = page.getByTestId('reminders');
    await rem.getByRole('radio', { name: '30 min', exact: true }).first().click();
    await rem.getByRole('radio', { name: '15 min', exact: true }).last().click();
    await rem.getByRole('switch', { name: 'Quiet hours' }).click(); await page.waitForTimeout(200);
    await rem.getByRole('switch', { name: 'Quiet hours' }).click();
    await page.locator('#rq-from').fill('21:15');
    await page.waitForTimeout(1200);
    const p = (await stored(page)).reminders.prefs;
    check('lead 30 min', p.leadMinutes === 30);
    check('snooze 15 min', p.snoozeMinutes === 15);
    check('quiet from 21:15', p.quiet.on === true && p.quiet.from === '21:15');
    await rem.getByRole('checkbox', { name: 'Movement' }).click(); await page.waitForTimeout(900);
    check('a section can be left out', (await stored(page)).reminders.prefs.modules.movement === false);
    await rem.getByRole('checkbox', { name: 'Movement' }).click(); await page.waitForTimeout(500);
  }, page);

  await step('D a reminder that has come due is shown inside the app, once, and Snooze moves just that one', async () => {
    const now = new Date(); const soon = new Date(now.getTime() + 10 * 60_000);
    await page.evaluate(({ time, date }) => {
      const d = JSON.parse(localStorage.getItem('cleanflow:v1'));
      d.activities.push({ id: 'due1', module: 'movement', kind: 'fixed', name: 'Due now walk', minutes: 20, schedule: { kind: 'once', date }, time, startDate: date, endDate: null, ref: null, intensity: 'gentle', difficulty: 1, note: '', createdAt: new Date().toISOString(), archived: false, remind: 30 });
      d.reminders.prefs.quiet.on = false; d.reminders.prefs.enabled = true;
      d._rev += 3; localStorage.setItem('cleanflow:v1', JSON.stringify(d));
    }, { time: `${pad(soon.getHours())}:${pad(soon.getMinutes())}`, date: iso(soon) });
    await page.reload(); await page.waitForSelector('main h1');
    await page.waitForSelector('text=Due now walk', { timeout: 8000 });
    const toast = page.locator('.toasts, [role=status]').filter({ hasText: 'Due now walk' }).first();
    check('shown with its planned time', /planned for \d\d:\d\d/.test(await toast.innerText()));
    check('once: it is recorded as shown', Object.keys((await stored(page)).reminders.shown).some((k) => k.startsWith('due1@')));
    await page.getByRole('button', { name: /Snooze 15 min/ }).click(); await page.waitForTimeout(700);
    const s = (await stored(page)).reminders.snoozed;
    check('only that occurrence is snoozed, for 15 minutes', Object.keys(s).length === 1 && Object.keys(s)[0].startsWith('due1@') && Math.abs(Date.parse(Object.values(s)[0]) - (Date.now() + 15 * 60_000)) < 60_000, JSON.stringify(s));
    await page.reload(); await page.waitForSelector('main h1'); await page.waitForTimeout(1500);
    check('it does not come straight back', (await page.locator('.toasts, [role=status]').filter({ hasText: 'Due now walk' }).count()) === 0);
  }, page);

  await step('D completing or deleting an activity removes its reminder', async () => {
    await go(page, 'settings'); await page.waitForSelector('[data-testid=reminders]');
    check('listed before', (await page.getByTestId('upcoming').allInnerTexts()).join().includes('Due now walk'));
    await page.evaluate(() => {
      const d = JSON.parse(localStorage.getItem('cleanflow:v1'));
      d.activities = d.activities.filter((a) => a.id !== 'due1'); d._rev += 3; localStorage.setItem('cleanflow:v1', JSON.stringify(d));
    });
    await page.reload(); await page.waitForSelector('[data-testid=reminders]');
    check('gone after it is deleted', !(await page.getByTestId('upcoming').allInnerTexts()).join().includes('Due now walk'));
  }, page);

  await step('D the calendar file is made on request, is called what it is, and holds the planned times', async () => {
    const t = await page.getByTestId('reminders').innerText();
    check('says events, not notifications, and that CleanFlow cannot change them afterwards', /calendar <b>events<\/b>|calendar events/i.test(t.replace(/\s+/g, ' ')) && /cannot change or remove them/.test(t));
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Download a calendar file/ }).click()]);
    check('named plainly', dl.suggestedFilename() === 'cleanflow-plan.ics');
    const fs = await import('node:fs'); const ics = fs.readFileSync(await dl.path(), 'utf8');
    check('a calendar, with CRLF lines', ics.startsWith('BEGIN:VCALENDAR\r\n') && !/[^\r]\n/.test(ics));
    check('the walk is in it, with its own alert', /SUMMARY:Evening walk/.test(ics) && /TRIGGER:-PT30M/.test(ics));
    check('an activity with no time is not', !/No time planned/.test(ics));
    check('escaped', /DESCRIPTION:Bring water\\, a hat\\; and a slash/.test(ics));
  }, page);

  await step('D alarms, Apple Reminders and Notes: says what it does not do', async () => {
    await page.getByText('What about alarms, Apple Reminders and Notes?').click();
    const t = await page.getByTestId('reminders').innerText();
    check('says it sets no alarms and no Apple Reminders', /does not\s+set clock alarms or add items to Apple Reminders/.test(t.replace(/\s+/g, ' ')) || /does not set clock alarms/.test(t.replace(/\s+/g, ' ')));
    check('says a notification is not an alarm', /a notification is not an alarm/.test(t));
  }, page);

  await step('D a planned activity can have its own reminder, or none', async () => {
    await go(page, 'movement?tab=plan');
    await page.getByRole('button', { name: 'Edit Evening walk' }).click(); await sheet(page);
    check('the form offers the choice', (await dlg(page).getByRole('radiogroup', { name: /Reminder/ }).count()) === 1);
    await dlg(page).getByRole('radio', { name: 'Off for this one' }).click();
    await dlg(page).getByRole('button', { name: 'Save' }).click(); await page.waitForTimeout(800);
    check('saved on that activity only', (await stored(page)).activities.find((a) => a.id === 'r1').remind === 'off' && (await stored(page)).activities.find((a) => a.id === 'r3').remind === undefined);
    await page.getByRole('button', { name: 'Edit Evening walk' }).click(); await sheet(page);
    await dlg(page).getByRole('radio', { name: '60 min before' }).click();
    await dlg(page).getByRole('button', { name: 'Save' }).click(); await page.waitForTimeout(800);
    check('its own lead time', (await stored(page)).activities.find((a) => a.id === 'r1').remind === 60);
  }, page);
  await ctx.close();
}

// ───────────── E ─────────────
{
  const { ctx, page } = await mk();
  await onboard(page, ['Movement']);
  await step('E health data: a browser has none, and says so instead of offering a switch that cannot work', async () => {
    await go(page, 'settings'); await page.waitForSelector('[data-testid=health]');
    await page.waitForSelector('[data-testid=health-status]');
    const t = await page.getByTestId('health').innerText();
    check('says it is not available in a browser, and where it works', /Not available in a browser/.test(t) && /phone app/.test(t));
    check('offers no switch and no "connected"', (await page.getByTestId('health').getByRole('switch').count()) === 0 && !/connected to/i.test(t));
    check('says it is optional, read-only and never goes to the AI', /never part of your plan or your minutes/.test(t.replace(/\s+/g, ' ')) && /never sent to the AI/.test(t.replace(/\s+/g, ' ')));
    check('nothing is stored', Object.keys((await stored(page)).health.daily).length === 0);
  }, page);
  await step('E imported health data, when there is some, is shown apart, labelled, and not in the log or minutes', async () => {
    await page.evaluate(() => {
      const d = JSON.parse(localStorage.getItem('cleanflow:v1'));
      const now = new Date(); const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      d.health = { prefs: { enabled: true, read: { steps: true, exercise: true, water: true } }, daily: { [date]: { steps: 6200, exerciseMinutes: 25, waterMl: 900, platform: 'healthkit', at: now.toISOString(), workouts: [{ id: 'w1', type: 'yoga', minutes: 25, startAt: now.toISOString(), source: 'Watch' }] } }, lastSync: now.toISOString() };
      d._rev += 3; localStorage.setItem('cleanflow:v1', JSON.stringify(d));
    });
    await page.reload(); await page.waitForSelector('main h1');
    await go(page, 'movement?tab=progress');
    const card = page.getByTestId('health-movement');
    await card.waitFor();
    const t = (await card.innerText()).replace(/\s+/g, ' ');
    check('labelled with where it came from, read-only', /From Apple Health \(read-only\)/.test(t));
    check('shows what was read', /6,200 steps/.test(t) && /25 exercise min/.test(t) && /yoga, 25 min \(Watch\)/.test(t));
    check('says it is not in the plan, log or minutes', /not part of your plan, not in your log, and not counted in your minutes/.test(t));
    const week = (await text(page)).replace(/\s+/g, ' ');
    check('the person\'s own week still says nothing was logged', /Nothing logged yet this week/.test(week));
    check('and the log has nothing', (await entriesOf(page)).length === 0);
  }, page);
  await ctx.close();
}

// ───────────── F ─────────────
for (const size of WIDTHS.filter((s) => s.w <= 430 || s.w === 768)) {
  const { ctx, page } = await mk(size);
  await onboard(page, ['Meals', 'Movement', 'Learning']);
  await stub(page, (req) => ({ json: { ok: true, proposal: { feature: req.feature, note: '', items: [] } } }));
  await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('cleanflow:v1'));
    d.appearance = { ...d.appearance, fontSize: 'xlarge', font: 'clear' };
    d.reminders.prefs.enabled = true;
    d._rev += 3; localStorage.setItem('cleanflow:v1', JSON.stringify(d));
  });
  await page.reload(); await page.waitForSelector('main h1');
  await step(`F the assistant sheets and the new settings fit at ${size.w}px with the largest text`, async () => {
    for (const [route, button] of [['meals?tab=plan', 'Suggest meals'], ['movement?tab=plan', 'Plan my movement'], ['learning?tab=discover', 'Ideas to try']]) {
      await go(page, route);
      await click(page, button); await sheet(page);
      const box = await dlg(page).boundingBox();
      check(`${button}: inside the viewport`, box.x >= -1 && box.x + box.width <= size.w + 1 && box.y >= -1, JSON.stringify(box));
      check(`${button}: no overflow inside`, (await page.evaluate(auditPage)).docOverflow <= 0);
      await dlg(page).getByRole('button', { name: 'Suggest with the app' }).click();
      await page.waitForSelector('[data-testid=origin]');
      check(`${button}: the review fits too`, (await page.evaluate(auditPage)).docOverflow <= 0);
      const foot = await dlg(page).locator('.sheet-foot button').first().boundingBox();
      check(`${button}: the buttons are in the footer, in view, without scrolling`, foot.y >= 0 && foot.y + foot.height <= size.h + 1, JSON.stringify(foot));
      await page.keyboard.press('Escape');
      await page.waitForSelector('role=dialog', { state: 'detached' });
    }
    await go(page, 'settings');
    const a = await page.evaluate(auditPage);
    check('settings: no overflow, every control named, valid ARIA', a.docOverflow <= 0 && a.wide.length === 0 && a.unnamed.length === 0 && a.badAria.length === 0, JSON.stringify(a));
  }, page);
  await ctx.close();
}

// ───────────── G ─────────────
{
  const ctx = await newContext(browser, { w: 1024, h: 768, mobile: false });
  const a = await ctx.newPage(); watch(a, errors, 'tab A');
  await onboard(a, ['Wellbeing', 'Water']);
  await go(a, 'wellbeing?tab=water');
  const b = await ctx.newPage(); watch(b, errors, 'tab B');
  await b.goto(BASE + '#/wellbeing?tab=water'); await b.waitForSelector('[aria-label="Quick add water"]'); await b.waitForTimeout(500);
  await step('G two tabs adding to the new sections at once: both tabs\' water survives, each tab shows both, and the setting made in one is in the other', async () => {
    await a.waitForSelector('[aria-label="Quick add water"]');
    await a.getByRole('button', { name: 'Add 250 ml' }).click(); await a.waitForTimeout(900);
    // tab B never reloaded: it has to take A's save as its base and keep its own work on top
    await b.getByRole('button', { name: 'Add 500 ml' }).click(); await b.waitForTimeout(1200);
    await go(b, 'settings'); await b.waitForSelector('[data-testid=reminders]');
    await b.getByRole('switch', { name: 'Remind me about things I planned' }).click(); await b.waitForTimeout(1200);
    const d = await stored(a);
    check('both glasses are in the saved data', d.water.entries.map((e) => e.ml).sort((x, y) => x - y).join() === '250,500', JSON.stringify(d.water.entries.map((e) => e.ml)));
    check('and the reminder setting made in tab B', d.reminders.prefs.enabled === true);
    await a.bringToFront(); await a.reload(); await a.waitForSelector('[aria-label="Quick add water"]');
    check('tab A, reloaded, shows 750 ml', /750 ml/.test(await text(a)));
    await b.evaluate(() => (location.hash = '#/wellbeing?tab=water')); await b.waitForTimeout(600);
    check('tab B shows 750 ml too', /750 ml/.test(await text(b)));
    const writes = (await stored(a))._rev;
    await a.waitForTimeout(3000);
    check('then both go quiet: the revision stops moving', (await stored(a))._rev === writes);
  }, a);
  await ctx.close();
}

await browser.close();
done(errors);
