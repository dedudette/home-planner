import { describe, expect, it } from 'vitest';
import { decideAccess, gateCopy, msUntilAccessEnds, OFFLINE_ALLOWANCE_MS, routeStaysOpen, serverNowMs, UNCONFIRMED_COPY, type AccessSnapshot } from '../src/account/access';
import type { AccountView } from '../src/domain/billing/account';
import { computeEntitlement, type EntitlementInput, type SubscriptionFacts, type SubscriptionStatus } from '../src/domain/billing/entitlement';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const T0 = Date.parse('2026-10-05T12:00:00.000Z');
const D = (ms: number) => new Date(ms);

const sub = (status: SubscriptionStatus, o: Partial<SubscriptionFacts> = {}): SubscriptionFacts => ({
  provider: 'stripe', plan: 'monthly', status, startedAt: D(T0 - 10 * DAY), currentPeriodStart: D(T0 - 5 * DAY), currentPeriodEnd: D(T0 + 25 * DAY), cancelAtPeriodEnd: false, suspendedReason: null, ...o,
});
const input = (o: Partial<EntitlementInput>): EntitlementInput => ({ now: D(T0), emailVerified: true, trial: null, subscription: null, ...o });
const view = (o: Partial<EntitlementInput>, now = T0): AccountView => {
  const entitlement = computeEntitlement(input({ ...o, now: D(now) }));
  return { user: { id: 'u1', email: 'a@example.test', name: 'A', emailVerified: true }, entitlement, trial: null, subscription: null, allowance: null, billing: { available: true, reason: null, canManage: false }, serverTime: D(now).toISOString() };
};
const snap = (v: AccountView, at = T0, reachable = true): AccessSnapshot => ({ view: v, verifiedAt: at, reachable });
const trial = (startedAt = T0 - 2 * DAY) => ({ startedAt: D(startedAt), endsAt: D(startedAt + 14 * DAY) });

describe('the gate follows the server’s entitlement in every state', () => {
  const cases: [string, Partial<EntitlementInput>, 'allowed' | 'blocked'][] = [
    ['eligible-not-started', {}, 'blocked'],
    ['trial-active', { trial: trial() }, 'allowed'],
    ['trial-expired', { trial: trial(T0 - 20 * DAY) }, 'blocked'],
    ['paid-active', { subscription: sub('active') }, 'allowed'],
    ['cancellation-scheduled', { subscription: sub('active', { cancelAtPeriodEnd: true }) }, 'allowed'],
    ['payment-action-required', { subscription: sub('incomplete') }, 'blocked'],
    ['past-due (inside the grace)', { subscription: sub('past_due', { currentPeriodStart: D(T0 - 1 * DAY) }) }, 'allowed'],
    ['past-due (after the grace)', { subscription: sub('past_due', { currentPeriodStart: D(T0 - 5 * DAY) }) }, 'blocked'],
    ['unpaid', { subscription: sub('unpaid') }, 'blocked'],
    ['suspended (dispute)', { subscription: sub('active', { suspendedReason: 'dispute' }) }, 'blocked'],
    ['expired (refunded)', { subscription: sub('active', { suspendedReason: 'refund' }) }, 'blocked'],
    ['expired (cancelled)', { subscription: sub('canceled') }, 'blocked'],
    ['expired (paused)', { subscription: sub('paused') }, 'blocked'],
    ['expired (never completed)', { subscription: sub('incomplete_expired') }, 'blocked'],
  ];
  for (const [name, facts, want] of cases) {
    it(`${name}: the planner is ${want === 'allowed' ? 'open' : 'closed'}`, () => {
      const v = view(facts);
      expect(decideAccess(snap(v), T0).kind).toBe(want);
      expect(v.entitlement.access).toBe(want === 'allowed' ? 'full' : 'account-only');
    });
  }
  it('an account that has not confirmed its email cannot start the trial, and is told to confirm first', () => {
    const v = view({ emailVerified: false });
    expect(v.entitlement.canStartTrial).toBe(false);
    expect(gateCopy(v).title).toMatch(/Confirm your email/);
  });
});

describe('cancel at the end of the period keeps access to the exact end, then closes', () => {
  it('open until the period ends by the server’s clock, then the app must ask again, and the server’s next answer closes it', () => {
    const end = T0 + 25 * DAY;
    const v = view({ subscription: sub('active', { cancelAtPeriodEnd: true }) });
    expect(v.entitlement.accessEndsAt).toBe(D(end).toISOString());
    const s = snap(v);
    expect(decideAccess(s, T0 + 24 * DAY + 23 * HOUR).kind).toBe('allowed');
    expect(decideAccess(s, end - 1000).kind).toBe('allowed');
    expect(decideAccess(s, end).kind).toBe('reconfirm');
    // The server’s answer after the end: closed.
    const later = view({ subscription: sub('active', { cancelAtPeriodEnd: true }) }, end + 1000);
    expect(later.entitlement).toMatchObject({ state: 'expired', access: 'account-only' });
    expect(decideAccess(snap(later, end + 1000), end + 1000).kind).toBe('blocked');
  });
});

describe('how long an answer is relied on', () => {
  it('a running trial is open until its end, measured as time passed since the answer, not by the device’s date', () => {
    const v = view({ trial: trial(T0 - 13 * DAY) });
    const s = snap(v);
    expect(decideAccess(s, T0 + 23 * HOUR).kind).toBe('allowed');
    expect(decideAccess(s, T0 + 24 * HOUR).kind).toBe('reconfirm');
    expect(msUntilAccessEnds(s, T0)).toBe(DAY + 1000);
  });
  it('a device clock moved backwards extends nothing: the app asks the server again', () => {
    const s = snap(view({ trial: trial() }));
    expect(decideAccess(s, T0 - 1).kind).toBe('reconfirm');
    expect(serverNowMs(s, T0 - 5 * DAY)).toBe(T0);
  });
  it('an answer given after the end, while the server was still allowing it (the day for a renewal to be recorded), is relied on until the next check and does not make the app ask every second', () => {
    const justPast = view({ subscription: sub('active', { currentPeriodEnd: D(T0 - 2 * HOUR) }) });
    expect(justPast.entitlement).toMatchObject({ state: 'paid-active', access: 'full' });
    const s = snap(justPast);
    expect(decideAccess(s, T0 + 1000).kind).toBe('allowed');
    expect(msUntilAccessEnds(s, T0)).toBeNull();
  });
  it('a closed account stays closed, and an open one with no end has no timer', () => {
    expect(msUntilAccessEnds(snap(view({})), T0)).toBeNull();
    expect(msUntilAccessEnds(snap(view({ subscription: sub('active') })), T0)).toBe(25 * DAY + 1000);
  });
  it('garbage in the server time is never trusted', () => {
    const v = { ...view({ trial: trial() }), serverTime: 'not a time' };
    expect(decideAccess(snap(v), T0).kind).toBe('reconfirm');
  });
});

describe('when the server cannot be reached (the documented offline allowance)', () => {
  const open = () => snap(view({ subscription: sub('active') }), T0, false);
  it('keeps the planner open for at most 72 hours after the last confirmation, and says until when', () => {
    const s = open();
    const a = decideAccess(s, T0 + 10 * HOUR);
    expect(a).toEqual({ kind: 'allowed', offlineUntil: T0 + OFFLINE_ALLOWANCE_MS });
    expect(decideAccess(s, T0 + 71 * HOUR).kind).toBe('allowed');
    expect(decideAccess(s, T0 + 72 * HOUR + 1000).kind).toBe('unconfirmed');
  });
  it('never beyond the confirmed end of the trial or paid period, even inside the 72 hours', () => {
    const v = view({ trial: trial(T0 - 13 * DAY - 20 * HOUR) });               // ends in 4 hours
    const s = snap(v, T0, false);
    expect(decideAccess(s, T0 + 3 * HOUR)).toEqual({ kind: 'allowed', offlineUntil: T0 + 4 * HOUR });
    expect(decideAccess(s, T0 + 4 * HOUR + 1000).kind).toBe('unconfirmed');
  });
  it('a no stays a no offline, and a clock moved backwards asks again rather than extending anything', () => {
    expect(decideAccess(snap(view({}), T0, false), T0 + HOUR).kind).toBe('blocked');
    expect(decideAccess(open(), T0 - HOUR).kind).toBe('reconfirm');
  });
  it('is the same as reachable until the connection fails: reachable answers carry no offline marker', () => {
    expect(decideAccess(snap(view({ subscription: sub('active') })), T0 + HOUR)).toEqual({ kind: 'allowed', offlineUntil: null });
  });
});

describe('what stays open when the planner is closed, and what it says', () => {
  it('only the account screens stay reachable by address', () => {
    expect(routeStaysOpen('account')).toBe(true);
    expect(routeStaysOpen('account/data')).toBe(true);
    for (const r of ['', 'today', 'plan', 'settings', 'onboarding', 'meals', 'account/other', 'accounts']) expect(routeStaysOpen(r)).toBe(false);
  });
  it('every closed state has its own title, says what stays open, and none promises a feature the server does not give', () => {
    const states: Partial<EntitlementInput>[] = [{}, { trial: trial(T0 - 20 * DAY) }, { subscription: sub('incomplete') }, { subscription: sub('past_due', { currentPeriodStart: D(T0 - 5 * DAY) }) }, { subscription: sub('unpaid') }, { subscription: sub('active', { suspendedReason: 'dispute' }) }, { subscription: sub('canceled') }];
    const copies = states.map((f) => gateCopy(view(f)));
    expect(new Set(copies.map((c) => c.lead)).size).toBe(copies.length);                 // each state says its own reason
    for (const c of copies.slice(1)) expect(c.title).toBe('Your planner is paused');      // and the headline never repeats a section's own heading
    for (const f of states) {
      const c = gateCopy(view(f));
      expect(c.lead).toMatch(/safe on this device/);
      expect(c.lead).toMatch(/download your data/);
      expect(c.lead).toMatch(/delete your account/);
      expect(c.title + c.lead).not.toMatch(/unlimited|free forever/i);
    }
    expect(gateCopy(view({})).title).toBe('Start your free trial');
    expect(gateCopy(view({})).lead).toMatch(/14-day free trial with no card/);
    expect(UNCONFIRMED_COPY.lead).toMatch(/Nothing on this device has been changed or deleted/);
  });
});
