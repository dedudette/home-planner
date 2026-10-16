import Anthropic from '@anthropic-ai/sdk';
import type { CoachConfig } from './config';
import { ProviderError, type CoachProvider, type ProviderReply, type ProviderRequest } from './provider';

/**
 * The Anthropic adapter, using the official SDK. Retries are off (a retry is a second charge the person did not ask for), the
 * request carries only the prompt we built, and every failure is reduced to a coarse code before it leaves this file.
 *
 * `output_config.effort: "low"` keeps this small explanation task cheap and quick. The newest models (Haiku 5.5 included) think by
 * default, and that thinking counts toward `max_tokens`, which is why COACH_MAX_OUTPUT_TOKENS defaults to a generous 4000. No
 * sampling settings are sent on purpose: the newest models reject non-default values.
 */
export const createAnthropicProvider = (config: CoachConfig, fetchImpl?: typeof fetch): CoachProvider => {
  const client = new Anthropic({
    apiKey: config.apiKey,
    ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
    timeout: config.timeoutMs,
    maxRetries: 0,
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  });
  return {
    name: 'anthropic',
    label: 'Anthropic',
    model: config.model,
    async generate(req: ProviderRequest): Promise<ProviderReply> {
      try {
        const res = await client.messages.create(
          {
            model: config.model,
            max_tokens: req.maxOutputTokens,
            system: req.system,
            messages: [{ role: 'user', content: req.user }],
            output_config: { effort: 'low' },
          },
          { signal: req.signal },
        );
        const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
        const stop = res.stop_reason === 'end_turn' ? 'end' : res.stop_reason === 'refusal' ? 'refusal' : res.stop_reason === 'max_tokens' ? 'truncated' : 'other';
        return { text, stop, usage: { inputTokens: res.usage?.input_tokens ?? 0, outputTokens: res.usage?.output_tokens ?? 0 } };
      } catch (e) {
        throw classify(e, req.signal);
      }
    },
  };
};

/** Most specific first: a timeout is a connection error, and the SDK's connection errors are a kind of API error. */
const classify = (e: unknown, signal: AbortSignal): ProviderError => {
  if (e instanceof ProviderError) return e;
  if (signal.aborted || e instanceof Anthropic.APIUserAbortError || e instanceof Anthropic.APIConnectionTimeoutError) return new ProviderError('timeout');
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return new ProviderError('auth');
  if (e instanceof Anthropic.RateLimitError) return new ProviderError('rate-limit');
  if (e instanceof Anthropic.BadRequestError || e instanceof Anthropic.NotFoundError || e instanceof Anthropic.UnprocessableEntityError) return new ProviderError('bad-request');
  if (e instanceof Anthropic.APIError) return new ProviderError('unavailable');
  return new ProviderError('unavailable');
};
