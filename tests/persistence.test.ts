import { describe, expect, it } from 'vitest';
import { buildView, todayPlan, weekPlan } from '../src/domain/view';
import { generatePlan } from '../src/domain/engine';
import { computeProgress } from '../src/domain/progress';
import { computeInsights, needsFreshStart } from '../src/domain/learning';
import { timeBox, resetSequence } from '../src/domain/modes';
import { pickJustFive } from '../src/domain/micro';
import type { AppData } from '../src/domain/types';
import { EXPORT_VERSION, LocalStorageRepository, exportJSON, importJSON, interpret, normalizeAppData, STORAGE_KEY, type StorageLike } from '../src/storage/repository';
import { SCHEMA_VERSION, validateAppData } from '../src/storage/schema';
import { demo, TODAY } from './helpers';

class FakeStorage implements StorageLike {
  m = new Map<string, string>();
  quota = Infinity;
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) {
    if (v.length > this.quota) throw new DOMException('full', 'QuotaExceededError');
    this.m.set(k, v);
  }
  removeItem(k: string) { this.m.delete(k); }
}

const good = (): AppData => demo('G', { withHistory: true });
/** What a v1 install actually has on disk: no analytics fields, version 1. */
const legacyV1 = (d: AppData = good()) => {
  const { exposures: _e, energyLog: _l, planVersions: _p, recEvents: _r, ...rest } = d;
  void _e; void _l; void _p; void _r;
  const { levelSince: _ls, ...prefs } = d.preferences;
  void _ls;
  return { ...rest, version: 1, preferences: prefs };
};
const entryCount = (d: AppData) => d.sessions.reduce((n, s) => n + s.entries.length, 0);

/** Every screen's selectors, run on whatever came out of the validator. None may throw. */
const exercise = (d: AppData) => {
  const plan = generatePlan(d.home, d.preferences, d.plan);
  const v = buildView(d, plan, TODAY);
  todayPlan(v); weekPlan(v, TODAY); computeProgress(v); computeInsights(v); needsFreshStart(v); timeBox(v, 30); resetSequence(d); pickJustFive(d);
};

describe('versioned load: valid data is never silently wiped', () => {
  it('an empty store loads as empty', async () => {
    const r = await new LocalStorageRepository(STORAGE_KEY, new FakeStorage()).load();
    expect(r.status).toBe('empty');
    expect(r.data).toBeNull();
  });

  it('a version-1 file is migrated to the current version with every completion intact', async () => {
    const st = new FakeStorage();
    const before = good();
    st.setItem(STORAGE_KEY, JSON.stringify(legacyV1(before)));
    const r = await new LocalStorageRepository(STORAGE_KEY, st).load();
    expect(r.status).toBe('migrated');
    expect(r.data!.version).toBe(SCHEMA_VERSION);
    expect(entryCount(r.data!)).toBe(entryCount(before));
    expect(r.data!.preferences.focus).toEqual(before.preferences.focus);
    expect(r.data!.exposures).toEqual([]); // new fields exist, empty
    expect(r.data!.preferences.levelSince).toBe(before.plan.startDate);
  });

  it('a file with no version at all is treated as version 1, not thrown away', () => {
    const raw = legacyV1() as Record<string, unknown>;
    delete raw.version;
    const r = interpret(JSON.stringify(raw));
    expect(r.status).toBe('migrated');
    expect(r.data).not.toBeNull();
  });

  it('data from a NEWER version is read as far as possible, kept, and backed up before anything can overwrite it', async () => {
    const st = new FakeStorage();
    const future = { ...good(), version: 99, somethingNew: { a: 1 } };
    const txt = JSON.stringify(future);
    st.setItem(STORAGE_KEY, txt);
    const repo = new LocalStorageRepository(STORAGE_KEY, st);
    const r = await repo.load();
    expect(r.status).toBe('newer');
    expect(r.data).not.toBeNull();
    expect(entryCount(r.data!)).toBe(entryCount(good()));
    expect(st.getItem(STORAGE_KEY)).toBe(txt); // the original bytes are untouched by loading
    const b = repo.listBackups();
    expect(b).toHaveLength(1);
    expect(b[0].reason).toBe('newer');
  });

  it('unreadable text is kept, stashed and reported, never replaced by an empty app', async () => {
    const st = new FakeStorage();
    st.setItem(STORAGE_KEY, '{"version":1,"sessions":[');
    const repo = new LocalStorageRepository(STORAGE_KEY, st);
    const r = await repo.load();
    expect(r.status).toBe('unreadable');
    expect(r.raw).toBe('{"version":1,"sessions":[');
    expect(st.getItem(STORAGE_KEY)).toBe('{"version":1,"sessions":[');
    expect(st.getItem('cleanflow:recovery')).toBe('{"version":1,"sessions":[');
    // "start fresh" removes only the main key; the copy survives
    repo.dropMain();
    expect(st.getItem(STORAGE_KEY)).toBeNull();
    expect(st.getItem('cleanflow:recovery')).toBe('{"version":1,"sessions":[');
  });

  it('JSON that is not CleanFlow data at all is unreadable rather than "empty"', () => {
    expect(interpret('{"hello":"world"}').status).toBe('unreadable');
    expect(interpret('[1,2,3]').status).toBe('unreadable');
    expect(interpret('"just a string"').status).toBe('unreadable');
    expect(interpret('null').status).toBe('unreadable');
  });

  it('validation is idempotent and a clean current file is reported as ok', () => {
    const d = good();
    const once = validateAppData(JSON.parse(JSON.stringify(d)))!;
    const twice = validateAppData(JSON.parse(JSON.stringify(once.data)))!;
    expect(twice.data).toEqual(once.data);
    expect(interpret(JSON.stringify(d)).status).toBe('ok');
  });
});

describe('malformed saved data can no longer crash the app', () => {
  const cases: [string, (d: Record<string, unknown>) => unknown][] = [
    ['sessions is a string', (d) => ({ ...d, sessions: 'x' })],
    ['sessions is an object', (d) => ({ ...d, sessions: {} })],
    ['session without entries', (d) => ({ ...d, sessions: [{ id: 'a', date: TODAY }] })],
    ['session.entries is null', (d) => ({ ...d, sessions: [{ id: 'a', date: TODAY, entries: null }] })],
    ['entry is null', (d) => ({ ...d, sessions: [{ id: 'a', date: TODAY, entries: [null, 5, 'x'] }] })],
    ['entry has bad outcome and bad dates', (d) => ({ ...d, sessions: [{ id: 'a', date: 'zzz', entries: [{ id: 'e', at: 'zz', date: 'zzz', taskId: 't', outcome: 'exploded' }] }] })],
    ['custom task is null', (d) => ({ ...d, customTasks: [null] })],
    ['custom task is missing fields', (d) => ({ ...d, customTasks: [{ id: 'c', name: 'x' }] })],
    ['taskStates is an array', (d) => ({ ...d, taskStates: [] })],
    ['taskStates holds null', (d) => ({ ...d, taskStates: { 'x:y': null, 'a:b': { due: 'nonsense', doneCount: 'many' } } })],
    ['home.rooms is a string', (d) => ({ ...d, home: { ...(d.home as object), rooms: 'x' } })],
    ['home.pets is null', (d) => ({ ...d, home: { ...(d.home as object), pets: null } })],
    ['home is a number', (d) => ({ ...d, home: 42 })],
    ['focus is a string', (d) => ({ ...d, preferences: { ...(d.preferences as object), focus: 'home' } })],
    ['focus holds unknown values', (d) => ({ ...d, preferences: { ...(d.preferences as object), focus: ['bogus', 7] } })],
    ['sessionMinutes is text', (d) => ({ ...d, preferences: { ...(d.preferences as object), sessionMinutes: 'abc' } })],
    ['sessionMinutes is negative', (d) => ({ ...d, preferences: { ...(d.preferences as object), sessionMinutes: -5 } })],
    ['daysPerWeek is 99', (d) => ({ ...d, preferences: { ...(d.preferences as object), daysPerWeek: 99 } })],
    ['lifeLevel is 9', (d) => ({ ...d, preferences: { ...(d.preferences as object), lifeLevel: 9 } })],
    ['fitnessLevel is unknown', (d) => ({ ...d, preferences: { ...(d.preferences as object), fitnessLevel: 'bogus' } })],
    ['plan.startDate is garbage', (d) => ({ ...d, plan: { startDate: 'not-a-date', resetCount: 'x' } })],
    ['supplies is null', (d) => ({ ...d, supplies: null })],
    ['resetRun is junk', (d) => ({ ...d, resetRun: { startedAt: 1 } })],
    ['dismissedInsights is an array', (d) => ({ ...d, dismissedInsights: [] })],
    ['exposures hold junk', (d) => ({ ...d, exposures: [null, { date: 'x' }, { date: TODAY, items: 'no' }] })],
    ['recEvents hold junk', (d) => ({ ...d, recEvents: [{}, null, { id: 1 }] })],
  ];
  for (const [name, mutate] of cases) {
    it(`survives: ${name}`, () => {
      const v = validateAppData(mutate(JSON.parse(JSON.stringify(good()))));
      expect(v, 'recognisable data must be repaired, not rejected').not.toBeNull();
      expect(() => exercise(v!.data)).not.toThrow();
    });
  }

  it('repairs are explained in plain language and clamp to sane values', () => {
    const d = JSON.parse(JSON.stringify(good()));
    d.preferences.sessionMinutes = -5; d.preferences.focus = ['nope']; d.plan.startDate = 'garbage';
    const v = validateAppData(d, TODAY)!;
    expect(v.data.preferences.sessionMinutes).toBe(5);
    expect(v.data.preferences.focus).toEqual(['home']);
    expect(v.data.plan.startDate).toBe(TODAY);
    expect(v.repairs.length).toBeGreaterThan(0);
  });

  it('bad history items are dropped and counted; good ones survive', () => {
    const d = JSON.parse(JSON.stringify(good()));
    const before = entryCount(good());
    d.sessions.push({ id: 'bad', date: TODAY, entries: [null, { nope: true }] });
    d.sessions[0].entries.push(null);
    const v = validateAppData(d)!;
    expect(entryCount(v.data)).toBe(before);
    expect(v.dropped).toBeGreaterThan(0);
  });
});

describe('concurrent writers and failing storage', () => {
  it('a stale writer is told about a newer save instead of overwriting it', async () => {
    const st = new FakeStorage();
    const a = new LocalStorageRepository(STORAGE_KEY, st);
    const b = new LocalStorageRepository(STORAGE_KEY, st);
    const base = good();
    await a.load(); await b.load(); // both see an empty store (rev 0)
    const ra = await a.save(base, 0);
    expect(ra.ok).toBe(true);
    const mine = { ...base, user: { ...base.user, name: 'From tab B' } };
    const rb = await b.save(mine, 0);
    expect(rb.ok).toBe(false);
    expect(rb.conflict?.user.name).toBe(base.user.name); // tab A's data, ready to merge with
    const merged = await b.save(mine, rb.rev); // after merging it saves with the new base
    expect(merged.ok).toBe(true);
    expect(interpret(st.getItem(STORAGE_KEY)).data!.user.name).toBe('From tab B');
  });

  it('a full disk is reported, not swallowed, and the previous save stays intact', async () => {
    const st = new FakeStorage();
    const repo = new LocalStorageRepository(STORAGE_KEY, st);
    const d = good();
    expect((await repo.save(d, 0)).ok).toBe(true);
    const saved = st.getItem(STORAGE_KEY);
    st.quota = 10;
    const r = await repo.save({ ...d, user: { ...d.user, name: 'x' } }, 1);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('quota');
    expect(st.getItem(STORAGE_KEY)).toBe(saved);
  });

  it('keeps a few automatic backups, newest first, and can read them back', () => {
    const st = new FakeStorage();
    const repo = new LocalStorageRepository(STORAGE_KEY, st);
    for (let i = 0; i < 5; i++) repo.backup({ ...good(), user: { ...good().user, name: `v${i}` } }, 'demo');
    const list = repo.listBackups();
    expect(list).toHaveLength(3);
    expect(repo.readBackup(list[0].id)!.user.name).toBe('v4');
    expect(repo.readBackup('nope')).toBeNull();
  });

  it('overwrite (restore) backs up what it replaces; clear erases everything including backups', async () => {
    const st = new FakeStorage();
    const repo = new LocalStorageRepository(STORAGE_KEY, st);
    await repo.save(good(), 0);
    repo.overwrite({ ...good(), user: { ...good().user, name: 'Restored' } });
    expect(repo.listBackups().some((b) => b.reason === 'before-restore')).toBe(true);
    await repo.clear();
    expect([...st.m.keys()]).toEqual([]);
  });
});

describe('versioned export and import', () => {
  it('exports a self-describing envelope that imports back to the same data', () => {
    const d = good();
    const parsed = JSON.parse(exportJSON(d));
    expect(parsed.app).toBe('cleanflow');
    expect(parsed.exportVersion).toBe(EXPORT_VERSION);
    expect(parsed.schemaVersion).toBe(SCHEMA_VERSION);
    const r = importJSON(exportJSON(d));
    expect(r.ok).toBe(true);
    expect(entryCount(r.data!)).toBe(entryCount(d));
    expect(r.summary!.entries).toBe(entryCount(d));
  });

  it('still imports the bare, unversioned files that older versions exported', () => {
    const r = importJSON(JSON.stringify(legacyV1()));
    expect(r.ok).toBe(true);
    expect(r.foundVersion).toBe(1);
    expect(r.data!.version).toBe(SCHEMA_VERSION);
  });

  it('rejects junk with a message instead of throwing', () => {
    for (const junk of ['', 'not json', '{}', '[]', 'null', '{"app":"cleanflow"}', '{"app":"cleanflow","data":5}']) {
      const r = importJSON(junk);
      expect(r.ok, junk).toBe(false);
      expect(r.error).toBeTruthy();
    }
  });

  it('normalizeAppData keeps working for older callers', () => {
    expect(normalizeAppData(legacyV1())).not.toBeNull();
    expect(normalizeAppData('x')).toBeNull();
  });
});
