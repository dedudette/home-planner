import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/account/api';
import { describeAuthError } from '../src/account/errors';

const e = (status: number, code = 'X', message = 'm') => new ApiError(status, code, message);

describe('what the person is told when an account request fails', () => {
  it('a wrong password and an unknown email get the same sentence (no way to find out who has an account)', () => {
    const wrong = describeAuthError(e(401, 'INVALID_EMAIL_OR_PASSWORD'), 'sign-in');
    const unknown = describeAuthError(e(401, 'USER_NOT_FOUND'), 'sign-in');
    expect(wrong).toEqual(unknown);
    expect(wrong.message).toMatch(/email or password is not right/i);
    expect(wrong.action).toBeUndefined();
  });
  it('an unconfirmed address offers to send the email again', () => {
    const d = describeAuthError(e(403, 'EMAIL_NOT_VERIFIED'), 'sign-in');
    expect(d.action).toBe('resend-verification');
    expect(d.message).toMatch(/not been confirmed/i);
  });
  it('any other 403 (a refused origin, a proxy) is NOT reported as an unconfirmed address', () => {
    for (const code of ['INVALID_ORIGIN', 'MISSING_OR_NULL_ORIGIN', 'error']) {
      const d = describeAuthError(e(403, code), 'sign-in');
      expect(d.action).not.toBe('resend-verification');
      expect(d.message).not.toMatch(/confirmed|email we sent/i);
      expect(d.message).toMatch(/refused/i);
      expect(d.message).toMatch(/nothing was changed/i);
    }
  });
  it('too many attempts, a server fault and being offline each say what happened and that nothing changed', () => {
    expect(describeAuthError(e(429), 'sign-in').message).toMatch(/too many attempts/i);
    expect(describeAuthError(e(429), 'forgot').message).toMatch(/wait a minute/i);
    const off = describeAuthError(new ApiError(0, 'offline', 'x'), 'sign-up');
    expect(off.message).toMatch(/could not be reached/i);
    expect(off.message).toMatch(/nothing was changed/i);
    expect(off.action).toBe('retry');
    expect(describeAuthError(e(500), 'change-password').message).toMatch(/nothing was changed/i);
    expect(describeAuthError(e(503), 'delete').action).toBe('retry');
    expect(describeAuthError(new Error('boom'), 'sign-in').message).toMatch(/something went wrong/i);
  });
  it('server text is never shown as it is', () => {
    const secret = 'select * from "user" where id = 42 -- internal detail';
    for (const ctx of ['sign-in', 'sign-up', 'forgot', 'reset', 'resend', 'change-password', 'delete', 'sign-out', 'load', 'start-trial', 'checkout', 'sync', 'portal', 'cancel', 'resume', 'export'] as const) {
      for (const status of [400, 401, 403, 404, 409, 422, 500]) expect(describeAuthError(e(status, 'WHATEVER', secret), ctx).message).not.toContain('internal detail');
    }
  });
  it('sign-up: password problems name the limit; anything else is a calm generic line', () => {
    expect(describeAuthError(e(400, 'PASSWORD_TOO_SHORT'), 'sign-up').message).toContain('10');
    expect(describeAuthError(e(400, 'PASSWORD_TOO_LONG'), 'sign-up').message).toContain('128');
    expect(describeAuthError(e(400, 'INVALID_EMAIL'), 'sign-up').message).toMatch(/email address/);
    expect(describeAuthError(e(422, 'USER_ALREADY_EXISTS'), 'sign-up').message).not.toMatch(/already/i);       // must not reveal that the address has an account
  });
  it('reset: an expired or used link offers a new one', () => {
    for (const code of ['INVALID_TOKEN', 'TOKEN_EXPIRED']) {
      const d = describeAuthError(e(400, code), 'reset');
      expect(d.action).toBe('request-new-link');
      expect(d.message).toMatch(/expired or was already used/i);
    }
  });
  it('change password and delete: a wrong current password is said plainly, and delete says nothing was deleted', () => {
    expect(describeAuthError(e(400, 'INVALID_PASSWORD'), 'change-password').message).toMatch(/current password is not right/i);
    expect(describeAuthError(e(401), 'delete').message).toMatch(/nothing was deleted/i);
    expect(describeAuthError(e(500, 'X'), 'delete').message).not.toMatch(/deleted\.$/);
  });
  it('starting the trial: already used, unconfirmed and ended-session each say so; anything else says nothing changed', () => {
    expect(describeAuthError(e(409, 'already-used'), 'start-trial').message).toMatch(/already been used/i);
    expect(describeAuthError(e(403, 'unverified'), 'start-trial').message).toMatch(/confirm your email/i);
    expect(describeAuthError(e(401), 'start-trial').message).toMatch(/sign in again/i);
    const other = describeAuthError(e(500), 'start-trial');
    expect(other.message).toMatch(/nothing was changed/i);
    expect(other.action).toBe('retry');
  });
  it('checkout and the payment check never claim a payment happened', () => {
    expect(describeAuthError(e(409, 'already-subscribed'), 'checkout').message).toMatch(/nothing was charged/i);
    expect(describeAuthError(e(503, 'billing-unavailable'), 'checkout').message).toMatch(/nothing was charged/i);
    expect(describeAuthError(e(500), 'checkout').message).toMatch(/nothing was charged/i);
    expect(describeAuthError(e(500), 'sync').message).toMatch(/nothing is assumed/i);
    expect(describeAuthError(e(429, 'slow-down'), 'sync').message).toMatch(/one moment/i);
  });
  it('a session that ended asks to sign in again', () => {
    expect(describeAuthError(e(401), 'load').message).toMatch(/sign in again/i);
  });
  it('subscription actions: a provider that is down is said to be down, and each action says what did not happen', () => {
    const down = (ctx: 'portal' | 'cancel' | 'resume' | 'checkout') => describeAuthError(e(503, 'billing-unavailable'), ctx);
    expect(down('cancel').message).toMatch(/cancellation was not made/);
    expect(down('cancel').message).toMatch(/unchanged/);
    expect(down('resume').message).toMatch(/nothing was resumed/);
    expect(down('portal').message).toMatch(/not changed/);
    expect(down('checkout').message).toMatch(/Nothing was charged/);
    for (const ctx of ['portal', 'cancel', 'resume'] as const) expect(down(ctx).action).toBe('retry');
    // Any other server fault is generic, and still says the subscription was not changed.
    for (const ctx of ['portal', 'cancel', 'resume'] as const) expect(describeAuthError(e(500, 'X'), ctx).message).toMatch(/not changed/);
    expect(describeAuthError(new ApiError(0, 'offline', 'x'), 'cancel').message).toMatch(/could not be reached.*not changed/);
  });
  it('subscription actions: an ended session asks to sign in again, and missing things are said plainly', () => {
    for (const ctx of ['portal', 'cancel', 'resume', 'export'] as const) expect(describeAuthError(e(401), ctx).message).toMatch(/Sign in again/);
    expect(describeAuthError(e(404, 'no-billing-account'), 'portal').message).toMatch(/no billing account/);
    expect(describeAuthError(e(404, 'no-subscription'), 'cancel').message).toMatch(/no active subscription/);
    expect(describeAuthError(e(404, 'no-subscription'), 'resume').message).toMatch(/no subscription to resume/);
    expect(describeAuthError(e(400, 'X'), 'export').message).toMatch(/Nothing was changed/);
  });

  it('cloud backup failures say what happened to the data on this device and what is true of the cloud copy', () => {
    const off = new ApiError(0, 'offline', 'x');
    expect(describeAuthError(off, 'backup-load').message).toMatch(/on this device is unchanged/i);
    expect(describeAuthError(off, 'backup-restore').message).toMatch(/nothing was restored/i);
    expect(describeAuthError(off, 'backup-delete').message).toMatch(/still there/i);
    // An upload that got no answer must not claim either outcome.
    const save = describeAuthError(off, 'backup-save');
    expect(save.message).toMatch(/cannot tell whether the cloud copy was updated/i);
    expect(save.message).not.toMatch(/nothing was uploaded/i);
    expect(save.action).toBe('retry');
    expect(describeAuthError(e(500), 'backup-save').message).toMatch(/cannot tell whether/i);
    expect(describeAuthError(e(402), 'backup-save').message).toMatch(/needs an active trial or subscription.*nothing was uploaded.*restore it or delete it/is);
    expect(describeAuthError(e(413), 'backup-save').message).toMatch(/5 MB/);
    expect(describeAuthError(e(422), 'backup-save').message).toMatch(/nothing was uploaded/i);
    expect(describeAuthError(e(409, 'conflict'), 'backup-save').message).toMatch(/nothing was overwritten/i);
    for (const ctx of ['backup-load', 'backup-save', 'backup-restore', 'backup-delete'] as const) {
      expect(describeAuthError(e(401), ctx).message).toMatch(/sign in again/i);
      expect(describeAuthError(e(429), ctx).message).toMatch(/too many attempts/i);
    }
  });
  it('restore problems that come from the app itself are told apart, each ending with "nothing was lost" in substance', () => {
    expect(describeAuthError(e(422, 'newer-backup'), 'backup-restore').message).toMatch(/newer version/i);
    expect(describeAuthError(e(422, 'unreadable-backup'), 'backup-restore').message).toMatch(/could not be read/i);
    expect(describeAuthError(e(422, 'no-room'), 'backup-restore').message).toMatch(/restore point/i);
    expect(describeAuthError(e(422, 'not-saved'), 'backup-restore').message).toMatch(/previous plan was put back/i);
    expect(describeAuthError(e(422, 'no-room'), 'backup-save').message).toMatch(/nothing was uploaded and the cloud copy is unchanged/i);
  });
  it('server text is never shown for backups either', () => {
    expect(describeAuthError(e(500, 'X', 'SELECT * FROM user_backups'), 'backup-restore').message).not.toMatch(/SELECT/);
  });
});
