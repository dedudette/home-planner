import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Stripe from 'stripe';
import { LOOKUP_KEYS, setupStripe } from '../server/billing/setup';
import { startFakeStripe, type FakeStripe } from './support/fakeStripe';

/** FAKE PROVIDER: the real SDK against the local stand-in. */
describe('stripe setup script logic (fake provider)', () => {
  let fake: FakeStripe;
  let stripe: Stripe;
  beforeAll(async () => { fake = await startFakeStripe(); stripe = new Stripe('sk_test_x', { host: '127.0.0.1', port: fake.port, protocol: 'http', telemetry: false, maxNetworkRetries: 0 }); });
  afterAll(async () => { await fake.close(); });

  it('creates the product, €25/month and €255/year prices (inclusive tax) and a portal configuration; running again reuses the prices', async () => {
    const first = await setupStripe(stripe, { taxMode: 'stripe_tax_inclusive', appOrigin: 'http://localhost:5173' });
    expect(first.created.length).toBe(4);
    const m = fake.prices.get(first.priceMonthly); const a = fake.prices.get(first.priceAnnual);
    expect(m).toMatchObject({ unit_amount: 2500, currency: 'eur', tax_behavior: 'inclusive', lookup_key: LOOKUP_KEYS.monthly, recurring: { interval: 'month' } });
    expect(a).toMatchObject({ unit_amount: 25500, currency: 'eur', tax_behavior: 'inclusive', lookup_key: LOOKUP_KEYS.annual, recurring: { interval: 'year' } });
    const portal = fake.requests.filter((r) => r.path === '/v1/billing_portal/configurations').pop()!.form;
    expect(portal.features.subscription_cancel).toMatchObject({ enabled: 'true', mode: 'at_period_end' });
    expect(portal.features.subscription_update.products[0].prices).toEqual([first.priceMonthly, first.priceAnnual]);
    const second = await setupStripe(stripe, { taxMode: 'stripe_tax_inclusive', appOrigin: 'http://localhost:5173' });
    expect(second.priceMonthly).toBe(first.priceMonthly);
    expect(second.priceAnnual).toBe(first.priceAnnual);
    expect(second.reused).toEqual([first.priceMonthly, first.priceAnnual]);
    expect(fake.prices.size).toBe(2);
  });
  it('refuses to reuse a price with the right lookup key but the wrong amount', async () => {
    const f2 = await startFakeStripe();
    try {
      f2.prices.set('price_bad', { id: 'price_bad', object: 'price', active: true, currency: 'eur', unit_amount: 24500, type: 'recurring', tax_behavior: 'inclusive', lookup_key: LOOKUP_KEYS.annual, product: 'prod_x', recurring: { interval: 'year', interval_count: 1 } });
      const s2 = new Stripe('sk_test_x', { host: '127.0.0.1', port: f2.port, protocol: 'http', telemetry: false, maxNetworkRetries: 0 });
      await expect(setupStripe(s2, { taxMode: 'stripe_tax_inclusive', appOrigin: 'http://localhost:5173' })).rejects.toThrow(/not €255 EUR per year/);
    } finally { await f2.close(); }
  });
});
