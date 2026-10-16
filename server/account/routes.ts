import type { PublicConfig } from '../../src/domain/billing/account';
import type { Ledger } from '../ai/ledger';
import { sessionUser, type Auth } from '../auth/auth';
import type { AccountsConfig } from '../config';
import { withUser, type Db } from '../db/pool';
import { fail, json, originOk } from '../http';
import type { EntitlementService } from '../billing/entitlements';
import type { Mailer } from '../mail/mailer';
import { startTrial } from '../trial/trial';
import { backupRoutes } from './backup';
import { buildAccountView, type BillingStatus } from './view';

/**
 * The account endpoints. Each one identifies the caller from the server-side session and nothing else: no user id in a URL, a body or a
 * header is ever read, so there is no id to forge.
 *
 *   GET  /api/config            public: which mode the server is in, whether billing is available, whether email really delivers
 *   GET  /api/account           the signed-in account: entitlement, trial, subscription, real AI allowance
 *   POST /api/account/trial     start the 14-day trial (verified account, explicit request, once)
 *   GET  /api/account/export    everything the server holds about the account, as a download; always available, whatever the state
 *   GET/PUT/DELETE /api/account/backup   optional cloud backup of plan data (see backup.ts); reading and deleting are always available
 *
 * Sign-up, sign-in, sign-out, email verification, password reset, password change and account deletion are Better Auth's own routes
 * under /api/auth/*.
 */
export interface AccountDeps {
  db: Db;
  auth: Auth;
  config: AccountsConfig;
  entitlements: EntitlementService;
  ledger: Ledger;
  mailer: Mailer;
  billing: () => BillingStatus & { mode: 'test' | 'live' | null };
  legal: PublicConfig['accounts'] extends infer A ? (A extends { legal: infer L } ? L : never) : never;
  now: () => Date;
  log?: (e: { event: string; code?: string }) => void;
}

export const createAccountRoutes = (deps: AccountDeps) => {
  const log = deps.log ?? (() => undefined);
  const backup = backupRoutes(deps.db, { now: deps.now, fullAccess: async (id) => (await deps.entitlements.get(id, deps.now()))?.entitlement.access === 'full' });
  return async (req: Request): Promise<Response | null> => {
    const path = new URL(req.url).pathname;

    if (path === '/api/config') {
      if (req.method !== 'GET') return fail(405, 'method', 'Use GET.', {}, { allow: 'GET' });
      const b = deps.billing();
      const body: PublicConfig = { mode: 'accounts', accounts: { billing: { available: b.available, reason: b.reason, mode: b.mode }, mail: { delivers: deps.mailer.delivers }, legal: deps.legal } };
      return json(200, body);
    }

    if (path !== '/api/account' && !path.startsWith('/api/account/')) return null;
    if (!originOk(req, deps.config.appOrigin)) { log({ event: 'account.rejected', code: 'origin' }); return fail(403, 'origin', 'This request did not come from the app.'); }

    let user;
    try { user = await sessionUser(deps.auth, req); } catch { return fail(503, 'unavailable', 'Accounts are unavailable just now. Try again in a moment.'); }
    if (!user) return fail(401, 'unauthenticated', 'Sign in to continue.');

    try {
      if (path === '/api/account') {
        if (req.method !== 'GET') return fail(405, 'method', 'Use GET.', {}, { allow: 'GET' });
        const view = await buildAccountView({ entitlements: deps.entitlements, ledger: deps.ledger, billing: deps.billing(), now: deps.now }, user);
        if (!view) return fail(401, 'unauthenticated', 'Sign in to continue.');
        return json(200, { ok: true, account: view });
      }

      if (path === '/api/account/trial') {
        if (req.method !== 'POST') return fail(405, 'method', 'Use POST.', {}, { allow: 'POST' });
        const r = await startTrial(deps.db, { userId: user.id, email: user.email, secret: deps.config.trialClaimSecret, now: deps.now(), policy: deps.config.policy });
        if (!r.ok) {
          const [status, message] = r.code === 'unverified' ? [403, 'Confirm your email address first.']
            : r.code === 'already-used' ? [409, 'The 14-day trial has already been used for this account.']
            : r.code === 'not-eligible' ? [409, 'The trial is not available for this account.']
            : [401, 'Sign in to continue.'];
          return fail(status as number, r.code, message as string);
        }
        const view = await buildAccountView({ entitlements: deps.entitlements, ledger: deps.ledger, billing: deps.billing(), now: deps.now }, user);
        return json(200, { ok: true, account: view });
      }

      if (path === '/api/account/backup') {
        if (req.method === 'GET') return await backup.get(user.id, new URL(req.url).searchParams.get('meta') === '1');
        if (req.method === 'PUT') return await backup.put(user.id, req);
        if (req.method === 'DELETE') return await backup.remove(user.id);
        return fail(405, 'method', 'Use GET, PUT or DELETE.', {}, { allow: 'GET, PUT, DELETE' });
      }

      if (path === '/api/account/export') {
        if (req.method !== 'GET') return fail(405, 'method', 'Use GET.', {}, { allow: 'GET' });
        const data = await withUser(deps.db, user.id, async (c) => {
          const u = await c.query('select id, name, email, "emailVerified", "createdAt" from "user" where id = $1', [user.id]);
          const trial = await c.query('select started_at, ends_at from trial_claims where user_id = $1', [user.id]);
          const subs = await c.query('select provider, provider_subscription_id, plan, status, started_at, current_period_start, current_period_end, cancel_at_period_end, canceled_at, amount_cents, currency from subscriptions where user_id = $1 order by id', [user.id]);
          const usage = await c.query('select window_key, window_end, used from ai_usage_counters where user_id = $1 order by window_end', [user.id]);
          const notes = await c.query('select kind, status, created_at, sent_at from notifications where user_id = $1 order by id', [user.id]);
          const backup = await c.query('select revision, includes, size_bytes, updated_at from user_backups where user_id = $1', [user.id]);
          return { profile: u.rows[0], trial: trial.rows[0] ?? null, subscriptions: subs.rows, aiUsage: usage.rows, notifications: notes.rows, cloudBackup: backup.rows[0] ?? null };
        });
        const body = JSON.stringify({ app: 'cleanflow-account', exportVersion: 1, exportedAt: deps.now().toISOString(), note: 'This is what the server holds about your account. Your plan, history and journal live on your device and are exported from the app (Settings → Back up your data), unless you chose cloud backup.', ...data }, null, 2);
        return new Response(body, { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', 'content-disposition': 'attachment; filename="cleanflow-account.json"', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
      }
    } catch (e) {
      log({ event: 'account.error', code: (e as { code?: string }).code ?? 'exception' });
      return fail(503, 'unavailable', 'Accounts are unavailable just now. Nothing was changed. Try again in a moment.');
    }
    return null;
  };
};
