import { addDays, diffDays, weekday } from './dates';
import { DOMAIN_SHORT } from './options';
import type {
  Cadence, CustomTask, Frequency, ISODate, Priority, Room, Task, TaskState,
} from './types';

/**
 * Runtime scheduling rules: what is due when, what happens when you complete /
 * skip / snooze a task, and how overdue work is handled *without* piling it on
 * today ("do not punish users for missed tasks").
 */

const ALL = [0, 1, 2, 3, 4, 5, 6];

export const cadenceFor = (freq: Frequency, active: number[], habit: boolean): Cadence => {
  switch (freq) {
    case 'daily': return { kind: 'days', days: habit ? ALL : active };
    case 'twice-weekly': {
      if (habit) return { kind: 'days', days: [2, 5] };
      if (active.length < 2) return { kind: 'every', every: 7 };
      const a = active[0];
      const far = active.find((d) => Math.min((d - a + 7) % 7, (a - d + 7) % 7) >= 3) ?? active[active.length - 1];
      return { kind: 'days', days: [a, far].sort((x, y) => x - y) };
    }
    case 'weekly': return { kind: 'every', every: 7 };
    case 'biweekly': return { kind: 'every', every: 14 };
    case 'monthly': return { kind: 'every', every: 28 };
    case 'seasonal': return { kind: 'every', every: 91 };
    default: return { kind: 'once' };
  }
};

export const FREQ_LABEL: Record<Frequency, string> = {
  daily: 'Daily', 'twice-weekly': 'Twice a week', weekly: 'Weekly', biweekly: 'Every 2 weeks', monthly: 'Monthly',
  seasonal: 'Seasonal', deep: 'Deep clean', once: 'One time',
};

const firstMatching = (from: ISODate, days: number[]): ISODate => {
  let d = from;
  for (let i = 0; i < 8; i++, d = addDays(d, 1)) if (days.includes(weekday(d))) return d;
  return from;
};

const alignedOnOrAfter = (anchor: ISODate, every: number, from: ISODate): ISODate => {
  const diff = diffDays(from, anchor);
  if (diff <= 0) return anchor;
  return addDays(anchor, Math.ceil(diff / every) * every);
};

/** The next occurrence after `from` (typically the day something was done). */
export const nextOccurrenceAfter = (cadence: Cadence, anchor: ISODate | null, from: ISODate): ISODate | null => {
  if (cadence.kind === 'once') return null;
  if (cadence.kind === 'days') return firstMatching(addDays(from, 1), cadence.days);
  const earliest = addDays(from, Math.max(1, Math.floor(cadence.every * 0.6)));
  return alignedOnOrAfter(anchor ?? from, cadence.every, earliest);
};

const maxLateDays = (c: Cadence): number =>
  c.kind === 'every' ? Math.min(14, Math.max(3, Math.ceil(c.every * 0.5))) : 0;

export interface DueInfo {
  due: ISODate | null;
  /** True when the scheduled date has passed but is still within the "no rush" window. */
  overdue: boolean;
  /** True when it was missed for so long that it quietly moved to the next slot. */
  rolled: boolean;
}

export const dueInfo = (task: Task, state: TaskState | undefined, today: ISODate): DueInfo => {
  if (state?.hidden || task.backlog && state?.due === undefined) return { due: null, overdue: false, rolled: false };
  const anchor = state?.anchor ?? task.startDate;
  const raw = state?.due !== undefined ? state.due : task.startDate;
  if (task.cadence.kind === 'once') {
    if (state?.done || !raw) return { due: null, overdue: false, rolled: false };
    // One-time tasks wait patiently until you are ready; they never become "late".
    return { due: raw < today ? today : raw, overdue: false, rolled: false };
  }
  if (!raw) return { due: null, overdue: false, rolled: false };
  if (raw >= today) return { due: raw, overdue: false, rolled: false };
  const late = diffDays(today, raw);
  if (late <= maxLateDays(task.cadence)) return { due: raw, overdue: true, rolled: false };
  // Too old: roll to the next slot instead of leaving a backlog.
  if (task.cadence.kind === 'days') return { due: firstMatching(today, task.cadence.days), overdue: false, rolled: true };
  return { due: alignedOnOrAfter(anchor ?? today, task.cadence.every, today), overdue: false, rolled: true };
};

/** Dates in [from, to] on which the task is (projected to be) due. */
export const projectDates = (task: Task, state: TaskState | undefined, from: ISODate, to: ISODate, today: ISODate): ISODate[] => {
  const info = dueInfo(task, state, today);
  if (!info.due) return [];
  const anchor = state?.anchor ?? task.startDate;
  const out: ISODate[] = [];
  let cur: ISODate | null = info.overdue ? today : info.due;
  for (let i = 0; cur && i < 500 && cur <= to; i++) {
    if (cur >= from) out.push(cur);
    if (task.cadence.kind === 'once') break;
    cur = nextOccurrenceAfter(task.cadence, anchor, cur);
  }
  return out;
};

// ───────────────────────── State transitions ─────────────────────────

const base = (s: TaskState | undefined): TaskState => ({ ...(s ?? {}) });

export const markComplete = (task: Task, state: TaskState | undefined, today: ISODate): TaskState => {
  const s = base(state);
  s.lastDone = today;
  s.doneCount = (s.doneCount ?? 0) + 1;
  s.skipStreak = 0;
  if (task.cadence.kind === 'once') { s.done = true; s.due = null; return s; }
  s.due = nextOccurrenceAfter(task.cadence, s.anchor ?? task.startDate, today);
  return s;
};

export const markSkip = (task: Task, state: TaskState | undefined, today: ISODate): TaskState => {
  const s = base(state);
  s.skipStreak = (s.skipStreak ?? 0) + 1;
  s.skipTotal = (s.skipTotal ?? 0) + 1;
  s.due = task.cadence.kind === 'once' ? addDays(today, 4) : nextOccurrenceAfter(task.cadence, s.anchor ?? task.startDate, today);
  return s;
};

export const markSnooze = (state: TaskState | undefined, today: ISODate, days = 2): TaskState => ({ ...base(state), due: addDays(today, days) });
export const markMove = (state: TaskState | undefined, to: ISODate): TaskState => ({ ...base(state), due: to });

/** "Reset my plan": fresh start from today, keeping history and finished one-time tasks. */
export const resetStates = (states: Record<string, TaskState>): Record<string, TaskState> => {
  const out: Record<string, TaskState> = {};
  for (const [id, s] of Object.entries(states)) {
    const { anchor, due, ...rest } = s;
    void anchor; void due;
    out[id] = { ...rest, skipStreak: 0 };
  }
  return out;
};

// ───────────────────────── Overrides & custom tasks ─────────────────────────

export const applyOverride = (task: Task, state: TaskState | undefined, active: number[]): Task => {
  const o = state?.override;
  if (!o) return task;
  const t = { ...task };
  if (o.frequency && o.frequency !== task.frequency) {
    t.frequency = o.frequency;
    t.cadence = cadenceFor(o.frequency, task.domain && task.domain !== 'home' ? ALL : active, task.habit);
  }
  if (o.smaller) {
    t.minutes = Math.max(2, o.minutes ?? Math.ceil(task.minutes / 2));
    t.substeps = task.tinySteps.length ? task.tinySteps : task.substeps;
    t.reason = `${task.reason} Shrunk to a smaller version.`;
  } else if (o.minutes) t.minutes = o.minutes;
  return t;
};

const SCORE: Record<Priority, number> = { URGENT: 92, HIGH: 72, MEDIUM: 52, LOW: 30 };
const IMPACT: Record<Priority, number> = { URGENT: 9, HIGH: 7, MEDIUM: 5, LOW: 3 };

export const customToTask = (ct: CustomTask, rooms: Room[], active: number[]): Task => {
  const domain = ct.domain ?? 'home';
  const room = domain === 'home' ? rooms.find((r) => r.id === ct.roomId) : undefined;
  const label = domain === 'home' ? (room?.name ?? 'Other') : DOMAIN_SHORT[domain];
  return {
    id: ct.id,
    templateId: null,
    name: ct.name,
    roomId: room?.id ?? (domain === 'home' ? 'other' : `life-${domain}`),
    roomKind: room?.kind ?? (domain === 'home' ? 'other' : 'home'),
    roomName: label,
    category: 'Custom',
    minutes: Math.max(1, ct.minutes),
    difficulty: 1,
    frequency: ct.frequency,
    cadence: cadenceFor(ct.frequency, domain === 'home' ? active : ALL, false),
    priority: ct.priority,
    score: SCORE[ct.priority],
    impact: IMPACT[ct.priority],
    reason: ct.notes ? `Your own task. ${ct.notes}` : 'You added this task yourself.',
    substeps: [],
    tinySteps: [],
    tier: 'maintenance',
    habit: false,
    quickWin: ct.minutes <= 5,
    zone: room?.zone ?? 'Home',
    floor: room?.floor ?? 0,
    startDate: ct.startDate,
    needs: [],
    domain,
    custom: true,
    notes: ct.notes,
    topics: [],
  };
};
