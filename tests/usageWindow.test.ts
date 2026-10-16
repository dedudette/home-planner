import { describe, expect, it } from 'vitest';
import { computeEntitlement, type SubscriptionFacts, type TrialFacts } from '../src/domain/billing/entitlement';
import { addMonthsUTC, DEFAULT_ALLOWANCE, monthlyWindow, usageWindowFor } from '../src/domain/billing/usage';

const D = (s: string) => new Date(s);
const sub = (over: Partial<SubscriptionFacts> = {}): SubscriptionFacts => ({
  provider: 'stripe', plan: 'monthly', status: 'active', startedAt: D('2026-01-31T10:00:00Z'),
  currentPeriodStart: D('2026-02-28T10:00:00Z'), currentPeriodEnd: D('2026-03-31T10:00:00Z'), cancelAtPeriodEnd: false, suspendedReason: null, ...over,
});
const windowAt = (s: SubscriptionFacts | null, trial: TrialFacts | null, now: Date) => {
  const e = computeEntitlement({ now, emailVerified: true, trial, subscription: s });
  return usageWindowFor(e, { trial, subscription: s }, now);
};

describe('AI allowance windows', () => {
  it('month arithmetic clamps to short months without drifting', () => {
    const a = D('2026-01-31T10:00:00Z');
    expect(addMonthsUTC(a, 1).toISOString()).toBe('2026-02-28T10:00:00.000Z');
    expect(addMonthsUTC(a, 2).toISOString()).toBe('2026-03-31T10:00:00.000Z');
    expect(addMonthsUTC(a, 13).toISOString()).toBe('2027-02-28T10:00:00.000Z');
    expect(addMonthsUTC(D('2024-01-31T00:00:00Z'), 1).toISOString()).toBe('2024-02-29T00:00:00.000Z');
  });
  it('windows are contiguous and contain "now"', () => {
    const a = D('2026-01-31T10:00:00Z');
    let prevEnd: number | null = null;
    for (let d = D('2026-01-31T10:00:00Z').getTime(); d < D('2027-03-01T00:00:00Z').getTime(); d += 36 * 3600 * 1000) {
      const w = monthlyWindow(a, new Date(d));
      expect(w.start.getTime()).toBeLessThanOrEqual(d);
      expect(w.end.getTime()).toBeGreaterThan(d);
      if (prevEnd !== null && w.start.getTime() > prevEnd) throw new Error('gap');
      prevEnd = w.end.getTime();
    }
  });
  it('the trial has one window with the trial number', () => {
    const trial = { startedAt: D('2026-03-01T09:00:00Z'), endsAt: D('2026-03-15T09:00:00Z') };
    const w = windowAt(null, trial, D('2026-03-05T00:00:00Z'))!;
    expect(w).toMatchObject({ kind: 'trial', limit: DEFAULT_ALLOWANCE.trial });
    expect(w.end.toISOString()).toBe('2026-03-15T09:00:00.000Z');
    expect(windowAt(null, trial, D('2026-03-15T09:00:00Z'))).toBeNull();
  });
  it('monthly and annual plans get the same monthly allowance and the same window dates', () => {
    const now = D('2026-03-10T00:00:00Z');
    const m = windowAt(sub({ plan: 'monthly' }), null, now)!;
    const a = windowAt(sub({ plan: 'annual', currentPeriodStart: D('2026-01-31T10:00:00Z'), currentPeriodEnd: D('2027-01-31T10:00:00Z') }), null, now)!;
    expect(a.limit).toBe(m.limit);
    expect(a.limit).toBe(DEFAULT_ALLOWANCE.monthly);
    expect(a.start.toISOString()).toBe(m.start.toISOString());
    expect(a.end.toISOString()).toBe(m.end.toISOString());
    expect(m.end.toISOString()).toBe('2026-03-31T10:00:00.000Z');
  });
  it('changing plan or re-dating the billing period does not open a new window', () => {
    const now = D('2026-03-10T00:00:00Z');
    const before = windowAt(sub({ plan: 'monthly' }), null, now)!;
    const after = windowAt(sub({ plan: 'annual', currentPeriodStart: D('2026-03-09T00:00:00Z'), currentPeriodEnd: D('2027-03-09T00:00:00Z') }), null, now)!;
    expect(after.key).toBe(before.key);
  });
  it('a scheduled cancellation never gives a window longer than the paid period', () => {
    const s = sub({ cancelAtPeriodEnd: true, currentPeriodEnd: D('2026-03-20T10:00:00Z') });
    expect(windowAt(s, null, D('2026-03-10T00:00:00Z'))!.end.toISOString()).toBe('2026-03-20T10:00:00.000Z');
  });
  it('states without full access have no window', () => {
    expect(windowAt(null, null, D('2026-03-10T00:00:00Z'))).toBeNull();
    expect(windowAt(sub({ status: 'unpaid' }), null, D('2026-03-10T00:00:00Z'))).toBeNull();
  });
});
