# Accounts, the 14-day trial and subscriptions

How the commercial layer behaves, exactly. Code references are to files in this repository. "Verified" below means a test in
`tests/db/*` ran against real PostgreSQL and real Better Auth; billing tests use the real Stripe SDK against a **local stand-in**
(`tests/support/fakeStripe.ts`), which proves our logic, not Stripe's behaviour. Nothing here has been run against Stripe's own servers
or any email provider: see `docs/billing-sandbox.md` for the procedure that does that, and the open items at the end.

## Prices and terms

| | Monthly | Annual |
|---|---|---|
| Charge | **€25** every month | **€255** once a year |
| Renewal | automatic until cancelled | automatic until cancelled |
| What the app shows | "€25/month" | "€255/year", "equivalent to €21.25/month", "save €45/year" (never "per month" as a charge) |
| Features | all | all (identical) |
| AI allowance | 300 answered requests per month | the **same** 300 per month (it resets monthly on the subscription's anniversary, not yearly) |

€255 is exactly 15% below 12 × €25 = €300 (`src/domain/billing/plans.ts`, tested). The server maps only the names `monthly` and
`annual` to Stripe Price ids and, at start-up and every ten minutes, checks that each Price really is that amount, EUR, that interval,
licensed, and tax-inclusive when `BILLING_TAX_MODE=stripe_tax_inclusive`. A mismatch turns checkout off with a reason (`price-mismatch:annual:amount`);
it never charges a different amount.

Before paying, Stripe's page carries the exact sentence next to the pay button (`custom_text.submit`): for the annual plan "€255 per year,
charged once a year (not monthly) until you cancel. Renews automatically. That is equivalent to €21.25 a month and saves €45 a year compared
with paying monthly." There is no promotion code field, no pre-selected extra and no trial card on file.

## The 14-day trial

- Started only by a signed-in account with a **confirmed email**, by pressing "Start my 14-day trial" (`POST /api/account/trial`). Nothing starts it implicitly, not sign-up, not opening checkout.
- No card. Never converts into a charge: after 14 days the account is simply `trial-expired`.
- Dates are the **server's clock**, stored in PostgreSQL (`trial_claims.started_at/ends_at`). The browser cannot send a start, an end, a time or a header that changes them (tested). Reload, reinstall, another device, another plan, recreating a checkout: nothing restarts it.
- One per person: the claim is keyed on an HMAC (key `TRIAL_CLAIM_SECRET`) of the lower-cased email with any `+tag` removed. Deleting the account and signing up again with the same address, or `name+x@…`, gets "already used". Two simultaneous requests start exactly one (tested).
- Starting a subscription ends the trial's remaining days (there is no carry-over).
- A card added for any other purpose is never charged for anything unless the person explicitly buys a plan.

## Access in every state

"Full" = the whole product. "Account only" = the subscription page, billing, export, cancellation and account deletion. There is no permanent free tier. Computed by `computeEntitlement` from database facts and the server clock; one service (`server/billing/entitlements.ts`) answers for every paid endpoint.

| State | Meaning | Access | AI endpoints |
|---|---|---|---|
| `eligible-not-started` | verified account, no trial yet | account only | refused (402) |
| `trial-active` | within 14 days of the server-recorded start | full | allowed, trial allowance (50) |
| `trial-expired` | trial over | account only | refused |
| `paid-active` | subscription active | full | allowed, monthly allowance (300) |
| `cancellation-scheduled` | will not renew | **full until the exact end of the paid period**, then `expired` | allowed until then |
| `payment-action-required` | first payment not finished (e.g. bank authentication) | account only (no paid access yet) | refused |
| `past-due` | a renewal failed; Stripe is retrying | full for `PAST_DUE_GRACE_DAYS` (default 3) from the start of the unpaid period, then account only | allowed during the grace |
| `unpaid` | retries ended unpaid | account only | refused |
| `suspended` | a payment dispute is open | account only | refused |
| `expired` | cancelled, refunded, or never completed | account only; **data is kept** | refused |

An "active" record whose period ended more than 24 hours ago with no renewal recorded is not trusted (`renewal-not-confirmed`) until the next sync. Statuses this code does not understand (including Stripe's `trialing`, which this product never creates) are treated as not paid.

### Which checks are enforced by the server, and which are only the interface

- **Server-enforced** (cannot be bypassed by editing the browser): every AI endpoint (`/api/coach`, `/api/assist`, and any future Paolo AI endpoint, because they all call the same `AiGate`), checkout, portal, cancel/resume, the account export and cloud backup endpoints, deletion.
- **Interface only**: hiding the planner when an account is not entitled. The planner's data and logic live in the browser (`localStorage`); a person who edits the page could keep using the local features without a subscription. This is stated here deliberately: the product's server-side value (AI, backup, accounts) is protected; offline local features are not and are not claimed to be.
- **Offline policy** (`offlineEntitlementOk`): the app may keep honouring the last server-confirmed "full" access while offline for at most **72 hours** from the last confirmation, never past the confirmed end of the trial or paid period, and never if the device clock moved backwards. After that it asks to reconnect. It is per account (a cache from one account is never used for another).

## AI included in the subscription

The operator's provider key pays for AI; the person never enters one. Durable ledger in PostgreSQL (`server/ai/ledger.ts`):

- Reserve a unit **before** the provider is called (one conditional UPDATE, race-safe: twenty simultaneous requests against five remaining units gives exactly five, tested), then **commit** (a usable answer was returned) or **release** (provider failure, timeout, refusal, or an answer the app's own checks rejected: no charge to the allowance). A request whose server died is released after 5 minutes.
- Allowance windows (`src/domain/billing/usage.ts`): trial = one window, 50 requests; paid = monthly windows from the subscription's start date, 300 requests, **identical for monthly and annual**. Changing plan or the provider re-dating a billing period does not open a new window.
- Limits per request: request bodies ≤ 4 KB (coach) / 16 KB (assistant); output capped at 2,000 tokens by the gate; provider timeout 45 s; a per-account cooldown (30 s default). No automatic overage: at the limit the answer is "You have used your N AI requests for this period. They reset on <date>." The screens show the real used/remaining and the reset date. They never say "unlimited".
- Configurable: `AI_TRIAL_ALLOWANCE`, `AI_MONTHLY_ALLOWANCE`. Any future paid add-on or overage needs its own explicit authorization and is not built.

### Cost assumptions (estimates: verify against current provider pricing)

Provider list price read from the provider's pricing page on 2026-10-16, for `claude-haiku-5-5` (default model), prompts up to 100k tokens: **$0.10 per million input tokens, $0.50 per million output tokens**; the same page listed Sonnet 5.5 at $2 / $10 and Opus 5.5 at $4 / $20. Prices change; recheck before relying on this.

Measured request sizes in this codebase: coach prompt ≈ 4.5 k characters, assistant prompt ≈ 5.2 k characters for a 40-candidate request (about 1.3–1.5 k input tokens at roughly 3.5 characters per token, an estimate). Worst case allowed by the size limits ≈ 6 k input tokens and 2 k output tokens.

| Model | Typical request (1.5 k in, 0.7 k out) | Worst allowed request | 300 requests/month: typical / worst |
|---|---|---|---|
| Haiku 5.5 | ≈ $0.0005 | ≈ $0.0016 | ≈ $0.15 / ≈ $0.49 |
| Sonnet 5.5 | ≈ $0.010 | ≈ $0.032 | ≈ $3 / ≈ $10 |
| Opus 5.5 | ≈ $0.020 | ≈ $0.065 | ≈ $6 / ≈ $19 |

Recommendation: keep Haiku 5.5 with the defaults (50 trial, 300 monthly). If a larger model is chosen, lower `AI_MONTHLY_ALLOWANCE` accordingly (for Opus-class pricing, 100 or fewer) because the worst case would otherwise approach the €25 monthly price before payment fees and tax, which are not estimated here. Total exposure is (active accounts) × allowance: set a spend limit with the provider as the final backstop.

## Cancel, change plan, refunds

- **Cancel**: in the app ("Cancel at period end", `POST /api/billing/cancel`) or the Stripe portal. Access continues to the exact end of the paid period; no further charge; history is never deleted; "Resume" undoes it before the end.
- **Monthly ↔ annual**: in the Stripe customer portal, which shows the prorated amount before the person confirms (configured by `npm run stripe:setup`; **not verified against Stripe here**). The server re-reads the subscription and updates plan and amount; the AI allowance window does not reset.
- **Refunds and disputes** (a policy this repository chose; confirm it with whoever owns refunds): a **full refund** of a charge ends access and cancels the subscription; a **partial** refund changes nothing; an **open dispute** pauses access (`suspended`) until decided; a dispute **won or closed as an inquiry** restores access; a dispute **lost** ends access and cancels. Decisions use the dispute's current status fetched from Stripe, so events arriving in any order give the same answer.
- **Duplicate subscriptions**: prevented by a check before checkout, one open checkout per person, and a unique index (one live subscription per account across providers). If one still arrives (e.g. created by hand in the dashboard) it is not recorded, is cancelled at Stripe (proration credit, no invoice), and the money already taken has to be refunded by hand.

## What the account screen shows in each state (issue #5)

`#/account` ("Trial & plans") is reachable whatever the state, before and after a plan exists, so billing, export and deletion are never behind a subscription. It shows only what the server answers (`GET /api/account`); no stored flag, return address or device clock decides anything. Words and offered actions come from `src/account/subscriptionView.ts`, pinned by `tests/accountSubscriptionView.test.ts` and, on real server answers, `tests/db/subscriptionContract.test.ts`.

| State | Headline | Actions offered | AI allowance shown |
|---|---|---|---|
| paid, active | "Monthly/Annual plan is active", renewal date and amount (€25 every month, or €255 once a year) | Manage billing and invoices, Cancel at period end | yes: used / left / reset date |
| cancellation scheduled | "Your plan ends on <date>" (full access until then, no further charge) | Resume, Manage billing | yes, until the end |
| payment action required | "Your payment needs one more step" (nothing active, nothing assumed) | Continue to the payment page (the same open checkout), Check status | no: paused, with the reason |
| past due, inside the grace | "Your last payment did not go through", access continues until the stated date | Manage billing (update the card), Check status | yes |
| past due, after the grace; or an "active" record whose renewal was not confirmed | stated plainly, what is paused and what keeps working | Manage billing, Check status | no |
| unpaid | "Payments stopped, so your subscription is paused" | Manage billing (pay the open invoice), Check status | no |
| dispute open | "Access is paused while a payment dispute is open" (the app cannot resolve it) | Manage billing | no |
| ended (cancelled, refunded, period over) | "Your subscription has ended", data kept | plans offered again; Manage billing for invoices | no |
| trial / eligible / trial expired | the trial card and the plans (issue #4) | start the trial, choose a plan | trial: its own allowance for the whole trial; otherwise paused |

Always shown: **Download my account data** and **Delete my account** (password required; says so when a subscription is live and that the rest of the paid period is not refunded). If the payment provider is not configured on the server, a subscription is still described, nothing changeable is offered, and the screen says why.

The AI allowance numbers are the server's configured ones (`AI_TRIAL_ALLOWANCE`, `AI_MONTHLY_ALLOWANCE`), never constants in the app. The monthly and annual plans show the same number with the same words, and an annual subscriber's allowance still resets monthly. The screen never says "unlimited".

What these tests prove and do not: the interface and the server logic are tested against real PostgreSQL, real Better Auth and the real Stripe SDK talking to a **mock** provider (`tests/support/fakeStripe.ts`). Stripe's own behaviour (the hosted payment and portal pages, 3-D Secure, retries, proration, disputes) is **not** verified here; the checklist in `docs/billing-sandbox.md` is the procedure for that.

## Webhooks

`POST /api/billing/webhook`: signature verified over the **raw bytes** (`stripe-signature`, 5-minute tolerance); the event id is stored before anything is done; the event is acted on by fetching the **current** subscription from Stripe, so retried, duplicated or out-of-order events cannot move a record backwards; failures answer 500 so Stripe retries; concurrent duplicates are told to come back. Handled: `checkout.session.completed/expired`, `customer.subscription.created/updated/deleted`, `invoice.paid/payment_failed/payment_action_required`, `charge.refunded`, `charge.dispute.created/updated/closed`. Anything else is acknowledged and ignored. Only ids and outcomes are stored, never payloads.

No paid access ever comes from the success URL: the page asks `POST /api/billing/sync`, which asks Stripe, and the record changes only if Stripe reports an active subscription for this person's own checkout session (tested, including trying to sync someone else's).

## Notifications

Queued in `notifications`, de-duplicated by key (one per invoice, one per scheduled cancellation, one per trial, one per renewal), delivered by the periodic tick with retries after 1, 5, 30, 120 and 720 minutes. Kinds: trial ending (3 days before), subscription started, annual renewal in 7 days, payment failed, payment needs confirmation, cancellation scheduled, access ended. Status is honest: `sent` = the mail provider accepted it; `simulated` = no provider configured, **nothing left the server**; `failed` = will be retried; `dead` = gave up. Monthly renewals are not announced by us (the provider's receipts cover them).

## Data, deletion and what is kept

- Account data is per person in PostgreSQL with row-level security (`server/db/migrations/0002_app.sql`); every request-scoped query runs in a transaction that carries only that person's id (tested with two accounts, forged ids, pooled connections).
- Plan, history, journal and health data stay on the device unless the person turns on cloud backup. Nothing from them is ever put in Stripe metadata (Stripe receives an email address, an opaque account id and the plan name; tested).
- **Delete account**: needs the password; first cancels the subscription at Stripe (if that fails nothing is deleted and the person is told to retry), then deletes the account and everything it owns. What remains: the **trial claim** (an HMAC, no readable email, so a deleted account cannot re-take the trial), webhook **event ids** (no personal data), and the Stripe **customer record and invoices at Stripe** (Stripe retains billing records; the app does not delete them). Whether that retention, and the HMAC itself, is acceptable and for how long, and the right to erasure vs accounting retention, is a **legal review item**. The remaining days of a paid period are forfeited by deleting; the screen says so.

## Mobile stores

Not implemented. The data model is provider-neutral (`subscriptions.provider` ∈ stripe | apple | google, one live subscription per account across providers, one trial per person) so store billing can be added, but StoreKit / Play Billing, receipt/notification verification and restore are not built, and **the native app shows no purchase buttons** (a web Stripe checkout is not assumed to be allowed inside a store app). Store rules about unlocking features, linking to outside payment and account deletion change and need a current review before any store submission; no store release was prepared or submitted.

## Charging currency is not payout currency

Checked on 2026-10-16 through search results that quote Stripe's documentation (the Stripe pages themselves could not be opened from the build environment, so **re-read them before relying on this**): [Supported currencies](https://docs.stripe.com/currencies), [Multi-currency settlement](https://docs.stripe.com/payouts/multi-currency-settlement), [Receive payouts](https://docs.stripe.com/payouts).

- The **charge (presentment) currency** is what the customer is shown and pays: €25 and €255 here. EUR is in Stripe's list of supported presentment currencies.
- The **settlement/payout currency** is what lands in the merchant's bank account. These can differ. A charge in a currency other than a settlement currency the account has configured is converted to the account's default settlement currency, and some additional settlement currencies carry a fee. To settle in euro without conversion the account needs a euro-capable bank account, which is a Dashboard/Stripe-support question for the specific account, not something this code decides.
- So a business in Romania is **not** assumed unable to charge in EUR. What is unverified is only the payout side (which settlement currencies the Romanian account offers, and the conversion fee). That does not block building or testing the screens: sandbox checks run in test mode, and the server already refuses to enable checkout unless each Price is exactly the expected EUR amount.
- Payment methods beyond cards (and the Apple Pay / Google Pay wallets that ride on cards) depend on the account's country and on whether the method supports subscriptions. From the same search: PayPal subscriptions in Checkout are for businesses located in Europe and need PayPal recurring payments enabled in the Dashboard; Revolut Pay is described as gated; the support matrix for SEPA Direct Debit and Link could not be read. The code sets no `payment_method_types`, so what is offered is whatever is enabled in the Dashboard.

## Open items before any production activation (none is resolved by this repository)

1. **Tax**: €25 and €255 are treated as the intended consumer totals; `stripe_tax_inclusive` makes Stripe Tax calculate tax inside them. Which countries, registrations, whether prices stay inclusive, and invoice requirements are decisions for a tax adviser. Production billing refuses to start with `BILLING_TAX_MODE` unset, and `none_sandbox_only` is test-mode only.
2. **Legal documents**: privacy policy, terms, refund/cancellation policy, company identity and withdrawal-right wording for EU consumers (the "Start my trial" and "Subscribe" flows state price, interval and renewal; withdrawal rules for digital services are for counsel). Links come from `LEGAL_*` variables; if unset the screens say the documents are not available, and the placeholders in this repo are **not** launch-ready.
3. **Live Stripe account** configuration (business details, statement descriptor, Radar, SCA settings, receipts and invoice emails, portal terms/privacy URLs), a real webhook endpoint, and a reviewed live activation (`BILLING_LIVE_CONFIRM`). Not done here.
4. **Email delivery provider** with a verified sender domain (SPF/DKIM/DMARC). The Resend adapter is written to its documented API but was not run against it.
5. **Store billing** (above).
6. Retention periods and erasure vs accounting rules (above); processor agreements with Stripe, the mail provider, the model provider and the host.
7. Support/admin tooling: there is no admin UI. Refunds are made in the Stripe dashboard; the policy above reacts to them.
