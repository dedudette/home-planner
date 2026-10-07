import { describe, expect, it } from 'vitest';
import { appDataForDemo } from '../src/domain/demo';
import { resolveTimerTask, startTimer } from '../src/domain/timer';
import type { AppData, Task } from '../src/domain/types';
import { dueInfo } from '../src/domain/schedule';
import { todayPlan } from '../src/domain/view';
import { isDuplicateCompletion, reducer, type Action, type Stamp } from '../src/state/reducer';
import { demo, TODAY, view } from './helpers';

const at = (iso: string, extra: Partial<Stamp> = {}): Stamp => ({ now: iso, today: TODAY, ...extra });
const stamp = at(`${TODAY}T09:00:00.000Z`);
const entries = (d: AppData) => d.sessions.flatMap((s) => s.entries);
const firstDue = (d: AppData) => todayPlan(view(d)).focus[0].task;
const run = (d: AppData, ...actions: Action[]) => actions.reduce(reducer, d);

describe('TASK_COMPLETE is idempotent', () => {
  it('the same action twice logs once and counts once', () => {
    const d0 = demo('B');
    const task = firstDue(d0);
    const a: Action = { type: 'TASK_COMPLETE', task, stamp, via: 'checkoff', entryId: 'e1' };
    const d = run(d0, a, a);
    expect(entries(d).filter((e) => e.taskId === task.id)).toHaveLength(1);
    expect(d.taskStates[task.id].doneCount).toBe(1);
  });

  it('two taps a moment apart (a double tap) log once, even with different ids', () => {
    const d0 = demo('B');
    const task = firstDue(d0);
    const d = run(d0,
      { type: 'TASK_COMPLETE', task, stamp: at(`${TODAY}T09:00:00.000Z`), via: 'checkoff', entryId: 'e1' },
      { type: 'TASK_COMPLETE', task, stamp: at(`${TODAY}T09:00:00.400Z`), via: 'checkoff', entryId: 'e2' });
    expect(entries(d).filter((e) => e.taskId === task.id)).toHaveLength(1);
    expect(d.taskStates[task.id].doneCount).toBe(1);
  });

  it('completing something that was already done and is not due again is a no-op, even minutes later', () => {
    const d0 = demo('B');
    const task = firstDue(d0);
    const d1 = run(d0, { type: 'TASK_COMPLETE', task, stamp, via: 'checkoff', entryId: 'e1' });
    expect(isDuplicateCompletion(d1, task, at(`${TODAY}T15:00:00.000Z`), 'checkoff', 'e9')).toBe(true);
    const d2 = run(d1, { type: 'TASK_COMPLETE', task, stamp: at(`${TODAY}T15:00:00.000Z`), via: 'checkoff', entryId: 'e9' });
    expect(d2).toBe(d1);
  });

  it('a repeatable task, or a "Just 5 minutes" task, can genuinely be done twice (seconds apart is the only duplicate)', () => {
    const d0 = demo('B');
    const five = { ...firstDue(d0), id: 'five:l-walk:home', repeatable: false } as Task;
    const d = run(d0,
      { type: 'TASK_COMPLETE', task: five, stamp: at(`${TODAY}T09:00:00.000Z`), via: 'five', entryId: 'f1' },
      { type: 'TASK_COMPLETE', task: five, stamp: at(`${TODAY}T09:10:00.000Z`), via: 'five', entryId: 'f2' });
    expect(entries(d).filter((e) => e.taskId === five.id)).toHaveLength(2);
    const walk = { ...firstDue(d0), id: 'rep:1', repeatable: true } as Task;
    const d2 = run(d0,
      { type: 'TASK_COMPLETE', task: walk, stamp: at(`${TODAY}T09:00:00.000Z`), via: 'checkoff', entryId: 'r1' },
      { type: 'TASK_COMPLETE', task: walk, stamp: at(`${TODAY}T11:00:00.000Z`), via: 'checkoff', entryId: 'r2' });
    expect(entries(d2).filter((e) => e.taskId === walk.id)).toHaveLength(2);
  });

  it('a one-time task cannot be completed twice', () => {
    const d0 = demo('A');
    const once = todayPlan(view(d0)).focus.map((f) => f.task).find((t) => t.cadence.kind === 'once');
    expect(once).toBeTruthy();
    const d1 = run(d0, { type: 'TASK_COMPLETE', task: once!, stamp, via: 'checkoff', entryId: 'o1' });
    const d2 = run(d1, { type: 'TASK_COMPLETE', task: once!, stamp: at(`${TODAY}T12:00:00.000Z`), via: 'checkoff', entryId: 'o2' });
    expect(entries(d2).filter((e) => e.taskId === once!.id)).toHaveLength(1);
  });

  it('a second reset run on the same day is not blocked by the first', () => {
    const d0 = demo('A');
    const task = firstDue(d0);
    const d1 = run(d0, { type: 'TASK_COMPLETE', task, stamp: at(`${TODAY}T09:00:00.000Z`), via: 'reset', entryId: 'x1' });
    expect(isDuplicateCompletion(d1, task, at(`${TODAY}T10:00:00.000Z`), 'reset', 'x2')).toBe(false);
  });
});

describe('Undo only undoes the intended action', () => {
  const undoFor = (before: AppData, after: AppData, task: Task, entryId: string): Action => ({
    type: 'UNDO', entryId, taskId: task.id, before: before.taskStates[task.id] ?? null, after: after.taskStates[task.id] ?? null,
  });

  it('removes its own entry and restores its own task, nothing else', () => {
    const d0 = demo('B');
    const [a, b] = todayPlan(view(d0)).focus.map((f) => f.task);
    const d1 = run(d0, { type: 'TASK_COMPLETE', task: a, stamp: at(`${TODAY}T09:00:00.000Z`), via: 'checkoff', entryId: 'ea' });
    const d2 = run(d1, { type: 'TASK_COMPLETE', task: b, stamp: at(`${TODAY}T09:05:00.000Z`), via: 'checkoff', entryId: 'eb' });
    // undo the FIRST action, after the second has happened
    const d3 = reducer(d2, undoFor(d0, d1, a, 'ea'));
    expect(entries(d3).some((e) => e.id === 'ea')).toBe(false);
    expect(entries(d3).some((e) => e.id === 'eb')).toBe(true);           // the newer action survives
    expect(d3.taskStates[b.id].doneCount).toBe(1);                       // …and so does its state
    expect(d3.taskStates[a.id]?.doneCount).toBeUndefined();              // the undone one is back to how it was
    expect(dueInfo(a, d3.taskStates[a.id], TODAY).due).toBe(dueInfo(a, d0.taskStates[a.id], TODAY).due);
  });

  it('if the same task was touched again since, only the entry goes; the newer state is kept', () => {
    const d0 = demo('B');
    const a = firstDue(d0);
    const d1 = run(d0, { type: 'TASK_SKIP', task: a, stamp: at(`${TODAY}T09:00:00.000Z`), entryId: 's1' });
    const d2 = run(d1, { type: 'TASK_MOVE', task: a, to: '2026-10-09', stamp: at(`${TODAY}T09:30:00.000Z`), entryId: 'm1' });
    const d3 = reducer(d2, undoFor(d0, d1, a, 's1'));
    expect(entries(d3).map((e) => e.id)).toEqual(['m1']);
    expect(d3.taskStates[a.id].due).toBe('2026-10-09'); // the move still stands
  });

  it('undoing a skip restores the skip streak', () => {
    const d0 = demo('B');
    const a = firstDue(d0);
    const d1 = run(d0, { type: 'TASK_SKIP', task: a, stamp, entryId: 's1' });
    expect(d1.taskStates[a.id].skipStreak).toBe(1);
    const d2 = reducer(d1, undoFor(d0, d1, a, 's1'));
    expect(d2.taskStates[a.id]?.skipStreak ?? 0).toBe(0);
    expect(entries(d2)).toHaveLength(0);
  });

  it('unknown entries are ignored, and undo twice is harmless', () => {
    const d0 = demo('B');
    const a = firstDue(d0);
    const d1 = run(d0, { type: 'TASK_COMPLETE', task: a, stamp, via: 'checkoff', entryId: 'e1' });
    const u = undoFor(d0, d1, a, 'e1');
    expect(reducer(d1, { ...(u as Extract<Action, { type: 'UNDO' }>), entryId: 'nope' })).toBe(d1);
    const once = reducer(d1, u);
    expect(reducer(once, u)).toBe(once);
  });

  it('undoing "Just 5 minutes" also rewinds the recent list', () => {
    const d0 = demo('B');
    const five = { ...firstDue(d0), id: 'five:trash:kitchen-1' } as Task;
    const d1 = run(d0, { type: 'TASK_COMPLETE', task: five, stamp, via: 'five', entryId: 'f1' });
    expect(d1.fiveRecent[0]).toBe(five.id);
    const d2 = reducer(d1, { type: 'UNDO', entryId: 'f1', taskId: five.id, before: null, after: null, fiveBefore: d0.fiveRecent });
    expect(d2.fiveRecent).toEqual(d0.fiveRecent);
    expect(entries(d2)).toHaveLength(0);
  });

  it('"Reset my plan" undo restores plan dates only for tasks nothing has touched since', () => {
    const d0 = demo('B', { withHistory: true });
    const before = Object.fromEntries(Object.entries(d0.taskStates).map(([id, s]) => [id, { anchor: s.anchor, due: s.due, skipStreak: s.skipStreak }]));
    const reset = reducer(d0, { type: 'RESET_PLAN', stamp });
    const touched = todayPlan(view(reset)).focus[0].task;
    const after = reducer(reset, { type: 'TASK_COMPLETE', task: touched, stamp, via: 'checkoff', entryId: 'c1' });
    const undone = reducer(after, { type: 'UNDO_RESET_PLAN', plan: d0.plan, lastOpened: d0.lastOpened, before });
    expect(undone.plan).toEqual(d0.plan);
    expect(entries(undone).some((e) => e.id === 'c1')).toBe(true);         // newer work is not undone
    expect(undone.taskStates[touched.id].due).toBe(after.taskStates[touched.id].due);
  });
});

describe('replaying actions (multi-tab merge) never double-counts', () => {
  it('re-applying a log of explicit-id actions on a base that already has them changes nothing', () => {
    const d0 = demo('B');
    const [a, b] = todayPlan(view(d0)).focus.map((f) => f.task);
    const actions: Action[] = [
      { type: 'TASK_COMPLETE', task: a, stamp: at(`${TODAY}T09:00:00.000Z`), via: 'checkoff', entryId: 'ea' },
      { type: 'TASK_SKIP', task: b, stamp: at(`${TODAY}T09:10:00.000Z`), entryId: 'eb' },
    ];
    const once = run(d0, ...actions);
    const twice = run(once, ...actions);
    expect(entries(twice)).toHaveLength(entries(once).length);
    expect(twice.taskStates[b.id].skipTotal).toBe(once.taskStates[b.id].skipTotal);
  });

  it("two tabs completing different tasks both survive when one replays its actions on the other's data", () => {
    const base = demo('B');
    const [a, b] = todayPlan(view(base)).focus.map((f) => f.task);
    const tabA = run(base, { type: 'TASK_COMPLETE', task: a, stamp: at(`${TODAY}T09:00:00.000Z`), via: 'checkoff', entryId: 'ea' });
    // tab B was stale (base), did its own action, then adopts A's saved data and replays its unsaved action on top
    const pendingB: Action[] = [{ type: 'TASK_COMPLETE', task: b, stamp: at(`${TODAY}T09:02:00.000Z`), via: 'checkoff', entryId: 'eb' }];
    const merged = run(tabA, ...pendingB);
    expect(entries(merged).map((e) => e.id).sort()).toEqual(['ea', 'eb']);
  });
});

describe('timer attribution after a reload', () => {
  const lifeFive = (d: AppData): Task => ({ ...todayPlan(view(d)).life[0].task, id: 'five:l-breathe:home', templateId: 'five:l-breathe' } as Task);

  it('the timer carries its task, and it survives the JSON round-trip a reload performs', () => {
    const d = demo('E');
    const task = lifeFive(d);
    const t = JSON.parse(JSON.stringify(startTimer(task, 5, 1_000)));
    expect(t.task.domain).toBe(task.domain);
    // after a reload nothing else knows this task: not the session ref, not the plan
    const resolved = resolveTimerTask(t, null, undefined);
    expect(resolved.domain).toBe(task.domain);
    expect(resolved.category).toBe(task.category);
    const after = reducer(d, { type: 'TASK_COMPLETE', task: resolved, stamp, via: 'timer', entryId: 't1' });
    const e = entries(after).find((x) => x.id === 't1')!;
    expect(e.domain).toBe(task.domain);          // counted under its life area…
    expect(e.category).not.toBe('Cleaning');     // …not as housework
    expect(e.templateId).toBe(task.templateId);
  });

  it('prefers the live plan version of a planned task, and only falls back to a generic one for very old timers', () => {
    const d = demo('B');
    const task = firstDue(d);
    const t = startTimer({ ...task }, 10, 0);
    const live = { ...task, minutes: 99 };
    expect(resolveTimerTask(t, null, live).minutes).toBe(99);
    const legacy = { taskId: 'x', taskName: 'Old', roomName: 'Kitchen', totalSec: 600, status: 'running' as const, endsAt: 1, remainingSec: 600, startedAt: 0 };
    expect(resolveTimerTask(legacy, null, undefined).category).toBe('Cleaning');
  });
});

describe('demo data carries the v2 fields', () => {
  it('a fresh demo has an empty exposure log and a level clock that starts with the plan', () => {
    const d = appDataForDemo('E', { today: TODAY });
    expect(d.version).toBe(2);
    expect(d.exposures).toEqual([]);
    expect(d.preferences.levelSince).toBe(TODAY);
  });
});
