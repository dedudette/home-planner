import { describe, expect, it } from 'vitest';
import type { AppData } from '../src/domain/types';
import { LocalStorageRepository, STORAGE_KEY, type StorageLike } from '../src/storage/repository';
import { demo } from './helpers';

class Fake implements StorageLike {
  m = new Map<string, string>();
  /** Total characters across all keys that this storage will hold. */
  quota = Infinity;
  writes = 0;
  private used(except?: string) { let n = 0; for (const [k, v] of this.m) if (k !== except) n += k.length + v.length; return n; }
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { if (this.used(k) + k.length + v.length > this.quota) throw new DOMException('full', 'QuotaExceededError'); this.writes++; this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
}
const setup = (quota = Infinity) => { const fs = new Fake(); fs.quota = quota; return { fs, repo: new LocalStorageRepository(STORAGE_KEY, fs) }; };
const good = (): AppData => demo('G', { withHistory: true });
const legacy = (): string => { const { exposures: _e, energyLog: _l, planVersions: _p, recEvents: _r, retention: _t, ...rest } = good(); void _e; void _l; void _p; void _r; void _t; return JSON.stringify({ ...rest, version: 1, _rev: 3 }); };
const backups = (fs: Fake) => JSON.parse(fs.getItem('cleanflow:backups') ?? '[]') as { id: string; reason: string; json: string }[];

describe('repeated loads do not pile up identical backups', () => {
  it('an unreadable file loaded ten times is backed up once', async () => {
    const { fs, repo } = setup();
    fs.setItem(STORAGE_KEY, '{ this is not json');
    for (let i = 0; i < 10; i++) await repo.load();
    expect(backups(fs)).toHaveLength(1);
    expect(backups(fs)[0].json).toBe('{ this is not json');
    expect(fs.getItem('cleanflow:recovery')).toBe('{ this is not json');
  });

  it('an old-version file loaded ten times is backed up once, and the original bytes are what is kept', async () => {
    const { fs, repo } = setup();
    const raw = legacy();
    fs.setItem(STORAGE_KEY, raw);
    for (let i = 0; i < 10; i++) { const r = await repo.load(); expect(r.status).toBe('migrated'); }
    expect(backups(fs)).toHaveLength(1);
    expect(backups(fs)[0].json).toBe(raw);
  });

  it('different content is a different recovery point', async () => {
    const { fs, repo } = setup();
    fs.setItem(STORAGE_KEY, 'broken one'); await repo.load();
    fs.setItem(STORAGE_KEY, 'broken two'); await repo.load();
    expect(backups(fs).map((b) => b.json)).toEqual(['broken two', 'broken one']);
  });

  it('repeating a load does not rewrite the backup list at all', async () => {
    const { fs, repo } = setup();
    fs.setItem(STORAGE_KEY, 'broken');
    await repo.load();
    const before = fs.writes;
    for (let i = 0; i < 5; i++) await repo.load();
    // each load re-stashes the raw text (one tiny write) but never touches the backup list again
    expect(backups(fs)).toHaveLength(1);
    expect(fs.writes - before).toBeLessThanOrEqual(5);
  });

  it('a pure peek touches nothing', () => {
    const { fs, repo } = setup();
    fs.setItem(STORAGE_KEY, 'broken');
    const w = fs.writes;
    expect(repo.peek().status).toBe('unreadable');
    expect(fs.writes).toBe(w);
    expect(fs.getItem('cleanflow:backups')).toBeNull();
    expect(fs.getItem('cleanflow:recovery')).toBeNull();
  });
});

describe('the most useful recovery points survive', () => {
  it('a flood of one kind of backup does not push out a different kind', () => {
    const { fs, repo } = setup();
    repo.backup('the unreadable one', 'unreadable');
    for (let i = 0; i < 6; i++) repo.backup(`import ${i}`, 'import');
    const reasons = backups(fs).map((b) => b.reason);
    expect(reasons).toHaveLength(3);
    expect(reasons).toContain('unreadable');
    expect(reasons.filter((r) => r === 'import').length).toBe(2);
    // and the newest import is the newest backup
    expect(backups(fs)[0].json).toBe('import 5');
  });

  it('when every kind is different, the oldest is the one to go', () => {
    const { fs, repo } = setup();
    repo.backup('a', 'migrated'); repo.backup('b', 'import'); repo.backup('c', 'demo'); repo.backup('d', 'restore');
    expect(backups(fs).map((b) => b.reason)).toEqual(['restore', 'demo', 'import']);
  });

  it('backing up the same bytes again returns the existing backup and changes nothing', () => {
    const { fs, repo } = setup();
    const first = repo.backup('same bytes', 'import')!;
    const w = fs.writes;
    const again = repo.backup('same bytes', 'demo')!;
    expect(again.id).toBe(first.id);
    expect(fs.writes).toBe(w);
  });

  it('restoring a backup gives back exactly what was saved', () => {
    const { repo } = setup();
    const d = good();
    const info = repo.backup(d, 'import')!;
    const back = repo.readBackup(info.id)!;
    expect(back.sessions.flatMap((s) => s.entries.map((e) => e.id))).toEqual(d.sessions.flatMap((s) => s.entries.map((e) => e.id)));
    expect(back.user.name).toBe(d.user.name);
  });
});

describe('a backup that cannot be made is reported, never faked', () => {
  it('quota failure returns null and leaves the existing backups exactly as they were', () => {
    const { fs, repo } = setup();
    repo.backup('keep me', 'import');
    const before = fs.getItem('cleanflow:backups');
    fs.quota = (fs.getItem('cleanflow:backups') ?? '').length + 'cleanflow:backups'.length + 10; // full
    expect(repo.backup('x'.repeat(5000), 'import')).toBeNull();
    expect(fs.getItem('cleanflow:backups')).toBe(before);
    expect(repo.listBackups()).toHaveLength(1);
  });

  it('no storage at all returns null', () => {
    const repo = new LocalStorageRepository(STORAGE_KEY, { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => {} });
    expect(repo.backup('x', 'import')).toBeNull();
  });

  it('when the new copy only fits by replacing the older ones, it does, and says so by returning the new one', () => {
    const { fs, repo } = setup();
    repo.backup('a'.repeat(1000), 'import');
    repo.backup('b'.repeat(1000), 'demo');
    fs.quota = 2600; // the new 1500-char copy cannot sit beside both
    const info = repo.backup('c'.repeat(1500), 'restore');
    expect(info).not.toBeNull();
    expect(backups(fs)[0].id).toBe(info!.id);
  });

  it('restoring over existing data is refused when the safety copy cannot be made, and the data is untouched', () => {
    const { fs, repo } = setup();
    const current = good();
    repo.saveSync(current, 0);
    const stored = fs.getItem(STORAGE_KEY)!;
    fs.quota = stored.length + 200; // no room for a copy of it
    const res = repo.overwrite({ ...current, user: { ...current.user, name: 'SOMEONE ELSE' } });
    expect(res.ok).toBe(false);
    expect(fs.getItem(STORAGE_KEY)).toBe(stored);
  });

  it('restoring over existing data works, and keeps a copy of what it replaced, when there is room', () => {
    const { fs, repo } = setup();
    const current = good();
    repo.saveSync(current, 0);
    const res = repo.overwrite({ ...current, user: { ...current.user, name: 'RESTORED' } });
    expect(res.ok).toBe(true);
    expect(backups(fs).some((b) => b.reason === 'before-restore' && JSON.parse(b.json).user.name === current.user.name)).toBe(true);
  });

  it('a stale writer cannot overwrite newer saved data: it is handed the newer data to merge instead', () => {
    const { fs, repo } = setup();
    const a = good();
    expect(repo.saveSync(a, 0).rev).toBe(1);
    expect(repo.saveSync({ ...a, user: { ...a.user, name: 'newer' } }, 1).rev).toBe(2);
    const stale = repo.saveSync({ ...a, user: { ...a.user, name: 'stale' } }, 1);
    expect(stale.ok).toBe(false);
    expect(stale.conflict!.user.name).toBe('newer');
    expect(JSON.parse(fs.getItem(STORAGE_KEY)!).user.name).toBe('newer');
  });
});
