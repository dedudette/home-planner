import { describe, expect, it } from 'vitest';
import { computeEntitlement, DEFAULT_POLICY, offlineEntitlementOk, type SubscriptionFacts, type SubscriptionStatus, type TrialFacts } from '../src/domain/billing/entitlement';

const D = (s: string) => new Date(s);
const NOW = D('2026-03-10T12:00:00Z');
const trial = (startedAt = '2026-03-01T12:00:00Z'): TrialFacts => ({ startedAt: D(startedAt), endsAt: new Date(D(startedAt).getTime() + 14 * 86400000) });
const sub = (over: Partial<SubscriptionFacts> = {}): SubscriptionFacts => ({
  provider: 'stripe', plan: 'monthly', status: 'active', startedAt: D('2026-02-20T12:00:00Z'),
  currentPeriodStart: D('2026-03-05T12:00:00Z'), currentPeriodEnd: D('2026-04-05T12:00:00Z'), cancelAtPeriodEnd: false, suspendedReason: null, ...over,
});
const ent = (o: { now?: Date; trial?: TrialFacts | null; subscription?: SubscriptionFacts | null; emailVerified?: boolean }) =>
  computeEntitlement({ now: o.now ?? NOW, emailVerified: o.emailVerified ?? true, trial: o.trial ?? null, subscription: o.subscription ?? null });

describe('entitlement states and what each allows', () => {
  it('a verified account that never started the trial can start it, and has account-only access', () => {
    const e = ent({});
    expect(e).toMatchObject({ state: 'eligible-not-started', access: 'account-only', canStartTrial: true, canSubscribe: true });
  });
  it('an unverified account cannot start the trial', () => {
    expect(ent({ emailVerified: false }).canStartTrial).toBe(false);
  });
  it('an active trial is full access until exactly its end, then account-only; it can never restart', () => {
    const t = trial();
    expect(ent({ trial: t, now: D('2026-03-10T12:00:00Z') })).toMatchObject({ state: 'trial-active', access: 'full', canStartTrial: false });
    expect(ent({ trial: t, now: new Date(t.endsAt.getTime() - 1) }).state).toBe('trial-active');
    const after = ent({ trial: t, now: t.endsAt });
    expect(after).toMatchObject({ state: 'trial-expired', access: 'account-only', canStartTrial: false, canSubscribe: true });
    expect(ent({ trial: t, now: D('2030-01-01T00:00:00Z') }).canStartTrial).toBe(false);
  });
  it('a paid subscription is full access; the plan does not change access', () => {
    for (const plan of ['monthly', 'annual'] as const) expect(ent({ subscription: sub({ plan }) })).toMatchObject({ state: 'paid-active', access: 'full', plan, canSubscribe: false });
  });
  it('a subscription wins over a running trial', () => {
    expect(ent({ trial: trial(), subscription: sub() }).state).toBe('paid-active');
  });
  it('cancellation keeps full access to the end of the paid period, with the exact date, then ends', () => {
    const s = sub({ cancelAtPeriodEnd: true });
    const e = ent({ subscription: s });
    expect(e).toMatchObject({ state: 'cancellation-scheduled', access: 'full', accessEndsAt: '2026-04-05T12:00:00.000Z' });
    expect(ent({ subscription: s, now: new Date(s.currentPeriodEnd.getTime() - 1) }).access).toBe('full');
    expect(ent({ subscription: s, now: s.currentPeriodEnd })).toMatchObject({ state: 'expired', access: 'account-only', canSubscribe: true });
  });
  it('a first payment that needs action gives no paid access', () => {
    expect(ent({ subscription: sub({ status: 'incomplete' }) })).toMatchObject({ state: 'payment-action-required', access: 'account-only' });
  });
  it('a failed renewal keeps access for a short stated grace, then stops; unpaid stops at once', () => {
    const s = sub({ status: 'past_due', currentPeriodStart: D('2026-03-09T12:00:00Z') });
    expect(ent({ subscription: s, now: D('2026-03-10T12:00:00Z') })).toMatchObject({ state: 'past-due', access: 'full' });
    const graceEnd = new Date(s.currentPeriodStart.getTime() + DEFAULT_POLICY.pastDueGraceDays * 86400000);
    expect(ent({ subscription: s, now: graceEnd })).toMatchObject({ state: 'past-due', access: 'account-only' });
    expect(ent({ subscription: sub({ status: 'unpaid' }) })).toMatchObject({ state: 'unpaid', access: 'account-only' });
  });
  it('an "active" record whose period ended long ago is not trusted', () => {
    const s = sub({ currentPeriodEnd: D('2026-03-01T12:00:00Z'), currentPeriodStart: D('2026-02-01T12:00:00Z') });
    expect(ent({ subscription: s }).access).toBe('account-only');
    expect(ent({ subscription: s, now: D('2026-03-01T20:00:00Z') }).access).toBe('full');      // inside the renewal-lag tolerance
  });
  it('a cancelled subscription is expired even if a trial window would still be open', () => {
    expect(ent({ trial: trial(), subscription: sub({ status: 'canceled' }) })).toMatchObject({ state: 'expired', access: 'account-only', canSubscribe: true });
  });
  it('an abandoned checkout leaves the trial as it was', () => {
    expect(ent({ trial: trial(), subscription: sub({ status: 'incomplete_expired' }) }).state).toBe('trial-active');
    expect(ent({ subscription: sub({ status: 'incomplete_expired' }) }).state).toBe('expired');
  });
  it('an open dispute suspends access; a refund ends it', () => {
    expect(ent({ subscription: sub({ suspendedReason: 'dispute' }) })).toMatchObject({ state: 'suspended', access: 'account-only' });
    expect(ent({ subscription: sub({ suspendedReason: 'refund' }) })).toMatchObject({ state: 'expired', access: 'account-only' });
  });
  it('every status maps to a state and a level (nothing falls through)', () => {
    const statuses: SubscriptionStatus[] = ['active', 'past_due', 'unpaid', 'incomplete', 'canceled', 'incomplete_expired', 'paused'];
    for (const status of statuses) {
      const e = ent({ subscription: sub({ status }) });
      expect(e.state).toBeTruthy();
      expect(['full', 'account-only']).toContain(e.access);
    }
  });
});

describe('offline policy: a cached entitlement is honoured only briefly and never past its end', () => {
  const full = (accessEndsAt: string | null) => ({ ...ent({ subscription: sub() }), accessEndsAt });
  it('honours a fresh cache, refuses a stale one, a rewound clock, an ended one, and account-only', () => {
    const verifiedAt = '2026-03-10T12:00:00.000Z';
    expect(offlineEntitlementOk({ entitlement: full('2026-04-05T12:00:00.000Z'), verifiedAt }, D('2026-03-11T12:00:00Z'))).toBe(true);
    expect(offlineEntitlementOk({ entitlement: full('2026-04-05T12:00:00.000Z'), verifiedAt }, D('2026-03-13T12:00:01Z'))).toBe(false);
    expect(offlineEntitlementOk({ entitlement: full('2026-04-05T12:00:00.000Z'), verifiedAt }, D('2026-03-09T12:00:00Z'))).toBe(false);
    expect(offlineEntitlementOk({ entitlement: full('2026-03-10T18:00:00.000Z'), verifiedAt }, D('2026-03-10T19:00:00Z'))).toBe(false);
    expect(offlineEntitlementOk({ entitlement: ent({}), verifiedAt }, D('2026-03-10T13:00:00Z'))).toBe(false);
  });
});
