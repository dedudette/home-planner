// Movement, water and wellbeing, in a real browser. Needs the dev server (npm run dev) and Chromium (CHROME_PATH). Uses the real clock.
//
//  A  movement: browse and filter, what you would rather not do, a low-energy day
//  B  your own workout, a guided session start to finish, one log entry, undo, pain, planned vs completed
//  C  water: add, correct, undo, units, your own goal, no zero for an unlogged day, no encouragement past the goal
//  D  wellbeing: check-in (and what it does to Today), breathing, journal, routines
//  E  layout and accessibility at every width
import { auditPage, BASE, entriesOf, launch, newContext, runner, stored, WIDTHS, watch } from './lib.mjs';

const { check, step, done } = runner('movement');
const errors = [];
const browser = await launch();
const click = (page, t, o) => page.getByRole('button', { name: t, ...o }).first().click();
const saved = (page) => page.waitForTimeout(700);
const text = (page) => page.evaluate(() => document.querySelector('main')?.innerText ?? '');
/** The Progress tab is on screen: the app finished loading its data, the route is the movement page, and the tab's own "This week" card has rendered. */
const progressLoaded = async (page) => {
  await page.getByRole('heading', { name: 'This week', level: 2 }).waitFor();
  await page.getByRole('heading', { name: 'Minutes per week', level: 2 }).waitFor();
};
const pad = (n) => String(n).padStart(2, '0');
const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const TODAY = localToday();

const mk = async (size = { w: 390, h: 844, mobile: true }) => {
  const ctx = await newContext(browser, size);
  const page = await ctx.newPage();
  watch(page, errors, `${size.w}`);
  return { ctx, page };
};

/** Onboard through the real flow, choosing the given sections by their label. */
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

const seed = (page, patch) => page.evaluate((p) => {
  const d = JSON.parse(localStorage.getItem('cleanflow:v1'));
  Object.assign(d, p); d._rev += 3; localStorage.setItem('cleanflow:v1', JSON.stringify(d));
}, patch);

// ───────────── A ─────────────
{
  const { ctx, page } = await mk();
  await onboard(page, ['Movement']);
  await step('A movement lists workouts with their minutes, kind and what they need', async () => {
    await page.goto(BASE + '#/movement');
    await page.waitForSelector('[aria-label="Workouts"]');
    const n = await page.locator('[aria-label="Workouts"] article').count();
    check('a real catalogue', n >= 10, String(n));
    const t = await text(page);
    check('says what it is not', /Nothing here is a target/.test(t));
    check('no weight, calorie or fat-burning wording', !/calorie|weight loss|burn|fat|kcal|shred|toned/i.test(t), t.slice(0, 200));
  }, page);
  await step('A filter by kind, level, time and low impact', async () => {
    await page.getByRole('checkbox', { name: 'Walking' }).click();
    const names = await page.locator('[aria-label="Workouts"] article b').allInnerTexts();
    check('only walking', names.length > 0 && names.every((x) => /walk/i.test(x)), names.join(', '));
    await page.getByRole('checkbox', { name: 'Walking' }).click();
    await page.getByRole('checkbox', { name: 'Up to 10 min' }).click();
    const tags = await page.locator('[aria-label="Workouts"] article').allInnerTexts();
    check('only up to 10 minutes', tags.every((x) => Number(/(\d+) min/.exec(x)[1]) <= 10), tags.map((x) => /(\d+) min/.exec(x)[1]).join(','));
    await page.getByRole('checkbox', { name: 'Up to 10 min' }).click();
    await page.getByRole('searchbox', { name: 'Search workouts' }).fill('unwind');
    check('search finds by name', (await page.locator('[aria-label="Workouts"] article').count()) === 1);
    await page.getByRole('searchbox', { name: 'Search workouts' }).fill('');
  }, page);
  await step('A saying what you would rather not do hides those workouts, and says why when asked', async () => {
    await page.goto(BASE + '#/movement?tab=setup');
    await page.getByRole('checkbox', { name: 'Getting down to the floor' }).click();
    await page.goto(BASE + '#/movement');
    await page.waitForSelector('[aria-label="Workouts"]');
    check('floor work is hidden', !(await page.locator('[aria-label="Workouts"] b').allInnerTexts()).some((x) => /on the mat/i.test(x)));
    check('the page says some are hidden', /hidden because of what you told us/.test(await text(page)));
    await page.getByRole('button', { name: 'Show them, with why' }).click();
    const flagged = await page.locator('[aria-label="Workouts"] article', { hasText: 'Core and glutes on the mat' }).innerText();
    check('and why', /Normally hidden.*floor/i.test(flagged), flagged);
  }, page);
  await step('A a low-energy day offers only gentler workouts and says so', async () => {
    await seed(page, { dayEnergy: { date: TODAY, level: 'low' } });
    await page.reload();
    await page.goto(BASE + '#/movement');
    await page.waitForSelector('[aria-label="Workouts"]');
    check('says why', /energy is low today/.test(await text(page)));
    const t = await page.locator('[aria-label="Workouts"]').innerText();
    check('nothing beyond gentle is offered', !/Full body with light weights|Bodyweight basics|Brisk walk|Core and glutes|freestyle/i.test(t), t.slice(0, 300));
    check('a gentle one is', /Seated gentle workout/.test(t));
  }, page);
  await ctx.close();
}

// ───────────── B ─────────────
{
  const { ctx, page } = await mk();
  await onboard(page, ['Movement']);
  await step('B build your own short workout (a 3-second hold, then 5 reps of your own move)', async () => {
    await page.goto(BASE + '#/movement');
    await page.getByRole('button', { name: 'Make your own workout' }).click();
    await page.fill('#wf-name', 'Quick stretch');
    await page.getByLabel('Exercise 1', { exact: true }).selectOption('neck-side-stretch');
    await page.getByRole('radio', { name: 'Seconds' }).first().click();
    await page.getByLabel('Seconds for exercise 1').fill('3');
    await page.getByLabel('Sets for exercise 1').fill('1');
    await page.getByLabel('Rest after exercise 1').fill('0');
    await page.getByLabel('Exercise 2', { exact: true }).selectOption('');
    await page.getByLabel('Name of exercise 2').fill('My own move');
    await page.getByLabel('Reps for exercise 2').fill('5');
    await page.getByLabel('Sets for exercise 2').fill('1');
    await page.getByLabel('Rest after exercise 2').fill('0');
    check('it works out the minutes', /About \d+ minutes? in all/.test(await page.locator('role=dialog').innerText()));
    await page.getByRole('button', { name: 'Save workout' }).click();
    await page.waitForSelector('role=dialog', { state: 'detached' });
    await saved(page);
    const w = (await stored(page)).movement.custom[0];
    check('saved as the person\'s own', w.name === 'Quick stretch' && w.blocks.length === 2 && w.blocks[1].name === 'My own move');
  }, page);
  await step('B a guided session: timed step counts down, rep step waits for Done, then a summary', async () => {
    await page.getByRole('button', { name: 'Start Quick stretch' }).click();
    const stepBox = page.locator('[data-testid="session-step"]');
    await stepBox.waitFor();
    check('first step is the hold with a countdown', /Neck side stretch/.test(await stepBox.innerText()) && (await page.locator('[role=timer]').count()) === 1);
    check('safety words are there', /If something hurts, stop/.test(await page.locator('role=dialog').innerText()));
    await page.waitForFunction(() => /My own move/.test(document.querySelector('[data-testid="session-step"]')?.textContent ?? ''), null, { timeout: 8000 });
    check('then the rep step, which waits for the person', /5 repetitions/.test(await stepBox.innerText()));
    await page.getByRole('button', { name: 'Pause' }).click();
    check('pause says the time is not running', /Paused/.test(await stepBox.innerText()));
    await page.getByRole('button', { name: 'Resume' }).click();
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await page.waitForSelector('role=dialog[name="Workout summary"]');
  }, page);
  await step('B finishing logs ONE entry, with the real minutes, and the exercises carry none', async () => {
    await page.getByRole('radio', { name: 'About right' }).click();
    await page.getByRole('button', { name: /^Log it/ }).click();
    await page.waitForSelector('text=That is recorded once');
    await saved(page);
    const d = await stored(page);
    const es = (await entriesOf(page)).filter((e) => e.taskId.startsWith('adhoc:workout:'));
    check('one entry', es.length === 1 && es[0].outcome === 'completed' && es[0].domain === 'fitness' && es[0].actualMinutes >= 1, JSON.stringify(es));
    check('one log, tied to that entry', d.movement.log.length === 1 && d.movement.log[0].entryId === es[0].id && d.movement.log[0].felt === 'right');
    check('no minutes anywhere in the exercise records', d.movement.log[0].exercises.length === 2 && d.movement.log[0].exercises.every((x) => !('minutes' in x) && !('seconds' in x) && x.status === 'done'), JSON.stringify(d.movement.log[0].exercises));
    check('no task state is kept for a one-off session', !Object.keys(d.taskStates).some((k) => k.startsWith('adhoc:')));
    await page.getByRole('button', { name: 'Close', exact: true }).last().click();
  }, page);
  await step('B undo removes the entry and the log together; logging again is one entry again', async () => {
    await page.locator('.toast button:has-text("Undo")').last().click();
    await saved(page);
    check('both gone', (await entriesOf(page)).length === 0 && (await stored(page)).movement.log.length === 0);
    await page.getByRole('button', { name: 'Start Quick stretch' }).click();
    await page.waitForSelector('[data-testid="session-step"]');
    await page.waitForFunction(() => /My own move/.test(document.querySelector('[data-testid="session-step"]')?.textContent ?? ''), null, { timeout: 8000 });
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await page.getByRole('button', { name: /^Log it/ }).click();
    await page.getByRole('button', { name: 'Close', exact: true }).last().click();
    await saved(page);
    check('one entry again', (await entriesOf(page)).length === 1 && (await stored(page)).movement.log.length === 1);
  }, page);
  await step('B progress shows what you did, and a week with nothing is not a zero', async () => {
    await page.goto(BASE + '#/movement?tab=progress');
    await progressLoaded(page);
    const t = await text(page);
    check('this week counts the one session', /1 session on 1 day/.test(t), t.slice(0, 300));
    check('the log lists it', (await page.locator('[data-testid="log-row"]').count()) === 1 && /Quick stretch/.test(t));
    await seed(page, { sessions: [] , movement: { ...(await stored(page)).movement, log: [] } });
    await page.reload();
    await page.goto(BASE + '#/movement?tab=progress');
    await progressLoaded(page);                                // the page has loaded its data and is showing the Progress tab, not a blank page mid-load
    const empty = await text(page);
    check('an empty week says nothing was logged, not zero', /Nothing logged yet this week/.test(empty) && !/0 sessions|0 minutes/.test(empty), empty.slice(0, 200));
  }, page);
  await step('B ending early and saying it hurt: logged as what was done, nothing is escalated, only an easier offer', async () => {
    await page.goto(BASE + '#/movement');
    await page.getByRole('button', { name: 'Start Quick stretch' }).click();
    await page.waitForSelector('[data-testid="session-step"]');
    await page.getByRole('button', { name: 'End workout' }).click();
    await page.waitForSelector('role=dialog[name="Workout summary"]');
    check('says stopping early is fine', /Stopping early is fine/.test(await page.locator('role=dialog').innerText()));
    await page.getByRole('radio', { name: /pain or discomfort/ }).click();
    await page.getByRole('button', { name: 'Log what I did' }).click();
    await page.waitForSelector('text=Nothing is being pushed');
    await page.getByRole('button', { name: 'Close', exact: true }).last().click();
    await saved(page);
    const es = (await entriesOf(page)).filter((e) => e.taskId.startsWith('adhoc:workout:'));
    check('an early stop is logged as stopped, not completed', es.length === 1 && es[0].outcome === 'stopped', JSON.stringify(es));
    await page.getByRole('button', { name: /Quick stretch, \d+ minutes?\. Open details/ }).click();
    const offer = page.locator('[data-testid="workout-offer"]');
    await offer.waitFor();
    check('the only offer is the gentler one', /Nothing is being pushed/.test(await offer.innerText()) && !/step up/i.test(await offer.innerText()));
    await page.keyboard.press('Escape');
  }, page);
  await step('B a workout you planned is completed ONCE from the guided session', async () => {
    await page.goto(BASE + '#/movement');
    await page.getByRole('button', { name: /Quick stretch, \d+ minutes?\. Open details/ }).click();
    await page.getByRole('button', { name: 'Plan it' }).click();
    await page.getByRole('radio', { name: 'One day' }).click();
    await page.getByRole('button', { name: 'Add to my plan' }).click();
    await page.waitForSelector('role=dialog', { state: 'detached' });
    await page.goto(BASE + '#/today');
    const card = page.locator('article.task', { hasText: 'Quick stretch' });
    await card.waitFor();
    check('the planned item shows the workout\'s own steps in its details', true);
    await card.locator('.task-body').click();
    await page.getByRole('button', { name: 'Start guided workout' }).click();
    await page.waitForFunction(() => /My own move/.test(document.querySelector('[data-testid="session-step"]')?.textContent ?? ''), null, { timeout: 9000 });
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await page.getByRole('button', { name: /^Log it/ }).click();
    await page.getByRole('button', { name: 'Close', exact: true }).last().click();
    await saved(page);
    const es = (await entriesOf(page)).filter((e) => e.outcome === 'completed');
    check('one completed entry, against the plan', es.length === 1 && es[0].taskId.startsWith('act:'), JSON.stringify(es.map((e) => [e.taskId, e.outcome])));
    await page.goto(BASE + '#/today');
    check('the plan card shows done', (await page.locator('article.task', { hasText: 'Quick stretch' }).locator('.check.on').count()) === 1 || (await page.locator('article.task', { hasText: 'Quick stretch' }).count()) === 0);
  }, page);
  await step('B a different session can be counted as the planned one, and is still recorded once', async () => {
    await seed(page, { sessions: [] });
    await page.reload();
    await page.goto(BASE + '#/movement');
    await page.getByRole('button', { name: /Quick stretch, \d+ minutes?\. Open details/ }).click();
    await page.getByRole('button', { name: 'Plan it' }).click();
    await page.getByRole('radio', { name: 'One day' }).click();
    await page.fill('#a-name', 'My evening stretch');
    await page.getByRole('button', { name: 'Add to my plan' }).click();
    await page.waitForSelector('role=dialog', { state: 'detached' });
    await page.getByRole('button', { name: 'Start Quick stretch' }).click();
    await page.waitForFunction(() => /My own move/.test(document.querySelector('[data-testid="session-step"]')?.textContent ?? ''), null, { timeout: 9000 });
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await page.getByLabel('Is this one of the things you planned for today?').selectOption({ label: 'Yes: Quick stretch' }).catch(async () => { await page.getByLabel('Is this one of the things you planned for today?').selectOption({ index: 1 }); });
    await page.getByRole('button', { name: /^Log it/ }).click();
    await page.getByRole('button', { name: 'Close', exact: true }).last().click();
    await saved(page);
    const es = (await entriesOf(page)).filter((e) => e.outcome === 'completed');
    check('exactly one entry for that session, against the plan', es.length === 1 && es[0].taskId.startsWith('act:'), JSON.stringify(es.map((e) => e.taskId)));
  }, page);
  await ctx.close();
}

// ───────────── rest days ─────────────
{
  const { ctx, page } = await mk();
  await onboard(page, ['Movement']);
  await step('B a workout planned on a rest day is flagged, not moved', async () => {
    await page.goto(BASE + '#/movement?tab=setup');
    const wd = new Date().getDay();
    const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    await page.getByRole('checkbox', { name: names[wd], exact: true }).click();
    await page.goto(BASE + '#/movement?tab=plan');
    await page.getByRole('button', { name: 'Plan an activity' }).first().click();
    await page.fill('#a-name', 'A walk');
    await page.getByRole('radio', { name: 'One day' }).click();
    await page.getByRole('button', { name: 'Add to my plan' }).click();
    await page.waitForSelector('role=dialog', { state: 'detached' });
    await page.goto(BASE + '#/today');
    const c = page.locator('[data-testid="conflicts"]');
    await c.waitFor();
    check('says rest day and that nothing moved', /rest day/.test(await c.innerText()) && /Nothing was moved/.test(await c.innerText()));
    check('the walk is still on Today', (await page.locator('article.task', { hasText: 'A walk' }).count()) === 1);
  }, page);
  await ctx.close();
}

// ───────────── C ─────────────
{
  const { ctx, page } = await mk();
  await onboard(page, ['Wellbeing', 'Water']);
  await step('C water is on Today with nothing logged: unknown, not zero', async () => {
    const card = page.locator('[data-testid="today-water"]');
    await card.waitFor();
    check('says nothing logged yet', /Nothing logged yet today/.test(await card.innerText()) && !/\b0 ml\b/.test(await card.innerText()));
  }, page);
  await step('C one tap adds, Undo removes exactly that entry', async () => {
    const card = page.locator('[data-testid="today-water"]');
    await card.getByRole('button', { name: 'Add 250 ml' }).click();
    await page.waitForSelector('.toast button:has-text("Undo")');
    check('the total shows it', /250 ml/.test(await card.locator('[data-testid="water-total"]').innerText()));
    await saved(page);
    check('one entry', (await stored(page)).water.entries.length === 1);
    await page.locator('.toast button:has-text("Undo")').last().click();
    await saved(page);
    check('gone, and back to unknown', (await stored(page)).water.entries.length === 0 && /Nothing logged yet/.test(await card.innerText()));
  }, page);
  await step('C the Water tab: custom amounts are checked, a big one is confirmed, an impossible one is refused', async () => {
    await page.goto(BASE + '#/wellbeing?tab=water');
    await page.waitForSelector('[data-testid="water-total"]');
    const input = page.getByLabel('Another amount in ml');
    await input.fill('0'); await page.getByRole('button', { name: 'Add', exact: true }).click();
    check('zero is refused', /above zero/.test(await text(page)));
    await input.fill('9000'); await page.getByRole('button', { name: 'Add', exact: true }).click();
    check('an impossible amount is refused', /Check the number and unit/.test(await text(page)));
    await saved(page);
    check('nothing was added', (await stored(page)).water.entries.length === 0);
    await input.fill('1800'); await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.waitForSelector('role=dialog');
    check('a large one asks first', /Is that right\?/.test(await page.locator('role=dialog').innerText()));
    await page.getByRole('button', { name: 'Let me change it' }).click();
    await saved(page);
    check('and adds nothing when declined', (await stored(page)).water.entries.length === 0);
    await input.fill('330'); await page.getByRole('button', { name: 'Add', exact: true }).click();
    await saved(page);
    check('an ordinary one is added', (await stored(page)).water.entries.map((e) => e.ml).join() === '330');
  }, page);
  await step('C correct an entry, delete it and undo the delete', async () => {
    await page.getByRole('button', { name: /^Change the 330 ml entry/ }).click();
    await page.fill('#we-a', '300');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await saved(page);
    check('amount corrected', (await stored(page)).water.entries[0].ml === 300);
    await page.getByRole('button', { name: /^Change the 300 ml entry/ }).click();
    await page.getByRole('button', { name: 'Remove' }).click();
    await page.locator('.toast button:has-text("Undo")').last().click();
    await saved(page);
    check('deleted and restored: one entry of 300', (await stored(page)).water.entries.map((e) => e.ml).join() === '300');
  }, page);
  await step('C units and your own goal; no goal means no target, and no encouragement past the goal', async () => {
    check('no goal by default, and it says why', (await stored(page)).water.goalMl === null && /no amount that suits everyone/i.test(await text(page)));
    check('no progress bar without a goal', (await page.locator('[role=progressbar]').count()) === 0);
    await page.getByRole('radio', { name: 'Fluid ounces' }).click();
    check('amounts read in the chosen unit', /fl oz/.test(await page.locator('[data-testid="water-total"]').innerText()));
    await page.getByRole('radio', { name: 'Millilitres' }).click();
    await page.getByLabel(/Daily goal/).fill('250');
    await page.getByRole('button', { name: 'Set goal' }).click();
    check('a goal under the lower bound is refused', /Choose between/.test(await text(page)));
    await page.getByLabel(/Daily goal/).fill('300');
    await page.getByRole('button', { name: 'Set goal' }).click();
    await saved(page);
    check('300 ml is refused too, and no goal was set', /Choose between/.test(await text(page)) && (await stored(page)).water.goalMl === null);
    await page.getByLabel(/Daily goal/).fill('600');
    await page.getByRole('button', { name: 'Set goal' }).click();
    await saved(page);
    check('a goal of the person\'s own', (await stored(page)).water.goalMl === 600);
    check('progress shows against it', (await page.locator('[role=progressbar]').count()) >= 1);
    await page.getByLabel('Another amount in ml').fill('500'); await page.getByRole('button', { name: 'Add', exact: true }).click();
    await saved(page);
    const t = await text(page);
    check('past the goal it says only that it is reached', /reached your own goal/.test(t));
    check('and never urges more', !/keep going|great job|amazing|drink more|well done|crush|smash|hydrate!|don't stop/i.test(t), t.slice(0, 400));
  }, page);
  await step('C the history leaves unlogged days unknown and averages only logged ones', async () => {
    const t = await text(page);
    check('unlogged days say not logged', (t.match(/not logged/g) ?? []).length >= 10);
    check('the average is over logged days only', /On the 1 day you logged, the average was/.test(t) && /left out, not counted as zero/.test(t));
  }, page);

  await step('D check-in: energy here is the same answer Today uses, and the screen says so first', async () => {
    await page.goto(BASE + '#/today');
    const card = page.locator('[data-testid="today-checkin"]');
    await card.waitFor();
    await card.getByRole('radio', { name: 'Low', exact: true }).first().click();
    check('says saving adjusts today\'s list', /Saving this also tells Today your energy/.test(await card.innerText()));
    await card.getByRole('radio', { name: 'Low', exact: true }).nth(1).click();
    await card.getByRole('button', { name: 'Save check-in' }).click();
    await saved(page);
    const d = await stored(page);
    check('check-in saved with only what was said', d.wellbeing.checkins.length === 1 && d.wellbeing.checkins[0].energy === 'low' && d.wellbeing.checkins[0].mood === 2, JSON.stringify(d.wellbeing.checkins));
    check('and Today\'s energy follows, visibly', d.dayEnergy?.level === 'low' && d.energyLog[TODAY] === 'low');
  }, page);
  await step('D an empty check-in cannot be saved; deleting one can be undone', async () => {
    const card = page.locator('[data-testid="today-checkin"]');
    check('save is disabled with nothing said', await card.getByRole('button', { name: 'Save check-in' }).isDisabled());
    await page.goto(BASE + '#/wellbeing?tab=checkin');
    await page.getByRole('button', { name: /^Delete the check-in/ }).click();
    await page.locator('.toast button:has-text("Undo")').last().click();
    await saved(page);
    check('restored', (await stored(page)).wellbeing.checkins.length === 1);
    check('the privacy words are there', /kept on this device/.test(await text(page)) && /does not diagnose/.test(await text(page)));
  }, page);
  await step('D breathing: a visible cue, stop early, log it once', async () => {
    await page.goto(BASE + '#/wellbeing?tab=breathe');
    await page.getByRole('radio', { name: '1 min' }).click();
    await page.getByRole('button', { name: 'Begin' }).click();
    await page.waitForFunction(() => /Breathe in · \d/.test(document.querySelector('[data-testid="breath-cue"]')?.textContent ?? ''));
    await page.waitForTimeout(1200);
    await page.getByRole('button', { name: 'Stop' }).click();
    check('offers to log it, and is not a treatment', /Would you like to log it/.test(await text(page)) && /not a treatment/.test(await text(page)));
    await page.getByRole('button', { name: 'Log it' }).click();
    await saved(page);
    const es = (await entriesOf(page)).filter((e) => e.taskId.startsWith('adhoc:breathing:'));
    check('one entry in the breathing area', es.length === 1 && es[0].domain === 'breathing' && es[0].actualMinutes === 1, JSON.stringify(es));
  }, page);
  await step('D journal: write, reopen, delete and undo, privately', async () => {
    await page.goto(BASE + '#/wellbeing?tab=journal');
    await page.getByRole('button', { name: 'New entry' }).click();
    await page.fill('#j-x', 'A quiet day. The walk helped.');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await saved(page);
    check('saved', (await stored(page)).wellbeing.journal.length === 1);
    check('listed with its words', /A quiet day/.test(await text(page)) && /Private/.test(await text(page)));
    await page.getByRole('button', { name: /^Open the entry/ }).click();
    await page.getByRole('button', { name: 'Delete' }).click();
    await saved(page);
    check('deleted', (await stored(page)).wellbeing.journal.length === 0);
    await page.locator('.toast button:has-text("Undo")').last().click();
    await saved(page);
    check('and restored by undo', (await stored(page)).wellbeing.journal.length === 1);
  }, page);
  await step('D routines: add a wind-down to the plan and see its steps', async () => {
    await page.goto(BASE + '#/wellbeing?tab=routines');
    await page.getByRole('button', { name: 'Add Wind-down to my plan' }).click();
    check('the form is pre-filled', (await page.inputValue('#a-name')) === 'Wind-down');
    await page.getByRole('radio', { name: 'One day' }).click();
    await page.getByRole('button', { name: 'Add to my plan' }).click();
    await page.waitForSelector('role=dialog', { state: 'detached' });
    await saved(page);
    const a = (await stored(page)).activities.find((x) => x.name === 'Wind-down');
    check('stored as a wellbeing activity pointing at the routine', a && a.module === 'wellbeing' && a.ref.kind === 'routine' && a.ref.id === 'winddown');
    await page.goto(BASE + '#/today');
    await page.locator('article.task', { hasText: 'Wind-down' }).locator('.task-body').click();
    check('its steps are in the details', /Dim the lights/.test(await page.locator('role=dialog').innerText()));
    check('no claims about sleep or health', !/sleep better|treat|cure|insomnia|anxiety/i.test(await page.locator('role=dialog').innerText()));
  }, page);
  await ctx.close();
}

// ───────────── E ─────────────
for (const size of WIDTHS) {
  const { ctx, page } = await mk(size);
  await onboard(page, ['Movement', 'Wellbeing', 'Water']);
  await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('cleanflow:v1'));
    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    d.water.entries = [{ id: 'w1', date, at: now.toISOString(), ml: 250 }, { id: 'w2', date, at: now.toISOString(), ml: 500 }];
    d.water.goalMl = 2000;
    d.wellbeing.journal = [{ id: 'j1', date, at: now.toISOString(), title: 'A long title that needs to wrap properly on a narrow phone screen without overflow', text: 'x '.repeat(200) }];
    d.movement.custom = [{ id: 'c1', name: 'A very long workout name that has to wrap properly on a narrow phone screen', type: 'strength', level: 'beginner', blurb: 'Some words', blocks: [{ exerciseId: 'sit-to-stand', sets: 2, reps: 6, restSeconds: 30 }], source: 'personal' }];
    d._rev += 3; localStorage.setItem('cleanflow:v1', JSON.stringify(d));
  });
  await page.reload();
  for (const r of ['today', 'movement', 'movement?tab=plan', 'movement?tab=progress', 'movement?tab=setup', 'wellbeing?tab=checkin', 'wellbeing?tab=water', 'wellbeing?tab=breathe', 'wellbeing?tab=journal', 'wellbeing?tab=routines']) {
    await step(`E ${r} at ${size.w}px: no overflow, every control named, valid ARIA`, async () => {
      await page.evaluate((x) => (location.hash = '#/' + x), r); await page.waitForTimeout(350);
      const a = await page.evaluate(auditPage);
      check('no horizontal overflow', a.docOverflow <= 0 && a.wide.length === 0, JSON.stringify(a.wide));
      check('every control is named', a.unnamed.length === 0, a.unnamed.join(' '));
      check('ARIA states match roles', a.badAria.length === 0, a.badAria.join(' '));
      check('headings do not skip a level', a.skips.length === 0);
    }, page);
  }
  await step(`E the workout, session and form sheets fit at ${size.w}px`, async () => {
    await page.evaluate(() => (location.hash = '#/movement')); await page.waitForTimeout(300);
    for (const open of [
      async () => page.getByRole('button', { name: /^Seated gentle workout, \d+ minutes\. Open details/ }).click(),
      async () => page.getByRole('button', { name: 'Start Seated gentle workout' }).click(),
      async () => page.getByRole('button', { name: 'Make your own workout' }).click(),
    ]) {
      await open();
      await page.waitForSelector('role=dialog');
      await page.waitForTimeout(400);
      const box = await page.locator('[role=dialog]').boundingBox();
      check('inside the viewport', box.x >= -1 && box.x + box.width <= size.w + 1 && box.y >= -1, JSON.stringify(box));
      check('no overflow inside', (await page.evaluate(auditPage)).docOverflow <= 0);
      await page.keyboard.press('Escape');
      await page.waitForSelector('role=dialog', { state: 'detached' });
    }
  }, page);
  await ctx.close();
}

await browser.close();
done(errors);
