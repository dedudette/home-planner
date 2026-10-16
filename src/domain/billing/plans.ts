/**
 * The two subscription plans, in one place for the server (which maps a plan name to a provider price and checks the price it finds
 * against these numbers) and the screens (which show them). Everything is in euro cents. These are the intended advertised totals a
 * consumer pays: whether tax is added on top or is already inside is a configuration decision (BILLING_TAX_MODE), never a number
 * invented here, and an unresolved tax setup blocks production billing (see docs/billing.md).
 *
 * The annual price is exactly 15% below twelve months at the monthly price: 12 × €25 = €300, less 15% = €255.
 */
export const CURRENCY = 'eur' as const;
export type PlanId = 'monthly' | 'annual';
export const PLAN_IDS: readonly PlanId[] = ['monthly', 'annual'];

export const MONTHLY_CENTS = 2_500;
export const ANNUAL_DISCOUNT_PERCENT = 15;
export const ANNUAL_CENTS = 25_500;
export const TRIAL_DAYS = 14;

export interface Plan {
  id: PlanId;
  cents: number;
  interval: 'month' | 'year';
  /** What one charge is, in the words every screen and the checkout use. */
  chargeLabel: string;
}

export const PLANS: Readonly<Record<PlanId, Plan>> = {
  monthly: { id: 'monthly', cents: MONTHLY_CENTS, interval: 'month', chargeLabel: '€25/month' },
  annual: { id: 'annual', cents: ANNUAL_CENTS, interval: 'year', chargeLabel: '€255/year' },
};

export const isPlanId = (v: unknown): v is PlanId => v === 'monthly' || v === 'annual';

/** €25, €21.25, €0.50: whole euros without decimals, otherwise two. Fixed format, not locale-dependent, so a test can pin it. */
export const formatEuro = (cents: number): string => {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.round(cents));
  const whole = Math.floor(abs / 100);
  const rest = abs % 100;
  return `${sign}€${whole}${rest ? `.${String(rest).padStart(2, '0')}` : ''}`;
};

export const annualMonthlyEquivalentCents = (): number => ANNUAL_CENTS / 12;
export const annualSavingsCents = (): number => 12 * MONTHLY_CENTS - ANNUAL_CENTS;

/** The sentence shown before anyone pays. It states the total, the interval and that the plan renews until cancelled. */
export const planDisclosure = (id: PlanId): string =>
  id === 'monthly'
    ? '€25 per month, charged every month until you cancel. Renews automatically.'
    : '€255 per year, charged once a year (not monthly) until you cancel. Renews automatically. That is equivalent to €21.25 a month and saves €45 a year compared with paying monthly.';

export const planTitle = (id: PlanId): string => (id === 'monthly' ? 'Monthly' : 'Annual');
export const planPriceLine = (id: PlanId): string => PLANS[id].chargeLabel;
export const annualNote = (): string => `equivalent to ${formatEuro(annualMonthlyEquivalentCents())}/month · save ${formatEuro(annualSavingsCents())}/year`;
