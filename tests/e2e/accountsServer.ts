import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { extname, resolve } from 'node:path';
import { Pool } from 'pg';
import { migrate } from '../../server/db/migrate';
import { createDb } from '../../server/db/pool';
import { createApp } from '../../server/createApp';
import { createCaptureMailer } from '../../server/mail/mailer';
import { handleNodeRequest } from '../../server/nodeAdapter';
import { resolveStatic } from '../../server/static';
import { startFakeStripe, type FakeStripe } from '../support/fakeStripe';

/**
 * A throwaway server for the browser checks of the account screens: the built app (dist/), the real API (real Better Auth, real
 * PostgreSQL) and a mailbox instead of an email provider, so a test can read the confirmation and reset links.
 *
 *   MODE=accounts (default)  a fresh, freshly migrated database and a capture mailer; GET /__test/mail?to=… lists what was "sent"
 *   MODE=local               no accounts at all: the original single-device app
 *   E2E_BILLING=fake         accounts mode with billing wired to tests/support/fakeStripe.ts: a MOCK payment provider (the real Stripe SDK talks
 *                            to a local stand-in). Proves this app's behaviour, not Stripe's. GET /__test/complete?session=cs_… "pays" a checkout.
 *
 * Needs TEST_DATABASE_URL for accounts mode (scripts/test-db.sh sets it) and `npm run build` first. Test use only: the /__test routes exist
 * nowhere else.
 */
const PORT = Number(process.env.E2E_PORT ?? 18123);
const MODE = process.env.MODE === 'local' ? 'local' : 'accounts';
const ORIGIN = `http://127.0.0.1:${PORT}`;
const root = resolve('dist');

const main = async () => {
  const mailer = createCaptureMailer();
  let db: ReturnType<typeof createDb> | undefined;
  let dbName = '';
  let admin: Pool | undefined;
  const env: Record<string, string> = MODE === 'local' ? {} : { CLEANFLOW_MODE: 'accounts', APP_ORIGIN: ORIGIN, DATABASE_URL: 'postgres://unused/unused', BETTER_AUTH_SECRET: 'e2e-secret-'.padEnd(40, 'x'), TRIAL_CLAIM_SECRET: 'e2e-claim-'.padEnd(40, 'y'), MAIL_PROVIDER: 'console' };
  let fake: FakeStripe | undefined;
  if (MODE === 'accounts' && process.env.E2E_BILLING === 'fake') {
    fake = await startFakeStripe();
    fake.seedPrice('price_monthly', { amount: 2500, interval: 'month' });
    fake.seedPrice('price_annual', { amount: 25500, interval: 'year' });
    Object.assign(env, { STRIPE_SECRET_KEY: 'sk_test_fake_0123456789', STRIPE_WEBHOOK_SECRET: fake.webhookSecret, STRIPE_PRICE_MONTHLY: 'price_monthly', STRIPE_PRICE_ANNUAL: 'price_annual', BILLING_TAX_MODE: 'stripe_tax_inclusive', STRIPE_API_BASE_URL: fake.base });
  }
  if (MODE === 'accounts') {
    const base = process.env.TEST_DATABASE_URL;
    if (!base) throw new Error('TEST_DATABASE_URL is not set (use scripts/test-db.sh run …).');
    const boot = new Pool({ connectionString: base, max: 1 });
    dbName = `cf_e2e_${Math.random().toString(36).slice(2, 10)}`;
    await boot.query(`create database ${dbName}`);
    if (!(await boot.query(`select 1 from pg_roles where rolname = 'cleanflow_app'`)).rowCount) await boot.query('create role cleanflow_app login');
    await boot.end();
    const url = (user?: string) => { const u = new URL(base); u.pathname = `/${dbName}`; if (user) { u.username = user; u.password = ''; } return u.toString(); };
    admin = new Pool({ connectionString: url(), max: 2 });
    await migrate(admin, { appRole: 'cleanflow_app' });
    db = createDb(url('cleanflow_app'));
  }
  const app = createApp(env, { ...(db ? { db } : {}), mailer, log: () => undefined });
  if (app.problems.length) throw new Error(app.problems.join(' '));
  if (fake) for (let i = 0; i < 100 && !app.runtime?.billing?.status().available; i++) await new Promise((r) => setTimeout(r, 50));
  const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
  const server = createServer((req, res) => {
    const u = new URL(req.url ?? '/', ORIGIN);
    if (u.pathname === '/__test/mail') {
      const to = (u.searchParams.get('to') ?? '').toLowerCase();
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(mailer.outbox.filter((m) => !to || m.to === to)));
      return;
    }
    if (u.pathname === '/__test/complete' && fake) {
      const sid = u.searchParams.get('session') ?? '';
      try { fake.completeCheckout(sid, 'paid'); res.end('{"ok":true}'); } catch (e) { res.statusCode = 400; res.end(JSON.stringify({ ok: false, error: String(e) })); }
      return;
    }
    handleNodeRequest(app.handler, req, res, { trustProxy: true }).then((handled) => {
      if (handled) return;
      const found = resolveStatic(root, u.pathname);
      if (found.kind !== 'file') { res.statusCode = found.kind === 'missing' ? 404 : 400; res.end(); return; }
      res.setHeader('content-type', TYPES[extname(found.file)] ?? 'application/octet-stream');
      createReadStream(found.file).pipe(res);
    }, () => { res.statusCode = 500; res.end(); });
  });
  server.listen(PORT, '127.0.0.1', () => console.log(`READY ${ORIGIN} ${MODE}`));
  const stop = async () => {
    server.close();
    await app.close().catch(() => undefined);
    await fake?.close().catch(() => undefined);
    await admin?.end().catch(() => undefined);
    if (dbName) { const d = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 1 }); await d.query(`drop database if exists ${dbName} with (force)`).catch(() => undefined); await d.end(); }
    process.exit(0);
  };
  process.on('SIGTERM', () => void stop());
  process.on('SIGINT', () => void stop());
};
main().catch((e) => { console.error(e); process.exit(1); });
