import { describe, expect, it } from 'vitest';
import { addDays } from '../src/domain/dates';
import { compactHistory, describeRetention, HARD_CHARS, serializedSize, SOFT_CHARS, storageLevel, TARGET_CHARS } from '../src/domain/retention';
import type { AppData, CleaningSession, SessionEntry } from '../src/domain/types';
import { exportJSON, importJSON, interpret, LocalStorageRepository, STORAGE_KEY, type StorageLike } from '../src/storage/repository';
import { validateAppData } from '../src/storage/schema';
import { reducer } from '../src/state/reducer';
import { demo, realEntries } from './helpers';

/** A history of exactly `n` entries, three to a session, one session a day, built from real entries so each is a realistic size. */
const history = (n: number, base: AppData = demo('G', { withHistory: true })): AppData => {
  const real = realEntries();
  const sessions: CleaningSession[] = [];
  let made = 0, day = 0;
  while (made < n) {
    const date = addDays('2017-01-01', day++);
    const entries: SessionEntry[] = [];
    for (let k = 0; k < 3 && made < n; k++, made++) {
      const src = real[made % real.length];
      entries.push({ ...src, id: `e${String(made).padStart(6, '0')}`, date, at: `${date}T${String(8 + k).padStart(2, '0')}:00:00.000Z` });
    }
    sessions.push({ id: `s${day}`, date, startedAt: entries[0].at, endedAt: entries[entries.length - 1].at, entries });
  }
  return { ...base, sessions };
};
const ids = (d: AppData) => d.sessions.flatMap((s) => s.entries.map((e) => e.id));
class Fake implements StorageLike {
  m = new Map<string, string>(); quota = Infinity;
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { if ([...this.m.entries()].reduce((n, [kk, vv]) => n + (kk === k ? 0 : vv.length), 0) + v.length > this.quota) throw new DOMException('full', 'QuotaExceededError'); this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
}

describe('how fast history grows, measured', () => {
  it('a logged action costs a few hundred characters, so storage (about 5 M) fills after a few thousand', () => {
    const d = history(2000);
    const per = serializedSize(d) / 2000;
    expect(per).toBeGreaterThan(300);
    expect(per).toBeLessThan(800);
  });

  it('the thresholds leave room for backups: hard limit is well under the browser quota', () => {
    expect(SOFT_CHARS).toBeLessThan(HARD_CHARS);
    expect(TARGET_CHARS).toBeLessThanOrEqual(SOFT_CHARS);
    expect(HARD_CHARS).toBeLessThanOrEqual(3_600_000);
    expect(storageLevel(0)).toBe('ok');
    expect(storageLevel(SOFT_CHARS)).toBe('large');
    expect(storageLevel(HARD_CHARS)).toBe('full');
  });
});

describe('loading never drops history silently', () => {
  for (const n of [5000, 5001, 8000, 10000]) {
    it(`${n} entries: every one is kept by the validator and nothing is reported as repaired`, () => {
      const d = history(n);
      const v = validateAppData(JSON.parse(JSON.stringify(d)))!;
      expect(ids(v.data)).toEqual(ids(d));
      expect(v.repairs).toEqual([]);
      expect(v.dropped).toBe(0);
    });
  }

  it('over the sanity limit it keeps the NEWEST sessions and says how many older ones went', () => {
    const real = realEntries()[0];
    const sessions: CleaningSession[] = Array.from({ length: 50_050 }, (_, i) => {
      const date = addDays('1990-01-01', i);
      const e: SessionEntry = { ...real, id: `e${i}`, date, at: `${date}T10:00:00.000Z` };
      return { id: `s${i}`, date, startedAt: e.at, endedAt: e.at, entries: [e] };
    });
    const v = validateAppData({ ...demo('G'), sessions })!;
    expect(v.data.sessions).toHaveLength(50_000);
    expect(v.data.sessions[v.data.sessions.length - 1].entries[0].id).toBe('e50049'); // the newest survived
    expect(v.data.sessions[0].entries[0].id).toBe('e50');                              // the oldest 50 went
    expect(v.repairs.join(' ')).toMatch(/50 older history sessions were left out/);
  });

  it('energy history keeps the newest days, and says so', () => {
    const energyLog: Record<string, 'low'> = {};
    for (let i = 0; i < 3700; i++) energyLog[addDays('2010-01-01', i)] = 'low';
    const v = validateAppData({ ...demo('G'), energyLog })!;
    const keys = Object.keys(v.data.energyLog).sort();
    expect(keys).toHaveLength(3650);
    expect(keys[keys.length - 1]).toBe(addDays('2010-01-01', 3699));
    expect(v.repairs.join(' ')).toMatch(/50 older days of energy history/);
  });

  it('every rolling window keeps its newest items and reports the rest', () => {
    const base = demo('G', { withHistory: true });
    const ex = base.exposures[0] ?? { date: '2026-01-01', recordedAt: '2026-01-01T00:00:00.000Z', planVersion: 'p', activeDay: true, energy: 'ok', tzOffsetMin: 0, budgetMinutes: 30, items: [] };
    const many = Array.from({ length: 130 }, (_, i) => ({ ...ex, date: addDays('2026-01-01', i) }));
    const v = validateAppData({ ...base, exposures: many })!;
    expect(v.data.exposures).toHaveLength(120);
    expect(v.data.exposures[119].date).toBe(addDays('2026-01-01', 129));
    expect(v.repairs.join(' ')).toMatch(/10 older days of what was shown/);
  });

  it('the person\'s own tasks and supplies are never dropped without a word either', () => {
    const base = demo('G');
    const customTasks = Array.from({ length: 510 }, (_, i) => ({ id: `c${i}`, name: `Task ${i}`, roomId: 'other', frequency: 'weekly', minutes: 5, priority: 'LOW', notes: '', startDate: '2026-01-01', createdAt: '2026-01-01' }));
    const v = validateAppData({ ...base, customTasks })!;
    expect(v.data.customTasks).toHaveLength(500);
    expect(v.repairs.join(' ')).toMatch(/10 of your own tasks were left out/);
  });
});

describe('compaction: the only thing that removes history', () => {
  for (const n of [5000, 5001, 8000, 10000]) {
    it(`${n} entries: the newest are kept in order, the oldest go only if needed, and the reduction is recorded`, () => {
      const d = history(n);
      const before = serializedSize(d);
      const c = compactHistory(d, TARGET_CHARS, '2026-10-05T00:00:00.000Z');
      const kept = ids(c.data);
      const all = ids(d);
      // always the newest suffix, never a gap
      expect(kept).toEqual(all.slice(all.length - kept.length));
      expect(kept[kept.length - 1]).toBe(all[all.length - 1]);
      expect(c.removedEntries + kept.length).toBe(n);
      if (before <= TARGET_CHARS) {
        expect(c.removedEntries).toBe(0);
        expect(c.data).toBe(d);                       // nothing touched, not even copied
        expect(c.data.retention).toEqual([]);         // and no note, because nothing was removed
      } else {
        expect(c.removedEntries).toBeGreaterThan(0);
        expect(serializedSize(c.data)).toBeLessThanOrEqual(TARGET_CHARS);
        const note = c.data.retention[c.data.retention.length - 1];
        expect(note).toMatchObject({ removedEntries: c.removedEntries, removedSessions: c.removedSessions, removedThrough: c.removedThrough, oldestKept: c.oldestKept });
        expect(c.data.sessions[0].date).toBe(note.oldestKept);
        expect(note.removedThrough < note.oldestKept).toBe(true);
        expect(describeRetention(note)).toContain(note.oldestKept);
      }
    });
  }

  it('up to a few thousand entries the app only suggests a download; it asks to remove history only past the hard limit', () => {
    const level = (n: number) => storageLevel(serializedSize(history(n)));
    expect(level(1000)).toBe('ok');
    expect(level(5000)).toBe('large');   // nothing is removed or offered to be removed automatically
    expect(level(5001)).toBe('large');
    expect(level(8000)).toBe('full');    // here the app asks, with a download offered first
    expect(level(10000)).toBe('full');
    // "large" data is intact on load, and a person who chooses "make room" still gets the newest kept
    expect(compactHistory(history(5000)).removedEntries).toBeGreaterThan(0);
    expect(compactHistory(history(10000)).removedEntries).toBeGreaterThan(compactHistory(history(8000)).removedEntries);
  });

  it('a full download made before compaction still has every entry (export first, then remove)', () => {
    const d = history(8000);
    const text = exportJSON(d);
    compactHistory(d);
    const back = importJSON(text);
    expect(back.ok).toBe(true);
    expect(ids(back.data!)).toEqual(ids(d));
  });

  it('is idempotent, and safe to replay on top of newer data', () => {
    const d = history(8000);
    const once = compactHistory(d).data;
    expect(compactHistory(once).removedEntries).toBe(0);
    expect(compactHistory(once).data).toBe(once);
    // replayed onto a base that another tab already extended, it still keeps the newest
    const extended = reducer(d, { type: 'COMPACT_HISTORY', at: '2026-10-05T00:00:00.000Z' });
    expect(ids(extended)[ids(extended).length - 1]).toBe(ids(d)[ids(d).length - 1]);
    expect(serializedSize(extended)).toBeLessThanOrEqual(TARGET_CHARS);
  });

  it('keeps everything that is not history: plan, home, settings, tasks', () => {
    const d = history(8000);
    const c = compactHistory(d).data;
    expect(c.home).toBe(d.home);
    expect(c.preferences).toBe(d.preferences);
    expect(c.taskStates).toBe(d.taskStates);
    expect(c.customTasks).toBe(d.customTasks);
    expect(c.exposures).toBe(d.exposures);
  });

  it('retention notes survive saving and loading, so analysis can tell where the data really starts', () => {
    const c = compactHistory(history(8000), TARGET_CHARS, '2026-10-05T00:00:00.000Z').data;
    const fs = new Fake();
    const repo = new LocalStorageRepository(STORAGE_KEY, fs);
    expect(repo.saveSync(c, 0).ok).toBe(true);
    const r = interpret(fs.getItem(STORAGE_KEY));
    expect(r.status).toBe('ok');
    expect(r.data!.retention).toEqual(c.retention);
    expect(r.bytes).toBe(fs.getItem(STORAGE_KEY)!.length);
  });

  it('after compaction a long history fits in the browser quota with room to spare for backups', () => {
    const fs = new Fake(); fs.quota = 5_000_000;
    const repo = new LocalStorageRepository(STORAGE_KEY, fs);
    const c = compactHistory(history(10000)).data;
    expect(repo.saveSync(c, 0).ok).toBe(true);
    expect(repo.backup(c, 'test')).not.toBeNull();   // a safety copy fits next to it
  });

  it('a payload that is too big for storage fails loudly (quota), it does not pretend to save', () => {
    const fs = new Fake(); fs.quota = 3_000_000;
    const repo = new LocalStorageRepository(STORAGE_KEY, fs);
    const res = repo.saveSync(history(8000), 0);
    expect(res.ok).toBe(false);
    expect(res.error).toBe('quota');
  });
});
