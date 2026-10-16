import { Pool } from 'pg';
import { loadMigrations, migrate } from '../server/db/migrate';

/**
 * Applies the SQL migrations as the database owner, then grants table access to the limited role the server runs as.
 *
 *   DATABASE_ADMIN_URL=postgres://owner:…@host/db APP_DB_ROLE=cleanflow_app npm run db:migrate
 *
 * The role must already exist (`create role cleanflow_app login password '…'`); this script never creates roles or sets passwords.
 */
const url = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
if (!url) { console.error('Set DATABASE_ADMIN_URL (the database owner) first.'); process.exit(2); }
const role = (process.env.APP_DB_ROLE ?? 'cleanflow_app').trim();
const pool = new Pool({ connectionString: url, max: 1 });
try {
  if (role) {
    const r = await pool.query('select 1 from pg_roles where rolname = $1', [role]);
    if (!r.rowCount) { console.error(`The role "${role}" does not exist. Create it first (see docs/deployment.md).`); process.exit(2); }
  }
  const out = await migrate(pool, { appRole: role || undefined, log: (m) => console.log(m) });
  console.log(`${out.applied.length} applied, ${out.alreadyApplied.length} already applied (of ${loadMigrations().length}).`);
} finally {
  await pool.end();
}
