import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, getConfig } from '../src/account/api';

const answer = (status: number, body: string, type = 'application/json') =>
  vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status, headers: { 'content-type': type } })));
const failure = async (): Promise<ApiError> => {
  const err = await getConfig().then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(ApiError);
  return err as ApiError;
};

const ACCOUNTS = { mode: 'accounts', accounts: { billing: { available: false, reason: 'not-configured', mode: null }, mail: { delivers: false }, legal: { privacy: null, terms: null, billing: null, company: null } } };

afterEach(() => vi.unstubAllGlobals());

describe('getConfig: only a valid, explicit answer selects a mode', () => {
  it('reads accounts mode and local mode from the server\'s own JSON', async () => {
    answer(200, JSON.stringify(ACCOUNTS));
    expect((await getConfig()).mode).toBe('accounts');
    answer(200, JSON.stringify({ mode: 'local' }));
    expect(await getConfig()).toEqual({ mode: 'local' });
  });
  it('a 200 HTML page (a static host or proxy answering every path with the app) is NOT local mode', async () => {
    answer(200, '<!doctype html><title>app</title>', 'text/html');
    const e = await failure();
    expect(e.offline).toBe(false);
    expect(e.code).toBe('config-not-json');
  });
  it('malformed JSON is an error, not local mode', async () => {
    for (const body of ['{"mode":', '', 'null{', '{"mode":"local"']) {
      answer(200, body);
      const e = await failure();
      expect(e.offline, body).toBe(false);
      expect(e.code, body).toBe('config-not-json');
    }
  });
  it('JSON of the wrong shape is an error, not local mode', async () => {
    const wrong: unknown[] = [null, [], 'local', 42, {}, { mode: 'nope' }, { mode: 'Local' }, { mode: 'accounts' }, { mode: 'accounts', accounts: {} },
      { mode: 'accounts', accounts: { ...ACCOUNTS.accounts, mail: { delivers: 'yes' } } },
      { mode: 'accounts', accounts: { ...ACCOUNTS.accounts, billing: { available: true, reason: null, mode: 'sandbox' } } },
      { mode: 'accounts', accounts: { ...ACCOUNTS.accounts, legal: { privacy: 1, terms: null, billing: null, company: null } } }];
    for (const body of wrong) {
      answer(200, JSON.stringify(body));
      const e = await failure();
      expect(e.code, JSON.stringify(body)).toBe('config-invalid');
    }
  });
  it('404, 405 and 410 (a proxy or a broken deployment) are errors, never "no server"', async () => {
    for (const status of [404, 405, 410]) {
      answer(status, status === 404 ? '<h1>Not found</h1>' : '', 'text/html');
      const e = await failure();
      expect(e.status).toBe(status);
      expect(e.offline).toBe(false);
    }
  });
  it('a failing server (5xx, 429, 401, 403) is an error; the status is kept', async () => {
    for (const status of [500, 502, 503, 504, 429, 401, 403]) {
      answer(status, JSON.stringify({ error: 'down' }));
      const e = await failure();
      expect(e.status).toBe(status);
      expect(e.offline).toBe(false);
    }
  });
  it('a valid-looking config body behind an error status is still an error', async () => {
    answer(503, JSON.stringify({ mode: 'local' }));
    expect((await failure()).status).toBe(503);
  });
  it('no answer at all is an offline error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network'); }));
    expect((await failure()).offline).toBe(true);
  });
});
