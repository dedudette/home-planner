import { addDays, diffDays } from './dates';
import { FREQ_LABEL } from './schedule';
import { LADDER } from './engine';
import { allEntries, type PlanView } from './view';
import type { Frequency, ISODate, RoomKind } from './types';

/**
 * The "learning" layer: simple, explainable rules over what the user actually
 * did. Nothing changes silently. Every adaptation is offered as a suggestion.
 */

export type InsightActionId = 'shorter' | 'smaller' | 'less-often' | 'move' | 'remove' | 'keep' | 'dismiss';

export interface InsightAction { id: InsightActionId; label: string; minutes?: number; frequency?: Frequency }

export interface Insight {
  id: string;
  tone: 'suggest' | 'celebrate';
  title: string;
  body: string;
  taskId?: string;
  actions: InsightAction[];
}

const WINDOW_DAYS = 21;

export const lowerFrequency = (f: Frequency): Frequency | null => {
  const i = LADDER.indexOf(f);
  return i > 0 ? LADDER[i - 1] : null;
};

export const computeInsights = (v: PlanView): Insight[] => {
  const today = v.today;
  const since = addDays(today, -WINDOW_DAYS);
  const entries = allEntries(v.data).filter((e) => e.date >= since);
  const out: Insight[] = [];
  const dismissed = (id: string, days = 14) => {
    const d = v.data.dismissedInsights[id];
    return !!d && diffDays(today, d) < days;
  };

  // 1. Long sessions keep getting skipped → suggest shorter ones.
  const long = entries.filter((e) => e.plannedMinutes >= 30 && e.outcome !== 'moved');
  // Rescheduling ("moved") is planning, not avoidance, so only skips, snoozes and abandoned timers count.
  const longMissed = long.filter((e) => e.outcome === 'skipped' || e.outcome === 'snoozed' || e.outcome === 'stopped');
  const currentCap = v.data.preferences.learnedSessionCap ?? v.plan.sessionMinutes;
  if (longMissed.length >= 3 && longMissed.length / long.length >= 0.5 && currentCap > 10 && !dismissed('shorter')) {
    const cap = currentCap > 30 ? 20 : currentCap > 15 ? 15 : 10;
    out.push({
      id: 'shorter', tone: 'suggest', title: 'Try shorter sessions?',
      body: `You've skipped ${longMissed.length} of your last ${long.length} longer tasks, and that's completely fine. Want CleanFlow to break big jobs into pieces of up to ${cap} minutes?`,
      actions: [{ id: 'shorter', label: `Yes, up to ${cap} min`, minutes: cap }, { id: 'dismiss', label: 'Not now' }],
    });
  }

  // 2. A task skipped three times in a row → offer ways to make it easier.
  const stuck = v.tasks
    .filter((t) => (v.states[t.id]?.skipStreak ?? 0) >= 3 && !dismissed(`skip:${t.id}`))
    .sort((a, b) => (v.states[b.id]?.skipStreak ?? 0) - (v.states[a.id]?.skipStreak ?? 0))
    .slice(0, 2);
  for (const t of stuck) {
    const lower = lowerFrequency(t.frequency);
    const actions: InsightAction[] = [{ id: 'smaller', label: 'Make it smaller' }];
    if (lower) actions.push({ id: 'less-often', label: `Do it less often (${FREQ_LABEL[lower].toLowerCase()})`, frequency: lower });
    if (t.cadence.kind === 'every') actions.push({ id: 'move', label: 'Move it to another day' });
    actions.push({ id: 'remove', label: 'Remove it' }, { id: 'dismiss', label: 'Keep as is' });
    out.push({
      id: `skip:${t.id}`, tone: 'suggest', taskId: t.id,
      title: `"${t.name}" keeps getting skipped`,
      body: 'No judgement. A task that never happens is a task that does not fit your life right now. What would help?',
      actions,
    });
  }

  // 3. Rooms that go smoothly → keep as is (positive reinforcement).
  const byKind = new Map<RoomKind, { done: number; missed: number }>();
  for (const e of entries) {
    const k = e.roomKind;
    const cur = byKind.get(k) ?? { done: 0, missed: 0 };
    if (e.outcome === 'completed') cur.done++; else if (e.outcome === 'skipped') cur.missed++;
    byKind.set(k, cur);
  }
  const steady = [...byKind.entries()]
    .filter(([k, x]) => ['bathroom', 'kitchen', 'bedroom', 'living', 'laundry'].includes(k) && x.done >= 4 && x.missed === 0 && !dismissed(`steady:${k}`, 30))
    .sort((a, b) => (a[0] === 'bathroom' ? -1 : 0) - (b[0] === 'bathroom' ? -1 : 0) || b[1].done - a[1].done)[0];
  if (steady) {
    const name = steady[0] === 'living' ? 'living room' : steady[0];
    out.push({
      id: `steady:${steady[0]}`, tone: 'celebrate', title: `Your ${name} routine is working`,
      body: `You've completed ${steady[1].done} ${name} tasks recently without skipping any. We're keeping that schedule exactly as it is.`,
      actions: [{ id: 'dismiss', label: 'Nice' }],
    });
  }
  return out;
};

/** Gentle re-entry: several quiet days → offer a fresh start instead of a pile of overdue tasks. */
export const needsFreshStart = (v: PlanView): { show: boolean; daysAway: number } => {
  const dates = allEntries(v.data).map((e) => e.date).sort();
  const last: ISODate | undefined = dates[dates.length - 1] ?? v.data.lastOpened ?? undefined;
  const planAge = diffDays(v.today, v.data.plan.startDate);
  const ref = last && last > v.data.plan.startDate ? last : v.data.plan.startDate;
  const daysAway = diffDays(v.today, ref);
  return { show: planAge >= 3 && daysAway >= 3, daysAway };
};
