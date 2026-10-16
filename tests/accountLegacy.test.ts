import { describe, expect, it } from 'vitest';
import { accountHasOwnData, legacyNoticeSeen, markLegacyNoticeSeen, readLegacyData, shouldShowLegacyNotice } from '../src/account/legacy';
import { emptyAppData } from '../src/domain/appdata';
import { nsKey, setNamespace } from '../src/storage/namespace';
import { LocalStorageRepository, STORAGE_KEY, type StorageLike } from '../src/storage/repository';
import { reducer } from '../src/state/reducer';
import { TODAY } from './helpers';

class Fake implements StorageLike {
  m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
}
const withData = () => reducer({ ...emptyAppData(TODAY), onboardingComplete: true }, { type: 'WATER_ADD', entry: { id: 'w1', date: TODAY, at: `${TODAY}T09:00:00.000Z`, ml: 300 } });
const seedLegacy = (fs: Fake) => { new LocalStorageRepository(STORAGE_KEY, fs).saveSync(withData(), 0); };

describe('data saved before accounts is never touched by account code', () => {
  it('there is nothing to show when the device holds no data, or only an empty plan', () => {
    const fs = new Fake();
    expect(readLegacyData(fs)).toBeNull();
    new LocalStorageRepository(STORAGE_KEY, fs).saveSync(emptyAppData(TODAY), 0);
    expect(readLegacyData(fs)).toBeNull();
  });
  it('reading it is read-only: no key is written, no backup is made', () => {
    const fs = new Fake();
    seedLegacy(fs);
    const before = JSON.stringify([...fs.m]);
    const r = readLegacyData(fs);
    expect(r).not.toBeNull();
    expect(r!.data.water.entries).toHaveLength(1);
    expect(JSON.stringify([...fs.m])).toBe(before);
  });
  it('unreadable or foreign text under the old key is ignored without throwing or being altered', () => {
    const fs = new Fake();
    fs.setItem(STORAGE_KEY, '{not json');
    expect(readLegacyData(fs)).toBeNull();
    expect(fs.getItem(STORAGE_KEY)).toBe('{not json');
  });
  it('two accounts on one device use different keys and cannot see each other, or the old data', () => {
    const fs = new Fake();
    seedLegacy(fs);
    const a = new LocalStorageRepository(`${STORAGE_KEY}@alice`, fs);
    const b = new LocalStorageRepository(`${STORAGE_KEY}@bob`, fs);
    expect(a.peek().status).toBe('empty');
    a.saveSync(reducer({ ...emptyAppData(TODAY), onboardingComplete: true }, { type: 'WATER_ADD', entry: { id: 'a1', date: TODAY, at: `${TODAY}T10:00:00.000Z`, ml: 500 } }), 0);
    expect(b.peek().status).toBe('empty');
    expect(a.peek().data!.water.entries.map((e) => e.id)).toEqual(['a1']);
    expect(readLegacyData(fs)!.data.water.entries.map((e) => e.id)).toEqual(['w1']);      // the old copy is unchanged by an account's writes
    // An account's backups and recovery copy are its own as well.
    a.backup(withData(), 'import');
    expect(a.listBackups()).toHaveLength(1);
    expect(b.listBackups()).toHaveLength(0);
    expect(new LocalStorageRepository(STORAGE_KEY, fs).listBackups()).toHaveLength(0);
    // Erasing an account's data leaves the old copy and the other account alone.
    void a.clear();
    expect(readLegacyData(fs)).not.toBeNull();
  });
  it('the "your earlier data is safe" screen appears once: old data exists, the account has none yet, and it was not shown before', () => {
    const fs = new Fake();
    expect(shouldShowLegacyNotice('u1', fs)).toBe(false);          // nothing old
    seedLegacy(fs);
    expect(shouldShowLegacyNotice('u1', fs)).toBe(true);
    expect(legacyNoticeSeen('u1', fs)).toBe(false);
    markLegacyNoticeSeen('u1', fs);
    expect(shouldShowLegacyNotice('u1', fs)).toBe(false);
    expect(shouldShowLegacyNotice('u2', fs)).toBe(true);           // another account on the same device is told once as well
    new LocalStorageRepository(`${STORAGE_KEY}@u2`, fs).saveSync(withData(), 0);
    expect(accountHasOwnData('u2', fs)).toBe(true);
    expect(shouldShowLegacyNotice('u2', fs)).toBe(false);          // an account that already has its own data does not need it
  });
  it('device keys follow the signed-in account, and go back to the originals in local mode', () => {
    setNamespace('abc');
    expect(nsKey('cleanflow:timer')).toBe('cleanflow:timer@abc');
    expect(nsKey(STORAGE_KEY)).toBe('cleanflow:v1@abc');
    setNamespace(null);
    expect(nsKey('cleanflow:timer')).toBe('cleanflow:timer');
    expect(nsKey(STORAGE_KEY)).toBe(STORAGE_KEY);
  });
});
