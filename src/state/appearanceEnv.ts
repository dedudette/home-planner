import { useEffect } from 'react';
import { applyAppearance, type Env, type Target } from '../domain/appearance/apply';
import type { Appearance } from '../domain/appearance/types';

/** Device-side copy of the appearance, read by a tiny script in index.html so the first paint already matches (no flash). */
export const MIRROR_KEY = 'cleanflow:appearance';
export const LEGACY_THEME_KEY = 'cleanflow:theme';

export const readEnv = (): Env => {
  try {
    return { prefersDark: window.matchMedia('(prefers-color-scheme: dark)').matches, prefersReduced: window.matchMedia('(prefers-reduced-motion: reduce)').matches };
  } catch { return { prefersDark: false, prefersReduced: false }; }
};

type Vars = Record<string, string>;
/** The properties `applyAppearance` would set on the page for each mode, so the first-paint script can set them without running this code. */
export const mirrorVars = (a: Appearance): { light: Vars; dark: Vars } => {
  const one = (prefersDark: boolean): Vars => {
    const set: Vars = {};
    const t: Target = { setAttribute: () => undefined, removeAttribute: () => undefined, style: { setProperty: (k, v) => { set[k] = v; }, removeProperty: (k) => { delete set[k]; } } };
    applyAppearance(a, t, { prefersDark, prefersReduced: false });
    return set;
  };
  return { light: one(false), dark: one(true) };
};

const THEME_COLOR_ID = 'theme-color';

/**
 * Applies the person's appearance to the page, follows the system's light/dark and reduced-motion settings while they are set to
 * "system", keeps the first-paint mirror up to date, and moves the browser's toolbar colour with the theme.
 */
export const useAppearanceEffect = (a: Appearance, ready: boolean): void => {
  useEffect(() => {
    if (!ready) return;
    const root = document.documentElement;
    const apply = () => {
      const { mode } = applyAppearance(a, root, readEnv());
      const bg = getComputedStyle(root).getPropertyValue('--bg').trim();
      const meta = document.getElementById(THEME_COLOR_ID);
      if (meta && bg) meta.setAttribute('content', bg);
      void mode;
    };
    apply();
    try { window.localStorage.setItem(MIRROR_KEY, JSON.stringify({ a, vars: mirrorVars(a) })); } catch { /* the mirror is a convenience only */ }
    const mqs = ['(prefers-color-scheme: dark)', '(prefers-reduced-motion: reduce)'].map((q) => { try { return window.matchMedia(q); } catch { return null; } });
    mqs.forEach((m) => m?.addEventListener?.('change', apply));
    return () => mqs.forEach((m) => m?.removeEventListener?.('change', apply));
  }, [a, ready]);
};

/** An older version kept just the theme on this device. Carry a light/dark choice over once, then let go of the old key. */
export const takeLegacyTheme = (): 'light' | 'dark' | null => {
  try {
    const v = window.localStorage.getItem(LEGACY_THEME_KEY);
    if (v === null) return null;
    window.localStorage.removeItem(LEGACY_THEME_KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch { return null; }
};
