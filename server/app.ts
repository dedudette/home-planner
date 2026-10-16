import type { AiGate } from './ai/gate';
import { createAiGate } from './ai/gate';
import { createLedger, type Ledger } from './ai/ledger';
import { createAccountRoutes } from './account/routes';
import { createAuth, sessionUser, type Auth } from './auth/auth';
import { createEntitlementService, type EntitlementService } from './billing/entitlements';
import type { BillingService } from './billing/types';
import type { Env } from './coach/config';
import type { AccountsConfig } from './config';
import { createDb, type Db } from './db/pool';
import { createConsoleMailer, createResendMailer, type Mailer } from './mail/mailer';
import type { PublicConfig } from '../src/domain/billing/account';

/**
 * Wires the accounts side of the server: database, Better Auth, entitlement service, usage ledger, the AI gate, billing. It exists only
 * in accounts mode; local mode (no DATABASE_URL, the original single-device app) has none of it and no endpoint here answers.
 */
export interface LegalLinks { privacy: string | null; terms: string | null; billing: string | null; company: string | null }

export interface AccountsRuntime {
  config: AccountsConfig;
  db: Db;
  auth: Auth;
  mailer: Mailer;
  entitlements: EntitlementService;
  ledger: Ledger;
  gate: AiGate;
  billing: BillingService | null;
  legal: LegalLinks;
  now: () => Date;
  log: (e: { event: string; code?: string }) => void;
  /** Periodic housekeeping: release stale reservations, run billing notifications. Safe to call often and from several instances. */
  tick(): Promise<void>;
  close(): Promise<void>;
}

export interface RuntimeOverrides {
  db?: Db;
  mailer?: Mailer;
  now?: () => Date;
  log?: (e: { event: string; code?: string }) => void;
  /** Built after the auth and database exist, because deleting an account has to reach billing. */
  billing?: (rt: Pick<AccountsRuntime, 'db' | 'config' | 'mailer' | 'now' | 'log'>) => BillingService | null;
  maxOutputTokens?: number;
  legal?: Partial<LegalLinks>;
  fetch?: typeof fetch;
}

const legalFromEnv = (env: Env): LegalLinks => {
  const url = (v: string | undefined): string | null => { const s = (v ?? '').trim(); try { return s && new URL(s).protocol === 'https:' ? s : null; } catch { return null; } };
  const text = (v: string | undefined): string | null => (v ?? '').trim() || null;
  return { privacy: url(env.LEGAL_PRIVACY_URL), terms: url(env.LEGAL_TERMS_URL), billing: url(env.LEGAL_BILLING_URL), company: text(env.LEGAL_COMPANY_NAME) };
};

export const buildAccountsRuntime = (config: AccountsConfig, env: Env, o: RuntimeOverrides = {}): AccountsRuntime => {
  const now = o.now ?? (() => new Date());
  const log = o.log ?? ((e) => console.warn(JSON.stringify(e)));
  const db = o.db ?? createDb(config.databaseUrl);
  const mailer = o.mailer ?? (config.mail.provider === 'resend' ? createResendMailer({ apiKey: config.mail.resendKey!, from: config.mail.from, fetch: o.fetch }) : createConsoleMailer());
  const entitlements = createEntitlementService(db, { allowance: config.allowance, policy: config.policy, now });
  const ledger = createLedger(db, { now });
  let billing: BillingService | null = null;
  const auth = createAuth({ db, config, mailer, hooks: { log, beforeDelete: async (u) => { if (billing) await billing.beforeDeleteAccount(u); } } });
  const gate = createAiGate({ identify: async (req) => { const u = await sessionUser(auth, req); return u ? { userId: u.id } : null; }, entitlements, ledger, now, maxOutputTokens: o.maxOutputTokens ?? 2_000, log });
  const rt: AccountsRuntime = {
    config, db, auth, mailer, entitlements, ledger, gate, billing: null, legal: { ...legalFromEnv(env), ...o.legal }, now, log,
    async tick() {
      await ledger.reapStale(now()).catch(() => log({ event: 'tick.error', code: 'reap' }));
      if (billing) await billing.tick(now()).catch(() => log({ event: 'tick.error', code: 'billing' }));
    },
    async close() { if (!o.db) await db.end().catch(() => undefined); },
  };
  billing = o.billing ? o.billing(rt) : null;
  rt.billing = billing;
  return rt;
};

export const accountRoutesFor = (rt: AccountsRuntime) =>
  createAccountRoutes({
    db: rt.db, auth: rt.auth, config: rt.config, entitlements: rt.entitlements, ledger: rt.ledger, mailer: rt.mailer, legal: rt.legal, now: rt.now, log: rt.log,
    billing: () => rt.billing?.status() ?? { available: false, reason: 'not-configured', mode: null },
  });

export const publicConfigLocal = (): PublicConfig => ({ mode: 'local' });
