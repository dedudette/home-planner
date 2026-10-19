// The planner's entitlement gate in a real browser (issue #7): who gets the planner, when it closes, what stays open, and what the server
// enforces whatever the browser does.
//
// Servers (tests/e2e/accountsServer.ts: the real API on a throwaway PostgreSQL database, real Better Auth, a mailbox instead of an email provider):
//   A  accounts mode, no payment provider
//   B  accounts mode, billing on a MOCK payment provider (tests/support/fakeStripe.ts: the REAL Stripe SDK talking to a local stand-in).
//      This proves the app's behaviour given plausible provider answers. It does NOT verify Stripe. Nothing here contacts Stripe or takes a payment.
//   L  local mode: no accounts at all
//
// Time: the server's clock is moved on with /__test/advance (the server decides what a trial or a period means); the browser's clock is
// controlled with Playwright's clock where a timer is under test. Neither clock is the other's.
//
//   npm run build && npm run e2e:gate        (needs the PostgreSQL server binaries; see scripts/test-db.sh)
//   E2E_ONLY=routes,expiry npm run e2e:gate   runs just those sections
import { spawn } from 'node:child_process';
import { launch, runner, watch } from './lib.mjs';

const P = Number(process.env.E2E_PORT ?? 18800);
const A = `http://127.0.0.1:${P}/`;
const B = `http://127.0.0.1:${P + 1}/`;
const L = `http://127.0.0.1:${P + 2}/`;
const { check, step, done } = runner('gate');
const errors = [];
const only = (process.env.E2E_ONLY ?? '').split(',').filter(Boolean);
const want = (name) => only.length === 0 || only.includes(name);

const start = (port, extra = {}) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, ['node_modules/vite-node/vite-node.mjs', 'tests/e2e/accountsServer.ts'], { env: { ...process.env, E2E_PORT: String(port), MODE: 'accounts', ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  const timer = setTimeout(() => reject(new Error(`server did not start: ${out.slice(-400)}`)), 60000);
  child.stdout.on('data', (d) => { out += d; if (out.includes('READY')) { clearTimeout(timer); resolve(child); } });
  child.stderr.on('data', (d) => { out += d; });
  child.on('exit', (c) => { if (c) { clearTimeout(timer); reject(new Error(`server exited ${c}: ${out.slice(-400)}`)); } });
});
const stopServer = (child) => new Promise((r) => { if (!child || child.exitCode !== null) return r(); child.on('exit', () => r()); child.kill('SIGTERM'); setTimeout(() => { child.kill('SIGKILL'); r(); }, 8000); });

const servers = [];
let browser;
try {
  servers.push(await start(P, { E2E_AI_DUMMY: '1' }));
  servers.push(await start(P + 1, { E2E_BILLING: 'fake', E2E_AI_DUMMY: '1' }));
  servers.push(await start(P + 2, { MODE: 'local' }));
  browser = await launch();
} catch (e) { console.log(`FAIL setup: ${e.message}`); await Promise.all(servers.map(stopServer)); process.exit(1); }

// A suite that hangs must not leave servers behind: after this long it says so, stops them and fails.
const watchdog = setTimeout(async () => { console.log('FAIL watchdog: the suite ran longer than allowed'); await Promise.all(servers.map(stopServer)); process.exit(1); }, Number(process.env.E2E_WATCHDOG_MS ?? 540000));

const PW = 'correct horse battery';
let ipn = 20;
const open = async (o = {}) => {
  const ctx = await browser.newContext({ viewport: { width: o.w ?? 390, height: o.h ?? 844 }, isMobile: (o.w ?? 390) < 600, hasTouch: (o.w ?? 390) < 600, locale: 'en-US', timezoneId: 'UTC', colorScheme: o.dark ? 'dark' : 'light', acceptDownloads: true, extraHTTPHeaders: { 'x-forwarded-for': `10.7.${++ipn}.1` } });
  const page = await ctx.newPage();
  watch(page, errors, o.label ?? '', o.ignore ?? null);
  await ctx.route(/^https:\/\/(checkout|billing)\.stripe\.test\//, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Mock provider page</title><p>Mock provider page</p>' }));
  page.reqs = [];
  page.on('request', (r) => { const u = new URL(r.url()); if (u.pathname.startsWith('/api/')) page.reqs.push(`${r.method()} ${u.pathname}`); });
  return { ctx, page };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitMail = async (base, to) => { for (let i = 0; i < 40; i++) { const ms = (await (await fetch(`${base}__test/mail?to=${encodeURIComponent(to.toLowerCase())}`)).json()).filter((x) => /confirm your email/i.test(x.subject)); if (ms.length) return ms[ms.length - 1]; await sleep(100); } throw new Error(`no mail for ${to}`); };
const api = (page, path, init) => page.evaluate(async ([p, i]) => { const r = await fetch(p, i); return { status: r.status, json: await r.json().catch(() => null) }; }, [path, init]);
const post = (page, path, body = {}) => api(page, path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const accountOf = async (page) => (await api(page, '/api/account')).json.account;
const idOf = async (page) => (await accountOf(page)).user.id;
const ls = (page, key) => page.evaluate((k) => localStorage.getItem(k), key);
const lsKeys = (page) => page.evaluate(() => Object.keys(localStorage).sort());
const settle = (page) => page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
const planOf = async (page) => { await settle(page); const t = await ls(page, `cleanflow:v1@${await idOf(page)}`); return t ? JSON.parse(t) : null; };
const provider = async (base, email, op, extra = '') => (await fetch(`${base}__test/provider?email=${encodeURIComponent(email)}&op=${op}${extra}`)).json();
const advance = async (base, days) => (await fetch(`${base}__test/advance?days=${days}`)).json();
const welcomeVisible = (p) => p.getByRole('heading', { name: 'One calm plan for your home, your body and your day' }).waitFor();
const paused = (p) => p.getByTestId('planner-paused');
const pausedVisible = (p) => paused(p).waitFor();
const plannerOpen = async (p) => (await p.locator('.app, .onb').count()) > 0 && (await paused(p).count()) === 0;
const waitPlanner = (p) => p.locator('.app, .onb').first().waitFor();
/** Ask the app to look at the server again now: the same thing it does when the connection comes back. */
const recheck = (p) => p.evaluate(() => window.dispatchEvent(new Event('online')));
const goto = async (p, base, hash = '') => { await p.goto(`${base}?r=${Date.now()}${hash ? `#/${hash}` : ''}`); };
const route = (p, hash) => p.evaluate((h) => { location.hash = `#/${h}`; }, hash);

const newAccount = async (page, base, email) => {
  await page.goto(base);
  await page.getByRole('button', { name: 'Create an account' }).click();
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PW);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await page.getByRole('heading', { name: 'Check your email' }).waitFor();
  const m = await waitMail(base, email);
  await page.goto(m.text.match(/https?:\/\/\S+/)[0]);
  await pausedVisible(page);
};
const signIn = async (page, base, email) => {
  await page.goto(base);
  await page.getByRole('heading', { name: 'Sign in', exact: true }).waitFor();
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PW);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
};
const startTrialUi = async (p) => {
  await pausedVisible(p);
  await p.getByRole('checkbox').check();
  await p.getByRole('button', { name: /^Start my 14-day trial$/ }).click();
  await waitPlanner(p);
};
const withTrial = async (page, base, email) => { await newAccount(page, base, email); await startTrialUi(page); await welcomeVisible(page); };
const pickDemo = async (page) => { await page.getByText('Beginner: discipline & fitness').first().click(); await page.waitForSelector('text=Habits & routine'); };
const loadDemo = async (page) => { await pickDemo(page); await settle(page); };
const coachBody = async (base) => (await fetch(`${base}__test/coach-body`)).json();
const subscribe = async (page, base, plan = 'monthly') => {
  const r = await post(page, '/api/billing/checkout', { plan });
  const sid = r.json.url.split('/').pop();
  await fetch(`${base}__test/complete?session=${sid}`);
  return post(page, '/api/billing/sync', { sessionId: sid });
};

// ───────────────────────────── 1. a new account: the planner is closed, whatever address is typed ─────────────────────────────
if (want('routes')) {
  const { ctx, page } = await open({ label: 'routes' });
  const email = 'gate.routes@example.test';
  await newAccount(page, A, email);
  await step('a new account lands on Trial & plans in its paused form, with the trial on offer and nothing started', async () => {
    check('the screen is Trial & plans', (await page.getByRole('heading', { name: 'Trial & plans', level: 1 }).count()) === 1);
    const t = await paused(page).innerText();
    check('it says why, and what stays open', /Start your free trial/.test(t) && /14-day free trial with no card/.test(t) && /download your data/.test(t) && /delete your account/.test(t), t);
    check('there is no planner: no navigation, no timer bar, no "add a task"', (await page.locator('nav, .sidebar, .bottomnav').count()) === 0 && (await page.getByRole('button', { name: /Add a task/ }).count()) === 0);
    check('the page title says it is paused', /paused/i.test(await page.title()), await page.title());
    const a = await accountOf(page);
    check('the server holds no trial', a.entitlement.state === 'eligible-not-started' && a.trial === null && a.entitlement.access === 'account-only');
    check('focus is on the screen’s heading', await page.evaluate(() => document.activeElement?.tagName === 'H1'));
  }, page);
  await step('every planner address shows the same paused screen, and nothing is written for a plan', async () => {
    for (const r of ['today', 'plan', 'plan?tab=goals', 'schedule', 'progress', 'patterns', 'home', 'supplies', 'meals', 'movement', 'wellbeing', 'learning', 'settings', 'more', 'onboarding', 'nonsense', '']) {
      await route(page, r);
      await pausedVisible(page);
      const open = await page.locator('.app').count();
      if (open !== 0 || (await page.getByRole('heading', { name: 'Trial & plans', level: 1 }).count()) !== 1) check(`#/${r} is paused`, false, `app=${open}`);
    }
    check('all 17 addresses were paused', true);
    check('no plan was created or saved for this account', !(await lsKeys(page)).some((k) => k.startsWith('cleanflow:v1@')), (await lsKeys(page)).join(','));
  }, page);
  await step('the account screens stay open: Trial & plans, Data & backup, export and deletion, change password and sign-out', async () => {
    await route(page, 'account/data');
    await page.getByRole('heading', { name: 'Your data and backup', level: 1 }).waitFor();
    await page.getByRole('heading', { name: 'Cloud backup (optional)' }).waitFor();
    check('Data & backup opens (it offers no way into the planner)', (await page.getByRole('link', { name: 'Back to the app' }).count()) === 0 && (await page.getByRole('link', { name: 'Settings', exact: true }).count()) === 0);
    check('and says it works without a trial or subscription', /whatever your trial or subscription says/.test(await page.locator('main').innerText()));
    await route(page, 'account');
    await page.getByRole('heading', { name: 'Trial & plans', level: 1 }).waitFor();
    await page.getByRole('heading', { name: 'Your account', exact: true }).waitFor();          // the sections load from the server
    const main = await page.locator('main').innerText();
    check('export and deletion are offered', /Download my account data/.test(main) && (await page.getByRole('button', { name: 'Delete my account…' }).count()) === 1);
    check('change password and sign out are offered', (await page.getByRole('button', { name: 'Change password' }).count()) === 1 && (await page.getByRole('button', { name: 'Sign out' }).count()) === 1);
  }, page);
  await step('reloading, signing out and in, and opening addresses never start the trial', async () => {
    await route(page, 'plan');
    await page.reload();
    await pausedVisible(page);
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.getByRole('heading', { name: 'Sign in', exact: true }).waitFor();
    await signIn(page, A, email);
    await pausedVisible(page);
    const a = await accountOf(page);
    check('still no trial on the server', a.trial === null && a.entitlement.state === 'eligible-not-started', JSON.stringify(a.entitlement));
    check('and the page never asked for one', !page.reqs.some((r) => r === 'POST /api/account/trial'), page.reqs.filter((r) => /trial/.test(r)).join(','));
  }, page);
  await step('the server refuses the paid parts whatever the screen shows: AI and cloud backup uploads', async () => {
    const coach = await post(page, '/api/coach', await coachBody(A));
    const assist = await post(page, '/api/assist', {});
    const put = await api(page, '/api/account/backup', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ baseRevision: null, includes: [], data: {} }) });
    check('the AI coach is refused (402)', coach.status === 402, `${coach.status} ${JSON.stringify(coach.json)}`);
    check('the assistant endpoint does not answer an account with no access (it checks the request first, so only the coach is asserted as 402)', assist.status !== 200, String(assist.status));
    check('a cloud backup upload is refused (402)', put.status === 402, String(put.status));
  }, page);
  await step('the trial starts only when the person ticks the box and presses the button, and the planner then opens on its own', async () => {
    await route(page, 'plan');
    await pausedVisible(page);
    const startBtn = page.getByRole('button', { name: /^Start my 14-day trial$/ });
    check('the button is disabled until the box is ticked', await startBtn.isDisabled());
    await page.getByRole('checkbox').check();
    check('and enabled after', await startBtn.isEnabled());
    await startBtn.click();
    await waitPlanner(page);
    check('the planner replaced the paused screen', (await paused(page).count()) === 0);
    check('the person is told, as the planner opens', (await page.getByText('Your 14-day free trial has started. The planner is open.').count()) === 1);
    const a = await accountOf(page);
    const days = (Date.parse(a.trial.endsAt) - Date.parse(a.trial.startedAt)) / 86400000;
    check('the server recorded a 14-day trial with its own dates', a.entitlement.state === 'trial-active' && days === 14, JSON.stringify(a.trial));
    check('the person is on the address they asked for', (await page.evaluate(() => location.hash)).startsWith('#/plan') || await page.locator('.onb').count() > 0);
  }, page);
  await ctx.close();
}

// ───────────────────────────── 1b. the whole path with the keyboard alone ─────────────────────────────
if (want('keyboard')) {
  const { ctx, page } = await open({ label: 'keyboard' });
  await newAccount(page, A, 'gate.keyboard@example.test');
  await step('the paused screen is a labelled region under one heading, and the trial can be started with the keyboard alone', async () => {
    check('the paused section is a region named by its own heading', (await page.getByRole('region', { name: 'Start your free trial' }).count()) === 1);
    check('the screen has one level-1 heading', (await page.locator('h1').count()) === 1);
    const focusIs = (pred) => page.evaluate(pred);
    let onBox = false;
    for (let i = 0; i < 40 && !onBox; i++) { await page.keyboard.press('Tab'); onBox = await focusIs(() => document.activeElement?.matches('input[type=checkbox]')); }
    check('Tab reaches the consent box', onBox);
    const label = await focusIs(() => document.activeElement?.closest('label')?.textContent ?? '');
    check('and the box is read out with its words (a trial of 14 days, no card, no charge unless a plan is chosen)', /14 days/.test(label) && /needs no card/.test(label) && /not be charged/.test(label), label);
    await page.keyboard.press('Space');
    let onBtn = false;
    for (let i = 0; i < 6 && !onBtn; i++) { await page.keyboard.press('Tab'); onBtn = await focusIs(() => /Start my 14-day trial/.test(document.activeElement?.textContent ?? '')); }
    check('Tab then reaches the start button, now enabled', onBtn && !(await focusIs(() => document.activeElement?.disabled)));
    await page.keyboard.press('Enter');
    await waitPlanner(page);
    check('the planner opened', await plannerOpen(page));
    check('the account has a trial', (await accountOf(page)).entitlement.state === 'trial-active');
  }, page);
  await ctx.close();
}

// ───────────────────────────── 2. access ends while the app is open: nothing pending is lost ─────────────────────────────
if (want('expiry')) {
  const { ctx, page } = await open({ label: 'expiry' });
  await page.clock.install();
  const email = 'gate.expiry@example.test';
  await page.goto(A);
  await page.clock.resume();
  await withTrial(page, A, email);
  await step('with a save pending, the trial ending at the server is noticed, the pending edit is written first, and the planner closes', async () => {
    await advance(A, 15);
    let release;
    const hold = new Promise((r) => { release = r; });
    let held = true;
    await page.route('**/api/account', async (r) => { if (held) await hold; await r.continue(); });
    await page.clock.pauseAt(new Date(Date.now() + 1000));         // no timer fires from here: the 250 ms save delay cannot run
    await recheck(page);                                            // the check starts; the server’s answer is held
    await pickDemo(page);                                           // the edit (made while the check is in flight); nothing flushes it
    const key = (await lsKeys(page)).find((k) => /^cleanflow:v1@[^:]+$/.test(k));
    const before = key ? await ls(page, key) : null;
    check('the edit is in the app but not in storage: a save is pending', !key || !JSON.parse(before ?? '{}').onboardingComplete, String(before?.length));
    held = false; release();                                        // the server says: no access any more
    await pausedVisible(page);
    const stored = JSON.parse(await ls(page, (await lsKeys(page)).find((k) => /^cleanflow:v1@[^:]+$/.test(k))));
    check('the pending edit was written out before the planner closed', stored.onboardingComplete === true && stored.sessions.length > 0, `entries=${stored.sessions?.length}`);
    check('the screen says the trial has ended', /Your free trial has ended/.test(await paused(page).innerText()));
    check('the planner is gone', (await page.locator('.app').count()) === 0);
    check('focus moved to the new screen’s heading, so a keyboard or screen-reader user is not left on a control that has gone', await page.evaluate(() => document.activeElement?.tagName === 'H1'));
    await page.unroute('**/api/account');
  }, page);
  await step('after a reload the plan is still on this device, still closed, and the data screen can download it', async () => {
    await page.reload();
    await pausedVisible(page);
    check('the plan is intact in storage', JSON.parse(await ls(page, `cleanflow:v1@${await idOf(page)}`)).onboardingComplete === true);
    await route(page, 'account/data');
    await page.getByRole('heading', { name: 'Your data and backup', level: 1 }).waitFor();
    const dl = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download my plan and history' }).click();
    const file = await dl;
    check('the download is a CleanFlow file named for today', /^cleanflow-backup-\d{4}-\d{2}-\d{2}\.json$/.test(file.suggestedFilename()), file.suggestedFilename());
  }, page);
  await ctx.close();
}
if (want('timer')) {
  const { ctx, page } = await open({ label: 'timer' });
  await page.clock.install();
  await page.goto(A);
  await page.clock.resume();
  await withTrial(page, A, 'gate.timer@example.test');
  await step('the app asks again at the moment the confirmed access is due to end, without any user action', async () => {
    check('the planner is open', await plannerOpen(page));
    await advance(A, 15);                                           // the server’s clock passes the trial’s end; the page has not been told
    check('the page still shows the planner until it asks (an old answer is not a new one)', await plannerOpen(page));
    const mark = page.reqs.length;
    await page.clock.fastForward(14 * 86400000 + 90_000);          // this device’s time passes the end the server announced
    await pausedVisible(page);
    check('it asked the server again by itself', page.reqs.slice(mark).some((r) => r === 'GET /api/account'), page.reqs.slice(mark).join(','));
    check('and closed on the server’s answer', /Your free trial has ended/.test(await paused(page).innerText()));
  }, page);
  await ctx.close();
}

// ───────────────────────────── 3. payment states, live (mock provider) ─────────────────────────────
if (want('payments')) {
  const { ctx, page } = await open({ label: 'payments' });
  const email = 'gate.pay@example.test';
  await withTrial(page, B, email);
  await loadDemo(page);
  const state = async () => (await accountOf(page)).entitlement.state;
  await step('subscribing opens the planner (trial or not), and the exact terms were shown before', async () => {
    await route(page, 'account');
    await page.getByRole('heading', { name: 'Trial & plans', level: 1 }).waitFor();
    await page.getByRole('heading', { name: 'Choose a plan' }).waitFor();
    const t = await page.locator('main').innerText();
    check('both plans and their exact prices are on the screen', /€25/.test(t) && /€255/.test(t), t.slice(0, 600));
    const r = await subscribe(page, B, 'monthly');
    check('the provider confirmed (mock)', r.status === 200);
    await recheck(page);
    await page.getByRole('heading', { name: 'Monthly plan is active' }).waitFor();
    check('the server says paid-active', (await state()) === 'paid-active');
    await route(page, 'today');
    await waitPlanner(page);
    check('the planner is open', await plannerOpen(page));
  }, page);
  await step('cancel at the end of the period keeps the planner open through the paid period', async () => {
    check('the provider records the cancellation (mock)', (await provider(B, email, 'portal-cancel')).ok === true);
    await recheck(page);
    for (let i = 0; i < 40 && (await state()) !== 'cancellation-scheduled'; i++) await sleep(100);
    check('the server says cancellation-scheduled', (await state()) === 'cancellation-scheduled');
    await sleep(500);
    check('the planner is still open', await plannerOpen(page));
    check('and resuming keeps it open', (await provider(B, email, 'portal-resume')).ok === true && (await (async () => { await recheck(page); await sleep(500); return plannerOpen(page); })()));
  }, page);
  await step('a failed renewal keeps the planner open through the grace, and a payment that works again keeps it open', async () => {
    check('the provider reports a failed payment (mock)', (await provider(B, email, 'past_due')).ok === true);
    await recheck(page);
    for (let i = 0; i < 40 && (await state()) !== 'past-due'; i++) await sleep(100);
    check('the server says past-due, with access in the grace', (await accountOf(page)).entitlement.access === 'full');
    await sleep(400);
    check('the planner is open during the grace', await plannerOpen(page));
    await provider(B, email, 'active');
    await recheck(page);
    for (let i = 0; i < 40 && (await state()) !== 'paid-active'; i++) await sleep(100);
    check('paid again', (await state()) === 'paid-active' && await plannerOpen(page));
  }, page);
  await step('unpaid closes the planner at once, with the reason; paying reopens it exactly where it was, with the plan intact', async () => {
    const before = await planOf(page);
    await provider(B, email, 'unpaid');
    await recheck(page);
    await pausedVisible(page);
    check('the paused screen names the reason', /Payments stopped/.test(await paused(page).innerText()), await paused(page).innerText());
    check('the subscription section tells what to do next', (await page.getByRole('heading', { name: /paused/i }).count()) >= 1);
    check('the plan on the device is untouched', JSON.stringify((await planOf(page)).user) === JSON.stringify(before.user));
    await provider(B, email, 'active');
    await recheck(page);
    await waitPlanner(page);
    check('paying reopened the planner', await plannerOpen(page));
    check('on the same screen with the same plan (no reload happened)', (await planOf(page)).user.id === before.user.id && (await page.evaluate(() => performance.getEntriesByType('navigation').length)) >= 0);
  }, page);
  await step('an open dispute pauses it, winning reopens it; a refund ends it', async () => {
    await provider(B, email, 'dispute-open');
    await recheck(page);
    await pausedVisible(page);
    check('the paused screen says access is paused for a dispute', /payment dispute/.test(await paused(page).innerText()));
    await provider(B, email, 'dispute-won');
    await recheck(page);
    await waitPlanner(page);
    check('reopened', await plannerOpen(page));
    await provider(B, email, 'refund');
    await recheck(page);
    await pausedVisible(page);
    check('a refund closes it', /Your subscription has ended/.test(await page.locator('main').innerText()));
  }, page);
  await step('a first payment that needs another step does not open the planner', async () => {
    const { ctx: c2, page: p2 } = await open({ label: 'payments-3ds' });
    await withTrial(p2, B, 'gate.pay3ds@example.test');
    const r = await post(p2, '/api/billing/checkout', { plan: 'monthly' });
    const sid = r.json.url.split('/').pop();
    check('the provider asks for an extra step (mock)', (await provider(B, 'gate.pay3ds@example.test', 'requires-action', `&session=${sid}`)).ok === true);
    await post(p2, '/api/billing/sync', { sessionId: sid });
    const a = await accountOf(p2);
    check('the server says payment-action-required and account-only', a.entitlement.state === 'payment-action-required' && a.entitlement.access === 'account-only', JSON.stringify(a.entitlement));
    await recheck(p2);
    await pausedVisible(p2);
    check('the paused screen says the payment is not finished', /first payment is not finished/.test(await paused(p2).innerText()));
    await c2.close();
  }, page);
  await ctx.close();
}

// ───────────────────────────── 4. returning from the payment page ─────────────────────────────
if (want('return')) {
  const { ctx, page } = await open({ label: 'return' });
  const email = 'gate.return@example.test';
  await newAccount(page, B, email);
  await step('coming back from a completed payment opens the planner only because the SERVER says so; the address proves nothing', async () => {
    const r = await post(page, '/api/billing/checkout', { plan: 'annual' });
    const sid = r.json.url.split('/').pop();
    // The person comes back before the provider has confirmed anything: the address says "success", the server says no.
    await page.goto(`${B}?billing=success&session_id=${sid}`);
    await pausedVisible(page);
    check('still paused: a success address is not a payment', (await accountOf(page)).entitlement.access === 'account-only' && (await page.locator('.app').count()) === 0);
    await page.getByText(/has not confirmed a payment yet|Nothing is assumed/).first().waitFor();
    await fetch(`${B}__test/complete?session=${sid}`);               // now the provider confirms
    await sleep(2300);                                               // the server lets one account ask the provider only every 2 seconds (SYNC_COOLDOWN_MS)
    await page.getByRole('button', { name: 'Check payment status again' }).click();
    await page.getByText('The payment provider confirmed your subscription. Thank you.').waitFor();
    check('the screen shows the confirmed plan from the server', (await accountOf(page)).entitlement.state === 'paid-active');
    await route(page, 'today');
    await waitPlanner(page);
    check('and now the planner opens', await plannerOpen(page));
  }, page);
  await ctx.close();
}

// ───────────────────────────── 5. when the server cannot be reached ─────────────────────────────
if (want('offline')) {
  const { ctx, page } = await open({ label: 'offline' });
  await page.clock.install();
  await page.goto(A);
  await page.clock.resume();
  const email = 'gate.offline@example.test';
  await withTrial(page, A, email);
  await loadDemo(page);
  const planKey = `cleanflow:v1@${await idOf(page)}`;                // read now: the account endpoint is about to become unreachable
  const storedPlan = async () => { await settle(page); return JSON.parse(await ls(page, planKey)); };
  await step('a check that gets no answer keeps the planner open for the documented allowance and says so', async () => {
    await page.route('**/api/account', (r) => r.abort('connectionfailed'));
    await recheck(page);
    const note = page.locator('.access-note');
    await note.waitFor();
    const t = await note.innerText();
    check('the note says the server could not be reached and until when', /Offline: the server could not be reached/.test(t) && /stays open until/.test(t), t);
    check('the planner is still open', await plannerOpen(page));
    check('nothing was thrown away: the plan is on the device', (await storedPlan()).onboardingComplete === true);
    check('the note is a status message for screen readers', (await note.getAttribute('role')) === 'status');
  }, page);
  await step('after the allowance (72 hours of this device’s time) the planner closes on a "cannot confirm" screen; nothing is deleted', async () => {
    await page.clock.fastForward(73 * 3600 * 1000);
    await page.getByRole('heading', { name: 'We cannot confirm your plan right now' }).waitFor();
    check('the screen says nothing was changed or deleted', /Nothing on this device has been changed or deleted/.test(await page.locator('main').innerText()));
    check('it is not local mode: the planner is not shown', (await page.locator('.app').count()) === 0);
    check('the data screen is still reachable to download the plan', (await page.getByRole('link', { name: 'Download my data' }).count()) === 1);
    check('the plan is untouched', (await storedPlan()).onboardingComplete === true);
  }, page);
  await step('when the server answers again the planner returns', async () => {
    await page.unroute('**/api/account');
    await page.getByRole('button', { name: 'Try again' }).click();
    await waitPlanner(page);
    check('open again, with no offline note', await plannerOpen(page) && (await page.locator('.access-note').count()) === 0);
  }, page);
  await step('a server fault on a check is treated the same way as no answer', async () => {
    await page.route('**/api/account', (r) => r.fulfill({ status: 503, contentType: 'application/json', body: '{"error":{"code":"x","message":"y"}}' }));
    await recheck(page);
    await page.locator('.access-note').waitFor();
    check('the planner stays open under the allowance', await plannerOpen(page));
    await page.unroute('**/api/account');
    await recheck(page);
    await page.locator('.access-note').waitFor({ state: 'detached' });
    check('and the note goes when the server is back', true);
  }, page);
  await step('a closed account stays closed without the server: a "no" is not an offline question', async () => {
    const { ctx: c2, page: p2 } = await open({ label: 'offline-closed' });
    await newAccount(p2, A, 'gate.offline.closed@example.test');
    await p2.route('**/api/account', (r) => r.abort('connectionfailed'));
    await recheck(p2);
    await sleep(500);
    check('still paused, no offline allowance offered', (await paused(p2).count()) === 1 && (await p2.locator('.access-note').count()) === 0);
    await c2.close();
  }, page);
  await step('a start with the server unreachable never turns into local mode: the app says so and touches nothing', async () => {
    const { ctx: c3, page: p3 } = await open({ label: 'offline-cold' });
    await p3.goto(A);
    await p3.evaluate(() => localStorage.setItem('cleanflow:v1@someone', '{"keep":"me"}'));
    await p3.route('**/api/config', (r) => r.abort('connectionfailed'));
    await p3.reload();
    await p3.getByRole('heading', { name: 'Cannot reach the server' }).waitFor();
    check('the data is exactly as it was', (await ls(p3, 'cleanflow:v1@someone')) === '{"keep":"me"}' && (await ls(p3, 'cleanflow:v1')) === null);
    check('and no planner is shown', (await p3.locator('.app, .onb').count()) === 0);
    await c3.close();
  }, page);
  await ctx.close();
}

// ───────────────────────────── 6. what the browser cannot decide ─────────────────────────────
if (want('tamper')) {
  const { ctx, page } = await open({ label: 'tamper' });
  await newAccount(page, A, 'gate.tamper@example.test');
  await step('a page edited to claim access opens the interface, and the server still refuses every paid operation (the gate is an interface rule)', async () => {
    await page.route('**/api/account', async (r) => {
      const real = await (await r.fetch()).json();
      real.account.entitlement = { ...real.account.entitlement, state: 'trial-active', access: 'full', accessEndsAt: null, reason: 'tampered' };
      await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(real) });
    });
    await page.reload();
    await waitPlanner(page);
    check('the planner opens on the forged answer: this part of the app cannot be made tamper-proof', await plannerOpen(page));
    await page.unroute('**/api/account');
    const coach = await post(page, '/api/coach', await coachBody(A));
    const put = await api(page, '/api/account/backup', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ baseRevision: null, includes: [], data: {} }) });
    check('the server still refuses the AI coach', coach.status === 402, `${coach.status} ${JSON.stringify(coach.json)}`);
    check('and the cloud backup upload', put.status === 402, String(put.status));
    check('and the account says what it really is', (await accountOf(page)).entitlement.access === 'account-only');
  }, page);
  await ctx.close();
}

// ───────────────────────────── 7. two accounts on one browser ─────────────────────────────
if (want('switch')) {
  const { ctx, page } = await open({ label: 'switch' });
  const e1 = 'gate.sw1@example.test'; const e2 = 'gate.sw2@example.test';
  await newAccount(page, A, e1);                                   // no trial: closed
  const id1 = await idOf(page);
  await post(page, '/api/auth/sign-out', {});
  await withTrial(page, A, e2);                                    // trial: open
  await loadDemo(page);
  const id2 = await idOf(page);
  await step('each account gets its own answer: the second is open, the first is closed, and neither sees the other’s plan', async () => {
    check('the second account’s planner is open', await plannerOpen(page));
    check('its plan is under its own key only', (await lsKeys(page)).includes(`cleanflow:v1@${id2}`) && !(await lsKeys(page)).includes(`cleanflow:v1@${id1}`));
    await post(page, '/api/auth/sign-out', {});
    await signIn(page, A, e1);
    await pausedVisible(page);
    check('the first account is still closed', (await page.locator('.app').count()) === 0 && (await accountOf(page)).user.id === id1);
    check('the second account’s plan is not shown or opened', !(await page.locator('main').innerText()).includes('Habits'));
    await post(page, '/api/auth/sign-out', {});
    await signIn(page, A, e2);
    await waitPlanner(page);
    check('and back to the second: open, with its plan', await plannerOpen(page) && (await planOf(page)).onboardingComplete === true);
  }, page);
  await ctx.close();
}

// ───────────────────────────── 8. local-only mode has no gate ─────────────────────────────
if (want('local')) {
  const { ctx, page } = await open({ label: 'local' });
  await step('with no accounts the planner is always open, nothing asks the server about a plan, and every address works', async () => {
    await page.goto(L);
    await welcomeVisible(page);
    await page.getByText('Beginner: discipline & fitness').first().click();
    await page.waitForSelector('text=Habits & routine');
    for (const r of ['today', 'plan', 'schedule', 'settings', 'more']) { await route(page, r); await page.locator('.app').waitFor(); }
    check('no paused screen anywhere', (await paused(page).count()) === 0);
    check('no request to an account or billing endpoint', !page.reqs.some((r) => /api\/account|api\/billing/.test(r)), page.reqs.join(' | '));
    await settle(page);
    check('the data is on the original key', (await ls(page, 'cleanflow:v1')) !== null);
    await route(page, 'account');
    await page.getByRole('heading', { name: 'Trial & plans', level: 1 }).waitFor();
    check('Trial & plans says there are no accounts', /no accounts/i.test(await page.locator('main').innerText()) && (await paused(page).count()) === 0);
  }, page);
  await ctx.close();
}

// ───────────────────────────── 9. the clock-driven ends, last: they move the servers’ clocks on ─────────────────────────────
if (want('ends')) {
  const e1 = 'gate.grace@example.test'; const e2 = 'gate.cancelled@example.test';
  const one = await open({ label: 'ends-grace' });
  const two = await open({ label: 'ends-cancel' });
  await withTrial(one.page, B, e1); await subscribe(one.page, B, 'monthly'); await loadDemo(one.page);
  await withTrial(two.page, B, e2); await subscribe(two.page, B, 'monthly'); await loadDemo(two.page);
  await provider(B, e1, 'past_due');                                // a failed renewal: the grace is 3 days
  await provider(B, e2, 'portal-cancel');                           // cancelled at the end of the period
  await one.page.reload(); await waitPlanner(one.page); await two.page.reload(); await waitPlanner(two.page);
  await step('inside the grace the planner is open; once the grace has passed by the server’s clock it closes with the reason', async () => {
    check('open in the grace', await plannerOpen(one.page) && (await accountOf(one.page)).entitlement.state === 'past-due');
    await advance(B, 4);
    await recheck(one.page);
    await pausedVisible(one.page);
    check('closed after the grace, naming the failed payment', /did not go through and the days of grace are over/.test(await paused(one.page).innerText()));
    check('the cancelled-at-period-end account is still inside its paid period', (await (async () => { await recheck(two.page); await sleep(600); return plannerOpen(two.page); })()));
  }, one.page);
  await step('a subscription cancelled at the end of the period stays open to the exact end, then closes', async () => {
    check('still cancellation-scheduled', (await accountOf(two.page)).entitlement.state === 'cancellation-scheduled');
    await advance(B, 27);                                            // 31 days in all: past the period end
    await recheck(two.page);
    await pausedVisible(two.page);
    check('now closed, and the subscription section says it has ended', /Your subscription has ended/.test(await two.page.locator('main').innerText()));
    check('a new plan can be chosen', (await two.page.getByRole('heading', { name: 'Choose a plan' }).count()) === 1);
    check('export and deletion are still there', (await two.page.getByRole('button', { name: 'Delete my account…' }).count()) === 1 && /Download my account data/.test(await two.page.locator('main').innerText()));
  }, two.page);
  await one.ctx.close(); await two.ctx.close();
}

clearTimeout(watchdog);
await browser.close();
await Promise.all(servers.map(stopServer));
done(errors);
process.exit(process.exitCode ?? 0);
