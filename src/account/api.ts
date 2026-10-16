import type { AccountView, PublicConfig } from '../domain/billing/account';
import type { PlanId } from '../domain/billing/plans';
import type { AppData } from '../domain/types';

/**
 * The browser's side of the account endpoints. Every call is to this app's own origin with the session cookie (HttpOnly, so this code
 * never sees the session). Nothing here sends a user id, a price, an amount or a time: the server decides those.
 */
export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly extra: Record<string, unknown> = {}) { super(message); this.name = 'ApiError'; }
  get offline(): boolean { return this.status === 0; }
}

const normalise = (status: number, body: unknown): ApiError => {
  const b = (body && typeof body === 'object' ? body : {}) as { error?: { code?: string; message?: string } & Record<string, unknown>; code?: string; message?: string };
  if (b.error && typeof b.error === 'object') { const { code, message, ...extra } = b.error; return new ApiError(status, String(code ?? 'error'), String(message ?? 'Something went wrong.'), extra); }
  return new ApiError(status, String(b.code ?? 'error'), String(b.message ?? 'Something went wrong.'));
};

const call = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
  let res: Response;
  try {
    res = await fetch(path, { method, credentials: 'same-origin', headers: body !== undefined ? { 'content-type': 'application/json' } : undefined, body: body !== undefined ? JSON.stringify(body) : undefined, cache: 'no-store' });
  } catch { throw new ApiError(0, 'offline', 'The server could not be reached.'); }
  const text = await res.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!res.ok) throw normalise(res.status, json);
  return json as T;
};

/** `null` when the answer is not JSON (a static host answering every path with the app's page): there is no server behind this app. */
export const getConfig = async (): Promise<PublicConfig | null> => {
  let res: Response;
  try { res = await fetch('/api/config', { credentials: 'same-origin', cache: 'no-store' }); } catch { throw new ApiError(0, 'offline', 'The server could not be reached.'); }
  if (!res.ok) return null;
  try { const j = (await res.json()) as PublicConfig; return j && (j.mode === 'local' || j.mode === 'accounts') ? j : null; } catch { return null; }
};

export const getAccount = async (): Promise<AccountView> => (await call<{ account: AccountView }>('GET', '/api/account')).account;

// Better Auth's own routes.
const here = (): string => window.location.origin;
export const signUp = (email: string, password: string, name: string): Promise<unknown> => call('POST', '/api/auth/sign-up/email', { email, password, name, callbackURL: `${here()}/?verified=1` });
export const signIn = (email: string, password: string): Promise<unknown> => call('POST', '/api/auth/sign-in/email', { email, password });
export const signOut = (): Promise<unknown> => call('POST', '/api/auth/sign-out', {});
export const resendVerification = (email: string): Promise<unknown> => call('POST', '/api/auth/send-verification-email', { email, callbackURL: `${here()}/?verified=1` });
export const requestReset = (email: string): Promise<unknown> => call('POST', '/api/auth/request-password-reset', { email, redirectTo: `${here()}/?reset=1` });
export const resetPassword = (token: string, newPassword: string): Promise<unknown> => call('POST', '/api/auth/reset-password', { token, newPassword });
export const changePassword = (currentPassword: string, newPassword: string): Promise<unknown> => call('POST', '/api/auth/change-password', { currentPassword, newPassword, revokeOtherSessions: true });
export const deleteAccount = (password: string): Promise<unknown> => call('POST', '/api/auth/delete-user', { password });

export const startTrial = async (): Promise<AccountView> => (await call<{ account: AccountView }>('POST', '/api/account/trial', {})).account;

export const checkout = async (plan: PlanId): Promise<{ url: string; resumed: boolean }> => call('POST', '/api/billing/checkout', { plan });
export const syncBilling = async (sessionId?: string): Promise<{ account: AccountView; pending: boolean }> => call('POST', '/api/billing/sync', sessionId ? { sessionId } : {});
export const openPortal = async (): Promise<string> => (await call<{ url: string }>('POST', '/api/billing/portal', {})).url;
export const cancelAtPeriodEnd = async (): Promise<AccountView> => (await call<{ account: AccountView }>('POST', '/api/billing/cancel', {})).account;
export const resumeSubscription = async (): Promise<AccountView> => (await call<{ account: AccountView }>('POST', '/api/billing/resume', {})).account;

export interface BackupMeta { revision: number; includes: ('journal' | 'health')[]; sizeBytes: number; schemaVersion: number | null; updatedAt: string }
export const getBackupMeta = async (): Promise<BackupMeta | null> => (await call<{ backup: BackupMeta | null }>('GET', '/api/account/backup?meta=1')).backup;
export const getBackup = async (): Promise<{ backup: BackupMeta; data: unknown } | null> => { const r = await call<{ backup: BackupMeta | null; data?: unknown }>('GET', '/api/account/backup'); return r.backup ? { backup: r.backup, data: r.data } : null; };
export const putBackup = async (baseRevision: number | null, includes: BackupMeta['includes'], data: AppData): Promise<BackupMeta> => (await call<{ backup: BackupMeta }>('PUT', '/api/account/backup', { baseRevision, includes, data })).backup;
export const deleteBackup = (): Promise<unknown> => call('DELETE', '/api/account/backup');

export const downloadAccountExport = async (): Promise<string> => {
  const res = await fetch('/api/account/export', { credentials: 'same-origin', cache: 'no-store' });
  if (!res.ok) throw normalise(res.status, await res.json().catch(() => null));
  return res.text();
};
