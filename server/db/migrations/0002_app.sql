-- Product tables: trial, billing, entitlements inputs, AI usage ledger, notifications, optional cloud backup.
-- Every table that holds one person's rows carries user_id and has row-level security: a request-scoped transaction sees only its own
-- rows (set by `withUser`), and server jobs (webhooks, sweeps) use `withSystem`. RLS is defence in depth behind the application's own
-- checks, not a replacement for them, and it does not stop a compromised server process that can call `withSystem`.

-- One 14-day trial per person. The key is an HMAC of the normalised email (never the email itself), so the claim outlives account
-- deletion: deleting and re-registering with the same email does not earn a second trial. user_id is cleared on deletion.
create table trial_claims (
  email_hash text primary key,
  user_id text unique references "user" ("id") on delete set null,
  started_at timestamptz not null,
  ends_at timestamptz not null,
  check (ends_at > started_at)
);

create table billing_customers (
  user_id text primary key references "user" ("id") on delete cascade,
  provider text not null default 'stripe' check (provider in ('stripe')),
  provider_customer_id text not null unique,
  created_at timestamptz not null default now()
);

-- Provider-neutral: Stripe today; the apple and google values are reserved for store billing, which is not implemented.
create table subscriptions (
  id bigserial primary key,
  user_id text not null references "user" ("id") on delete cascade,
  provider text not null check (provider in ('stripe', 'apple', 'google')),
  provider_subscription_id text not null,
  plan text not null check (plan in ('monthly', 'annual')),
  status text not null check (status in ('active', 'past_due', 'unpaid', 'incomplete', 'canceled', 'incomplete_expired', 'paused')),
  started_at timestamptz not null,
  current_period_start timestamptz not null,
  current_period_end timestamptz not null,
  cancel_at_period_end boolean not null default false,
  canceled_at timestamptz,
  suspended_reason text check (suspended_reason in ('dispute', 'refund')),
  amount_cents integer not null check (amount_cents > 0),
  currency text not null,
  updated_at timestamptz not null default now(),
  unique (provider, provider_subscription_id)
);
-- At most one live subscription per person, across providers: a second one cannot be recorded, so a duplicate cannot grant access twice.
create unique index subscriptions_one_live_per_user on subscriptions (user_id) where status in ('active', 'past_due', 'unpaid', 'incomplete', 'paused');

-- Checkout sessions we created. At most one open per person, so a double click or a second tab reuses it instead of creating another.
create table checkout_sessions (
  id text primary key,
  user_id text not null references "user" ("id") on delete cascade,
  plan text not null check (plan in ('monthly', 'annual')),
  status text not null check (status in ('open', 'completed', 'expired')),
  url text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create unique index checkout_one_open_per_user on checkout_sessions (user_id) where status = 'open';

-- Webhook deliveries already seen. Holds ids and outcomes only, never the payload.
create table billing_events (
  provider text not null,
  event_id text not null,
  type text not null,
  status text not null check (status in ('processing', 'processed', 'failed', 'ignored')),
  attempts integer not null default 1,
  error_code text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  primary key (provider, event_id)
);

-- Provider customers whose account was deleted, so a late event for them is recognised and ignored. No personal data.
create table deleted_billing_customers (
  provider_customer_id text primary key,
  deleted_at timestamptz not null default now()
);

-- AI allowance. A counter row per account and window; a ledger row per request. A request reserves before the provider is called.
create table ai_usage_counters (
  user_id text not null references "user" ("id") on delete cascade,
  window_key text not null,
  window_end timestamptz not null,
  used integer not null default 0 check (used >= 0),
  reserved integer not null default 0 check (reserved >= 0),
  primary key (user_id, window_key)
);
create table ai_usage_ledger (
  request_id text primary key,
  user_id text not null,
  window_key text not null,
  feature text not null,
  state text not null check (state in ('reserved', 'committed', 'released')),
  units integer not null default 1 check (units > 0),
  input_tokens integer,
  output_tokens integer,
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  foreign key (user_id, window_key) references ai_usage_counters (user_id, window_key) on delete cascade
);
create index ai_usage_ledger_stale on ai_usage_ledger (created_at) where state = 'reserved';

-- Email and similar notices. `status` says what really happened: pending, sent (the provider accepted it), simulated (no provider is
-- configured: nothing left the server), failed (will be retried) or dead (gave up).
create table notifications (
  id bigserial primary key,
  user_id text not null references "user" ("id") on delete cascade,
  kind text not null,
  dedupe_key text not null unique,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'sent', 'simulated', 'failed', 'dead')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error_code text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index notifications_due on notifications (next_attempt_at) where status in ('pending', 'failed');

-- Optional cloud backup of the person's plan data. Off unless they choose it; `includes` records exactly which sections they chose.
create table user_backups (
  user_id text primary key references "user" ("id") on delete cascade,
  revision integer not null check (revision > 0),
  snapshot jsonb not null,
  includes jsonb not null default '[]'::jsonb,
  schema_version integer,
  size_bytes integer not null,
  updated_at timestamptz not null default now()
);

-- Row-level security: a person's rows for a person-scoped transaction; everything for a system transaction.
do $$
declare t text;
begin
  foreach t in array array['trial_claims', 'billing_customers', 'subscriptions', 'checkout_sessions', 'ai_usage_counters', 'ai_usage_ledger', 'notifications', 'user_backups'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format($p$create policy own_rows on %I using (user_id = nullif(current_setting('app.user_id', true), '') or current_setting('app.system', true) = 'on') with check (user_id = nullif(current_setting('app.user_id', true), '') or current_setting('app.system', true) = 'on')$p$, t);
  end loop;
  foreach t in array array['billing_events', 'deleted_billing_customers'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format($p$create policy system_only on %I using (current_setting('app.system', true) = 'on') with check (current_setting('app.system', true) = 'on')$p$, t);
  end loop;
end $$;
