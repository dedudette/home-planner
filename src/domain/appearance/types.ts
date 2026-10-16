export const THEMES = ['system', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];
export const PALETTES = ['sage', 'ocean', 'dusk', 'sunrise', 'graphite'] as const;
export type Palette = (typeof PALETTES)[number];
export const FONTS = ['standard', 'system', 'serif', 'clear'] as const;
export type FontChoice = (typeof FONTS)[number];
export const FONT_SIZES = ['small', 'medium', 'large', 'xlarge'] as const;
export type FontSize = (typeof FONT_SIZES)[number];
export const DENSITIES = ['comfortable', 'compact'] as const;
export type Density = (typeof DENSITIES)[number];
export const MOTIONS = ['system', 'reduced', 'full'] as const;
export type Motion = (typeof MOTIONS)[number];

export interface Appearance {
  theme: Theme;
  palette: Palette;
  /** The person's own accent colour as #rrggbb, or null. It is always adjusted until it is readable; the adjustment is shown. */
  accent: string | null;
  font: FontChoice;
  fontSize: FontSize;
  density: Density;
  motion: Motion;
  /** Show the owl helper. */
  owl: boolean;
}

export const DEFAULT_APPEARANCE: Appearance = { theme: 'system', palette: 'sage', accent: null, font: 'standard', fontSize: 'medium', density: 'comfortable', motion: 'system', owl: true };

export const PALETTE_LABEL: Record<Palette, string> = { sage: 'Sage', ocean: 'Ocean', dusk: 'Dusk', sunrise: 'Sunrise', graphite: 'Graphite' };
export const FONT_LABEL: Record<FontChoice, string> = { standard: 'Standard', system: 'Plain', serif: 'Serif', clear: 'Wide and clear' };
export const SIZE_LABEL: Record<FontSize, string> = { small: 'Small', medium: 'Medium', large: 'Large', xlarge: 'Extra large' };
