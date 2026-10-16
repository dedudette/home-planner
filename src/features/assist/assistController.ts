import { validateProposal, validateRequest } from '../../domain/assist/contract';
import { localProposal } from '../../domain/assist/local';
import type { AssistProposal, AssistRequest, ProposalOrigin } from '../../domain/assist/types';

/**
 * The browser side of the optional AI assistant, free of React so it can be tested on its own.
 *
 * Like the coach, it only moves forward when the person says so:
 *   idle → (ask the AI) → checking → review → (Send) → sending → done | error     Cancel returns to idle before Send.
 * "Suggest with the app" skips the network entirely: the app makes the same kind of proposal with plain rules and it goes through the
 * same review. Nothing is requested from the AI until Send; the only earlier request is a status check that carries no data. The
 * controller never touches the plan: it hands back a checked proposal, and the screen decides what the person approves.
 */

export interface AssistStatus { available: boolean; provider?: string; model?: string; cooldownSeconds?: number }
export interface Meta { provider: string; model: string }

export type AssistState =
  | { s: 'idle' }
  | { s: 'checking' }
  | { s: 'unavailable'; why: 'not-set-up' | 'unreachable' }
  | { s: 'review'; request: AssistRequest; status: AssistStatus }
  | { s: 'sending'; request: AssistRequest; status: AssistStatus }
  | { s: 'done'; request: AssistRequest; proposal: AssistProposal | null; origin: ProposalOrigin; notice?: 'unreliable' | 'empty'; meta?: Meta }
  | { s: 'error'; message: string; retryAfterSeconds?: number };

export interface AssistDeps { fetch?: typeof fetch; now?: () => number }

const STATUS_URL = '/api/assist/status';
const ASK_URL = '/api/assist';
const CLIENT_TIMEOUT_MS = 70_000;
const isJson = (r: Response) => (r.headers.get('content-type') ?? '').toLowerCase().includes('application/json');

export const createAssistController = (deps: AssistDeps = {}) => {
  const f = (...a: Parameters<typeof fetch>) => (deps.fetch ?? fetch)(...a);
  const now = deps.now ?? Date.now;
  let state: AssistState = { s: 'idle' };
  let cooldownUntil = 0;
  let abort: AbortController | null = null;
  let token = 0;
  let known: AssistStatus | 'unreachable' | null = null;
  const listeners = new Set<() => void>();
  const set = (next: AssistState) => { state = next; listeners.forEach((l) => l()); };

  const status = async (signal: AbortSignal): Promise<AssistStatus | 'unreachable'> => {
    try {
      const r = await f(STATUS_URL, { method: 'GET', signal, headers: { accept: 'application/json' }, credentials: 'same-origin' });
      if (!r.ok || !isJson(r)) return 'unreachable';
      const j = (await r.json()) as Partial<AssistStatus>;
      return j && j.available === true
        ? { available: true, provider: typeof j.provider === 'string' ? j.provider : undefined, model: typeof j.model === 'string' ? j.model : undefined, cooldownSeconds: typeof j.cooldownSeconds === 'number' ? j.cooldownSeconds : undefined }
        : { available: false };
    } catch { return 'unreachable'; }
  };

  return {
    get: (): AssistState => state,
    subscribe: (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; },
    cooldown: (): number => Math.max(0, Math.ceil((cooldownUntil - now()) / 1000)),

    /** Whether the AI is set up here. Carries no data. The answer is remembered for this screen. */
    async probe(): Promise<'available' | 'not-set-up' | 'unreachable'> {
      const ctl = new AbortController();
      const st = await status(ctl.signal);
      known = st;
      return st === 'unreachable' ? 'unreachable' : st.available ? 'available' : 'not-set-up';
    },

    /** "Ask the AI": shows exactly what would be sent. Nothing is sent yet. */
    async open(request: AssistRequest): Promise<void> {
      const mine = ++token;
      abort?.abort();
      abort = new AbortController();
      set({ s: 'checking' });
      const st = known ?? (await status(abort.signal));
      known = st;
      if (mine !== token) return;
      if (st === 'unreachable') return set({ s: 'unavailable', why: 'unreachable' });
      if (!st.available) return set({ s: 'unavailable', why: 'not-set-up' });
      set({ s: 'review', request, status: st });
    },

    /** "Suggest with the app": no AI, no network. The same review follows. */
    local(request: AssistRequest): void {
      token++; abort?.abort(); abort = null;
      const check = validateRequest(request);
      if (!check.ok) return set({ s: 'error', message: 'There was nothing to choose from with those settings.' });
      const proposal = localProposal(check.request);
      set({ s: 'done', request: check.request, proposal: proposal.items.length ? proposal : null, origin: 'app', ...(proposal.items.length ? {} : { notice: 'empty' as const }) });
    },

    reset(): void { token++; abort?.abort(); abort = null; set({ s: 'idle' }); },

    /** "Send": the first and only moment the reviewed request leaves the browser. */
    async send(): Promise<void> {
      if (state.s !== 'review') return;
      const { request, status: st } = state;
      const check = validateRequest(request);
      if (!check.ok) return set({ s: 'error', message: 'This request could not be checked, so nothing was sent.' });
      const wait = this.cooldown();
      if (wait > 0) return set({ s: 'error', message: `Please wait ${wait} seconds before asking again.`, retryAfterSeconds: wait });
      const mine = ++token;
      abort?.abort();
      const ctl = (abort = new AbortController());
      const timer = setTimeout(() => ctl.abort(), CLIENT_TIMEOUT_MS);
      set({ s: 'sending', request, status: st });
      cooldownUntil = now() + Math.max(5, st.cooldownSeconds ?? 30) * 1000;
      try {
        const r = await f(ASK_URL, { method: 'POST', signal: ctl.signal, headers: { 'content-type': 'application/json', accept: 'application/json' }, credentials: 'same-origin', body: JSON.stringify(check.request) });
        if (mine !== token) return;
        let j: { ok?: boolean; proposal?: unknown; notice?: string; meta?: { provider?: string; model?: string }; error?: { message?: string; retryAfterSeconds?: number } } | null = null;
        if (isJson(r)) { try { j = await r.json(); } catch { j = null; } }
        if (!r.ok || !j || j.ok !== true) {
          const retry = typeof j?.error?.retryAfterSeconds === 'number' ? j.error.retryAfterSeconds : undefined;
          if (retry) cooldownUntil = Math.max(cooldownUntil, now() + retry * 1000);
          return set({ s: 'error', message: typeof j?.error?.message === 'string' ? j.error.message : 'The AI service did not answer. Nothing was changed.', retryAfterSeconds: retry });
        }
        const meta = j.meta && typeof j.meta.provider === 'string' && typeof j.meta.model === 'string' ? { provider: j.meta.provider, model: j.meta.model } : undefined;
        // Checked again here, against the request the person reviewed, not the one the server says it received.
        const again = j.proposal ? validateProposal(j.proposal, check.request) : null;
        if (!again || !again.ok) return set({ s: 'done', request: check.request, proposal: null, origin: 'ai', notice: 'unreliable', meta });
        set({ s: 'done', request: check.request, proposal: again.proposal, origin: 'ai', meta });
      } catch {
        if (mine !== token) return;
        set({ s: 'error', message: ctl.signal.aborted ? 'That took too long, so it was stopped. Nothing was changed.' : 'The AI service could not be reached. Nothing was changed.' });
      } finally { clearTimeout(timer); }
    },
  };
};

export type AssistController = ReturnType<typeof createAssistController>;
