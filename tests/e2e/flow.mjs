import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs'; mkdirSync('./e2e-shots', { recursive: true });
const OUT = './e2e-shots';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = []; page.setDefaultTimeout(6000);
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/ERR_CERT|Failed to load resource/.test(m.text())) errors.push(m.text()); });
const step = async (n, fn) => { try { await fn(); console.log('ok  ', n); } catch (e) { console.log('FAIL', n, e.message.split('\n').slice(0,6).join(' | ')); await page.screenshot({ path: `${OUT}/fail-${n.replace(/\W+/g,'_')}.png` }); } };
const click = (t, o) => page.getByRole('button', { name: t, ...o }).first().click();

await page.goto('http://127.0.0.1:5173/');
await page.evaluate(() => localStorage.clear()); await page.reload();
await step('welcome→onboarding', async () => { await click('Build my plan'); await page.waitForSelector('text=What do you want to improve'); });
await step('step0 focus', async () => {
  // home is pre-selected; add two life goals and answer the fitness follow-ups
  await page.getByRole('checkbox', { name: /Build discipline/ }).click();
  await page.getByRole('checkbox', { name: /Become more physically active/ }).click();
  await page.waitForSelector('text=How would you describe your fitness');
  await page.getByRole('radio', { name: /Beginner/ }).click();
  await page.getByRole('radio', { name: /No equipment/ }).click();
  await page.screenshot({ path: './e2e-shots/00-focus.png', fullPage: true });
  await click('Continue');
});
await step('step1', async () => { await page.getByRole('radio', { name: 'House', exact: true }).click(); await click('Continue'); });
await step('step2 exact size', async () => { await page.fill('#exact', '150'); await page.waitForSelector('text=Using your exact size'); await click('Continue'); });
await step('step3 rooms', async () => {
  await page.waitForSelector('text=Number of floors');
  await page.getByRole('group', { name: 'Bedrooms' }).getByRole('button', { name: '4', exact: true }).click();
  await page.getByRole('group', { name: 'Bathrooms' }).getByRole('button', { name: '2', exact: true }).click();
  await page.getByRole('group', { name: 'Floors' }).getByRole('button', { name: '2', exact: true }).click();
  await click('Continue');
});
await step('step4 people/pets', async () => {
  await page.getByRole('group', { name: 'Children' }).getByRole('button', { name: '2', exact: true }).click();
  await page.getByRole('radio', { name: 'Dog', exact: true }).click();
  await page.waitForSelector('text=What type of pet?');
  await click('Continue');
});
await step('step5 state', async () => { await page.getByRole('radio', { name: 'Quite messy' }).click(); await page.getByRole('checkbox', { name: 'Dishes' }).click(); await click('Continue'); });
await step('step6 style', async () => { await page.getByRole('radio', { name: /Several short/ }).click(); await page.getByRole('radio', { name: '45 minutes' }).click(); await page.getByRole('radio', { name: '7', exact: true }).click(); await click('Continue'); });
await step('step7 energy', async () => { await page.getByRole('radio', { name: 'Medium' }).click(); await page.getByRole('checkbox', { name: /overwhelming/ }).click(); await click('Continue'); });
await step('step8 goals', async () => { await page.getByRole('checkbox', { name: /Build a daily routine/ }).click(); await click('Review'); await page.waitForSelector('text=Ready when you are'); await page.fill('#name', 'Dee'); await click('Build my plan'); });
await step('my home', async () => { await page.waitForSelector('text=Here\'s your home', { timeout: 8000 }); await page.screenshot({ path: `${OUT}/10-myhome.png`, fullPage: true }); });
await step('today', async () => { await click('See my plan for today'); await page.waitForSelector('text=Your list for today'); await page.screenshot({ path: `${OUT}/11-today.png`, fullPage: true }); });
await step('today has life habits', async () => {
  await page.waitForSelector('text=Habits & routine');
  await page.getByText('Make the bed').first().waitFor().catch(() => {});
  await page.screenshot({ path: './e2e-shots/11b-today-life.png', fullPage: true });
});
await step('life task detail shows safety + metadata', async () => {
  await page.locator('.task-body', { hasText: /walk/i }).first().click();
  await page.waitForSelector('text=Intensity');
  await page.waitForSelector('text=not medical advice');
  await page.screenshot({ path: './e2e-shots/11c-life-detail.png' });
  await page.getByRole('button', { name: 'Close' }).click();
});
await step('rough day sheet', async () => {
  await page.getByRole('button', { name: /Rough day/ }).click();
  await page.waitForSelector('text=Bad day? That happens.');
  await page.getByRole('dialog').getByRole('button', { name: /^Mark .* complete$/ }).first().click();
  await page.waitForSelector('text=1 of');
  await page.screenshot({ path: './e2e-shots/11d-rough.png' });
  await page.getByRole('button', { name: 'Close' }).click();
});
await step('complete task + undo', async () => { await page.getByRole('button', { name: /^Mark .* complete$/ }).first().click(); await page.waitForSelector('.toast'); await page.screenshot({ path: `${OUT}/12-toast.png` }); await page.getByRole('button', { name: 'Undo' }).click(); });
await step('timer', async () => {
  await page.getByRole('button', { name: 'Start timer' }).first().click();
  await page.getByRole('radio', { name: '5 min', exact: true }).click();
  await page.getByRole('button', { name: /^Start 5 min/ }).click();
  await page.waitForSelector('[role=timer]'); await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/13-timer.png` });
  await click('Pause', { exact: true }); await page.waitForSelector('text=Paused'); await click('Resume', { exact: true });
  await page.getByRole('button', { name: 'Close' }).click();
  await page.waitForSelector('.timerbar'); await page.screenshot({ path: `${OUT}/14-timerbar.png` });
  await page.locator('.timerbar button.open').click(); await click('Complete', { exact: true }); await page.waitForSelector('.timerbar', { state: 'detached' });
});
await step('just 5', async () => { await page.locator('.qa.five').click(); await page.waitForSelector('text=Just one small thing'); await page.screenshot({ path: `${OUT}/15-five.png` }); await click('I did it'); await page.waitForSelector('text=Nice. You made progress.'); await page.screenshot({ path: `${OUT}/16-five-done.png` }); await click('Do another 5 minutes'); await page.waitForSelector('text=Just one small thing'); await page.getByRole('button',{name:'Close',exact:true}).click(); });
await step('timebox', async () => { await page.locator('.qa.time').click(); await page.locator('.time-btn', { hasText: '30' }).click(); await page.waitForSelector('text=Change time'); await page.screenshot({ path: `${OUT}/17-timebox.png` }); await page.getByRole('button',{name:'Close',exact:true}).click(); });
await step('emergency', async () => { await page.locator('.qa.mess').click(); await click('Start the reset'); await page.waitForSelector('text=Home reset'); await page.screenshot({ path: `${OUT}/18-emergency.png` }); await page.getByRole('button',{name:'Close',exact:true}).click(); });
await step('plan: domain filter + challenge', async () => {
  await page.evaluate(() => (location.hash = '#/plan'));
  await page.getByRole('group', { name: 'Filter by area' }).getByRole('button', { name: /Fitness/ }).click();
  await page.getByRole('tab', { name: /CHALLENGES/ }).click();
  await page.screenshot({ path: './e2e-shots/19-plan-life.png', fullPage: true });
});
for (const [n, hash] of [['plan', 'plan'], ['rooms', 'plan?tab=rooms'], ['deep', 'plan?tab=deep'], ['schedule', 'schedule'], ['progress', 'progress'], ['supplies', 'supplies'], ['settings', 'settings'], ['more', 'more']]) {
  await step('page ' + n, async () => { await page.evaluate((h) => (location.hash = '#/' + h), hash); await page.waitForTimeout(400); await page.screenshot({ path: `${OUT}/20-${n}.png`, fullPage: true }); });
}
await step('add task', async () => { await page.evaluate(() => (location.hash = '#/today')); await page.getByRole('button', { name: 'Add your own task' }).click(); await click('Add task'); await page.waitForSelector('text=Give the task a name'); await page.fill('#t-name', 'Water plants'); await click('Add task'); });
await step('reload persistence', async () => { await page.waitForTimeout(500); await page.reload(); await page.waitForSelector('text=Your list for today'); });
console.log(errors.join('\n') || 'no console errors');
await browser.close();
