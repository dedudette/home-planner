// Layout checks at every target width: no horizontal overflow on any screen, sheets and dialogs stay inside the viewport,
// the recovery screen and onboarding fit, and the accessibility rules we have broken before stay fixed.
import { BASE, DEMOS, OUT, WIDTHS, auditPage, fresh, launch, loadDemo, newContext, runner, watch } from './lib.mjs';

const { check, step, done } = runner('responsive');
const browser = await launch();
const errors = [];
const ROUTES_BOTH = ['today', 'plan', 'plan?tab=rooms', 'plan?tab=deep', 'schedule', 'progress', 'home', 'supplies', 'settings', 'more'];
const ROUTES_LIFE = ['today', 'plan', 'schedule', 'progress', 'home', 'settings', 'more'];

const verdict = (label, a) => {
  const problems = [];
  if (a.docOverflow > 0) problems.push(`page is ${a.docOverflow}px wider than the screen`);
  if (a.wide.length) problems.push(`wider than the screen: ${a.wide.join(', ')}`);
  if (a.navOverflow > 0) problems.push(`bottom nav overflows by ${a.navOverflow}px`);
  if (a.badAria.length) problems.push(`aria-pressed on radio/tab: ${a.badAria[0]}`);
  if (a.skips.length) problems.push('heading levels are skipped');
  if (a.unnamed.length) problems.push(`unnamed control: ${a.unnamed[0]}`);
  check(label, problems.length === 0, problems.join('; '));
};

for (const size of WIDTHS) {
  const label = `${size.w}px`;
  // ── a household with habits (cleaning + habits) ──
  {
    const ctx = await newContext(browser, size); const page = await ctx.newPage(); watch(page, errors, label);
    await page.clock.setFixedTime(new Date(2026, 9, 5, 8, 15));
    await loadDemo(page, DEMOS.student);
    for (const r of ROUTES_BOTH) {
      await step(`${label} ${r}`, async () => {
        await page.evaluate((x) => (location.hash = '#/' + x), r); await page.waitForTimeout(250);
        verdict(`${label} · ${r} has no overflow and passes the a11y rules`, await page.evaluate(auditPage));
      }, page);
    }
    await step(`${label} sheets stay inside the screen`, async () => {
      await page.evaluate(() => (location.hash = '#/today')); await page.waitForTimeout(200);
      await page.locator('.task-body').first().click(); await page.waitForSelector('.sheet-foot');
      verdict(`${label} · task detail sheet`, await page.evaluate(auditPage));
      await page.getByRole('dialog').getByRole('button', { name: 'Start timer' }).click(); await page.waitForSelector('text=Start a timer');
      verdict(`${label} · timer picker`, await page.evaluate(auditPage));
      await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
      // a demo is throwaway and replaced without ceremony; make this one look like the user's own data
      await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('cleanflow:v1')); d.user.demo = false; localStorage.setItem('cleanflow:v1', JSON.stringify(d)); });
      await page.reload(); await page.waitForSelector('text=Habits & routine');
      await page.evaluate(() => (location.hash = '#/settings')); await page.waitForSelector('text=Try a demo');
      await page.locator('.demo-card').nth(2).click(); await page.waitForSelector('text=Replace your data with a demo?');
      verdict(`${label} · confirm dialog`, await page.evaluate(auditPage));
      const m = await page.evaluate(() => [...document.querySelectorAll('.sheet-foot .btn')].map((b) => { const r = b.getBoundingClientRect(); return [r.left, r.right, document.documentElement.clientWidth]; }));
      check(`${label} · confirm dialog buttons inside the screen`, m.every(([l, r, vw]) => l >= -0.5 && r <= vw + 0.5), JSON.stringify(m));
      await page.keyboard.press('Escape');
    }, page);
    if (size.w === 360 || size.w === 1024) await page.screenshot({ path: `${OUT}/resp-${size.w}-settings.png` });
    await ctx.close();
  }
  // ── the states added for budget honesty, goal coverage and storage safety ──
  {
    const ctx = await newContext(browser, size); const page = await ctx.newPage(); watch(page, errors, label + ' new');
    await page.clock.setFixedTime(new Date(2026, 9, 5, 8, 15));
    await loadDemo(page, DEMOS.student);
    const patch = (src) => page.evaluate((s) => { const d = JSON.parse(localStorage.getItem('cleanflow:v1')); new Function('d', s)(d); d.user.demo = false; d._rev = (d._rev ?? 0) + 100; localStorage.setItem('cleanflow:v1', JSON.stringify(d)); }, src);
    const buttonsInside = async (what) => {
      const m = await page.evaluate(() => [...document.querySelectorAll('.sheet-foot .btn')].map((b) => { const r = b.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right), document.documentElement.clientWidth, Math.round(r.height)]; }));
      check(`${label} · ${what}: buttons inside the screen and at least 44px tall`, m.length > 0 && m.every(([l, r, vw, h]) => l >= -0.5 && r <= vw + 0.5 && h >= 44), JSON.stringify(m));
    };
    await step(`${label} tight day: left-out tasks, goal coverage detail, Tomorrow and week with budgets`, async () => {
      await patch("d.preferences.focus=['home','active','discipline','morning','evening','focus','phone','selfcare','study']; d.preferences.sessionMinutes=10; d.preferences.daysPerWeek=7;");
      await page.reload(); await page.waitForSelector('.hero-card');
      verdict(`${label} · Today on a 10-minute day`, await page.evaluate(auditPage));
      await page.getByRole('button', { name: /more, left out of today/ }).first().click(); await page.waitForTimeout(150);
      verdict(`${label} · Today with the left-out list open`, await page.evaluate(auditPage));
      await page.evaluate(() => (location.hash = '#/plan')); await page.waitForSelector('[data-testid=goal-coverage]'); await page.waitForTimeout(200);
      verdict(`${label} · Plan with the goal detail`, await page.evaluate(auditPage));
      await page.evaluate(() => (location.hash = '#/schedule')); await page.waitForSelector('[role=tablist]');
      for (const tab of ['Tomorrow', 'This week']) { await page.getByRole('tab', { name: tab }).click(); await page.waitForTimeout(200); verdict(`${label} · Schedule ${tab}`, await page.evaluate(auditPage)); }
    }, page);
    await step(`${label} a long history: the "make room" question, and Settings' storage row`, async () => {
      await patch(`const real = d.sessions.flatMap((s) => s.entries); const ss = []; let n = 0;
        for (let day = 0; day < 2900; day++) { const dt = new Date(Date.UTC(2019, 0, 1 + day)).toISOString().slice(0, 10); const es = [];
          for (let k = 0; k < 4; k++, n++) { const src = real[n % real.length]; es.push({ ...src, id: 'big' + n, date: dt, at: dt + 'T0' + (6 + k) + ':00:00.000Z' }); }
          ss.push({ id: 'bs' + day, date: dt, startedAt: es[0].at, endedAt: es[3].at, entries: es }); }
        d.sessions = ss; d.preferences.focus = ['home','discipline']; d.preferences.sessionMinutes = 30;`);
      await page.evaluate(() => (location.hash = '#/today')); await page.reload();
      await page.waitForSelector('text=Make room by removing the oldest history?');
      verdict(`${label} · the make-room question`, await page.evaluate(auditPage));
      await buttonsInside('make-room question');
      await page.getByRole('button', { name: 'Not now' }).click();
      await page.evaluate(() => (location.hash = '#/settings')); await page.waitForSelector('[data-testid=storage-usage]');
      verdict(`${label} · Settings with the storage row`, await page.evaluate(auditPage));
      await page.getByRole('button', { name: 'Make room…' }).click(); await page.getByRole('button', { name: /Remove \d+ oldest entries/ }).click(); await page.waitForTimeout(600);
      verdict(`${label} · Settings after history was removed (note shown)`, await page.evaluate(auditPage));
    }, page);
    await ctx.close();
  }
  {
    const ctx = await newContext(browser, size); const page = await ctx.newPage(); watch(page, errors, label + ' noroom');
    await loadDemo(page, DEMOS.student);
    await step(`${label} no room for the safety copy: the sheet fits and its buttons are reachable`, async () => {
      await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('cleanflow:v1')); d.user.demo = false; d._rev += 100; localStorage.setItem('cleanflow:v1', JSON.stringify(d)); });
      await page.reload(); await page.waitForSelector('text=Habits & routine');
      const file = await page.evaluate(() => localStorage.getItem('cleanflow:v1'));
      await page.evaluate(() => { let chunk = 200000, i = 0; while (chunk >= 50) { try { localStorage.setItem('zz_filler' + i++, 'x'.repeat(chunk)); } catch { chunk = Math.floor(chunk / 2); } } });
      await page.evaluate(() => (location.hash = '#/settings')); await page.waitForSelector('text=Your data');
      await page.locator('input[type=file]').setInputFiles({ name: 'restore.json', mimeType: 'application/json', buffer: Buffer.from(file) });
      await page.getByRole('button', { name: 'Replace my data' }).click();
      await page.waitForSelector('text=No room for an automatic safety copy');
      verdict(`${label} · the no-room sheet`, await page.evaluate(auditPage));
      const m = await page.evaluate(() => [...document.querySelectorAll('.sheet-foot .btn')].map((b) => { const r = b.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right), document.documentElement.clientWidth, Math.round(r.height)]; }));
      check(`${label} · no-room sheet: three buttons inside the screen, at least 44px tall`, m.length === 3 && m.every(([l, r, vw, h]) => l >= -0.5 && r <= vw + 0.5 && h >= 44), JSON.stringify(m));
    }, page);
    await ctx.close();
  }
  // ── someone with habits only ──
  {
    const ctx = await newContext(browser, size); const page = await ctx.newPage(); watch(page, errors, label + ' life');
    await loadDemo(page, DEMOS.beginner);
    for (const r of ROUTES_LIFE) {
      await step(`${label} life-only ${r}`, async () => {
        await page.evaluate((x) => (location.hash = '#/' + x), r); await page.waitForTimeout(250);
        verdict(`${label} · life-only ${r}`, await page.evaluate(auditPage));
      }, page);
    }
    await ctx.close();
  }
  // ── onboarding and the recovery screen ──
  {
    const ctx = await newContext(browser, size); const page = await ctx.newPage(); watch(page, errors, label + ' onb');
    await step(`${label} welcome`, async () => {
      await fresh(page);
      verdict(`${label} · welcome`, await page.evaluate(auditPage));
    }, page);
    // Every onboarding step, with a realistic answered home behind it, so the later steps have content to lay out.
    await step(`${label} every onboarding step`, async () => {
      await loadDemo(page, DEMOS.family, 'text=Your list for today');
      await page.evaluate(() => {
        const d = JSON.parse(localStorage.getItem('cleanflow:v1'));
        d.onboardingComplete = false; d.preferences.focus = ['home', 'active', 'morning'];
        localStorage.setItem('cleanflow:v1', JSON.stringify(d));
      });
      for (let i = 0; i <= 9; i++) {
        await page.evaluate((n) => { localStorage.setItem('cleanflow:onb-step', String(n)); location.hash = '#/onboarding'; }, i);
        await page.reload(); await page.waitForSelector('.onb-body'); await page.waitForTimeout(200);
        verdict(`${label} · onboarding step ${i + 1}`, await page.evaluate(auditPage));
      }
    }, page);
    await step(`${label} recovery screen`, async () => {
      await page.goto(BASE); await page.evaluate(() => localStorage.setItem('cleanflow:v1', '{"version":1,"sessions":[')); await page.reload();
      await page.waitForSelector('text=We couldn\'t open your saved data');
      verdict(`${label} · recovery screen`, await page.evaluate(auditPage));
    }, page);
    await ctx.close();
  }
}
done(errors);
await browser.close();
