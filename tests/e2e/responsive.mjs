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
