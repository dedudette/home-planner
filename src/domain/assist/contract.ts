import { MEAL_SLOTS, type MealSlot } from '../meals/types';
import type { ISODate } from '../types';
import { clean, textProblem } from './text';
import { ASSIST_FEATURES, LIMITS, type AssistFeature, type AssistProposal, type AssistRequest, type Candidate, type ProposalItem } from './types';

/**
 * The two checks that make the assistant safe to rely on. `validateRequest` decides what may be sent (an exact shape, nothing extra,
 * bounded sizes, no markup), and `validateProposal` decides what may be shown: every item must point at a candidate that was in the
 * request, on a day and slot that was in the request, with words that pass the text rules. Whatever fails is dropped, never repaired.
 */

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const ID = /^[a-z0-9][a-z0-9:_-]{0,59}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PLAIN = /^[^<>{}`\\]*$/;
const exactKeys = (o: Record<string, unknown>, keys: string[]): boolean => Object.keys(o).length === keys.length && keys.every((k) => k in o);

export type RequestCheck = { ok: true; request: AssistRequest } | { ok: false; code: 'invalid' | 'insufficient' };

const isRealDate = (s: string): boolean => { if (!DATE.test(s)) return false; const d = new Date(`${s}T00:00:00Z`); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s; };

const candidateOk = (raw: unknown): Candidate | null => {
  if (!isObj(raw)) return null;
  const allowed = ['id', 'name', 'minutes', 'tags', 'slots'];
  if (Object.keys(raw).some((k) => !allowed.includes(k)) || !('id' in raw) || !('name' in raw) || !('minutes' in raw) || !('tags' in raw)) return null;
  const id = typeof raw.id === 'string' && ID.test(raw.id) ? raw.id : null;
  const name = clean(raw.name);
  if (!id || !name || name.length > LIMITS.name || !PLAIN.test(name)) return null;
  if (typeof raw.minutes !== 'number' || !Number.isInteger(raw.minutes) || raw.minutes < 0 || raw.minutes > LIMITS.minutes) return null;
  if (!Array.isArray(raw.tags) || raw.tags.length > LIMITS.tags) return null;
  const tags: string[] = [];
  for (const t of raw.tags) { const c = clean(t); if (!c || c.length > LIMITS.tag || !PLAIN.test(c)) return null; tags.push(c); }
  let slots: MealSlot[] | undefined;
  if (raw.slots !== undefined) {
    if (!Array.isArray(raw.slots) || raw.slots.length > MEAL_SLOTS.length || raw.slots.some((s) => !(MEAL_SLOTS as readonly unknown[]).includes(s))) return null;
    slots = [...new Set(raw.slots as MealSlot[])];
  }
  return { id, name, minutes: raw.minutes, tags, ...(slots ? { slots } : {}) };
};

export const validateRequest = (raw: unknown): RequestCheck => {
  const bad = { ok: false, code: 'invalid' } as const;
  if (!isObj(raw) || !exactKeys(raw, ['v', 'feature', 'days', 'slots', 'maxItems', 'wish', 'candidates']) || raw.v !== 1) return bad;
  const feature = raw.feature;
  if (!(ASSIST_FEATURES as readonly unknown[]).includes(feature)) return bad;
  if (!Array.isArray(raw.days) || raw.days.length > LIMITS.days) return bad;
  const days: ISODate[] = [];
  for (const d of raw.days) { if (typeof d !== 'string' || !isRealDate(d) || days.includes(d)) return bad; days.push(d); }
  if (!Array.isArray(raw.slots) || raw.slots.some((s) => !(MEAL_SLOTS as readonly unknown[]).includes(s))) return bad;
  const slots = [...new Set(raw.slots as MealSlot[])];
  if (typeof raw.maxItems !== 'number' || !Number.isInteger(raw.maxItems) || raw.maxItems < 1 || raw.maxItems > LIMITS.items) return bad;
  const wish = clean(raw.wish);
  if (wish === null || wish.length > LIMITS.wish) return bad;
  if (!Array.isArray(raw.candidates) || raw.candidates.length > LIMITS.candidates) return bad;
  const seen = new Set<string>();
  const candidates: Candidate[] = [];
  for (const c of raw.candidates) { const k = candidateOk(c); if (!k || seen.has(k.id)) return bad; seen.add(k.id); candidates.push(k); }
  const f = feature as AssistFeature;
  if (f === 'meals' && (days.length === 0 || slots.length === 0)) return bad;
  if (f === 'movement' && days.length === 0) return bad;
  if (f === 'learning' && (days.length > 0 || slots.length > 0)) return bad;
  if (f !== 'meals' && slots.length > 0) return bad;
  if (f === 'meals' && candidates.some((c) => !c.slots || c.slots.length === 0)) return bad;
  if (candidates.length === 0) return { ok: false, code: 'insufficient' };
  return { ok: true, request: { v: 1, feature: f, days, slots, maxItems: raw.maxItems, wish, candidates } };
};

export type ProposalCheck = { ok: true; proposal: AssistProposal; dropped: number } | { ok: false; reason: 'malformed' | 'nothing-reliable' };

const parse = (input: unknown): unknown => {
  if (typeof input !== 'string') return input;
  let t = input.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(t);
  if (fence) t = fence[1];
  try { return JSON.parse(t); } catch { return undefined; }
};

/** The numbers a sentence about one candidate may contain: its own minutes, and the request's own counts. */
const numbersFor = (c: Candidate, req: AssistRequest): number[] => [c.minutes, req.maxItems, req.days.length, req.slots.length];

/**
 * Check what the model returned against the exact request it answered. `input` is the provider's text, or an already-parsed object
 * (the browser checks the server's answer again, against the request the person reviewed).
 */
export const validateProposal = (input: unknown, req: AssistRequest): ProposalCheck => {
  const data = parse(input);
  if (!isObj(data) || !Array.isArray(data.items)) return { ok: false, reason: 'malformed' };
  const byId = new Map(req.candidates.map((c) => [c.id, c]));
  const kept: ProposalItem[] = [];
  const taken = new Set<string>();
  let dropped = 0;
  for (const raw of data.items.slice(0, LIMITS.items * 2)) {
    const item = checkItem(raw, req, byId, taken);
    if (item && kept.length < req.maxItems) { kept.push(item); taken.add(slotKey(item)); } else dropped++;
  }
  let note = '';
  if (data.note !== undefined && data.note !== null && data.note !== '') {
    const n = clean(data.note);
    // A note that fails the checks is left out; the items stand on their own.
    if (n && n.length <= LIMITS.note && !textProblem(n, [req.maxItems, req.days.length, req.slots.length, ...req.candidates.map((c) => c.minutes)])) note = n;
  }
  if (kept.length === 0) return { ok: false, reason: data.items.length === 0 ? 'malformed' : 'nothing-reliable' };
  return { ok: true, proposal: { feature: req.feature, note, items: kept }, dropped };
};

const slotKey = (i: ProposalItem): string => (hasSlot(i) ? `${i.date}|${i.slot}` : i.date ? `${i.date}` : `c:${i.candidateId}`);
const hasSlot = (i: ProposalItem): boolean => i.slot !== null;

const checkItem = (raw: unknown, req: AssistRequest, byId: Map<string, Candidate>, taken: Set<string>): ProposalItem | null => {
  if (!isObj(raw)) return null;
  const id = typeof raw.candidateId === 'string' ? raw.candidateId : typeof raw.candidate_id === 'string' ? raw.candidate_id : null;
  const c = id ? byId.get(id) : undefined;
  if (!c) return null; // the model named something that was not offered
  const reason = clean(raw.reason);
  if (!reason || reason.length < 3 || reason.length > LIMITS.reason || textProblem(reason, numbersFor(c, req))) return null;
  let date: ISODate | null = null;
  let slot: MealSlot | null = null;
  if (req.feature !== 'learning') {
    if (typeof raw.date !== 'string' || !req.days.includes(raw.date)) return null;
    date = raw.date;
  } else if (raw.date !== undefined && raw.date !== null) return null;
  if (req.feature === 'meals') {
    if (typeof raw.slot !== 'string' || !req.slots.includes(raw.slot as MealSlot) || !c.slots?.includes(raw.slot as MealSlot)) return null;
    slot = raw.slot as MealSlot;
  } else if (raw.slot !== undefined && raw.slot !== null) return null;
  const item: ProposalItem = { candidateId: c.id, date, slot, reason };
  if (taken.has(slotKey(item))) return null; // one thing per slot, one session per day, each idea once
  return item;
};
