import { accentTokens, paletteTokens, type Mode, type Tokens } from './palettes';
import { DEFAULT_APPEARANCE, FONTS, DENSITIES, FONT_SIZES, MOTIONS, PALETTES, THEMES, type Appearance, type FontChoice, type FontSize } from './types';

/**
 * Turning a person's appearance choices into attributes and CSS variables on the page. Pure with respect to its inputs, so it can be
 * tested without a browser. Only system fonts are used: nothing here makes a request to anyone.
 */
export const FONT_STACKS: Record<FontChoice, { body: string; head: string }> = {
  standard: { body: "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif", head: "'Fraunces', 'Iowan Old Style', 'Palatino Linotype', Georgia, serif" },
  system: { body: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif", head: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" },
  serif: { body: "Georgia, 'Iowan Old Style', 'Palatino Linotype', 'Times New Roman', serif", head: "Georgia, 'Iowan Old Style', 'Palatino Linotype', 'Times New Roman', serif" },
  clear: { body: "Verdana, Tahoma, 'DejaVu Sans', 'Segoe UI', sans-serif", head: "Verdana, Tahoma, 'DejaVu Sans', 'Segoe UI', sans-serif" },
};

/** Root text size as a share of the browser's own size (so a person's browser setting still counts). */
export const SIZE_PERCENT: Record<FontSize, number> = { small: 93.75, medium: 100, large: 112.5, xlarge: 125 };

export interface Target {
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  style: { setProperty(name: string, value: string): void; removeProperty(name: string): void };
}
export interface Env { prefersDark: boolean; prefersReduced: boolean }

export const effectiveMode = (a: Appearance, env: Env): Mode => (a.theme === 'system' ? (env.prefersDark ? 'dark' : 'light') : a.theme);
export const effectiveMotion = (a: Appearance, env: Env): 'reduced' | 'full' => (a.motion === 'system' ? (env.prefersReduced ? 'reduced' : 'full') : a.motion === 'reduced' ? 'reduced' : 'full');

const TOKEN_NAMES = Object.keys(paletteTokens('sage', 'light')) as (keyof Tokens)[];

export const applyAppearance = (a: Appearance, root: Target, env: Env): { accentAdjusted: boolean; mode: Mode; tokens: Tokens | null } => {
  const mode = effectiveMode(a, env);
  if (a.theme === 'system') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', a.theme);
  root.setAttribute('data-palette', a.palette);
  root.setAttribute('data-font', a.font);
  root.setAttribute('data-size', a.fontSize);
  root.setAttribute('data-density', a.density);
  root.setAttribute('data-motion', effectiveMotion(a, env));
  root.style.setProperty('color-scheme', mode);

  let tokens: Tokens | null = null;
  let accentAdjusted = false;
  if (a.accent) {
    const r = accentTokens(a.accent, a.palette, mode);
    if (r) { tokens = r.tokens; accentAdjusted = r.adjusted; }
  }
  if (!tokens && a.palette !== 'sage') tokens = paletteTokens(a.palette, mode);
  // The built-in sage palette is in the stylesheet itself, so with it and no accent nothing needs to be set.
  for (const k of TOKEN_NAMES) { if (tokens) root.style.setProperty(k, tokens[k]); else root.style.removeProperty(k); }

  if (a.font === 'standard') { root.style.removeProperty('--font-body'); root.style.removeProperty('--font-head'); }
  else { root.style.setProperty('--font-body', FONT_STACKS[a.font].body); root.style.setProperty('--font-head', FONT_STACKS[a.font].head); }
  if (a.fontSize === 'medium') root.style.removeProperty('font-size'); else root.style.setProperty('font-size', `${SIZE_PERCENT[a.fontSize]}%`);
  return { accentAdjusted, mode, tokens };
};

const isHex = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
const pick = <T extends string>(v: unknown, allowed: readonly T[], d: T): T => (typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : d);

/** Reads anything into a valid Appearance. Unknown values fall back to the default; an accent that is not #rrggbb is dropped. */
export const readAppearance = (raw: unknown): Appearance => {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const D = DEFAULT_APPEARANCE;
  return {
    theme: pick(r.theme, THEMES, D.theme), palette: pick(r.palette, PALETTES, D.palette), accent: isHex(r.accent) ? r.accent.toLowerCase() : null, font: pick(r.font, FONTS, D.font),
    fontSize: pick(r.fontSize, FONT_SIZES, D.fontSize), density: pick(r.density, DENSITIES, D.density), motion: pick(r.motion, MOTIONS, D.motion), owl: typeof r.owl === 'boolean' ? r.owl : D.owl,
  };
};
