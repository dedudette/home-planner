import type { AccountView } from '../../src/domain/billing/account';
import type { Ledger } from '../ai/ledger';
import type { EntitlementService } from '../billing/entitlements';
import type { SessionUser } from '../auth/auth';
import { PLANS } from '../../src/domain/billing/plans';

export interface BillingStatus { available: boolean; reason: string | null }

export const buildAccountView = async (
  deps: { entitlements: EntitlementService; ledger: Ledger; billing: BillingStatus; now: () => Date },
  user: SessionUser,
): Promise<AccountView | null> => {
  const now = deps.now();
  const view = await deps.entitlements.get(user.id, now);
  if (!view) return null;
  const sub = view.facts.subscription;
  const showSub = sub && (view.entitlement.hasSubscription || sub.status === 'canceled');
  let allowance: AccountView['allowance'] = null;
  if (view.window) {
    const c = await deps.ledger.counter(user.id, view.window);
    allowance = { kind: view.window.kind, limit: c.limit, used: c.used, remaining: Math.max(0, c.limit - c.used - c.reserved), resetsAt: c.resetsAt.toISOString() };
  }
  return {
    user: { id: user.id, email: user.email, name: user.name, emailVerified: user.emailVerified },
    entitlement: view.entitlement,
    trial: view.facts.trial ? { startedAt: view.facts.trial.startedAt.toISOString(), endsAt: view.facts.trial.endsAt.toISOString() } : null,
    subscription: showSub && sub
      ? { provider: sub.provider, plan: sub.plan, status: sub.status, currentPeriodEnd: sub.currentPeriodEnd.toISOString(), cancelAtPeriodEnd: sub.cancelAtPeriodEnd, amountCents: PLANS[sub.plan].cents, currency: 'eur' }
      : null,
    allowance,
    billing: { available: deps.billing.available, reason: deps.billing.reason, canManage: deps.billing.available && view.facts.hasCustomer },
    serverTime: now.toISOString(),
  };
};
