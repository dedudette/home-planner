import type { EvidenceStrength } from '../patterns';
import { isMetricId, METRICS, type CoachPayload, type MetricId } from './metrics';

/**
 * What the AI coach may say, and the deterministic checks that decide whether it is shown.
 *
 * The model explains counts the app has already computed. It does not decide what is true: every claim has to point at named counts
 * from the exact request that was sent, every number in its text has to be one of those counts, and anything that diagnoses,
 * guesses at a cause, claims something the records do not say, or tells the person to change their plan is dropped. If nothing
 * survives, the person sees a calm "I couldn't create a reliable suggestion", never the raw model text.
 */

export type SuggestionKind = 'pattern' | 'idea' | 'data_note';

export interface CoachSuggestion {
  kind: SuggestionKind;
  title: string;
  explanation: string;
  /** An optional thing the person could try that changes nothing in their plan. */
  idea?: string;
  /** The named counts from the request that this rests on. */
  metricIds: MetricId[];
  /** About the amount of recorded data only. Never about the person. */
  strength: EvidenceStrength;
}

export interface CoachOutput { suggestions: CoachSuggestion[]; insufficient: boolean }

export type OutputCheck =
  | { ok: true; output: CoachOutput; dropped: number }
  | { ok: false; reason: 'malformed' | 'nothing-reliable' };

export const MAX_SUGGESTIONS = 3;
const MAX_CONSIDERED = 8;
const LIMITS = { title: [3, 80], explanation: [10, 400], idea: [5, 200], ids: [1, 6] } as const;

/** Things the app already offers that change nothing in the plan. An idea has to name one of them. */
export const COACH_FEATURES = ['Just 5 minutes', 'I only have', 'left out of today', 'Tomorrow tab', 'Your patterns'] as const;

const STRENGTH_ORDER: EvidenceStrength[] = ['limited', 'moderate', 'good'];
const lower = (a: EvidenceStrength, b: EvidenceStrength): EvidenceStrength => (STRENGTH_ORDER.indexOf(a) <= STRENGTH_ORDER.indexOf(b) ? a : b);

// ───────────── what may not be said ─────────────
const BANNED: { name: string; re: RegExp }[] = [
  { name: 'cause', re: /\b(because|due to|caused?|causes|reasons?|why|result of|leads? to|explains?|explained by|that's why|which is why)\b/i },
  { name: 'emotion, health or character', re: /\b(motivat\w*|lazy|laziness|procrastinat\w*|disciplin\w*|willpower|committed|commitment|character|personality|traits?|struggl\w*|overwhelm\w*|stress\w*|anxi\w*|depress\w*|moods?|feel(s|ing|ings)?|felt|emotion\w*|burn(ed|t)? ?out|exhaust\w*|tired|fatigue\w*|sleep\w*|health\w*|mental\w*|disorder|adhd|lack of|gave up|giving up|fail(ed|ure|ing|s)?|avoid\w*|excuses?|slack\w*|neglect\w*|bad habits?)\b/i },
  { name: 'speculation', re: /\b(suggests?|indicates?|implies|probably|likely|seems?|appears? to|perhaps|maybe|might be|could be|tends? to|usually|always|never)\b/i },
  { name: 'pressure', re: /\b(should|must|need to|needs to|have to|ought)\b/i },
  { name: 'ignored', re: /\bignor(e|ed|es|ing)\b/i },
  { name: 'vague quantity', re: /\b(half|most|mostly|majority|minority|nearly|almost|roughly|about|around|approximately|several|many|few)\b|%/i },
  { name: 'markup or link', re: /[<>`{}]|https?:|www\.|\]\(/i },
  // The model never changes anything, and must not say or imply that it has.
  { name: 'claims a change', re: /\b(i|i've|i have|i'll|i will|i'm going to|let me|we've|we have|we'll|we will)\b[^.!?]{0,40}\b(chang\w*|updat\w*|adjust\w*|remov\w*|delet\w*|add(ed|ing)?|reschedul\w*|mov(e|ed)|lower\w*|rais\w*|reduc\w*|increas\w*|turn\w*|enabl\w*|disabl\w*|made)\b/i },
  { name: 'plan change', re: /\b(chang\w*|edit\w*|updat\w*|adjust\w*|lower\w*|rais\w*|reduc\w*|increas\w*|trim\w*|remov\w*|delet\w*|disabl\w*|enabl\w*|turn (on|off)|switch\w*|reschedul\w*|postpon\w*)\b[^.!?]{0,50}\b(goals?|budgets?|daily time|session (time|length|minutes)|minutes per day|schedule|routines?|rest days?|energy setting|plan|settings?|frequenc\w*|reminders?)\b/i },
  { name: 'task change', re: /\b(remov\w*|delet\w*|hid(e|ing)|add(ed|ing)?|reschedul\w*|postpon\w*)\b[^.!?]{0,30}\btasks?\b/i },
  // Nothing may ask for more than the day already allows, or for pushing past energy, rest or safety limits.
  { name: 'bypasses limits', re: /\b(push through|ignore (your )?(energy|rest|limits?|safety|body)|despite (low|your) energy|even (if|when) (you are|you're) (tired|low)|anyway|extra (tasks?|minutes)|double|triple|catch up on everything)\b/i },
];

/** Words that claim something the records only support if the matching count was cited, and is above zero. */
const NEEDS_EVIDENCE: { word: RegExp; ids: MetricId[]; what: string }[] = [
  { word: /\bskip(s|ped|ping)?\b/i, ids: ['tasks.seenSkipped'], what: 'skipped' },
  { word: /\bsnooz\w*/i, ids: ['tasks.seenSnoozed'], what: 'snoozed' },
  { word: /\bmoved\b/i, ids: ['tasks.seenMoved'], what: 'moved' },
  { word: /\bstopped\b/i, ids: ['tasks.seenStopped'], what: 'stopped' },
  { word: /\b(complet(e|ed|es|ing|ion)|finish(ed|es)?|done)\b/i, ids: ['tasks.seenCompleted', 'area.home.completed', 'area.habits.completed'], what: 'completed' },
  { word: /\b(saw|seen|shown|viewed|displayed)\b/i, ids: ['tasks.seen', 'tasks.seenCompleted', 'tasks.seenSkipped', 'tasks.seenSnoozed', 'tasks.seenMoved', 'tasks.seenStopped', 'tasks.seenNoAction', 'area.home.seen', 'area.habits.seen', 'area.home.noAction', 'area.habits.noAction'], what: 'shown' },
  { word: /\bopened\b/i, ids: ['days.opened', 'days.notOpened'], what: 'opened' },
  { word: /\bleft out\b/i, ids: ['leftOut.notEnoughTime', 'leftOut.lowEnergyDay', 'leftOut.notACleaningDay'], what: 'left out' },
];

const ALLOWED_DIGIT_PHRASES = ['Just 5 minutes'];

const inRange = (s: string, [min, max]: readonly [number, number]) => s.length >= min && s.length <= max;
const clean = (x: unknown): string | null => (typeof x === 'string' ? x.replace(/\s+/g, ' ').trim() : null);

/** Why a piece of text is not acceptable, or null. `cited` are the counts it points at, with their values from the request. */
export const textProblem = (text: string, cited: { id: MetricId; value: number }[], windowDays: number): string | null => {
  // The name of the app's own time-boxed list ("I only have…") starts with the word "I"; it is not a claim by the model.
  const scrubbed = text.replace(/I only have/gi, 'the time list');
  for (const b of BANNED) if (b.re.test(scrubbed)) return b.name;
  for (const n of NEEDS_EVIDENCE) if (n.word.test(text) && !cited.some((c) => n.ids.includes(c.id) && c.value > 0)) return `says "${n.what}" without a recorded count`;
  let t = text;
  for (const p of ALLOWED_DIGIT_PHRASES) t = t.split(p).join(' ');
  const allowed = new Set<number>([windowDays, ...cited.map((c) => c.value)]);
  for (const tok of t.match(/\d+(?:[.,]\d+)?/g) ?? []) if (!allowed.has(Number(tok.replace(',', '.')))) return `number ${tok} is not one of the cited counts`;
  return null;
};

type Verdict = { ok: true; s: CoachSuggestion } | { ok: false; why: string };

const checkOne = (raw: unknown, payload: CoachPayload, cap: EvidenceStrength): Verdict => {
  const no = (why: string): Verdict => ({ ok: false, why });
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return no('not an object');
  const r = raw as Record<string, unknown>;
  const kind = r.kind;
  if (kind !== 'pattern' && kind !== 'idea' && kind !== 'data_note') return no('unknown kind');
  const title = clean(r.title), explanation = clean(r.explanation);
  if (!title || !inRange(title, LIMITS.title)) return no('bad title');
  if (!explanation || !inRange(explanation, LIMITS.explanation)) return no('bad explanation');
  let idea: string | undefined;
  if (r.idea !== undefined && r.idea !== null && r.idea !== '') {
    const i = clean(r.idea);
    if (!i || !inRange(i, LIMITS.idea)) return no('bad idea');
    idea = i;
  }
  if (kind === 'idea' && !idea) return no('idea missing');
  if (idea && !COACH_FEATURES.some((f) => idea!.toLowerCase().includes(f.toLowerCase()))) return no('idea is not about a feature that leaves the plan alone');
  // The model writes `metric_ids`; the server's checked answer carries the same list as `metricIds`. Either is read the same way.
  const cited = r.metric_ids ?? r.metricIds;
  if (!Array.isArray(cited) || cited.length < LIMITS.ids[0] || cited.length > LIMITS.ids[1]) return no('bad evidence list');
  const ids: MetricId[] = [];
  for (const id of cited) {
    if (!isMetricId(id) || !(id in payload.metrics)) return no('cites something that was not sent');
    if (!ids.includes(id)) ids.push(id);
  }
  // Suggestions rest on recorded facts. Counts that only say what the data does not cover may be mentioned in a data note, nothing else.
  if (kind !== 'data_note' && ids.some((id) => METRICS[id].role !== 'evidence')) return no('rests on a count that is not evidence');
  const counts = ids.map((id) => ({ id, value: payload.metrics[id] }));
  if (kind !== 'data_note' && !counts.some((c) => c.value > 0)) return no('cites only zeros');
  for (const part of [title, explanation, idea]) {
    if (!part) continue;
    const p = textProblem(part, counts, payload.windowDays);
    if (p) return no(p);
  }
  const model = r.strength;
  if (model !== 'limited' && model !== 'moderate' && model !== 'good') return no('bad strength');
  return { ok: true, s: { kind, title, explanation, ...(idea ? { idea } : {}), metricIds: ids, strength: lower(model, cap) } };
};

const parse = (input: unknown): unknown => {
  if (typeof input !== 'string') return input;
  let t = input.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(t);
  if (fence) t = fence[1];
  try { return JSON.parse(t); } catch { return undefined; }
};

/**
 * Check what the model returned against the exact request it answered. `input` is the provider's text, or an already-parsed object
 * (the browser checks the server's answer again, against the request the person reviewed).
 */
export const validateCoachOutput = (input: unknown, payload: CoachPayload, cap: EvidenceStrength): OutputCheck => {
  const data = parse(input);
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, reason: 'malformed' };
  const d = data as Record<string, unknown>;
  if (!Array.isArray(d.suggestions)) return { ok: false, reason: 'malformed' };
  const kept: CoachSuggestion[] = [];
  let dropped = 0;
  for (const raw of d.suggestions.slice(0, MAX_CONSIDERED)) {
    const v = checkOne(raw, payload, cap);
    if (v.ok && kept.length < MAX_SUGGESTIONS) kept.push(v.s); else dropped++;
  }
  if (kept.length === 0) {
    if (d.suggestions.length === 0 && d.insufficient === true) return { ok: true, output: { suggestions: [], insufficient: true }, dropped: 0 };
    return { ok: false, reason: 'nothing-reliable' };
  }
  return { ok: true, output: { suggestions: kept, insufficient: false }, dropped };
};
