import type { Entitlement } from '../../src/domain/billing/entitlement';
import type { EntitlementService } from '../billing/entitlements';
import type { Ledger, Usage } from './ledger';

/**
 * The single door every paid AI endpoint goes through (coach, assistant, and every Paolo AI endpoint added later). It identifies the
 * caller from the server-side session, asks the entitlement service whether this account may use paid features right now, and reserves
 * one unit of the allowance. If any step says no, the request is answered here and the provider is never called.
 *
 * The handlers receive a ticket and must settle it exactly once: `commit` when the person got a usable answer, `release` otherwise.
 */
export type AiFeature = 'coach' | 'assist' | 'paolo';

export interface AiTicket {
  userId: string;
  /** The most output the provider may be asked for on this request. */
  maxOutputTokens: number;
  commit(usage?: Usage): Promise<void>;
  release(usage?: Usage): Promise<void>;
}

export type GateResult = { ok: true; ticket: AiTicket } | { ok: false; response: Response };

export interface Identity { userId: string }
export interface GateDeps {
  identify: (req: Request) => Promise<Identity | null>;
  entitlements: EntitlementService;
  ledger: Ledger;
  now?: () => Date;
  maxOutputTokens: number;
  log?: (e: { event: string; code?: string }) => void;
}

export interface AiGate { begin(req: Request, feature: AiFeature): Promise<GateResult> }

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers } });
const deny = (status: number, code: string, message: string, extra: Record<string, unknown> = {}): GateResult =>
  ({ ok: false, response: json(status, { ok: false, error: { code, message, ...extra } }) });

const stateMessage = (e: Entitlement): string => {
  switch (e.state) {
    case 'eligible-not-started': return 'Start your 14-day trial or choose a subscription to use AI features.';
    case 'trial-expired': return 'Your trial has ended. Choose a subscription to keep using AI features.';
    case 'expired': return 'Your subscription has ended. Choose a subscription to keep using AI features.';
    case 'payment-action-required': return 'Your first payment needs to be completed before AI features unlock.';
    case 'past-due': case 'unpaid': return 'Your last payment did not go through. Update your payment method to keep using AI features.';
    case 'suspended': return 'AI features are paused while a payment dispute is open.';
    default: return 'A subscription is needed to use AI features.';
  }
};

export const createAiGate = (deps: GateDeps): AiGate => {
  const clock = deps.now ?? (() => new Date());
  const log = deps.log ?? (() => undefined);
  return {
    async begin(req, feature) {
      let who: Identity | null;
      try { who = await deps.identify(req); } catch { log({ event: 'gate.error', code: 'identify' }); return deny(503, 'unavailable', 'Accounts are unavailable just now. Nothing was changed. Try again in a moment.'); }
      if (!who) return deny(401, 'unauthenticated', 'Sign in to use AI features.');
      let view;
      try { view = await deps.entitlements.get(who.userId, clock()); } catch { log({ event: 'gate.error', code: 'entitlement' }); return deny(503, 'unavailable', 'Accounts are unavailable just now. Nothing was changed. Try again in a moment.'); }
      if (!view) return deny(401, 'unauthenticated', 'Sign in to use AI features.');
      if (view.entitlement.access !== 'full' || !view.window) {
        log({ event: 'gate.denied', code: view.entitlement.state });
        return deny(402, 'subscription-required', stateMessage(view.entitlement), { state: view.entitlement.state });
      }
      let r;
      try { r = await deps.ledger.reserve(who.userId, view.window, feature); } catch { log({ event: 'gate.error', code: 'ledger' }); return deny(503, 'unavailable', 'Accounts are unavailable just now. Nothing was changed. Try again in a moment.'); }
      if (!r.ok) {
        log({ event: 'gate.denied', code: 'allowance-exhausted' });
        return deny(429, 'allowance-exhausted', `You have used your ${r.limit} AI requests for this period. They reset on ${r.resetsAt.toISOString().slice(0, 10)}.`, { limit: r.limit, used: r.used, resetsAt: r.resetsAt.toISOString() });
      }
      const requestId = r.reservation.requestId;
      let settled = false;
      const once = (fn: () => Promise<boolean>) => async () => { if (settled) return; settled = true; try { await fn(); } catch { log({ event: 'gate.error', code: 'settle' }); } };
      return {
        ok: true,
        ticket: {
          userId: who.userId,
          maxOutputTokens: deps.maxOutputTokens,
          commit: (u) => once(() => deps.ledger.commit(who!.userId, requestId, u))(),
          release: (u) => once(() => deps.ledger.release(who!.userId, requestId, u))(),
        },
      };
    },
  };
};
