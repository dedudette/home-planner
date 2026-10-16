import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { trialSummary } from '../../src/account/planView';
import { describeAuthError } from '../../src/account/errors';
import { ApiError } from '../../src/account/api';
import { haveDb } from './helpers';
import { makeRig, ORIGIN, PASSWORD, type Rig } from './rig';

/**
 * The contract the Trial & plans screen is built on, checked against the real server code (real Better Auth, real PostgreSQL, the server's
 * own clock). No payment provider is involved. If the server's answers change shape, this fails before the screen does.
 */
describe.skipIf(!haveDb)('the /api/account contract the Trial & plans screen relies on', () => {
  let rig: Rig;
  beforeAll(async () => { rig = await makeRig({ start: '2026-10-16T12:00:00Z' }); }, 60_000);
  afterAll(async () => { await rig?.close(); });

  const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

  it('GET /api/account: the exact top-level fields, ISO timestamps from the server clock, and nothing started by looking', async () => {
    const c = rig.client();
    await c.register(rig, 'con1@example.test');
    const r = await c.get('/api/account');
    expect(r.status).toBe(200);
    expect(r.json.ok).toBe(true);
    const a = r.json.account;
    expect(Object.keys(a).sort()).toEqual(['allowance', 'billing', 'entitlement', 'serverTime', 'subscription', 'trial', 'user']);
    expect(a.serverTime).toBe('2026-10-16T12:00:00.000Z');
    expect(a.trial).toBeNull();
    expect(a.subscription).toBeNull();
    expect(a.allowance).toBeNull();
    expect(a.billing).toMatchObject({ available: false, canManage: false });
    expect(Object.keys(a.entitlement).sort()).toEqual(['access', 'accessEndsAt', 'canStartTrial', 'canSubscribe', 'hasSubscription', 'periodEnd', 'plan', 'reason', 'state', 'trialEndsAt']);
    expect(a.entitlement).toMatchObject({ state: 'eligible-not-started', access: 'account-only', canStartTrial: true, canSubscribe: true, hasSubscription: false, trialEndsAt: null });
    expect(trialSummary(a).phase).toBe('can-start');
    // Reading it again does not start anything.
    expect((await c.get('/api/account')).json.account.trial).toBeNull();
  });

  it('POST /api/account/trial: returns the new account view with the trial dates, exactly 14 days apart, and days left on the server clock', async () => {
    const c = rig.client();
    await c.register(rig, 'con2@example.test');
    const r = await c.post('/api/account/trial', {});
    expect(r.status).toBe(200);
    const a = r.json.account;
    expect(a.trial.startedAt).toMatch(ISO);
    expect(a.trial.endsAt).toMatch(ISO);
    expect(Date.parse(a.trial.endsAt) - Date.parse(a.trial.startedAt)).toBe(14 * 86_400_000);
    expect(a.trial.startedAt).toBe(a.serverTime);
    expect(a.entitlement).toMatchObject({ state: 'trial-active', access: 'full', canStartTrial: false, trialEndsAt: a.trial.endsAt, accessEndsAt: a.trial.endsAt });
    expect(trialSummary(a)).toMatchObject({ phase: 'active', daysLeft: 14, startedAt: a.trial.startedAt, endsAt: a.trial.endsAt });
  });

  it('the dates survive expiry (the screen can say when it ended), the state flips exactly at the end, and a second trial is refused', async () => {
    const c = rig.client();
    await c.register(rig, 'con3@example.test');
    const started = (await c.post('/api/account/trial', {})).json.account.trial;
    const end = Date.parse(started.endsAt);
    rig.clock.now = new Date(end - 1);
    const before = (await c.get('/api/account')).json.account;
    expect(before.entitlement.state).toBe('trial-active');
    expect(trialSummary(before)).toMatchObject({ phase: 'active', daysLeft: 1 });
    rig.clock.now = new Date(end);
    const at = (await c.get('/api/account')).json.account;
    expect(at.entitlement).toMatchObject({ state: 'trial-expired', access: 'account-only', canStartTrial: false, canSubscribe: true });
    expect(at.trial).toEqual(started);
    expect(trialSummary(at)).toMatchObject({ phase: 'expired', endsAt: started.endsAt, daysLeft: null });
    const second = await c.post('/api/account/trial', {});
    expect(second.status).toBe(409);
    expect(second.json.error.code).toBe('already-used');
    expect(describeAuthError(new ApiError(409, second.json.error.code, second.json.error.message), 'start-trial').message).toMatch(/already been used/i);
    rig.clock.now = new Date('2026-10-16T12:00:00Z');
  });

  it('the checkout and sync endpoints answer "unavailable" (not a crash) when billing is not configured', async () => {
    const c = rig.client();
    await c.register(rig, 'con4@example.test');
    const r = await c.post('/api/billing/checkout', { plan: 'monthly' });
    expect(r.status).toBe(503);
    expect(r.json.error.code).toBe('billing-not-configured');
    for (const code of ['billing-not-configured', 'billing-unavailable']) {
      const m = describeAuthError(new ApiError(503, code, ''), 'checkout').message;
      expect(m, code).toMatch(/not available just now.*nothing was charged/i);
    }
  });

  it('the real error codes behind the sign-in messages: unconfirmed is EMAIL_NOT_VERIFIED; other 403s carry other codes and are not reported as unconfirmed', async () => {
    const c = rig.client();
    await c.post('/api/auth/sign-up/email', { email: 'con5@example.test', password: PASSWORD, name: 'Con', callbackURL: `${ORIGIN}/` });
    const unconfirmed = await c.post('/api/auth/sign-in/email', { email: 'con5@example.test', password: PASSWORD });
    expect(unconfirmed.status).toBe(403);
    expect(unconfirmed.json.code).toBe('EMAIL_NOT_VERIFIED');
    expect(describeAuthError(new ApiError(403, unconfirmed.json.code, ''), 'sign-in').action).toBe('resend-verification');
    // A refused origin on an account endpoint is also a 403, with the server's own code.
    const s = rig.client();
    await s.register(rig, 'con6@example.test');
    const refused = await s.post('/api/account/trial', {}, { origin: 'https://evil.example' });
    expect(refused.status).toBe(403);
    expect(refused.json.error.code).toBe('origin');
    const d = describeAuthError(new ApiError(403, refused.json.error.code, ''), 'sign-in');
    expect(d.action).not.toBe('resend-verification');
    expect(d.message).not.toMatch(/confirmed/i);
  });
});
