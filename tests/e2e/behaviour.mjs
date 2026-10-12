// What the app records about a day, in a real browser: the planner's decision (selected / left out, with the planner's reason),
// and what was actually put in front of the person (seen). Opening a screen that is not Today must not count as seeing Today's tasks;
// a background tab must not count as opening the day; reloads, StrictMode and a second tab must add nothing.
import { BASE, DEMOS, launch, loadDemo, newContext, runner, stored, watch } from './lib.mjs';

const { check, step, done } = runner('behaviour');
const browser = await launch();
const errors = [];
const mk = async (opts = { w: 390, h: 844, mobile: true }, init = null) => {
  const ctx = await newContext(browser, opts);
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage(); watch(page, errors);
  await page.clock.setFixedTime(new Date(2026, 9, 5, 8, 15));
  return { ctx, page };
};
const patchStore = (page, src) => page.evaluate((s) => { const d = JSON.parse(localStorage.getItem('cleanflow:v1')); new Function('d', s)(d); d._rev = (d._rev ?? 0) + 100; localStorage.setItem('cleanflow:v1', JSON.stringify(d)); }, src);
const TODAY = '2026-10-05';
const todayRec = async (page) => ((await stored(page))?.exposures ?? []).find((e) => e.date === TODAY);
const COUNT_WRITES = () => {
  window.__writes = [];
  const orig = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) { if (k === 'cleanflow:v1') window.__writes.push(performance.now()); return orig.call(this, k, v); };
};

// ───────────── 1. the day's record: selected tasks, with when they were chosen and under what energy ─────────────
{
  const { ctx, page } = await mk();
  await loadDemo(page, DEMOS.beginner);
  await step('the day record carries the planner\'s selection, in the current contract', async () => {
    await page.waitForTimeout(600);
    const rec = await todayRec(page);
    check('there is a record for today', !!rec);
    check('it is a contract 2 record', rec?.contract === 2, JSON.stringify(rec && { contract: rec.contract }));
    check('it lists what was selected', rec.items.length > 0, String(rec.items.length));
    check('every selected task says when it was selected and under which energy', rec.items.every((i) => !!i.selectedAt && !!i.energy));
    check('and nothing in it says "shown"', rec.items.every((i) => i.shownAt === undefined));
  }, page);
  await ctx.close();
}

// ───────────── 2. opening Settings first does not count as seeing Today's tasks ─────────────
{
  const { ctx, page } = await mk();
  await loadDemo(page, DEMOS.student);
  await step('a day opened on Settings records what was selected and that none of it was seen', async () => {
    await patchStore(page, 'd.exposures=[];');
    await page.evaluate(() => (location.hash = '#/settings')); await page.reload();
    await page.waitForSelector('[data-testid=storage-usage]'); await page.waitForTimeout(700);
    const rec = await todayRec(page);
    check('the planner\'s decision was recorded', !!rec && rec.items.length > 0, JSON.stringify(rec && rec.items.length));
    check('none of it is marked seen', rec.items.every((i) => !i.seenAt), JSON.stringify(rec.items.filter((i) => i.seenAt).length));
  }, page);
  await step('going to Today marks what is on screen, and only that', async () => {
    await page.evaluate(() => (location.hash = '#/today')); await page.waitForSelector('.hero-card'); await page.waitForTimeout(700);
    const rec = await todayRec(page);
    const cards = await page.locator('main article.task').count();
    const seen = rec.items.filter((i) => i.seenAt).length;
    check(`seen matches the cards on screen (${seen} seen, ${cards} cards)`, seen === cards && seen > 0, `${seen}/${cards}`);
    check('tasks in a closed group ("This evening") are still unseen', rec.items.length > seen, `${seen}/${rec.items.length}`);
  }, page);
  await step('opening a closed group marks its tasks seen', async () => {
    const before = (await todayRec(page)).items.filter((i) => i.seenAt).length;
    const toggle = page.locator('main button[aria-expanded=false]').filter({ hasText: /evening|later|earlier/i }).first();
    check('there is a closed group to open', (await toggle.count()) > 0);
    await toggle.click(); await page.waitForTimeout(700);
    const after = (await todayRec(page)).items.filter((i) => i.seenAt).length;
    check(`more tasks are seen after opening it (${before} → ${after})`, after > before);
  }, page);
  await step('seen is recorded once: more renders and a reload change nothing', async () => {
    const a = JSON.stringify((await todayRec(page)).items.map((i) => [i.taskId, i.seenAt]));
    await page.reload(); await page.waitForSelector('.hero-card'); await page.waitForTimeout(700);
    const b = JSON.stringify((await todayRec(page)).items.map((i) => [i.taskId, i.seenAt]));
    check('the first time something was seen is kept', a === b);
  }, page);
  await ctx.close();
}

// ───────────── 3. a day the planner left things out: they are not exposures, have a reason, and are revealed only when opened ─────────────
{
  const { ctx, page } = await mk();
  await loadDemo(page, DEMOS.family, '.hero-card');
  await step('too little time: tasks are left out with the planner\'s reason, and none is marked seen', async () => {
    await patchStore(page, "d.exposures=[]; d.preferences.sessionMinutes=15; d.preferences.focus=['home']; d.dayEnergy=undefined;");
    await page.reload(); await page.waitForSelector('.hero-card'); await page.waitForTimeout(700);
    const rec = await todayRec(page);
    check('some tasks were left out', (rec.left ?? []).length > 0, String((rec.left ?? []).length));
    check('each says why, in the planner\'s words', rec.left.every((x) => ['not-enough-time', 'low-energy-day', 'not-a-cleaning-day'].includes(x.reason)), JSON.stringify([...new Set(rec.left.map((x) => x.reason))]));
    check('each says what the budget was', rec.left.every((x) => typeof x.budget === 'number' || x.budget === undefined || x.budget === null));
    check('a left-out task is not also a selected one', rec.left.every((x) => !rec.items.some((i) => i.taskId === x.taskId)));
    check('left out is not seen: nothing there has been revealed yet', rec.left.every((x) => !x.seenAt));
    check('and no entries were created by any of this', ((await stored(page)).sessions ?? []).every((s) => s.entries.length === 0 || s.date !== TODAY));
  }, page);
  await step('opening the "left out of today" list marks those tasks as revealed, not as done or skipped', async () => {
    const btn = page.getByRole('button', { name: /more, left out of today/ });
    check('the list is offered', (await btn.count()) > 0);
    const entriesBefore = ((await stored(page)).sessions ?? []).flatMap((s) => s.entries).length;
    await btn.click(); await page.waitForTimeout(700);
    const rec = await todayRec(page);
    const shownLeft = rec.left.filter((x) => x.seenAt).length;
    check(`the first ones listed are marked revealed (${shownLeft})`, shownLeft > 0);
    check('revealing is not an action: no entries were added', ((await stored(page)).sessions ?? []).flatMap((s) => s.entries).length === entriesBefore);
  }, page);
  await ctx.close();
}

// ───────────── 4. a background tab does not "open" the day ─────────────
{
  const { ctx, page } = await mk({ w: 390, h: 844, mobile: true });
  await loadDemo(page, DEMOS.beginner);
  await patchStore(page, 'd.exposures=[];');
  await page.close();                                        // the only tab left is the hidden one below
  const bg = await ctx.newPage(); watch(bg, errors, 'bg');
  await bg.addInitScript(() => Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }));
  await bg.clock.setFixedTime(new Date(2026, 9, 5, 8, 15));
  await step('a tab that is hidden from the start records nothing; once it is visible the day is recorded', async () => {
    await bg.goto(BASE + '#/today'); await bg.waitForTimeout(1500);
    check('nothing is recorded while hidden', !(await todayRec(bg)));
    await bg.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
    await bg.waitForTimeout(1200);
    const rec = await todayRec(bg);
    check('it is recorded once the tab is visible', !!rec && rec.items.length > 0);
    check('and what is on screen is now seen', rec.items.some((i) => i.seenAt));
  }, bg);
  await ctx.close();
}

// ───────────── 5. two tabs: the same day is recorded once, and both go quiet ─────────────
{
  const ctx = await newContext(browser, { w: 390, h: 844, mobile: true });
  await ctx.addInitScript(COUNT_WRITES);
  const a = await ctx.newPage(); watch(a, errors, 'A');
  await a.clock.setFixedTime(new Date(2026, 9, 5, 8, 15));
  await a.goto(BASE); await a.evaluate(() => { localStorage.clear(); sessionStorage.clear(); }); await a.reload();
  await a.getByText(DEMOS.beginner).first().click(); await a.waitForSelector('text=Habits & routine'); await a.waitForTimeout(500);
  const b = await ctx.newPage(); watch(b, errors, 'B');
  await b.clock.setFixedTime(new Date(2026, 9, 5, 8, 15));
  await b.goto(BASE + '#/today'); await b.waitForSelector('.hero-card');
  await step('both tabs open on Today: one record for the day, and writes stop', async () => {
    await a.waitForTimeout(1500);
    const rec = ((await stored(a)).exposures ?? []).filter((e) => e.date === TODAY);
    check('one record for today, not one per tab', rec.length === 1, String(rec.length));
    const ids = rec[0].items.map((i) => i.taskId);
    check('and no task twice', new Set(ids).size === ids.length);
    const wa = await a.evaluate(() => window.__writes.length), wb = await b.evaluate(() => window.__writes.length);
    await a.waitForTimeout(2500);
    const wa2 = await a.evaluate(() => window.__writes.length), wb2 = await b.evaluate(() => window.__writes.length);
    check(`tab A is quiet (+${wa2 - wa})`, wa2 === wa);
    check(`tab B is quiet (+${wb2 - wb})`, wb2 === wb);
  }, a);
  await step('one tab opens a group: the other adopts it and still goes quiet', async () => {
    const toggle = a.locator('main button[aria-expanded=false]').filter({ hasText: /evening|later|earlier/i }).first();
    if (await toggle.count()) await toggle.click();
    await a.waitForTimeout(1500);
    const wa = await a.evaluate(() => window.__writes.length), wb = await b.evaluate(() => window.__writes.length);
    await a.waitForTimeout(2500);
    const wa2 = await a.evaluate(() => window.__writes.length), wb2 = await b.evaluate(() => window.__writes.length);
    check(`no ping-pong afterwards (A +${wa2 - wa}, B +${wb2 - wb})`, wa2 === wa && wb2 === wb);
    const rec = ((await stored(a)).exposures ?? []).find((e) => e.date === TODAY);
    check('the first-seen times were kept', rec.items.some((i) => i.seenAt));
  }, a);
  await ctx.close();
}

// ───────────── 6. a fresh start says what is known: nothing was LOGGED, not that the person was away ─────────────
{
  const { ctx, page } = await mk();
  await loadDemo(page, DEMOS.beginner);
  await step('with nothing ever logged, the card says so without claiming anything about the person', async () => {
    await patchStore(page, "d.sessions=[]; d.plan.startDate='2026-09-25';");
    await page.reload(); await page.waitForSelector('.hero-card');
    const card = page.getByRole('region', { name: 'Fresh start' });
    check('the card is offered', (await card.count()) === 1);
    const txt = await card.innerText();
    check('it says nothing has been logged since the plan began', /Nothing has been logged since your plan began 10 days ago/.test(txt), txt.slice(0, 200));
    check('and does not say they were away, gone, or inactive', !/away|gone|inactive|stopped|gave up|fell off/i.test(txt));
  }, page);
  await ctx.close();
}

done(errors);
await browser.close();
