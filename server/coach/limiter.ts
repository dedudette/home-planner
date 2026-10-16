/**
 * Basic cost and abuse control, in memory: a cooldown between requests from one client, a daily allowance per client, and a daily
 * allowance for the whole server process. It resets when the process restarts and is not shared between instances, so on a
 * multi-instance deployment each instance enforces its own limits; the provider's own spend limit is the real backstop.
 * A request is counted when it is accepted, before the provider is called, so a failed or slow call still counts.
 */
export interface LimiterConfig { cooldownSeconds: number; perClientDaily: number; globalDaily: number }

export type LimitResult = { ok: true } | { ok: false; code: 'cooldown' | 'client-daily' | 'global-daily'; retryAfterSeconds: number };

export interface Limiter { take(client: string, now: number): LimitResult }

const DAY = 24 * 60 * 60 * 1000;
const MAX_CLIENTS = 2_000;

export const createLimiter = (cfg: LimiterConfig): Limiter => {
  const clients = new Map<string, { last: number; count: number; since: number }>();
  const total = { count: 0, since: 0 };
  return {
    take(client, now) {
      if (now - total.since >= DAY) { total.count = 0; total.since = now; }
      let c = clients.get(client);
      if (c && now - c.since >= DAY) c = undefined;
      if (c && now - c.last < cfg.cooldownSeconds * 1000) return { ok: false, code: 'cooldown', retryAfterSeconds: Math.ceil((cfg.cooldownSeconds * 1000 - (now - c.last)) / 1000) };
      if (c && c.count >= cfg.perClientDaily) return { ok: false, code: 'client-daily', retryAfterSeconds: Math.ceil((c.since + DAY - now) / 1000) };
      if (total.count >= cfg.globalDaily) return { ok: false, code: 'global-daily', retryAfterSeconds: Math.ceil((total.since + DAY - now) / 1000) };
      total.count++;
      if (!c) {
        if (clients.size >= MAX_CLIENTS) clients.delete(clients.keys().next().value as string);
        c = { last: now, count: 1, since: now };
      } else { c.last = now; c.count++; }
      clients.set(client, c);
      return { ok: true };
    },
  };
};
