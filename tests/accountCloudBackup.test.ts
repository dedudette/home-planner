import { describe, expect, it } from 'vitest';
import type { BackupMeta } from '../src/account/api';
import {
  clearCloudRecord, clearPending, cloudPendingKey, cloudRecordKey, conflictCurrent, formatSize, includesLine, readCloudRecord, readPending,
  uploadVerdict, writeCloudRecord, writePending,
} from '../src/account/cloudBackup';
import type { StorageLike } from '../src/storage/repository';

class Fake implements StorageLike {
  m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
}
const meta = (revision: number, includes: BackupMeta['includes'] = []): BackupMeta => ({ revision, includes, sizeBytes: 2048, schemaVersion: 3, updatedAt: '2026-10-17T10:00:00.000Z' });

describe('what this device remembers about the cloud copy', () => {
  it('is kept per account, so two accounts on one device never share it', () => {
    const fs = new Fake();
    writeCloudRecord(cloudRecordKey('a'), meta(3, ['journal']), fs);
    expect(readCloudRecord(cloudRecordKey('a'), fs)).toEqual({ revision: 3, at: '2026-10-17T10:00:00.000Z', includes: ['journal'] });
    expect(readCloudRecord(cloudRecordKey('b'), fs)).toBeNull();
    clearCloudRecord(cloudRecordKey('a'), fs);
    expect(readCloudRecord(cloudRecordKey('a'), fs)).toBeNull();
  });
  it('a damaged or invented record is ignored', () => {
    const fs = new Fake();
    for (const bad of ['{', '"x"', '{"revision":0,"at":"x","includes":[]}', '{"revision":1.5,"at":"x","includes":[]}', '{"revision":2,"includes":[]}']) {
      fs.setItem(cloudRecordKey('a'), bad);
      expect(readCloudRecord(cloudRecordKey('a'), fs)).toBeNull();
    }
    fs.setItem(cloudRecordKey('a'), '{"revision":2,"at":"x","includes":["journal","secrets",7]}');
    expect(readCloudRecord(cloudRecordKey('a'), fs)?.includes).toEqual(['journal']);
  });
  it('an upload whose outcome was never learned is remembered until the person has been told', () => {
    const fs = new Fake();
    expect(writePending(cloudPendingKey('a'), { startedAt: '2026-10-17T10:00:00.000Z', baseRevision: null, includes: [] }, fs)).toBe(true);
    expect(readPending(cloudPendingKey('a'), fs)).toEqual({ startedAt: '2026-10-17T10:00:00.000Z', baseRevision: null, includes: [] });
    expect(readPending(cloudPendingKey('b'), fs)).toBeNull();
    clearPending(cloudPendingKey('a'), fs);
    expect(readPending(cloudPendingKey('a'), fs)).toBeNull();
  });
  it('a blocked store does not break anything: writes report failure, reads give nothing', () => {
    const blocked: StorageLike = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
    expect(writeCloudRecord('k', meta(1), blocked)).toBe(false);
    expect(readCloudRecord('k', blocked)).toBeNull();
    expect(() => clearCloudRecord('k', blocked)).not.toThrow();
  });
});

describe('which upload this is, from what the cloud holds and what this device last saw', () => {
  const seen = (revision: number) => ({ revision, at: 'x', includes: [] as BackupMeta['includes'] });
  it('nothing there, nothing ever seen: a first backup with no base revision', () => {
    expect(uploadVerdict(null, null)).toEqual({ kind: 'first', base: null });
  });
  it('the cloud copy is the one this device last saw: replace it', () => {
    expect(uploadVerdict(seen(4), meta(4))).toEqual({ kind: 'update', base: 4 });
  });
  it('anything else is a conflict, named for what happened, and none of them uploads on its own', () => {
    expect(uploadVerdict(null, meta(1))).toEqual({ kind: 'unseen' });
    expect(uploadVerdict(seen(2), meta(5))).toEqual({ kind: 'changed' });
    expect(uploadVerdict(seen(2), meta(1))).toEqual({ kind: 'changed' });     // not "older is fine": any difference is a difference
    expect(uploadVerdict(seen(2), null)).toEqual({ kind: 'deleted' });
  });
});

describe('reading the server’s refusal and describing sizes', () => {
  it('takes the current copy out of a conflict answer, including "it was deleted"', () => {
    expect(conflictCurrent({ current: meta(7, ['health']) })?.revision).toBe(7);
    expect(conflictCurrent({ current: null })).toBeNull();
    expect(conflictCurrent({})).toBeUndefined();
    expect(conflictCurrent({ current: { revision: 'x' } })).toBeUndefined();
  });
  it('writes sizes and choices in words', () => {
    expect(formatSize(500)).toBe('500 bytes');
    expect(formatSize(2048)).toBe('2 KB');
    expect(formatSize(3 * 1024 * 1024)).toBe('3.0 MB');
    expect(includesLine([])).toMatch(/no journal, no health/);
    expect(includesLine(['journal', 'health'])).toMatch(/journal.*health/);
  });
});
