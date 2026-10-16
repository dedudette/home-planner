import { validateCoachOutput, type CoachSuggestion } from '../../src/domain/coach/output';
import { validatePayload } from '../../src/domain/coach/metrics';
import { describeAvailability, readCoachConfig, type CoachAvailability, type CoachConfig, type Env } from './config';
import { createLimiter, type Limiter } from './limiter';
import { buildPrompt } from './prompt';
import { createProvider, ProviderError, type CoachProvider } from './provider';
import type { AiGate, AiTicket } from '../ai/gate';

/**
 * The AI coach endpoint, as a plain `(Request) => Response` function so any host can mount it (the Vite dev and preview servers and the
 * Node server in this repository do; a serverless platform needs only a few lines of glue).
 *
 *   GET  /api/coach/status   → whether the coach is set up here, and who would receive the request. No data is read.
 *   POST /api/coach          → one reviewed request in, a checked answer out.
 *
 * What it will not do: log or store the request, echo any text from the request, expose the provider key or provider error text,
 * accept anything but the fixed set of counts, or return model text that has not passed the answer checks. It never reads or writes
 * the person's plan, because it has no access to it: the browser only ever sends counts.
 */

export type CoachLog = (event: { event: string; code?: string }) => void;

export interface CoachDeps {
  env?: () => Env;
  /** For tests: the HTTP call to the provider. */
  fetch?: typeof fetch;
  now?: () => number;
  /** Receives event names and short codes only. It is never handed the request, the answer or any provider text. */
  log?: CoachLog;
  /** For tests: a ready-made provider instead of the real adapter. */
  provider?: (config: CoachConfig) => CoachProvider;
  /**
   * Accounts mode: the door that identifies the caller, checks their entitlement and reserves one unit of their AI allowance before the
   * provider is called. Absent in local mode (the original single-device app), where the in-memory limiter is the only control.
   */
  gate?: AiGate;
}

const json = (status: number, body: unknown, extra: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...extra } });

const fail = (status: number, code: string, message: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}): Response =>
  json(status, { ok: false, error: { code, message, ...extra } }, headers);

const NOT_SET_UP = 'AI suggestions are not set up on this server.';

/** Same origin is always fine; anything else has to be on the allow-list. A request with no browser headers at all (curl, tests) passes. */
const originAllowed = (req: Request, config: CoachConfig): boolean => {
  const origin = req.headers.get('origin');
  if (origin) {
    const host = req.headers.get('host') ?? new URL(req.url).host;
    try { if (new URL(origin).host === host) return true; } catch { return false; }
    return config.allowedOrigins.includes(origin);
  }
  const site = req.headers.get('sec-fetch-site');
  return !site || site === 'same-origin' || site === 'none';
};

const clientOf = (req: Request, config: CoachConfig): string => {
  const set = req.headers.get('x-coach-client');
  if (set) return `c:${set}`;
  if (config.trustProxy) return `f:${(req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown'}`;
  return 'shared';
};

const readBody = async (req: Request, max: number): Promise<string | 'too-large'> => {
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > max) return 'too-large';
  if (!req.body) return '';
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { await reader.cancel().catch(() => undefined); return 'too-large'; }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.byteLength; }
  return new TextDecoder().decode(all);
};

export interface CoachHandler {
  (req: Request): Promise<Response | null>;
  /** One line for the operator at start-up. */
  describe(): string;
}

export const createCoachHandler = (deps: CoachDeps = {}): CoachHandler => {
  const env = deps.env ?? (() => process.env as Env);
  const now = deps.now ?? Date.now;
  const log: CoachLog = deps.log ?? ((e) => console.warn(JSON.stringify(e)));
  let limiter: { key: string; limiter: Limiter } | null = null;
  const limiterFor = (c: CoachConfig): Limiter => {
    const key = `${c.cooldownSeconds}|${c.perClientDaily}|${c.globalDaily}`;
    if (!limiter || limiter.key !== key) limiter = { key, limiter: createLimiter(c) };
    return limiter.limiter;
  };

  let accountLimiter: { key: number; limiter: Limiter } | null = null;
  const accountLimiterFor = (c: CoachConfig): Limiter => {
    if (!accountLimiter || accountLimiter.key !== c.cooldownSeconds) accountLimiter = { key: c.cooldownSeconds, limiter: createLimiter({ cooldownSeconds: c.cooldownSeconds, perClientDaily: 1e9, globalDaily: 1e9 }) };
    return accountLimiter.limiter;
  };

  const handler = (async (req: Request): Promise<Response | null> => {
    const url = new URL(req.url);
    const isStatus = url.pathname === '/api/coach/status';
    const isAsk = url.pathname === '/api/coach';
    if (!isStatus && !isAsk) return null;

    const avail: CoachAvailability = readCoachConfig(env());

    if (isStatus) {
      if (req.method !== 'GET') return fail(405, 'method', 'Use GET.', {}, { allow: 'GET' });
      if (!avail.available) return json(200, { available: false });
      const provider = (deps.provider ?? ((c) => createProvider(c, deps.fetch)))(avail.config);
      return json(200, { available: true, provider: provider.label, model: provider.model, cooldownSeconds: avail.config.cooldownSeconds });
    }

    if (req.method !== 'POST') return fail(405, 'method', 'Use POST.', {}, { allow: 'POST' });
    if (!avail.available) return fail(503, 'not-configured', NOT_SET_UP);
    const config = avail.config;
    if (!originAllowed(req, config)) { log({ event: 'coach.rejected', code: 'origin' }); return fail(403, 'origin', 'This request did not come from the app.'); }
    if (!(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) return fail(415, 'content-type', 'Send JSON.');

    const body = await readBody(req, config.maxBodyBytes);
    if (body === 'too-large') return fail(413, 'too-large', 'That request is larger than anything the app sends.');
    let raw: unknown;
    try { raw = JSON.parse(body); } catch { return fail(400, 'invalid', 'That request could not be read.'); }
    const check = validatePayload(raw);
    if (!check.ok) {
      if (check.code === 'insufficient') return fail(422, 'insufficient', 'There is not enough recorded data in this window for a useful suggestion.');
      return fail(400, 'invalid', 'That request could not be read.');
    }

    const t = now();
    let ticket: AiTicket | null = null;
    if (deps.gate) {
      const g = await deps.gate.begin(req, 'coach');
      if (!g.ok) return g.response;
      ticket = g.ticket;
    }
    // With accounts the allowance ledger is the quota; the in-memory limiter keeps only its cooldown, per account.
    const limit = (ticket ? accountLimiterFor(config) : limiterFor(config)).take(ticket ? `u:${ticket.userId}` : clientOf(req, config), t);
    if (!limit.ok) {
      await ticket?.release();
      log({ event: 'coach.rejected', code: limit.code });
      const msg = limit.code === 'cooldown' ? `Please wait ${limit.retryAfterSeconds} seconds before asking again.` : 'The AI suggestion limit has been reached for now. Try again later.';
      return fail(429, limit.code, msg, { retryAfterSeconds: limit.retryAfterSeconds }, { 'retry-after': String(limit.retryAfterSeconds) });
    }

    const provider = (deps.provider ?? ((c) => createProvider(c, deps.fetch)))(config);
    const prompt = buildPrompt(check.payload, check.strength);
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), config.timeoutMs);
    let reply;
    try {
      reply = await provider.generate({ system: prompt.system, user: prompt.user, maxOutputTokens: Math.min(config.maxOutputTokens, ticket?.maxOutputTokens ?? config.maxOutputTokens), signal: abort.signal });
    } catch (e) {
      await ticket?.release();
      const code = e instanceof ProviderError ? e.code : 'unavailable';
      log({ event: 'coach.provider-error', code });
      if (code === 'timeout') return fail(504, 'timeout', 'The AI service took too long. Nothing was changed. You can try again in a moment.');
      return fail(502, 'provider-unavailable', 'The AI service could not be reached just now. Nothing was changed.');
    } finally { clearTimeout(timer); }

    const meta = { provider: provider.label, model: provider.model };
    // An answer the person cannot use is not charged to their allowance: release, never commit.
    const unreliable = async () => { await ticket?.release(reply.usage); return json(200, { ok: true, suggestions: [] as CoachSuggestion[], notice: 'unreliable', meta }); };
    if (reply.stop !== 'end') { log({ event: 'coach.unusable', code: reply.stop }); return unreliable(); }
    const out = validateCoachOutput(reply.text, check.payload, check.strength);
    if (!out.ok) { log({ event: 'coach.unusable', code: out.reason }); return unreliable(); }
    if (out.dropped) log({ event: 'coach.dropped', code: String(out.dropped) });
    if (out.output.insufficient) { await ticket?.release(reply.usage); return json(200, { ok: true, suggestions: [], notice: 'insufficient', meta }); }
    await ticket?.commit(reply.usage);
    return json(200, { ok: true, suggestions: out.output.suggestions, meta });
  }) as CoachHandler;
  handler.describe = () => describeAvailability(readCoachConfig(env()));
  return handler;
};
