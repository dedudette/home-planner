import type { AccountView } from '../domain/billing/account';
import { annualNote, planDisclosure, planPriceLine, planTitle, PLAN_IDS, PLANS, TRIAL_DAYS, formatEuro, type PlanId } from '../domain/billing/plans';

/**
 * What the Trial & plans screen shows, as plain functions of the server's answer so each rule can be tested without a browser. Nothing here
 * reads the device clock to decide anything: the trial's dates and "days left" come from the server's own timestamps (`serverTime`
 * is the server's clock at the moment it answered), and whether the trial may start comes from `entitlement.canStartTrial`.
 */
export const DAY_MS = 24 * 60 * 60 * 1000;

export type TrialPhase =
  | 'can-start'      // verified, never started: the person may start it (after confirming)
  | 'active'
  | 'expired'
  | 'unverified'     // the address is not confirmed yet
  | 'unavailable'    // cannot start (already used, or the account has a subscription)
  | 'subscribed';    // a subscription exists: the trial no longer matters

export interface TrialSummary {
  phase: TrialPhase;
  startedAt: string | null;
  endsAt: string | null;
  /** Whole days left, counted on the SERVER's clock at the time of its answer; null unless the trial is active. */
  daysLeft: number | null;
}

/** Whole days from `fromIso` to `toIso`, rounded up, never negative. Both are server timestamps. */
export const daysBetween = (fromIso: string, toIso: string): number => {
  const ms = Date.parse(toIso) - Date.parse(fromIso);
  return Number.isFinite(ms) && ms > 0 ? Math.ceil(ms / DAY_MS) : 0;
};

export const trialSummary = (a: AccountView): TrialSummary => {
  const e = a.entitlement;
  const startedAt = a.trial?.startedAt ?? null;
  const endsAt = a.trial?.endsAt ?? null;
  if (e.hasSubscription && e.state !== 'trial-active') return { phase: 'subscribed', startedAt, endsAt, daysLeft: null };
  switch (e.state) {
    case 'trial-active': return { phase: 'active', startedAt, endsAt, daysLeft: endsAt ? daysBetween(a.serverTime, endsAt) : null };
    case 'trial-expired': return { phase: 'expired', startedAt, endsAt, daysLeft: null };
    case 'eligible-not-started':
      if (e.canStartTrial) return { phase: 'can-start', startedAt, endsAt, daysLeft: null };
      return { phase: a.user.emailVerified ? 'unavailable' : 'unverified', startedAt, endsAt, daysLeft: null };
    default:
      return { phase: e.canStartTrial ? 'can-start' : 'unavailable', startedAt, endsAt, daysLeft: null };
  }
};

/** The trial can be submitted only with the box ticked, while nothing is in flight, and only if the SERVER says it may start. */
export const canSubmitTrial = (s: { consent: boolean; busy: boolean; canStartTrial: boolean }): boolean => s.consent && !s.busy && s.canStartTrial;

export const formatDate = (iso: string, opts: { locale?: string; timeZone?: string } = {}): string => {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  return new Intl.DateTimeFormat(opts.locale, { year: 'numeric', month: 'long', day: 'numeric', ...(opts.timeZone ? { timeZone: opts.timeZone } : {}) }).format(d);
};

export interface PricingOption {
  id: PlanId;
  title: string;
  priceLine: string;
  /** Only the annual plan has one: the monthly equivalent and the saving. */
  note: string | null;
  /** What the person is charged when they confirm, in the words used on every screen and by the checkout. */
  chargeNow: string;
  disclosure: string;
}

export const pricingOptions = (): PricingOption[] =>
  PLAN_IDS.map((id) => ({
    id,
    title: planTitle(id),
    priceLine: planPriceLine(id),
    note: id === 'annual' ? annualNote() : null,
    chargeNow: `${formatEuro(PLANS[id].cents)} ${id === 'annual' ? 'for the year, in one payment' : 'for the first month'}`,
    disclosure: planDisclosure(id),
  }));

export const TRIAL_PROMISE = `${TRIAL_DAYS} days free. No card is needed, and the trial never turns into a charge by itself.`;

/** A checkout address from the server is followed only if it is a plain https address without embedded credentials. */
export const safeCheckoutUrl = (raw: unknown): string | null => {
  if (typeof raw !== 'string') return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' || u.username || u.password) return null;
    return u.toString();
  } catch { return null; }
};

/** The provider's reason code, turned into one calm sentence. Codes are never shown. */
export const describeBillingUnavailable = (reason: string | null): string => {
  if (!reason) return 'Subscriptions are not available just now.';
  if (reason.startsWith('price-mismatch')) return 'Subscriptions are paused while the prices are being checked. Nothing can be charged.';
  if (reason.includes('live')) return 'Subscriptions are not switched on for this server.';
  return 'Subscriptions are not set up on this server yet, so there is nothing to buy. The free trial works as usual.';
};
