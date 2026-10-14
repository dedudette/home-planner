import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildCoachPayload, validatePayload, type CoachPayload } from '../src/domain/coach/metrics';
import { computePatterns } from '../src/domain/patterns';
import { createCoachController } from '../src/features/patterns/coachController';
import { lived, range } from './coachHelpers';
import { TODAY } from './helpers';

const payload: CoachPayload = buildCoachPayload(computePatterns(lived(range(-9, 0), { doneEach: 2, skipEach: 1, minutes: 20, focus: ['home', 'discipline', 'morning', 'evening'] }), TODAY, 14))!;
const M = payload.metrics;
const strength = (() => { const v = validatePayload(payload); if (!v.ok) throw new Error('fixture'); return v.strength; })();
void strength;

const jsonRes = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const suggestion = (over: Record<string, unknown> = {}) => ({ kind: 'pattern', title: 'Opened days and completed tasks', explanation: `The app was opened on ${M['days.opened']} of ${payload.windowDays} days, and ${M['tasks.seenCompleted']} of ${M['tasks.seen']} tasks shown on Today were completed.`, metricIds: ['days.opened', 'tasks.seen', 'tasks.seenCompleted'], strength: 'good', ...over });
const STATUS_OK = { available: true, provider: 'Anthropic', model: 'claude-test', cooldownSeconds: 30 };

interface Req { url: string; init?: RequestInit }
const rig = (answer: (r: Req) => Promise<Response> | Response, now = { t: 1_000_000 }) => {
  const reqs: Req[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => { const r = { url: String(url), init }; reqs.push(r); return answer(r); }) as unknown as typeof fetch;
  const ctl = createCoachController({ fetch: fetchImpl, now: () => now.t });
  return { ctl, reqs, now, posts: () => reqs.filter((r) => r.init?.method === 'POST') };
};
const server = (r: Req) => (r.url.endsWith('/status') ? jsonRes(STATUS_OK) : jsonRes({ ok: true, suggestions: [suggestion()], meta: { provider: 'Anthropic', model: 'claude-test' } }));

afterEach(() => { vi.useRealTimers(); });

describe('nothing is requested until the person says so', () => {
  it('a fresh controller has made no request at all', () => {
    const { ctl, reqs } = rig(server);
    expect(ctl.get()).toEqual({ s: 'idle' });
    expect(reqs).toHaveLength(0);
  });

  it('"Ask" only checks whether a server is set up, then shows what would be sent: the data has not left the browser', async () => {
    const { ctl, reqs } = rig(server);
    await ctl.open(payload);
    expect(reqs.map((r) => `${r.init?.method} ${r.url}`)).toEqual(['GET /api/coach/status']);
    expect(reqs[0].init?.body).toBeUndefined();
    const s = ctl.get();
    expect(s.s).toBe('review');
    if (s.s === 'review') { expect(s.payload).toBe(payload); expect(s.status).toMatchObject({ provider: 'Anthropic', model: 'claude-test' }); }
  });

  it('REGRESSION: cancelling at the review step sends nothing, ever', async () => {
    const { ctl, posts, reqs } = rig(server);
    await ctl.open(payload);
    ctl.reset();
    expect(ctl.get()).toEqual({ s: 'idle' });
    await ctl.send();                                            // pressing Send after Cancel does nothing
    expect(posts()).toHaveLength(0);
    expect(reqs).toHaveLength(1);
  });

  it('cancelling while the status check is still running abandons it; a late answer cannot reopen the review', async () => {
    let release: (r: Response) => void = () => undefined;
    const { ctl, posts } = rig(() => new Promise<Response>((r) => { release = r; }));
    const opening = ctl.open(payload);
    expect(ctl.get().s).toBe('checking');
    ctl.reset();
    release(jsonRes(STATUS_OK));
    await opening;
    expect(ctl.get()).toEqual({ s: 'idle' });
    expect(posts()).toHaveLength(0);
  });

  it('Send does nothing unless the review step is showing: nothing is sent and nothing changes', async () => {
    const { ctl, posts, reqs } = rig(server);
    await ctl.send();
    expect(posts()).toHaveLength(0);
    expect(reqs).toHaveLength(0);
    expect(ctl.get()).toEqual({ s: 'idle' });
    await ctl.open(payload); ctl.reset();
    await ctl.send();
    expect(ctl.get()).toEqual({ s: 'idle' });
    expect(posts()).toHaveLength(0);
  });
});

describe('when there is no server', () => {
  const unavailable = async (answer: () => Promise<Response> | Response) => { const { ctl, posts } = rig(answer); await ctl.open(payload); expect(posts()).toHaveLength(0); return ctl.get(); };

  it('a static host (the page comes back instead of JSON), a missing endpoint, a server that is not set up, and a network failure are all "unavailable", with nothing sent', async () => {
    expect(await unavailable(() => new Response('<!doctype html><html></html>', { status: 200, headers: { 'content-type': 'text/html' } }))).toEqual({ s: 'unavailable', why: 'unreachable' });
    expect(await unavailable(() => new Response('nope', { status: 404 }))).toEqual({ s: 'unavailable', why: 'unreachable' });
    expect(await unavailable(() => jsonRes({ available: false }))).toEqual({ s: 'unavailable', why: 'not-set-up' });
    expect(await unavailable(() => { throw new TypeError('network'); })).toEqual({ s: 'unavailable', why: 'unreachable' });
  });
});

describe('sending: exactly what was reviewed', () => {
  it('the body is the reviewed payload, byte for byte, and nothing else is added', async () => {
    const { ctl, posts } = rig(server);
    await ctl.open(payload);
    const reviewed = JSON.stringify((ctl.get() as { payload: CoachPayload }).payload, null, 2);
    await ctl.send();
    expect(posts()).toHaveLength(1);
    const body = String(posts()[0].init?.body);
    expect(JSON.parse(body)).toEqual(JSON.parse(reviewed));
    expect(body).toBe(JSON.stringify(payload));
    expect(posts()[0].url).toBe('/api/coach');
    expect(posts()[0].init?.credentials).toBe('same-origin');
    expect(Object.keys(posts()[0].init?.headers as object).sort()).toEqual(['accept', 'content-type']);     // no cookies, tokens or identifiers
  });

  it('shows the answer with the request it answers: the window, the counts and the strength come from the reviewed payload', async () => {
    const { ctl } = rig(server);
    await ctl.open(payload); await ctl.send();
    const s = ctl.get();
    expect(s.s).toBe('done');
    if (s.s === 'done') {
      expect(s.payload).toBe(payload);
      expect(s.suggestions).toHaveLength(1);
      expect(s.suggestions[0].metricIds.every((id) => id in s.payload.metrics)).toBe(true);
      expect(s.meta).toEqual({ provider: 'Anthropic', model: 'claude-test' });
      expect(['limited', 'moderate', 'good']).toContain(s.strength);
    }
  });

  it('dismissing clears it, and asking again goes back through the review step (nothing is sent without it)', async () => {
    const { ctl, posts } = rig(server);
    await ctl.open(payload); await ctl.send();
    ctl.reset();
    expect(ctl.get()).toEqual({ s: 'idle' });
    await ctl.open(payload);
    expect(ctl.get().s).toBe('review');
    expect(posts()).toHaveLength(1);                             // still only the first send
  });
});

describe('the answer is checked again here, against what was reviewed', () => {
  const withServerAnswer = async (suggestions: unknown[], extra: Record<string, unknown> = {}) => {
    const { ctl } = rig((r) => (r.url.endsWith('/status') ? jsonRes(STATUS_OK) : jsonRes({ ok: true, suggestions, ...extra })));
    await ctl.open(payload); await ctl.send();
    return ctl.get();
  };

  it('evidence that was not in the request, invented numbers, plan-changing text: all become the calm fallback even if a server let them through', async () => {
    for (const bad of [suggestion({ metricIds: ['tasks.invented'] }), suggestion({ explanation: 'The app was opened on 99 days and tasks were completed.' }), suggestion({ kind: 'idea', idea: 'Change your goals and try Just 5 minutes.' }), suggestion({ explanation: 'Tasks were shown on Today because you lack motivation.', metricIds: ['tasks.seen'] })]) {
      const s = await withServerAnswer([bad]);
      expect(s).toMatchObject({ s: 'done', suggestions: [], notice: 'unreliable' });
    }
  });

  it('a server-declared "unreliable" or "insufficient" is passed on', async () => {
    expect(await withServerAnswer([], { notice: 'unreliable' })).toMatchObject({ s: 'done', suggestions: [], notice: 'unreliable' });
    expect(await withServerAnswer([], { notice: 'insufficient' })).toMatchObject({ s: 'done', suggestions: [], notice: 'insufficient' });
  });

  it('garbage from the server is an error or the fallback, never a crash or raw text', async () => {
    const { ctl } = rig((r) => (r.url.endsWith('/status') ? jsonRes(STATUS_OK) : new Response('<html>oops</html>', { status: 200, headers: { 'content-type': 'text/html' } })));
    await ctl.open(payload); await ctl.send();
    expect(ctl.get().s).toBe('error');
    const s = await withServerAnswer('not a list' as never);
    expect(s).toMatchObject({ s: 'done', suggestions: [], notice: 'unreliable' });
  });
});

describe('errors, waiting and timeouts', () => {
  it('a server error is shown in its own calm words, and a "wait" from the server extends the cooldown', async () => {
    const now = { t: 1_000_000 };
    const { ctl } = rig((r) => (r.url.endsWith('/status') ? jsonRes(STATUS_OK) : jsonRes({ ok: false, error: { code: 'client-daily', message: 'The AI suggestion limit has been reached for now. Try again later.', retryAfterSeconds: 600 } }, 429)), now);
    await ctl.open(payload); await ctl.send();
    expect(ctl.get()).toMatchObject({ s: 'error', message: 'The AI suggestion limit has been reached for now. Try again later.', retryAfterSeconds: 600 });
    expect(ctl.cooldown()).toBe(600);
  });

  it('a network failure says nothing was changed', async () => {
    const { ctl } = rig((r) => { if (r.url.endsWith('/status')) return jsonRes(STATUS_OK); throw new TypeError('network down'); });
    await ctl.open(payload); await ctl.send();
    const s = ctl.get();
    expect(s.s).toBe('error');
    if (s.s === 'error') expect(s.message).toMatch(/Nothing was changed/);
  });

  it('a request that never finishes is stopped after the client time limit', async () => {
    vi.useFakeTimers();
    const { ctl } = rig((r) => (r.url.endsWith('/status') ? jsonRes(STATUS_OK) : new Promise<Response>((_res, rej) => { r.init?.signal?.addEventListener('abort', () => rej(new DOMException('Aborted', 'AbortError'))); })));
    await ctl.open(payload);
    const sending = ctl.send();
    expect(ctl.get().s).toBe('sending');
    await vi.advanceTimersByTimeAsync(71_000);
    await sending;
    const s = ctl.get();
    expect(s.s).toBe('error');
    if (s.s === 'error') expect(s.message).toMatch(/too long.*Nothing was changed/);
  });

  it('Cancel while waiting abandons the request and ignores a late answer', async () => {
    let release: (r: Response) => void = () => undefined;
    const { ctl } = rig((r) => (r.url.endsWith('/status') ? jsonRes(STATUS_OK) : new Promise<Response>((res) => { release = res; })));
    await ctl.open(payload);
    const sending = ctl.send();
    ctl.reset();
    release(jsonRes({ ok: true, suggestions: [suggestion()] }));
    await sending;
    expect(ctl.get()).toEqual({ s: 'idle' });
  });

  it('a second request inside the cooldown is stopped here, before anything is sent', async () => {
    const now = { t: 1_000_000 };
    const { ctl, posts } = rig(server, now);
    await ctl.open(payload); await ctl.send();
    expect(ctl.cooldown()).toBe(30);
    await ctl.open(payload);
    await ctl.send();
    expect(ctl.get()).toMatchObject({ s: 'error' });
    expect(posts()).toHaveLength(1);
    now.t += 31_000;
    expect(ctl.cooldown()).toBe(0);
    await ctl.open(payload); await ctl.send();
    expect(posts()).toHaveLength(2);
  });

  it('refuses to send numbers that fail the same check the server will apply', async () => {
    const { ctl, posts } = rig(server);
    await ctl.open({ ...payload, metrics: { ...M, 'tasks.seen': M['tasks.seen'] + 1 } });
    await ctl.send();
    expect(posts()).toHaveLength(0);
    expect(ctl.get()).toMatchObject({ s: 'error' });
  });
});
