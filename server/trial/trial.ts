import { createHmac } from 'node:crypto';
import { TRIAL_DAYS } from '../../src/domain/billing/plans';
import { withUser, type Db } from '../db/pool';
import { loadFacts } from '../billing/entitlements';
import { computeEntitlement, DEFAULT_POLICY, type EntitlementPolicy } from '../../src/domain/billing/entitlement';

/**
 * The 14-day trial. One per person, started only by a verified account that explicitly asks, timed by the server clock and recorded in
 * the database, so reloading, reinstalling, switching device or plan, or recreating a checkout changes nothing.
 *
 * "One per person" is keyed on an HMAC of the normalised email address (lower case, "+tag" removed), not on the account id, so deleting
 * the account and registering again with the same address does not earn a second trial. The record holds no readable email. Whether
 * keeping it after deletion is acceptable under the applicable privacy rules is a legal review item (docs/billing.md).
 */
export const normalizeEmail = (email: string): string => {
  const [local, ...rest] = email.trim().toLowerCase().split('@');
  const domain = rest.join('@');
  const base = local.split('+')[0];
  return `${base || local}@${domain}`;
};

export const claimKey = (secret: string, email: string): string => createHmac('sha256', secret).update(`trial-claim:v1:${normalizeEmail(email)}`).digest('hex');

export type StartTrialResult =
  | { ok: true; startedAt: Date; endsAt: Date }
  | { ok: false; code: 'unverified' | 'already-used' | 'not-eligible' | 'no-account' };

export const startTrial = async (db: Db, o: { userId: string; email: string; secret: string; now: Date; policy?: EntitlementPolicy }): Promise<StartTrialResult> =>
  withUser(db, o.userId, async (c) => {
    // Serialise concurrent clicks for the same account on its user row.
    const u = await c.query('select "emailVerified" as v from "user" where id = $1 for update', [o.userId]);
    if (!u.rowCount) return { ok: false, code: 'no-account' };
    if (u.rows[0].v !== true) return { ok: false, code: 'unverified' };
    const facts = await loadFacts(c, o.userId);
    if (!facts) return { ok: false, code: 'no-account' };
    const ent = computeEntitlement({ now: o.now, emailVerified: true, trial: facts.trial, subscription: facts.subscription, policy: o.policy ?? DEFAULT_POLICY });
    if (facts.trial) return { ok: false, code: 'already-used' };
    if (!ent.canStartTrial) return { ok: false, code: 'not-eligible' };
    const endsAt = new Date(o.now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
    const hash = claimKey(o.secret, o.email);
    const ins = await c.query('insert into trial_claims (email_hash, user_id, started_at, ends_at) values ($1, $2, $3, $4) on conflict (email_hash) do nothing returning started_at', [hash, o.userId, o.now, endsAt]);
    if (!ins.rowCount) return { ok: false, code: 'already-used' };
    return { ok: true, startedAt: o.now, endsAt };
  });
