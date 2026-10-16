import { activityTaskId, activityToTask } from '../domain/modules/activities';
import { ACTIVITY_MODULES, MODULE_IDS, TODAY_CARDS, type ActivityModule, type ModuleId, type PlannedActivity, type TodayCard } from '../domain/modules/types';
import { nextOccurrenceAfter } from '../domain/schedule';
import type { AppData, ISODate, TaskState } from '../domain/types';

/**
 * The reducer for sections and planned activities. Pure, idempotent, and it never touches what a person logged: switching a section
 * off hides it, deleting an activity removes its plan, and neither erases a single history entry.
 */

export type ModuleAction =
  | { type: 'MODULE_SET'; id: ModuleId; on: boolean }
  | { type: 'MODULE_CARDS'; order: TodayCard[]; hidden: TodayCard[] }
  | { type: 'MODULE_CAP'; module: ActivityModule; minutes: number | null }
  | { type: 'MODULE_INTRO_SEEN' }
  | { type: 'ACTIVITY_SAVE'; activity: PlannedActivity; today: ISODate }
  | { type: 'ACTIVITY_DELETE'; id: string }
  /** Undo of a delete: the activity and the task state it had (so its counts and next date come back too). */
  | { type: 'ACTIVITY_RESTORE'; activity: PlannedActivity; state: TaskState | null }
  | { type: 'ACTIVITY_ARCHIVE'; id: string; archived: boolean };

const scheduleKey = (a: PlannedActivity) => JSON.stringify([a.schedule, a.startDate, a.endDate]);

export const moduleReducer = (data: AppData, a: ModuleAction): AppData => {
  switch (a.type) {
    case 'MODULE_SET': {
      if (!MODULE_IDS.includes(a.id) || data.modules.enabled[a.id] === a.on) return data;
      return { ...data, modules: { ...data.modules, enabled: { ...data.modules.enabled, [a.id]: a.on }, introSeen: true } };
    }
    case 'MODULE_CARDS': {
      const order = [...new Set(a.order.filter((c) => TODAY_CARDS.includes(c)))];
      for (const c of TODAY_CARDS) if (!order.includes(c)) order.push(c);
      const hidden = [...new Set(a.hidden)].filter((c) => TODAY_CARDS.includes(c) && c !== 'plan');
      return { ...data, modules: { ...data.modules, order, hidden } };
    }
    case 'MODULE_CAP': {
      if (!ACTIVITY_MODULES.includes(a.module)) return data;
      const caps = { ...data.modules.caps };
      if (a.minutes === null || !(a.minutes >= 5)) delete caps[a.module]; else caps[a.module] = Math.min(600, Math.round(a.minutes));
      return { ...data, modules: { ...data.modules, caps } };
    }
    case 'MODULE_INTRO_SEEN': return data.modules.introSeen ? data : { ...data, modules: { ...data.modules, introSeen: true } };
    case 'ACTIVITY_SAVE': {
      const prev = data.activities.find((x) => x.id === a.activity.id);
      const next = a.activity;
      const activities = prev ? data.activities.map((x) => (x.id === next.id ? next : x)) : [...data.activities, next];
      const id = activityTaskId(next.id);
      let taskStates = data.taskStates;
      // Only a change to WHEN it happens re-derives the next date. A rename or a new note leaves snoozes, moves and counts alone.
      if (prev && scheduleKey(prev) !== scheduleKey(next)) {
        const st: TaskState = { ...(data.taskStates[id] ?? {}) };
        delete st.due; delete st.anchor;
        const t = activityToTask(next);
        if (t.cadence.kind === 'once') st.done = false;
        else if (st.lastDone === a.today) st.due = nextOccurrenceAfter(t.cadence, t.startDate, a.today);
        taskStates = { ...data.taskStates, [id]: st };
      }
      return { ...data, activities, taskStates };
    }
    case 'ACTIVITY_DELETE': {
      if (!data.activities.some((x) => x.id === a.id)) return data;
      const { [activityTaskId(a.id)]: _gone, ...rest } = data.taskStates;
      void _gone;
      return { ...data, activities: data.activities.filter((x) => x.id !== a.id), taskStates: rest };
    }
    case 'ACTIVITY_RESTORE': {
      if (data.activities.some((x) => x.id === a.activity.id)) return data;
      const id = activityTaskId(a.activity.id);
      const taskStates = a.state && !data.taskStates[id] ? { ...data.taskStates, [id]: a.state } : data.taskStates;
      return { ...data, activities: [...data.activities, a.activity], taskStates };
    }
    case 'ACTIVITY_ARCHIVE': {
      const cur = data.activities.find((x) => x.id === a.id);
      if (!cur || cur.archived === a.archived) return data;
      return { ...data, activities: data.activities.map((x) => (x.id === a.id ? { ...x, archived: a.archived } : x)) };
    }
    default: return data;
  }
};
