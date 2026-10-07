/**
 * Pure timer state machine. Time is derived from timestamps (not tick counts),
 * so a throttled background tab or a page reload can never make it drift.
 */
import type { Task } from './types';

export type TimerStatus = 'running' | 'paused' | 'finished';

export interface TimerState {
  taskId: string;
  taskName: string;
  roomName: string;
  totalSec: number;
  status: TimerStatus;
  /** Epoch ms when it will finish (while running). */
  endsAt: number | null;
  /** Seconds left (while paused / finished). */
  remainingSec: number;
  startedAt: number;
  /**
   * The task being timed, kept with the timer. After a reload, tasks made on the fly (Just 5 minutes, rough-day reset) no longer
   * exist anywhere else, and finishing them would otherwise log them as generic cleaning.
   */
  task?: Task;
}

export const DURATIONS = [5, 10, 15, 20, 30] as const;

export const startTimer = (task: { id: string; name: string; roomName: string } & Partial<Task>, minutes: number, now: number): TimerState => {
  const totalSec = Math.max(1, Math.round(minutes * 60));
  const full = 'substeps' in task && 'cadence' in task ? (task as Task) : undefined;
  return { taskId: task.id, taskName: task.name, roomName: task.roomName, totalSec, status: 'running', endsAt: now + totalSec * 1000, remainingSec: totalSec, startedAt: now, ...(full ? { task: full } : {}) };
};

export const remainingSec = (t: TimerState, now: number): number =>
  t.status === 'running' && t.endsAt !== null ? Math.max(0, Math.ceil((t.endsAt - now) / 1000)) : t.remainingSec;

/** Moves a running timer to 'finished' when time is up. Returns the same object if nothing changed. */
export const tick = (t: TimerState, now: number): TimerState =>
  t.status === 'running' && remainingSec(t, now) <= 0 ? { ...t, status: 'finished', endsAt: null, remainingSec: 0 } : t;

export const pauseTimer = (t: TimerState, now: number): TimerState =>
  t.status === 'running' ? { ...t, status: 'paused', endsAt: null, remainingSec: remainingSec(t, now) } : t;

export const resumeTimer = (t: TimerState, now: number): TimerState =>
  t.status === 'paused' ? { ...t, status: 'running', endsAt: now + t.remainingSec * 1000 } : t;

/** Add time (e.g. "5 more minutes") – also reopens a finished timer. */
export const extendTimer = (t: TimerState, minutes: number, now: number): TimerState => {
  const add = Math.round(minutes * 60);
  const left = remainingSec(t, now) + add;
  return { ...t, totalSec: t.totalSec + add, status: 'running', endsAt: now + left * 1000, remainingSec: left };
};

/** Minutes actually spent (excluding paused time), at least 1 once started. */
export const elapsedMinutes = (t: TimerState, now: number): number => {
  const spent = t.totalSec - remainingSec(t, now);
  return Math.max(spent > 0 ? 1 : 0, Math.round(spent / 60));
};

export const formatClock = (sec: number): string => {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * Which task does a finishing timer belong to? In order: the one it was started with in this session, the live plan's version of it,
 * the snapshot stored with the timer (the only source left for "Just 5 minutes" tasks after a reload), and last of all a generic stand-in.
 */
export const resolveTimerTask = (t: TimerState, started: Task | null | undefined, live: Task | undefined): Task =>
  (started && started.id === t.taskId ? started : null) ?? live ?? t.task ?? ({
    id: t.taskId, name: t.taskName, roomName: t.roomName, roomKind: 'home', category: 'Cleaning', minutes: Math.round(t.totalSec / 60),
    cadence: { kind: 'once' }, frequency: 'once',
  } as unknown as Task);
