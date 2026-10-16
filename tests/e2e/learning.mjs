// Learning, hobbies, reading, appearance and the owl, in a real browser. Needs the dev server (npm run dev) and Chromium (CHROME_PATH).
//
//  A  discover → try a first step → log it (feedback, one log entry) → "not for me" and bring back → undo
//  B  reading list: add, log reading with a page, progress, finish
//  C  plan an interest, complete it once, minutes counted once
//  D  appearance: every choice applies and persists, first paint needs no script from the app, no font requests, readable custom accent,
//     reduced motion, the older theme setting carries over
//  E  the owl: a tip says it is not the AI, "Got it" lasts, "Hide the owl" hides it everywhere
//  F  layout at every width with the largest text, the widest font and compact spacing
import { auditPage, BASE, entriesOf, launch, newContext, runner, stored, WIDTHS, watch } from './lib.mjs';

const { check, step, done } = runner('learning');
const errors = [];
const browser = await launch();
const click = (page, t, o) => page.getByRole('button', { name: t, ...o }).first().click();
const text = (page) => page.evaluate(() => document.querySelector('main')?.innerText ?? '');
const go = async (page, hash) => { await page.evaluate((h) => (location.hash = '#/' + h), hash); await page.waitForTimeout(350); };
const sheet = async (page) => { await page.waitForSelector('role=dialog'); await page.waitForTimeout(420); };

const mk = async (size = { w: 390, h: 844, mobile: true }) => {
  const ctx = await newContext(browser, size);
  const page = await ctx.newPage();
  watch(page, errors, `${size.w}`);
  return { ctx, page };
};

const onboard = async (page, sections) => {
  await page.goto(BASE); await page.evaluate(() => localStorage.clear()); await page.reload();
  await click(page, 'Build my plan');
  await page.waitForSelector('text=What do you want help with');
  for (const s of sections) await page.getByRole('checkbox', { name: new RegExp(`^${s}`) }).click();
  await click(page, 'Continue');
  await page.waitForSelector('text=How much time can you give your plan each day');
  await page.getByRole('radio', { name: '30 minutes' }).click();
  await page.getByRole('radio', { name: '4', exact: true }).click();
  await click(page, 'Continue');
  await click(page, 'Skip');
  await page.waitForSelector('text=Ready when you are');
  await click(page, 'Build my plan');
  await page.waitForSelector('main h1', { timeout: 9000 });
};

// ───────────── A, B, C ─────────────
{
  const { ctx, page } = await mk();
  await onboard(page, ['Learning']);

  await step('A the page starts empty and says interests are not tasks', async () => {
    await go(page, 'learning');
    await page.waitForSelector('text=No interests yet');
    const t = await text(page);
    check('says nothing here is due', /not tasks/.test(t) && /Nothing here is due/.test(t));
    check('the four sections are there', (await page.getByRole('tab').allInnerTexts()).join('|') === 'Interests|Discover|Reading|Plan');
  }, page);

  await step('A discover lists ideas with reasons, and recommends no books, courses or sites', async () => {
    await page.getByRole('tab', { name: 'Discover' }).click();
    await page.waitForSelector('[aria-label="What suits you"]');
    const t = await text(page);
    check('says what the list is and is not', /We do not recommend books, courses or websites/.test(t));
    const n = await page.locator('main article').count();
    check('several ideas fit the defaults', n >= 4, String(n));
    check('each one says why it is shown', /a first try fits in your 15 minutes/.test(t) && /uses things most homes have/.test(t));
    check('no links and no prices', !/https?:|www\.|\$\d|£\d|€\d/.test(t));
    await page.getByRole('radio', { name: '10 min' }).click();
    await page.getByRole('radio', { name: /Nothing: what I have at home/ }).click();
    await page.getByRole('radio', { name: 'Outdoors' }).click();
    const outdoor = await page.locator('main article b').allInnerTexts();
    const indoorOnly = ['Singing', 'Playing an instrument', 'Rhythm with what you have', 'Dance for fun', 'Painting', 'Sewing and mending', 'Paper folding'];
    check('"outdoors" leaves out what can only be done indoors, and keeps what can be done anywhere', outdoor.includes('Noticing nature') && !outdoor.some((x) => indoorOnly.includes(x)), outdoor.join(', '));
    await page.getByRole('radio', { name: 'Either', exact: false }).first().click();
    await page.waitForTimeout(900);
    const saved = (await stored(page)).interests.discover;
    check('the answers are remembered', saved && saved.minutes === 10 && saved.setting === 'either', JSON.stringify(saved));
    await page.getByRole('radio', { name: '15 min' }).click();
  }, page);

  await step('A try a first step, then log it: one log entry, feedback saved, interest added only now', async () => {
    check('nothing was added just by looking', (await stored(page)).interests.items.length === 0);
    await page.getByRole('button', { name: 'Try Reading: Ten pages, no pressure' }).click();
    await sheet(page);
    const t = await page.locator('[role=dialog]').innerText();
    check('shows what you need and the steps', /You will need/.test(t) && /Set a timer for ten minutes/.test(t));
    check('says nothing is added until you say you tried it', /Nothing is added to your list until you say you tried it/.test(t));
    check('still nothing stored', (await stored(page)).interests.items.length === 0);
    await click(page, 'I tried it');
    await page.waitForSelector('text=How long (minutes)?'); await page.waitForTimeout(420);
    check('minutes pre-filled from the starter', (await page.locator('#ls-min').inputValue()) === '10');
    await page.getByRole('radio', { name: 'Enjoyed it' }).click();
    await page.getByLabel('A note (optional)').fill('Quiet and nice');
    await click(page, 'Log it');
    await page.waitForTimeout(700);
    const d = await stored(page);
    check('the interest exists, as "trying it out"', d.interests.items.length === 1 && d.interests.items[0].catalogId === 'reading' && d.interests.items[0].status === 'exploring');
    check('one session with the feedback', d.interests.sessions.length === 1 && d.interests.sessions[0].feedback === 'enjoyed' && d.interests.sessions[0].starterId === 'ten-pages' && d.interests.sessions[0].note === 'Quiet and nice');
    const es = await entriesOf(page);
    check('exactly one log entry, with the minutes, and no minutes anywhere else', es.length === 1 && es[0].actualMinutes === 10 && es[0].taskId.startsWith('adhoc:learning:') && d.interests.sessions[0].entryId === es[0].id && !('minutes' in d.interests.sessions[0]), JSON.stringify(es.map((e) => [e.taskId, e.actualMinutes])));
    check('no task state was created for a one-off', Object.keys(d.taskStates).length === 0);
  }, page);

  await step('A the Interests tab shows what was logged, without judging what was not', async () => {
    await go(page, 'learning');
    await page.waitForSelector('[aria-label="Your interests"]');
    const t = await text(page);
    check('shows the minutes lately', /10 min in the last four weeks/.test(t), t.slice(0, 300));
    await page.getByRole('tab', { name: 'Discover' }).click(); await page.waitForSelector('[aria-label="What suits you"]');
    check('Reading is no longer suggested', !(await page.locator('main article b').allInnerTexts()).includes('Reading'));
  }, page);

  await step('A "not for me" hides an idea, and it can be brought back', async () => {
    await page.getByRole('button', { name: 'Singing: not for me' }).click();
    await page.waitForTimeout(500);
    check('gone from discover', !(await page.locator('main article b').allInnerTexts()).includes('Singing'));
    await go(page, 'learning');
    await click(page, /1 marked not for me/);
    check('listed as set aside', /Singing/.test(await text(page)));
    await click(page, 'Bring back');
    await page.waitForTimeout(500);
    const d = await stored(page);
    check('back as "trying it out"', d.interests.items.find((i) => i.name === 'Singing')?.status === 'exploring');
  }, page);

  await step('A logging again and pressing Undo removes exactly that entry and session', async () => {
    await go(page, 'learning'); await page.waitForSelector('[aria-label="Your interests"]');
    await click(page, 'Log a session of Reading');
    await page.waitForSelector('text=How long (minutes)?'); await page.waitForTimeout(420);
    await page.locator('#ls-min').fill('20');
    await click(page, 'Log it'); await page.waitForTimeout(600);
    check('two entries now', (await entriesOf(page)).length === 2);
    await page.locator('.toasts, [role=status]').getByRole('button', { name: 'Undo' }).first().click();
    await page.waitForTimeout(700);
    const d = await stored(page);
    check('back to one entry and one session', (await entriesOf(page)).length === 1 && d.interests.sessions.length === 1);
  }, page);

  await step('A "not for me" after a session asks before it stops suggesting', async () => {
    await click(page, 'Log a session of Singing');
    await page.waitForSelector('text=How long (minutes)?'); await page.waitForTimeout(420);
    await page.getByRole('radio', { name: 'Not for me' }).click();
    await click(page, 'Log it'); await page.waitForTimeout(500);
    const t = await page.locator('body').innerText();
    check('asks, does not assume', /Stop suggesting Singing\?/.test(t));
    check('status unchanged until you say so', (await stored(page)).interests.items.find((i) => i.name === 'Singing').status === 'exploring');
    await page.getByRole('button', { name: 'Yes, not for me' }).click(); await page.waitForTimeout(500);
    check('now set aside', (await stored(page)).interests.items.find((i) => i.name === 'Singing').status === 'not-for-me');
  }, page);

  await step('B add a book, log reading with a page number, see progress, finish it', async () => {
    await go(page, 'learning?tab=reading');
    await page.waitForSelector('text=Your reading list is empty');
    check('says the app suggests no books', /does not suggest or rate books/.test(await text(page)));
    await click(page, 'Add a book'); await sheet(page);
    await page.getByLabel('Title').fill('My test book');
    await page.getByLabel('Author (optional)').fill('A. Writer');
    await page.getByLabel('Pages in total (optional)').fill('120');
    await click(page, 'Add it'); await page.waitForTimeout(500);
    check('listed under "Want to read"', /Want to read\s*·\s*1/.test(await text(page)));
    await click(page, 'Log reading: My test book');
    await page.waitForSelector('text=How long (minutes)?'); await page.waitForTimeout(420);
    await page.locator('#ls-min').fill('20');
    await page.getByLabel('Page you reached (optional)').fill('30');
    await click(page, 'Log it'); await page.waitForTimeout(700);
    const d = await stored(page);
    const b = d.interests.books[0];
    check('moved to reading, with the page', b.status === 'reading' && b.pagesRead === 30, JSON.stringify(b));
    check('shows 25% and the pages', (await page.getByRole('progressbar', { name: /25% read/ }).count()) === 1 && /Page 30 of 120/.test(await text(page)));
    check('the session is tied to the book and to the reading interest', d.interests.sessions.some((s) => s.bookId === b.id) && d.interests.items.some((i) => i.catalogId === 'reading'));
    await page.getByRole('button', { name: /Mark finished/ }).first().click(); await page.waitForTimeout(500);
    const f = (await stored(page)).interests.books[0];
    check('finished, with the end page and date', f.status === 'finished' && f.pagesRead === 120 && !!f.finishedAt);
    check('shows under Finished', /Finished\s*·\s*1/.test(await text(page)));
  }, page);

  await step('C plan an interest for today, complete it once; minutes are counted once', async () => {
    await go(page, 'learning'); await page.waitForSelector('[aria-label="Your interests"]');
    await click(page, /Reading\. Open details/); await sheet(page);
    check('shows resources as yours', /Books, videos, courses, people: whatever you use/.test(await page.locator('[role=dialog]').innerText()));
    await click(page, 'Plan it'); await sheet(page);
    check('name is pre-filled and one day is chosen', (await page.locator('#a-name').inputValue()) === 'Reading' && (await page.getByRole('radio', { name: 'One day' }).getAttribute('aria-checked')) === 'true');
    await click(page, 'Add to my plan'); await page.waitForTimeout(500);
    await go(page, 'today');
    const card = page.locator('article.task', { hasText: 'Reading' }).first();
    await card.waitFor();
    await card.locator('button.check').click(); await page.waitForTimeout(800);
    const before = (await entriesOf(page)).filter((e) => e.taskId.startsWith('act:'));
    check('one entry for the planned item', before.length === 1, JSON.stringify(before.map((e) => e.taskId)));
    await go(page, 'learning'); await page.waitForSelector('[aria-label="Your interests"]');
    const all = await entriesOf(page);
    const d = await stored(page);
    const rid = d.interests.items.find((i) => i.catalogId === 'reading').id;
    const sessionMin = all.filter((e) => d.interests.sessions.some((s) => s.interestId === rid && s.entryId === e.id)).reduce((n, e) => n + e.actualMinutes, 0);
    const planned = before[0].actualMinutes;
    const shown = /Reading[\s\S]*?(\d+) min in the last four weeks/.exec(await text(page));
    check('minutes on the card are the sessions plus the planned entry, once each', shown && Number(shown[1]) === sessionMin + planned, `${shown && shown[1]} vs ${sessionMin}+${planned}`);
  }, page);

  await step('C an interest holds links you add, and only real web addresses', async () => {
    await click(page, /Reading\. Open details/); await sheet(page);
    await page.getByLabel('Name', { exact: true }).fill('My library page');
    await page.getByLabel('Link (optional)').fill('javascript:alert(1)');
    await click(page, 'Add resource');
    check('refuses a link that is not a web address', /does not look like a web address/.test(await page.locator('[role=dialog]').innerText()));
    await page.getByLabel('Link (optional)').fill('example.org/reading');
    await click(page, 'Add resource'); await page.waitForTimeout(400);
    const link = page.locator('[role=dialog] a', { hasText: 'My library page' });
    check('saved as https and opened safely', (await link.getAttribute('href')) === 'https://example.org/reading' && /noopener/.test(await link.getAttribute('rel')) && (await link.getAttribute('target')) === '_blank');
    await page.keyboard.press('Escape');
  }, page);

  await step('A+B+C the sheets fit at 390px and nothing overflows', async () => {
    for (const r of ['learning', 'learning?tab=discover', 'learning?tab=reading', 'learning?tab=plan']) {
      await go(page, r);
      const a = await page.evaluate(auditPage);
      check(`${r}: no overflow, every control named, valid ARIA`, a.docOverflow <= 0 && a.wide.length === 0 && a.unnamed.length === 0 && a.badAria.length === 0 && a.skips.length === 0, JSON.stringify(a));
    }
  }, page);
  await ctx.close();
}

// ───────────── D ─────────────
{
  const { ctx, page } = await mk();
  const hosts = new Set();
  page.on('request', (r) => { try { hosts.add(new URL(r.url()).host); } catch { /* data: urls */ } });
  await onboard(page, ['Learning']);
  const attrs = () => page.evaluate(() => { const r = document.documentElement; return { theme: r.getAttribute('data-theme'), palette: r.getAttribute('data-palette'), font: r.getAttribute('data-font'), size: r.getAttribute('data-size'), density: r.getAttribute('data-density'), motion: r.getAttribute('data-motion'), primary: getComputedStyle(r).getPropertyValue('--primary').trim(), fontSize: getComputedStyle(r).fontSize, bg: getComputedStyle(document.body).backgroundColor }; });

  await step('D every choice applies at once, and is saved with the rest of your data', async () => {
    await go(page, 'settings');
    await page.waitForSelector('[data-testid=appearance]');
    const before = await attrs();
    check('starts on the sage palette, system theme', before.palette === 'sage' && before.theme === null);
    await page.getByRole('radio', { name: 'Dark' }).click();
    await page.waitForTimeout(200);
    check('dark really is dark, even though this device is set to light', (await attrs()).bg === 'rgb(19, 24, 21)', (await attrs()).bg);
    await page.getByRole('radio', { name: 'Ocean' }).click();
    await page.getByRole('radio', { name: 'Wide and clear' }).click();
    await page.getByRole('radio', { name: 'Extra large' }).click();
    await page.getByRole('radio', { name: 'Compact' }).click();
    await page.getByRole('radio', { name: 'Reduce movement' }).click();
    await page.waitForTimeout(300);
    const a = await attrs();
    check('attributes follow', a.theme === 'dark' && a.palette === 'ocean' && a.font === 'clear' && a.size === 'xlarge' && a.density === 'compact' && a.motion === 'reduced', JSON.stringify(a));
    check('the palette changed the real colours', a.primary !== before.primary && a.primary !== '', `${before.primary} -> ${a.primary}`);
    check('extra large is a quarter bigger than the browser size', a.fontSize === '20px', a.fontSize);
    const d = await stored(page);
    check('saved in the data file', d.appearance.palette === 'ocean' && d.appearance.fontSize === 'xlarge' && d.appearance.theme === 'dark');
    check('the first-paint copy was written', await page.evaluate(() => !!localStorage.getItem('cleanflow:appearance')));
  }, page);

  await step('D after a reload the first paint already has it, before the app has started', async () => {
    // hold the app's own script back, so only the small script in the page can have set anything
    await page.route(/\/src\/main\.tsx/, async (route) => { await new Promise((r) => setTimeout(r, 1800)); try { await route.continue(); } catch { /* the hold was lifted first: the page already carries on */ } });
    await page.goto(BASE, { waitUntil: 'commit' });
    await page.waitForTimeout(700);
    const a = await attrs();
    check('palette, theme, size and motion are already set', a.theme === 'dark' && a.palette === 'ocean' && a.size === 'xlarge' && a.density === 'compact' && a.motion === 'reduced', JSON.stringify(a));
    check('the colours are already the ocean ones', /^#[0-9a-f]{6}$/i.test(a.primary), a.primary);
    await page.unroute(/\/src\/main\.tsx/);
    await page.waitForSelector('main h1', { timeout: 9000 });
    const b = await attrs();
    check('and the app agrees once it starts', b.palette === 'ocean' && b.primary === a.primary);
  }, page);

  await step('D no request to any font service, ever', async () => {
    const bad = [...hosts].filter((h) => !/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(h));
    check('only this app was contacted', bad.length === 0, bad.join(', '));
    check('the page no longer links a font stylesheet', (await page.locator('link[rel=stylesheet][href*="fonts."]').count()) === 0);
  }, page);

  await step('D a custom accent that would be unreadable is adjusted, and the app says so', async () => {
    await go(page, 'settings'); await page.waitForSelector('[data-testid=appearance]');
    await page.getByRole('radio', { name: 'Light' }).click();
    await page.locator('#ap-accent').fill('#ffee00');
    await page.waitForTimeout(300);
    const note = await page.locator('#ap-accent-note').innerText();
    check('says it was adjusted', /adjusted a little so buttons and text stay readable/.test(note), note);
    const ratio = await page.evaluate(() => {
      const s = getComputedStyle(document.documentElement);
      const hex = (v) => { const m = /^#?([0-9a-f]{6})$/i.exec(v.trim()); return m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) : null; };
      const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
      const a = hex(s.getPropertyValue('--primary')), b = hex(s.getPropertyValue('--primary-ink'));
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    });
    check('button text on the accent meets 4.5:1', ratio >= 4.5, String(ratio));
    await page.getByRole('button', { name: "Use the palette's own colour" }).click();
    await page.waitForTimeout(900);
    check('removing it restores the palette colour', (await stored(page)).appearance.accent === null);
  }, page);

  await step('D "Reset appearance" returns everything to the defaults, and nothing else changes', async () => {
    const before = await stored(page);
    await click(page, 'Reset appearance'); await page.waitForTimeout(400);
    const a = await attrs(); const d = await stored(page);
    check('back to sage, system, standard, medium, comfortable', a.palette === 'sage' && a.theme === null && a.font === 'standard' && a.size === 'medium' && a.density === 'comfortable', JSON.stringify(a));
    check('plan, history and interests untouched', JSON.stringify(d.sessions) === JSON.stringify(before.sessions) && JSON.stringify(d.interests) === JSON.stringify(before.interests));
  }, page);

  await step('D reduced motion: the owl and breathing stop moving, whether chosen here or on the device', async () => {
    await page.getByRole('radio', { name: 'Allow movement' }).click(); await page.waitForTimeout(200);
    const moving = await page.evaluate(() => { const e = document.createElement('div'); e.className = 'owl'; e.innerHTML = '<svg class="owl owl-idle"><g class="owl-eyes"></g></svg>'; document.body.appendChild(e); const n = getComputedStyle(e.querySelector('.owl-eyes')).animationName; e.remove(); return n; });
    check('with movement allowed the owl blinks', moving !== 'none', moving);
    await page.getByRole('radio', { name: 'Match my device' }).nth(1).click(); await page.waitForTimeout(100);
    await page.emulateMedia({ reducedMotion: 'reduce' }); await page.waitForTimeout(300);
    check('"match my device" follows a reduce-motion device', (await attrs()).motion === 'reduced');
    await page.emulateMedia({ reducedMotion: 'no-preference' }); await page.waitForTimeout(300);
    check('and follows it back', (await attrs()).motion === 'full');
    const still = await page.evaluate(() => { document.documentElement.setAttribute('data-motion', 'reduced'); const e = document.createElement('div'); e.innerHTML = '<svg class="owl owl-idle"><g class="owl-eyes"></g></svg>'; document.body.appendChild(e); const n = getComputedStyle(e.querySelector('.owl-eyes')).animationName; e.remove(); return n; });
    check('reduced motion stops the owl', still === 'none', still);
  }, page);

  await step('D the system light/dark setting is followed live while the theme is "match my device"', async () => {
    await page.reload(); await page.waitForSelector('[data-testid=appearance]');
    const bars = () => page.evaluate(() => ({ meta: (document.getElementById('theme-color')?.getAttribute('content') ?? '').toLowerCase(), bg: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim().toLowerCase() }));
    await page.emulateMedia({ colorScheme: 'dark' }); await page.waitForTimeout(300);
    const dark = await attrs(); const darkBar = await bars();
    await page.emulateMedia({ colorScheme: 'light' }); await page.waitForTimeout(300);
    const light = await attrs(); const lightBar = await bars();
    check('background changes with the device', dark.bg !== light.bg, `${dark.bg} / ${light.bg}`);
    check('the toolbar colour follows, in both', darkBar.meta === darkBar.bg && lightBar.meta === lightBar.bg && darkBar.meta !== lightBar.meta, JSON.stringify({ darkBar, lightBar }));
  }, page);

  await step('D the older theme setting carries over once, then is let go', async () => {
    await page.evaluate(() => localStorage.setItem('cleanflow:theme', 'dark'));
    await page.reload(); await page.waitForTimeout(900);
    check('dark', (await attrs()).theme === 'dark' && (await stored(page)).appearance.theme === 'dark');
    check('old key removed', (await page.evaluate(() => localStorage.getItem('cleanflow:theme'))) === null);
  }, page);
  await ctx.close();
}

// ───────────── E ─────────────
{
  const { ctx, page } = await mk();
  await onboard(page, ['Learning']);
  await step('E the owl\'s tip says it is not the AI, and "Got it" lasts', async () => {
    await go(page, 'learning');
    const tip = page.getByTestId('owl-tip');
    await tip.waitFor();
    const t = await tip.innerText();
    check('labelled as an app tip, not the AI', /App tip · not from the AI/.test(t), t);
    check('says what it is for, in plain words', /Not sure what to try\?/.test(t));
    const box = await tip.boundingBox();
    check('in the page flow, not floating over controls', await tip.evaluate((e) => getComputedStyle(e).position !== 'fixed' && getComputedStyle(e).position !== 'absolute'));
    check('has a size a person can read', box.width > 200);
    await click(page, 'Got it'); await page.waitForTimeout(400);
    check('gone', (await page.getByTestId('owl-tip').count()) === 0);
    await page.reload(); await page.waitForSelector('main h1');
    check('stays gone after a reload', (await page.getByTestId('owl-tip').count()) === 0);
    check('remembered in the data', Object.keys((await stored(page)).dismissedInsights).some((k) => k === 'owl:discover'));
  }, page);
  await step('E "Hide the owl" hides it everywhere, and Settings can bring it back', async () => {
    await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('cleanflow:v1')); delete d.dismissedInsights['owl:discover']; d._rev += 3; localStorage.setItem('cleanflow:v1', JSON.stringify(d)); });
    await page.reload(); await page.waitForSelector('[data-testid=owl-tip]');
    await click(page, 'Hide the owl'); await page.waitForTimeout(400);
    check('gone', (await page.getByTestId('owl-tip').count()) === 0);
    check('saved', (await stored(page)).appearance.owl === false);
    await go(page, 'settings'); await page.waitForSelector('[data-testid=appearance]');
    await page.getByRole('switch', { name: 'Show the owl' }).click(); await page.waitForTimeout(300);
    await go(page, 'learning');
    check('back', (await page.getByTestId('owl-tip').count()) === 1);
  }, page);
  await ctx.close();
}

// ───────────── F ─────────────
for (const size of WIDTHS.filter((s) => s.w <= 430 || s.w === 768)) {
  const { ctx, page } = await mk(size);
  await onboard(page, ['Learning', 'Movement']);
  await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('cleanflow:v1'));
    d.appearance = { ...d.appearance, fontSize: 'xlarge', font: 'clear', density: 'compact', palette: 'dusk', theme: 'dark' };
    d.interests.items = [{ id: 'i1', name: 'A very long name for an interest that has to wrap on a narrow phone screen', catalogId: null, category: 'making', status: 'active', goal: 'A long goal in the person\'s own words that also has to wrap', weeklyMinutes: 90, note: '', createdAt: new Date().toISOString() }];
    d.interests.books = [{ id: 'b1', title: 'An extremely long book title that needs to wrap without pushing the screen sideways', author: 'Somebody With A Long Name', status: 'reading', pagesTotal: 300, pagesRead: 120, addedAt: new Date().toISOString(), finishedAt: null, note: 'x '.repeat(100) }];
    d._rev += 3; localStorage.setItem('cleanflow:v1', JSON.stringify(d));
  });
  await page.reload(); await page.waitForSelector('main h1');
  for (const r of ['today', 'learning', 'learning?tab=discover', 'learning?tab=reading', 'learning?tab=plan', 'movement', 'settings', 'more']) {
    await step(`F ${r} at ${size.w}px, largest text, wide font, compact: no overflow, valid ARIA`, async () => {
      await go(page, r);
      const a = await page.evaluate(auditPage);
      check('no horizontal overflow', a.docOverflow <= 0 && a.wide.length === 0, JSON.stringify(a.wide));
      check('every control is named', a.unnamed.length === 0, a.unnamed.join(' '));
      check('ARIA states match roles', a.badAria.length === 0, a.badAria.join(' '));
      check('the bottom bar fits', a.navOverflow <= 0, String(a.navOverflow));
    }, page);
  }
  await step(`F learning sheets fit at ${size.w}px with the largest text`, async () => {
    await go(page, 'learning');
    for (const open of [
      async () => page.getByRole('button', { name: /Open details/ }).first().click(),
      async () => page.getByRole('button', { name: 'Add an interest' }).click(),
      async () => page.getByRole('button', { name: /^Log a session of/ }).first().click(),
    ]) {
      await open();
      await sheet(page);
      const box = await page.locator('[role=dialog]').boundingBox();
      check('inside the viewport', box.x >= -1 && box.x + box.width <= size.w + 1 && box.y >= -1, JSON.stringify(box));
      check('no overflow inside', (await page.evaluate(auditPage)).docOverflow <= 0);
      check('the footer buttons can be reached', (await page.locator('[role=dialog] .sheet-foot button').first().boundingBox()).y + 10 < size.h);
      await page.keyboard.press('Escape');
      await page.waitForSelector('role=dialog', { state: 'detached' });
    }
  }, page);
  await ctx.close();
}

await browser.close();
done(errors);
