# Deploying the server (accounts mode)

Without `DATABASE_URL` the server is the original single-device app: no sign-in, no subscription, the AI endpoints limited by the in-memory limiter. That mode is for personal use and development. **A public deployment must run accounts mode** (set `REQUIRE_ACCOUNTS=1` so a missing setting stops the server instead of silently serving the app unprotected).

## Requirements
Node 22, PostgreSQL 14+ (tested on 16), HTTPS in front (the server speaks HTTP; terminate TLS at your proxy and set `TRUST_PROXY=1` only if that proxy is yours), an email provider (Resend is implemented), optionally Stripe (test mode first) and an Anthropic key for the AI features.

## Build and install (production)
```
npm ci
npm run build && npm run build:server           # dist/ (the app) and dist-server/node.js
# production image: install WITHOUT development and optional packages
npm ci --omit=dev --omit=optional
node dist-server/node.js
```
`--omit=optional` matters: Better Auth lists the test runner as an optional peer, and a plain `--omit=dev` install would pull in development tools that have known advisories (verified: with both flags `npm audit --omit=dev --omit=optional` reports 0 vulnerabilities).

## Database
Two roles: an **owner** that runs migrations, and a **limited role** the server uses. Create them once (as a database admin):
```sql
create role cleanflow_owner login password '…';
create role cleanflow_app   login password '…';
create database cleanflow owner cleanflow_owner;
```
Then, as the owner:
```
DATABASE_ADMIN_URL=postgres://cleanflow_owner:…@host/cleanflow APP_DB_ROLE=cleanflow_app npm run db:migrate
```
It applies `server/db/migrations/*.sql` in order (each in a transaction, recorded with a checksum; an edited, already-applied migration is refused), then grants table access to the limited role. Because that role does not own the tables, row-level security applies to it. The server's `DATABASE_URL` uses **only** the limited role. Never give the server the owner's credentials.

Backups: use your host's PostgreSQL backups; they contain account data, subscription state and AI usage counts (no meal, journal or health content unless a person chose cloud backup).

## Settings (environment variables; names only are ever logged)
| Variable | Purpose |
|---|---|
| `APP_ORIGIN` | public origin, `https://app.example.com` (cookies, redirects, checkout return, origin checks) |
| `DATABASE_URL` | limited role connection string |
| `BETTER_AUTH_SECRET` | ≥32 random characters; signs sessions (rotating signs everyone out) |
| `TRIAL_CLAIM_SECRET` | ≥32 random characters, **different**; keys the one-trial-per-person record. **Do not rotate** (it would let everyone start a second trial) |
| `NODE_ENV=production` | secure cookies; requires https `APP_ORIGIN` and a real mail provider |
| `MAIL_PROVIDER`, `RESEND_API_KEY`, `MAIL_FROM` | `resend` in production; `console` (prints, delivers nothing) only in development |
| `AI_TRIAL_ALLOWANCE`, `AI_MONTHLY_ALLOWANCE`, `PAST_DUE_GRACE_DAYS` | defaults 50, 300, 3 (see docs/billing.md for the cost reasoning) |
| `ANTHROPIC_API_KEY`, `COACH_MODEL`, … | as in the README (AI) |
| `STRIPE_*`, `BILLING_*` | see `server/billing/config.ts` and `docs/billing-sandbox.md` |
| `LEGAL_PRIVACY_URL`, `LEGAL_TERMS_URL`, `LEGAL_BILLING_URL`, `LEGAL_COMPANY_NAME` | shown in the app; unset means the app says they are not available |
| `TRUST_PROXY=1` | use the last `X-Forwarded-For` hop as the client address (rate limits); only behind your own proxy |

Generate secrets with `openssl rand -base64 48`. Put them in your host's secret store, not in Git, not in the client, not in a command line you keep in shell history.

## Start-up behaviour
- Invalid or missing account settings: the server prints the **names** of the offending variables and exits with status 1.
- Billing misconfigured (bad key, price mismatch, tax unset): the app still runs; checkout is off and says why; nothing is charged.
- A tick every minute releases stale AI reservations and runs the notification queue. It is safe to run on several instances at once.

## Not included
No admin UI, no Apple/Google billing, no deployment automation, no monitoring or alerting. Rate limits for sign-in and email endpoints are stored in the database (shared by instances); the AI cooldown is per instance, and the AI allowance is in the database.
