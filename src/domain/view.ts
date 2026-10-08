import { PHASE_ORDER } from './catalog';
import { addDays, diffDays, endOfMonth, startOfMonth } from './dates';
import type { Plan } from './engine';
import { fitDay, dayBudget, type DeferReason, type FitItem } from './budget';
import { isLife } from './scoring';
import { dayEnergyOf, energyOk } from './safety';
import { TIME_ORDER } from './options';
import { applyOverride, customToTask, dueInfo, projectDates, type DueInfo } from './schedule';
import type { AppData, Domain, EnergyLevel, ISODate, LifeDomain, RoomKind, SessionEntry, Task, TaskState, TimeOfDay } from './types';

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

/** Why a task that is due is not part of the plan for the day. Shown to the user, so every deferral has a stated cause. */
export type { DeferReason } from './budget';

export interface DeferredItem { item: DueItem; reason: DeferReason }

export interface TodayPlan {
  isActiveDay: boolean;
  /** Cleaning's share of today's minutes (all of them when habits are off). */
  budget: number;
  /** Habits' and life tasks' share of today's minutes. */
  lifeBudget: number;
  /** The whole day's promise: the one number the user chose, shared by cleaning and habits. */
  totalBudget: number;
  /** Everything planned today, cleaning plus habits. Never more than totalBudget unless `overBy` says so. */
  totalPlanned: number;
  /** Minutes by which the user's own urgent tasks exceed the promise (0 when the day fits). Shown honestly rather than hidden. */
  overBy: number;
  /** The urgent tasks the user added that cause the overage. */
  overBecause: Task[];
  focus: DueItem[];
  /** Life-layer habits planned for today (they share the one budget with cleaning). */
  life: DueItem[];
  /** Due but not planned today, in priority order. See `deferred` for why. */
  extra: DueItem[];
  deferred: DeferredItem[];
  catchUp: DueItem[];
  done: SessionEntry[];
  plannedMinutes: number;
  lifeMinutes: number;
  doneMinutes: number;
  energy: EnergyLevel;
}

interface Cand extends FitItem { item: DueItem; catchUp?: boolean }

const asDue = (task: Task, due: ISODate): DueItem => ({ task, due, overdue: false, info: { due, overdue: false, rolled: false } });

/** Daily basics may take at most this share of cleaning's minutes before real cleaning gets a turn, so habits cannot crowd out everything else. */
const HABIT_SHARE = 0.6;
/** At most this many overdue tasks are offered on one day, as a gentle catch-up. */
const CATCH_UP_MAX = 2;
/** A task that has waited this many days jumps ahead of today's regular cleaning, so deferral can never turn into starvation. */
const AGED_DAYS = 2;

/**
 * The one place a day is assembled, for today and for any future date alike. `items` are the tasks due that day; this orders them,
 * applies the low-energy rule, and lets `fitDay` decide what the day's minutes can hold.
 */
const assembleDay = (v: PlanView, date: ISODate, items: DueItem[], energy: EnergyLevel) => {
  const { plan } = v;
  const wd = new Date(`${date}T12:00:00`).getDay();
  const budget = dayBudget(plan, wd, energy);
  const home = items.filter((i) => !isLife(i.task));
  const lifeItems = items.filter((i) => isLife(i.task) && !i.task.challenge);
  const covering = new Set(plan.goalCoverage.flatMap((g) => g.taskIds));
  const essential = (t: Task) => !!t.custom && t.priority === 'URGENT';
  const age = (i: DueItem) => Math.max(0, diffDays(date, i.due));

  // Cleaning's order: the basics (up to their share), then anything that has waited too long, then today's regular list in the
  // usual order, then a little catch-up, and last any basics beyond their share (they take whatever minutes are left).
  const todays = home.filter((i) => !i.overdue).sort(compareForToday);
  const overdue = home.filter((i) => i.overdue).sort((a, b) => age(b) - age(a) || b.task.score - a.task.score).slice(0, CATCH_UP_MAX);
  const habitCap = budget.home * HABIT_SHARE;
  let habitMin = 0;
  const firstHabits: DueItem[] = [], moreHabits: DueItem[] = [];
  for (const i of todays.filter((x) => x.task.habit)) {
    if (habitMin + i.task.minutes <= habitCap || firstHabits.length === 0) { firstHabits.push(i); habitMin += i.task.minutes; } else moreHabits.push(i);
  }
  const aged = overdue.filter((i) => age(i) >= AGED_DAYS);
  const rest = overdue.filter((i) => age(i) < AGED_DAYS);
  const ordered: { item: DueItem; catchUp: boolean }[] = [
    ...firstHabits.map((item) => ({ item, catchUp: false })),
    ...aged.map((item) => ({ item, catchUp: true })),
    ...todays.filter((i) => !i.task.habit).map((item) => ({ item, catchUp: false })),
    ...rest.map((item) => ({ item, catchUp: true })),
    ...moreHabits.map((item) => ({ item, catchUp: false })),
  ];
  const cands: Cand[] = [];
  ordered.forEach(({ item, catchUp }, order) => {
    const t = item.task;
    const ess = essential(t);
    const blocked = ess ? undefined : !budget.active && !t.habit ? 'rest-day' as const : !energyOk(t, energy) ? 'energy' as const : undefined;
    cands.push({ item, minutes: t.minutes, domain: 'home', order, weight: t.score + (t.habit ? 15 : 0) + (catchUp ? Math.min(30, 8 * age(item)) - 20 : 0), essential: ess, blocked, catchUp });
  });
  // Life tasks: the ones that are a goal's cover come first, so a tight day drops filler before it drops a goal.
  lifeItems
    .sort((a, b) => Number(covering.has(b.task.id)) - Number(covering.has(a.task.id)) || b.task.score - a.task.score)
    .forEach((item, order) => {
      const t = item.task;
      cands.push({ item, minutes: t.minutes, domain: 'life', order, weight: t.score + (covering.has(t.id) ? 50 : 0), essential: essential(t), blocked: essential(t) ? undefined : !energyOk(t, energy) ? 'energy' : undefined });
    });
  return { budget, fit: fitDay(cands, budget) };
};

export const todayPlan = (v: PlanView): TodayPlan => {
  const { data, today } = v;
  const energy = dayEnergyOf(data, today);
  const done = entriesOn(data, today).filter((e) => e.outcome === 'completed');
  const all = dueItems(v);
  const { budget, fit } = assembleDay(v, today, all, energy);

  const byKind = (domain: 'home' | 'life', isCatch: boolean) => fit.planned.filter((c) => c.domain === domain && !!c.catchUp === isCatch).sort((a, b) => a.order - b.order).map((c) => c.item);
  const todRank = (t: Task) => TIME_ORDER.indexOf(t.timeOfDay ?? 'anytime');
  const focus = byKind('home', false);
  const life = byKind('life', false).sort((a, b) => todRank(a.task) - todRank(b.task) || b.task.score - a.task.score);
  const catchPlanned = byKind('home', true);
  const deferred: DeferredItem[] = fit.deferred.map((d) => ({ item: d.item.item, reason: d.reason }));
  const homeMinutes = fit.planned.filter((c) => c.domain === 'home').reduce((s, c) => s + c.minutes, 0);
  const lifeMinutes = fit.planned.filter((c) => c.domain === 'life').reduce((s, c) => s + c.minutes, 0);
  return {
    isActiveDay: budget.active, budget: budget.home, lifeBudget: budget.life, totalBudget: budget.total, totalPlanned: fit.total, overBy: fit.overBy,
    overBecause: fit.essentials.map((c) => c.item.task),
    focus, life, extra: deferred.map((d) => d.item), deferred, catchUp: catchPlanned, done,
    plannedMinutes: homeMinutes,
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

export interface DayPlan {
  date: ISODate;
  /** What is planned for the day. These, and only these, count against the day's minutes. */
  tasks: Task[];
  /** Minutes of `tasks`. */
  minutes: number;
  /** The day's promise (the one number the user chose; smaller on a rest day or a low-energy day). */
  budget: number;
  /** Minutes by which the user's own urgent tasks exceed the promise. 0 when the day fits. */
  overBy: number;
  /** Due that day but not planned, each with the reason. */
  deferred: { task: Task; reason: DeferReason }[];
  done: SessionEntry[];
}

/** Tasks due on `date`, before the day's minutes are applied. */
const dueOn = (v: PlanView, date: ISODate): Task[] => {
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
  return out;
};

/** Everything due that day, unfitted. Use `dayPlan` for what the day can actually hold. */
export const tasksOnDate = (v: PlanView, date: ISODate): Task[] =>
  dueOn(v, date).sort((a, b) => Number(b.habit) - Number(a.habit) || b.score - a.score);

/**
 * What a day holds. Today uses `todayPlan` (which also knows the user's energy and what is overdue); every other date is assembled
 * by the same `assembleDay`, with a normal-energy day and nothing overdue, so Today, Tomorrow and the Schedule can never disagree
 * about what fits.
 */
export const dayPlan = (v: PlanView, date: ISODate): DayPlan => {
  const done = entriesOn(v.data, date).filter((e) => e.outcome === 'completed');
  if (date === v.today) {
    const t = todayPlan(v);
    const tasks = [...t.focus, ...t.catchUp, ...t.life].map((f) => f.task);
    return { date, tasks, minutes: tasks.reduce((s, x) => s + x.minutes, 0), budget: t.totalBudget, overBy: t.overBy, deferred: t.deferred.map((d) => ({ task: d.item.task, reason: d.reason })), done };
  }
  const { budget, fit } = assembleDay(v, date, dueOn(v, date).map((t) => asDue(t, date)), 'ok');
  const tasks = fit.planned.sort((a, b) => a.domain.localeCompare(b.domain) || a.order - b.order).map((c) => c.item.task);
  return { date, tasks, minutes: tasks.reduce((s, x) => s + x.minutes, 0), budget: budget.total, overBy: fit.overBy, deferred: fit.deferred.map((d) => ({ task: d.item.item.task, reason: d.reason })), done };
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

/** The user's energy for the view's day. Every list that suggests a task filters through `energyOk` with this. */
export const viewEnergy = (v: PlanView): EnergyLevel => dayEnergyOf(v.data, v.today);

export const quickWins = (v: PlanView, limit = 8): Task[] => {
  const doneToday = new Set(entriesOn(v.data, v.today).filter((e) => e.outcome === 'completed').map((e) => e.taskId));
  const cands = v.tasks
    .filter((t) => t.tier !== 'deep' && live(v, t) && !doneToday.has(t.id) && !t.challenge && t.minutes <= 10 && (t.quickWin || t.minutes <= 5) && t.frequency !== 'seasonal' && energyOk(t, viewEnergy(v)))
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
    case 'routine': return v.tasks.filter((t) => t.routine && live(v, t) && energyOk(t, viewEnergy(v))).sort((a, b) => TIME_ORDER.indexOf(a.timeOfDay ?? 'anytime') - TIME_ORDER.indexOf(b.timeOfDay ?? 'anytime') || b.score - a.score);
    case 'challenge': return v.tasks.filter((t) => t.challenge && energyOk(t, viewEnergy(v))).sort((a, b) => b.score - a.score);
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
    .filter((t) => energyOk(t, viewEnergy(v)))
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
