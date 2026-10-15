import { describe, expect, it } from 'vitest';
import { emptyAppData } from '../src/domain/appdata';
import { checkAmount, dayTotal, formatVolume, fromMl, GOAL_MAX_ML, QUICK_ML, toMl, totalOn, waterHistory } from '../src/domain/water/water';
import type { WaterEntry } from '../src/domain/water/types';
import { BREATHING, BREATHING_NOTE, ROUTINES } from '../src/domain/wellbeing/content';
import { emptyWater, emptyWellbeing } from '../src/domain/wellbeing/defaults';
import { reducer } from '../src/state/reducer';
import { validateAppData } from '../src/storage/schema';
import { TODAY } from './helpers';

const entry = (id: string, date: string, ml: number, hour = 9): WaterEntry => ({ id, date, ml, at: `${date}T${String(hour).padStart(2, '0')}:00:00.000Z` });

describe('water amounts', () => {
  it('converts with fixed definitions and reads naturally in each unit', () => {
    expect(toMl(8, 'floz')).toBe(237);
    expect(toMl(2, 'cup')).toBe(480);
    expect(fromMl(500, 'ml')).toBe(500);
    expect(formatVolume(250, 'ml')).toBe('250 ml');
    expect(formatVolume(250, 'floz')).toBe('8.5 fl oz');
    expect(formatVolume(480, 'cup')).toBe('2 cups');
    expect(QUICK_ML.every((q) => q >= 100 && q <= 600)).toBe(true);
  });
  it('refuses the impossible, asks about the surprising, and accepts the ordinary', () => {
    expect(checkAmount(0, 'ml')).toMatchObject({ ok: false });
    expect(checkAmount(-5, 'ml')).toMatchObject({ ok: false });
    expect(checkAmount(Number.NaN, 'ml')).toMatchObject({ ok: false });
    expect(checkAmount(2, 'ml')).toMatchObject({ ok: false });
    expect(checkAmount(9000, 'ml')).toMatchObject({ ok: false });
    const big = checkAmount(1800, 'ml');
    expect(big).toMatchObject({ ok: true, ml: 1800 });
    expect('confirm' in big && big.confirm).toMatch(/Is that right\?/);
    expect('confirm' in checkAmount(250, 'ml')).toBe(false);
    expect(checkAmount(10, 'floz')).toMatchObject({ ok: true, ml: 296 });
  });
});

describe('a day with nothing logged is unknown, never zero', () => {
  const entries = [entry('a', TODAY, 250), entry('b', TODAY, 500, 12), entry('c', '2026-10-03', 750)];
  it('totals what was logged and says null when nothing was', () => {
    expect(totalOn(entries, TODAY)).toBe(750);
    expect(dayTotal(entries, TODAY)).toBe(750);
    expect(dayTotal(entries, '2026-10-04')).toBeNull();
  });
  it('the history keeps unlogged days as unknown and averages only the days that have entries', () => {
    const h = waterHistory(entries, TODAY, 7);
    expect(h.days).toHaveLength(7);
    expect(h.days.find((d) => d.date === '2026-10-04')!.ml).toBeNull();
    expect(h.loggedDays).toBe(2);
    expect(h.averageOnLoggedDays).toBe(750);
    expect(waterHistory([], TODAY, 7)).toMatchObject({ loggedDays: 0, averageOnLoggedDays: null });
  });
});

describe('the water reducer', () => {
  const base = emptyAppData(TODAY);
  it('adds once, edits the amount and the time, and deletes, each safe to replay', () => {
    let d = reducer(base, { type: 'WATER_ADD', entry: entry('a', TODAY, 250) });
    d = reducer(d, { type: 'WATER_ADD', entry: entry('a', TODAY, 250) });
    expect(d.water.entries).toHaveLength(1);
    d = reducer(d, { type: 'WATER_EDIT', id: 'a', ml: 300, at: `${TODAY}T07:30:00.000Z` });
    expect(d.water.entries[0]).toMatchObject({ ml: 300, at: `${TODAY}T07:30:00.000Z` });
    const same = reducer(d, { type: 'WATER_EDIT', id: 'a', ml: 300 });
    expect(same).toBe(d);
    d = reducer(d, { type: 'WATER_DELETE', id: 'a' });
    d = reducer(d, { type: 'WATER_DELETE', id: 'a' });
    expect(d.water.entries).toHaveLength(0);
  });
  it('an undo of a delete is just adding the same entry back', () => {
    const e = entry('a', TODAY, 250);
    let d = reducer(base, { type: 'WATER_ADD', entry: e });
    d = reducer(d, { type: 'WATER_DELETE', id: 'a' });
    d = reducer(d, { type: 'WATER_ADD', entry: e });
    expect(d.water.entries).toEqual([e]);
  });
  it('keeps entries in time order however they were added', () => {
    let d = reducer(base, { type: 'WATER_ADD', entry: entry('late', TODAY, 250, 20) });
    d = reducer(d, { type: 'WATER_ADD', entry: entry('early', TODAY, 250, 6) });
    expect(d.water.entries.map((e) => e.id)).toEqual(['early', 'late']);
  });
  it('the goal is the person\'s own: none by default, clearable, and never set outside a sane range', () => {
    expect(base.water.goalMl).toBeNull();
    let d = reducer(base, { type: 'WATER_SETTINGS', goalMl: 2000, unit: 'cup' });
    expect(d.water).toMatchObject({ goalMl: 2000, unit: 'cup' });
    expect(reducer(d, { type: 'WATER_SETTINGS', goalMl: 90000 }).water.goalMl).toBe(2000);
    expect(reducer(d, { type: 'WATER_SETTINGS', goalMl: 50 }).water.goalMl).toBe(2000);
    expect(GOAL_MAX_ML).toBeLessThanOrEqual(6000);
    d = reducer(d, { type: 'WATER_SETTINGS', goalMl: null });
    expect(d.water.goalMl).toBeNull();
  });
});

describe('saved water and wellbeing data are validated', () => {
  it('survives a round trip and drops what cannot be real', () => {
    const good = { ...emptyAppData(TODAY), water: { goalMl: 2000, unit: 'floz' as const, entries: [entry('a', TODAY, 250), entry('b', TODAY, 500, 12)] } };
    expect(validateAppData(JSON.parse(JSON.stringify(good)), TODAY)!.data.water).toEqual(good.water);
    const raw = JSON.parse(JSON.stringify(good));
    raw.water = { goalMl: 99999, unit: 'barrel', entries: [entry('a', TODAY, 250), entry('a', TODAY, 300), entry('x', 'bad date', 250), entry('y', TODAY, 1), entry('z', TODAY, 90000), { id: 'q', date: TODAY, ml: 250, at: 'never' }, 'junk', { ...entry('k', TODAY, 400), note: 'x' }] };
    const r = validateAppData(raw, TODAY)!;
    expect(r.data.water.goalMl).toBeNull();
    expect(r.data.water.unit).toBe('ml');
    expect(r.data.water.entries.map((e) => e.id)).toEqual(['a', 'k']);
    expect(Object.keys(r.data.water.entries[1]).sort()).toEqual(['at', 'date', 'id', 'ml']);
    expect(r.dropped).toBeGreaterThanOrEqual(5);
  });
  it('check-ins keep only what was said, and an empty one is not a record', () => {
    const raw = JSON.parse(JSON.stringify(emptyAppData(TODAY)));
    const at = `${TODAY}T09:00:00.000Z`;
    raw.wellbeing = { checkins: [
      { id: 'a', date: TODAY, at, energy: 'low', mood: 2, note: 'tired' }, { id: 'b', date: TODAY, at, energy: null, mood: null, note: '' }, { id: 'c', date: TODAY, at, energy: 'extreme', mood: 9, note: 'ok' },
      { id: 'd', date: TODAY, at, mood: 4 }, { id: 'a', date: TODAY, at, mood: 5 },
    ], journal: [{ id: 'j1', date: TODAY, at, title: 'T', text: 'x'.repeat(20000) }, { id: 'j2', date: TODAY, at, title: '', text: '   ' }] };
    const w = validateAppData(raw, TODAY)!.data.wellbeing;
    expect(w.checkins.map((c) => [c.id, c.energy, c.mood])).toEqual([['a', 'low', 2], ['c', null, null], ['d', null, 4]]);
    expect(w.journal).toHaveLength(1);
    expect(w.journal[0].text).toHaveLength(8000);
  });
  it('an old file has empty water and wellbeing, nothing invented', () => {
    const raw = JSON.parse(JSON.stringify(emptyAppData(TODAY))) as Record<string, unknown>;
    delete raw.water; delete raw.wellbeing; raw.version = 2; raw.onboardingComplete = true;
    const d = validateAppData(raw, TODAY)!.data;
    expect(d.water).toEqual(emptyWater());
    expect(d.wellbeing).toEqual(emptyWellbeing());
  });
});

describe('check-ins and the journal', () => {
  it('a check-in can be changed and deleted; the journal likewise', () => {
    const at = `${TODAY}T09:00:00.000Z`;
    let d = reducer(emptyAppData(TODAY), { type: 'CHECKIN_SAVE', checkin: { id: 'c1', date: TODAY, at, energy: 'ok', mood: 3, note: '' } });
    d = reducer(d, { type: 'CHECKIN_SAVE', checkin: { id: 'c1', date: TODAY, at, energy: 'ok', mood: 4, note: 'better' } });
    expect(d.wellbeing.checkins).toHaveLength(1);
    expect(d.wellbeing.checkins[0]).toMatchObject({ mood: 4, note: 'better' });
    d = reducer(d, { type: 'JOURNAL_SAVE', entry: { id: 'j1', date: TODAY, at, title: '', text: 'A good walk.' } });
    d = reducer(d, { type: 'JOURNAL_DELETE', id: 'j1' });
    d = reducer(d, { type: 'CHECKIN_DELETE', id: 'c1' });
    expect(d.wellbeing).toEqual(emptyWellbeing());
  });
});

describe('what the app says about relaxation and routines', () => {
  it('makes no medical, treatment or sleep-outcome claims', () => {
    const text = JSON.stringify([BREATHING, BREATHING_NOTE, ROUTINES]).toLowerCase();
    for (const w of ['cure', 'treat ', 'treatment for', 'diagnos', 'anxiety disorder', 'depression', 'insomnia', 'sleep better', 'fall asleep', 'lower your blood pressure', 'therapy', 'heal']) expect(text.includes(w), w).toBe(false);
    expect(BREATHING_NOTE).toMatch(/not a treatment/);
    expect(BREATHING_NOTE).toMatch(/stop if/i);
  });
  it('every breathing pattern is a real cycle and every routine has steps', () => {
    for (const b of BREATHING) { expect(b.cycle[0]).toBeGreaterThan(0); expect(b.cycle[2]).toBeGreaterThan(0); expect(b.cycle.reduce((n, x) => n + x, 0)).toBeLessThanOrEqual(16); }
    for (const r of ROUTINES) { expect(r.steps.length).toBeGreaterThanOrEqual(3); expect(r.minutes).toBeGreaterThan(0); }
  });
});
