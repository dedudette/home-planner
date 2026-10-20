import type { StorageLike } from '../storage/repository';

/**
 * Text a person has typed into a form or sheet and not saved yet ("a draft"), with the form's own structure that gives it meaning (the rows
 * they added, the options they chose), and what happens to it when they leave: the planner's access gate closes (account/AccessGate.tsx), the
 * session ends, they sign out, or the account changes. Without this, text typed into a form would be gone when access came back, and a
 * full-page trip to the payment provider and back would lose it for certain.
 *
 * What is promised, and what is not:
 *  - A form keeps its state in this registry as it is typed (only in accounts mode; local mode has no gate and none of this runs). The forms
 *    do it themselves with useDraftState (state/DraftScope.tsx): the text fields, the options chosen, and rows added with a button. Nothing is
 *    read back out of the page's DOM.
 *  - It is written to this browser's storage ONLY when the person leaves: the planner closes, or this account's app goes away (sign-out, the
 *    session ending, the account changing), under that account's own key. Text typed while the planner is open and never left is not written
 *    anywhere. Closing the tab, reloading, a crash or the browser discarding the page does NOT write it: those do not run any code that could.
 *  - It is never sent anywhere: this file has no network code, the draft key is not part of the plan, an export or a backup, and the server
 *    never sees it.
 *  - It is never submitted by itself. After access returns, or the person signs back in, they open the form again (or press Resume) and press
 *    its own button.
 *  - Saving or closing a form on purpose discards its draft (a sheet is dropped when it leaves the sheet stack). A draft is also discarded on
 *    request, when the account is deleted, and after MAX_AGE_DAYS.
 *  - A draft exists only while some text in it has been typed (a changed option alone is not worth keeping). Search boxes, quick-add boxes and
 *    the onboarding steps do not use drafts.
 */

export const DRAFTS_VERSION = 2;
export const draftsKey = (accountId: string): string => `cleanflow:drafts@${accountId}`;
export const MAX_AGE_DAYS = 30;
export const MAX_AGE_MS = MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
/** Far above any field's own `maxLength` (the journal's is 8,000): these only stop a corrupt or hostile record from filling storage. */
export const LIMITS = { drafts: 12, keys: 60, stringChars: 20_000, draftChars: 40_000, totalChars: 150_000 } as const;
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

export interface DraftSummary { scope: string; label: string; resume: ResumeTarget; page: string | null; at: number }
export interface DraftsSnapshot {
  /** Drafts that were kept because the person left (the planner closed, or they signed out or the session ended). Text still being typed while the planner is open is not listed: it is not stored. */
  drafts: DraftSummary[];
  /** Everything that holds typed text right now, kept or not: what a sign-out would leave behind. */
  held: number;
  /** Writing to this device failed the last time: the drafts live only as long as this page stays open. */
  persistFailed: boolean;
  bannerHidden: boolean;
}

/** One piece of a form's state. `text` says it is typed text (a draft exists only while some text in it does); the rest is structure and choices. */
interface Entry { v: unknown; text: boolean }
interface Draft { info: ScopeInfo; state: Record<string, Entry>; at: number; interrupted: boolean }
interface StoredDraft { scope: string; label: string; resume: ResumeTarget; state: Record<string, { v: unknown; t: boolean }>; at: string }

const isDraft = (d: Draft): boolean => Object.values(d.state).some((e) => e.text);
const sizeOf = (state: Record<string, Entry>): number => JSON.stringify(state).length;
const KEY = /^[A-Za-z0-9_.-]{1,60}$/;

/** A value a form can hold in a draft: plain data only (strings, numbers, booleans, null, arrays and objects of them), bounded. */
const plainValue = (v: unknown, depth = 0): boolean => {
  if (v === null || typeof v === 'boolean' || typeof v === 'number') return typeof v !== 'number' || Number.isFinite(v);
  if (typeof v === 'string') return v.length <= LIMITS.stringChars;
  if (depth > 5) return false;
  if (Array.isArray(v)) return v.length <= 80 && v.every((x) => plainValue(x, depth + 1));
  if (typeof v === 'object') { const o = v as Record<string, unknown>; return Object.keys(o).length <= 40 && Object.values(o).every((x) => plainValue(x, depth + 1)); }
  return false;
};

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
    if (!s || typeof s.scope !== 'string' || typeof s.label !== 'string' || typeof s.at !== 'string' || !s.state || typeof s.state !== 'object' || !s.resume || typeof s.resume !== 'object') continue;
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
    const state: Record<string, Entry> = {};
    let ok = true;
    for (const [k, e] of Object.entries(s.state as Record<string, unknown>)) {
      const en = e as { v?: unknown; t?: unknown } | null;
      if (!KEY.test(k) || !en || typeof en !== 'object' || !('v' in en) || !plainValue(en.v)) { ok = false; break; }
      if (Object.keys(state).length >= LIMITS.keys) { ok = false; break; }
      state[k] = { v: en.v, text: en.t === true };
    }
    if (!ok) continue;
    const chars = sizeOf(state);
    if (!Object.keys(state).length || chars > LIMITS.draftChars || total + chars > LIMITS.totalChars) continue;
    if (!Object.values(state).some((e) => e.text)) continue;                  // no typed text: not a draft
    total += chars;
    out.push({ info, state, at, interrupted: true });
  }
  return out;
};

/** Two values of a form's state are the same (plain data, compared by content). */
export const sameState = (a: unknown, b: unknown): boolean => a === b || JSON.stringify(a) === JSON.stringify(b);

/** A put-back value is only used if it has the same shape as the form's own starting value (the same kind of thing, the same fields in each row). */
export const shapeOk = (start: unknown, saved: unknown): boolean => {
  if (start === null || start === undefined) return saved === null || ['string', 'number', 'boolean', 'object'].includes(typeof saved);
  if (Array.isArray(start)) return Array.isArray(saved) && (start.length === 0 || saved.every((x) => shapeOk(start[0], x)));
  if (typeof start === 'object') {
    if (typeof saved !== 'object' || saved === null || Array.isArray(saved)) return false;
    return Object.keys(start as object).every((k) => k in (saved as object) && shapeOk((start as Record<string, unknown>)[k], (saved as Record<string, unknown>)[k]));
  }
  return typeof saved === typeof start;
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
  private snap: DraftsSnapshot = { drafts: [], held: 0, persistFailed: false, bannerHidden: false };

  constructor(readonly accountId: string, private readonly storage: StorageLike | null, private readonly now: () => number = Date.now) {
    for (const d of readDrafts(storage, accountId, this.now())) this.map.set(d.info.id, d);
    this.publish();
  }

  // ── what the forms use ──
  /** What the form last held for this piece of state (a draft's text, a chosen option, the rows added), or undefined when there is none. */
  stateOf(scope: string, key: string): unknown {
    const e = this.map.get(scope)?.state[key];
    return e === undefined ? undefined : JSON.parse(JSON.stringify(e.v));
  }

  /**
   * Called when a piece of a form's state changes. `dirty` says it differs from what the form starts with (an unchanged piece is forgotten);
   * `text` says it is typed text. A form with no typed text left has no draft, whatever options it holds.
   */
  capture(info: ScopeInfo, key: string, value: unknown, text: boolean, dirty: boolean): void {
    if (this.dead || !KEY.test(key)) return;
    let d = this.map.get(info.id);
    if (!dirty) {
      if (!d || !(key in d.state)) return;
      delete d.state[key];
      if (!Object.keys(d.state).length) { this.map.delete(info.id); this.changed(d); return; }
      d.at = this.now();
      this.changed(d);
      return;
    }
    if (!plainValue(value)) return;                                  // plain data only (a NaN or a function would not survive being written down)
    let v: unknown;
    try { v = JSON.parse(JSON.stringify(value)); } catch { return; }
    if (d && key in d.state && sameState(d.state[key].v, v) && d.state[key].text === text) return;      // nothing new (for instance, a value just put back)
    if (!d) { d = { info, state: {}, at: this.now(), interrupted: false }; this.map.set(info.id, d); }
    if (!(key in d.state) && Object.keys(d.state).length >= LIMITS.keys) return;
    d.state[key] = { v, text };
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
   * because the person left is not ended by this: it stays until they finish it, discard it, or it expires.
   */
  dropPagesExcept(route: string): void { for (const d of [...this.map.values()]) if (d.info.page !== null && d.info.page !== route && !d.interrupted) this.drop(d.info.id); }

  // ── leaving ──
  /**
   * The person is leaving: the planner closed, or this account's app is going away (sign-out, the session ended, the account changed). What is
   * typed and unsaved is kept on this device, for this account, and listed on the screens that stay open and in the planner when it comes back.
   */
  interrupt(): number {
    if (this.dead) return 0;
    let n = 0;
    for (const d of this.map.values()) { if (isDraft(d)) { d.interrupted = true; n++; } }
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
  /** Writes pending changes now (page closing). */
  flush(): void { if (this.timer !== null) { this.cancelTimer(); this.persist(); } }
  /** Starts (or, in development's double mount, restarts) the registry's life. */
  activate(): void { this.dead = false; }
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
    const kept = [...this.map.values()].filter((d) => d.interrupted && isDraft(d)).sort((a, b) => b.at - a.at);
    const out: StoredDraft[] = [];
    let total = 0;
    for (const d of kept) {
      const chars = sizeOf(d.state);
      if (out.length >= LIMITS.drafts || chars > LIMITS.draftChars || total + chars > LIMITS.totalChars) continue;
      total += chars;
      out.push({ scope: d.info.id, label: d.info.label, resume: d.info.resume, state: Object.fromEntries(Object.entries(d.state).map(([k, e]) => [k, { v: e.v, t: e.text }])), at: new Date(d.at).toISOString() });
    }
    try {
      if (!this.storage) { this.failed = out.length > 0; return; }
      if (!out.length) { if (force || this.storage.getItem(draftsKey(this.accountId)) !== null) this.storage.removeItem(draftsKey(this.accountId)); this.failed = false; return; }
      this.storage.setItem(draftsKey(this.accountId), JSON.stringify({ v: DRAFTS_VERSION, drafts: out }));
      this.failed = false;
    } catch { this.failed = true; }
  }

  private publish(): void {
    const all = [...this.map.values()].filter(isDraft);
    const drafts = all.filter((d) => d.interrupted).sort((a, b) => b.at - a.at)
      .map((d): DraftSummary => ({ scope: d.info.id, label: d.info.label, resume: d.info.resume, page: d.info.page, at: d.at }));
    this.snap = { drafts, held: all.length, persistFailed: this.failed, bannerHidden: this.hidden };
    for (const l of [...this.listeners]) l();
  }
}

/** A fixed, empty snapshot for the places that look at drafts when there is no registry (local mode, or outside an account). */
export const NO_DRAFTS: DraftsSnapshot = { drafts: [], held: 0, persistFailed: false, bannerHidden: false };
