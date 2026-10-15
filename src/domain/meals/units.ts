import type { Unit } from './types';

/**
 * Adding up quantities honestly.
 *
 * Mass (g, kg) and volume (ml, l, tsp, tbsp, cup) convert inside their own family using fixed, standard cooking definitions
 * (1 kg = 1000 g, 1 l = 1000 ml, 1 tsp = 5 ml, 1 tbsp = 15 ml, 1 cup = 240 ml). Nothing converts ACROSS families, because that needs the
 * density of the specific food (200 g of flour is not "a cup"), and the app does not guess: those amounts stay as separate lines.
 * Counted units (piece, clove, can, bunch, pack, slice, pinch) only ever add to the same unit.
 */

const MASS: Partial<Record<Unit, number>> = { g: 1, kg: 1000 };
const VOLUME: Partial<Record<Unit, number>> = { ml: 1, l: 1000, tsp: 5, tbsp: 15, cup: 240 };

export type Family = 'mass' | 'volume' | 'none' | `unit:${Unit}`;

export const familyOf = (u: Unit | null): Family => (u === null ? 'none' : u in MASS ? 'mass' : u in VOLUME ? 'volume' : `unit:${u}`);

const factor = (u: Unit): number => MASS[u] ?? VOLUME[u] ?? 1;

export interface Amount { qty: number | null; unit: Unit | null }

/**
 * Add amounts that are all in the same family. A null quantity ("salt, to taste") contributes nothing to the number; if every amount
 * is null the result stays null (still needed, no amount known). Throws nothing: amounts of another family are the caller's mistake and
 * are ignored here (the caller groups by family first).
 */
export const sumAmounts = (parts: Amount[]): Amount => {
  const known = parts.filter((p) => p.qty !== null && p.unit !== null || p.qty !== null && p.unit === null);
  if (!known.length) return { qty: null, unit: parts.find((p) => p.unit)?.unit ?? null };
  const fam = familyOf(known[0].unit);
  const same = known.filter((p) => familyOf(p.unit) === fam);
  if (fam === 'mass' || fam === 'volume') {
    const base = same.reduce((n, p) => n + (p.qty as number) * factor(p.unit as Unit), 0);
    const units = new Set(same.map((p) => p.unit));
    // Everything was a spoon or cup measure of one kind: keep saying it that way.
    if (fam === 'volume' && units.size === 1) {
      const u = [...units][0] as Unit;
      if (u === 'tsp' || u === 'tbsp' || u === 'cup') return { qty: round(base / factor(u)), unit: u };
    }
    if (fam === 'mass') return base >= 1000 ? { qty: round(base / 1000), unit: 'kg' } : { qty: round(base), unit: 'g' };
    return base >= 1000 ? { qty: round(base / 1000), unit: 'l' } : { qty: round(base), unit: 'ml' };
  }
  return { qty: round(same.reduce((n, p) => n + (p.qty as number), 0)), unit: same[0].unit };
};

export const round = (n: number, places = 2): number => { const f = 10 ** places; return Math.round((n + Number.EPSILON) * f) / f; };

/** Scale an amount for a different number of servings. */
export const scaleAmount = (a: Amount, by: number): Amount => (a.qty === null ? a : { qty: round(a.qty * by, 3), unit: a.unit });

const LABEL: Record<Unit, [string, string]> = {
  g: ['g', 'g'], kg: ['kg', 'kg'], ml: ['ml', 'ml'], l: ['l', 'l'], tsp: ['tsp', 'tsp'], tbsp: ['tbsp', 'tbsp'], cup: ['cup', 'cups'],
  piece: ['', ''], clove: ['clove', 'cloves'], can: ['can', 'cans'], bunch: ['bunch', 'bunches'], pack: ['pack', 'packs'], slice: ['slice', 'slices'], pinch: ['pinch', 'pinches'],
};

export const unitLabel = (u: Unit | null, qty: number | null): string => (u === null ? '' : LABEL[u][qty !== null && qty > 1 ? 1 : 0]);

/** "250 g", "1.5 kg", "3 cloves", "2" (pieces), or "" when there is no amount. */
export const formatAmount = (qty: number | null, unit: Unit | null): string => {
  if (qty === null) return '';
  const shown = unit === 'g' || unit === 'ml' ? (qty >= 10 ? Math.round(qty) : round(qty, 1)) : round(qty, 2);
  const label = unitLabel(unit, qty);
  return label ? `${shown} ${label}` : `${shown}`;
};
