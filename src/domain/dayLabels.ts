import { formatLong, formatMinutes } from './dates';
import type { DayPlan } from './view';

/**
 * How the schedule words a day. A day that has not happened yet is described by what is planned for it ("Free" and "Rest day" are
 * statements about a plan that exists). A day that has already happened has no plan to describe: the planner only plans forward and never
 * rebuilds a past day from today's settings. What is said instead is what was saved: the plan the app recorded on that day, if the day was
 * opened, and otherwise plainly "No saved plan". What was logged as done is shown separately and is always real.
 */
export const dayHeadline = (day: DayPlan, restDay: boolean): string => {
  if (day.past) {
    const r = day.recorded;
    if (!r) return 'No saved plan';
    if (r.planned > 0) return `${r.planned} planned then · ${formatMinutes(r.minutes)}${r.budget ? ` of ${r.budget} min` : ''}`;
    return r.activeDay ? 'Nothing was planned' : 'A rest day then';
  }
  if (day.tasks.length) return `${day.tasks.length} · ${formatMinutes(day.minutes)}${day.budget ? ` of ${day.budget} min` : ''}`;
  return restDay ? 'Rest day' : 'Free';
};

/** The sentence under a day with nothing listed. */
export const dayEmptyNote = (day: DayPlan, restDay: boolean): string => {
  if (day.past) return day.recorded ? 'This is what the planner chose on that day, as it was saved then.' : 'No plan was saved for this day. The app saves a day’s plan when that day is opened in it.';
  return restDay ? 'A rest day, with nothing planned.' : 'Nothing planned.';
};

/** The label a screen reader gets for a day in the month grid. */
export const dayAriaLabel = (day: DayPlan): string => {
  if (day.past) return `${formatLong(day.date)}: ${day.recorded ? `${day.recorded.planned} planned then, ${day.recorded.minutes} minutes` : 'no saved plan'}${day.done.length ? `, ${day.done.length} done` : ''}`;
  return `${formatLong(day.date)}: ${day.tasks.length} tasks, ${day.minutes} minutes`;
};

/** How full the day’s bar is, 0 to 1, or null when there is nothing true to show (a past day with no saved plan). */
export const dayFill = (day: DayPlan): number | null => {
  if (day.past) return day.recorded && day.recorded.budget > 0 ? Math.min(1, day.recorded.minutes / day.recorded.budget) : null;
  return Math.min(1, day.minutes / Math.max(1, day.budget));
};
