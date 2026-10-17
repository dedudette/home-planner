import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BackupMeta } from '../../src/account/api';
import { conflictCurrent, uploadVerdict, type CloudRecord } from '../../src/account/cloudBackup';
import { emptyAppData } from '../../src/domain/appdata';
import type { AppData } from '../../src/domain/types';
import { reducer } from '../../src/state/reducer';
import { countData, mergeRestore, planUpload, sameData } from '../../src/storage/backupPlan';
import { validateAppData } from '../../src/storage/schema';
import { TODAY } from '../helpers';
import { haveDb } from './helpers';
import { makeRig, PASSWORD, type Client, type Rig } from './rig';

/**
 * What the data & backup screen relies on, checked against the real server code: real Better Auth, real PostgreSQL, the server's own clock.
 * Every answer from the server is fed to the app's own functions (the upload plan, the verdict, the conflict reader, the restore merge), so
 * the words and the choices are checked on what the server really says, not on hand-made fixtures. No payment provider is involved.
 */
const device = (tag: string, withPrivate = true): AppData => {
  let d: AppData = { ...emptyAppData(TODAY), onboardingComplete: true };
  const a = (x: Parameters<typeof reducer>[1]) => { d = reducer(d, x); };
  a({ type: 'WATER_ADD', entry: { id: `w-${tag}`, date: TODAY, at: `${TODAY}T09:00:00.000Z`, ml: 300 } });
  if (withPrivate) {
    a({ type: 'JOURNAL_SAVE', entry: { id: `j-${tag}`, date: TODAY, at: `${TODAY}T21:00:00.000Z`, title: `title ${tag}`, text: `private text ${tag}` } });
    a({ type: 'CHECKIN_SAVE', checkin: { id: `c-${tag}`, date: TODAY, at: `${TODAY}T20:00:00.000Z`, energy: 'ok', mood: 3, note: `note ${tag}` } });
    a({ type: 'HEALTH_PREFS', enabled: true, read: { steps: true } });
    a({ type: 'HEALTH_MERGE', daily: { [TODAY]: { steps: 777, platform: 'healthkit', at: `${TODAY}T10:00:00.000Z` } }, today: TODAY, at: `${TODAY}T10:00:00.000Z` });
  }
  return d;
};

describe.skipIf(!haveDb)('the data & backup screen\'s contract with the server (real PostgreSQL)', () => {
  let rig: Rig;
  let n = 0;
  const signedIn = async (trial = true): Promise<{ c: Client; email: string }> => {
    const email = `bc${++n}@example.test`;
    const c = rig.client(); await c.register(rig, email);
    if (trial) await c.post('/api/account/trial', {});
    return { c, email };
  };
  const meta = async (c: Client): Promise<BackupMeta | null> => (await c.get('/api/account/backup?meta=1')).json.backup;
  const entitlement = async (c: Client) => (await c.get('/api/account')).json.account.entitlement;
  /** What a device does: take a plan from its data and its choices, send exactly that, learn the new revision. */
  const upload = async (c: Client, d: AppData, includes: ('journal' | 'health')[], base: number | null) => {
    const plan = planUpload(d, includes);
    const r = await c.call('PUT', '/api/account/backup', { baseRevision: base, includes: plan.includes, data: plan.payload });
    return { r, plan };
  };

  beforeAll(async () => { rig = await makeRig(); }, 60_000);
  afterAll(async () => { await rig?.close(); });

  it('what is previewed is what is sent, and the server stores what was sent: nothing private by default, and a restore returns the same content', async () => {
    const { c } = await signedIn();
    const d = device('a');
    const { r, plan } = await upload(c, d, [], null);
    expect(r.status).toBe(200);
    // The payload the device sends never contained the private parts in the first place.
    const sentText = JSON.stringify(plan.payload);
    expect(sentText).not.toMatch(/private text|note a|777/);
    expect(plan.sent).toMatchObject({ journalEntries: 0, checkinNotes: 0, healthDays: 0 });
    expect(plan.withheld).toEqual({ journalEntries: 1, checkinNotes: 1, healthDays: 1 });
    // What comes back is the sent plan data, validated by the same code the app uses to read its own storage.
    const back = (await c.get('/api/account/backup')).json;
    const v = validateAppData(back.data);
    expect(v && !v.fromFuture).toBe(true);
    expect(sameData(v!.data, validateAppData(plan.payload)!.data)).toBe(true);
    expect(countData(v!.data)).toMatchObject({ waterEntries: 1, journalEntries: 0, healthDays: 0 });
  });

  it('with a choice ticked, exactly that choice is sent and stored, and the cloud record says so', async () => {
    const { c } = await signedIn();
    const d = device('b');
    const { r, plan } = await upload(c, d, ['journal'], null);
    expect(r.status).toBe(200);
    expect(r.json.backup.includes).toEqual(['journal']);
    expect(plan.sent).toMatchObject({ journalEntries: 1, checkinNotes: 1, healthDays: 0 });
    const v = validateAppData((await c.get('/api/account/backup')).json.data)!;
    expect(v.data.wellbeing.journal[0].text).toBe('private text b');
    expect(v.data.health.daily).toEqual({});
  });

  it('two devices on one account: the second is told there is a copy it never saw, can look at it, and restoring keeps its own private parts', async () => {
    const { c } = await signedIn();
    const a = device('A');
    const first = await upload(c, a, [], null);
    const recA: CloudRecord = { revision: first.r.json.backup.revision, at: first.r.json.backup.updatedAt, includes: [] };

    const b = device('B');                                               // device B has its own plan and its own journal
    expect(uploadVerdict(null, await meta(c))).toEqual({ kind: 'unseen' });
    // The server agrees: a blind first upload from B is refused and nothing is overwritten.
    const blind = await upload(c, b, [], null);
    expect(blind.r.status).toBe(409);
    expect(conflictCurrent(blind.r.json.error)?.revision).toBe(1);
    expect(sameData(validateAppData((await c.get('/api/account/backup')).json.data)!.data, validateAppData(first.plan.payload)!.data)).toBe(true);

    // B restores A's copy: A's plan replaces B's, B's journal and health readings (never in the cloud) stay.
    const cloud = (await c.get('/api/account/backup')).json;
    const merged = mergeRestore(validateAppData(cloud.data)!.data, cloud.backup.includes, b);
    expect(merged.data.water.entries.map((e) => e.id)).toEqual(['w-A']);
    expect(merged.data.wellbeing.journal.map((j) => j.id)).toEqual(['j-B']);
    expect(Object.keys(merged.data.health.daily)).toEqual([TODAY]);
    const recB: CloudRecord = { revision: cloud.backup.revision, at: cloud.backup.updatedAt, includes: cloud.backup.includes };

    // B is now level with the cloud and can update it; A, which did not see B's update, is then refused.
    expect(uploadVerdict(recB, await meta(c))).toEqual({ kind: 'update', base: 1 });
    const second = await upload(c, merged.data, [], 1);
    expect(second.r.status).toBe(200);
    expect(second.r.json.backup.revision).toBe(2);
    expect(uploadVerdict(recA, await meta(c))).toEqual({ kind: 'changed' });
    const stale = await upload(c, a, [], recA.revision);
    expect(stale.r.status).toBe(409);
    expect(conflictCurrent(stale.r.json.error)?.revision).toBe(2);
  });

  it('after the cloud copy is deleted a device that remembers it is told so, and revision numbers carry on', async () => {
    const { c } = await signedIn();
    const d = device('d');
    const first = await upload(c, d, [], null);
    const rec: CloudRecord = { revision: first.r.json.backup.revision, at: first.r.json.backup.updatedAt, includes: [] };
    expect((await c.call('DELETE', '/api/account/backup')).status).toBe(200);
    expect(await meta(c)).toBeNull();
    expect(uploadVerdict(rec, await meta(c))).toEqual({ kind: 'deleted' });
    const blind = await upload(c, d, [], rec.revision);
    expect(blind.r.status).toBe(409);
    expect(conflictCurrent(blind.r.json.error)).toBeNull();                  // "deleted": there is nothing there to replace
    const again = await upload(c, d, [], null);
    expect(again.r.json.backup.revision).toBe(2);
    expect((await upload(c, d, [], rec.revision)).r.status).toBe(409);        // the old revision 1 can no longer overwrite anything
  });

  it('backing up, restoring and deleting never touch the trial or the subscription', async () => {
    const { c } = await signedIn();
    const before = await entitlement(c);
    const d = device('e');
    await upload(c, d, ['journal', 'health'], null);
    await c.get('/api/account/backup');
    await upload(c, d, [], 1);
    await c.call('DELETE', '/api/account/backup');
    expect(await entitlement(c)).toEqual(before);
    expect((await c.get('/api/account')).json.account.subscription).toBeNull();
  });

  it('after the trial ends: the screen can still read and delete, uploads are refused (the server decides), nothing is started or reset', async () => {
    const { c } = await signedIn();
    const d = device('f');
    await upload(c, d, [], null);
    rig.clock.now = new Date(rig.clock.now.getTime() + 20 * 86_400_000);
    const ended = await entitlement(c);
    expect(ended).toMatchObject({ state: 'trial-expired', access: 'account-only' });
    expect(await meta(c)).toMatchObject({ revision: 1 });
    expect((await upload(c, d, [], 1)).r.status).toBe(402);
    expect((await c.get('/api/account/backup')).status).toBe(200);
    expect((await c.call('DELETE', '/api/account/backup')).status).toBe(200);
    expect(await entitlement(c)).toEqual(ended);
    expect((await c.post('/api/account/trial', {})).status).not.toBe(200);       // and deleting a backup did not hand out a second trial
    rig.clock.now = new Date('2026-03-10T12:00:00Z');
  });

  it('one account never sees or touches another’s backup, and signing in elsewhere starts with an empty cloud', async () => {
    const a = await signedIn(); const b = await signedIn();
    await upload(a.c, device('x'), ['journal'], null);
    expect(await meta(b.c)).toBeNull();
    expect((await b.c.get('/api/account/backup')).json.backup).toBeNull();
    expect(uploadVerdict(null, await meta(b.c))).toEqual({ kind: 'first', base: null });
    const b1 = await upload(b.c, device('y'), [], null);
    expect(b1.r.json.backup.revision).toBe(1);
    expect((await meta(a.c))?.includes).toEqual(['journal']);           // A's copy is untouched by B's
  });

  it('deleting an account removes its cloud backup, even one that was deleted and re-made', async () => {
    const { c, email } = await signedIn();
    await upload(c, device('g'), ['journal'], null);
    await c.call('DELETE', '/api/account/backup');
    await upload(c, device('g'), ['journal'], null);
    const uid = (await rig.t.admin.query('select id from "user" where email = $1', [email])).rows[0].id as string;
    expect((await rig.t.admin.query('select count(*)::int as n from user_backups where user_id = $1', [uid])).rows[0].n).toBe(1);
    expect((await c.post('/api/auth/delete-user', { password: PASSWORD })).status).toBe(200);
    expect((await rig.t.admin.query('select count(*)::int as n from user_backups where user_id = $1', [uid])).rows[0].n).toBe(0);
  });
});
