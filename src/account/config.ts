import type { PublicConfig } from '../domain/billing/account';

/**
 * How the app learns which mode it runs in. Only two things may select local (no accounts) mode:
 *
 *  1. the server's own, valid answer to GET /api/config: `{ "mode": "local" }`; or
 *  2. a deliberate build setting, `VITE_CLEANFLOW_STANDALONE=1`, for deployments that have no server at all (a static host, the phone app).
 *
 * Anything else (a 404 or 405 from a proxy, an HTML page, malformed JSON, an error status, an answer of the wrong shape) is NOT "no server":
 * it is an unexpected response, and the app shows a recoverable error and leaves the current scope and stored data alone.
 */
export const parseStandalone = (v: unknown): boolean => v === true || v === '1' || v === 'true';
export const isStandalone = (): boolean => parseStandalone((import.meta as { env?: Record<string, unknown> }).env?.VITE_CLEANFLOW_STANDALONE);

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const orNull = (v: unknown): boolean => v === null || typeof v === 'string';

/** The config if it is exactly what the server sends, otherwise null. */
export const validateConfig = (j: unknown): PublicConfig | null => {
  if (!isObj(j)) return null;
  if (j.mode === 'local') return { mode: 'local' };
  if (j.mode !== 'accounts') return null;
  const a = j.accounts;
  if (!isObj(a) || !isObj(a.billing) || !isObj(a.mail) || !isObj(a.legal)) return null;
  const b = a.billing;
  if (typeof b.available !== 'boolean' || !orNull(b.reason) || !(b.mode === null || b.mode === 'test' || b.mode === 'live')) return null;
  if (typeof a.mail.delivers !== 'boolean') return null;
  const l = a.legal;
  if (!['privacy', 'terms', 'billing', 'company'].every((k) => orNull(l[k]))) return null;
  return j as unknown as PublicConfig;
};
