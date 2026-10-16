import { addDays } from '../dates';
import type { ISODate } from '../types';
import type { HealthAdapter } from './adapter';
import { HEALTH_METRICS, MAX_HEALTH_DAYS, type DayHealth, type HealthData, type HealthMetric, type HealthPrefs, type HealthStatus } from './types';

/**
 * The status shown to the person, worked out from what the device says. The switch alone never produces "connected": that word needs a
 * device with the health service, at least one kind of data the person allowed, and nothing having gone wrong.
 */
export const statusOf = (
  prefs: HealthPrefs, adapter: HealthAdapter | null, availability: { available: boolean; reason?: string } | null, allowed: HealthMetric[] | null, lastSync: string | null, failed = false,
): HealthStatus => {
  if (!prefs.enabled) return { s: 'off' };
  if (!adapter) return { s: 'web' };
  if (!availability || !availability.available) return { s: 'unavailable', reason: availability?.reason ?? 'Not available on this device.' };
  const wanted = HEALTH_METRICS.filter((m) => prefs.read[m]);
  if (wanted.length === 0) return { s: 'needs-permission' };
  if (failed) return { s: 'error' };
  const ok = (allowed ?? []).filter((m) => wanted.includes(m));
  if (ok.length === 0) return { s: 'needs-permission' };
  if (ok.length < wanted.length) return { s: 'partial', allowed: ok, missing: wanted.filter((m) => !ok.includes(m)) };
  return { s: 'connected', allowed: ok, lastSync };
};

export const statusText = (st: HealthStatus, platformLabel: string): string => {
  switch (st.s) {
    case 'off': return 'Off. Nothing is read.';
    case 'web': return 'Not available in a browser. It works in the phone app, on a device that has Apple Health or Health Connect.';
    case 'unavailable': return `${platformLabel} is not available here. ${st.reason}`;
    case 'needs-permission': return `Waiting for your permission. ${platformLabel} asks you which kinds of data to share, and you can say no to any of them.`;
    case 'partial': return `Reading ${st.allowed.join(', ')}. Not allowed (or no data to read yet): ${st.missing.join(', ')}.`;
    case 'connected': return `Connected to ${platformLabel}, read-only.${st.lastSync ? '' : ' Nothing read yet.'}`;
    case 'error': return `The last read from ${platformLabel} did not work. Nothing was changed. You can try again.`;
  }
};

/**
 * Reads the last `days` days of the allowed kinds of data. Returns one record per day with only what was actually read: a kind that was
 * not allowed, or that the platform returned nothing for, is left out, never filled with zero. The platform's own daily total is used.
 */
export const readHealth = async (adapter: HealthAdapter, prefs: HealthPrefs, today: ISODate, now: Date, days = 14): Promise<Record<ISODate, DayHealth>> => {
  const from = addDays(today, -(days - 1));
  const out: Record<ISODate, DayHealth> = {};
  const day = (d: ISODate): DayHealth => (out[d] ??= { platform: adapter.platform, at: now.toISOString() });
  const allowed = await adapter.authorized(HEALTH_METRICS.filter((m) => prefs.read[m]));
  if (allowed.includes('steps')) for (const r of await adapter.daily('steps', from, today)) if (Number.isFinite(r.value) && r.value >= 0 && r.date >= from && r.date <= today) day(r.date).steps = Math.round(r.value);
  if (allowed.includes('exercise')) for (const r of await adapter.daily('exercise', from, today)) if (Number.isFinite(r.value) && r.value >= 0 && r.date >= from && r.date <= today) day(r.date).exerciseMinutes = Math.round(r.value);
  if (allowed.includes('water')) for (const r of await adapter.daily('water', from, today)) if (Number.isFinite(r.value) && r.value >= 0 && r.date >= from && r.date <= today) day(r.date).waterMl = Math.round(r.value);
  if (allowed.includes('exercise')) {
    const seen = new Set<string>();
    for (const w of await adapter.workouts(from, today)) {
      const d = w.startAt.slice(0, 10);
      if (d < from || d > today || seen.has(w.id) || !(w.minutes > 0)) continue; // the same workout reported twice is stored once
      seen.add(w.id);
      (day(d).workouts ??= []).push(w);
    }
  }
  return out;
};

/** Merges a read into what is stored: a day that was read again is replaced, never added to, and only recent days are kept. */
export const mergeDaily = (cur: HealthData['daily'], read: Record<ISODate, DayHealth>, today: ISODate): HealthData['daily'] => {
  const next = { ...cur, ...read };
  const keep = Object.keys(next).sort().slice(-MAX_HEALTH_DAYS).filter((d) => d <= today);
  return Object.fromEntries(keep.map((d) => [d, next[d]]));
};
