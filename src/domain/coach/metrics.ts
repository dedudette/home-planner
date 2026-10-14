import { evidenceFor, PATTERN_WINDOWS, type EvidenceStrength, type PatternWindow, type Patterns } from '../patterns';

/**
 * What the AI coach is allowed to be told, and the only vocabulary it may cite.
 *
 * The request is NOT free text. It is a window length and a fixed set of named counts, each computed here from Patterns (which comes
 * from behaviour.ts). There are no names, task names, room names, dates, ids or notes in it: nothing a person typed can reach the
 * model, and nothing the model says can refer to anything outside this list. The server rebuilds every label from this registry
 * rather than trusting any text from the browser.
 */

export type MetricRole =
  /** A recorded fact a suggestion may rest on. */
  | 'evidence'
  /** Tells the model what the data does not cover. It may be mentioned, but no suggestion may rest on it. */
  | 'context';

export const METRICS = {
  'days.window': { label: 'Days in this window', role: 'context' },
  'days.opened': { label: 'Days the app was opened', role: 'evidence' },
  'days.notOpened': { label: 'Days the app was not opened', role: 'evidence' },
  'days.acted': { label: 'Days with activity but no record of what Today showed', role: 'context' },
  'days.unknown': { label: 'Days with unknown status', role: 'context' },
  'history.daysRemoved': { label: 'Days whose history was removed to save space', role: 'context' },
  'tasks.seen': { label: 'Tasks shown on Today', role: 'evidence' },
  'tasks.seenCompleted': { label: 'Shown tasks that were completed', role: 'evidence' },
  'tasks.seenSkipped': { label: 'Shown tasks that were skipped', role: 'evidence' },
  'tasks.seenSnoozed': { label: 'Shown tasks that were snoozed', role: 'evidence' },
  'tasks.seenMoved': { label: 'Shown tasks that were moved to another day', role: 'evidence' },
  'tasks.seenStopped': { label: 'Shown tasks where a timer was stopped early', role: 'evidence' },
  'tasks.seenNoAction': { label: 'Shown tasks with no recorded action', role: 'evidence' },
  'tasks.seenOutcomeOpen': { label: 'Shown tasks whose outcome is not final (today is not over, or history was removed)', role: 'context' },
  'tasks.notShown': { label: 'Tasks selected for a day but not shown on Today', role: 'evidence' },
  'leftOut.notEnoughTime': { label: 'Tasks left out by the planner: not enough time', role: 'evidence' },
  'leftOut.lowEnergyDay': { label: 'Tasks left out by the planner: low-energy day', role: 'evidence' },
  'leftOut.notACleaningDay': { label: 'Tasks left out by the planner: not a cleaning day', role: 'evidence' },
  'area.home.seen': { label: 'Home cleaning tasks shown', role: 'evidence' },
  'area.home.completed': { label: 'Home cleaning tasks completed', role: 'evidence' },
  'area.home.noAction': { label: 'Home cleaning tasks shown with no recorded action', role: 'evidence' },
  'area.habits.seen': { label: 'Daily habit tasks shown', role: 'evidence' },
  'area.habits.completed': { label: 'Daily habit tasks completed', role: 'evidence' },
  'area.habits.noAction': { label: 'Daily habit tasks shown with no recorded action', role: 'evidence' },
} as const satisfies Record<string, { label: string; role: MetricRole }>;

export type MetricId = keyof typeof METRICS;
export const METRIC_IDS = Object.keys(METRICS) as MetricId[];
export const isMetricId = (x: unknown): x is MetricId => typeof x === 'string' && Object.prototype.hasOwnProperty.call(METRICS, x);

/** The request. Exactly this shape and nothing else is ever sent. */
export interface CoachPayload {
  v: 1;
  windowDays: PatternWindow;
  metrics: Record<MetricId, number>;
}

export const MAX_METRIC_VALUE = 9999;

/** The numbers for a window. Null when there is not enough known to ask for anything (the AI is not offered then). */
export const buildCoachPayload = (p: Patterns): CoachPayload | null => {
  if (!p.evidence.sufficient) return null;
  const s = p.seen;
  const metrics: Record<MetricId, number> = {
    'days.window': p.windowDays,
    'days.opened': p.days.opened,
    'days.notOpened': p.days.notOpened,
    'days.acted': p.days.acted,
    'days.unknown': p.days.unknown,
    'history.daysRemoved': p.history.daysRemovedInWindow,
    'tasks.seen': s.tasks,
    'tasks.seenCompleted': s.completed,
    'tasks.seenSkipped': s.skipped,
    'tasks.seenSnoozed': s.snoozed,
    'tasks.seenMoved': s.moved,
    'tasks.seenStopped': s.stopped,
    'tasks.seenNoAction': s.noAction,
    'tasks.seenOutcomeOpen': s.pendingToday + s.actionsRemoved,
    'tasks.notShown': p.notShown,
    'leftOut.notEnoughTime': p.leftOut.notEnoughTime,
    'leftOut.lowEnergyDay': p.leftOut.lowEnergyDay,
    'leftOut.notACleaningDay': p.leftOut.notACleaningDay,
    'area.home.seen': p.areas.home.seen,
    'area.home.completed': p.areas.home.completed,
    'area.home.noAction': p.areas.home.noAction,
    'area.habits.seen': p.areas.habits.seen,
    'area.habits.completed': p.areas.habits.completed,
    'area.habits.noAction': p.areas.habits.noAction,
  };
  for (const id of METRIC_IDS) metrics[id] = Math.max(0, Math.min(MAX_METRIC_VALUE, Math.round(metrics[id])));
  return { v: 1, windowDays: p.windowDays, metrics };
};

export type PayloadCheck =
  | { ok: true; payload: CoachPayload; strength: EvidenceStrength }
  | { ok: false; code: 'invalid' | 'insufficient'; detail: string };

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

/**
 * Strict check of a request. Unknown keys, missing keys, non-integers, out-of-range values and counts that cannot add up are all
 * refused, and "enough evidence" is re-decided here from the counts themselves, never from anything the sender says about it.
 */
export const validatePayload = (raw: unknown): PayloadCheck => {
  const bad = (detail: string): PayloadCheck => ({ ok: false, code: 'invalid', detail });
  if (!isObj(raw)) return bad('not an object');
  const keys = Object.keys(raw);
  if (keys.length !== 3 || !['v', 'windowDays', 'metrics'].every((k) => keys.includes(k))) return bad('unexpected fields');
  if (raw.v !== 1) return bad('unsupported version');
  if (!PATTERN_WINDOWS.includes(raw.windowDays as PatternWindow)) return bad('unsupported window');
  if (!isObj(raw.metrics)) return bad('metrics missing');
  const mk = Object.keys(raw.metrics);
  if (mk.length !== METRIC_IDS.length || !mk.every(isMetricId)) return bad('unexpected metrics');
  const m = {} as Record<MetricId, number>;
  for (const id of METRIC_IDS) {
    const v = (raw.metrics as Record<string, unknown>)[id];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > MAX_METRIC_VALUE) return bad(`bad value for ${id}`);
    m[id] = v;
  }
  const w = raw.windowDays as PatternWindow;
  // The counts have to be able to add up, or the request did not come from this app.
  if (m['days.window'] !== w) return bad('window mismatch');
  if (m['days.opened'] + m['days.notOpened'] + m['days.acted'] + m['days.unknown'] !== w) return bad('days do not add up');
  if (m['history.daysRemoved'] > w) return bad('history days exceed the window');
  const actions = m['tasks.seenCompleted'] + m['tasks.seenSkipped'] + m['tasks.seenSnoozed'] + m['tasks.seenMoved'] + m['tasks.seenStopped'] + m['tasks.seenNoAction'] + m['tasks.seenOutcomeOpen'];
  if (actions !== m['tasks.seen']) return bad('shown tasks do not add up');
  if (m['area.home.seen'] + m['area.habits.seen'] !== m['tasks.seen']) return bad('areas do not add up');
  if (m['area.home.completed'] + m['area.habits.completed'] !== m['tasks.seenCompleted']) return bad('completed does not add up');
  if (m['area.home.noAction'] + m['area.habits.noAction'] !== m['tasks.seenNoAction']) return bad('no-action does not add up');
  const ev = evidenceFor(m['days.opened'], m['tasks.seen']);
  if (!ev.sufficient || !ev.strength) return { ok: false, code: 'insufficient', detail: 'not enough recorded days or shown tasks' };
  return { ok: true, payload: { v: 1, windowDays: w, metrics: m }, strength: ev.strength };
};

export interface MetricLine { id: MetricId; label: string; value: number; role: MetricRole }

/** The request as readable lines: used for the review screen and for the prompt, so what is reviewed is what is sent. */
export const describePayload = (p: CoachPayload): MetricLine[] => METRIC_IDS.map((id) => ({ id, label: METRICS[id].label, value: p.metrics[id], role: METRICS[id].role }));
