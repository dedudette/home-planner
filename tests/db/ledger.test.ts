import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLedger, STALE_MS } from '../../server/ai/ledger';
import type { UsageWindow } from '../../src/domain/billing/usage';
import { addUser, createTestDb, haveDb, type TestDb } from './helpers';

const win = (key: string, limit: number, end = '2026-04-01T00:00:00Z'): UsageWindow => ({ key, kind: 'paid', start: new Date('2026-03-01T00:00:00Z'), end: new Date(end), limit });

describe.skipIf(!haveDb)('AI allowance ledger (real PostgreSQL)', () => {
  let t: TestDb;
  let now = new Date('2026-03-10T12:00:00Z');
  const ledger = () => createLedger(t.db, { now: () => now });
  beforeAll(async () => { t = await createTestDb(); for (const u of ['u1', 'u2', 'u3', 'u4', 'u5']) await addUser(t.admin, u); }, 60_000);
  afterAll(async () => { await t?.close(); });

  const state = async (user: string, key: string) => (await t.admin.query('select used, reserved from ai_usage_counters where user_id = $1 and window_key = $2', [user, key])).rows[0];

  it('exactly the allowance succeeds when twenty requests arrive at once', async () => {
    const l = ledger();
    const results = await Promise.all(Array.from({ length: 20 }, () => l.reserve('u1', win('w-a', 5), 'coach')));
    expect(results.filter((r) => r.ok)).toHaveLength(5);
    const refused = results.filter((r) => !r.ok);
    expect(refused).toHaveLength(15);
    expect(refused[0]).toMatchObject({ ok: false, code: 'allowance-exhausted', limit: 5 });
    expect(await state('u1', 'w-a')).toEqual({ used: 0, reserved: 5 });
  });
  it('concurrent settle: commits count once each, releases give the unit back, and nothing is double counted', async () => {
    const l = ledger();
    const held = (await Promise.all(Array.from({ length: 6 }, () => l.reserve('u2', win('w-b', 6), 'assist')))).map((r) => (r.ok ? r.reservation.requestId : ''));
    expect(held.every(Boolean)).toBe(true);
    await Promise.all([
      ...held.slice(0, 3).map((id) => l.commit('u2', id, { inputTokens: 100, outputTokens: 50 })),
      ...held.slice(3).map((id) => l.release('u2', id)),
      ...held.slice(0, 3).map((id) => l.commit('u2', id, { inputTokens: 100, outputTokens: 50 })),   // duplicate commits, racing the first ones
      ...held.slice(3).map((id) => l.release('u2', id)),         // duplicate releases
    ]);
    for (const id of held.slice(3)) expect(await l.commit('u2', id)).toBe(false);   // a unit that was given back cannot be spent afterwards
    expect(await state('u2', 'w-b')).toEqual({ used: 3, reserved: 0 });
    const after = await Promise.all(Array.from({ length: 6 }, () => l.reserve('u2', win('w-b', 6), 'assist')));
    expect(after.filter((r) => r.ok)).toHaveLength(3);          // three units were really spent, three given back
    const tok = await t.admin.query(`select sum(input_tokens)::int as i, sum(output_tokens)::int as o from ai_usage_ledger where user_id = 'u2' and state = 'committed'`);
    expect(tok.rows[0]).toEqual({ i: 300, o: 150 });
  });
  it('accounts do not share an allowance, and a window resets by being a new window', async () => {
    const l = ledger();
    for (let i = 0; i < 2; i++) expect((await l.reserve('u3', win('w-c', 2), 'coach')).ok).toBe(true);
    expect((await l.reserve('u3', win('w-c', 2), 'coach')).ok).toBe(false);
    expect((await l.reserve('u4', win('w-c', 2), 'coach')).ok).toBe(true);        // someone else, same window key
    expect((await l.reserve('u3', win('w-c-next', 2), 'coach')).ok).toBe(true);   // next period
  });
  it('lowering the configured limit below what was used refuses without corrupting the count', async () => {
    const l = ledger();
    for (let i = 0; i < 3; i++) { const r = await l.reserve('u5', win('w-d', 10), 'coach'); if (r.ok) await l.commit('u5', r.reservation.requestId); }
    const r = await l.reserve('u5', win('w-d', 2), 'coach');
    expect(r).toMatchObject({ ok: false, used: 3, limit: 2 });
    expect(await state('u5', 'w-d')).toEqual({ used: 3, reserved: 0 });
  });
  it('the counter the person sees matches the ledger', async () => {
    const l = ledger();
    const c = await l.counter('u3', win('w-c', 2));
    expect(c).toMatchObject({ used: 0, reserved: 2, limit: 2 });
  });
  it('a request whose server died is released after five minutes at no charge, and only then', async () => {
    const l = ledger();
    await addUser(t.admin, 'u6');
    const r = await l.reserve('u6', win('w-e', 1), 'coach');
    expect(r.ok).toBe(true);
    expect((await l.reserve('u6', win('w-e', 1), 'coach')).ok).toBe(false);
    expect(await l.reapStale(new Date(now.getTime() + STALE_MS - 1000))).toBe(0);
    expect(await l.reapStale(new Date(now.getTime() + STALE_MS + 1000))).toBeGreaterThanOrEqual(1);
    expect(await state('u6', 'w-e')).toEqual({ used: 0, reserved: 0 });
    expect((await l.reserve('u6', win('w-e', 1), 'coach')).ok).toBe(true);
    if (r.ok) expect(await l.commit('u6', r.reservation.requestId)).toBe(false);   // too late: it was already released
  });
});
