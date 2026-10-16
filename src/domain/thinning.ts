import { addDays } from './dates';
import type { AppData, ISODate } from './types';

/**
 * Letting go of old detail, in the gentlest order, when the app has to make room (see retention.ts). Only history is ever touched:
 * a person's own writing and settings never are. The journal, dishes, workouts, interests, books, links, recipes they wrote, and every
 * setting stay exactly as they are.
 *
 *   1. thin     keep the totals, drop the detail: old water becomes one total per day (the day's amount is unchanged), old workout
 *               records lose their exercise-by-exercise list (the workout, its date, its minutes and how it felt stay).
 *   2. trim     only if that is not enough: remove the oldest days of history, everywhere at once, so every record in the data starts
 *               on the same date and no screen mixes a complete past with a partial one.
 */
export const WATER_THIN_AFTER_DAYS = 30;
export const EXERCISE_THIN_AFTER_DAYS = 60;

export interface Thinned { data: AppData; waterDays: number; exerciseDetails: number }
export interface OtherRemoved { meals: number; workouts: number; water: number; hobbySessions: number; checkins: number; shoppingLists: number }

export const emptyRemoved = (): OtherRemoved => ({ meals: 0, workouts: 0, water: 0, hobbySessions: 0, checkins: 0, shoppingLists: 0 });
export const totalRemoved = (r: OtherRemoved): number => r.meals + r.workouts + r.water + r.hobbySessions + r.checkins + r.shoppingLists;

export const thinHistory = (d: AppData, today: ISODate): Thinned => {
  const waterBefore = addDays(today, -WATER_THIN_AFTER_DAYS);
  const exerciseBefore = addDays(today, -EXERCISE_THIN_AFTER_DAYS);

  // water: one total per old day (a day with a single entry is already as small as it gets)
  const byDay = new Map<ISODate, typeof d.water.entries>();
  for (const e of d.water.entries) if (e.date < waterBefore) { const xs = byDay.get(e.date) ?? []; xs.push(e); byDay.set(e.date, xs); }
  let waterDays = 0;
  const old: typeof d.water.entries = [];
  for (const [date, xs] of byDay) {
    if (xs.length === 1) { old.push(xs[0]); continue; }
    waterDays++;
    const last = xs.reduce((m, e) => (e.at > m ? e.at : m), xs[0].at);
    old.push({ id: `day:${date}`, date, at: last, ml: xs.reduce((n, e) => n + e.ml, 0) });
  }
  const water = waterDays === 0 ? d.water : { ...d.water, entries: [...old, ...d.water.entries.filter((e) => !(e.date < waterBefore))].sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : 0)) };

  // workout records: drop the exercise list of old ones
  let exerciseDetails = 0;
  const log = d.movement.log.map((l) => { if (l.date < exerciseBefore && l.exercises.length > 0) { exerciseDetails++; return { ...l, exercises: [] }; } return l; });
  const movement = exerciseDetails === 0 ? d.movement : { ...d.movement, log };

  if (waterDays === 0 && exerciseDetails === 0) return { data: d, waterDays: 0, exerciseDetails: 0 };
  return { data: { ...d, water, movement }, waterDays, exerciseDetails };
};

const keep = <T>(xs: T[], pred: (x: T) => boolean): { out: T[]; removed: number } => { const out = xs.filter(pred); return out.length === xs.length ? { out: xs, removed: 0 } : { out, removed: xs.length - out.length }; };

/**
 * Everything dated before `horizon` goes, except what the person wrote. Returns the same arrays (not copies) where nothing was removed,
 * so unchanged parts keep their identity.
 */
export const trimOtherBefore = (d: AppData, horizon: ISODate): { data: AppData; removed: OtherRemoved } => {
  const meals = keep(d.meals.plan, (m) => m.date >= horizon);
  const workouts = keep(d.movement.log, (l) => l.date >= horizon);
  const water = keep(d.water.entries, (e) => e.date >= horizon);
  const hobby = keep(d.interests.sessions, (s) => s.date >= horizon);
  const checkins = keep(d.wellbeing.checkins, (c) => c.date >= horizon);
  const lists = keep(d.shopping.lists, (l) => l.createdAt.slice(0, 10) >= horizon);
  const removed: OtherRemoved = { meals: meals.removed, workouts: workouts.removed, water: water.removed, hobbySessions: hobby.removed, checkins: checkins.removed, shoppingLists: lists.removed };
  if (totalRemoved(removed) === 0) return { data: d, removed };
  return {
    removed,
    data: {
      ...d,
      meals: meals.removed ? { ...d.meals, plan: meals.out } : d.meals,
      movement: workouts.removed ? { ...d.movement, log: workouts.out } : d.movement,
      water: water.removed ? { ...d.water, entries: water.out } : d.water,
      interests: hobby.removed ? { ...d.interests, sessions: hobby.out } : d.interests,
      wellbeing: checkins.removed ? { ...d.wellbeing, checkins: checkins.out } : d.wellbeing,
      shopping: lists.removed ? { ...d.shopping, lists: lists.out } : d.shopping,
    },
  };
};

/** Every date a trim could start from, oldest first. */
export const trimDates = (d: AppData): ISODate[] => {
  const s = new Set<ISODate>();
  for (const x of d.sessions) s.add(x.date);
  for (const x of d.meals.plan) s.add(x.date);
  for (const x of d.movement.log) s.add(x.date);
  for (const x of d.water.entries) s.add(x.date);
  for (const x of d.interests.sessions) s.add(x.date);
  for (const x of d.wellbeing.checkins) s.add(x.date);
  for (const x of d.shopping.lists) s.add(x.createdAt.slice(0, 10));
  return [...s].sort();
};
