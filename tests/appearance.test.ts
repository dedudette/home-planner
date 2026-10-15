import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
import { contrast, hexToRgb, rgbToHex, rgbToHsl } from '../src/domain/appearance/color';
import { accentTokens, FOCUS_MIN, paletteTokens, READABLE_PAIRS, type Mode } from '../src/domain/appearance/palettes';
import { PALETTES } from '../src/domain/appearance/types';

const MODES: Mode[] = ['light', 'dark'];

describe('contrast arithmetic', () => {
  it('matches the WCAG definition', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrast('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    expect(contrast('#767676', '#ffffff')).toBeCloseTo(4.54, 1); // the classic threshold grey
    expect(contrast('#777777', '#ffffff')).toBeLessThan(4.5);
    expect(rgbToHex(hexToRgb('#2f6b5a')!)).toBe('#2f6b5a');
    expect(Math.round(rgbToHsl(hexToRgb('#ff0000')!).h)).toBe(0);
  });
});

describe('every palette is readable in light and dark', () => {
  for (const p of PALETTES) for (const mode of MODES) {
    it(`${p} (${mode}): every text pair meets its contrast minimum`, () => {
      const t = paletteTokens(p, mode);
      for (const pair of READABLE_PAIRS) expect(contrast(t[pair.fg], t[pair.bg]), `${p}/${mode}: ${pair.what}`).toBeGreaterThanOrEqual(pair.min);
    });
    it(`${p} (${mode}): the focus ring stands out from the page and from cards`, () => {
      const t = paletteTokens(p, mode);
      expect(contrast(t['--primary'], t['--bg']), 'on the page').toBeGreaterThanOrEqual(FOCUS_MIN);
      expect(contrast(t['--primary'], t['--surface']), 'on a card').toBeGreaterThanOrEqual(FOCUS_MIN);
    });
    it(`${p} (${mode}): every token is a real colour and the surfaces are distinct`, () => {
      const t = paletteTokens(p, mode);
      for (const [k, v] of Object.entries(t)) expect(/^#[0-9a-f]{6}$/.test(v), `${p}/${mode} ${k}=${v}`).toBe(true);
      expect(new Set([t['--bg'], t['--surface'], t['--bg-deep']]).size).toBe(3);
    });
  }
  it('the palettes are really different from each other', () => {
    const primaries = new Set(PALETTES.map((p) => paletteTokens(p, 'light')['--primary']));
    expect(primaries.size).toBe(PALETTES.length);
  });
});

describe('the sage palette is exactly what styles.css has', () => {
  const block = (src: string): Record<string, string> => Object.fromEntries([...src.matchAll(/(--[a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map((m) => [m[1], m[2].toLowerCase()]));
  const light = block(css.slice(css.indexOf(':root {'), css.indexOf('@media (prefers-color-scheme: dark)')));
  const dark = block(css.slice(css.indexOf('@media (prefers-color-scheme: dark)'), css.indexOf('* { box-sizing')));
  it('light', () => { for (const [k, v] of Object.entries(paletteTokens('sage', 'light'))) expect(light[k], k).toBe(v); });
  it('dark', () => { for (const [k, v] of Object.entries(paletteTokens('sage', 'dark'))) expect(dark[k], k).toBe(v); });
});

describe('a custom accent is always made readable, and says when it was adjusted', () => {
  const accents = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#fff200', '#ffe0f0', '#fafafa', '#050505', '#808080', '#00bcd4', '#ff69b4', '#8a2be2'];
  for (const a of accents) for (const p of PALETTES) for (const mode of MODES) {
    it(`${a} on ${p} (${mode})`, () => {
      const r = accentTokens(a, p, mode)!;
      expect(r).not.toBeNull();
      const t = r.tokens;
      expect(contrast(t['--primary'], t['--bg']), 'links on the page').toBeGreaterThanOrEqual(4.5);
      expect(contrast(t['--primary'], t['--surface']), 'links on a card').toBeGreaterThanOrEqual(4.5);
      expect(contrast(t['--primary-ink'], t['--primary']), 'button text').toBeGreaterThanOrEqual(4.5);
      expect(contrast(t['--primary'], t['--primary-soft']), 'text on soft primary').toBeGreaterThanOrEqual(4.5);
      expect(contrast(t['--ink'], t['--primary-soft']), 'body text on soft primary').toBeGreaterThanOrEqual(7);
    });
  }
  it('keeps the hue the person chose and reports adjustments honestly', () => {
    const red = accentTokens('#d32f2f', 'sage', 'light')!;
    expect(Math.abs(rgbToHsl(hexToRgb(red.tokens['--primary'])!).h - rgbToHsl(hexToRgb('#d32f2f')!).h)).toBeLessThan(3);
    expect(accentTokens('#fff200', 'sage', 'light')!.adjusted).toBe(true);
    expect(accentTokens('#1b5e20', 'sage', 'light')!.adjusted).toBe(false);
  });
  it('refuses anything that is not a colour', () => {
    expect(accentTokens('red', 'sage', 'light')).toBeNull();
    expect(accentTokens('#12345', 'sage', 'light')).toBeNull();
    expect(accentTokens('javascript:alert(1)', 'sage', 'light')).toBeNull();
    expect(accentTokens('#12345g', 'sage', 'light')).toBeNull();
  });
});

describe('no remote font requests', () => {
  it('the page loads no web fonts from a third party', () => {
    expect(html).not.toMatch(/fonts\.googleapis|fonts\.gstatic|use\.typekit|cdn\./i);
    expect(html).not.toMatch(/<link[^>]+rel="stylesheet"[^>]+https?:/i);
  });
});

import { applyAppearance, effectiveMode, effectiveMotion, FONT_STACKS, readAppearance, SIZE_PERCENT, type Target } from '../src/domain/appearance/apply';
import { DEFAULT_APPEARANCE, FONTS, type Appearance } from '../src/domain/appearance/types';

const fake = () => {
  const attrs = new Map<string, string>(); const vars = new Map<string, string>();
  const t: Target = { setAttribute: (k, v) => void attrs.set(k, v), removeAttribute: (k) => void attrs.delete(k), style: { setProperty: (k, v) => void vars.set(k, v), removeProperty: (k) => void vars.delete(k) } };
  return { t, attrs, vars };
};
const env = { prefersDark: false, prefersReduced: false };
const A = (patch: Partial<Appearance>): Appearance => ({ ...DEFAULT_APPEARANCE, ...patch });

describe('applying appearance to the page', () => {
  it('the default sets attributes only and leaves the stylesheet\'s own colours alone', () => {
    const { t, attrs, vars } = fake();
    applyAppearance(DEFAULT_APPEARANCE, t, env);
    expect(attrs.get('data-palette')).toBe('sage');
    expect(attrs.has('data-theme')).toBe(false);
    expect([...vars.keys()].filter((k) => k.startsWith('--') && k !== '--font-body')).toEqual([]);
    expect(vars.has('font-size')).toBe(false);
  });
  it('light, dark and system resolve against the device preference', () => {
    expect(effectiveMode(A({ theme: 'system' }), { ...env, prefersDark: true })).toBe('dark');
    expect(effectiveMode(A({ theme: 'system' }), env)).toBe('light');
    expect(effectiveMode(A({ theme: 'light' }), { ...env, prefersDark: true })).toBe('light');
    const { t, attrs } = fake();
    applyAppearance(A({ theme: 'dark' }), t, env);
    expect(attrs.get('data-theme')).toBe('dark');
  });
  it('another palette sets every colour token, and switching back removes them', () => {
    const { t, vars } = fake();
    applyAppearance(A({ palette: 'ocean' }), t, env);
    expect(vars.get('--primary')).toBe(paletteTokens('ocean', 'light')['--primary']);
    expect(vars.size).toBeGreaterThanOrEqual(16);
    applyAppearance(A({ palette: 'sage' }), t, env);
    expect(vars.has('--primary')).toBe(false);
  });
  it('a custom accent overrides the palette\'s primary and reports when it had to be adjusted', () => {
    const { t, vars } = fake();
    const r = applyAppearance(A({ accent: '#fff200' }), t, env);
    expect(r.accentAdjusted).toBe(true);
    expect(contrast(vars.get('--primary')!, vars.get('--surface') ?? '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(applyAppearance(A({ accent: '#1b5e20' }), fake().t, env).accentAdjusted).toBe(false);
  });
  it('motion follows the device unless the person chose', () => {
    expect(effectiveMotion(A({ motion: 'system' }), { ...env, prefersReduced: true })).toBe('reduced');
    expect(effectiveMotion(A({ motion: 'system' }), env)).toBe('full');
    expect(effectiveMotion(A({ motion: 'full' }), { ...env, prefersReduced: true })).toBe('full');
    expect(effectiveMotion(A({ motion: 'reduced' }), env)).toBe('reduced');
  });
  it('font choices are system fonts only, and size scales from the browser\'s own', () => {
    for (const f of FONTS) expect(JSON.stringify(FONT_STACKS[f])).not.toMatch(/https?:|url\(/);
    const { t, vars } = fake();
    applyAppearance(A({ font: 'clear', fontSize: 'large' }), t, env);
    expect(vars.get('--font-body')).toBe(FONT_STACKS.clear.body);
    expect(vars.get('font-size')).toBe(`${SIZE_PERCENT.large}%`);
    expect(SIZE_PERCENT.small).toBeLessThan(100);
    expect(SIZE_PERCENT.xlarge).toBeGreaterThan(SIZE_PERCENT.large);
  });
  it('reads anything safely', () => {
    expect(readAppearance(undefined)).toEqual(DEFAULT_APPEARANCE);
    expect(readAppearance({ theme: 'neon', palette: 'dusk', accent: 'red', font: 'serif', fontSize: 'huge', density: 'compact', motion: 'x', owl: 'yes' })).toEqual({ ...DEFAULT_APPEARANCE, palette: 'dusk', font: 'serif', density: 'compact' });
    expect(readAppearance({ accent: '#ABCDEF' }).accent).toBe('#abcdef');
  });
});
