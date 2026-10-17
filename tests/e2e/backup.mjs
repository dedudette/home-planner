// Data & backup in a real browser (issue #6): copying data from before accounts into an account, and the optional manual cloud backup.
//
// Servers (tests/e2e/accountsServer.ts: the real API on a throwaway PostgreSQL database with real Better Auth and a mailbox):
//   A  accounts mode (no payment provider is involved anywhere in this suite)
//   L  local mode: no accounts at all
//
// What is real here: the built app in Chromium, the HTTP API, PostgreSQL, Better Auth sessions, the server's entitlement rules and its clock.
// What is simulated: failures. Network failures are made by the browser (aborted or rewritten requests), storage failures by making the
// browser's localStorage refuse writes the way a full or blocked store does, and "a crash in the middle of a copy" by leaving behind the exact
// records a crash would have left (a browser test cannot stop JavaScript between two synchronous statements). Nothing contacts Stripe.
//
//   npm run build && npm run e2e:backup      (needs the PostgreSQL server binaries; see scripts/test-db.sh)
//   E2E_ONLY=link,cloud npm run e2e:backup   runs just those sections
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { launch, runner, watch } from './lib.mjs';

const P = Number(process.env.E2E_PORT ?? 18700);
const A = `http://127.0.0.1:${P}/`;
const L = `http://127.0.0.1:${P + 1}/`;
const { check, step, done } = runner('backup');
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
  servers.push(await start(P));
  servers.push(await start(P + 1, { MODE: 'local' }));
  browser = await launch();
} catch (e) { console.log(`FAIL setup: ${e.message}`); await Promise.all(servers.map(stopServer)); process.exit(1); }

const PW = 'correct horse battery';
let ipn = 10;
const open = async (o = {}) => {
  const ctx = await browser.newContext({ viewport: { width: o.w ?? 390, height: o.h ?? 844 }, isMobile: (o.w ?? 390) < 600, hasTouch: (o.w ?? 390) < 600, locale: 'en-US', timezoneId: 'UTC', colorScheme: o.dark ? 'dark' : 'light', acceptDownloads: true, extraHTTPHeaders: { 'x-forwarded-for': `10.9.${++ipn}.1` } });
  const page = await ctx.newPage();
  watch(page, errors, o.label ?? '', o.ignore ?? null);
  page.reqs = [];
  page.on('request', (r) => { const u = new URL(r.url()); if (u.pathname.startsWith('/api/')) page.reqs.push(`${r.method()} ${u.pathname}${u.search}`); });
  return { ctx, page };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mail = async (base, to) => (await fetch(`${base}__test/mail?to=${encodeURIComponent(to.toLowerCase())}`)).json();
const waitMail = async (base, to) => { for (let i = 0; i < 40; i++) { const ms = (await mail(base, to)).filter((x) => /confirm your email/i.test(x.subject)); if (ms.length) return ms[ms.length - 1]; await sleep(100); } throw new Error(`no mail for ${to}`); };
const seed = async (base, name, demo = 0) => (await (await fetch(`${base}__test/seed?name=${encodeURIComponent(name)}&demo=${demo}`)).text());
const countsOf = (raw) => { const d = JSON.parse(raw); return { entries: d.sessions.reduce((n, s) => n + s.entries.length, 0), days: new Set(d.sessions.map((s) => s.date)).size, journal: d.wellbeing.journal.length, notes: d.wellbeing.checkins.filter((c) => c.note).length, health: Object.keys(d.health.daily).length }; };
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const api = (page, path, init) => page.evaluate(async ([p, i]) => { const r = await fetch(p, i); return { status: r.status, json: await r.json().catch(() => null) }; }, [path, init]);
const post = (page, path, body = {}) => api(page, path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const accountOf = async (page) => (await api(page, '/api/account')).json.account;
const idOf = async (page) => (await accountOf(page)).user.id;
const cloud = async (page) => (await api(page, '/api/account/backup')).json;
const cloudMeta = async (page) => (await api(page, '/api/account/backup?meta=1')).json.backup;
const ls = (page, key) => page.evaluate((k) => localStorage.getItem(k), key);
const lsKeys = (page) => page.evaluate(() => Object.keys(localStorage).sort());
const setLs = (page, key, value) => page.evaluate(([k, v]) => localStorage.setItem(k, v), [key, value]);
/** Ask the app to write what it holds now (the same path the browser uses when the page closes), so storage can be read without waiting out the save delay. */
const settle = (page) => page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
const planOf = async (page) => {
  await settle(page); const t = await ls(page, `cleanflow:v1@${await idOf(page)}`); return t ? JSON.parse(t) : null; };
const pointsOf = async (page) => { const t = await ls(page, `cleanflow:v1@${await idOf(page)}:backups`); return t ? JSON.parse(t) : []; };
const welcomeVisible = (p) => p.getByRole('heading', { name: 'One calm plan for your home, your body and your day' }).waitFor();
const legacyNotice = (p) => p.getByRole('heading', { name: 'Your earlier data is safe' }).waitFor();
const btn = (page, name) => page.getByRole('button', { name, exact: true });
const region = (page, name) => page.getByRole('region', { name });
const text = (page) => page.locator('main').innerText();

const newAccount = async (page, base, email, after = 'welcome') => {
  await page.goto(base);
  await page.getByRole('button', { name: 'Create an account' }).click();
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PW);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await page.getByRole('heading', { name: 'Check your email' }).waitFor();
  const m = await waitMail(base, email);
  await page.goto(m.text.match(/https?:\/\/\S+/)[0]);
  await (after === 'legacy' ? legacyNotice(page) : welcomeVisible(page));
};
const signIn = async (page, base, email) => {
  await page.goto(base);
  await page.getByRole('heading', { name: 'Sign in', exact: true }).waitFor();
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PW);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
};
const signOutApi = async (page) => { await post(page, '/api/auth/sign-out', {}); };
const goData = async (page, base = A) => {
  await page.goto(`${base}?r=${Date.now()}#/account/data`);
  await page.getByRole('heading', { name: 'Your data and backup', level: 1 }).waitFor();
};
const cloudCard = (page) => region(page, 'Cloud backup (optional)');
const cloudReady = async (page) => { await cloudCard(page).locator('[data-testid=cloud-status], [data-testid=cloud-empty]').first().waitFor(); };
const startTrial = async (page) => { const r = await post(page, '/api/account/trial', {}); if (r.status !== 200) throw new Error(`trial: ${r.status}`); };
/** Put a plan (with the private parts) in this account's storage, as if the person had built it, and load it. */
const putPlan = async (page, base, name, demo = 0) => {
  const raw = JSON.parse(await seed(base, name, demo));
  raw._rev = 1000 + Math.floor(Math.random() * 1000);
  await setLs(page, `cleanflow:v1@${await idOf(page)}`, JSON.stringify(raw));
  return raw;
};
/** Make the browser's storage refuse some writes the way a full or blocked store does (suffix ':backups' matches a key ending that way; anything else is the exact key). */
const failWrites = (page, keys, noRemove = []) => page.evaluate(([ks, nr]) => {
  if (!window.__wrapped) {
    const set = Storage.prototype.setItem; const rem = Storage.prototype.removeItem;
    window.__failKeys = []; window.__noRemove = [];
    Storage.prototype.setItem = function (k, v) { if (window.__failKeys.some((f) => (f.startsWith(':') ? k.endsWith(f) : k === f))) throw new DOMException('full', 'QuotaExceededError'); return set.call(this, k, v); };
    Storage.prototype.removeItem = function (k) { if (window.__noRemove.includes(k)) return undefined; return rem.call(this, k); };
    window.__wrapped = true;
  }
  window.__failKeys = ks; window.__noRemove = nr;
}, [keys, noRemove]);
const reloadClean = async (page) => { await page.reload(); };
const noOverflow = async (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);

// ───────────────────────────── 1. copying data from before accounts into a new account ─────────────────────────────
let legacyRaw = '';
const legacyKey = 'cleanflow:v1';
if (want('link')) {
  const { ctx, page } = await open({ label: 'link' });
  const email = 'link.one@example.test';
  let id = '';
  let entitlementBefore = null;
  await step('a person who used the app before accounts signs up and is offered a way to review and copy the earlier data (not told it is "not available")', async () => {
    await page.goto(A);
    legacyRaw = await seed(A, 'Legacy One', 0);
    await setLs(page, legacyKey, legacyRaw);
    await newAccount(page, A, email, 'legacy');
    const t = await text(page);
    check('says it was not uploaded', /not been touched or uploaded/i.test(t));
    check('no longer says copying is unavailable', !/not available yet/i.test(t));
    check('offers review and copy', (await page.getByRole('button', { name: 'Review and copy it into my account' }).count()) === 1);
    check('offers starting empty', (await page.getByRole('button', { name: 'Continue with an empty plan' }).count()) === 1);
    id = await idOf(page);
  }, page);
  await step('"Review and copy" opens the data screen before any plan exists, and the preview matches the earlier data exactly', async () => {
    await page.getByRole('button', { name: 'Review and copy it into my account' }).click();
    await page.getByRole('heading', { name: 'Your data and backup', level: 1 }).waitFor();
    const c = countsOf(legacyRaw);
    const card = region(page, 'Data from before accounts');
    const prev = card.getByTestId('link-preview');
    await prev.waitFor();
    const t = await prev.innerText();
    check('shows the logged actions and days', t.includes(`${plural(c.entries, 'logged action')} across ${plural(c.days, 'day')}`), t);
    check('shows the private journal separately', t.includes(`Private journal: ${plural(c.journal, 'entry', 'entries')} and ${plural(c.notes, 'check-in note')}`), t);
    check('shows the health readings separately', t.includes(`Health readings: ${plural(c.health, 'day')}`), t);
    check('says copying replaces nothing', /has no plan yet, so copying it replaces nothing/.test(await card.innerText()));
    check('the explanation says what is device-only and what is backed up', /On this device \(always\)/.test(await text(page)) && /Not end-to-end encrypted/.test(await text(page)) && /left out unless you tick each one/.test(await text(page)));
    entitlementBefore = await accountOf(page);
    check('nothing has been written for this account yet', !(await lsKeys(page)).includes(`cleanflow:v1@${id}`), (await lsKeys(page)).join(','));
  }, page);
  await step('cancelling the confirmation changes nothing', async () => {
    const card = region(page, 'Data from before accounts');
    await card.getByRole('button', { name: 'Copy into my account…' }).click();
    const box = card.getByTestId('link-confirm');
    await box.waitFor();
    check('focus moved into the confirmation', await box.evaluate((el) => el.contains(document.activeElement)));
    const t = await box.innerText();
    check('states the restore point, the original staying, no upload, no billing change', /restore point/.test(t) && /original on this device is not changed or deleted/.test(t) && /Nothing is uploaded/.test(t) && /trial and subscription are not touched/.test(t), t);
    await box.getByRole('button', { name: 'Cancel' }).click();
    await box.waitFor({ state: 'detached' });
    check('focus returned to the button that opened it', (await page.evaluate(() => document.activeElement?.textContent)) === 'Copy into my account…');
    check('no account data written', !(await lsKeys(page)).includes(`cleanflow:v1@${id}`));
    check('the earlier data is byte for byte unchanged', (await ls(page, legacyKey)) === legacyRaw);
  }, page);
  await step('refreshing the page in the middle of the confirmation leaves everything as it was, and the choice is still there afterwards', async () => {
    const card = region(page, 'Data from before accounts');
    await card.getByRole('button', { name: 'Copy into my account…' }).click();
    await card.getByTestId('link-confirm').waitFor();
    await page.reload();
    await page.getByRole('heading', { name: 'Your data and backup', level: 1 }).waitFor();
    const again = region(page, 'Data from before accounts');
    await again.getByTestId('link-preview').waitFor();
    check('the confirmation is closed', (await again.getByTestId('link-confirm').count()) === 0);
    check('nothing was written for this account', !(await lsKeys(page)).includes(`cleanflow:v1@${id}`) && !(await lsKeys(page)).includes(`cleanflow:link-intent@${id}`));
    check('the earlier data is untouched', (await ls(page, legacyKey)) === legacyRaw);
    check('the copy is still on offer', (await again.getByRole('button', { name: 'Copy into my account…' }).count()) === 1);
  }, page);
  await step('copying: the account gets the plan, the earlier data is untouched, a restore point exists, nothing is uploaded and billing is not touched', async () => {
    const card = region(page, 'Data from before accounts');
    const mark = page.reqs.length;
    await card.getByRole('button', { name: 'Copy into my account…' }).click();
    await card.getByRole('button', { name: 'Yes, copy it' }).click();
    await card.getByText(/Done\. This account now has your earlier data/).waitFor();
    const sent = page.reqs.slice(mark);
    check('no request touched the trial, billing or the backup', !sent.some((r) => /api\/billing|api\/account\/trial|api\/account\/backup/.test(r)), sent.join(' | '));
    const own = await planOf(page);
    check('the account holds the earlier plan', own && own.user.name === 'Legacy One' && countsOf(JSON.stringify(own)).entries === countsOf(legacyRaw).entries);
    check('with its private parts (they are the same device)', own.wellbeing.journal.length === 2 && Object.keys(own.health.daily).length === 3);
    check('the earlier data is byte for byte unchanged', (await ls(page, legacyKey)) === legacyRaw);
    const pts = await pointsOf(page);
    check('a restore point of the earlier data was kept first', pts.some((p) => p.reason === 'device-copy' && JSON.parse(p.json).user.name === 'Legacy One'), JSON.stringify(pts.map((p) => p.reason)));
    const ks = await lsKeys(page);
    check('no half-finished record is left behind', !ks.includes(`cleanflow:link-intent@${id}`), ks.join(','));
    check('the device remembers which account got the copy', !!(await ls(page, 'cleanflow:legacy-link')) && JSON.parse(await ls(page, 'cleanflow:legacy-link')).accountId === id);
    const after = await accountOf(page);
    check('copying needed no trial and no subscription (this account has neither)', entitlementBefore.entitlement.state === 'eligible-not-started' && entitlementBefore.entitlement.access === 'account-only', JSON.stringify(entitlementBefore.entitlement));
    check('the trial and subscription are exactly as they were', JSON.stringify(after.entitlement) === JSON.stringify(entitlementBefore.entitlement) && after.subscription === null && after.trial === entitlementBefore.trial, JSON.stringify(after.entitlement));
    check('the screen says nothing was uploaded and billing did not change', /Nothing was uploaded/.test(await card.innerText()));
  }, page);
  await step('undo puts the account back as it was and forgets the claim, leaving the earlier data alone; copying again then works', async () => {
    const card = region(page, 'Data from before accounts');
    await card.getByRole('button', { name: 'Undo this copy' }).click();
    await card.getByText(/Undone\. This account is as it was/).waitFor();
    check('the account no longer holds the earlier plan', (await planOf(page)).user.name !== 'Legacy One' && (await planOf(page)).onboardingComplete === false);
    check('the claim is forgotten', (await ls(page, 'cleanflow:legacy-link')) === null);
    check('the earlier data is untouched', (await ls(page, legacyKey)) === legacyRaw);
    check('the restore point of the earlier data is still there', (await pointsOf(page)).some((p) => p.reason === 'device-copy'));
    check('the screen offers the copy again', (await card.getByRole('button', { name: 'Copy into my account…' }).count()) === 1);
    await card.getByRole('button', { name: 'Copy into my account…' }).click();
    await card.getByRole('button', { name: 'Yes, copy it' }).click();
    await card.getByText(/Done\. This account now has your earlier data/).waitFor();
    check('copied again', (await planOf(page)).user.name === 'Legacy One');
  }, page);
  await step('the copied plan is what the app shows, it survives a reload, and the screen then says the account holds exactly this data', async () => {
    await page.goto(`${A}#/today`);
    await page.waitForSelector('.hero-card');
    await page.reload();
    await page.waitForSelector('.hero-card');
    check('still the earlier plan after a reload', (await planOf(page)).user.name === 'Legacy One');
    await goData(page);
    const said = await region(page, 'Data from before accounts').innerText();
    check('the screen says the account already holds this data (or that it was copied and has been used since); it offers no silent copy', /already holds exactly the data/.test(said) || /was copied into this account on/.test(said), said.slice(0, 300));
    check('the device still holds the earlier data, byte for byte', (await ls(page, legacyKey)) === legacyRaw);
  }, page);
  await step('Settings lists the restore points in words and they are restorable', async () => {
    await page.goto(`${A}#/settings`);
    await page.getByRole('heading', { name: 'Settings', level: 1 }).waitFor();
    check('the restore point is described', /copy of the earlier data from this device/.test(await page.locator('main').innerText()));
  }, page);
  await ctx.close();
}

// ───────────────────────────── 2. an account that already has a plan: never replaced silently, and a second account on the same device ─────────────────────────────
if (want('replace')) {
  const { ctx, page } = await open({ label: 'replace' });
  let id = '';
  await page.goto(A);
  const legacy = await seed(A, 'Legacy Two', 1);
  await setLs(page, legacyKey, legacy);
  // Account R1 copies the data first, so account R2 finds it already claimed.
  await newAccount(page, A, 'rep.one@example.test', 'legacy');
  await page.getByRole('button', { name: 'Review and copy it into my account' }).click();
  await page.getByRole('heading', { name: 'Your data and backup', level: 1 }).waitFor();
  await region(page, 'Data from before accounts').getByRole('button', { name: 'Copy into my account…' }).click();
  await region(page, 'Data from before accounts').getByRole('button', { name: 'Yes, copy it' }).click();
  await region(page, 'Data from before accounts').getByText(/Done\. This account now has your earlier data/).waitFor();
  const r1Id = await idOf(page);
  let r1Plan = '';
  await signOutApi(page);

  await step('a second account on the same device is told the data already went into another account, and has to say it understands', async () => {
    await newAccount(page, A, 'rep.two@example.test', 'legacy');
    r1Plan = await ls(page, `cleanflow:v1@${r1Id}`);                    // account one's final state: its app has written everything and been closed
    await page.getByRole('button', { name: 'Continue with an empty plan' }).click();
    await welcomeVisible(page);
    await page.getByText('Beginner: discipline & fitness').first().click();
    await page.waitForSelector('text=Habits & routine');
    id = await idOf(page);
    const own = await planOf(page);
    await goData(page);
    const card = region(page, 'Data from before accounts');
    await card.getByTestId('link-own').waitFor();
    check('both plans are shown side by side', (await card.getByTestId('link-preview').count()) === 1 && (await card.getByTestId('link-own').count()) === 1);
    check('keeping the account’s plan is the selected choice', await card.getByRole('radio', { name: /Keep this account’s plan as it is/ }).isChecked());
    check('there is no copy button while that choice is selected', (await card.getByRole('button', { name: /Replace my plan with my earlier data…/ }).count()) === 0);
    check('the data is flagged as already copied into another account', /already copied into another account on this device/.test(await card.innerText()));
    await card.getByRole('radio', { name: /Replace it with my earlier data/ }).check();
    const go = card.getByRole('button', { name: 'Replace my plan with my earlier data…' });
    check('the button is disabled until the second-copy box is ticked', await go.isDisabled());
    check('nothing changed so far', (await planOf(page)).user.name === own.user.name);
    await card.getByLabel(/I understand that copying it here puts the same data/).check();
    check('now it can be pressed', await go.isEnabled());
  }, page);
  await step('replacing keeps the account’s own plan as a restore point that brings it back from Settings; the other account is untouched', async () => {
    const card = region(page, 'Data from before accounts');
    const ownName = (await planOf(page)).user.name;
    await card.getByRole('button', { name: 'Replace my plan with my earlier data…' }).click();
    check('the confirmation is about replacing', (await card.getByRole('heading', { name: 'Replace this account’s plan?' }).count()) === 1);
    await card.getByRole('button', { name: 'Yes, replace my plan' }).click();
    await card.getByText(/Done\. This account now has your earlier data/).waitFor();
    check('the plan is now the earlier data', (await planOf(page)).user.name === 'Legacy Two');
    const pts = await pointsOf(page);
    const before = pts.find((p) => p.reason === 'before-link');
    check('the account’s previous plan was kept as a restore point', !!before && JSON.parse(before.json).user.name === ownName, JSON.stringify(pts.map((p) => p.reason)));
    check('the other account’s data is exactly as it was', (await ls(page, `cleanflow:v1@${r1Id}`)) === r1Plan);
    await page.goto(`${A}#/settings`);
    await page.getByRole('heading', { name: 'Settings', level: 1 }).waitFor();
    const main = page.locator('main');
    check('the restore point is described in words', /before your earlier data was copied in/.test(await main.innerText()));
    const row = main.locator('div.row', { hasText: 'before your earlier data was copied in' });
    await row.getByRole('button', { name: 'Restore' }).click();
    await page.getByRole('button', { name: 'Restore', exact: true }).last().click();
    await page.getByText('Backup restored.').waitFor();
    check('restoring brings the account’s own plan back', (await planOf(page)).user.name === ownName, (await planOf(page)).user.name);
    check('the earlier data on the device is still untouched', (await ls(page, legacyKey)) === legacy);
  }, page);
  await step('signing back in as the first account shows its own plan, never the second account’s', async () => {
    await signOutApi(page);
    await signIn(page, A, 'rep.one@example.test');
    await page.waitForSelector('.hero-card');
    check('account one’s plan is its own copy of the earlier data', (await planOf(page)).user.name === 'Legacy Two' && (await idOf(page)) === r1Id);
    check('and account two’s restore points and plan are not in it', !JSON.stringify(await pointsOf(page)).includes('before-link'));
  }, page);
  await ctx.close();
}

// ───────────────────────────── 3. copy failures and an interrupted copy ─────────────────────────────
if (want('failures')) {
  const { ctx, page } = await open({ label: 'failures' });
  await page.goto(A);
  const legacy = await seed(A, 'Legacy Three', 2);
  await setLs(page, legacyKey, legacy);
  await newAccount(page, A, 'fail.one@example.test', 'legacy');
  await page.getByRole('button', { name: 'Review and copy it into my account' }).click();
  await page.getByRole('heading', { name: 'Your data and backup', level: 1 }).waitFor();
  const id = await idOf(page);
  const card = () => region(page, 'Data from before accounts');
  await step('if a restore point cannot be kept (storage full), nothing is copied and nothing changes', async () => {
    await failWrites(page, [':backups']);
    await card().getByRole('button', { name: 'Copy into my account…' }).click();
    await card().getByRole('button', { name: 'Yes, copy it' }).click();
    await card().getByText(/not enough room on this device to keep a restore point first/).waitFor();
    check('the account has no data of its own', !(await lsKeys(page)).includes(`cleanflow:v1@${id}`), (await lsKeys(page)).join(','));
    check('no claim and no half-finished record', !(await lsKeys(page)).includes('cleanflow:legacy-link') && !(await lsKeys(page)).includes(`cleanflow:link-intent@${id}`));
    check('the earlier data is untouched', (await ls(page, legacyKey)) === legacy);
    check('a download of the earlier data is offered', (await card().getByRole('button', { name: 'Download my earlier data' }).count()) >= 1);
    check('the message is an alert', (await card().locator('[role=alert]').count()) >= 1);
  }, page);
  await step('with room again, the same copy goes through', async () => {
    await failWrites(page, []);
    await card().getByRole('button', { name: 'Copy into my account…' }).click();
    await card().getByRole('button', { name: 'Yes, copy it' }).click();
    await card().getByText(/Done\. This account now has your earlier data/).waitFor();
    check('the account holds the earlier plan', (await planOf(page)).user.name === 'Legacy Three');
  }, page);
  await step('if the copy cannot be saved, the account’s own plan is put back and the failure is explained', async () => {
    // Undo the copy so there is an account plan to protect, then make the main save fail while restore points still work.
    await card().getByRole('button', { name: 'Undo this copy' }).click();
    await card().getByText(/Undone\./).waitFor();
    await page.goto(`${A}#/`);
    await welcomeVisible(page);
    await page.getByText('Beginner: discipline & fitness').first().click();
    await page.waitForSelector('text=Habits & routine');
    const own = (await planOf(page));
    await goData(page);
    await failWrites(page, [`cleanflow:v1@${id}`]);
    await card().getByRole('radio', { name: /Replace it with my earlier data/ }).check();
    await card().getByRole('button', { name: 'Replace my plan with my earlier data…' }).click();
    await card().getByRole('button', { name: 'Yes, replace my plan' }).click();
    await card().getByText(/could not be saved on this device/).waitFor();
    check('says the previous plan was put back', /previous plan was put back/.test(await card().innerText()));
    await failWrites(page, []);
    check('the stored plan is the account’s own, unchanged', (await planOf(page)).user.name === own.user.name, (await planOf(page)).user.name);
    check('no claim was recorded for the failed copy', (await ls(page, 'cleanflow:legacy-link')) === null);
    await page.goto(`${A}#/today`);
    await page.waitForSelector('text=Habits & routine');
    check('the app still shows the account’s own plan after the failed attempt', (await planOf(page)).user.name === own.user.name);
  }, page);
  await step('after a crash that stopped before anything was written, the next visit says nothing was changed and offers to try again', async () => {
    await failWrites(page, []);
    const own = await planOf(page);
    await setLs(page, `cleanflow:link-intent@${id}`, JSON.stringify({ startedAt: new Date().toISOString(), choice: 'replace', hash: '1:deadbeef', hadOwnPlan: true }));
    await goData(page);
    const card1 = region(page, 'Data from before accounts');
    await card1.getByText(/did not finish\. Nothing was changed/).waitFor();
    check('the account’s plan is as it was', (await planOf(page)).user.id === own.user.id && (await planOf(page)).user.name === own.user.name);
    check('the earlier data is untouched', (await ls(page, legacyKey)) === legacy);
    await card1.getByRole('button', { name: 'OK' }).click();
    check('the notice is gone and the record is cleared', !(await lsKeys(page)).includes(`cleanflow:link-intent@${id}`));
  }, page);
  await step('after a crash that stopped after the copy was written, the next visit says it finished and the device remembers where it went', async () => {
    await page.goto(`${A}#/`);
    // Make the final step of a real copy fail: the claim cannot be written and the intent cannot be removed, which is what a crash right there leaves.
    await page.waitForSelector('text=Habits & routine');
    await goData(page);
    await failWrites(page, ['cleanflow:legacy-link'], [`cleanflow:link-intent@${id}`]);
    const c = region(page, 'Data from before accounts');
    await c.getByRole('radio', { name: /Replace it with my earlier data/ }).check();
    await c.getByRole('button', { name: 'Replace my plan with my earlier data…' }).click();
    await c.getByRole('button', { name: 'Yes, replace my plan' }).click();
    await c.getByText(/Done\./).waitFor();
    await failWrites(page, []);
    check('the intent is still there (the crash left it)', (await lsKeys(page)).includes(`cleanflow:link-intent@${id}`));
    await goData(page);
    const c2 = region(page, 'Data from before accounts');
    await c2.getByText(/A copy that was started earlier did finish/).waitFor();
    check('the claim was recorded from the facts', !!(await ls(page, 'cleanflow:legacy-link')) && JSON.parse(await ls(page, 'cleanflow:legacy-link')).accountId === id);
    await c2.getByRole('button', { name: 'OK' }).click();
    check('the record is cleared once the person has been told', !(await lsKeys(page)).includes(`cleanflow:link-intent@${id}`));
  }, page);
  await ctx.close();
}


// ───────────────────────────── shared pieces for the cloud sections ─────────────────────────────
const patchPlan = async (page, src) => {
  const key = `cleanflow:v1@${await idOf(page)}`;
  await settle(page);
  await page.evaluate(([k, code]) => { const d = JSON.parse(localStorage.getItem(k)); new Function('d', code)(d); d._rev = (d._rev ?? 0) + 5000; localStorage.setItem(k, JSON.stringify(d)); }, [key, src]);
};
const backupNow = async (page, o = {}) => {
  await btn(page, 'Back up now').click();
  const panel = page.getByTestId('backup-panel');
  await panel.waitFor();
  if (o.journal) await panel.getByLabel(/Include my private journal/).check();
  if (o.health) await panel.getByLabel(/Include my health readings/).check();
  return panel;
};
const putReq = (page) => page.waitForRequest((r) => r.method() === 'PUT' && r.url().includes('/api/account/backup'));
const uploadNow = async (page, o = {}) => {
  const panel = await backupNow(page, o);
  const [req] = await Promise.all([putReq(page), panel.getByRole('button', { name: 'Upload this backup' }).click()]);
  await cloudCard(page).getByText(/^Backed up\./).waitFor();
  return JSON.parse(req.postData());
};
const noteOf = (page) => cloudCard(page).locator('[role=status]').first().innerText();
const freshAccount = async (page, email, name, o = {}) => {
  await newAccount(page, A, email);
  if (o.trial !== false) await startTrial(page);
  await putPlan(page, A, name, o.demo ?? 0);
  await goData(page);
  await cloudReady(page);
};

// ───────────────────────────── 4. the cloud backup on one device ─────────────────────────────
if (want('cloud')) {
  const { ctx, page } = await open({ label: 'cloud' });
  await freshAccount(page, 'cloud.one@example.test', 'Cloud One');
  const PRIV = /PRIVATE JOURNAL|PRIVATE NOTE/;
  await step('before any backup: an empty state that says nothing is stored, and the optional, manual nature', async () => {
    const t = await cloudCard(page).innerText();
    check('says there is no cloud backup and nothing is stored', /No cloud backup\./.test(t) && /Nothing from your plan is stored in your account/.test(t));
    check('says it is manual', /nothing is sent unless you press Back up now/.test(t));
    check('offers Back up now, and no restore or delete', (await btn(page, 'Back up now').count()) === 1 && (await btn(page, 'Restore from the cloud').count()) === 0 && (await btn(page, 'Delete my cloud backup').count()) === 0);
    check('no request has uploaded anything', !page.reqs.some((r) => r.startsWith('PUT ')));
  }, page);
  await step('the backup panel opens with the journal and health UNTICKED and a preview that names what stays on the device', async () => {
    const panel = await backupNow(page);
    check('focus moved into the panel', await panel.evaluate((el) => el.contains(document.activeElement)));
    check('the journal is unticked', !(await panel.getByLabel(/Include my private journal/).isChecked()));
    check('health is unticked', !(await panel.getByLabel(/Include my health readings/).isChecked()));
    const pre = await panel.getByTestId('upload-preview').innerText();
    check('the preview says the journal is not uploaded and what stays', /Private journal and check-in notes: not uploaded \(2 entries and 1 note stay on this device\)/.test(pre), pre);
    check('and the same for health', /Health readings: not uploaded \(3 days stay on this device\)/.test(pre), pre);
    check('it says it is the first cloud copy', /first cloud copy/.test(pre));
    check('the choices are described honestly (readable text, not end-to-end encrypted)', /not end-to-end encrypted/.test(await panel.innerText()));
  }, page);
  await step('the default upload sends no private text at all, and what the server stores matches', async () => {
    const panel = page.getByTestId('backup-panel');
    const [req] = await Promise.all([putReq(page), panel.getByRole('button', { name: 'Upload this backup' }).click()]);
    const body = JSON.parse(req.postData());
    check('the request had no base revision and no choices', body.baseRevision === null && body.includes.length === 0, JSON.stringify([body.baseRevision, body.includes]));
    check('the request itself contained none of the private text', !PRIV.test(req.postData()));
    check('nor any health reading', JSON.stringify(body.data.health.daily) === '{}');
    await cloudCard(page).getByText(/^Backed up\./).waitFor();
    const c = await cloud(page);
    check('the server holds revision 1 with no choices', c.backup.revision === 1 && c.backup.includes.length === 0);
    check('and none of the private text', !PRIV.test(JSON.stringify(c.data)) && JSON.stringify(c.data.health.daily) === '{}');
    const own = await planOf(page);
    check('the device still has all of it', own.wellbeing.journal.length === 2 && Object.keys(own.health.daily).length === 3);
    const t = await cloudCard(page).innerText();
    check('the status shows the revision and what it contains', /Revision 1/.test(t) && /plan and history only/.test(t), t);
    check('and that this device is up to date', /This device is up to date with it/.test(t));
    check('restore and delete are now offered', (await btn(page, 'Restore from the cloud').count()) === 1 && (await btn(page, 'Delete my cloud backup').count()) === 1);
  }, page);
  await step('refreshing with the panel open uploads nothing, and the private choices are unticked afterwards', async () => {
    const panel = await backupNow(page, { journal: true, health: true });
    const before = page.reqs.filter((r) => r.startsWith('PUT ')).length;
    await page.reload();
    await cloudReady(page);
    check('the panel is closed', (await page.getByTestId('backup-panel').count()) === 0);
    const reopened = await backupNow(page);
    check('the choices are unticked again', !(await reopened.getByLabel(/Include my private journal/).isChecked()) && !(await reopened.getByLabel(/Include my health readings/).isChecked()));
    check('nothing was uploaded', page.reqs.filter((r) => r.startsWith('PUT ')).length === before);
    await reopened.getByRole('button', { name: 'Cancel' }).click();
    check('the cloud is still revision 1', (await cloudMeta(page)).revision === 1);
    void panel;
  }, page);
  await step('ticking the journal sends exactly the journal and check-in notes, not health; the preview said so first', async () => {
    const panel = await backupNow(page, { journal: true });
    const pre = await panel.getByTestId('upload-preview').innerText();
    check('the preview lists the journal as readable text', /Private journal: 2 entries and 1 check-in note, as readable text/.test(pre), pre);
    check('health is still not uploaded', /Health readings: not uploaded/.test(pre));
    check('it says it replaces revision 1', /replaces the cloud copy \(revision 1/.test(pre));
    const [req] = await Promise.all([putReq(page), panel.getByRole('button', { name: 'Upload this backup' }).click()]);
    const body = JSON.parse(req.postData());
    check('base revision 1, choice journal only', body.baseRevision === 1 && JSON.stringify(body.includes) === '["journal"]');
    check('the journal text is in the request, because it was chosen', /PRIVATE JOURNAL Cloud One one/.test(req.postData()) && /PRIVATE NOTE Cloud One/.test(req.postData()));
    check('health is not', JSON.stringify(body.data.health.daily) === '{}');
    await cloudCard(page).getByText(/^Backed up\./).waitFor();
    const c = await cloud(page);
    check('the server records exactly that choice', c.backup.revision === 2 && JSON.stringify(c.backup.includes) === '["journal"]');
    check('the server holds the journal, not health', /PRIVATE JOURNAL Cloud One two/.test(JSON.stringify(c.data)) && JSON.stringify(c.data.health.daily) === '{}');
  }, page);
  await step('the private choices are unticked again next time, and leaving the journal out warns that it is removed from the cloud', async () => {
    const panel = await backupNow(page);
    check('unticked again', !(await panel.getByLabel(/Include my private journal/).isChecked()));
    const pre = await panel.getByTestId('upload-preview').innerText();
    const warn = await panel.innerText();
    check('warns that the current cloud copy includes the journal and this upload removes it', /current cloud copy includes your journal\. This upload leaves it out, so the journal is removed from the cloud/.test(warn), warn.slice(0, 600));
    void pre;
    const [req] = await Promise.all([putReq(page), panel.getByRole('button', { name: 'Upload this backup' }).click()]);
    check('base revision 2, no choices', JSON.parse(req.postData()).baseRevision === 2 && JSON.parse(req.postData()).includes.length === 0);
    await cloudCard(page).getByText(/^Backed up\./).waitFor();
    const c = await cloud(page);
    check('the journal is gone from the cloud', c.backup.revision === 3 && !PRIV.test(JSON.stringify(c.data)));
    check('and still on the device', (await planOf(page)).wellbeing.journal.length === 2);
  }, page);
  await step('health is its own choice: ticking only health sends the readings and not the journal', async () => {
    const panel = await backupNow(page, { health: true });
    const pre = await panel.getByTestId('upload-preview').innerText();
    check('the preview lists 3 days of health and no journal', /Health readings: 3 days/.test(pre) && /Private journal and check-in notes: not uploaded/.test(pre), pre);
    const [req] = await Promise.all([putReq(page), panel.getByRole('button', { name: 'Upload this backup' }).click()]);
    const body = JSON.parse(req.postData());
    check('choice health only', JSON.stringify(body.includes) === '["health"]' && Object.keys(body.data.health.daily).length === 3 && !PRIV.test(req.postData()));
    await cloudCard(page).getByText(/^Backed up\./).waitFor();
    const c = await cloud(page);
    check('the server holds health only', c.backup.revision === 4 && JSON.stringify(c.backup.includes) === '["health"]' && Object.keys(c.data.health.daily).length === 3 && !PRIV.test(JSON.stringify(c.data)));
  }, page);
  await step('restoring replaces the plan but keeps this device’s journal and notes, which were never in that backup, and keeps a restore point', async () => {
    await patchPlan(page, "d.user.name = 'Local edit'; d.health.daily = {};");
    await goData(page);
    await cloudReady(page);
    await btn(page, 'Restore from the cloud').click();
    const panel = page.getByTestId('restore-panel');
    await panel.getByTestId('restore-effects').waitFor();
    const eff = await panel.getByTestId('restore-effects').innerText();
    check('says the journal on the device stays (it is not in the backup)', /does not contain your journal, so your journal and check-in notes on this device stay as they are \(2 entries, 1 note\)/.test(eff), eff);
    check('says the health readings come from the backup', /health readings on this device \(0 days\) are replaced by the ones in the backup/.test(eff), eff);
    check('says a restore point is kept first, and billing is untouched', /restore point of what is here now is kept first/.test(eff) && /trial and subscription are not touched/.test(eff));
    check('both sides are shown', (await panel.getByTestId('restore-cloud').count()) === 1 && (await panel.getByTestId('restore-device').count()) === 1);
    await panel.getByRole('button', { name: 'Restore to this device' }).click();
    await cloudCard(page).getByText(/^Restored revision 4/).waitFor();
    const own = await planOf(page);
    check('the plan is the cloud copy’s', own.user.name === 'Cloud One', own.user.name);
    check('the journal and notes on this device are still there', own.wellbeing.journal.length === 2 && own.wellbeing.checkins.some((c) => c.note === 'PRIVATE NOTE Cloud One'));
    check('health readings came back from the backup', Object.keys(own.health.daily).length === 3);
    const pts = await pointsOf(page);
    check('a restore point of the previous plan was kept', pts.some((p) => p.reason === 'before-cloud-restore' && JSON.parse(p.json).user.name === 'Local edit'), JSON.stringify(pts.map((p) => p.reason)));
    check('the screen lists the restore point in words', /before restoring from the cloud/.test(await cloudCard(page).innerText()));
    check('the device now remembers revision 4', JSON.parse(await ls(page, `cleanflow:cloud-backup@${await idOf(page)}`)).revision === 4);
  }, page);
  await ctx.close();
}

// ───────────────────────────── 5. two devices on one account: revision conflicts ─────────────────────────────
if (want('devices')) {
  const email = 'dev.one@example.test';
  const one = await open({ label: 'device-1' });
  const p1 = one.page;
  await freshAccount(p1, email, 'Device One');
  await uploadNow(p1);
  const two = await open({ label: 'device-2' });
  const p2 = two.page;
  await step('a second device with an empty plan is told there is a copy it never saw, can look, and cannot overwrite anything', async () => {
    await signIn(p2, A, email);
    await welcomeVisible(p2);
    await goData(p2);
    await cloudReady(p2);
    check('says this device has not seen the copy', /This device has not backed up to, or restored from, this copy/.test(await cloudCard(p2).innerText()));
    await btn(p2, 'Back up now').click();
    const box = p2.getByTestId('conflict-box');
    await box.waitFor();
    const t = await box.innerText();
    check('names what happened', /There is already a cloud copy this device has never seen/.test(t));
    check('shows the cloud copy and this device side by side', (await box.getByTestId('conflict-cloud').count()) === 1 && (await box.getByTestId('conflict-device').count()) === 1);
    await box.getByTestId('conflict-cloud').getByText(/logged action/).waitFor();
    check('the empty plan cannot replace the cloud copy', await box.getByRole('button', { name: 'Replace the cloud copy with this device' }).isDisabled());
    check('there is no plain upload button in a conflict', (await p2.getByRole('button', { name: 'Upload this backup' }).count()) === 0);
    check('the screen warns that an empty plan would replace the cloud copy with nothing', /There is no plan on this device yet/.test(await p2.getByTestId('backup-panel').innerText()));
    await box.getByRole('button', { name: 'Keep the cloud copy (upload nothing)' }).click();
    await p2.getByTestId('backup-panel').waitFor({ state: 'detached' });
    check('the cloud copy is exactly as it was (still revision 1)', (await cloudMeta(p2)).revision === 1);
    check('nothing was sent', !p2.reqs.some((r) => r.startsWith('PUT ')));
  }, p2);
  await step('restoring on the second device brings the first device’s plan over and makes it level with the cloud', async () => {
    await btn(p2, 'Restore from the cloud').click();
    const panel = p2.getByTestId('restore-panel');
    await panel.getByRole('button', { name: 'Restore to this device' }).click();
    await cloudCard(p2).getByText(/^Restored revision 1/).waitFor();
    check('the plan is Device One’s', (await planOf(p2)).user.name === 'Device One');
    check('this device is up to date', /This device is up to date with it/.test(await cloudCard(p2).innerText()));
  }, p2);
  await step('the second device updates the cloud copy (it saw the current revision, so no conflict) and the first device is then told it is out of date', async () => {
    await patchPlan(p2, "d.user.name = 'Device Two edit';");
    await goData(p2);
    await cloudReady(p2);
    await btn(p2, 'Back up now').click();
    check('no conflict on the second device', (await p2.getByTestId('conflict-box').count()) === 0);
    const [req] = await Promise.all([putReq(p2), p2.getByRole('button', { name: 'Upload this backup' }).click()]);
    check('it sent base revision 1', JSON.parse(req.postData()).baseRevision === 1);
    await cloudCard(p2).getByText(/^Backed up\./).waitFor();
    check('the cloud is at revision 2', (await cloudMeta(p2)).revision === 2);
    await btn(p1, 'Check again').click();
    await cloudCard(p1).getByText(/The cloud copy has changed since this device last saw it \(this device saw revision 1\)/).waitFor();
    check('the first device says so', true);
  }, p1);
  await step('on the out-of-date device: both sides are shown, replacing needs an explicit tick, keeps a copy of what it replaces, and only then goes through', async () => {
    await btn(p1, 'Back up now').click();
    const box = p1.getByTestId('conflict-box');
    await box.waitFor();
    const t = await box.innerText();
    check('says what changed, with the revisions', /The cloud copy changed since this device last saw it/.test(t) && /saw revision 1; the cloud now has revision 2/.test(t), t);
    const replace = box.getByRole('button', { name: 'Replace the cloud copy with this device' });
    await box.getByTestId('conflict-cloud').getByText(/logged action/).waitFor();
    check('the replace button is disabled until the tick', await replace.isDisabled());
    await box.getByLabel(/I understand the cloud copy will be replaced/).check();
    check('and enabled after it', await replace.isEnabled());
    const [req] = await Promise.all([putReq(p1), replace.click()]);
    check('the request carries the revision the server currently holds', JSON.parse(req.postData()).baseRevision === 2);
    await cloudCard(p1).getByText(/^Backed up\./).waitFor();
    check('the note says a copy of the replaced cloud backup is kept', /A copy of the cloud backup it replaced is kept on this device as a restore point/.test(await noteOf(p1)));
    const pts = await pointsOf(p1);
    check('that copy really is the other device’s plan, and can be restored', pts.some((p) => p.reason === 'cloud-copy' && JSON.parse(p.json).user.name === 'Device Two edit'), JSON.stringify(pts.map((p) => p.reason)));
    const c = await cloud(p1);
    check('the cloud is now this device’s plan at revision 3', c.backup.revision === 3 && c.data.user.name === 'Device One');
  }, p1);
  await step('a change made elsewhere between opening the panel and pressing Upload is caught by the server, nothing is overwritten, and the choices are shown', async () => {
    await btn(p1, 'Back up now').click();
    await p1.getByTestId('backup-panel').getByRole('button', { name: 'Upload this backup' }).waitFor();
    // Meanwhile the second device uploads (through the same API the screen uses), at revision 4.
    const other = JSON.parse(await ls(p2, `cleanflow:v1@${await idOf(p2)}`));
    const up = await api(p2, '/api/account/backup', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ baseRevision: 3, includes: [], data: other }) });
    check('the other device’s upload was accepted', up.status === 200 && up.json.backup.revision === 4, JSON.stringify(up));
    await p1.getByTestId('backup-panel').getByRole('button', { name: 'Upload this backup' }).click();
    const box = p1.getByTestId('conflict-box');
    await box.waitFor();
    check('says the cloud copy changed and nothing was overwritten', /changed since this device last saw it\. Nothing was overwritten/.test(await cloudCard(p1).innerText()));
    check('the cloud copy is the other device’s upload', (await cloud(p1)).data.user.name === 'Device Two edit' && (await cloudMeta(p1)).revision === 4);
    await box.getByRole('button', { name: 'Restore the cloud copy to this device…' }).click();
    const panel = p1.getByTestId('restore-panel');
    await panel.getByRole('button', { name: 'Restore to this device' }).click();
    await cloudCard(p1).getByText(/^Restored revision 4/).waitFor();
    check('this device now has the cloud copy', (await planOf(p1)).user.name === 'Device Two edit');
    check('and a restore point of what it replaced', (await pointsOf(p1)).some((p) => p.reason === 'before-cloud-restore' && JSON.parse(p.json).user.name === 'Device One'));
  }, p1);
  await one.ctx.close(); await two.ctx.close();
}

// ───────────────────────────── 6. network failures and interrupted operations ─────────────────────────────
if (want('network')) {
  const { ctx, page } = await open({ label: 'network' });
  await freshAccount(page, 'net.one@example.test', 'Net One');
  await uploadNow(page);
  const only = (method, fn) => async (route) => (route.request().method() === method && /\/api\/account\/backup/.test(route.request().url()) ? fn(route) : route.continue());
  await step('a restore that cannot reach the server says so, changes nothing, and works when asked again', async () => {
    const before = (await planOf(page)).user.name;
    await page.route('**/api/account/backup', only('GET', (r) => r.abort('connectionfailed')));
    await btn(page, 'Restore from the cloud').click();
    const panel = page.getByTestId('restore-panel');
    await panel.getByText(/could not be reached, so nothing was restored/).waitFor();
    check('says the device is unchanged', /Your data on this device is unchanged/.test(await panel.innerText()));
    check('the plan is unchanged', (await planOf(page)).user.name === before);
    await page.unroute('**/api/account/backup');
    await panel.getByRole('button', { name: 'Try again' }).click();
    await panel.getByRole('button', { name: 'Restore to this device' }).waitFor();
    await panel.getByRole('button', { name: 'Cancel' }).click();
    check('cancelling leaves everything as it was', (await planOf(page)).user.name === before && (await cloudMeta(page)).revision === 1);
  }, page);
  await step('an upload that never reaches the server says it cannot tell, the cloud is untouched, and the next visit explains the open question', async () => {
    await page.route('**/api/account/backup', only('PUT', (r) => r.abort('connectionfailed')));
    const panel = await backupNow(page);
    await panel.getByRole('button', { name: 'Upload this backup' }).click();
    await panel.getByText(/cannot tell whether the cloud copy was updated/).waitFor();
    check('the panel stays open so nothing is lost', (await panel.count()) === 1);
    check('the cloud copy is still revision 1', (await cloudMeta(page)).revision === 1);
    await page.unroute('**/api/account/backup');
    await goData(page);
    await cloudReady(page);
    const pend = page.getByTestId('pending-upload');
    await pend.waitFor();
    check('the next visit explains that an upload did not report back', /did not report back/.test(await pend.innerText()) && /was not changed/.test(await pend.innerText()));
    await pend.getByRole('button', { name: 'OK' }).click();
    await goData(page);
    await cloudReady(page);
    check('and once acknowledged it does not come back', (await page.getByTestId('pending-upload').count()) === 0);
  }, page);
  await step('an upload the server applied but whose answer was lost: the screen does not claim either outcome; afterwards it shows the real revision and a conflict, not an overwrite', async () => {
    await page.route('**/api/account/backup', only('PUT', async (r) => { await r.fetch(); await r.abort('failed'); }));
    const panel = await backupNow(page);
    await panel.getByRole('button', { name: 'Upload this backup' }).click();
    await panel.getByText(/cannot tell whether the cloud copy was updated/).waitFor();
    check('the server did apply it (revision 2)', (await cloudMeta(page)).revision === 2);
    await page.unroute('**/api/account/backup');
    await goData(page);
    await cloudReady(page);
    check('the next visit says an upload did not report back', (await page.getByTestId('pending-upload').count()) === 1);
    check('and shows the real revision, and that this device has not seen it', /Revision 2/.test(await cloudCard(page).innerText()) && /this device saw revision 1/.test(await cloudCard(page).innerText()));
    await btn(page, 'Back up now').click();
    const box = page.getByTestId('conflict-box');
    await box.waitFor();
    check('another upload is refused as a conflict until the person chooses', (await page.getByRole('button', { name: 'Upload this backup' }).count()) === 0);
    await box.getByRole('button', { name: 'Keep the cloud copy (upload nothing)' }).click();
    await page.getByTestId('pending-upload').getByRole('button', { name: 'OK' }).click();
    check('nothing was uploaded in the meantime', (await cloudMeta(page)).revision === 2);
  }, page);
  await step('a failed check of the cloud copy says so with a way to try again; it never shows an empty state that is not true', async () => {
    await page.route('**/api/account/backup?meta=1', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"code":"boom","message":"SELECT secret FROM user_backups"}}' }));
    await goData(page);
    const card = cloudCard(page);
    await card.getByText(/could not be checked just now/).waitFor();
    check('the server’s own words are not shown', !/SELECT|boom/.test(await card.innerText()));
    check('it does not claim there is no backup', (await card.getByTestId('cloud-empty').count()) === 0);
    check('there is no Back up button while it is unknown', (await btn(page, 'Back up now').count()) === 0);
    await page.unroute('**/api/account/backup?meta=1');
    await card.getByRole('button', { name: 'Try again' }).click();
    await cloudReady(page);
    check('then the real status shows', /Revision 2/.test(await card.innerText()));
  }, page);
  await step('deleting: a failed request leaves the copy where it is and says so; then it works, clears this device’s memory of it, and the cloud is empty', async () => {
    await page.route('**/api/account/backup', only('DELETE', (r) => r.abort('connectionfailed')));
    await btn(page, 'Delete my cloud backup').click();
    const panel = page.getByTestId('delete-panel');
    await panel.getByRole('button', { name: 'Yes, delete the cloud copy' }).click();
    await panel.getByText(/still there/i).waitFor();
    check('the cloud copy is still there', (await cloudMeta(page)) !== null);
    await page.unroute('**/api/account/backup');
    await panel.getByRole('button', { name: 'Yes, delete the cloud copy' }).click();
    await cloudCard(page).getByText(/The cloud backup was deleted from your account/).waitFor();
    check('the cloud has nothing', (await cloudMeta(page)) === null && (await cloud(page)).backup === null);
    check('this device forgot the old revision', (await ls(page, `cleanflow:cloud-backup@${await idOf(page)}`)) === null);
    check('the empty state is shown again', (await cloudCard(page).getByTestId('cloud-empty').count()) === 1);
    check('the plan on this device was not touched', (await planOf(page)).user.name === 'Net One');
    await uploadNow(page);
    check('backing up again works, and the revision carries on (it is never reused)', (await cloudMeta(page)).revision === 3, JSON.stringify(await cloudMeta(page)));
  }, page);
  await ctx.close();
}

// ───────────────────────────── 7. two accounts on one device ─────────────────────────────
if (want('switch')) {
  const { ctx, page } = await open({ label: 'switch' });
  const e1 = 'sw.one@example.test'; const e2 = 'sw.two@example.test';
  await freshAccount(page, e1, 'Switch One');
  await uploadNow(page, { journal: true });
  const id1 = await idOf(page);
  await signOutApi(page);
  let id2 = '';
  await step('a second account on the same browser sees an empty cloud and none of the first account’s data', async () => {
    await freshAccount(page, e2, 'Switch Two');
    id2 = await idOf(page);
    const t = await text(page);
    check('no sign of the first account’s plan or backup on screen', !/Switch One/.test(t));
    check('the second account’s cloud is empty', (await cloudCard(page).getByTestId('cloud-empty').count()) === 1 && (await cloudMeta(page)) === null);
    check('this device has no record for the second account', (await ls(page, `cleanflow:cloud-backup@${await idOf(page)}`)) === null);
    await uploadNow(page);
    const c = await cloud(page);
    check('the second account’s backup is its own plan, with no private text', c.data.user.name === 'Switch Two' && !/PRIVATE/.test(JSON.stringify(c.data)) && c.backup.revision === 1);
    check('the first account’s device records are still under its own key', (await ls(page, `cleanflow:cloud-backup@${id1}`)) !== null && JSON.parse(await ls(page, `cleanflow:cloud-backup@${id1}`)).revision === 1);
    check('the first account’s stored plan is not touched by the second', JSON.parse(await ls(page, `cleanflow:v1@${id1}`)).user.name === 'Switch One');
  }, page);
  await step('signing back in as the first account shows its own backup, its own revision and nothing of the second’s', async () => {
    await signOutApi(page);
    await signIn(page, A, e1);
    await page.waitForSelector('.hero-card');
    await goData(page);
    await cloudReady(page);
    const t = await cloudCard(page).innerText();
    check('its own revision and choices', /Revision 1/.test(t) && /private journal and check-in notes/.test(t), t);
    check('and that this device is up to date with it', /This device is up to date with it/.test(t));
    const c = await cloud(page);
    check('the cloud copy is the first account’s, with its journal because it chose that', c.data.user.name === 'Switch One' && /PRIVATE JOURNAL Switch One/.test(JSON.stringify(c.data)));
    check('nothing of the second account is in this browser view', !JSON.stringify(await planOf(page)).includes('Switch Two') && !(await text(page)).includes('Switch Two'));
  }, page);
  await step('deleting the first account (and erasing its plan from this device) leaves none of its records here, and the second account’s are untouched', async () => {
    await page.goto(`${A}?r=${Date.now()}#/account`);
    await page.getByRole('heading', { name: 'Trial & plans', level: 1 }).waitFor();
    await page.getByRole('button', { name: 'Delete my account…' }).click();
    await page.getByLabel('Your password, to confirm').fill(PW);
    await page.getByLabel(/Also erase this account's plan/).check();
    await page.getByRole('button', { name: 'Delete my account', exact: true }).click();
    await page.getByRole('heading', { name: 'Sign in', exact: true }).waitFor();
    const ks = await lsKeys(page);
    check('no key of the deleted account is left (plan, restore points, backup memory, notes)', !ks.some((k) => k.includes(id1)), ks.filter((k) => k.includes(id1)).join(','));
    check('the second account’s plan and backup memory are still there', ks.includes(`cleanflow:v1@${id2}`) && ks.includes(`cleanflow:cloud-backup@${id2}`), ks.join(','));
  }, page);
  await ctx.close();
}

// ───────────────────────────── 8. local-only mode ─────────────────────────────
if (want('local')) {
  const { ctx, page } = await open({ label: 'local' });
  await step('with no accounts there is no cloud backup, the data screen says so, and the device’s data is untouched', async () => {
    await page.goto(L);
    const raw = await seed(L, 'Local Person', 0);
    await setLs(page, legacyKey, raw);
    page.reqs.length = 0;
    await page.goto(`${L}?r=${Date.now()}#/account/data`);
    await page.getByRole('heading', { name: 'Your data and backup', level: 1 }).waitFor();
    const t = await text(page);
    check('says there are no accounts and nothing is uploaded', /running without accounts here/.test(t) && /nothing is uploaded/.test(t) && /no cloud backup in this setup/.test(t));
    check('offers no backup, restore or copy controls', (await page.getByRole('button').count()) === 0);
    check('no request touched an account or backup endpoint', !page.reqs.some((r) => /api\/account|api\/billing/.test(r)), page.reqs.join(' | '));
    check('the data is byte for byte unchanged', (await ls(page, legacyKey)) === raw);
    await page.goto(`${L}#/settings`);
    await page.getByRole('heading', { name: 'Settings', level: 1 }).waitFor();
    check('Settings has no Account section', (await region(page, 'Account').count()) === 0);
    await page.goto(`${L}#/today`);
    await page.waitForSelector('.hero-card');
    check('the app works as it always did on the original key', (await ls(page, legacyKey)) !== null && JSON.parse(await ls(page, legacyKey)).user.name === 'Local Person');
  }, page);
  await ctx.close();
}

// ───────────────────────────── 9. after the trial ends ─────────────────────────────
if (want('lapse')) {
  const { ctx, page } = await open({ label: 'lapse' });
  await freshAccount(page, 'lapse.one@example.test', 'Lapse One');
  await uploadNow(page);
  await step('when access ends, backing up is not offered, but the copy can still be restored and deleted, and nothing starts a new trial', async () => {
    await fetch(`${A}__test/advance?days=20`);
    await goData(page);
    await cloudReady(page);
    const ent = (await accountOf(page)).entitlement;
    check('the trial really has ended', ent.state === 'trial-expired' && ent.access === 'account-only', JSON.stringify(ent));
    check('says backing up needs an active trial or subscription, and what still works', /Backing up needs an active trial or subscription/.test(await cloudCard(page).innerText()) && /still restore your cloud copy, delete it/.test(await cloudCard(page).innerText()));
    check('Back up now is disabled', await btn(page, 'Back up now').isDisabled());
    check('restore and delete are available', (await btn(page, 'Restore from the cloud').isEnabled()) && (await btn(page, 'Delete my cloud backup').isEnabled()));
    const forced = await api(page, '/api/account/backup', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ baseRevision: 1, includes: [], data: JSON.parse(await ls(page, `cleanflow:v1@${await idOf(page)}`)) }) });
    check('and the server refuses an upload anyway (it, not the screen, decides)', forced.status === 402, String(forced.status));
    await btn(page, 'Restore from the cloud').click();
    await page.getByTestId('restore-panel').getByRole('button', { name: 'Restore to this device' }).click();
    await cloudCard(page).getByText(/^Restored revision 1/).waitFor();
    await btn(page, 'Delete my cloud backup').click();
    await page.getByTestId('delete-panel').getByRole('button', { name: 'Yes, delete the cloud copy' }).click();
    await cloudCard(page).getByText(/The cloud backup was deleted from your account/).waitFor();
    const after = (await accountOf(page)).entitlement;
    check('the entitlement is exactly what it was: nothing was started, extended or reset', JSON.stringify(after) === JSON.stringify(ent), JSON.stringify(after));
  }, page);
  await ctx.close();
}

// ───────────────────────────── 10. layout, keyboard and screen-reader semantics ─────────────────────────────
if (want('layout')) {
  const email = 'lay.one@example.test';
  const first = await open({ label: 'layout-setup' });
  await freshAccount(first.page, email, 'Layout One');
  await uploadNow(first.page);
  await first.ctx.close();
  for (const [w, dark] of [[320, false], [360, false], [390, true], [768, false], [1024, false]]) {
    const { ctx, page } = await open({ label: `layout-${w}`, w, h: w >= 768 ? 900 : 740, dark });
    await signIn(page, A, email);
    await welcomeVisible(page);
    await step(`${w}px${dark ? ' (dark)' : ''}: the data screen, its panels and the conflict view fit without sideways scrolling`, async () => {
      await goData(page);
      await cloudReady(page);
      check('no horizontal scroll on the screen', await noOverflow(page));
      await btn(page, 'Back up now').click();
      await page.getByTestId('conflict-box').waitFor();
      check('no horizontal scroll with the conflict view open', await noOverflow(page));
      await page.screenshot({ path: `e2e-shots/backup-${w}${dark ? '-dark' : ''}.png`, fullPage: true });
      const small = await page.evaluate(() => [...document.querySelectorAll('button, a.btn, input')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.height < 24 || r.width < 24) && e.type !== 'hidden'; }).length);
      check('every control is at least 24px in both directions', small === 0, String(small));
    }, page);
    await ctx.close();
  }
  const { ctx, page } = await open({ label: 'layout-a11y' });
  await signIn(page, A, email);
  await welcomeVisible(page);
  await step('headings, regions, names and keyboard use', async () => {
    await goData(page);
    await cloudReady(page);
    const heads = await page.$$eval('h1, h2, h3', (hs) => hs.map((h) => `${h.tagName}:${h.textContent.trim()}`));
    check('one h1 first, then the cards as h2', heads[0] === 'H1:Your data and backup' && heads.filter((h) => h.startsWith('H1')).length === 1 && heads.includes('H2:Where your data is') && heads.includes('H2:Data from before accounts') && heads.includes('H2:Cloud backup (optional)'), heads.join(' | '));
    check('each card is a named region', (await region(page, 'Where your data is').count()) === 1 && (await region(page, 'Cloud backup (optional)').count()) === 1);
    const unnamed = await page.$$eval('button, a[href], input, select, textarea', (els) => els.filter((e) => e.type !== 'hidden' && !(e.getAttribute('aria-label') || (e.textContent ?? '').trim() || (e.labels && e.labels.length) || e.getAttribute('aria-labelledby'))).length);
    check('every control has a name', unnamed === 0, String(unnamed));
    check('the screen has one main landmark and a status region for messages', (await page.locator('main').count()) === 1 && (await page.locator('[role=status]').count()) >= 1);
    // Keyboard: Tab until Back up now has focus, open it with Enter, and focus lands inside the panel; Tab reaches the choices in order.
    let reached = false;
    for (let i = 0; i < 60 && !reached; i++) { await page.keyboard.press('Tab'); reached = (await page.evaluate(() => document.activeElement?.textContent?.trim())) === 'Back up now'; }
    check('Back up now can be reached with the keyboard', reached);
    await page.keyboard.press('Enter');
    const panel = page.getByTestId('conflict-box');
    await panel.waitFor();
    check('focus moved into the panel', await page.getByTestId('backup-panel').evaluate((el) => el.contains(document.activeElement)));
    await page.keyboard.press('Tab');
    check('the first thing Tab reaches is the first choice (the journal)', (await page.evaluate(() => document.activeElement?.getAttribute('type'))) === 'checkbox' && /private journal/i.test(await page.evaluate(() => document.activeElement?.closest('label')?.textContent ?? '')));
    await page.keyboard.press('Space');
    check('Space ticks it and the preview follows', /Private journal: 1 entry and 1 check-in note|Private journal: \d+ entr/.test(await page.getByTestId('upload-preview').innerText()));
  }, page);
  await ctx.close();
}

await browser.close();
await Promise.all(servers.map(stopServer));
done(errors);
process.exit(process.exitCode ?? 0);
