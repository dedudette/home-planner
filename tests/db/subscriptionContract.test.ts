import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AccountView } from '../../src/domain/billing/account';
import { allowanceView, subscriptionPanel } from '../../src/account/subscriptionView';
import { startFakeStripe, type FakeStripe } from '../support/fakeStripe';
import { haveDb } from './helpers';
import { Client, makeRig, ORIGIN, PASSWORD, type Rig } from './rig';

/**
 * What the subscription section of the account screen relies on, checked against the real server code: real Better Auth, real PostgreSQL,
 * the server's own clock, the real billing service. The payment provider is a MOCK (tests/support/fakeStripe.ts: the real Stripe SDK talking
 * to a local stand-in). So this proves the app's behaviour given plausible provider answers; it is NOT a Stripe verification. If the server's
 * answers change shape or meaning, this fails before the screen does. Each answer is fed to the screen's own functions, so the words and
 * the offered actions are checked on the real data, not on hand-made fixtures.
 */
const DAY = 86_400_000;
const sidOf = (url: string) => url.split('/').pop()!;

describe.skipIf(!haveDb)('the subscription screen\'s contract with the server (mock payment provider, real everything else)', () => {
  let rig: Rig;
  let fake: FakeStripe;
  let n = 0;
  const acct = async (c: Client): Promise<AccountView> => (await c.get('/api/account')).json.account;
  const deliver = async (type: string, obj: unknown) => {
    const e = fake.event(type, obj);
    const res = await rig.app.handler(new Request(`${ORIGIN}/api/billing/webhook`, { method: 'POST', headers: { 'stripe-signature': e.header, 'content-type': 'application/json', 'x-coach-client': '54.0.0.1' }, body: e.payload }));
    expect(res!.status).toBe(200);
  };
  const subscribe = async (plan: 'monthly' | 'annual' = 'monthly') => {
    const email = `sc${++n}@example.test`;
    const c = rig.client();
    await c.register(rig, email);
    const r = await c.post('/api/billing/checkout', { plan });
    expect(r.status).toBe(200);
    const sid = sidOf(r.json.url);
    const sub = fake.completeCheckout(sid, 'paid');
    await deliver('checkout.session.completed', fake.sessions.get(sid));
    const uid = (await rig.t.admin.query('select id from "user" where email = $1', [email])).rows[0].id as string;
    rig.clock.now = new Date();           // level with the time the mock provider stamped on the new subscription
    return { c, email, uid, sub, sid };
  };
  const useUnits = async (uid: string, k: number) => {
    const view = await rig.app.runtime!.entitlements.get(uid, rig.clock.now);
    for (let i = 0; i < k; i++) { const r = await rig.app.runtime!.ledger.reserve(uid, view!.window!, 'coach'); if (r.ok) await rig.app.runtime!.ledger.commit(uid, r.reservation.requestId); }
  };

  beforeAll(async () => {
    fake = await startFakeStripe();
    fake.seedPrice('price_monthly', { amount: 2500, interval: 'month' });
    fake.seedPrice('price_annual', { amount: 25500, interval: 'year' });
    rig = await makeRig({ start: new Date().toISOString(), env: { STRIPE_SECRET_KEY: 'sk_test_fake_0123456789', STRIPE_WEBHOOK_SECRET: fake.webhookSecret, STRIPE_PRICE_MONTHLY: 'price_monthly', STRIPE_PRICE_ANNUAL: 'price_annual', BILLING_TAX_MODE: 'stripe_tax_inclusive', STRIPE_API_BASE_URL: fake.base, AI_MONTHLY_ALLOWANCE: '120', AI_TRIAL_ALLOWANCE: '15' } });
    for (let i = 0; i < 100 && !rig.app.runtime!.billing!.status().available; i++) await new Promise((r) => setTimeout(r, 50));
  }, 60_000);
  // The mock provider stamps real times on what it creates; keep the server's clock level with them, then let a test move it on.
  beforeEach(() => { if (fake) fake.failNext = null; if (rig) rig.clock.now = new Date(); });
  afterAll(async () => { await rig?.close(); await fake?.close(); });

  it('a paid monthly account: the fields the screen reads, the configured allowance, and the words made from them', async () => {
    const s = await subscribe('monthly');
    const a = await acct(s.c);
    expect(a.subscription).toEqual({ provider: 'stripe', plan: 'monthly', status: 'active', currentPeriodEnd: new Date(s.sub.items.data[0].current_period_end * 1000).toISOString(), cancelAtPeriodEnd: false, amountCents: 2500, currency: 'eur' });
    expect(a.billing).toMatchObject({ available: true, canManage: true });
    expect(a.allowance).toMatchObject({ kind: 'paid', limit: 120, used: 0, remaining: 120 });          // the server's configured number, not the default 300
    const p = subscriptionPanel(a, { locale: 'en-GB', timeZone: 'UTC' });
    expect(p.headline).toBe('Monthly plan is active');
    expect(p.planLine).toBe('Monthly · €25/month');
    expect(p.actions).toEqual(['portal', 'cancel']);
    expect(allowanceView(a).headline).toBe('120 of 120 AI requests left this month');
  });

  it('the allowance counts real ledger usage, shows the reset date, and is the same number for the annual plan', async () => {
    const m = await subscribe('monthly');
    await useUnits(m.uid, 5);
    const am = await acct(m.c);
    expect(am.allowance).toMatchObject({ used: 5, remaining: 115, limit: 120 });
    expect(Date.parse(am.allowance!.resetsAt)).toBeGreaterThan(Date.parse(am.serverTime));
    expect(Date.parse(am.allowance!.resetsAt) - Date.parse(am.serverTime)).toBeLessThanOrEqual(31 * DAY);
    const y = await subscribe('annual');
    const ay = await acct(y.c);
    expect(ay.subscription).toMatchObject({ plan: 'annual', amountCents: 25500 });
    expect(ay.allowance!.limit).toBe(am.allowance!.limit);
    expect(Date.parse(ay.allowance!.resetsAt) - Date.parse(ay.serverTime)).toBeLessThanOrEqual(31 * DAY);       // a year-long plan, a month-long allowance window
    expect(subscriptionPanel(ay).lines[0]).toContain('€255 once a year');
    expect(allowanceView(ay).detail).toContain('same allowance: 120 requests every month, even if you pay once a year');
    // Usage is per account.
    expect((await acct(y.c)).allowance!.used).toBe(0);
  });

  it('a trial shows its own allowance for the whole trial', async () => {
    const c = rig.client();
    await c.register(rig, `sc${++n}@example.test`);
    const t = (await c.post('/api/account/trial', {})).json.account as AccountView;
    expect(t.allowance).toMatchObject({ kind: 'trial', limit: 15, used: 0, remaining: 15, resetsAt: t.trial!.endsAt });
    expect(allowanceView(t).headline).toBe('15 of 15 AI requests left in your trial');
  });

  it('cancel and resume go through the server, return the new view, and keep access to the exact end date', async () => {
    const s = await subscribe('monthly');
    const end = new Date(s.sub.items.data[0].current_period_end * 1000).toISOString();
    const r = await s.c.post('/api/billing/cancel', { subscription: 'sub_other', customer: 'cus_other', id: 'x' });          // browser-supplied ids are ignored
    expect(r.status).toBe(200);
    const a = r.json.account as AccountView;
    expect(a.subscription).toMatchObject({ cancelAtPeriodEnd: true, currentPeriodEnd: end, status: 'active' });
    expect(a.entitlement).toMatchObject({ state: 'cancellation-scheduled', access: 'full', accessEndsAt: end });
    const p = subscriptionPanel(a, { locale: 'en-GB', timeZone: 'UTC' });
    expect(p.actions).toEqual(['resume', 'portal']);
    expect(fake.subs.get(s.sub.id).cancel_at_period_end).toBe(true);
    const back = (await s.c.post('/api/billing/resume', {})).json.account as AccountView;
    expect(back.entitlement.state).toBe('paid-active');
    expect(subscriptionPanel(back).actions).toEqual(['portal', 'cancel']);
    // After the end date the same account is plainly expired, and may choose a plan again.
    await s.c.post('/api/billing/cancel', {});
    rig.clock.now = new Date(Date.parse(end) + 60_000);
    const gone = await acct(s.c);
    expect(gone.entitlement).toMatchObject({ state: 'expired', access: 'account-only', canSubscribe: true });
    expect(gone.allowance).toBeNull();
    expect(allowanceView(gone).kind).toBe('none');
    rig.clock.now = new Date();
  });

  it('the billing portal is created by the server for this account\'s own customer, whatever the browser sends', async () => {
    const s = await subscribe('monthly');
    const before = fake.portalSessions.length;
    const r = await s.c.post('/api/billing/portal', { customer: 'cus_someone_else', return_url: 'https://evil.example', configuration: 'bpc_x' });
    expect(r.status).toBe(200);
    expect(r.json.url).toMatch(/^https:\/\//);
    const made = fake.portalSessions[before];
    expect(made.customer).toBe(fake.subs.get(s.sub.id).customer);
    expect(made.return_url.startsWith(`${ORIGIN}/`)).toBe(true);
  });

  it('a payment that needs the bank: no access and the finish-payment action resumes the same checkout', async () => {
    const email = `sc${++n}@example.test`;
    const c = rig.client();
    await c.register(rig, email);
    const first = await c.post('/api/billing/checkout', { plan: 'annual' });
    const sub = fake.completeCheckout(sidOf(first.json.url), 'requires-action');
    await deliver('customer.subscription.created', sub);
    const a = await acct(c);
    expect(a.entitlement).toMatchObject({ state: 'payment-action-required', access: 'account-only' });
    expect(a.allowance).toBeNull();
    const p = subscriptionPanel(a);
    expect(p.actions).toEqual(['finish-payment', 'check-status']);
    // "Continue to the payment page" asks for a checkout for the plan on record and gets the one already open, not a second one.
    const again = await c.post('/api/billing/checkout', { plan: a.subscription!.plan });
    expect(again.status).toBe(200);
    expect(again.json.resumed).toBe(true);
    expect(again.json.url).toBe(first.json.url);
    // "Check status" asks the provider; with nothing new at the provider, nothing changes.
    await new Promise((r) => setTimeout(r, 2100));
    const sync = await c.post('/api/billing/sync', {});
    expect(sync.json.account.entitlement.state).toBe('payment-action-required');
  });

  it('past due: full access for the stated grace, then paused, and the billing page and data export stay reachable', async () => {
    const s = await subscribe('monthly');
    const start = Math.floor(Date.now() / 1000);
    fake.patchSub(s.sub.id, { status: 'past_due' }, { current_period_start: start, current_period_end: start + 30 * 86400 });
    await deliver('invoice.payment_failed', { id: 'in_pd_1', parent: { subscription_details: { subscription: s.sub.id } } });
    const a = await acct(s.c);
    expect(a.entitlement).toMatchObject({ state: 'past-due', access: 'full' });
    expect(Date.parse(a.entitlement.accessEndsAt!) - Date.parse(a.serverTime)).toBeLessThanOrEqual(3 * DAY);
    expect(subscriptionPanel(a).lines[0]).toMatch(/Your access continues until/);
    rig.clock.now = new Date(Date.now() + 4 * DAY);
    const late = await acct(s.c);
    expect(late.entitlement).toMatchObject({ state: 'past-due', access: 'account-only' });
    expect(late.allowance).toBeNull();
    expect(subscriptionPanel(late).actions).toEqual(['portal', 'check-status']);
    expect((await s.c.post('/api/billing/portal', {})).status).toBe(200);
    expect((await s.c.get('/api/account/export')).status).toBe(200);
    // The card is fixed at the provider and the provider says so: access returns.
    fake.patchSub(s.sub.id, { status: 'active' });
    await deliver('invoice.paid', { id: 'in_pd_1', parent: { subscription_details: { subscription: s.sub.id } } });
    expect((await acct(s.c)).entitlement).toMatchObject({ state: 'paid-active', access: 'full' });
    rig.clock.now = new Date();
  });

  it('unpaid, dispute and refund each give the screen the state it describes, and export/billing/deletion stay available', async () => {
    const u = await subscribe('monthly');
    fake.patchSub(u.sub.id, { status: 'unpaid' });
    await deliver('customer.subscription.updated', fake.subs.get(u.sub.id));
    const au = await acct(u.c);
    expect(au.entitlement.state).toBe('unpaid');
    expect(subscriptionPanel(au).tone).toBe('error');
    expect((await u.c.get('/api/account/export')).status).toBe(200);
    expect((await u.c.post('/api/billing/portal', {})).status).toBe(200);

    const d = await subscribe('monthly');
    const ch = fake.addCharge(fake.subs.get(d.sub.id).customer, { amount: 2500 });
    await deliver('charge.dispute.created', fake.addDispute(ch.id, 'needs_response'));
    const ad = await acct(d.c);
    expect(ad.entitlement).toMatchObject({ state: 'suspended', access: 'account-only' });
    expect(subscriptionPanel(ad).headline).toBe('Access is paused while a payment dispute is open');

    const r = await subscribe('monthly');
    await deliver('charge.refunded', fake.addCharge(fake.subs.get(r.sub.id).customer, { amount: 2500, refunded: true }));
    const ar = await acct(r.c);
    expect(ar.entitlement).toMatchObject({ state: 'expired', reason: 'refunded', canSubscribe: true });
    expect(subscriptionPanel(ar).lines[0]).toMatch(/refunded/);
  });

  it('after the subscription has ended, export, billing and deletion all still work, and deletion stops nothing twice', async () => {
    const s = await subscribe('monthly');
    fake.patchSub(s.sub.id, { status: 'canceled', canceled_at: Math.floor(Date.now() / 1000) });
    await deliver('customer.subscription.deleted', fake.subs.get(s.sub.id));
    const a = await acct(s.c);
    expect(a.entitlement).toMatchObject({ state: 'expired', access: 'account-only', canSubscribe: true });
    const ex = await s.c.get('/api/account/export');
    expect(ex.status).toBe(200);
    expect(ex.json.subscriptions).toHaveLength(1);
    expect((await s.c.post('/api/billing/portal', {})).status).toBe(200);
    expect((await s.c.post('/api/auth/delete-user', { password: PASSWORD })).status).toBe(200);
    expect((await rig.t.admin.query('select 1 from "user" where id = $1', [s.uid])).rowCount).toBe(0);
  });

  it('deleting an account with a live subscription stops it at the provider first', async () => {
    const s = await subscribe('annual');
    expect((await s.c.post('/api/auth/delete-user', { password: PASSWORD })).status).toBe(200);
    expect(fake.subs.get(s.sub.id).status).toBe('canceled');
  });

  it('when the provider fails, cancel says nothing changed and the subscription is untouched', async () => {
    const s = await subscribe('monthly');
    fake.failNext = { match: /POST \/v1\/subscriptions\//, status: 500, times: 10 };
    const r = await s.c.post('/api/billing/cancel', {});
    expect(r.status).toBe(503);
    expect(r.json.error.code).toBe('billing-unavailable');
    fake.failNext = null;
    expect((await acct(s.c)).subscription!.cancelAtPeriodEnd).toBe(false);
    expect(fake.subs.get(s.sub.id).cancel_at_period_end).toBe(false);
  });

  it('nobody else\'s subscription can be reached: cancel and portal act only on the signed-in account', async () => {
    const a = await subscribe('monthly');
    const b = rig.client();
    await b.register(rig, `sc${++n}@example.test`);
    expect((await b.post('/api/billing/cancel', { subscription: a.sub.id })).status).toBe(404);
    expect((await b.post('/api/billing/resume', { subscription: a.sub.id })).status).toBe(404);
    expect((await b.post('/api/billing/portal', {})).status).toBe(404);          // no billing account of its own
    expect(fake.subs.get(a.sub.id).cancel_at_period_end).toBe(false);
    expect((await acct(b)).billing.canManage).toBe(false);
    expect(subscriptionPanel(await acct(b)).show).toBe(false);
  });
});

describe.skipIf(!haveDb)('the subscription screen when the payment provider is not configured on the server (no provider at all)', () => {
  let rig: Rig;
  beforeAll(async () => { rig = await makeRig({ start: new Date().toISOString() }); }, 60_000);
  afterAll(async () => { await rig?.close(); });

  it('an existing subscription record is described, nothing changeable is offered, and export and deletion still work', async () => {
    const c = rig.client();
    await c.register(rig, 'nobill@example.test');
    const uid = (await rig.t.admin.query(`select id from "user" where email = 'nobill@example.test'`)).rows[0].id as string;
    await rig.t.admin.query(`insert into subscriptions (user_id, provider, provider_subscription_id, plan, status, started_at, current_period_start, current_period_end, amount_cents, currency) values ($1, 'stripe', 'sub_nobill', 'monthly', 'active', now() - interval '3 days', now() - interval '3 days', now() + interval '27 days', 2500, 'eur')`, [uid]);
    const a = (await c.get('/api/account')).json.account as AccountView;
    expect(a.billing).toMatchObject({ available: false, canManage: false });
    expect(a.entitlement.state).toBe('paid-active');
    const p = subscriptionPanel(a);
    expect(p.show).toBe(true);
    expect(p.actions).toEqual([]);
    expect(p.actionsUnavailable).toBe('billing-unavailable');
    expect((await c.post('/api/billing/cancel', {})).status).toBe(503);
    expect((await c.post('/api/billing/portal', {})).status).toBe(503);
    expect((await c.get('/api/account/export')).status).toBe(200);
    expect((await c.post('/api/auth/delete-user', { password: PASSWORD })).status).toBe(200);
  });
});
