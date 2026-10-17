import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AccountView } from '../src/domain/billing/account';
import { computeEntitlement, DEFAULT_POLICY, type SubscriptionFacts, type SubscriptionStatus, type TrialFacts } from '../src/domain/billing/entitlement';
import { PLANS, type PlanId } from '../src/domain/billing/plans';
import { DEFAULT_ALLOWANCE, usageWindowFor } from '../src/domain/billing/usage';
import { allowanceView, cancelConfirmation, statusLabel, subscriptionPanel, type PanelOpts } from '../src/account/subscriptionView';

/** Builds the same AccountView the server builds (server/account/view.ts), from the same pure rules, so each state is the real thing. */
const D = (s: string) => new Date(s);
const NOW = D('2026-03-10T12:00:00Z');
const UTC: PanelOpts = { locale: 'en-GB', timeZone: 'UTC' };

interface Make {
  now?: Date; trial?: TrialFacts | null; plan?: PlanId; status?: SubscriptionStatus; cancel?: boolean; suspended?: 'dispute' | 'refund' | null;
  periodStart?: string; periodEnd?: string; used?: number; reserved?: number; provider?: 'stripe' | 'apple' | 'google';
  billingAvailable?: boolean; hasCustomer?: boolean; noSub?: boolean; allowance?: { trial: number; monthly: number };
}
const make = (o: Make = {}): AccountView => {
  const now = o.now ?? NOW;
  const plan = o.plan ?? 'monthly';
  const subscription: SubscriptionFacts | null = o.noSub ? null : {
    provider: o.provider ?? 'stripe', plan, status: o.status ?? 'active', startedAt: D('2026-02-20T12:00:00Z'),
    currentPeriodStart: D(o.periodStart ?? '2026-03-05T12:00:00Z'), currentPeriodEnd: D(o.periodEnd ?? '2026-04-05T12:00:00Z'), cancelAtPeriodEnd: o.cancel ?? false, suspendedReason: o.suspended ?? null,
  };
  const trial = o.trial ?? null;
  const entitlement = computeEntitlement({ now, emailVerified: true, trial, subscription, policy: DEFAULT_POLICY });
  const window = usageWindowFor(entitlement, { trial, subscription }, now, o.allowance ?? DEFAULT_ALLOWANCE);
  const used = o.used ?? 0;
  const live = !!subscription && subscription.status !== 'canceled' && subscription.status !== 'incomplete_expired';
  return {
    user: { id: 'u1', email: 'a@example.test', name: 'A', emailVerified: true },
    entitlement,
    trial: trial ? { startedAt: trial.startedAt.toISOString(), endsAt: trial.endsAt.toISOString() } : null,
    subscription: subscription && (live || subscription.status === 'canceled')
      ? { provider: subscription.provider, plan, status: subscription.status, currentPeriodEnd: subscription.currentPeriodEnd.toISOString(), cancelAtPeriodEnd: subscription.cancelAtPeriodEnd, amountCents: PLANS[plan].cents, currency: 'eur' }
      : null,
    allowance: window ? { kind: window.kind, limit: window.limit, used, remaining: Math.max(0, window.limit - used - (o.reserved ?? 0)), resetsAt: window.end.toISOString() } : null,
    billing: { available: o.billingAvailable ?? true, reason: o.billingAvailable === false ? 'not-configured' : null, canManage: (o.billingAvailable ?? true) && (o.hasCustomer ?? true) },
    serverTime: now.toISOString(),
  };
};
const trial = (start = '2026-03-05T12:00:00Z'): TrialFacts => ({ startedAt: D(start), endsAt: new Date(D(start).getTime() + 14 * 86400000) });
const text = (a: AccountView): string => { const p = subscriptionPanel(a, UTC); const v = allowanceView(a, UTC); return [p.headline, p.planLine ?? '', ...p.lines, v.headline, v.detail, v.valueText].join(' \n '); };

afterEach(() => { vi.useRealTimers(); });

describe('the subscription section, state by state (real entitlement rules, UTC dates)', () => {
  it('paid and active: plan, price, status, the renewal date and the amount, with cancel and billing offered', () => {
    const p = subscriptionPanel(make(), UTC);
    expect(p).toMatchObject({ show: true, tone: 'good', headline: 'Monthly plan is active', planLine: 'Monthly · €25/month' });
    expect(p.lines[0]).toBe('It renews automatically on 5 April 2026 and you will be charged €25 every month.');
    expect(p.actions).toEqual(['portal', 'cancel']);
  });
  it('annual: €255 once a year, stated as such and never as a monthly charge', () => {
    const p = subscriptionPanel(make({ plan: 'annual', periodEnd: '2027-03-05T12:00:00Z' }), UTC);
    expect(p.planLine).toBe('Annual · €255/year');
    expect(p.lines[0]).toBe('It renews automatically on 5 March 2027 and you will be charged €255 once a year.');
    expect(p.lines.join(' ')).not.toMatch(/€255 every month|€255\/month/);
  });
  it('cancellation scheduled: the exact end date, full access until then, no further charge, and resume (not cancel) offered', () => {
    const a = make({ cancel: true });
    const p = subscriptionPanel(a, UTC);
    expect(a.entitlement).toMatchObject({ state: 'cancellation-scheduled', access: 'full' });
    expect(p.headline).toBe('Your plan ends on 5 April 2026');
    expect(p.lines.join(' ')).toMatch(/keep full access until then/);
    expect(p.lines.join(' ')).toMatch(/will not be charged again/);
    expect(p.actions).toEqual(['resume', 'portal']);
    expect(p.actions).not.toContain('cancel');
  });
  it('first payment needs the bank: nothing active, finish and check offered, no cancel or portal', () => {
    const a = make({ status: 'incomplete' });
    const p = subscriptionPanel(a, UTC);
    expect(a.entitlement.state).toBe('payment-action-required');
    expect(p).toMatchObject({ tone: 'warn', headline: 'Your payment needs one more step' });
    expect(p.actions).toEqual(['finish-payment', 'check-status']);
    expect(p.lines.join(' ')).toMatch(/not active/);
    expect(allowanceView(a, UTC).kind).toBe('none');
  });
  it('a failed renewal: access continues for a stated grace and ends on a stated date; update-payment (portal) offered', () => {
    const a = make({ status: 'past_due', periodStart: '2026-03-09T12:00:00Z', periodEnd: '2026-04-09T12:00:00Z' });
    const p = subscriptionPanel(a, UTC);
    expect(a.entitlement).toMatchObject({ state: 'past-due', access: 'full' });
    expect(p.headline).toBe('Your last payment did not go through');
    expect(p.lines[0]).toBe('The payment provider will try again. Your access continues until 12 March 2026. Update your payment method to keep it.');
    expect(p.actions).toEqual(['portal', 'check-status']);
    expect(allowanceView(a, UTC).kind).toBe('paid');
  });
  it('past due after the grace: paid features paused, data and billing still reachable', () => {
    const a = make({ status: 'past_due', periodStart: '2026-03-01T12:00:00Z', periodEnd: '2026-04-01T12:00:00Z' });
    const p = subscriptionPanel(a, UTC);
    expect(a.entitlement).toMatchObject({ state: 'past-due', access: 'account-only' });
    expect(p.lines.join(' ')).toMatch(/grace period has ended/);
    expect(p.lines.join(' ')).toMatch(/AI suggestions and cloud backup are paused/);
    expect(p.lines.join(' ')).toMatch(/export, billing and account deletion all keep working/);
    expect(p.actions).toContain('portal');
    expect(allowanceView(a, UTC).kind).toBe('none');
  });
  it('an "active" record whose renewal was never confirmed asks to check, and says so plainly', () => {
    const a = make({ periodStart: '2026-01-01T12:00:00Z', periodEnd: '2026-02-01T12:00:00Z' });
    expect(a.entitlement.reason).toBe('renewal-not-confirmed');
    const p = subscriptionPanel(a, UTC);
    expect(p.headline).toBe('We could not confirm your latest renewal');
    expect(p.actions).toEqual(['check-status', 'portal']);
  });
  it('unpaid: paused, billing page to pay the open invoice', () => {
    const a = make({ status: 'unpaid' });
    const p = subscriptionPanel(a, UTC);
    expect(p).toMatchObject({ tone: 'error', headline: 'Payments stopped, so your subscription is paused' });
    expect(p.actions).toEqual(['portal', 'check-status']);
    expect(a.entitlement.access).toBe('account-only');
  });
  it('an open dispute: paused, says the app cannot resolve it, billing and data still available', () => {
    const a = make({ suspended: 'dispute' });
    const p = subscriptionPanel(a, UTC);
    expect(a.entitlement.state).toBe('suspended');
    expect(p.headline).toBe('Access is paused while a payment dispute is open');
    expect(p.lines.join(' ')).toMatch(/cannot resolve a dispute/);
    expect(p.actions).toEqual(['portal']);
  });
  it('cancelled or refunded: ended, data kept, and the person may choose a plan again', () => {
    const cancelled = make({ status: 'canceled' });
    const pc = subscriptionPanel(cancelled, UTC);
    expect(cancelled.entitlement).toMatchObject({ state: 'expired', canSubscribe: true });
    expect(pc.headline).toBe('Your subscription has ended');
    expect(pc.lines.join(' ')).toMatch(/choose a plan again below/);
    const refunded = make({ suspended: 'refund' });
    expect(subscriptionPanel(refunded, UTC).lines[0]).toMatch(/refunded/);
    const over = make({ cancel: true, now: D('2026-04-06T00:00:00Z') });
    expect(over.entitlement.state).toBe('expired');
    expect(subscriptionPanel(over, UTC).lines[0]).toBe('Your subscription ended on 5 April 2026.');
  });
  it('no subscription (never bought, trial running or expired): nothing to show in this section', () => {
    expect(subscriptionPanel(make({ noSub: true }), UTC).show).toBe(false);
    expect(subscriptionPanel(make({ noSub: true, trial: trial() }), UTC).show).toBe(false);
    expect(subscriptionPanel(make({ noSub: true, trial: trial('2026-01-01T12:00:00Z') }), UTC).show).toBe(false);
  });
});

describe('who may do what', () => {
  const stateCases: Array<[string, Make, string[]]> = [
    ['paid', {}, ['portal', 'cancel']],
    ['cancelling', { cancel: true }, ['resume', 'portal']],
    ['action required', { status: 'incomplete' }, ['finish-payment', 'check-status']],
    ['past due', { status: 'past_due', periodStart: '2026-03-09T12:00:00Z' }, ['portal', 'check-status']],
    ['unpaid', { status: 'unpaid' }, ['portal', 'check-status']],
    ['dispute', { suspended: 'dispute' }, ['portal']],
    ['ended', { status: 'canceled' }, ['portal']],
  ];
  it.each(stateCases)('%s: the offered actions are exactly the right ones', (_n, o, want) => { expect(subscriptionPanel(make(o), UTC).actions).toEqual(want); });
  it('cancel exists only for an active, renewing subscription; resume only when a cancellation is scheduled', () => {
    for (const [, o] of stateCases) {
      const acts = subscriptionPanel(make(o), UTC).actions;
      expect(acts.includes('cancel')).toBe(!o.cancel && !o.status && !o.suspended);
      expect(acts.includes('resume')).toBe(!!o.cancel);
    }
  });
  it('without a billing account the billing page is not offered; without the payment provider nothing changeable is offered at all', () => {
    expect(subscriptionPanel(make({ hasCustomer: false }), UTC).actions).toEqual(['cancel']);
    const off = subscriptionPanel(make({ billingAvailable: false }), UTC);
    expect(off.actions).toEqual([]);
    expect(off.actionsUnavailable).toBe('billing-unavailable');
    expect(off.show).toBe(true);
    expect(off.headline).toBe('Monthly plan is active');         // the subscription is still described as it is
  });
  it('a subscription held with Apple or Google cannot be changed here', () => {
    for (const provider of ['apple', 'google'] as const) {
      const p = subscriptionPanel(make({ provider }), UTC);
      expect(p.actions).toEqual([]);
      expect(p.actionsUnavailable).toBe('other-provider');
    }
  });
  it('the cancel confirmation repeats the exact end date and what is kept', () => {
    const t = cancelConfirmation(make(), UTC).join(' ');
    expect(t).toContain('until 5 April 2026');
    expect(t).toMatch(/not be charged again/);
    expect(t).toMatch(/Your data is kept/);
    expect(cancelConfirmation(make({ noSub: true }), UTC)).toEqual([]);
  });
  it('status words are plain', () => {
    expect(['active', 'past_due', 'unpaid', 'incomplete', 'canceled', 'paused'].map(statusLabel)).toEqual(['active', 'payment overdue', 'unpaid', 'waiting for the payment to be completed', 'ended', 'paused']);
    expect(statusLabel('something_new')).toBe('something new');
  });
});

describe('the AI allowance, as the server configured it', () => {
  it('paid: remaining, used and the reset date come from the server; the bar says the same in words', () => {
    const a = make({ used: 3 });
    const v = allowanceView(a, UTC);
    expect(v).toMatchObject({ kind: 'paid', limit: 300, used: 3, remaining: 297, headline: '297 of 300 AI requests left this month' });
    expect(v.detail).toContain('3 used. The allowance resets on 20 March 2026.');
    expect(v.share).toBeCloseTo(0.01);
    expect(v.valueText).toBe('3 of 300 used, 297 left, resets 20 March 2026');
  });
  it('the limit shown is whatever the server is configured with, not a number in the app', () => {
    for (const monthly of [10, 123, 777]) expect(allowanceView(make({ allowance: { trial: 5, monthly } }), UTC).limit).toBe(monthly);
    expect(allowanceView(make({ allowance: { trial: 5, monthly: 123 }, used: 23 }), UTC).headline).toBe('100 of 123 AI requests left this month');
  });
  it('the same monthly allowance for the monthly and the annual plan, with the same words, and the annual plan resets monthly', () => {
    const m = allowanceView(make({ plan: 'monthly', used: 40 }), UTC);
    const y = allowanceView(make({ plan: 'annual', periodEnd: '2027-03-05T12:00:00Z', used: 40 }), UTC);
    expect(y.limit).toBe(m.limit);
    expect(y.remaining).toBe(m.remaining);
    expect(y.headline).toBe(m.headline);
    expect(y.detail).toBe(m.detail);
    const a = make({ plan: 'annual', periodEnd: '2027-03-05T12:00:00Z' });
    expect(Date.parse(a.allowance!.resetsAt) - Date.parse(a.serverTime)).toBeLessThanOrEqual(31 * 86400000);
    expect(y.detail).toMatch(/same allowance: 300 requests every month, even if you pay once a year/);
  });
  it('a request in flight holds its unit; an exhausted allowance reads as zero left and says what happens next', () => {
    expect(allowanceView(make({ used: 10, reserved: 2 }), UTC).remaining).toBe(288);
    const v = allowanceView(make({ used: 300 }), UTC);
    expect(v).toMatchObject({ remaining: 0, share: 1, headline: '0 of 300 AI requests left this month' });
    expect(v.detail).toMatch(/AI features pause until the reset/);
    expect(v.detail).toMatch(/never charged extra/);
  });
  it('trial: its own, whole-trial number, ending with the trial', () => {
    const v = allowanceView(make({ noSub: true, trial: trial(), used: 7 }), UTC);
    expect(v).toMatchObject({ kind: 'trial', limit: 50, remaining: 43, headline: '43 of 50 AI requests left in your trial' });
    expect(v.detail).toMatch(/ends on 19 March 2026/);
    expect(v.detail).toMatch(/separate monthly allowance/);
  });
  it('without access there is no allowance and the reason is given in words', () => {
    const cases: Array<[Make, RegExp]> = [
      [{ noSub: true }, /not started a trial or a subscription/],
      [{ noSub: true, trial: trial('2026-01-01T12:00:00Z') }, /trial has ended/],
      [{ status: 'incomplete' }, /first payment is not confirmed/],
      [{ status: 'unpaid' }, /last payment did not go through/],
      [{ suspended: 'dispute' }, /dispute is open/],
      [{ status: 'canceled' }, /subscription has ended/],
    ];
    for (const [o, why] of cases) {
      const v = allowanceView(make(o), UTC);
      expect(v.kind).toBe('none');
      expect(v.headline).toBe('AI features are paused');
      expect(v.detail).toMatch(why);
      expect(v.detail).toMatch(/rest of the app keeps working/);
    }
  });
  it('no state ever promises unlimited AI, a free tier or hidden extras', () => {
    const states: Make[] = [{}, { cancel: true }, { status: 'incomplete' }, { status: 'past_due' }, { status: 'unpaid' }, { suspended: 'dispute' }, { status: 'canceled' }, { noSub: true }, { noSub: true, trial: trial() }, { plan: 'annual' }];
    for (const o of states) expect(text(make(o))).not.toMatch(/unlimited|free forever|free tier|no limit|unmetered/i);
  });
});

describe('the screen owes nothing to the browser: only the server\'s answer and its clock decide', () => {
  it('the same answer gives the same words whatever the device clock says and whatever is in localStorage', () => {
    const a = make({ used: 12 });
    const before = text(a);
    vi.useFakeTimers();
    vi.setSystemTime(D('2031-01-01T00:00:00Z'));
    const store = new Map<string, string>([['cleanflow:entitlement', 'full'], ['cleanflow:plan', 'annual'], ['cleanflow:mode', 'accounts']]);
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: () => undefined, removeItem: () => undefined });
    expect(text(a)).toBe(before);
    expect(allowanceView(make({ status: 'canceled' }), UTC).kind).toBe('none');       // a stored "full" changes nothing
    vi.unstubAllGlobals();
  });
});
