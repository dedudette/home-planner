import { validateCoachOutput, type CoachSuggestion } from '../../domain/coach/output';
import { validatePayload, type CoachPayload } from '../../domain/coach/metrics';
import type { EvidenceStrength } from '../../domain/patterns';

/**
 * The browser side of the optional AI coach, kept free of React so it can be tested on its own.
 *
 * It is a small state machine, and it only moves forward when the person says so:
 *   idle → (Ask) → checking → review → (Send) → sending → done | error      Cancel returns to idle from every step before Send.
 * Nothing is requested from the AI until Send. The only request made before that is a status check that carries no data.
 * It holds no access to the person's data or plan: the only thing it is ever given is the reviewed payload, so a suggestion cannot
 * change anything.
 */

export interface CoachStatus { available: boolean; provider?: string; model?: string; cooldownSeconds?: number }

export type CoachState =
  | { s: 'idle' }
  | { s: 'checking' }
  | { s: 'unavailable'; why: 'not-set-up' | 'unreachable' }
  | { s: 'review'; payload: CoachPayload; status: CoachStatus }
  | { s: 'sending'; payload: CoachPayload; status: CoachStatus }
  | { s: 'done'; payload: CoachPayload; strength: EvidenceStrength; suggestions: CoachSuggestion[]; notice?: 'unreliable' | 'insufficient'; meta?: { provider: string; model: string } }
  | { s: 'error'; message: string; retryAfterSeconds?: number };

export interface CoachDeps { fetch?: typeof fetch; now?: () => number }

const STATUS_URL = '/api/coach/status';
const ASK_URL = '/api/coach';
const CLIENT_TIMEOUT_MS = 70_000;

const isJson = (r: Response) => (r.headers.get('content-type') ?? '').toLowerCase().includes('application/json');

export const createCoachController = (deps: CoachDeps = {}) => {
  const f = (...a: Parameters<typeof fetch>) => (deps.fetch ?? fetch)(...a);
  const now = deps.now ?? Date.now;
  let state: CoachState = { s: 'idle' };
  let cooldownUntil = 0;
  let abort: AbortController | null = null;
  let token = 0;
  const listeners = new Set<() => void>();
  const set = (next: CoachState) => { state = next; listeners.forEach((l) => l()); };

  const status = async (signal: AbortSignal): Promise<CoachStatus | 'unreachable'> => {
    try {
      const r = await f(STATUS_URL, { method: 'GET', signal, headers: { accept: 'application/json' }, credentials: 'same-origin' });
      if (!r.ok || !isJson(r)) return 'unreachable';
      const j = (await r.json()) as Partial<CoachStatus>;
      return j && j.available === true
        ? { available: true, provider: typeof j.provider === 'string' ? j.provider : undefined, model: typeof j.model === 'string' ? j.model : undefined, cooldownSeconds: typeof j.cooldownSeconds === 'number' ? j.cooldownSeconds : undefined }
        : { available: false };
    } catch { return 'unreachable'; }
  };

  return {
    get: (): CoachState => state,
    subscribe: (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; },
    /** Seconds until another request is allowed (0 when it is). */
    cooldown: (): number => Math.max(0, Math.ceil((cooldownUntil - now()) / 1000)),

    /** "Ask AI for suggestions": looks only at whether a server is set up, then shows what would be sent. Nothing is sent yet. */
    async open(payload: CoachPayload): Promise<void> {
      const mine = ++token;
      abort?.abort();
      abort = new AbortController();
      set({ s: 'checking' });
      const st = await status(abort.signal);
      if (mine !== token) return;
      if (st === 'unreachable') return set({ s: 'unavailable', why: 'unreachable' });
      if (!st.available) return set({ s: 'unavailable', why: 'not-set-up' });
      set({ s: 'review', payload, status: st });
    },

    /** Cancel / dismiss / change of window: back to the start, and anything in flight is abandoned. */
    reset(): void { token++; abort?.abort(); abort = null; set({ s: 'idle' }); },

    /** "Send": the first and only moment the reviewed counts leave the browser. */
    async send(): Promise<void> {
      if (state.s !== 'review') return;
      const { payload, status: st } = state;
      const check = validatePayload(payload);
      if (!check.ok) return set({ s: 'error', message: 'These numbers could not be checked, so nothing was sent.' });
      const wait = this.cooldown();
      if (wait > 0) return set({ s: 'error', message: `Please wait ${wait} seconds before asking again.`, retryAfterSeconds: wait });
      const mine = ++token;
      abort?.abort();
      const ctl = (abort = new AbortController());
      const timer = setTimeout(() => ctl.abort(), CLIENT_TIMEOUT_MS);
      set({ s: 'sending', payload, status: st });
      // Counted when asked, like the server does: a slow or failed call still used one.
      cooldownUntil = now() + Math.max(5, st.cooldownSeconds ?? 30) * 1000;
      try {
        const r = await f(ASK_URL, { method: 'POST', signal: ctl.signal, headers: { 'content-type': 'application/json', accept: 'application/json' }, credentials: 'same-origin', body: JSON.stringify(payload) });
        if (mine !== token) return;
        let j: { ok?: boolean; suggestions?: unknown; notice?: string; meta?: { provider?: string; model?: string }; error?: { message?: string; retryAfterSeconds?: number } } | null = null;
        if (isJson(r)) { try { j = await r.json(); } catch { j = null; } }
        if (!r.ok || !j || j.ok !== true) {
          const retry = typeof j?.error?.retryAfterSeconds === 'number' ? j.error.retryAfterSeconds : undefined;
          if (retry) cooldownUntil = Math.max(cooldownUntil, now() + retry * 1000);
          return set({ s: 'error', message: typeof j?.error?.message === 'string' ? j.error.message : 'The AI suggestion service did not answer. Nothing was changed.', retryAfterSeconds: retry });
        }
        const meta = j.meta && typeof j.meta.provider === 'string' && typeof j.meta.model === 'string' ? { provider: j.meta.provider, model: j.meta.model } : undefined;
        if (j.notice === 'insufficient') return set({ s: 'done', payload, strength: check.strength, suggestions: [], notice: 'insufficient', meta });
        // The answer is checked again here, against the request the person reviewed, not the one the server says it received.
        const again = validateCoachOutput({ suggestions: j.suggestions }, payload, check.strength);
        if (!again.ok || again.output.suggestions.length === 0) return set({ s: 'done', payload, strength: check.strength, suggestions: [], notice: 'unreliable', meta });
        set({ s: 'done', payload, strength: check.strength, suggestions: again.output.suggestions, meta });
      } catch {
        if (mine !== token) return;
        set({ s: 'error', message: ctl.signal.aborted ? 'That took too long, so it was stopped. Nothing was changed.' : 'The AI suggestion service could not be reached. Nothing was changed.' });
      } finally { clearTimeout(timer); }
    },
  };
};

export type CoachController = ReturnType<typeof createCoachController>;
