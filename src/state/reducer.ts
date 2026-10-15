import { uid } from '../domain/appdata';
import { compactHistory } from '../domain/retention';
import { MAX_LEFT_PER_DAY, leftKey } from '../domain/exposure';
import { applyTypeDefaults } from '../domain/context';
import { appDataForDemo, type DemoProfile } from '../domain/demo';
import { buildResetTasks } from '../domain/engine';
import { planOf } from '../domain/planInputs';
import {
  dueInfo, markComplete, markMove, markSkip, markSnooze, resetStates,
} from '../domain/schedule';
import type {
  AppData, CleaningSession, CustomTask, EnergyLevel, EntryOutcome, EntryPlanned, EntrySurface, EntryVia, ExposureRecord, Home, ISODate, PlanMeta, PlanVersion, Preferences,
  RecommendationEvent, ResetRun, SessionEntry, Supply, Task, TaskState,
} from '../domain/types';
import { planVersionOf } from '../domain/planVersion';
import { emptyAppData } from '../domain/appdata';
import { applyOverride } from '../domain/schedule';
import { isAdhocId } from '../domain/modules/adhoc';
import { moduleReducer, type ModuleAction } from './moduleReducer';
import { mealsReducer, type MealsAction } from './mealsReducer';
import { movementReducer, type MovementAction } from './movementReducer';
import { wellReducer, type WellAction } from './wellReducer';

/**
 * When something happened. `hour` and `tz` are filled in by the store; when absent (tests, older callers) they are derived from `now`,
 * which is exact on the device that produced the stamp.
 */
export interface Stamp { now: string; today: ISODate; hour?: number; tz?: number }

const localHourOf = (s: Stamp) => s.hour ?? new Date(s.now).getHours();
const tzOf = (s: Stamp) => s.tz ?? new Date(s.now).getTimezoneOffset();

export type Action =
  | { type: 'LOAD'; data: AppData }
  | { type: 'RESET_ALL'; stamp: Stamp }
  | { type: 'SET_NAME'; name: string }
  | { type: 'SET_HOME'; patch: Partial<Home>; stamp: Stamp }
  | { type: 'SET_HOME_TYPE'; homeType: NonNullable<Home['type']>; stamp: Stamp }
  | { type: 'SET_PREFS'; patch: Partial<Preferences>; stamp: Stamp }
  | { type: 'FINISH_ONBOARDING'; stamp: Stamp }
  | { type: 'LOAD_DEMO'; id: DemoProfile['id']; withHistory: boolean; stamp: Stamp }
  // `entryId` makes every logged action idempotent and individually undoable. Callers generate it; tests may omit it.
  | { type: 'TASK_COMPLETE'; task: Task; stamp: Stamp; minutes?: number; via: EntryVia; entryId?: string; surface?: EntrySurface }
  | { type: 'TASK_SKIP'; task: Task; stamp: Stamp; via?: EntryVia; minutes?: number; entryId?: string; surface?: EntrySurface }
  | { type: 'TASK_STOP'; task: Task; stamp: Stamp; minutes: number; entryId?: string; surface?: EntrySurface }
  | { type: 'TASK_SNOOZE'; task: Task; stamp: Stamp; entryId?: string; surface?: EntrySurface }
  | { type: 'TASK_MOVE'; task: Task; to: ISODate; stamp: Stamp; label?: 'moved' | 'snoozed'; entryId?: string; surface?: EntrySurface }
  | { type: 'UNDO'; entryId: string; taskId: string; before: TaskState | null; after: TaskState | null; undoReset?: boolean; fiveBefore?: string[] }
  | { type: 'UNDO_RESET_PLAN'; plan: PlanMeta; lastOpened: ISODate | null; before: Record<string, Pick<TaskState, 'anchor' | 'due' | 'skipStreak'>> }
  | { type: 'RECORD_EXPOSURE'; record: ExposureRecord }
  /**
   * The Today screen rendered these tasks while the page was visible (`ids` are selected tasks; `revealed` are left-out tasks the
   * person opened the list of). The first time wins, so repeats, StrictMode, reloads and a second tab record nothing new.
   */
  | { type: 'RECORD_SEEN'; date: ISODate; ids: string[]; revealed?: string[]; at: string }
  | { type: 'RECORD_PLAN_VERSION'; version: PlanVersion }
  | { type: 'REC_EVENT'; event: RecommendationEvent }
  /** Keep the newest history that fits, remove the oldest, and leave a note saying so. Only ever sent after the person agreed. */
  | { type: 'COMPACT_HISTORY'; at: string; target?: number }
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
  | { type: 'SET_OPENED'; stamp: Stamp }
  | ModuleAction
  | MealsAction
  | MovementAction
  | WellAction;

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

const energyOn = (data: AppData, today: ISODate): EnergyLevel =>
  data.energyLog[today] ?? (data.dayEnergy?.date === today ? data.dayEnergy.level : 'ok');

/**
 * Fallback id for callers that do not supply one (tests, scripts). The app always passes a unique `entryId`; that id is what
 * makes an action safe to replay, and what lets Undo find exactly its own entry.
 */
const entryCount = (data: AppData) => data.sessions.reduce((n, s) => n + s.entries.length, 0);
const defaultEntryId = (data: AppData, stamp: Stamp, task: Task, outcome: EntryOutcome) => `e:${stamp.now}:${task.id}:${outcome}:${entryCount(data)}`;

/**
 * How a task relates to the day's planner decision *right now* (selected, left out, or not considered). Unknown when there is no
 * contract 2 record for the day: then nothing is guessed.
 */
const plannedRelation = (data: AppData, task: Task, today: ISODate): EntryPlanned | undefined => {
  const rec = data.exposures.find((e) => e.date === today);
  if (!rec || rec.contract !== 2) return undefined;
  if (rec.items.some((i) => i.taskId === task.id)) return 'selected';
  if ((rec.left ?? []).some((i) => i.taskId === task.id)) return 'left-out';
  return 'not-planned';
};

const entryFor = (
  data: AppData, task: Task, stamp: Stamp, outcome: EntryOutcome, via: EntryVia, minutes: number, id: string | undefined,
  extra: Partial<Pick<SessionEntry, 'fromDue' | 'toDue'>> = {}, surface?: EntrySurface,
): SessionEntry => {
  const e: SessionEntry = {
    id: id ?? defaultEntryId(data, stamp, task, outcome), at: stamp.now, date: stamp.today, taskId: task.id, name: task.name, roomKind: task.roomKind, roomName: task.roomName,
    category: task.category, plannedMinutes: task.minutes, actualMinutes: Math.max(0, Math.round(minutes)), outcome, via, domain: task.domain,
    templateId: task.templateId, difficulty: task.difficulty, localHour: localHourOf(stamp), tzOffsetMin: tzOf(stamp),
    planVersion: planVersionOf(data), energy: energyOn(data, stamp.today),
    // The occurrence this answers: the date it was due (null for tasks with no schedule of their own).
    fromDue: isEphemeral(task) ? null : dueInfo(task, data.taskStates[task.id], stamp.today).due,
    ...extra,
  };
  if (surface) e.surface = surface;
  const planned = plannedRelation(data, task, stamp.today);
  if (planned) e.planned = planned;
  if (task.part) e.part = { index: task.part.index, of: task.part.of };
  if (task.level) e.level = task.level;
  if (task.intensity) e.intensity = task.intensity;
  if (task.timeOfDay) e.timeOfDay = task.timeOfDay;
  if (task.matches?.length) e.goals = task.matches;
  return e;
};

const hasEntry = (data: AppData, id: string) => data.sessions.some((s) => s.entries.some((e) => e.id === id));
const RAPID_MS = 3000;

/**
 * Completing the same thing twice must never double-count. A completion is a duplicate when its id was already logged, when the same
 * task was completed a moment ago (a double tap), or when the task was already completed and is not due again.
 */
export const isDuplicateCompletion = (data: AppData, task: Task, stamp: Stamp, via: EntryVia, entryId?: string): boolean => {
  if (entryId && hasEntry(data, entryId)) return true;
  const nowMs = new Date(stamp.now).getTime();
  const rapid = data.sessions.some((s) => s.date === stamp.today && s.entries.some((e) => e.taskId === task.id && e.outcome === 'completed' && Math.abs(nowMs - new Date(e.at).getTime()) < RAPID_MS));
  if (rapid) return true;
  if (isEphemeral(task) || task.repeatable || via === 'reset') return false;
  const st = data.taskStates[task.id];
  if (task.cadence.kind === 'once') return !!st?.done;
  return st?.lastDone === stamp.today && (st.due === null || (!!st.due && st.due > stamp.today));
};

/** Tasks generated on the fly (Just 5 Minutes, rough-day reset) have no schedule of their own. */
const isEphemeral = (task: Task) => task.id.startsWith('five:') || task.id.startsWith('rough:') || isAdhocId(task.id);

/**
 * Before a profile edit, pin the *current* schedule into task state so that
 * changing, say, the number of bathrooms doesn't shuffle the days of every
 * task you already had.
 */
const freezeSchedule = (data: AppData, today: ISODate): AppData => {
  if (!data.onboardingComplete) return data;
  const plan = planOf(data);
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

const sameState = (a: TaskState | null | undefined, b: TaskState | null | undefined) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Undo exactly one logged action: remove its entry, and put the task's state back only if nothing newer has touched it since.
 * Anything the user did afterwards (other tasks, or the same task again) is left alone.
 */
const undo = (data: AppData, a: Extract<Action, { type: 'UNDO' }>): AppData => {
  if (!hasEntry(data, a.entryId)) return data;
  const sessions = data.sessions
    .map((s) => ({ ...s, entries: s.entries.filter((e) => e.id !== a.entryId) }))
    .filter((s) => s.entries.length > 0);
  let next: AppData = { ...data, sessions };
  if (sameState(data.taskStates[a.taskId], a.after)) {
    const states = { ...data.taskStates };
    if (a.before) states[a.taskId] = a.before; else delete states[a.taskId];
    next = { ...next, taskStates: states };
  }
  if (a.undoReset && next.resetRun) {
    const resetRun: ResetRun = { ...next.resetRun, doneIds: next.resetRun.doneIds.filter((id) => id !== a.taskId) };
    next = { ...next, resetRun };
  }
  if (a.fiveBefore) next = { ...next, fiveRecent: a.fiveBefore };
  return next;
};


const recordExposure = (data: AppData, rec: ExposureRecord): AppData => {
  const idx = data.exposures.findIndex((e) => e.date === rec.date);
  if (idx < 0) return { ...data, exposures: [...data.exposures, rec].sort((x, y) => (x.date < y.date ? -1 : 1)).slice(-120) };
  const cur = data.exposures[idx];
  // A day recorded before contract 2 stays exactly as it was: its display and exclusion facts are unknown and are never filled in.
  if (cur.contract !== 2 && rec.contract === 2) return data;
  // Same day seen again (the plan changed, or the energy did): add what is new, never rewrite what was already recorded.
  const known = new Set(cur.items.map((i) => i.taskId));
  const added = rec.items.filter((i) => !known.has(i.taskId));
  const knownLeft = new Set((cur.left ?? []).map(leftKey));
  const room = Math.max(0, MAX_LEFT_PER_DAY - (cur.left ?? []).length);
  const addedLeft = (rec.left ?? []).filter((x) => !knownLeft.has(leftKey(x))).slice(0, room);
  if (!added.length && !addedLeft.length) return data;
  const exposures = [...data.exposures];
  exposures[idx] = { ...cur, items: [...cur.items, ...added], ...(cur.contract === 2 ? { left: [...(cur.left ?? []), ...addedLeft] } : {}) };
  return { ...data, exposures };
};

/** Mark selected tasks as seen, and left-out tasks as revealed. Only the first time counts; nothing else on the record changes. */
const recordSeen = (data: AppData, a: Extract<Action, { type: 'RECORD_SEEN' }>): AppData => {
  const idx = data.exposures.findIndex((e) => e.date === a.date);
  const cur = data.exposures[idx];
  if (idx < 0 || cur.contract !== 2) return data;
  const ids = new Set(a.ids), rev = new Set(a.revealed ?? []);
  let changed = false;
  const items = cur.items.map((i) => (ids.has(i.taskId) && !i.seenAt ? (changed = true, { ...i, seenAt: a.at }) : i));
  const left = cur.left?.map((i) => (rev.has(i.taskId) && !i.seenAt ? (changed = true, { ...i, seenAt: a.at }) : i));
  if (!changed) return data;
  const exposures = [...data.exposures];
  exposures[idx] = { ...cur, items, ...(left ? { left } : {}) };
  return { ...data, exposures };
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
      const levelChanged = a.patch.lifeLevel !== undefined && a.patch.lifeLevel !== d.preferences.lifeLevel;
      // The clock for "have they been steady long enough?" restarts whenever the level changes.
      return { ...d, preferences: { ...d.preferences, ...a.patch, ...(levelChanged ? { levelSince: a.stamp.today } : {}) } };
    }
    case 'FINISH_ONBOARDING':
      return { ...data, onboardingComplete: true, plan: { startDate: a.stamp.today, resetCount: 0 }, lastOpened: a.stamp.today };
    case 'LOAD_DEMO': {
      const demo = appDataForDemo(a.id, { withHistory: a.withHistory, today: a.stamp.today });
      return { ...demo, supplies: data.supplies, lastOpened: a.stamp.today };
    }
    case 'TASK_COMPLETE': {
      const { task, stamp } = a;
      if (isDuplicateCompletion(data, task, stamp, a.via, a.entryId)) return data;
      let next = logEntry(data, entryFor(data, task, stamp, 'completed', a.via, a.minutes ?? task.minutes, a.entryId, {}, a.surface));
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
      if (a.entryId && hasEntry(data, a.entryId)) return data;
      let next = logEntry(data, entryFor(data, task, stamp, 'skipped', a.via ?? 'plan', 0, a.entryId, {}, a.surface));
      if (!isEphemeral(task)) next = { ...next, taskStates: { ...next.taskStates, [task.id]: markSkip(task, next.taskStates[task.id], stamp.today) } };
      return next;
    }
    case 'TASK_STOP': {
      // Timer stopped before finishing: log the effort, keep the task due. No shame.
      const { task, stamp } = a;
      if (a.entryId && hasEntry(data, a.entryId)) return data;
      return logEntry(data, entryFor(data, task, stamp, 'stopped', 'timer', a.minutes, a.entryId, {}, a.surface));
    }
    case 'TASK_SNOOZE': {
      const { task, stamp } = a;
      if (a.entryId && hasEntry(data, a.entryId)) return data;
      const fromDue = dueInfo(task, data.taskStates[task.id], stamp.today).due;
      const state = markSnooze(data.taskStates[task.id], stamp.today);
      const next = logEntry(data, entryFor(data, task, stamp, 'snoozed', 'plan', 0, a.entryId, { fromDue, toDue: state.due ?? null }, a.surface));
      return { ...next, taskStates: { ...next.taskStates, [task.id]: state } };
    }
    case 'TASK_MOVE': {
      const { task, stamp } = a;
      if (a.entryId && hasEntry(data, a.entryId)) return data;
      const fromDue = dueInfo(task, data.taskStates[task.id], stamp.today).due;
      const next = logEntry(data, entryFor(data, task, stamp, a.label ?? 'moved', 'plan', 0, a.entryId, { fromDue, toDue: a.to }, a.surface));
      return { ...next, taskStates: { ...next.taskStates, [task.id]: markMove(next.taskStates[task.id], a.to) } };
    }
    case 'UNDO': return undo(data, a);
    case 'UNDO_RESET_PLAN': {
      // Put back the plan dates a reset removed, but only for tasks nothing has touched since. Newer work is never undone.
      const states = { ...data.taskStates };
      for (const [id, b] of Object.entries(a.before)) {
        const cur = states[id];
        if (cur && cur.anchor === undefined && cur.due === undefined) states[id] = { ...cur, ...b };
      }
      return { ...data, plan: a.plan, lastOpened: a.lastOpened, taskStates: states };
    }
    case 'COMPACT_HISTORY': return compactHistory(data, a.target, a.at).data;
    case 'RECORD_EXPOSURE': return recordExposure(data, a.record);
    case 'RECORD_SEEN': return recordSeen(data, a);
    case 'RECORD_PLAN_VERSION': {
      if (data.planVersions.some((v) => v.id === a.version.id) && data.planVersions[data.planVersions.length - 1]?.id === a.version.id) return data;
      return { ...data, planVersions: [...data.planVersions, a.version].slice(-60) };
    }
    case 'REC_EVENT': {
      // Idempotent by what the event MEANS, not by its random id: one "shown" per suggestion per day, one answer per suggestion per
      // day. A double effect (React StrictMode in development), a double click, or a replay after a merge records it once.
      const dup = (e: RecommendationEvent) => e.id === a.event.id
        || (e.kind === a.event.kind && e.recommendationId === a.event.recommendationId && e.date === a.event.date && e.action === a.event.action);
      if (data.recEvents.some(dup)) return data;
      return { ...data, recEvents: [...data.recEvents, a.event].slice(-400) };
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
    case 'DAY_ENERGY': {
      // The day's exposure keeps its first energy; a change is appended to its history, never written over it.
      const idx = data.exposures.findIndex((e) => e.date === a.stamp.today);
      let exposures = data.exposures;
      if (idx >= 0) {
        const cur = data.exposures[idx];
        const last = cur.energyChanges?.[cur.energyChanges.length - 1]?.level ?? cur.energy;
        if (last !== a.level) {
          exposures = [...data.exposures];
          exposures[idx] = { ...cur, energyChanges: [...(cur.energyChanges ?? []), { at: a.stamp.now, level: a.level }].slice(-12) };
        }
      }
      return { ...data, exposures, dayEnergy: { date: a.stamp.today, level: a.level }, energyLog: { ...data.energyLog, [a.stamp.today]: a.level } };
    }
    case 'DISMISS_INSIGHT': return { ...data, dismissedInsights: { ...data.dismissedInsights, [a.id]: a.stamp.today } };
    case 'SET_SESSION_CAP': return { ...data, preferences: { ...data.preferences, learnedSessionCap: a.minutes } };
    case 'SET_OPENED': return { ...data, lastOpened: a.stamp.today };
    // Section reducers each ignore actions that are not theirs, so the data passes through them in turn.
    default: return wellReducer(movementReducer(mealsReducer(moduleReducer(data, a as ModuleAction), a as MealsAction), a as MovementAction), a as WellAction);
  }
};

