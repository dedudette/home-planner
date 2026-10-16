import { describe, expect, it } from 'vitest';
import { ANNUAL_CENTS, ANNUAL_DISCOUNT_PERCENT, annualMonthlyEquivalentCents, annualNote, annualSavingsCents, CURRENCY, formatEuro, isPlanId, MONTHLY_CENTS, PLANS, planDisclosure, TRIAL_DAYS } from '../src/domain/billing/plans';

describe('plans: the exact advertised prices', () => {
  it('monthly is €25 and annual is €255, in euro cents', () => {
    expect(CURRENCY).toBe('eur');
    expect(MONTHLY_CENTS).toBe(2500);
    expect(ANNUAL_CENTS).toBe(25500);
    expect(PLANS.monthly).toMatchObject({ cents: 2500, interval: 'month', chargeLabel: '€25/month' });
    expect(PLANS.annual).toMatchObject({ cents: 25500, interval: 'year', chargeLabel: '€255/year' });
  });
  it('annual is exactly 15% below twelve months at the monthly price', () => {
    expect(ANNUAL_DISCOUNT_PERCENT).toBe(15);
    expect(ANNUAL_CENTS).toBe((12 * MONTHLY_CENTS * (100 - ANNUAL_DISCOUNT_PERCENT)) / 100);
    expect(annualSavingsCents()).toBe(4500);
    expect(annualMonthlyEquivalentCents()).toBe(2125);
  });
  it('the words shown to people: €255/year, €21.25 a month, save €45, never implying monthly charging', () => {
    expect(formatEuro(25500)).toBe('€255');
    expect(formatEuro(2125)).toBe('€21.25');
    expect(formatEuro(4500)).toBe('€45');
    expect(annualNote()).toBe('equivalent to €21.25/month · save €45/year');
    const a = planDisclosure('annual');
    expect(a).toContain('€255 per year');
    expect(a).toContain('charged once a year');
    expect(a).toContain('not monthly');
    expect(a).toContain('Renews automatically');
    expect(a).toContain('€21.25');
    expect(a).toContain('€45');
    expect(planDisclosure('monthly')).toContain('€25 per month');
    expect(planDisclosure('monthly')).toContain('until you cancel');
  });
  it('the trial is fourteen days and only the two plan names are accepted', () => {
    expect(TRIAL_DAYS).toBe(14);
    expect(isPlanId('monthly') && isPlanId('annual')).toBe(true);
    for (const bad of ['', 'Monthly', 'lifetime', 'price_123', null, undefined, 25, {}]) expect(isPlanId(bad)).toBe(false);
  });
});
