import { createHash } from 'node:crypto';
import type { Pool } from 'pg';

/**
 * Plain SQL migrations, applied in file order, each in its own transaction, recorded with a checksum. A migration that was applied and
 * has since been edited is an error (the history must not be rewritten under a live database). A session-level advisory lock makes two
 * servers starting together safe. The SQL files are read at build time (Vite's glob import), so the bundled server needs no files.
 *
 * Run as the database OWNER (DATABASE_ADMIN_URL). The server itself runs as a different, limited role (DATABASE_URL), which is granted
 * only table access afterwards by `grantAppRole`; because that role does not own the tables, row-level security applies to it.
 */
export interface Migration { version: string; sql: string; checksum: string }

const files = import.meta.glob('./migrations/*.sql', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

export const loadMigrations = (): Migration[] =>
  Object.entries(files)
    .map(([path, sql]) => ({ version: path.replace(/^.*\//, '').replace(/\.sql$/, ''), sql, checksum: createHash('sha256').update(sql).digest('hex') }))
    .sort((a, b) => (a.version < b.version ? -1 : 1));

const LOCK_ID = 7_352_901;
const IDENT = /^[a-z_][a-z0-9_]{0,62}$/;

export interface MigrateResult { applied: string[]; alreadyApplied: string[] }

export const migrate = async (pool: Pool, opts: { appRole?: string; log?: (m: string) => void } = {}): Promise<MigrateResult> => {
  const log = opts.log ?? (() => undefined);
  const client = await pool.connect();
  const applied: string[] = [];
  const already: string[] = [];
  try {
    await client.query('select pg_advisory_lock($1)', [LOCK_ID]);
    await client.query('create table if not exists schema_migrations (version text primary key, checksum text not null, applied_at timestamptz not null default now())');
    const done = new Map<string, string>((await client.query('select version, checksum from schema_migrations')).rows.map((r: { version: string; checksum: string }) => [r.version, r.checksum]));
    for (const m of loadMigrations()) {
      const have = done.get(m.version);
      if (have !== undefined) {
        if (have !== m.checksum) throw new Error(`Migration ${m.version} was changed after it was applied. Add a new migration instead of editing an applied one.`);
        already.push(m.version);
        continue;
      }
      await client.query('begin');
      try {
        await client.query(m.sql);
        await client.query('insert into schema_migrations (version, checksum) values ($1, $2)', [m.version, m.checksum]);
        await client.query('commit');
      } catch (e) {
        await client.query('rollback').catch(() => undefined);
        throw new Error(`Migration ${m.version} failed: ${(e as Error).message}`);
      }
      log(`applied ${m.version}`);
      applied.push(m.version);
    }
    if (opts.appRole) await grantAppRole(client, opts.appRole);
  } finally {
    await client.query('select pg_advisory_unlock($1)', [LOCK_ID]).catch(() => undefined);
    client.release();
  }
  return { applied, alreadyApplied: already };
};

/** Table access for the limited role the server runs as. Re-run on every migrate, so a role created later is covered. */
export const grantAppRole = async (client: { query: (q: string) => Promise<unknown> }, role: string): Promise<void> => {
  if (!IDENT.test(role)) throw new Error('APP_DB_ROLE must be a plain lower-case identifier.');
  await client.query(`grant usage on schema public to ${role}`);
  await client.query(`grant select, insert, update, delete on all tables in schema public to ${role}`);
  await client.query(`grant usage, select on all sequences in schema public to ${role}`);
  await client.query(`revoke all on schema_migrations from ${role}`);
};
