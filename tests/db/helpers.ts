import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { migrate } from '../../server/db/migrate';
import { createDb, type Db } from '../../server/db/pool';

/**
 * Real PostgreSQL for the tests that need it. TEST_DATABASE_URL points at a server where the caller may create databases (a superuser;
 * `npm run test:db` starts a throwaway local cluster and sets it). Each test file gets its own freshly migrated database, and the code
 * under test connects as the limited `cleanflow_app` role, exactly as the server does, so row-level security is really in force.
 */
export const DB_URL = process.env.TEST_DATABASE_URL ?? '';
export const haveDb = DB_URL !== '';
export const APP_ROLE = 'cleanflow_app';

export interface TestDb { db: Db; admin: Pool; name: string; close: () => Promise<void> }

const swapDatabase = (url: string, name: string, user?: string): string => {
  const u = new URL(url);
  u.pathname = `/${name}`;
  if (user) { u.username = user; u.password = ''; }
  return u.toString();
};

export const createTestDb = async (): Promise<TestDb> => {
  if (!haveDb) throw new Error('TEST_DATABASE_URL is not set; run `npm run test:db`.');
  const boot = new Pool({ connectionString: DB_URL, max: 1 });
  const name = `cf_${randomBytes(6).toString('hex')}`;
  await boot.query(`create database ${name}`);
  const roles = await boot.query('select 1 from pg_roles where rolname = $1', [APP_ROLE]);
  if (!roles.rowCount) await boot.query(`create role ${APP_ROLE} login`).catch((e: { code?: string }) => { if (e.code !== '42710') throw e; });
  await boot.end();
  const admin = new Pool({ connectionString: swapDatabase(DB_URL, name), max: 4 });
  admin.on('error', () => undefined);       // an idle connection closed by the database during teardown is not a test failure
  await migrate(admin, { appRole: APP_ROLE });
  const db = createDb(swapDatabase(DB_URL, name, APP_ROLE), { max: 12 });
  return {
    db, admin, name,
    close: async () => {
      await db.end();
      await admin.end();
      const drop = new Pool({ connectionString: DB_URL, max: 1 });
      await drop.query(`drop database if exists ${name} with (force)`).catch(() => undefined);
      await drop.end();
    },
  };
};

export const addUser = async (admin: Pool, id: string, email = `${id}@example.test`, verified = true): Promise<void> => {
  await admin.query('insert into "user" (id, name, email, "emailVerified") values ($1, $2, $3, $4)', [id, id, email, verified]);
};
