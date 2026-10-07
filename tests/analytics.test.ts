import { describe, expect, it } from 'vitest';
import { addDays } from '../src/domain/dates';
import { buildExposure, hasNewExposure } from '../src/domain/exposure';
import { computeInsights } from '../src/domain/learning';
import { planVersionOf, planVersionId, snapshotPlanVersion } from '../src/domain/planVersion';
import type { AppData, ExposureRecord, RecommendationEvent } from '../src/domain/types';
import { todayPlan } from '../src/domain/view';
import { reducer, type Stamp } from '../src/state/reducer';
import { validateAppData } from '../src/storage/schema';
import { demo, TODAY, view } from './helpers';

const entries = (d: AppData) => d.sessions.flatMap((s) => s.entries);
const st = (hour: number, extra: Partial<Stamp> = {}): Stamp => ({ now: new Date(2026, 9, 5, hour, 30).toISOString(), today: TODAY, hour, tz: -120, ...extra });
const firstLife = (d: AppData) => todayPlan(view(d)).life[0].task;

describe('every logged action carries what a future recommender needs', () => {
  it('records template, level, difficulty, intensity, planned time of day, goals, plan version, energy, local hour and timezone', () => {
    const d0 = demo('E');
    const task = todayPlan(view(d0)).life.map((i) => i.task).find((t) => t.timeOfDay !== 'anytime' && t.matches?.length) ?? firstLife(d0);
    const d = reducer(d0, { type: 'TASK_COMPLETE', task, stamp: st(7), via: 'checkoff', entryId: 'a1' });
    const e = entries(d)[0];
    expect(e.templateId).toBe(task.templateId);
    expect(e.level).toBe(task.level);
    expect(e.difficulty).toBe(task.difficulty);
    expect(e.intensity).toBe(task.intensity);
    expect(e.timeOfDay).toBe(task.timeOfDay);
    expect(e.goals).toEqual(task.matches);
    expect(e.localHour).toBe(7);
    expect(e.tzOffsetMin).toBe(-120);
    expect(e.planVersion).toBe(planVersionOf(d0));
    expect(e.energy).toBe('ok');
    expect(e.domain).toBe(task.domain);
  });

  it('derives the local hour and offset from the timestamp when the caller did not supply them', () => {
    const d0 = demo('E');
    const task = firstLife(d0);
    const now = new Date(2026, 9, 5, 21, 5);
    const d = reducer(d0, { type: 'TASK_SKIP', task, stamp: { now: now.toISOString(), today: TODAY }, entryId: 'k1' });
    expect(entries(d)[0].localHour).toBe(21);
    expect(entries(d)[0].tzOffsetMin).toBe(now.getTimezoneOffset());
  });

  it('the day\'s energy is recorded with the action', () => {
    const d0 = reducer(demo('E'), { type: 'DAY_ENERGY', level: 'low', stamp: st(8) });
    const d = reducer(d0, { type: 'TASK_COMPLETE', task: firstLife(d0), stamp: st(9), via: 'checkoff', entryId: 'a1' });
    expect(entries(d)[0].energy).toBe('low');
  });

  it('snoozes and moves record where the task was due and where it went', () => {
    const d0 = demo('E');
    const task = firstLife(d0);
    const snoozed = reducer(d0, { type: 'TASK_SNOOZE', task, stamp: st(9), entryId: 'z1' });
    expect(entries(snoozed)[0]).toMatchObject({ outcome: 'snoozed', fromDue: TODAY, toDue: addDays(TODAY, 2) });
    const moved = reducer(d0, { type: 'TASK_MOVE', task, to: '2026-10-09', stamp: st(9), entryId: 'm1' });
    expect(entries(moved)[0]).toMatchObject({ outcome: 'moved', fromDue: TODAY, toDue: '2026-10-09' });
  });

  it('old entries without these fields still load, and new ones survive validation unchanged', () => {
    const d = reducer(demo('E'), { type: 'TASK_COMPLETE', task: firstLife(demo('E')), stamp: st(7), via: 'checkoff', entryId: 'a1' });
    const back = validateAppData(JSON.parse(JSON.stringify(d)))!.data;
    expect(entries(back).find((e) => e.id === 'a1')).toEqual(entries(d).find((e) => e.id === 'a1'));
    const legacy = JSON.parse(JSON.stringify(demo('E', { withHistory: true })));
    expect(validateAppData(legacy)!.data.sessions.length).toBeGreaterThan(0);
  });
});

describe('what was scheduled is recorded, so ignored tasks are visible', () => {
  const rec = (d: AppData, today = TODAY): ExposureRecord => buildExposure(view(d, today), `${today}T06:00:00.000Z`, -120);

  it('lists every task shown today with its template, level, difficulty and time of day, including ones never touched', () => {
    const d = demo('G');
    const r = rec(d);
    const t = todayPlan(view(d));
    expect(r.items.length).toBe(t.focus.length + t.life.length + t.extra.length + t.catchUp.length);
    const life = r.items.filter((i) => i.kind === 'life');
    expect(life.length).toBe(t.life.length);
    for (const i of life) {
      expect(i.templateId).toBeTruthy();
      expect(i.level).toBeTruthy();
      expect(i.difficulty).toBeGreaterThan(0);
      expect(i.timeOfDay).toBeTruthy();
      expect(i.goals?.length).toBeGreaterThan(0);
    }
    expect(r.planVersion).toBe(planVersionOf(d));
    expect(r.tzOffsetMin).toBe(-120);
    expect(r.budgetMinutes).toBeGreaterThan(0);
  });

  it('a task that was scheduled and ignored stays in the record while a completed one is simply marked by its entry', () => {
    let d = reducer(demo('G'), { type: 'RECORD_EXPOSURE', record: rec(demo('G')) });
    const [a, b] = todayPlan(view(d)).life.map((i) => i.task);
    d = reducer(d, { type: 'TASK_COMPLETE', task: a, stamp: st(9), via: 'checkoff', entryId: 'a1' });
    const ids = d.exposures[0].items.map((i) => i.taskId);
    expect(ids).toContain(a.id);
    expect(ids).toContain(b.id); // ignored, but we know it was offered
    expect(entries(d).map((e) => e.taskId)).not.toContain(b.id);
  });

  it('recording the same day again only adds what is new and never rewrites what was already recorded', () => {
    const d0 = demo('G');
    const r = rec(d0);
    const once = reducer(d0, { type: 'RECORD_EXPOSURE', record: r });
    const again = reducer(once, { type: 'RECORD_EXPOSURE', record: r });
    expect(again).toBe(once);
    const extra = { ...r, items: [...r.items, { ...r.items[0], taskId: 'moved-here' }] };
    const grown = reducer(once, { type: 'RECORD_EXPOSURE', record: extra });
    expect(grown.exposures).toHaveLength(1);
    expect(grown.exposures[0].items).toHaveLength(r.items.length + 1);
    expect(grown.exposures[0].recordedAt).toBe(r.recordedAt);
  });

  it('hasNewExposure tells the store when dispatching would be a no-op', () => {
    const d0 = demo('G');
    const r = rec(d0);
    expect(hasNewExposure(view(d0), r)).toBe(true);
    const d1 = reducer(d0, { type: 'RECORD_EXPOSURE', record: r });
    expect(hasNewExposure(view(d1), rec(d1))).toBe(false);
  });

  it('keeps one record per day, in date order, and at most four months of them', () => {
    let d = demo('G');
    for (let i = 130; i >= 0; i--) { const day = addDays(TODAY, -i); d = reducer(d, { type: 'RECORD_EXPOSURE', record: { ...rec(d), date: day } }); }
    expect(d.exposures).toHaveLength(120);
    const dates = d.exposures.map((e) => e.date);
    expect([...dates].sort()).toEqual(dates);
    expect(new Set(dates).size).toBe(120);
  });
});

describe('plan versions', () => {
  it('stay the same through behaviour and change when the plan\'s inputs change', () => {
    const d0 = demo('E');
    const v0 = planVersionOf(d0);
    const done = reducer(d0, { type: 'TASK_COMPLETE', task: firstLife(d0), stamp: st(9), via: 'checkoff', entryId: 'a1' });
    expect(planVersionOf(done)).toBe(v0);
    expect(planVersionOf(reducer(done, { type: 'SET_PREFS', patch: { sessionMinutes: 45 }, stamp: st(9) }))).not.toBe(v0);
    expect(planVersionOf(reducer(d0, { type: 'SET_PREFS', patch: { focus: ['home'] }, stamp: st(9) }))).not.toBe(v0);
    expect(planVersionId(d0.home, d0.preferences, 0)).toBe(planVersionId(d0.home, d0.preferences, 0));
  });

  it('a snapshot is recorded once per version, newest last', () => {
    const d0 = demo('E');
    const s0 = snapshotPlanVersion(d0, `${TODAY}T08:00:00.000Z`);
    const d1 = reducer(reducer(d0, { type: 'RECORD_PLAN_VERSION', version: s0 }), { type: 'RECORD_PLAN_VERSION', version: s0 });
    expect(d1.planVersions).toHaveLength(1);
    expect(s0).toMatchObject({ focus: d0.preferences.focus, lifeLevel: 1, fitnessLevel: 'beginner' });
    const d2 = reducer(d1, { type: 'SET_PREFS', patch: { sessionMinutes: 60 }, stamp: st(9) });
    const d3 = reducer(d2, { type: 'RECORD_PLAN_VERSION', version: snapshotPlanVersion(d2, `${TODAY}T09:00:00.000Z`) });
    expect(d3.planVersions.map((v) => v.id)).toEqual([planVersionOf(d0), planVersionOf(d2)]);
  });
});

describe('day energy history', () => {
  it('keeps every day\'s answer instead of overwriting yesterday\'s', () => {
    let d = demo('E');
    d = reducer(d, { type: 'DAY_ENERGY', level: 'low', stamp: { ...st(8), today: '2026-10-05' } });
    d = reducer(d, { type: 'DAY_ENERGY', level: 'high', stamp: { ...st(8), today: '2026-10-06' } });
    d = reducer(d, { type: 'DAY_ENERGY', level: 'ok', stamp: { ...st(8), today: '2026-10-07' } });
    expect(d.energyLog).toEqual({ '2026-10-05': 'low', '2026-10-06': 'high', '2026-10-07': 'ok' });
    expect(d.dayEnergy).toEqual({ date: '2026-10-07', level: 'ok' });
    expect(validateAppData(JSON.parse(JSON.stringify(d)))!.data.energyLog).toEqual(d.energyLog);
  });
});

describe('recommendation-ready events', () => {
  const ev = (over: Partial<RecommendationEvent> = {}): RecommendationEvent => ({
    id: 'r1', at: `${TODAY}T09:00:00.000Z`, date: TODAY, localHour: 9, kind: 'shown', recommendationId: 'level-up', code: 'level-up', evidence: { activeDays: 16 }, planVersion: 'p1', ...over,
  });

  it('every insight explains itself with a machine-readable code and the numbers behind it', () => {
    const d0 = demo('E');
    const task = firstLife(d0);
    let d: AppData = d0;
    for (let i = 0; i < 3; i++) d = reducer(d, { type: 'TASK_SKIP', task, stamp: st(9 + i), entryId: `s${i}` });
    const skip = computeInsights(view(d)).find((i) => i.id === `skip:${task.id}`)!;
    expect(skip.code).toBe('skip-streak');
    expect(skip.evidence).toMatchObject({ streak: 3 });
  });

  it('shown / accepted / dismissed events are stored once each, in order, and survive a save', () => {
    let d = demo('E');
    d = reducer(d, { type: 'REC_EVENT', event: ev() });
    d = reducer(d, { type: 'REC_EVENT', event: ev() });                         // same id twice → once
    d = reducer(d, { type: 'REC_EVENT', event: ev({ id: 'r2', kind: 'accepted', action: 'level-up' }) });
    expect(d.recEvents.map((e) => e.kind)).toEqual(['shown', 'accepted']);
    const back = validateAppData(JSON.parse(JSON.stringify(d)))!.data;
    expect(back.recEvents).toEqual(d.recEvents);
  });

  it('is capped so it can never grow without bound', () => {
    let d = demo('E');
    for (let i = 0; i < 450; i++) d = reducer(d, { type: 'REC_EVENT', event: ev({ id: `r${i}` }) });
    expect(d.recEvents).toHaveLength(400);
    expect(d.recEvents[d.recEvents.length - 1].id).toBe('r449');
  });

  it('contains nothing but behaviour: no names, free text or home details', () => {
    expect(Object.keys(ev()).sort()).toEqual(['at', 'code', 'date', 'evidence', 'id', 'kind', 'localHour', 'planVersion', 'recommendationId']);
    const v = validateAppData({ ...JSON.parse(JSON.stringify(demo('E'))), recEvents: [{ ...ev(), name: 'Dee', address: '1 High St', evidence: { note: 'free text'.repeat(30), nested: { a: 1 } } }] })!;
    const stored = v.data.recEvents[0];
    expect(Object.keys(stored)).not.toContain('name');
    expect(Object.keys(stored)).not.toContain('address');
    expect(stored.evidence).not.toHaveProperty('nested');
    expect(String(stored.evidence!.note).length).toBeLessThanOrEqual(80);
  });
});
