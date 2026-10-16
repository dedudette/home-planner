import Stripe from 'stripe';
import { setupStripe } from '../server/billing/setup';

/**
 * Prepares a Stripe TEST-mode account for CleanFlow: product, the €25/month and €255/year prices, and a portal configuration. It prints
 * the environment variable lines to put in the server's environment. It refuses a live key, never prints a secret, and charges nobody.
 *
 *   STRIPE_SECRET_KEY=sk_test_… APP_ORIGIN=https://your-test-host npm run stripe:setup
 */
const key = (process.env.STRIPE_SECRET_KEY ?? '').trim();
if (!/^(sk|rk)_test_/.test(key)) { console.error('Set STRIPE_SECRET_KEY to a TEST-mode key (sk_test_… or rk_test_…). Live keys are refused.'); process.exit(2); }
const origin = (process.env.APP_ORIGIN ?? '').trim().replace(/\/+$/, '');
if (!origin) { console.error('Set APP_ORIGIN (for example http://localhost:5173).'); process.exit(2); }
const tax = process.env.BILLING_TAX_MODE === 'none_sandbox_only' ? 'none_sandbox_only' : 'stripe_tax_inclusive';
const stripe = new Stripe(key, { maxNetworkRetries: 2, telemetry: false, appInfo: { name: 'CleanFlow setup' } });
const r = await setupStripe(stripe, { taxMode: tax, appOrigin: origin });
console.log(`Created: ${r.created.join(', ') || 'nothing'}\nReused:  ${r.reused.join(', ') || 'nothing'}\n`);
console.log('Add these to the server environment:');
console.log(`STRIPE_PRICE_MONTHLY=${r.priceMonthly}`);
console.log(`STRIPE_PRICE_ANNUAL=${r.priceAnnual}`);
console.log(`STRIPE_PORTAL_CONFIGURATION=${r.portalConfiguration}`);
console.log(`BILLING_TAX_MODE=${tax}`);
console.log('\nThen register the webhook endpoint by hand (docs/billing-sandbox.md, step 3) and set STRIPE_WEBHOOK_SECRET.');
