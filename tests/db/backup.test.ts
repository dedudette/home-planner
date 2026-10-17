import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { emptyAppData } from '../../src/domain/appdata';
import type { AppData } from '../../src/domain/types';
import { reducer } from '../../src/state/reducer';
import { TODAY } from '../helpers';
import { haveDb } from './helpers';
import { makeRig, type Client, type Rig } from './rig';

const data = (): AppData => {
  let d = emptyAppData(TODAY);
  const a = (x: Parameters<typeof reducer>[1]) => { d = reducer(d, x); };
  a({ type: 'JOURNAL_SAVE', entry: { id: 'j1', date: TODAY, at: `${TODAY}T21:00:00.000Z`, title: 'Private title', text: 'Private words only I should read.' } });
  a({ type: 'CHECKIN_SAVE', checkin: { id: 'c1', date: TODAY, at: `${TODAY}T20:00:00.000Z`, energy: 'low', mood: 3, note: 'a private note about my day' } });
  a({ type: 'HEALTH_PREFS', enabled: true, read: { steps: true } });
  a({ type: 'HEALTH_MERGE', daily: { [TODAY]: { steps: 4321, platform: 'healthkit', at: `${TODAY}T10:00:00.000Z` } }, today: TODAY, at: `${TODAY}T10:00:00.000Z` });
  a({ type: 'WATER_ADD', entry: { id: 'w1', date: TODAY, at: `${TODAY}T09:00:00.000Z`, ml: 300 } });
  return d;
};

describe.skipIf(!haveDb)('optional cloud backup (real PostgreSQL)', () => {
  let rig: Rig;
  let n = 0;
  const user = async (trial = true): Promise<Client> => { const c = rig.client(); await c.register(rig, `bk${++n}@example.test`); if (trial) await c.post('/api/account/trial', {}); return c; };
  const stored = async (c: Client) => { const r = await c.get('/api/account/backup'); return r.json; };
  /** The snapshot text as the database holds it, for this person only (other tests' rows are not this test's business). */
  const rawOf = async (c: Client): Promise<string> => {
    const id = (await c.get('/api/account')).json.account.user.id as string;
    return (await rig.t.admin.query('select snapshot::text as s from user_backups where user_id = $1', [id])).rows.map((r) => r.s as string).join('');
  };
  beforeAll(async () => { rig = await makeRig(); }, 60_000);
  afterAll(async () => { await rig?.close(); });

  it('needs an active trial or subscription to save, but never to read or delete', async () => {
    const c = await user(false);
    const put = await c.call('PUT', '/api/account/backup', { baseRevision: null, includes: [], data: data() });
    expect(put.status).toBe(402);
    expect((await c.get('/api/account/backup')).json.backup).toBeNull();
    expect((await c.call('DELETE', '/api/account/backup')).status).toBe(200);
  });

  it('by default the private journal, check-in notes and health readings are not stored, even if the app sent them', async () => {
    const c = await user();
    const put = await c.call('PUT', '/api/account/backup', { baseRevision: null, includes: [], data: data() });
    expect(put.status).toBe(200);
    expect(put.json.backup).toMatchObject({ revision: 1, includes: [] });
    const back = (await stored(c)).data as AppData;
    expect(back.wellbeing.journal).toEqual([]);
    expect(back.wellbeing.checkins[0]).toMatchObject({ id: 'c1', energy: 'low', mood: 3, note: '' });
    expect(back.health.daily).toEqual({});
    expect(back.water.entries).toHaveLength(1);              // the ordinary plan data is kept
    const raw = (await rig.t.admin.query('select snapshot::text as s from user_backups')).rows.map((r) => r.s as string).join('');
    expect(raw).not.toContain('Private words only I should read');
    expect(raw).not.toContain('a private note about my day');
    expect(raw).not.toContain('4321');
  });

  it('what the person ticks is what is stored, and the record says exactly that', async () => {
    const c = await user();
    const put = await c.call('PUT', '/api/account/backup', { baseRevision: null, includes: ['journal', 'health'], data: data() });
    expect(put.json.backup.includes).toEqual(['journal', 'health']);
    const back = (await stored(c)).data as AppData;
    expect(back.wellbeing.journal[0].text).toBe('Private words only I should read.');
    expect(back.health.daily[TODAY].steps).toBe(4321);
    expect((await c.get('/api/account/export')).json.cloudBackup.includes).toEqual(['journal', 'health']);
    expect(JSON.stringify((await c.get('/api/account/export')).json)).not.toContain('Private words');   // the account export lists the backup, not its content
  });

  it('a backup is accepted only from someone who saw the current revision; conflicts overwrite nothing', async () => {
    const c = await user();
    expect((await c.call('PUT', '/api/account/backup', { baseRevision: null, includes: [], data: data() })).json.backup.revision).toBe(1);
    const again = await c.call('PUT', '/api/account/backup', { baseRevision: null, includes: [], data: data() });
    expect(again.status).toBe(409);
    expect(again.json.error).toMatchObject({ code: 'conflict', current: { revision: 1 } });
    expect((await c.call('PUT', '/api/account/backup', { baseRevision: 1, includes: [], data: data() })).json.backup.revision).toBe(2);
    expect((await c.call('PUT', '/api/account/backup', { baseRevision: 1, includes: [], data: data() })).status).toBe(409);
    const rs = await Promise.all([1, 2, 3, 4].map(() => c.call('PUT', '/api/account/backup', { baseRevision: 2, includes: [], data: data() })));
    expect(rs.map((r) => r.status).sort()).toEqual([200, 409, 409, 409]);
    expect((await stored(c)).backup.revision).toBe(3);
  });

  it('rejects data that is not CleanFlow data, data from a newer version, and anything over the size limit; nothing is stored', async () => {
    const c = await user();
    expect((await c.call('PUT', '/api/account/backup', { baseRevision: null, includes: [], data: { hello: 'world' } })).status).toBe(422);
    expect((await c.call('PUT', '/api/account/backup', { baseRevision: null, includes: [], data: { ...data(), version: 99 } })).status).toBe(422);
    expect((await c.call('PUT', '/api/account/backup', { baseRevision: 0, includes: [], data: data() })).status).toBe(400);
    expect((await c.call('PUT', '/api/account/backup', { baseRevision: null, includes: [], data: data(), pad: 'x'.repeat(6 * 1024 * 1024) })).status).toBe(413);
    expect((await stored(c)).backup).toBeNull();
  });

  it('one account never sees another’s backup; deleting removes it', async () => {
    const a = await user(); const b = await user();
    await a.call('PUT', '/api/account/backup', { baseRevision: null, includes: ['journal'], data: data() });
    expect((await b.get('/api/account/backup')).json.backup).toBeNull();
    expect((await b.call('PUT', '/api/account/backup', { baseRevision: 1, includes: [], data: data() })).status).toBe(409);    // B never saw revision 1
    expect((await a.call('DELETE', '/api/account/backup')).status).toBe(200);
    expect((await a.get('/api/account/backup')).json.backup).toBeNull();
  });

  it('two first uploads at once: exactly one is accepted, the other is told the cloud copy changed', async () => {
    const c = await user();
    const rs = await Promise.all([1, 2, 3, 4, 5, 6].map(() => c.call('PUT', '/api/account/backup', { baseRevision: null, includes: [], data: data() })));
    expect(rs.map((r) => r.status).sort()).toEqual([200, 409, 409, 409, 409, 409]);
    expect((await stored(c)).backup.revision).toBe(1);
  });

  it('a revision number is never reused after the cloud copy is deleted, so a device that saw the old copy cannot overwrite a new one', async () => {
    const c = await user();
    expect((await c.call('PUT', '/api/account/backup', { baseRevision: null, includes: [], data: data() })).json.backup.revision).toBe(1);
    expect((await c.call('DELETE', '/api/account/backup')).status).toBe(200);
    expect((await stored(c)).backup).toBeNull();
    // A device that still believes revision 1 is current is refused: there is nothing there to replace, and it must say so.
    const stale = await c.call('PUT', '/api/account/backup', { baseRevision: 1, includes: [], data: data() });
    expect(stale.status).toBe(409);
    expect(stale.json.error).toMatchObject({ code: 'conflict', current: null });
    // A fresh first backup goes through, and carries on counting rather than starting again at 1.
    const fresh = await c.call('PUT', '/api/account/backup', { baseRevision: null, includes: [], data: data() });
    expect(fresh.status).toBe(200);
    expect(fresh.json.backup.revision).toBe(2);
    // The old device (which saw revision 1) is now refused too: what is in the cloud is not what it saw.
    expect((await c.call('PUT', '/api/account/backup', { baseRevision: 1, includes: [], data: data() })).status).toBe(409);
    expect((await stored(c)).backup.revision).toBe(2);
  });

  it('deleting removes the content for good: nothing of the snapshot stays in the database, and the account export lists no backup', async () => {
    const c = await user();
    await c.call('PUT', '/api/account/backup', { baseRevision: null, includes: ['journal', 'health'], data: data() });
    expect((await c.call('DELETE', '/api/account/backup')).status).toBe(200);
    const raw = await rawOf(c);
    expect(raw).not.toContain('Private words only I should read');
    expect(raw).not.toContain('4321');
    expect(raw).not.toContain('a private note about my day');
    expect((await c.get('/api/account/export')).json.cloudBackup).toBeNull();
    expect((await c.get('/api/account/backup?meta=1')).json.backup).toBeNull();
  });

  it('the exclusions hold for every combination of choices, whatever the sender claims', async () => {
    const cases: { includes: unknown; journal: boolean; health: boolean }[] = [
      { includes: [], journal: false, health: false },
      { includes: ['journal'], journal: true, health: false },
      { includes: ['health'], journal: false, health: true },
      { includes: ['journal', 'health'], journal: true, health: true },
      { includes: ['Journal', 'everything', 7, null, { journal: true }], journal: false, health: false },    // anything the server does not know is ignored, never trusted
      { includes: 'journal', journal: false, health: false },                                                  // not a list: nothing is included
    ];
    for (const k of cases) {
      const c = await user();
      const put = await c.call('PUT', '/api/account/backup', { baseRevision: null, includes: k.includes, data: data() });
      expect(put.status).toBe(200);
      const back = (await stored(c)).data as AppData;
      expect(back.wellbeing.journal.length).toBe(k.journal ? 1 : 0);
      expect(back.wellbeing.checkins[0].note).toBe(k.journal ? 'a private note about my day' : '');
      expect(Object.keys(back.health.daily).length).toBe(k.health ? 1 : 0);
      expect(back.health.lastSync === null).toBe(!k.health);
      expect(back.health.prefs.enabled).toBe(true);                         // the person's own on/off choice is a setting, not imported data
      expect(put.json.backup.includes).toEqual([...(k.journal ? ['journal'] : []), ...(k.health ? ['health'] : [])]);
    }
  });

  it('the private parts are removed even when they sit where a screen might forget them (many entries, workouts, notes)', async () => {
    const c = await user();
    let d = data();
    for (let i = 0; i < 30; i++) {
      d = reducer(d, { type: 'JOURNAL_SAVE', entry: { id: `jx${i}`, date: TODAY, at: `${TODAY}T21:0${i % 10}:00.000Z`, title: `secret title ${i}`, text: `secret words ${i}` } });
      d = reducer(d, { type: 'CHECKIN_SAVE', checkin: { id: `cx${i}`, date: TODAY, at: `${TODAY}T20:0${i % 10}:00.000Z`, energy: 'ok', mood: 3, note: `secret note ${i}` } });
    }
    expect((await c.call('PUT', '/api/account/backup', { baseRevision: null, includes: [], data: d })).status).toBe(200);
    const raw = await rawOf(c);
    expect(raw).not.toMatch(/secret (title|words|note)/);
    expect(((await stored(c)).data as AppData).wellbeing.checkins.length).toBeGreaterThanOrEqual(30);    // the check-ins themselves (mood, energy, date) are ordinary plan data and stay
  });

  it('after the trial ends the backup can still be read and deleted, but not written', async () => {
    const c = await user();
    await c.call('PUT', '/api/account/backup', { baseRevision: null, includes: [], data: data() });
    rig.clock.now = new Date(rig.clock.now.getTime() + 20 * 86400000);
    expect((await c.get('/api/account/backup')).json.backup.revision).toBe(1);
    expect((await c.call('PUT', '/api/account/backup', { baseRevision: 1, includes: [], data: data() })).status).toBe(402);
    expect((await c.call('DELETE', '/api/account/backup')).status).toBe(200);
    rig.clock.now = new Date('2026-03-10T12:00:00Z');
  });
});
