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
| Entitlement state machine, per-state access table, offline policy | ✅ | `tests/entitlement.test.ts`, `docs/billing.md` |
| AI allowance windows (same monthly number for both plans, anchored to subscription start) | ✅ | `tests/usageWindow.test.ts` |
| Database, migrations (checksummed), per-account row-level security | ✅ | real PostgreSQL: `tests/db/rls.test.ts` |
| Accounts: sign-up, email verification, sign-in/out, reset, session expiry, deletion with password | ✅ | real Better Auth + PostgreSQL: `tests/db/accounts.test.ts` |
| 14-day trial: once per person (email HMAC survives deletion), server clock, no client input | ✅ | same file |
| AI usage ledger (reserve/commit/release, concurrency) and the gate on coach and assistant | ✅ | `tests/db/ledger.test.ts`, `tests/db/aiGate.test.ts` |
| Stripe Checkout, Portal, cancel/resume, webhooks, reconcile, duplicate guards, refund/dispute policy | ✅ fake provider only | real Stripe SDK against a local stand-in (`tests/db/billing.test.ts`); **never run against Stripe itself** |
| Notifications: queue, de-duplication, retry, honest status | ✅ fake provider only | delivery needs a configured email provider; Resend adapter not run live |
| Stripe setup script (product, prices, portal) | ✅ against the stand-in only | `tests/billingSetup.test.ts` |
| Optional cloud backup endpoints (opt-in, private parts stripped server-side, revision check) | ✅ | `tests/db/backup.test.ts`. Issue #6 found and fixed two defects here (revision numbers reused after a deletion; two first uploads at once both accepted), each with a test that failed first: `docs/data-and-backup.md` |
| Per-account namespacing of device storage keys (plan, backups, timer, workout, onboarding, schedule) | ✅ | unit tests; with the auth UI in place the local-mode browser suites flow, integrity, sync and responsive were re-run and pass (local mode keeps the original keys) |
| Client API module for the above | ✅ | `src/account/api.ts` (the auth, billing and backup calls are all used by screens now) |
| **Authentication UI** (issue #3): sign-up, sign-in, email confirmation, forgot/reset password, sign-out, account settings (change password, delete account), loading/validation/error states, responsive and accessible; local-only mode and existing data preserved | ✅ | unit tests `tests/account*.test.ts`; browser suite `npm run e2e:accounts` (real API, real PostgreSQL, a mailbox instead of an email provider) |
| **Trial activation & pricing UI** (issue #4): `#/account` "Trial & plans": explicit 14-day trial start (tick box + button, server decides eligibility and dates), server-provided start/end and days left, pricing selector with the exact €25 / €255 terms and the full charge stated before checkout, checkout cancel/return handling that never infers payment from the redirect, clear local-mode and unavailable-provider states | ✅ against the real API and PostgreSQL; checkout flow against a **mock provider** only | unit tests `tests/accountPlanView.test.ts`, `tests/accountBillingReturn.test.ts`, `tests/accountErrors.test.ts`; contract test `tests/db/accountContract.test.ts`; browser suite `npm run e2e:plans` (mock provider = `tests/support/fakeStripe.ts`, never Stripe). Stacked on PR #8 (issue #3). |
| **Subscription management & AI allowance UI** (issue #5): on `#/account` "Trial & plans": current plan, status, price and renewal/end date; the provider's billing portal created by the server; cancel at period end (with an exact-date confirmation) and resume; screens and next actions for payment-action-required, past-due (grace and after), unpaid, dispute, refund, cancelled/expired and trial-expired; the real AI allowance (limit, used, remaining, reset date) with the same monthly number for both paid plans; export and account deletion always shown, including after expiry | ✅ against the real API and PostgreSQL; every payment-provider interaction against a **mock provider** (the real Stripe SDK talking to a local stand-in) | unit tests `tests/accountSubscriptionView.test.ts`, `tests/accountErrors.test.ts`; PostgreSQL contract test `tests/db/subscriptionContract.test.ts`; browser suite `npm run e2e:subscription`. **Not verified against Stripe itself** (needs a Stripe test account: `docs/billing-sandbox.md`) |
| **Local-data linking & optional cloud backup UI** (issue #6): `#/account/data` "Data & backup": what is device-only and what is backed up; preview of the earlier data, then an explicit copy into the account with restore points kept first, never silently replacing an account's plan, undo, second-account warning, interrupted-copy explanation; manual backup with the journal and health readings off by default as separate choices, an exact upload preview, revision conflicts with side-by-side choices, restore that never wipes a private part that was not in the backup, delete/revoke, loading/empty/error states, expiry handling | ✅ against the real API, PostgreSQL and a real browser; failures are **simulated** (aborted requests, refused storage writes, seeded crash states) | `docs/data-and-backup.md`; unit tests `tests/backupPlan.test.ts`, `tests/accountLink.test.ts`, `tests/accountCloudBackup.test.ts`, `tests/accountErrors.test.ts`; PostgreSQL `tests/db/backup.test.ts`, `tests/db/backupContract.test.ts`; browser suite `npm run e2e:backup`. Needs no payment provider. Stacked on PR #10 (issue #5) → #9 → #8 |
| Client: subscription gate (UI) | ⏳ **not started, and a release blocker** | see "Release blockers carried forward" below |
| Server docs (billing, sandbox procedure, deployment) | ✅ drafted | README and PR #1 description not yet updated |
| Mobile billing (Apple/Google) | ⛔ | documented, no purchase buttons planned in native |

### Paolo expansion (brief part A)

| Milestone | Status |
|---|---|
| 1 Paolo identity, launcher, adaptive conversational onboarding | ⏳ not started |
| 2 Voice (speech in/out) | ⏳ not started |
| 3 Nutrition, hydration, reminders | ⏳ not started |
| 4 Visual exercise and food content | ⏳ not started |
| 5 Behavioural reflection, wellbeing, learning | ⏳ not started |
| 6 Native focus blocking and external integrations | ⏳ not started |

## Release blockers carried forward (not resolved by issue #6)

- **The account UI does not yet restrict planner access after the entitlement ends.** An account whose trial has expired, or whose subscription has ended, can still open and use the planner in the browser. The server already withholds the paid, server-side parts (AI, cloud backup uploads; entitlement answers are the same everywhere), and the Trial & plans, Data & backup, export and deletion screens stay reachable by design, but **nothing in the interface gates the planner itself.** The planner's data and logic live in the browser, so a gate there is an interface rule, not a security boundary (`docs/billing.md`, "Which checks are enforced by the server"). This is **not implemented in issue #6** (linking and backup do not need it), and the paid-access system **must not be described as complete** until it is built and tested, with the policy for what an expired account may still do decided first (read-only? export only?).
- Everything under "External blockers" below still applies (Stripe account and keys, tax treatment, email provider, store billing, legal documents). Nothing in this repository has been run against Stripe itself.

## Test status

Recorded when issue #6 was built (branch `claude/issue-6-data-linking-backup`, Saturday 2026-10-17, real clock). The integrity suite has known failures that are **not** produced by this work; they are listed with the evidence so issue #7 can decide, not assumed to be harmless.

| Check | Result |
|---|---|
| `npx tsc --noEmit` | passes |
| `npx vitest run` (unit; database suites skip without PostgreSQL) | 1,261 passed, 115 skipped (55 files passed, 8 skipped) |
| `sh scripts/test-db.sh run npx vitest run tests/db` (real PostgreSQL 16) | 120 passed in 9 files (includes `backup.test.ts` 12 and `backupContract.test.ts` 8) |
| `npm run build` | passes |
| `npm run e2e:backup` (new) | PASSED, 261 checks |
| `npm run e2e:accounts` / `e2e:plans` / `e2e:subscription` / `e2e:standalone` | PASSED (284 / 82 / 232 / 5 checks) |
| local-mode suites `flow` / `sync` / `responsive` / `behaviour` / `coach` / `sections` / `meals` / `learning` / `assist` | PASSED (45 / 41 / 504 / 44 / 191 / 250 / 274 / 350 / 186 checks) |
| `integrity.mjs` | **FAILED (4)**, 173 checks passed. Same four checks, same observed values, **before and after** this work (baseline run at the start of the issue on commit `5ffdc71`, final run on this branch) |
| `movement.mjs` | **FAILED (1)**, 497 checks passed. The same single check fails on a clean checkout of `5ffdc71` (a separate worktree and dev server), so it is not caused by this work |

**Integrity: what was measured.** All four failures are the check "the week shows its promise for each planned day" (section 10, `seen >= 3`). The week tab lists the Monday-anchored calendar week and shows days before today as "Free", so the number of planned days left in it is 7 minus the days already gone. A probe that ran the first of the suite's four scenarios (Student demo, 7 days a week, 10 minutes) with the browser clock fixed at 10:00 on each day of 12-18 October 2026 saw 7, 6, 5, 4, 3, 2 and 1 planned days for Monday to Sunday (and 2 with the real clock on Saturday). With the code as it stands the check therefore passes Monday to Friday and fails on Saturday and Sunday; the real-clock failures of all four scenarios show the same two trailing planned days. That is a measurement, not a diagnosis of what is right: either the suite should fix its clock the way sections 6, 11 and 12 do (`page.clock.setFixedTime`), or listing earlier days of the current week as "Free" is itself something to change in the product. **Left for issue #7; the assertion was not changed.**

**Movement: what was measured.** The failing check ("an empty week says nothing was logged, not zero", `tests/e2e/movement.mjs` around lines 169-173) reads the page text immediately after a `reload()` followed by a `goto` that only changes the hash. A probe that read the page at that moment got an empty string (the app had not rendered `main` yet); with a short wait before reading, the same check passed and the whole suite passed (`MOVEMENT: PASSED`). It failed three out of three runs here, on this branch and on the baseline commit. This is a missing wait in the suite, not a product fault, so far as the probe shows. **Left for issue #7; the suite was not changed.**

**Not run against anything real:** there is no payment provider, mail provider, store or phone in this feature's tests; no result here says anything about Stripe or a device. Failures in the browser suite (network, storage, a crash in the middle of a copy) are simulated as `docs/data-and-backup.md` describes.

## 4. External blockers (stated, not worked around)

- **Stripe account and keys, product and prices, webhook endpoint, portal configuration, tax setup** (test mode first): `docs/billing-sandbox.md`.
- **Tax treatment** is unresolved. €25 and €255 are treated as the intended consumer totals; `BILLING_TAX_MODE` must be set deliberately and production billing refuses to start without it.
- **Email delivery provider** (verification, reset, billing notices). Without one the server says so and nothing is reported as delivered.
- **Apple StoreKit / Google Play Billing** and the stores' current rules for subscriptions unlocking app features, steering to web purchase, and account deletion: not implemented; native builds show no purchase buttons.
- **Apple Family Controls / Device Activity / Managed Settings** need an entitlement approved by Apple; Android app blocking needs Accessibility or Usage Access, restricted by Google Play policy. A website cannot block phone apps.
- **Food composition data** (USDA FoodData Central needs an API key and its licence terms), **licensed exercise/food media**, **Canva** (OAuth app registration), **speech recognition on a real device**.
- **Legal documents** (privacy policy, terms, refund policy, company details): placeholders only; not launch-ready and not claimed to be.

## 5. Checkpoint status

Issue #6 (branch `claude/issue-6-data-linking-backup`, draft PR into `claude/issue-5-subscription-ui`, itself stacked on #10 → #9 → #8 → `claude/cleanflow-app-cw6hwb`) added the Data & backup screen. Nothing is merged. Still not built: the subscription gate for the planner (release blocker above), the end-to-end browser and accessibility pass and final documentation (issue #7), and the Paolo milestones.

After the server side of Part B (paused by request), the authentication screens were added (issue #3, branch `claude/issue-3-auth-ui`, draft PR into `claude/cleanflow-app-cw6hwb`). Nothing is merged. Accounts mode now has working sign-up, sign-in, confirmation, reset and account settings in the browser, but **no subscription gate, pricing or billing screens yet**, so it is not sandbox-ready for people. Local mode (no `DATABASE_URL`) is unchanged.
