import { Pool, type PoolClient } from 'pg';

/**
 * Every query the server makes on a person's behalf goes through `withUser`, which runs it in a transaction whose database session knows
 * the person's id, so row-level security shows it only that person's rows. Server jobs that legitimately span people (the webhook
 * handler, the notification sweep, the usage-ledger reaper) use `withSystem`. Both set the identity with `set_config(..., true)`, which
 * lasts for the transaction only, so a pooled connection never carries one person's identity into the next request.
 */
export type Db = Pool;

export const createDb = (connectionString: string, opts: { max?: number } = {}): Db => {
  const pool = new Pool({ connectionString, max: opts.max ?? 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000, statement_timeout: 15_000 });
  // An idle client erroring (the database restarted) must not crash the process: the pool discards it.
  pool.on('error', () => undefined);
  return pool;
};

export interface Scope { userId?: string; system?: boolean }

export const inTransaction = async <T>(db: Db, scope: Scope, fn: (c: PoolClient) => Promise<T>): Promise<T> => {
  const c = await db.connect();
  try {
    await c.query('begin');
    await c.query("select set_config('app.user_id', $1, true), set_config('app.system', $2, true)", [scope.userId ?? '', scope.system ? 'on' : 'off']);
    const out = await fn(c);
    await c.query('commit');
    return out;
  } catch (e) {
    await c.query('rollback').catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
};

export const withUser = <T>(db: Db, userId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> => {
  if (!userId) throw new Error('withUser needs a user id');
  return inTransaction(db, { userId }, fn);
};
export const withSystem = <T>(db: Db, fn: (c: PoolClient) => Promise<T>): Promise<T> => inTransaction(db, { system: true }, fn);
