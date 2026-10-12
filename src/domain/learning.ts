import { dayFacts, historyKnownFrom, isHomeEntry, isScheduledEntry, summarizeWindow } from './behaviour';
import { addDays, daysInRange, diffDays } from './dates';
import { FREQ_LABEL } from './schedule';
import { LADDER } from './engine';
import { allEntries, type PlanView } from './view';
import { PROGRESSION, progressionReadiness } from './progression';
import type { Frequency, ISODate, RoomKind, SessionEntry } from './types';

/**
 * The "learning" layer: simple, explainable rules over what the user actually
 * did. Nothing changes silently. Every adaptation is offered as a suggestion.
 */

export type InsightActionId = 'shorter' | 'smaller' | 'less-often' | 'move' | 'remove' | 'keep' | 'dismiss' | 'level-up' | 'level-down';

export interface InsightAction { id: InsightActionId; label: string; minutes?: number; frequency?: Frequency; level?: 1 | 2 | 3 }

export interface Insight {
  id: string;
  /** Machine-readable reason ('skip-streak', 'level-up'...). Recorded with every recommendation event. */
  code: string;
  /** The numbers the sentence is built from, so the explanation can always be reproduced and checked. */
  evidence?: Record<string, number | string>;
  tone: 'suggest' | 'celebrate';
  title: string;
  body: string;
  taskId?: string;
  actions: InsightAction[];
}

const WINDOW_DAYS = 21;
/** How far back a run of skips on one task is looked for. */
const STREAK_WINDOW_DAYS = 28;
const STREAK_MIN_DAYS = 3;
const SHORTER_MIN_DAYS = 2;
const STEADY_MIN_DAYS = 3;

export const lowerFrequency = (f: Frequency): Frequency | null => {
  const i = LADDER.indexOf(f);
  return i > 0 ? LADDER[i - 1] : null;
};

/**
 * The rules below read only what the person DID (entries) and, where it exists, what they were SHOWN (see behaviour.ts). Shared rules:
 *  - "No completion" is never a skip. A skip is an entry with outcome 'skipped'; a snooze or move is its own thing.
 *  - A day declared low-energy is a known reason for doing less, so its skips are not read as "this task is too big".
 *  - One-off helpers (Just 5 minutes, the rough-day steps, the reset sequence) are not the routines, and are left out.
 *  - A window that history was removed from is not read at all: a short count there would look like a quiet period.
 *  - Nothing is said about why anyone did or did not do something, and every suggestion is optional and only ever makes things
 *    smaller or gentler. The one that adds work (a step up) needs a yes and is held back by the guards in progression.ts.
 */
export const computeInsights = (v: PlanView): Insight[] => {
  const today = v.today;
  const since = addDays(today, -WINDOW_DAYS);
  const all = allEntries(v.data);
  const entries = all.filter((e) => e.date >= since && e.date <= today);
  const known = historyKnownFrom(v.data);
  const complete = (days: number) => !known || known <= addDays(today, -days);
  const out: Insight[] = [];
  const dismissed = (id: string, days = 14) => {
    const d = v.data.dismissedInsights[id];
    return !!d && diffDays(today, d) < days;
  };
  const declaredLow = (e: SessionEntry) => e.energy === 'low';

  // 1. Long cleaning jobs keep being skipped or snoozed → suggest shorter pieces. Home cleaning only: the shorter-pieces setting
  //    changes how cleaning is split, so a skipped long walk or study block is not evidence for it.
  const clean = entries.filter((e) => isHomeEntry(e) && isScheduledEntry(e) && !declaredLow(e));
  // A timer that was stopped early is effort, and a move is planning: neither is a skip, and neither is a completion.
  const long = clean.filter((e) => e.plannedMinutes >= 30 && (e.outcome === 'completed' || e.outcome === 'skipped' || e.outcome === 'snoozed'));
  const longMissed = long.filter((e) => e.outcome === 'skipped' || e.outcome === 'snoozed');
  const longMissedDays = new Set(longMissed.map((e) => e.date)).size;
  const currentCap = v.data.preferences.learnedSessionCap ?? v.plan.sessionMinutes;
  if (complete(WINDOW_DAYS) && longMissed.length >= 3 && longMissedDays >= SHORTER_MIN_DAYS && longMissed.length / long.length >= 0.5 && currentCap > 10 && !dismissed('shorter')) {
    const cap = currentCap > 30 ? 20 : currentCap > 15 ? 15 : 10;
    out.push({
      id: 'shorter', code: 'long-tasks-missed', evidence: { missed: longMissed.length, of: long.length, days: longMissedDays, windowDays: WINDOW_DAYS }, tone: 'suggest', title: 'Try shorter sessions?',
      body: `You've skipped or snoozed ${longMissed.length} of your last ${long.length} longer cleaning tasks, on ${longMissedDays} different days. If you'd like, CleanFlow can break big jobs into pieces of up to ${cap} minutes. It's only a setting, and you can undo it.`,
      actions: [{ id: 'shorter', label: `Yes, up to ${cap} min`, minutes: cap }, { id: 'dismiss', label: 'Not now' }],
    });
  }

  // 2. One task skipped again and again → offer ways to make it easier. Counted from what was recorded in the last four weeks, since
  //    the task was last done, on at least three different days. (The old counter on the task never expired, so a task skipped
  //    three times last spring was "stuck" forever.)
  const sinceStreak = addDays(today, -STREAK_WINDOW_DAYS);
  const byTask = new Map<string, SessionEntry[]>();
  for (const e of all) if (e.date >= sinceStreak && e.date <= today && isScheduledEntry(e)) (byTask.get(e.taskId) ?? byTask.set(e.taskId, []).get(e.taskId)!).push(e);
  const streakOf = (taskId: string) => {
    const es = (byTask.get(taskId) ?? []).sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : 0));
    const lastDone = es.map((e) => e.outcome).lastIndexOf('completed');
    const skips = es.slice(lastDone + 1).filter((e) => e.outcome === 'skipped' && !declaredLow(e));
    return { n: skips.length, days: new Set(skips.map((e) => e.date)).size };
  };
  const stuck = complete(STREAK_WINDOW_DAYS)
    ? v.tasks.map((t) => ({ t, ...streakOf(t.id) })).filter((x) => x.n >= 3 && x.days >= STREAK_MIN_DAYS && !dismissed(`skip:${x.t.id}`)).sort((a, b) => b.n - a.n).slice(0, 2)
    : [];
  for (const { t, n, days } of stuck) {
    const lower = lowerFrequency(t.frequency);
    const actions: InsightAction[] = [{ id: 'smaller', label: 'Make it smaller' }];
    if (lower) actions.push({ id: 'less-often', label: `Do it less often (${FREQ_LABEL[lower].toLowerCase()})`, frequency: lower });
    if (t.cadence.kind === 'every') actions.push({ id: 'move', label: 'Move it to another day' });
    actions.push({ id: 'remove', label: 'Remove it' }, { id: 'dismiss', label: 'Keep as is' });
    out.push({
      id: `skip:${t.id}`, code: 'skip-streak', evidence: { streak: n, days, taskId: t.id, windowDays: STREAK_WINDOW_DAYS }, tone: 'suggest', taskId: t.id,
      title: `"${t.name}" has been skipped ${n} times`,
      body: `You've skipped it ${n} times since you last did it, over ${days} days. If it would help, here are some ways to make it easier. This is only a suggestion.`,
      actions,
    });
  }

  // 2b. Progressive discipline: a step up is offered only when the SCHEDULED habits have been steady across many distinct days, over
  //     enough time at the current level, and only when nothing says it would be too much: not on or around low-energy days, not
  //     when what was shown was mostly left undone, not when history in the window is missing. Thresholds live in progression.ts.
  const level = v.data.preferences.lifeLevel ?? 1;
  const levelSince = v.data.preferences.levelSince ?? v.data.plan.startDate;
  const lowDays = daysInRange(addDays(today, -6), today).filter((d) => v.data.energyLog[d] === 'low' || (v.data.dayEnergy?.date === d && v.data.dayEnergy.level === 'low')).length;
  const yesterday = addDays(today, -1);
  const seenHabits = summarizeWindow(v.data, addDays(today, -PROGRESSION.windowDays), yesterday, (f) => f.kind === 'life' && f.seen === true);
  const seenDays = seenHabits.days.opened;
  const seen = seenHabits.selected > 0 ? { habits: seenHabits.selected, completed: seenHabits.completed, days: seenDays } : null;
  const r = progressionReadiness(all, today, levelSince, level, { knownFrom: known, lowEnergyDays: lowDays, lowEnergyToday: energyToday(v) === 'low', seen });
  if (r.readyToStepUp && !dismissed('level-up', 21)) {
    out.push({
      id: 'level-up', code: 'level-up', evidence: { activeDays: r.activeDays, windowDays: PROGRESSION.windowDays, weekdays: r.weekdays, observedDays: r.observedDays, ...(seen ? { seenHabits: seen.habits, completedOfSeen: seen.completed } : {}) }, tone: 'celebrate', title: 'Ready for a small step up?',
      body: `You did at least one of your scheduled habits on ${r.activeDays} of the last ${PROGRESSION.windowDays} days and rarely skipped one. If you'd like, CleanFlow can make your routines a little fuller. It stays within your daily time, and you can always go back.`,
      actions: [{ id: 'level-up', label: 'Yes, a small step up', level: (level + 1) as 2 | 3 }, { id: 'dismiss', label: 'Stay where I am' }],
    });
  }
  if (r.readyToEaseOff && !dismissed('level-down', 14)) {
    out.push({
      id: 'level-down', code: 'level-down', evidence: { missRatio: Math.round(r.missRatio * 100), observedDays: r.observedDays }, tone: 'suggest', title: 'Want an easier stretch?',
      body: 'Most of what you decided about your scheduled habits in the last ten days was to skip or snooze it. If you like, CleanFlow can go back to gentler, shorter versions for a while. It is only a suggestion, and you can change it back.',
      actions: [{ id: 'level-down', label: 'Yes, make it gentler', level: (level - 1) as 1 | 2 }, { id: 'dismiss', label: 'Keep as is' }],
    });
  }

  // 3. Rooms that are going smoothly → say so, in facts. Counted from scheduled cleaning only (not Just 5 minutes or the reset
  //    sequence), on at least three different days, with no skips or snoozes; and, where Today shows what was seen, with most of
  //    what was shown for that room done. Nothing about the plan changes.
  const roomOf = (taskId: string): RoomKind | undefined => v.byId.get(taskId)?.roomKind;
  const byKind = new Map<RoomKind, { done: number; missed: number; days: Set<ISODate> }>();
  for (const e of entries) {
    if (!isHomeEntry(e) || !isScheduledEntry(e)) continue;
    const cur = byKind.get(e.roomKind) ?? { done: 0, missed: 0, days: new Set<ISODate>() };
    if (e.outcome === 'completed') { cur.done++; cur.days.add(e.date); } else if (e.outcome === 'skipped' || e.outcome === 'snoozed') cur.missed++;
    byKind.set(e.roomKind, cur);
  }
  const followThrough = (k: RoomKind) => {
    const facts = daysInRange(since, yesterday).flatMap((d) => dayFacts(v.data, d, today).selected.filter((f) => f.domain === 'home' && f.seen === true && roomOf(f.taskId) === k));
    return { seen: facts.length, done: facts.filter((f) => f.action === 'completed').length };
  };
  const steady = complete(WINDOW_DAYS)
    ? [...byKind.entries()]
      .filter(([k, x]) => ['bathroom', 'kitchen', 'bedroom', 'living', 'laundry'].includes(k) && x.done >= 4 && x.days.size >= STEADY_MIN_DAYS && x.missed === 0 && !dismissed(`steady:${k}`, 30))
      .filter(([k]) => { const f = followThrough(k); return f.seen < 5 || f.done / f.seen >= 0.6; })
      .sort((a, b) => (a[0] === 'bathroom' ? -1 : 0) - (b[0] === 'bathroom' ? -1 : 0) || b[1].done - a[1].done)[0]
    : undefined;
  if (steady) {
    const name = steady[0] === 'living' ? 'living room' : steady[0];
    out.push({
      id: `steady:${steady[0]}`, code: 'steady-room', evidence: { room: steady[0], done: steady[1].done, days: steady[1].days.size, windowDays: WINDOW_DAYS }, tone: 'celebrate', title: `Your ${name} tasks are going smoothly`,
      body: `You completed ${steady[1].done} ${name} tasks on ${steady[1].days.size} different days in the last three weeks, and skipped none. Nothing about your plan will change.`,
      actions: [{ id: 'dismiss', label: 'Nice' }],
    });
  }
  return out;
};

const energyToday = (v: PlanView) => (v.data.dayEnergy?.date === v.today ? v.data.dayEnergy.level : v.data.energyLog[v.today] ?? 'ok');

/** Gentle re-entry: several quiet days → offer a fresh start instead of a pile of overdue tasks. */
/**
 * Several quiet days → offer a fresh start instead of a pile of overdue tasks. "Quiet" means nothing was LOGGED. It says nothing about
 * whether the app was opened: someone who looked at it every day and logged nothing is as quiet as someone who never opened it, and
 * the card must not claim they were away.
 */
export const needsFreshStart = (v: PlanView): { show: boolean; daysAway: number; neverLogged: boolean } => {
  const dates = allEntries(v.data).map((e) => e.date).sort();
  const last: ISODate | undefined = dates[dates.length - 1];
  const planAge = diffDays(v.today, v.data.plan.startDate);
  const ref = last && last > v.data.plan.startDate ? last : v.data.plan.startDate;
  const daysAway = diffDays(v.today, ref);
  return { show: planAge >= 3 && daysAway >= 3, daysAway, neverLogged: !last || last <= v.data.plan.startDate };
};
