import { createApiHandler, type ApiDeps, type ApiHandler } from './api';
import { buildAccountsRuntime, type AccountsRuntime, type RuntimeOverrides } from './app';
import { readServerMode } from './config';
import type { Env } from './coach/config';

export interface App { handler: ApiHandler; runtime: AccountsRuntime | null; problems: string[]; close(): Promise<void> }

/** The whole server from its environment. `overrides` are for tests. */
export const createApp = (env: Env = process.env as Env, overrides: RuntimeOverrides & Omit<ApiDeps, 'accounts' | 'invalid'> = {}): App => {
  const mode = readServerMode(env);
  if (mode.kind === 'invalid') return { handler: createApiHandler({ invalid: mode.problems }), runtime: null, problems: mode.problems, close: async () => undefined };
  if (mode.kind === 'local') return { handler: createApiHandler({ env: () => env, ...overrides }), runtime: null, problems: [], close: async () => undefined };
  const runtime = buildAccountsRuntime(mode.config, env, overrides);
  return { handler: createApiHandler({ env: () => env, ...overrides, accounts: runtime }), runtime, problems: [], close: () => runtime.close() };
};
