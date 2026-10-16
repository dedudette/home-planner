import type { Env } from '../coach/config';

/**
 * Stripe settings, from environment variables only (a secret never reaches a browser, a log line or an error message: problems name the
 * variable, not its value). Test mode is the default and the only mode this repository has been run in.
 *
 *   STRIPE_SECRET_KEY         sk_test_… (or a restricted rk_test_… key). Unset: billing is off and says so.
 *   STRIPE_WEBHOOK_SECRET     whsec_… for the webhook endpoint you registered at <APP_ORIGIN>/api/billing/webhook.
 *   STRIPE_PRICE_MONTHLY      price_… for €25/month. The server checks it really is €25, EUR, monthly, before taking anyone to checkout.
 *   STRIPE_PRICE_ANNUAL       price_… for €255/year, checked the same way.
 *   STRIPE_PORTAL_CONFIGURATION  optional bpc_… (scripts/stripe-setup.ts creates one).
 *   BILLING_TAX_MODE          required, no default: "stripe_tax_inclusive" (prices include tax, Stripe Tax calculates it; the intended
 *                             production setting) or "none_sandbox_only" (no tax handling, test mode only). Unset keeps billing off.
 *   BILLING_ENV               "test" (default) or "live". The key's prefix must agree.
 *   BILLING_LIVE_CONFIRM      must equal "reviewed-tax-legal-refund-policy" before a live key is accepted. Nothing in this repository sets it.
 *   STRIPE_API_BASE_URL       test mode only: send API calls to a local stand-in (http://127.0.0.1:port) instead of Stripe.
 */
export type TaxMode = 'stripe_tax_inclusive' | 'none_sandbox_only';

export interface BillingConfig {
  readonly secretKey: string;
  readonly webhookSecret: string;
  priceMonthly: string;
  priceAnnual: string;
  portalConfiguration: string | null;
  taxMode: TaxMode;
  env: 'test' | 'live';
  apiBase: { protocol: 'http' | 'https'; host: string; port: number } | null;
}

export type BillingConfigResult =
  | { kind: 'absent' }
  | { kind: 'off'; reason: string }
  | { kind: 'on'; config: BillingConfig };

export const LIVE_CONFIRMATION = 'reviewed-tax-legal-refund-policy';

export const readBillingConfig = (env: Env): BillingConfigResult => {
  const key = (env.STRIPE_SECRET_KEY ?? '').trim();
  if (!key) return { kind: 'absent' };
  const mode = ((env.BILLING_ENV ?? '').trim().toLowerCase() || 'test');
  if (mode !== 'test' && mode !== 'live') return { kind: 'off', reason: 'BILLING_ENV must be "test" or "live".' };
  const isTestKey = /^(sk|rk)_test_/.test(key);
  const isLiveKey = /^(sk|rk)_live_/.test(key);
  if (!isTestKey && !isLiveKey) return { kind: 'off', reason: 'STRIPE_SECRET_KEY is not a Stripe secret or restricted key.' };
  if (mode === 'test' && !isTestKey) return { kind: 'off', reason: 'BILLING_ENV=test but STRIPE_SECRET_KEY is a live key. Live keys are refused in test mode.' };
  if (mode === 'live' && !isLiveKey) return { kind: 'off', reason: 'BILLING_ENV=live but STRIPE_SECRET_KEY is not a live key.' };
  if (mode === 'live' && (env.BILLING_LIVE_CONFIRM ?? '').trim() !== LIVE_CONFIRMATION) return { kind: 'off', reason: 'live-not-activated: a live key is set but BILLING_LIVE_CONFIRM is not. Live billing needs a reviewed tax, legal and refund setup first (docs/billing.md).' };
  const tax = (env.BILLING_TAX_MODE ?? '').trim();
  if (tax !== 'stripe_tax_inclusive' && tax !== 'none_sandbox_only') return { kind: 'off', reason: 'tax-not-configured: set BILLING_TAX_MODE to "stripe_tax_inclusive" or (test mode only) "none_sandbox_only".' };
  if (tax === 'none_sandbox_only' && mode === 'live') return { kind: 'off', reason: 'BILLING_TAX_MODE=none_sandbox_only is not allowed with live billing.' };
  const whsec = (env.STRIPE_WEBHOOK_SECRET ?? '').trim();
  if (!/^whsec_/.test(whsec)) return { kind: 'off', reason: 'STRIPE_WEBHOOK_SECRET (whsec_…) is not set.' };
  const pm = (env.STRIPE_PRICE_MONTHLY ?? '').trim();
  const pa = (env.STRIPE_PRICE_ANNUAL ?? '').trim();
  if (!/^price_/.test(pm) || !/^price_/.test(pa)) return { kind: 'off', reason: 'STRIPE_PRICE_MONTHLY and STRIPE_PRICE_ANNUAL (price_…) are not both set.' };
  if (pm === pa) return { kind: 'off', reason: 'STRIPE_PRICE_MONTHLY and STRIPE_PRICE_ANNUAL must be different prices.' };
  let apiBase: BillingConfig['apiBase'] = null;
  const base = (env.STRIPE_API_BASE_URL ?? '').trim();
  if (base) {
    if (mode !== 'test') return { kind: 'off', reason: 'STRIPE_API_BASE_URL is only allowed in test mode.' };
    try { const u = new URL(base); apiBase = { protocol: u.protocol === 'https:' ? 'https' : 'http', host: u.hostname, port: Number(u.port || (u.protocol === 'https:' ? 443 : 80)) }; }
    catch { return { kind: 'off', reason: 'STRIPE_API_BASE_URL is not a URL.' }; }
  }
  const portal = (env.STRIPE_PORTAL_CONFIGURATION ?? '').trim();
  const config = { priceMonthly: pm, priceAnnual: pa, portalConfiguration: portal || null, taxMode: tax as TaxMode, env: mode as 'test' | 'live', apiBase };
  Object.defineProperty(config, 'secretKey', { value: key, enumerable: false });
  Object.defineProperty(config, 'webhookSecret', { value: whsec, enumerable: false });
  return { kind: 'on', config: config as BillingConfig };
};
