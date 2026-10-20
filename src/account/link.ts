import type { AppData } from '../domain/types';
import { countData, sameData, stableText, type DataCounts } from '../storage/backupPlan';
import { interpret, STORAGE_KEY, type LoadStatus, type Repository, type StorageLike } from '../storage/repository';
import { draftsKey } from '../state/drafts';
import { hasUserData } from '../storage/schema';
import { cloudPendingKey, cloudRecordKey } from './cloudBackup';
import { deviceStorage, readRecord, removeRecord, writeRecord } from './deviceStore';

/**
 * Copying the data this browser saved before accounts into the signed-in account. The original is never moved, changed or erased: the
 * account gets a COPY, in its own namespaced storage, and only after the person has seen what it holds and agreed.
 *
 * The order is fixed so that no step can lose anything, and a record of the intention is written first so an interrupted copy can be
 * explained after a reload:
 *   1. write the intent        (what we are about to do, and which data)
 *   2. keep a restore point of the device's earlier data, and of the account's own plan if it has one (if either cannot be kept, STOP)
 *   3. put the copy into the running app and flush it to storage
 *   4. read storage back and compare; if it is not what we wrote, put the previous plan back
 *   5. record that this device's earlier data went into this account, then drop the intent
 * Nothing here starts a trial, touches a subscription or calls the server.
 */

export const LEGACY_CLAIM_KEY = 'cleanflow:legacy-link';
export const intentKey = (accountId: string): string => `cleanflow:link-intent@${accountId}`;
const accountKey = (accountId: string): string => `${STORAGE_KEY}@${accountId}`;

export interface LegacyData { data: AppData; counts: DataCounts; status: LoadStatus; repairs: string[]; sizeChars: number }
export type LegacyRead = { kind: 'none' } | { kind: 'unreadable'; raw: string; reason: string } | { kind: 'ok'; legacy: LegacyData };

/** What the original (un-namespaced) key holds. Read-only. An empty plan that holds nothing the person made is "none". */
export const readLegacy = (storage?: StorageLike): LegacyRead => {
  const st = deviceStorage(storage);
  if (!st) return { kind: 'none' };
  let raw: string | null = null;
  try { raw = st.getItem(STORAGE_KEY); } catch { return { kind: 'none' }; }
  if (raw === null) return { kind: 'none' };
  const r = interpret(raw);
  if (r.status === 'unreadable' || !r.data) return { kind: 'unreadable', raw, reason: r.reason ?? 'The saved data could not be read.' };
  if (!hasUserData(r.data) && !r.data.wellbeing.journal.length) return { kind: 'none' };
  return { kind: 'ok', legacy: { data: r.data, counts: countData(r.data), status: r.status, repairs: r.repairs, sizeChars: raw.length } };
};

/** A short fingerprint of some data (its stable text without the revision counter), enough to tell "the same data" from "different data". */
export const hashData = (d: AppData): string => {
  const t = stableText(d);
  let h = 0x811c9dc5;
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return `${t.length}:${h.toString(16)}`;
};

/** Which account this device's earlier data was copied into, and when. It is about the original data, so it is not namespaced. */
export interface LegacyClaim { accountId: string; at: string; hash: string }
const isClaim = (v: unknown): LegacyClaim | null => {
  const o = v as Partial<LegacyClaim> | null;
  return o && typeof o.accountId === 'string' && typeof o.at === 'string' && typeof o.hash === 'string' ? { accountId: o.accountId, at: o.at, hash: o.hash } : null;
};
export const readClaim = (storage?: StorageLike): LegacyClaim | null => readRecord(LEGACY_CLAIM_KEY, isClaim, storage);

export type LinkKind =
  | 'nothing'        // there is no earlier data on this device to copy
  | 'unreadable'     // there is, but it cannot be read: it stays untouched and cannot be copied
  | 'ready'          // the account has no plan yet: the copy has nothing to replace
  | 'replace'        // the account already has a plan: copying means replacing it, and the person must choose that
  | 'identical'      // the account already holds exactly this data
  | 'linked';        // this account got a copy before and has been used since

export interface LinkSituation {
  kind: LinkKind;
  legacy: LegacyData | null;
  own: DataCounts | null;
  /** This data was already copied into a DIFFERENT account on this device. A second copy is allowed, but only knowingly. */
  claimedByOther: boolean;
  claim: LegacyClaim | null;
}

export const linkSituation = (o: { read: LegacyRead; own: AppData; accountId: string; claim: LegacyClaim | null }): LinkSituation => {
  const own = hasUserData(o.own) ? countData(o.own) : null;
  const base = { legacy: null, own, claimedByOther: false, claim: o.claim };
  if (o.read.kind === 'none') return { ...base, kind: 'nothing' };
  if (o.read.kind === 'unreadable') return { ...base, kind: 'unreadable' };
  const legacy = o.read.legacy;
  const hash = hashData(legacy.data);
  const claimedByOther = !!o.claim && o.claim.accountId !== o.accountId && o.claim.hash === hash;
  const common = { ...base, legacy, claimedByOther };
  if (!own) return { ...common, kind: 'ready' };
  if (sameData(o.own, legacy.data)) return { ...common, kind: 'identical' };
  if (o.claim && o.claim.accountId === o.accountId && o.claim.hash === hash) return { ...common, kind: 'linked' };
  return { ...common, kind: 'replace' };
};

// ─────────────────────────── the interrupted-copy record ───────────────────────────

export interface LinkIntent { startedAt: string; choice: 'copy' | 'replace'; hash: string; /** The copied plan's own id: it travels with the copy, so "the account holds this plan" can still be told after the app has changed some details. */ planId: string; hadOwnPlan: boolean }
const isIntent = (v: unknown): LinkIntent | null => {
  const o = v as Partial<LinkIntent> | null;
  return o && typeof o.startedAt === 'string' && (o.choice === 'copy' || o.choice === 'replace') && typeof o.hash === 'string' && typeof o.hadOwnPlan === 'boolean'
    ? { startedAt: o.startedAt, choice: o.choice, hash: o.hash, planId: typeof o.planId === 'string' ? o.planId : '', hadOwnPlan: o.hadOwnPlan } : null;
};
export const readIntent = (accountId: string, storage?: StorageLike): LinkIntent | null => readRecord(intentKey(accountId), isIntent, storage);

/** What an interrupted copy left behind, worked out from what is actually stored, never from a flag: the copy either reached the account's storage or it did not. */
export type IntentOutcome = { kind: 'none' } | { kind: 'completed'; intent: LinkIntent } | { kind: 'unchanged'; intent: LinkIntent };
export const intentOutcome = (accountId: string, storage?: StorageLike): IntentOutcome => {
  const intent = readIntent(accountId, storage);
  if (!intent) return { kind: 'none' };
  let raw: string | null = null;
  try { raw = deviceStorage(storage)?.getItem(accountKey(accountId)) ?? null; } catch { /* unreadable storage: treat as unchanged */ }
  const r = interpret(raw);
  // The copy is "done" if what is stored is exactly it, or is that very plan (same id) which the app has since touched: once the app has
  // run, a detail such as the last-opened day may differ, and a done copy must not be reported as "nothing was changed".
  const done = !!r.data && (hashData(r.data) === intent.hash || (intent.planId !== '' && r.data.user.id === intent.planId));
  return done ? { kind: 'completed', intent } : { kind: 'unchanged', intent };
};

/** Finish what an interrupted copy started when its work is in fact done (record the claim), and forget the intent once the person has been told. */
export const settleIntent = (accountId: string, forget: boolean, storage?: StorageLike): void => {
  const out = intentOutcome(accountId, storage);
  if (out.kind === 'completed' && !readClaim(storage)) writeRecord(LEGACY_CLAIM_KEY, { accountId, at: out.intent.startedAt, hash: out.intent.hash } satisfies LegacyClaim, storage);
  if (forget) removeRecord(intentKey(accountId), storage);
};

// ─────────────────────────── the copy itself ───────────────────────────

export interface LinkEnv {
  storage?: StorageLike;
  accountId: string;
  repo: Pick<Repository, 'backup' | 'peek'>;
  /** The account's plan as the running app holds it now. */
  current: AppData;
  /** Put `next` into the running app (the app's own replace, which keeps its own automatic copy). False when it did not happen. */
  replace: (next: AppData) => boolean;
  /** Put a previous plan back into the running app without any ceremony (only used to undo a copy that could not be saved). */
  revert: (prev: AppData) => void;
  /** Write whatever the running app holds to storage now. */
  flush: () => void;
  now?: () => Date;
}

export type LinkFailure = 'no-room-for-copy' | 'not-replaced' | 'not-saved';
export type LinkResult = { ok: true; copied: DataCounts; keptPrevious: boolean } | { ok: false; reason: LinkFailure };

export const performLink = (env: LinkEnv, legacy: LegacyData, choice: 'copy' | 'replace'): LinkResult => {
  const st = deviceStorage(env.storage);
  const hadOwnPlan = hasUserData(env.current);
  const hash = hashData(legacy.data);
  const now = (env.now ?? (() => new Date()))().toISOString();
  const abandon = (reason: LinkFailure): LinkResult => { removeRecord(intentKey(env.accountId), env.storage); return { ok: false, reason }; };
  if (!st) return { ok: false, reason: 'no-room-for-copy' };

  // 1. the intent, before anything else
  writeRecord(intentKey(env.accountId), { startedAt: now, choice, hash, planId: legacy.data.user.id, hadOwnPlan } satisfies LinkIntent, env.storage);

  // 2. restore points, before anything is replaced. If either cannot be kept, nothing has changed and we stop.
  if (!env.repo.backup(legacy.data, 'device-copy')) return abandon('no-room-for-copy');
  if (hadOwnPlan && !env.repo.backup(env.current, 'before-link')) return abandon('no-room-for-copy');

  // 3. the copy, into the running app, then to storage
  if (!env.replace(legacy.data)) return abandon('not-replaced');
  env.flush();

  // 4. read it back: what is stored must be what we meant to store, or the previous plan goes back
  const stored = env.repo.peek?.();
  if (!stored?.data || hashData(stored.data) !== hash) {
    env.revert(env.current);
    env.flush();
    return abandon('not-saved');
  }

  // 5. done: record where the earlier data went, forget the intent
  writeRecord(LEGACY_CLAIM_KEY, { accountId: env.accountId, at: now, hash } satisfies LegacyClaim, env.storage);
  removeRecord(intentKey(env.accountId), env.storage);
  return { ok: true, copied: legacy.counts, keptPrevious: hadOwnPlan };
};

export const undoClaim = (accountId: string, storage?: StorageLike): void => {
  const c = readClaim(storage);
  if (c && c.accountId === accountId) removeRecord(LEGACY_CLAIM_KEY, storage);
};

/**
 * After an account is deleted: this device's memory of its cloud backup is meaningless (the server holds nothing any more), so it goes. When
 * the person also erased the account's plan from this device, the record of a copy that was in progress goes too, and so does the note that
 * the earlier data went into that account, so the next account is not warned about an account that no longer exists.
 */
export const forgetAccountOnDevice = (accountId: string, erasedPlan: boolean, storage?: StorageLike): void => {
  removeRecord(cloudRecordKey(accountId), storage);
  removeRecord(cloudPendingKey(accountId), storage);
  removeRecord(draftsKey(accountId), storage);               // unsent text is never kept for an account that no longer exists, whatever happens to the plan
  if (!erasedPlan) return;
  removeRecord(intentKey(accountId), storage);
  const claim = readClaim(storage);
  if (claim && claim.accountId === accountId) removeRecord(LEGACY_CLAIM_KEY, storage);
};
