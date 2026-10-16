import type { Entitlement } from './entitlement';
import type { PlanId } from './plans';

/** What the server tells the app about the signed-in account. Everything here is decided by the server; the app only displays it. */
export interface AccountView {
  user: { id: string; email: string; name: string; emailVerified: boolean };
  entitlement: Entitlement;
  trial: { startedAt: string; endsAt: string } | null;
  subscription: {
    provider: 'stripe' | 'apple' | 'google';
    plan: PlanId;
    status: string;
    currentPeriodEnd: string;
    cancelAtPeriodEnd: boolean;
    amountCents: number;
    currency: string;
  } | null;
  /** The real AI allowance for the current period, or null when the account has no paid access now. */
  allowance: { kind: 'trial' | 'paid'; limit: number; used: number; remaining: number; resetsAt: string } | null;
  billing: { available: boolean; reason: string | null; canManage: boolean };
  serverTime: string;
}

export interface PublicConfig {
  mode: 'local' | 'accounts';
  accounts?: {
    billing: { available: boolean; reason: string | null; mode: 'test' | 'live' | null };
    mail: { delivers: boolean };
    legal: { privacy: string | null; terms: string | null; billing: string | null; company: string | null };
  };
}
