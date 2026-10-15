import { validateProposal } from '../../src/domain/assist/contract';
import { validateRequest } from '../../src/domain/assist/contract';
import { ASSIST_FEATURES } from '../../src/domain/assist/types';
import { describeAvailability, readCoachConfig, type CoachAvailability, type CoachConfig, type Env } from '../coach/config';
import { createLimiter, type Limiter } from '../coach/limiter';
import { createProvider, ProviderError, type CoachProvider } from '../coach/provider';
import { buildPrompt } from './prompt';

/**
 * The assistant endpoint: one reviewed request in, a checked proposal out. It shares the coach's settings (the same provider key, model,
 * time-outs and limits, all from the server's environment) and its provider adapter, but not its contract: the coach describes counts the
 * app computed, the assistant chooses among candidates the app filtered.
 *
 *   GET  /api/assist/status   → whether the assistant is set up here, and who would receive a request. No data is read.
 *   POST /api/assist          → one reviewed request in, a checked proposal out.
 *
 * It never reads or writes the plan (it has no access to it), never logs or stores a request, never echoes request text, never
 * exposes the key or provider error text, and returns nothing the proposal checks have not accepted. A request is limited to 16 KB.
 */

export type AssistLog = (event: { event: string; code?: string }) => void;

export interface AssistDeps {
  env?: () => Env;
  fetch?: typeof fetch;
  now?: () => number;
  log?: AssistLog;
  provider?: (config: CoachConfig) => CoachProvider;
}

const MAX_BODY = 16 * 1024;

const json = (status: number, body: unknown, extra: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...extra } });

const fail = (status: number, code: string, message: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}): Response =>
  json(status, { ok: false, error: { code, message, ...extra } }, headers);

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

export interface AssistHandler {
  (req: Request): Promise<Response | null>;
  describe(): string;
}

export const createAssistHandler = (deps: AssistDeps = {}): AssistHandler => {
  const env = deps.env ?? (() => process.env as Env);
  const now = deps.now ?? Date.now;
  const log: AssistLog = deps.log ?? ((e) => console.warn(JSON.stringify(e)));
  let limiter: { key: string; limiter: Limiter } | null = null;
  const limiterFor = (c: CoachConfig): Limiter => {
    const key = `${c.cooldownSeconds}|${c.perClientDaily}|${c.globalDaily}`;
    if (!limiter || limiter.key !== key) limiter = { key, limiter: createLimiter(c) };
    return limiter.limiter;
  };

  const handler = (async (req: Request): Promise<Response | null> => {
    const url = new URL(req.url);
    const isStatus = url.pathname === '/api/assist/status';
    const isAsk = url.pathname === '/api/assist';
    if (!isStatus && !isAsk) return null;

    const avail: CoachAvailability = readCoachConfig(env());
    const make = (c: CoachConfig) => (deps.provider ?? ((cfg) => createProvider(cfg, deps.fetch)))(c);

    if (isStatus) {
      if (req.method !== 'GET') return fail(405, 'method', 'Use GET.', {}, { allow: 'GET' });
      if (!avail.available) return json(200, { available: false });
      const provider = make(avail.config);
      return json(200, { available: true, provider: provider.label, model: provider.model, cooldownSeconds: avail.config.cooldownSeconds, features: ASSIST_FEATURES });
    }

    if (req.method !== 'POST') return fail(405, 'method', 'Use POST.', {}, { allow: 'POST' });
    if (!avail.available) return fail(503, 'not-configured', 'The assistant is not set up on this server.');
    const config = avail.config;
    if (!originAllowed(req, config)) { log({ event: 'assist.rejected', code: 'origin' }); return fail(403, 'origin', 'This request did not come from the app.'); }
    if (!(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) return fail(415, 'content-type', 'Send JSON.');

    const body = await readBody(req, MAX_BODY);
    if (body === 'too-large') return fail(413, 'too-large', 'That request is larger than anything the app sends.');
    let raw: unknown;
    try { raw = JSON.parse(body); } catch { return fail(400, 'invalid', 'That request could not be read.'); }
    const check = validateRequest(raw);
    if (!check.ok) {
      if (check.code === 'insufficient') return fail(422, 'insufficient', 'There was nothing to choose from with those settings.');
      return fail(400, 'invalid', 'That request could not be read.');
    }

    const t = now();
    const limit = limiterFor(config).take(clientOf(req, config), t);
    if (!limit.ok) {
      log({ event: 'assist.rejected', code: limit.code });
      const msg = limit.code === 'cooldown' ? `Please wait ${limit.retryAfterSeconds} seconds before asking again.` : 'The AI request limit has been reached for now. Try again later.';
      return fail(429, limit.code, msg, { retryAfterSeconds: limit.retryAfterSeconds }, { 'retry-after': String(limit.retryAfterSeconds) });
    }

    const provider = make(config);
    const prompt = buildPrompt(check.request);
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), config.timeoutMs);
    let reply;
    try {
      reply = await provider.generate({ system: prompt.system, user: prompt.user, maxOutputTokens: config.maxOutputTokens, signal: abort.signal });
    } catch (e) {
      const code = e instanceof ProviderError ? e.code : 'unavailable';
      log({ event: 'assist.provider-error', code });
      if (code === 'timeout') return fail(504, 'timeout', 'The AI service took too long. Nothing was changed. You can try again in a moment.');
      return fail(502, 'provider-unavailable', 'The AI service could not be reached just now. Nothing was changed.');
    } finally { clearTimeout(timer); }

    const meta = { provider: provider.label, model: provider.model };
    const unreliable = () => json(200, { ok: true, proposal: null, notice: 'unreliable', meta });
    if (reply.stop !== 'end') { log({ event: 'assist.unusable', code: reply.stop }); return unreliable(); }
    const out = validateProposal(reply.text, check.request);
    if (!out.ok) { log({ event: 'assist.unusable', code: out.reason }); return unreliable(); }
    if (out.dropped) log({ event: 'assist.dropped', code: String(out.dropped) });
    return json(200, { ok: true, proposal: out.proposal, meta });
  }) as AssistHandler;
  handler.describe = () => describeAvailability(readCoachConfig(env())).replace('AI suggestions', 'AI assistant');
  return handler;
};
