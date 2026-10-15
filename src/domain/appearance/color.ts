/** Small colour helpers, used to build palettes and to keep every pair of colours readable. WCAG 2.x contrast. */
export interface RGB { r: number; g: number; b: number }
export interface HSL { h: number; s: number; l: number }

export const hexToRgb = (hex: string): RGB | null => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
};
export const rgbToHex = ({ r, g, b }: RGB): string => `#${[r, g, b].map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('')}`;

export const rgbToHsl = ({ r, g, b }: RGB): HSL => {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B), d = max - min;
  const l = (max + min) / 2;
  if (d === 0) return { h: 0, s: 0, l: l * 100 };
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return { h: (h * 60 + 360) % 360, s: s * 100, l: l * 100 };
};

export const hslToRgb = ({ h, s, l }: HSL): RGB => {
  const S = Math.max(0, Math.min(100, s)) / 100, L = Math.max(0, Math.min(100, l)) / 100;
  const c = (1 - Math.abs(2 * L - 1)) * S;
  const x = c * (1 - Math.abs(((h % 360) / 60) % 2 - 1));
  const m = L - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
};

export const hsl = (h: number, s: number, l: number): string => rgbToHex(hslToRgb({ h, s, l }));

const lin = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
export const luminance = ({ r, g, b }: RGB): number => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);

/** WCAG contrast ratio, 1 to 21. */
export const contrast = (a: string, b: string): number => {
  const A = hexToRgb(a), B = hexToRgb(b);
  if (!A || !B) return 1;
  const la = luminance(A), lb = luminance(B);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};
