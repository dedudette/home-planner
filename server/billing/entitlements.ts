import type { PoolClient } from 'pg';
import { computeEntitlement, type Entitlement, type EntitlementPolicy, type SubscriptionFacts, type SubscriptionStatus, type TrialFacts } from '../../src/domain/billing/entitlement';
import { usageWindowFor, type AllowanceConfig, type UsageWindow } from '../../src/domain/billing/usage';
import { isPlanId } from '../../src/domain/billing/plans';
import { withUser, type Db } from '../db/pool';

/**
 * The one entitlement service. Every endpoint that does paid work (every AI endpoint, cloud backup) asks it, and it answers from the
 * database and the server's clock only. A browser can ask what it is, but nothing a browser sends can change the answer.
 */
export interface Facts {
  emailVerified: boolean;
  trial: TrialFacts | null;
  subscription: SubscriptionFacts | null;
  hasCustomer: boolean;
}

export interface EntitlementView { entitlement: Entitlement; window: UsageWindow | null; facts: Facts }

const rowToSub = (r: Record<string, unknown>): SubscriptionFacts | null => {
  if (!isPlanId(r.plan)) return null;
  return {
    provider: r.provider as SubscriptionFacts['provider'],
    plan: r.plan,
    status: r.status as SubscriptionStatus,
    startedAt: r.started_at as Date,
    currentPeriodStart: r.current_period_start as Date,
    currentPeriodEnd: r.current_period_end as Date,
    cancelAtPeriodEnd: r.cancel_at_period_end as boolean,
    suspendedReason: (r.suspended_reason as SubscriptionFacts['suspendedReason']) ?? null,
  };
};

export const loadFacts = async (c: PoolClient, userId: string): Promise<Facts | null> => {
  const u = await c.query('select "emailVerified" as v from "user" where id = $1', [userId]);
  if (!u.rowCount) return null;
  const t = await c.query('select started_at, ends_at from trial_claims where user_id = $1', [userId]);
  // The live subscription if there is one, otherwise the most recent ended one (so "cancelled" is remembered).
  const s = await c.query(
    `select * from subscriptions where user_id = $1
     order by (status in ('active','past_due','unpaid','incomplete','paused')) desc, updated_at desc, id desc limit 1`, [userId]);
  const cu = await c.query('select 1 from billing_customers where user_id = $1', [userId]);
  return {
    emailVerified: u.rows[0].v === true,
    trial: t.rowCount ? { startedAt: t.rows[0].started_at, endsAt: t.rows[0].ends_at } : null,
    subscription: s.rowCount ? rowToSub(s.rows[0]) : null,
    hasCustomer: !!cu.rowCount,
  };
};

export interface EntitlementService {
  /** `null` when the account does not exist. */
  get(userId: string, now?: Date): Promise<EntitlementView | null>;
}

export const createEntitlementService = (db: Db, opts: { allowance: AllowanceConfig; policy: EntitlementPolicy; now?: () => Date }): EntitlementService => ({
  async get(userId, at) {
    const now = at ?? (opts.now ? opts.now() : new Date());
    const facts = await withUser(db, userId, (c) => loadFacts(c, userId));
    if (!facts) return null;
    const entitlement = computeEntitlement({ now, emailVerified: facts.emailVerified, trial: facts.trial, subscription: facts.subscription, policy: opts.policy });
    const window = usageWindowFor(entitlement, facts, now, opts.allowance);
    return { entitlement, window, facts };
  },
});
