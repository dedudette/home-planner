import { emptyAppData } from '../domain/appdata';
import type { AppData } from '../domain/types';
import { SCHEMA_VERSION, summarize, validateAppData, looksLikeAppData } from './schema';

/**
 * Persistence boundary. The app only talks to `Repository`, so moving from localStorage to a real backend means writing one more
 * class with these methods, with nothing else changing.
 *
 * Two properties matter more than anything else here:
 *  1. Saved data is never silently destroyed. Unreadable data is kept (as raw text) and handed to a recovery screen; data from a
 *     newer or older version is migrated or read best-effort, and a safety copy is written before the first overwrite.
 *  2. Concurrent writers (two tabs) are detected with a revision number, so the stale one merges instead of clobbering.
 */

export type LoadStatus = 'empty' | 'ok' | 'migrated' | 'repaired' | 'newer' | 'unreadable';

export interface LoadResult {
  status: LoadStatus;
  data: AppData | null;
  /** Monotonic write counter of what was loaded. Pass it back to `save` as `baseRev`. */
  rev: number;
  repairs: string[];
  /** Raw text, only for `unreadable`. Keep it, offer it for download, never overwrite it silently. */
  raw?: string;
  reason?: string;
}

export interface SaveResult {
  ok: boolean;
  rev: number;
  /** Set when another writer got there first. The caller should merge its own changes on top of this and save again. */
  conflict?: AppData;
  error?: 'quota' | 'blocked';
}

export interface BackupInfo { id: string; at: string; reason: string; entries: number; bytes: number }

export interface Repository {
  load(): Promise<LoadResult>;
  save(data: AppData, baseRev: number): Promise<SaveResult>;
  /** Synchronous variant for `pagehide`, where an async write may never finish. */
  saveSync?(data: AppData, baseRev: number): SaveResult;
  backup(data: AppData | string, reason: string): BackupInfo | null;
  listBackups(): BackupInfo[];
  readBackup(id: string): AppData | null;
  readRaw(): string | null;
  /** Keeps the unreadable text under a separate key so starting fresh never destroys it. */
  stashRaw(raw: string): void;
  /** Remove only the main save (the raw text is already stashed). Used by "start fresh" in recovery. */
  dropMain(): void;
  /** Force-write data over whatever is there, after taking a safety copy of it. Used to restore a backup in recovery. */
  overwrite(data: AppData): SaveResult;
  /** Erase everything, including backups and any stashed raw text. Used by "Erase all my data". */
  clear(): Promise<void>;
  /** Be told when another tab changes the data. */
  subscribe?(onChange: (r: LoadResult) => void): () => void;
}

export interface StorageLike { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }

/**
 * The key keeps its historical name; the schema version lives inside the payload.
 * Changing the key would orphan every existing user's data.
 */
export const STORAGE_KEY = 'cleanflow:v1';
const BACKUP_KEY = 'cleanflow:backups';
const RAW_KEY = 'cleanflow:recovery';
const MAX_BACKUPS = 3;
const MAX_BACKUP_BYTES = 1_500_000;

interface StoredBackup extends BackupInfo { json: string }

/** What `load` reports for a piece of stored text. Pure: used by the repository, the storage event and the tests. */
export const interpret = (txt: string | null): LoadResult => {
  if (txt === null) return { status: 'empty', data: null, rev: 0, repairs: [] };
  let parsed: unknown;
  try { parsed = JSON.parse(txt); } catch { return { status: 'unreadable', data: null, rev: 0, repairs: [], raw: txt, reason: 'The saved text is not valid JSON.' }; }
  if (!looksLikeAppData(parsed)) return { status: 'unreadable', data: null, rev: 0, repairs: [], raw: txt, reason: 'The saved data is not in a format CleanFlow recognises.' };
  const rev = typeof parsed._rev === 'number' && Number.isFinite(parsed._rev) ? parsed._rev : 0;
  const v = validateAppData(parsed);
  if (!v) return { status: 'unreadable', data: null, rev, repairs: [], raw: txt, reason: 'The saved data could not be read.' };
  const status: LoadStatus = v.fromFuture ? 'newer' : v.foundVersion < SCHEMA_VERSION ? 'migrated' : v.repairs.length ? 'repaired' : 'ok';
  return { status, data: v.data, rev, repairs: v.repairs };
};

export class LocalStorageRepository implements Repository {
  private storage: StorageLike | null;
  constructor(private key = STORAGE_KEY, storage?: StorageLike) {
    this.storage = storage ?? null;
  }

  private ls(): StorageLike | null {
    if (this.storage) return this.storage;
    try { return typeof window !== 'undefined' ? window.localStorage : null; } catch { return null; }
  }

  readRaw(): string | null {
    try { return this.ls()?.getItem(this.key) ?? null; } catch { return null; }
  }

  async load(): Promise<LoadResult> {
    const txt = this.readRaw();
    const r = interpret(txt);
    // Anything but a clean current-version file gets a safety copy of the original bytes before the app can overwrite it.
    if (txt !== null && r.status !== 'ok' && r.status !== 'empty') this.backup(txt, r.status === 'unreadable' ? 'unreadable' : r.status);
    if (r.status === 'unreadable' && r.raw) this.stashRaw(r.raw);
    return r;
  }

  saveSync(data: AppData, baseRev: number): SaveResult {
    const store = this.ls();
    if (!store) return { ok: false, rev: baseRev, error: 'blocked' };
    try {
      const cur = interpret(store.getItem(this.key));
      if (cur.status !== 'empty' && cur.status !== 'unreadable' && cur.data && cur.rev > baseRev) return { ok: false, rev: cur.rev, conflict: cur.data };
      const rev = Math.max(baseRev, cur.rev) + 1;
      store.setItem(this.key, JSON.stringify({ ...data, _rev: rev }));
      return { ok: true, rev };
    } catch (e) {
      const quota = e instanceof DOMException && (e.name === 'QuotaExceededError' || e.code === 22);
      return { ok: false, rev: baseRev, error: quota ? 'quota' : 'blocked' };
    }
  }

  async save(data: AppData, baseRev: number): Promise<SaveResult> {
    return this.saveSync(data, baseRev);
  }

  private readBackups(): StoredBackup[] {
    try {
      const raw = this.ls()?.getItem(BACKUP_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.filter((b): b is StoredBackup => !!b && typeof b.id === 'string' && typeof b.json === 'string') : [];
    } catch { return []; }
  }

  backup(data: AppData | string, reason: string): BackupInfo | null {
    const store = this.ls();
    if (!store) return null;
    const json = typeof data === 'string' ? data : JSON.stringify({ ...data });
    const at = new Date().toISOString();
    let entries = 0;
    try { const p = typeof data === 'string' ? JSON.parse(data) : data; entries = looksLikeAppData(p) && Array.isArray((p as { sessions?: unknown }).sessions) ? ((p as { sessions: { entries?: unknown[] }[] }).sessions.reduce((n, s) => n + (Array.isArray(s?.entries) ? s.entries.length : 0), 0)) : 0; } catch { /* unreadable text: entries stays 0 */ }
    const info: StoredBackup = { id: `b_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, at, reason, entries, bytes: json.length, json };
    let list = [info, ...this.readBackups()];
    // Newest first. Keep a handful, and never let backups crowd out the real data.
    list = list.slice(0, MAX_BACKUPS);
    while (list.length > 1 && list.reduce((n, b) => n + b.bytes, 0) > MAX_BACKUP_BYTES) list.pop();
    try { store.setItem(BACKUP_KEY, JSON.stringify(list)); return info; } catch {
      try { store.setItem(BACKUP_KEY, JSON.stringify([info])); return info; } catch { return null; }
    }
  }

  listBackups(): BackupInfo[] {
    return this.readBackups().map(({ json: _json, ...info }) => { void _json; return info; });
  }

  readBackup(id: string): AppData | null {
    const b = this.readBackups().find((x) => x.id === id);
    if (!b) return null;
    try { return validateAppData(JSON.parse(b.json))?.data ?? null; } catch { return null; }
  }

  dropMain(): void {
    try { this.ls()?.removeItem(this.key); } catch { /* ignore */ }
  }

  overwrite(data: AppData): SaveResult {
    const cur = this.readRaw();
    if (cur !== null) this.backup(cur, 'before-restore');
    return this.saveSync(data, interpret(cur).rev);
  }

  stashRaw(raw: string): void {
    try { this.ls()?.setItem(RAW_KEY, raw); } catch { /* quota: the original is still in the main key */ }
  }

  async clear(): Promise<void> {
    const store = this.ls();
    if (!store) return;
    for (const k of [this.key, BACKUP_KEY, RAW_KEY]) { try { store.removeItem(k); } catch { /* ignore */ } }
  }

  subscribe(onChange: (r: LoadResult) => void): () => void {
    if (typeof window === 'undefined') return () => {};
    const on = (e: StorageEvent) => {
      if (e.storageArea !== null && e.storageArea !== window.localStorage) return;
      if (e.key !== this.key && e.key !== null) return;
      onChange(interpret(this.readRaw()));
    };
    window.addEventListener('storage', on);
    return () => window.removeEventListener('storage', on);
  }
}

// ───────────────────────── export / import ─────────────────────────

export const EXPORT_VERSION = 2;

/** A versioned envelope: self-describing, so a future version can always tell what it is looking at. */
export const exportJSON = (data: AppData): string =>
  JSON.stringify({ app: 'cleanflow', exportVersion: EXPORT_VERSION, schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), data }, null, 2);

export interface ImportResult {
  ok: boolean;
  data?: AppData;
  repairs: string[];
  error?: string;
  summary?: ReturnType<typeof summarize>;
  foundVersion?: number;
}

/** Accepts the current envelope, an older envelope, and the bare data older versions exported. Never throws. */
export const importJSON = (text: string): ImportResult => {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return { ok: false, repairs: [], error: 'That file is not valid JSON.' }; }
  const payload = parsed && typeof parsed === 'object' && !Array.isArray(parsed) && (parsed as { app?: unknown }).app === 'cleanflow' && 'data' in (parsed as object)
    ? (parsed as { data: unknown }).data : parsed;
  const v = validateAppData(payload);
  if (!v) return { ok: false, repairs: [], error: "That file doesn't look like a CleanFlow backup." };
  return { ok: true, data: v.data, repairs: v.repairs, summary: summarize(v.data), foundVersion: v.foundVersion };
};

/** Kept for callers that only need "validated data or null". */
export const normalizeAppData = (raw: unknown): AppData | null => validateAppData(raw)?.data ?? null;

export { emptyAppData };
