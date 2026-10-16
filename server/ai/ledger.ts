import { randomUUID } from 'node:crypto';
import type { UsageWindow } from '../../src/domain/billing/usage';
import { withSystem, withUser, type Db } from '../db/pool';

/**
 * The AI allowance ledger. Durable (PostgreSQL, not process memory), atomic, and safe under concurrency.
 *
 *   reserve → the provider is called → commit (the person used one request) or release (they did not)
 *
 * Reserving is a single conditional UPDATE on the account's counter row: `used + reserved + 1 <= limit`. Postgres takes a row lock for
 * the update, so ten simultaneous requests against one remaining unit see the counter one after another and exactly one succeeds. A
 * reserved request is not yet spent, but it holds its unit, so concurrent requests cannot overshoot while an answer is pending.
 *
 * What is charged: one unit when the provider returned a usable answer; nothing when the provider failed, timed out, was refused, or
 * returned something the app's own checks rejected. A request whose server died between reserve and settle is released by the reaper
 * after `STALE_MS`, also at no charge (a small cost risk the operator accepts instead of charging for an answer nobody saw).
 */
export interface Reservation { requestId: string; windowKey: string; windowEnd: Date; limit: number }
export type ReserveResult =
  | { ok: true; reservation: Reservation }
  | { ok: false; code: 'allowance-exhausted'; limit: number; used: number; resetsAt: Date };

export interface Usage { inputTokens?: number; outputTokens?: number }
export interface Counter { used: number; reserved: number; limit: number; resetsAt: Date }

export const STALE_MS = 5 * 60 * 1000;

export interface Ledger {
  reserve(userId: string, window: UsageWindow, feature: string, requestId?: string): Promise<ReserveResult>;
  commit(userId: string, requestId: string, usage?: Usage): Promise<boolean>;
  release(userId: string, requestId: string, usage?: Usage): Promise<boolean>;
  counter(userId: string, window: UsageWindow): Promise<Counter>;
  reapStale(now?: Date): Promise<number>;
}

export const createLedger = (db: Db, opts: { now?: () => Date } = {}): Ledger => {
  const clock = opts.now ?? (() => new Date());
  const settle = async (userId: string, requestId: string, to: 'committed' | 'released', usage?: Usage): Promise<boolean> =>
    withUser(db, userId, async (c) => {
      const r = await c.query(
        `update ai_usage_ledger set state = $3, settled_at = $4, input_tokens = $5, output_tokens = $6
         where request_id = $1 and user_id = $2 and state = 'reserved' returning window_key`,
        [requestId, userId, to, clock(), usage?.inputTokens ?? null, usage?.outputTokens ?? null]);
      if (!r.rowCount) return false;        // already settled: settling twice changes nothing
      await c.query(
        to === 'committed'
          ? 'update ai_usage_counters set used = used + 1, reserved = reserved - 1 where user_id = $1 and window_key = $2'
          : 'update ai_usage_counters set reserved = reserved - 1 where user_id = $1 and window_key = $2',
        [userId, r.rows[0].window_key]);
      return true;
    });

  return {
    async reserve(userId, window, feature, requestId = randomUUID()) {
      return withUser(db, userId, async (c) => {
        await c.query('insert into ai_usage_counters (user_id, window_key, window_end) values ($1, $2, $3) on conflict (user_id, window_key) do nothing', [userId, window.key, window.end]);
        const r = await c.query(
          `update ai_usage_counters set reserved = reserved + 1
           where user_id = $1 and window_key = $2 and used + reserved + 1 <= $3 returning used`,
          [userId, window.key, window.limit]);
        if (!r.rowCount) {
          const cur = await c.query('select used, window_end from ai_usage_counters where user_id = $1 and window_key = $2', [userId, window.key]);
          return { ok: false as const, code: 'allowance-exhausted' as const, limit: window.limit, used: cur.rows[0]?.used ?? 0, resetsAt: window.end };
        }
        await c.query(`insert into ai_usage_ledger (request_id, user_id, window_key, feature, state, created_at) values ($1, $2, $3, $4, 'reserved', $5)`, [requestId, userId, window.key, feature, clock()]);
        return { ok: true as const, reservation: { requestId, windowKey: window.key, windowEnd: window.end, limit: window.limit } };
      });
    },
    commit: (userId, requestId, usage) => settle(userId, requestId, 'committed', usage),
    release: (userId, requestId, usage) => settle(userId, requestId, 'released', usage),
    async counter(userId, window) {
      return withUser(db, userId, async (c) => {
        const r = await c.query('select used, reserved from ai_usage_counters where user_id = $1 and window_key = $2', [userId, window.key]);
        return { used: r.rows[0]?.used ?? 0, reserved: r.rows[0]?.reserved ?? 0, limit: window.limit, resetsAt: window.end };
      });
    },
    async reapStale(now = clock()) {
      return withSystem(db, async (c) => {
        const rows = await c.query(
          `update ai_usage_ledger set state = 'released', settled_at = $2
           where state = 'reserved' and created_at < $1 returning user_id, window_key`, [new Date(now.getTime() - STALE_MS), now]);
        for (const r of rows.rows as { user_id: string; window_key: string }[]) {
          await c.query('update ai_usage_counters set reserved = reserved - 1 where user_id = $1 and window_key = $2', [r.user_id, r.window_key]);
        }
        return rows.rowCount ?? 0;
      });
    },
  };
};
