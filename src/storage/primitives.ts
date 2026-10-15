import type { ISODate } from '../domain/types';

/** Small, shared building blocks for validating saved data. Nothing here throws. */

export const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
export const values = <T extends string>(opts: readonly { value: T }[]): readonly T[] => opts.map((o) => o.value);


export class Ctx {
  repairs: string[] = [];
  dropped = 0;
  note(msg: string) { if (!this.repairs.includes(msg)) this.repairs.push(msg); }
}

/** The newest `max` of a chronological list, and a note saying how many older ones went. */
export const keepNewest = <T,>(arr: T[], max: number, c: Ctx, what: string): T[] => {
  if (arr.length <= max) return arr;
  const n = arr.length - max;
  c.dropped += n;
  c.note(`${n} older ${what} ${n === 1 ? 'was' : 'were'} left out because this version keeps at most ${max}. The newest were kept.`);
  return arr.slice(-max);
};
/** The first `max` of a list that has no time order (the person's own tasks, supplies), and a note about the rest. */
export const keepFirst = <T,>(arr: T[], max: number, c: Ctx, what: string): T[] => {
  if (arr.length <= max) return arr;
  const n = arr.length - max;
  c.dropped += n;
  c.note(`${n} ${what} ${n === 1 ? 'was' : 'were'} left out because this version keeps at most ${max}.`);
  return arr.slice(0, max);
};

export const str = (v: unknown, d = '', max = 500): string => (typeof v === 'string' ? v.slice(0, max) : d);
export const bool = (v: unknown, d = false): boolean => (typeof v === 'boolean' ? v : d);
export const num = (v: unknown, d: number, lo = -Infinity, hi = Infinity): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};
export const intn = (v: unknown, d: number, lo: number, hi: number) => Math.round(num(v, d, lo, hi));
export const oneOf = <T extends string>(v: unknown, allowed: readonly T[], d: T): T => (typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : d);
export const oneOfOrNull = <T extends string>(v: unknown, allowed: readonly T[]): T | null => (typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : null);
export const list = <T extends string>(v: unknown, allowed: readonly T[]): T[] =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is T => typeof x === 'string' && (allowed as readonly string[]).includes(x)))] : [];
export const strList = (v: unknown, max = 200): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, max) : []);

/** True for a real calendar date in YYYY-MM-DD form. */
export const isISODate = (v: unknown): v is ISODate => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number);
  const dt = new Date(y, m - 1, d, 12);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
};
export const date = (v: unknown): ISODate | null => (isISODate(v) ? v : null);
export const isoStamp = (v: unknown, fallback: string): string => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : fallback);

