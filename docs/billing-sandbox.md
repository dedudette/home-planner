# Trying billing in Stripe's test mode

Everything below uses **test mode only**: test keys (`sk_test_…`), test cards, no real money. The server refuses a live key unless `BILLING_ENV=live` **and** `BILLING_LIVE_CONFIRM` are set, and nothing in this repository sets them. Do not do these steps with live keys.

The automated tests (`npm run test:db`) cover the same flows against a **local stand-in** for Stripe, so they do not need a Stripe account; they prove this code's logic, not Stripe's. The steps here are the check against Stripe itself. They were **not run** while building this (no network route to Stripe from the build environment).

## 0. What you need
A Stripe account in test mode; PostgreSQL; Node 22; an email provider **or** development mode (`MAIL_PROVIDER=console` prints verification links to the server log; nothing is delivered). `stripe` CLI optional (for `stripe listen` and test clocks).

## 1. Database and server settings
Follow `docs/deployment.md` (create the roles, `npm run db:migrate`). Minimal local environment:

```
APP_ORIGIN=http://localhost:5173        DATABASE_URL=postgres://cleanflow_app:…@127.0.0.1/cleanflow
BETTER_AUTH_SECRET=<32+ random chars>    TRIAL_CLAIM_SECRET=<32+ other random chars>
MAIL_PROVIDER=console
STRIPE_SECRET_KEY=sk_test_…              BILLING_TAX_MODE=none_sandbox_only
ANTHROPIC_API_KEY=…                      (optional: only for the AI features)
```

## 2. Create the product, prices and portal configuration
`STRIPE_SECRET_KEY=sk_test_… APP_ORIGIN=http://localhost:5173 BILLING_TAX_MODE=none_sandbox_only npm run stripe:setup`
It prints `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_ANNUAL`, `STRIPE_PORTAL_CONFIGURATION`. Add them to the environment. (For the intended production tax setting use `BILLING_TAX_MODE=stripe_tax_inclusive` after configuring Stripe Tax in the dashboard.) The portal needs your privacy-policy and terms URLs in the dashboard's portal settings; Stripe may refuse the configuration until they exist.

## 3. Webhook endpoint
Locally: `stripe listen --forward-to localhost:5173/api/billing/webhook` prints a `whsec_…` secret for that session: set it as `STRIPE_WEBHOOK_SECRET`. On a hosted test deployment register `https://<APP_ORIGIN>/api/billing/webhook` in Developers → Webhooks with these events: `checkout.session.completed`, `checkout.session.expired`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`, `invoice.payment_action_required`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`, and copy its signing secret. Never put the secret in Git, a client file or a chat.

## 4. Run it
`npm run dev`, open the app, create an account, confirm the email (the link is in the server log in console mode), then check each item:

1. **Prices**: the pricing screen shows €25/month and €255/year with "equivalent to €21.25/month · save €45/year". The server log must not say `price-mismatch`.
2. **Trial**: "Start my 14-day trial" → trial days remaining; reload and use another browser: same end date; try again: "already used".
3. **Checkout**: choose Annual → Stripe's page shows €255 and the sentence "charged once a year (not monthly)" above the pay button. Pay with `4242 4242 4242 4242` (any future expiry, any CVC). Back in the app the plan becomes active **only after** Stripe reports it; check that opening the success URL by hand with a made-up `session_id` changes nothing.
4. **Authentication required**: pay with `4000 0025 0000 3155` and complete or fail the 3-D Secure step. Failing it must leave "payment action required" and no paid access.
5. **Declined renewal**: use `4000 0000 0000 0341` (attaches, then fails on charge) with a **test clock** (see Stripe's test-clock documentation; you create the clock first and attach the customer to it when the customer is created, so create the account's customer through a clock-enabled flow or use a fresh test customer): attach the customer to a clock, advance a month; expect `past-due`, full access for the grace days, then account-only, and one "payment did not go through" email. Update the card in the portal and expect recovery.
6. **Cancel**: "Cancel at period end" → exact end date shown, access continues; advance the test clock past it → `expired`, data intact; export still works.
7. **Plan change**: in the portal switch Monthly → Annual; the portal shows the prorated amount before confirming; the app then shows €255/year and the same AI allowance.
8. **Refund / dispute**: refund a test charge fully in the dashboard → access ends; a partial refund → no change. Create a dispute with test card `4000 0000 0000 0259` → `suspended`; resolve it in the dashboard (the dashboard lets you submit evidence in test mode) → restored.
9. **Webhook hygiene**: resend the same event twice from the dashboard's webhook page (or the CLI) → one change only; the `billing_events` table shows the id once.
10. **Deleting the account** with an active subscription: the subscription is cancelled in Stripe first.

**Test card numbers above are written from memory of Stripe's testing documentation: check them there before relying on them.**

Record which of these you ran and what you saw; the repository claims only what is in `docs/billing.md` and the test suite.
