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
