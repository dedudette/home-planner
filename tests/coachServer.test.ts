import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildCoachPayload, METRIC_IDS, validatePayload, type CoachPayload } from '../src/domain/coach/metrics';
import { computePatterns } from '../src/domain/patterns';
import { readCoachConfig } from '../server/coach/config';
import { createCoachHandler } from '../server/coach/handler';
import { createLimiter } from '../server/coach/limiter';
import { buildPrompt, SYSTEM_PROMPT } from '../server/coach/prompt';
import { handleNodeRequest } from '../server/nodeAdapter';
import { lived, range } from './coachHelpers';
import { TODAY } from './helpers';

const KEY = 'sk-test-DO-NOT-LEAK-0123456789';
const payload: CoachPayload = buildCoachPayload(computePatterns(lived(range(-9, 0), { doneEach: 2, skipEach: 1, minutes: 20, focus: ['home', 'discipline', 'morning', 'evening'] }), TODAY, 14))!;
const M = payload.metrics;
const evidenceStrength = (p: CoachPayload) => { const v = validatePayload(p); if (!v.ok) throw new Error('fixture'); return v.strength; };

const messageBody = (text: string, stop = 'end_turn') => JSON.stringify({ id: 'msg_test', type: 'message', role: 'assistant', model: 'test-model', content: text === '' ? [] : [{ type: 'text', text }], stop_reason: stop, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 } });
const reply = (text: string, stop?: string) => new Response(messageBody(text, stop), { status: 200, headers: { 'content-type': 'application/json' } });
const errorReply = (status: number, type: string, message: string) => new Response(JSON.stringify({ type: 'error', error: { type, message } }), { status, headers: { 'content-type': 'application/json' } });

const good = () => JSON.stringify({ suggestions: [{ kind: 'pattern', title: 'Opened days and completed tasks', explanation: `The app was opened on ${M['days.opened']} of ${payload.windowDays} days, and ${M['tasks.seenCompleted']} of ${M['tasks.seen']} tasks shown on Today were completed.`, metric_ids: ['days.opened', 'tasks.seen', 'tasks.seenCompleted'], strength: 'good' }] });

interface Call { url: string; headers: Record<string, string>; body: any }
const rig = (respond: (c: Call, init: RequestInit) => Promise<Response> | Response, extraEnv: Record<string, string> = {}, now = () => 1_000_000) => {
  const calls: Call[] = [];
  const logs: unknown[] = [];
  const env = { ANTHROPIC_API_KEY: KEY, COACH_COOLDOWN_SECONDS: '30', ...extraEnv };
  const fetchImpl = (async (input: unknown, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => { headers[k] = v; });
    const call: Call = { url: String(input instanceof Request ? input.url : input), headers, body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    return respond(call, init ?? {});
  }) as typeof fetch;
  const handler = createCoachHandler({ env: () => env, fetch: fetchImpl, now, log: (e) => logs.push(e) });
  return { handler, calls, logs, env };
};

const ask = (body: unknown = payload, headers: Record<string, string> = {}, client = 'client-1') =>
  new Request('http://app.test/api/coach', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://app.test', 'x-coach-client': client, ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const status = () => new Request('http://app.test/api/coach/status', { method: 'GET' });
const read = async (r: Response | null) => { expect(r).not.toBeNull(); return { status: r!.status, text: await r!.clone().text(), json: await r!.json() as any, headers: r!.headers }; };

afterEach(() => { vi.useRealTimers(); });

describe('not set up: nothing is attempted and nothing is revealed', () => {
  it('status says unavailable; a request is refused before anything else happens', async () => {
    const calls: unknown[] = [];
    const h = createCoachHandler({ env: () => ({}), fetch: (async (...a: unknown[]) => { calls.push(a); return reply(good()); }) as typeof fetch, log: () => undefined });
    const s = await read(await h(status()));
    expect(s.json).toEqual({ available: false });
    const a = await read(await h(ask()));
    expect(a.status).toBe(503);
    expect(a.json.error.code).toBe('not-configured');
    expect(a.text).not.toMatch(/ANTHROPIC|API_KEY|env/i);
    expect(calls).toHaveLength(0);
  });

  it('can be switched off while the key stays in place, and an unknown provider is refused', async () => {
    expect(readCoachConfig({ ANTHROPIC_API_KEY: KEY, COACH_DISABLED: '1' })).toMatchObject({ available: false, reason: 'disabled' });
    expect(readCoachConfig({ ANTHROPIC_API_KEY: KEY, COACH_PROVIDER: 'other' })).toMatchObject({ available: false, reason: 'unsupported-provider' });
    expect(readCoachConfig({ ANTHROPIC_API_KEY: '   ' })).toMatchObject({ available: false, reason: 'not-configured', missing: ['ANTHROPIC_API_KEY'] });
  });

  it('REGRESSION: settings left empty (VAR=) count as not set, not as an unknown provider', () => {
    const c = readCoachConfig({ ANTHROPIC_API_KEY: KEY, COACH_PROVIDER: '', COACH_MODEL: '  ', COACH_API_BASE_URL: '', COACH_TIMEOUT_MS: '', COACH_ALLOWED_ORIGINS: ' , ' });
    expect(c.available).toBe(true);
    expect(c.available && c.config).toMatchObject({ provider: 'anthropic', model: 'claude-opus-5-5', timeoutMs: 45000, allowedOrigins: [] });
    expect(c.available && c.config.baseUrl).toBeUndefined();
  });

  it('paths it does not own fall through to the host', async () => {
    const { handler } = rig(() => reply(good()));
    expect(await handler(new Request('http://app.test/index.html'))).toBeNull();
    expect(await handler(new Request('http://app.test/api/other'))).toBeNull();
  });
});

describe('a request goes to the provider exactly as designed', () => {
  it('sends the model, the output limit and the prompt, with the key in the provider header only, and no sampling or thinking settings', async () => {
    const { handler, calls } = rig(() => reply(good()), { COACH_MODEL: 'claude-test-model', COACH_MAX_OUTPUT_TOKENS: '3000' });
    const r = await read(await handler(ask()));
    expect(r.status).toBe(200);
    expect(calls).toHaveLength(1);
    const c = calls[0];
    expect(c.url).toMatch(/\/v1\/messages$/);
    expect(c.headers['x-api-key']).toBe(KEY);
    expect(c.body.model).toBe('claude-test-model');
    expect(c.body.max_tokens).toBe(3000);
    expect(c.body.output_config).toEqual({ effort: 'low' });
    for (const k of ['temperature', 'top_p', 'top_k', 'thinking', 'tools', 'stream']) expect(c.body[k]).toBeUndefined();
    expect(c.body.system).toBe(SYSTEM_PROMPT);
    expect(c.body.messages).toHaveLength(1);
    expect(c.body.messages[0].role).toBe('user');
  });

  it('the message is the window and the registered counts: nothing else, in a fixed layout', async () => {
    const { handler, calls } = rig(() => reply(good()));
    await handler(ask());
    const user: string = calls[0].body.messages[0].content;
    expect(user).toBe(buildPrompt(payload, evidenceStrength(payload)).user);
    expect(user.split('\n')).toHaveLength(3 + METRIC_IDS.length);              // window, strength, header, then one line per count
    for (const id of METRIC_IDS) expect(user).toContain(`${id} | `);
    expect(user).not.toMatch(/Zebediah|@|https?:|2026-/);
  });

  it('defaults to claude-opus-5-5, and the model is a server setting only', async () => {
    const a = rig(() => reply(good()));
    await a.handler(ask());
    expect(a.calls[0].body.model).toBe('claude-opus-5-5');
    const b = rig(() => reply(good()));
    await b.handler(ask({ ...payload, model: 'cheap-model' } as unknown as CoachPayload));       // a client cannot pick the model: the extra field is refused
    expect(b.calls).toHaveLength(0);
  });

  it('the status response names who would receive the request and the cooldown, and nothing secret', async () => {
    const { handler } = rig(() => reply(good()), { COACH_MODEL: 'claude-test-model', COACH_COOLDOWN_SECONDS: '45' });
    const s = await read(await handler(status()));
    expect(s.json).toEqual({ available: true, provider: 'Anthropic', model: 'claude-test-model', cooldownSeconds: 45 });
    expect(s.text).not.toContain(KEY);
  });

  it('returns suggestions that passed the checks, with the provider and model for the "AI-generated" label', async () => {
    const { handler } = rig(() => reply(good()));
    const r = await read(await handler(ask()));
    expect(r.json.ok).toBe(true);
    expect(r.json.suggestions).toHaveLength(1);
    expect(r.json.suggestions[0].metricIds).toEqual(['days.opened', 'tasks.seen', 'tasks.seenCompleted']);
    expect(r.json.meta).toEqual({ provider: 'Anthropic', model: 'claude-opus-5-5' });
    expect(r.headers.get('cache-control')).toBe('no-store');
  });
});

describe('the key and the request never leak', () => {
  it('the key appears in no response, header, log line or printed settings', async () => {
    const scenarios: [string, () => Promise<Response> | Response][] = [
      ['ok', () => reply(good())], ['bad json', () => reply('nope')], ['401', () => errorReply(401, 'authentication_error', `invalid x-api-key ${KEY}`)],
      ['500', () => errorReply(500, 'api_error', `boom ${KEY}`)], ['429', () => errorReply(429, 'rate_limit_error', 'slow down')],
    ];
    for (const [name, respond] of scenarios) {
      const { handler, logs, env } = rig(respond);
      const out = [await read(await handler(status())), await read(await handler(ask())), await read(await handler(ask(payload, {}, 'client-2')))];
      const everything = JSON.stringify([out.map((o) => [o.text, [...o.headers.entries()]]), logs]);
      expect(everything, name).not.toContain(KEY);
      expect(everything, name).not.toContain('sk-test');
      const cfg = readCoachConfig(env);
      expect(cfg.available && JSON.stringify(cfg.config)).not.toContain(KEY);
      expect(cfg.available && String(Object.values(cfg.config))).not.toContain(KEY);
    }
  });

  it('REGRESSION: the submitted counts are never logged, and log lines are only an event name and a short code', async () => {
    const { handler, logs } = rig((c) => (c.body ? reply('not json') : reply(good())));
    await handler(ask());                                              // unusable answer → logged
    await handler(ask(payload, {}, 'client-2'));
    await handler(ask({ nope: 1 }));                                   // invalid → refused
    await handler(ask(payload, { origin: 'http://evil.test' }, 'client-3'));
    const text = JSON.stringify(logs);
    expect(logs.length).toBeGreaterThan(0);
    for (const l of logs as Record<string, unknown>[]) expect(Object.keys(l).every((k) => k === 'event' || k === 'code')).toBe(true);
    for (const id of METRIC_IDS) expect(text).not.toContain(id);
    expect(text).not.toContain('metrics');
    expect(text).not.toContain('not json');
  });

  it('provider error text never reaches the browser', async () => {
    const { handler } = rig(() => errorReply(401, 'authentication_error', 'secret detail: your account is xyz'));
    const r = await read(await handler(ask()));
    expect(r.status).toBe(502);
    expect(r.text).not.toContain('secret detail');
    expect(r.text).not.toContain('xyz');
    expect(r.json.error.code).toBe('provider-unavailable');
    expect(r.json.error.message).toMatch(/Nothing was changed/);
  });
});

describe('requests are checked before anything is spent', () => {
  const noCall = async (req: Request, expected: number, code: string, extraEnv: Record<string, string> = {}) => {
    const { handler, calls } = rig(() => reply(good()), extraEnv);
    const r = await read(await handler(req));
    expect(r.status).toBe(expected);
    expect(r.json.error.code).toBe(code);
    expect(calls).toHaveLength(0);
  };

  it('wrong method, wrong content type, unreadable or oversized body', async () => {
    await noCall(new Request('http://app.test/api/coach', { method: 'GET' }), 405, 'method');
    await noCall(ask(payload, { 'content-type': 'text/plain' }), 415, 'content-type');
    await noCall(ask('{not json'), 400, 'invalid');
    await noCall(ask(JSON.stringify({ pad: 'x'.repeat(6000) })), 413, 'too-large');
    await noCall(ask(payload, { 'content-length': '999999' }), 413, 'too-large');
  });

  it('anything but the fixed counts: extra fields, text, odd values, a forged sufficiency', async () => {
    await noCall(ask({ ...payload, note: 'hi' }), 400, 'invalid');
    await noCall(ask({ ...payload, metrics: { ...M, 'user.name': 1 } }), 400, 'invalid');
    await noCall(ask({ ...payload, metrics: { ...M, 'tasks.seen': 'Alice' } }), 400, 'invalid');
    await noCall(ask({ ...payload, metrics: { ...M, 'tasks.seen': M['tasks.seen'] + 1 } }), 400, 'invalid');
    await noCall(ask([payload]), 400, 'invalid');
    const thin = { ...payload, metrics: { ...M, 'days.opened': 1, 'days.unknown': M['days.unknown'] + M['days.opened'] - 1 } };
    await noCall(ask(thin), 422, 'insufficient');
  });

  it('a request from another website is refused; the same origin and allow-listed origins are not', async () => {
    await noCall(ask(payload, { origin: 'http://evil.test' }), 403, 'origin');
    const { handler, calls } = rig(() => reply(good()), { COACH_ALLOWED_ORIGINS: 'http://partner.test' });
    expect((await handler(ask(payload, { origin: 'http://partner.test' })))!.status).toBe(200);
    expect(calls).toHaveLength(1);
    const cross = rig(() => reply(good()));
    const r = await cross.handler(new Request('http://app.test/api/coach', { method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site', 'x-coach-client': 'c' }, body: JSON.stringify(payload) }));
    expect(r!.status).toBe(403);
    expect(cross.calls).toHaveLength(0);
  });
});

describe('cost and abuse limits', () => {
  it('a second request inside the cooldown is refused with a wait time and never reaches the provider', async () => {
    let t = 1_000_000;
    const { handler, calls } = rig(() => reply(good()), { COACH_COOLDOWN_SECONDS: '30' }, () => t);
    expect((await handler(ask()))!.status).toBe(200);
    t += 10_000;
    const r = await read(await handler(ask()));
    expect(r.status).toBe(429);
    expect(r.json.error).toMatchObject({ code: 'cooldown', retryAfterSeconds: 20 });
    expect(r.headers.get('retry-after')).toBe('20');
    expect(calls).toHaveLength(1);
    t += 21_000;
    expect((await handler(ask()))!.status).toBe(200);
    expect(calls).toHaveLength(2);
  });

  it('clients are limited separately, each has a daily allowance, and the whole process has one too', async () => {
    let t = 5_000_000;
    const a = rig(() => reply(good()), { COACH_COOLDOWN_SECONDS: '5', COACH_DAILY_PER_CLIENT: '2', COACH_DAILY_TOTAL: '100' }, () => t);
    for (let i = 0; i < 2; i++) { expect((await a.handler(ask(payload, {}, 'one')))!.status).toBe(200); t += 6_000; }
    const third = await read(await a.handler(ask(payload, {}, 'one')));
    expect(third.status).toBe(429);
    expect(third.json.error.code).toBe('client-daily');
    expect((await a.handler(ask(payload, {}, 'two')))!.status).toBe(200);
    t += 24 * 3600 * 1000;
    expect((await a.handler(ask(payload, {}, 'one')))!.status).toBe(200);          // the allowance rolls over

    t = 9_000_000;
    const b = rig(() => reply(good()), { COACH_COOLDOWN_SECONDS: '5', COACH_DAILY_TOTAL: '2' }, () => t);
    expect((await b.handler(ask(payload, {}, 'x')))!.status).toBe(200);
    expect((await b.handler(ask(payload, {}, 'y')))!.status).toBe(200);
    const over = await read(await b.handler(ask(payload, {}, 'z')));
    expect(over.json.error.code).toBe('global-daily');
    expect(b.calls).toHaveLength(2);
  });

  it('a failed or slow provider call still counts, so errors cannot be used to hammer it', async () => {
    const { handler, calls } = rig(() => errorReply(500, 'api_error', 'x'));
    expect((await handler(ask()))!.status).toBe(502);
    expect((await handler(ask()))!.status).toBe(429);
    expect(calls).toHaveLength(1);
  });

  it('the limiter on its own', () => {
    const l = createLimiter({ cooldownSeconds: 10, perClientDaily: 2, globalDaily: 3 });
    expect(l.take('a', 0)).toEqual({ ok: true });
    expect(l.take('a', 5_000)).toMatchObject({ ok: false, code: 'cooldown', retryAfterSeconds: 5 });
    expect(l.take('a', 11_000)).toEqual({ ok: true });
    expect(l.take('a', 30_000)).toMatchObject({ ok: false, code: 'client-daily' });
    expect(l.take('b', 30_000)).toEqual({ ok: true });
    expect(l.take('c', 30_000)).toMatchObject({ ok: false, code: 'global-daily' });
  });

  it('output is capped by settings: the token limit and the time limit are clamped', () => {
    const c = readCoachConfig({ ANTHROPIC_API_KEY: KEY, COACH_MAX_OUTPUT_TOKENS: '99999999', COACH_TIMEOUT_MS: '1', COACH_COOLDOWN_SECONDS: '0', COACH_DAILY_PER_CLIENT: 'abc' });
    expect(c.available && c.config).toMatchObject({ maxOutputTokens: 8000, timeoutMs: 1000, cooldownSeconds: 5, perClientDaily: 20, maxBodyBytes: 4096 });
  });
});

describe('time limits and provider failures', () => {
  it('a provider that never answers is stopped at the time limit with a calm message', async () => {
    vi.useFakeTimers();
    let aborted = false;
    const { handler, logs } = rig((_c, init) => new Promise<Response>((_res, rej) => { init.signal?.addEventListener('abort', () => { aborted = true; rej(new DOMException('Aborted', 'AbortError')); }); }), { COACH_TIMEOUT_MS: '2000' });
    const pending = handler(ask());
    await vi.advanceTimersByTimeAsync(2500);
    const r = await read(await pending);
    expect(r.status).toBe(504);
    expect(r.json.error.code).toBe('timeout');
    expect(r.json.error.message).toMatch(/too long.*Nothing was changed/);
    expect(aborted).toBe(true);
    expect(JSON.stringify(logs)).toContain('timeout');
  });

  it('auth, rate limit, server and bad-request failures all become one generic message', async () => {
    for (const [status, type] of [[401, 'authentication_error'], [403, 'permission_error'], [429, 'rate_limit_error'], [500, 'api_error'], [529, 'overloaded_error'], [400, 'invalid_request_error'], [404, 'not_found_error']] as const) {
      const { handler } = rig(() => errorReply(status, type, 'details'));
      const r = await read(await handler(ask()));
      expect(r.status, String(status)).toBe(502);
      expect(r.json.error.code).toBe('provider-unavailable');
    }
  });

  it('a network failure is the same generic message', async () => {
    const { handler } = rig(() => { throw new TypeError('fetch failed: ECONNREFUSED 10.0.0.1'); });
    const r = await read(await handler(ask()));
    expect(r.status).toBe(502);
    expect(r.text).not.toContain('ECONNREFUSED');
  });
});

describe('what the model returns is checked before anyone sees it', () => {
  const unreliable = async (respond: () => Response) => {
    const { handler } = rig(respond);
    const r = await read(await handler(ask()));
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, suggestions: [], notice: 'unreliable' });
    return r;
  };

  it('malformed, empty, truncated, refused and non-JSON answers become the calm fallback, never raw text', async () => {
    const r = await unreliable(() => reply('I changed your plan. Here you go!'));
    expect(r.text).not.toContain('changed your plan');
    await unreliable(() => reply(''));
    await unreliable(() => reply('{"suggestions":'));
    await unreliable(() => reply(good(), 'max_tokens'));
    await unreliable(() => reply(good(), 'refusal'));
    await unreliable(() => reply('[]'));
  });

  it('unsupported claims, invalid evidence, and plan-changing advice are dropped', async () => {
    const bad = (s: Record<string, unknown>) => JSON.stringify({ suggestions: [{ kind: 'pattern', title: 'A count', explanation: `${M['tasks.seen']} tasks were shown on Today.`, metric_ids: ['tasks.seen'], strength: 'good', ...s }] });
    await unreliable(() => reply(bad({ metric_ids: ['tasks.invented'] })));
    await unreliable(() => reply(bad({ explanation: '99 tasks were shown on Today.' })));
    await unreliable(() => reply(bad({ explanation: `${M['tasks.seen']} tasks were shown on Today because you were busy.` })));
    await unreliable(() => reply(bad({ kind: 'idea', idea: 'Increase your daily time and try Just 5 minutes.' })));
    await unreliable(() => reply(bad({ kind: 'idea', idea: 'I have changed your schedule. Try Just 5 minutes.' })));
  });

  it('a mixed answer keeps the supported part and drops the rest', async () => {
    const mixed = JSON.stringify({ suggestions: [JSON.parse(good()).suggestions[0], { kind: 'pattern', title: 'Bad', explanation: 'You lack motivation.', metric_ids: ['tasks.seen'], strength: 'good' }] });
    const { handler } = rig(() => reply(mixed));
    const r = await read(await handler(ask()));
    expect(r.json.suggestions).toHaveLength(1);
    expect(r.text).not.toContain('motivation');
  });

  it('"not enough information" from the model is passed on as such', async () => {
    const { handler } = rig(() => reply(JSON.stringify({ suggestions: [], insufficient: true })));
    const r = await read(await handler(ask()));
    expect(r.json).toMatchObject({ ok: true, suggestions: [], notice: 'insufficient' });
  });

});

describe('the Node glue', () => {
  let server: Server | null = null;
  afterEach(() => new Promise<void>((r) => { if (server) server.close(() => r()); else r(); }));

  const start = async (extraEnv: Record<string, string> = {}) => {
    const calls: unknown[] = [];
    const h = createCoachHandler({ env: () => ({ ANTHROPIC_API_KEY: KEY, COACH_COOLDOWN_SECONDS: '30', ...extraEnv }), fetch: (async (...a: unknown[]) => { calls.push(a); return reply(good()); }) as typeof fetch, log: () => undefined });
    server = createServer((req, res) => { handleNodeRequest(h, req, res).then((done) => { if (!done) { res.statusCode = 404; res.end('static'); } }); });
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
    return { base: `http://127.0.0.1:${(server!.address() as AddressInfo).port}`, calls };
  };

  it('serves status and answers over real HTTP, and passes other paths on', async () => {
    const { base, calls } = await start();
    expect((await (await fetch(`${base}/api/coach/status`)).json())).toMatchObject({ available: true });
    const r = await fetch(`${base}/api/coach`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify(payload) });
    expect(r.status).toBe(200);
    expect((await r.json()).suggestions).toHaveLength(1);
    expect(calls).toHaveLength(1);
    expect((await fetch(`${base}/index.html`)).status).toBe(404);
  });

  it('a caller cannot dodge the cooldown by inventing a client identity', async () => {
    const { base, calls } = await start();
    const go = (id: string) => fetch(`${base}/api/coach`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base, 'x-coach-client': id }, body: JSON.stringify(payload) });
    expect((await go('spoof-1')).status).toBe(200);
    expect((await go('spoof-2')).status).toBe(429);
    expect(calls).toHaveLength(1);
  });

  it('an oversized body is refused before it is read in full', async () => {
    const { base, calls } = await start();
    const r = await fetch(`${base}/api/coach`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: 'x'.repeat(40_000) });
    expect(r.status).toBe(413);
    expect(calls).toHaveLength(0);
  });

  it('a cross-site browser request is refused', async () => {
    const { base, calls } = await start();
    const r = await fetch(`${base}/api/coach`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://evil.test' }, body: JSON.stringify(payload) });
    expect(r.status).toBe(403);
    expect(calls).toHaveLength(0);
  });
});
