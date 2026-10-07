import { PHASE_ORDER } from './catalog';
import { addDays, endOfMonth, startOfMonth } from './dates';
import type { Plan } from './engine';
import { isLife } from './scoring';
import { TIME_ORDER } from './options';
import { applyOverride, customToTask, dueInfo, projectDates, type DueInfo } from './schedule';
import type { AppData, Domain, ISODate, LifeDomain, RoomKind, SessionEntry, Task, TaskState, TimeOfDay } from './types';

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
  /** Cleaning's share of today's minutes (all of them when habits are off). */
  budget: number;
  /** The whole day's promise: the one number the user chose, shared by cleaning and habits. */
  totalBudget: number;
  /** Everything planned today, cleaning plus habits. */
  totalPlanned: number;
  /** Minutes by which the essentials exceed the promise (0 when they fit). Shown honestly rather than hidden. */
  overBy: number;
  focus: DueItem[];
  /** Life-layer habits due today (separate time budget from home cleaning). */
  life: DueItem[];
  extra: DueItem[];
  catchUp: DueItem[];
  done: SessionEntry[];
  plannedMinutes: number;
  lifeMinutes: number;
  doneMinutes: number;
  energy: 'low' | 'ok' | 'high';
}

export const todayPlan = (v: PlanView): TodayPlan => {
  const { data, plan, today } = v;
  const energy = data.dayEnergy?.date === today ? data.dayEnergy.level : 'ok';
  const isActiveDay = plan.activeDays.includes(new Date(`${today}T12:00:00`).getDay());
  const factor = energy === 'low' ? 0.6 : energy === 'high' ? 1.3 : 1;
  // One daily budget, shared. Cleaning gets its share (all of it when habits are off), habits get the rest.
  const budget = isActiveDay ? Math.round(plan.sessionMinutes * plan.homeShare * factor) : 0;
  const lifeBudget = plan.lifeActive ? Math.round(plan.lifeBudget * factor) : 0;
  // On a rest day only the daily micro-habits remain of cleaning's share, so the promise shrinks to habits plus those basics.
  const restBudget = lifeBudget + (plan.homeShare >= 0.5 ? plan.habitBudget : 0);
  const totalBudget = plan.lifeActive ? (plan.homeShare < 0.5 || isActiveDay ? Math.round(plan.sessionMinutes * factor) : restBudget) : budget;

  const items = dueItems(v);
  const done = entriesOn(data, today).filter((e) => e.outcome === 'completed');
  const catchUp = items.filter((i) => i.overdue && !isLife(i.task)).sort((a, b) => b.task.score - a.task.score).slice(0, 2);
  const eligible = items.filter((i) => !i.overdue && !isLife(i.task)).sort(compareForToday);
  // Life habits have their own (small) budget, so they never crowd out or get crowded out by cleaning.
  const lifeAll = items.filter((i) => isLife(i.task) && !i.task.challenge);
  const todRank = (t: Task) => TIME_ORDER.indexOf(t.timeOfDay ?? 'anytime');
  const lifeEasy = (t: Task) => energy !== 'low' || (t.intensity !== 'vigorous' && t.difficulty <= 2);
  const life = lifeAll.filter((i) => lifeEasy(i.task)).sort((a, b) => todRank(a.task) - todRank(b.task) || b.task.score - a.task.score);

  const easy = (t: Task) => t.difficulty <= 2 && t.minutes <= Math.max(10, plan.chunkLimit);
  const focus: DueItem[] = eligible.filter((i) => i.task.habit);
  const extra: DueItem[] = [];
  let used = focus.reduce((s, f) => s + f.task.minutes, 0);
  // When cleaning shares the day with habits, nothing gets a free pass: the day has to fit the promise.
  const strict = plan.lifeActive;
  const fits = (t: Task) => energy !== 'low' || easy(t);
  for (const it of eligible) {
    if (it.task.habit) continue;
    const firstOne = !strict && focus.every((f) => f.task.habit);
    if (isActiveDay && fits(it.task) && (used + it.task.minutes <= budget * 1.1 || firstOne)) {
      focus.push(it);
      used += it.task.minutes;
    } else extra.push(it);
  }
  if (strict && isActiveDay && !focus.some((f) => !f.task.habit)) {
    // Never leave a cleaning day with only habits if something small enough still fits the promise.
    const small = extra.filter((i) => fits(i.task)).sort((a, b) => a.task.minutes - b.task.minutes)[0];
    if (small && used + small.task.minutes <= budget * 1.3) { focus.push(small); used += small.task.minutes; extra.splice(extra.indexOf(small), 1); }
  }
  extra.push(...lifeAll.filter((i) => !lifeEasy(i.task)));
  const lifeMinutes = life.reduce((s, i) => s + i.task.minutes, 0);
  const totalPlanned = used + lifeMinutes;
  return {
    isActiveDay, budget, totalBudget, totalPlanned, overBy: Math.max(0, totalPlanned - totalBudget), focus, life, extra, catchUp, done,
    plannedMinutes: used,
    lifeMinutes,
    doneMinutes: done.reduce((s, e) => s + e.actualMinutes, 0),
    energy,
  };
};

// ───────────────────────── Now / later ─────────────────────────

export type DayPhase = 'morning' | 'afternoon' | 'evening';

/** Late night still belongs to "this evening": a 1 am user has not started tomorrow yet. */
export const phaseOfHour = (hour: number): DayPhase => (hour >= 17 || hour < 5 ? 'evening' : hour >= 12 ? 'afternoon' : 'morning');

export interface LifeBuckets {
  phase: DayPhase;
  /** What suits this part of the day, plus anything that can be done at any time. */
  now: DueItem[];
  /** Later today, but not evening (afternoon items seen in the morning). */
  later: DueItem[];
  /** Evening routines seen before the evening, so they never look like current morning tasks. */
  evening: DueItem[];
  /** Morning (or afternoon) items still open after their time. Optional and quiet: no rush, no shame. */
  earlier: DueItem[];
}

/** Sort today's habits by when they make sense, so an evening routine is never presented as a task for right now. */
export const bucketLife = (items: DueItem[], hour: number): LifeBuckets => {
  const phase = phaseOfHour(hour);
  const out: LifeBuckets = { phase, now: [], later: [], evening: [], earlier: [] };
  for (const i of items) {
    const tod: TimeOfDay = i.task.timeOfDay ?? 'anytime';
    if (tod === 'anytime' || tod === phase) out.now.push(i);
    else if (tod === 'evening') out.evening.push(i);          // phase is morning or afternoon
    else if (tod === 'afternoon' && phase === 'morning') out.later.push(i);
    else out.earlier.push(i);                                  // morning/afternoon items after their time
  }
  return out;
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
  const tasks = date === v.today ? (() => { const t = todayPlan(v); return [...t.focus, ...t.life].map((f) => f.task); })() : tasksOnDate(v, date);
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

export const sectionId = ['today', 'quick', 'routine', 'reset', 'daily', 'weekly', 'biweekly', 'monthly', 'seasonal', 'challenge', 'deep', 'backlog'] as const;
export type SectionId = (typeof sectionId)[number];

export const SECTION_LABEL: Record<SectionId, string> = {
  today: 'Today', quick: 'Quick wins', routine: 'Routines', challenge: 'Challenges', reset: 'Reset & one-time', daily: 'Daily', weekly: 'Weekly', biweekly: 'Every 2 weeks',
  monthly: 'Monthly', seasonal: 'Seasonal', deep: 'Deep clean', backlog: 'Backlog',
};

const live = (v: PlanView, t: Task) => !v.states[t.id]?.done && !t.backlog && !t.challenge;

export const quickWins = (v: PlanView, limit = 8): Task[] => {
  const doneToday = new Set(entriesOn(v.data, v.today).filter((e) => e.outcome === 'completed').map((e) => e.taskId));
  const cands = v.tasks
    .filter((t) => t.tier !== 'deep' && live(v, t) && !doneToday.has(t.id) && !t.challenge && t.minutes <= 10 && (t.quickWin || t.minutes <= 5) && t.frequency !== 'seasonal')
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

export const sectionTasks = (v: PlanView, id: SectionId, domain: Domain | 'all' = 'all'): Task[] => {
  const inDomain = (t: Task) => domain === 'all' || (t.domain ?? 'home') === domain;
  return sectionTasksRaw(v, id).filter(inDomain);
};

const sectionTasksRaw = (v: PlanView, id: SectionId): Task[] => {
  const byScore = (a: Task, b: Task) => b.score - a.score;
  const m = (t: Task) => t.tier === 'maintenance' && live(v, t);
  switch (id) {
    case 'today': { const t = todayPlan(v); return [...t.focus, ...t.life].map((f) => f.task); }
    case 'routine': return v.tasks.filter((t) => t.routine && live(v, t)).sort((a, b) => TIME_ORDER.indexOf(a.timeOfDay ?? 'anytime') - TIME_ORDER.indexOf(b.timeOfDay ?? 'anytime') || b.score - a.score);
    case 'challenge': return v.tasks.filter((t) => t.challenge).sort((a, b) => b.score - a.score);
    case 'quick': return quickWins(v, 12);
    case 'reset': return v.tasks.filter((t) => t.frequency === 'once' && !v.states[t.id]?.done && !t.custom && !isLife(t)).sort((a, b) => phaseRank(a) - phaseRank(b) || b.score - a.score);
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
  const kinds = new Set<RoomKind>(v.tasks.filter((t) => !isLife(t)).map((t) => (OTHER_KINDS.includes(t.roomKind) ? 'other' : t.roomKind)));
  kinds.add('other');
  // studio/dorm main rooms double as bedroom/living
  return ROOM_MODE_ORDER.filter((k) => kinds.has(k) || (k === 'bedroom' && v.plan.rooms.some((r) => r.sleeps)) || (k === 'living' && v.plan.rooms.some((r) => r.sleeps)));
};

export const roomTasks = (v: PlanView, kind: RoomKind): Task[] =>
  v.tasks
    .filter((t) => !isLife(t))
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

/**
 * Which icon a group header in the Plan should use. For Routines the header is the time of day itself,
 * so its icon is fixed per group and never borrowed from whichever task happens to come first.
 */
export type GroupVisual =
  | { kind: 'time'; time: TimeOfDay }
  | { kind: 'domain'; domain: LifeDomain }
  | { kind: 'room'; room: RoomKind };

export const groupVisual = (section: SectionId, t: Task): GroupVisual => {
  if (section === 'routine') return { kind: 'time', time: t.timeOfDay ?? 'anytime' };
  if (isLife(t)) return { kind: 'domain', domain: t.domain as LifeDomain };
  return { kind: 'room', room: t.roomKind };
};
