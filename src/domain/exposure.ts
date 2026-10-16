import type { ExposureItem, ExposureRecord, ISODate, LeftOutItem, PlannerExclusion, Task } from './types';
import { planVersionOf } from './planVersion';
import { todayPlan, type DeferReason, type DueItem, type PlanView } from './view';

/** The most left-out entries kept for one day. Real days have a handful; this only stops a runaway. */
export const MAX_LEFT_PER_DAY = 60;

/** The planner's own vocabulary for why it left something out. Deliberately different from anything a person's action says. */
export const EXCLUSION: Record<DeferReason, PlannerExclusion> = {
  time: 'not-enough-time',
  energy: 'low-energy-day',
  'rest-day': 'not-a-cleaning-day',
  // Left out to stay within the minutes the person allowed for that category: the same fact as "not enough time", for the same reason.
  category: 'not-enough-time',
};

const traits = (t: Task) => {
  const e: { level?: Task['level']; intensity?: Task['intensity']; timeOfDay?: Task['timeOfDay']; goals?: Task['matches'] } = {};
  if (t.level) e.level = t.level;
  if (t.intensity) e.intensity = t.intensity;
  if (t.timeOfDay) e.timeOfDay = t.timeOfDay;
  if (t.matches?.length) e.goals = t.matches;
  return e;
};

const selected = (i: DueItem, kind: ExposureItem['kind'], at: string, energy: ExposureItem['energy']): ExposureItem => {
  const t = i.task;
  return { taskId: t.id, templateId: t.templateId, domain: t.domain ?? 'home', minutes: t.minutes, difficulty: t.difficulty, kind, selectedAt: at, energy, ...traits(t) };
};

const leftOut = (i: DueItem, reason: DeferReason, at: string, energy: LeftOutItem['energy'], budget: number): LeftOutItem => {
  const t = i.task;
  return { taskId: t.id, templateId: t.templateId, domain: t.domain ?? 'home', minutes: t.minutes, difficulty: t.difficulty, reason: EXCLUSION[reason], at, energy, budget, ...traits(t) };
};

/**
 * What the planner decided for `view.today`, taken from the very computation that decided it (`todayPlan`), at this moment, with
 * this moment's energy and budget. Nothing here is worked out later from the person's current settings.
 *
 * `items` are the tasks SELECTED for the day; `left` are the due tasks that were considered and left out, with the reason. Neither
 * says anything about whether the person saw them: that is `seenAt`, set by the Today screen (see RECORD_SEEN).
 */
export const buildExposure = (v: PlanView, at: string, tzOffsetMin: number): ExposureRecord => {
  const t = todayPlan(v);
  const items: ExposureItem[] = [
    ...t.focus.map((i) => selected(i, 'focus', at, t.energy)),
    ...t.life.map((i) => selected(i, 'life', at, t.energy)),
    ...t.catchUp.map((i) => selected(i, 'catchUp', at, t.energy)),
  ];
  const left = t.deferred.slice(0, MAX_LEFT_PER_DAY).map((d) => leftOut(d.item, d.reason, at, t.energy, t.totalBudget));
  return { date: v.today as ISODate, contract: 2, recordedAt: at, planVersion: planVersionOf(v.data), activeDay: t.isActiveDay, energy: t.energy, tzOffsetMin, budgetMinutes: t.totalBudget ?? t.budget, items, left };
};

/** The task/reason pairs already on a day's record. A change of reason (time → energy) is a new decision, so it is a new entry. */
export const leftKey = (x: { taskId: string; reason: PlannerExclusion }) => `${x.taskId}|${x.reason}`;

/**
 * True when recording would add something new: no record for the day yet, a newly selected task, or a task newly left out for a
 * reason it was not already left out for (an energy change, a new plan). Re-rendering, StrictMode, a reload or a second tab all
 * return false.
 */
export const hasNewExposure = (v: PlanView, rec: ExposureRecord): boolean => {
  const cur = v.data.exposures.find((e) => e.date === rec.date);
  if (!cur) return true;
  // A record for today written before contract 2 stays as it is: mixing contract 2 facts into it would make "not seen" look known.
  if (cur.contract !== 2) return false;
  const known = new Set(cur.items.map((i) => i.taskId));
  const knownLeft = new Set((cur.left ?? []).map(leftKey));
  return rec.items.some((i) => !known.has(i.taskId)) || (rec.left ?? []).some((x) => !knownLeft.has(leftKey(x)) && (cur.left ?? []).length < MAX_LEFT_PER_DAY);
};
