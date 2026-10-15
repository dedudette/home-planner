import { contrast, hexToRgb, hsl, rgbToHsl } from './color';
import type { Palette } from './types';

/**
 * Every colour the interface uses, as one coordinated set per palette and mode. Tokens are derived from a hue so a palette is
 * consistent by construction, and a test checks every readable pair (text on its background, button text on its button, links, focus
 * rings) against WCAG contrast for every palette, in light and dark, and for any custom accent.
 */
export interface Tokens {
  '--bg': string; '--bg-deep': string; '--surface': string; '--surface-2': string; '--line': string; '--line-strong': string;
  '--ink': string; '--ink-2': string; '--muted': string;
  '--primary': string; '--primary-hover': string; '--primary-ink': string; '--primary-soft': string; '--primary-line': string; '--primary-soft-hover': string; '--good': string;
}
export type Mode = 'light' | 'dark';

/** The original sage palette, exactly as styles.css has it (a test keeps the two in step). */
const SAGE: Record<Mode, Tokens> = {
  light: {
    '--bg': '#f6f2ea', '--bg-deep': '#efe9dd', '--surface': '#ffffff', '--surface-2': '#fbf8f2', '--line': '#e4ddcf', '--line-strong': '#cfc6b4', '--ink': '#1f2a25', '--ink-2': '#44514a', '--muted': '#5d6962',
    '--primary': '#2f6b5a', '--primary-hover': '#265a4b', '--primary-ink': '#ffffff', '--primary-soft': '#e2efe8', '--primary-line': '#b9d6c8', '--primary-soft-hover': '#d3e6dc', '--good': '#2f6b5a',
  },
  dark: {
    '--bg': '#131815', '--bg-deep': '#0f1411', '--surface': '#1c231f', '--surface-2': '#202823', '--line': '#2d3731', '--line-strong': '#3f4c44', '--ink': '#e8eee9', '--ink-2': '#c3cec7', '--muted': '#9eada4',
    '--primary': '#7cc4aa', '--primary-hover': '#93d1ba', '--primary-ink': '#0f241c', '--primary-soft': '#1f3a30', '--primary-line': '#35574a', '--primary-soft-hover': '#2b4d40', '--good': '#7cc4aa',
  },
};

interface Hue { h: number; s: number; neutral: number }
const HUES: Record<Exclude<Palette, 'sage'>, Hue> = {
  ocean: { h: 205, s: 62, neutral: 30 },
  dusk: { h: 262, s: 42, neutral: 18 },
  sunrise: { h: 18, s: 70, neutral: 34 },
  graphite: { h: 215, s: 16, neutral: 8 },
};

const derive = ({ h, s, neutral }: Hue, mode: Mode): Tokens => {
  if (mode === 'light') {
    return {
      '--bg': hsl(h, neutral, 95), '--bg-deep': hsl(h, neutral, 91.5), '--surface': '#ffffff', '--surface-2': hsl(h, neutral, 98), '--line': hsl(h, neutral * 0.7, 87), '--line-strong': hsl(h, neutral * 0.6, 76),
      '--ink': hsl(h, 22, 12), '--ink-2': hsl(h, 14, 27), '--muted': hsl(h, 9, 35),
      '--primary': hsl(h, s, 29), '--primary-hover': hsl(h, s, 24), '--primary-ink': '#ffffff', '--primary-soft': hsl(h, s * 0.55, 91), '--primary-line': hsl(h, s * 0.45, 77), '--primary-soft-hover': hsl(h, s * 0.55, 86), '--good': hsl(h, s, 29),
    };
  }
  return {
    '--bg': hsl(h, neutral * 0.5, 8.5), '--bg-deep': hsl(h, neutral * 0.5, 6.5), '--surface': hsl(h, neutral * 0.5, 11.5), '--surface-2': hsl(h, neutral * 0.5, 13.5), '--line': hsl(h, neutral * 0.45, 19), '--line-strong': hsl(h, neutral * 0.4, 27),
    '--ink': hsl(h, 14, 92), '--ink-2': hsl(h, 10, 79), '--muted': hsl(h, 9, 66),
    '--primary': hsl(h, Math.min(60, s * 0.8), 68), '--primary-hover': hsl(h, Math.min(60, s * 0.8), 75), '--primary-ink': hsl(h, 40, 9), '--primary-soft': hsl(h, s * 0.4, 17), '--primary-line': hsl(h, s * 0.35, 29), '--primary-soft-hover': hsl(h, s * 0.4, 21), '--good': hsl(h, Math.min(60, s * 0.8), 68),
  };
};

export const paletteTokens = (p: Palette, mode: Mode): Tokens => (p === 'sage' ? SAGE[mode] : derive(HUES[p], mode));

/** The pairs that must stay readable, with the lowest contrast ratio each may have. */
export const READABLE_PAIRS: { fg: keyof Tokens; bg: keyof Tokens; min: number; what: string }[] = [
  { fg: '--ink', bg: '--bg', min: 7, what: 'body text on the page' },
  { fg: '--ink', bg: '--surface', min: 7, what: 'body text on a card' },
  { fg: '--ink-2', bg: '--surface', min: 4.5, what: 'secondary text on a card' },
  { fg: '--muted', bg: '--bg', min: 4.5, what: 'quiet text on the page' },
  { fg: '--muted', bg: '--surface', min: 4.5, what: 'quiet text on a card' },
  { fg: '--primary', bg: '--bg', min: 4.5, what: 'links and primary text on the page' },
  { fg: '--primary', bg: '--surface', min: 4.5, what: 'links and primary text on a card' },
  { fg: '--primary-ink', bg: '--primary', min: 4.5, what: 'text on a primary button' },
  { fg: '--primary', bg: '--primary-soft', min: 4.5, what: 'text on a soft primary background' },
  { fg: '--primary', bg: '--primary-soft-hover', min: 4.5, what: 'text on a hovered soft background' },
  { fg: '--ink', bg: '--primary-soft', min: 7, what: 'body text on a soft primary background' },
];

/** The focus outline is the primary colour, so it has to stand out from the page by at least 3:1 (non-text contrast). */
export const FOCUS_MIN = 3;

/**
 * A person's own accent colour, made readable. The hue and saturation are theirs; the lightness is moved only as far as needed for the
 * pairs above to pass against this palette. `adjusted` says so, so the settings screen can tell them.
 */
export const accentTokens = (hex: string, palette: Palette, mode: Mode): { tokens: Tokens; adjusted: boolean } | null => {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const base = paletteTokens(palette, mode);
  const { h, s, l } = rgbToHsl(rgb);
  const sat = Math.max(0, Math.min(mode === 'light' ? 85 : 65, s));
  const soft = () => (mode === 'light' ? hsl(h, sat * 0.5, 91) : hsl(h, sat * 0.4, 17));
  const softHover = () => (mode === 'light' ? hsl(h, sat * 0.5, 86) : hsl(h, sat * 0.4, 23));
  const inkFor = (p: string) => (contrast('#ffffff', p) >= contrast('#0b0f0d', p) ? '#ffffff' : '#0b0f0d');
  const readable = (primary: string) =>
    contrast(primary, base['--bg']) >= 4.5 && contrast(primary, base['--surface']) >= 4.5 && contrast(inkFor(primary), primary) >= 4.5
    && contrast(primary, soft()) >= 4.5 && contrast(primary, softHover()) >= 4.5 && contrast(base['--ink'], soft()) >= 7;
  // Move the lightness (darker in light mode, lighter in dark) only as far as it takes for everything to be readable.
  const dir = mode === 'light' ? -1 : 1;
  let L = l, primary = hsl(h, sat, L);
  for (let i = 0; i < 100 && !readable(primary); i++) { L = Math.max(3, Math.min(97, L + dir)); primary = hsl(h, sat, L); }
  const adjusted = Math.abs(L - l) > 0.5 || sat !== s;
  const tokens: Tokens = {
    ...base, '--primary': primary, '--primary-hover': hsl(h, sat, mode === 'light' ? Math.max(3, L - 5) : Math.min(97, L + 6)), '--primary-ink': inkFor(primary), '--good': primary,
    '--primary-soft': soft(), '--primary-line': mode === 'light' ? hsl(h, sat * 0.4, 77) : hsl(h, sat * 0.35, 29), '--primary-soft-hover': softHover(),
  };
  return { tokens, adjusted };
};
