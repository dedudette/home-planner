import { describe, expect, it } from 'vitest';
import { historyKnownFrom } from '../src/domain/behaviour';
import { computePatterns, evidenceFor, PATTERN_RULES, PATTERN_WINDOWS } from '../src/domain/patterns';
import type { AppData } from '../src/domain/types';
import { day, doIt, entriesOf, mk, open, seeAll } from './behaviourHelpers';
import { asLegacy, lived, range, reducer } from './coachHelpers';
import { TODAY } from './helpers';

const P = (d: AppData, w: 7 | 14 | 28 = 14) => computePatterns(d, TODAY, w);

/** An independent count straight from the stored records, so the tests do not just ask the code under test for its own answer. */
const oracle = (d: AppData, from: string, to: string) => {
  let seen = 0, completed = 0, skipped = 0, snoozed = 0, noAction = 0, pending = 0, notShown = 0, left = 0;
  for (const e of d.exposures) {
    if (e.contract !== 2 || e.date < from || e.date > to) continue;
    for (const i of e.items) {
      if (!i.seenAt) { notShown++; continue; }
      seen++;
      const es = entriesOf(d).filter((x) => x.date === e.date && x.taskId === i.taskId);
      const last = es[es.length - 1];
      if (last?.outcome === 'completed') completed++;
      else if (last?.outcome === 'skipped') skipped++;
      else if (last?.outcome === 'snoozed') snoozed++;
      else if (!last) { if (e.date === to) pending++; else noAction++; }
    }
    left += (e.left ?? []).length;
  }
  return { seen, completed, skipped, snoozed, noAction, pending, notShown, left };
};

describe('a new user, and too little history', () => {
  it('has no known days and nothing to read: every window is "not enough recorded yet"', () => {
    const d = mk(['home', 'discipline'], { sessionMinutes: 30 }, 0);
    for (const w of PATTERN_WINDOWS) {
      const p = P(d, w);
      expect(p.evidence.sufficient).toBe(false);
      expect(p.evidence.strength).toBeNull();
      expect(p.evidence.missing).toEqual(['opened-days', 'seen-tasks']);
      expect(p.days.opened).toBe(0);
      expect(p.seen.tasks).toBe(0);
      expect(p.days.list).toHaveLength(w);
      expect(p.days.opened + p.days.acted + p.days.notOpened + p.days.unknown).toBe(w);
    }
  });

  it('two opened days is still not enough, however much was shown; three days with five tasks is', () => {
    const two = lived([-1, 0]);
    expect(P(two).days.opened).toBe(2);
    expect(P(two).evidence.sufficient).toBe(false);
    expect(P(two).evidence.missing).toContain('opened-days');
    const three = lived([-2, -1, 0]);
    expect(P(three).days.opened).toBe(3);
    expect(P(three).seen.tasks).toBeGreaterThanOrEqual(PATTERN_RULES.minSeenTasks);
    expect(P(three).evidence).toMatchObject({ sufficient: true, strength: 'limited' });
  });

  it('days before the app began recording are unknown, never "not opened"', () => {
    const d = lived([-2, -1, 0]);
    const p = P(d, 14);
    const before = p.days.list.filter((x) => x.date < day(-2));
    expect(before.length).toBe(11);
    expect(before.every((x) => x.status === 'unknown' && x.why === 'before-records')).toBe(true);
    expect(p.days.notOpened).toBe(0);
  });

  it('the evidence rule is one function: thresholds and strength', () => {
    const R = PATTERN_RULES;
    expect(evidenceFor(R.minOpenedDays - 1, 100).sufficient).toBe(false);
    expect(evidenceFor(30, R.minSeenTasks - 1).sufficient).toBe(false);
    expect(evidenceFor(R.minOpenedDays, R.minSeenTasks).strength).toBe('limited');
    expect(evidenceFor(R.moderateOpenedDays, R.moderateSeenTasks).strength).toBe('moderate');
    expect(evidenceFor(R.goodOpenedDays, R.goodSeenTasks).strength).toBe('good');
    expect(evidenceFor(R.goodOpenedDays, R.moderateSeenTasks).strength).toBe('moderate');   // both must be met
  });
});

describe('what was shown, done, and not recorded', () => {
  it('counts match an independent count from the stored records, in every window', () => {
    const d = lived(range(-20, 0), { doneEach: 2, skipEach: 1 });
    for (const w of PATTERN_WINDOWS) {
      const p = P(d, w);
      const o = oracle(d, day(-(w - 1)), TODAY);
      expect(p.seen).toMatchObject({ tasks: o.seen, completed: o.completed, skipped: o.skipped, snoozed: o.snoozed, noAction: o.noAction, pendingToday: o.pending });
      expect(p.notShown).toBe(o.notShown);
      expect(p.days.opened).toBe(Math.min(w, 21));              // 21 days of real records exist, whatever the window
    }
  });

  it('a window only counts its own days', () => {
    const d = lived(range(-20, 0), { doneEach: 1 });
    expect(P(d, 7).seen.tasks).toBeLessThan(P(d, 14).seen.tasks);
    expect(P(d, 14).seen.tasks).toBeLessThan(P(d, 28).seen.tasks);
    expect(P(d, 7).from).toBe(day(-6));
    expect(P(d, 28).from).toBe(day(-27));
  });

  it('REGRESSION: shown with nothing logged is "no recorded action", never a skip', () => {
    const d = lived(range(-6, 0));                                    // opens daily, sees everything, does nothing at all
    const p = P(d, 7);
    expect(p.seen.tasks).toBeGreaterThan(0);
    expect(p.seen.skipped).toBe(0);
    expect(p.seen.snoozed).toBe(0);
    expect(p.seen.completed).toBe(0);
    expect(p.seen.noAction).toBeGreaterThan(0);
    expect(entriesOf(d)).toHaveLength(0);
    expect(p.seen.noAction + p.seen.pendingToday).toBe(p.seen.tasks);
  });

  it('an explicit skip is counted as a skip, apart from no recorded action', () => {
    const d = lived(range(-6, 0), { skipEach: 1 });
    const p = P(d, 7);
    expect(p.seen.skipped).toBe(entriesOf(d).filter((e) => e.outcome === 'skipped' && e.date >= day(-6)).length);
    expect(p.seen.skipped).toBeGreaterThan(0);
    expect(p.seen.noAction).toBeGreaterThan(0);
  });

  it("today is not over: what was shown today with nothing logged yet is pending, not 'no recorded action'", () => {
    let d = mk(['home', 'discipline'], { sessionMinutes: 45 });
    d = seeAll(open(d, TODAY, 7), TODAY, 7);
    const p = P(d, 7);
    expect(p.seen.tasks).toBeGreaterThan(0);
    expect(p.seen.noAction).toBe(0);
    expect(p.seen.pendingToday).toBe(p.seen.tasks);
  });

  it('a task selected but never put on screen is "not shown": it is not counted as shown or as ignored', () => {
    let d = mk(['home', 'discipline'], { sessionMinutes: 45 });
    d = open(d, day(-1), 7);                                           // recorded, nothing marked seen (opened on Settings, say)
    const p = P(d, 7);
    expect(p.seen.tasks).toBe(0);
    expect(p.notShown).toBe(d.exposures[0].items.length);
    expect(p.seen.noAction).toBe(0);
  });

  it('areas add up to the whole', () => {
    const d = lived(range(-9, 0), { doneEach: 2, focus: ['home', 'discipline', 'morning', 'evening'] });
    const p = P(d, 14);
    expect(p.areas.home.seen + p.areas.habits.seen).toBe(p.seen.tasks);
    expect(p.areas.home.completed + p.areas.habits.completed).toBe(p.seen.completed);
    expect(p.areas.home.noAction + p.areas.habits.noAction).toBe(p.seen.noAction);
  });
});

describe('tasks the planner left out are never counted as shown', () => {
  it('too little time: they are listed under their reason, and the shown count does not move', () => {
    const d = lived(range(-5, 0), { minutes: 10, focus: ['home', 'discipline', 'morning', 'evening'] });
    const p = P(d, 7);
    expect(p.leftOut.notEnoughTime).toBeGreaterThan(0);
    const ids = new Set(d.exposures.flatMap((e) => e.items.map((i) => `${e.date}|${i.taskId}`)));
    for (const e of d.exposures) for (const x of e.left ?? []) expect(ids.has(`${e.date}|${x.taskId}`)).toBe(false);
    expect(p.seen.tasks).toBe(d.exposures.reduce((n, e) => n + e.items.filter((i) => i.seenAt).length, 0));
  });

  it('opening the left-out list marks them revealed, not shown: counts for shown tasks are unchanged', () => {
    const before = lived(range(-5, 0), { minutes: 10, focus: ['home', 'discipline', 'morning', 'evening'] });
    const rec = before.exposures[before.exposures.length - 1];
    const after = reducer(before, { type: 'RECORD_SEEN', date: rec.date, ids: [], revealed: (rec.left ?? []).map((x) => x.taskId), at: `${rec.date}T12:00:00.000Z` });
    expect(after.exposures.some((e) => (e.left ?? []).some((x) => x.seenAt))).toBe(true);
    expect(P(after, 7).seen).toEqual(P(before, 7).seen);
    expect(P(after, 7).leftOut).toEqual(P(before, 7).leftOut);
  });

  it('a task left out and never acted on is not "no recorded action" either', () => {
    const d = lived(range(-5, 0), { minutes: 10, focus: ['home', 'discipline', 'morning', 'evening'] });
    const p = P(d, 7);
    expect(p.leftOut.notEnoughTime + p.leftOut.lowEnergyDay + p.leftOut.notACleaningDay).toBeGreaterThan(0);
    expect(p.seen.noAction).toBe(oracle(d, day(-6), TODAY).noAction);
  });

  it('low-energy days show the planner\'s own reason', () => {
    const d = lived(range(-5, 0), { energy: { [-3]: 'low', [-2]: 'low' }, focus: ['home', 'active', 'discipline'], minutes: 60 });
    const p = P(d, 7);
    expect(p.leftOut.lowEnergyDay).toBeGreaterThanOrEqual(0);
    expect(p.leftOut.lowEnergyDay).toBe(d.exposures.flatMap((e) => e.left ?? []).filter((x) => x.reason === 'low-energy-day').length);
  });
});

describe('older records and unknown days', () => {
  it('a day recorded before display tracking is unknown: its tasks are not counted as shown or not shown', () => {
    let d = lived(range(-6, 0), { doneEach: 1 });
    const keptSeen = P(d, 7).seen.tasks;
    const legacyItems = d.exposures.find((e) => e.date === day(-3))!.items.filter((i) => i.seenAt).length;
    d = asLegacy(d, day(-3));
    const p = P(d, 7);
    expect(p.displayUnknown).toBeGreaterThan(0);
    expect(p.seen.tasks).toBe(keptSeen - legacyItems);                // they leave the shown count, and are not turned into "not shown"
    expect(p.notShown).toBe(P(lived(range(-6, 0), { doneEach: 1 }), 7).notShown);
    const status = p.days.list.find((x) => x.date === day(-3))!.status;
    expect(['acted', 'unknown']).toContain(status);
  });

  it('REGRESSION: legacy days are never turned into "seen", "skipped" or "no action" to fill a gap', () => {
    const base = lived(range(-6, 0));
    const legacy = range(-6, -1).reduce((d, off) => asLegacy(d, day(off)), base);
    const p = P(legacy, 7);
    expect(p.days.opened).toBe(1);                                    // only today still has a real record
    expect(p.seen.noAction).toBe(0);
    expect(p.seen.skipped).toBe(0);
    expect(p.displayUnknown).toBeGreaterThan(0);
    expect(p.evidence.sufficient).toBe(false);
  });

  it('a gap between two opened days is "not opened" only because records sit on both sides', () => {
    const d = lived([-6, -5, -1, 0]);
    const gap = P(d, 7).days.list.filter((x) => x.date >= day(-4) && x.date <= day(-2));
    expect(gap.map((x) => x.status)).toEqual(['not-opened', 'not-opened', 'not-opened']);
    expect(P(d, 7).days.notOpened).toBe(3);
  });
});

describe('history removed to save space', () => {
  const trimmed = (d: AppData, through: number): AppData => ({ ...d, sessions: d.sessions.filter((s) => s.date > day(through)), retention: [{ at: `${TODAY}T00:00:00.000Z`, removedSessions: 4, removedEntries: 9, removedThrough: day(through), oldestKept: day(through + 1) }] });

  it('days in the gap are counted apart; what happened on them is unknown, not "no action"', () => {
    const d = lived(range(-9, 0), { doneEach: 2 });
    const t = trimmed(d, -5);
    const p = P(t, 14);
    expect(historyKnownFrom(t)).toBe(day(-4));
    expect(p.history.daysRemovedInWindow).toBe(9);                    // every window day up to the removal point, day(-13)..day(-5)
    expect(p.seen.actionsRemoved).toBeGreaterThan(0);
    // the removed days cannot raise "no recorded action": it only counts days whose actions are on file
    const intact = P(d, 14);
    expect(p.seen.noAction).toBeLessThanOrEqual(intact.seen.noAction);
    expect(p.seen.completed).toBeLessThan(intact.seen.completed);
    expect(p.seen.completed + p.seen.skipped + p.seen.snoozed + p.seen.moved + p.seen.stopped + p.seen.noAction + p.seen.pendingToday + p.seen.actionsRemoved).toBe(p.seen.tasks);
  });

  it('a window entirely after the gap reports no removed days', () => {
    const t = trimmed(lived(range(-9, 0), { doneEach: 1 }), -9);
    expect(P(t, 7).history.daysRemovedInWindow).toBe(0);
    expect(P(t, 7).seen.actionsRemoved).toBe(0);
  });

  it('no retention note means nothing was removed', () => {
    const p = P(lived(range(-5, 0)), 7);
    expect(p.history).toEqual({ knownFrom: null, daysRemovedInWindow: 0 });
  });
});

describe('reading the page is not an action', () => {
  it('computing patterns changes nothing: same data back, no entries added', () => {
    const d = lived(range(-6, 0), { doneEach: 1 });
    const json = JSON.stringify(d);
    for (const w of PATTERN_WINDOWS) P(d, w);
    expect(JSON.stringify(d)).toBe(json);
    expect(doIt).toBeTypeOf('function');
  });
});
