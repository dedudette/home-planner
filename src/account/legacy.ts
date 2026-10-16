import type { AppData } from '../domain/types';
import { interpret, STORAGE_KEY, type StorageLike } from '../storage/repository';
import { hasUserData, summarize } from '../storage/schema';

/**
 * Data this browser saved before accounts existed lives under the original storage key. With accounts on, each account works in its own
 * namespaced copy (see storage/namespace.ts), so that original copy is never read, written or erased by account code. These helpers only
 * LOOK at it, so a person who finds an empty app after their first sign-in can be told it is safe and can download it.
 * Moving it into an account (with a preview and a backup) is a separate feature and is not built here.
 */
export interface LegacyData { data: AppData; entries: number; days: number; name: string | null }

const store = (s?: StorageLike): StorageLike | null => {
  if (s) return s;
  try { return typeof window !== 'undefined' ? window.localStorage : null; } catch { return null; }
};

/** The original (un-namespaced) data, if it exists, is readable and holds something the person made. Never writes. */
export const readLegacyData = (storage?: StorageLike): LegacyData | null => {
  const st = store(storage);
  if (!st) return null;
  let raw: string | null = null;
  try { raw = st.getItem(STORAGE_KEY); } catch { return null; }
  const r = interpret(raw);
  if (!r.data || !hasUserData(r.data)) return null;
  const s = summarize(r.data);
  return { data: r.data, entries: s.entries, days: s.days, name: s.name ?? null };
};

/** True when this account has no saved data of its own yet (nothing under its namespaced key). */
export const accountHasOwnData = (accountId: string, storage?: StorageLike): boolean => {
  const st = store(storage);
  if (!st) return false;
  try { return st.getItem(`${STORAGE_KEY}@${accountId}`) !== null; } catch { return false; }
};

const seenKey = (id: string): string => `cleanflow:legacy-seen@${id}`;
export const legacyNoticeSeen = (id: string, storage?: StorageLike): boolean => { try { return store(storage)?.getItem(seenKey(id)) === '1'; } catch { return true; } };
export const markLegacyNoticeSeen = (id: string, storage?: StorageLike): void => { try { store(storage)?.setItem(seenKey(id), '1'); } catch { /* the notice may show once more; harmless */ } };

/** Whether to show the "your earlier data is safe" screen right after sign-in: there is old data, this account has none of its own, and it was not shown before. */
export const shouldShowLegacyNotice = (accountId: string, storage?: StorageLike): boolean =>
  readLegacyData(storage) !== null && !accountHasOwnData(accountId, storage) && !legacyNoticeSeen(accountId, storage);
