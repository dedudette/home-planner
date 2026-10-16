import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AccountView } from '../src/domain/billing/account';
import { computeEntitlement, type SubscriptionFacts } from '../src/domain/billing/entitlement';
import { ANNUAL_CENTS, MONTHLY_CENTS, TRIAL_DAYS } from '../src/domain/billing/plans';
import { canSubmitTrial, daysBetween, describeBillingUnavailable, formatDate, pricingOptions, safeCheckoutUrl, trialSummary } from '../src/account/planView';

const SERVER_NOW = new Date('2026-10-16T12:00:00.000Z');
const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString();

/** An AccountView made the way the server makes it: the real entitlement function over database-like facts, at the server's clock. */
const view = (o: { now?: Date; verified?: boolean; trial?: { startedAt: Date; endsAt: Date } | null; sub?: Partial<SubscriptionFacts> | null } = {}): AccountView => {
  const now = o.now ?? SERVER_NOW;
  const sub: SubscriptionFacts | null = o.sub ? {
    provider: 'stripe', plan: 'monthly', status: 'active', startedAt: new Date(now.getTime() - 5 * DAY), currentPeriodStart: new Date(now.getTime() - 5 * DAY), currentPeriodEnd: new Date(now.getTime() + 25 * DAY),
    cancelAtPeriodEnd: false, suspendedReason: null, ...o.sub,
  } : null;
  const trial = o.trial === undefined ? null : o.trial;
  return {
    user: { id: 'u1', email: 'a@example.test', name: 'A', emailVerified: o.verified ?? true },
    entitlement: computeEntitlement({ now, emailVerified: o.verified ?? true, trial, subscription: sub }),
    trial: trial ? { startedAt: iso(trial.startedAt), endsAt: iso(trial.endsAt) } : null,
    subscription: sub ? { provider: sub.provider, plan: sub.plan, status: sub.status, currentPeriodEnd: iso(sub.currentPeriodEnd), cancelAtPeriodEnd: sub.cancelAtPeriodEnd, amountCents: 0, currency: 'eur' } : null,
    allowance: null,
    billing: { available: true, reason: null, canManage: false },
    serverTime: iso(now),
  };
};
const trialOf = (startDaysAgo: number) => ({ startedAt: new Date(SERVER_NOW.getTime() - startDaysAgo * DAY), endsAt: new Date(SERVER_NOW.getTime() - startDaysAgo * DAY + TRIAL_DAYS * DAY) });

afterEach(() => vi.useRealTimers());

describe('pricing: amounts and the words around them', () => {
  const [monthly, annual] = pricingOptions();
  it('€25 per month and €255 per year, from the shared constants', () => {
    expect(MONTHLY_CENTS).toBe(2500);
    expect(ANNUAL_CENTS).toBe(25500);
    expect(monthly).toMatchObject({ id: 'monthly', priceLine: '€25/month', note: null });
    expect(annual).toMatchObject({ id: 'annual', priceLine: '€255/year' });
  });
  it('annual is described as one yearly charge, with the monthly equivalent and the saving', () => {
    expect(annual.note).toBe('equivalent to €21.25/month · save €45/year');
    expect(annual.disclosure).toContain('€255 per year, charged once a year (not monthly)');
    expect(annual.disclosure).toMatch(/renews automatically/i);
    expect(annual.disclosure).toContain('€21.25 a month');
    expect(annual.disclosure).toContain('saves €45 a year');
    expect(annual.chargeNow).toBe('€255 for the year, in one payment');
  });
  it('monthly states the full charge and automatic renewal before checkout', () => {
    expect(monthly.disclosure).toMatch(/€25 per month.*every month until you cancel.*renews automatically/i);
    expect(monthly.chargeNow).toBe('€25 for the first month');
  });
  it('the annual price is exactly 15% below twelve monthly payments', () => {
    expect(12 * MONTHLY_CENTS - ANNUAL_CENTS).toBe(4500);
    expect(ANNUAL_CENTS).toBe(Math.round(12 * MONTHLY_CENTS * 0.85));
  });
});

describe('the trial, as the server describes it', () => {
  it('a verified account that never started may start it', () => {
    const t = trialSummary(view());
    expect(t.phase).toBe('can-start');
  });
  it('an unverified account cannot start it, and is told to confirm the address', () => {
    expect(trialSummary(view({ verified: false })).phase).toBe('unverified');
  });
  it('an active trial shows the SERVER dates and whole days left on the SERVER clock', () => {
    const tr = trialOf(3);
    const t = trialSummary(view({ trial: tr }));
    expect(t.phase).toBe('active');
    expect(t.startedAt).toBe(iso(tr.startedAt));
    expect(t.endsAt).toBe(iso(tr.endsAt));
    expect(t.daysLeft).toBe(11);
  });
  it('days left does not move when the device clock is wrong (it never reads Date.now)', () => {
    const v = view({ trial: trialOf(3) });
    vi.useFakeTimers(); vi.setSystemTime(new Date('2031-01-01T00:00:00Z'));          // a device set years ahead
    expect(trialSummary(v).daysLeft).toBe(11);
    vi.setSystemTime(new Date('2001-01-01T00:00:00Z'));                              // or years behind
    expect(trialSummary(v).daysLeft).toBe(11);
    expect(trialSummary(v).phase).toBe('active');
  });
  it('rounds up, and the last partial day still counts as a day', () => {
    expect(daysBetween('2026-10-16T12:00:00Z', '2026-10-16T12:00:01Z')).toBe(1);
    expect(daysBetween('2026-10-16T12:00:00Z', '2026-10-30T12:00:00Z')).toBe(14);
    expect(daysBetween('2026-10-16T12:00:00Z', '2026-10-16T11:00:00Z')).toBe(0);
    expect(daysBetween('nonsense', '2026-10-16T11:00:00Z')).toBe(0);
  });
  it('expiry: at the exact end the trial is over, one second before it is still active; expired trials do not restart', () => {
    const tr = trialOf(0);
    expect(trialSummary(view({ now: new Date(tr.endsAt.getTime() - 1000), trial: tr })).phase).toBe('active');
    const atEnd = trialSummary(view({ now: tr.endsAt, trial: tr }));
    expect(atEnd.phase).toBe('expired');
    expect(atEnd.daysLeft).toBeNull();
    const later = view({ now: new Date(tr.endsAt.getTime() + 30 * DAY), trial: tr });
    expect(trialSummary(later).phase).toBe('expired');
    expect(later.entitlement.canStartTrial).toBe(false);          // a refresh never offers a second trial
  });
  it('a subscription replaces the trial card', () => {
    expect(trialSummary(view({ trial: trialOf(20), sub: {} })).phase).toBe('subscribed');
  });
  it('an account whose subscription ended and had no trial left is "unavailable", not offered a trial by guesswork', () => {
    const v = view({ trial: trialOf(40), sub: { status: 'canceled', currentPeriodEnd: new Date(SERVER_NOW.getTime() - DAY) } });
    expect(v.entitlement.state).toBe('expired');
    expect(trialSummary(v).phase).toBe('unavailable');
    expect(v.entitlement.canSubscribe).toBe(true);                 // the plans are offered instead
  });
});

describe('starting the trial takes a deliberate act', () => {
  it('needs the tick box, nothing in flight, and the server saying it may start', () => {
    const ok = { consent: true, busy: false, canStartTrial: true };
    expect(canSubmitTrial(ok)).toBe(true);
    expect(canSubmitTrial({ ...ok, consent: false })).toBe(false);
    expect(canSubmitTrial({ ...ok, busy: true })).toBe(false);
    expect(canSubmitTrial({ ...ok, canStartTrial: false })).toBe(false);
  });
});

describe('small guards', () => {
  it('follows only a plain https checkout address', () => {
    expect(safeCheckoutUrl('https://checkout.stripe.com/c/pay/cs_test_1')).toBe('https://checkout.stripe.com/c/pay/cs_test_1');
    for (const bad of ['http://checkout.stripe.com/x', 'javascript:alert(1)', 'https://user:pw@evil.example/x', '//evil.example', 'not a url', '', null, undefined, 42]) expect(safeCheckoutUrl(bad), String(bad)).toBeNull();
  });
  it('never shows a provider reason code', () => {
    for (const r of [null, 'not-configured', 'price-mismatch', 'live-not-activated', 'tax-not-configured', 'STRIPE_WEBHOOK_SECRET (whsec_…) is not set.']) {
      const m = describeBillingUnavailable(r);
      expect(m).not.toMatch(/STRIPE|whsec|price-mismatch|not-configured|tax-not/);
      expect(m.length).toBeGreaterThan(20);
    }
  });
  it('formats server timestamps as dates, and an unreadable one as nothing', () => {
    expect(formatDate('2026-10-30T12:00:00Z', { locale: 'en-GB', timeZone: 'UTC' })).toBe('30 October 2026');
    expect(formatDate('garbage')).toBe('');
  });
});
