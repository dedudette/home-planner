import { describe, expect, it } from 'vitest';
import { emptyAppData } from '../src/domain/appdata';
import { buildCoachPayload } from '../src/domain/coach/metrics';
import type { HealthAdapter } from '../src/domain/health/adapter';
import { createCapgoAdapter, type HealthPluginLike } from '../src/domain/health/capgo';
import { mergeDaily, readHealth, statusOf, statusText } from '../src/domain/health/sync';
import type { DayHealth, HealthMetric, HealthPrefs, HealthStatus } from '../src/domain/health/types';
import { buildLearningRequest, buildMealsRequest, buildMovementRequest } from '../src/domain/assist/build';
import { reducer } from '../src/state/reducer';
import { validateHealth } from '../src/storage/healthSchema';
import { validateAppData } from '../src/storage/schema';
import { Ctx } from '../src/storage/primitives';
import { TODAY } from './helpers';

const NOW = new Date(`${TODAY}T12:00:00`);
const day = (n: number) => { const [y, m, d] = TODAY.split('-').map(Number); const t = new Date(y, m - 1, d + n); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; };
const prefs = (enabled: boolean, on: HealthMetric[]): HealthPrefs => ({ enabled, read: { steps: on.includes('steps'), exercise: on.includes('exercise'), water: on.includes('water') } });

const adapter = (over: Partial<HealthAdapter> = {}): HealthAdapter => ({
  platform: 'healthkit', label: 'Apple Health', isAvailable: async () => ({ available: true }), requestAuthorization: async () => undefined, authorized: async (r) => r,
  daily: async () => [], workouts: async () => [], ...over,
});

describe('"connected" is never said because of a switch', () => {
  const A = adapter();
  const av = { available: true };
  it('off is off, a browser has no health service, and an unavailable device says why', () => {
    expect(statusOf(prefs(false, ['steps']), A, av, ['steps'], null)).toEqual({ s: 'off' });
    expect(statusOf(prefs(true, ['steps']), null, null, null, null)).toEqual({ s: 'web' });
    expect(statusOf(prefs(true, ['steps']), A, { available: false, reason: 'Health Connect is not installed.' }, null, null)).toEqual({ s: 'unavailable', reason: 'Health Connect is not installed.' });
    expect(statusOf(prefs(true, ['steps']), A, null, null, null)).toMatchObject({ s: 'unavailable' });
  });
  it('turned on with nothing allowed yet is "needs permission", not connected', () => {
    expect(statusOf(prefs(true, ['steps']), A, av, [], null)).toEqual({ s: 'needs-permission' });
    expect(statusOf(prefs(true, []), A, av, [], null)).toEqual({ s: 'needs-permission' });
    expect(statusOf(prefs(true, ['steps']), A, av, null, null)).toEqual({ s: 'needs-permission' });
  });
  it('only some of what was asked for is "partial", all of it is "connected", and a failed read is "error"', () => {
    expect(statusOf(prefs(true, ['steps', 'water']), A, av, ['steps'], null)).toEqual({ s: 'partial', allowed: ['steps'], missing: ['water'] });
    expect(statusOf(prefs(true, ['steps', 'water']), A, av, ['steps', 'water'], '2026-10-05T10:00:00.000Z')).toEqual({ s: 'connected', allowed: ['steps', 'water'], lastSync: '2026-10-05T10:00:00.000Z' });
    expect(statusOf(prefs(true, ['steps']), A, av, ['steps'], null, true)).toEqual({ s: 'error' });
  });
  it('the words never overclaim', () => {
    for (const st of [{ s: 'off' }, { s: 'web' }, { s: 'unavailable', reason: 'x' }, { s: 'needs-permission' }, { s: 'partial', allowed: ['steps'], missing: ['water'] }, { s: 'connected', allowed: ['steps'], lastSync: null }, { s: 'error' }] as HealthStatus[]) {
      const t = statusText(st, 'Apple Health');
      if (st.s !== 'connected') expect(t, st.s).not.toMatch(/connected/i);
      expect(t).not.toMatch(/sync(ed|ing)? successfully|all set|you're good/i);
    }
    expect(statusText({ s: 'web' }, 'Apple Health')).toMatch(/Not available in a browser/);
  });
});

describe('what is read is only what was allowed, from the platform\'s own daily totals, never filled with zeros', () => {
  it('reads each allowed kind, leaves out the rest, and says nothing about a day it did not read', async () => {
    const A = adapter({
      authorized: async () => ['steps', 'water'],
      daily: async (m) => (m === 'steps' ? [{ date: day(-1), value: 6200.4 }, { date: TODAY, value: 1500 }] : m === 'water' ? [{ date: day(-1), value: 1750 }] : [{ date: day(-1), value: 999 }]),
      workouts: async () => [{ id: 'w1', type: 'running', minutes: 30, startAt: `${day(-1)}T07:00:00.000Z`, source: 'Watch' }],
    });
    const r = await readHealth(A, prefs(true, ['steps', 'exercise', 'water']), TODAY, NOW);
    expect(r[day(-1)]).toMatchObject({ steps: 6200, waterMl: 1750, platform: 'healthkit' });
    expect(r[day(-1)].exerciseMinutes).toBeUndefined();   // exercise was not allowed
    expect(r[day(-1)].workouts).toBeUndefined();
    expect(r[TODAY]).toMatchObject({ steps: 1500 });
    expect(r[day(-2)]).toBeUndefined();                    // nothing read for that day: absent, not zero
  });
  it('drops impossible numbers and days outside the window', async () => {
    const A = adapter({ authorized: async () => ['steps'], daily: async () => [{ date: day(-1), value: -5 }, { date: day(-1), value: Number.NaN }, { date: day(-60), value: 100 }, { date: day(3), value: 100 }, { date: day(-2), value: 0 }] });
    const r = await readHealth(A, prefs(true, ['steps']), TODAY, NOW, 14);
    expect(Object.keys(r)).toEqual([day(-2)]);
    expect(r[day(-2)].steps).toBe(0);                      // a real zero from the platform is kept as a zero
  });
  it('the same workout reported twice is stored once, and a zero-minute one is dropped', async () => {
    const w = { id: 'w1', type: 'walking', minutes: 20, startAt: `${day(-1)}T07:00:00.000Z`, source: 'Phone' };
    const A = adapter({ authorized: async () => ['exercise'], workouts: async () => [w, { ...w }, { ...w, id: 'w2', minutes: 0 }] });
    const r = await readHealth(A, prefs(true, ['exercise']), TODAY, NOW);
    expect(r[day(-1)].workouts).toEqual([w]);
  });
  it('a re-read replaces a day, never adds to it, and only recent days are kept', () => {
    const d1: DayHealth = { steps: 100, platform: 'healthkit', at: 'a' };
    const cur = mergeDaily({}, { [day(-1)]: d1 }, TODAY);
    const next = mergeDaily(cur, { [day(-1)]: { steps: 150, platform: 'healthkit', at: 'b' } }, TODAY);
    expect(next[day(-1)].steps).toBe(150);
    const many = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [day(-i), { steps: i, platform: 'healthkit' as const, at: 'x' }]));
    expect(Object.keys(mergeDaily({}, many, TODAY)).length).toBe(120);
    expect(Object.keys(mergeDaily({}, { [day(5)]: d1 }, TODAY))).toEqual([]);   // a future date is not history
  });
});

describe('the Capacitor adapter, against the plugin\'s documented shapes', () => {
  const plugin = (over: Partial<HealthPluginLike> = {}): HealthPluginLike & { calls: { fn: string; arg: any }[] } => {
    const calls: { fn: string; arg: any }[] = [];
    const base: HealthPluginLike = {
      isAvailable: async () => ({ available: true, platform: 'ios' }),
      requestAuthorization: async (o) => { calls.push({ fn: 'request', arg: o }); return { readAuthorized: o.read ?? [], readDenied: [] }; },
      checkAuthorization: async (o) => { calls.push({ fn: 'check', arg: o }); return { readAuthorized: o.read ?? [], readDenied: [] }; },
      queryAggregated: async (o) => { calls.push({ fn: 'aggregate', arg: o }); return { samples: [{ startDate: `${day(-1)}T00:00:00`, endDate: `${day(-1)}T23:59:59`, value: o.dataType === 'dietaryWater' ? 1.5 : 4000, unit: o.dataType === 'dietaryWater' ? 'liter' : 'count' }] }; },
      queryWorkouts: async (o) => { calls.push({ fn: 'workouts', arg: o }); return { workouts: [{ workoutType: 'yoga', duration: 1800, startDate: `${day(-1)}T07:00:00`, endDate: `${day(-1)}T07:30:00`, sourceName: 'Watch', platformId: 'uuid-1' }] }; },
      ...over,
    };
    return Object.assign(base, { calls });
  };
  it('asks for daily SUMS from the platform (so a watch and a phone are not both counted), and converts litres to millilitres', async () => {
    const p = plugin();
    const a = createCapgoAdapter(p, 'healthkit');
    expect(await a.daily('steps', day(-3), TODAY)).toEqual([{ date: day(-1), value: 4000 }]);
    expect(await a.daily('water', day(-3), TODAY)).toEqual([{ date: day(-1), value: 1500 }]);
    const agg = p.calls.filter((c) => c.fn === 'aggregate');
    expect(agg.map((c) => [c.arg.dataType, c.arg.bucket, c.arg.aggregation])).toEqual([['steps', 'day', 'sum'], ['dietaryWater', 'day', 'sum']]);
  });
  it('requests only read access, for exactly the kinds chosen, and workouts must be asked for explicitly', async () => {
    const p = plugin();
    const a = createCapgoAdapter(p, 'healthkit');
    await a.requestAuthorization(['steps', 'exercise']);
    const req = p.calls.find((c) => c.fn === 'request')!.arg;
    expect(req.write).toBeUndefined();
    expect([...req.read].sort()).toEqual(['exerciseTime', 'steps', 'workouts']);
    const water = plugin(); await createCapgoAdapter(water, 'health-connect').requestAuthorization(['water']);
    expect(water.calls[0].arg.read).toEqual(['dietaryWater']);
  });
  it('on Health Connect, exercise means workout sessions (exerciseTime is documented as iOS only), added up per day', async () => {
    const p = plugin({ queryWorkouts: async () => ({ workouts: [{ workoutType: 'walking', duration: 1200, startDate: `${day(-1)}T07:00:00`, endDate: `${day(-1)}T07:20:00`, platformId: 'a' }, { workoutType: 'yoga', duration: 1800, startDate: `${day(-1)}T18:00:00`, endDate: `${day(-1)}T18:30:00`, platformId: 'b' }] }) });
    const a = createCapgoAdapter(p, 'health-connect');
    expect(await a.daily('exercise', day(-3), TODAY)).toEqual([{ date: day(-1), value: 50 }]);
    expect(p.calls.some((c) => c.fn === 'aggregate')).toBe(false);
    const req = plugin(); await createCapgoAdapter(req, 'health-connect').requestAuthorization(['exercise']);
    expect(req.calls[0].arg.read).toEqual(['workouts']);
  });
  it('turns workouts (seconds) into minutes with their source, and drops absurd ones', async () => {
    const p = plugin({ queryWorkouts: async () => ({ workouts: [{ workoutType: 'yoga', duration: 1800, startDate: `${day(-1)}T07:00:00`, endDate: '', sourceName: 'Watch', platformId: 'u1' }, { workoutType: 'x', duration: 5, startDate: `${day(-1)}T07:00:00`, endDate: '' }, { workoutType: 'y', duration: 9_999_999, startDate: `${day(-1)}T07:00:00`, endDate: '' }] }) });
    const w = await createCapgoAdapter(p, 'healthkit').workouts(day(-3), TODAY);
    expect(w).toEqual([{ id: 'u1', type: 'yoga', minutes: 30, startAt: `${day(-1)}T07:00:00`, source: 'Watch' }]);
  });
  it('reports a device without the health service as unavailable, with the plugin\'s reason', async () => {
    const a = createCapgoAdapter(plugin({ isAvailable: async () => ({ available: false, reason: 'Health Connect is not installed' }) }), 'health-connect');
    expect(await a.isAvailable()).toEqual({ available: false, reason: 'Health Connect is not installed' });
    expect(a.label).toBe('Health Connect');
    expect(createCapgoAdapter(plugin(), 'healthkit').label).toBe('Apple Health');
  });
  it('a kind counts as allowed only if everything it needs was granted', async () => {
    const p = plugin({ checkAuthorization: async () => ({ readAuthorized: ['steps', 'exerciseTime'], readDenied: ['workouts'] }) });
    expect(await createCapgoAdapter(p, 'healthkit').authorized(['steps', 'exercise'])).toEqual(['steps']);
  });
});

describe('imported health data is kept apart from what the person logs, and never leaves the device', () => {
  const withHealth = () => {
    let d = emptyAppData(TODAY);
    d = reducer(d, { type: 'HEALTH_PREFS', enabled: true, read: { steps: true, water: true } });
    d = reducer(d, { type: 'HEALTH_MERGE', daily: { [TODAY]: { steps: 5000, waterMl: 900, exerciseMinutes: 30, workouts: [{ id: 'w', type: 'run', minutes: 30, startAt: `${TODAY}T07:00:00.000Z`, source: 'Watch' }], platform: 'healthkit', at: `${TODAY}T10:00:00.000Z` } }, today: TODAY, at: `${TODAY}T10:00:00.000Z` });
    return d;
  };
  it('it does not touch the log, the water log, the plan or the minutes', () => {
    const base = emptyAppData(TODAY);
    const d = withHealth();
    expect(d.sessions).toEqual(base.sessions);
    expect(d.water.entries).toEqual([]);
    expect(d.activities).toEqual([]);
    expect(d.taskStates).toEqual(base.taskStates);
    expect(d.movement.log).toEqual([]);
  });
  it('no assistant request has anywhere to put it, and the coach\'s counts do not include it', () => {
    const d = withHealth();
    const all = [buildMealsRequest(d, { days: [TODAY], slots: ['dinner'], wish: '', includeOwnDishes: true }), buildMovementRequest(d, { today: TODAY, days: 3, maxItems: 2, maxMinutes: null, wish: '', includeOwn: true }), buildLearningRequest(d, { minutes: 15, budget: 'free', setting: 'either', social: 'either' }, '')];
    for (const b of all) expect(JSON.stringify(b.request)).not.toMatch(/5000|900|steps|Watch|health/i);
    expect(buildCoachPayload).toBeTypeOf('function');
  });
  it('removing it forgets everything and turns reading off; it is idempotent', () => {
    const d = reducer(withHealth(), { type: 'HEALTH_CLEAR' });
    expect(d.health).toEqual({ prefs: { enabled: false, read: { steps: false, exercise: false, water: false } }, daily: {}, lastSync: null });
    expect(reducer(d, { type: 'HEALTH_CLEAR' })).toBe(d);
  });
  it('it is saved with the data and rebuilt safely on load: bad values are dropped, nothing is invented', () => {
    const back = validateAppData(JSON.parse(JSON.stringify(withHealth())))!.data;
    expect(back.health.daily[TODAY]).toMatchObject({ steps: 5000, waterMl: 900, exerciseMinutes: 30, platform: 'healthkit' });
    const v = validateHealth({ prefs: { enabled: 1, read: { steps: true, nonsense: true } }, daily: { [TODAY]: { steps: -5, waterMl: 'lots', platform: 'x', workouts: [{ id: 'a', startAt: 'garbage', minutes: 5 }, { id: 'b', startAt: `${TODAY}T07:00:00.000Z`, minutes: 10, type: 'yoga' }, { id: 'b', startAt: `${TODAY}T07:00:00.000Z`, minutes: 10 }] }, 'not a date': {} }, lastSync: 'nope' }, new Ctx());
    expect(v.prefs).toEqual({ enabled: false, read: { steps: true, exercise: false, water: false } });
    expect(v.daily[TODAY]).toMatchObject({ platform: 'healthkit' });
    expect(v.daily[TODAY].steps).toBeUndefined();
    expect(v.daily[TODAY].waterMl).toBeUndefined();
    expect(v.daily[TODAY].workouts).toEqual([{ id: 'b', type: 'yoga', minutes: 10, startAt: `${TODAY}T07:00:00.000Z`, source: 'Unknown source' }]);
    expect(Object.keys(v.daily)).toEqual([TODAY]);
    expect(v.lastSync).toBeNull();
    const old = JSON.parse(JSON.stringify(emptyAppData(TODAY))); delete old.health; delete old.reminders;
    expect(validateAppData(old)!.data.health.prefs.enabled).toBe(false);
  });
});
