import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, getConfig } from '../src/account/api';

const answer = (status: number, body: string, type = 'application/json') =>
  vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status, headers: { 'content-type': type } })));

afterEach(() => vi.unstubAllGlobals());

describe('getConfig: "there is no server" is told apart from "the server is failing"', () => {
  it('reads the server mode when it answers with JSON', async () => {
    answer(200, JSON.stringify({ mode: 'accounts', accounts: {} }));
    expect((await getConfig())?.mode).toBe('accounts');
    answer(200, JSON.stringify({ mode: 'local' }));
    expect((await getConfig())?.mode).toBe('local');
  });
  it('no server behind the app (the app page answers, or the path does not exist) is null, i.e. a local app', async () => {
    answer(200, '<!doctype html><title>app</title>', 'text/html');
    expect(await getConfig()).toBeNull();
    for (const status of [404, 405, 410]) { answer(status, ''); expect(await getConfig()).toBeNull(); }
  });
  it('a server that is there but failing is an error, never "local": an outage must not switch an accounts deployment to the original storage', async () => {
    for (const status of [500, 502, 503, 504, 429, 401, 403]) {
      answer(status, JSON.stringify({ error: 'down' }));
      const err = await getConfig().then(() => null, (e: unknown) => e);
      expect(err, `HTTP ${status}`).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(status);
      expect((err as ApiError).offline).toBe(false);
    }
  });
  it('no answer at all is an offline error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network'); }));
    const err = await getConfig().then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).offline).toBe(true);
  });
});
