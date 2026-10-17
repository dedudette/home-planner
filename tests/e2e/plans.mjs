// Trial & plans in a real browser: starting the 14-day trial on purpose, the server's dates, pricing and the words before checkout, what
// happens when billing is unavailable, and coming back from the payment page. Servers (tests/e2e/accountsServer.ts, real API, real PostgreSQL,
// real Better Auth, a mailbox instead of an email provider):
//   A  accounts, billing NOT configured     (the "unavailable provider" case)
//   B  accounts, billing on a MOCK provider (tests/support/fakeStripe.ts: the real Stripe SDK talking to a local stand-in; this proves this
//      app's behaviour, NOT Stripe's. No live billing, no real money, no network call to Stripe.)
//   C  local mode, no accounts
//
//   npm run build && npm run e2e:plans        (needs the PostgreSQL server binaries; see scripts/test-db.sh)
import { spawn } from 'node:child_process';
import { launch, OUT, runner, watch } from './lib.mjs';

const P = Number(process.env.E2E_PORT ?? 18400);
const A = `http://127.0.0.1:${P}/`;
const B = `http://127.0.0.1:${P + 1}/`;
const C = `http://127.0.0.1:${P + 2}/`;
const { check, step, done } = runner('plans');
const errors = [];

const start = (port, mode, extra = {}) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, ['node_modules/vite-node/vite-node.mjs', 'tests/e2e/accountsServer.ts'], { env: { ...process.env, E2E_PORT: String(port), MODE: mode, ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
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
  servers.push(await start(P, 'accounts'));
  servers.push(await start(P + 1, 'accounts', { E2E_BILLING: 'fake' }));
  servers.push(await start(P + 2, 'local'));
  browser = await launch();
} catch (e) { console.log(`FAIL setup: ${e.message}`); await Promise.all(servers.map(stopServer)); process.exit(1); }

const PW = 'correct horse battery';
let ipn = 40;
const open = async (o = {}) => {
  const ctx = await browser.newContext({ viewport: { width: o.w ?? 390, height: o.h ?? 844 }, isMobile: (o.w ?? 390) < 600, hasTouch: (o.w ?? 390) < 600, colorScheme: o.dark ? 'dark' : 'light', extraHTTPHeaders: { 'x-forwarded-for': `10.8.${++ipn}.1` } });
  const page = await ctx.newPage();
  watch(page, errors, o.label ?? '');
  return { ctx, page };
};
const mail = async (base, to) => (await fetch(`${base}__test/mail?to=${encodeURIComponent(to.toLowerCase())}`)).json();
const waitMail = async (base, to) => { for (let i = 0; i < 40; i++) { const ms = (await mail(base, to)).filter((x) => /confirm your email/i.test(x.subject)); if (ms.length) return ms[ms.length - 1]; await new Promise((r) => setTimeout(r, 100)); } throw new Error(`no mail for ${to}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const welcomeVisible = (p) => p.getByRole('heading', { name: 'One calm plan for your home, your body and your day' }).waitFor();

/** A confirmed, signed-in account on `base`. */
const newAccount = async (page, base, email) => {
  await page.goto(base);
  await page.getByRole('button', { name: 'Create an account' }).click();
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PW);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await page.getByRole('heading', { name: 'Check your email' }).waitFor();
  const m = await waitMail(base, email);
  await page.goto(m.text.match(/https?:\/\/\S+/)[0]);
  await welcomeVisible(page);
};
const openPlans = async (page) => { await page.evaluate(() => { location.hash = '#/account'; }); await page.getByRole('heading', { name: 'Trial & plans', level: 1 }).waitFor(); await page.locator('main h2').first().waitFor(); };
const api = (page, path, init) => page.evaluate(async ([p, i]) => { const r = await fetch(p, i); return { status: r.status, json: await r.json().catch(() => null) }; }, [path, init]);
const trialBtn = (p) => p.getByRole('button', { name: /^Start my 14-day trial$/ });
const payBtn = (p) => p.getByRole('button', { name: /^Continue to pay|^Choose a plan$|^Opening/ });
const DAYMS = 86400000;

// ───────────────────────────── A: billing not configured ─────────────────────────────
{
  const { ctx, page } = await open({ label: 'trial' });
  await newAccount(page, A, 'tia.one@example.test');
  await step('opening Trial & plans never starts the trial; the server holds no trial yet', async () => {
    await openPlans(page);
    await page.getByRole('heading', { name: 'Free trial' }).waitFor();
    const a = await api(page, '/api/account');
    check('no trial recorded after the page loaded', a.json.account.trial === null && a.json.account.entitlement.state === 'eligible-not-started');
    check('the start button exists but is disabled until the box is ticked', await trialBtn(page).isDisabled());
    check('it says no card is needed and nothing is charged by itself', /No card is needed/.test(await page.locator('main').innerText()));
    check('a plain-words consent is shown next to the box', /I understand that the trial lasts 14 days, needs no card/.test(await page.locator('main').innerText()));
  }, page);
  let endsText = '';
  let window0 = null;
  await step('ticking the box and pressing the button starts exactly one 14-day trial, with the server\'s dates', async () => {
    await page.getByRole('checkbox').check();
    check('now enabled', await trialBtn(page).isEnabled());
    await trialBtn(page).click();
    await page.getByText('Your free trial is active.').waitFor();
    check('14 days left', /14 days left/.test(await page.locator('main').innerText()));
    const a = (await api(page, '/api/account')).json.account;
    check('the server recorded a 14-day window', Date.parse(a.trial.endsAt) - Date.parse(a.trial.startedAt) === 14 * DAYMS, `${a.trial.startedAt} ${a.trial.endsAt}`);
    check('entitlement is trial-active with full access', a.entitlement.state === 'trial-active' && a.entitlement.access === 'full');
    window0 = a.trial;
    endsText = await page.locator('p.small b').nth(1).innerText();
    check('the end date shown is a real date', /\d{4}/.test(endsText), endsText);
    check('the start button is gone', (await trialBtn(page).count()) === 0);
  }, page);
  await step('reload, another tab and a second request never restart it; a wrong device clock changes nothing', async () => {
    await page.reload();
    await page.getByRole('heading', { name: 'Trial & plans', level: 1 }).waitFor();
    await page.getByText('Your free trial is active.').waitFor();
    check('same end date after reload', (await page.locator('p.small b').nth(1).innerText()) === endsText);
    const again = await api(page, '/api/account/trial', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    check('a second start is refused by the server (409 already used)', again.status === 409 && again.json.error.code === 'already-used', JSON.stringify(again));
    const now = (await api(page, '/api/account')).json.account.trial;
    check('the trial window is exactly the one recorded at the start', now.startedAt === window0.startedAt && now.endsAt === window0.endsAt);
    await page.clock.install({ time: new Date(Date.now() + 40 * DAYMS) });             // the device says it is 40 days later
    await page.reload();
    await page.getByText('Your free trial is active.').waitFor();
    check('still active and still the server\'s days (device clock ignored)', /1[34] days left/.test(await page.locator('main').innerText()) && (await page.locator('p.small b').nth(1).innerText()) === endsText);
  }, page);
  await step('plans: amounts, annual copy and the full charge are shown before checkout; with no provider configured the button is disabled and says why', async () => {
    const txt = await page.locator('main').innerText();
    check('both prices', /€25\/month/.test(txt) && /€255\/year/.test(txt));
    check('annual equivalent and saving', /equivalent to €21\.25\/month · save €45\/year/.test(txt));
    check('nothing is pre-selected: choose a plan first', (await page.getByRole('radio', { checked: true }).count()) === 0 && (await payBtn(page).innerText()) === 'Choose a plan');
    await page.getByRole('radio', { name: /Annual/ }).check();
    const t2 = await page.locator('main').innerText();
    check('annual disclosure: once a year, not monthly, renews automatically', /€255 per year, charged once a year \(not monthly\) until you cancel\. Renews automatically\./.test(t2));
    check('the charge is stated before checkout', /charged €255 for the year, in one payment/.test(t2));
    check('unavailable provider explained, no codes', /not set up on this server yet/.test(t2) && !/STRIPE|not-configured/.test(t2));
    check('the pay button is disabled (no fake active button)', await payBtn(page).isDisabled());
    check('the free trial still works / is shown', /Your free trial is active/.test(t2));
    check('no test-mode banner when billing is not configured', (await page.getByText(/test mode/i).count()) === 0);
  }, page);
  await ctx.close();
}
{
  const { ctx, page } = await open({ label: 'expired-style' });
  await step('the signed-in bar on the welcome page links to Trial & plans, and Back returns', async () => {
    await newAccount(page, A, 'tia.two@example.test');
    check('link on the welcome page', (await page.getByRole('link', { name: 'Trial & plans' }).count()) === 1);
    await page.getByRole('link', { name: 'Trial & plans' }).click();
    await page.getByRole('heading', { name: 'Trial & plans', level: 1 }).waitFor();
    await page.locator('main h2').first().waitFor();
    check('a new account is offered the trial, not a charge', (await trialBtn(page).count()) === 1);
    await page.getByRole('link', { name: 'Back to the app' }).click();
    await welcomeVisible(page);
  }, page);
  await ctx.close();
}

// ───────────────────────────── B: a mock payment provider ─────────────────────────────
{
  const { ctx, page } = await open({ label: 'checkout' });
  await ctx.route('https://checkout.stripe.test/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Mock payment page</title><h1>Mock payment page</h1>' }));
  await newAccount(page, B, 'cho.one@example.test');
  let sid = '';
  await step('(mock provider) choosing a plan shows the exact terms, then goes to the provider\'s payment page; nothing is paid yet', async () => {
    await openPlans(page);
    check('test-mode notice', (await page.getByText(/test mode\. No real money is taken/i).count()) >= 1);
    await page.getByRole('radio', { name: /Monthly/ }).check();
    const t = await page.locator('main').innerText();
    check('monthly disclosure', /€25 per month, charged every month until you cancel\. Renews automatically\./.test(t) && /charged €25 for the first month/.test(t));
    check('the button is enabled and names the price', await page.getByRole('button', { name: 'Continue to pay €25/month' }).isEnabled());
    await page.getByRole('button', { name: 'Continue to pay €25/month' }).click();
    await page.waitForURL(/checkout\.stripe\.test\/c\/pay\/cs_/);
    sid = page.url().match(/\/(cs_[A-Za-z0-9_]+)/)[1];
    const a = (await (await ctx.request.get(`${B}api/account`)).json()).account;
    check('going to the payment page gave no access', a.entitlement.access === 'account-only' && a.subscription === null, JSON.stringify(a.entitlement));
  }, page);
  await step('(mock provider) cancelling at the payment page returns with a calm note and no change', async () => {
    await page.goto(`${B}?billing=cancelled`);
    await page.getByRole('heading', { name: 'Trial & plans', level: 1 }).waitFor();
    await page.getByText('Checkout was cancelled. You were not charged and nothing changed.').waitFor();
    check('the return parameters were removed from the address', !/billing=/.test(page.url()), page.url());
    check('plans are still offered', (await page.getByRole('radio').count()) === 2);
  }, page);
  await step('(mock provider) the success address alone proves nothing: unpaid, forged and invented ids give no subscription', async () => {
    await sleep(2300);
    await page.goto(`${B}?billing=success&session_id=${sid}`);
    await page.getByText(/has not confirmed a payment yet/).waitFor();
    check('still no subscription after "success" with an unpaid checkout', (await page.getByRole('heading', { name: 'Your subscription', exact: true }).count()) === 0 && (await page.getByRole('radio').count()) === 2);
    check('the server agrees', (await (await ctx.request.get(`${B}api/account`)).json()).account.subscription === null);
    await sleep(2300);
    await page.goto(`${B}?billing=success&session_id=cs_forgedforged123456`);
    await page.getByText(/could not check your payment/i).waitFor();
    check('a forged id is refused and nothing is assumed', (await page.getByRole('heading', { name: 'Your subscription', exact: true }).count()) === 0);
    await sleep(2300);
    await page.goto(`${B}?billing=success`);
    await page.getByText(/has not confirmed a payment yet/).waitFor();
    check('success with no id also assumes nothing', (await page.getByRole('heading', { name: 'Your subscription', exact: true }).count()) === 0);
  }, page);
  await step('(mock provider) once the provider confirms, the page shows the plan from the SERVER\'s answer', async () => {
    const done = await fetch(`${B}__test/complete?session=${sid}`);
    check('the mock provider marked the checkout paid', done.status === 200);
    await sleep(2300);
    await page.goto(`${B}?billing=success&session_id=${sid}`);
    await page.getByText('The payment provider confirmed your subscription. Thank you.').waitFor();
    await page.getByRole('heading', { name: 'Your subscription', exact: true }).waitFor();
    const t = await page.locator('main').innerText();
    check('plan and price shown', /Monthly/.test(t) && /€25\/month/.test(t));
    check('the plans selector is gone (no second subscription offered)', (await page.getByRole('radio').count()) === 0);
    check('the server says paid-active', (await (await ctx.request.get(`${B}api/account`)).json()).account.entitlement.state === 'paid-active');
    check('management is offered (issue #5): the billing page and cancel at period end', (await page.getByRole('button', { name: 'Manage billing and invoices' }).count()) === 1 && (await page.getByRole('button', { name: 'Cancel at period end' }).count()) === 1);
    await page.reload();
    await page.getByRole('heading', { name: 'Your subscription', exact: true }).waitFor();
  }, page);
  await ctx.close();
}

// ───────────────────────────── C: local mode, and a signed-out visitor ─────────────────────────────
{
  const { ctx, page } = await open({ label: 'local' });
  await step('local mode: Trial & plans says there are no accounts and offers nothing to start or buy', async () => {
    await page.goto(`${C}#/account`);
    await page.getByRole('heading', { name: 'Trial & plans', level: 1 }).waitFor();
    check('says no accounts', /no accounts/i.test(await page.locator('main').innerText()));
    check('no trial or pay buttons', (await trialBtn(page).count()) === 0 && (await payBtn(page).count()) === 0 && (await page.getByRole('checkbox').count()) === 0);
    await page.getByRole('link', { name: 'Back to the app' }).click();
    await welcomeVisible(page);
  }, page);
  await ctx.close();
}
{
  const { ctx, page } = await open({ label: 'signed-out' });
  await step('signed out: the address #/account shows the sign-in screen, not plans or a trial button', async () => {
    await page.goto(`${B}#/account`);
    await page.getByRole('heading', { name: 'Sign in', exact: true }).waitFor();
    check('no trial or plans', (await trialBtn(page).count()) === 0 && (await page.getByRole('radio').count()) === 0);
  }, page);
  await ctx.close();
}

// ───────────────────────────── layout, labels, keyboard ─────────────────────────────
for (const [w, h, dark, big] of [[320, 640, false, false], [390, 844, true, false], [1024, 768, false, false], [320, 640, false, true]]) {
  const tag = `${w}${dark ? '-dark' : ''}${big ? '-bigtext' : ''}`;
  const { ctx, page } = await open({ w, h, dark, label: `layout-${tag}` });
  await step(`Trial & plans @ ${tag}: no sideways scrolling, labels, one h1, big enough controls; radios work from the keyboard`, async () => {
    await newAccount(page, A, `lay${Date.now()}${w}${dark ? 'd' : ''}${big ? 'b' : ''}@example.test`);
    await openPlans(page);
    await page.getByRole('radio', { name: /Annual/ }).check();
    if (big) await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    await page.waitForTimeout(150);
    const r = await page.evaluate(() => {
      const vis = (el) => el.offsetParent !== null || getComputedStyle(el).position === 'fixed';
      const inputs = [...document.querySelectorAll('input')].filter(vis);
      const unlabeled = inputs.filter((i) => !(i.closest('label')) && !(i.id && document.querySelector(`label[for="${i.id}"]`)) && !i.getAttribute('aria-label')).map((i) => i.name || i.type);
      const small = [...document.querySelectorAll('button, a.btn')].filter(vis).filter((b) => b.getBoundingClientRect().height < 40).map((b) => (b.textContent || '').trim().slice(0, 30));
      const smallLabels = [...document.querySelectorAll('label.plan-opt, label.check-row')].filter(vis).filter((b) => b.getBoundingClientRect().height < 40).length;
      return { overflow: document.documentElement.scrollWidth - window.innerWidth, h1: document.querySelectorAll('h1').length, main: document.querySelectorAll('main').length, unlabeled, small, smallLabels, legend: document.querySelectorAll('fieldset legend').length };
    });
    check('no sideways scrolling', r.overflow <= 0, String(r.overflow));
    check('one h1 and one main', r.h1 === 1 && r.main === 1);
    check('every input has a label', r.unlabeled.length === 0, r.unlabeled.join(','));
    check('buttons and options are big enough', r.small.length === 0 && r.smallLabels === 0, r.small.join(' | '));
    check('the plan group has a legend', r.legend >= 1);
    await page.getByRole('radio', { name: /Annual/ }).focus();
    await page.keyboard.press('ArrowUp');
    check('arrow keys move between plans', await page.getByRole('radio', { name: /Monthly/ }).isChecked());
    await page.screenshot({ path: `${OUT}/plans-${tag}.png` });
  }, page);
  await ctx.close();
}

await browser.close();
await Promise.all(servers.map(stopServer));
done(errors);
process.exit(process.exitCode ?? 0);
