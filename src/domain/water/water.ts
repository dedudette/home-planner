import { addDays, daysInRange } from '../dates';
import type { ISODate } from '../types';
import type { WaterEntry, WaterUnit } from './types';

export const ML_PER: Record<WaterUnit, number> = { ml: 1, floz: 29.5735, cup: 240 };
export const UNIT_LABEL: Record<WaterUnit, string> = { ml: 'ml', floz: 'fl oz', cup: 'cups' };

/** One drink's most plausible upper bound. Above it the app asks the person to check the number; it never refuses a real one. */
export const CHECK_ENTRY_ML = 1500;
export const MAX_ENTRY_ML = 3000;
export const GOAL_MIN_ML = 500;
export const GOAL_MAX_ML = 6000;
/** A day's total above this is flagged for a second look, not celebrated. */
export const CHECK_DAY_ML = 6000;

export const fromMl = (ml: number, unit: WaterUnit): number => ml / ML_PER[unit];
export const toMl = (amount: number, unit: WaterUnit): number => Math.round(amount * ML_PER[unit]);

const nice = (n: number, unit: WaterUnit): string => (unit === 'ml' ? String(Math.round(n)) : n >= 10 ? String(Math.round(n)) : String(Math.round(n * 10) / 10));
export const formatVolume = (ml: number, unit: WaterUnit): string => `${nice(fromMl(ml, unit), unit)} ${UNIT_LABEL[unit]}`;

/** Quick-add amounts, stored in ml and shown in the person's unit. */
export const QUICK_ML = [150, 250, 330, 500] as const;

export const totalOn = (entries: WaterEntry[], date: ISODate): number => entries.filter((e) => e.date === date).reduce((n, e) => n + e.ml, 0);

/** `null` means nothing was logged that day: unknown, not zero. */
export const dayTotal = (entries: WaterEntry[], date: ISODate): number | null => {
  const here = entries.filter((e) => e.date === date);
  return here.length ? here.reduce((n, e) => n + e.ml, 0) : null;
};

export interface WaterHistory {
  days: { date: ISODate; ml: number | null; entries: number }[];
  loggedDays: number;
  /** The average over the days that have entries. Null when no day does. Days with nothing logged are left out, not counted as zero. */
  averageOnLoggedDays: number | null;
}

export const waterHistory = (entries: WaterEntry[], today: ISODate, days: number): WaterHistory => {
  const list = daysInRange(addDays(today, -(days - 1)), today).map((date) => ({ date, ml: dayTotal(entries, date), entries: entries.filter((e) => e.date === date).length }));
  const logged = list.filter((d) => d.ml !== null);
  return { days: list, loggedDays: logged.length, averageOnLoggedDays: logged.length ? Math.round(logged.reduce((n, d) => n + (d.ml as number), 0) / logged.length) : null };
};

export type AmountCheck = { ok: true; ml: number } | { ok: false; why: string } | { ok: true; ml: number; confirm: string };

/** Checks a typed amount. A big but possible number is allowed after a confirmation; an impossible one is refused. */
export const checkAmount = (amount: number, unit: WaterUnit): AmountCheck => {
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, why: 'Enter an amount above zero.' };
  const ml = toMl(amount, unit);
  if (ml < 5) return { ok: false, why: 'That is smaller than a sip. Check the number and unit.' };
  if (ml > MAX_ENTRY_ML) return { ok: false, why: `That is more than ${formatVolume(MAX_ENTRY_ML, unit)} in one go. Check the number and unit.` };
  if (ml > CHECK_ENTRY_ML) return { ok: true, ml, confirm: `${formatVolume(ml, unit)} is a lot for one drink. Is that right?` };
  return { ok: true, ml };
};
