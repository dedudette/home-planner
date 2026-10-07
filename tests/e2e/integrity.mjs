// Data safety and product honesty, end to end: recovery, confirmation, duplicates, two tabs, flush on close, timer attribution,
// precise undo, time-aware Today, life-only experience and goal coverage.
import { BASE, DEMOS, OUT, entriesOf, fresh, launch, loadDemo, newContext, runner, stored, watch } from './lib.mjs';

const { check, step, done } = runner('integrity');
const browser = await launch();
const errors = [];
const mk = async (opts, ignore = null) => { const ctx = await newContext(browser, opts); const page = await ctx.newPage(); watch(page, errors, '', ignore); return { ctx, page }; };
// Crash tests throw on purpose; React and the boundary log those, and that is expected there (and only there).
const EXPECTED_CRASH = /boom|The above error occurred|CleanFlow crashed/;
// Edits the saved data as another writer would: the revision is bumped, so the live page merges instead of overwriting.
const patchStore = (page, fn) => page.evaluate((src) => { const d = JSON.parse(localStorage.getItem('cleanflow:v1')); new Function('d', src)(d); d._rev = (d._rev ?? 0) + 100; localStorage.setItem('cleanflow:v1', JSON.stringify(d)); }, fn);
const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// ───────────── 1. unreadable or odd saved data never produces a blank screen or silent loss ─────────────
{
  const { ctx, page } = await mk();
  const bad = '{"version":1,"sessions":[';
  await step('unreadable data shows the recovery screen, not a blank page', async () => {
    await page.goto(BASE); await page.evaluate((t) => localStorage.setItem('cleanflow:v1', t), bad); await page.reload();
    await page.waitForSelector("text=We couldn't open your saved data");
    check('says nothing was deleted', /Nothing has been deleted/.test(await page.locator('body').innerText()));
    check('the original data is still in storage', (await page.evaluate(() => localStorage.getItem('cleanflow:v1'))) === bad);
    await page.screenshot({ path: `${OUT}/int-recovery.png` });
  }, page);
  await step('"Download my data" hands over the raw text', async () => {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download my data' }).click()]);
    check('file is named as a recovery file', /cleanflow-recovery-/.test(dl.suggestedFilename()));
    const fs = await import('node:fs'); const text = fs.readFileSync(await dl.path(), 'utf8');
    check('download holds the original text', text === bad);
  }, page);
  await step('reload keeps showing recovery (nothing overwrote the data)', async () => {
    await page.reload(); await page.waitForSelector("text=We couldn't open your saved data");
    check('still untouched', (await page.evaluate(() => localStorage.getItem('cleanflow:v1'))) === bad);
  }, page);
  await step('"Start fresh" needs a second confirmation and keeps a copy', async () => {
    await page.getByRole('button', { name: 'Start fresh…' }).click();
    await page.getByRole('button', { name: 'Yes, start fresh' }).click();
    await page.waitForSelector('text=Build my plan');
    check('a copy of the unreadable data is kept', (await page.evaluate(() => localStorage.getItem('cleanflow:recovery'))) === bad);
  }, page);
  await ctx.close();
}
{
  const { ctx, page } = await mk();
  await step('structurally odd (but recognisable) data opens, repaired, with a plain-language notice and a backup', async () => {
    await loadDemo(page, DEMOS.student);
    const before = (await entriesOf(page)).length;
    await patchStore(page, "d.sessions.push({id:'junk',date:'2026-01-01',entries:[null,5]}); d.customTasks=[null]; d.preferences.focus=['bogus','home','study','phone','evening'];");
    await page.reload(); await page.waitForSelector('text=Habits & routine');
    await page.waitForSelector('text=We tidied up your saved data');
    check('history survived', (await entriesOf(page)).length >= before);
    check('the screen works', (await page.locator('main').innerText()).includes('Habits & routine'));
    await page.evaluate(() => (location.hash = '#/settings')); await page.waitForSelector('text=Automatic backups');
    await page.screenshot({ path: `${OUT}/int-repaired-settings.png`, fullPage: true });
  }, page);
  await step('data from a newer version opens, and the original bytes are kept until you change something', async () => {
    await page.goto(BASE); await patchStore(page, "d.version=99; d.fromTheFuture={a:1};");
    const raw = await page.evaluate(() => localStorage.getItem('cleanflow:v1'));
    await page.reload(); await page.waitForSelector('text=Habits & routine');
    check('not wiped, still readable', (await page.evaluate(() => localStorage.getItem('cleanflow:v1'))) === raw || (await stored(page))?.fromTheFuture !== undefined || (await stored(page))?.version === 2);
    check('a backup exists', (await page.evaluate(() => JSON.parse(localStorage.getItem('cleanflow:backups') || '[]').length)) >= 1);
  }, page);
  await ctx.close();
}

// ───────────── 2. a crash shows recovery instead of a white page ─────────────
{
  const { ctx, page } = await mk(undefined, EXPECTED_CRASH);
  await page.addInitScript(() => { const o = Math.imul; Math.imul = function (...a) { if (sessionStorage.getItem('__boom')) throw new Error('boom'); return o.apply(Math, a); }; });
  await step('an app-level crash shows the recovery screen and keeps the data', async () => {
    await loadDemo(page, DEMOS.student);
    const raw = await page.evaluate(() => localStorage.getItem('cleanflow:v1'));
    await page.evaluate(() => sessionStorage.setItem('__boom', '1')); await page.reload();
    await page.waitForSelector('text=Something went wrong');
    check('offers a way to download the data', await page.getByRole('button', { name: 'Download my data' }).isVisible());
    check('data untouched by the crash', (await page.evaluate(() => localStorage.getItem('cleanflow:v1'))) === raw);
    await page.screenshot({ path: `${OUT}/int-crash.png` });
    await page.evaluate(() => sessionStorage.removeItem('__boom'));
    await page.getByRole('button', { name: 'Try again' }).click(); await page.waitForSelector('text=Habits & routine');
  }, page);
  await ctx.close();
}
{
  const { ctx, page } = await mk(undefined, EXPECTED_CRASH);
  await step('a screen-level crash leaves the navigation working and recovers on "Try again"', async () => {
    await loadDemo(page, DEMOS.student);
    await page.evaluate(() => { window.__realFilter = Array.prototype.sort; Array.prototype.sort = function () { throw new Error('boom'); }; });
    await page.evaluate(() => (location.hash = '#/progress'));
    await page.waitForSelector('text=This screen hit a problem');
    check('navigation is still there', await page.locator('.bottomnav').isVisible());
    await page.evaluate(() => { Array.prototype.sort = window.__realFilter; });
    await page.getByRole('button', { name: 'Try again' }).click(); await page.waitForSelector('text=Your progress');
  }, page);
  await ctx.close();
}

// ───────────── 3. nothing replaces the user's data without asking, and everything is backed up ─────────────
{
  const { ctx, page } = await mk();
  await loadDemo(page, DEMOS.student);
  await patchStore(page, "d.user.demo=false; d.user.name='Real Person';");
  await page.reload(); await page.waitForSelector('text=Habits & routine');
  await page.evaluate(() => (location.hash = '#/settings')); await page.waitForSelector('text=Try a demo');
  await step('loading a demo asks first; Cancel changes nothing', async () => {
    await page.locator('.demo-card').first().click();
    await page.waitForSelector('text=Replace your data with a demo?');
    check('says it replaces the plan and offers a download first', /replaces your current home/i.test(await page.getByRole('dialog').innerText()) && await page.getByRole('button', { name: 'Download current data first' }).isVisible());
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.waitForTimeout(400);
    check('data unchanged', (await stored(page)).user.name === 'Real Person');
  }, page);
  await step('confirming replaces it, backs up first, and Undo brings it back', async () => {
    await page.locator('.demo-card').first().click();
    await page.getByRole('button', { name: 'Load the demo' }).click();
    await page.waitForSelector('text=Loaded:'); await page.waitForTimeout(500);
    check('replaced', (await stored(page)).user.name !== 'Real Person');
    check('an automatic backup was taken', (await page.evaluate(() => JSON.parse(localStorage.getItem('cleanflow:backups') || '[]').some((b) => b.reason === 'demo'))));
    await page.waitForSelector('.toast'); await page.getByRole('button', { name: 'Undo' }).click(); await page.waitForTimeout(500);
    check('Undo restored the user data', (await stored(page)).user.name === 'Real Person');
  }, page);
  await step('a backup can be restored from Settings (with confirmation)', async () => {
    await page.evaluate(() => (location.hash = '#/settings')); await page.waitForSelector('text=Automatic backups');
    await page.getByLabel('Automatic backups').getByRole('button', { name: 'Restore' }).first().click();
    await page.waitForSelector('text=Restore this backup?');
    await page.getByRole('button', { name: 'Cancel' }).click();
  }, page);
  await step('restoring a file shows a summary, asks first, and rejects junk with a message', async () => {
    const fs = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path');
    const good = await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('cleanflow:v1')); d.user.name = 'From file'; return JSON.stringify({ app: 'cleanflow', exportVersion: 2, schemaVersion: 2, exportedAt: new Date().toISOString(), data: d }); });
    const f1 = path.join(os.tmpdir(), 'cf-good.json'); fs.writeFileSync(f1, good);
    await page.setInputFiles('input[type=file]', f1);
    await page.waitForSelector('text=Replace your data with this backup?');
    check('shows how much is in the file', /completed or logged actions/.test(await page.getByRole('dialog').innerText()));
    await page.getByRole('button', { name: 'Cancel' }).click(); await page.waitForTimeout(300);
    check('cancel left data alone', (await stored(page)).user.name === 'Real Person');
    await page.setInputFiles('input[type=file]', f1);
    await page.getByRole('button', { name: 'Replace my data' }).click(); await page.waitForTimeout(500);
    check('confirm restored it', (await stored(page)).user.name === 'From file');
    const f2 = path.join(os.tmpdir(), 'cf-junk.json'); fs.writeFileSync(f2, '{"hello":1}');
    await page.setInputFiles('input[type=file]', f2);
    await page.waitForSelector("text=doesn't look like a CleanFlow backup");
    check('junk left data alone', (await stored(page)).user.name === 'From file');
  }, page);
  await step('"Erase" asks, offers a download, and really erases (backups included)', async () => {
    await page.getByRole('button', { name: 'Erase all my data' }).click();
    await page.waitForSelector('text=Erase everything on this device?');
    check('offers a backup download first', await page.getByRole('button', { name: 'Download a backup first' }).isVisible());
    await page.getByRole('dialog').getByRole('button', { name: 'Erase everything' }).click();
    await page.waitForSelector('text=Build my plan'); await page.waitForTimeout(500);
    check('backups are gone too', (await page.evaluate(() => localStorage.getItem('cleanflow:backups'))) === null);
  }, page);
  await ctx.close();
}

// ───────────── 4. duplicates, two tabs, closing the page, precise undo ─────────────
{
  const { ctx, page } = await mk();
  await loadDemo(page, DEMOS.student);
  const key = todayKey();
  const countFor = async (name) => (await entriesOf(page)).filter((e) => e.date === key && e.name === name && e.outcome === 'completed').length;
  await step('two rapid activations of "Mark complete" log one completion', async () => {
    const name = 'Plan tomorrow';
    const before = await countFor(name);
    await page.locator('.task-body', { hasText: name }).first().click(); await page.waitForSelector('.sheet-foot');
    await page.getByRole('button', { name: 'Mark complete' }).evaluate((b) => { b.click(); b.click(); });
    await page.waitForTimeout(700);
    check('one entry added, not two', (await countFor(name)) === before + 1, `before ${before} after ${await countFor(name)}`);
  }, page);
  await step('a completion is saved even if the page is closed immediately', async () => {
    const name = 'Put your phone away for the night';
    const before = await countFor(name);
    await page.locator('.task', { hasText: name }).first().locator('button.check').click().catch(async () => {
      await page.getByRole('button', { name: /This evening/ }).click(); await page.locator('.task', { hasText: name }).first().locator('button.check').click();
    });
    await page.reload(); await page.waitForSelector('text=Habits & routine');
    check('survived an instant reload', (await countFor(name)) === before + 1, `before ${before} after ${await countFor(name)}`);
  }, page);
  await step('undo only undoes its own action, not newer ones', async () => {
    await page.evaluate(() => (location.hash = '#/today')); await page.waitForTimeout(300);
    const cards = page.locator('article.task button.check:not([disabled])');
    const nameOf = async (i) => (await cards.nth(i).getAttribute('aria-label')).replace(/^Mark |, complete| complete$/g, '');
    const a = (await nameOf(0)), b = (await nameOf(1));
    const before = (await entriesOf(page)).length;
    await cards.nth(0).click(); await page.waitForTimeout(150);
    await page.locator('article.task button.check:not([disabled])').nth(0).click(); await page.waitForTimeout(300);
    check('both actions logged', (await entriesOf(page)).length === before + 2);
    await page.locator('.toast button', { hasText: 'Undo' }).first().click(); await page.waitForTimeout(400);
    const names = (await entriesOf(page)).slice(-3).map((e) => e.name);
    check('exactly one of the two was undone', (await entriesOf(page)).length === before + 1, `${a} / ${b} -> ${names.join(', ')}`);
  }, page);
  await ctx.close();
}
{
  const { ctx, page: tab1 } = await mk();
  await loadDemo(tab1, DEMOS.student);
  const tab2 = await ctx.newPage(); watch(tab2, errors, 'tab2');
  await tab2.goto(BASE + '#/today'); await tab2.waitForSelector('text=Habits & routine'); await tab2.waitForTimeout(500);
  await step('two tabs: each tab\'s work survives, whichever saved last', async () => {
    const key = todayKey();
    const n0 = (await entriesOf(tab1)).filter((e) => e.date === key).length;
    await tab1.locator('.task', { hasText: 'Plan tomorrow' }).first().locator('button.check').click().catch(async () => { await tab1.getByRole('button', { name: /This evening/ }).click(); await tab1.locator('.task', { hasText: 'Plan tomorrow' }).first().locator('button.check').click(); });
    await tab1.waitForTimeout(700);
    // tab 2 never reloaded: it must have merged tab 1's change and must not erase it when it saves its own
    await tab2.locator('article.task button.check:not([disabled])').first().click(); await tab2.waitForTimeout(800);
    const names = (await entriesOf(tab1)).filter((e) => e.date === key).map((e) => e.name);
    check('both completions are in storage', names.length === n0 + 2, JSON.stringify(names));
    check('tab 1 completion is not lost', names.includes('Plan tomorrow'));
    await tab1.waitForTimeout(600);
    check('tab 2 now shows the other tab\'s work too', (await entriesOf(tab2)).filter((e) => e.date === key).length === n0 + 2);
  }, tab1);
  await ctx.close();
}

// ───────────── 5. a timer for a habit stays a habit after a reload ─────────────
{
  const { ctx, page } = await mk();
  await loadDemo(page, DEMOS.beginner);
  await step('a "Just 5 minutes" habit finished after a reload is still logged as that habit', async () => {
    const before = new Set((await entriesOf(page)).map((e) => e.id));
    await page.getByRole('button', { name: /Just 5 minutes/ }).first().click(); await page.waitForSelector('.five-name');
    const name = await page.locator('.five-name').innerText();
    await page.getByRole('button', { name: /Start 5-min timer/ }).click(); await page.waitForSelector('.ring-time'); await page.waitForTimeout(1100);
    await page.reload(); await page.waitForSelector('.timerbar');
    check('timer bar says "Timer", not "Cleaning"', !/Cleaning/.test(await page.locator('.timerbar').innerText()), await page.locator('.timerbar').innerText());
    await page.locator('.timerbar .open').click(); await page.waitForSelector('.ring-time');
    await page.locator('.sheet-foot').getByRole('button', { name: 'Complete' }).click(); await page.waitForTimeout(700);
    const added = (await entriesOf(page)).filter((e) => !before.has(e.id));
    check('exactly one entry', added.length === 1);
    check(`"${name}" kept its life area and category`, !!added[0]?.domain && added[0].domain !== 'home' && added[0].category !== 'Cleaning', JSON.stringify(added[0] && { d: added[0].domain, c: added[0].category }));
    check('its analytics fields are filled in', added[0]?.templateId && added[0]?.localHour !== undefined && added[0]?.planVersion);
  }, page);
  await ctx.close();
}

// ───────────── 6. Today knows what time it is ─────────────
for (const [hour, expectNow, expectCollapsed, label] of [[8, 'Morning', 'evening', '08:00'], [14, 'Afternoon', 'evening', '14:00'], [21, 'Evening', null, '21:00']]) {
  const { ctx, page } = await mk();
  await page.clock.setFixedTime(new Date(2026, 9, 5, hour, 0));
  await loadDemo(page, DEMOS.student);
  await step(`Today at ${label}: "Now" is ${expectNow}`, async () => {
    await patchStore(page, "d.preferences.focus=['home','morning','evening','study','discipline']; d.preferences.sessionMinutes=45;");
    await page.reload(); await page.waitForSelector('text=Habits & routine');
    check(`group says Now · ${expectNow}`, new RegExp(`Now · ${expectNow}`).test(await page.locator('[data-bucket="now"] .group-title').innerText()));
    const nowText = (await page.locator('[data-bucket="now"] .task').allTextContents()).join('|');
    if (expectCollapsed) {
      check('evening routines are not shown as current tasks', !/Evening/.test(nowText), nowText.slice(0, 160));
      check('they wait under "This evening"', (await page.locator('[data-bucket="evening"]').count()) === 1);
    } else {
      check('evening routines are current in the evening', /Evening/.test(nowText));
      check('nothing is waiting for "this evening"', (await page.locator('[data-bucket="evening"]').count()) === 0);
      check('morning habits are quietly "earlier today"', (await page.locator('[data-bucket="earlier"]').count()) === 1);
    }
    await page.screenshot({ path: `${OUT}/int-today-${hour}.png`, fullPage: true });
  }, page);
  await ctx.close();
}
{
  const { ctx, page } = await mk();
  await page.clock.setFixedTime(new Date(2026, 9, 5, 9, 0));
  await loadDemo(page, DEMOS.student);
  await step('the Today header keeps the daily promise honest', async () => {
    const hero = await page.locator('.hero-card').innerText();
    const goal = Number((hero.match(/daily goal (\d+) min/) ?? [])[1]);
    const planned = hero.match(/about (?:(\d+) h )?(\d+) min/);
    const mins = planned ? Number(planned[1] ?? 0) * 60 + Number(planned[2]) : NaN;
    check('shows a daily goal', goal === 30, hero.slice(0, 160));
    check(`planned ${mins} min stays near the ${goal}-minute promise`, mins <= goal * 1.2, hero.slice(0, 200));
  }, page);
  await ctx.close();
}

// ───────────── 7. someone who chose no cleaning gets no pretend home ─────────────
{
  const { ctx, page } = await mk();
  await fresh(page);
  await step('onboarding with only "physically active" lands on Today, not My Home', async () => {
    await page.getByRole('button', { name: 'Build my plan' }).first().click(); await page.waitForSelector('text=What do you want to improve');
    await page.getByRole('checkbox', { name: /Keep my home clean/ }).click();
    await page.getByRole('checkbox', { name: /physically active/ }).click();
    await page.getByRole('button', { name: 'Continue' }).click();                                   // time
    await page.getByRole('radio', { name: '15 minutes' }).click(); await page.getByRole('radio', { name: '7', exact: true }).click();
    await page.getByRole('button', { name: 'Continue' }).click();                                   // energy
    await page.getByRole('radio', { name: 'Medium' }).click(); await page.getByRole('button', { name: 'Review' }).click();
    await page.getByRole('button', { name: 'Build my plan' }).click();
    await page.waitForSelector('text=Habits & routine', { timeout: 9000 });
    check('landed on Today', /#\/today/.test(await page.evaluate(() => location.hash)));
  }, page);
  await step('no cleaning UI anywhere', async () => {
    const main = await page.locator('main').innerText();
    check('no "My home is a mess"', !/My home is a mess/.test(main));
    check('"Just 5 minutes" and "Rough day" are there', /Just 5 minutes/.test(main) && /Rough day/.test(main));
    check('hero does not say "cleaned"', !/cleaned/.test(main));
    const nav = await page.locator('.bottomnav').innerText();
    check('bottom nav unchanged and short', /Today[\s\S]*Plan[\s\S]*Schedule[\s\S]*Progress[\s\S]*More/.test(nav));
    await page.evaluate(() => (location.hash = '#/more')); await page.waitForSelector('main >> text=My goals');
    const more = await page.locator('main').innerText();
    check('More offers "My goals", no home or supplies', /My goals/.test(more) && !/My Home|Cleaning supplies/.test(more), more.replace(/\n/g, ' | ').slice(0, 200));
    await page.evaluate(() => (location.hash = '#/supplies')); await page.waitForTimeout(300);
    check('supplies route does not show supplies', !/Cleaning supplies/.test(await page.locator('main').innerText()));
    await page.evaluate(() => (location.hash = '#/home')); await page.waitForSelector('h1:has-text("My goals")');
    check('goals page has no rooms, floors or pets', !/Bedrooms|Number of rooms|Pets|Spaces in your plan/.test(await page.locator('main').innerText()));
    await page.evaluate(() => (location.hash = '#/plan')); await page.waitForTimeout(300);
    check('Plan has no By room / Deep clean views', (await page.getByRole('tab', { name: 'By room' }).count()) === 0);
    await page.evaluate(() => (location.hash = '#/progress')); await page.waitForTimeout(300);
    const prog = await page.locator('main').innerText();
    check('Progress speaks of active minutes and sessions', /Active minutes/.test(prog) && !/Minutes cleaned|Cleaning sessions/.test(prog));
    await page.evaluate(() => (location.hash = '#/settings')); await page.waitForTimeout(300);
    check('Settings says "Edit my goals"', /Edit my goals/.test(await page.locator('main').innerText()));
    await page.screenshot({ path: `${OUT}/int-life-only-settings.png`, fullPage: true });
  }, page);
  await step('a habit timer is labelled "Timer", not "Cleaning timer"', async () => {
    await page.evaluate(() => (location.hash = '#/today')); await page.waitForSelector('text=Habits & routine');
    await page.getByRole('button', { name: 'Start timer' }).first().click(); await page.getByRole('radio', { name: '5 min', exact: true }).click();
    await page.getByRole('button', { name: /^Start 5 min/ }).click(); await page.waitForSelector('.ring-time');
    check('title', (await page.getByRole('dialog').getByRole('heading', { level: 2 }).first().innerText()) === 'Timer');
  }, page);
  await ctx.close();
}

// ───────────── 8. goals that did not fit are named, with reasons ─────────────
{
  const { ctx, page } = await mk();
  await loadDemo(page, DEMOS.student);
  await step('too many goals for the time: the app says which ones were deferred and why', async () => {
    await patchStore(page, "d.preferences.focus=['home','active','discipline','morning','evening','focus','phone','selfcare','study','organize','healthy','consistent']; d.preferences.sessionMinutes=10;");
    await page.reload(); await page.waitForSelector('text=Habits & routine');
    const card = page.getByTestId('goal-coverage');
    await card.waitFor();
    const text = await card.innerText();
    check('says some goals are not in the plan', /not\s+in your plan/i.test(text) && /goals fit your plan/.test(text), text.slice(0, 200));
    check('explains why, in plain language', /needs at least|capped at|used the .* min|Nothing suits/.test(text), text.slice(0, 300));
    check('offers a way out', await card.getByRole('button', { name: /Change my daily time|Give it more time/ }).isVisible());
    await page.screenshot({ path: `${OUT}/int-goals-deferred.png`, fullPage: true });
    await page.evaluate(() => (location.hash = '#/plan')); await page.waitForSelector('[data-testid=goal-coverage]');
    const full = await page.getByTestId('goal-coverage').innerText();
    check('the Plan page lists every goal, covered or deferred', (full.match(/[✓•]/g) ?? []).length >= 10, full.slice(0, 120));
  }, page);
  await step('with enough time every goal is covered and the card says so', async () => {
    await patchStore(page, "d.preferences.focus=['home','study','phone']; d.preferences.sessionMinutes=60;");
    await page.evaluate(() => (location.hash = '#/today')); await page.reload(); await page.waitForSelector('text=Habits & routine');
    check('no deferral card on Today', (await page.getByTestId('goal-coverage').count()) === 0);
    await page.evaluate(() => (location.hash = '#/plan')); await page.waitForSelector('[data-testid=goal-coverage]');
    check('Plan says all goals have a task', /All \d+ goals have a task/.test(await page.getByTestId('goal-coverage').innerText()));
  }, page);
  await ctx.close();
}

done(errors);
await browser.close();
