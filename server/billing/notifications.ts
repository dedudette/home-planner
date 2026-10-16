import type { PoolClient } from 'pg';
import { notice, type NoticeKind, type NoticePayload } from '../mail/templates';
import { withSystem, type Db } from '../db/pool';
import type { Mailer } from '../mail/mailer';

/**
 * Billing and trial notices, queued in the database and delivered with retries. Two promises:
 *
 *  - De-duplicated: every notice has a `dedupe_key` (for example "payment-failed:<invoice id>"), so a webhook delivered twice, or a sweep
 *    that runs on two servers, queues it once.
 *  - Honest status: `sent` means the mail provider accepted it; `simulated` means no provider is configured and nothing left the server;
 *    `failed` will be retried with growing delays; `dead` gave up. Nothing here ever claims delivery that did not happen.
 *
 * Delivery claims a row by pushing its next attempt five minutes ahead while it holds the row lock (a lease), so two servers do not send
 * the same notice, and a server that dies mid-send leaves it to be retried.
 */
export const RETRY_DELAYS_MIN = [1, 5, 30, 120, 720];
export const LEASE_MIN = 5;

export const enqueue = async (c: PoolClient, userId: string, kind: NoticeKind, dedupeKey: string, payload: Omit<NoticePayload, 'manageUrl'>, at: Date): Promise<boolean> => {
  const r = await c.query(
    `insert into notifications (user_id, kind, dedupe_key, payload, next_attempt_at, created_at) values ($1, $2, $3, $4::jsonb, $5, $5) on conflict (dedupe_key) do nothing`,
    [userId, kind, dedupeKey, JSON.stringify(payload), at]);
  return (r.rowCount ?? 0) > 0;
};

export interface DeliverResult { attempted: number; sent: number; simulated: number; failed: number; dead: number }

export const deliverDue = async (db: Db, o: { mailer: Mailer; appOrigin: string; now: Date; limit?: number }): Promise<DeliverResult> => {
  const out: DeliverResult = { attempted: 0, sent: 0, simulated: 0, failed: 0, dead: 0 };
  const claimed = await withSystem(db, async (c) => {
    const rows = await c.query(
      `select n.id, n.kind, n.payload, n.attempts, u.email
       from notifications n join "user" u on u.id = n.user_id
       where n.status in ('pending', 'failed') and n.next_attempt_at <= $1
       order by n.next_attempt_at limit $2 for update of n skip locked`, [o.now, o.limit ?? 25]);
    for (const r of rows.rows) await c.query('update notifications set next_attempt_at = $2 where id = $1', [r.id, new Date(o.now.getTime() + LEASE_MIN * 60_000)]);
    return rows.rows as { id: string; kind: NoticeKind; payload: Omit<NoticePayload, 'manageUrl'>; attempts: number; email: string }[];
  });
  for (const n of claimed) {
    out.attempted++;
    const rendered = notice(n.kind, { ...n.payload, manageUrl: `${o.appOrigin}/?billing=manage` });
    const res = await o.mailer.send({ to: n.email, subject: rendered.subject, text: rendered.text, idempotencyKey: `notification-${n.id}` }).catch(() => ({ status: 'failed' as const, retryable: true, code: 'exception' }));
    await withSystem(db, async (c) => {
      const attempts = n.attempts + 1;
      if (res.status === 'sent') { out.sent++; await c.query(`update notifications set status = 'sent', attempts = $2, sent_at = $3, last_error_code = null where id = $1`, [n.id, attempts, o.now]); }
      else if (res.status === 'simulated') { out.simulated++; await c.query(`update notifications set status = 'simulated', attempts = $2, last_error_code = null where id = $1`, [n.id, attempts]); }
      else if (!res.retryable || attempts > RETRY_DELAYS_MIN.length) { out.dead++; await c.query(`update notifications set status = 'dead', attempts = $2, last_error_code = $3 where id = $1`, [n.id, attempts, res.code]); }
      else { out.failed++; await c.query(`update notifications set status = 'failed', attempts = $2, last_error_code = $3, next_attempt_at = $4 where id = $1`, [n.id, attempts, res.code, new Date(o.now.getTime() + RETRY_DELAYS_MIN[attempts - 1] * 60_000)]); }
    });
  }
  return out;
};

/** Notices that are due because of the calendar rather than an event: a trial about to end, an annual renewal coming up. */
export const sweepCalendar = async (db: Db, now: Date): Promise<number> =>
  withSystem(db, async (c) => {
    let n = 0;
    const trials = await c.query(
      `select user_id, ends_at from trial_claims
       where user_id is not null and ends_at > $1 and ends_at <= $2
         and not exists (select 1 from subscriptions s where s.user_id = trial_claims.user_id and s.status in ('active', 'past_due', 'unpaid', 'incomplete', 'paused'))`,
      [now, new Date(now.getTime() + 3 * 86_400_000)]);
    for (const t of trials.rows) if (await enqueue(c, t.user_id, 'trial-ending', `trial-ending:${t.user_id}`, { endsAt: (t.ends_at as Date).toISOString() }, now)) n++;
    // Annual plans only: a €255 charge once a year is the one a person can forget about. Monthly renewals are covered by the provider's receipts.
    const renew = await c.query(
      `select user_id, plan, current_period_end, provider_subscription_id from subscriptions
       where status = 'active' and plan = 'annual' and cancel_at_period_end = false and current_period_end > $1 and current_period_end <= $2`,
      [now, new Date(now.getTime() + 7 * 86_400_000)]);
    for (const s of renew.rows) if (await enqueue(c, s.user_id, 'renewal-upcoming', `renewal:${s.provider_subscription_id}:${(s.current_period_end as Date).toISOString()}`, { plan: s.plan, periodEnd: (s.current_period_end as Date).toISOString() }, now)) n++;
    return n;
  });
