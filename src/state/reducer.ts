import { uid } from '../domain/appdata';
import { applyTypeDefaults } from '../domain/context';
import { appDataForDemo, type DemoProfile } from '../domain/demo';
import { buildResetTasks, generatePlan } from '../domain/engine';
import {
  dueInfo, markComplete, markMove, markSkip, markSnooze, resetStates,
} from '../domain/schedule';
import type {
  AppData, CleaningSession, CustomTask, EntryOutcome, EntryVia, Home, ISODate, Preferences, SessionEntry,
  Supply, Task, TaskState,
} from '../domain/types';
import { emptyAppData } from '../domain/appdata';
import { applyOverride } from '../domain/schedule';

export interface Stamp { now: string; today: ISODate }

export type Action =
  | { type: 'LOAD'; data: AppData }
  | { type: 'RESET_ALL'; stamp: Stamp }
  | { type: 'SET_NAME'; name: string }
  | { type: 'SET_HOME'; patch: Partial<Home>; stamp: Stamp }
  | { type: 'SET_HOME_TYPE'; homeType: NonNullable<Home['type']>; stamp: Stamp }
  | { type: 'SET_PREFS'; patch: Partial<Preferences>; stamp: Stamp }
  | { type: 'FINISH_ONBOARDING'; stamp: Stamp }
  | { type: 'LOAD_DEMO'; id: DemoProfile['id']; withHistory: boolean; stamp: Stamp }
  | { type: 'TASK_COMPLETE'; task: Task; stamp: Stamp; minutes?: number; via: EntryVia }
  | { type: 'TASK_SKIP'; task: Task; stamp: Stamp; via?: EntryVia; minutes?: number }
  | { type: 'TASK_STOP'; task: Task; stamp: Stamp; minutes: number }
  | { type: 'TASK_SNOOZE'; task: Task; stamp: Stamp }
  | { type: 'TASK_MOVE'; task: Task; to: ISODate; stamp: Stamp; label?: 'moved' | 'snoozed' }
  | { type: 'TASK_PATCH'; id: string; patch: Partial<TaskState> }
  | { type: 'TASK_OVERRIDE'; id: string; override: NonNullable<TaskState['override']> | null }
  | { type: 'RESET_PLAN'; stamp: Stamp }
  | { type: 'CUSTOM_SAVE'; task: CustomTask }
  | { type: 'CUSTOM_DELETE'; id: string }
  | { type: 'SUPPLY_SAVE'; supply: Supply }
  | { type: 'SUPPLY_DELETE'; id: string }
  | { type: 'SUPPLY_STARTERS'; supplies: Omit<Supply, 'id'>[] }
  | { type: 'RESET_RUN_START'; stamp: Stamp }
  | { type: 'RESET_RUN_FINISH'; stamp: Stamp }
  | { type: 'FIVE_SEEN'; id: string }
  | { type: 'DAY_ENERGY'; level: 'low' | 'ok' | 'high'; stamp: Stamp }
  | { type: 'DISMISS_INSIGHT'; id: string; stamp: Stamp }
  | { type: 'SET_SESSION_CAP'; minutes: number | null; stamp: Stamp }
  | { type: 'SET_OPENED'; stamp: Stamp };

const SESSION_GAP_MIN = 45;

export const logEntry = (data: AppData, entry: SessionEntry): AppData => {
  const sessions = [...data.sessions];
  const last = sessions[sessions.length - 1];
  const gap = last ? (new Date(entry.at).getTime() - new Date(last.endedAt).getTime()) / 60000 : Infinity;
  if (last && last.date === entry.date && gap >= 0 && gap < SESSION_GAP_MIN) {
    sessions[sessions.length - 1] = { ...last, endedAt: entry.at, entries: [...last.entries, entry] };
  } else {
    const s: CleaningSession = { id: uid('s'), date: entry.date, startedAt: entry.at, endedAt: entry.at, entries: [entry] };
    sessions.push(s);
  }
  return { ...data, sessions };
};

const entryFor = (task: Task, stamp: Stamp, outcome: EntryOutcome, via: EntryVia, minutes: number): SessionEntry => ({
  id: uid('e'), at: stamp.now, date: stamp.today, taskId: task.id, name: task.name, roomKind: task.roomKind, roomName: task.roomName,
  category: task.category, plannedMinutes: task.minutes, actualMinutes: Math.max(0, Math.round(minutes)), outcome, via, domain: task.domain,
});

/** Tasks generated on the fly (Just 5 Minutes, rough-day reset) have no schedule of their own. */
const isEphemeral = (task: Task) => task.id.startsWith('five:') || task.id.startsWith('rough:');

/**
 * Before a profile edit, pin the *current* schedule into task state so that
 * changing, say, the number of bathrooms doesn't shuffle the days of every
 * task you already had.
 */
const freezeSchedule = (data: AppData, today: ISODate): AppData => {
  if (!data.onboardingComplete) return data;
  const plan = generatePlan(data.home, data.preferences, data.plan);
  const states = { ...data.taskStates };
  for (const raw of plan.tasks) {
    const t = applyOverride(raw, states[raw.id], plan.activeDays);
    const st = states[t.id] ?? {};
    if (st.done || st.hidden || !t.startDate) continue;
    if (st.due !== undefined && st.anchor !== undefined) continue;
    const info = dueInfo(t, st, today);
    states[t.id] = { ...st, anchor: st.anchor ?? t.startDate, due: st.due !== undefined ? st.due : info.due };
  }
  return { ...data, taskStates: states };
};

export const reducer = (data: AppData, a: Action): AppData => {
  switch (a.type) {
    case 'LOAD': return a.data;
    case 'RESET_ALL': return emptyAppData(a.stamp.today);
    case 'SET_NAME': return { ...data, user: { ...data.user, name: a.name } };
    case 'SET_HOME_TYPE': {
      const d = freezeSchedule(data, a.stamp.today);
      return { ...d, home: applyTypeDefaults(d.home, a.homeType) };
    }
    case 'SET_HOME': {
      const d = freezeSchedule(data, a.stamp.today);
      const touched = a.patch.rooms !== undefined || a.patch.floors !== undefined || a.patch.extraRooms !== undefined;
      return { ...d, home: { ...d.home, ...a.patch, roomsTouched: d.home.roomsTouched || touched } };
    }
    case 'SET_PREFS': {
      const d = freezeSchedule(data, a.stamp.today);
      return { ...d, preferences: { ...d.preferences, ...a.patch } };
    }
    case 'FINISH_ONBOARDING':
      return { ...data, onboardingComplete: true, plan: { startDate: a.stamp.today, resetCount: 0 }, lastOpened: a.stamp.today };
    case 'LOAD_DEMO': {
      const demo = appDataForDemo(a.id, { withHistory: a.withHistory, today: a.stamp.today });
      return { ...demo, supplies: data.supplies, lastOpened: a.stamp.today };
    }
    case 'TASK_COMPLETE': {
      const { task, stamp } = a;
      let next = logEntry(data, entryFor(task, stamp, 'completed', a.via, a.minutes ?? task.minutes));
      if (!isEphemeral(task)) {
        next = { ...next, taskStates: { ...next.taskStates, [task.id]: markComplete(task, next.taskStates[task.id], stamp.today) } };
      } else if (task.id.startsWith('five:')) next = { ...next, fiveRecent: [task.id, ...next.fiveRecent].slice(0, 8) };
      if (a.via === 'reset' && next.resetRun && !next.resetRun.doneIds.includes(task.id)) {
        next = { ...next, resetRun: { ...next.resetRun, doneIds: [...next.resetRun.doneIds, task.id] } };
      }
      return next;
    }
    case 'TASK_SKIP': {
      const { task, stamp } = a;
      let next = logEntry(data, entryFor(task, stamp, 'skipped', a.via ?? 'plan', 0));
      if (!isEphemeral(task)) next = { ...next, taskStates: { ...next.taskStates, [task.id]: markSkip(task, next.taskStates[task.id], stamp.today) } };
      return next;
    }
    case 'TASK_STOP': {
      // Timer stopped before finishing: log the effort, keep the task due. No shame.
      const { task, stamp } = a;
      return logEntry(data, entryFor(task, stamp, 'stopped', 'timer', a.minutes));
    }
    case 'TASK_SNOOZE': {
      const { task, stamp } = a;
      const next = logEntry(data, entryFor(task, stamp, 'snoozed', 'plan', 0));
      return { ...next, taskStates: { ...next.taskStates, [task.id]: markSnooze(next.taskStates[task.id], stamp.today) } };
    }
    case 'TASK_MOVE': {
      const { task, stamp } = a;
      const next = logEntry(data, entryFor(task, stamp, a.label ?? 'moved', 'plan', 0));
      return { ...next, taskStates: { ...next.taskStates, [task.id]: markMove(next.taskStates[task.id], a.to) } };
    }
    case 'TASK_PATCH':
      return { ...data, taskStates: { ...data.taskStates, [a.id]: { ...(data.taskStates[a.id] ?? {}), ...a.patch } } };
    case 'TASK_OVERRIDE': {
      const cur = { ...(data.taskStates[a.id] ?? {}) };
      if (a.override) cur.override = { ...(cur.override ?? {}), ...a.override }; else delete cur.override;
      return { ...data, taskStates: { ...data.taskStates, [a.id]: { ...cur, skipStreak: 0 } } };
    }
    case 'RESET_PLAN':
      return {
        ...data,
        plan: { startDate: a.stamp.today, resetCount: data.plan.resetCount + 1 },
        taskStates: resetStates(data.taskStates),
        lastOpened: a.stamp.today,
      };
    case 'CUSTOM_SAVE': {
      const exists = data.customTasks.some((c) => c.id === a.task.id);
      return { ...data, customTasks: exists ? data.customTasks.map((c) => (c.id === a.task.id ? a.task : c)) : [...data.customTasks, a.task] };
    }
    case 'CUSTOM_DELETE': {
      const { [a.id]: _gone, ...rest } = data.taskStates;
      void _gone;
      return { ...data, customTasks: data.customTasks.filter((c) => c.id !== a.id), taskStates: rest };
    }
    case 'SUPPLY_SAVE': {
      const exists = data.supplies.some((s) => s.id === a.supply.id);
      return { ...data, supplies: exists ? data.supplies.map((s) => (s.id === a.supply.id ? a.supply : s)) : [...data.supplies, a.supply] };
    }
    case 'SUPPLY_DELETE': return { ...data, supplies: data.supplies.filter((s) => s.id !== a.id) };
    case 'SUPPLY_STARTERS': return { ...data, supplies: [...data.supplies, ...a.supplies.map((s) => ({ ...s, id: uid('sup') }))] };
    case 'RESET_RUN_START': {
      if (data.resetRun && !data.resetRun.finishedAt) return data;
      // A fresh run after a finished one starts from a clean slate.
      let states = data.taskStates;
      if (data.resetRun?.finishedAt) {
        states = { ...states };
        for (const t of buildResetTasks(data.home, data.preferences)) {
          if (states[t.id]) states[t.id] = { ...states[t.id], done: false };
        }
      }
      return { ...data, taskStates: states, resetRun: { startedAt: a.stamp.now, doneIds: [] } };
    }
    case 'RESET_RUN_FINISH': return data.resetRun ? { ...data, resetRun: { ...data.resetRun, finishedAt: a.stamp.now } } : data;
    case 'FIVE_SEEN': return { ...data, fiveRecent: [a.id, ...data.fiveRecent.filter((x) => x !== a.id)].slice(0, 8) };
    case 'DAY_ENERGY': return { ...data, dayEnergy: { date: a.stamp.today, level: a.level } };
    case 'DISMISS_INSIGHT': return { ...data, dismissedInsights: { ...data.dismissedInsights, [a.id]: a.stamp.today } };
    case 'SET_SESSION_CAP': return { ...data, preferences: { ...data.preferences, learnedSessionCap: a.minutes } };
    case 'SET_OPENED': return { ...data, lastOpened: a.stamp.today };
    default: return data;
  }
};

