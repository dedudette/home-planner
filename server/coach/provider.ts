import { createAnthropicProvider } from './anthropic';
import type { CoachConfig } from './config';

/**
 * The only thing the rest of the server knows about a model provider. To use another one, write a function that returns this
 * interface and select it in `createProvider`. Nothing else changes: the prompt, the request checks and the answer checks do not
 * depend on who the provider is.
 */
export type ProviderErrorCode = 'timeout' | 'auth' | 'rate-limit' | 'unavailable' | 'bad-request' | 'bad-response';

export class ProviderError extends Error {
  constructor(readonly code: ProviderErrorCode) {
    // The message is deliberately generic: a provider's own error text can quote the request, and it must not reach logs or clients.
    super(`provider error: ${code}`);
    this.name = 'ProviderError';
  }
}

export interface ProviderRequest {
  system: string;
  user: string;
  maxOutputTokens: number;
  /** Aborted by the caller when its time is up. */
  signal: AbortSignal;
}

export interface ProviderReply {
  text: string;
  /** "refusal" and "truncated" mean the text is not a finished answer. */
  stop: 'end' | 'refusal' | 'truncated' | 'other';
}

export interface CoachProvider {
  readonly name: string;
  readonly label: string;
  readonly model: string;
  generate(req: ProviderRequest): Promise<ProviderReply>;
}

export const createProvider = (config: CoachConfig, fetchImpl?: typeof fetch): CoachProvider => createAnthropicProvider(config, fetchImpl);
