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
    check(`group says Now · ${expectNow}`, new RegExp(`Now · ${expectNow}`).test(await page.locator('[data-scope="life"][data-bucket="now"] .group-title').innerText()));
    const nowText = (await page.locator('[data-bucket="now"] .task').allTextContents()).join('|');
    if (expectCollapsed) {
      check('evening routines are not shown as current tasks', !/Evening/.test(nowText), nowText.slice(0, 160));
      check('they wait under "This evening"', (await page.locator('[data-scope="life"][data-bucket="evening"]').count()) === 1);
    } else {
      check('evening routines are current in the evening', /Evening/.test(nowText));
      check('nothing is waiting for "this evening"', (await page.locator('[data-scope="life"][data-bucket="evening"]').count()) === 0);
      check('morning habits are quietly "earlier today"', (await page.locator('[data-scope="life"][data-bucket="earlier"]').count()) === 1);
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

// ───────────── 9. the goal card names the task, why it counts, and for how long ─────────────
{
  const { ctx, page } = await mk();
  await loadDemo(page, DEMOS.student);
  await step('Plan: each covered goal shows its task, minutes, primary/supporting, and why it counts', async () => {
    await patchStore(page, "d.preferences.focus=['home','study','phone','evening','active']; d.preferences.sessionMinutes=60;");
    await page.evaluate(() => (location.hash = '#/plan')); await page.reload(); await page.waitForSelector('[data-testid=goal-coverage]');
    const card = page.getByTestId('goal-coverage');
    const text = await card.innerText();
    check('every goal lists at least one task', (await card.locator('ul.gc-tasks').count()) >= 4, text.slice(0, 200));
    check('shows minutes for tasks', /\d+ min/.test(text));
    check('marks tasks as primary', /Primary/.test(text));
    check('says why a task counts, in the goal\'s own words', /Studies or practises a skill for 5 minutes or more/.test(text), text.slice(0, 400));
    check('shows related-but-not-enough tasks as supporting, with the reason', !/Supporting/.test(text) || /Related to this goal, but not directly about it|Too short to count|Longer than a tiny habit/.test(text));
    await page.screenshot({ path: `${OUT}/int-goals-detail.png`, fullPage: true });
  }, page);
  await step('a deferred goal gives the real reason, in words', async () => {
    await patchStore(page, "d.preferences.focus=['home','study','active','discipline','phone']; d.preferences.sessionMinutes=5;");
    await page.reload(); await page.waitForSelector('[data-testid=goal-coverage]');
    const text = await page.getByTestId('goal-coverage').innerText();
    check('says it needs a stated number of minutes', /needs (only )?\d+ min|at least \d+ min/.test(text), text.slice(0, 300));
  }, page);
  await ctx.close();
}

// ───────────── 10. one budget: Today, Tomorrow and the week all stay inside it ─────────────
const parseMin = (s) => { const m = s.match(/(?:(\d+) h )?(\d+) min/); return m ? Number(m[1] ?? 0) * 60 + Number(m[2]) : NaN; };
for (const [label, focus, mins] of [['home + habits, 10 min', "['home','discipline','morning','evening']", 10], ['home only, 5 min', "['home']", 5], ['habits only, 15 min', "['discipline','study','evening']", 15], ['home + habits, 90 min', "['home','active','study','phone']", 90]]) {
  const { ctx, page } = await mk();
  await loadDemo(page, DEMOS.student);
  await step(`${label}: Today, Tomorrow and the week never plan more than the promise`, async () => {
    await patchStore(page, `d.preferences.focus=${focus}; d.preferences.sessionMinutes=${mins}; d.preferences.daysPerWeek=7;`);
    await page.reload(); await page.waitForSelector('.hero-card');
    const hero = await page.locator('.hero-card').innerText();
    const goal = Number((hero.match(/(?:daily|session) goal (\d+) min/) ?? [])[1] ?? mins);
    const planned = parseMin(hero.match(/about [^\n]*/)?.[0] ?? '');
    if (!Number.isNaN(planned)) check(`Today: planned ${planned} <= goal ${goal}`, planned <= goal, hero.slice(0, 160));
    await page.evaluate(() => (location.hash = '#/schedule')); await page.waitForSelector('[role=tablist]');
    await page.getByRole('tab', { name: 'Tomorrow' }).click();
    const tomorrow = await page.getByTestId('day-total').innerText().catch(() => '');
    if (tomorrow) { const [, p, b] = tomorrow.match(/(.+?) planned, out of your (\d+) min/) ?? []; check(`Tomorrow: ${p} within ${b}`, parseMin(p) <= Number(b), tomorrow); }
    await page.getByRole('tab', { name: 'This week' }).click();
    const heads = await page.locator('.daycard .row.between .small').allInnerTexts();
    let seen = 0;
    for (const h of heads) { const m = h.match(/^\d+ · (.+?) of (\d+) min$/); if (m) { seen++; check(`week day "${h}" within its promise`, parseMin(m[1]) <= Number(m[2]), h); } }
    check('the week shows its promise for each planned day', seen >= 3, heads.join(' | '));
  }, page);
  await ctx.close();
}
{
  const { ctx, page } = await mk();
  await loadDemo(page, DEMOS.student);
  await step('tasks that do not fit are said to be left out, not silently dropped (Today and Tomorrow)', async () => {
    await patchStore(page, "d.preferences.focus=['home','discipline','morning','evening']; d.preferences.sessionMinutes=10; d.preferences.daysPerWeek=7;");
    await page.reload(); await page.waitForSelector('.hero-card');
    await page.getByRole('button', { name: /more, left out of today/ }).first().click();
    const note = await page.locator('.tasklist .small.muted').filter({ hasText: /Left out so today stays within your 10 minutes/ }).first().innerText().catch(() => '');
    check('each left-out task states why', /Left out so today stays within your 10 minutes/.test(note), note);
  }, page);
  await ctx.close();
}

// ───────────── 11. home routines follow the time of day too ─────────────
for (const h of [0, 6, 8, 12, 15, 18, 21, 23]) {
  const { ctx, page } = await mk();
  await page.clock.setFixedTime(new Date(2026, 9, 5, h, 0));
  await loadDemo(page, DEMOS.student);
  await step(`${String(h).padStart(2, '0')}:00 home routines: evening ones and morning ones are in the right place`, async () => {
    await patchStore(page, "d.preferences.focus=['home','morning','evening','discipline']; d.preferences.sessionMinutes=60; d.preferences.daysPerWeek=7;");
    await page.reload(); await page.waitForSelector('.hero-card');
    const eveningPhase = h >= 17 || h < 5;
    const now = await page.locator('[data-scope="home"][data-bucket="now"]').innerText().catch(() => '');
    const eveningHome = /Quick tidy|Evening reset|cups and dishes|Do the dishes|Wash your cups/;
    // dishes at night are "this evening" work; none of it is a morning task
    check(`${h}:00: "Make the bed" ${h >= 5 && h < 12 ? 'is' : 'is not'} a current action`, /Make the bed/.test(now) === (h >= 5 && h < 12), now.slice(0, 160));
    const eveningBucketShown = (await page.locator('[data-scope="home"][data-bucket="evening"]').count()) > 0;
    if (!eveningPhase) check(`${h}:00: evening home routines wait under "This evening"`, eveningBucketShown || !eveningHome.test(now), now.slice(0, 160));
    else check(`${h}:00: nothing is waiting for "this evening"`, !eveningBucketShown);
    await page.screenshot({ path: `${OUT}/int-home-${h}.png`, fullPage: true });
  }, page);
  await ctx.close();
}

// ───────────── 12. no cleaning vocabulary for people who did not choose cleaning ─────────────
{
  const { ctx, page } = await mk({ w: 390, h: 844, mobile: true });
  await page.clock.setFixedTime(new Date(2026, 9, 5, 8, 15));
  await loadDemo(page, DEMOS.beginner);
  await step('life-only: no screen talks about cleaning, mess, chores or "your home"', async () => {
    const WORDS = /\b(clean(ed|ing|er)?|mess(y)?|chores?|housework|dish(es)?|mop(ping)?|vacuum(ing)?|laundry|your home)\b/i;
    // places that legitimately mention it: the brand name, the demo list in Settings, and the opt-in offer to add a cleaning plan
    const ALLOWED = /CleanFlow|Want a cleaning plan too\?|Add a cleaning plan|No cleaning plan/;
    const bad = [];
    for (const r of ['today', 'plan', 'schedule', 'progress', 'home', 'settings', 'more']) {
      await page.evaluate((x) => (location.hash = '#/' + x), r); await page.waitForTimeout(250);
      let txt = await page.evaluate(() => document.querySelector('main')?.innerText ?? '');
      if (r === 'settings') txt = txt.split('Try a demo')[0] + (txt.split('Your data')[1] ?? '');
      for (const line of txt.split('\n')) if (WORDS.test(line) && !ALLOWED.test(line) && !/^\s*(Studio|Apartment|House|\d+ minutes:)/.test(line)) bad.push(`${r}: ${line.trim().slice(0, 100)}`);
    }
    check('no cleaning words on any life-only screen', bad.length === 0, bad.slice(0, 6).join(' || '));
  }, page);
  await ctx.close();
}

// ───────────── 13. suggestion events record once, in development (StrictMode) too ─────────────
{
  const { ctx, page } = await mk();
  await loadDemo(page, DEMOS.student);
  await step('each suggestion is recorded as "shown" once per day however many times the page renders it', async () => {
    await page.waitForTimeout(800);
    await page.reload(); await page.waitForSelector('text=Habits & routine'); await page.waitForTimeout(800);
    const ev = (await stored(page)).recEvents ?? [];
    const shown = ev.filter((e) => e.kind === 'shown');
    const counts = new Map(); for (const e of shown) counts.set(`${e.recommendationId}|${e.date}`, (counts.get(`${e.recommendationId}|${e.date}`) ?? 0) + 1);
    check(`some suggestion was shown (${shown.length})`, shown.length >= 1);
    check('and none is recorded twice', [...counts.values()].every((n) => n === 1), JSON.stringify([...counts.entries()]));
  }, page);
  await ctx.close();
}

// ───────────── 14. low energy: nothing hard or vigorous is suggested anywhere ─────────────
{
  const { ctx, page } = await mk();
  await loadDemo(page, DEMOS.student);
  await step('on a low-energy day the suggesting screens show no vigorous or hard task', async () => {
    await patchStore(page, `d.preferences.focus=['home','active','discipline','healthy']; d.preferences.fitnessLevel='advanced'; d.preferences.lifeLevel=3; d.preferences.sessionMinutes=60; d.dayEnergy={date:'${todayKey()}',level:'low'};`);
    await page.reload(); await page.waitForSelector('.hero-card');
    const bad = [];
    const scan = async (where) => { const t = await page.locator('main').innerText(); if (/Vigorous|\bHard\b/.test(t)) bad.push(`${where}: ${(t.match(/.{0,40}(Vigorous|\bHard\b).{0,20}/) ?? [''])[0]}`); };
    await scan('today');
    for (const sheet of [/I only have/, /Just 5 minutes/]) {
      await page.evaluate(() => (location.hash = '#/today')); await page.waitForTimeout(200);
      await page.getByRole('button', { name: sheet }).first().click(); await page.waitForTimeout(500);
      if (/I only have/.test(String(sheet))) { await page.locator('.sheet button, [role=dialog] button').filter({ hasText: /^60 min|1 hour/ }).first().click().catch(() => {}); await page.waitForTimeout(300); }
      const t = await page.locator('[role=dialog]').innerText().catch(() => ''); if (/Vigorous|\bHard\b/.test(t)) bad.push(`${sheet}: sheet`);
      await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    }
    for (const tab of ['quick', 'challenge', 'routine']) { await page.evaluate((x) => (location.hash = `#/plan?section=${x}`), tab); await page.waitForTimeout(200); await scan(`plan ${tab}`); }
    check('no vigorous or hard task on a low-energy day', bad.length === 0, bad.join(' | '));
  }, page);
  await ctx.close();
}

// ───────────── 15. small accessibility details: touch size and where focus goes ─────────────
{
  const { ctx, page } = await mk({ w: 360, h: 740, mobile: true });
  await loadDemo(page, DEMOS.student);
  await step('"Start timer" buttons meet the 44px touch size on touch screens', async () => {
    const heights = await page.locator('article.task').getByRole('button', { name: 'Start timer' }).evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
    check(`all ${heights.length} are at least 44px tall`, heights.length > 0 && heights.every((h) => h >= 44), heights.join(','));
    const small = await page.evaluate(() => [...document.querySelectorAll('main button, main a, .bottomnav a, .bottomnav button')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.height < 44 || r.width < 44) && !e.closest('.sr-only') && getComputedStyle(e).position !== 'absolute'; }).map((e) => `${(e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 24)} ${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`));
    check('no other control on Today is smaller than 44px in both directions', small.length === 0, small.slice(0, 6).join(' | '));
  }, page);
  await ctx.close();
}
{
  const { ctx, page } = await mk({ w: 1024, h: 768, mobile: false });
  await loadDemo(page, DEMOS.student);
  await step('closing the task menu or a sheet puts focus back where it came from, not on the page', async () => {
    const more = page.locator('[aria-haspopup=menu]').first();
    const name = await more.getAttribute('aria-label');
    await more.click(); await page.waitForSelector('[role=menu]');
    await page.keyboard.press('Escape'); await page.waitForTimeout(150);
    check('Escape from the menu returns focus to its button', (await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))) === name);
    await more.click(); await page.getByRole('menuitem', { name: /Details/ }).click(); await page.waitForSelector('.sheet-foot');
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    check('closing the sheet opened from the menu returns focus to the menu button', (await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))) === name, String(await page.evaluate(() => document.activeElement?.tagName)));
  }, page);
  await ctx.close();
}

// ───────────── 16. a long history: the app asks, offers a download first, and keeps the newest ─────────────
{
  const { ctx, page } = await mk();
  await loadDemo(page, DEMOS.student);
  await step('three years of history: nothing is removed without asking; "make room" keeps the newest and records it', async () => {
    // inflate the saved history to about three years of entries (realistic entry sizes: copies of real ones with new ids and dates)
    await page.evaluate(() => {
      const d = JSON.parse(localStorage.getItem('cleanflow:v1'));
      const real = d.sessions.flatMap((s) => s.entries);
      const sessions = []; let n = 0;
      for (let day = 0; day < 2900; day++) {
        const dt = new Date(Date.UTC(2019, 0, 1 + day)).toISOString().slice(0, 10);
        const entries = [];
        for (let k = 0; k < 4; k++, n++) { const src = real[n % real.length]; entries.push({ ...src, id: `big${n}`, date: dt, at: `${dt}T0${6 + k}:00:00.000Z` }); }
        sessions.push({ id: `bs${day}`, date: dt, startedAt: entries[0].at, endedAt: entries[3].at, entries });
      }
      d.sessions = sessions; d._rev += 500; localStorage.setItem('cleanflow:v1', JSON.stringify(d));
    });
    const bytesBefore = (await page.evaluate(() => localStorage.getItem('cleanflow:v1').length));
    check(`the history is large enough to matter (${(bytesBefore / 1e6).toFixed(1)} M characters)`, bytesBefore > 3_000_000, String(bytesBefore));
    await page.reload();
    await page.waitForSelector('text=Make room by removing the oldest history?');
    const sheet = await page.locator('[role=dialog]').innerText();
    check('explains the size and what will be removed', /MB/.test(sheet) && /oldest/.test(sheet) && /can't be undone/.test(sheet), sheet.slice(0, 300));
    check('the data has not been touched while the question is open', (await page.evaluate(() => localStorage.getItem('cleanflow:v1').length)) >= bytesBefore - 100);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download everything first' }).click()]);
    const fs = await import('node:fs'); const exported = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
    check('the download holds every entry', exported.data.sessions.reduce((n, s) => n + s.entries.length, 0) === 2900 * 4);
    await page.getByRole('button', { name: 'Not now' }).click();
    await page.waitForTimeout(500);
    check('"Not now" leaves the history exactly as it was', (await entriesOf(page)).length === 2900 * 4);
    await page.evaluate(() => (location.hash = '#/settings')); await page.waitForSelector('[data-testid=storage-usage]');
    check('Settings shows how full storage is', /MB of about 5 MB/.test(await page.getByTestId('storage-usage').innerText()));
    await page.getByRole('button', { name: 'Make room…' }).click();
    await page.getByRole('button', { name: /Remove \d+ oldest entries/ }).click();
    await page.waitForTimeout(800);
    const after = await stored(page);
    const entries = after.sessions.flatMap((s) => s.entries);
    check('the newest entry is still there', entries[entries.length - 1].id === `big${2900 * 4 - 1}`);
    check('the oldest were removed', !entries.some((e) => e.id === 'big0') && entries.length < 2900 * 4);
    check('what is kept is the newest, with no gap', entries.every((e, i) => i === 0 || e.id.localeCompare(entries[i - 1].id, undefined, { numeric: true }) > 0));
    check('a note says what was removed and where the history now starts', after.retention?.length === 1 && after.retention[0].removedEntries === 2900 * 4 - entries.length, JSON.stringify(after.retention));
    const size = await page.evaluate(() => localStorage.getItem('cleanflow:v1').length);
    check(`it now fits with room to spare (${(size / 1e6).toFixed(2)} M characters)`, size <= 1_950_000, String(size));
    check('Settings tells the person, in words', /older entries .* removed to keep saving working/.test(await page.locator('main').innerText()));
    await page.evaluate(() => (location.hash = '#/today')); await page.reload(); await page.waitForSelector('.hero-card'); await page.waitForTimeout(500);
    check('and it does not ask again', (await page.locator('text=Make room by removing the oldest history?').count()) === 0);
  }, page);
  await ctx.close();
}

done(errors);
await browser.close();
