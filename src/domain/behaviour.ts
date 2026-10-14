import { addDays, diffDays } from './dates';
import type { AppData, EntryOutcome, ExposureItem, ISODate, LeftOutItem, PlannerExclusion, SessionEntry } from './types';

/**
 * Behaviour facts: what the recorded data does and does not say.
 *
 * This is the one place that decides what "seen", "no action", "not opened" and "unknown" mean, so every insight (and any later
 * analysis) shares the same rules. It is deliberately small, pure, and conservative:
 *
 *  - A task the planner SELECTED is not a task the person SAW. Seen is recorded by the Today screen (`seenAt`); for records written
 *    before contract 2 it is unknown, and stays unknown.
 *  - A task the planner LEFT OUT is not an exposure and not a failure. Its reason is the planner's, recorded when it decided.
 *  - SKIPPED, SNOOZED and MOVED are things the person did (entries). "No recorded action" is the absence of an entry. It is never
 *    counted as a skip, and nothing here says why a person did or did not act.
 *  - A day with no decision record is "not opened" only when records exist on both sides of it; before records began, or after the
 *    oldest kept record, it is unknown. History removed to save space (a retention note) is unknown too.
 */

/**
 * The fewest distinct days any rule here treats as a pattern. The skip-streak and steady-room insights and the "Your patterns" page all
 * share it, so "enough days" means the same thing everywhere.
 */
export const MIN_PATTERN_DAYS = 3;

/** Entries that are the person's response to the day's scheduled list, as opposed to one-off helpers with no schedule of their own. */
export const isEphemeralTask = (taskId: string): boolean => taskId.startsWith('five:') || taskId.startsWith('rough:');
export const isScheduledEntry = (e: Pick<SessionEntry, 'taskId' | 'via'>): boolean => !isEphemeralTask(e.taskId) && e.via !== 'five' && e.via !== 'reset';
export const isHomeEntry = (e: Pick<SessionEntry, 'domain'>): boolean => !e.domain || e.domain === 'home';

export type UnknownWhy = 'before-records' | 'older-record' | 'history-trimmed' | 'no-plan';
export type DayStatus =
  /** A contract 2 record exists: the app was visible and the planner decided. */
  | { kind: 'opened' }
  /** Something was logged that day but there is no contract 2 record (older data, or the record rolled off). The app was used. */
  | { kind: 'acted' }
  /** Records exist before and after this day, and nothing was logged: the app was not opened (visible) that day. */
  | { kind: 'not-opened' }
  | { kind: 'unknown'; why: UnknownWhy };

/** The first date from which entries are complete: the day after the newest day history was removed from, or null if none was. */
export const historyKnownFrom = (d: Pick<AppData, 'retention'>): ISODate | null => {
  const through = d.retention.reduce<ISODate | null>((m, n) => (m === null || n.removedThrough > m ? n.removedThrough : m), null);
  return through ? addDays(through, 1) : null;
};

/** The date contract 2 recording began (the oldest contract 2 record still kept), or null when there is none. */
export const recordsBegin = (d: Pick<AppData, 'exposures'>): ISODate | null => d.exposures.find((e) => e.contract === 2)?.date ?? null;

export const dayStatus = (d: AppData, date: ISODate, today: ISODate): DayStatus => {
  if (date < d.plan.startDate) return { kind: 'unknown', why: 'no-plan' };
  const rec = d.exposures.find((e) => e.date === date);
  if (rec?.contract === 2) return { kind: 'opened' };
  const acted = d.sessions.some((s) => s.date === date && s.entries.length > 0);
  if (acted) return { kind: 'acted' };
  if (rec) return { kind: 'unknown', why: 'older-record' };
  const begin = recordsBegin(d);
  const known = historyKnownFrom(d);
  if (known && date < known) return { kind: 'unknown', why: 'history-trimmed' };
  if (!begin || date < begin) return { kind: 'unknown', why: 'before-records' };
  if (date > today) return { kind: 'unknown', why: 'no-plan' };
  return { kind: 'not-opened' };
};

export type ActionOnTask = EntryOutcome | 'none-recorded';

export interface SelectedFact {
  taskId: string;
  domain: ExposureItem['domain'];
  kind: ExposureItem['kind'];
  /** true: rendered on Today while visible. false: recorded as not seen. 'unknown': the record predates display tracking. */
  seen: boolean | 'unknown';
  action: ActionOnTask;
  energyAtSelection?: ExposureItem['energy'];
  energyAtAction?: SessionEntry['energy'];
}
export interface LeftOutFact {
  taskId: string;
  /** The planner's reason, or 'unknown' for a record that predates reasons (its 'extra' items). */
  reason: PlannerExclusion | 'unknown';
  revealed: boolean | 'unknown';
  /** What the person then did with it, if anything (they may pull a left-out task in from another screen). */
  action: ActionOnTask;
}
export interface DayFacts { date: ISODate; status: DayStatus; selected: SelectedFact[]; leftOut: LeftOutFact[]; actionsKnown: boolean }

const lastEntryFor = (d: AppData, date: ISODate, taskId: string): SessionEntry | undefined =>
  d.sessions.filter((s) => s.date === date).flatMap((s) => s.entries).filter((e) => e.taskId === taskId).sort((a, b) => (a.at < b.at ? -1 : 1)).pop();

export const dayFacts = (d: AppData, date: ISODate, today: ISODate): DayFacts => {
  const rec = d.exposures.find((e) => e.date === date);
  const known = historyKnownFrom(d);
  const actionsKnown = !known || date >= known;
  const act = (taskId: string): { action: ActionOnTask; e?: SessionEntry } => {
    if (!actionsKnown) return { action: 'none-recorded' };
    const e = lastEntryFor(d, date, taskId);
    return { action: e ? e.outcome : 'none-recorded', e };
  };
  const selected: SelectedFact[] = [];
  const leftOut: LeftOutFact[] = [];
  for (const i of rec?.items ?? []) {
    if (i.kind === 'extra') { leftOut.push({ taskId: i.taskId, reason: 'unknown', revealed: 'unknown', action: act(i.taskId).action }); continue; }
    const { action, e } = act(i.taskId);
    selected.push({ taskId: i.taskId, domain: i.domain, kind: i.kind, seen: rec?.contract === 2 ? !!i.seenAt : 'unknown', action, energyAtSelection: i.energy, energyAtAction: e?.energy });
  }
  for (const x of (rec?.left ?? []) as LeftOutItem[]) leftOut.push({ taskId: x.taskId, reason: x.reason, revealed: !!x.seenAt, action: act(x.taskId).action });
  return { date, status: dayStatus(d, date, today), selected, leftOut, actionsKnown };
};

export interface WindowSummary {
  from: ISODate;
  to: ISODate;
  days: { opened: number; acted: number; notOpened: number; unknown: number };
  /** Selected tasks on days with a contract 2 record. */
  selected: number;
  seen: number;
  notSeen: number;
  /** Selected tasks on days recorded before display tracking. */
  seenUnknown: number;
  /** What the person did with selected tasks that day. Skips, snoozes and moves are explicit actions. */
  completed: number;
  skipped: number;
  snoozed: number;
  moved: number;
  stopped: number;
  /** Seen, and no action recorded by the end of that day. Only days before `to`'s own day are counted: today is not over. */
  seenNoAction: number;
  /** Seen on `to`'s own day with no action yet. The day is not over, so this is neither "no action" nor anything else. */
  seenPending: number;
  /** Seen, with no action on file, but history was removed for that day, so "no action" cannot be said. */
  seenActionsUnknown: number;
  leftOut: Record<PlannerExclusion | 'unknown', number>;
  /** True when history was removed inside the window, so counts of actions are incomplete. */
  partial: boolean;
}

/** Counts over a window, with every unknown kept apart from every known. Never turns "no action" into a skip. */
export const summarizeWindow = (d: AppData, from: ISODate, to: ISODate, filter: (i: SelectedFact) => boolean = () => true): WindowSummary => {
  const out: WindowSummary = {
    from, to, days: { opened: 0, acted: 0, notOpened: 0, unknown: 0 }, selected: 0, seen: 0, notSeen: 0, seenUnknown: 0, completed: 0, skipped: 0, snoozed: 0, moved: 0, stopped: 0,
    seenNoAction: 0, seenPending: 0, seenActionsUnknown: 0, leftOut: { 'not-enough-time': 0, 'low-energy-day': 0, 'not-a-cleaning-day': 0, unknown: 0 }, partial: false,
  };
  const known = historyKnownFrom(d);
  out.partial = !!known && known > from;
  for (let day = from, n = 0; day <= to && n < 400; day = addDays(day, 1), n++) {
    const f = dayFacts(d, day, to);
    const k = f.status.kind;
    if (k === 'opened') out.days.opened++; else if (k === 'acted') out.days.acted++; else if (k === 'not-opened') out.days.notOpened++; else out.days.unknown++;
    for (const x of f.leftOut) out.leftOut[x.reason]++;
    for (const s of f.selected.filter(filter)) {
      out.selected++;
      if (s.seen === true) out.seen++; else if (s.seen === false) out.notSeen++; else out.seenUnknown++;
      if (s.action === 'completed') out.completed++;
      else if (s.action === 'skipped') out.skipped++;
      else if (s.action === 'snoozed') out.snoozed++;
      else if (s.action === 'moved') out.moved++;
      else if (s.action === 'stopped') out.stopped++;
      else if (s.seen === true) {
        if (!f.actionsKnown) out.seenActionsUnknown++;
        else if (day < to) out.seenNoAction++;
        else out.seenPending++;
      }
    }
  }
  return out;
};

/** Days between two dates, counting both ends. */
export const spanDays = (from: ISODate, to: ISODate): number => diffDays(to, from) + 1;
