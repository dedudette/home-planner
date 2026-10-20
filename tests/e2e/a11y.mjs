// An accessibility and layout sweep of the Stage 6 screens (accounts, trial and plans, subscription, the paused-planner screen, data & backup)
// in a real Chromium, at narrow and wide widths, in light and dark, with reduced motion and with 200% text.
//
// What this IS: automated checks (axe-core 4 against the WCAG 2.0/2.1/2.2 A and AA rules it implements, including colour contrast and target
// size), a keyboard walk (every control reachable with Tab, a visible focus indicator on every stop, no trap), layout (no sideways scroll,
// controls at least 24 CSS pixels), page structure (one main landmark, one h1, no skipped heading levels), and emulated user preferences
// (dark colour scheme, reduced motion, 200% text size).
// What this is NOT: a screen-reader test. No NVDA, JAWS, VoiceOver or TalkBack was run, and no real phone or tablet was used. axe-core cannot
// judge everything (reading order, meaningful link text, whether a message makes sense when spoken); that needs a person with assistive
// technology. This suite says what an automated engine and a keyboard can see, and nothing more.
//
// Servers (tests/e2e/accountsServer.ts): A = accounts mode; B = accounts with a MOCK payment provider (the real Stripe SDK against a local
// stand-in; nothing here contacts Stripe or takes a payment).
//
//   npm run build && npm run e2e:a11y        (needs the PostgreSQL server binaries; see scripts/test-db.sh)
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { launch, OUT, runner, watch } from './lib.mjs';

const require = createRequire(import.meta.url);
const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const P = Number(process.env.E2E_PORT ?? 18900);
const A = `http://127.0.0.1:${P}/`;
const B = `http://127.0.0.1:${P + 1}/`;
const { check, step, done } = runner('a11y');
const errors = [];
const only = (process.env.E2E_ONLY ?? '').split(',').filter(Boolean);

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
  servers.push(await start(P + 1, { E2E_BILLING: 'fake' }));
  browser = await launch();
} catch (e) { console.log(`FAIL setup: ${e.message}`); await Promise.all(servers.map(stopServer)); process.exit(1); }
const watchdog = setTimeout(async () => { console.log('FAIL watchdog: the suite ran longer than allowed'); await Promise.all(servers.map(stopServer)); process.exit(1); }, Number(process.env.E2E_WATCHDOG_MS ?? 840000));

const PW = 'correct horse battery';
let ipn = 30;
let acct = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CONFIGS = [
  { name: '320px light', w: 320, h: 640 },
  { name: '390px dark, reduced motion', w: 390, h: 844, dark: true, reduced: true },
  { name: '768px light', w: 768, h: 1024 },
  { name: '1024px dark', w: 1024, h: 768, dark: true },
  { name: '320px, text 200%', w: 320, h: 640, large: true },
].filter((c) => only.length === 0 || only.some((o) => c.name.startsWith(o)));

const open = async (cfg) => {
  const ctx = await browser.newContext({ viewport: { width: cfg.w, height: cfg.h }, isMobile: cfg.w < 600, hasTouch: cfg.w < 600, locale: 'en-US', timezoneId: 'UTC', colorScheme: cfg.dark ? 'dark' : 'light', reducedMotion: cfg.reduced ? 'reduce' : 'no-preference', acceptDownloads: true, extraHTTPHeaders: { 'x-forwarded-for': `10.6.${++ipn}.1` } });
  if (cfg.large) await ctx.addInitScript(() => { const add = () => { const s = document.createElement('style'); s.textContent = 'html { font-size: 200% !important; }'; document.head.appendChild(s); }; if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add); else add(); });
  await ctx.route(/^https:\/\/(checkout|billing)\.stripe\.test\//, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Mock provider page</title><p>Mock provider page</p>' }));
  const page = await ctx.newPage();
  watch(page, errors, cfg.name);
  return { ctx, page };
};

/** Everything checked on every screen. `name` says which screen, `cfg` which configuration. */
const audit = async (page, cfg, name) => {
  const label = `${cfg.name} · ${name}`;
  // 1. axe-core, WCAG 2.x A and AA (including colour contrast and target size)
  await page.evaluate(AXE);
  const violations = await page.evaluate(async () => {
    const r = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] }, resultTypes: ['violations'] });
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.slice(0, 3).map((n) => `${n.target.join(' ')} :: ${(n.failureSummary ?? '').split('\n').slice(1, 3).join(' ').slice(0, 160)}`) }));
  });
  check(`${label}: no axe-core violations (WCAG 2.x A/AA)`, violations.length === 0, JSON.stringify(violations).slice(0, 700));
  // 2. layout
  const lay = await page.evaluate(() => {
    const visible = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
    const small = [...document.querySelectorAll('button, a.btn, [role=button]')].filter((e) => visible(e) && !e.closest('[hidden]')).filter((e) => { const r = e.getBoundingClientRect(); return r.width < 24 || r.height < 24; }).map((e) => `${e.tagName.toLowerCase()}${e.id ? `#${e.id}` : ''} ${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)} "${(e.textContent ?? '').trim().slice(0, 30)}"`);
    const cut = [...document.querySelectorAll('body *')].filter((e) => visible(e) && e.getBoundingClientRect().right > document.documentElement.clientWidth + 1 && !e.closest('.sr-only, [aria-hidden="true"]') && getComputedStyle(e).position !== 'fixed').slice(0, 4).map((e) => `${e.tagName.toLowerCase()}.${String(e.className).slice(0, 40)} right=${Math.round(e.getBoundingClientRect().right)} ${e.outerHTML.slice(0, 90).replace(/\s+/g, " ")}`);
    return { overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1, small, cut };
  });
  check(`${label}: no sideways scrolling and nothing cut off on the right`, !lay.overflow && lay.cut.length === 0, JSON.stringify(lay));
  check(`${label}: every button is at least 24 × 24 CSS pixels (axe-core checks the rest of WCAG 2.2 target size)`, lay.small.length === 0, lay.small.join(' | '));
  // 3. structure
  const st = await page.evaluate(() => {
    const hs = [...document.querySelectorAll('h1, h2, h3, h4, h5, h6')].filter((h) => h.getBoundingClientRect().width > 0 || h.closest('.sr-only'));
    const levels = hs.map((h) => Number(h.tagName[1]));
    let skip = false; for (let i = 1; i < levels.length; i++) if (levels[i] > levels[i - 1] + 1) skip = true;
    return { mains: document.querySelectorAll('main').length, h1: levels.filter((l) => l === 1).length, skip, levels: levels.join('') };
  });
  check(`${label}: one main landmark, one level-1 heading, no skipped heading levels`, st.mains === 1 && st.h1 === 1 && !st.skip, JSON.stringify(st));
  // 4. preferences really applied
  const pref = await page.evaluate(() => ({ dark: matchMedia('(prefers-color-scheme: dark)').matches, reduce: matchMedia('(prefers-reduced-motion: reduce)').matches, bg: getComputedStyle(document.body).backgroundColor, anim: document.getAnimations().filter((a) => a.playState === 'running' && Number(a.effect?.getComputedTiming().duration ?? 0) > 1).length }));
  const lum = (rgb) => { const m = rgb.match(/\d+(\.\d+)?/g)?.map(Number) ?? [255, 255, 255]; return (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255; };
  check(`${label}: the ${cfg.dark ? 'dark' : 'light'} colour scheme is what is drawn`, pref.dark === !!cfg.dark && (cfg.dark ? lum(pref.bg) < 0.4 : lum(pref.bg) > 0.6), JSON.stringify(pref));
  if (cfg.reduced) check(`${label}: with reduced motion requested nothing is animating`, pref.reduce && pref.anim === 0, JSON.stringify(pref));
  // 5. keyboard: Tab through everything
  const kb = await keyboardWalk(page);
  check(`${label}: every control can be reached with Tab (${kb.reached}/${kb.tabbable})`, kb.missed.length === 0, kb.missed.join(' | '));
  check(`${label}: every Tab stop shows where focus is`, kb.noRing.length === 0, kb.noRing.join(' | '));
  check(`${label}: Tab never gets stuck`, !kb.trap, kb.trap ?? '');
};

const keyboardWalk = async (page) => {
  // Start from the very top of the page: Tab continues from wherever focus last was, so put a throwaway stop before everything else.
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    const s = document.createElement('span'); s.id = '__walk-start'; s.tabIndex = -1; document.body.prepend(s); s.focus();
  });
  const keyOf = `(e) => (e.id && !e.id.startsWith('__') ? '#' + e.id : e.tagName.toLowerCase() + ':' + ((e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 30)))`;
  const tabbable = await page.evaluate((k) => {
    const keyOf = eval(k);
    const vis = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
    return [...document.querySelectorAll('a[href], button, input, select, textarea, [tabindex]')].filter((e) => !e.disabled && e.tabIndex >= 0 && vis(e) && !e.closest('[inert]') && !e.matches('.sr-only')).map(keyOf);
  }, keyOf);
  const seen = new Set(); const noRing = []; let trap = null; let prev = null; let same = 0;
  for (let i = 0; i < tabbable.length + 6; i++) {
    await page.keyboard.press('Tab');
    const cur = await page.evaluate(async (k) => {
      const keyOf = eval(k);
      const e = document.activeElement;
      if (!e || e === document.body) return null;
      // A focus ring may be fading in (a CSS transition): read it once the control's own animations have finished, not at their first frame.
      await Promise.allSettled(e.getAnimations().map((a) => a.finished));
      const cs = getComputedStyle(e);
      const ring = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || (cs.boxShadow && cs.boxShadow !== 'none');
      const sr = e.matches('.sr-only');
      return { key: keyOf(e), ring: !!ring || sr };
    }, keyOf);
    if (!cur) break;                                                    // focus left the page's controls: the walk is complete
    if (cur.key === prev) { same++; if (same >= 3) { trap = cur.key; break; } } else same = 0;
    prev = cur.key; seen.add(cur.key);
    if (!cur.ring) noRing.push(cur.key);
  }
  await page.evaluate(() => document.getElementById('__walk-start')?.remove());
  // A control that went away on its own while the walk was under way (a message that dismisses itself) is not a control that could not be reached.
  const gone = await page.evaluate((k) => {
    const keyOf = eval(k);
    const now = new Set([...document.querySelectorAll('a[href], button, input, select, textarea, [tabindex]')].map(keyOf));
    return [...now];
  }, keyOf);
  const missed = tabbable.filter((k) => !seen.has(k) && gone.includes(k));
  return { tabbable: tabbable.length, reached: tabbable.length - missed.length, missed, noRing: [...new Set(noRing)], trap };
};

const mail = async (base, to) => (await (await fetch(`${base}__test/mail?to=${encodeURIComponent(to.toLowerCase())}`)).json());
const waitMail = async (base, to) => { for (let i = 0; i < 40; i++) { const ms = (await mail(base, to)).filter((x) => /confirm your email/i.test(x.subject)); if (ms.length) return ms[ms.length - 1]; await sleep(100); } throw new Error(`no mail for ${to}`); };
const api = (page, path, init) => page.evaluate(async ([p, i]) => { const r = await fetch(p, i); return { status: r.status, json: await r.json().catch(() => null) }; }, [path, init]);
const post = (page, path, body = {}) => api(page, path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const seedPlan = async (base, name) => (await fetch(`${base}__test/seed?name=${encodeURIComponent(name)}&demo=1`)).text();
const h1Text = (page) => page.locator('h1').first().innerText();
const welcomeVisible = (p) => p.getByRole('heading', { name: 'One calm plan for your home, your body and your day' }).waitFor();
const tick = async (page, name, cfg) => step(`${cfg.name} · ${name}`, async () => { await audit(page, cfg, name); }, page);

// ───────────────────────────── the tour of server A (no payment provider) ─────────────────────────────
for (const cfg of CONFIGS) {
  const { ctx, page } = await open(cfg);
  const email = `a11y.a${++acct}@example.test`;
  const legacy = await seedPlan(A, 'Earlier Plan');
  try {
    await page.goto(A);
    await page.evaluate((raw) => localStorage.setItem('cleanflow:v1', raw), legacy);          // data from before accounts, so the copy screens appear
    await page.reload();
    await page.getByRole('heading', { name: 'Sign in', exact: true }).waitFor();
    await tick(page, 'sign in', cfg);
    await page.getByRole('button', { name: 'Forgot your password?' }).click();
    await page.getByRole('heading', { name: /password/i, level: 1 }).waitFor();
    await tick(page, 'forgot password', cfg);
    await page.goto(A);
    await page.getByRole('button', { name: 'Create an account' }).click();
    await page.getByRole('heading', { name: 'Create your account' }).waitFor();
    await tick(page, 'create account', cfg);
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    await page.locator('[role=alert]').first().waitFor();
    await tick(page, 'create account with errors shown', cfg);
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByLabel('Password', { exact: true }).fill(PW);
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    await page.getByRole('heading', { name: 'Check your email' }).waitFor();
    await tick(page, 'check your email', cfg);
    const m = await waitMail(A, email);
    await page.goto(m.text.match(/https?:\/\/\S+/)[0]);
    await page.getByRole('heading', { name: 'Your earlier data is safe' }).waitFor();
    await tick(page, 'earlier data notice', cfg);
    await page.getByRole('button', { name: 'Review and copy it into my account' }).click();
    await page.getByRole('heading', { name: 'Your data and backup', level: 1 }).waitFor();
    await page.getByTestId('link-preview').waitFor();
    await page.getByRole('heading', { name: 'Cloud backup (optional)' }).waitFor();
    await tick(page, 'data & backup before the planner is open (earlier data on offer)', cfg);
    await page.getByRole('button', { name: 'Copy into my account…' }).click();
    await page.getByTestId('link-confirm').waitFor();
    await tick(page, 'confirming the copy of earlier data', cfg);
    await page.getByTestId('link-confirm').getByRole('button', { name: 'Cancel' }).click();
    await page.evaluate(() => { location.hash = '#/account'; });
    await page.getByTestId('planner-paused').waitFor();
    await page.getByRole('heading', { name: 'Your account', exact: true }).waitFor();
    await tick(page, 'Trial & plans, planner paused (no trial yet)', cfg);
    await page.getByRole('button', { name: 'Change password' }).click();
    await page.getByRole('heading', { name: 'Change password' }).waitFor();
    await tick(page, 'change password form', cfg);
    await page.getByRole('button', { name: 'Cancel' }).first().click();
    await page.getByRole('button', { name: 'Delete my account…' }).click();
    await page.getByLabel('Your password, to confirm').waitFor();
    await tick(page, 'delete account form', cfg);
    await page.getByRole('button', { name: 'Cancel' }).last().click();
    await page.getByRole('checkbox').check();
    await tick(page, 'trial consent ticked', cfg);
    await page.getByRole('button', { name: /^Start my 14-day trial$/ }).click();
    await page.getByText('Your free trial is active.').waitFor();
    await page.evaluate(() => { location.hash = '#/'; });
    await welcomeVisible(page);
    await tick(page, 'welcome (signed-in bar, planner open)', cfg);
    await page.getByText('Beginner: discipline & fitness').first().click();
    await page.waitForSelector('text=Habits & routine');
    await page.evaluate(() => { location.hash = '#/settings'; });
    await page.getByRole('heading', { name: 'Settings', level: 1 }).waitFor();
    await page.getByRole('region', { name: 'Account' }).waitFor();
    await tick(page, 'Settings with the account section', cfg);
    await page.evaluate(() => { location.hash = '#/account'; });
    await page.getByRole('heading', { name: 'Trial & plans', level: 1 }).waitFor();
    await page.getByText('Your free trial is active.').waitFor();
    await tick(page, 'Trial & plans, trial running', cfg);
    // a cloud copy that this device never saw, so the conflict view appears
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    const id = (await api(page, '/api/account')).json.account.user.id;
    const plan = JSON.parse(await page.evaluate((k) => localStorage.getItem(k), `cleanflow:v1@${id}`));
    const put = await api(page, '/api/account/backup', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ baseRevision: null, includes: [], data: plan }) });
    check(`${cfg.name}: a cloud copy for the conflict view was made`, put.status === 200, String(put.status));
    await page.evaluate(() => { location.hash = '#/account/data'; });
    await page.getByRole('heading', { name: 'Your data and backup', level: 1 }).waitFor();
    await page.getByTestId('cloud-status').waitFor();
    await tick(page, 'Data & backup with a plan and a cloud copy', cfg);
    await page.getByRole('button', { name: 'Back up now' }).click();
    await page.getByTestId('conflict-box').waitFor();
    await page.getByTestId('conflict-cloud').getByText(/logged action/).waitFor();
    await tick(page, 'backup panel with a revision conflict', cfg);
    await page.getByRole('button', { name: 'Keep the cloud copy (upload nothing)' }).click();
    await page.getByRole('button', { name: 'Delete my cloud backup' }).click();
    await page.getByTestId('delete-panel').waitFor();
    await tick(page, 'delete cloud backup confirmation', cfg);
    await page.getByRole('button', { name: 'Keep it' }).click();
    await page.getByRole('button', { name: 'Restore from the cloud' }).click();
    await page.getByTestId('restore-effects').waitFor();
    await tick(page, 'restore preview', cfg);
    await page.getByTestId('restore-panel').getByRole('button', { name: 'Cancel' }).click();
    // offline: the note, then the "cannot confirm" screen
    await page.evaluate(() => { location.hash = '#/today'; });
    await page.waitForSelector('.app');
    await page.route('**/api/account', (r) => r.abort('connectionfailed'));
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.locator('.access-note').waitFor();
    await tick(page, 'planner open with the offline note', cfg);               // every configuration, 320 px with 200% text included

    await page.unroute('**/api/account');
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.locator('.access-note').waitFor({ state: 'detached' });
  } catch (e) { check(`${cfg.name}: the tour of server A ran to the end`, false, String(e.message).split('\n').slice(0, 3).join(' | ')); await page.screenshot({ path: `${OUT}/a11y-fail-${cfg.name.replace(/\W+/g, '_')}.png` }).catch(() => undefined); }
  await ctx.close();
}

// ───────────────────────────── the tour of server B (mock payment provider) ─────────────────────────────
for (const cfg of CONFIGS) {
  const { ctx, page } = await open(cfg);
  const email = `a11y.b${++acct}@example.test`;
  try {
    await page.goto(B);
    await page.getByRole('button', { name: 'Create an account' }).click();
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByLabel('Password', { exact: true }).fill(PW);
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    await page.getByRole('heading', { name: 'Check your email' }).waitFor();
    const m = await waitMail(B, email);
    await page.goto(m.text.match(/https?:\/\/\S+/)[0]);
    await page.getByTestId('planner-paused').waitFor();
    await page.getByRole('heading', { name: 'Choose a plan' }).waitFor();
    await tick(page, 'plans on offer, nothing chosen', cfg);
    await page.getByRole('radio', { name: /Annual/ }).check();
    await page.getByText(/You are charged/).waitFor();
    await tick(page, 'a plan chosen, the exact charge stated', cfg);
    const r = await post(page, '/api/billing/checkout', { plan: 'monthly' });
    const sid = r.json.url.split('/').pop();
    await fetch(`${B}__test/complete?session=${sid}`);
    await post(page, '/api/billing/sync', { sessionId: sid });
    await page.goto(`${B}?r=${Date.now()}#/account`);
    await page.getByRole('heading', { name: 'Your subscription', exact: true }).waitFor();
    await page.getByRole('heading', { name: 'AI allowance' }).waitFor();
    await tick(page, 'Trial & plans with an active subscription and the AI allowance', cfg);
    await page.getByRole('button', { name: 'Cancel at period end' }).click();
    await page.getByRole('heading', { name: 'Cancel at the end of this period?' }).waitFor();
    await tick(page, 'cancel at period end confirmation', cfg);
    await page.getByRole('button', { name: 'Keep my subscription' }).click();
    await fetch(`${B}__test/provider?email=${encodeURIComponent(email)}&op=unpaid`);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.getByTestId('planner-paused').waitFor();
    await page.getByRole('heading', { name: 'Your planner is paused' }).waitFor();
    await tick(page, 'planner paused after a payment problem', cfg);
  } catch (e) { check(`${cfg.name}: the tour of server B ran to the end`, false, String(e.message).split('\n').slice(0, 3).join(' | ')); await page.screenshot({ path: `${OUT}/a11y-fail-b-${cfg.name.replace(/\W+/g, '_')}.png` }).catch(() => undefined); }
  await ctx.close();
}

clearTimeout(watchdog);
await browser.close();
await Promise.all(servers.map(stopServer));
done(errors);
process.exit(process.exitCode ?? 0);
