import type { AppData } from '../domain/types';
import type { Include } from '../storage/backupPlan';
import type { StorageLike } from '../storage/repository';
import type { BackupMeta } from './api';
import { readRecord, removeRecord, writeRecord } from './deviceStore';

/**
 * What this device remembers about the account's cloud backup, so it can tell "the cloud copy is the one I last saw" from "someone
 * changed it". The keys are per account (the caller passes the account's namespaced key), so two accounts on one device never share them.
 * None of this is trusted for anything but choosing which screen to show: the server checks the revision itself on every upload.
 */
export interface CloudRecord { revision: number; at: string; includes: Include[] }
const isInclude = (x: unknown): x is Include => x === 'journal' || x === 'health';
const isRecord = (v: unknown): CloudRecord | null => {
  const o = v as Partial<CloudRecord> | null;
  return o && typeof o.revision === 'number' && Number.isInteger(o.revision) && o.revision > 0 && typeof o.at === 'string' && Array.isArray(o.includes)
    ? { revision: o.revision, at: o.at, includes: o.includes.filter(isInclude) } : null;
};
export const readCloudRecord = (key: string, storage?: StorageLike): CloudRecord | null => readRecord(key, isRecord, storage);
export const writeCloudRecord = (key: string, meta: Pick<BackupMeta, 'revision' | 'updatedAt' | 'includes'>, storage?: StorageLike): boolean =>
  writeRecord(key, { revision: meta.revision, at: meta.updatedAt, includes: meta.includes } satisfies CloudRecord, storage);
export const clearCloudRecord = (key: string, storage?: StorageLike): void => removeRecord(key, storage);

/** An upload whose outcome this device never learned (the page closed, the connection dropped): the cloud copy may or may not have changed. */
export interface PendingUpload { startedAt: string; baseRevision: number | null; includes: Include[] }
const isPending = (v: unknown): PendingUpload | null => {
  const o = v as Partial<PendingUpload> | null;
  return o && typeof o.startedAt === 'string' && (o.baseRevision === null || typeof o.baseRevision === 'number') && Array.isArray(o.includes)
    ? { startedAt: o.startedAt, baseRevision: o.baseRevision as number | null, includes: o.includes.filter(isInclude) } : null;
};
export const readPending = (key: string, storage?: StorageLike): PendingUpload | null => readRecord(key, isPending, storage);
export const writePending = (key: string, p: PendingUpload, storage?: StorageLike): boolean => writeRecord(key, p, storage);
export const clearPending = (key: string, storage?: StorageLike): void => removeRecord(key, storage);

/**
 * What to do with an upload, from what the cloud holds now and what this device last saw:
 *  - first      nothing in the cloud and this device never had a copy there: upload with no base revision
 *  - update     the cloud copy is exactly the one this device last saw: replace it
 *  - unseen     the cloud has a copy this device has never seen (another device, or before this one remembered): conflict
 *  - changed    the cloud copy is newer than the one this device last saw: conflict
 *  - deleted    this device saw a copy that has since been deleted: conflict (uploading would be a new first copy)
 */
export type UploadVerdict = { kind: 'first' | 'update'; base: number | null } | { kind: 'unseen' | 'changed' | 'deleted' };
export const uploadVerdict = (record: CloudRecord | null, cloud: BackupMeta | null): UploadVerdict => {
  if (!cloud) return record ? { kind: 'deleted' } : { kind: 'first', base: null };
  if (!record) return { kind: 'unseen' };
  return record.revision === cloud.revision ? { kind: 'update', base: cloud.revision } : { kind: 'changed' };
};

/** The server's own answer to a refused upload: the copy that is there now (or null when it was deleted). */
export const conflictCurrent = (extra: Record<string, unknown>): BackupMeta | null | undefined => {
  if (!('current' in extra)) return undefined;
  const c = extra.current as Partial<BackupMeta> | null;
  if (c === null) return null;
  return c && typeof c.revision === 'number' && Array.isArray(c.includes) && typeof c.updatedAt === 'string' && typeof c.sizeBytes === 'number'
    ? { revision: c.revision, includes: c.includes.filter(isInclude), sizeBytes: c.sizeBytes, schemaVersion: typeof c.schemaVersion === 'number' ? c.schemaVersion : null, updatedAt: c.updatedAt }
    : undefined;
};

export const formatWhen = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};
export const formatSize = (bytes: number): string => (bytes < 1024 ? `${bytes} bytes` : bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);
export const includesLine = (includes: readonly Include[]): string =>
  includes.length === 0 ? 'plan and history only (no journal, no health readings)'
    : `plan and history, plus ${includes.map((i) => (i === 'journal' ? 'your private journal and check-in notes' : 'your health readings')).join(' and ')}`;

/** Used by the screens to tell a usable snapshot from the server from anything else. */
export const looksLikeSnapshot = (v: unknown): v is AppData => !!v && typeof v === 'object' && Array.isArray((v as AppData).sessions);

/** The device's records about one account's cloud backup. Per account, so two accounts on one device never share them. */
export const cloudRecordKey = (accountId: string): string => `cleanflow:cloud-backup@${accountId}`;
export const cloudPendingKey = (accountId: string): string => `cleanflow:cloud-pending@${accountId}`;
