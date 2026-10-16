import type { PlanId } from './plans';

/**
 * What a person may do right now, decided from facts the server holds (the trial record, the subscription record) and the server's own
 * clock. This function is pure: nothing here reads a device clock, a cookie or anything a browser sends, and every server endpoint that
 * does paid work asks the entitlement service (which calls this) instead of making its own rule.
 *
 * Access has two levels. "full" is the whole product. "account-only" is what stays reachable without a subscription: the subscription
 * and billing screens, export of the person's data, cancellation and account deletion. There is no permanent free tier.
 */
export type EntitlementState =
  | 'eligible-not-started'     // verified account, never started the trial, no subscription
  | 'trial-active'
  | 'trial-expired'
  | 'paid-active'
  | 'cancellation-scheduled'   // paid, will not renew; access continues to the end of the paid period
  | 'payment-action-required'  // a first payment (or its authentication) is not finished: no paid access yet
  | 'past-due'                 // a renewal payment failed; the provider is retrying
  | 'unpaid'                   // retries ended without payment
  | 'suspended'                // a payment dispute is open: access is paused until it is decided
  | 'expired';                 // the subscription ended (cancelled, refunded or never completed)

export type Access = 'full' | 'account-only';

/** The provider's subscription status, reduced to what this product needs. Provider adapters map into this. */
export type SubscriptionStatus = 'active' | 'past_due' | 'unpaid' | 'incomplete' | 'canceled' | 'incomplete_expired' | 'paused';

export interface SubscriptionFacts {
  provider: 'stripe' | 'apple' | 'google';
  plan: PlanId;
  status: SubscriptionStatus;
  /** When the subscription first started (not the current period): it anchors the monthly AI allowance windows. */
  startedAt: Date;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  /** Set by the refund and dispute policy; null otherwise. */
  suspendedReason: 'dispute' | 'refund' | null;
}

export interface TrialFacts { startedAt: Date; endsAt: Date }

export interface EntitlementPolicy {
  /** Days a failed renewal keeps full access, counted from the start of the unpaid period. */
  pastDueGraceDays: number;
  /** Hours an "active" subscription is trusted past its period end while the renewal notice is on its way. */
  renewalLagHours: number;
}

export const DEFAULT_POLICY: EntitlementPolicy = { pastDueGraceDays: 3, renewalLagHours: 24 };

export interface EntitlementInput {
  now: Date;
  emailVerified: boolean;
  trial: TrialFacts | null;
  subscription: SubscriptionFacts | null;
  policy?: EntitlementPolicy;
}

export interface Entitlement {
  state: EntitlementState;
  access: Access;
  plan: PlanId | null;
  trialEndsAt: string | null;
  /** End of the paid period, when there is one. */
  periodEnd: string | null;
  /** When access ends if nothing changes: the trial end, the paid period end, or the end of the failed-payment grace. */
  accessEndsAt: string | null;
  canStartTrial: boolean;
  canSubscribe: boolean;
  /** True when a subscription exists whose billing can be managed (portal, cancellation, invoices). */
  hasSubscription: boolean;
  /** Short code for why, stable for tests and for the screens. */
  reason: string;
}

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

export const computeEntitlement = (input: EntitlementInput): Entitlement => {
  const { now, trial, subscription: sub } = input;
  const policy = input.policy ?? DEFAULT_POLICY;
  const t = now.getTime();

  const base = (state: EntitlementState, access: Access, reason: string, extra: Partial<Entitlement> = {}): Entitlement => ({
    state,
    access,
    plan: sub?.plan ?? null,
    trialEndsAt: iso(trial?.endsAt),
    periodEnd: iso(sub?.currentPeriodEnd),
    accessEndsAt: null,
    canStartTrial: false,
    canSubscribe: false,
    hasSubscription: !!sub && sub.status !== 'canceled' && sub.status !== 'incomplete_expired',
    reason,
    ...extra,
  });
  const canSub = (s: EntitlementState): boolean => s === 'eligible-not-started' || s === 'trial-active' || s === 'trial-expired' || s === 'expired';

  if (sub) {
    const end = sub.currentPeriodEnd.getTime();
    const start = sub.currentPeriodStart.getTime();
    // An open dispute pauses access whatever the status says; a refund ends it.
    if (sub.suspendedReason === 'refund') return base('expired', 'account-only', 'refunded', { canSubscribe: true });
    if (sub.suspendedReason === 'dispute') return base('suspended', 'account-only', 'dispute-open');

    switch (sub.status) {
      case 'active': {
        if (sub.cancelAtPeriodEnd) {
          if (t < end) return base('cancellation-scheduled', 'full', 'cancels-at-period-end', { accessEndsAt: iso(sub.currentPeriodEnd) });
          return base('expired', 'account-only', 'period-ended', { canSubscribe: true });
        }
        if (t < end + policy.renewalLagHours * HOUR) return base('paid-active', 'full', 'active', { accessEndsAt: iso(sub.currentPeriodEnd) });
        // The period ended and no renewal has been recorded: do not keep trusting a stale record.
        return base('past-due', 'account-only', 'renewal-not-confirmed');
      }
      case 'past_due': {
        const graceEnd = start + policy.pastDueGraceDays * DAY;
        if (t < graceEnd) return base('past-due', 'full', 'payment-failed-grace', { accessEndsAt: new Date(graceEnd).toISOString() });
        return base('past-due', 'account-only', 'payment-failed');
      }
      case 'unpaid': return base('unpaid', 'account-only', 'unpaid');
      case 'incomplete': return base('payment-action-required', 'account-only', 'first-payment-incomplete');
      case 'paused': return base('expired', 'account-only', 'paused', { canSubscribe: false });
      case 'canceled':
      case 'incomplete_expired':
        break; // falls through to the trial rules below, as an ended subscription
    }
  }

  const ended = !!sub && (sub.status === 'canceled' || sub.status === 'incomplete_expired');
  if (ended && sub!.status === 'canceled') return base('expired', 'account-only', 'cancelled', { canSubscribe: true });
  if (trial) {
    if (t < trial.endsAt.getTime()) return base('trial-active', 'full', 'trial', { accessEndsAt: iso(trial.endsAt), canSubscribe: canSub('trial-active') });
    return base('trial-expired', 'account-only', 'trial-ended', { canSubscribe: true });
  }
  if (ended) return base('expired', 'account-only', 'never-completed', { canSubscribe: true, canStartTrial: input.emailVerified });
  return base('eligible-not-started', 'account-only', 'no-trial-yet', { canStartTrial: input.emailVerified, canSubscribe: true });
};

/** A cached entitlement may be honoured offline only this long after the server last confirmed it, and never past its own end. */
export const OFFLINE_GRACE_HOURS = 72;

export const offlineEntitlementOk = (cached: { entitlement: Entitlement; verifiedAt: string }, now: Date): boolean => {
  if (cached.entitlement.access !== 'full') return false;
  const verified = Date.parse(cached.verifiedAt);
  if (!Number.isFinite(verified) || now.getTime() < verified) return false;      // a clock set backwards does not extend anything
  if (now.getTime() - verified > OFFLINE_GRACE_HOURS * HOUR) return false;
  const ends = cached.entitlement.accessEndsAt ? Date.parse(cached.entitlement.accessEndsAt) : NaN;
  return !Number.isFinite(ends) || now.getTime() < ends;
};
