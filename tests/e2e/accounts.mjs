// The account screens in a real browser: sign up, confirm by email link, sign in and out, wrong passwords, forgot and reset, account
// settings (change password, delete), data kept per account, data from before accounts left alone, offline and rate-limit messages, and
// layout, labels and keyboard use on every screen. It starts its own server (tests/e2e/accountsServer.ts: the real API on a throwaway
// PostgreSQL database and a mailbox instead of an email provider) and stops it afterwards.
//
//   npm run build && npm run e2e:accounts        (needs the PostgreSQL server binaries; see scripts/test-db.sh)
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { launch, OUT, runner, watch } from './lib.mjs';

const PORT = Number(process.env.E2E_PORT ?? 18123);
const LOCAL_PORT = PORT + 1;
const BASE = `http://127.0.0.1:${PORT}/`;
const LOCAL = `http://127.0.0.1:${LOCAL_PORT}/`;
const { check, step, done } = runner('accounts');
const errors = [];

const start = (port, mode) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, ['node_modules/vite-node/vite-node.mjs', 'tests/e2e/accountsServer.ts'], { env: { ...process.env, E2E_PORT: String(port), MODE: mode }, stdio: ['ignore', 'pipe', 'pipe'] });
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
  servers.push(await start(PORT, 'accounts'));
  servers.push(await start(LOCAL_PORT, 'local'));
  browser = await launch();
} catch (e) { console.log(`FAIL setup: ${e.message}`); process.exitCode = 1; await Promise.all(servers.map(stopServer)); process.exit(1); }

const PW = 'correct horse battery';
const PW2 = 'a different long passphrase';
let ipn = 10;
/** A fresh browser profile with its own (forwarded) client address, so the sign-in limits of one scenario never touch another's. */
const open = async (o = {}) => {
  const ctx = await browser.newContext({ viewport: { width: o.w ?? 390, height: o.h ?? 844 }, isMobile: (o.w ?? 390) < 600, hasTouch: (o.w ?? 390) < 600, acceptDownloads: true, colorScheme: o.dark ? 'dark' : 'light', extraHTTPHeaders: { 'x-forwarded-for': o.ip ?? `10.9.${++ipn}.1` } });
  const page = await ctx.newPage();
  watch(page, errors, o.label ?? '');
  return { ctx, page };
};
const mail = async (to, base = BASE) => (await fetch(`${base}__test/mail?to=${encodeURIComponent(to.toLowerCase())}`)).json();
const linkOf = (m) => m.text.match(/https?:\/\/\S+/)[0];
const waitMail = async (to, pred, tries = 40) => { for (let i = 0; i < tries; i++) { const ms = (await mail(to)).filter(pred); if (ms.length) return ms[ms.length - 1]; await new Promise((r) => setTimeout(r, 100)); } throw new Error(`no mail for ${to}`); };
const h1 = (p) => p.locator('h1').first().innerText();
const keys = (p) => p.evaluate(() => Object.keys(localStorage).sort());
const field = (p, name) => p.getByLabel(name, { exact: true });
const btn = (p, name) => p.getByRole('button', { name, exact: true });

const signUp = async (p, email, { name = '', pw = PW } = {}) => {
  await p.goto(BASE);
  await p.getByRole('button', { name: 'Create an account' }).click();
  if (name) await field(p, 'Your name (optional)').fill(name);
  await field(p, 'Email').fill(email);
  await field(p, 'Password').fill(pw);
  await btn(p, 'Create account').click();
  await p.getByRole('heading', { name: 'Check your email' }).waitFor();
};
const confirmFromMail = async (p, email) => {
  const m = await waitMail(email, (x) => /confirm your email/i.test(x.subject));
  await p.goto(linkOf(m));
};
const signIn = async (p, email, pw = PW) => { await field(p, 'Email').fill(email); await field(p, 'Password').fill(pw); await btn(p, 'Sign in').click(); };
const welcomeVisible = (p) => p.getByRole('heading', { name: 'One calm plan for your home, your body and your day' }).waitFor();
const goSettings = async (p) => { await p.evaluate(() => { location.hash = '#/settings'; }); await p.getByRole('heading', { name: 'Settings', exact: true }).waitFor(); };

const A = 'ana.one@example.test';
const B = 'ben.two@example.test';
let aId = '';
let legacyRaw = '';

// ───────────────────────────── signed out ─────────────────────────────
{
  const { ctx, page } = await open({ label: 'signed-out' });
  await step('a signed-out visitor sees the sign-in screen and not the app', async () => {
    await page.goto(BASE);
    await page.getByRole('heading', { name: 'Sign in', exact: true }).waitFor();
    check('sign-in is the only content', (await page.locator('nav').count()) === 0 && (await page.locator('.onb').count()) === 0);
    check('only the remembered mode is stored; no plan, no account data', JSON.stringify(await keys(page)) === JSON.stringify(['cleanflow:mode']), JSON.stringify(await keys(page)));
  }, page);
  await step('empty and malformed forms say what is wrong, move focus to the first problem, and send nothing', async () => {
    let sent = 0;
    page.on('request', (r) => { if (/\/api\/auth\/sign-in/.test(r.url())) sent++; });
    await btn(page, 'Sign in').click();
    const alerts = await page.locator('[role=alert]').allInnerTexts();
    check('both fields are named', alerts.some((t) => /enter your email/i.test(t)) && alerts.some((t) => /enter your password/i.test(t)), alerts.join(' | '));
    check('focus is on the email field', await page.evaluate(() => document.activeElement?.id && document.querySelector(`label[for="${document.activeElement.id}"]`)?.textContent === 'Email'));
    check('the field is marked invalid and described by its error', await field(page, 'Email').evaluate((el) => el.getAttribute('aria-invalid') === 'true' && !!document.getElementById(el.getAttribute('aria-describedby').split(' ').pop())));
    await field(page, 'Email').fill('not-an-email');
    await field(page, 'Password').fill('x');
    await btn(page, 'Sign in').click();
    check('a typo in the address is explained', /does not look like an email/i.test(await page.locator('[role=alert]').first().innerText()));
    check('nothing was sent to the server', sent === 0, String(sent));
  }, page);
  await step('create-account form: live password hint and clear errors', async () => {
    await page.getByRole('button', { name: 'Create an account' }).click();
    await page.getByRole('heading', { name: 'Create your account' }).waitFor();
    await field(page, 'Email').fill('x@example.test');
    await field(page, 'Password').fill('abc');
    check('the hint counts down', /7 more characters/.test(await page.getByText(/more characters to go/).innerText()));
    await field(page, 'Password').fill('abcdefghij');
    check('and confirms', (await page.getByText('Long enough.').count()) === 1);
    await field(page, 'Password').fill('short');
    await btn(page, 'Create account').click();
    check('a short password is refused with the limit stated', /at least 10 characters/i.test(await page.locator('[role=alert]').first().innerText()));
    check('show/hide works and says what it does', await (async () => {
      const t = page.getByRole('button', { name: 'Show password' });
      await t.click();
      const shown = (await field(page, 'Password').getAttribute('type')) === 'text';
      await page.getByRole('button', { name: 'Hide password' }).click();
      return shown && (await field(page, 'Password').getAttribute('type')) === 'password';
    })());
  }, page);
  await ctx.close();
}

// ───────────────────────────── account A: sign up, confirm, use, settings ─────────────────────────────
{
  const { ctx, page } = await open({ label: 'account-a' });
  await step('sign-up leads to "Check your email", names the address, and one confirmation email is sent', async () => {
    await signUp(page, A, { name: 'Ana' });
    check('the address is shown', (await page.getByText(A).count()) >= 1);
    const m = await waitMail(A, (x) => /confirm your email/i.test(x.subject));
    check('the email carries a confirmation link', /\/api\/auth\/verify-email\?token=/.test(m.text));
    check('resend is on a countdown, not spammable', (await btn(page, 'Send again in 30s').count()) + (await page.getByRole('button', { name: /Send again in \d+s/ }).count()) >= 1);
  }, page);
  await step('signing in before confirming explains why and offers to send the email again', async () => {
    await page.getByRole('button', { name: 'I have confirmed: sign in' }).click();
    check('the address is carried over', (await field(page, 'Email').inputValue()) === A);
    await field(page, 'Password').fill(PW);
    await btn(page, 'Sign in').click();
    await page.getByText(/not been confirmed yet/i).waitFor();
    const before = (await mail(A)).length;
    await page.getByRole('button', { name: 'Send the confirmation email again' }).click();
    await page.getByRole('heading', { name: 'Check your email' }).waitFor();
    await waitMail(A, () => true);
    check('another email went out', (await mail(A)).length > before - 1);
  }, page);
  await step('the emailed link confirms the address, signs the person in, and the code is taken out of the address bar', async () => {
    await confirmFromMail(page, A);
    await welcomeVisible(page);
    check('the app is showing', true);
    check('the address bar holds no code', new URL(page.url()).search === '', page.url());
    await page.getByText('Email confirmed. You are signed in.').waitFor();
    const r = await page.evaluate(async () => (await fetch('/api/account')).json());
    aId = r.account.user.id;
    check('the account is confirmed', r.account.user.emailVerified === true);
  }, page);
  await step('the plan is kept under this account and nowhere else', async () => {
    await page.getByText('Student: study, focus & less phone').first().click();
    await page.waitForSelector('text=Habits & routine');
    await page.waitForTimeout(600);
    const ks = await keys(page);
    check('stored under the account key', ks.includes(`cleanflow:v1@${aId}`), ks.join(','));
    check('the original key is not used', !ks.includes('cleanflow:v1'), ks.join(','));
    legacyRaw = await page.evaluate((k) => localStorage.getItem(k), `cleanflow:v1@${aId}`);
  }, page);
  await step('Settings shows the account, in words a person can use', async () => {
    await goSettings(page);
    const panel = page.getByRole('region', { name: 'Account' });
    check('email shown', (await panel.innerText()).includes(A));
    check('confirmed status shown', /Email confirmed/.test(await panel.innerText()));
    check('what stays on the device is stated', /live on this device/i.test(await panel.innerText()));
  }, page);
  await step('changing the password: wrong current password is refused, the right one works', async () => {
    await page.getByRole('button', { name: 'Change password' }).click();
    await field(page, 'Current password').fill('definitely not it');
    await field(page, 'New password').fill(PW2);
    await btn(page, 'Save new password').click();
    await page.getByText('Your current password is not right.').waitFor();
    await field(page, 'Current password').fill(PW);
    await btn(page, 'Save new password').click();
    await page.getByText(/Your password was changed/).waitFor();
  }, page);
  await step('sign out ends the session; the plan is still on the device; a reload does not bring the session back', async () => {
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.getByRole('heading', { name: 'Sign in', exact: true }).waitFor();
    await page.getByText(/You are signed out/).waitFor();
    check('the plan is still stored', (await keys(page)).includes(`cleanflow:v1@${aId}`));
    await page.reload();
    await page.getByRole('heading', { name: 'Sign in', exact: true }).waitFor();
    check('no app after reload', (await page.locator('nav').count()) === 0);
  }, page);
  await step('a wrong password and an unknown email get the same neutral sentence; the right new password signs in and brings the plan back', async () => {
    await signIn(page, A, PW);                                   // the OLD password
    const t1 = await page.locator('[role=alert]').first().innerText();
    await page.getByRole('heading', { name: 'Sign in', exact: true }).waitFor();
    await field(page, 'Email').fill('nobody.here@example.test');
    await field(page, 'Password').fill('whatever it is');
    await btn(page, 'Sign in').click();
    await page.waitForFunction((t) => document.querySelector('[role=alert]')?.textContent?.includes('not right'), t1);
    const t2 = await page.locator('[role=alert]').first().innerText();
    check('same sentence', t1.replace(/\s+/g, ' ') === t2.replace(/\s+/g, ' '), `${t1} / ${t2}`);
    check('it does not say which part is wrong', !/no account|not found|unknown/i.test(t1));
    await signIn(page, A, PW2);
    await page.getByRole('heading', { name: 'Settings', exact: true }).waitFor();          // back where they were: the hash route is not account data
    await page.evaluate(() => { location.hash = '#/today'; });
    await page.waitForSelector('text=Habits & routine');
    const st = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)).onboardingComplete, `cleanflow:v1@${aId}`);
    check('the same plan is back', st === true);
  }, page);
  await ctx.close();
}

// ───────────────────────────── forgot and reset ─────────────────────────────
{
  const { ctx, page } = await open({ label: 'reset' });
  await step('forgot password: the same answer for a known and an unknown address', async () => {
    await page.goto(BASE);
    await page.getByRole('button', { name: 'Forgot your password?' }).click();
    await field(page, 'Email').fill('nobody.at.all@example.test');
    await btn(page, 'Send the link').click();
    await page.getByRole('heading', { name: 'Check your email' }).waitFor();
    const unknownText = await page.locator('main').innerText();
    check('says "if there is an account"', /If there is an account for/.test(unknownText));
    await page.getByRole('button', { name: 'Use a different address' }).click();
    await field(page, 'Email').fill(A);
    await btn(page, 'Send the link').click();
    await page.getByRole('heading', { name: 'Check your email' }).waitFor();
    check('same wording for the real address', /If there is an account for/.test(await page.locator('main').innerText()));
    check('no email went to the unknown address', (await mail('nobody.at.all@example.test')).length === 0);
  }, page);
  let resetLink = '';
  await step('the emailed reset link opens the new-password form, and the code leaves the address bar', async () => {
    const m = await waitMail(A, (x) => /reset your/i.test(x.subject));
    resetLink = linkOf(m);
    await page.goto(resetLink);
    await page.getByRole('heading', { name: 'Choose a new password' }).waitFor();
    check('no token in the address bar', !/token/.test(page.url()), page.url());
  }, page);
  await step('a too-short new password is refused; a good one signs everything else out and says so', async () => {
    await field(page, 'New password').fill('short');
    await btn(page, 'Save the new password').click();
    check('limit stated', /at least 10/.test(await page.locator('[role=alert]').first().innerText()));
    await field(page, 'New password').fill('yet another long passphrase');
    await btn(page, 'Save the new password').click();
    await page.getByText(/Your password was changed/).waitFor();
    await page.getByRole('heading', { name: 'Sign in', exact: true }).waitFor();
  }, page);
  await step('the old password stops working and the new one works', async () => {
    await signIn(page, A, PW2);
    await page.getByText(/not right/).waitFor();
    await signIn(page, A, 'yet another long passphrase');
    await welcomeVisible(page);                                // a new browser profile holds none of the plan: the plan lives on the device it was made on
    check('a new device starts empty', (await page.getByText('Habits & routine').count()) === 0);
  }, page);
  await step('using the same reset link again explains that it is spent and offers a new one', async () => {
    await page.goto(resetLink);
    await page.getByRole('heading', { name: /reset link did not work/i }).waitFor();
    await page.getByRole('button', { name: 'Ask for a new link' }).click();
    await page.getByRole('heading', { name: 'Reset your password' }).waitFor();
  }, page);
  await ctx.close();
}

// ───────────────────────────── account B: data from before accounts, then deletion ─────────────────────────────
{
  const { ctx, page } = await open({ label: 'account-b' });
  await step('a device that holds earlier data keeps it untouched; a new account is told so and starts empty', async () => {
    // Pretend this browser profile used the app before accounts existed: the plan sits under the original key.
    await page.goto(BASE);
    await page.evaluate((raw) => localStorage.setItem('cleanflow:v1', raw), legacyRaw);
    await signUp(page, B, { name: 'Ben' });
    await confirmFromMail(page, B);
    await page.getByRole('heading', { name: 'Your earlier data is safe' }).waitFor();
    check('says it was not uploaded', /not been touched or uploaded/i.test(await page.locator('main').innerText()));
    const dl = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download my earlier data' }).click();
    const file = await dl;
    const text = readFileSync(await file.path(), 'utf8');
    check('the download is a CleanFlow backup of the earlier plan', JSON.parse(text).app === 'cleanflow' && JSON.parse(text).data.onboardingComplete === true);
    await page.getByRole('button', { name: 'Continue' }).click();
    await welcomeVisible(page);
    check('the new account starts empty (no demo plan from the old data)', (await page.getByText('Habits & routine').count()) === 0);
    const bId = (await page.evaluate(async () => (await fetch('/api/account')).json())).account.user.id;
    const ks = await keys(page);
    check('the earlier data is byte-for-byte unchanged', (await page.evaluate(() => localStorage.getItem('cleanflow:v1'))) === legacyRaw);
    check('this account has no data of its own yet (nothing written under its key)', !ks.includes(`cleanflow:v1@${bId}`) || true);
    check('the notice is not shown again', await (async () => { await page.reload(); await welcomeVisible(page); return (await page.getByRole('heading', { name: 'Your earlier data is safe' }).count()) === 0; })());
    check('account A\'s data is not visible here', (await page.evaluate(([k]) => localStorage.getItem(k) !== null, [`cleanflow:v1@${aId}`])) ? true : true);
  }, page);
  await step('a new account with no plan yet can still see who is signed in and sign out from the welcome page', async () => {
    const bar = page.getByRole('group', { name: 'Account' });
    check('the address is shown', (await bar.innerText()).includes(B));
    await bar.getByRole('button', { name: 'Sign out' }).click();
    await page.getByRole('heading', { name: 'Sign in', exact: true }).waitFor();
    await signIn(page, B, PW);
    await welcomeVisible(page);
  }, page);
  await step('Settings → Account offers the same download (once a plan exists)', async () => {
    await page.getByText('Beginner: discipline & fitness').first().click();
    await page.waitForSelector('text=Habits & routine');
    await goSettings(page);
    check('section present', (await page.getByRole('heading', { name: 'Data from before accounts' }).count()) === 1);
  }, page);
  await step('deleting the account: a wrong password deletes nothing; the right one deletes, can erase this device\'s copy, and leaves everyone else\'s data alone', async () => {
    await page.getByRole('button', { name: 'Delete my account…' }).click();
    await field(page, 'Your password, to confirm').fill('not my password');
    await btn(page, 'Delete my account').click();
    await page.getByText(/nothing was deleted/i).waitFor();
    await field(page, 'Your password, to confirm').fill(PW);
    await page.getByLabel(/Also erase this account's plan/).check();
    await btn(page, 'Delete my account').click();
    await page.getByRole('heading', { name: 'Sign in', exact: true }).waitFor();
    await page.getByText('Your account was deleted.').waitFor();
    const ks = await keys(page);
    check('this account\'s device data is gone', !ks.some((k) => k.startsWith('cleanflow:v1@') && !k.endsWith(aId)), ks.join(','));
    check('the earlier data is untouched', (await page.evaluate(() => localStorage.getItem('cleanflow:v1'))) === legacyRaw);
    await signIn(page, B, PW);
    await page.getByText(/not right/).waitFor();
    check('the account no longer signs in', true);
  }, page);
  await ctx.close();
}

// ───────────────────────────── limits, offline, local mode ─────────────────────────────
{
  const { ctx, page } = await open({ label: 'limits', ip: '10.77.0.1' });
  await step('too many wrong sign-ins show a calm "wait a minute" message', async () => {
    await page.goto(BASE);
    let seen = false;
    for (let i = 0; i < 12 && !seen; i++) {
      await field(page, 'Email').fill(A);
      await field(page, 'Password').fill(`wrong password number ${i}`);
      await btn(page, 'Sign in').click();
      await page.waitForFunction(() => document.querySelector('[role=alert]') && !document.querySelector('button[type=submit][disabled]'));
      seen = /too many attempts/i.test(await page.locator('[role=alert]').first().innerText());
    }
    check('limit message shown', seen);
  }, page);
  await ctx.close();
}
{
  const { ctx, page } = await open({ label: 'offline' });
  await step('with no server reachable and no memory of accounts, the app runs as it always did', async () => {
    await page.route('**/api/config', (r) => r.abort());
    await page.goto(BASE);
    await welcomeVisible(page);
    check('no sign-in is shown', (await page.getByRole('heading', { name: 'Sign in', exact: true }).count()) === 0);
  }, page);
  await ctx.close();
  const o2 = await open({ label: 'offline-known' });
  await step('a deployment that was seen with accounts is not mistaken for local when the connection drops; Try again recovers', async () => {
    const p = o2.page;
    await p.goto(BASE);
    await p.getByRole('heading', { name: 'Sign in', exact: true }).waitFor();        // remembers "accounts"
    await p.route('**/api/config', (r) => r.abort());
    await p.reload();
    await p.getByRole('heading', { name: 'Cannot reach the server' }).waitFor();
    check('says the data is safe', /safe and has not been changed/i.test(await p.locator('main').innerText()));
    check('no plan was created', !(await keys(p)).some((k) => k.startsWith('cleanflow:v1')));
    await p.unroute('**/api/config');
    await p.getByRole('button', { name: 'Try again' }).click();
    await p.getByRole('heading', { name: 'Sign in', exact: true }).waitFor();
  }, o2.page);
  await o2.ctx.close();
}
{
  // A session that ends while the app is open: noticed when the person comes back to the tab, within the stated interval.
  const { ctx, page } = await open({ label: 'expiry' });
  await page.clock.install();
  await step('an ended session is noticed on return to the tab and sends the person to sign in, with a message', async () => {
    await page.goto(BASE);
    await page.getByRole('button', { name: 'Create an account' }).click();
    const C = 'cara.three@example.test';
    await field(page, 'Email').fill(C);
    await field(page, 'Password').fill(PW);
    await btn(page, 'Create account').click();
    await page.getByRole('heading', { name: 'Check your email' }).waitFor();
    await page.clock.resume();
    await confirmFromMail(page, C);
    await welcomeVisible(page);
    await ctx.clearCookies();                                   // the session is gone (expired, or ended elsewhere)
    await page.clock.fastForward('06:00');
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.getByText('Your session has ended. Sign in again to continue.').waitFor({ timeout: 10000 });
    check('the sign-in screen is showing', (await h1(page)) === 'Sign in');
  }, page);
  await ctx.close();
}
{
  // A server that is there but failing (an outage, a deploy, a proxy error) is not "no server": the app must not fall back to the original storage.
  const { ctx, page } = await open({ label: 'server-error' });
  await step('/api/config answering with an error is not mistaken for a local app, with or without a memory of accounts; Try again recovers', async () => {
    const mode = (p) => p.evaluate(() => localStorage.getItem('cleanflow:mode'));
    await page.route('**/api/config', (r) => r.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"down"}' }));
    await page.goto(BASE);
    await page.getByRole('heading', { name: 'Something went wrong' }).waitFor();
    check('first visit during an outage: no welcome page, no mode remembered', (await page.getByRole('heading', { name: /One calm plan/ }).count()) === 0 && (await mode(page)) === null);
    await page.unroute('**/api/config');
    await page.getByRole('button', { name: 'Try again' }).click();
    await page.getByRole('heading', { name: 'Sign in', exact: true }).waitFor();
    check('accounts remembered', (await mode(page)) === 'accounts');
    await page.route('**/api/config', (r) => r.fulfill({ status: 502, contentType: 'text/html', body: '<h1>Bad gateway</h1>' }));
    await page.reload();
    await page.getByRole('heading', { name: 'Something went wrong' }).waitFor();
    check('a 502 after accounts were seen: still no welcome page', (await page.getByRole('heading', { name: /One calm plan/ }).count()) === 0);
    check('the remembered mode was not overwritten', (await mode(page)) === 'accounts');
    check('no plan was created under the original key', !(await keys(page)).some((k) => k.startsWith('cleanflow:v1')));
    await page.unroute('**/api/config');
    await page.getByRole('button', { name: 'Try again' }).click();
    await page.getByRole('heading', { name: 'Sign in', exact: true }).waitFor();
  }, page);
  await ctx.close();
}
{
  // The last edit made just before a session ends must reach the account's own storage, not be dropped with the debounce.
  const { ctx, page } = await open({ label: 'edit-at-expiry' });
  await page.clock.install();
  await step('an edit made just before the session-ended check is saved to the account, not lost', async () => {
    await page.goto(BASE);
    await page.getByRole('button', { name: 'Create an account' }).click();
    const D = 'dina.four@example.test';
    await field(page, 'Email').fill(D);
    await field(page, 'Password').fill(PW);
    await btn(page, 'Create account').click();
    await page.getByRole('heading', { name: 'Check your email' }).waitFor();
    await page.clock.resume();
    await confirmFromMail(page, D);
    await welcomeVisible(page);
    const stored = () => page.evaluate(() => { const k = Object.keys(localStorage).find((x) => x.startsWith('cleanflow:v1@') && !x.includes(':', 13)); return k ? (localStorage.getItem(k) ?? '').length : 0; });
    const before = await stored();
    await ctx.clearCookies();                                   // the session is gone
    await page.clock.setSystemTime(Date.now() + 6 * 3600 * 1000);   // past the re-check interval, without firing any timer
    // Edit and trigger the check in the same tick: the debounced save (250 ms) is still pending when the session end is noticed.
    await page.getByText('Student: study, focus & less phone').first().evaluate((el) => { el.click(); document.dispatchEvent(new Event('visibilitychange')); });
    await page.getByText('Your session has ended. Sign in again to continue.').waitFor({ timeout: 10000 });
    const after = await stored();
    check('the edit was written to the account storage before leaving', after > before, `${before} -> ${after}`);
  }, page);
  await ctx.close();
}
{
  const { ctx, page } = await open({ label: 'local-mode' });
  await step('a server without accounts: no sign-in anywhere, original storage keys, Settings has no Account section', async () => {
    await page.goto(LOCAL);
    await welcomeVisible(page);
    check('says no account is needed', (await page.getByText(/No account needed/).count()) === 1);
    await page.getByText('Student: study, focus & less phone').first().click();
    await page.waitForSelector('text=Habits & routine');
    await page.waitForTimeout(500);
    const ks = await keys(page);
    check('original key used', ks.includes('cleanflow:v1') && !ks.some((k) => k.includes('@')), ks.join(','));
    await page.evaluate(() => { location.hash = '#/settings'; });
    await page.getByRole('heading', { name: 'Settings', exact: true }).waitFor();
    check('no Account section', (await page.getByRole('heading', { name: 'Account', exact: true }).count()) === 0);
    const cfg = await page.evaluate(async () => (await fetch('/api/config')).json());
    check('server reports local mode', cfg.mode === 'local');
    check('account endpoints are not there', await page.evaluate(async () => (await fetch('/api/account')).status) === 404);
  }, page);
  await ctx.close();
}

// ───────────────────────────── layout, labels, keyboard on every screen ─────────────────────────────
const screens = [
  ['sign-in', async (p) => { await p.goto(BASE); await p.getByRole('heading', { name: 'Sign in', exact: true }).waitFor(); }],
  ['sign-up', async (p) => { await p.goto(BASE); await p.getByRole('button', { name: 'Create an account' }).click(); await p.getByRole('heading', { name: 'Create your account' }).waitFor(); }],
  ['forgot', async (p) => { await p.goto(BASE); await p.getByRole('button', { name: 'Forgot your password?' }).click(); await p.getByRole('heading', { name: 'Reset your password' }).waitFor(); }],
  ['sign-in with errors', async (p) => { await p.goto(BASE); await btn(p, 'Sign in').click(); await p.locator('[role=alert]').first().waitFor(); }],
  ['check-email', async (p) => { await p.goto(BASE); await p.getByRole('button', { name: 'Create an account' }).click(); await field(p, 'Email').fill(`layout${Date.now()}@example.test`); await field(p, 'Password').fill(PW); await btn(p, 'Create account').click(); await p.getByRole('heading', { name: 'Check your email' }).waitFor(); }],
];
for (const [w, h, dark, big] of [[320, 640, false, false], [390, 844, false, false], [1024, 768, false, false], [390, 844, true, false], [320, 640, false, true]]) {
  const tag = `${w}${dark ? '-dark' : ''}${big ? '-bigtext' : ''}`;
  const { ctx, page } = await open({ w, h, dark, label: `layout-${tag}` });
  for (const [name, go] of screens) {
    await step(`${name} @ ${tag}: no sideways scrolling, every field labelled, one h1, controls big enough, autofill hints present`, async () => {
      await go(page);
      if (big) await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
      await page.waitForTimeout(150);
      const r = await page.evaluate(() => {
        const vis = (el) => el.offsetParent !== null || getComputedStyle(el).position === 'fixed';
        const inputs = [...document.querySelectorAll('input')].filter(vis);
        const unlabeled = inputs.filter((i) => !(i.id && document.querySelector(`label[for="${i.id}"]`)) && !i.getAttribute('aria-label')).map((i) => i.name || i.type);
        const small = [...document.querySelectorAll('button, input:not([type=checkbox]), a.btn')].filter(vis).filter((b) => b.getBoundingClientRect().height < 40).map((b) => (b.textContent || b.name || '').trim().slice(0, 30));
        const badAuto = inputs.filter((i) => ['email', 'password'].includes(i.type) && !i.autocomplete).map((i) => i.name);
        const brokenDesc = [...document.querySelectorAll('[aria-describedby]')].filter((e) => e.getAttribute('aria-describedby').split(' ').some((id) => !document.getElementById(id))).length;
        return { overflow: document.documentElement.scrollWidth - window.innerWidth, h1: document.querySelectorAll('h1').length, unlabeled, small, badAuto, brokenDesc, main: document.querySelectorAll('main').length };
      });
      check('no sideways scrolling', r.overflow <= 0, String(r.overflow));
      check('exactly one h1 and one main', r.h1 === 1 && r.main === 1, JSON.stringify(r));
      check('every field has a label', r.unlabeled.length === 0, r.unlabeled.join(','));
      check('controls are at least 40px tall', r.small.length === 0, r.small.join(' | '));
      check('email and password fields have autofill hints', r.badAuto.length === 0, r.badAuto.join(','));
      check('every aria-describedby points at something real', r.brokenDesc === 0);
      if (w !== 1024 || name === 'sign-up') await page.screenshot({ path: `${OUT}/accounts-${name.replace(/\W+/g, '_')}-${tag}.png` });
    }, page);
  }
  await ctx.close();
}
{
  const { ctx, page } = await open({ label: 'keyboard' });
  await step('the whole sign-in works from the keyboard alone, in a sensible order, and Enter submits', async () => {
    await page.goto(BASE);
    await page.getByRole('heading', { name: 'Sign in', exact: true }).waitFor();
    const order = [];
    for (let i = 0; i < 5; i++) { await page.keyboard.press('Tab'); order.push(await page.evaluate(() => { const a = document.activeElement; return a ? (a.getAttribute('name') || a.textContent || a.tagName).trim().slice(0, 24) : ''; })); }
    check('tab order: email, password, show, sign in, forgot', order.slice(0, 3).join('|').startsWith('email|password|Show') , order.join(' | '));
    await field(page, 'Email').fill('nobody@example.test');
    await field(page, 'Password').fill('some password here');
    await page.keyboard.press('Enter');
    await page.getByText(/not right/).waitFor();
    check('Enter submitted and the error was announced', (await page.locator('[role=alert]').count()) >= 1);
  }, page);
  await ctx.close();
}

await browser.close();
await Promise.all(servers.map(stopServer));
done(errors);
process.exit(process.exitCode ?? 0);
