import { addDays, WEEKDAY_SHORT, weekday } from '../dates';
import { ACTIVITY_LABEL, clockLabel, clockMinutes, MODULES, moduleOfDomain, timeOfDayFor } from './registry';
import type { ActivityModule, PlannedActivity } from './types';
import type { AppData, Frequency, ISODate, Task } from '../types';

/**
 * Planned activities become ordinary tasks, so the planner, Today, the Schedule, the timer and the log treat them exactly like
 * everything else. The task id is derived from the activity id and nothing else, which is what gives an activity one identity
 * and one completion record no matter which section shows it.
 */

export const ACTIVITY_PREFIX = 'act:';
export const activityTaskId = (id: string): string => `${ACTIVITY_PREFIX}${id}`;
export const isActivityTaskId = (id: string): boolean => id.startsWith(ACTIVITY_PREFIX);
export const activityIdOf = (taskId: string): string | null => (isActivityTaskId(taskId) ? taskId.slice(ACTIVITY_PREFIX.length) : null);

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

export const weekdaysOf = (a: PlannedActivity): number[] => (a.schedule.kind === 'weekly' ? [...new Set(a.schedule.weekdays)].sort((x, y) => x - y) : []);

/** "Every day", "Mon, Wed, Fri" or "Tue, Oct 14". Used wherever the frequency label would otherwise be wrong ("Weekly" for three days). */
export const describeSchedule = (a: PlannedActivity): string => {
  if (a.schedule.kind === 'once') return new Date(`${a.schedule.date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const wds = weekdaysOf(a);
  if (wds.length === 7) return 'Every day';
  // Week order starts on Monday, as the rest of the app does.
  const order = [...wds].sort((x, y) => ((x + 6) % 7) - ((y + 6) % 7));
  return `Every ${order.map((d) => WEEKDAY_SHORT[d]).join(', ')}`;
};

const firstOnOrAfter = (from: ISODate, wds: number[]): ISODate => {
  if (!wds.length) return from;
  let d = from;
  for (let i = 0; i < 8; i++, d = addDays(d, 1)) if (wds.includes(weekday(d))) return d;
  return from;
};

const freqFor = (a: PlannedActivity): Frequency => {
  if (a.schedule.kind === 'once') return 'once';
  const n = weekdaysOf(a).length;
  return n === 7 ? 'daily' : n === 2 ? 'twice-weekly' : 'weekly';
};

/** Where an activity's own content (a workout's steps, a recipe's method…) is looked up. Sections register what they can show. */
export interface ActivityContent { description?: string; steps?: string[]; tags?: string[] }
export type ActivityContentResolver = (ref: NonNullable<PlannedActivity['ref']>) => ActivityContent | null;

export const activityToTask = (a: PlannedActivity, resolve?: ActivityContentResolver): Task => {
  const info = MODULES[a.module];
  const content = a.ref && resolve ? resolve(a.ref) : null;
  const once = a.schedule.kind === 'once';
  const wds = weekdaysOf(a);
  const start = once ? (a.schedule as { kind: 'once'; date: ISODate }).date : firstOnOrAfter(a.startDate, wds);
  const when = a.kind === 'fixed' && a.time ? `Scheduled for ${clockLabel(a.time)}.` : 'You planned this yourself.';
  const steps = content?.steps ?? [];
  const label = ACTIVITY_LABEL[a.module];
  return {
    id: activityTaskId(a.id),
    templateId: null,
    name: a.name,
    roomId: `life-${info.domain ?? 'mind'}`,
    roomKind: 'home',
    roomName: label,
    category: label,
    minutes: Math.max(1, a.minutes),
    difficulty: a.difficulty,
    frequency: freqFor(a),
    cadence: once ? { kind: 'once' } : { kind: 'days', days: wds.length ? wds : ALL_DAYS },
    priority: a.kind === 'fixed' ? 'HIGH' : 'MEDIUM',
    score: a.kind === 'fixed' ? 78 : 58,
    impact: 5,
    reason: `${when}${a.note ? ` ${a.note}` : ''}`,
    substeps: steps,
    tinySteps: steps.slice(0, 3),
    tier: 'maintenance',
    habit: false,
    quickWin: a.minutes <= 5,
    zone: label,
    floor: 0,
    startDate: start,
    needs: [],
    topics: [],
    domain: info.domain ?? 'mind',
    description: content?.description,
    tags: content?.tags,
    equipment: 'none',
    intensity: a.intensity,
    timeOfDay: timeOfDayFor(a.time),
    // Everything here is something the person put in their own plan.
    notes: a.note || undefined,
    activityId: a.id,
    module: a.module,
    kind: a.kind,
    userPlanned: a.kind !== 'optional',
    time: a.time,
    scheduleLabel: describeSchedule(a),
    expires: once ? (a.kind === 'fixed' ? start : undefined) : (a.endDate ?? undefined),
    ref: a.ref,
  };
};

/** The tasks for every activity that is still in the plan. Archived activities are history only. */
export const activityTasks = (data: AppData, resolve?: ActivityContentResolver): Task[] =>
  data.activities.filter((a) => !a.archived).map((a) => activityToTask(a, resolve));

// ───────────────────────── history: scheduled, completed, skipped, unrecorded ─────────────────────────

/**
 * What became of one scheduled day. Nothing logged is `unrecorded`: it is never read as skipped, failed or zero. A day only counts as
 * skipped when the person skipped it, and only counts as completed when they completed it.
 */
export type OccurrenceState = 'completed' | 'skipped' | 'moved' | 'scheduled' | 'unrecorded';
export interface Occurrence { date: ISODate; state: OccurrenceState; minutes: number }

export const scheduledDates = (a: PlannedActivity, from: ISODate, to: ISODate): ISODate[] => {
  const lo = from > a.startDate ? from : a.startDate;
  const hi = a.endDate && a.endDate < to ? a.endDate : to;
  if (a.schedule.kind === 'once') return a.schedule.date >= from && a.schedule.date <= to ? [a.schedule.date] : [];
  const wds = weekdaysOf(a);
  const out: ISODate[] = [];
  for (let d = lo, i = 0; d <= hi && i < 800; d = addDays(d, 1), i++) if (wds.includes(weekday(d))) out.push(d);
  return out;
};

export const activityHistory = (data: AppData, a: PlannedActivity, from: ISODate, to: ISODate, today: ISODate): Occurrence[] => {
  const id = activityTaskId(a.id);
  const entries = data.sessions.flatMap((s) => s.entries).filter((e) => e.taskId === id);
  return scheduledDates(a, from, to).map((date) => {
    const here = entries.filter((e) => e.date === date);
    const done = here.filter((e) => e.outcome === 'completed');
    if (done.length) return { date, state: 'completed', minutes: done.reduce((n, e) => n + e.actualMinutes, 0) };
    if (here.some((e) => e.outcome === 'skipped')) return { date, state: 'skipped', minutes: 0 };
    if (entries.some((e) => (e.outcome === 'moved' || e.outcome === 'snoozed') && e.fromDue === date)) return { date, state: 'moved', minutes: 0 };
    return { date, state: date >= today ? 'scheduled' : 'unrecorded', minutes: 0 };
  });
};

export interface HistorySummary { scheduled: number; completed: number; skipped: number; moved: number; unrecorded: number; minutes: number }
export const summarizeHistory = (occ: Occurrence[]): HistorySummary => ({
  scheduled: occ.filter((o) => o.state === 'scheduled').length,
  completed: occ.filter((o) => o.state === 'completed').length,
  skipped: occ.filter((o) => o.state === 'skipped').length,
  moved: occ.filter((o) => o.state === 'moved').length,
  unrecorded: occ.filter((o) => o.state === 'unrecorded').length,
  minutes: occ.reduce((n, o) => n + o.minutes, 0),
});

// ───────────────────────── conflicts ─────────────────────────

export type Conflict =
  | { kind: 'overlap'; a: Task; b: Task }
  | { kind: 'category'; module: ActivityModule; planned: number; cap: number };

/** Two fixed activities whose times overlap. The planner never moves either: it says so and the person decides. */
export const timeConflicts = (tasks: Task[]): Conflict[] => {
  const fixed = tasks.filter((t) => t.kind === 'fixed' && t.time).sort((x, y) => clockMinutes(x.time!) - clockMinutes(y.time!));
  const out: Conflict[] = [];
  for (let i = 0; i < fixed.length; i++) {
    for (let j = i + 1; j < fixed.length; j++) {
      const a = fixed[i], b = fixed[j];
      if (clockMinutes(b.time!) >= clockMinutes(a.time!) + a.minutes) break;
      out.push({ kind: 'overlap', a, b });
    }
  }
  return out;
};

/** Planned minutes in a category beyond the allowance the person set for it. Absent allowance, no conflict. */
export const categoryConflicts = (tasks: Task[], caps: Partial<Record<ActivityModule, number>>): Conflict[] => {
  const out: Conflict[] = [];
  for (const [module, cap] of Object.entries(caps) as [ActivityModule, number][]) {
    if (!(cap > 0)) continue;
    const planned = tasks.filter((t) => (t.module ?? moduleOfDomain(t.domain)) === module).reduce((n, t) => n + t.minutes, 0);
    if (planned > cap) out.push({ kind: 'category', module, planned, cap });
  }
  return out;
};

export const describeConflict = (c: Conflict): string =>
  c.kind === 'overlap'
    ? `"${c.a.name}" (${clockLabel(c.a.time!)}) and "${c.b.name}" (${clockLabel(c.b.time!)}) overlap. Nothing was moved. Change one time if you want to.`
    : `${ACTIVITY_LABEL[c.module]} is ${c.planned - c.cap} min over the ${c.cap} min you set for it today. Nothing was removed.`;
