import type { StorageLike } from '../storage/repository';

/** Safe access to this browser's storage for the small records the account screens keep (never the plan itself: the repository does that). Every call swallows storage errors and says whether it worked. */
export const deviceStorage = (s?: StorageLike): StorageLike | null => {
  if (s) return s;
  try { return typeof window !== 'undefined' ? window.localStorage : null; } catch { return null; }
};

export const readRecord = <T>(key: string, check: (v: unknown) => T | null, storage?: StorageLike): T | null => {
  try {
    const raw = deviceStorage(storage)?.getItem(key);
    return raw ? check(JSON.parse(raw)) : null;
  } catch { return null; }
};

export const writeRecord = (key: string, value: unknown, storage?: StorageLike): boolean => {
  try { const st = deviceStorage(storage); if (!st) return false; st.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
};

export const removeRecord = (key: string, storage?: StorageLike): void => {
  try { deviceStorage(storage)?.removeItem(key); } catch { /* nothing to remove, or storage is blocked: harmless */ }
};
