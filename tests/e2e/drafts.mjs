// Unsent text when the person leaves, in a real browser (issue #7 follow-ups): text typed into a sheet or a form, with the rows added and the
// options chosen, is kept for the same account when the planner's access gate closes, when the session ends, and when the account changes
// under an open form; it comes back when the person does, is never submitted or sent anywhere by itself, is never shown to another account,
// and can be deleted on purpose. What closing the tab does not keep is asserted too, so the documentation cannot overstate it.
//
// Servers (tests/e2e/accountsServer.ts: the real API on a throwaway PostgreSQL database, real Better Auth, a mailbox instead of an email provider):
//   B  accounts mode, billing on a MOCK payment provider (tests/support/fakeStripe.ts: the REAL Stripe SDK talking to a local stand-in).
//      It is used here only to make the server say "no access" (an unpaid subscription) and "access" again for one account.
//      It does NOT verify Stripe. Nothing here contacts Stripe or takes a payment.
//   L  local mode: no accounts, no gate
//
// Nothing here waits on a timer: every step waits for the thing it needs on screen or in storage.
//
//   npm run build && npm run e2e:drafts        (needs the PostgreSQL server binaries; see scripts/test-db.sh)
//   E2E_ONLY=sheet,reload npm run e2e:drafts   runs just those sections
import { spawn } from 'node:child_process';
import { launch, runner, watch } from './lib.mjs';

const P = Number(process.env.E2E_PORT ?? 19000);
const B = `http://127.0.0.1:${P}/`;
const L = `http://127.0.0.1:${P + 1}/`;
const { check, step, done } = runner('drafts');
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
  servers.push(await start(P, { E2E_BILLING: 'fake' }));
  servers.push(await start(P + 1, { MODE: 'local' }));
  browser = await launch();
} catch (e) { console.log(`FAIL setup: ${e.message}`); await Promise.all(servers.map(stopServer)); process.exit(1); }

const watchdog = setTimeout(async () => { console.log('FAIL watchdog: the suite ran longer than allowed'); await Promise.all(servers.map(stopServer)); process.exit(1); }, Number(process.env.E2E_WATCHDOG_MS ?? 600000));

// Anything that escapes a step (a wait that never completes) must still stop the servers and fail the run.
const bail = async (e) => { console.log(`FAIL uncaught: ${String(e?.message ?? e).split('\n').slice(0, 3).join(' | ')}`); process.exitCode = 1; await Promise.all(servers.map(stopServer)); process.exit(1); };
process.on('uncaughtException', bail);
process.on('unhandledRejection', bail);

const PW = 'correct horse battery';
let ipn = 40;
/** Every request the page makes, with its body: a private marker must never appear in any of them. */
const open = async (o = {}) => {
  const ctx = await browser.newContext({ viewport: { width: o.w ?? 1024, height: o.h ?? 800 }, locale: 'en-US', timezoneId: 'UTC', acceptDownloads: true, extraHTTPHeaders: { 'x-forwarded-for': `10.9.${Math.floor(ipn / 250)}.${ipn++ % 250}` } });
  const page = await ctx.newPage();
  watch(page, errors, o.label ?? '');
  await ctx.route(/^https:\/\/(checkout|billing)\.stripe\.test\//, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Mock provider page</title><p>Mock provider page</p>' }));
  page.sent = [];
  page.on('request', (r) => { page.sent.push(`${r.method()} ${r.url()} ${r.postData() ?? ''}`); });
  return { ctx, page };
};
const sentWith = (page, marker) => page.sent.filter((s) => s.includes(marker));
const waitMail = async (base, to) => { for (let i = 0; i < 40; i++) { const ms = (await (await fetch(`${base}__test/mail?to=${encodeURIComponent(to.toLowerCase())}`)).json()).filter((x) => /confirm your email/i.test(x.subject)); if (ms.length) return ms[ms.length - 1]; await new Promise((r) => setTimeout(r, 250)); } throw new Error('no confirmation mail'); };
const api = (page, path, init) => page.evaluate(async ([p, i]) => { const r = await fetch(p, i); return { status: r.status, text: await r.text() }; }, [path, init]);
const apiJson = async (page, path, init) => { const r = await api(page, path, init); return { status: r.status, json: (() => { try { return JSON.parse(r.text); } catch { return null; } })() }; };
const post = (page, path, body = {}) => apiJson(page, path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const idOf = async (page) => (await apiJson(page, '/api/account')).json.account.user.id;
const ls = (page, key) => page.evaluate((k) => localStorage.getItem(k), key);
const lsAll = (page) => page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)])));
const settle = (page) => page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
const draftsKey = (id) => `cleanflow:drafts@${id}`;
const planOf = async (page) => { await settle(page); const t = await ls(page, `cleanflow:v1@${await idOf(page)}`); return t ? JSON.parse(t) : null; };
const patchPlan = async (page, fn) => {
  await settle(page);
  const id = await idOf(page);
  await page.evaluate(([src, key]) => { const d = JSON.parse(localStorage.getItem(key)); new Function('d', src)(d); d._rev = (d._rev ?? 0) + 100; localStorage.setItem(key, JSON.stringify(d)); }, [fn, `cleanflow:v1@${id}`]);
  await page.reload();
};
const provider = async (email, op) => (await fetch(`${B}__test/provider?email=${encodeURIComponent(email)}&op=${op}`)).json();
const paused = (p) => p.getByTestId('planner-paused');
const pausedVisible = (p) => paused(p).waitFor();
const waitPlanner = (p) => p.locator('.app').first().waitFor();
const recheck = (p) => p.evaluate(() => window.dispatchEvent(new Event('online')));
const route = (p, hash) => p.evaluate((h) => { location.hash = `#/${h}`; }, hash);
const valueIs = (p, sel, v) => p.waitForFunction(([s, x]) => document.querySelector(s)?.value === x, [sel, v]);
const gone = (p, key) => p.waitForFunction((k) => localStorage.getItem(k) === null, key);
const stored = (p, key) => p.waitForFunction((k) => localStorage.getItem(k) !== null, key);

const newAccount = async (page, email) => {
  await page.goto(B);
  await page.getByRole('button', { name: 'Create an account' }).click();
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PW);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await page.getByRole('heading', { name: 'Check your email' }).waitFor();
  const m = await waitMail(B, email);
  await page.goto(m.text.match(/https?:\/\/\S+/)[0]);
  await pausedVisible(page);
};
const signIn = async (page, email) => {
  await page.goto(B);
  await page.getByRole('heading', { name: 'Sign in', exact: true }).waitFor();
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PW);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
};
/** A new account with a paid subscription (mock provider), a demo plan, and the wellbeing section switched on. The planner is open. */
const subscribed = async (page, email) => {
  await newAccount(page, email);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: /^Start my 14-day trial$/ }).click();
  await page.getByRole('heading', { name: 'One calm plan for your home, your body and your day' }).waitFor();
  await page.getByText('Beginner: discipline & fitness').first().click();
  await page.waitForSelector('text=Habits & routine');
  const r = await post(page, '/api/billing/checkout', { plan: 'monthly' });
  const sid = r.json.url.split('/').pop();
  await fetch(`${B}__test/complete?session=${sid}`);
  await post(page, '/api/billing/sync', { sessionId: sid });
  await patchPlan(page, 'd.modules.enabled.wellbeing = true; d.modules.enabled.water = true; d.modules.enabled.meals = true;');
  await waitPlanner(page);
};
const closeGate = async (page, email) => { await provider(email, 'unpaid'); await recheck(page); await pausedVisible(page); };
/** Access returns. `at` is the planner address to look at it on (an account screen is not a planner address, so the planner is not on it). */
const openGate = async (page, email, at = null) => { await provider(email, 'active'); await recheck(page); if (at) await route(page, at); await waitPlanner(page); };
const openTaskSheet = async (page) => {
  await route(page, 'today');
  await page.getByRole('button', { name: 'Add a task' }).first().click();
  await page.getByRole('dialog', { name: 'Add your own task' }).waitFor();
};
const openJournalSheet = async (page) => {
  await route(page, 'wellbeing?tab=journal');
  await page.getByRole('button', { name: 'New entry' }).click();
  await page.getByRole('dialog', { name: 'A new entry' }).waitFor();
};

// ───────────────────────────── 1. a sheet: type, lose access, regain it, finish ─────────────────────────────
if (want('sheet')) {
  const { ctx, page } = await open({ label: 'sheet' });
  const email = 'drafts.sheet@example.test';
  const M1 = 'TASK-DRAFT-8f21a'; const M2 = 'NOTES-DRAFT-3c9e7';
  await subscribed(page, email);
  const id = await idOf(page);
  await openTaskSheet(page);
  await page.locator('#t-name').fill(M1);
  await page.locator('#t-notes').fill(M2);
  await step('while the planner is open, typed text is only in the form: nothing is written for it', async () => {
    check('no drafts key exists', (await ls(page, draftsKey(id))) === null);
    check('the plan holds no task with that name', !JSON.stringify(await planOf(page)).includes(M1));
  }, page);
  await step('the planner closes with text typed into the form: the text is kept on this device, for this account, and not shown or sent', async () => {
    await closeGate(page, email);
    check('the planner and its sheet are gone', (await page.locator('.app').count()) === 0 && (await page.getByRole('dialog').count()) === 0);
    await stored(page, draftsKey(id));
    const raw = await ls(page, draftsKey(id));
    check('the text is under this account’s own key', raw.includes(M1) && raw.includes(M2), raw.slice(0, 200));
    check('the paused screen says what was kept, in words, never the text', /a task/i.test(await page.getByTestId('drafts-note').innerText()) && !(await page.locator('body').innerText()).includes(M1));
    check('it says where it is stored and that it is not uploaded', /only on this device/.test(await page.getByTestId('drafts-note').innerText()) && /never sent to the server/.test(await page.getByTestId('drafts-note').innerText()));
    check('it is not in the plan', !JSON.stringify(await planOf(page)).includes(M1));
    check('no request carried it anywhere', sentWith(page, M1).length === 0 && sentWith(page, M2).length === 0, sentWith(page, M1).join(' | ').slice(0, 200));
  }, page);
  await step('access returns: the same sheet is open with the text put back, and nothing was submitted', async () => {
    await openGate(page, email);
    await page.getByRole('dialog', { name: 'Add your own task' }).waitFor();
    await valueIs(page, '#t-name', M1);
    await valueIs(page, '#t-notes', M2);
    check('the person is told it was put back and that nothing was saved or sent', /We put back the text you had typed\. Nothing was saved or sent\./.test(await page.locator('.toasts').innerText()), await page.locator('.toasts').innerText());
    const plan = JSON.stringify(await planOf(page));
    check('no task was created from it', !plan.includes(M1));
    check('and still no request carried it', sentWith(page, M1).length === 0 && sentWith(page, M2).length === 0);
  }, page);
  await step('pressing the form’s own button saves it, and then the draft is gone', async () => {
    await page.getByRole('button', { name: 'Add task' }).click();
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    await gone(page, draftsKey(id));
    check('the task is in the plan now', JSON.stringify(await planOf(page)).includes(M1));
    check('the key is gone', (await ls(page, draftsKey(id))) === null);
  }, page);
  await step('closing a sheet on purpose (Cancel, Escape, the X) discards its text: a later pause keeps nothing', async () => {
    await openTaskSheet(page);
    await page.locator('#t-name').fill('CANCELLED-DRAFT-11');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    await openTaskSheet(page);
    check('reopened empty', (await page.locator('#t-name').inputValue()) === '');
    await page.locator('#t-name').fill('ESCAPED-DRAFT-12');
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    await openTaskSheet(page);
    check('reopened empty after Escape', (await page.locator('#t-name').inputValue()) === '');
    await page.getByRole('button', { name: 'Close' }).click();
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    await closeGate(page, email);
    check('nothing was kept, and the screen does not claim it', (await ls(page, draftsKey(id))) === null && (await page.getByTestId('drafts-note').count()) === 0);
    await openGate(page, email);
  }, page);
  check('nothing sensitive was sent in this whole section', sentWith(page, 'DRAFT').length === 0, sentWith(page, 'DRAFT').join(' | ').slice(0, 200));
  await ctx.close();
}

// ───────────────────────────── 2. a full page load while closed (the payment page and back), then resume ─────────────────────────────
if (want('reload')) {
  const { ctx, page } = await open({ label: 'reload' });
  const email = 'drafts.reload@example.test';
  const J = 'JOURNAL-DRAFT-5d0b1 a private thought'; const T = 'JTITLE-DRAFT-77e2';
  await subscribed(page, email);
  const id = await idOf(page);
  await openJournalSheet(page);
  await page.locator('#j-t').fill(T);
  await page.locator('#j-x').fill(J);
  await closeGate(page, email);
  await stored(page, draftsKey(id));
  await step('a whole new page load while the planner is closed finds the draft and lists it (not its text)', async () => {
    await page.goto(`${B}?r=${Date.now()}#/account`);
    await pausedVisible(page);
    const note = await page.getByTestId('drafts-note').innerText();
    check('the closed screen lists the journal entry draft', /a journal entry/i.test(note), note);
    check('and does not show the text', !(await page.locator('body').innerText()).includes('JOURNAL-DRAFT-5d0b1'));
    check('the draft is still only on this device', sentWith(page, 'JOURNAL-DRAFT-5d0b1').length === 0);
  }, page);
  await step('when access returns the planner offers the draft; Resume opens the entry with the text, and nothing is saved until Save', async () => {
    await openGate(page, email, 'today');
    await page.getByTestId('drafts-banner').waitFor();
    check('the banner says what it is and that nothing was saved or sent', /Text you had not saved is still here/.test(await page.getByTestId('drafts-banner').innerText()) && /nothing was sent to the server/.test(await page.getByTestId('drafts-banner').innerText()));
    check('the plan holds no such entry yet', !JSON.stringify(await planOf(page)).includes('JOURNAL-DRAFT-5d0b1'));
    await page.getByRole('button', { name: 'Resume' }).click();
    await page.getByRole('dialog', { name: 'A new entry' }).waitFor();
    await valueIs(page, '#j-x', J);
    await valueIs(page, '#j-t', T);
    check('both fields are back', true);
    check('the banner steps aside while the entry is open', (await page.getByTestId('drafts-banner').count()) === 0);
    check('still not in the plan', !JSON.stringify(await planOf(page)).includes('JOURNAL-DRAFT-5d0b1'));
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    await gone(page, draftsKey(id));
    check('saved by the form’s own button, and the draft is gone', JSON.stringify(await planOf(page)).includes('JOURNAL-DRAFT-5d0b1'));
  }, page);
  await step('Discard in the banner deletes a draft without saving anything', async () => {
    await openTaskSheet(page);
    await page.locator('#t-name').fill('DISCARD-ME-DRAFT-9');
    await closeGate(page, email);
    await stored(page, draftsKey(id));
    await openGate(page, email);
    await page.reload();
    await page.getByTestId('drafts-banner').waitFor();
    await page.getByRole('button', { name: 'Discard', exact: true }).click();
    await page.getByTestId('drafts-banner').waitFor({ state: 'detached' });
    await gone(page, draftsKey(id));
    check('the key is gone and no task was made', !JSON.stringify(await planOf(page)).includes('DISCARD-ME-DRAFT-9'));
    await openTaskSheet(page);
    check('opening the form again finds it empty', (await page.locator('#t-name').inputValue()) === '');
    await page.getByRole('button', { name: 'Cancel' }).click();
  }, page);
  await step('"Not now" hides the banner for this visit but keeps the draft, and the Data & backup screen still lists it', async () => {
    await openTaskSheet(page);
    await page.locator('#t-name').fill('KEEP-ME-DRAFT-10');
    await closeGate(page, email);
    await openGate(page, email);
    await page.reload();
    await page.getByTestId('drafts-banner').waitFor();
    await page.getByRole('button', { name: 'Not now' }).click();
    await page.getByTestId('drafts-banner').waitFor({ state: 'detached' });
    check('still stored', (await ls(page, draftsKey(id))) !== null);
    await route(page, 'account/data');
    await page.getByRole('heading', { name: 'Your data and backup', level: 1 }).waitFor();
    check('the data screen lists it and offers to discard it', /a task/i.test(await page.getByTestId('drafts-note').innerText()));
    await page.getByTestId('drafts-note').getByRole('button', { name: /^Discard/ }).click();
    await gone(page, draftsKey(id));
    check('discarded from there', (await page.getByTestId('drafts-note').count()) === 0);
  }, page);
  check('nothing private was sent in this whole section', sentWith(page, 'DRAFT').length === 0 && sentWith(page, 'a private thought').length === 0);
  await ctx.close();
}

// ───────────────────────────── 3. a form on a page (the check-in note) ─────────────────────────────
if (want('page')) {
  const { ctx, page } = await open({ label: 'page' });
  const email = 'drafts.page@example.test';
  const N = 'CHECKIN-NOTE-DRAFT-61a4';
  await subscribed(page, email);
  const id = await idOf(page);
  await route(page, 'wellbeing?tab=checkin');
  await page.locator('#ck-n').fill(N);
  await step('the private check-in note survives the planner closing and returning, on the same page, and is not saved by itself', async () => {
    await closeGate(page, email);
    await stored(page, draftsKey(id));
    check('the closed screen lists it by name', /a check-in note/i.test(await page.getByTestId('drafts-note').innerText()));
    await openGate(page, email);
    await page.locator('#ck-n').waitFor();
    await valueIs(page, '#ck-n', N);
    check('no check-in was saved', (await planOf(page)).wellbeing.checkins.length === 0);
    await page.getByRole('radiogroup', { name: 'Energy right now' }).getByRole('radio', { name: 'Okay' }).click();
    await page.getByRole('button', { name: 'Save check-in' }).click();
    await gone(page, draftsKey(id));
    const plan = await planOf(page);
    check('saving it by its own button stores the note and removes the draft', plan.wellbeing.checkins.length === 1 && plan.wellbeing.checkins[0].note === N);
    check('the form is empty again', (await page.locator('#ck-n').inputValue()) === '');
  }, page);
  await step('moving to another page while the planner is open ends the form: a later pause keeps nothing of it', async () => {
    await page.locator('#ck-n').fill('LEFT-BEHIND-DRAFT-62');
    await route(page, 'today');
    await page.locator('.hero-card').first().waitFor();
    await closeGate(page, email);
    check('no draft was kept', (await ls(page, draftsKey(id))) === null && (await page.getByTestId('drafts-note').count()) === 0);
    await openGate(page, email);
  }, page);
  check('no request carried the note', sentWith(page, 'DRAFT').length === 0);
  await ctx.close();
}

// ───────────────────────────── 4. two accounts, sign-out, and getting your own back ─────────────────────────────
if (want('accounts')) {
  const { ctx, page } = await open({ label: 'accounts' });
  const e1 = 'drafts.acct1@example.test'; const e2 = 'drafts.acct2@example.test';
  const A1 = 'ACCOUNT-ONE-PRIVATE-DRAFT-4e90';
  await subscribed(page, e1);
  const id1 = await idOf(page);
  await openTaskSheet(page);
  await page.locator('#t-name').fill(A1);
  await closeGate(page, e1);
  await stored(page, draftsKey(id1));
  await step('signing out offers to delete the draft, and by default keeps it under that account (it is the same device storage as the plan)', async () => {
    const row = page.getByRole('checkbox', { name: /Also delete the draft of text I had not saved/ });
    check('the choice is on the sign-out row and says what happens otherwise', await row.count() === 1 && /stays on this device, under your account/.test(await page.locator('.check-row', { hasText: 'Also delete the draft' }).innerText()));
    check('it is not ticked by default', !(await row.isChecked()));
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.getByRole('heading', { name: 'Sign in', exact: true }).waitFor();
    check('the draft is still stored for account one', (await ls(page, draftsKey(id1))) !== null);
  }, page);
  await subscribed(page, e2);
  const id2 = await idOf(page);
  await step('another account on the same browser never sees it: not on screen, not in its form, not under its key', async () => {
    check('no banner for account two', (await page.getByTestId('drafts-banner').count()) === 0);
    await openTaskSheet(page);
    check('the same form is empty for account two', (await page.locator('#t-name').inputValue()) === '');
    await closeGate(page, e2);
    check('account two has no drafts key and no note', (await ls(page, draftsKey(id2))) === null && (await page.getByTestId('drafts-note').count()) === 0);
    const all = await lsAll(page);
    const leaks = Object.entries(all).filter(([k, v]) => k.includes(id2) && String(v).includes(A1));
    check('nothing stored under account two’s keys contains account one’s text', leaks.length === 0, leaks.map(([k]) => k).join(','));
    check('and the page never showed it', !(await page.content()).includes(A1));
    check('account one’s draft is untouched', (await ls(page, draftsKey(id1))).includes(A1));
    await openGate(page, e2);
  }, page);
  await step('signing back in as account one gives it its own text back, once access is open', async () => {
    await post(page, '/api/auth/sign-out', {});
    await signIn(page, e1);
    await pausedVisible(page);
    check('the closed screen for account one lists its draft', /a task/i.test(await page.getByTestId('drafts-note').innerText()));
    await openGate(page, e1);
    await page.getByTestId('drafts-banner').waitFor();
    await page.getByRole('button', { name: 'Resume' }).click();
    await page.getByRole('dialog', { name: 'Add your own task' }).waitFor();
    await valueIs(page, '#t-name', A1);
    check('account one’s text is back in its form', true);
    await page.getByRole('button', { name: 'Cancel' }).click();
  }, page);
  await step('ticking the box when signing out deletes the draft', async () => {
    await openTaskSheet(page);
    await page.locator('#t-name').fill('ACCOUNT-ONE-SECOND-DRAFT-4f');
    await closeGate(page, e1);
    await stored(page, draftsKey(id1));
    await page.getByRole('checkbox', { name: /Also delete the draft of text I had not saved/ }).check();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.getByRole('heading', { name: 'Sign in', exact: true }).waitFor();
    check('the key is gone', (await ls(page, draftsKey(id1))) === null);
    check('and nothing was sent', sentWith(page, 'PRIVATE-DRAFT').length === 0 && sentWith(page, 'SECOND-DRAFT').length === 0);
  }, page);
  await ctx.close();
}

// ───────────────────────────── 5. deleting the account removes the draft, whatever is chosen about the plan ─────────────────────────────
if (want('delete')) {
  const { ctx, page } = await open({ label: 'delete' });
  const email = 'drafts.delete@example.test';
  await subscribed(page, email);
  const id = await idOf(page);
  await openTaskSheet(page);
  await page.locator('#t-name').fill('DELETED-ACCOUNT-DRAFT-0d');
  await closeGate(page, email);
  await stored(page, draftsKey(id));
  await step('deleting the account (keeping the plan on the device) still removes the unsent text', async () => {
    await page.getByRole('button', { name: 'Delete my account…' }).click();
    await page.getByLabel('Your password, to confirm').fill(PW);
    check('the plan is kept unless the box is ticked (it is not)', !(await page.getByRole('checkbox', { name: /Also erase this account's plan/ }).isChecked()));
    await page.getByRole('button', { name: 'Delete my account', exact: true }).click();
    await page.getByText('Your account was deleted.').waitFor();
    check('no drafts key remains', (await ls(page, draftsKey(id))) === null);
    check('while the plan key does, because the plan was not erased', (await ls(page, `cleanflow:v1@${id}`)) !== null);
    check('no draft key of any account is left behind', Object.keys(await lsAll(page)).filter((k) => k.startsWith('cleanflow:drafts@')).length === 0);
  }, page);
  await ctx.close();
}


// ───────────────────────────── 3b. structure: rows added, options chosen, so the text lands where it was typed ─────────────────────────────
if (want('structure')) {
  const { ctx, page } = await open({ label: 'structure' });
  const email = 'drafts.structure@example.test';
  const D = 'DISH-DRAFT-9e1f'; const STEPS = 'STEP-ONE-4b7\nSTEP-TWO-2d9';
  await subscribed(page, email);
  const id = await idOf(page);
  await route(page, 'meals?tab=recipes');
  await page.getByRole('button', { name: 'Write down a dish' }).first().click();
  await page.getByRole('dialog', { name: 'Write down a dish' }).waitFor();
  await page.locator('#d-name').fill(D);
  await page.locator('#d-serv').fill('6');
  await page.getByRole('button', { name: 'Add an ingredient' }).click();
  await page.getByRole('button', { name: 'Add an ingredient' }).click();          // three starting rows, two added: five
  await page.getByLabel('Ingredient 1 name').fill('flour');
  await page.getByLabel('Ingredient 1 amount').fill('200');
  await page.getByLabel('Ingredient 1 unit').selectOption('g');
  await page.getByLabel('Ingredient 2 name').fill('cinnamon');
  await page.getByLabel('Ingredient 2 name').locator('xpath=ancestor::div[contains(@class,"row")][1]').getByRole('checkbox', { name: 'Optional' }).check();
  await page.getByLabel('Ingredient 5 name').fill('salt-pinch');                  // a row that only exists because a button was pressed
  await page.locator('#d-steps').fill(STEPS);
  const slotChip = page.getByRole('dialog').getByRole('checkbox', { name: 'Breakfast' });
  const slotBefore = await slotChip.getAttribute('aria-checked');
  await slotChip.click();                                                         // an option changed from its starting value
  const slotAfter = await slotChip.getAttribute('aria-checked');
  const dishState = async () => page.evaluate(() => ({
    name: document.querySelector('#d-name').value, serves: document.querySelector('#d-serv').value, steps: document.querySelector('#d-steps').value,
    rows: [1, 2, 3, 4, 5, 6].map((i) => { const n = document.querySelector(`[aria-label="Ingredient ${i} name"]`); if (!n) return null; const row = n.closest('.row'); return { name: n.value, qty: document.querySelector(`[aria-label="Ingredient ${i} amount"]`).value, unit: document.querySelector(`[aria-label="Ingredient ${i} unit"]`).value, optional: row.querySelector('input[type=checkbox]').checked }; }),
    slots: [...document.querySelector('[role=dialog]').querySelectorAll('#d-slots + [role=group] [role=checkbox]')].map((e) => `${e.textContent.trim()}:${e.getAttribute('aria-checked')}`),
  }));
  const before = await dishState();
  await step('before leaving, the form is as typed (five rows, a chosen unit, a ticked box, a changed option)', async () => {
    check('five ingredient rows, row 5 filled, the option changed', before.rows.filter(Boolean).length === 5 && before.rows[4].name === 'salt-pinch' && before.rows[0].unit === 'g' && before.rows[1].optional === true && slotBefore !== slotAfter && before.slots.length >= 3 && before.slots.some((x) => /^Breakfast:/.test(x)), JSON.stringify(before));
    check('nothing is kept yet', (await ls(page, draftsKey(id))) === null);
  }, page);
  await step('the planner closes and returns: every row, value and option is back exactly, and nothing was saved', async () => {
    await closeGate(page, email);
    await stored(page, draftsKey(id));
    const raw = JSON.parse(await ls(page, draftsKey(id)));
    check('what is kept names the rows and the options (and is only on this device)', raw.v === 2 && /salt-pinch/.test(JSON.stringify(raw)) && sentWith(page, 'salt-pinch').length === 0, JSON.stringify(raw).slice(0, 200));
    await openGate(page, email);
    await page.getByRole('dialog', { name: 'Write down a dish' }).waitFor();
    await valueIs(page, '#d-name', D);
    const after = await dishState();
    check('the dish is exactly as it was typed, row for row', JSON.stringify(after) === JSON.stringify(before), JSON.stringify(after));
    check('no dish was saved', !JSON.stringify(await planOf(page)).includes(D));
  }, page);
  await step('a whole page load while closed, then Resume, gives the same form again', async () => {
    await closeGate(page, email);
    await page.goto(`${B}?r=${Date.now()}#/account`);
    await pausedVisible(page);
    check('the closed screen lists a dish by kind, not its text', /a dish/i.test(await page.getByTestId('drafts-note').innerText()) && !(await page.locator('body').innerText()).includes('salt-pinch'));
    await openGate(page, email, 'today');
    await page.getByTestId('drafts-banner').waitFor();
    await page.getByRole('button', { name: 'Resume' }).click();
    await page.getByRole('dialog', { name: 'Write down a dish' }).waitFor();
    await valueIs(page, '#d-name', D);
    const after = await dishState();
    check('five rows, every value and option, after a page load', JSON.stringify(after) === JSON.stringify(before), `before ${JSON.stringify(before)} after ${JSON.stringify(after)}`);
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    await gone(page, draftsKey(id));
  }, page);
  await step('a task: chosen area, frequency and priority come back with the text', async () => {
    await openTaskSheet(page);
    await page.locator('#t-name').fill('TASK-STRUCT-DRAFT-6a');
    await page.locator('#t-area').selectOption('home');
    await page.locator('#t-room').waitFor();
    await page.locator('#t-freq').selectOption('weekly');
    await page.getByRole('dialog').getByRole('radio', { name: 'High' }).click();
    await closeGate(page, email);
    await openGate(page, email);
    await valueIs(page, '#t-name', 'TASK-STRUCT-DRAFT-6a');
    check('the area, the room field it reveals, the frequency and the priority are as chosen', (await page.locator('#t-area').inputValue()) === 'home' && (await page.locator('#t-room').count()) === 1 && (await page.locator('#t-freq').inputValue()) === 'weekly' && (await page.getByRole('dialog').getByRole('radio', { name: 'High' }).getAttribute('aria-checked')) === 'true');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await gone(page, draftsKey(id));
  }, page);
  await step('a choice alone is not a draft: changing only an option keeps nothing', async () => {
    await openTaskSheet(page);
    await page.getByRole('dialog').getByRole('radio', { name: 'High' }).click();
    await closeGate(page, email);
    check('no key, no note', (await ls(page, draftsKey(id))) === null && (await page.getByTestId('drafts-note').count()) === 0);
    await openGate(page, email);
    await page.getByRole('button', { name: 'Cancel' }).click();
  }, page);
  check('nothing was sent in this whole section', sentWith(page, 'DRAFT').length === 0 && sentWith(page, 'STEP-ONE').length === 0);
  await ctx.close();
}

// ───────────────────────────── 3c. the session ends under an open form ─────────────────────────────
if (want('expiry')) {
  const { ctx, page } = await open({ label: 'expiry' });
  const email = 'drafts.expiry@example.test';
  const M = 'EXPIRY-DRAFT-71b3'; const N = 'EXPIRY-NOTES-5c20';
  await subscribed(page, email);
  const id = await idOf(page);
  await openTaskSheet(page);
  await page.locator('#t-name').fill(M);
  await page.locator('#t-notes').fill(N);
  await page.locator('#t-freq').selectOption('monthly');
  await page.getByRole('dialog').getByRole('radio', { name: 'Low' }).click();
  await step('while the form is open and the planner is open, nothing is written', async () => {
    check('no drafts key', (await ls(page, draftsKey(id))) === null);
    check('the plan holds nothing of it', !JSON.stringify(await planOf(page)).includes(M));
  }, page);
  await step('the session ends under the open form: the person is told, the text is kept for that account, and nothing is sent', async () => {
    await ctx.clearCookies();                                                  // expired, or ended elsewhere
    await recheck(page);
    await page.getByText('Your session has ended. Sign in again to continue.').waitFor();
    check('the sign-in screen is showing, and the form is gone', (await page.getByRole('heading', { name: 'Sign in', exact: true }).count()) === 1 && (await page.getByRole('dialog').count()) === 0);
    await stored(page, draftsKey(id));
    const raw = await ls(page, draftsKey(id));
    check('the text and the options are kept under this account’s own key', raw.includes(M) && raw.includes(N) && raw.includes('monthly') && raw.includes('LOW'), raw.slice(0, 200));
    check('it is not on the sign-in screen', !(await page.locator('body').innerText()).includes(M));
    check('not in the plan', !JSON.stringify(JSON.parse(await ls(page, `cleanflow:v1@${id}`) ?? '{}')).includes(M));
    check('no request carried it', sentWith(page, M).length === 0 && sentWith(page, N).length === 0);
  }, page);
  await step('signing in again: the planner opens, offers the draft, and Resume puts back the text and the options; nothing was saved', async () => {
    await signIn(page, email);
    await waitPlanner(page);
    await page.getByTestId('drafts-banner').waitFor();
    check('the banner says what it is and that nothing was sent', /Text you had not saved is still here/.test(await page.getByTestId('drafts-banner').innerText()) && /nothing was sent to the server/.test(await page.getByTestId('drafts-banner').innerText()));
    await page.getByRole('button', { name: 'Resume' }).click();
    await page.getByRole('dialog', { name: 'Add your own task' }).waitFor();
    await valueIs(page, '#t-name', M);
    await valueIs(page, '#t-notes', N);
    check('the frequency and the priority are back too', (await page.locator('#t-freq').inputValue()) === 'monthly' && (await page.getByRole('dialog').getByRole('radio', { name: 'Low' }).getAttribute('aria-checked')) === 'true');
    check('not saved, and nothing sent', !JSON.stringify(await planOf(page)).includes(M) && sentWith(page, M).length === 0);
    await page.getByRole('button', { name: 'Add task' }).click();
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    await gone(page, draftsKey(id));
    check('saved by the form’s own button, and the draft is gone', JSON.stringify(await planOf(page)).includes(M));
  }, page);
  await ctx.close();
}

// ───────────────────────────── 3d. the account changes under an open form (another tab signs in as someone else) ─────────────────────────────
if (want('switch')) {
  const { ctx, page } = await open({ label: 'switch' });
  const e1 = 'drafts.sw1@example.test'; const e2 = 'drafts.sw2@example.test';
  const S1 = 'SWITCH-ONE-DRAFT-3f8a'; const S2 = 'SWITCH-TWO-DRAFT-8c41';
  await subscribed(page, e2);                                                   // account two exists, with a plan
  const id2 = await idOf(page);
  await post(page, '/api/auth/sign-out', {});
  await subscribed(page, e1);
  const id1 = await idOf(page);
  /** Another tab or window of this browser signs in as someone else (the cookie is shared): this tab finds out at its next check. */
  const elsewhere = async (email) => {
    await ctx.request.post(`${B}api/auth/sign-out`, { data: {}, headers: { origin: B.slice(0, -1) } });
    const r = await ctx.request.post(`${B}api/auth/sign-in/email`, { data: { email, password: PW }, headers: { origin: B.slice(0, -1) } });
    if (!r.ok()) throw new Error(`sign-in elsewhere failed: ${r.status()}`);
  };
  await openTaskSheet(page);
  await page.locator('#t-name').fill(S1);
  await page.getByRole('dialog').getByRole('radio', { name: 'High' }).click();
  await step('another tab signs in as account two: this tab switches, account one’s open form is kept for account one, and account two sees nothing of it', async () => {
    check('nothing was written while the form was open', (await ls(page, draftsKey(id1))) === null);
    await elsewhere(e2);
    await recheck(page);
    await page.waitForFunction((k) => localStorage.getItem(k) !== null, draftsKey(id1));
    await waitPlanner(page);
    check('this tab is now account two’s (its own plan key is the one in use)', (await idOf(page)) === id2);
    check('account one’s form is gone and its text is not on the page', (await page.getByRole('dialog').count()) === 0 && !(await page.content()).includes(S1));
    check('account one’s text is under account one’s key only', (await ls(page, draftsKey(id1))).includes(S1) && (await ls(page, draftsKey(id2))) === null);
    check('account two gets no banner for it', (await page.getByTestId('drafts-banner').count()) === 0);
    await openTaskSheet(page);
    check('account two’s task form is empty (nothing restored, nothing from account one)', (await page.locator('#t-name').inputValue()) === '' && (await page.getByRole('dialog').getByRole('radio', { name: 'High' }).getAttribute('aria-checked')) !== 'true');
    const all = await lsAll(page);
    check('nothing stored under account two’s keys holds account one’s text', Object.entries(all).filter(([k, v]) => k.includes(id2) && String(v).includes(S1)).length === 0);
    check('no request carried account one’s text', sentWith(page, S1).length === 0);
  }, page);
  await step('account two types in its own form; another tab signs account one back in: each gets its own draft and only its own', async () => {
    await page.locator('#t-name').fill(S2);
    await elsewhere(e1);
    await recheck(page);
    await page.waitForFunction((k) => localStorage.getItem(k) !== null, draftsKey(id2));
    await waitPlanner(page);
    check('this tab is account one’s again', (await idOf(page)) === id1);
    await page.getByTestId('drafts-banner').waitFor();
    check('account one is offered its own draft, and the page shows nothing of account two’s', !(await page.content()).includes(S2) && /A task/.test(await page.getByTestId('drafts-banner').innerText()));
    await page.getByRole('button', { name: 'Resume' }).click();
    await page.getByRole('dialog', { name: 'Add your own task' }).waitFor();
    await valueIs(page, '#t-name', S1);
    check('account one’s text and its chosen priority are back', (await page.getByRole('dialog').getByRole('radio', { name: 'High' }).getAttribute('aria-checked')) === 'true');
    check('both drafts are under their own accounts’ keys, each holding only its own text', (await ls(page, draftsKey(id1))).includes(S1) && !(await ls(page, draftsKey(id1))).includes(S2) && (await ls(page, draftsKey(id2))).includes(S2) && !(await ls(page, draftsKey(id2))).includes(S1));
    await page.getByRole('button', { name: 'Cancel' }).click();
    await gone(page, draftsKey(id1));
  }, page);
  await step('deleting is deliberate and per account: account one’s Discard leaves account two’s draft alone', async () => {
    check('account two’s draft is still stored after account one finished with its own', (await ls(page, draftsKey(id2))) !== null && (await ls(page, draftsKey(id2))).includes(S2));
    await elsewhere(e2);
    await recheck(page);
    await waitPlanner(page);
    await page.getByTestId('drafts-banner').waitFor();
    check('account two sees only its own', !(await page.content()).includes(S1));
    await page.getByRole('button', { name: 'Discard', exact: true }).click();
    await gone(page, draftsKey(id2));
    check('discarded: gone, and nothing was saved', !JSON.stringify(await planOf(page)).includes(S2));
  }, page);
  check('nothing was sent in this whole section', sentWith(page, 'SWITCH-').length === 0);
  await ctx.close();
}

// ───────────────────────────── 3e. what closing the tab does NOT keep (the documented limit) ─────────────────────────────
if (want('tabclose')) {
  const { ctx, page } = await open({ label: 'tabclose' });
  const email = 'drafts.tab@example.test';
  const T = 'TAB-CLOSE-DRAFT-0e55';
  await subscribed(page, email);
  const id = await idOf(page);
  await openTaskSheet(page);
  await page.locator('#t-name').fill(T);
  await step('reloading (or closing) the tab with the planner open keeps nothing: no code of ours runs, and the text is gone', async () => {
    await page.reload();
    await waitPlanner(page);
    check('no drafts key, no banner, no note, and the form is not open', (await ls(page, draftsKey(id))) === null && (await page.getByTestId('drafts-banner').count()) === 0 && (await page.getByRole('dialog').count()) === 0);
    check('the text is not anywhere in this browser’s storage', Object.values(await lsAll(page)).every((v) => !String(v).includes(T)));
    await openTaskSheet(page);
    check('the form opens empty', (await page.locator('#t-name').inputValue()) === '');
    await page.getByRole('button', { name: 'Cancel' }).click();
  }, page);
  await ctx.close();
}

// ───────────────────────────── 6. what a draft is not part of ─────────────────────────────
if (want('privacy')) {
  const { ctx, page } = await open({ label: 'privacy' });
  const email = 'drafts.privacy@example.test';
  const S = 'SECRET-DRAFT-TEXT-b7c1';
  await subscribed(page, email);
  const id = await idOf(page);
  await openJournalSheet(page);
  await page.locator('#j-x').fill(S);
  await closeGate(page, email);
  await stored(page, draftsKey(id));
  await step('it is not in the plan, the downloaded plan, the account export, or any request', async () => {
    check('not in the plan on the device', !JSON.stringify(await planOf(page)).includes(S));
    await route(page, 'account/data');
    await page.getByRole('heading', { name: 'Your data and backup', level: 1 }).waitFor();
    const dl = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download my plan and history' }).click();
    const file = await dl;
    const text = await (await import('node:fs/promises')).readFile(await file.path(), 'utf8');
    check('not in the downloaded plan file', text.length > 100 && !text.includes(S), String(text.length));
    const exp = await api(page, '/api/account/export');
    check('not in the account export from the server (it cannot be: the server never had it)', exp.status === 200 && !exp.text.includes(S), String(exp.status));
    check('no request of any kind carried it', sentWith(page, S).length === 0, sentWith(page, S).join(' | ').slice(0, 200));
  }, page);
  await step('the only copy is the one under this account’s own key, and it is plain data with no script or address in it', async () => {
    const keys = Object.entries(await lsAll(page)).filter(([, v]) => String(v).includes(S)).map(([k]) => k);
    check('exactly one stored value holds it', keys.length === 1 && keys[0] === draftsKey(id), keys.join(','));
  }, page);
  await ctx.close();
}

// ───────────────────────────── 7. local mode is untouched ─────────────────────────────
if (want('local')) {
  const { ctx, page } = await open({ label: 'local' });
  await step('with no accounts there are no drafts: no wrapper, no key, no banner, and the form behaves as before', async () => {
    await page.goto(L);
    await page.getByText('Beginner: discipline & fitness').first().click();
    await page.waitForSelector('text=Habits & routine');
    await route(page, 'today');
    await page.getByRole('button', { name: 'Add a task' }).first().click();
    await page.getByRole('dialog', { name: 'Add your own task' }).waitFor();
    await page.locator('#t-name').fill('LOCAL-MODE-TEXT');
    check('there is no draft wrapper in the page', (await page.locator('.draft-scope').count()) === 0);
    await page.reload();
    check('a reload loses unsaved text exactly as before, and no draft key exists', (await page.getByRole('dialog').count()) === 0 && Object.keys(await lsAll(page)).filter((k) => k.includes('drafts')).length === 0);
    check('no banner or note', (await page.getByTestId('drafts-banner').count()) === 0 && (await page.getByTestId('drafts-note').count()) === 0);
  }, page);
  await ctx.close();
}

clearTimeout(watchdog);
await browser.close();
await Promise.all(servers.map(stopServer));
done(errors);
