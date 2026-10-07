// Shared helpers for the browser checks. Needs a running dev server (npm run dev) and Chromium (set CHROME_PATH if needed).
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

export const BASE = process.env.BASE_URL || 'http://127.0.0.1:5173/';
export const OUT = './e2e-shots';
mkdirSync(OUT, { recursive: true });

export const launch = () => chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });

/** Target widths for every layout check. */
export const WIDTHS = [
  { w: 320, h: 640, mobile: true }, { w: 360, h: 740, mobile: true }, { w: 390, h: 844, mobile: true }, { w: 430, h: 932, mobile: true },
  { w: 768, h: 1024, mobile: false }, { w: 1024, h: 768, mobile: false }, { w: 1366, h: 860, mobile: false },
];

export const newContext = (browser, { w, h, mobile } = { w: 390, h: 844, mobile: true }) =>
  browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile, acceptDownloads: true });

export const watch = (page, errors, label = '', ignore = null) => {
  page.setDefaultTimeout(7000);
  page.on('pageerror', (e) => { if (!(ignore && ignore.test(e.message))) errors.push(`PAGEERROR ${label} ${e.message}`); });
  // Fonts come from a CDN that sandboxes block; that is not an app error.
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_CERT|Failed to load resource|ERR_NAME_NOT_RESOLVED|ERR_PROXY|fonts\.g/.test(m.text()) && !(ignore && ignore.test(m.text()))) errors.push(`console ${label} ${m.text().slice(0, 200)}`); });
};

export const fresh = async (page, hash = '') => {
  await page.goto(BASE);
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.goto(BASE + (hash ? `#/${hash}` : ''));
  await page.reload();
};

export const loadDemo = async (page, title, ready = 'text=Habits & routine') => {
  await fresh(page);
  await page.getByText(title).first().click();
  await page.waitForSelector(ready);
  await page.waitForTimeout(500);
};

export const DEMOS = { student: 'Student: study, focus & less phone', beginner: 'Beginner: discipline & fitness', family: 'Family house with a dog', studio: 'Studio, low energy' };

export const stored = (page) => page.evaluate(() => { const t = localStorage.getItem('cleanflow:v1'); return t ? JSON.parse(t) : null; });
export const entriesOf = async (page) => ((await stored(page))?.sessions ?? []).flatMap((s) => s.entries);

let failures = 0;
export const runner = (name) => {
  const ok = (what, extra = '') => console.log(`ok   ${what}${extra ? ' ' + extra : ''}`);
  const fail = (what, why) => { failures++; process.exitCode = 1; console.log(`FAIL ${what}: ${why}`); };
  const check = (what, cond, detail = '') => { if (cond) ok(what); else fail(what, detail); };
  const step = async (what, fn, page) => {
    try { await fn(); ok(what); } catch (e) {
      fail(what, String(e.message).split('\n').slice(0, 4).join(' | '));
      if (page) await page.screenshot({ path: `${OUT}/fail-${name}-${what.replace(/\W+/g, '_').slice(0, 40)}.png` }).catch(() => {});
    }
  };
  const done = (errors) => {
    if (errors.length) { failures++; process.exitCode = 1; console.log('CONSOLE ERRORS:\n' + errors.join('\n')); } else console.log('no console errors');
    console.log(failures ? `${name.toUpperCase()}: FAILED (${failures})` : `${name.toUpperCase()}: PASSED`);
  };
  return { ok, fail, check, step, done };
};

/** In-page audit of a rendered screen: layout overflow plus the accessibility rules we have broken before. */
export const auditPage = () => {
  const vw = document.documentElement.clientWidth;
  const inScroller = (el) => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll') return true; } return false; };
  const wide = [];
  document.querySelectorAll('body *').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (!r.width || getComputedStyle(el).position === 'fixed' && el.classList.contains('toasts')) return;
    if (r.right > vw + 1 && !inScroller(el) && !el.closest('.sr-only')) wide.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]}(${Math.round(r.right)})`);
  });
  const nav = document.querySelector('.bottomnav');
  // The state attribute must match the role: radio/checkbox -> aria-checked, tab -> aria-selected, plain toggle -> aria-pressed.
  const badAria = [...document.querySelectorAll('[role]')].filter((e) => {
    const r = e.getAttribute('role');
    if (r === 'radio' || r === 'checkbox') return e.hasAttribute('aria-pressed') || e.hasAttribute('aria-selected');
    if (r === 'tab') return e.hasAttribute('aria-pressed') || e.hasAttribute('aria-checked');
    return false;
  }).map((e) => e.outerHTML.slice(0, 90));
  const heads = [...document.querySelectorAll('main h1, main h2, main h3, main h4')].map((h) => Number(h.tagName[1]));
  const skips = heads.filter((l, i) => i > 0 && l > heads[i - 1] + 1);
  const unnamed = [...document.querySelectorAll('button, a[href]')].filter((b) => !(b.getAttribute('aria-label') || b.textContent.trim() || b.getAttribute('title'))).map((b) => b.outerHTML.slice(0, 80));
  const smallChips = [...document.querySelectorAll('.chip')].filter((c) => { const r = c.getBoundingClientRect(); return r.width && r.height < 40; }).length;
  return { vw, docOverflow: document.documentElement.scrollWidth - vw, wide: wide.slice(0, 4), navOverflow: nav ? Math.max(0, nav.getBoundingClientRect().right - vw) : 0, badAria, skips, unnamed, smallChips };
};
