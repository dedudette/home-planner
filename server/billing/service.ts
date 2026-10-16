import Stripe from 'stripe';
import type { PoolClient } from 'pg';
import type { AccountView } from '../../src/domain/billing/account';
import type { SubscriptionStatus } from '../../src/domain/billing/entitlement';
import { PLAN_IDS, PLANS, isPlanId, planDisclosure, type PlanId } from '../../src/domain/billing/plans';
import type { SessionUser } from '../auth/auth';
import { withSystem, withUser, type Db } from '../db/pool';
import { fail, json, readJson } from '../http';
import type { Mailer } from '../mail/mailer';
import type { EntitlementService } from './entitlements';
import type { BillingConfig } from './config';
import { deliverDue, enqueue, sweepCalendar } from './notifications';
import type { BillingService, BillingStatusInfo } from './types';

/**
 * Stripe Checkout and Customer Portal, server side. The rules this file keeps:
 *
 *  - The browser names a plan ("monthly" or "annual"), never a price, an amount, a customer or an entitlement. The server maps the name
 *    to the Price id from its own configuration, and has checked at start-up that the price really is €25/month or €255/year, EUR.
 *  - Access never comes from a redirect. The success URL only asks the server to look; the server asks Stripe, and the subscription
 *    record (and so the entitlement) changes only when Stripe says the subscription is active.
 *  - Every webhook is verified against its signature over the exact bytes, its id is stored before it is acted on, and it is acted on
 *    by fetching the CURRENT subscription from Stripe, so a retried, duplicated or out-of-order event cannot move the record backwards.
 *  - One live subscription per person, enforced three ways: a check before checkout, one open checkout per person, and a unique index.
 *  - Nothing about the person's plan, meals, journal, health or conversations is ever sent to Stripe: only an email address, an opaque
 *    account id, and the plan name.
 *
 * Refund and dispute policy (documented in docs/billing.md): a full refund ends access and cancels the subscription; an open dispute
 * pauses access until it is decided; a dispute won or closed as an inquiry restores it; a dispute lost ends it. A partial refund changes
 * nothing.
 */
export interface BillingDeps {
  db: Db;
  config: BillingConfig;
  appOrigin: string;
  stripe: Stripe;
  mailer: Mailer;
  entitlements: EntitlementService;
  /** The account view the app shows after an action. */
  accountView: (user: SessionUser) => Promise<AccountView | null>;
  now: () => Date;
  log: (e: { event: string; code?: string }) => void;
}

const SYNC_COOLDOWN_MS = 2_000;
const TOLERANCE_SECONDS = 300;
const IN_FLIGHT_MS = 5 * 60_000;

export const mapStatus = (s: string): SubscriptionStatus => {
  switch (s) {
    case 'active': case 'past_due': case 'unpaid': case 'incomplete': case 'incomplete_expired': case 'canceled': case 'paused': return s;
    // "trialing" is not something this product creates (its trial is its own, without a card). A subscription that arrives that way, or
    // with a status this code has never heard of, is treated as not paid: no access until a status it understands says otherwise.
    default: return 'paused';
  }
};

interface Record_ {
  providerId: string;
  customerId: string;
  plan: PlanId;
  status: SubscriptionStatus;
  startedAt: Date;
  periodStart: Date;
  periodEnd: Date;
  cancelAtPeriodEnd: boolean;
  canceledAt: Date | null;
  amountCents: number;
  currency: string;
}

type Outcome = { ok: true; userId: string; record: Record_ } | { ok: false; code: string };

const errorCode = (e: unknown): string => {
  if (e instanceof Stripe.errors.StripeConnectionError) return 'stripe-unreachable';
  if (e instanceof Stripe.errors.StripeAuthenticationError) return 'stripe-auth';
  if (e instanceof Stripe.errors.StripeRateLimitError) return 'stripe-rate-limit';
  if (e instanceof Stripe.errors.StripeInvalidRequestError) return `stripe-invalid-${(e as { code?: string }).code ?? (e as { statusCode?: number }).statusCode ?? 'request'}`;
  if (e instanceof Stripe.errors.StripeError) return 'stripe-error';
  return (e as { code?: string })?.code ?? 'exception';
};
const isMissing = (e: unknown): boolean => e instanceof Stripe.errors.StripeInvalidRequestError && ((e as { statusCode?: number }).statusCode === 404 || (e as { code?: string }).code === 'resource_missing');

export const createBillingService = (d: BillingDeps): BillingService & { verifyPrices(): Promise<BillingStatusInfo>; reconcileSubscription(sub: Stripe.Subscription): Promise<Outcome> } => {
  const { db, stripe, config, log } = d;
  const priceIds: Record<PlanId, string> = { monthly: config.priceMonthly, annual: config.priceAnnual };
  const planOfPrice = (id: string): PlanId | null => (PLAN_IDS.find((p) => priceIds[p] === id) ?? null);
  let verified: { ok: boolean; reason: string | null; at: number } = { ok: false, reason: 'checking', at: 0 };
  let verifying: Promise<BillingStatusInfo> | null = null;
  const lastSync = new Map<string, number>();

  const info = (): BillingStatusInfo => ({ available: verified.ok, reason: verified.reason, mode: config.env });

  // ---- configuration check ---------------------------------------------------------------------------------------------------------
  const verifyPrices = (): Promise<BillingStatusInfo> => {
    if (verifying) return verifying;
    verifying = (async () => {
      try {
        for (const plan of PLAN_IDS) {
          const p = await stripe.prices.retrieve(priceIds[plan]);
          const want = PLANS[plan];
          const bad =
            !p.active ? 'inactive'
            : p.currency !== 'eur' ? 'currency'
            : p.unit_amount !== want.cents ? 'amount'
            : p.type !== 'recurring' || p.recurring?.interval !== want.interval || (p.recurring?.interval_count ?? 1) !== 1 ? 'interval'
            : (p.recurring?.usage_type ?? 'licensed') !== 'licensed' ? 'usage-type'
            : config.taxMode === 'stripe_tax_inclusive' && p.tax_behavior !== 'inclusive' ? 'tax-behavior'
            : null;
          if (bad) { verified = { ok: false, reason: `price-mismatch:${plan}:${bad}`, at: d.now().getTime() }; log({ event: 'billing.config', code: verified.reason! }); return info(); }
        }
        verified = { ok: true, reason: null, at: d.now().getTime() };
      } catch (e) {
        verified = { ok: false, reason: e instanceof Stripe.errors.StripeAuthenticationError ? 'stripe-auth' : 'stripe-unreachable', at: d.now().getTime() };
        log({ event: 'billing.config', code: verified.reason! });
      }
      return info();
    })().finally(() => { verifying = null; });
    return verifying;
  };

  // ---- subscription records --------------------------------------------------------------------------------------------------------
  const toRecord = (sub: Stripe.Subscription): { ok: true; r: Record_ } | { ok: false; code: string } => {
    const items = sub.items?.data ?? [];
    if (items.length !== 1) return { ok: false, code: 'unexpected-items' };
    const item = items[0];
    const plan = planOfPrice(item.price.id);
    if (!plan) return { ok: false, code: 'unknown-price' };
    if (item.price.currency !== 'eur' || item.price.unit_amount !== PLANS[plan].cents || (item.quantity ?? 1) !== 1) return { ok: false, code: 'price-mismatch' };
    const periodEnd = new Date(item.current_period_end * 1000);
    const scheduled = sub.cancel_at_period_end || (sub.cancel_at != null && sub.cancel_at <= item.current_period_end);
    return {
      ok: true,
      r: {
        providerId: sub.id,
        customerId: typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
        plan,
        status: mapStatus(sub.status),
        startedAt: new Date(sub.start_date * 1000),
        periodStart: new Date(item.current_period_start * 1000),
        periodEnd,
        cancelAtPeriodEnd: scheduled,
        canceledAt: sub.canceled_at ? new Date(sub.canceled_at * 1000) : null,
        amountCents: PLANS[plan].cents,
        currency: 'eur',
      },
    };
  };

  const userForCustomer = async (c: PoolClient, customerId: string): Promise<{ userId: string } | { ignored: string }> => {
    const r = await c.query('select user_id from billing_customers where provider_customer_id = $1', [customerId]);
    if (r.rowCount) return { userId: r.rows[0].user_id };
    const gone = await c.query('select 1 from deleted_billing_customers where provider_customer_id = $1', [customerId]);
    return { ignored: gone.rowCount ? 'deleted-customer' : 'unknown-customer' };
  };

  /** Records the subscription as Stripe currently has it. This is the only place a subscription row is written from the provider. */
  const reconcileSubscription = async (sub: Stripe.Subscription): Promise<Outcome> => {
    const parsed = toRecord(sub);
    if (!parsed.ok) { log({ event: 'billing.rejected', code: parsed.code }); return { ok: false, code: parsed.code }; }
    const r = parsed.r;
    const now = d.now();
    let duplicateOf: string | null = null;
    const outcome = await withSystem(db, async (c): Promise<Outcome> => {
      const who = await userForCustomer(c, r.customerId);
      if ('ignored' in who) return { ok: false, code: who.ignored };
      const userId = who.userId;
      const before = await c.query('select status, cancel_at_period_end from subscriptions where provider = $1 and provider_subscription_id = $2 for update', ['stripe', r.providerId]);
      await c.query('savepoint upsert');
      try {
        await c.query(
          `insert into subscriptions (user_id, provider, provider_subscription_id, plan, status, started_at, current_period_start, current_period_end, cancel_at_period_end, canceled_at, amount_cents, currency, updated_at)
           values ($1, 'stripe', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           on conflict (provider, provider_subscription_id) do update set plan = excluded.plan, status = excluded.status, current_period_start = excluded.current_period_start,
             current_period_end = excluded.current_period_end, cancel_at_period_end = excluded.cancel_at_period_end, canceled_at = excluded.canceled_at,
             amount_cents = excluded.amount_cents, currency = excluded.currency, updated_at = excluded.updated_at`,
          [userId, r.providerId, r.plan, r.status, r.startedAt, r.periodStart, r.periodEnd, r.cancelAtPeriodEnd, r.canceledAt, r.amountCents, r.currency, now]);
      } catch (e) {
        await c.query('rollback to savepoint upsert');
        if ((e as { code?: string }).code === '23505' && /one_live_per_user/.test((e as { constraint?: string }).constraint ?? '')) { duplicateOf = r.providerId; return { ok: false, code: 'duplicate-subscription' }; }
        throw e;
      }
      const prev = before.rows[0] as { status: string; cancel_at_period_end: boolean } | undefined;
      if (r.status === 'active' && (!prev || prev.status === 'incomplete')) await enqueue(c, userId, 'subscription-started', `sub-started:${r.providerId}`, { plan: r.plan }, now);
      if (r.status === 'active' && r.cancelAtPeriodEnd && !(prev?.cancel_at_period_end)) await enqueue(c, userId, 'cancellation-scheduled', `cancel:${r.providerId}:${r.periodEnd.toISOString()}`, { plan: r.plan, periodEnd: r.periodEnd.toISOString() }, now);
      if (r.status === 'canceled' && prev && prev.status !== 'canceled') await enqueue(c, userId, 'access-ended', `ended:${r.providerId}`, { plan: r.plan }, now);
      await c.query(`update checkout_sessions set status = 'completed' where user_id = $1 and status = 'open' and $2::text in ('active', 'past_due', 'unpaid')`, [userId, r.status]);
      return { ok: true, userId, record: r };
    });
    if (duplicateOf) {
      // A second live subscription cannot be recorded, so it grants nothing. Stop it billing; the money already taken is refunded by hand.
      log({ event: 'billing.duplicate-subscription', code: 'cancelled-at-provider' });
      await stripe.subscriptions.cancel(duplicateOf, { prorate: true, invoice_now: false }).catch((e) => log({ event: 'billing.error', code: errorCode(e) }));
    }
    return outcome;
  };

  const fetchSubscription = async (id: string): Promise<Stripe.Subscription | null> => {
    try { return await stripe.subscriptions.retrieve(id); } catch (e) { if (isMissing(e)) return null; throw e; }
  };

  const ownedLiveSubscription = async (userId: string): Promise<{ providerId: string; customerId: string | null } | null> =>
    withUser(db, userId, async (c) => {
      const s = await c.query(`select provider_subscription_id from subscriptions where user_id = $1 and provider = 'stripe' and status in ('active','past_due','unpaid','incomplete','paused') limit 1`, [userId]);
      if (!s.rowCount) return null;
      const cu = await c.query('select provider_customer_id from billing_customers where user_id = $1', [userId]);
      return { providerId: s.rows[0].provider_subscription_id, customerId: cu.rows[0]?.provider_customer_id ?? null };
    });

  const ensureCustomer = async (user: SessionUser): Promise<string> => {
    const have = await withUser(db, user.id, (c) => c.query('select provider_customer_id from billing_customers where user_id = $1', [user.id]));
    if (have.rowCount) return have.rows[0].provider_customer_id;
    // The idempotency key makes a double click create one customer, not two. Only an email address and an opaque account id go to Stripe.
    const created = await stripe.customers.create({ email: user.email, metadata: { user_id: user.id } }, { idempotencyKey: `cleanflow-customer-${user.id}` });
    await withUser(db, user.id, (c) => c.query(`insert into billing_customers (user_id, provider, provider_customer_id) values ($1, 'stripe', $2) on conflict (user_id) do nothing`, [user.id, created.id]));
    const r = await withUser(db, user.id, (c) => c.query('select provider_customer_id from billing_customers where user_id = $1', [user.id]));
    return r.rows[0].provider_customer_id;
  };

  // ---- checkout --------------------------------------------------------------------------------------------------------------------
  const createCheckout = async (user: SessionUser, planRaw: unknown): Promise<Response> => {
    if (!isPlanId(planRaw)) return fail(400, 'invalid-plan', 'Choose the monthly or the annual plan.');
    const plan = planRaw;
    const status = await (verified.ok ? Promise.resolve(info()) : verifyPrices());
    if (!status.available) return fail(503, 'billing-unavailable', 'Subscriptions are not available just now. Nothing was charged.');
    const view = await d.entitlements.get(user.id, d.now());
    if (!view) return fail(401, 'unauthenticated', 'Sign in to continue.');
    if (!view.entitlement.canSubscribe && view.facts.subscription && view.facts.subscription.status !== 'incomplete') {
      return fail(409, 'already-subscribed', 'You already have a subscription. You can manage it from the billing page.', { state: view.entitlement.state });
    }
    const customer = await ensureCustomer(user);

    const open = await withUser(db, user.id, (c) => c.query(`select id, plan from checkout_sessions where user_id = $1 and status = 'open'`, [user.id]));
    if (open.rowCount) {
      const row = open.rows[0] as { id: string; plan: PlanId };
      let existing: Stripe.Checkout.Session | null = null;
      try { existing = await stripe.checkout.sessions.retrieve(row.id); } catch (e) { if (!isMissing(e)) throw e; }
      if (existing?.status === 'complete') {
        // Paid in another tab and the notice has not arrived yet: record it now instead of starting a second checkout.
        if (typeof existing.subscription === 'string') { const s = await fetchSubscription(existing.subscription); if (s) await reconcileSubscription(s); }
        return fail(409, 'already-subscribed', 'Your subscription is already active.');
      }
      if (existing?.status === 'open' && row.plan === plan && existing.url) return json(200, { ok: true, url: existing.url, resumed: true });
      if (existing?.status === 'open') await stripe.checkout.sessions.expire(row.id).catch(() => undefined);   // a different plan was chosen: the old one is closed
      await withUser(db, user.id, (c) => c.query(`update checkout_sessions set status = 'expired' where id = $1 and status = 'open'`, [row.id]));
    }

    const now = d.now();
    const session = await stripe.checkout.sessions.create(
      {
        mode: 'subscription',
        customer,
        client_reference_id: user.id,
        line_items: [{ price: priceIds[plan], quantity: 1 }],
        success_url: `${d.appOrigin}/?billing=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${d.appOrigin}/?billing=cancelled`,
        metadata: { user_id: user.id, plan },
        subscription_data: { metadata: { user_id: user.id, plan } },
        allow_promotion_codes: false,
        locale: 'auto',
        expires_at: Math.floor(now.getTime() / 1000) + 3600,
        // The exact terms, in Stripe's own payment page, next to the pay button.
        custom_text: { submit: { message: planDisclosure(plan) } },
        ...(config.taxMode === 'stripe_tax_inclusive' ? { automatic_tax: { enabled: true }, customer_update: { address: 'auto' as const } } : {}),
      },
      { idempotencyKey: `cleanflow-checkout-${user.id}-${plan}-${Math.floor(now.getTime() / 60_000)}` },
    );
    try {
      await withUser(db, user.id, (c) => c.query(`insert into checkout_sessions (id, user_id, plan, status, url, expires_at) values ($1, $2, $3, 'open', $4, $5)`, [session.id, user.id, plan, session.url, new Date(session.expires_at * 1000)]));
    } catch (e) {
      if ((e as { code?: string }).code !== '23505') throw e;
      // Two requests raced: another one's session is the open one. If it is this very session (same idempotency key) use it; else close ours.
      const winner = await withUser(db, user.id, (c) => c.query(`select id, url from checkout_sessions where user_id = $1 and status = 'open'`, [user.id]));
      if (winner.rows[0]?.id !== session.id) await stripe.checkout.sessions.expire(session.id).catch(() => undefined);
      return json(200, { ok: true, url: winner.rows[0]?.url ?? session.url, resumed: true });
    }
    log({ event: 'billing.checkout-created', code: plan });
    return json(200, { ok: true, url: session.url, resumed: false });
  };

  // ---- sync after returning from checkout ------------------------------------------------------------------------------------------
  const sync = async (user: SessionUser, sessionId: unknown): Promise<Response> => {
    const last = lastSync.get(user.id) ?? 0;
    if (d.now().getTime() - last < SYNC_COOLDOWN_MS) return fail(429, 'slow-down', 'One moment, then check again.', {}, { 'retry-after': '2' });
    lastSync.set(user.id, d.now().getTime());
    if (lastSync.size > 5_000) lastSync.delete(lastSync.keys().next().value as string);
    const own = await withUser(db, user.id, (c) => c.query('select provider_customer_id from billing_customers where user_id = $1', [user.id]));
    const customerId = own.rows[0]?.provider_customer_id as string | undefined;
    if (!customerId) return json(200, { ok: true, pending: false, account: await d.accountView(user) });
    let pending = false;
    if (typeof sessionId === 'string' && /^cs_[A-Za-z0-9_]+$/.test(sessionId)) {
      const s = await stripe.checkout.sessions.retrieve(sessionId).catch((e) => { if (isMissing(e)) return null; throw e; });
      // The session must be this person's: created for their account id and billed to their customer.
      const sameCustomer = s && (typeof s.customer === 'string' ? s.customer : s.customer?.id) === customerId;
      if (!s || s.client_reference_id !== user.id || !sameCustomer) return fail(404, 'unknown-session', 'That checkout was not found for your account.');
      if (s.status === 'expired') await withUser(db, user.id, (c) => c.query(`update checkout_sessions set status = 'expired' where id = $1`, [s.id]));
      if (s.status === 'complete' && typeof s.subscription === 'string') {
        const sub = await fetchSubscription(s.subscription);
        if (sub) await reconcileSubscription(sub);
        pending = s.payment_status !== 'paid';
      }
    } else {
      const list = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 5 });
      for (const sub of list.data) await reconcileSubscription(sub);
    }
    return json(200, { ok: true, pending, account: await d.accountView(user) });
  };

  // ---- portal, cancel, resume ------------------------------------------------------------------------------------------------------
  const portal = async (user: SessionUser): Promise<Response> => {
    const own = await withUser(db, user.id, (c) => c.query('select provider_customer_id from billing_customers where user_id = $1', [user.id]));
    if (!own.rowCount) return fail(404, 'no-billing-account', 'There is no billing account yet. Choose a subscription first.');
    const s = await stripe.billingPortal.sessions.create({ customer: own.rows[0].provider_customer_id, return_url: `${d.appOrigin}/?billing=returned`, ...(config.portalConfiguration ? { configuration: config.portalConfiguration } : {}) });
    return json(200, { ok: true, url: s.url });
  };

  const setCancel = async (user: SessionUser, cancel: boolean): Promise<Response> => {
    const sub = await ownedLiveSubscription(user.id);
    if (!sub) return fail(404, 'no-subscription', 'There is no active subscription to change.');
    const updated = await stripe.subscriptions.update(sub.providerId, { cancel_at_period_end: cancel });
    await reconcileSubscription(updated);
    return json(200, { ok: true, account: await d.accountView(user) });
  };

  // ---- webhooks --------------------------------------------------------------------------------------------------------------------
  const subIdOfInvoice = (inv: Stripe.Invoice): string | null => {
    const s = inv.parent?.subscription_details?.subscription;
    return typeof s === 'string' ? s : s?.id ?? null;
  };

  /** Ends or pauses access for refunds and disputes, and tells Stripe to stop billing when access is ended. */
  const applyAccessPolicy = async (customerId: string, action: 'suspend-dispute' | 'clear-dispute' | 'end'): Promise<void> => {
    const found = await withSystem(db, async (c) => {
      const who = await userForCustomer(c, customerId);
      if ('ignored' in who) return null;
      const s = await c.query(`select provider_subscription_id, suspended_reason from subscriptions where user_id = $1 and status in ('active','past_due','unpaid','incomplete','paused') limit 1`, [who.userId]);
      return s.rowCount ? { userId: who.userId, subId: s.rows[0].provider_subscription_id as string, reason: s.rows[0].suspended_reason as string | null } : { userId: who.userId, subId: null, reason: null };
    });
    if (!found || !found.subId) return;
    if (action === 'suspend-dispute' && found.reason !== 'refund') await withSystem(db, (c) => c.query(`update subscriptions set suspended_reason = 'dispute', updated_at = $2 where provider_subscription_id = $1`, [found.subId, d.now()]));
    if (action === 'clear-dispute' && found.reason === 'dispute') await withSystem(db, (c) => c.query(`update subscriptions set suspended_reason = null, updated_at = $2 where provider_subscription_id = $1`, [found.subId, d.now()]));
    if (action === 'end') {
      await withSystem(db, (c) => c.query(`update subscriptions set suspended_reason = 'refund', updated_at = $2 where provider_subscription_id = $1`, [found.subId, d.now()]));
      const cancelled = await stripe.subscriptions.cancel(found.subId).catch((e) => { if (isMissing(e)) return null; throw e; });
      if (cancelled) await reconcileSubscription(cancelled);
    }
  };

  const processEvent = async (event: Stripe.Event): Promise<string> => {
    switch (event.type) {
      case 'checkout.session.completed': {
        const s = event.data.object as Stripe.Checkout.Session;
        if (s.mode !== 'subscription' || typeof s.subscription !== 'string') return 'ignored';
        const sub = await fetchSubscription(s.subscription);
        if (!sub) return 'ignored';
        const o = await reconcileSubscription(sub);
        return o.ok ? 'processed' : 'ignored';
      }
      case 'checkout.session.expired': {
        const s = event.data.object as Stripe.Checkout.Session;
        await withSystem(db, (c) => c.query(`update checkout_sessions set status = 'expired' where id = $1 and status = 'open'`, [s.id]));
        return 'processed';
      }
      case 'customer.subscription.created': case 'customer.subscription.updated': case 'customer.subscription.deleted': {
        const evSub = event.data.object as Stripe.Subscription;
        // The event is a hint that something changed; the truth is the subscription as Stripe has it now.
        const current = (await fetchSubscription(evSub.id)) ?? (event.type === 'customer.subscription.deleted' ? evSub : null);
        if (!current) return 'ignored';
        const o = await reconcileSubscription(current);
        return o.ok ? 'processed' : 'ignored';
      }
      case 'invoice.paid': case 'invoice.payment_failed': case 'invoice.payment_action_required': {
        const inv = event.data.object as Stripe.Invoice;
        const subId = subIdOfInvoice(inv);
        if (!subId) return 'ignored';
        const sub = await fetchSubscription(subId);
        if (!sub) return 'ignored';
        const o = await reconcileSubscription(sub);
        if (o.ok && event.type !== 'invoice.paid') {
          const kind = event.type === 'invoice.payment_failed' ? 'payment-failed' : 'payment-action-required';
          await withSystem(db, (c) => enqueue(c, o.userId, kind, `${kind}:${inv.id}`, { plan: o.record.plan }, d.now()));
        }
        return o.ok ? 'processed' : 'ignored';
      }
      case 'charge.refunded': {
        const ch = event.data.object as Stripe.Charge;
        const customer = typeof ch.customer === 'string' ? ch.customer : ch.customer?.id;
        if (!customer || !ch.refunded) return 'ignored';       // only a full refund ends access
        await applyAccessPolicy(customer, 'end');
        return 'processed';
      }
      case 'charge.dispute.created': case 'charge.dispute.closed': case 'charge.dispute.updated': {
        const ev = event.data.object as Stripe.Dispute;
        // Decide from the dispute as it is now, not from this event, so events arriving in any order land on the same answer.
        const dispute = await stripe.disputes.retrieve(ev.id).catch((e) => { if (isMissing(e)) return ev; throw e; });
        const chargeId = typeof dispute.charge === 'string' ? dispute.charge : dispute.charge.id;
        const charge = await stripe.charges.retrieve(chargeId);
        const customer = typeof charge.customer === 'string' ? charge.customer : charge.customer?.id;
        if (!customer) return 'ignored';
        if (dispute.status === 'needs_response' || dispute.status === 'under_review') await applyAccessPolicy(customer, 'suspend-dispute');
        else if (dispute.status === 'won' || dispute.status === 'warning_closed' || dispute.status === 'prevented') await applyAccessPolicy(customer, 'clear-dispute');
        else if (dispute.status === 'lost') await applyAccessPolicy(customer, 'end');
        return 'processed';
      }
      default: return 'ignored';
    }
  };

  const webhook = async (req: Request): Promise<Response> => {
    if (req.method !== 'POST') return fail(405, 'method', 'Use POST.', {}, { allow: 'POST' });
    const sig = req.headers.get('stripe-signature');
    if (!sig) return fail(400, 'no-signature', 'Missing signature.');
    const raw = Buffer.from(await req.arrayBuffer());
    let event: Stripe.Event;
    try { event = stripe.webhooks.constructEvent(raw, sig, config.webhookSecret, TOLERANCE_SECONDS); }
    catch { log({ event: 'billing.webhook-rejected', code: 'signature' }); return fail(400, 'bad-signature', 'Signature check failed.'); }

    const now = d.now();
    const claim = await withSystem(db, async (c) => {
      const ins = await c.query(`insert into billing_events (provider, event_id, type, status, received_at) values ('stripe', $1, $2, 'processing', $3) on conflict do nothing returning event_id`, [event.id, event.type, now]);
      if (ins.rowCount) return 'new' as const;
      const cur = await c.query(`select status, received_at from billing_events where provider = 'stripe' and event_id = $1 for update`, [event.id]);
      const row = cur.rows[0] as { status: string; received_at: Date };
      if (row.status === 'processed' || row.status === 'ignored') return 'done' as const;
      if (row.status === 'processing' && now.getTime() - row.received_at.getTime() < IN_FLIGHT_MS) return 'busy' as const;
      await c.query(`update billing_events set status = 'processing', attempts = attempts + 1, received_at = $2 where provider = 'stripe' and event_id = $1`, [event.id, now]);
      return 'retry' as const;
    });
    if (claim === 'done') return json(200, { ok: true, duplicate: true });
    if (claim === 'busy') return fail(503, 'in-flight', 'That event is being processed.');
    try {
      const result = await processEvent(event);
      await withSystem(db, (c) => c.query(`update billing_events set status = $2, processed_at = $3, error_code = null where provider = 'stripe' and event_id = $1`, [event.id, result === 'processed' ? 'processed' : 'ignored', d.now()]));
      return json(200, { ok: true });
    } catch (e) {
      const code = errorCode(e);
      log({ event: 'billing.webhook-failed', code });
      await withSystem(db, (c) => c.query(`update billing_events set status = 'failed', error_code = $2 where provider = 'stripe' and event_id = $1`, [event.id, code])).catch(() => undefined);
      return fail(500, 'processing-failed', 'Will retry.');         // Stripe retries a non-2xx answer for days
    }
  };

  // ---- the service -----------------------------------------------------------------------------------------------------------------
  return {
    status: info,
    verifyPrices,
    reconcileSubscription,
    async handle(req, user) {
      const path = new URL(req.url).pathname;
      try {
        if (path === '/api/billing/webhook') return await webhook(req);
        if (!user) return fail(401, 'unauthenticated', 'Sign in to continue.');
        const origin = req.headers.get('origin');
        if (req.method !== 'GET' && (origin ? origin !== d.appOrigin : req.headers.get('sec-fetch-site') !== 'same-origin')) return fail(403, 'origin', 'This request did not come from the app.');
        if (req.method !== 'POST') return fail(405, 'method', 'Use POST.', {}, { allow: 'POST' });
        if (!user.emailVerified) return fail(403, 'unverified', 'Confirm your email address first.');
        const needsBody = path === '/api/billing/checkout' || path === '/api/billing/sync';
        let body: Record<string, unknown> = {};
        if (needsBody) {
          const b = await readJson(req, 2_048);
          if (!b.ok) return b.response;
          body = (b.value && typeof b.value === 'object' ? b.value : {}) as Record<string, unknown>;
        }
        if (path === '/api/billing/checkout') return await createCheckout(user, body.plan);
        if (path === '/api/billing/sync') return await sync(user, body.sessionId);
        if (path === '/api/billing/portal') return await portal(user);
        if (path === '/api/billing/cancel') return await setCancel(user, true);
        if (path === '/api/billing/resume') return await setCancel(user, false);
        return fail(404, 'not-found', 'Not found.');
      } catch (e) {
        const code = errorCode(e);
        log({ event: 'billing.error', code });
        return fail(503, 'billing-unavailable', 'Subscriptions are not available just now. Nothing was charged and nothing was changed. Try again in a moment.');
      }
    },
    async beforeDeleteAccount(user) {
      // Stop billing first. If Stripe cannot be reached the deletion is refused, so no one is left paying for an account that is gone.
      const subs = await withUser(db, user.id, (c) => c.query(`select provider_subscription_id from subscriptions where user_id = $1 and provider = 'stripe' and status in ('active','past_due','unpaid','incomplete','paused')`, [user.id]));
      for (const s of subs.rows as { provider_subscription_id: string }[]) {
        await stripe.subscriptions.cancel(s.provider_subscription_id).catch((e) => { if (!isMissing(e)) throw e; });
      }
      const open = await withUser(db, user.id, (c) => c.query(`select id from checkout_sessions where user_id = $1 and status = 'open'`, [user.id]));
      for (const o of open.rows as { id: string }[]) await stripe.checkout.sessions.expire(o.id).catch(() => undefined);
      const cu = await withUser(db, user.id, (c) => c.query('select provider_customer_id from billing_customers where user_id = $1', [user.id]));
      if (cu.rowCount) await withSystem(db, (c) => c.query('insert into deleted_billing_customers (provider_customer_id) values ($1) on conflict do nothing', [cu.rows[0].provider_customer_id]));
    },
    async tick(now) {
      if (!verified.ok && now.getTime() - verified.at > 60_000) await verifyPrices();
      else if (verified.ok && now.getTime() - verified.at > 10 * 60_000) { verified = { ...verified, at: now.getTime() }; void verifyPrices(); }
      await sweepCalendar(db, now);
      await deliverDue(db, { mailer: d.mailer, appOrigin: d.appOrigin, now });
    },
  };
};
