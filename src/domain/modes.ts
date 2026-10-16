import { PHASE_LABEL, PHASE_ORDER, PHASE_WHY } from './catalog';
import { buildResetTasks } from './engine';
import { dueInfo } from './schedule';
import type { AppData, ISODate, ResetPhase, Task } from './types';
import { energyOk, dayEnergyOf } from './safety';
import { entriesOn, type PlanView } from './view';

// ───────────────────────── "I only have X minutes" ─────────────────────────

export const TIME_OPTIONS = [5, 10, 15, 20, 30, 45, 60, 90, 120] as const;
export const timeOptionLabel = (m: number) => (m >= 120 ? '2+ hours' : m >= 60 && m % 60 === 0 ? `${m / 60} hour${m > 60 ? 's' : ''}` : `${m} minutes`);

export interface TimeBoxResult {
  minutes: number;
  tasks: Task[];
  total: number;
  spare: number;
  /** True when everything that matters already fits and there is nothing more worth adding. */
  everythingFits: boolean;
}

/**
 * Highest-impact tasks that fit *within* the time (0/1 knapsack, exact minutes).
 * A 60-minute selection never contains 90 minutes of work.
 */
export const timeBox = (v: PlanView, minutes: number): TimeBoxResult => {
  const doneToday = new Set(entriesOn(v.data, v.today).filter((e) => e.outcome === 'completed').map((e) => e.taskId));
  const mess = v.plan.mess;
  const energy = dayEnergyOf(v.data, v.today);
  const pool: { task: Task; value: number }[] = [];
  for (const task of v.tasks) {
    const st = v.states[task.id];
    if (st?.done || task.challenge || (doneToday.has(task.id) && !task.repeatable)) continue;
    if (!energyOk(task, energy)) continue; // the same low-energy rule as every other list
    if (task.tier === 'deep' && minutes < 45) continue;
    const info = dueInfo(task, st, v.today);
    let w = 0.55; // not due soon
    if (info.due) {
      const days = Math.round((new Date(`${info.due}T12:00:00`).getTime() - new Date(`${v.today}T12:00:00`).getTime()) / 86400000);
      w = days <= 0 ? 1.6 : days <= 2 ? 1.0 : 0.65;
    }
    if (task.tier === 'reset') w = 1.4 + mess * 0.06;
    if (task.tier === 'deep') w = 0.4;
    if (task.backlog) w = Math.min(w, 0.5);
    pool.push({ task, value: (task.impact * 10 + task.score) * w });
  }

  const cap = Math.max(1, Math.floor(minutes));
  // dp[i][m] = best value using first i items within m minutes
  const n = pool.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(cap + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    const { task, value } = pool[i - 1];
    const w = Math.max(1, Math.round(task.minutes));
    for (let m = 0; m <= cap; m++) {
      dp[i][m] = dp[i - 1][m];
      if (w <= m && dp[i - 1][m - w] + value > dp[i][m]) dp[i][m] = dp[i - 1][m - w] + value;
    }
  }
  const picked: Task[] = [];
  let m = cap;
  for (let i = n; i >= 1; i--) {
    if (dp[i][m] !== dp[i - 1][m]) {
      const t = pool[i - 1].task;
      picked.push(t);
      m -= Math.max(1, Math.round(t.minutes));
    }
  }
  // Sensible running order: biggest visible impact first, then group by room.
  picked.sort((a, b) => b.impact - a.impact || a.roomName.localeCompare(b.roomName));
  const total = picked.reduce((s, t) => s + Math.round(t.minutes), 0);
  return { minutes, tasks: picked, total, spare: cap - total, everythingFits: pool.length > 0 && picked.length === pool.length };
};

// ───────────────────────── "My home is a mess" ─────────────────────────

export interface ResetStage { phase: ResetPhase; label: string; why: string; tasks: Task[]; minutes: number }

export const resetSequence = (data: AppData, today?: ISODate, source: Task[] = buildResetTasks(data.home, data.preferences)): ResetStage[] => {
  const energy = today ? dayEnergyOf(data, today) : 'ok';
  const tasks = source.filter((t) => energyOk(t, energy));
  return PHASE_ORDER.map((phase) => {
    const ts = tasks.filter((t) => t.phase === phase);
    return { phase, label: PHASE_LABEL[phase], why: PHASE_WHY[phase], tasks: ts, minutes: ts.reduce((s, t) => s + t.minutes, 0) };
  }).filter((s) => s.tasks.length);
};

export const isResetDone = (data: AppData, id: string): boolean =>
  !!data.resetRun?.doneIds.includes(id) || !!data.taskStates[id]?.done;
