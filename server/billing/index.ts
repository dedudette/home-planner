import Stripe from 'stripe';
import type { AccountView } from '../../src/domain/billing/account';
import { buildAccountView } from '../account/view';
import type { AccountsRuntime } from '../app';
import { readBillingConfig, type BillingConfig } from './config';
import { createBillingService } from './service';
import type { BillingService } from './types';
import type { Env } from '../coach/config';

export const createStripeClient = (cfg: BillingConfig, fetchImpl?: typeof fetch): Stripe =>
  new Stripe(cfg.secretKey, {
    maxNetworkRetries: 2,
    timeout: 20_000,
    telemetry: false,
    appInfo: { name: 'CleanFlow' },
    ...(cfg.apiBase ? { protocol: cfg.apiBase.protocol, host: cfg.apiBase.host, port: cfg.apiBase.port } : {}),
    ...(fetchImpl ? { httpClient: Stripe.createFetchHttpClient(fetchImpl) } : {}),
  });

type Runtime = Pick<AccountsRuntime, 'db' | 'config' | 'mailer' | 'now' | 'log' | 'entitlements' | 'ledger'>;

const unavailable = (reason: string): BillingService => ({
  status: () => ({ available: false, reason, mode: null }),
  handle: async (req) => {
    const path = new URL(req.url).pathname;
    // A webhook that arrives while billing is off is refused so the provider keeps retrying until billing is on.
    return new Response(JSON.stringify({ ok: false, error: { code: 'billing-unavailable', message: path === '/api/billing/webhook' ? 'Billing is not configured.' : 'Subscriptions are not available on this server yet.' } }), { status: 503, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
  },
  beforeDeleteAccount: async () => undefined,
  tick: async () => undefined,
});

/** Billing from the server's environment: null when no Stripe key is set at all, a clearly "unavailable" service when it is set but not usable. */
export const createBillingFromEnv = (env: Env, rt: Runtime & { billing: () => BillingService | null }, o: { stripe?: Stripe; fetch?: typeof fetch } = {}): BillingService | null => {
  const r = readBillingConfig(env);
  if (r.kind === 'absent') return null;
  if (r.kind === 'off') { rt.log({ event: 'billing.off', code: r.reason.split(':')[0].slice(0, 40) }); return unavailable(r.reason.split(':')[0].slice(0, 60)); }
  const stripe = o.stripe ?? createStripeClient(r.config, o.fetch);
  const accountView = (user: Parameters<typeof buildAccountView>[1]): Promise<AccountView | null> =>
    buildAccountView({ entitlements: rt.entitlements, ledger: rt.ledger, billing: rt.billing()?.status() ?? { available: false, reason: 'not-configured' }, now: rt.now }, user);
  const svc = createBillingService({ db: rt.db, config: r.config, appOrigin: rt.config.appOrigin, stripe, mailer: rt.mailer, entitlements: rt.entitlements, accountView, now: rt.now, log: rt.log });
  void svc.verifyPrices();
  return svc;
};
