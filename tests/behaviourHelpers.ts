import { addDays } from '../src/domain/dates';
import { buildExposure, hasNewExposure } from '../src/domain/exposure';
import { generatePlan } from '../src/domain/engine';
import { buildView } from '../src/domain/view';
import type { AppData, LifeFocus, Preferences, Task } from '../src/domain/types';
import { reducer, type Stamp } from '../src/state/reducer';
import { custom, TODAY } from './helpers';

// ───────────── helpers: a person's days, built through the real reducer ─────────────
export const day = (off: number) => addDays(TODAY, off);
export const stampOn = (date: string, hour = 9): Stamp => ({ today: date, now: `${date}T${String(hour).padStart(2, '0')}:00:00.000Z`, hour, tz: 0 });
export const mk = (focus: LifeFocus[], prefs: Partial<Preferences> = {}, startOffset = -45): AppData => {
  const d = custom('apartment', {}, {}, { focus, sessionMinutes: 60, daysPerWeek: 7, style: 'daily', ...prefs });
  return { ...d, plan: { ...d.plan, startDate: day(startOffset) } };
};
export const viewAt = (d: AppData, date = TODAY) => buildView(d, generatePlan(d.home, d.preferences, d.plan), date);
/** The planner's decision for `date`, recorded the way the app does when it is opened that day. */
export const open = (d: AppData, date = TODAY, hour = 7): AppData => {
  const rec = buildExposure(viewAt(d, date), `${date}T${String(hour).padStart(2, '0')}:00:00.000Z`, 0);
  return hasNewExposure(viewAt(d, date), rec) ? reducer(d, { type: 'RECORD_EXPOSURE', record: rec }) : d;
};
export const seeAll = (d: AppData, date = TODAY, hour = 7): AppData => {
  const rec = d.exposures.find((e) => e.date === date)!;
  return reducer(d, { type: 'RECORD_SEEN', date, ids: rec.items.map((i) => i.taskId), revealed: (rec.left ?? []).map((i) => i.taskId), at: `${date}T${String(hour).padStart(2, '0')}:05:00.000Z` });
};
export const doIt = (d: AppData, type: 'TASK_COMPLETE' | 'TASK_SKIP' | 'TASK_SNOOZE', task: Task, date = TODAY, hour = 9, extra: Record<string, unknown> = {}, id?: string): AppData =>
  reducer(d, { type, task, stamp: stampOn(date, hour), ...(type === 'TASK_COMPLETE' ? { via: 'checkoff' } : {}), entryId: id ?? `e-${type}-${task.id}-${date}-${hour}`, ...extra } as never);
export const entriesOf = (d: AppData) => d.sessions.flatMap((s) => s.entries);
export const left = (d: AppData, date = TODAY) => d.exposures.find((e) => e.date === date)?.left ?? [];
export const selectedIds = (d: AppData, date = TODAY) => (d.exposures.find((e) => e.date === date)?.items ?? []).map((i) => i.taskId);
export const withEnergy = (d: AppData, level: 'low' | 'ok' | 'high', date = TODAY, hour = 8): AppData => reducer(d, { type: 'DAY_ENERGY', level, stamp: stampOn(date, hour) });
