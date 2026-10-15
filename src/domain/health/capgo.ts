import type { ISODate } from '../types';
import type { HealthAdapter } from './adapter';
import type { HealthMetric, HealthPlatformName, ImportedWorkout } from './types';

/**
 * An adapter over @capgo/capacitor-health (a community Capacitor plugin over HealthKit on iOS and Health Connect on Android; not an
 * Apple or Google product). It is written against the small part of the plugin this app uses, so it can be checked without a phone.
 * It has NOT been run on a device: see docs/native-integrations.md for what has and has not been verified.
 */
export type PluginType = 'steps' | 'exerciseTime' | 'dietaryWater' | 'workouts';
export interface HealthPluginLike {
  isAvailable(): Promise<{ available: boolean; platform?: 'ios' | 'android' | 'web'; reason?: string }>;
  requestAuthorization(o: { read?: PluginType[]; write?: PluginType[] }): Promise<{ readAuthorized: string[]; readDenied: string[] }>;
  checkAuthorization(o: { read?: PluginType[]; write?: PluginType[] }): Promise<{ readAuthorized: string[]; readDenied: string[] }>;
  queryAggregated(o: { dataType: PluginType; startDate?: string; endDate?: string; bucket?: 'day'; aggregation?: 'sum' }): Promise<{ samples: { startDate: string; endDate: string; value: number; unit: string }[] }>;
  queryWorkouts(o: { startDate?: string; endDate?: string; limit?: number }): Promise<{ workouts: { workoutType: string; duration: number; startDate: string; endDate: string; sourceName?: string; sourceId?: string; platformId?: string }[] }>;
}

const TYPE: Record<HealthMetric, PluginType> = { steps: 'steps', exercise: 'exerciseTime', water: 'dietaryWater' };
/**
 * The plugin documents `exerciseTime` as iOS only, and says `workouts` must be requested explicitly to read workouts. So on Health Connect
 * "exercise" means the workout sessions themselves, and the minutes are added up from them here.
 */
const wantFor = (platform: HealthPlatformName): Record<HealthMetric, PluginType[]> => ({
  steps: ['steps'], exercise: platform === 'healthkit' ? ['exerciseTime', 'workouts'] : ['workouts'], water: ['dietaryWater'],
});

const localDate = (iso: string): ISODate => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const dayStart = (d: ISODate): string => { const [y, m, dd] = d.split('-').map(Number); return new Date(y, m - 1, dd, 0, 0, 0, 0).toISOString(); };
const dayEnd = (d: ISODate): string => { const [y, m, dd] = d.split('-').map(Number); return new Date(y, m - 1, dd, 23, 59, 59, 999).toISOString(); };
/** Liters in, millilitres out; other units are refused rather than guessed. */
const toMl = (v: number, unit: string): number | null => (unit === 'liter' ? v * 1000 : unit === 'milliliter' || unit === 'mL' || unit === 'ml' ? v : null);

export const createCapgoAdapter = (plugin: HealthPluginLike, platform: HealthPlatformName): HealthAdapter => {
  const WANT = wantFor(platform);
  const workouts = async (from: ISODate, to: ISODate): Promise<ImportedWorkout[]> => {
    const r = await plugin.queryWorkouts({ startDate: dayStart(from), endDate: dayEnd(to), limit: 200 });
    const out: ImportedWorkout[] = [];
    for (const w of r.workouts) {
      const id = w.platformId ?? `${w.sourceId ?? w.sourceName ?? 'src'}:${w.startDate}:${w.workoutType}`;
      // the plugin documents `duration` in seconds; anything absurd is dropped rather than guessed at
      const minutes = Math.round(w.duration / 60);
      if (!Number.isFinite(minutes) || minutes < 1 || minutes > 24 * 60) continue;
      out.push({ id: String(id).slice(0, 100), type: String(w.workoutType).slice(0, 40), minutes, startAt: w.startDate, source: String(w.sourceName ?? 'Unknown source').slice(0, 60) });
    }
    return out;
  };
  return {
    platform,
    label: platform === 'healthkit' ? 'Apple Health' : 'Health Connect',
    isAvailable: async () => { const a = await plugin.isAvailable(); return a.available ? { available: true } : { available: false, reason: a.reason }; },
    requestAuthorization: async (read) => { await plugin.requestAuthorization({ read: [...new Set(read.flatMap((m) => WANT[m]))] }); },
    authorized: async (read) => {
      const want = [...new Set(read.flatMap((m) => WANT[m]))];
      const s = await plugin.checkAuthorization({ read: want });
      return read.filter((m) => WANT[m].every((t) => s.readAuthorized.includes(t)));
    },
    daily: async (metric, from, to) => {
      if (metric === 'exercise' && platform !== 'healthkit') {
        const sum = new Map<ISODate, number>();
        for (const w of await workouts(from, to)) sum.set(localDate(w.startAt), (sum.get(localDate(w.startAt)) ?? 0) + w.minutes);
        return [...sum].map(([date, value]) => ({ date, value }));
      }
      const r = await plugin.queryAggregated({ dataType: TYPE[metric], startDate: dayStart(from), endDate: dayEnd(to), bucket: 'day', aggregation: 'sum' });
      const out: { date: ISODate; value: number }[] = [];
      for (const s of r.samples) {
        const v = metric === 'water' ? toMl(s.value, s.unit) : s.value;
        if (v === null || !Number.isFinite(v)) continue;
        out.push({ date: localDate(s.startDate), value: v });
      }
      return out;
    },
    workouts,
  };
};
