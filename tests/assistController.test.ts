import { describe, expect, it } from 'vitest';
import type { AssistRequest } from '../src/domain/assist/types';
import { createAssistController } from '../src/features/assist/assistController';
import { TODAY } from './helpers';

const day = (n: number) => { const d = new Date(`${TODAY}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const req: AssistRequest = {
  v: 1, feature: 'meals', days: [day(0), day(1)], slots: ['lunch', 'dinner'], maxItems: 4, wish: '',
  candidates: [{ id: 'r1', name: 'Red lentil soup', minutes: 30, tags: [], slots: ['lunch', 'dinner'] }],
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const goodProposal = { items: [{ candidateId: 'r1', date: day(0), slot: 'dinner', reason: 'A 30 minute soup.' }] };

const rig = (post: (body: any) => Response | Promise<Response>, available = true) => {
  const calls: { url: string; method: string; body?: any }[] = [];
  let t = 1_000_000;
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method: init?.method ?? 'GET', body });
    if (url === '/api/assist/status') return json(available ? { available: true, provider: 'Anthropic', model: 'claude-haiku-5-5', cooldownSeconds: 30 } : { available: false });
    return post(body);
  }) as typeof fetch;
  const ctl = createAssistController({ fetch: fetchImpl, now: () => t });
  return { ctl, calls, tick: (ms: number) => { t += ms; } };
};

describe('the assistant controller only moves forward when the person says so', () => {
  it('opening only checks status: no data is sent until Send', async () => {
    const { ctl, calls } = rig(() => json({ ok: true, proposal: goodProposal }));
    await ctl.open(req);
    expect(ctl.get().s).toBe('review');
    expect(calls).toEqual([{ url: '/api/assist/status', method: 'GET', body: undefined }]);
    ctl.reset();
    expect(ctl.get().s).toBe('idle');
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  });
  it('Send posts exactly the reviewed request, then shows the proposal after checking it again', async () => {
    const { ctl, calls } = rig(() => json({ ok: true, proposal: goodProposal, meta: { provider: 'Anthropic', model: 'claude-haiku-5-5' } }));
    await ctl.open(req);
    await ctl.send();
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.url).toBe('/api/assist');
    expect(post.body).toEqual(req);
    const s = ctl.get();
    expect(s.s === 'done' && s.origin).toBe('ai');
    expect(s.s === 'done' && s.proposal?.items).toHaveLength(1);
    expect(s.s === 'done' && s.meta).toEqual({ provider: 'Anthropic', model: 'claude-haiku-5-5' });
  });
  it('checks the server\'s answer again, so a proposal that is not in the request never reaches the screen', async () => {
    const lie = { items: [{ candidateId: 'pizza', date: day(0), slot: 'dinner', reason: 'Tasty.' }, { candidateId: 'r1', date: day(7), slot: 'dinner', reason: 'A 30 minute soup.' }] };
    const { ctl } = rig(() => json({ ok: true, proposal: lie }));
    await ctl.open(req); await ctl.send();
    const s = ctl.get();
    expect(s.s === 'done' && s.proposal).toBeNull();
    expect(s.s === 'done' && s.notice).toBe('unreliable');
  });
  it('a request the checks refuse is never sent', async () => {
    const { ctl, calls } = rig(() => json({ ok: true, proposal: goodProposal }));
    await ctl.open({ ...req, candidates: [{ id: 'r1', name: '<b>x</b>', minutes: 1, tags: [], slots: ['lunch'] }] });
    await ctl.send();
    expect(ctl.get().s).toBe('error');
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  });
  it('not set up, or unreachable: says so and sends nothing', async () => {
    const a = rig(() => json({}), false);
    await a.ctl.open(req);
    expect(a.ctl.get()).toEqual({ s: 'unavailable', why: 'not-set-up' });
    const b = createAssistController({ fetch: (async () => { throw new Error('offline'); }) as typeof fetch });
    await b.open(req);
    expect(b.get()).toEqual({ s: 'unavailable', why: 'unreachable' });
    expect(await b.probe()).toBe('unreachable');
  });
  it('server errors become the server\'s calm message, and a cooldown stops a second ask', async () => {
    const { ctl, calls, tick } = rig(() => json({ ok: false, error: { code: 'cooldown', message: 'Please wait 12 seconds before asking again.', retryAfterSeconds: 12 } }, 429));
    await ctl.open(req); await ctl.send();
    expect(ctl.get()).toMatchObject({ s: 'error', message: 'Please wait 12 seconds before asking again.', retryAfterSeconds: 12 });
    await ctl.open(req);
    await ctl.send();
    expect(ctl.get()).toMatchObject({ s: 'error' });
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
    expect(ctl.cooldown()).toBeGreaterThan(0);
    tick(31_000);
    expect(ctl.cooldown()).toBe(0);
  });
  it('a network failure says nothing was changed', async () => {
    const ctl = createAssistController({ fetch: (async (url: string) => { if (url === '/api/assist/status') return json({ available: true, cooldownSeconds: 5 }); throw new Error('boom'); }) as typeof fetch });
    await ctl.open(req); await ctl.send();
    const s = ctl.get();
    expect(s.s === 'error' && s.message).toMatch(/Nothing was changed/);
  });
});

describe('the app\'s own suggestion needs no network at all', () => {
  it('makes a proposal with origin "app" and never calls fetch', () => {
    let called = 0;
    const ctl = createAssistController({ fetch: (async () => { called++; return json({}); }) as typeof fetch });
    ctl.local(req);
    const s = ctl.get();
    expect(called).toBe(0);
    expect(s.s === 'done' && s.origin).toBe('app');
    expect(s.s === 'done' && s.proposal?.items.length).toBeGreaterThan(0);
  });
  it('says so plainly when nothing fits, and refuses a request that fails the checks', () => {
    const ctl = createAssistController({ fetch: (async () => json({})) as typeof fetch });
    ctl.local({ ...req, candidates: [{ id: 'r1', name: 'Lunch only', minutes: 5, tags: [], slots: ['breakfast'] }] });
    const s = ctl.get();
    expect(s.s === 'done' && s.proposal).toBeNull();
    expect(s.s === 'done' && s.notice).toBe('empty');
    ctl.local({ ...req, candidates: [] });
    expect(ctl.get().s).toBe('error');
  });
});
