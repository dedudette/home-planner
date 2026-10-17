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
import { appDataForDemo, DEMO_PROFILES } from '../../src/domain/demo';
import { reducer } from '../../src/state/reducer';

/**
 * A throwaway server for the browser checks of the account screens: the built app (dist/), the real API (real Better Auth, real
 * PostgreSQL) and a mailbox instead of an email provider, so a test can read the confirmation and reset links.
 *
 *   MODE=accounts (default)  a fresh, freshly migrated database and a capture mailer; GET /__test/mail?to=… lists what was "sent"
 *   MODE=local               no accounts at all: the original single-device app
 *   E2E_BILLING=fake         accounts mode with billing wired to tests/support/fakeStripe.ts: a MOCK payment provider (the real Stripe SDK talks
 *                            to a local stand-in). Proves this app's behaviour, not Stripe's. GET /__test/complete?session=cs_… "pays" a checkout.
 *                            GET /__test/provider?email=…&op=… plays what the provider would do (past_due, unpaid, active, portal-cancel, portal-resume,
 *                            portal-annual, dispute-open, dispute-won, refund, canceled, renew, requires-action&session=…), each followed by the signed
 *                            webhook the provider would send. GET /__test/advance?days=N moves the SERVER's clock on. GET /__test/use?email=…&n=N spends
 *                            N AI requests through the real ledger. GET /__test/state?email=… reports what the mock provider holds.
 *
 *   GET /__test/seed?name=…&demo=N   (any mode) a complete, valid plan as JSON text, for a test to put in browser storage: demo profile N with history,
 *                            named `name`, plus two private journal entries, one check-in note and three days of imported health readings that all
 *                            carry the name, so a test can tell whose data it is looking at and whether anything private went anywhere.
 *
 * Needs TEST_DATABASE_URL for accounts mode (scripts/test-db.sh sets it) and `npm run build` first. Test use only: the /__test routes exist
 * nowhere else.
 */
const PORT = Number(process.env.E2E_PORT ?? 18123);
const MODE = process.env.MODE === 'local' ? 'local' : 'accounts';
const ORIGIN = `http://127.0.0.1:${PORT}`;
const root = resolve('dist');
const DAY_MS = 86_400_000;
let clockOffset = 0;                      // test-only: how far the SERVER's clock has been moved on

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
  const app = createApp(env, { ...(db ? { db } : {}), mailer, log: () => undefined, now: () => new Date(Date.now() + clockOffset) });
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
    if (u.pathname === '/__test/seed') {
      const name = u.searchParams.get('name') ?? 'Seed';
      const day = (back: number) => new Date(Date.now() - back * DAY_MS).toISOString().slice(0, 10);
      const today = day(0);
      let d = appDataForDemo(DEMO_PROFILES[Number(u.searchParams.get('demo') ?? '0') % DEMO_PROFILES.length].id, { today, withHistory: true });
      d = { ...d, user: { ...d.user, name } };
      for (const [i, text] of ['one', 'two'].entries()) d = reducer(d, { type: 'JOURNAL_SAVE', entry: { id: `j${i}-${name}`, date: today, at: `${today}T2${i}:00:00.000Z`, title: `Title ${name} ${text}`, text: `PRIVATE JOURNAL ${name} ${text}` } });
      d = reducer(d, { type: 'CHECKIN_SAVE', checkin: { id: `c0-${name}`, date: today, at: `${today}T20:30:00.000Z`, energy: 'ok', mood: 3, note: `PRIVATE NOTE ${name}` } });
      d = reducer(d, { type: 'HEALTH_PREFS', enabled: true, read: { steps: true } });
      d = reducer(d, { type: 'HEALTH_MERGE', daily: Object.fromEntries([0, 1, 2].map((b) => [day(b), { steps: 4000 + b, platform: 'healthkit' as const, at: `${day(b)}T10:00:00.000Z` }])), today, at: `${today}T10:00:00.000Z` });
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ...d, _rev: 1 }));
      return;
    }
    if (u.pathname === '/__test/advance') { clockOffset += Number(u.searchParams.get('days') ?? '0') * DAY_MS; res.end(JSON.stringify({ ok: true, now: new Date(Date.now() + clockOffset).toISOString() })); return; }
    if (u.pathname === '/__test/use' && app.runtime) {
      const email = (u.searchParams.get('email') ?? '').toLowerCase();
      void (async () => {
        const rt = app.runtime!;
        const row = (await admin!.query('select id from "user" where email = $1', [email])).rows[0];
        const view = row ? await rt.entitlements.get(row.id, rt.now()) : null;
        if (!view?.window) { res.statusCode = 409; res.end('{"ok":false,"error":"no allowance window"}'); return; }
        let spent = 0;
        for (let i = 0; i < Number(u.searchParams.get('n') ?? '1'); i++) { const r = await rt.ledger.reserve(row.id, view.window, 'coach'); if (r.ok) { await rt.ledger.commit(row.id, r.reservation.requestId); spent++; } }
        res.end(JSON.stringify({ ok: true, spent }));
      })().catch(() => { res.statusCode = 500; res.end(); });
      return;
    }
    if ((u.pathname === '/__test/provider' || u.pathname === '/__test/state') && fake) {
      const email = (u.searchParams.get('email') ?? '').toLowerCase();
      const customer = [...fake.customers.values()].find((c) => c.email === email);
      const sub = customer ? [...fake.subs.values()].filter((s) => s.customer === customer.id).pop() : undefined;
      if (u.pathname === '/__test/state') {
        res.end(JSON.stringify({ customer: customer?.id ?? null, sub: sub ? { id: sub.id, status: sub.status, cancel_at_period_end: sub.cancel_at_period_end, price: sub.items.data[0].price.id } : null, portalSessions: fake.portalSessions.filter((p) => p.customer === customer?.id).length, requests: fake.requests.filter((r) => r.method === 'POST').map((r) => `${r.path} ${JSON.stringify(r.form)}`).slice(-12) }));
        return;
      }
      const op = u.searchParams.get('op') ?? '';
      const nowSec = Math.floor((Date.now() + clockOffset) / 1000);
      const send = async (type: string, obj: unknown) => {
        const e = fake!.event(type, obj);
        const r = await app.handler(new Request(`${ORIGIN}/api/billing/webhook`, { method: 'POST', headers: { 'stripe-signature': e.header, 'content-type': 'application/json', 'x-coach-client': '54.0.0.1' }, body: e.payload }));
        return r?.status ?? 0;
      };
      void (async () => {
        let status = 200;
        const sid = u.searchParams.get('session') ?? '';
        if (op === 'requires-action') status = await send('customer.subscription.created', fake!.completeCheckout(sid, 'requires-action'));
        else if (!sub || !customer) { res.statusCode = 404; res.end('{"ok":false,"error":"no subscription"}'); return; }
        else if (op === 'past_due') { fake!.patchSub(sub.id, { status: 'past_due' }, { current_period_start: nowSec, current_period_end: nowSec + 30 * 86400 }); status = await send('invoice.payment_failed', { id: `in_${nowSec}`, parent: { subscription_details: { subscription: sub.id } } }); }
        else if (op === 'unpaid') { fake!.patchSub(sub.id, { status: 'unpaid' }); status = await send('customer.subscription.updated', sub); }
        else if (op === 'active') { fake!.patchSub(sub.id, { status: 'active' }); status = await send('invoice.paid', { id: `in_ok_${nowSec}`, parent: { subscription_details: { subscription: sub.id } } }); }
        else if (op === 'portal-cancel') { fake!.patchSub(sub.id, { cancel_at_period_end: true, canceled_at: nowSec }); status = await send('customer.subscription.updated', sub); }
        else if (op === 'portal-resume') { fake!.patchSub(sub.id, { cancel_at_period_end: false, canceled_at: null }); status = await send('customer.subscription.updated', sub); }
        else if (op === 'portal-annual') { fake!.changePlan(sub.id, 'price_annual'); status = await send('customer.subscription.updated', sub); }
        else if (op === 'canceled') { fake!.patchSub(sub.id, { status: 'canceled', canceled_at: nowSec }); status = await send('customer.subscription.deleted', sub); }
        else if (op === 'renew') { fake!.renew(sub.id); status = await send('invoice.paid', { id: `in_r_${nowSec}`, parent: { subscription_details: { subscription: sub.id } } }); }
        else if (op === 'dispute-open' || op === 'dispute-won') { const ch = fake!.addCharge(customer.id, { amount: 2500 }); status = await send('charge.dispute.created', fake!.addDispute(ch.id, op === 'dispute-open' ? 'needs_response' : 'won')); }
        else if (op === 'refund') status = await send('charge.refunded', fake!.addCharge(customer.id, { amount: 2500, refunded: true }));
        else { res.statusCode = 400; res.end('{"ok":false,"error":"unknown op"}'); return; }
        res.end(JSON.stringify({ ok: status === 200, webhook: status }));
      })().catch((e) => { res.statusCode = 500; res.end(JSON.stringify({ ok: false, error: String(e) })); });
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
