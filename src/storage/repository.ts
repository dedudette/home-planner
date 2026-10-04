import { emptyAppData } from '../domain/appdata';
import type { AppData } from '../domain/types';

/**
 * Persistence boundary. The app only talks to `Repository`, so moving from
 * localStorage to a real backend (Supabase, Firebase, your own API…) means
 * writing one more class with these three methods, with nothing else changing.
 */
export interface Repository {
  load(): Promise<AppData | null>;
  save(data: AppData): Promise<void>;
  clear(): Promise<void>;
}

const KEY = 'cleanflow:v1';

/** Merge stored JSON onto fresh defaults so older/partial saves never crash the app. */
export const normalizeAppData = (raw: unknown): AppData | null => {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<AppData>;
  if (r.version !== 1) return null;
  const d = emptyAppData();
  return {
    ...d,
    ...r,
    user: { ...d.user, ...(r.user ?? {}) },
    home: {
      ...d.home, ...(r.home ?? {}),
      rooms: { ...d.home.rooms, ...(r.home?.rooms ?? {}) },
      pets: { ...d.home.pets, ...(r.home?.pets ?? {}) },
      extraRooms: r.home?.extraRooms ?? [],
      problemAreas: r.home?.problemAreas ?? [],
    },
    preferences: { ...d.preferences, ...(r.preferences ?? {}), blockers: r.preferences?.blockers ?? [], goals: r.preferences?.goals ?? [] },
    plan: { ...d.plan, ...(r.plan ?? {}) },
    taskStates: r.taskStates ?? {},
    customTasks: r.customTasks ?? [],
    sessions: r.sessions ?? [],
    supplies: r.supplies ?? [],
    fiveRecent: r.fiveRecent ?? [],
    dismissedInsights: r.dismissedInsights ?? {},
  } as AppData;
};

export class LocalStorageRepository implements Repository {
  constructor(private key = KEY) {}

  async load(): Promise<AppData | null> {
    try {
      const txt = window.localStorage.getItem(this.key);
      return txt ? normalizeAppData(JSON.parse(txt)) : null;
    } catch {
      return null; // private mode, blocked storage or corrupt JSON → start fresh
    }
  }

  async save(data: AppData): Promise<void> {
    try {
      window.localStorage.setItem(this.key, JSON.stringify(data));
    } catch {
      /* quota or blocked storage: the app keeps working in memory */
    }
  }

  async clear(): Promise<void> {
    try { window.localStorage.removeItem(this.key); } catch { /* ignore */ }
  }
}

export const exportJSON = (data: AppData): string => JSON.stringify(data, null, 2);

export const importJSON = (text: string): AppData | null => {
  try { return normalizeAppData(JSON.parse(text)); } catch { return null; }
};
