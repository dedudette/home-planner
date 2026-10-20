import type { StorageLike } from '../storage/repository';

/**
 * Text a person has typed into a form or sheet and not saved yet ("a draft"), and what happens to it when the planner's access gate closes
 * (account/AccessGate.tsx). The gate replaces the planner with the Trial & plans screen, which unmounts every form; without this the typed
 * text would be gone when access came back, and a full-page trip to the payment provider and back would lose it for certain.
 *
 * What is promised, and what is not:
 *  - Text is held in memory, per account, as it is typed (only in accounts mode; local mode has no gate and none of this runs).
 *  - It is written to this browser's storage ONLY when the planner closes ("interrupted"), under that account's own key. Text typed while the
 *    planner is open and never interrupted is never written anywhere, exactly as before.
 *  - It is never sent anywhere: this file has no network code, the draft key is not part of the plan, an export or a backup, and the server
 *    never sees it.
 *  - It is never submitted by itself. After access returns the person opens the form again (or presses Resume) and presses its own button.
 *  - Saving or closing a form on purpose discards its draft (a sheet is dropped when it leaves the sheet stack). A draft is also discarded on
 *    request, when the account is deleted, and after MAX_AGE_DAYS.
 *  - What is captured is text typed into text-like fields (text, search, number, date, time, tel, url, email, textarea) that the form has
 *    at the time it is opened again. Choices made with buttons, chips, selects and checkboxes, and rows a person added with a button
 *    (ingredient or exercise rows) are not captured. Password fields are never captured.
 */

export const DRAFTS_VERSION = 1;
export const draftsKey = (accountId: string): string => `cleanflow:drafts@${accountId}`;
export const MAX_AGE_DAYS = 30;
export const MAX_AGE_MS = MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
/** Far above any field's own `maxLength` (the journal's is 8,000): these only stop a corrupt or hostile record from filling storage. */
export const LIMITS = { drafts: 12, fields: 40, fieldChars: 20_000, draftChars: 40_000, totalChars: 150_000 } as const;
const PERSIST_DELAY_MS = 250;

/** The sheets that hold typed text and can be reopened from their description alone (no callbacks, no copy of a task). */
const SHEET_LABELS: Record<string, string> = {
  taskForm: 'A task', activityForm: 'A planned activity', journal: 'A journal entry', dishForm: 'A dish', workoutForm: 'A workout',
  interestForm: 'An interest', interest: 'An interest', bookForm: 'A book', logSession: 'A learning session', mealEdit: 'A meal',
  mealPicker: 'A meal', shopItem: 'A shopping item', shopGen: 'A shopping list', waterEdit: 'A water entry',
};
export const DRAFT_SHEET_KINDS: ReadonlySet<string> = new Set(Object.keys(SHEET_LABELS));

export type ResumeTarget = { sheet: Record<string, unknown> } | { route: string };

export interface ScopeInfo {
  /** `sheet:<the sheet's description>` or `page:<name>`. The same form opened for the same thing has the same id. */
  id: string;
  /** Plain words for a list ("A journal entry"). Never the text itself. */
  label: string;
  resume: ResumeTarget;
  /** For a form that lives on a page rather than in a sheet: the page (route) it belongs to. */
  page: string | null;
}

const stable = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(v) ?? 'null';
};
const isPlain = (v: unknown, depth = 0): boolean => {
  if (v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return true;
  if (depth > 3) return false;
  if (Array.isArray(v)) return v.length <= 50 && v.every((x) => isPlain(x, depth + 1));
  if (typeof v === 'object') return Object.keys(v as object).length <= 30 && Object.values(v as object).every((x) => isPlain(x, depth + 1));
  return false;
};

/** The scope of a sheet from the app's own description of it, or null for a sheet that holds no typed text or cannot be reopened from words. */
export const scopeOfSheet = (sheet: { kind: string }): ScopeInfo | null => {
  if (!DRAFT_SHEET_KINDS.has(sheet.kind)) return null;
  let plain: Record<string, unknown>;
  try { plain = JSON.parse(JSON.stringify(sheet)) as Record<string, unknown>; } catch { return null; }
  if (!isPlain(plain)) return null;
  return { id: `sheet:${stable(plain)}`, label: SHEET_LABELS[sheet.kind], resume: { sheet: plain }, page: null };
};

export const pageScope = (name: string, route: string, label: string): ScopeInfo => ({ id: `page:${name}`, label, resume: { route }, page: route });

export interface DraftSummary { scope: string; label: string; resume: ResumeTarget; page: string | null; at: number; fieldCount: number }
export interface DraftsSnapshot {
  /** Drafts that were kept because the planner closed. Typed text that has not been interrupted is not listed (it is not stored). */
  drafts: DraftSummary[];
  /** Writing to this device failed the last time: the drafts live only as long as this page stays open. */
  persistFailed: boolean;
  bannerHidden: boolean;
}

interface Draft { info: ScopeInfo; fields: Record<string, string>; at: number; interrupted: boolean }
interface StoredDraft { scope: string; label: string; resume: ResumeTarget; fields: Record<string, string>; at: string }

const clip = (s: string): string => (s.length > LIMITS.fieldChars ? s.slice(0, LIMITS.fieldChars) : s);
const charsOf = (f: Record<string, string>): number => Object.values(f).reduce((n, v) => n + v.length, 0);

/** Reads and checks the stored drafts for one account. Anything malformed, forged, too old or too large is dropped, never trusted. */
export const readDrafts = (storage: StorageLike | null, accountId: string, nowMs: number): Draft[] => {
  let raw: string | null = null;
  try { raw = storage?.getItem(draftsKey(accountId)) ?? null; } catch { return []; }
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  const rec = parsed as { v?: unknown; drafts?: unknown };
  if (!rec || rec.v !== DRAFTS_VERSION || !Array.isArray(rec.drafts)) return [];
  const out: Draft[] = [];
  let total = 0;
  for (const d of rec.drafts as unknown[]) {
    if (out.length >= LIMITS.drafts) break;
    const s = d as Partial<StoredDraft> | null;
    if (!s || typeof s.scope !== 'string' || typeof s.label !== 'string' || typeof s.at !== 'string' || !s.fields || typeof s.fields !== 'object' || !s.resume || typeof s.resume !== 'object') continue;
    const at = Date.parse(s.at);
    if (!Number.isFinite(at) || nowMs - at > MAX_AGE_MS) continue;
    let info: ScopeInfo | null = null;
    if (s.scope.startsWith('sheet:')) {
      const sheet = (s.resume as { sheet?: unknown }).sheet as { kind?: unknown } | undefined;
      if (!sheet || typeof sheet !== 'object' || typeof sheet.kind !== 'string') continue;
      const again = scopeOfSheet(sheet as { kind: string });
      if (!again || again.id !== s.scope) continue;                        // the description and the id must agree: a record cannot name a different sheet
      info = again;
    } else if (s.scope.startsWith('page:') && s.scope.length <= 60) {
      const route = (s.resume as { route?: unknown }).route;
      if (typeof route !== 'string' || !/^[a-z]{1,24}$/.test(route)) continue;
      info = { id: s.scope, label: s.label.slice(0, 80), resume: { route }, page: route };
    }
    if (!info) continue;
    const fields: Record<string, string> = {};
    for (const [k, v] of Object.entries(s.fields as Record<string, unknown>)) {
      if (Object.keys(fields).length >= LIMITS.fields) break;
      if (typeof v === 'string' && v !== '' && k.length <= 120) fields[k] = clip(v);
    }
    const chars = charsOf(fields);
    if (!Object.keys(fields).length || chars > LIMITS.draftChars || total + chars > LIMITS.totalChars) continue;
    total += chars;
    out.push({ info, fields, at, interrupted: true });
  }
  return out;
};

/**
 * The drafts of ONE account. Created for the signed-in account's scope (so another account never gets this object), and thrown away with it.
 * Reads storage once, at creation. Writes only the interrupted drafts, and only to that account's key.
 */
export class DraftRegistry {
  private map = new Map<string, Draft>();
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private failed = false;
  private hidden = false;
  private dead = false;
  private snap: DraftsSnapshot = { drafts: [], persistFailed: false, bannerHidden: false };

  constructor(readonly accountId: string, private readonly storage: StorageLike | null, private readonly now: () => number = Date.now) {
    for (const d of readDrafts(storage, accountId, this.now())) this.map.set(d.info.id, d);
    this.publish();
  }

  // ── what the forms use ──
  /** The text last typed in this form (field key → text). Empty when there is none. */
  fieldsOf(scope: string): Record<string, string> { return { ...(this.map.get(scope)?.fields ?? {}) }; }

  /** Called as the person types. A field emptied again is forgotten; a form with nothing left in it has no draft. */
  capture(info: ScopeInfo, field: string, value: string): void {
    if (this.dead) return;
    let d = this.map.get(info.id);
    const v = clip(value);
    if (v === '') {
      if (!d || !(field in d.fields)) return;
      delete d.fields[field];
      if (!Object.keys(d.fields).length) { this.map.delete(info.id); this.changed(d); return; }
    } else {
      if (!d) { d = { info, fields: {}, at: this.now(), interrupted: false }; this.map.set(info.id, d); }
      if (!(field in d.fields) && Object.keys(d.fields).length >= LIMITS.fields) return;
      d.fields[field] = v;
    }
    d.at = this.now();
    this.changed(d);
  }

  /** The person finished with this form on purpose (saved it, cancelled it, closed it): its text is not wanted any more. */
  drop(scope: string): void {
    const d = this.map.get(scope);
    if (!d || this.dead) return;
    this.map.delete(scope);
    this.changed(d);
  }
  dropSheet(sheet: { kind: string }): void { const s = scopeOfSheet(sheet); if (s) this.drop(s.id); }
  /**
   * Moving to another page on purpose ends the forms of the pages left behind (not called while the planner is closed). A draft that was kept
   * because the planner closed is not ended by this: it stays until the person finishes it, discards it, or it expires.
   */
  dropPagesExcept(route: string): void { for (const d of [...this.map.values()]) if (d.info.page !== null && d.info.page !== route && !d.interrupted) this.drop(d.info.id); }

  // ── the gate ──
  /** The planner closed: what is typed and unsaved is kept on this device, for this account, and listed on the screens that stay open. */
  interrupt(): number {
    if (this.dead) return 0;
    let n = 0;
    for (const d of this.map.values()) { if (Object.keys(d.fields).length) { d.interrupted = true; n++; } }
    this.persist();
    this.publish();
    return n;
  }

  // ── the person's own control over what is kept ──
  discard(scope: string): void { this.drop(scope); }
  discardAll(): void {
    if (this.dead) return;
    const had = this.map.size > 0;
    this.map.clear();
    this.cancelTimer();
    this.persist(true);
    if (had) this.publish();
  }
  hideBanner(): void { this.hidden = true; this.publish(); }

  // ── plumbing ──
  /** Writes pending changes now (page closing, account leaving). */
  flush(): void { if (this.timer !== null) { this.cancelTimer(); this.persist(); } }
  /** After this, nothing is written or read: the account has gone. */
  dispose(): void { this.cancelTimer(); this.dead = true; this.listeners.clear(); }

  subscribe = (fn: () => void): (() => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getSnapshot = (): DraftsSnapshot => this.snap;

  private changed(d: Draft): void {
    if (d.interrupted) this.schedulePersist();
    this.publish();
  }
  private cancelTimer(): void { if (this.timer !== null) { clearTimeout(this.timer); this.timer = null; } }
  private schedulePersist(): void {
    if (this.timer !== null || this.dead) return;
    this.timer = setTimeout(() => { this.timer = null; this.persist(); this.publish(); }, PERSIST_DELAY_MS);
  }

  /** Writes the interrupted drafts (newest first, within the limits), or removes the key when there are none. */
  private persist(force = false): void {
    if (this.dead) return;
    this.cancelTimer();
    const kept = [...this.map.values()].filter((d) => d.interrupted && Object.keys(d.fields).length).sort((a, b) => b.at - a.at);
    const out: StoredDraft[] = [];
    let total = 0;
    for (const d of kept) {
      const chars = charsOf(d.fields);
      if (out.length >= LIMITS.drafts || chars > LIMITS.draftChars || total + chars > LIMITS.totalChars) continue;
      total += chars;
      out.push({ scope: d.info.id, label: d.info.label, resume: d.info.resume, fields: d.fields, at: new Date(d.at).toISOString() });
    }
    try {
      if (!this.storage) { this.failed = out.length > 0; return; }
      if (!out.length) { if (force || this.storage.getItem(draftsKey(this.accountId)) !== null) this.storage.removeItem(draftsKey(this.accountId)); this.failed = false; return; }
      this.storage.setItem(draftsKey(this.accountId), JSON.stringify({ v: DRAFTS_VERSION, drafts: out }));
      this.failed = false;
    } catch { this.failed = true; }
  }

  private publish(): void {
    const drafts = [...this.map.values()].filter((d) => d.interrupted && Object.keys(d.fields).length)
      .sort((a, b) => b.at - a.at)
      .map((d): DraftSummary => ({ scope: d.info.id, label: d.info.label, resume: d.info.resume, page: d.info.page, at: d.at, fieldCount: Object.keys(d.fields).length }));
    this.snap = { drafts, persistFailed: this.failed, bannerHidden: this.hidden };
    for (const l of [...this.listeners]) l();
  }
}

/** A fixed, empty snapshot for the places that look at drafts when there is no registry (local mode, or outside an account). */
export const NO_DRAFTS: DraftsSnapshot = { drafts: [], persistFailed: false, bannerHidden: false };
