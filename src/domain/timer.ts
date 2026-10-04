/**
 * Pure timer state machine. Time is derived from timestamps (not tick counts),
 * so a throttled background tab or a page reload can never make it drift.
 */
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
}

export const DURATIONS = [5, 10, 15, 20, 30] as const;

export const startTimer = (task: { id: string; name: string; roomName: string }, minutes: number, now: number): TimerState => {
  const totalSec = Math.max(1, Math.round(minutes * 60));
  return { taskId: task.id, taskName: task.name, roomName: task.roomName, totalSec, status: 'running', endsAt: now + totalSec * 1000, remainingSec: totalSec, startedAt: now };
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
