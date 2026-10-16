import type Stripe from 'stripe';
import { ANNUAL_CENTS, MONTHLY_CENTS, PLANS, type PlanId } from '../../src/domain/billing/plans';
import type { TaxMode } from './config';

/**
 * One-time Stripe setup for a TEST-mode account: the product, the two prices, and a customer-portal configuration. Safe to run again:
 * existing prices are found by their lookup keys and reused if they are exactly right; if one exists with a different amount it stops
 * (a price's amount cannot be changed, and moving a lookup key is a decision for a person). It creates nothing that charges anyone.
 * The webhook endpoint is registered by hand (see docs/billing-sandbox.md) because Stripe shows its signing secret only once.
 */
export const LOOKUP_KEYS: Record<PlanId, string> = { monthly: `cleanflow_monthly_eur_${MONTHLY_CENTS}`, annual: `cleanflow_annual_eur_${ANNUAL_CENTS}` };

export interface SetupResult { product: string; priceMonthly: string; priceAnnual: string; portalConfiguration: string; created: string[]; reused: string[] }

export const setupStripe = async (stripe: Stripe, o: { taxMode: TaxMode; appOrigin: string }): Promise<SetupResult> => {
  const created: string[] = [];
  const reused: string[] = [];
  const found = await stripe.prices.list({ lookup_keys: Object.values(LOOKUP_KEYS), active: true, limit: 10 });
  const byKey = new Map(found.data.map((p) => [p.lookup_key, p]));
  let product = '';
  const priceIds = {} as Record<PlanId, string>;
  for (const plan of ['monthly', 'annual'] as const) {
    const want = PLANS[plan];
    const have = byKey.get(LOOKUP_KEYS[plan]);
    if (have) {
      const ok = have.unit_amount === want.cents && have.currency === 'eur' && have.recurring?.interval === want.interval && (have.recurring?.interval_count ?? 1) === 1 && (o.taxMode !== 'stripe_tax_inclusive' || have.tax_behavior === 'inclusive');
      if (!ok) throw new Error(`A price with lookup key ${LOOKUP_KEYS[plan]} exists but is not €${want.cents / 100} EUR per ${want.interval}${o.taxMode === 'stripe_tax_inclusive' ? ' with inclusive tax' : ''}. Archive it in the Stripe dashboard (or give it another lookup key) and run this again.`);
      priceIds[plan] = have.id;
      product ||= typeof have.product === 'string' ? have.product : have.product.id;
      reused.push(have.id);
    }
  }
  if (!product) {
    const p = await stripe.products.create({ name: 'CleanFlow subscription', metadata: { app: 'cleanflow' } });
    product = p.id;
    created.push(p.id);
  }
  for (const plan of ['monthly', 'annual'] as const) {
    if (priceIds[plan]) continue;
    const want = PLANS[plan];
    const p = await stripe.prices.create({
      product, currency: 'eur', unit_amount: want.cents, recurring: { interval: want.interval }, lookup_key: LOOKUP_KEYS[plan],
      nickname: `CleanFlow ${plan} (${want.chargeLabel})`, tax_behavior: o.taxMode === 'stripe_tax_inclusive' ? 'inclusive' : 'unspecified',
    });
    priceIds[plan] = p.id;
    created.push(p.id);
  }
  const portal = await stripe.billingPortal.configurations.create({
    business_profile: { headline: 'Manage your CleanFlow subscription' },
    default_return_url: `${o.appOrigin}/?billing=returned`,
    features: {
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      customer_update: { enabled: true, allowed_updates: ['email', 'address'] },
      // Cancelling keeps access to the end of the paid period and shows its date; switching plan shows the prorated amount before it is confirmed.
      subscription_cancel: { enabled: true, mode: 'at_period_end', proration_behavior: 'none' },
      subscription_update: { enabled: true, default_allowed_updates: ['price'], proration_behavior: 'create_prorations', products: [{ product, prices: [priceIds.monthly, priceIds.annual] }] },
    },
  });
  created.push(portal.id);
  return { product, priceMonthly: priceIds.monthly, priceAnnual: priceIds.annual, portalConfiguration: portal.id, created, reused };
};
