import { DEFAULT_ALLOWANCE, type AllowanceConfig } from '../src/domain/billing/usage';
import { DEFAULT_POLICY, type EntitlementPolicy } from '../src/domain/billing/entitlement';
import type { Env } from './coach/config';

/**
 * Server settings for accounts and billing, from environment variables only. Nothing here is sent to a browser, and secret values are
 * never put in an error message: problems name the VARIABLE, not its value. The server fails closed: a half-configured accounts setup
 * is reported at start-up as a list of problems and the server does not serve the app, instead of quietly running unprotected.
 *
 *   CLEANFLOW_MODE        "accounts" or "local". Default: accounts when DATABASE_URL is set, otherwise local (the original
 *                         single-device app with no accounts, for personal use and development).
 *   REQUIRE_ACCOUNTS=1    refuse to start in local mode. Set it on any public deployment.
 *   APP_ORIGIN            the public origin of the app, e.g. https://app.example.com (no path). Used for cookies, redirects and checkout.
 *   DATABASE_URL          the limited application role's connection string.
 *   DATABASE_ADMIN_URL    only for `npm run db:migrate`; never needed by the running server.
 *   BETTER_AUTH_SECRET    ≥ 32 random characters. Signs sessions. Rotating it signs everyone out.
 *   TRIAL_CLAIM_SECRET    ≥ 32 random characters, different from the above. Keys the one-trial-per-person record. Do not rotate it.
 *   NODE_ENV=production   secure cookies, and the mail provider must be a real one.
 *   MAIL_PROVIDER         "resend" (needs RESEND_API_KEY and MAIL_FROM) or "console" (development only: prints, delivers nothing).
 *   AI_TRIAL_ALLOWANCE    answered AI requests per 14-day trial (default 50).
 *   AI_MONTHLY_ALLOWANCE  answered AI requests per month for either plan (default 300).
 *   PAST_DUE_GRACE_DAYS   days of access after a failed renewal (default 3).
 *   Billing (Stripe) variables are read by billing/config.ts.
 */
export type ServerMode =
  | { kind: 'local' }
  | { kind: 'accounts'; config: AccountsConfig }
  | { kind: 'invalid'; problems: string[] };

export interface AccountsConfig {
  appOrigin: string;
  production: boolean;
  databaseUrl: string;
  /** Not enumerable: a stray JSON.stringify or console.log of the config cannot print them. */
  readonly authSecret: string;
  readonly trialClaimSecret: string;
  allowance: AllowanceConfig;
  policy: EntitlementPolicy;
  mail: { provider: 'resend' | 'console'; from: string; resendKey?: string };
  trustProxy: boolean;
}

const int = (v: string | undefined, dflt: number, min: number, max: number): number => {
  const n = v === undefined || v.trim() === '' ? NaN : Number(v);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : dflt;
};

export const readServerMode = (env: Env): ServerMode => {
  const problems: string[] = [];
  const dbUrl = (env.DATABASE_URL ?? '').trim();
  const modeVar = (env.CLEANFLOW_MODE ?? '').trim().toLowerCase();
  if (modeVar && modeVar !== 'accounts' && modeVar !== 'local') problems.push('CLEANFLOW_MODE must be "accounts" or "local".');
  const mode = modeVar === 'accounts' || modeVar === 'local' ? modeVar : dbUrl ? 'accounts' : 'local';
  if (mode === 'local') {
    if (env.REQUIRE_ACCOUNTS === '1') problems.push('REQUIRE_ACCOUNTS=1 but the server is in local mode (set DATABASE_URL and the account settings).');
    return problems.length ? { kind: 'invalid', problems } : { kind: 'local' };
  }

  const production = env.NODE_ENV === 'production';
  if (!dbUrl) problems.push('DATABASE_URL is not set.');
  const origin = (env.APP_ORIGIN ?? '').trim().replace(/\/+$/, '');
  let appOrigin = '';
  try {
    const u = new URL(origin);
    if ((u.protocol !== 'https:' && !(u.protocol === 'http:' && !production)) || u.pathname !== '/' && u.pathname !== '') throw new Error('x');
    if (production && u.protocol !== 'https:') throw new Error('x');
    appOrigin = u.origin;
  } catch { problems.push(production ? 'APP_ORIGIN must be an https origin such as https://app.example.com.' : 'APP_ORIGIN must be an origin such as http://localhost:5173.'); }
  const secret = (env.BETTER_AUTH_SECRET ?? '').trim();
  if (secret.length < 32) problems.push('BETTER_AUTH_SECRET must be at least 32 random characters.');
  const claim = (env.TRIAL_CLAIM_SECRET ?? '').trim();
  if (claim.length < 32) problems.push('TRIAL_CLAIM_SECRET must be at least 32 random characters.');
  if (secret && claim && secret === claim) problems.push('TRIAL_CLAIM_SECRET must differ from BETTER_AUTH_SECRET.');

  const provider = ((env.MAIL_PROVIDER ?? '').trim().toLowerCase() || (production ? '' : 'console')) as string;
  const from = (env.MAIL_FROM ?? '').trim() || 'CleanFlow <no-reply@localhost>';
  let mail: AccountsConfig['mail'] = { provider: 'console', from };
  if (provider === 'resend') {
    const key = (env.RESEND_API_KEY ?? '').trim();
    if (!key) problems.push('MAIL_PROVIDER=resend needs RESEND_API_KEY.');
    if (!(env.MAIL_FROM ?? '').trim()) problems.push('MAIL_PROVIDER=resend needs MAIL_FROM (a sender address your provider has verified).');
    mail = { provider: 'resend', from, resendKey: key };
  } else if (provider === 'console') {
    if (production) problems.push('MAIL_PROVIDER=console delivers nothing and is not allowed with NODE_ENV=production.');
  } else {
    problems.push(production ? 'Set MAIL_PROVIDER=resend (and RESEND_API_KEY, MAIL_FROM): verification and password-reset emails must be delivered.' : 'MAIL_PROVIDER must be "resend" or "console".');
  }
  if (problems.length) return { kind: 'invalid', problems };

  const config = {
    appOrigin,
    production,
    databaseUrl: dbUrl,
    allowance: { trial: int(env.AI_TRIAL_ALLOWANCE, DEFAULT_ALLOWANCE.trial, 0, 10_000), monthly: int(env.AI_MONTHLY_ALLOWANCE, DEFAULT_ALLOWANCE.monthly, 0, 100_000) },
    policy: { ...DEFAULT_POLICY, pastDueGraceDays: int(env.PAST_DUE_GRACE_DAYS, DEFAULT_POLICY.pastDueGraceDays, 0, 30) },
    mail,
    trustProxy: env.COACH_TRUST_PROXY === '1' || env.TRUST_PROXY === '1',
  };
  Object.defineProperty(config, 'authSecret', { value: secret, enumerable: false });
  Object.defineProperty(config, 'trialClaimSecret', { value: claim, enumerable: false });
  if (config.mail.resendKey) Object.defineProperty(config.mail, 'resendKey', { value: config.mail.resendKey, enumerable: false });
  return { kind: 'accounts', config: config as AccountsConfig };
};
