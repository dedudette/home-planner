# Implementation checklist: Paolo expansion, accounts, trial and subscriptions

A living record of the audit that came first, the decisions taken, and where each requirement stands. "Verified" means a test or a
command in this environment showed it. "Unverified" means it needs something this environment does not have (a real Stripe account, an
email provider, a phone). Nothing marked done here is a mock standing in for a finished integration: where a test uses a fake, the
row says so.

## 1. Audit before editing (done)

| Item | Finding |
|---|---|
| Branch and PR | `claude/cleanflow-app-cw6hwb`, draft PR #1 into `main` (created at the first commit because the repository's default branch is the feature branch itself). Never merged; stays draft. |
| Existing product | React 18 + TypeScript + Vite, pure domain code, reducer, `localStorage` repository with validation, two-tab sync, shared planner, rule-based owl tips, AI coach and assistant endpoints (server-side key, provider adapter), reminders and health adapters. 653+ unit tests and eleven browser suites passed at the last commit. |
| Backend before this work | None except the stateless coach/assist handlers and an in-memory limiter. No identities, no database, no billing. |
| Pending work | None uncommitted except the dependency additions made for this brief. |
| Unfinished native work | No `ios/` or `android/` projects are generated. Apple Reminders, alarms and direct Notes writing are not implemented. No native code has run on a device. The mobile AI server address is still unconfigured. See `docs/native-integrations.md`. |
| Native permissions | `@capacitor/local-notifications` adds `SCHEDULE_EXACT_ALARM`, `RECEIVE_BOOT_COMPLETED`, `WAKE_LOCK`, `POST_NOTIFICATIONS`; `@capgo/capacitor-health` adds 24 read and 23 write Health Connect permissions. A release must strip what the app does not use (see native doc). Not done here: there is no manifest yet to strip from. |
| `npm audit` (full tree) | 9 findings (6 moderate, 1 high, 2 critical), **all in development tools**: `vitest`, `vite`, `vite-node`, `@vitest/mocker`, `tinypool`, `esbuild` (test runner and dev server) and `@capacitor/cli` → `xcode` → `uuid` (command line tool). None is in the code that runs in production. |
| `npm audit` (production install) | `npm ci --omit=dev --omit=optional` installs no development tool and `npm audit --omit=dev --omit=optional` reports **0 vulnerabilities** (verified in a clean copy). Better Auth lists `vitest` as an *optional* peer, which is why a plain `--omit=dev` would still pull the test tools: **production installs must use `--omit=dev --omit=optional`** (the deployment doc and the Dockerfile example say so). |
| Decision on the dev-tool findings | Not force-upgraded. The advisories need Vitest 5 and Vite 6+ (breaking) and apply only to a developer's machine running the dev server or the test runner on untrusted input. Revisit as a separate, tested upgrade. |
| Environment constraints | Real PostgreSQL 16 can run here (`scripts/test-db.sh`), so database, row-level security and concurrency tests are real. `api.stripe.com`, email providers, USDA and store APIs are unreachable, so provider tests use a local stand-in server that the **real Stripe SDK** talks to. A stand-in proves our code, not Stripe's behaviour. |

## 2. Decisions

| Topic | Decision |
|---|---|
| Authentication | **Better Auth** (self-hosted, established library, Postgres), not hand-written password code: password hashing, session cookies, email verification, reset, CSRF/origin checks and rate limiting come from the library. Chosen over managed vendors (Supabase/Clerk/Auth0) because it can be exercised for real here, and over writing auth ourselves. No social-login buttons: none is implemented. |
| Database | **PostgreSQL**, SQL migrations checked in (`server/db/migrations`), run by `npm run db:migrate`. The app connects as a non-owner role; row-level security on every user-owned table as defence in depth (server checks come first). |
| Billing | **Stripe Checkout + Customer Portal**, server-side only. Provider-neutral `subscriptions` table so Apple/Google can be added; not implemented (see section 4). |
| Entitlements | One pure function (`src/domain/billing/entitlement.ts`) fed by database facts and the server clock, wrapped by one service every paid endpoint calls. |
| AI included in the subscription | Operator's provider key. Durable per-account ledger in Postgres: reserve → commit/release. Same monthly request allowance for both plans; separate smaller trial allowance; hard per-request size and output caps; never "unlimited". |
| Cloud data | Opt-in, manual "back up to my account" / "restore" of a validated snapshot with a revision check, not silent continuous sync. Private journal and raw health imports are device-only unless the person ticks a specific box. No end-to-end-encryption claim is made. |

## 3. Work items and status

Status key: ✅ verified here · ⚠️ built, needs something external to verify · ⛔ blocked · ⏳ not started

### Commercial layer (brief part B)

| Item | Status | Note |
|---|---|---|
| Plans €25/month and €255/year, exactly 15% off, shared constants and disclosure text | ✅ | `tests/billingPlans.test.ts` |
| Entitlement state machine, per-state access table | ✅ | `tests/entitlement.test.ts`, `docs/billing.md` |
| AI allowance windows (same monthly number for both plans, anchored to subscription start) | ✅ | `tests/usageWindow.test.ts` |
| Database, migrations, row-level security | ⏳ | |
| Accounts: sign-up, email verification, sign-in/out, reset, session expiry, re-authentication, deletion | ⏳ | |
| 14-day trial: once per account (and per email across deletion), server timestamps | ⏳ | |
| Stripe Checkout, Portal, webhooks, reconcile, duplicate guards, refund/dispute policy | ⏳ | fake-provider tests; real sandbox procedure in `docs/billing-sandbox.md` |
| AI usage ledger and gate on every AI endpoint | ⏳ | |
| Notifications with retry and de-duplication | ⏳ | delivery depends on a configured email provider |
| Client: sign-up, gate, pricing, billing, allowance, local-data linking | ⏳ | |
| Mobile billing (Apple/Google) | ⛔ | documented, kept unavailable |

### Paolo expansion (brief part A)

| Milestone | Status |
|---|---|
| 1 Paolo identity, launcher, adaptive conversational onboarding | ⏳ |
| 2 Voice (speech in/out) | ⏳ |
| 3 Nutrition, hydration, reminders | ⏳ |
| 4 Visual exercise and food content | ⏳ |
| 5 Behavioural reflection, wellbeing, learning | ⏳ |
| 6 Native focus blocking and external integrations | ⏳ |

Statuses above are updated at the end of the work (section 5).

## 4. External blockers (stated, not worked around)

- **Stripe account and keys, product and prices, webhook endpoint, portal configuration, tax setup** (test mode first): `docs/billing-sandbox.md`.
- **Tax treatment** is unresolved. €25 and €255 are treated as the intended consumer totals; `BILLING_TAX_MODE` must be set deliberately and production billing refuses to start without it.
- **Email delivery provider** (verification, reset, billing notices). Without one the server says so and nothing is reported as delivered.
- **Apple StoreKit / Google Play Billing** and the stores' current rules for subscriptions unlocking app features, steering to web purchase, and account deletion: not implemented; native builds show no purchase buttons.
- **Apple Family Controls / Device Activity / Managed Settings** need an entitlement approved by Apple; Android app blocking needs Accessibility or Usage Access, restricted by Google Play policy. A website cannot block phone apps.
- **Food composition data** (USDA FoodData Central needs an API key and its licence terms), **licensed exercise/food media**, **Canva** (OAuth app registration), **speech recognition on a real device**.
- **Legal documents** (privacy policy, terms, refund policy, company details): placeholders only; not launch-ready and not claimed to be.

## 5. Final status

Filled in at the end of the work.
