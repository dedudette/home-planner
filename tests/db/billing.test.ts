import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readBillingConfig } from '../../server/billing/config';
import { buildCoachPayload } from '../../src/domain/coach/metrics';
import { computePatterns } from '../../src/domain/patterns';
import { lived, range } from '../coachHelpers';
import { TODAY } from '../helpers';
import { startFakeStripe, type FakeStripe } from '../support/fakeStripe';
import { haveDb } from './helpers';
import { Client, makeRig, ORIGIN, type Rig } from './rig';

/**
 * FAKE PROVIDER: the real Stripe SDK, real Better Auth and real PostgreSQL, against a local stand-in for Stripe's API (see
 * tests/support/fakeStripe.ts). This proves CleanFlow's billing logic, not Stripe's behaviour; docs/billing-sandbox.md is the check
 * against Stripe's own test mode.
 */
const payload = buildCoachPayload(computePatterns(lived(range(-9, 0), { doneEach: 2, skipEach: 1, minutes: 20, focus: ['home', 'discipline', 'morning', 'evening'] }), TODAY, 14))!;
const M = payload.metrics;
const goodText = JSON.stringify({ suggestions: [{ kind: 'pattern', title: 'Opened days and completed tasks', explanation: `The app was opened on ${M['days.opened']} of ${payload.windowDays} days, and ${M['tasks.seenCompleted']} of ${M['tasks.seen']} tasks shown on Today were completed.`, metric_ids: ['days.opened', 'tasks.seen', 'tasks.seenCompleted'], strength: 'good' }] });
const anthropicStub = (async () => new Response(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 't', content: [{ type: 'text', text: goodText }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 100, output_tokens: 30 } }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;

const day = (n: number) => { const d = new Date(`${TODAY}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const assistReq = { v: 1, feature: 'meals', days: [day(0), day(1)], slots: ['lunch', 'dinner'], maxItems: 4, wish: 'quick weeknights', candidates: [{ id: 'r1', name: 'Red lentil soup', minutes: 30, tags: ['quick'], slots: ['lunch', 'dinner'] }, { id: 'r2', name: 'Veg omelette', minutes: 15, tags: [], slots: ['lunch'] }] };
const DAY = 86_400_000;

describe.skipIf(!haveDb)('billing against a fake Stripe (real SDK, real PostgreSQL, real Better Auth)', () => {
  let rig: Rig;
  let fake: FakeStripe;
  let n = 0;

  const acct = async (c: Client) => (await c.get('/api/account')).json.account;
  const newUser = async (): Promise<{ c: Client; email: string }> => { const email = `u${++n}@example.test`; const c = rig.client(); await c.register(rig, email); return { c, email }; };
  const userId = async (email: string) => (await rig.t.admin.query('select id from "user" where email = $1', [email])).rows[0].id as string;
  const deliver = async (type: string, obj: unknown, o: Parameters<FakeStripe['event']>[2] = {}) => {
    const e = fake.event(type, obj, o);
    const res = await rig.app.handler(new Request(`${ORIGIN}/api/billing/webhook`, { method: 'POST', headers: { 'stripe-signature': e.header, 'content-type': 'application/json', 'x-coach-client': '54.0.0.1' }, body: e.payload }));
    return { status: res!.status, json: (await res!.json()) as any, id: e.id };
  };
  const sidOf = (url: string) => url.split('/').pop()!;
  /** Starts checkout, completes it on the fake hosted page and delivers the notice, as a real purchase would unfold. */
  const subscribe = async (plan: 'monthly' | 'annual' = 'monthly') => {
    const u = await newUser();
    const r = await u.c.post('/api/billing/checkout', { plan });
    expect(r.status).toBe(200);
    const sid = sidOf(r.json.url);
    const sub = fake.completeCheckout(sid, 'paid');
    const ev = await deliver('checkout.session.completed', fake.sessions.get(sid));
    expect(ev.status).toBe(200);
    return { ...u, sid, sub, uid: await userId(u.email) };
  };
  const subRow = async (uid: string) => (await rig.t.admin.query('select * from subscriptions where user_id = $1 order by id desc limit 1', [uid])).rows[0];
  const coach = (c: Client) => c.post('/api/coach', payload);

  beforeAll(async () => {
    fake = await startFakeStripe();
    fake.seedPrice('price_monthly', { amount: 2500, interval: 'month' });
    fake.seedPrice('price_annual', { amount: 25500, interval: 'year' });
    rig = await makeRig({
      start: new Date().toISOString(),
      env: {
        STRIPE_SECRET_KEY: 'sk_test_fake_0123456789', STRIPE_WEBHOOK_SECRET: fake.webhookSecret, STRIPE_PRICE_MONTHLY: 'price_monthly', STRIPE_PRICE_ANNUAL: 'price_annual',
        BILLING_TAX_MODE: 'stripe_tax_inclusive', STRIPE_API_BASE_URL: fake.base, ANTHROPIC_API_KEY: 'sk-test', COACH_COOLDOWN_SECONDS: '5',
      },
      overrides: { fetch: anthropicStub },
    });
    // The server checks the two prices once at start-up; wait for that to finish before the tests rely on it.
    for (let i = 0; i < 100 && !rig.app.runtime!.billing!.status().available; i++) await new Promise((r) => setTimeout(r, 50));
  }, 60_000);
  beforeEach(() => { if (fake) fake.failNext = null; });
  afterAll(async () => { await rig?.close(); await fake?.close(); });

  describe('configuration', () => {
    it('the prices are checked against €25/month and €255/year before anyone can reach checkout', async () => {
      expect(rig.app.runtime!.billing!.status()).toEqual({ available: true, reason: null, mode: 'test' });
      const bad = await startFakeStripe();
      bad.seedPrice('price_monthly', { amount: 2500, interval: 'month' });
      bad.seedPrice('price_annual', { amount: 24500, interval: 'year' });       // €245: a configuration mistake
      const rig2 = await makeRig({ env: { STRIPE_SECRET_KEY: 'sk_test_fake_0123456789', STRIPE_WEBHOOK_SECRET: bad.webhookSecret, STRIPE_PRICE_MONTHLY: 'price_monthly', STRIPE_PRICE_ANNUAL: 'price_annual', BILLING_TAX_MODE: 'stripe_tax_inclusive', STRIPE_API_BASE_URL: bad.base } });
      try {
        const c = rig2.client(); await c.register(rig2, 'cfg@example.test');
        const r = await c.post('/api/billing/checkout', { plan: 'annual' });
        expect(r.status).toBe(503);
        expect(rig2.app.runtime!.billing!.status()).toMatchObject({ available: false, reason: 'price-mismatch:annual:amount' });
        expect(bad.requests.some((q) => q.path === '/v1/checkout/sessions')).toBe(false);
        const cfg = await c.get('/api/config');
        expect(cfg.json.accounts.billing).toMatchObject({ available: false, reason: 'price-mismatch:annual:amount' });
      } finally { await rig2.close(); await bad.close(); }
    });
    it('keys and modes: live keys are refused in test mode and without explicit activation; tax must be chosen; secrets stay out of the config object', () => {
      const ok = { STRIPE_SECRET_KEY: 'sk_test_abcdef', STRIPE_WEBHOOK_SECRET: 'whsec_abc', STRIPE_PRICE_MONTHLY: 'price_1', STRIPE_PRICE_ANNUAL: 'price_2', BILLING_TAX_MODE: 'stripe_tax_inclusive' };
      expect(readBillingConfig(ok).kind).toBe('on');
      expect(readBillingConfig({}).kind).toBe('absent');
      expect(readBillingConfig({ ...ok, STRIPE_SECRET_KEY: 'sk_live_abcdef' })).toMatchObject({ kind: 'off', reason: expect.stringContaining('live key') });
      expect(readBillingConfig({ ...ok, STRIPE_SECRET_KEY: 'sk_live_abcdef', BILLING_ENV: 'live' })).toMatchObject({ kind: 'off', reason: expect.stringContaining('live-not-activated') });
      expect(readBillingConfig({ ...ok, BILLING_TAX_MODE: undefined })).toMatchObject({ kind: 'off', reason: expect.stringContaining('tax-not-configured') });
      expect(readBillingConfig({ ...ok, BILLING_TAX_MODE: 'none_sandbox_only', STRIPE_SECRET_KEY: 'sk_live_abcdef', BILLING_ENV: 'live', BILLING_LIVE_CONFIRM: 'reviewed-tax-legal-refund-policy' })).toMatchObject({ kind: 'off' });
      expect(readBillingConfig({ ...ok, STRIPE_PRICE_ANNUAL: 'price_1' })).toMatchObject({ kind: 'off' });
      expect(readBillingConfig({ ...ok, STRIPE_API_BASE_URL: 'http://127.0.0.1:1', BILLING_ENV: 'live' })).toMatchObject({ kind: 'off' });
      const r = readBillingConfig(ok);
      if (r.kind === 'on') { expect(JSON.stringify(r.config)).not.toContain('sk_test_abcdef'); expect(JSON.stringify(r.config)).not.toContain('whsec_abc'); }
    });
  });

  describe('checkout', () => {
    it('the server picks the price: a browser that names another price, amount or customer changes nothing', async () => {
      const { c } = await newUser();
      const r = await c.post('/api/billing/checkout', { plan: 'monthly', price: 'price_annual', priceId: 'price_annual', amount: 1, unit_amount: 1, customer: 'cus_someone_else', mode: 'payment', success_url: 'https://evil.example' });
      expect(r.status).toBe(200);
      const created = fake.requests.filter((q) => q.method === 'POST' && q.path === '/v1/checkout/sessions').pop()!.form;
      expect(created.line_items[0].price).toBe('price_monthly');
      expect(created.mode).toBe('subscription');
      expect(created.customer).not.toBe('cus_someone_else');
      expect(created.success_url.startsWith(`${ORIGIN}/`)).toBe(true);
      expect(created.cancel_url.startsWith(`${ORIGIN}/`)).toBe(true);
    });
    it('only the plan names are accepted', async () => {
      const { c } = await newUser();
      for (const plan of ['lifetime', 'price_monthly', '', null, 12, undefined]) expect((await c.post('/api/billing/checkout', { plan })).status).toBe(400);
    });
    it('the payment page states the exact terms: €25 per month, or €255 once a year and not monthly', async () => {
      const { c } = await newUser();
      await c.post('/api/billing/checkout', { plan: 'monthly' });
      await c.post('/api/billing/checkout', { plan: 'annual' });
      const forms = fake.requests.filter((q) => q.method === 'POST' && q.path === '/v1/checkout/sessions').slice(-2).map((q) => q.form);
      expect(forms[0].custom_text.submit.message).toContain('€25 per month');
      expect(forms[0].line_items[0].price).toBe('price_monthly');
      expect(forms[1].custom_text.submit.message).toContain('€255 per year');
      expect(forms[1].custom_text.submit.message).toContain('charged once a year');
      expect(forms[1].custom_text.submit.message).toContain('not monthly');
      expect(forms[1].line_items[0].price).toBe('price_annual');
      expect(forms[1].automatic_tax.enabled).toBe('true');
      expect(forms[1].allow_promotion_codes).toBe('false');
      expect(forms[1].subscription_data.trial_period_days).toBeUndefined();     // the trial is ours: no card, no Stripe trial
    });
    it('Stripe receives an email address, an opaque account id and the plan name, and nothing else about the person', async () => {
      const { c, email } = await newUser();
      await c.post('/api/billing/checkout', { plan: 'annual' });
      const cust = fake.requests.filter((q) => q.path === '/v1/customers' && q.method === 'POST').pop()!.form;
      expect(Object.keys(cust).sort()).toEqual(['email', 'metadata']);
      expect(cust.email).toBe(email);
      expect(Object.keys(cust.metadata)).toEqual(['user_id']);
      const co = fake.requests.filter((q) => q.path === '/v1/checkout/sessions' && q.method === 'POST').pop()!.form;
      expect(Object.keys(co.metadata).sort()).toEqual(['plan', 'user_id']);
      expect(Object.keys(co.subscription_data.metadata).sort()).toEqual(['plan', 'user_id']);
    });
    it('a double click, or two tabs, give one open checkout and one customer', async () => {
      const { c, email } = await newUser();
      const rs = await Promise.all([c.post('/api/billing/checkout', { plan: 'annual' }), c.post('/api/billing/checkout', { plan: 'annual' }), c.post('/api/billing/checkout', { plan: 'annual' })]);
      expect(rs.every((r) => r.status === 200)).toBe(true);
      expect(new Set(rs.map((r) => r.json.url)).size).toBe(1);
      const uid = await userId(email);
      expect((await rig.t.admin.query(`select count(*)::int as n from checkout_sessions where user_id = $1 and status = 'open'`, [uid])).rows[0].n).toBe(1);
      expect((await rig.t.admin.query(`select count(*)::int as n from billing_customers where user_id = $1`, [uid])).rows[0].n).toBe(1);
      const again = await c.post('/api/billing/checkout', { plan: 'annual' });
      expect(again.json.resumed).toBe(true);
      expect(again.json.url).toBe(rs[0].json.url);
    });
    it('choosing the other plan closes the first checkout and opens a new one', async () => {
      const { c, email } = await newUser();
      const a = await c.post('/api/billing/checkout', { plan: 'monthly' });
      const b = await c.post('/api/billing/checkout', { plan: 'annual' });
      expect(b.json.url).not.toBe(a.json.url);
      expect(fake.sessions.get(sidOf(a.json.url)).status).toBe('expired');
      const uid = await userId(email);
      expect((await rig.t.admin.query(`select plan from checkout_sessions where user_id = $1 and status = 'open'`, [uid])).rows).toEqual([{ plan: 'annual' }]);
    });
    it('signed-out requests and requests from another origin are refused', async () => {
      const anon = rig.client();
      expect((await anon.post('/api/billing/checkout', { plan: 'monthly' })).status).toBe(401);
      const { c } = await newUser();
      expect((await c.post('/api/billing/checkout', { plan: 'monthly' }, { origin: 'https://evil.example' })).status).toBe(403);
    });
  });

  describe('no access without a verified payment', () => {
    it('returning from checkout (the success URL) without a paid subscription gives nothing', async () => {
      const { c } = await newUser();
      const r = await c.post('/api/billing/checkout', { plan: 'monthly' });
      const sid = sidOf(r.json.url);
      await new Promise((ok) => setTimeout(ok, 2100));
      const s = await c.post('/api/billing/sync', { sessionId: sid });                     // what the page does when the success URL loads
      expect(s.status).toBe(200);
      expect(s.json.account.entitlement.access).toBe('account-only');
      expect(s.json.account.subscription).toBeNull();
      expect((await coach(c)).status).toBe(402);
    });
    it('a checkout whose payment needs authentication leaves the account in "payment action required", with no paid access', async () => {
      const { c } = await newUser();
      const r = await c.post('/api/billing/checkout', { plan: 'monthly' });
      const sid = sidOf(r.json.url);
      const sub = fake.completeCheckout(sid, 'requires-action');
      await deliver('customer.subscription.created', sub);
      const a = await acct(c);
      expect(a.entitlement).toMatchObject({ state: 'payment-action-required', access: 'account-only' });
      expect((await coach(c)).status).toBe(402);
      // The person can pick the same checkout back up instead of starting another.
      const again = await c.post('/api/billing/checkout', { plan: 'monthly' });
      expect(again.status).toBe(200);
    });
    it('after the real payment the same account becomes paid, and the sync from the success URL agrees with the webhook', async () => {
      const { c, email } = await newUser();
      const r = await c.post('/api/billing/checkout', { plan: 'annual' });
      const sid = sidOf(r.json.url);
      fake.completeCheckout(sid, 'paid');
      await new Promise((ok) => setTimeout(ok, 2100));
      const s = await c.post('/api/billing/sync', { sessionId: sid });          // before any webhook arrives
      expect(s.json.account.entitlement).toMatchObject({ state: 'paid-active', access: 'full', plan: 'annual' });
      const before = await subRow(await userId(email));
      await deliver('checkout.session.completed', fake.sessions.get(sid));
      const after = await subRow(await userId(email));
      expect(after.id).toBe(before.id);                                          // one record, not two
    });
    it('a person cannot sync someone else’s checkout', async () => {
      const a = await newUser(); const b = await newUser();
      const ra = await a.c.post('/api/billing/checkout', { plan: 'monthly' });
      await b.c.post('/api/billing/checkout', { plan: 'monthly' });
      const sid = sidOf(ra.json.url);
      fake.completeCheckout(sid, 'paid');
      await new Promise((ok) => setTimeout(ok, 2100));
      const steal = await b.c.post('/api/billing/sync', { sessionId: sid });
      expect(steal.status).toBe(404);
      expect((await acct(b.c)).entitlement.access).toBe('account-only');
    });
  });

  describe('what a paid account sees and may do', () => {
    it('monthly: €25/month, the real allowance and its reset date; AI works; both plans share one allowance number', async () => {
      const m = await subscribe('monthly');
      const a = await acct(m.c);
      expect(a.entitlement).toMatchObject({ state: 'paid-active', access: 'full', plan: 'monthly' });
      expect(a.subscription).toMatchObject({ plan: 'monthly', status: 'active', amountCents: 2500, currency: 'eur', cancelAtPeriodEnd: false });
      expect(a.allowance).toMatchObject({ kind: 'paid', limit: 300, used: 0, remaining: 300 });
      expect((await coach(m.c)).status).toBe(200);
      expect((await acct(m.c)).allowance).toMatchObject({ used: 1, remaining: 299 });
      const y = await subscribe('annual');
      const b = await acct(y.c);
      expect(b.subscription).toMatchObject({ plan: 'annual', amountCents: 25500 });
      expect(b.allowance.limit).toBe(a.allowance.limit);
      expect(new Date(b.allowance.resetsAt).getTime() - Date.now()).toBeLessThanOrEqual(31 * DAY);      // an annual plan still resets monthly
    });
    it('cancelling keeps access to the end of the paid period, with the exact date, then ends it; resuming undoes it', async () => {
      const s = await subscribe('monthly');
      const periodEnd = new Date(s.sub.items.data[0].current_period_end * 1000);
      const r = await s.c.post('/api/billing/cancel', {});
      expect(r.status).toBe(200);
      expect(r.json.account.entitlement).toMatchObject({ state: 'cancellation-scheduled', access: 'full', accessEndsAt: periodEnd.toISOString() });
      expect(r.json.account.subscription.cancelAtPeriodEnd).toBe(true);
      expect((await coach(s.c)).status).toBe(200);
      rig.clock.now = new Date(periodEnd.getTime() - 1000);
      expect((await acct(s.c)).entitlement.access).toBe('full');
      rig.clock.now = new Date(periodEnd.getTime() + 1000);
      const ended = await acct(s.c);
      expect(ended.entitlement).toMatchObject({ state: 'expired', access: 'account-only' });
      expect((await coach(s.c)).status).toBe(402);
      rig.clock.now = new Date();
      const back = await s.c.post('/api/billing/resume', {});
      expect(back.json.account.entitlement).toMatchObject({ state: 'paid-active', access: 'full' });
    });
    it('after the subscription has ended: paid AI is refused directly, while export, billing and deletion still work and the data is kept', async () => {
      const s = await subscribe('monthly');
      fake.patchSub(s.sub.id, { status: 'canceled', canceled_at: Math.floor(Date.now() / 1000) });
      await deliver('customer.subscription.deleted', fake.subs.get(s.sub.id));
      expect((await coach(s.c)).status).toBe(402);
      expect((await s.c.post('/api/assist', assistReq)).status).toBe(402);
      const a = await acct(s.c);
      expect(a.entitlement).toMatchObject({ state: 'expired', access: 'account-only', canSubscribe: true });
      expect((await s.c.get('/api/account/export')).status).toBe(200);
      expect((await s.c.post('/api/billing/portal', {})).status).toBe(200);
      expect((await rig.t.admin.query('select 1 from subscriptions where user_id = $1', [s.uid])).rowCount).toBe(1);     // history is not deleted
      // ...and they can subscribe again.
      expect((await s.c.post('/api/billing/checkout', { plan: 'annual' })).status).toBe(200);
    });
    it('a person with a live subscription cannot start another checkout', async () => {
      const s = await subscribe('monthly');
      const r = await s.c.post('/api/billing/checkout', { plan: 'annual' });
      expect(r.status).toBe(409);
      expect(r.json.error.code).toBe('already-subscribed');
    });
  });

  describe('webhooks', () => {
    it('a bad signature, a wrong secret, no signature and a stale timestamp are all refused and change nothing', async () => {
      const s = await subscribe('monthly');
      const before = await subRow(s.uid);
      const evt = fake.event('customer.subscription.deleted', { ...fake.subs.get(s.sub.id), status: 'canceled' });
      const post = (header: string | null, payloadText = evt.payload) => rig.app.handler(new Request(`${ORIGIN}/api/billing/webhook`, { method: 'POST', headers: { ...(header ? { 'stripe-signature': header } : {}), 'content-type': 'application/json' }, body: payloadText }));
      expect((await post(evt.header, evt.payload.replace('canceled', 'actived')))!.status).toBe(400);
      expect((await post(fake.event('x', {}, { secret: 'whsec_wrong' }).header))!.status).toBe(400);
      expect((await post(null))!.status).toBe(400);
      const stale = fake.event('customer.subscription.deleted', fake.subs.get(s.sub.id), { ageSeconds: 3600 });
      expect((await post(stale.header, stale.payload))!.status).toBe(400);
      const after = await subRow(s.uid);
      expect(after.status).toBe(before.status);
      expect((await rig.t.admin.query(`select count(*)::int as n from billing_events where event_id in ($1, $2)`, [evt.id, stale.id])).rows[0].n).toBe(0);
    });
    it('the same event delivered again, even many times at once, is acted on once', async () => {
      const u = await newUser();
      const r = await u.c.post('/api/billing/checkout', { plan: 'monthly' });
      const sid = sidOf(r.json.url);
      fake.completeCheckout(sid, 'paid');
      const e = fake.event('checkout.session.completed', fake.sessions.get(sid));
      const send = () => rig.app.handler(new Request(`${ORIGIN}/api/billing/webhook`, { method: 'POST', headers: { 'stripe-signature': e.header, 'content-type': 'application/json' }, body: e.payload }));
      const rs = await Promise.all([send(), send(), send(), send(), send()]);
      const codes = rs.map((x) => x!.status);
      expect(codes.filter((x) => x === 200).length).toBeGreaterThanOrEqual(1);
      expect(codes.every((x) => x === 200 || x === 503)).toBe(true);      // a concurrent twin is told to come back, never processed twice
      const again = await send();
      expect(again!.status).toBe(200);
      expect(((await again!.json()) as any).duplicate).toBe(true);
      const uid = await userId(u.email);
      expect((await rig.t.admin.query('select count(*)::int as n from subscriptions where user_id = $1', [uid])).rows[0].n).toBe(1);
      expect((await rig.t.admin.query(`select count(*)::int as n from billing_events where event_id = $1`, [e.id])).rows[0].n).toBe(1);
      expect((await rig.t.admin.query(`select count(*)::int as n from notifications where user_id = $1 and kind = 'subscription-started'`, [uid])).rows[0].n).toBe(1);
    });
    it('events out of order cannot move a subscription backwards: the current state at Stripe wins', async () => {
      const s = await subscribe('monthly');
      const staleActive = JSON.parse(JSON.stringify(fake.subs.get(s.sub.id)));
      fake.patchSub(s.sub.id, { status: 'canceled', canceled_at: Math.floor(Date.now() / 1000) });
      await deliver('customer.subscription.deleted', fake.subs.get(s.sub.id));
      expect((await subRow(s.uid)).status).toBe('canceled');
      const late = await deliver('customer.subscription.updated', staleActive);        // an older "active" snapshot arrives last
      expect(late.status).toBe(200);
      expect((await subRow(s.uid)).status).toBe('canceled');
      expect((await acct(s.c)).entitlement.access).toBe('account-only');
    });
    it('a failure while processing returns an error so Stripe retries, and the retry then succeeds exactly once', async () => {
      const u = await newUser();
      const r = await u.c.post('/api/billing/checkout', { plan: 'monthly' });
      const sid = sidOf(r.json.url);
      fake.completeCheckout(sid, 'paid');
      const e = fake.event('checkout.session.completed', fake.sessions.get(sid));
      const send = () => rig.app.handler(new Request(`${ORIGIN}/api/billing/webhook`, { method: 'POST', headers: { 'stripe-signature': e.header, 'content-type': 'application/json' }, body: e.payload }));
      fake.failNext = { match: /GET \/v1\/subscriptions\//, status: 500, times: 10 };
      const first = await send();
      expect(first!.status).toBe(500);
      const uid = await userId(u.email);
      expect((await rig.t.admin.query(`select status, error_code from billing_events where event_id = $1`, [e.id])).rows[0].status).toBe('failed');
      expect((await acct(u.c)).entitlement.access).toBe('account-only');
      fake.failNext = null;                                                   // Stripe is reachable again
      const second = await send();
      expect(second!.status).toBe(200);
      expect((await rig.t.admin.query(`select status, attempts from billing_events where event_id = $1`, [e.id])).rows[0]).toEqual({ status: 'processed', attempts: 2 });
      expect((await acct(u.c)).entitlement.state).toBe('paid-active');
      expect((await rig.t.admin.query('select count(*)::int as n from subscriptions where user_id = $1', [uid])).rows[0].n).toBe(1);
    });
    it('events for unknown customers, unknown prices and unrelated types are acknowledged and grant nothing', async () => {
      const stranger = { ...fake.subs.get((await subscribe('monthly')).sub.id), id: 'sub_stranger', customer: 'cus_unknown' };
      fake.subs.set('sub_stranger', stranger);
      const r1 = await deliver('customer.subscription.created', stranger);
      expect(r1.status).toBe(200);
      expect((await rig.t.admin.query(`select 1 from subscriptions where provider_subscription_id = 'sub_stranger'`)).rowCount).toBe(0);
      const { c, email } = await newUser();
      const co = await c.post('/api/billing/checkout', { plan: 'monthly' });
      const sub = fake.completeCheckout(sidOf(co.json.url), 'paid');
      fake.seedPrice('price_other', { amount: 100, interval: 'month' });
      fake.changePlan(sub.id, 'price_other');
      await deliver('customer.subscription.created', sub);
      expect((await rig.t.admin.query(`select 1 from subscriptions where user_id = $1`, [await userId(email)])).rowCount).toBe(0);
      expect((await acct(c)).entitlement.access).toBe('account-only');
      expect((await deliver('customer.created', { id: 'cus_x' })).status).toBe(200);
    });
  });

  describe('payment problems, renewals and plan changes', () => {
    it('a failed renewal: access continues for the stated grace, then stops; one email; updating the card (a later paid event) restores it', async () => {
      const s = await subscribe('monthly');
      const start = Math.floor(rig.clock.now.getTime() / 1000);
      fake.patchSub(s.sub.id, { status: 'past_due' }, { current_period_start: start, current_period_end: start + 30 * 86400 });
      const inv = { id: 'in_failed_1', parent: { subscription_details: { subscription: s.sub.id } } };
      expect((await deliver('invoice.payment_failed', inv)).status).toBe(200);
      expect((await deliver('invoice.payment_failed', inv)).status).toBe(200);          // Stripe sends a new event per attempt; same invoice, one notice
      expect((await acct(s.c)).entitlement).toMatchObject({ state: 'past-due', access: 'full' });
      expect((await rig.t.admin.query(`select count(*)::int as n from notifications where user_id = $1 and kind = 'payment-failed'`, [s.uid])).rows[0].n).toBe(1);
      rig.clock.now = new Date(rig.clock.now.getTime() + 4 * DAY);
      expect((await acct(s.c)).entitlement).toMatchObject({ state: 'past-due', access: 'account-only' });
      expect((await coach(s.c)).status).toBe(402);
      fake.patchSub(s.sub.id, { status: 'active' });
      await deliver('invoice.paid', inv);
      expect((await acct(s.c)).entitlement).toMatchObject({ state: 'paid-active', access: 'full' });
      rig.clock.now = new Date();
    });
    it('unpaid ends access; a renewal moves the period and the allowance window stays the same', async () => {
      const s = await subscribe('monthly');
      const w1 = (await acct(s.c)).allowance;
      const endBefore = new Date(s.sub.items.data[0].current_period_end * 1000).getTime();
      fake.renew(s.sub.id);
      await deliver('invoice.paid', { id: 'in_renew', parent: { subscription_details: { subscription: s.sub.id } } });
      const row = await subRow(s.uid);
      expect(new Date(row.current_period_end).getTime()).toBeGreaterThan(endBefore);
      expect((await acct(s.c)).allowance.resetsAt).toBe(w1.resetsAt);
      fake.patchSub(s.sub.id, { status: 'unpaid' });
      await deliver('customer.subscription.updated', fake.subs.get(s.sub.id));
      expect((await acct(s.c)).entitlement).toMatchObject({ state: 'unpaid', access: 'account-only' });
    });
    it('a payment that needs the bank’s confirmation sends one notice', async () => {
      const s = await subscribe('monthly');
      fake.patchSub(s.sub.id, { status: 'past_due' });
      const inv = { id: 'in_sca', parent: { subscription_details: { subscription: s.sub.id } } };
      await deliver('invoice.payment_action_required', inv);
      await deliver('invoice.payment_action_required', inv);
      expect((await rig.t.admin.query(`select count(*)::int as n from notifications where user_id = $1 and kind = 'payment-action-required'`, [s.uid])).rows[0].n).toBe(1);
    });
    it('switching monthly → annual (done in the portal) updates the plan and the amount, and does not reset the AI allowance', async () => {
      const s = await subscribe('monthly');
      expect((await coach(s.c)).status).toBe(200);
      const before = await acct(s.c);
      fake.changePlan(s.sub.id, 'price_annual');
      await deliver('customer.subscription.updated', fake.subs.get(s.sub.id));
      const after = await acct(s.c);
      expect(after.subscription).toMatchObject({ plan: 'annual', amountCents: 25500 });
      expect(after.allowance.used).toBe(before.allowance.used);
      expect(after.allowance.resetsAt).toBe(before.allowance.resetsAt);
      expect(after.allowance.limit).toBe(before.allowance.limit);
    });
  });

  describe('refunds, disputes and duplicate subscriptions', () => {
    it('a full refund ends access and stops billing; a partial refund changes nothing', async () => {
      const s = await subscribe('monthly');
      const cust = fake.subs.get(s.sub.id).customer;
      const partial = fake.addCharge(cust, { amount: 2500 }); partial.amount_refunded = 500;
      await deliver('charge.refunded', partial);
      expect((await acct(s.c)).entitlement.access).toBe('full');
      const full = fake.addCharge(cust, { amount: 2500, refunded: true });
      await deliver('charge.refunded', full);
      expect((await acct(s.c)).entitlement).toMatchObject({ state: 'expired', access: 'account-only' });
      expect(fake.subs.get(s.sub.id).status).toBe('canceled');
      expect((await coach(s.c)).status).toBe(402);
    });
    it('an open dispute pauses access; winning it restores access; events in any order land on the same answer', async () => {
      const s = await subscribe('monthly');
      const cust = fake.subs.get(s.sub.id).customer;
      const ch = fake.addCharge(cust, { amount: 2500 });
      const d = fake.addDispute(ch.id, 'needs_response');
      await deliver('charge.dispute.created', d);
      expect((await acct(s.c)).entitlement).toMatchObject({ state: 'suspended', access: 'account-only' });
      expect((await coach(s.c)).status).toBe(402);
      d.status = 'won';
      await deliver('charge.dispute.closed', d);
      expect((await acct(s.c)).entitlement).toMatchObject({ state: 'paid-active', access: 'full' });
      await deliver('charge.dispute.created', { ...d, status: 'needs_response' });      // a late "created" arrives after "closed"
      expect((await acct(s.c)).entitlement.state).toBe('paid-active');
    });
    it('a dispute that is lost ends access and cancels the subscription', async () => {
      const s = await subscribe('monthly');
      const ch = fake.addCharge(fake.subs.get(s.sub.id).customer, { amount: 2500 });
      const d = fake.addDispute(ch.id, 'lost');
      await deliver('charge.dispute.closed', d);
      expect((await acct(s.c)).entitlement).toMatchObject({ state: 'expired', access: 'account-only' });
      expect(fake.subs.get(s.sub.id).status).toBe('canceled');
    });
    it('a second live subscription for the same person is never recorded, and is stopped at Stripe', async () => {
      const s = await subscribe('monthly');
      const dup = fake.completeCheckout((() => { const id = 'cs_test_dup'; fake.sessions.set(id, { id, customer: fake.subs.get(s.sub.id).customer, line_items: { data: [{ price: 'price_annual' }] }, subscription_metadata: {} }); return id; })(), 'paid');
      const r = await deliver('customer.subscription.created', dup);
      expect(r.status).toBe(200);
      expect((await rig.t.admin.query(`select count(*)::int as n from subscriptions where user_id = $1 and status in ('active','past_due','unpaid','incomplete')`, [s.uid])).rows[0].n).toBe(1);
      expect((await subRow(s.uid)).provider_subscription_id).toBe(s.sub.id);
      expect(fake.subs.get(dup.id).status).toBe('canceled');
    });
  });

  describe('portal, deletion, isolation', () => {
    it('the billing portal is for the signed-in customer only, returns to the app, and needs a billing account', async () => {
      const none = await newUser();
      expect((await none.c.post('/api/billing/portal', {})).status).toBe(404);
      const s = await subscribe('monthly');
      const r = await s.c.post('/api/billing/portal', {});
      expect(r.status).toBe(200);
      expect(r.json.url).toMatch(/^https:\/\/billing\.stripe\.test\//);
      const sent = fake.portalSessions.pop();
      expect(sent.customer).toBe(fake.subs.get(s.sub.id).customer);
      expect(sent.return_url.startsWith(`${ORIGIN}/`)).toBe(true);
      expect((await s.c.post('/api/billing/portal', { customer: 'cus_other' })).status).toBe(200);
      expect(fake.portalSessions.pop().customer).toBe(fake.subs.get(s.sub.id).customer);
    });
    it('one person cannot cancel or change another person’s subscription', async () => {
      const a = await subscribe('monthly'); const b = await newUser();
      expect((await b.c.post('/api/billing/cancel', { subscription: a.sub.id, id: a.sub.id })).status).toBe(404);
      expect(fake.subs.get(a.sub.id).cancel_at_period_end).toBe(false);
      expect((await acct(a.c)).subscription.cancelAtPeriodEnd).toBe(false);
    });
    it('deleting an account stops its subscription first; a late event for that customer is ignored; if Stripe cannot be reached nothing is deleted', async () => {
      const s = await subscribe('monthly');
      const cust = fake.subs.get(s.sub.id).customer;
      fake.failNext = { match: /DELETE \/v1\/subscriptions\//, status: 500, times: 10 };
      const blocked = await s.c.post('/api/auth/delete-user', { password: 'correct horse battery' });
      expect(blocked.status).toBeGreaterThanOrEqual(400);
      fake.failNext = null;
      expect((await rig.t.admin.query('select 1 from "user" where id = $1', [s.uid])).rowCount).toBe(1);
      expect(fake.subs.get(s.sub.id).status).toBe('active');
      const del = await s.c.post('/api/auth/delete-user', { password: 'correct horse battery' });
      expect(del.status).toBe(200);
      expect(fake.subs.get(s.sub.id).status).toBe('canceled');
      expect((await rig.t.admin.query('select 1 from "user" where id = $1', [s.uid])).rowCount).toBe(0);
      expect((await rig.t.admin.query('select count(*)::int as n from subscriptions where user_id = $1', [s.uid])).rows[0].n).toBe(0);
      expect((await rig.t.admin.query('select 1 from deleted_billing_customers where provider_customer_id = $1', [cust])).rowCount).toBe(1);
      const late = await deliver('customer.subscription.updated', fake.subs.get(s.sub.id));
      expect(late.status).toBe(200);
      expect((await rig.t.admin.query('select count(*)::int as n from subscriptions where user_id = $1', [s.uid])).rows[0].n).toBe(0);
    });
    it('two accounts with subscriptions never see each other’s billing or allowance', async () => {
      const a = await subscribe('monthly'); const b = await subscribe('annual');
      await coach(a.c); await coach(a.c).catch(() => undefined);
      const va = await acct(a.c); const vb = await acct(b.c);
      expect(va.subscription.plan).toBe('monthly');
      expect(vb.subscription.plan).toBe('annual');
      expect(vb.allowance.used).toBe(0);
      const ea = (await a.c.get('/api/account/export')).json;
      expect(JSON.stringify(ea)).not.toContain(b.email);
      expect(ea.subscriptions).toHaveLength(1);
    });
  });

  describe('notifications: queued, de-duplicated, retried, and honest about what happened', () => {
    it('a trial about to end and an annual renewal each produce one notice, however often the sweep runs', async () => {
      const u = await newUser();
      await u.c.post('/api/account/trial', {});
      rig.clock.now = new Date(Date.now() + 12 * DAY);
      const uid = await userId(u.email);
      await rig.app.runtime!.tick(); await rig.app.runtime!.tick();
      expect((await rig.t.admin.query(`select count(*)::int as n from notifications where user_id = $1 and kind = 'trial-ending'`, [uid])).rows[0].n).toBe(1);
      const sent = rig.mailer.outbox.filter((m) => m.to === u.email && /trial ends soon/i.test(m.subject));
      expect(sent).toHaveLength(1);
      expect(sent[0].text).toContain('No card was taken');
      expect(sent[0].text).toContain('€255/year');
      expect((await rig.t.admin.query(`select status from notifications where user_id = $1 and kind = 'trial-ending'`, [uid])).rows[0].status).toBe('sent');
      const y = await subscribe('annual');
      rig.clock.now = new Date(Date.now() + 360 * DAY);
      await rig.app.runtime!.tick(); await rig.app.runtime!.tick();
      expect((await rig.t.admin.query(`select count(*)::int as n from notifications where user_id = $1 and kind = 'renewal-upcoming'`, [y.uid])).rows[0].n).toBe(1);
      expect(rig.mailer.outbox.some((m) => m.to === y.email && /renews on/i.test(m.subject) && m.text.includes('€255'))).toBe(true);
      rig.clock.now = new Date();
    });
    it('a provider failure is retried with growing delays, then succeeds; a permanent failure stops; nothing is called "sent" until the provider accepted it', async () => {
      const s = await subscribe('monthly');
      const row = async () => (await rig.t.admin.query(`select status, attempts, last_error_code, next_attempt_at from notifications where user_id = $1 and kind = 'subscription-started'`, [s.uid])).rows[0];
      rig.mailer.failNext = { status: 'failed', retryable: true, code: 'http-503' };
      const t0 = new Date();
      rig.clock.now = t0;
      await rig.app.runtime!.tick();
      let r = await row();
      expect(r).toMatchObject({ status: 'failed', attempts: 1, last_error_code: 'http-503' });
      expect(new Date(r.next_attempt_at).getTime()).toBe(t0.getTime() + 60_000);
      await rig.app.runtime!.tick();                                                       // too soon: nothing happens
      expect((await row()).attempts).toBe(1);
      rig.clock.now = new Date(t0.getTime() + 61_000);
      await rig.app.runtime!.tick();
      r = await row();
      expect(r).toMatchObject({ status: 'sent', attempts: 2 });
      const u = await subscribe('monthly');
      rig.mailer.failNext = { status: 'failed', retryable: false, code: 'http-422' };
      await rig.app.runtime!.tick();
      expect((await rig.t.admin.query(`select status from notifications where user_id = $1 and kind = 'subscription-started'`, [u.uid])).rows[0].status).toBe('dead');
      rig.clock.now = new Date();
    });
  });
});
