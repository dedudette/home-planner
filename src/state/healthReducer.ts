import { emptyHealth } from '../domain/health/defaults';
import { mergeDaily } from '../domain/health/sync';
import type { DayHealth, HealthMetric } from '../domain/health/types';
import type { AppData, ISODate } from '../domain/types';

export type HealthAction =
  | { type: 'HEALTH_PREFS'; enabled?: boolean; read?: Partial<Record<HealthMetric, boolean>> }
  | { type: 'HEALTH_MERGE'; daily: Record<ISODate, DayHealth>; today: ISODate; at: string }
  /** "Remove what was read": forgets all imported data and turns the reading off. It cannot revoke permission: only the system settings can. */
  | { type: 'HEALTH_CLEAR' };

export const healthReducer = (d: AppData, a: HealthAction): AppData => {
  const cur = d.health ?? emptyHealth();
  switch (a.type) {
    case 'HEALTH_PREFS': {
      const prefs = { enabled: a.enabled ?? cur.prefs.enabled, read: { ...cur.prefs.read, ...(a.read ?? {}) } };
      return JSON.stringify(prefs) === JSON.stringify(cur.prefs) ? d : { ...d, health: { ...cur, prefs } };
    }
    case 'HEALTH_MERGE': return { ...d, health: { ...cur, daily: mergeDaily(cur.daily, a.daily, a.today), lastSync: a.at } };
    case 'HEALTH_CLEAR': return Object.keys(cur.daily).length === 0 && !cur.prefs.enabled && cur.lastSync === null ? d : { ...d, health: emptyHealth() };
    default: return d;
  }
};
