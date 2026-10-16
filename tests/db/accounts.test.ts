import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readServerMode } from '../../server/config';
import { claimKey, normalizeEmail } from '../../server/trial/trial';
import { haveDb } from './helpers';
import { makeRig, ORIGIN, PASSWORD, type Rig } from './rig';

const settle = () => new Promise((r) => setTimeout(r, 30));

describe.skipIf(!haveDb)('accounts, sessions, recovery and the trial (real Better Auth, real PostgreSQL)', () => {
  let rig: Rig;
  beforeAll(async () => { rig = await makeRig(); }, 60_000);
  afterAll(async () => { await rig?.close(); });

  it('sign-up creates an unverified account, sends one confirmation email, and gives no session; sign-in is refused until the email is confirmed', async () => {
    const c = rig.client();
    const r = await c.post('/api/auth/sign-up/email', { email: 'ana@example.test', password: PASSWORD, name: 'Ana', callbackURL: `${ORIGIN}/` });
    expect(r.status).toBe(200);
    expect(c.hasSession()).toBe(false);
    await settle();
    const mails = rig.mailer.outbox.filter((m) => m.to === 'ana@example.test');
    expect(mails).toHaveLength(1);
    expect(mails[0].subject).toMatch(/confirm/i);
    expect(mails[0].text).toContain('/api/auth/verify-email?token=');
    const row = (await rig.t.admin.query(`select "emailVerified" as v from "user" where email = 'ana@example.test'`)).rows[0];
    expect(row.v).toBe(false);
    const signIn = await c.post('/api/auth/sign-in/email', { email: 'ana@example.test', password: PASSWORD });
    expect(signIn.status).toBe(403);
    expect(c.hasSession()).toBe(false);
    expect((await c.get('/api/account')).status).toBe(401);
  });

  it('following the emailed link verifies the account and signs the person in; the session then reaches /api/account', async () => {
    const c = rig.client();
    const r = await c.register(rig, 'ben@example.test');
    expect(r.status).toBeLessThan(400);
    expect(c.hasSession()).toBe(true);
    const a = await c.get('/api/account');
    expect(a.status).toBe(200);
    expect(a.json.account.user).toMatchObject({ email: 'ben@example.test', emailVerified: true });
    expect(a.json.account.entitlement).toMatchObject({ state: 'eligible-not-started', access: 'account-only', canStartTrial: true });
    expect(a.json.account.allowance).toBeNull();
  });

  it('sign-out ends the session on the server: the old cookie no longer works', async () => {
    const c = rig.client();
    await c.register(rig, 'cy@example.test');
    const old = new Map(c.jar);
    expect((await c.post('/api/auth/sign-out', {})).status).toBe(200);
    expect(c.hasSession()).toBe(false);
    const replay = rig.client();
    replay.jar = old;
    expect((await replay.get('/api/account')).status).toBe(401);
  });

  it('a wrong password and an unknown email look the same, and a duplicate sign-up reveals nothing and creates nothing', async () => {
    const c = rig.client();
    await c.register(rig, 'dee@example.test');
    const other = rig.client();
    const wrong = await other.post('/api/auth/sign-in/email', { email: 'dee@example.test', password: 'not the password' });
    const unknown = await other.post('/api/auth/sign-in/email', { email: 'nobody@example.test', password: 'not the password' });
    expect(wrong.status).toBe(unknown.status);
    expect(wrong.json?.message).toBe(unknown.json?.message);
    const before = (await rig.t.admin.query(`select count(*)::int as n from "user" where email = 'dee@example.test'`)).rows[0].n;
    const again = await rig.client().post('/api/auth/sign-up/email', { email: 'dee@example.test', password: PASSWORD, name: 'Dee' });
    expect(again.status).toBe(200);
    expect((await rig.t.admin.query(`select count(*)::int as n from "user" where email = 'dee@example.test'`)).rows[0].n).toBe(before);
  });

  it('short passwords are refused', async () => {
    const r = await rig.client().post('/api/auth/sign-up/email', { email: 'short@example.test', password: 'short', name: 'S' });
    expect(r.status).toBe(400);
    expect((await rig.t.admin.query(`select 1 from "user" where email = 'short@example.test'`)).rowCount).toBe(0);
  });

  it('password reset: the link sets a new password, the old one stops working, and other sessions end', async () => {
    const c = rig.client();
    await c.register(rig, 'eve@example.test');
    const second = rig.client();
    expect((await second.post('/api/auth/sign-in/email', { email: 'eve@example.test', password: PASSWORD })).status).toBe(200);
    const anon = rig.client();
    const before = rig.mailer.outbox.length;
    expect((await anon.post('/api/auth/request-password-reset', { email: 'eve@example.test', redirectTo: `${ORIGIN}/` })).status).toBe(200);
    await settle();
    const mail = rig.mailer.outbox.slice(before).find((m) => /reset/i.test(m.subject))!;
    expect(mail).toBeTruthy();
    const link = mail.text.match(/https?:\/\/\S+/)![0];
    const visit = await anon.call('GET', link.replace(ORIGIN, ''));
    const token = new URL(visit.headers.get('location')!, ORIGIN).searchParams.get('token')!;
    expect(token.length).toBeGreaterThan(10);
    const reset = await anon.post('/api/auth/reset-password', { newPassword: 'a brand new passphrase', token });
    expect(reset.status).toBe(200);
    expect((await rig.client().post('/api/auth/sign-in/email', { email: 'eve@example.test', password: PASSWORD })).status).toBe(401);
    expect((await rig.client().post('/api/auth/sign-in/email', { email: 'eve@example.test', password: 'a brand new passphrase' })).status).toBe(200);
    expect((await second.get('/api/account')).status).toBe(401);          // revoked by the reset
    expect((await anon.post('/api/auth/reset-password', { newPassword: 'another passphrase here', token })).status).toBe(400);   // single use
  });

  it('a session whose time has passed is refused', async () => {
    const c = rig.client();
    await c.register(rig, 'fay@example.test');
    expect((await c.get('/api/account')).status).toBe(200);
    await rig.t.admin.query(`update session set "expiresAt" = now() - interval '1 minute' where "userId" = (select id from "user" where email = 'fay@example.test')`);
    expect((await c.get('/api/account')).status).toBe(401);
  });

  it('sign-in is rate limited per address', async () => {
    const c = rig.client('203.0.113.77');
    await c.register(rig, 'gus@example.test');
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) codes.push((await rig.client('203.0.113.99').post('/api/auth/sign-in/email', { email: 'gus@example.test', password: 'wrong wrong wrong' })).status);
    expect(codes.slice(0, 8).every((s) => s === 401)).toBe(true);
    expect(codes.slice(8)).toContain(429);
    // Someone else, from another address, is not affected.
    expect((await rig.client('203.0.113.55').post('/api/auth/sign-in/email', { email: 'gus@example.test', password: PASSWORD })).status).toBe(200);
  });

  it('requests that did not come from the app’s own origin cannot change anything', async () => {
    const c = rig.client();
    await c.register(rig, 'hal@example.test');
    expect((await c.post('/api/account/trial', {}, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await c.post('/api/account/trial', {}, { origin: '' })).status).toBe(403);
    expect((await c.get('/api/account')).json.account.entitlement.state).toBe('eligible-not-started');
  });

  it('the trial: an explicit request starts exactly 14 days from the server clock, once; a second request changes nothing', async () => {
    const c = rig.client();
    await c.register(rig, 'ivy@example.test');
    rig.clock.now = new Date('2026-03-10T12:00:00Z');
    // Nothing the browser sends can set the dates.
    const r = await c.post('/api/account/trial', { startedAt: '2020-01-01T00:00:00Z', endsAt: '2099-01-01T00:00:00Z', now: '2020-01-01T00:00:00Z' }, { date: 'Tue, 01 Jan 2030 00:00:00 GMT', 'x-client-time': '2030-01-01T00:00:00Z' });
    expect(r.status).toBe(200);
    expect(r.json.account.trial).toEqual({ startedAt: '2026-03-10T12:00:00.000Z', endsAt: '2026-03-24T12:00:00.000Z' });
    expect(r.json.account.entitlement).toMatchObject({ state: 'trial-active', access: 'full' });
    expect(r.json.account.allowance).toMatchObject({ kind: 'trial', limit: 50, used: 0, resetsAt: '2026-03-24T12:00:00.000Z' });
    const again = await c.post('/api/account/trial', {});
    expect(again.status).toBe(409);
    expect(again.json.error.code).toBe('already-used');
    expect((await c.get('/api/account')).json.account.trial.endsAt).toBe('2026-03-24T12:00:00.000Z');
    // Time passes on the server: the trial ends exactly then, and cannot be restarted.
    rig.clock.now = new Date('2026-03-24T12:00:00Z');
    const expired = (await c.get('/api/account')).json.account;
    expect(expired.entitlement).toMatchObject({ state: 'trial-expired', access: 'account-only', canStartTrial: false });
    expect(expired.allowance).toBeNull();
    expect((await c.post('/api/account/trial', {})).status).toBe(409);
    rig.clock.now = new Date('2026-03-10T12:00:00Z');
  });

  it('two simultaneous trial requests start one trial', async () => {
    const c = rig.client();
    await c.register(rig, 'jo@example.test');
    const rs = await Promise.all([c.post('/api/account/trial', {}), c.post('/api/account/trial', {}), c.post('/api/account/trial', {})]);
    expect(rs.map((r) => r.status).sort()).toEqual([200, 409, 409]);
    expect((await rig.t.admin.query(`select count(*)::int as n from trial_claims where user_id = (select id from "user" where email = 'jo@example.test')`)).rows[0].n).toBe(1);
  });

  it('deleting the account needs the password; once deleted, registering again with the same address (or a +tag variant) earns no second trial', async () => {
    const c = rig.client();
    await c.register(rig, 'kim@example.test');
    expect((await c.post('/api/account/trial', {})).status).toBe(200);
    const wrong = await c.post('/api/auth/delete-user', { password: 'not my password' });
    expect(wrong.status).toBeGreaterThanOrEqual(400);
    expect((await rig.t.admin.query(`select 1 from "user" where email = 'kim@example.test'`)).rowCount).toBe(1);
    const del = await c.post('/api/auth/delete-user', { password: PASSWORD });
    expect(del.status).toBe(200);
    expect((await rig.t.admin.query(`select 1 from "user" where email = 'kim@example.test'`)).rowCount).toBe(0);
    expect((await rig.t.admin.query(`select user_id from trial_claims where email_hash = $1`, [claimKey(rig.env.TRIAL_CLAIM_SECRET, 'kim@example.test')])).rows).toEqual([{ user_id: null }]);
    const again = rig.client();
    await again.register(rig, 'kim@example.test');
    const r = await again.post('/api/account/trial', {});
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe('already-used');
    const variant = rig.client();
    await variant.register(rig, 'Kim+promo@Example.test');
    expect((await variant.post('/api/account/trial', {})).status).toBe(409);
  });

  it('two accounts see only their own account and export; nothing in the request names the account', async () => {
    const a = rig.client(); const b = rig.client();
    await a.register(rig, 'lia@example.test'); await b.register(rig, 'max@example.test');
    await a.post('/api/account/trial', {});
    const va = (await a.get('/api/account')).json.account;
    const vb = (await b.get('/api/account')).json.account;
    expect(va.user.email).toBe('lia@example.test');
    expect(vb.user.email).toBe('max@example.test');
    expect(va.entitlement.state).toBe('trial-active');
    expect(vb.entitlement.state).toBe('eligible-not-started');
    // Forged identifiers in every place a client could put one are ignored.
    const forged = await b.call('GET', `/api/account?userId=${va.user.id}&user_id=${va.user.id}`, undefined, { 'x-user-id': va.user.id, authorization: `Bearer ${va.user.id}` });
    expect(forged.json.account.user.email).toBe('max@example.test');
    const ea = (await a.get('/api/account/export')).json;
    const eb = (await b.get('/api/account/export')).json;
    expect(ea.profile.email).toBe('lia@example.test');
    expect(ea.trial).not.toBeNull();
    expect(eb.profile.email).toBe('max@example.test');
    expect(eb.trial).toBeNull();
    expect(JSON.stringify(eb)).not.toContain('lia@example.test');
  });

  it('export, billing information and deletion stay available when the trial has ended; paid features do not', async () => {
    const c = rig.client();
    await c.register(rig, 'noa@example.test');
    await c.post('/api/account/trial', {});
    rig.clock.now = new Date('2026-04-30T00:00:00Z');
    const ex = await c.get('/api/account/export');
    expect(ex.status).toBe(200);
    expect(ex.headers.get('content-disposition')).toContain('attachment');
    expect(ex.json.trial).not.toBeNull();
    expect((await c.get('/api/account')).json.account.entitlement.access).toBe('account-only');
    expect((await c.post('/api/auth/delete-user', { password: PASSWORD })).status).toBe(200);
    rig.clock.now = new Date('2026-03-10T12:00:00Z');
  });

  it('billing is honest when it is not configured', async () => {
    const c = rig.client();
    const cfg = await c.get('/api/config');
    expect(cfg.json).toMatchObject({ mode: 'accounts', accounts: { billing: { available: false, reason: 'not-configured' }, mail: { delivers: true } } });
    await c.register(rig, 'oli@example.test');
    expect((await c.post('/api/billing/checkout', { plan: 'monthly' })).status).toBe(503);
  });
});

describe('server settings fail closed and never print secrets', () => {
  const good = { CLEANFLOW_MODE: 'accounts', APP_ORIGIN: 'http://localhost:5173', DATABASE_URL: 'postgres://u:p@h/db', BETTER_AUTH_SECRET: 'a'.repeat(40), TRIAL_CLAIM_SECRET: 'b'.repeat(40), MAIL_PROVIDER: 'console' };
  it('no DATABASE_URL means the original local mode; REQUIRE_ACCOUNTS=1 without accounts is an error', () => {
    expect(readServerMode({})).toEqual({ kind: 'local' });
    expect(readServerMode({ REQUIRE_ACCOUNTS: '1' })).toMatchObject({ kind: 'invalid' });
  });
  it('a complete set of settings gives accounts mode, with the secrets not enumerable', () => {
    const m = readServerMode(good);
    expect(m.kind).toBe('accounts');
    if (m.kind === 'accounts') {
      expect(JSON.stringify(m.config)).not.toContain('a'.repeat(40));
      expect(JSON.stringify(m.config)).not.toContain('b'.repeat(40));
      expect(m.config.allowance).toEqual({ trial: 50, monthly: 300 });
    }
  });
  it('missing or weak settings are named, and their values are not', () => {
    const m = readServerMode({ ...good, BETTER_AUTH_SECRET: 'short-secret-value', TRIAL_CLAIM_SECRET: undefined, APP_ORIGIN: 'not a url' });
    expect(m.kind).toBe('invalid');
    if (m.kind === 'invalid') {
      const all = m.problems.join(' ');
      expect(all).toContain('BETTER_AUTH_SECRET');
      expect(all).toContain('TRIAL_CLAIM_SECRET');
      expect(all).toContain('APP_ORIGIN');
      expect(all).not.toContain('short-secret-value');
    }
  });
  it('production needs https, a real mail provider, and secrets that differ', () => {
    const prod = { ...good, NODE_ENV: 'production', APP_ORIGIN: 'https://app.example.com', MAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_x', MAIL_FROM: 'CleanFlow <hello@example.com>' };
    expect(readServerMode(prod).kind).toBe('accounts');
    expect(readServerMode({ ...prod, APP_ORIGIN: 'http://app.example.com' }).kind).toBe('invalid');
    expect(readServerMode({ ...prod, MAIL_PROVIDER: 'console' }).kind).toBe('invalid');
    expect(readServerMode({ ...prod, TRIAL_CLAIM_SECRET: good.BETTER_AUTH_SECRET }).kind).toBe('invalid');
    expect(readServerMode({ ...prod, MAIL_PROVIDER: undefined }).kind).toBe('invalid');
  });
  it('email normalisation: case and +tag do not make a second person', () => {
    expect(normalizeEmail(' Kim+Promo@Example.TEST ')).toBe('kim@example.test');
    expect(claimKey('s'.repeat(32), 'Kim+x@example.test')).toBe(claimKey('s'.repeat(32), 'kim@example.test'));
    expect(claimKey('s'.repeat(32), 'kim@example.test')).not.toBe(claimKey('t'.repeat(32), 'kim@example.test'));
  });
});
