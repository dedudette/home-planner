import type { Entitlement, SubscriptionFacts, TrialFacts } from './entitlement';

/**
 * The AI allowance: how many answered AI requests one account may use in a window, and when the window resets. The same monthly number
 * applies to both plans (an annual subscriber gets the monthly allowance every month, not a year's worth at once). Windows are anchored
 * to the day the subscription first started and step by calendar months, so changing plan, or the provider re-dating a billing period,
 * can never re-open a fresh allowance. The trial has its own single window with its own (smaller) number.
 *
 * Pure: the server passes its clock and its configuration in; nothing here reads either.
 */
export interface AllowanceConfig {
  /** Requests for the whole 14-day trial. */
  trial: number;
  /** Requests per monthly window while subscribed (identical for monthly and annual plans). */
  monthly: number;
}

export const DEFAULT_ALLOWANCE: AllowanceConfig = { trial: 50, monthly: 300 };

export interface UsageWindow {
  /** Stable id for the counter row. */
  key: string;
  kind: 'trial' | 'paid';
  start: Date;
  /** The reset date shown to the person. */
  end: Date;
  limit: number;
}

/** UTC calendar-month arithmetic that clamps to the end of a shorter month (Jan 31 + 1 month = Feb 28/29), computed from the anchor each time so it never drifts. */
export const addMonthsUTC = (anchor: Date, months: number): Date => {
  const y = anchor.getUTCFullYear();
  const m = anchor.getUTCMonth() + months;
  const target = new Date(Date.UTC(y, m, 1, anchor.getUTCHours(), anchor.getUTCMinutes(), anchor.getUTCSeconds(), anchor.getUTCMilliseconds()));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(anchor.getUTCDate(), lastDay));
  return target;
};

export const monthlyWindow = (anchor: Date, now: Date): { start: Date; end: Date } => {
  const t = now.getTime();
  let k = (now.getUTCFullYear() - anchor.getUTCFullYear()) * 12 + (now.getUTCMonth() - anchor.getUTCMonth());
  if (k < 0) k = 0;
  while (k > 0 && addMonthsUTC(anchor, k).getTime() > t) k--;
  while (addMonthsUTC(anchor, k + 1).getTime() <= t) k++;
  return { start: addMonthsUTC(anchor, k), end: addMonthsUTC(anchor, k + 1) };
};

/** The window that applies to this entitlement, or null when the state has no AI access. */
export const usageWindowFor = (
  ent: Pick<Entitlement, 'state' | 'access'>,
  facts: { trial: TrialFacts | null; subscription: SubscriptionFacts | null },
  now: Date,
  allowance: AllowanceConfig = DEFAULT_ALLOWANCE,
): UsageWindow | null => {
  if (ent.access !== 'full') return null;
  if (ent.state === 'trial-active' && facts.trial) {
    return { key: `trial:${facts.trial.startedAt.toISOString()}`, kind: 'trial', start: facts.trial.startedAt, end: facts.trial.endsAt, limit: allowance.trial };
  }
  const sub = facts.subscription;
  if (sub && (ent.state === 'paid-active' || ent.state === 'cancellation-scheduled' || ent.state === 'past-due')) {
    const w = monthlyWindow(sub.startedAt, now);
    // A window never outlasts the access it belongs to.
    const end = ent.state === 'cancellation-scheduled' && sub.currentPeriodEnd < w.end ? sub.currentPeriodEnd : w.end;
    return { key: `paid:${sub.provider}:${sub.startedAt.toISOString()}:${w.start.toISOString()}`, kind: 'paid', start: w.start, end, limit: allowance.monthly };
  }
  return null;
};
