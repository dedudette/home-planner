/**
 * Server-side settings for the AI coach, read from environment variables only. Nothing here is ever sent to the browser, and the
 * provider key is never written to a file, a log line or a response: `apiKey` is not enumerable, so even a careless
 * JSON.stringify(config) or console.log(config) does not print it.
 *
 *   ANTHROPIC_API_KEY        required. The provider's own variable name; set it in the server's environment, never in the client.
 *   COACH_PROVIDER           optional, default "anthropic" (the only adapter so far; see provider.ts to add another).
 *   COACH_MODEL              optional, default "claude-haiku-5-5" (the smallest and cheapest current model). Any model id the provider
 *                            accepts, for example "claude-sonnet-5-5" or "claude-opus-5-5" for more capable (and dearer) answers.
 *   COACH_API_BASE_URL       optional. Point at a gateway or a local test double instead of the provider's own address.
 *   COACH_DISABLED           optional. "1" switches the coach off without removing the key.
 *   COACH_TIMEOUT_MS         optional, default 45000 (1000–120000).
 *   COACH_MAX_OUTPUT_TOKENS  optional, default 4000 (500–8000). Includes the model's own thinking, so keep it generous.
 *   COACH_COOLDOWN_SECONDS   optional, default 30 (5–3600): the least time between two requests from one client.
 *   COACH_DAILY_PER_CLIENT   optional, default 20 (1–1000): requests per client per rolling 24 hours.
 *   COACH_DAILY_TOTAL        optional, default 300 (1–100000): requests per rolling 24 hours for this whole server process.
 *   COACH_ALLOWED_ORIGINS    optional, comma-separated extra origins allowed to call the endpoint (same origin is always allowed).
 *   COACH_TRUST_PROXY        optional. "1" uses the first X-Forwarded-For address as the client identity (only behind your own proxy).
 */

export type Env = Record<string, string | undefined>;

/** Used when COACH_MODEL is unset or empty. Chosen for cost: the task is a short explanation of a few dozen counts. */
export const DEFAULT_COACH_MODEL = 'claude-haiku-5-5';

export interface CoachConfig {
  provider: 'anthropic';
  model: string;
  /** Not enumerable on purpose. */
  readonly apiKey: string;
  baseUrl?: string;
  timeoutMs: number;
  maxOutputTokens: number;
  cooldownSeconds: number;
  perClientDaily: number;
  globalDaily: number;
  maxBodyBytes: number;
  allowedOrigins: string[];
  trustProxy: boolean;
}

export type CoachAvailability =
  | { available: true; config: CoachConfig }
  /** `missing` holds variable NAMES only, for the operator's start-up note. */
  | { available: false; reason: 'disabled' | 'not-configured' | 'unsupported-provider'; missing: string[] };

const num = (v: string | undefined, dflt: number, min: number, max: number): number => {
  const n = v === undefined || v.trim() === '' ? NaN : Number(v);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : dflt;
};

export const readCoachConfig = (env: Env): CoachAvailability => {
  if (env.COACH_DISABLED === '1') return { available: false, reason: 'disabled', missing: [] };
  // An empty value ("COACH_PROVIDER=" left in an env file) means "not set", not "a provider with no name".
  const provider = (env.COACH_PROVIDER ?? '').trim().toLowerCase() || 'anthropic';
  if (provider !== 'anthropic') return { available: false, reason: 'unsupported-provider', missing: [] };
  const key = (env.ANTHROPIC_API_KEY ?? '').trim();
  if (!key) return { available: false, reason: 'not-configured', missing: ['ANTHROPIC_API_KEY'] };
  const baseUrl = (env.COACH_API_BASE_URL ?? '').trim();
  const config = {
    provider: 'anthropic' as const,
    model: (env.COACH_MODEL ?? '').trim() || DEFAULT_COACH_MODEL,
    ...(baseUrl ? { baseUrl } : {}),
    timeoutMs: num(env.COACH_TIMEOUT_MS, 45_000, 1_000, 120_000),
    maxOutputTokens: num(env.COACH_MAX_OUTPUT_TOKENS, 4_000, 500, 8_000),
    cooldownSeconds: num(env.COACH_COOLDOWN_SECONDS, 30, 5, 3_600),
    perClientDaily: num(env.COACH_DAILY_PER_CLIENT, 20, 1, 1_000),
    globalDaily: num(env.COACH_DAILY_TOTAL, 300, 1, 100_000),
    maxBodyBytes: 4_096,
    allowedOrigins: (env.COACH_ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    trustProxy: env.COACH_TRUST_PROXY === '1',
  };
  Object.defineProperty(config, 'apiKey', { value: key, enumerable: false });
  return { available: true, config: config as CoachConfig };
};

/** One line for the operator at start-up. Variable names and settings, never values of secrets. */
export const describeAvailability = (a: CoachAvailability): string =>
  a.available
    ? `AI suggestions: on (${a.config.provider}, model ${a.config.model}). Provider usage is billed to your provider account.`
    : a.reason === 'disabled' ? 'AI suggestions: off (COACH_DISABLED=1).'
    : a.reason === 'unsupported-provider' ? 'AI suggestions: off (COACH_PROVIDER names a provider this build has no adapter for).'
    : `AI suggestions: off (set ${a.missing.join(', ')} in the server environment to turn them on).`;
