// Layout checks at every target width: no horizontal overflow on any screen, sheets and dialogs stay inside the viewport,
// the recovery screen and onboarding fit, and the accessibility rules we have broken before stay fixed.
import { BASE, DEMOS, OUT, WIDTHS, auditPage, fresh, launch, loadDemo, newContext, runner, watch } from './lib.mjs';

const { check, step, done } = runner('responsive');
const browser = await launch();
const errors = [];
const ROUTES_BOTH = ['today', 'plan', 'plan?tab=rooms', 'plan?tab=deep', 'schedule', 'progress', 'patterns', 'home', 'supplies', 'settings', 'more'];
const ROUTES_LIFE = ['today', 'plan', 'schedule', 'progress', 'patterns', 'home', 'settings', 'more'];

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

// E2E_ONLY=large runs just the large-text sweep at the end.
for (const size of (process.env.E2E_ONLY === 'large' ? [] : WIDTHS)) {
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

// ───────────── Large text: 200% text on the phone widths, light and dark ─────────────
// A person who has set a large text size gets the same planner at half the room. Nothing may spill past the screen or out of its own box,
// the five bottom-navigation labels must stay whole and apart (the navigation wraps onto a second row instead of overlapping), the last
// thing on a page must clear the navigation, and a chart that has to scroll must be reachable by keyboard. The text size is set the way a
// browser's own large-text setting does: the root font size doubles (every rem follows); no px sizes are touched.
const LARGE_ROUTES = ['today', 'plan', 'plan?tab=rooms', 'plan?tab=deep', 'schedule', 'progress', 'patterns', 'home', 'supplies', 'settings', 'more',
  'movement', 'movement?tab=progress', 'meals', 'wellbeing?tab=checkin', 'wellbeing?tab=water', 'wellbeing?tab=journal', 'learning'];
const frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
const largeAudit = () => {
  const out = {};
  // 1. every label is whole and inside its own item, and no two labels overlap
  const items = [...document.querySelectorAll('.bottomnav a')];
  const labels = items.map((a) => { const r = document.createRange(); r.selectNodeContents([...a.childNodes].filter((n) => n.nodeType === 3 || (n.nodeType === 1 && n.tagName !== 'svg')).pop() ?? a); const t = r.getBoundingClientRect(); const b = a.getBoundingClientRect(); return { text: a.textContent.trim(), t, b }; });
  out.navLabelsOutside = labels.filter((l) => l.t.left < l.b.left - 0.5 || l.t.right > l.b.right + 0.5).map((l) => l.text);
  out.navLabelsOverlap = [];
  for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) {
    const a = labels[i].t; const b = labels[j].t;
    if (a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5) out.navLabelsOverlap.push(labels[i].text + '/' + labels[j].text);
  }
  out.navItemsOnScreen = items.every((a) => { const b = a.getBoundingClientRect(); return b.left >= -0.5 && b.right <= document.documentElement.clientWidth + 0.5; });
  out.navRows = new Set(items.map((a) => Math.round(a.getBoundingClientRect().top))).size;
  // 2. the last thing on the page clears the navigation
  window.scrollTo(0, document.documentElement.scrollHeight);
  const nav = document.querySelector('.bottomnav'); const main = document.querySelector('.main');
  if (nav && main) {
    const lowest = Math.max(...[...main.querySelectorAll('*')].map((e) => e.getBoundingClientRect()).filter((r) => r.height > 0).map((r) => r.bottom));
    out.clearBy = Math.round(nav.getBoundingClientRect().top - lowest);
  }
  window.scrollTo(0, 0);
  // 3. a chart that scrolls is a tab stop; one that does not is not
  out.chartsBad = [...document.querySelectorAll('.bars')].filter((c) => (c.scrollWidth > c.clientWidth + 1) !== (c.getAttribute('tabindex') === '0')).length;
  out.charts = document.querySelectorAll('.bars').length;
  out.chartsScrolling = [...document.querySelectorAll('.bars')].filter((c) => c.scrollWidth > c.clientWidth + 1).length;
  return out;
};
const allSectionsOn = (page) => page.evaluate(() => {
  window.dispatchEvent(new Event('pagehide'));
  const d = JSON.parse(localStorage.getItem('cleanflow:v1'));
  d.modules.enabled = { ...d.modules.enabled, movement: true, meals: true, learning: true, water: true, wellbeing: true };
  d._rev = (d._rev ?? 0) + 100;
  localStorage.setItem('cleanflow:v1', JSON.stringify(d));
});
const largeText = () => { const add = () => { const st = document.createElement('style'); st.textContent = 'html { font-size: 200% !important; }'; document.head.appendChild(st); }; if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add); else add(); };
{
  let sawScrollingChart = false;
  for (const dark of [false, true]) for (const size of WIDTHS.filter((w) => w.mobile)) for (const [demoName, demo] of [['family', DEMOS.family], ['student', DEMOS.student]]) {
    const label = `200% text · ${size.w}px · ${dark ? 'dark' : 'light'} · ${demoName}`;
    const ctx = await browser.newContext({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, colorScheme: dark ? 'dark' : 'light', locale: 'en-US', timezoneId: 'UTC' });
    await ctx.addInitScript(largeText);
    const page = await ctx.newPage(); watch(page, errors, label);
    await page.clock.setFixedTime(new Date(2026, 9, 5, 8, 15));
    await loadDemo(page, demo, '.app');
    await allSectionsOn(page);
    await page.reload(); await page.waitForSelector('.app');
    await step(label, async () => {
      for (const r of LARGE_ROUTES) {
        await page.evaluate((x) => (location.hash = '#/' + x), r);
        await page.waitForSelector('.app .page, .app .empty');
        await page.evaluate(frames);
        const a = await page.evaluate(auditPage);
        const l = await page.evaluate(largeAudit);
        const problems = [];
        if (a.docOverflow > 0) problems.push(`the page is ${a.docOverflow}px wider than the screen`);
        if (a.wide.length) problems.push(`wider than the screen: ${a.wide.join(', ')}`);
        if (l.navLabelsOutside.length) problems.push(`nav labels spill out of their item: ${l.navLabelsOutside.join(', ')}`);
        if (l.navLabelsOverlap.length) problems.push(`nav labels overlap: ${l.navLabelsOverlap.join(', ')}`);
        if (!l.navItemsOnScreen) problems.push('a nav item is off the screen');
        if (l.clearBy !== undefined && l.clearBy < -1) problems.push(`the last thing on the page is ${-l.clearBy}px under the navigation`);
        if (l.chartsBad) problems.push('a chart that scrolls is not a tab stop, or one that does not scroll is');
        if (l.chartsScrolling) sawScrollingChart = true;
        check(`${label} · #/${r}: nothing spills, the nav is whole, the page clears it`, problems.length === 0, problems.join('; '));
      }
      const nav = await page.evaluate(() => ({ items: document.querySelectorAll('.bottomnav a').length, rows: new Set([...document.querySelectorAll('.bottomnav a')].map((x) => Math.round(x.getBoundingClientRect().top))).size }));
      check(`${label} · all five navigation items are there (in ${nav.rows} row${nav.rows === 1 ? '' : 's'})`, nav.items === 5 && nav.rows >= 1 && nav.rows <= 3, JSON.stringify(nav));
    }, page);
    await ctx.close();
  }
  check('at least one chart really did scroll at 200% text, so the keyboard rule above was exercised', sawScrollingChart);
}
done(errors);
await browser.close();
