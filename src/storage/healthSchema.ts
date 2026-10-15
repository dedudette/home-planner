import { emptyHealth } from '../domain/health/defaults';
import { MAX_HEALTH_DAYS, type DayHealth, type HealthData, type ImportedWorkout } from '../domain/health/types';
import { bool, Ctx, date, intn, isoStamp, isObj, oneOf, str } from './primitives';

/** Validation for imported health data (schema v3). It is read-only data about a person's day: bounded, rebuilt field by field, and never trusted. */
const PLATFORMS = ['healthkit', 'health-connect'] as const;

const workout = (x: unknown): ImportedWorkout | null => {
  if (!isObj(x) || typeof x.id !== 'string' || !x.id || typeof x.startAt !== 'string' || Number.isNaN(Date.parse(x.startAt)) || typeof x.minutes !== 'number' || !(x.minutes >= 1)) return null;
  return { id: x.id.slice(0, 100), type: str(x.type, 'other', 40), minutes: intn(x.minutes, 1, 1, 1440), startAt: x.startAt, source: str(x.source, 'Unknown source', 60) };
};

export const validateHealth = (raw: unknown, c: Ctx): HealthData => {
  const d = emptyHealth();
  if (raw === undefined) return d;
  if (!isObj(raw)) { c.note('Your health settings were unreadable and were reset.'); return d; }
  const p = isObj(raw.prefs) ? raw.prefs : {};
  const r = isObj(p.read) ? p.read : {};
  const prefs = { enabled: bool(p.enabled, false), read: { steps: bool(r.steps, false), exercise: bool(r.exercise, false), water: bool(r.water, false) } };
  const daily: HealthData['daily'] = {};
  if (isObj(raw.daily)) {
    for (const [k, v] of Object.entries(raw.daily).sort(([a], [b]) => (a < b ? -1 : 1)).slice(-MAX_HEALTH_DAYS)) {
      if (!date(k) || !isObj(v)) { c.dropped++; continue; }
      const day: DayHealth = { platform: oneOf(v.platform, PLATFORMS, 'healthkit'), at: isoStamp(v.at, new Date(0).toISOString()) };
      if (typeof v.steps === 'number' && v.steps >= 0) day.steps = intn(v.steps, 0, 0, 500000);
      if (typeof v.exerciseMinutes === 'number' && v.exerciseMinutes >= 0) day.exerciseMinutes = intn(v.exerciseMinutes, 0, 0, 1440);
      if (typeof v.waterMl === 'number' && v.waterMl >= 0) day.waterMl = intn(v.waterMl, 0, 0, 20000);
      if (Array.isArray(v.workouts)) {
        const seen = new Set<string>();
        const ws = v.workouts.slice(0, 20).map(workout).filter((w): w is ImportedWorkout => !!w && !seen.has(w.id) && !!seen.add(w.id));
        if (ws.length) day.workouts = ws;
      }
      daily[k] = day;
    }
  }
  return { prefs, daily, lastSync: typeof raw.lastSync === 'string' && !Number.isNaN(Date.parse(raw.lastSync)) ? raw.lastSync : null };
};
