import { PHASE_ORDER } from './catalog';
import { addDays, endOfMonth, startOfMonth } from './dates';
import type { Plan } from './engine';
import { applyOverride, customToTask, dueInfo, projectDates, type DueInfo } from './schedule';
import type { AppData, ISODate, RoomKind, SessionEntry, Task, TaskState } from './types';

/**
 * A PlanView is the plan *as the user currently experiences it*:
 * generated tasks + custom tasks, with per-task overrides applied.
 */
export interface PlanView {
  today: ISODate;
  plan: Plan;
  tasks: Task[]; // visible
  hidden: Task[];
  byId: Map<string, Task>;
  states: Record<string, TaskState>;
  data: AppData;
}

export const buildView = (data: AppData, plan: Plan, today: ISODate): PlanView => {
  const states = data.taskStates;
  const active = plan.activeDays;
  const generated = plan.tasks.map((t) => applyOverride(t, states[t.id], active));
  const custom = data.customTasks.map((ct) => applyOverride(customToTask(ct, plan.rooms, active), states[ct.id], active));
  const all = [...generated, ...custom];
  const tasks = all.filter((t) => !states[t.id]?.hidden);
  const hidden = all.filter((t) => states[t.id]?.hidden);
  return { today, plan, tasks, hidden, byId: new Map(all.map((t) => [t.id, t])), states, data };
};

export const entriesOn = (data: AppData, date: ISODate): SessionEntry[] =>
  data.sessions.filter((s) => s.date === date).flatMap((s) => s.entries);

export const allEntries = (data: AppData): SessionEntry[] => data.sessions.flatMap((s) => s.entries);

export interface DueItem { task: Task; due: ISODate; overdue: boolean; info: DueInfo }

export const dueItems = (v: PlanView): DueItem[] => {
  const out: DueItem[] = [];
  for (const task of v.tasks) {
    const info = dueInfo(task, v.states[task.id], v.today);
    if (info.due && info.due <= v.today) out.push({ task, due: info.due, overdue: info.overdue, info });
  }
  return out;
};

const phaseRank = (t: Task) => (t.phase ? PHASE_ORDER.indexOf(t.phase) : 50);

/** Order used for "what first": reset phases in sequence, then by score. */
export const compareForToday = (a: DueItem, b: DueItem): number => {
  if (a.task.habit !== b.task.habit) return a.task.habit ? -1 : 1;
  const ra = a.task.tier === 'reset' ? 0 : 1;
  const rb = b.task.tier === 'reset' ? 0 : 1;
  if (ra !== rb) return ra - rb;
  if (ra === 0) return phaseRank(a.task) - phaseRank(b.task) || b.task.score - a.task.score;
  return b.task.score - a.task.score;
};

export interface TodayPlan {
  isActiveDay: boolean;
  budget: number;
  focus: DueItem[];
  extra: DueItem[];
  catchUp: DueItem[];
  done: SessionEntry[];
  plannedMinutes: number;
  doneMinutes: number;
  energy: 'low' | 'ok' | 'high';
}

export const todayPlan = (v: PlanView): TodayPlan => {
  const { data, plan, today } = v;
  const energy = data.dayEnergy?.date === today ? data.dayEnergy.level : 'ok';
  const isActiveDay = plan.activeDays.includes(new Date(`${today}T12:00:00`).getDay());
  const factor = energy === 'low' ? 0.6 : energy === 'high' ? 1.3 : 1;
  const budget = isActiveDay ? Math.round(plan.sessionMinutes * factor) : 0;

  const items = dueItems(v);
  const done = entriesOn(data, today).filter((e) => e.outcome === 'completed');
  const catchUp = items.filter((i) => i.overdue).sort((a, b) => b.task.score - a.task.score).slice(0, 2);
  const eligible = items.filter((i) => !i.overdue).sort(compareForToday);

  const easy = (t: Task) => t.difficulty <= 2 && t.minutes <= Math.max(10, plan.chunkLimit);
  const focus: DueItem[] = eligible.filter((i) => i.task.habit);
  const extra: DueItem[] = [];
  let used = focus.reduce((s, f) => s + f.task.minutes, 0);
  for (const it of eligible) {
    if (it.task.habit) continue;
    const fitsEnergy = energy !== 'low' || easy(it.task);
    const firstOne = focus.every((f) => f.task.habit);
    if (isActiveDay && fitsEnergy && (used + it.task.minutes <= budget * 1.1 || firstOne)) {
      focus.push(it);
      used += it.task.minutes;
    } else extra.push(it);
  }
  return {
    isActiveDay, budget, focus, extra, catchUp, done,
    plannedMinutes: used,
    doneMinutes: done.reduce((s, e) => s + e.actualMinutes, 0),
    energy,
  };
};

// ───────────────────────── Schedule views ─────────────────────────

export interface DayPlan { date: ISODate; tasks: Task[]; minutes: number; done: SessionEntry[] }

export const tasksOnDate = (v: PlanView, date: ISODate): Task[] => {
  const out: Task[] = [];
  for (const task of v.tasks) {
    const st = v.states[task.id];
    if (date === v.today) {
      const info = dueInfo(task, st, v.today);
      if (info.due && info.due <= v.today) out.push(task);
      continue;
    }
    if (projectDates(task, st, date, date, v.today).length) out.push(task);
  }
  return out.sort((a, b) => Number(b.habit) - Number(a.habit) || b.score - a.score);
};

export const dayPlan = (v: PlanView, date: ISODate): DayPlan => {
  const tasks = date === v.today ? todayPlan(v).focus.map((f) => f.task) : tasksOnDate(v, date);
  return { date, tasks, minutes: tasks.reduce((s, t) => s + t.minutes, 0), done: entriesOn(v.data, date).filter((e) => e.outcome === 'completed') };
};

export const weekPlan = (v: PlanView, from: ISODate): DayPlan[] =>
  Array.from({ length: 7 }, (_, i) => dayPlan(v, addDays(from, i)));

export const monthPlan = (v: PlanView, anchor: ISODate): { start: ISODate; end: ISODate; days: DayPlan[] } => {
  const start = startOfMonth(anchor);
  const end = endOfMonth(anchor);
  const days: DayPlan[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) days.push(dayPlan(v, d));
  return { start, end, days };
};

export const overdueItems = (v: PlanView): DueItem[] => dueItems(v).filter((i) => i.overdue).sort((a, b) => b.task.score - a.task.score);

// ───────────────────────── Sections & rooms ─────────────────────────

export const sectionId = ['today', 'quick', 'reset', 'daily', 'weekly', 'biweekly', 'monthly', 'seasonal', 'deep', 'backlog'] as const;
export type SectionId = (typeof sectionId)[number];

export const SECTION_LABEL: Record<SectionId, string> = {
  today: 'Today', quick: 'Quick wins', reset: 'Reset & one-time', daily: 'Daily', weekly: 'Weekly', biweekly: 'Every 2 weeks',
  monthly: 'Monthly', seasonal: 'Seasonal', deep: 'Deep clean', backlog: 'Backlog',
};

const live = (v: PlanView, t: Task) => !v.states[t.id]?.done && !t.backlog;

export const quickWins = (v: PlanView, limit = 8): Task[] => {
  const doneToday = new Set(entriesOn(v.data, v.today).filter((e) => e.outcome === 'completed').map((e) => e.taskId));
  const cands = v.tasks
    .filter((t) => t.tier !== 'deep' && live(v, t) && !doneToday.has(t.id) && t.minutes <= 10 && (t.quickWin || t.minutes <= 5) && t.frequency !== 'seasonal')
    .sort((a, b) => b.impact / b.minutes - a.impact / a.minutes || b.score - a.score);
  const perRoom = new Map<string, number>();
  const out: Task[] = [];
  for (const t of cands) {
    const n = perRoom.get(t.roomId) ?? 0;
    if (n >= 2) continue;
    perRoom.set(t.roomId, n + 1);
    out.push(t);
    if (out.length >= limit) break;
  }
  return out;
};

export const sectionTasks = (v: PlanView, id: SectionId): Task[] => {
  const byScore = (a: Task, b: Task) => b.score - a.score;
  const m = (t: Task) => t.tier === 'maintenance' && live(v, t);
  switch (id) {
    case 'today': return todayPlan(v).focus.map((f) => f.task);
    case 'quick': return quickWins(v, 12);
    case 'reset': return v.tasks.filter((t) => t.frequency === 'once' && !v.states[t.id]?.done && !t.custom).sort((a, b) => phaseRank(a) - phaseRank(b) || b.score - a.score);
    case 'daily': return v.tasks.filter((t) => m(t) && t.frequency === 'daily').sort(byScore);
    case 'weekly': return v.tasks.filter((t) => m(t) && (t.frequency === 'weekly' || t.frequency === 'twice-weekly')).sort(byScore);
    case 'biweekly': return v.tasks.filter((t) => m(t) && t.frequency === 'biweekly').sort(byScore);
    case 'monthly': return v.tasks.filter((t) => m(t) && t.frequency === 'monthly').sort(byScore);
    case 'seasonal': return v.tasks.filter((t) => m(t) && t.frequency === 'seasonal').sort(byScore);
    case 'deep': return v.tasks.filter((t) => t.tier === 'deep').sort(byScore);
    case 'backlog': return v.tasks.filter((t) => t.backlog && t.tier !== 'deep').sort(byScore);
  }
};

const OTHER_KINDS: RoomKind[] = ['other', 'dining', 'storage', 'home'];

export const ROOM_MODE_LABEL: Partial<Record<RoomKind, string>> = {
  kitchen: 'Kitchen', bathroom: 'Bathroom', bedroom: 'Bedroom', living: 'Living room', office: 'Office', hallway: 'Hallway',
  laundry: 'Laundry', balcony: 'Balcony', garage: 'Garage', basement: 'Basement', attic: 'Attic', other: 'Other',
};

export const ROOM_MODE_ORDER: RoomKind[] = ['kitchen', 'bathroom', 'bedroom', 'living', 'office', 'hallway', 'laundry', 'balcony', 'garage', 'basement', 'attic', 'other'];

/** Room modes the home actually has. "Other" always exists (dining, storage, whole-home tasks). */
export const availableRoomModes = (v: PlanView): RoomKind[] => {
  const kinds = new Set<RoomKind>(v.tasks.map((t) => (OTHER_KINDS.includes(t.roomKind) ? 'other' : t.roomKind)));
  kinds.add('other');
  // studio/dorm main rooms double as bedroom/living
  return ROOM_MODE_ORDER.filter((k) => kinds.has(k) || (k === 'bedroom' && v.plan.rooms.some((r) => r.sleeps)) || (k === 'living' && v.plan.rooms.some((r) => r.sleeps)));
};

export const roomTasks = (v: PlanView, kind: RoomKind): Task[] =>
  v.tasks
    .filter((t) => {
      const k = OTHER_KINDS.includes(t.roomKind) ? 'other' : t.roomKind;
      const sleepsMatch = (kind === 'bedroom' || kind === 'living') && v.plan.rooms.some((r) => r.id === t.roomId && r.sleeps);
      return k === kind || sleepsMatch;
    })
    .filter((t) => !v.states[t.id]?.done || t.tier === 'deep')
    .sort((a, b) => Number(!!a.backlog) - Number(!!b.backlog) || b.score - a.score);

/** How many task occurrences are still expected in [from, to] (ignores things already done). */
export const projectRemaining = (v: PlanView, from: ISODate, to: ISODate): number => {
  let n = 0;
  for (const task of v.tasks) {
    if (task.tier === 'deep' && !v.states[task.id]?.due) continue;
    n += projectDates(task, v.states[task.id], from, to, v.today).length;
  }
  return n;
};
