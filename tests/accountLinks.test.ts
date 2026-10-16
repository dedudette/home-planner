import { describe, expect, it } from 'vitest';
import { readAuthLink, stripAuthParams } from '../src/account/links';

describe('links people arrive on from an email', () => {
  it('no parameters, or unrelated ones, mean nothing to do', () => {
    expect(readAuthLink('')).toEqual({ kind: 'none' });
    expect(readAuthLink('?utm=1&x=2')).toEqual({ kind: 'none' });
  });
  it('a confirmed address', () => {
    expect(readAuthLink('?verified=1')).toEqual({ kind: 'verified' });
    expect(readAuthLink('verified=1')).toEqual({ kind: 'verified' });
  });
  it('a valid reset link carries its token to the new-password form', () => {
    expect(readAuthLink('?reset=1&token=abcDEF1234567890xyz')).toEqual({ kind: 'reset', token: 'abcDEF1234567890xyz' });
  });
  it('a reset link with no token, a malformed token or an error is a bad link, never a form', () => {
    for (const q of ['?reset=1', '?reset=1&token=', '?reset=1&token=short', '?reset=1&token=has spaces in it here', '?reset=1&token=abcDEF1234567890xyz&error=INVALID_TOKEN', `?reset=1&token=${'a'.repeat(600)}`, '?reset=1&token=<script>alert(1)</script>']) {
      expect(readAuthLink(q), q).toEqual({ kind: 'bad-link', what: 'reset' });
    }
  });
  it('an expired or used confirmation link, and any other error, is a bad link', () => {
    expect(readAuthLink('?verified=1&error=invalid_token')).toEqual({ kind: 'bad-link', what: 'verify' });
    expect(readAuthLink('?error=TOKEN_EXPIRED')).toEqual({ kind: 'bad-link', what: 'unknown' });
  });
  it('stripping removes only the account parameters and keeps the path, other parameters and the hash route', () => {
    expect(stripAuthParams('http://localhost:5173/?reset=1&token=abcDEF1234567890xyz')).toBe('/');
    expect(stripAuthParams('http://localhost:5173/?verified=1#/today')).toBe('/#/today');
    expect(stripAuthParams('http://localhost:5173/app?x=1&token=abcDEF1234567890xyz&error=E#/plan')).toBe('/app?x=1#/plan');
  });
});
