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
    for (const x of [e(403, 'EMAIL_NOT_VERIFIED'), e(403)]) {
      const d = describeAuthError(x, 'sign-in');
      expect(d.action).toBe('resend-verification');
      expect(d.message).toMatch(/not been confirmed/i);
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
    for (const ctx of ['sign-in', 'sign-up', 'forgot', 'reset', 'resend', 'change-password', 'delete', 'sign-out', 'load'] as const) {
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
  it('a session that ended asks to sign in again', () => {
    expect(describeAuthError(e(401), 'load').message).toMatch(/sign in again/i);
  });
});
