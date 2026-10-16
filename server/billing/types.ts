import type { SessionUser } from '../auth/auth';

/** What the rest of the server needs from billing. Stripe is the only implementation (billing/service.ts). */
export interface BillingStatusInfo { available: boolean; reason: string | null; mode: 'test' | 'live' | null }

export interface BillingService {
  status(): BillingStatusInfo;
  /** Handles /api/billing/*. `user` is null for the webhook, which is authenticated by its signature instead of a session. */
  handle(req: Request, user: SessionUser | null): Promise<Response | null>;
  /** Cancels what must be cancelled before an account is deleted. Throws if it could not, which stops the deletion. */
  beforeDeleteAccount(user: { id: string; email: string }): Promise<void>;
  /** Periodic work: notification sweep and delivery. */
  tick(now: Date): Promise<void>;
}
