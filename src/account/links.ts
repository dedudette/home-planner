/**
 * The addresses people arrive on from an email. After the server handles a confirmation or reset link it sends the browser back to the
 * app with a short code in the query string:
 *
 *   /?verified=1                 the address was confirmed (and the person is signed in if the server could do that)
 *   /?reset=1&token=…            the reset link was valid: show the new-password form
 *   /?error=…                    the link was not valid (expired, already used)
 *
 * `readAuthLink` turns that into a small value; `stripAuthParams` is used right afterwards to take the token out of the address bar so it
 * is not left in history, screenshots or a shared link.
 */
export type AuthLink =
  | { kind: 'none' }
  | { kind: 'verified' }
  | { kind: 'reset'; token: string }
  | { kind: 'bad-link'; what: 'verify' | 'reset' | 'unknown' };

const TOKEN = /^[A-Za-z0-9_\-.~]{8,512}$/;

export const readAuthLink = (search: string): AuthLink => {
  const p = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const error = p.get('error');
  if (p.get('reset') === '1') {
    const token = p.get('token') ?? '';
    if (error || !TOKEN.test(token)) return { kind: 'bad-link', what: 'reset' };
    return { kind: 'reset', token };
  }
  if (p.get('verified') === '1') return error ? { kind: 'bad-link', what: 'verify' } : { kind: 'verified' };
  if (error) return { kind: 'bad-link', what: 'unknown' };
  return { kind: 'none' };
};

const AUTH_PARAMS = ['verified', 'reset', 'token', 'error'];

/** The same address without the auth parameters, keeping the path and the hash route untouched. */
export const stripAuthParams = (href: string): string => {
  const u = new URL(href);
  for (const k of AUTH_PARAMS) u.searchParams.delete(k);
  return `${u.pathname}${u.search}${u.hash}`;
};
