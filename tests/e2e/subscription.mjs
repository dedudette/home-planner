// Subscription management and the AI allowance in a real browser: the subscription card in every state, the billing portal, cancelling and
// resuming, payment problems, the AI allowance, and export / billing / deletion after access has ended. Also errors and recovery, tampering,
// keyboard use, screen-reader semantics, reduced motion, dark mode, narrow screens and large text.
//
// Servers (tests/e2e/accountsServer.ts: the real API on a throwaway PostgreSQL database with real Better Auth and a mailbox):
//   A  accounts, billing on a MOCK payment provider (tests/support/fakeStripe.ts: the REAL Stripe SDK talking to a local stand-in).
//      What this proves is this app's behaviour given plausible provider answers. It does NOT verify Stripe. Nothing here contacts Stripe,
//      no card or payment is involved, and the server refuses live keys. The "provider" is driven through /__test/provider.
//   B  accounts, billing NOT configured
//
//   npm run build && npm run e2e:subscription      (needs the PostgreSQL server binaries; see scripts/test-db.sh)
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { launch, OUT, runner, watch } from './lib.mjs';

const P = Number(process.env.E2E_PORT ?? 18500);
const A = `http://127.0.0.1:${P}/`;
const B = `http://127.0.0.1:${P + 1}/`;
const { check, step, done } = runner('subscription');
const errors = [];

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
  servers.push(await start(P, { E2E_BILLING: 'fake' }));
  servers.push(await start(P + 1));
  browser = await launch();
} catch (e) { console.log(`FAIL setup: ${e.message}`); await Promise.all(servers.map(stopServer)); process.exit(1); }

const PW = 'correct horse battery';
let ipn = 60;
const open = async (o = {}) => {
  const ctx = await browser.newContext({ viewport: { width: o.w ?? 390, height: o.h ?? 844 }, isMobile: (o.w ?? 390) < 600, hasTouch: (o.w ?? 390) < 600, locale: 'en-US', timezoneId: 'UTC', colorScheme: o.dark ? 'dark' : 'light', reducedMotion: o.reduced ? 'reduce' : 'no-preference', acceptDownloads: true, extraHTTPHeaders: { 'x-forwarded-for': `10.8.${++ipn}.1` } });
  const page = await ctx.newPage();
  watch(page, errors, o.label ?? '');
  // The mock provider's pages do not exist on the network; the browser is only ever sent to them, never to Stripe.
  await ctx.route(/^https:\/\/(checkout|billing)\.stripe\.test\//, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Mock provider page</title><p>Mock provider page</p>' }));
  return { ctx, page };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mail = async (base, to) => (await fetch(`${base}__test/mail?to=${encodeURIComponent(to.toLowerCase())}`)).json();
const waitMail = async (base, to) => { for (let i = 0; i < 40; i++) { const ms = (await mail(base, to)).filter((x) => /confirm your email/i.test(x.subject)); if (ms.length) return ms[ms.length - 1]; await sleep(100); } throw new Error(`no mail for ${to}`); };
const welcomeVisible = (p) => p.getByRole('heading', { name: 'One calm plan for your home, your body and your day' }).waitFor();
/** A new account has no trial yet, so the planner is closed and the first screen is Trial & plans in its paused form. */
const pausedVisible = (p) => p.getByTestId('planner-paused').waitFor();
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
const openPlans = async (page, base = A) => {
  await page.goto(`${base}?r=${Date.now()}#/account`);                    // a new address, so the screen always loads the server's current answer
  await page.getByRole('heading', { name: 'Trial & plans', level: 1 }).waitFor();
  await page.getByRole('heading', { name: 'AI allowance' }).waitFor();
};
const api = (page, path, init) => page.evaluate(async ([p, i]) => { const r = await fetch(p, i); return { status: r.status, json: await r.json().catch(() => null) }; }, [path, init]);
const post = (page, path, body = {}) => api(page, path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const text = (page) => page.locator('main').innerText();
const provider = async (base, email, op, extra = '') => { const r = await fetch(`${base}__test/provider?email=${encodeURIComponent(email)}&op=${op}${extra}`); return r.json(); };
const state = async (base, email) => (await fetch(`${base}__test/state?email=${encodeURIComponent(email)}`)).json();
const advance = async (base, days) => (await fetch(`${base}__test/advance?days=${days}`)).json();
const use = async (base, email, n) => (await fetch(`${base}__test/use?email=${encodeURIComponent(email)}&n=${n}`)).json();
const dateText = (iso) => new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(new Date(iso));
const region = (page, name) => page.getByRole('region', { name });
const btn = (page, name) => page.getByRole('button', { name, exact: true });
const accountOf = async (page) => (await api(page, '/api/account')).json.account;
/** A paid subscription made the way the app does it: server-created checkout, "paid" at the mock provider, then the server asks the provider. */
const subscribe = async (page, base, plan = 'monthly') => {
  const r = await post(page, '/api/billing/checkout', { plan });
  const sid = r.json.url.split('/').pop();
  await fetch(`${base}__test/complete?session=${sid}`);
  const s = await post(page, '/api/billing/sync', { sessionId: sid });
  return { sid, status: s.status, url: r.json.url };
};
let N = 0;
const mk = async (label, o = {}) => { const { ctx, page } = await open({ label, ...o }); const email = `sub${++N}.${label}@example.test`; await newAccount(page, A, email); return { ctx, page, email }; };

let monthlyLimit = null;

// ───────────────────────────── a trial, then a subscription made through the app ─────────────────────────────
{
  const { ctx, page, email } = await mk('flow');
  await step('before anything is bought: no subscription section, AI paused with the reason, and export and deletion are already there', async () => {
    await openPlans(page);
    const t = await text(page);
    check('no subscription section', (await page.getByRole('heading', { name: 'Your subscription', exact: true }).count()) === 0);
    check('AI is paused and says why, in words', /AI features are paused/.test(t) && /not started a trial or a subscription/.test(t));
    check('no progress bar without an allowance', (await page.getByRole('progressbar').count()) === 0);
    check('export and deletion are offered', (await page.getByRole('button', { name: 'Download my account data' }).count()) === 1 && (await page.getByRole('button', { name: 'Delete my account…' }).count()) === 1);
    check('the always-available promise is stated', /always available, including after your trial or subscription has ended/.test(t));
  }, page);
  await step('a trial shows the trial allowance (whole trial), and spending requests lowers it by exactly that many', async () => {
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: /^Start my 14-day trial$/ }).click();
    await page.getByText('Your free trial is active.').waitFor();
    check('full trial allowance', /50 of 50 AI requests left in your trial/.test(await text(page)));
    await use(A, email, 7);
    await page.reload();
    await page.getByRole('heading', { name: 'AI allowance' }).waitFor();
    const t = await text(page);
    check('43 of 50 after 7 requests', /43 of 50 AI requests left in your trial/.test(t) && /7 used/.test(t));
    check('says the trial allowance is for the whole trial and does not carry over', /whole trial/.test(t) && /do not carry over/.test(t));
    const bar = page.getByRole('progressbar', { name: 'AI requests used' });
    check('the bar is named and readable by a screen reader', (await bar.getAttribute('aria-valuetext')) === '7 of 50 used, 43 left');
  }, page);
  let checkoutUrl = '';
  await step('choosing a plan goes to the mock provider\'s payment page; the browser sends only the plan name', async () => {
    const bodies = [];
    page.on('request', (r) => { if (r.url().includes('/api/billing/') && r.method() === 'POST') bodies.push(`${new URL(r.url()).pathname} ${r.postData()}`); });
    await page.getByRole('radio', { name: /Monthly/ }).check();
    await page.getByRole('button', { name: /^Continue to pay/ }).click();
    await page.waitForURL(/checkout\.stripe\.test/);
    checkoutUrl = page.url();
    check('only the plan name was sent', bodies.some((b) => b === '/api/billing/checkout {"plan":"monthly"}'), bodies.join(' | '));
    check('no price, amount or customer left the browser', !bodies.some((b) => /price|amount|customer|cus_|unit_amount/i.test(b)));
  }, page);
  await step('coming back from the payment page proves nothing by itself; after the mock provider says paid, the server confirms and the card appears', async () => {
    const sid = checkoutUrl.split('/').pop();
    await page.goto(`${A}?billing=success&session_id=${sid}#/account`);
    await page.getByText('has not confirmed a payment yet').waitFor();
    check('no subscription card while unpaid', (await page.getByRole('heading', { name: 'Your subscription', exact: true }).count()) === 0);
    check('the trial allowance still applies', /AI requests left in your trial/.test(await text(page)));
    await fetch(`${A}__test/complete?session=${sid}`);
    await sleep(2300);
    await page.getByRole('button', { name: 'Check payment status again' }).click();
    await page.getByRole('heading', { name: 'Your subscription', exact: true }).waitFor();
    await page.getByText('The payment provider confirmed your subscription. Thank you.').waitFor();
  }, page);
  let end = '';
  await step('the card shows plan, status, price, the renewal date and the amount; the allowance is the paid monthly one', async () => {
    const a = await accountOf(page);
    end = a.subscription.currentPeriodEnd;
    const t = await text(page);
    check('headline', /Monthly plan is active/.test(t));
    check('plan, price and status', /Monthly · €25\/month · status: active/.test(t));
    check('renewal date and amount, charged every month', t.includes(`renews automatically on ${dateText(end)} and you will be charged €25 every month`), t);
    check('the allowance card is the monthly one with the server\'s numbers', /300 of 300 AI requests left this month/.test(t));
    monthlyLimit = a.allowance.limit;
    check('the reset date is shown and is the server\'s', t.includes(`resets on ${dateText(a.allowance.resetsAt)}`));
    check('both plans share it, said plainly', /same allowance: 300 requests every month, even if you pay once a year/.test(t));
    check('never "unlimited"', !/unlimited/i.test(t));
    check('the trial section is gone once subscribed', (await page.getByRole('heading', { name: 'Free trial' }).count()) === 0);
    check('no second plan is offered', (await page.getByRole('radio').count()) === 0);
    await use(A, email, 5);
    await page.reload();
    await page.getByRole('heading', { name: 'AI allowance' }).waitFor();
    check('295 of 300 after 5 more', /295 of 300 AI requests left this month/.test(await text(page)));
  }, page);
  await step('"Manage billing and invoices" asks the server for the portal; the browser supplies no customer', async () => {
    const bodies = [];
    page.on('request', (r) => { if (r.url().includes('/api/billing/portal')) bodies.push(r.postData()); });
    await btn(page, 'Manage billing and invoices').click();
    await page.waitForURL(/billing\.stripe\.test/);
    check('the request body is empty', bodies.length === 1 && bodies[0] === '{}', JSON.stringify(bodies));
    const s = await state(A, email);
    check('the server made one portal session, for this account\'s own customer', s.portalSessions === 1);
    await page.goto(`${A}?billing=returned#/account`);
    await page.getByRole('heading', { name: 'Your subscription', exact: true }).waitFor();
    check('returning from the portal asks the server and shows the same subscription', /Monthly plan is active/.test(await text(page)));
  }, page);
  await step('cancel: a confirmation with the exact end date comes first, focus moves into it, and "Keep my subscription" changes nothing', async () => {
    await page.getByRole('heading', { name: 'Your subscription', exact: true }).waitFor();
    await btn(page, 'Cancel at period end').click();
    const g = page.getByRole('group', { name: 'Cancel at the end of this period?' });
    await g.waitFor();
    check('the confirmation names the date and what is kept', (await g.innerText()).includes(`until ${dateText(end)}`) && /Your data is kept/.test(await g.innerText()));
    check('focus is inside the confirmation', await g.evaluate((el) => el === document.activeElement || el.contains(document.activeElement)));
    check('the other buttons are out of the way while deciding', (await btn(page, 'Manage billing and invoices').count()) === 0);
    await btn(page, 'Keep my subscription').click();
    check('focus returns to the button that opened it', await page.evaluate(() => document.activeElement?.textContent === 'Cancel at period end'));
    check('nothing changed at the provider', (await state(A, email)).sub.cancel_at_period_end === false);
  }, page);
  await step('confirming cancels at period end: access stays, the date is stated, resume replaces cancel, and a double click sends one request', async () => {
    let cancels = 0;
    page.on('request', (r) => { if (r.url().includes('/api/billing/cancel')) cancels++; });
    await btn(page, 'Cancel at period end').click();
    const yes = btn(page, 'Yes, cancel at period end');
    await yes.dblclick();
    await page.getByRole('heading', { name: `Your plan ends on ${dateText(end)}` }).waitFor();
    check('exactly one cancel request', cancels === 1, String(cancels));
    const t = await text(page);
    check('a status message says what happened', t.includes(`Cancellation scheduled. You keep full access until ${dateText(end)}`));
    check('keeps full access and no further charge', /keep full access until then/.test(t) && /will not be charged again/.test(t));
    check('resume and billing offered, cancel gone', (await btn(page, 'Resume my subscription').count()) === 1 && (await btn(page, 'Cancel at period end').count()) === 0);
    check('the AI allowance is still there until the end', /AI requests left this month/.test(t));
    check('the provider really has it set to cancel at period end', (await state(A, email)).sub.cancel_at_period_end === true);
    await page.reload();
    await page.getByRole('heading', { name: `Your plan ends on ${dateText(end)}` }).waitFor();
  }, page);
  await step('resume undoes it; nothing else changes', async () => {
    await btn(page, 'Resume my subscription').click();
    await page.getByRole('heading', { name: 'Monthly plan is active' }).waitFor();
    check('provider agrees', (await state(A, email)).sub.cancel_at_period_end === false);
    check('allowance untouched', /295 of 300 AI requests left this month/.test(await text(page)));
  }, page);
  await ctx.close();
}

// ───────────────────────────── the annual plan: €255 once a year, and the same monthly allowance ─────────────────────────────
{
  const { ctx, page, email } = await mk('annual');
  await step('annual: €255 a year charged once, never as a monthly charge, and exactly the same AI allowance as monthly, resetting within a month', async () => {
    const r = await subscribe(page, A, 'annual');
    check('the server confirmed it', r.status === 200);
    await openPlans(page);
    await page.getByRole('heading', { name: 'Your subscription', exact: true }).waitFor();
    const t = await text(page);
    const a = await accountOf(page);
    check('plan line', /Annual · €255\/year · status: active/.test(t));
    check('charged once a year', /charged €255 once a year/.test(t) && !/€255 every month/.test(t));
    check('same limit as the monthly account', a.allowance.limit === monthlyLimit && new RegExp(`${monthlyLimit} of ${monthlyLimit} AI requests left this month`).test(t), `${a.allowance.limit} vs ${monthlyLimit}`);
    check('the reset is within a month although the plan is for a year', Date.parse(a.allowance.resetsAt) - Date.parse(a.serverTime) <= 31 * 86400000);
    check('the renewal is a year away', Date.parse(a.subscription.currentPeriodEnd) - Date.parse(a.serverTime) > 300 * 86400000);
    void email;
  }, page);
  await step('plan changes made in the portal show up after returning: cancel in the portal, then monthly → annual', async () => {
    check('portal-side cancel reported by the provider', (await provider(A, email, 'portal-cancel')).ok === true);
    await page.goto(`${A}?billing=returned#/account`);
    await page.getByRole('heading', { name: /^Your plan ends on/ }).waitFor();
    check('the screen now says it ends', /will not be charged again/.test(await text(page)));
    check('resumed in the portal too', (await provider(A, email, 'portal-resume')).ok === true);
    await page.goto(`${A}?billing=returned#/account`);
    await page.getByRole('heading', { name: 'Annual plan is active' }).waitFor();
  }, page);
  await ctx.close();
}
{
  const { ctx, page, email } = await mk('switch');
  await step('switching monthly → annual in the portal updates plan and amount, and does not reset the allowance', async () => {
    await subscribe(page, A, 'monthly');
    await use(A, email, 4);
    await openPlans(page);
    await page.getByRole('heading', { name: 'Monthly plan is active' }).waitFor();
    check('196 → 296 of 300 left', /296 of 300 AI requests left this month/.test(await text(page)));
    await provider(A, email, 'portal-annual');
    await page.goto(`${A}?billing=returned#/account`);
    await page.getByRole('heading', { name: 'Annual plan is active' }).waitFor();
    const t = await text(page);
    check('annual price and charge', /Annual · €255\/year/.test(t) && /€255 once a year/.test(t));
    check('allowance carried over, not reset', /296 of 300 AI requests left this month/.test(t));
  }, page);
  await ctx.close();
}

// ───────────────────────────── a payment that needs the bank ─────────────────────────────
{
  const { ctx, page, email } = await mk('sca');
  await step('payment action required: nothing active, no AI, "Continue to the payment page" returns to the same checkout, "Check status" assumes nothing', async () => {
    const r = await post(page, '/api/billing/checkout', { plan: 'annual' });
    const sid = r.json.url.split('/').pop();
    check('the provider created an incomplete subscription', (await provider(A, email, 'requires-action', `&session=${sid}`)).ok === true);
    await openPlans(page);
    await page.getByRole('heading', { name: 'Your payment needs one more step' }).waitFor();
    const t = await text(page);
    check('says nothing is active and nothing is assumed', /not active/.test(t) && /Nothing is assumed/.test(t));
    check('the allowance is paused with the reason', /AI features are paused/.test(t) && /first payment is not confirmed/.test(t));
    check('export and deletion still there', (await btn(page, 'Download my account data').count()) === 1);
    check('no cancel or billing page offered yet', (await btn(page, 'Cancel at period end').count()) === 0 && (await btn(page, 'Manage billing and invoices').count()) === 0);
    await sleep(2200);
    await btn(page, 'Check status').click();
    await page.getByText('nothing has changed').waitFor();
    await btn(page, 'Continue to the payment page').click();
    await page.waitForURL(/checkout\.stripe\.test/);
    check('it went back to the very same checkout, not a new one', page.url() === r.json.url, `${page.url()} vs ${r.json.url}`);
  }, page);
  await ctx.close();
}

// ───────────────────────────── errors and recovery ─────────────────────────────
{
  const { ctx, page, email } = await mk('errors');
  await subscribe(page, A, 'monthly');
  await step('the account cannot be loaded: a clear message, nothing invented, and Try again recovers', async () => {
    await openPlans(page);
    await page.getByRole('heading', { name: 'Your subscription', exact: true }).waitFor();
    await page.route('**/api/account', (r) => r.abort());
    await page.evaluate(() => { location.hash = '#/'; });
    await page.evaluate(() => { location.hash = '#/account'; });
    await page.getByText(/could not be reached/).waitFor();
    check('no subscription or allowance is shown from memory', (await page.getByRole('heading', { name: 'Your subscription', exact: true }).count()) === 0 && (await page.getByRole('progressbar').count()) === 0);
    await page.unroute('**/api/account');
    await btn(page, 'Try again').click();
    await page.getByRole('heading', { name: 'Your subscription', exact: true }).waitFor();
  }, page);
  await step('cancel fails at the provider: the message says it is unchanged, the confirmation stays so it can be retried, and retry works', async () => {
    await page.route('**/api/billing/cancel', (r) => r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: 'billing-unavailable', message: 'x' } }) }));
    await btn(page, 'Cancel at period end').click();
    await btn(page, 'Yes, cancel at period end').click();
    const alert = page.locator('[role=alert]').filter({ hasText: 'unchanged' });
    await alert.waitFor();
    check('the card still says active', /Monthly plan is active/.test(await text(page)));
    check('the confirmation is still open', (await page.getByRole('group', { name: 'Cancel at the end of this period?' }).count()) === 1);
    check('the provider was not changed', (await state(A, email)).sub.cancel_at_period_end === false);
    await page.unroute('**/api/billing/cancel');
    await btn(page, 'Yes, cancel at period end').click();
    await page.getByRole('heading', { name: /^Your plan ends on/ }).waitFor();
    await btn(page, 'Resume my subscription').click();
    await page.getByRole('heading', { name: 'Monthly plan is active' }).waitFor();
  }, page);
  await step('the billing page cannot be opened: said plainly, nothing changed, and the screen stays usable', async () => {
    await page.route('**/api/billing/portal', (r) => r.abort());
    await btn(page, 'Manage billing and invoices').click();
    await page.locator('[role=alert]').filter({ hasText: 'could not be reached' }).waitFor();
    check('the subscription was not changed', /Your subscription was not changed/.test(await text(page)));
    check('the buttons work again', await btn(page, 'Manage billing and invoices').isEnabled());
    await page.unroute('**/api/billing/portal');
  }, page);
  await step('an unsafe address from the server is never followed', async () => {
    await page.route('**/api/billing/portal', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, url: 'javascript:alert(1)' }) }));
    await btn(page, 'Manage billing and invoices').click();
    await page.locator('[role=alert]').filter({ hasText: 'Something went wrong' }).waitFor();
    check('still on this app', page.url().startsWith(A));
    await page.unroute('**/api/billing/portal');
  }, page);
  await step('the session ends while the screen is open: the next action says so and offers to sign in again', async () => {
    await ctx.clearCookies();
    await btn(page, 'Manage billing and invoices').click();
    await page.getByText('Your session has ended. Sign in again to continue.').first().waitFor();
    await page.getByRole('button', { name: 'Sign in again' }).click();
    await page.getByRole('heading', { name: 'Sign in', exact: true }).waitFor();
  }, page);
  await ctx.close();
}

// ───────────────────────────── nothing the browser holds grants anything ─────────────────────────────
{
  const { ctx, page } = await mk('tamper');
  await step('stored flags, a forged success address and a wrong device clock change nothing about what is shown', async () => {
    await page.evaluate(() => { for (const k of ['cleanflow:entitlement', 'cleanflow:plan', 'cleanflow:subscription', 'cleanflow:paid', 'cleanflow:allowance']) localStorage.setItem(k, JSON.stringify({ state: 'paid-active', plan: 'annual', remaining: 9999, access: 'full' })); });
    await page.clock.install({ time: new Date(Date.now() + 400 * 86400000) });
    await page.goto(`${A}?billing=success&session_id=cs_forged_1234567890#/account`);
    await page.getByRole('heading', { name: 'AI allowance' }).waitFor();
    const t = await text(page);
    check('no subscription section', (await page.getByRole('heading', { name: 'Your subscription', exact: true }).count()) === 0);
    check('AI paused', /AI features are paused/.test(t) && !/9999/.test(t));
    check('nothing is claimed as paid', !/Thank you/.test(t) && !/is active/.test(t));
    check('the server still says no access', (await accountOf(page)).entitlement.access === 'account-only');
  }, page);
  await ctx.close();
}

// ───────────────────────────── billing not configured on the server ─────────────────────────────
{
  const { ctx, page } = await open({ label: 'nobilling' });
  await step('without a payment provider: the trial and its allowance work, there is nothing to buy or manage, and export and deletion are there', async () => {
    await newAccount(page, B, 'sub.nobill@example.test');
    await openPlans(page, B);
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: /^Start my 14-day trial$/ }).click();
    await page.getByText('Your free trial is active.').waitFor();
    const t = await text(page);
    check('trial allowance shown', /50 of 50 AI requests left in your trial/.test(t));
    check('says nothing can be bought and explains in words', /not set up on this server yet/.test(t) && !/not-configured|STRIPE/.test(t));
    check('no billing buttons', (await btn(page, 'Manage billing and invoices').count()) === 0 && (await btn(page, 'Cancel at period end').count()) === 0);
    check('export and deletion', (await btn(page, 'Download my account data').count()) === 1 && (await btn(page, 'Delete my account…').count()) === 1);
  }, page);
  await ctx.close();
}

// ───────────────────────────── layout, semantics, motion and colour on the real states ─────────────────────────────
const setups = {
  active: async (p, email) => { await subscribe(p, A, 'monthly'); },
  cancelling: async (p, email) => { await subscribe(p, A, 'monthly'); await post(p, '/api/billing/cancel'); },
  pastdue: async (p, email) => { await subscribe(p, A, 'monthly'); await provider(A, email, 'past_due'); },
  unpaid: async (p, email) => { await subscribe(p, A, 'annual'); await provider(A, email, 'unpaid'); },
};
for (const [w, h, dark, big, reduced] of [[320, 640, false, false, false], [390, 844, true, false, true], [1024, 768, false, false, false], [320, 640, false, true, false]]) {
  const tag = `${w}${dark ? '-dark' : ''}${big ? '-bigtext' : ''}${reduced ? '-reduced' : ''}`;
  for (const [name, setup] of Object.entries(setups)) {
    const { ctx, page, email } = await mk(`lay-${name}-${tag}`.replace(/[^a-z0-9-]/gi, ''), { w, h, dark, reduced });
    await step(`${name} @ ${tag}: no sideways scrolling, one h1, labelled sections, a named bar, big enough controls`, async () => {
      await setup(page, email);
      await openPlans(page);
      await page.getByRole('heading', { name: 'Your subscription', exact: true }).waitFor();
      if (big) await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
      await page.waitForTimeout(150);
      const r = await page.evaluate(() => {
        const vis = (el) => el.offsetParent !== null;
        const small = [...document.querySelectorAll('main button, main a.btn, main input:not([type=checkbox]):not([type=radio])')].filter(vis).filter((b) => b.getBoundingClientRect().height < 40).map((b) => (b.textContent || '').trim().slice(0, 30));
        const sections = [...document.querySelectorAll('main section section')].map((s) => ({ labelled: !!document.getElementById(s.getAttribute('aria-labelledby') || '__none__') }));
        const bar = document.querySelector('[role=progressbar]');
        const fill = document.querySelector('.progress-fill');
        return { overflow: document.documentElement.scrollWidth - innerWidth, h1: document.querySelectorAll('h1').length, h2: document.querySelectorAll('main h2').length, sections, small, bar: bar ? { name: bar.getAttribute('aria-label'), text: bar.getAttribute('aria-valuetext'), now: bar.getAttribute('aria-valuenow') } : null, transition: fill ? getComputedStyle(fill).transitionDuration : null };
      });
      check('no sideways scrolling', r.overflow <= 0, String(r.overflow));
      check('one h1, section headings are h2', r.h1 === 1 && r.h2 >= 3, JSON.stringify(r));
      check('every section is labelled by its heading', r.sections.every((s) => s.labelled));
      check('controls at least 40px tall', r.small.length === 0, r.small.join(' | '));
      if (name === 'active' || name === 'cancelling' || name === 'pastdue') check('the allowance bar has a name and a spoken value', !!r.bar && r.bar.name === 'AI requests used' && /of 300 used/.test(r.bar.text ?? ''), JSON.stringify(r.bar));
      if (reduced && r.transition) check('reduced motion: the bar does not animate', parseFloat(r.transition) <= 0.001, r.transition);
      if (w !== 1024 || name === 'active') await page.screenshot({ path: `${OUT}/subscription-${name}-${tag}.png`, fullPage: true });
    }, page);
    await ctx.close();
  }
}
{
  const { ctx, page, email } = await mk('aria');
  await step('screen-reader view of the subscription card: region, headings, status, buttons and bar read as intended', async () => {
    await subscribe(page, A, 'monthly');
    await openPlans(page);
    await page.getByRole('heading', { name: 'Your subscription', exact: true }).waitFor();
    const snap = await region(page, 'Your subscription').ariaSnapshot();
    check('region heading level 2', /heading "Your subscription" \[level=2\]/.test(snap), snap);
    check('named buttons', /button "Manage billing and invoices"/.test(snap) && /button "Cancel at period end"/.test(snap), snap);
    const allow = await region(page, 'AI allowance').ariaSnapshot();
    check('the bar is a progressbar with a name', /progressbar "AI requests used"/.test(allow), allow);
    check('a polite live region exists for outcomes', (await page.locator('main [role=status][aria-live=polite]').count()) >= 2);
    const data = await region(page, 'Your data and your account').ariaSnapshot();
    check('export and delete are real buttons', /button "Download my account data"/.test(data) && /button "Delete my account…"/.test(data), data);
    void email;
  }, page);
  await ctx.close();
}

// The scenarios below move the SERVER's clock on (a few days, then more than a month), so they run last.
// ───────────────────────────── payment problems, and what stays available ─────────────────────────────
{
  const { ctx, page, email } = await mk('problems');
  await subscribe(page, A, 'monthly');
  await step('past due: access continues for a stated grace and the screen offers the billing page to fix the card', async () => {
    await provider(A, email, 'past_due');
    await openPlans(page);
    await page.getByRole('heading', { name: 'Your last payment did not go through' }).waitFor();
    const a = await accountOf(page);
    const t = await text(page);
    check('the end of the grace is stated', t.includes(`Your access continues until ${dateText(a.entitlement.accessEndsAt)}`));
    check('the allowance is still shown during the grace', /AI requests left this month/.test(t));
    check('billing and a status check are offered', (await btn(page, 'Manage billing and invoices').count()) === 1 && (await btn(page, 'Check status').count()) === 1);
  }, page);
  await step('after the grace: paid features paused, and billing, export and deletion are all still reachable', async () => {
    await advance(A, 4);
    await page.reload();
    await page.getByRole('heading', { name: 'Your last payment did not go through' }).waitFor();
    const t = await text(page);
    check('says the grace has ended and what is paused', /grace period has ended/.test(t) && /AI suggestions and cloud backup are paused/.test(t));
    check('says what keeps working', /export, billing and account deletion all keep working/.test(t));
    check('AI allowance shows paused', /AI features are paused/.test(t) && (await page.getByRole('progressbar').count()) === 0);
    check('billing page, export, deletion are offered', (await btn(page, 'Manage billing and invoices').count()) === 1 && (await btn(page, 'Download my account data').count()) === 1 && (await btn(page, 'Delete my account…').count()) === 1);
    const dl = page.waitForEvent('download');
    await btn(page, 'Download my account data').click();
    const f = JSON.parse(readFileSync(await (await dl).path(), 'utf8'));
    check('the export downloads and lists the subscription', f.app === 'cleanflow-account' && f.subscriptions.length === 1);
    await page.getByText('Your account data was downloaded.').waitFor();
  }, page);
  await step('when the provider confirms the payment, access comes back: the page follows the server, not a timer', async () => {
    await provider(A, email, 'active');
    await sleep(2200);
    await btn(page, 'Check status').click();
    await page.getByRole('heading', { name: 'Monthly plan is active' }).waitFor();
    check('allowance is back', /AI requests left this month/.test(await text(page)));
  }, page);
  await step('unpaid: stated plainly, billing page offered', async () => {
    await provider(A, email, 'unpaid');
    await openPlans(page);
    await page.getByRole('heading', { name: 'Payments stopped, so your subscription is paused' }).waitFor();
    check('AI paused', /AI features are paused/.test(await text(page)));
    check('billing page to pay the open invoice', (await btn(page, 'Manage billing and invoices').count()) === 1);
    await provider(A, email, 'active');
  }, page);
  await step('an open dispute pauses access and the screen says the app cannot resolve it; winning restores it', async () => {
    await provider(A, email, 'dispute-open');
    await openPlans(page);
    await page.getByRole('heading', { name: 'Access is paused while a payment dispute is open' }).waitFor();
    check('says it cannot resolve a dispute', /cannot resolve a dispute/.test(await text(page)));
    await provider(A, email, 'dispute-won');
    await openPlans(page);
    await page.getByRole('heading', { name: 'Monthly plan is active' }).waitFor();
  }, page);
  await step('a full refund ends the subscription: ended, data kept, and a plan can be chosen again', async () => {
    await provider(A, email, 'refund');
    await openPlans(page);
    await page.getByRole('heading', { name: 'Your subscription has ended' }).waitFor();
    const t = await text(page);
    check('says it was refunded', /refunded/.test(t));
    check('plans are offered again, nothing preselected', (await page.getByRole('radio').count()) === 2 && (await page.getByRole('radio', { checked: true }).count()) === 0);
    check('the card says nothing is charged until paying on the payment page', /Nothing is charged until you pay on the secure payment page/.test(t));
    check('export and deletion', (await btn(page, 'Download my account data').count()) === 1 && (await btn(page, 'Delete my account…').count()) === 1);
  }, page);
  await ctx.close();
}

// ───────────────────────────── cancelled and expired ─────────────────────────────
{
  const { ctx, page, email } = await mk('expiry');
  await step('keyboard only: cancel at period end is reachable and operable without a mouse', async () => {
    await subscribe(page, A, 'monthly');
    await openPlans(page);
    await page.getByRole('heading', { name: 'Monthly plan is active' }).waitFor();
    await btn(page, 'Cancel at period end').focus();
    await page.keyboard.press('Enter');
    const g = page.getByRole('group', { name: 'Cancel at the end of this period?' });
    await g.waitFor();
    await page.keyboard.press('Tab');
    check('Tab goes to "Yes, cancel", the first control in the box', await page.evaluate(() => document.activeElement?.textContent === 'Yes, cancel at period end'));
    await page.keyboard.press('Tab');
    check('then "Keep my subscription"', await page.evaluate(() => document.activeElement?.textContent === 'Keep my subscription'));
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Enter');
    await page.getByRole('heading', { name: /^Your plan ends on/ }).waitFor();
    check('the status message is in a live region', (await page.locator('[role=status][aria-live=polite]').filter({ hasText: 'Cancellation scheduled' }).count()) === 1);
  }, page);
  await step('after the paid period ends: ended, AI paused, a new plan can be chosen, and export, billing and deletion still work', async () => {
    await advance(A, 40);
    await page.reload();
    await page.getByRole('heading', { name: 'Your subscription has ended' }).waitFor();
    const t = await text(page);
    check('says when it ended', /Your subscription ended on/.test(t));
    check('data is kept', /Your plan on this device/.test(t));
    check('AI is paused with a reason', /AI features are paused/.test(t) && /subscription has ended/.test(t));
    check('plans can be chosen again', (await page.getByRole('radio').count()) === 2);
    check('billing page (invoices) still offered', (await btn(page, 'Manage billing and invoices').count()) === 1);
    const dl = page.waitForEvent('download');
    await btn(page, 'Download my account data').click();
    const f = JSON.parse(readFileSync(await (await dl).path(), 'utf8'));
    check('export works after expiry and keeps the history', f.subscriptions.length === 1 && f.profile.email === email);
    check('the account itself is still signed in and reachable', (await accountOf(page)).entitlement.state === 'expired');
  }, page);
  await step('deleting the account after expiry works, and returns to sign-in', async () => {
    await btn(page, 'Delete my account…').click();
    await page.getByLabel('Your password, to confirm').fill(PW);
    await page.getByRole('button', { name: 'Delete my account', exact: true }).click();
    await page.getByRole('heading', { name: 'Sign in', exact: true }).waitFor();
    check('says the account was deleted', (await page.getByText('Your account was deleted.').count()) === 1);
  }, page);
  await ctx.close();
}
{
  // The clock has moved on by now, so this account is made fresh: deleting an account that still has a live subscription.
  const { ctx, page, email } = await mk('delete-live');
  await step('deleting an account with a live subscription says so first and stops it at the provider', async () => {
    await subscribe(page, A, 'annual');
    await openPlans(page);
    await page.getByRole('heading', { name: 'Annual plan is active' }).waitFor();
    await btn(page, 'Delete my account…').click();
    check('the warning names the consequence', /stops your subscription straight away/.test(await text(page)) && /not refunded/.test(await text(page)));
    await page.getByLabel('Your password, to confirm').fill(PW);
    await page.getByRole('button', { name: 'Delete my account', exact: true }).click();
    await page.getByRole('heading', { name: 'Sign in', exact: true }).waitFor();
    check('the provider\'s subscription is cancelled', (await state(A, email)).sub?.status === 'canceled');
  }, page);
  await ctx.close();
}

await browser.close();
await Promise.all(servers.map(stopServer));
done(errors);
process.exit(process.exitCode ?? 0);
