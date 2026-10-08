import type { Plan } from './engine';
import type { EnergyLevel } from './types';

/**
 * The daily time budget: ONE number the user chose (sessionMinutes), shared by everything that can appear in a day.
 *
 *   home + life : cleaning gets `homeShare` (60%), habits and life tasks get the rest (40%)
 *   home only   : all of it is cleaning
 *   life only   : all of it is habits and life tasks
 *
 * `fitDay` is the single place that decides what is planned and what is deferred, for Today, Tomorrow and the Schedule alike.
 * Whatever it plans never adds up to more than the day's total, except for the fixed essentials the user added themselves, and
 * then the overage is reported as a number rather than hidden.
 */

export const energyFactor = (e: EnergyLevel): number => (e === 'low' ? 0.6 : e === 'high' ? 1.3 : 1);

export interface Split { home: number; life: number }

/** The user's minutes divided between cleaning and life tasks on a normal day. Always adds up to exactly `sessionMinutes`. */
export const nominalSplit = (sessionMinutes: number, homeOn: boolean, lifeActive: boolean, homeShare: number): Split => {
  if (!lifeActive) return { home: homeOn ? sessionMinutes : 0, life: 0 };
  if (!homeOn) return { home: 0, life: sessionMinutes };
  const home = Math.round(sessionMinutes * homeShare);
  return { home, life: sessionMinutes - home };
};

export interface DayBudget {
  /** A day the user chose for cleaning. On other days only the tiny daily basics (and life tasks) remain. */
  active: boolean;
  home: number;
  life: number;
  /** The promise for the day: home + life. */
  total: number;
}

type BudgetPlan = Pick<Plan, 'sessionMinutes' | 'homeOn' | 'lifeActive' | 'homeShare' | 'habitBudget' | 'activeDays'>;

export const dayBudget = (plan: BudgetPlan, weekdayNum: number, energy: EnergyLevel = 'ok'): DayBudget => {
  const active = plan.activeDays.includes(weekdayNum);
  const f = energyFactor(energy);
  const nom = nominalSplit(plan.sessionMinutes, plan.homeOn, plan.lifeActive, plan.homeShare);
  // On a rest day cleaning shrinks to the daily basics, which have their own small allowance.
  const homeNominal = active ? nom.home : Math.min(nom.home, plan.habitBudget);
  const home = plan.homeOn ? Math.round(homeNominal * f) : 0;
  const life = plan.lifeActive ? Math.round(nom.life * f) : 0;
  return { active, home, life, total: home + life };
};

export type DeferReason =
  /** It does not fit in what is left of the day's minutes. */
  | 'time'
  /** Too demanding for a low-energy day. */
  | 'energy'
  /** Not a cleaning day, and this is not one of the daily basics. */
  | 'rest-day';

export interface FitItem {
  minutes: number;
  domain: 'home' | 'life';
  /** Position within its own domain's priority order (0 = first). Decides who gets the domain's own share. */
  order: number;
  /** Cross-domain priority, used only to share out whatever one domain left unused. Higher first. */
  weight: number;
  /** A task the user marked urgent themselves: it is never dropped, even when it overshoots. */
  essential?: boolean;
  /** Set by the caller when the task must not be planned today for a reason other than time. */
  blocked?: Exclude<DeferReason, 'time'>;
}

export interface Fit<T extends FitItem> {
  planned: T[];
  deferred: { item: T; reason: DeferReason }[];
  home: number;
  life: number;
  total: number;
  /** Minutes by which the fixed essentials alone exceed the day's promise. 0 whenever the day fits. */
  overBy: number;
  /** The essentials that cause an overage (empty when `overBy` is 0). */
  essentials: T[];
}

/**
 * Decide the day. Three steps, each of which can only add minutes that are still free:
 *  1. fixed essentials go in first, whatever they cost;
 *  2. each domain fills its own share in its own priority order;
 *  3. any minutes one domain left unused go to the highest-weight leftovers of either.
 * Nothing but step 1 can push the day past its total, so `overBy > 0` always means "your own urgent tasks alone are longer than
 * the time you set", and the caller says so.
 */
export const fitDay = <T extends FitItem>(items: T[], b: DayBudget): Fit<T> => {
  const taken = new Set<T>();
  const used = { home: 0, life: 0 };
  const take = (it: T) => { taken.add(it); used[it.domain] += it.minutes; };

  const essentials = items.filter((i) => i.essential);
  essentials.forEach(take);

  for (const domain of ['home', 'life'] as const) {
    const alloc = domain === 'home' ? b.home : b.life;
    for (const it of items.filter((i) => i.domain === domain).sort((a, c) => a.order - c.order)) {
      if (taken.has(it) || it.blocked) continue;
      if (used[domain] + it.minutes <= alloc && used.home + used.life + it.minutes <= b.total) take(it);
    }
  }
  for (const it of items.filter((i) => !taken.has(i) && !i.blocked).sort((a, c) => c.weight - a.weight || a.order - c.order)) {
    if (used.home + used.life + it.minutes <= b.total) take(it);
  }

  const planned = items.filter((i) => taken.has(i));
  const deferred = items.filter((i) => !taken.has(i)).map((item) => ({ item, reason: (item.blocked ?? 'time') as DeferReason }));
  const total = used.home + used.life;
  const essentialMinutes = essentials.reduce((s, e) => s + e.minutes, 0);
  return { planned, deferred, home: used.home, life: used.life, total, overBy: Math.max(0, total - b.total), essentials: essentialMinutes > b.total ? essentials : [] };
};
