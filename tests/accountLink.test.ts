import { describe, expect, it, vi } from 'vitest';
import { cloudPendingKey, cloudRecordKey } from '../src/account/cloudBackup';
import { LEGACY_CLAIM_KEY, forgetAccountOnDevice, hashData, intentKey, intentOutcome, linkSituation, performLink, readClaim, readIntent, readLegacy, settleIntent, undoClaim, type LinkEnv } from '../src/account/link';
import { emptyAppData } from '../src/domain/appdata';
import { appDataForDemo, DEMO_PROFILES } from '../src/domain/demo';
import type { AppData } from '../src/domain/types';
import { reducer } from '../src/state/reducer';
import { sameData } from '../src/storage/backupPlan';
import { LocalStorageRepository, STORAGE_KEY, type StorageLike } from '../src/storage/repository';
import { validateAppData } from '../src/storage/schema';
import { TODAY } from './helpers';

class Fake implements StorageLike {
  m = new Map<string, string>();
  /** Writes to these keys (exactly, or a key ending with ":backups" when given as such) fail the way a full or blocked store does. */
  failOn: string[] = [];
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) {
    if (this.failOn.some((f) => (f.startsWith(':') ? k.endsWith(f) : k === f))) throw new DOMException('full', 'QuotaExceededError');
    this.m.set(k, v);
  }
  removeItem(k: string) { this.m.delete(k); }
}

const plan = (name: string, ml: number): AppData => {
  let d: AppData = { ...emptyAppData(TODAY), onboardingComplete: true, user: { ...emptyAppData(TODAY).user, name } };
  d = reducer(d, { type: 'WATER_ADD', entry: { id: `w-${name}`, date: TODAY, at: `${TODAY}T09:00:00.000Z`, ml } });
  d = reducer(d, { type: 'JOURNAL_SAVE', entry: { id: `j-${name}`, date: TODAY, at: `${TODAY}T21:00:00.000Z`, title: 't', text: `private ${name}` } });
  return d;
};

/** A stand-in for the running app: it holds a plan in memory and writes it through the real repository when flushed. */
const world = (accountId = 'acc1') => {
  const fs = new Fake();
  const repo = new LocalStorageRepository(`${STORAGE_KEY}@${accountId}`, fs);
  const app = { data: emptyAppData(TODAY) as AppData, rev: 0 };
  const calls: string[] = [];
  const env = (over: Partial<LinkEnv> = {}): LinkEnv => ({
    storage: fs, accountId, repo, current: app.data,
    replace: (next) => { calls.push('replace'); app.data = next; return true; },
    revert: (prev) => { calls.push('revert'); app.data = prev; },
    flush: () => { calls.push('flush'); const r = repo.saveSync(app.data, app.rev); if (r.ok) app.rev = r.rev; },
    now: () => new Date('2026-10-17T10:00:00.000Z'),
    ...over,
  });
  const seedLegacy = (d: AppData) => { new LocalStorageRepository(STORAGE_KEY, fs).saveSync(d, 0); };
  return { fs, repo, app, calls, env, seedLegacy };
};

describe('reading the data from before accounts', () => {
  it('finds nothing in an empty browser, and nothing in an untouched empty plan', () => {
    const w = world();
    expect(readLegacy(w.fs).kind).toBe('none');
    w.seedLegacy(emptyAppData(TODAY));
    expect(readLegacy(w.fs).kind).toBe('none');
  });
  it('describes real data without changing a thing', () => {
    const w = world();
    w.seedLegacy(plan('old', 300));
    const before = JSON.stringify([...w.fs.m]);
    const r = readLegacy(w.fs);
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') expect(r.legacy.counts).toMatchObject({ waterEntries: 1, journalEntries: 1, name: 'old' });
    expect(JSON.stringify([...w.fs.m])).toBe(before);
  });
  it('unreadable text is reported as unreadable, kept exactly, and cannot be copied', () => {
    const w = world();
    w.fs.setItem(STORAGE_KEY, '{broken');
    const r = readLegacy(w.fs);
    expect(r.kind).toBe('unreadable');
    expect(w.fs.getItem(STORAGE_KEY)).toBe('{broken');
    expect(linkSituation({ read: r, own: emptyAppData(TODAY), accountId: 'acc1', claim: null }).kind).toBe('unreadable');
  });
  it('a fingerprint is stable, ignores the revision counter, and survives being validated again (so a read-back comparison is sound)', () => {
    const d = appDataForDemo(DEMO_PROFILES[0].id, { today: TODAY, withHistory: true });
    const once = validateAppData(d)!.data;
    const twice = validateAppData(once)!.data;
    expect(hashData(twice)).toBe(hashData(once));
    expect(hashData({ ...once, _rev: 9 } as AppData)).toBe(hashData(once));
    expect(hashData(plan('a', 1))).not.toBe(hashData(plan('a', 2)));
  });
});

describe('what the person is shown, from the facts', () => {
  const legacy = plan('old', 300);
  const read = () => { const w = world(); w.seedLegacy(legacy); return readLegacy(w.fs); };
  const sit = (own: AppData, claim: Parameters<typeof linkSituation>[0]['claim'] = null, id = 'acc1') => linkSituation({ read: read(), own, accountId: id, claim });

  it('an account with no plan yet is "ready": copying replaces nothing', () => {
    const s = sit(emptyAppData(TODAY));
    expect(s.kind).toBe('ready');
    expect(s.own).toBeNull();
    expect(s.claimedByOther).toBe(false);
  });
  it('an account that already has a different plan is "replace", never copied over silently', () => {
    expect(sit(plan('mine', 500)).kind).toBe('replace');
  });
  it('an account that already holds exactly this data has nothing to copy', () => {
    expect(sit(structuredClone(validateAppData(legacy)!.data)).kind).toBe('identical');
  });
  it('after a copy, once the account has moved on, it says so rather than offering a silent re-copy', () => {
    const claim = { accountId: 'acc1', at: '2026-10-01T00:00:00.000Z', hash: hashData(validateAppData(legacy)!.data) };
    expect(sit(plan('moved on', 9), claim).kind).toBe('linked');
  });
  it('data already copied into a different account is flagged, so a second copy is only ever made knowingly', () => {
    const claim = { accountId: 'someone-else', at: '2026-10-01T00:00:00.000Z', hash: hashData(validateAppData(legacy)!.data) };
    expect(sit(emptyAppData(TODAY), claim).claimedByOther).toBe(true);
    expect(sit(emptyAppData(TODAY), claim, 'someone-else').claimedByOther).toBe(false);
  });
});

describe('copying into an account', () => {
  const legacy = plan('old', 300);

  it('into an empty account: the account gets a copy, the original is unchanged, restore points exist, and nothing is uploaded', () => {
    const w = world();
    w.seedLegacy(legacy);
    const originalText = w.fs.getItem(STORAGE_KEY);
    const r = readLegacy(w.fs);
    if (r.kind !== 'ok') throw new Error('no legacy');
    const res = performLink(w.env(), r.legacy, 'copy');
    expect(res).toMatchObject({ ok: true, keptPrevious: false });
    expect(sameData(w.repo.peek().data, r.legacy.data)).toBe(true);
    expect(w.fs.getItem(STORAGE_KEY)).toBe(originalText);                       // byte for byte
    const points = w.repo.listBackups();
    expect(points.map((p) => p.reason)).toEqual(['device-copy']);
    expect(sameData(w.repo.readBackup(points[0].id), r.legacy.data)).toBe(true);
    expect(readClaim(w.fs)).toMatchObject({ accountId: 'acc1', hash: hashData(r.legacy.data) });
    expect(readIntent('acc1', w.fs)).toBeNull();
    expect(w.calls).toEqual(['replace', 'flush']);
  });

  it('replacing an account’s plan keeps that plan as a restore point you can bring back', () => {
    const w = world();
    w.seedLegacy(legacy);
    const mine = plan('mine', 500);
    w.app.data = mine;
    expect(w.repo.saveSync(mine, 0).ok).toBe(true);
    w.app.rev = 1;
    const r = readLegacy(w.fs);
    if (r.kind !== 'ok') throw new Error('no legacy');
    const res = performLink(w.env({ current: mine }), r.legacy, 'replace');
    expect(res).toMatchObject({ ok: true, keptPrevious: true });
    const points = w.repo.listBackups();
    expect(points.map((p) => p.reason).sort()).toEqual(['before-link', 'device-copy']);
    const before = points.find((p) => p.reason === 'before-link')!;
    expect(sameData(w.repo.readBackup(before.id), validateAppData(mine)!.data)).toBe(true);
    expect(sameData(w.repo.peek().data, r.legacy.data)).toBe(true);
  });

  it('if a restore point cannot be kept, nothing is copied, nothing changes and no claim is made', () => {
    const w = world();
    w.seedLegacy(legacy);
    w.fs.failOn = [':backups'];
    const r = readLegacy(w.fs);
    if (r.kind !== 'ok') throw new Error('no legacy');
    const replace = vi.fn(() => true);
    const res = performLink(w.env({ replace }), r.legacy, 'copy');
    expect(res).toEqual({ ok: false, reason: 'no-room-for-copy' });
    expect(replace).not.toHaveBeenCalled();
    expect(w.repo.peek().status).toBe('empty');
    expect(readClaim(w.fs)).toBeNull();
    expect(readIntent('acc1', w.fs)).toBeNull();
  });

  it('if only the account’s own plan cannot be kept as a restore point (the second copy does not fit), nothing is replaced', () => {
    const w = world();
    w.seedLegacy(legacy);
    const mine = plan('mine', 500);
    w.app.data = mine;
    w.repo.saveSync(mine, 0); w.app.rev = 1;
    // The first restore point fits, the second does not (not even in place of the first: the repository tries that too).
    let backupWrites = 0;
    const set = w.fs.setItem.bind(w.fs);
    w.fs.setItem = (k: string, v: string) => { if (k.endsWith(':backups') && ++backupWrites >= 2) throw new DOMException('full', 'QuotaExceededError'); set(k, v); };
    const r = readLegacy(w.fs);
    if (r.kind !== 'ok') throw new Error('no legacy');
    const replace = vi.fn(() => true);
    const res = performLink(w.env({ current: mine, replace }), r.legacy, 'replace');
    expect(res).toEqual({ ok: false, reason: 'no-room-for-copy' });
    expect(replace).not.toHaveBeenCalled();
    expect(sameData(w.repo.peek().data, validateAppData(mine)!.data)).toBe(true);
    expect(readClaim(w.fs)).toBeNull();
    expect(readIntent('acc1', w.fs)).toBeNull();
  });

  it('if the copy cannot be saved, the previous plan is put back and the failure is reported', () => {
    const w = world();
    w.seedLegacy(legacy);
    const mine = plan('mine', 500);
    w.app.data = mine;
    w.repo.saveSync(mine, 0); w.app.rev = 1;
    w.fs.failOn = [`${STORAGE_KEY}@acc1`];          // the account's main save fails; backups still work
    const r = readLegacy(w.fs);
    if (r.kind !== 'ok') throw new Error('no legacy');
    const res = performLink(w.env({ current: mine }), r.legacy, 'replace');
    expect(res).toEqual({ ok: false, reason: 'not-saved' });
    expect(w.calls).toContain('revert');
    expect(w.app.data).toBe(mine);
    expect(sameData(w.repo.peek().data, validateAppData(mine)!.data)).toBe(true);          // storage still holds the account's own plan
    expect(readClaim(w.fs)).toBeNull();
    expect(readIntent('acc1', w.fs)).toBeNull();
  });

  it('if the app does not take the replacement, nothing is claimed', () => {
    const w = world();
    w.seedLegacy(legacy);
    const r = readLegacy(w.fs);
    if (r.kind !== 'ok') throw new Error('no legacy');
    expect(performLink(w.env({ replace: () => false }), r.legacy, 'copy')).toEqual({ ok: false, reason: 'not-replaced' });
    expect(readClaim(w.fs)).toBeNull();
  });

  it('never calls anything that could touch a trial or a subscription (it has no way to: no network, no account calls)', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    try {
      const w = world();
      w.seedLegacy(legacy);
      const r = readLegacy(w.fs);
      if (r.kind !== 'ok') throw new Error('no legacy');
      performLink(w.env(), r.legacy, 'copy');
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
});

describe('an interrupted copy is explained from what is actually stored', () => {
  const legacy = validateAppData(plan('old', 300))!.data;
  const intent = { startedAt: '2026-10-17T10:00:00.000Z', choice: 'copy', hash: hashData(legacy), planId: legacy.user.id, hadOwnPlan: false };

  it('no record, nothing to say', () => {
    expect(intentOutcome('acc1', new Fake()).kind).toBe('none');
  });
  it('cut short before the account’s storage changed: "unchanged" (and no claim is invented)', () => {
    const w = world();
    w.fs.setItem(intentKey('acc1'), JSON.stringify(intent));
    expect(intentOutcome('acc1', w.fs).kind).toBe('unchanged');
    settleIntent('acc1', false, w.fs);
    expect(readClaim(w.fs)).toBeNull();
    settleIntent('acc1', true, w.fs);
    expect(readIntent('acc1', w.fs)).toBeNull();
  });
  it('cut short after the copy reached storage: "completed", and the claim is recorded so the device remembers where its data went', () => {
    const w = world();
    w.fs.setItem(intentKey('acc1'), JSON.stringify(intent));
    w.repo.saveSync(legacy, 0);
    expect(intentOutcome('acc1', w.fs).kind).toBe('completed');
    settleIntent('acc1', false, w.fs);
    expect(readClaim(w.fs)).toMatchObject({ accountId: 'acc1', hash: hashData(legacy) });
    expect(readIntent('acc1', w.fs)).not.toBeNull();             // kept until the person has been told
    settleIntent('acc1', true, w.fs);
    expect(readIntent('acc1', w.fs)).toBeNull();
  });
  it('a copy the app has touched since is still "completed" (the plan travels with its own id), and a different plan is not', () => {
    const w = world();
    w.fs.setItem(intentKey('acc1'), JSON.stringify(intent));
    const touched = { ...legacy, lastOpened: '2026-10-18' };
    w.repo.saveSync(touched, 0);
    expect(hashData(touched)).not.toBe(intent.hash);
    expect(intentOutcome('acc1', w.fs).kind).toBe('completed');
    const other = world();
    other.fs.setItem(intentKey('acc1'), JSON.stringify(intent));
    other.repo.saveSync(plan('someone else', 5), 0);
    expect(intentOutcome('acc1', other.fs).kind).toBe('unchanged');
  });
  it('a damaged record is ignored rather than trusted', () => {
    const w = world();
    w.fs.setItem(intentKey('acc1'), '{"startedAt": 5');
    expect(intentOutcome('acc1', w.fs).kind).toBe('none');
    w.fs.setItem(intentKey('acc1'), JSON.stringify({ startedAt: 'x', choice: 'wipe', hash: 'h', hadOwnPlan: false }));
    expect(intentOutcome('acc1', w.fs).kind).toBe('none');
  });
  it('undoing a copy forgets this account’s claim, and only this account’s', () => {
    const w = world();
    w.fs.setItem(LEGACY_CLAIM_KEY, JSON.stringify({ accountId: 'other', at: 'x', hash: 'h' }));
    undoClaim('acc1', w.fs);
    expect(readClaim(w.fs)?.accountId).toBe('other');
    undoClaim('other', w.fs);
    expect(readClaim(w.fs)).toBeNull();
  });
});

describe('when an account is deleted, its records on this device go with it', () => {
  const seed = () => {
    const fs = new Fake();
    fs.setItem(cloudRecordKey('gone'), '{"revision":2,"at":"x","includes":[]}');
    fs.setItem(cloudPendingKey('gone'), '{"startedAt":"x","baseRevision":null,"includes":[]}');
    fs.setItem(intentKey('gone'), '{"startedAt":"x","choice":"copy","hash":"h","planId":"p","hadOwnPlan":false}');
    fs.setItem(LEGACY_CLAIM_KEY, JSON.stringify({ accountId: 'gone', at: 'x', hash: 'h' }));
    fs.setItem(cloudRecordKey('other'), '{"revision":5,"at":"x","includes":[]}');
    return fs;
  };
  it('the memory of the cloud backup always goes; the rest goes only if the plan was erased too; another account’s records never go', () => {
    const kept = seed();
    forgetAccountOnDevice('gone', false, kept);
    expect(kept.getItem(cloudRecordKey('gone'))).toBeNull();
    expect(kept.getItem(cloudPendingKey('gone'))).toBeNull();
    expect(kept.getItem(intentKey('gone'))).not.toBeNull();
    expect(readClaim(kept)?.accountId).toBe('gone');
    const erased = seed();
    forgetAccountOnDevice('gone', true, erased);
    expect(erased.getItem(intentKey('gone'))).toBeNull();
    expect(readClaim(erased)).toBeNull();
    expect(erased.getItem(cloudRecordKey('other'))).not.toBeNull();
  });
  it('a note that the data went into someone else’s account is not touched', () => {
    const fs = new Fake();
    fs.setItem(LEGACY_CLAIM_KEY, JSON.stringify({ accountId: 'someone', at: 'x', hash: 'h' }));
    forgetAccountOnDevice('gone', true, fs);
    expect(readClaim(fs)?.accountId).toBe('someone');
  });
});
