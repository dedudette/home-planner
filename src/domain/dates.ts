import type { ISODate } from './types';

const pad = (n: number) => String(n).padStart(2, '0');

export const toISO = (d: Date): ISODate => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Parse as local noon so DST shifts can never move the calendar day. */
export const fromISO = (s: ISODate): Date => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 12, 0, 0, 0);
};

export const todayISO = (): ISODate => toISO(new Date());

export const addDays = (s: ISODate, n: number): ISODate => {
  const d = fromISO(s);
  d.setDate(d.getDate() + n);
  return toISO(d);
};

export const diffDays = (a: ISODate, b: ISODate): number =>
  Math.round((fromISO(a).getTime() - fromISO(b).getTime()) / 86400000);

/** 0 = Sunday … 6 = Saturday */
export const weekday = (s: ISODate): number => fromISO(s).getDay();

/** Monday-based start of week. */
export const startOfWeek = (s: ISODate): ISODate => {
  const wd = weekday(s);
  return addDays(s, -((wd + 6) % 7));
};

export const startOfMonth = (s: ISODate): ISODate => `${s.slice(0, 7)}-01`;

export const endOfMonth = (s: ISODate): ISODate => {
  const d = fromISO(s);
  return toISO(new Date(d.getFullYear(), d.getMonth() + 1, 0, 12));
};

export const daysInRange = (from: ISODate, to: ISODate): ISODate[] => {
  const out: ISODate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
};

export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const WEEKDAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const formatDay = (s: ISODate, today: ISODate): string => {
  const diff = diffDays(s, today);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return fromISO(s).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
};

export const formatLong = (s: ISODate): string =>
  fromISO(s).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

export const formatShort = (s: ISODate): string =>
  fromISO(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

export const formatMinutes = (m: number): string => {
  const r = Math.round(m);
  if (r < 60) return `${r} min`;
  const h = Math.floor(r / 60);
  const rest = r % 60;
  return rest ? `${h} h ${rest} min` : `${h} h`;
};
