import type { ExposureItem, ExposureRecord, ISODate } from './types';
import { planVersionOf } from './planVersion';
import { todayPlan, type DueItem, type PlanView } from './view';

const item = (i: DueItem, kind: ExposureItem['kind'], at: string, energy: ExposureItem['energy']): ExposureItem => {
  const t = i.task;
  const e: ExposureItem = { taskId: t.id, templateId: t.templateId, domain: t.domain ?? 'home', minutes: t.minutes, difficulty: t.difficulty, kind, shownAt: at, energy };
  if (t.level) e.level = t.level;
  if (t.intensity) e.intensity = t.intensity;
  if (t.timeOfDay) e.timeOfDay = t.timeOfDay;
  if (t.matches?.length) e.goals = t.matches;
  return e;
};

/**
 * What the user was shown for `view.today`: the denominator for every adherence statistic. Without it, a task that was scheduled
 * and quietly ignored leaves no trace at all, which would make "what do they tend to skip?" unanswerable.
 */
export const buildExposure = (v: PlanView, at: string, tzOffsetMin: number): ExposureRecord => {
  const t = todayPlan(v);
  const items: ExposureItem[] = [
    ...t.focus.map((i) => item(i, 'focus', at, t.energy)),
    ...t.life.map((i) => item(i, 'life', at, t.energy)),
    ...t.extra.map((i) => item(i, 'extra', at, t.energy)),
    ...t.catchUp.map((i) => item(i, 'catchUp', at, t.energy)),
  ];
  return { date: v.today as ISODate, recordedAt: at, planVersion: planVersionOf(v.data), activeDay: t.isActiveDay, energy: t.energy, tzOffsetMin, budgetMinutes: t.totalBudget ?? t.budget, items };
};

/** True when recording would add something new (so the store never dispatches a no-op). */
export const hasNewExposure = (v: PlanView, rec: ExposureRecord): boolean => {
  const cur = v.data.exposures.find((e) => e.date === rec.date);
  if (!cur) return true;
  const known = new Set(cur.items.map((i) => i.taskId));
  return rec.items.some((i) => !known.has(i.taskId));
};
