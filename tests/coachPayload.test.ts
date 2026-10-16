import { describe, expect, it } from 'vitest';
import { buildCoachPayload, describePayload, METRIC_IDS, METRICS, validatePayload, type CoachPayload } from '../src/domain/coach/metrics';
import { computePatterns } from '../src/domain/patterns';
import type { AppData } from '../src/domain/types';
import { lived, range } from './coachHelpers';
import { TODAY } from './helpers';

const rich = (): AppData => {
  const d = lived(range(-13, 0), { doneEach: 2, skipEach: 1, focus: ['home', 'discipline', 'morning', 'evening', 'study'] });
  return {
    ...d,
    user: { ...d.user, name: 'Zebediah Quillfeather' },
    customTasks: [{ ...(d.customTasks[0] ?? ({} as never)) }].slice(0, 0),
  };
};
const payloadOf = (d: AppData, w: 7 | 14 | 28 = 14): CoachPayload => buildCoachPayload(computePatterns(d, TODAY, w))!;

describe('what is sent: counts only', () => {
  it('is exactly a version, a window and the named counts: nothing else', () => {
    const p = payloadOf(rich());
    expect(Object.keys(p).sort()).toEqual(['metrics', 'v', 'windowDays']);
    expect(Object.keys(p.metrics).sort()).toEqual([...METRIC_IDS].sort());
    expect(Object.values(p.metrics).every((v) => Number.isInteger(v) && v >= 0)).toBe(true);
    expect(p.v).toBe(1);
  });

  it('contains no name, no task, room or goal wording, no id, no date, no free text', () => {
    const d = rich();
    const text = JSON.stringify(buildCoachPayload(computePatterns(d, TODAY, 14)));
    const forbidden = [d.user.name, 'Zebediah', ...d.sessions.flatMap((s) => s.entries.map((e) => e.name)), ...d.sessions.flatMap((s) => s.entries.map((e) => e.roomName)), ...d.sessions.flatMap((s) => s.entries.map((e) => e.taskId)), ...d.exposures.flatMap((e) => e.items.map((i) => i.taskId)), TODAY, '2026-', '@', 'http'];
    for (const f of forbidden) if (f) expect(text, `payload must not contain "${f}"`).not.toContain(f);
    // every key is a registered metric id and every value a number: there is nowhere for text to hide
    expect(text).toMatch(/^\{"v":1,"windowDays":14,"metrics":\{("[a-zA-Z.]+":\d+,?)+\}\}$/);
  });

  it('is small and fixed in size, however long the history is', () => {
    const few = JSON.stringify(payloadOf(lived(range(-4, 0), { doneEach: 1 }))).length;
    const many = JSON.stringify(payloadOf(lived(range(-27, 0), { doneEach: 2 }), 28)).length;
    expect(few).toBeLessThan(1000);
    expect(many).toBeLessThan(1000);
    expect(Math.abs(many - few)).toBeLessThan(120);
  });

  it('is not offered at all when there is not enough recorded: the AI is never asked about nothing', () => {
    expect(buildCoachPayload(computePatterns(lived([-1, 0]), TODAY, 14))).toBeNull();
    expect(buildCoachPayload(computePatterns(lived([], {}), TODAY, 14))).toBeNull();
  });

  it('every count is the one the page shows', () => {
    const d = rich();
    const pat = computePatterns(d, TODAY, 14);
    const m = payloadOf(d).metrics;
    expect(m['tasks.seen']).toBe(pat.seen.tasks);
    expect(m['tasks.seenCompleted']).toBe(pat.seen.completed);
    expect(m['tasks.seenSkipped']).toBe(pat.seen.skipped);
    expect(m['tasks.seenNoAction']).toBe(pat.seen.noAction);
    expect(m['days.opened']).toBe(pat.days.opened);
    expect(m['tasks.notShown']).toBe(pat.notShown);
    expect(m['tasks.seenOutcomeOpen']).toBe(pat.seen.pendingToday + pat.seen.actionsRemoved);
  });

  it('what the person reviews is what is sent: the review lines are the payload, one line per count', () => {
    const p = payloadOf(rich());
    const lines = describePayload(p);
    expect(lines.map((l) => l.id)).toEqual(METRIC_IDS);
    for (const l of lines) { expect(l.value).toBe(p.metrics[l.id]); expect(l.label).toBe(METRICS[l.id].label); }
    expect(JSON.parse(JSON.stringify(p))).toEqual(p);
  });

  it('unknown days and removed history are labelled as context, so nothing may rest on them', () => {
    for (const id of ['days.unknown', 'days.acted', 'history.daysRemoved', 'tasks.seenOutcomeOpen', 'days.window'] as const) expect(METRICS[id].role).toBe('context');
    for (const id of ['tasks.seenCompleted', 'tasks.seenNoAction', 'leftOut.notEnoughTime', 'days.opened'] as const) expect(METRICS[id].role).toBe('evidence');
  });
});

describe('a request is checked from its counts, not from what the sender claims', () => {
  const good = () => JSON.parse(JSON.stringify(payloadOf(rich()))) as CoachPayload;

  it('accepts what the app builds, and decides sufficiency itself', () => {
    const r = validatePayload(good());
    expect(r.ok).toBe(true);
    if (r.ok) expect(['limited', 'moderate', 'good']).toContain(r.strength);
  });

  it('refuses anything that is not exactly the fixed shape', () => {
    const cases: [string, (p: any) => void][] = [
      ['an extra top-level field (a place to put text)', (p) => { p.note = 'hello'; }],
      ['an extra metric', (p) => { p.metrics['user.name'] = 1; }],
      ['a missing metric', (p) => { delete p.metrics['tasks.seen']; }],
      ['a text value', (p) => { p.metrics['tasks.seen'] = 'Alice'; }],
      ['a fraction', (p) => { p.metrics['tasks.seen'] = 1.5; }],
      ['a negative', (p) => { p.metrics['tasks.seen'] = -1; }],
      ['a fraction in a count that nothing else constrains', (p) => { p.metrics['tasks.notShown'] = 0.5; }],
      ['a fraction in a left-out count', (p) => { p.metrics['leftOut.notEnoughTime'] = 1.5; }],
      ['shown tasks that do not add up even though the areas still do', (p) => { p.metrics['tasks.seenNoAction'] += 1; p.metrics['area.home.noAction'] += 1; }],
      ['a huge number', (p) => { p.metrics['tasks.seen'] = 1e9; }],
      ['a wrong version', (p) => { p.v = 2; }],
      ['an odd window', (p) => { p.windowDays = 90; }],
      ['a window that does not match its day counts', (p) => { p.metrics['days.window'] = 7; }],
      ['day counts that do not add up', (p) => { p.metrics['days.opened'] += 1; }],
      ['shown tasks that do not add up', (p) => { p.metrics['tasks.seenCompleted'] += 5; }],
      ['areas that do not add up', (p) => { p.metrics['area.home.seen'] += 1; }],
    ];
    for (const [name, mutate] of cases) { const p = good(); mutate(p); expect(validatePayload(p).ok, name).toBe(false); }
    for (const junk of [null, 5, 'x', [], [1], {}]) expect(validatePayload(junk).ok).toBe(false);
  });

  it('refuses a request that claims enough evidence when its own counts say there is not', () => {
    const p = good();
    p.metrics['days.opened'] = 1; p.metrics['days.unknown'] += p.metrics['days.window'] - (p.metrics['days.opened'] + p.metrics['days.notOpened'] + p.metrics['days.acted'] + p.metrics['days.unknown']);
    const r = validatePayload(p);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('insufficient');
  });
});
