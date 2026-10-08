// Two tabs on the same data: they must converge and then go quiet. This is the regression test for the write ping-pong, where
// adopting another tab's save was itself treated as a change, so each tab's "merge" woke the other tab's merge forever.
//
// Two tabs share localStorage only inside ONE browser context, so each scenario opens two pages in a single context. Writes are
// counted by wrapping Storage.setItem in every page, so "quiet" is measured, not assumed.
import { BASE, DEMOS, launch, newContext, runner, stored as storedOf, watch } from './lib.mjs';

const { check, step, done } = runner('sync');
const errors = [];
const browser = await launch();

const KEY = 'cleanflow:v1';
const COUNT_WRITES = () => {
  window.__writes = [];
  const orig = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) {
    if (k === 'cleanflow:v1') { const m = /"_rev":(\d+)/.exec(v); window.__writes.push({ t: performance.now(), rev: m ? Number(m[1]) : null }); }
    return orig.call(this, k, v);
  };
};
// A tab that never hears about other tabs: what a frozen, bfcached or heavily throttled background tab looks like.
const FROZEN = () => {
  const ow = window.addEventListener.bind(window);
  window.addEventListener = (t, ...r) => (t === 'storage' || t === 'pageshow' ? undefined : ow(t, ...r));
  const od = document.addEventListener.bind(document);
  document.addEventListener = (t, ...r) => (t === 'visibilitychange' ? undefined : od(t, ...r));
};

// A tab whose storage events were lost (it still flushes on hide, and still hears visibility changes).
const DEAF = () => {
  const ow = window.addEventListener.bind(window);
  window.addEventListener = (t, ...r) => (t === 'storage' ? undefined : ow(t, ...r));
};

const stored = (p) => storedOf(p);
const writes = (p) => p.evaluate(() => window.__writes.length);
const labelsOf = (p) => p.locator('article.task button.check:not([disabled])').evaluateAll((els) => els.slice(0, 3).map((e) => e.getAttribute('aria-label')));
const nameOf = (label) => label.replace(/^Mark | complete$/g, '');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const completedToday = async (p, name) => (await stored(p)).sessions.flatMap((s) => s.entries).filter((e) => e.date === today() && e.outcome === 'completed' && e.name === name).length;

const open = async (second = null) => {
  const ctx = await newContext(browser, { w: 1024, h: 768, mobile: false });
  await ctx.addInitScript(COUNT_WRITES);
  const a = await ctx.newPage(); watch(a, errors, 'A');
  await a.goto(BASE); await a.evaluate(() => localStorage.clear()); await a.reload();
  await a.getByText(DEMOS.student).first().click(); await a.waitForSelector('text=Habits & routine'); await a.waitForTimeout(900);
  const b = await ctx.newPage(); watch(b, errors, 'B');
  if (second) await b.addInitScript(second);
  await b.goto(BASE + '#/today'); await b.waitForSelector('text=Habits & routine'); await b.waitForTimeout(900);
  return { ctx, a, b };
};

/** After the last action: wait for the burst to finish, then require total silence on both tabs and a fixed revision. */
const expectQuiet = async (name, a, b, ms = 3500) => {
  await a.waitForTimeout(1500);
  const wa = await writes(a), wb = await writes(b), rev = (await stored(a))._rev;
  await a.waitForTimeout(ms);
  const wa2 = await writes(a), wb2 = await writes(b), rev2 = (await stored(a))._rev;
  check(`${name}: no further writes after convergence (tab A +${wa2 - wa}, tab B +${wb2 - wb})`, wa2 === wa && wb2 === wb);
  check(`${name}: revision is stable (${rev} → ${rev2})`, rev === rev2);
  return { rev: rev2, total: wa2 + wb2 };
};

// 1. idle: just opening a second tab must not start anything
await step('opening a second tab on the same data does not start a write loop', async () => {
  const { ctx, a, b } = await open();
  const q = await expectQuiet('idle', a, b);
  check(`idle: only a handful of writes in total (${q.total})`, q.total <= 12, `${q.total} writes`);
  await ctx.close();
}, null);

// 2. different tasks in each tab
await step('two tabs complete different tasks: both survive, then silence', async () => {
  const { ctx, a, b } = await open();
  const [x, y] = await labelsOf(a);
  const before = (await writes(a)) + (await writes(b));
  await a.locator(`button[aria-label="${x}"]`).first().click();
  await a.waitForTimeout(1200);
  await b.locator(`button[aria-label="${y}"]`).first().click();
  const q = await expectQuiet('different tasks', a, b);
  check('different tasks: tab A\'s completion is in storage', (await completedToday(a, nameOf(x))) === 1);
  check('different tasks: tab B\'s completion is in storage', (await completedToday(a, nameOf(y))) === 1);
  for (const [tab, who] of [[a, 'A'], [b, 'B']]) {
    check(`different tasks: tab ${who} shows both as done`, (await tab.locator(`button[aria-label="${x}"], button[aria-label="${y}"]`).count()) === 0);
  }
  check(`different tasks: the whole exchange cost a handful of writes (${q.total - before})`, q.total - before <= 8, `${q.total - before} writes`);
  await ctx.close();
}, null);

// 3. the same task at the same moment
await step('two tabs complete the same task at once: exactly one completion, then silence', async () => {
  const { ctx, a, b } = await open();
  const [x] = await labelsOf(a);
  await Promise.all([a.locator(`button[aria-label="${x}"]`).first().click(), b.locator(`button[aria-label="${x}"]`).first().click().catch(() => {})]);
  await expectQuiet('same task', a, b);
  check('same task: logged exactly once', (await completedToday(a, nameOf(x))) === 1, `${await completedToday(a, nameOf(x))}`);
  await ctx.close();
}, null);

// 4. a frozen tab that wakes up
await step('a frozen tab that completed a different task reconciles when it wakes', async () => {
  const { ctx, a, b } = await open(FROZEN);
  const [x, y, z] = await labelsOf(a);
  await a.locator(`button[aria-label="${x}"]`).first().click();
  await a.waitForTimeout(900);
  await b.locator(`button[aria-label="${y}"]`).first().click(); // B never heard about x
  await b.waitForTimeout(1500);
  check('frozen: both completions are in storage after B saves over A', (await completedToday(a, nameOf(x))) === 1 && (await completedToday(a, nameOf(y))) === 1);
  // wake B: it must pick up everything, and its next action must not erase A's
  await b.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('pageshow')); });
  await b.waitForTimeout(500);
  await b.locator(`button[aria-label="${z}"]`).first().click();
  await expectQuiet('frozen', a, b);
  const names = [x, y, z].map(nameOf);
  for (const n of names) check(`frozen: "${n.slice(0, 30)}" survived`, (await completedToday(a, n)) === 1);
  await ctx.close();
}, null);

// 5. hiding a tab with unsaved work must save AND bring that tab up to date (the stale-overwrite case)
await step('a tab hidden right after a click saves, merges, and does not overwrite the other tab\'s newer work later', async () => {
  const { ctx, a, b } = await open(DEAF);
  const [x, y, z] = await labelsOf(a);
  await a.locator(`button[aria-label="${x}"]`).first().click();
  await a.waitForTimeout(900);
  await b.locator(`button[aria-label="${y}"]`).first().click();
  await b.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await b.evaluate(() => Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }));
  await b.waitForTimeout(400);
  await b.locator(`button[aria-label="${z}"]`).first().click(); // B's next write must be based on A's work too
  await expectQuiet('flush', a, b);
  for (const n of [x, y, z].map(nameOf)) check(`flush: "${n.slice(0, 30)}" survived`, (await completedToday(a, n)) === 1);
  await ctx.close();
}, null);

// 6. a stale tab replaces everything: the safety copy must hold the OTHER tab's newer work, not what this tab remembers
await step('a stale tab that replaces your data backs up the latest saved state, including the other tab\'s newest work', async () => {
  const { ctx, a, b } = await open();
  await a.evaluate(() => { const d = JSON.parse(localStorage.getItem('cleanflow:v1')); d.user.demo = false; d.user.name = 'MINE'; d._rev += 100; localStorage.setItem('cleanflow:v1', JSON.stringify(d)); });
  await a.reload(); await a.waitForSelector('text=Habits & routine');
  const stale = await ctx.newPage(); watch(stale, errors, 'stale');
  await stale.addInitScript(FROZEN);
  await stale.goto(BASE + '#/settings'); await stale.waitForSelector('text=Try a demo'); await stale.waitForTimeout(500);
  const [x] = await labelsOf(a);
  const before = new Set((await stored(a)).sessions.flatMap((s) => s.entries.map((e) => e.id)));
  await a.locator(`button[aria-label="${x}"]`).first().click();
  await a.waitForTimeout(1200);
  const mine = (await stored(a)).sessions.flatMap((s) => s.entries).filter((e) => !before.has(e.id));
  check('the other tab saved a new completion', mine.length === 1);
  await stale.locator('.demo-card').first().click();
  await stale.getByRole('button', { name: 'Load the demo' }).click();
  await stale.waitForTimeout(1500);
  const backups = await stale.evaluate(() => JSON.parse(localStorage.getItem('cleanflow:backups') || '[]'));
  const demoCopy = backups.find((b) => b.reason === 'demo');
  check('a safety copy was made before replacing', !!demoCopy);
  const ids = demoCopy ? JSON.parse(demoCopy.json).sessions.flatMap((s) => s.entries.map((e) => e.id)) : [];
  check('and it contains the other tab\'s newest completion', ids.includes(mine[0]?.id), `${ids.length} entries in the copy`);
  check('and it is the person\'s own data, not the stale tab\'s memory', demoCopy ? JSON.parse(demoCopy.json).user.name === 'MINE' : false);
  await ctx.close();
}, null);

// 7. no room for the safety copy: nothing is replaced until the person has a copy of their own
await step('with storage too full for a safety copy, replacing is refused until a download has been made', async () => {
  const { ctx, a } = await open();
  await a.evaluate(() => { const d = JSON.parse(localStorage.getItem('cleanflow:v1')); d.user.demo = false; d.user.name = 'MINE'; d._rev += 100; localStorage.setItem('cleanflow:v1', JSON.stringify(d)); });
  await a.reload(); await a.waitForSelector('text=Habits & routine');
  const file = await a.evaluate(() => localStorage.getItem('cleanflow:v1'));
  await a.evaluate(() => { let chunk = 200000, i = 0; while (chunk >= 50) { try { localStorage.setItem('zz_filler' + i++, 'x'.repeat(chunk)); } catch { chunk = Math.floor(chunk / 2); } } });
  await a.evaluate(() => (location.hash = '#/settings')); await a.waitForSelector('text=Your data');
  const pick = () => a.locator('input[type=file]').setInputFiles({ name: 'restore.json', mimeType: 'application/json', buffer: Buffer.from(file) });
  await pick();
  await a.getByRole('button', { name: 'Replace my data' }).click();
  await a.waitForSelector('text=No room for an automatic safety copy');
  const confirmBtn = a.getByRole('button', { name: 'I have my copy: replace my data' });
  check('says nothing has been replaced yet', /nothing has been replaced yet/.test(await a.locator('[role=dialog]').innerText()));
  check('the replace button is disabled', await confirmBtn.isDisabled());
  check('the person\'s data is untouched', (await stored(a)).user.name === 'MINE');
  await a.getByRole('button', { name: 'Keep everything as it is' }).click();
  check('and still untouched after cancelling', (await stored(a)).user.name === 'MINE');
  await pick();
  await a.getByRole('button', { name: 'Replace my data' }).click();
  await a.waitForSelector('text=No room for an automatic safety copy');
  const [dl] = await Promise.all([a.waitForEvent('download'), a.getByRole('button', { name: 'Download my current data' }).click()]);
  check('the download is a real backup file of the current data', /cleanflow-backup-/.test(dl.suggestedFilename()));
  check('after downloading, the replace button is enabled', await confirmBtn.isEnabled());
  await ctx.close();
}, null);

await browser.close();
done(errors);
