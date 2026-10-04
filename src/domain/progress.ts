import { addDays, daysInRange, diffDays, endOfMonth, formatShort, startOfMonth, startOfWeek } from './dates';
import { ROOM_MODE_LABEL, allEntries, projectRemaining, type PlanView } from './view';
import type { ISODate, Progress, RoomKind } from './types';

const completed = (v: PlanView) => allEntries(v.data).filter((e) => e.outcome === 'completed');

/**
 * Forgiving streak: a single rest day never breaks it. Two quiet days in a row do.
 */
export const streaks = (dates: ISODate[], today: ISODate): { current: number; best: number } => {
  const days = [...new Set(dates)].sort();
  if (!days.length) return { current: 0, best: 0 };
  let best = 1;
  let run = 1;
  for (let i = 1; i < days.length; i++) {
    run = diffDays(days[i], days[i - 1]) <= 2 ? run + 1 : 1;
    best = Math.max(best, run);
  }
  const last = days[days.length - 1];
  const alive = diffDays(today, last) <= 2;
  return { current: alive ? run : 0, best };
};

export const computeProgress = (v: PlanView): Progress => {
  const today = v.today;
  const done = completed(v);
  const { current, best } = streaks(done.map((e) => e.date), today);
  const weekStart = startOfWeek(today);
  const weekEnd = addDays(weekStart, 6);
  const monthStart = startOfMonth(today);
  const monthEnd = endOfMonth(today);

  const inRange = (from: ISODate, to: ISODate) => done.filter((e) => e.date >= from && e.date <= to);
  const weekDone = inRange(weekStart, weekEnd).length;
  const monthDone = inRange(monthStart, monthEnd).length;
  const weekPlanned = weekDone + projectRemaining(v, today, weekEnd);
  const monthPlanned = monthDone + projectRemaining(v, today, monthEnd);

  const last7 = daysInRange(addDays(today, -6), today).map((date) => {
    const es = done.filter((e) => e.date === date);
    return { date, minutes: es.reduce((s, e) => s + e.actualMinutes, 0), tasks: es.length };
  });
  const weeks = [3, 2, 1, 0].map((back) => {
    const s = addDays(weekStart, -7 * back);
    const es = inRange(s, addDays(s, 6));
    return { label: back === 0 ? 'This week' : formatShort(s), tasks: es.length, minutes: es.reduce((a, e) => a + e.actualMinutes, 0) };
  });

  const byRoom = new Map<RoomKind, { tasks: number; minutes: number }>();
  for (const e of done) {
    const k: RoomKind = ['dining', 'storage', 'home'].includes(e.roomKind) ? 'other' : e.roomKind;
    const cur = byRoom.get(k) ?? { tasks: 0, minutes: 0 };
    cur.tasks++; cur.minutes += e.actualMinutes;
    byRoom.set(k, cur);
  }
  const rooms = [...byRoom.entries()]
    .map(([kind, x]) => ({ kind, name: ROOM_MODE_LABEL[kind] ?? kind, ...x }))
    .sort((a, b) => b.tasks - a.tasks);

  return {
    tasksCompleted: done.length,
    minutesCleaned: done.reduce((s, e) => s + e.actualMinutes, 0),
    streak: current,
    bestStreak: best,
    sessions: v.data.sessions.filter((s) => s.entries.some((e) => e.outcome === 'completed')).length,
    weekDone, weekPlanned, monthDone, monthPlanned, last7, weeks, rooms,
    roomsRefreshedThisWeek: new Set(inRange(weekStart, weekEnd).map((e) => e.roomName)).size,
  };
};
