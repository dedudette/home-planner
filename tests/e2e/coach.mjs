// "Your patterns" and the optional AI coach, in a real browser.
//
// This suite starts its own dev servers (the shared one on :5173 has no provider settings) and a stand-in for the provider's HTTP API
// (tests/e2e/fakeProvider.mjs), so the real server code, prompt and answer checks all run. It never talks to a real provider, and it
// proves nothing about one: a live provider call has to be tested separately with real credentials.
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const PORT = 5174, PORT_OFF = 5175;
process.env.BASE_URL = `http://127.0.0.1:${PORT}/`;
const { BASE, WIDTHS, auditPage, launch, newContext, runner, stored, watch } = await import('./lib.mjs');
const { startFakeProvider } = await import('./fakeProvider.mjs');

const { check, step, done } = runner('coach');
const SENTINEL = 'sk-test-SENTINEL-must-never-reach-a-browser-0451';
const TODAY = '2026-10-05';
const errors = [];
const allBodies = [];
const want = (n) => !process.env.COACH_ONLY || process.env.COACH_ONLY.split(',').includes(String(n));

// ───────────── servers ─────────────
const provider = await startFakeProvider();
const procs = [];
const startVite = async (port, env) => {
  const p = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  procs.push(p);
  let out = ''; p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { out += d; });
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/api/coach/status`); if (r.ok) return out; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`dev server on ${port} did not start:\n${out.slice(-400)}`);
};
const clean = { ANTHROPIC_API_KEY: '', COACH_PROVIDER: '', COACH_MODEL: '', COACH_API_BASE_URL: '' };
const bootLog = await startVite(PORT, { ...clean, ANTHROPIC_API_KEY: SENTINEL, COACH_API_BASE_URL: provider.url, COACH_MODEL: 'e2e-model', COACH_COOLDOWN_SECONDS: '5', COACH_TIMEOUT_MS: '2500', COACH_DAILY_PER_CLIENT: '200', COACH_DAILY_TOTAL: '1000' });
const offLog = await startVite(PORT_OFF, clean);
const stop = async () => { for (const p of procs) p.kill('SIGTERM'); await provider.close(); };
process.on('exit', () => { for (const p of procs) p.kill('SIGKILL'); });

const browser = await launch();
const mk = async (opts, base = BASE) => {
  const ctx = await newContext(browser, opts);
  const page = await ctx.newPage(); watch(page, errors);
  await page.clock.install({ time: new Date(2026, 9, 5, 8, 15) });   // starts at the usual test morning, then runs in real time so waits and cooldowns elapse
  await page.clock.resume();
  page.on('response', async (r) => { try { const ct = r.headers()['content-type'] ?? ''; if (/json|text|javascript|html|css/.test(ct)) allBodies.push(await r.text()); } catch { /* streamed or gone */ } });
  await page.goto(base); await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); }); await page.reload();
  await page.getByText('Student: study, focus & less phone').first().click();
  await page.waitForSelector('.hero-card'); await page.waitForTimeout(700);
  return { ctx, page, base };
};
const patch = (page, src) => page.evaluate((s) => { const d = JSON.parse(localStorage.getItem('cleanflow:v1')); new Function('d', s)(d); d._rev = (d._rev ?? 0) + 100; localStorage.setItem('cleanflow:v1', JSON.stringify(d)); }, src);

/** Ten recorded days built from today's own record: seven with a display record, one gap, one older-format day, plus a few explicit actions. */
const SEED = `
  const today = d.exposures.find((e) => e.date === '${TODAY}');
  const iso = (off) => { const t = new Date(Date.UTC(2026, 9, 5 + off)); return t.toISOString().slice(0, 10); };
  d.exposures = d.exposures.filter((e) => e.date === '${TODAY}');
  d.sessions = [];
  for (let off = -9; off <= -1; off++) {
    if (off === -5) continue;                                              // a day the app was not opened
    const date = iso(off);
    const legacy = off === -7;
    const items = today.items.map((i) => { const x = { ...i }; delete x.seenAt; return legacy ? { ...x, shownAt: date + 'T07:00:00.000Z' } : { ...x, selectedAt: date + 'T07:00:00.000Z', seenAt: date + 'T07:01:00.000Z' }; });
    if (legacy) items.forEach((i) => { delete i.selectedAt; });
    const rec = { date, recordedAt: date + 'T07:00:00.000Z', planVersion: today.planVersion, activeDay: true, energy: 'ok', tzOffsetMin: 0, budgetMinutes: today.budgetMinutes, items };
    if (!legacy) { rec.contract = 2; rec.left = (off % 2 === 0 ? [{ taskId: 'left:' + off, templateId: null, domain: 'home', minutes: 20, difficulty: 1, reason: 'not-enough-time', at: date + 'T07:00:00.000Z', energy: 'ok', budget: 15 }] : []); }
    d.exposures.push(rec);
    const entry = (i, n, outcome) => ({ id: 'seed-' + off + '-' + n, at: date + 'T0' + (8 + n) + ':00:00.000Z', date, taskId: i.taskId, name: 'seeded task ' + n, roomKind: 'home', roomName: 'Seeded room', category: 'Seeded', plannedMinutes: 5, actualMinutes: outcome === 'completed' ? 5 : 0, outcome, via: 'checkoff', domain: i.domain === 'home' ? undefined : i.domain });
    const es = [];
    if (items[0]) es.push(entry(items[0], 0, 'completed'));
    if (items[1]) es.push(entry(items[1], 1, off % 3 === 0 ? 'skipped' : 'completed'));
    if (es.length) d.sessions.push({ id: 's' + off, date, startedAt: es[0].at, endedAt: es[es.length - 1].at, entries: es });
  }
  d.exposures.sort((a, b) => (a.date < b.date ? -1 : 1));
`;

const read = (page, id) => page.getByTestId(id).innerText().then((t) => Number(t.trim()));
const PLAN_KEYS = ['plan', 'home', 'preferences', 'customTasks', 'taskStates', 'dayEnergy', 'energyLog', 'sessions', 'planVersions', 'onboardingComplete', 'user'];
const planState = async (page) => { const d = await stored(page); return JSON.stringify(PLAN_KEYS.map((k) => d[k])); };

/** An independent count from the stored data, not from the app's own functions. */
const oracle = (d, windowDays) => {
  const from = new Date(Date.UTC(2026, 9, 5 - (windowDays - 1))).toISOString().slice(0, 10);
  const o = { opened: 0, seen: 0, completed: 0, skipped: 0, noAction: 0, pending: 0, left: 0 };
  const entries = d.sessions.flatMap((s) => s.entries);
  for (const e of d.exposures) {
    if (e.contract !== 2 || e.date < from || e.date > TODAY) continue;
    o.opened++;
    o.left += (e.left ?? []).filter((x) => x.reason === 'not-enough-time').length;
    for (const i of e.items) {
      if (!i.seenAt) continue;
      o.seen++;
      const es = entries.filter((x) => x.date === e.date && x.taskId === i.taskId).sort((a, b) => (a.at < b.at ? -1 : 1));
      const last = es[es.length - 1];
      if (!last) { if (e.date === TODAY) o.pending++; else o.noAction++; } else if (last.outcome === 'completed') o.completed++; else if (last.outcome === 'skipped') o.skipped++;
    }
  }
  return o;
};

const goPatterns = async (page) => { await page.evaluate(() => (location.hash = '#/patterns')); await page.waitForSelector('[data-testid=patterns-window]'); await page.waitForTimeout(300); };
const waitCooldown = (page) => page.waitForTimeout(5400);

// ───────────── 1. a new user ─────────────
if (want(1)) {
  const { ctx, page } = await mk({ w: 390, h: 844, mobile: true });
  const apiCalls = [];
  page.on('request', (r) => { if (r.url().includes('/api/coach')) apiCalls.push(`${r.method()} ${new URL(r.url()).pathname}`); });
  await step('a new user sees "not enough recorded yet", the known days, and no AI offer they can use', async () => {
    await goPatterns(page);
    check('the insufficient notice is shown', (await page.getByTestId('patterns-insufficient').count()) === 1);
    const t = await page.getByTestId('patterns-insufficient').innerText();
    check('it says what is needed and what there is', /at least 3 days/.test(t) && /5 tasks/.test(t) && /1 opened day/.test(t), t);
    check('the facts cards are not shown', (await page.getByTestId('pt-seen-total').count()) === 0);
    check('the day strip has one entry per day', (await page.locator('.pday-strip li').count()) === 14);
    check('the Ask button is disabled and says why', (await page.getByRole('button', { name: 'Ask AI for suggestions' }).isDisabled()) && /Available once this window has/.test(await page.locator('#coach-why').innerText()));
    await page.getByRole('button', { name: 'Ask AI for suggestions' }).click({ force: true, timeout: 800 }).catch(() => undefined);
    await page.waitForTimeout(400);
    check('nothing was requested from the AI endpoint (not even a status check)', apiCalls.length === 0, apiCalls.join(','));
  }, page);
  await step('the page is reachable from Progress and from More, and Progress stays highlighted', async () => {
    await page.evaluate(() => (location.hash = '#/progress')); await page.waitForSelector('[data-testid=patterns-link]');
    await page.getByTestId('patterns-link').click();
    await page.waitForSelector('[data-testid=patterns-window]');
    check('Progress is the current nav item on Your patterns', (await page.locator('.bottomnav [aria-current=page]').innerText()).trim() === 'Progress');
    check('the document title names the page', /Your patterns/.test(await page.title()));
    await page.evaluate(() => (location.hash = '#/more')); await page.waitForSelector('text=What the app recorded, plus optional AI suggestions');
  }, page);
  await ctx.close();
}

// ───────────── 2. real counts, windows and notes ─────────────
if (want(2)) {
  const { ctx, page } = await mk({ w: 390, h: 844, mobile: true });
  await patch(page, SEED); await page.reload(); await page.waitForSelector('.hero-card'); await page.waitForTimeout(800);
  await step('the counts on the page match an independent count from the stored data, in every window', async () => {
    await goPatterns(page);
    const d = await stored(page);
    for (const w of [7, 14, 28]) {
      await page.getByRole('tab', { name: `${w} days` }).click(); await page.waitForTimeout(250);
      const o = oracle(d, w);
      check(`${w} days: the date range and length are shown`, /Oct|Sep/.test(await page.getByTestId('patterns-window').innerText()) && (await page.getByTestId('patterns-window').innerText()).includes(`${w} days`));
      check(`${w} days: opened days = ${o.opened}`, (await read(page, 'pt-days-opened')) === o.opened, String(await read(page, 'pt-days-opened')));
      check(`${w} days: shown tasks = ${o.seen}`, (await read(page, 'pt-seen-total')) === o.seen);
      check(`${w} days: completed = ${o.completed}`, (await read(page, 'pt-completed')) === o.completed);
      check(`${w} days: skipped = ${o.skipped}`, (await read(page, 'pt-skipped')) === o.skipped);
      check(`${w} days: shown with no recorded action = ${o.noAction}`, (await read(page, 'pt-no-action')) === o.noAction);
      check(`${w} days: left out for time = ${o.left}`, (await read(page, 'pt-left-time')) === o.left);
    }
  }, page);
  await step('the day statuses add up, and the gap and the older-format day are labelled as what they are', async () => {
    await page.getByRole('tab', { name: '14 days' }).click(); await page.waitForTimeout(200);
    const n = { opened: await read(page, 'pt-days-opened'), no: await read(page, 'pt-days-not-opened'), acted: await read(page, 'pt-days-acted'), unk: await read(page, 'pt-days-unknown') };
    check('14 days add up', n.opened + n.no + n.acted + n.unk === 14, JSON.stringify(n));
    check('exactly one day was not opened (records exist on both sides)', n.no === 1, JSON.stringify(n));
    check('the older-format day is "used, but not tracked", not "opened"', n.acted === 1, JSON.stringify(n));
    check('days before tracking began are unknown, not "not opened"', n.unk === 4, JSON.stringify(n));
    check('the older-format day is explained in a note and left out of the counts', /recorded before CleanFlow tracked what Today showed/.test(await page.getByTestId('patterns-note-legacy').innerText()));
    const strip = await page.locator('.pday-strip li .sr-only').allInnerTexts();
    check('every day has a text equivalent for screen readers', strip.length === 14 && strip.every((t) => /: (opened|not opened|used, but not tracked|unknown)$/.test(t)), strip.slice(0, 3).join(' | '));
  }, page);
  await step('"no recorded action" is never called a skip, and the page says what it does and does not mean', async () => {
    const body = await page.locator('main').innerText();
    check('the note says it is not a skip and does not say why', /does not know why, and it is not a skip/.test(body));
    check('nothing on the page explains behaviour', !/lazy|unmotivated|forgot|ignored|because you|gave up/i.test(body));
    check('"shown" is explained as displayed, not read', /does not mean it was read/.test(body));
  }, page);
  await step('tasks the planner left out are listed apart, with its reason, and are not in the shown count', async () => {
    check('the left-out card says they are not something you skipped and not counted as shown', /not something you skipped, and they are not counted as shown/.test(await page.locator('main').innerText()));
    check('the reason rows are the planner\'s words', (await page.getByTestId('pt-left-time').count()) === 1 && (await page.getByTestId('pt-left-energy').count()) === 1 && (await page.getByTestId('pt-left-rest').count()) === 1);
  }, page);
  await step('history removed to save space is stated, with how many days of the window it covers', async () => {
    await patch(page, "d.retention = [{ at: '2026-10-05T00:00:00.000Z', removedSessions: 3, removedEntries: 8, removedThrough: '2026-10-01', oldestKept: '2026-10-02' }];");
    await page.reload(); await page.waitForSelector('[data-testid=patterns-window]'); await page.waitForTimeout(500);
    const note = await page.getByTestId('patterns-note-history').innerText();
    check('the note says history was removed and that those days are not treated as quiet', /removed to save space/.test(note) && /not treated as quiet days/.test(note), note);
    check('and counts the days', /\d+ days? in this window fall in that gap/.test(note), note);
    await patch(page, 'd.retention = [];');
  }, page);
  await ctx.close();
}

// ───────────── 3. the optional AI coach ─────────────
if (want(3)) {
  const { ctx, page } = await mk({ w: 390, h: 844, mobile: true });
  await patch(page, SEED); await page.reload(); await page.waitForSelector('.hero-card'); await page.waitForTimeout(800);
  const apiCalls = [];
  page.on('request', (r) => { if (r.url().includes('/api/coach')) apiCalls.push({ method: r.method(), path: new URL(r.url()).pathname, body: r.postData() }); });
  const before = await planState(page);
  const { name: userName } = (await stored(page)).user;

  await goPatterns(page);
  await step('the AI is off until asked: nothing has been requested from the endpoint', async () => {
    await page.waitForTimeout(800);
    check('no request to /api/coach on arriving at the page', apiCalls.length === 0, JSON.stringify(apiCalls));
    check('the section explains it is optional and that it cannot change the plan', /Off unless you ask/.test(await page.getByTestId('coach').innerText()) && /cannot change your plan/.test(await page.getByTestId('coach').innerText()));
    check('there is no suggestion on screen', (await page.getByTestId('coach-suggestion').count()) === 0);
  }, page);

  let reviewedJson = '';
  await step('"Ask" shows what would be sent, to whom, and what is not sent; only a status check has been made', async () => {
    await page.getByRole('button', { name: 'Ask AI for suggestions' }).click();
    await page.waitForSelector('[data-testid=coach-review]');
    check('exactly one request so far, and it is the status check', apiCalls.length === 1 && apiCalls[0].method === 'GET' && apiCalls[0].path === '/api/coach/status', JSON.stringify(apiCalls));
    check('the provider received nothing', provider.requests.length === 0);
    const t = await page.getByTestId('coach-review').innerText();
    check('it names the provider and model', /Anthropic/.test(t) && /e2e-model/.test(t), t.slice(0, 200));
    check('it lists what is not sent', /Not sent:.*name, task names, room names, dates, notes/.test(t));
    check('it lists every count in words', /Tasks shown on Today/.test(t) && /Days the app was opened/.test(t) && /Tasks left out by the planner: not enough time/.test(t));
    check('focus moved to the review heading', (await page.evaluate(() => document.activeElement?.id)) === 'coach-h');
    await page.getByText('Show the exact data').click();
    reviewedJson = await page.locator('.payload-json').innerText();
    const j = JSON.parse(reviewedJson);
    check('the exact data is the window and counts only', Object.keys(j).sort().join() === 'metrics,v,windowDays' && Object.values(j.metrics).every((v) => Number.isInteger(v)), reviewedJson.slice(0, 120));
    check('it contains no name, task name, room name or date', !(userName && reviewedJson.includes(userName)) && !/seeded|Seeded|2026-|@/.test(reviewedJson));
    check('the cost and accuracy caveats are stated', /paid service, billed to whoever runs this server/.test(t) && /can be wrong/.test(t));
  }, page);

  await step('Cancel sends nothing, closes the review, and returns focus to the button', async () => {
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.waitForTimeout(300);
    check('the review is gone', (await page.getByTestId('coach-review').count()) === 0);
    check('no POST was made', apiCalls.every((c) => c.method !== 'POST'));
    check('the provider received nothing', provider.requests.length === 0);
    check('focus is back on the Ask button', (await page.evaluate(() => document.activeElement?.id)) === 'coach-ask');
  }, page);

  await step('Send posts exactly the reviewed counts, once, and the key stays on the server', async () => {
    provider.setMode('ok');
    await page.getByRole('button', { name: 'Ask AI for suggestions' }).click();
    await page.waitForSelector('[data-testid=coach-review]');
    await page.getByText('Show the exact data').click();
    const reviewed = JSON.parse(await page.locator('.payload-json').innerText());
    await page.getByRole('button', { name: /Send these counts|Send in/ }).click();
    await page.waitForSelector('[data-testid=coach-result]', { timeout: 15000 });
    const posts = apiCalls.filter((c) => c.method === 'POST');
    check('exactly one POST', posts.length === 1, String(posts.length));
    check('its body is the reviewed data', JSON.stringify(JSON.parse(posts[0].body)) === JSON.stringify(reviewed));
    check('the provider received exactly one request', provider.requests.length === 1);
    check('the key was sent to the provider by the server', provider.requests[0].apiKey === SENTINEL);
    check('and the server used the configured model', provider.requests[0].body.model === 'e2e-model');
    const sent = provider.requests[0].body.messages[0].content;
    check('the prompt holds only counts: no name, task or room text', !(userName && sent.includes(userName)) && !/seeded|Seeded|2026-|@/.test(sent));
  }, page);

  await step('the answer is labelled AI-generated, shows its evidence window and the counts it rests on, and offers only optional ideas', async () => {
    check('the AI-generated label is shown', (await page.getByTestId('coach-ai-label').innerText()) === 'AI-generated');
    const win = await page.getByTestId('coach-evidence-window').innerText();
    check('the evidence window states the days, the dates and the strength', /last 14 days/.test(win) && /Sep|Oct/.test(win) && /days opened/.test(win) && /evidence strength: (limited|moderate|good)/.test(win), win);
    const n = await page.getByTestId('coach-suggestion').count();
    check('between one and three suggestions', n >= 1 && n <= 3, String(n));
    const text = await page.getByTestId('coach-result').innerText();
    check('each suggestion lists the counts it is based on', (await page.locator('[data-testid=coach-suggestion] .chips-static li').count()) >= n);
    check('every count shown equals the reviewed value', await page.evaluate((j) => [...document.querySelectorAll('[data-testid=coach-suggestion] .chips-static li')].every((li) => { const label = li.querySelector('span').textContent; const v = Number(li.querySelector('b').textContent); return Object.values(j.metrics).includes(v) && !!label; }), JSON.parse(reviewedJson)));
    check('an idea says nothing changes unless you do it', !/Optional idea/.test(text) || /Nothing changes unless you choose to do it yourself/.test(text));
    check('the footer says it can be wrong and did not change the plan', /AI-generated by Anthropic \(e2e-model\)\. It can be wrong\. It did not change anything in your plan/.test(text));
    check('nothing in it diagnoses or explains', !/because|motivat|lazy|depress|anxious|should|must/i.test(text));
  }, page);

  await step('the plan, goals, tasks, schedule, energy and history are exactly as they were', async () => {
    check('stored plan state is unchanged after the whole exchange', (await planState(page)) === before);
  }, page);

  await step('Dismiss clears it; asking again goes back through the review, and a request inside the wait is held back', async () => {
    await page.getByRole('button', { name: 'Dismiss' }).click();
    check('the result is gone', (await page.getByTestId('coach-result').count()) === 0);
    await page.getByRole('button', { name: 'Ask AI for suggestions' }).click();
    await page.waitForSelector('[data-testid=coach-review]');
    const send = page.getByRole('button', { name: /Send in \d+s|Send these counts/ });
    check('Send is held back with a visible wait time', /Send in \d+s/.test(await send.innerText()) && (await send.isDisabled()), await send.innerText());
    check('still only one POST', apiCalls.filter((c) => c.method === 'POST').length === 1);
    await page.getByRole('button', { name: 'Cancel' }).click();
  }, page);

  for (const [mode, expect, label] of [
    ['unsupported', /I couldn't create a reliable suggestion from this data/, 'unsupported claims and invented evidence'],
    ['malformed', /I couldn't create a reliable suggestion from this data/, 'free text instead of the required format'],
    ['plan-change', /I couldn't create a reliable suggestion from this data/, 'advice to change the plan'],
    ['insufficient', /isn't enough recorded information for a useful suggestion yet/, 'the model saying there is not enough information'],
  ]) {
    await step(`${label}: a calm fallback, never the raw text`, async () => {
      await waitCooldown(page);
      provider.setMode(mode);
      await page.getByRole('button', { name: 'Ask AI for suggestions' }).click();
      await page.waitForSelector('[data-testid=coach-review]');
      await page.getByRole('button', { name: /Send these counts/ }).click();
      await page.waitForSelector('[data-testid=coach-result]', { timeout: 15000 });
      check('the fallback is shown', expect.test(await page.getByTestId('coach-fallback').innerText()));
      check('there are no suggestion cards', (await page.getByTestId('coach-suggestion').count()) === 0);
      const t = await page.getByTestId('coach').innerText();
      check('none of the model\'s text appears', !/999|tired|Increase your daily time|updated your plan|Sure!/.test(t));
      await page.getByRole('button', { name: 'Dismiss' }).click();
    }, page);
  }

  await step('a provider that never answers is cut off with a calm message and the plan is untouched', async () => {
    await waitCooldown(page);
    provider.setMode('slow');
    await page.getByRole('button', { name: 'Ask AI for suggestions' }).click();
    await page.waitForSelector('[data-testid=coach-review]');
    await page.getByRole('button', { name: /Send these counts/ }).click();
    await page.waitForSelector('[data-testid=coach-error]', { timeout: 15000 });
    const t = await page.getByTestId('coach-error').innerText();
    check('it says it took too long and nothing was changed', /took too long/.test(t) && /Nothing was changed/.test(t), t);
    check('no secret detail', !/secret|SENTINEL|sk-/.test(t));
    await page.getByRole('button', { name: 'Close' }).click();
  }, page);

  await step('a provider error is one generic message: its own text never reaches the page', async () => {
    await waitCooldown(page);
    provider.setMode('error500');
    await page.getByRole('button', { name: 'Ask AI for suggestions' }).click();
    await page.waitForSelector('[data-testid=coach-review]');
    await page.getByRole('button', { name: /Send these counts/ }).click();
    await page.waitForSelector('[data-testid=coach-error]', { timeout: 15000 });
    const t = await page.getByTestId('coach-error').innerText();
    check('a generic message', /could not be reached just now\. Nothing was changed/.test(t), t);
    check('the provider\'s own text is not shown', !/secret provider detail/.test(t) && !(await page.locator('body').innerText()).includes('secret provider detail'));
    await page.getByRole('button', { name: 'Close' }).click();
  }, page);

  await step('changing the window drops a pending review, because it would be a different question', async () => {
    await waitCooldown(page);
    provider.setMode('ok');
    await page.getByRole('button', { name: 'Ask AI for suggestions' }).click();
    await page.waitForSelector('[data-testid=coach-review]');
    await page.getByRole('tab', { name: '7 days' }).click();
    await page.waitForTimeout(300);
    check('the review is gone and nothing was sent', (await page.getByTestId('coach-review').count()) === 0);
    await page.getByRole('tab', { name: '14 days' }).click();
  }, page);

  await step('the key never appears anywhere the browser can see: responses, storage, cookies, page text', async () => {
    const all = allBodies.join('\n');
    check(`${allBodies.length} responses were read (every page, from the first request) and none holds the key`, allBodies.length > 100 && !all.includes(SENTINEL) && !all.includes('sk-test'), String(allBodies.length));
    const store = await page.evaluate(async () => JSON.stringify({ l: { ...localStorage }, s: { ...sessionStorage }, c: document.cookie, idb: (await indexedDB.databases?.().catch(() => [])) ?? [], text: document.documentElement.outerHTML }));
    check('not in local storage, session storage, cookies, databases or the page', !store.includes(SENTINEL) && !store.includes('sk-test'));
    check('the saved data holds no AI answer and no provider setting', !/e2e-model|AI-generated|metric_ids|coach/i.test(JSON.stringify((await stored(page)))));
    check('the server note at start-up names settings, not secrets', !bootLog.includes(SENTINEL) && /AI suggestions: on \(anthropic, model e2e-model\)/.test(bootLog), bootLog.slice(-200));
  }, page);
  await ctx.close();
}

// ───────────── 4. a server that is not set up ─────────────
if (want(4)) {
  const { ctx, page } = await mk({ w: 390, h: 844, mobile: true }, `http://127.0.0.1:${PORT_OFF}/`);
  await patch(page, SEED); await page.reload(); await page.waitForSelector('.hero-card'); await page.waitForTimeout(800);
  const posts = [];
  page.on('request', (r) => { if (r.method() === 'POST' && r.url().includes('/api/coach')) posts.push(r.url()); });
  await step('with no provider key on the server, the coach says so plainly and sends nothing', async () => {
    await page.evaluate(() => (location.hash = '#/patterns')); await page.waitForSelector('[data-testid=patterns-window]');
    await page.getByRole('button', { name: 'Ask AI for suggestions' }).click();
    await page.waitForSelector('[data-testid=coach-unavailable]');
    const t = await page.getByTestId('coach-unavailable').innerText();
    check('it says suggestions are not set up, and that nothing was sent', /aren't set up/.test(t) && /Nothing was sent/.test(t), t);
    check('no review step was offered', (await page.getByTestId('coach-review').count()) === 0);
    check('no POST', posts.length === 0);
    check('the server note says how to turn it on, by name only', /set ANTHROPIC_API_KEY in the server environment/.test(offLog));
    await page.getByRole('button', { name: 'Close' }).click();
    check('the rest of the page still works', (await page.getByTestId('pt-seen-total').count()) === 1);
  }, page);
  await ctx.close();
}

// ───────────── 5. layout and accessibility on every width ─────────────
if (want(5)) {
  let askedOnce = false;
  for (const size of WIDTHS) {
    const { ctx, page } = await mk(size);
    await patch(page, SEED); await page.reload(); await page.waitForSelector('.hero-card'); await page.waitForTimeout(600);
    const label = `${size.w}px`;
    const noInnerScroll = (what) => page.evaluate(() => [...document.querySelectorAll('.table-wrap')].filter((w) => w.scrollWidth > w.clientWidth + 1).length).then((n) => check(`${label} · ${what}: the area table fits without sideways scrolling`, n === 0, String(n)));
    const verdict = (what, a) => check(`${label} · ${what} has no overflow and passes the a11y rules`, a.docOverflow <= 0 && a.wide.length === 0 && a.navOverflow === 0 && a.badAria.length === 0 && a.skips.length === 0 && a.unnamed.length === 0, JSON.stringify(a));
    const small = (what) => page.evaluate(() => [...document.querySelectorAll('main button, main a, main summary, main [role=tab]')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.height < 44 || r.width < 44) && !e.closest('.sr-only'); }).map((e) => `${(e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 24)} ${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`)).then((s) => check(`${label} · ${what}: every control is at least 44px`, s.length === 0, s.join(' | ')));
    await step(`${label} · Your patterns, the AI review and an answer`, async () => {
      await goPatterns(page);
      verdict('Your patterns', await page.evaluate(auditPage));
      await noInnerScroll('Your patterns');
      if (size.mobile) await small('Your patterns');
      await page.getByRole('button', { name: 'Ask AI for suggestions' }).click();
      await page.waitForSelector('[data-testid=coach-review]');
      verdict('the AI review', await page.evaluate(auditPage));
      if (size.mobile) await small('the AI review');
      await page.getByText('Show the exact data').click();
      verdict('the exact data open', await page.evaluate(auditPage));
      if (size.w === 320 || size.w === 390 || size.w === 1024) {
        if (askedOnce) await waitCooldown(page);
        provider.setMode('ok');
        await page.getByRole('button', { name: /Send these counts|Send in/ }).click({ timeout: 8000 }).catch(async () => { await page.waitForTimeout(5400); await page.getByRole('button', { name: /Send these counts/ }).click(); });
        await page.waitForSelector('[data-testid=coach-result]', { timeout: 15000 });
        askedOnce = true;
        verdict('an AI answer', await page.evaluate(auditPage));
        if (size.mobile) await small('an AI answer');
      }
    }, page);
    await ctx.close();
  }
}

// ───────────── 6. a built bundle ─────────────
if (want(6)) await step('the production bundle contains no key, provider address, SDK or server setting', async () => {
  check('a build exists (run npm run build first)', existsSync('dist/assets'));
  const walk = (dir) => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
  const files = walk('dist').filter((f) => /\.(js|css|html)$/.test(f));
  const text = files.map((f) => readFileSync(f, 'utf8')).join('\n');
  for (const [name, re] of [['the key variable name', /ANTHROPIC/i], ['the key header', /x-api-key/i], ['the provider address', /api\.anthropic\.com/i], ['a key-shaped string', /sk-ant-|sk-test-/], ['a server setting', /COACH_(MODEL|PROVIDER|API_BASE_URL|DISABLED|TIMEOUT_MS|MAX_OUTPUT_TOKENS|COOLDOWN_SECONDS|DAILY_|ALLOWED_ORIGINS|TRUST_PROXY)/], ['the SDK', /@anthropic-ai/]]) check(`${files.length} built files do not contain ${name}`, !re.test(text));
  check('the app does call its own endpoint', /\/api\/coach/.test(text));
}, null);

await browser.close();
await stop();
done(errors);
