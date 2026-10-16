import { describe, expect, it } from 'vitest';
import { dayFacts, dayStatus, historyKnownFrom, isScheduledEntry, recordsBegin, summarizeWindow } from '../src/domain/behaviour';
import { addDays } from '../src/domain/dates';
import { buildExposure, EXCLUSION, hasNewExposure, MAX_LEFT_PER_DAY } from '../src/domain/exposure';
import { snapshotPlanVersion } from '../src/domain/planVersion';
import { pickJustFive } from '../src/domain/micro';
import { compactHistory } from '../src/domain/retention';
import { todayPlan } from '../src/domain/view';
import type { AppData, ExposureRecord, LeftOutItem, Task } from '../src/domain/types';
import { reducer } from '../src/state/reducer';
import { validateAppData } from '../src/storage/schema';
import { day, doIt, entriesOf, left, mk, open, seeAll, selectedIds, stampOn, viewAt, withEnergy } from './behaviourHelpers';
import { demo, TODAY } from './helpers';

describe('the planner\'s decision, what was seen, and what was left out are three different records', () => {
  it('selected tasks are recorded as selected, not as seen; nothing is seen until the Today screen says so', () => {
    const d = open(mk(['home', 'discipline'], { sessionMinutes: 30 }));
    const rec = d.exposures[0];
    expect(rec.contract).toBe(2);
    expect(rec.items.length).toBeGreaterThan(0);
    for (const i of rec.items) { expect(i.selectedAt).toBeTruthy(); expect(i.seenAt).toBeUndefined(); expect(i.kind).not.toBe('extra'); }
  });

  it('RECORD_SEEN marks only selected tasks, only the first time, and only on a contract 2 record', () => {
    const d0 = open(mk(['home', 'discipline'], { sessionMinutes: 30 }));
    const [a, b] = selectedIds(d0);
    const d1 = reducer(d0, { type: 'RECORD_SEEN', date: TODAY, ids: [a, 'not-a-task'], at: `${TODAY}T08:00:00.000Z` });
    const rec = d1.exposures[0];
    expect(rec.items.find((i) => i.taskId === a)!.seenAt).toBe(`${TODAY}T08:00:00.000Z`);
    expect(rec.items.find((i) => i.taskId === b)!.seenAt).toBeUndefined();
    expect(rec.items.some((i) => i.taskId === 'not-a-task')).toBe(false);
    // the second time changes nothing at all (same object back), and the first time is kept
    expect(reducer(d1, { type: 'RECORD_SEEN', date: TODAY, ids: [a], at: `${TODAY}T20:00:00.000Z` })).toBe(d1);
    // a date with no record is left alone
    expect(reducer(d1, { type: 'RECORD_SEEN', date: day(-3), ids: [a], at: `${day(-3)}T08:00:00.000Z` })).toBe(d1);
  });

  it('a left-out task is never an exposure: it has its own list, its own reason, and no seenAt until the list is opened', () => {
    const d = open(mk(['home', 'discipline', 'morning', 'evening'], { sessionMinutes: 10 }));
    const rec = d.exposures[0];
    expect(rec.left!.length).toBeGreaterThan(0);
    const selected = new Set(rec.items.map((i) => i.taskId));
    for (const x of rec.left!) {
      expect(selected.has(x.taskId), `${x.taskId} is both selected and left out`).toBe(false);
      expect(x.reason).toBe('not-enough-time');
      expect(x.seenAt).toBeUndefined();
      expect(x.at).toBeTruthy();
      expect(x.budget).toBe(10);
      expect(x.energy).toBe('ok');
    }
    // opening the left-out list marks revealed, and only revealed
    const id = rec.left![0].taskId;
    const d2 = reducer(d, { type: 'RECORD_SEEN', date: TODAY, ids: [], revealed: [id], at: `${TODAY}T09:00:00.000Z` });
    expect(d2.exposures[0].left!.find((x) => x.taskId === id)!.seenAt).toBeTruthy();
    expect(d2.exposures[0].items.every((i) => !i.seenAt)).toBe(true);
  });

  it('the reason is the one the planner had at that moment: not enough time, a low-energy day, or not a cleaning day', () => {
    const lowEnergy = open(withEnergy(mk(['home', 'active', 'discipline'], { sessionMinutes: 60, fitnessLevel: 'intermediate', lifeLevel: 2 }), 'low'));
    const tp = todayPlan(viewAt(withEnergy(mk(['home', 'active', 'discipline'], { sessionMinutes: 60, fitnessLevel: 'intermediate', lifeLevel: 2 }), 'low')));
    const byReason = new Map(tp.deferred.map((x) => [x.item.task.id, x.reason]));
    for (const x of left(lowEnergy)) expect(x.reason).toBe(EXCLUSION[byReason.get(x.taskId)!]);
    // rest day: home-only, three cleaning days a week and nothing done on the first: the overdue tasks wait on the rest day after it
    const base = mk(['home'], { sessionMinutes: 30, daysPerWeek: 3, style: 'several-short' });
    let found = false;
    for (let off = 0; off < 14 && !found; off++) {
      const date = day(off);
      const dd = open(base, date);
      if (left(dd, date).some((x) => x.reason === 'not-a-cleaning-day')) found = true;
    }
    expect(found, 'some rest day leaves a due task out for not being a cleaning day').toBe(true);
  });

  it('planner reasons and a person\'s decisions never share a word: the planner\'s exclusions are not outcomes', () => {
    const outcomes = ['completed', 'skipped', 'snoozed', 'moved', 'stopped'];
    for (const v of Object.values(EXCLUSION)) expect(outcomes).not.toContain(v);
    // and a person's skip never lands in `left`, nor does a left-out task gain an outcome
    let d = open(mk(['home', 'discipline'], { sessionMinutes: 30 }));
    const t = viewAt(d).byId.get(selectedIds(d)[0])!;
    d = doIt(d, 'TASK_SKIP', t);
    expect(left(d).some((x) => x.taskId === t.id)).toBe(false);
    expect(entriesOf(d)[0].outcome).toBe('skipped');
  });

  it('an energy change after the first record adds the new decisions as new records and keeps the old ones as they were', () => {
    const base = mk(['home', 'active', 'discipline'], { sessionMinutes: 60, fitnessLevel: 'intermediate', lifeLevel: 2 });
    let d = open(withEnergy(base, 'high', TODAY, 6), TODAY, 6);
    const before = JSON.stringify(d.exposures[0]);
    const firstItems = selectedIds(d).length;
    d = withEnergy(d, 'low', TODAY, 15);
    d = open(d, TODAY, 15);
    const rec = d.exposures[0];
    // what was recorded at 06:00 is untouched (items first, energy first), and the day's energy history shows the change
    expect(JSON.stringify(rec.items.slice(0, firstItems))).toBe(JSON.stringify(JSON.parse(before).items));
    expect(rec.energy).toBe('high');
    expect(rec.energyChanges).toEqual([{ at: `${TODAY}T15:00:00.000Z`, level: 'low' }]);
    // anything newly left out for low energy is recorded with the low energy it was decided under
    const lowLeft = rec.left!.filter((x) => x.reason === 'low-energy-day');
    for (const x of lowLeft) { expect(x.energy).toBe('low'); expect(x.at).toBe(`${TODAY}T15:00:00.000Z`); }
    // asking again changes nothing
    expect(open(d, TODAY, 16)).toBe(d);
  });

  it('re-rendering, StrictMode, a reload and a second tab record nothing twice', () => {
    const d0 = mk(['home', 'discipline'], { sessionMinutes: 30 });
    const once = open(d0);
    for (let i = 0; i < 5; i++) expect(open(once, TODAY, 8 + i)).toBe(once);
    // two tabs open at once each record the day; merged, it is one record with the first tab's facts
    const a = open(d0, TODAY, 7), b = open(d0, TODAY, 7);
    const mergedAB = reducer(a, { type: 'RECORD_EXPOSURE', record: buildExposure(viewAt(b), `${TODAY}T07:00:03.000Z`, 0) });
    expect(mergedAB).toBe(a);
    expect(a.exposures).toHaveLength(1);
    // seen from two tabs: the first time wins and the second is a no-op
    const id = selectedIds(a)[0];
    const s1 = reducer(a, { type: 'RECORD_SEEN', date: TODAY, ids: [id], at: `${TODAY}T07:01:00.000Z` });
    const s2 = reducer(s1, { type: 'RECORD_SEEN', date: TODAY, ids: [id], at: `${TODAY}T07:02:00.000Z` });
    expect(s2).toBe(s1);
    expect(s2.exposures[0].items.find((i) => i.taskId === id)!.seenAt).toBe(`${TODAY}T07:01:00.000Z`);
  });

  it('the number of left-out records for a day is bounded', () => {
    const d = open(mk(['home', 'discipline'], { sessionMinutes: 5 }));
    expect(left(d).length).toBeLessThanOrEqual(MAX_LEFT_PER_DAY);
  });
});

describe('every action can be linked to the occurrence and the decision it answers', () => {
  it('a completion carries the due date it answers, where it was done, and how it related to the day\'s decision', () => {
    let d = open(mk(['home', 'discipline'], { sessionMinutes: 30 }));
    const task = viewAt(d).byId.get(selectedIds(d)[0])!;
    d = doIt(d, 'TASK_COMPLETE', task, TODAY, 9, { surface: 'today' });
    const e = entriesOf(d)[0];
    expect(e.planned).toBe('selected');
    expect(e.surface).toBe('today');
    expect(e.fromDue).toBe(TODAY);
    expect(e.taskId).toBe(task.id);
  });

  it('an overdue task done later records the day it was due, not the day it was done', () => {
    let d = mk(['home'], { sessionMinutes: 60 });
    // find a task due a few days ago that has not been done
    const v = viewAt(d, day(-6));
    const past = todayPlan(v).focus.find((f) => !f.task.habit)!;
    d = open(d, TODAY);
    const overdue = todayPlan(viewAt(d)).catchUp[0];
    if (overdue) {
      const dd = doIt(d, 'TASK_COMPLETE', overdue.task, TODAY);
      expect(entriesOf(dd)[0].fromDue! < TODAY).toBe(true);
      expect(entriesOf(dd)[0].fromDue).toBe(overdue.due);
    }
    expect(past).toBeTruthy();
  });

  it('a task the planner left out, and one it never considered, are told apart from a selected one', () => {
    let d = open(mk(['home', 'discipline', 'morning', 'evening'], { sessionMinutes: 10 }));
    const rec = d.exposures[0];
    const leftTask = viewAt(d).byId.get(rec.left![0].taskId)!;
    d = doIt(d, 'TASK_COMPLETE', leftTask, TODAY, 9, { surface: 'timebox' }, 'x1');
    expect(entriesOf(d).find((e) => e.id === 'x1')!.planned).toBe('left-out');
    // Just 5 minutes is never on the day's list
    const five = pickJustFive(d, [], TODAY)!;
    d = reducer(d, { type: 'TASK_COMPLETE', task: five, stamp: stampOn(TODAY, 10), via: 'five', entryId: 'x2', surface: 'five' });
    const e2 = entriesOf(d).find((e) => e.id === 'x2')!;
    expect(e2.planned).toBe('not-planned');
    expect(e2.fromDue).toBeNull();
    expect(e2.surface).toBe('five');
    expect(isScheduledEntry(e2)).toBe(false);
  });

  it('with no contract 2 record for the day the relation is unknown, never guessed', () => {
    const d0 = mk(['home', 'discipline'], { sessionMinutes: 30 });
    const task = viewAt(d0).tasks[0];
    const d = doIt(d0, 'TASK_COMPLETE', task);
    expect(entriesOf(d)[0].planned).toBeUndefined();
    // and a record from before contract 2 does not count as a decision either
    const legacy = { ...d0, exposures: [{ date: TODAY, recordedAt: `${TODAY}T06:00:00.000Z`, planVersion: 'p', activeDay: true, energy: 'ok' as const, tzOffsetMin: 0, budgetMinutes: 30, items: [{ taskId: task.id, templateId: null, domain: 'home' as const, minutes: 5, difficulty: 1 as const, kind: 'focus' as const }] }] };
    expect(entriesOf(doIt(legacy, 'TASK_COMPLETE', task))[0].planned).toBeUndefined();
  });

  it('split task parts are separate occurrences with their own ids, and each says which part it is', () => {
    let d = mk(['home'], { sessionMinutes: 10 });
    const v = viewAt(d);
    const parts = v.tasks.filter((t) => t.part && t.part.index <= 2 && t.templateId === v.tasks.find((x) => x.part)!.templateId && t.roomId === v.tasks.find((x) => x.part)!.roomId);
    expect(parts.length).toBeGreaterThanOrEqual(2);
    expect(new Set(parts.map((p) => p.id)).size).toBe(parts.length);
    d = doIt(d, 'TASK_COMPLETE', parts[0], day(-2), 9, {}, 'p1');
    d = doIt(d, 'TASK_COMPLETE', parts[1], day(-1), 9, {}, 'p2');
    const es = entriesOf(d);
    expect(es.map((e) => e.part)).toEqual([{ index: parts[0].part!.index, of: parts[0].part!.of }, { index: parts[1].part!.index, of: parts[1].part!.of }]);
    expect(new Set(es.map((e) => e.templateId)).size).toBe(1);
    expect(new Set(es.map((e) => e.taskId)).size).toBe(2);
  });

  it('the same completion sent twice (a double tap, a replay after a tab merge) is one entry', () => {
    let d = open(mk(['home', 'discipline'], { sessionMinutes: 30 }));
    const task = viewAt(d).byId.get(selectedIds(d)[0])!;
    d = doIt(d, 'TASK_COMPLETE', task, TODAY, 9, {}, 'same');
    const again = doIt(d, 'TASK_COMPLETE', task, TODAY, 9, {}, 'same');
    expect(again).toBe(d);
    expect(entriesOf(d)).toHaveLength(1);
  });
});

describe('what the app can and cannot say about a day', () => {
  const recordOn = (d: AppData, date: string) => open(d, date);

  it('a day with a decision record is opened; a day with only entries was acted in; a gap between records is not opened', () => {
    let d = mk(['home', 'discipline'], { sessionMinutes: 30 });
    d = recordOn(d, day(-6));
    d = recordOn(d, day(-1));
    d = doIt(d, 'TASK_COMPLETE', viewAt(d, day(-3)).tasks[0], day(-3));
    expect(dayStatus(d, day(-6), TODAY)).toEqual({ kind: 'opened' });
    expect(dayStatus(d, day(-5), TODAY)).toEqual({ kind: 'not-opened' });
    expect(dayStatus(d, day(-4), TODAY)).toEqual({ kind: 'not-opened' });
    expect(dayStatus(d, day(-3), TODAY)).toEqual({ kind: 'acted' });
    expect(dayStatus(d, day(-2), TODAY)).toEqual({ kind: 'not-opened' });
    expect(dayStatus(d, day(-1), TODAY)).toEqual({ kind: 'opened' });
  });

  it('before records began, a day is unknown (never "not opened"); so is a day recorded under the old contract', () => {
    let d = mk(['home', 'discipline'], { sessionMinutes: 30 });
    d = recordOn(d, day(-2));
    expect(dayStatus(d, day(-10), TODAY)).toEqual({ kind: 'unknown', why: 'before-records' });
    expect(recordsBegin(d)).toBe(day(-2));
    const old = { ...d, exposures: [{ ...d.exposures[0], contract: undefined, date: day(-8) } as ExposureRecord, ...d.exposures] };
    expect(dayStatus(old, day(-8), TODAY)).toEqual({ kind: 'unknown', why: 'older-record' });
    // before the plan began there is nothing to open
    expect(dayStatus(d, day(-60), TODAY)).toEqual({ kind: 'unknown', why: 'no-plan' });
  });

  it('a brand-new user with no history has nothing but unknowns', () => {
    const d = mk(['home', 'discipline'], { sessionMinutes: 30 }, 0);
    expect(recordsBegin(d)).toBeNull();
    const s = summarizeWindow(d, day(-6), TODAY);
    expect(s.days).toEqual({ opened: 0, acted: 0, notOpened: 0, unknown: 7 });
    expect(s.selected).toBe(0);
    expect(s.completed + s.skipped + s.snoozed + s.moved + s.stopped + s.seenNoAction).toBe(0);
  });

  it('a seen task with no entry is "seen, no recorded action": it is not a skip, a failure, or a lack of motivation', () => {
    let d = open(mk(['home', 'discipline'], { sessionMinutes: 30 }), day(-1));
    d = seeAll(d, day(-1));
    const f = dayFacts(d, day(-1), TODAY);
    expect(f.selected.length).toBeGreaterThan(0);
    for (const x of f.selected) { expect(x.seen).toBe(true); expect(x.action).toBe('none-recorded'); }
    const s = summarizeWindow(d, day(-1), TODAY);
    expect(s.skipped).toBe(0);
    expect(s.snoozed).toBe(0);
    expect(s.seenNoAction).toBe(f.selected.length);
    // and today is not over, so today's unacted tasks are not counted as "no action" yet
    const today = summarizeWindow(seeAll(open(mk(['home', 'discipline'], { sessionMinutes: 30 })), TODAY), TODAY, TODAY);
    expect(today.seenNoAction).toBe(0);
  });

  it('a task that was selected but never shown is "not seen", which is different from seen-and-unacted', () => {
    const d = open(mk(['home', 'discipline'], { sessionMinutes: 30 }), day(-1));
    const f = dayFacts(d, day(-1), TODAY);
    expect(f.selected.every((x) => x.seen === false)).toBe(true);
    const s = summarizeWindow(d, day(-1), TODAY);
    expect(s.notSeen).toBe(f.selected.length);
    expect(s.seenNoAction).toBe(0);
  });

  it('explicit skips, snoozes and completions are counted from what the person did, apart from each other', () => {
    let d = open(mk(['home', 'discipline'], { sessionMinutes: 60 }), day(-1));
    d = seeAll(d, day(-1));
    const ts = selectedIds(d, day(-1)).slice(0, 3).map((id) => viewAt(d, day(-1)).byId.get(id)!);
    d = doIt(d, 'TASK_COMPLETE', ts[0], day(-1));
    d = doIt(d, 'TASK_SKIP', ts[1], day(-1));
    d = doIt(d, 'TASK_SNOOZE', ts[2], day(-1));
    const s = summarizeWindow(d, day(-1), TODAY);
    expect([s.completed, s.skipped, s.snoozed]).toEqual([1, 1, 1]);
  });

  it('records from before contract 2 keep their unknowns: display unknown, left-out reason unknown', () => {
    const d0 = mk(['home', 'discipline'], { sessionMinutes: 30 });
    const task = viewAt(d0).tasks[0];
    const legacy: AppData = { ...d0, exposures: [{ date: day(-1), recordedAt: `${day(-1)}T06:00:00.000Z`, planVersion: 'p', activeDay: true, energy: 'ok', tzOffsetMin: 0, budgetMinutes: 30, items: [
      { taskId: task.id, templateId: null, domain: 'home', minutes: 5, difficulty: 1, kind: 'focus', shownAt: `${day(-1)}T06:00:00.000Z` },
      { taskId: 'hidden-one', templateId: null, domain: 'home', minutes: 5, difficulty: 1, kind: 'extra', shownAt: `${day(-1)}T06:00:00.000Z` }] }] };
    const f = dayFacts(legacy, day(-1), TODAY);
    expect(f.status).toEqual({ kind: 'unknown', why: 'older-record' });
    expect(f.selected[0].seen).toBe('unknown');
    expect(f.leftOut[0]).toMatchObject({ taskId: 'hidden-one', reason: 'unknown', revealed: 'unknown' });
    const s = summarizeWindow(legacy, day(-1), TODAY);
    expect(s.seenUnknown).toBe(1);
    expect(s.seen + s.notSeen).toBe(0);
    expect(s.leftOut.unknown).toBe(1);
    // today's old-style record is left exactly as it is: contract 2 facts are never mixed into it
    const todayLegacy: AppData = { ...legacy, exposures: [{ ...legacy.exposures[0], date: TODAY }] };
    expect(hasNewExposure(viewAt(todayLegacy), buildExposure(viewAt(todayLegacy), `${TODAY}T07:00:00.000Z`, 0))).toBe(false);
    expect(open(todayLegacy)).toBe(todayLegacy);
  });

  it('history removed to save space is unknown, not "no activity", and the summary says it is partial', () => {
    let d = mk(['home', 'discipline'], { sessionMinutes: 30 });
    for (let i = -10; i <= -1; i++) { d = open(d, day(i)); d = doIt(d, 'TASK_COMPLETE', viewAt(d, day(i)).byId.get(selectedIds(d, day(i))[0])!, day(i)); }
    const trimmed: AppData = { ...d, retention: [{ at: `${TODAY}T00:00:00.000Z`, removedSessions: 3, removedEntries: 3, removedThrough: day(-8), oldestKept: day(-7) }] };
    const kept = { ...trimmed, sessions: trimmed.sessions.filter((s) => s.date >= day(-7)) };
    expect(historyKnownFrom(kept)).toBe(day(-7));
    const f = dayFacts(kept, day(-9), TODAY);
    expect(f.actionsKnown).toBe(false);
    expect(f.selected.every((x) => x.action === 'none-recorded')).toBe(true); // it says nothing was recorded, not that nothing happened
    expect(dayStatus({ ...kept, exposures: [] }, day(-9), TODAY)).toEqual({ kind: 'unknown', why: 'history-trimmed' });
    expect(summarizeWindow(kept, day(-10), TODAY).partial).toBe(true);
    expect(summarizeWindow(kept, day(-6), TODAY).partial).toBe(false);
  });

  it('a real compaction leaves a note that behaviour.ts reads', () => {
    const base = demo('G', { withHistory: true });
    const first = base.sessions.flatMap((s) => s.entries)[0];
    const big: AppData = { ...base, sessions: Array.from({ length: 4000 }, (_, i) => { const date = addDays('2016-01-01', i); const e = { ...first, id: `c${i}`, date, at: `${date}T09:00:00.000Z` }; return { id: `s${i}`, date, startedAt: e.at, endedAt: e.at, entries: [e] }; }) };
    const c = compactHistory(big, 300_000).data;
    expect(c.retention).toHaveLength(1);
    expect(historyKnownFrom(c)).toBe(addDays(c.retention[0].removedThrough, 1));
  });
});

describe('storage compatibility: older data is read as it is, and the new records round-trip exactly', () => {
  it('a contract 2 record survives save and load unchanged, including seen, left-out and energy history', () => {
    let d = open(withEnergy(mk(['home', 'discipline', 'morning', 'evening'], { sessionMinutes: 10 }), 'ok', TODAY, 6), TODAY, 6);
    d = seeAll(d);
    d = withEnergy(d, 'low', TODAY, 15);
    const back = validateAppData(JSON.parse(JSON.stringify(d)))!;
    expect(back.repairs).toEqual([]);
    expect(back.data.exposures).toEqual(d.exposures);
    expect(back.data.exposures[0].left!.length).toBeGreaterThan(0);
  });

  it('entries keep their surface, relation, occurrence and part through save and load', () => {
    let d = open(mk(['home'], { sessionMinutes: 10 }));
    const part = viewAt(d).tasks.find((t) => t.part)!;
    d = doIt(d, 'TASK_COMPLETE', part, TODAY, 9, { surface: 'plan' }, 'rt1');
    const back = validateAppData(JSON.parse(JSON.stringify(d)))!.data;
    expect(entriesOf(back).find((e) => e.id === 'rt1')).toEqual(entriesOf(d).find((e) => e.id === 'rt1'));
    expect(entriesOf(back)[0].part).toEqual({ index: part.part!.index, of: part.part!.of });
  });

  it('a record from before contract 2 comes back exactly as it was: no contract, no left-out list, no invented seen', () => {
    const d0 = demo('E');
    const old = { ...JSON.parse(JSON.stringify(d0)), exposures: [{ date: day(-2), recordedAt: `${day(-2)}T06:00:00.000Z`, planVersion: 'p1', activeDay: true, energy: 'ok', tzOffsetMin: -120, budgetMinutes: 30, items: [{ taskId: 'a', templateId: 'x', domain: 'home', minutes: 5, difficulty: 1, kind: 'extra', shownAt: `${day(-2)}T06:00:00.000Z`, energy: 'ok' }] }] };
    const back = validateAppData(old)!.data.exposures[0];
    expect(back.contract).toBeUndefined();
    expect(back.left).toBeUndefined();
    expect(back.items[0]).toMatchObject({ kind: 'extra', shownAt: `${day(-2)}T06:00:00.000Z` });
    expect(back.items[0].seenAt).toBeUndefined();
    expect(back.items[0].selectedAt).toBeUndefined();
  });

  it('a left-out entry with no reason is dropped rather than given one, and junk values are repaired', () => {
    let d = open(mk(['home', 'discipline', 'morning', 'evening'], { sessionMinutes: 10 }));
    const raw = JSON.parse(JSON.stringify(d));
    raw.exposures[0].left[0].reason = 'because-you-are-lazy';
    raw.exposures[0].left[1].energy = 'purple';
    const n = raw.exposures[0].left.length;
    const back = validateAppData(raw)!.data.exposures[0];
    expect(back.left!.length).toBe(n - 2);
    expect(back.left!.every((x) => ['not-enough-time', 'low-energy-day', 'not-a-cleaning-day'].includes(x.reason))).toBe(true);
    d = d; // (the original is untouched)
  });

  it('arbitrary unknown fields are NOT carried through (the validator rebuilds every record); this is the existing behaviour, pinned here', () => {
    const d = open(mk(['home', 'discipline'], { sessionMinutes: 30 }));
    const raw = JSON.parse(JSON.stringify(d));
    raw.exposures[0].mystery = 1; raw.exposures[0].items[0].mystery = 2; raw.futureField = { a: 1 };
    const back = validateAppData(raw)!.data as unknown as Record<string, unknown>;
    expect('futureField' in back).toBe(false);
    expect('mystery' in (back.exposures as object[])[0]).toBe(false);
  });

  it('plan versions record the goals the plan could not serve and why, and older versions simply lack it', () => {
    const d = mk(['home', 'active', 'study', 'phone', 'discipline', 'focus'], { sessionMinutes: 5 });
    const snap = reducer(d, { type: 'RECORD_PLAN_VERSION', version: { id: 'p-now', at: `${TODAY}T00:00:00.000Z`, focus: d.preferences.focus, lifeLevel: 1, fitnessLevel: 'beginner', sessionMinutes: 5, daysPerWeek: 7, deferredGoals: [{ goal: 'study', reason: 'budget', needMinutes: 5 }] } });
    const back = validateAppData(JSON.parse(JSON.stringify(snap)))!.data.planVersions;
    expect(back[0].deferredGoals).toEqual([{ goal: 'study', reason: 'budget', needMinutes: 5 }]);
    const old = JSON.parse(JSON.stringify(snap)); delete old.planVersions[0].deferredGoals;
    expect(validateAppData(old)!.data.planVersions[0].deferredGoals).toBeUndefined();
  });
});

describe('guards that the first set of tests did not reach (found by mutation checks)', () => {
  const legacyDay = (d: AppData, taskId: string): AppData => ({
    ...d, exposures: [{ date: TODAY, recordedAt: `${TODAY}T06:00:00.000Z`, planVersion: 'p', activeDay: true, energy: 'ok' as const, tzOffsetMin: 0, budgetMinutes: 30, items: [{ taskId, templateId: null, domain: 'home' as const, minutes: 5, difficulty: 1 as const, kind: 'focus' as const, shownAt: `${TODAY}T06:00:00.000Z` }] }],
  });

  it('REGRESSION: "seen" is never filled in for a day recorded before display tracking', () => {
    const d0 = mk(['home', 'discipline'], { sessionMinutes: 30 });
    const id = viewAt(d0).tasks[0].id;
    const legacy = legacyDay(d0, id);
    const after = reducer(legacy, { type: 'RECORD_SEEN', date: TODAY, ids: [id], at: `${TODAY}T08:00:00.000Z` });
    expect(after).toBe(legacy);                                   // the very same object: nothing was written
    expect(after.exposures[0].items[0].seenAt).toBeUndefined();
    expect(dayFacts(after, TODAY, TODAY).selected[0].seen).toBe('unknown');
  });

  it('REGRESSION: a contract 2 record dispatched onto a same-day legacy record leaves it exactly as it was', () => {
    const d0 = mk(['home', 'discipline'], { sessionMinutes: 30 });
    const id = viewAt(d0).tasks[0].id;
    const legacy = legacyDay(d0, id);
    const rec = buildExposure(viewAt(legacy), `${TODAY}T09:00:00.000Z`, 0);
    expect(rec.items.length).toBeGreaterThan(0);
    const after = reducer(legacy, { type: 'RECORD_EXPOSURE', record: rec });
    expect(after).toBe(legacy);
    expect(after.exposures[0].contract).toBeUndefined();
    expect(after.exposures[0].left).toBeUndefined();
  });

  const leftOne = (taskId: string, reason: LeftOutItem['reason'], at: string): LeftOutItem => ({ taskId, templateId: null, domain: 'home', minutes: 5, difficulty: 1, reason, at, energy: 'ok', budget: 30 });
  const base = (_d: AppData, left: LeftOutItem[]): ExposureRecord => ({ date: TODAY, contract: 2, recordedAt: `${TODAY}T07:00:00.000Z`, planVersion: 'p', activeDay: true, energy: 'ok', tzOffsetMin: 0, budgetMinutes: 30, items: [], left });

  it('the same task left out for a NEW reason is a new decision and is recorded beside the first; the same reason again is not', () => {
    const d0 = mk(['home'], { sessionMinutes: 30 });
    let d = reducer(d0, { type: 'RECORD_EXPOSURE', record: base(d0, [leftOne('t1', 'not-enough-time', `${TODAY}T07:00:00.000Z`)]) });
    d = reducer(d, { type: 'RECORD_EXPOSURE', record: base(d0, [leftOne('t1', 'low-energy-day', `${TODAY}T15:00:00.000Z`)]) });
    expect(d.exposures[0].left!.map((x) => `${x.taskId}|${x.reason}`)).toEqual(['t1|not-enough-time', 't1|low-energy-day']);
    const again = reducer(d, { type: 'RECORD_EXPOSURE', record: base(d0, [leftOne('t1', 'low-energy-day', `${TODAY}T16:00:00.000Z`)]) });
    expect(again).toBe(d);
  });

  it('hasNewExposure agrees: a task left out for a different reason than the one on record is news, the same reason is not', () => {
    const d0 = mk(['home'], { sessionMinutes: 30 });
    const cur = base(d0, [leftOne('t1', 'not-enough-time', `${TODAY}T07:00:00.000Z`)]);
    const v = viewAt({ ...d0, exposures: [cur] });
    expect(hasNewExposure(v, base(d0, [leftOne('t1', 'low-energy-day', `${TODAY}T15:00:00.000Z`)]))).toBe(true);
    expect(hasNewExposure(v, base(d0, [leftOne('t1', 'not-enough-time', `${TODAY}T15:00:00.000Z`)]))).toBe(false);
  });

  it('a runaway cannot grow a day\'s left-out list past the limit, however many records arrive', () => {
    const d0 = mk(['home'], { sessionMinutes: 30 });
    let d = d0;
    for (let batch = 0; batch < 5; batch++) {
      const items = Array.from({ length: 30 }, (_, i) => leftOne(`x${batch}-${i}`, 'not-enough-time', `${TODAY}T07:00:00.000Z`));
      d = reducer(d, { type: 'RECORD_EXPOSURE', record: base(d0, items) });
    }
    expect(d.exposures[0].left!.length).toBe(MAX_LEFT_PER_DAY);
    // and once full, a further record is a no-op (so it cannot cause a write)
    const full = d;
    expect(reducer(full, { type: 'RECORD_EXPOSURE', record: base(d0, [leftOne('late', 'not-enough-time', `${TODAY}T08:00:00.000Z`)]) })).toBe(full);
  });

  it('a plan version snapshot written by the app records the goals the plan could not serve, with the reason', () => {
    const d = mk(['home', 'active', 'study', 'phone', 'discipline', 'focus'], { sessionMinutes: 5 });
    const v = snapshotPlanVersion(d, `${TODAY}T00:00:00.000Z`);
    expect(v.deferredGoals && v.deferredGoals.length).toBeGreaterThan(0);
    for (const g of v.deferredGoals!) expect(['budget', 'cap', 'safety', 'context', 'none']).toContain(g.reason);
    const roomy = snapshotPlanVersion(mk(['home', 'discipline'], { sessionMinutes: 90 }), `${TODAY}T00:00:00.000Z`);
    expect(roomy.deferredGoals).toEqual([]);                        // nothing deferred is an empty list, not a missing one
  });

  it('history removed in two rounds is known from the day after the NEWEST removal', () => {
    const d = mk(['home'], { sessionMinutes: 30 });
    const note = (through: number) => ({ at: `${TODAY}T00:00:00.000Z`, removedSessions: 1, removedEntries: 1, removedThrough: day(through), oldestKept: day(through + 1) });
    expect(historyKnownFrom({ ...d, retention: [note(-40), note(-10)] })).toBe(day(-9));
    expect(historyKnownFrom({ ...d, retention: [note(-10), note(-40)] })).toBe(day(-9));
  });

  it('an ephemeral task has no occurrence to answer, even if it somehow carries a schedule', () => {
    let d = open(mk(['home', 'discipline'], { sessionMinutes: 30 }));
    const five = pickJustFive(d, [], TODAY)!;
    const scheduled = { ...five, startDate: TODAY, cadence: { kind: 'every', every: 1 } } as unknown as Task;
    d = reducer(d, { type: 'TASK_COMPLETE', task: scheduled, stamp: stampOn(TODAY, 10), via: 'five', entryId: 'eph', surface: 'five' });
    expect(entriesOf(d).find((e) => e.id === 'eph')!.fromDue).toBeNull();
  });
});
