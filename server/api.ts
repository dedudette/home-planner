import { accountRoutesFor, publicConfigLocal, type AccountsRuntime } from './app';
import { createAssistHandler, type AssistDeps } from './assist/handler';
import { sessionUser } from './auth/auth';
import { createCoachHandler, type CoachDeps } from './coach/handler';
import { fail, json } from './http';

/**
 * Everything the server answers under /api:
 *
 *   /api/config                 which mode this server is in (public)
 *   /api/auth/*                 accounts: sign-up, sign-in, verification, reset, deletion (Better Auth)
 *   /api/account/*              the signed-in account, the trial, export
 *   /api/billing/*              checkout, portal, webhook, sync
 *   /api/coach, /api/assist     the AI endpoints, behind the entitlement gate when accounts are on
 *
 * Without accounts (no DATABASE_URL: the original single-device app) only /api/config, the coach and the assistant exist, and the
 * coach and assistant are limited by the in-memory limiter alone, exactly as before.
 */
export interface ApiHandler {
  (req: Request): Promise<Response | null>;
  describe(): string;
}

export interface ApiDeps extends CoachDeps, AssistDeps {
  accounts?: AccountsRuntime | null;
  /** Problems found reading the server's settings. When present the server answers nothing but a clear error. */
  invalid?: string[];
}

const ACCOUNT_PREFIXES = ['/api/auth', '/api/account', '/api/billing'];

export const createApiHandler = (deps: ApiDeps = {}): ApiHandler => {
  const rt = deps.accounts ?? null;
  const coach = createCoachHandler({ ...deps, ...(rt ? { gate: rt.gate } : {}) });
  const assist = createAssistHandler({ ...deps, ...(rt ? { gate: rt.gate } : {}) });
  const accountRoutes = rt ? accountRoutesFor(rt) : null;

  const h = (async (req: Request): Promise<Response | null> => {
    const path = new URL(req.url).pathname;
    if (deps.invalid) return fail(503, 'server-misconfigured', 'This server is not set up correctly. The operator can see what to fix in the server log.');
    if (path === '/api/config') return rt ? accountRoutes!(req) : json(200, publicConfigLocal());
    if (ACCOUNT_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) {
      if (!rt) return fail(404, 'not-available', 'Accounts are not enabled on this server.');
      if (path.startsWith('/api/auth')) return rt.auth.handler(req);
      if (path.startsWith('/api/billing')) {
        if (!rt.billing) return fail(503, 'billing-not-configured', 'Subscriptions are not available on this server yet.');
        const isWebhook = path === '/api/billing/webhook';
        const user = isWebhook ? null : await sessionUser(rt.auth, req).catch(() => null);
        if (!isWebhook && !user) return fail(401, 'unauthenticated', 'Sign in to continue.');
        return rt.billing.handle(req, user);
      }
      return accountRoutes!(req);
    }
    return (await coach(req)) ?? (await assist(req));
  }) as ApiHandler;
  h.describe = () => (deps.invalid ? `SERVER NOT STARTED: ${deps.invalid.join(' ')}` : coach.describe());
  return h;
};

/** Paths this server owns, so a host knows which requests to hand over. */
export const isApiPath = (url: string): boolean =>
  url.startsWith('/api/coach') || url.startsWith('/api/assist') || url === '/api/config' || ACCOUNT_PREFIXES.some((p) => url === p || url.startsWith(`${p}/`) || url.startsWith(`${p}?`));
