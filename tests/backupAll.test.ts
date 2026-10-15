import { describe, expect, it } from 'vitest';
import { emptyAppData } from '../src/domain/appdata';
import type { AppData } from '../src/domain/types';
import { exportJSON, importJSON, interpret, LocalStorageRepository, STORAGE_KEY, type StorageLike } from '../src/storage/repository';
import { validateAppData } from '../src/storage/schema';
import { reducer } from '../src/state/reducer';
import { TODAY } from './helpers';

class Fake implements StorageLike {
  m = new Map<string, string>(); quota = Infinity;
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { if ([...this.m.values()].reduce((n, x) => n + x.length, 0) + v.length > this.quota) { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; } this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
  get length() { return this.m.size; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
}

/** A person who has used every part of the app: each action is one the screens dispatch. */
const everything = (): AppData => {
  let d = emptyAppData(TODAY);
  const a = (x: Parameters<typeof reducer>[1]) => { d = reducer(d, x); };
  a({ type: 'MODULE_TOGGLE', module: 'meals', on: true } as never);
  a({ type: 'MEALS_PREFS', patch: { diet: 'vegetarian', avoid: ['gluten'], household: 3 } });
  a({ type: 'MEAL_SAVE', entry: { id: 'm1', date: TODAY, slot: 'dinner', ref: { kind: 'recipe', id: 'lentil-soup' }, name: 'Red lentil soup', servings: 3, status: 'planned', statusAt: null, prepActivityId: null, kcal: null, note: 'with bread' } });
  a({ type: 'DISH_SAVE', dish: { id: 'dish_a', name: 'My stew', source: 'personal', servings: 2, prepMinutes: 10, cookMinutes: 20, slots: ['dinner'], tags: [], equipment: [], ingredients: [{ name: 'carrot', qty: 2, unit: 'piece' }], steps: ['Cook it'] } });
  a({ type: 'MOVE_PREFS', patch: { equipment: ['mat'], likes: ['walking'] } } as never);
  a({ type: 'MOVE_REST_DAYS', days: [0] });
  a({ type: 'WATER_ADD', entry: { id: 'w1', date: TODAY, at: `${TODAY}T09:00:00.000Z`, ml: 300 } });
  a({ type: 'CHECKIN_SAVE', checkin: { id: 'c1', date: TODAY, at: `${TODAY}T20:00:00.000Z`, energy: 'low', mood: 3, note: 'a quiet day' } });
  a({ type: 'JOURNAL_SAVE', entry: { id: 'j1', date: TODAY, at: `${TODAY}T21:00:00.000Z`, title: 'Private title', text: 'Private words that must survive a backup.' } });
  a({ type: 'INTEREST_SAVE', interest: { id: 'i1', name: 'Drawing', catalogId: 'drawing', category: 'visual-art', status: 'active', goal: 'Draw a hand', weeklyMinutes: 60, note: 'n', createdAt: `${TODAY}T00:00:00.000Z` } });
  a({ type: 'BOOK_SAVE', book: { id: 'b1', title: 'A book I typed', author: 'Me', status: 'reading', pagesTotal: 200, pagesRead: 50, addedAt: `${TODAY}T00:00:00.000Z`, finishedAt: null, note: '' } });
  a({ type: 'RESOURCE_SAVE', resource: { id: 'r1', interestId: 'i1', title: 'My link', url: 'https://example.org/x', note: '' } });
  a({ type: 'SESSION_ADD', session: { id: 's1', interestId: 'i1', entryId: 'e1', date: TODAY, at: `${TODAY}T19:00:00.000Z`, bookId: null, starterId: 'contour-hand', note: 'fun', feedback: 'enjoyed', resource: '' } });
  a({ type: 'DISCOVER_SET', answers: { minutes: 30, budget: 'low', setting: 'indoor', social: 'solo' } });
  a({ type: 'APPEARANCE_SET', patch: { theme: 'dark', palette: 'dusk', accent: '#336699', font: 'serif', fontSize: 'large', density: 'compact', motion: 'reduced', owl: false } });
  a({ type: 'REMINDER_PREFS', patch: { enabled: true, leadMinutes: 30, quiet: { from: '21:30' }, modules: { meals: false } } });
  a({ type: 'REMINDER_SNOOZE', key: `act1@${TODAY}`, until: `${TODAY}T18:40:00.000Z` });
  a({ type: 'HEALTH_PREFS', enabled: true, read: { steps: true } });
  a({ type: 'HEALTH_MERGE', daily: { [TODAY]: { steps: 4000, platform: 'healthkit', at: `${TODAY}T10:00:00.000Z` } }, today: TODAY, at: `${TODAY}T10:00:00.000Z` });
  a({ type: 'DISMISS_INSIGHT', id: 'owl:discover', stamp: { now: `${TODAY}T10:00:00.000Z`, today: TODAY } });
  return d;
};

describe('everything the app now stores survives saving, exporting and restoring, unchanged', () => {
  const d = everything();
  const parts = (x: AppData) => ({ meals: x.meals, movement: x.movement, water: x.water, wellbeing: x.wellbeing, interests: x.interests, appearance: x.appearance, reminders: x.reminders, health: x.health, dismissed: x.dismissedInsights });

  it('the fixture really uses every new part (so this test cannot pass by testing nothing)', () => {
    expect(d.meals.plan).toHaveLength(1);
    expect(d.meals.dishes).toHaveLength(1);
    expect(d.water.entries).toHaveLength(1);
    expect(d.wellbeing.journal).toHaveLength(1);
    expect(d.wellbeing.checkins).toHaveLength(1);
    expect(d.interests.items).toHaveLength(1);
    expect(d.interests.books).toHaveLength(1);
    expect(d.interests.resources).toHaveLength(1);
    expect(d.interests.sessions).toHaveLength(1);
    expect(d.appearance.palette).toBe('dusk');
    expect(d.reminders.prefs.leadMinutes).toBe(30);
    expect(Object.keys(d.reminders.snoozed)).toHaveLength(1);
    expect(d.health.daily[TODAY].steps).toBe(4000);
    expect(d.dismissedInsights['owl:discover']).toBe(TODAY);
  });
  it('validation is a fixed point: loading what the app wrote changes nothing', () => {
    const back = validateAppData(JSON.parse(JSON.stringify(d)))!;
    expect(back.repairs).toEqual([]);
    expect(back.dropped).toBe(0);
    expect(parts(back.data)).toEqual(parts(d));
  });
  it('export then import returns every new part exactly', () => {
    const r = importJSON(exportJSON(d));
    expect(r.ok).toBe(true);
    expect(parts(r.data!)).toEqual(parts(d));
  });
  it('a save to storage and a load from it return them exactly, and the journal text is intact', () => {
    const fs = new Fake();
    const repo = new LocalStorageRepository(STORAGE_KEY, fs);
    expect(repo.saveSync(d, 0).ok).toBe(true);
    const r = interpret(fs.getItem(STORAGE_KEY));
    expect(r.status).toBe('ok');
    expect(parts(r.data!)).toEqual(parts(d));
    expect(r.data!.wellbeing.journal[0].text).toBe('Private words that must survive a backup.');
  });
  it('an automatic backup taken before replacing the data holds them too', () => {
    const fs = new Fake();
    const repo = new LocalStorageRepository(STORAGE_KEY, fs);
    repo.saveSync(d, 0);
    expect(repo.backup(d, 'import')).not.toBeNull();
    const b = repo.listBackups()[0];
    expect(parts(repo.readBackup(b.id)!)).toEqual(parts(d));
  });
  it('a backup written before these sections existed restores to a working app with empty new sections', () => {
    const old = JSON.parse(JSON.stringify(emptyAppData(TODAY)));
    for (const k of ['interests', 'appearance', 'reminders', 'health', 'meals', 'shopping', 'movement', 'water', 'wellbeing', 'modules', 'activities']) delete old[k];
    old.version = 2;
    const r = importJSON(JSON.stringify({ app: 'cleanflow', exportVersion: 1, schemaVersion: 2, data: old }));
    expect(r.ok).toBe(true);
    expect(r.data!.interests.items).toEqual([]);
    expect(r.data!.reminders.prefs.enabled).toBe(false);
    expect(r.data!.health.prefs.enabled).toBe(false);
    expect(r.data!.appearance.theme).toBe('system');
  });
  it('data from a newer version keeps what this version understands and is flagged', () => {
    const fut = JSON.parse(JSON.stringify(d)); fut.version = 99; fut.fromTheFuture = { a: 1 };
    const v = validateAppData(fut)!;
    expect(v.fromFuture).toBe(true);
    expect(parts(v.data)).toEqual(parts(d));
  });
});

describe('two tabs working at once on the new sections both keep their work', () => {
  // The store resolves a conflict by taking the other tab's saved data as the base and replaying this tab's own unsaved actions on it.
  const replay = (base: AppData, mine: Parameters<typeof reducer>[1][]) => mine.reduce((x, a) => reducer(x, a), base);
  const water = (id: string, ml: number) => ({ type: 'WATER_ADD', entry: { id, date: TODAY, at: `${TODAY}T0${id.length}:00:00.000Z`, ml } }) as const;

  it('water in one tab and a journal entry, an interest and a reminder setting in the other, all survive in either order', () => {
    const start = emptyAppData(TODAY);
    const tabA = [water('wa', 250), { type: 'MEAL_SAVE', entry: { id: 'ma', date: TODAY, slot: 'lunch', ref: { kind: 'recipe', id: 'lentil-soup' }, name: 'Soup', servings: 2, status: 'planned', statusAt: null, prepActivityId: null, kcal: null, note: '' } } as const];
    const tabB = [{ type: 'JOURNAL_SAVE', entry: { id: 'jb', date: TODAY, at: `${TODAY}T21:00:00.000Z`, title: 't', text: 'b' } } as const, { type: 'INTEREST_SAVE', interest: { id: 'ib', name: 'Chess', catalogId: null, category: 'games', status: 'active', goal: '', weeklyMinutes: null, note: '', createdAt: `${TODAY}T00:00:00.000Z` } } as const, { type: 'REMINDER_PREFS', patch: { enabled: true } } as const, water('wb2', 500)];
    const savedByB = replay(start, tabB);
    const mergedAB = replay(savedByB, tabA);          // A saves second: B's data is the base, A's actions replay on it
    const savedByA = replay(start, tabA);
    const mergedBA = replay(savedByA, tabB);          // B saves second
    for (const m of [mergedAB, mergedBA]) {
      expect(m.water.entries.map((e) => e.id).sort()).toEqual(['wa', 'wb2']);
      expect(m.meals.plan.map((e) => e.id)).toEqual(['ma']);
      expect(m.wellbeing.journal.map((e) => e.id)).toEqual(['jb']);
      expect(m.interests.items.map((e) => e.id)).toEqual(['ib']);
      expect(m.reminders.prefs.enabled).toBe(true);
    }
  });
  it('replaying the same actions again changes nothing (a lost acknowledgement cannot double anything)', () => {
    const acts = [water('wa', 250), { type: 'REMINDER_PREFS', patch: { leadMinutes: 15 } } as const, { type: 'HEALTH_PREFS', enabled: true } as const];
    const once = replay(emptyAppData(TODAY), acts);
    const twice = replay(once, acts);
    expect(twice.water.entries).toHaveLength(1);
    expect(twice).toEqual(once);
  });
  it('one tab removing something another tab edited keeps the deletion and drops the stale edit', () => {
    let base = emptyAppData(TODAY);
    base = reducer(base, { type: 'INTEREST_SAVE', interest: { id: 'i1', name: 'Drawing', catalogId: null, category: 'visual-art', status: 'active', goal: '', weeklyMinutes: null, note: '', createdAt: `${TODAY}T00:00:00.000Z` } });
    const deletedElsewhere = reducer(base, { type: 'INTEREST_DELETE', id: 'i1' });
    const staleStatus = reducer(deletedElsewhere, { type: 'INTEREST_STATUS', id: 'i1', status: 'paused' });
    expect(staleStatus.interests.items).toEqual([]);
  });
});
