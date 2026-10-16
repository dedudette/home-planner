import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadMigrations, migrate } from '../../server/db/migrate';
import { withSystem, withUser } from '../../server/db/pool';
import { addUser, createTestDb, haveDb, type TestDb } from './helpers';

describe.skipIf(!haveDb)('database: migrations and per-account isolation (real PostgreSQL)', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
    await addUser(t.admin, 'alice');
    await addUser(t.admin, 'bob');
    await withUser(t.db, 'alice', (c) => c.query(`insert into user_backups (user_id, revision, snapshot, size_bytes) values ('alice', 1, '{"a":1}', 7)`));
    await withUser(t.db, 'bob', (c) => c.query(`insert into user_backups (user_id, revision, snapshot, size_bytes) values ('bob', 1, '{"b":1}', 7)`));
  }, 60_000);
  afterAll(async () => { await t?.close(); });

  it('migrations apply once, are recorded with checksums, and a second run does nothing', async () => {
    const all = loadMigrations().map((m) => m.version);
    expect(all.length).toBeGreaterThanOrEqual(2);
    const again = await migrate(t.admin, { appRole: 'cleanflow_app' });
    expect(again.applied).toEqual([]);
    expect(again.alreadyApplied).toEqual(all);
  });
  it('an applied migration that was edited afterwards is refused', async () => {
    await t.admin.query(`update schema_migrations set checksum = 'edited' where version = $1`, [loadMigrations()[0].version]);
    await expect(migrate(t.admin)).rejects.toThrow(/changed after it was applied/);
    await t.admin.query(`update schema_migrations set checksum = $2 where version = $1`, [loadMigrations()[0].version, loadMigrations()[0].checksum]);
  });
  it('the server role does not own the tables, so row-level security binds it', async () => {
    const r = await t.db.query(`select rolsuper, rolbypassrls from pg_roles where rolname = current_user`);
    expect(r.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });
  it('a person-scoped transaction sees only that person’s rows', async () => {
    const a = await withUser(t.db, 'alice', (c) => c.query('select user_id from user_backups'));
    expect(a.rows).toEqual([{ user_id: 'alice' }]);
    const b = await withUser(t.db, 'bob', (c) => c.query('select user_id from user_backups'));
    expect(b.rows).toEqual([{ user_id: 'bob' }]);
  });
  it('a query with no identity at all sees nothing', async () => {
    const r = await t.db.query('select * from user_backups');
    expect(r.rowCount).toBe(0);
  });
  it('one person cannot change or delete another person’s rows, nor write one in their name', async () => {
    const upd = await withUser(t.db, 'alice', (c) => c.query(`update user_backups set revision = 99 where user_id = 'bob'`));
    expect(upd.rowCount).toBe(0);
    const del = await withUser(t.db, 'alice', (c) => c.query(`delete from user_backups where user_id = 'bob'`));
    expect(del.rowCount).toBe(0);
    await expect(withUser(t.db, 'alice', (c) => c.query(`insert into user_backups (user_id, revision, snapshot, size_bytes) values ('bob', 2, '{}', 2) on conflict do nothing`).then(() => c.query(`insert into subscriptions (user_id, provider, provider_subscription_id, plan, status, started_at, current_period_start, current_period_end, amount_cents, currency) values ('bob','stripe','sub_x','monthly','active', now(), now(), now() + interval '1 month', 2500, 'eur')`)))).rejects.toThrow(/row-level security/);
    const bob = await withUser(t.db, 'bob', (c) => c.query('select revision from user_backups'));
    expect(bob.rows).toEqual([{ revision: 1 }]);
  });
  it('person-scoped transactions cannot read the webhook ledger; system ones can', async () => {
    await withSystem(t.db, (c) => c.query(`insert into billing_events (provider, event_id, type, status) values ('stripe','evt_1','x','processed')`));
    const asUser = await withUser(t.db, 'alice', (c) => c.query('select * from billing_events'));
    expect(asUser.rowCount).toBe(0);
    await expect(withUser(t.db, 'alice', (c) => c.query(`insert into billing_events (provider, event_id, type, status) values ('stripe','evt_2','x','processed')`))).rejects.toThrow(/row-level security/);
    const asSystem = await withSystem(t.db, (c) => c.query('select event_id from billing_events'));
    expect(asSystem.rows).toEqual([{ event_id: 'evt_1' }]);
  });
  it('identity does not leak between pooled connections', async () => {
    for (let i = 0; i < 20; i++) {
      const who = i % 2 ? 'alice' : 'bob';
      const r = await withUser(t.db, who, (c) => c.query(`select current_setting('app.user_id', true) as me, current_setting('app.system', true) as sys`));
      expect(r.rows[0]).toEqual({ me: who, sys: 'off' });
    }
    const bare = await t.db.query(`select nullif(current_setting('app.user_id', true), '') as me`);
    expect(bare.rows[0].me).toBeNull();
  });
  it('at most one live subscription per account, across providers; a cancelled one does not count', async () => {
    const ins = (id: string, provider: string, status: string) => withSystem(t.db, (c) => c.query(
      `insert into subscriptions (user_id, provider, provider_subscription_id, plan, status, started_at, current_period_start, current_period_end, amount_cents, currency) values ('alice', $1, $2, 'monthly', $3, now(), now(), now() + interval '1 month', 2500, 'eur')`, [provider, id, status]));
    await ins('sub_old', 'stripe', 'canceled');
    await ins('sub_live', 'stripe', 'active');
    await expect(ins('sub_dup', 'stripe', 'active')).rejects.toThrow(/subscriptions_one_live_per_user/);
    await expect(ins('apple_dup', 'apple', 'past_due')).rejects.toThrow(/subscriptions_one_live_per_user/);
  });
  it('deleting an account removes its rows, and leaves the trial claim with no owner', async () => {
    await addUser(t.admin, 'carol');
    await t.admin.query(`insert into trial_claims (email_hash, user_id, started_at, ends_at) values ('h1', 'carol', now(), now() + interval '14 days')`);
    await withUser(t.db, 'carol', (c) => c.query(`insert into user_backups (user_id, revision, snapshot, size_bytes) values ('carol', 1, '{}', 2)`));
    await t.admin.query(`delete from "user" where id = 'carol'`);
    expect((await t.admin.query(`select count(*)::int as n from user_backups where user_id = 'carol'`)).rows[0].n).toBe(0);
    expect((await t.admin.query(`select user_id from trial_claims where email_hash = 'h1'`)).rows).toEqual([{ user_id: null }]);
  });
});
