import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { decideAccess, type AccessSnapshot } from '../../src/account/access';
import type { AccountView } from '../../src/domain/billing/account';
import { startFakeStripe, type FakeStripe } from '../support/fakeStripe';
import { haveDb } from './helpers';
import { Client, makeRig, ORIGIN, PASSWORD, type Rig } from './rig';

/**
 * The planner gate's contract with the real server: what the gate decides from the account view the server really sends, state by state,
 * and that the server refuses the paid operations in exactly the states the gate closes. Real PostgreSQL, real Better Auth, the server's own
 * clock. The payment provider is a MOCK (tests/support/fakeStripe.ts: the real Stripe SDK talking to a local stand-in), so this proves the
 * app's behaviour given plausible provider answers; it is NOT a Stripe verification.
 */
const DAY = 86_400_000;
const sidOf = (url: string) => url.split('/').pop()!;

describe.skipIf(!haveDb)('the planner gate against the real server (mock payment provider, real everything else)', () => {
  let rig: Rig;
  let fake: FakeStripe;
  let n = 0;
  const view = async (c: Client): Promise<AccountView> => (await c.get('/api/account')).json.account;
  /** What the gate would decide from the server's answer, on this device, `after` ms after the answer arrived. */
  const gate = (v: AccountView, after = 0, reachable = true): string => {
    const snap: AccessSnapshot = { view: v, verifiedAt: 1_000_000, reachable };
    return decideAccess(snap, 1_000_000 + after).kind;
  };
  const deliver = async (type: string, obj: unknown) => {
    const e = fake.event(type, obj);
    const res = await rig.app.handler(new Request(`${ORIGIN}/api/billing/webhook`, { method: 'POST', headers: { 'stripe-signature': e.header, 'content-type': 'application/json', 'x-coach-client': '54.0.0.1' }, body: e.payload }));
    expect(res!.status).toBe(200);
  };
  const account = async (trial = false) => {
    const email = `gc${++n}@example.test`;
    const c = rig.client();
    await c.register(rig, email);
    if (trial) expect((await c.post('/api/account/trial', {})).status).toBe(200);
    return { c, email };
  };
  const subscribe = async (plan: 'monthly' | 'annual' = 'monthly') => {
    const { c, email } = await account();
    const r = await c.post('/api/billing/checkout', { plan });
    const sid = sidOf(r.json.url);
    const sub = fake.completeCheckout(sid, 'paid');
    await deliver('checkout.session.completed', fake.sessions.get(sid));
    rig.clock.now = new Date();
    return { c, email, sub };
  };

  beforeAll(async () => {
    fake = await startFakeStripe();
    fake.seedPrice('price_monthly', { amount: 2500, interval: 'month' });
    fake.seedPrice('price_annual', { amount: 25500, interval: 'year' });
    rig = await makeRig({ start: new Date().toISOString(), env: { STRIPE_SECRET_KEY: 'sk_test_fake_0123456789', STRIPE_WEBHOOK_SECRET: fake.webhookSecret, STRIPE_PRICE_MONTHLY: 'price_monthly', STRIPE_PRICE_ANNUAL: 'price_annual', BILLING_TAX_MODE: 'stripe_tax_inclusive', STRIPE_API_BASE_URL: fake.base } });
    for (let i = 0; i < 100 && !rig.app.runtime!.billing!.status().available; i++) await new Promise((r) => setTimeout(r, 50));
  }, 60_000);
  beforeEach(() => { if (fake) fake.failNext = null; if (rig) rig.clock.now = new Date(); });
  afterAll(async () => { await rig?.close(); await fake?.close(); });

  it('a verified account with no trial is closed, and the trial is not started by anything the gate or the account reads do', async () => {
    const { c } = await account();
    const v = await view(c);
    expect(v.entitlement).toMatchObject({ state: 'eligible-not-started', access: 'account-only', canStartTrial: true });
    expect(gate(v)).toBe('blocked');
    for (let i = 0; i < 3; i++) await c.get('/api/account');
    expect((await view(c)).trial).toBeNull();
  });

  it('starting the trial opens it for exactly 14 days of the server’s clock; the gate asks again at the end and the server then closes it', async () => {
    const { c } = await account();
    expect((await c.post('/api/account/trial', {})).status).toBe(200);
    const v = await view(c);
    expect(v.entitlement).toMatchObject({ state: 'trial-active', access: 'full' });
    expect(Date.parse(v.entitlement.accessEndsAt!) - Date.parse(v.trial!.startedAt)).toBe(14 * DAY);
    expect(gate(v, 13 * DAY)).toBe('allowed');
    expect(gate(v, 14 * DAY + 1000)).toBe('reconfirm');
    rig.clock.now = new Date(rig.clock.now.getTime() + 14 * DAY + 1000);
    const after = await view(c);
    expect(after.entitlement).toMatchObject({ state: 'trial-expired', access: 'account-only' });
    expect(gate(after)).toBe('blocked');
  });

  it('a subscription opens it; cancelling at the period end keeps it open to the exact end of the paid period, then the server closes it', async () => {
    const { c, email, sub } = await subscribe();
    const v = await view(c);
    expect(v.entitlement).toMatchObject({ state: 'paid-active', access: 'full' });
    expect(gate(v)).toBe('allowed');
    // Cancel at period end, through the provider (as the billing portal would).
    fake.patchSub(sub.id, { cancel_at_period_end: true, canceled_at: Math.floor(Date.now() / 1000) });
    await deliver('customer.subscription.updated', sub);
    const c2 = await view(c);
    expect(c2.entitlement).toMatchObject({ state: 'cancellation-scheduled', access: 'full', accessEndsAt: c2.subscription!.currentPeriodEnd });
    expect(gate(c2)).toBe('allowed');
    const end = Date.parse(c2.subscription!.currentPeriodEnd);
    rig.clock.now = new Date(end - 60_000);
    expect(await view(c)).toMatchObject({ entitlement: { state: 'cancellation-scheduled', access: 'full' } });
    rig.clock.now = new Date(end + 1000);
    const ended = await view(c);
    expect(ended.entitlement).toMatchObject({ state: 'expired', access: 'account-only' });
    expect(gate(ended)).toBe('blocked');
    void email;
  });

  it('a failed renewal stays open through the grace and closes after it; unpaid and a dispute close it, and recovering reopens it; a refund ends it', async () => {
    const { c, sub } = await subscribe();
    const nowSec = () => Math.floor(rig.clock.now.getTime() / 1000);
    fake.patchSub(sub.id, { status: 'past_due' }, { current_period_start: nowSec(), current_period_end: nowSec() + 30 * 86400 });
    await deliver('invoice.payment_failed', { id: 'in_gc1', parent: { subscription_details: { subscription: sub.id } } });
    const inGrace = await view(c);
    expect(inGrace.entitlement).toMatchObject({ state: 'past-due', access: 'full' });
    expect(gate(inGrace)).toBe('allowed');
    rig.clock.now = new Date(rig.clock.now.getTime() + 4 * DAY);
    const afterGrace = await view(c);
    expect(afterGrace.entitlement).toMatchObject({ state: 'past-due', access: 'account-only' });
    expect(gate(afterGrace)).toBe('blocked');
    fake.patchSub(sub.id, { status: 'unpaid' });
    await deliver('customer.subscription.updated', sub);
    expect(gate(await view(c))).toBe('blocked');
    fake.patchSub(sub.id, { status: 'active' }, { current_period_start: nowSec(), current_period_end: nowSec() + 30 * 86400 });
    await deliver('invoice.paid', { id: 'in_gc2', parent: { subscription_details: { subscription: sub.id } } });
    expect(gate(await view(c))).toBe('allowed');
    const ch = fake.addCharge([...fake.customers.values()].pop()!.id, { amount: 2500 });
    await deliver('charge.dispute.created', fake.addDispute(ch.id, 'needs_response'));
    expect((await view(c)).entitlement).toMatchObject({ state: 'suspended', access: 'account-only' });
    expect(gate(await view(c))).toBe('blocked');
    await deliver('charge.dispute.created', fake.addDispute(ch.id, 'won'));
    expect(gate(await view(c))).toBe('allowed');
    await deliver('charge.refunded', fake.addCharge([...fake.customers.values()].pop()!.id, { amount: 2500, refunded: true }));
    expect((await view(c)).entitlement).toMatchObject({ state: 'expired', access: 'account-only' });
    expect(gate(await view(c))).toBe('blocked');
  });

  it('a first payment that needs another step keeps it closed', async () => {
    const { c } = await account();
    const r = await c.post('/api/billing/checkout', { plan: 'monthly' });
    const sid = sidOf(r.json.url);
    await deliver('customer.subscription.created', fake.completeCheckout(sid, 'requires-action'));
    const v = await view(c);
    expect(v.entitlement).toMatchObject({ state: 'payment-action-required', access: 'account-only' });
    expect(gate(v)).toBe('blocked');
  });

  it('the server refuses the paid operations in exactly the states the gate closes, and keeps the account operations open in them', async () => {
    const closed = await account();                                   // never started a trial
    const expired = await account(true);
    rig.clock.now = new Date(rig.clock.now.getTime() + 15 * DAY);
    const open = await account(true);
    const put = (c: Client) => c.call('PUT', '/api/account/backup', { baseRevision: null, includes: [], data: {} });
    for (const who of [closed, expired]) {
      const v = await view(who.c);
      expect(gate(v)).toBe('blocked');
      expect((await put(who.c)).status).toBe(402);                      // cloud backup upload: refused by the server
    }
    expect(gate(await view(open.c))).toBe('allowed');
    expect((await put(open.c)).status).not.toBe(402);                  // allowed through to validation (422: not a CleanFlow plan)
    // What stays open when the planner is closed: export, reading and deleting a cloud backup, the billing page, and deletion.
    for (const who of [closed, expired]) {
      expect((await who.c.get('/api/account/export')).status).toBe(200);
      expect((await who.c.get('/api/account/backup')).status).toBe(200);
      expect((await who.c.call('DELETE', '/api/account/backup')).status).toBe(200);
      expect((await who.c.post('/api/billing/checkout', { plan: 'monthly' })).status).toBe(200);
    }
    expect((await expired.c.post('/api/auth/delete-user', { password: PASSWORD })).status).toBe(200);
  });

  it('the account view carries the server’s own time, which is what the gate counts from (not the device’s date)', async () => {
    const { c } = await account(true);
    const v = await view(c);
    expect(Math.abs(Date.parse(v.serverTime) - rig.clock.now.getTime())).toBeLessThan(5000);
  });
});
