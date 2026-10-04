import { PHASE_ORDER } from './catalog';
import type { Ctx } from './context';
import { addDays, diffDays, weekday } from './dates';
import type { ISODate, PlanMeta, Task } from './types';

/**
 * Scheduler: assigns each task a cadence and first date.
 *
 *  1. one-time reset tasks fill the first cleaning days in phase order
 *  2. daily/habit tasks are laid down on their weekdays
 *  3. weekly → seasonal tasks are slotted into the least-loaded weekday
 *     (4-week grid), grouped by zone and room so one session = one area
 *  4. deep-clean goal: deep tasks fill leftover capacity
 *
 * Mutates the tasks it is given.
 */

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

const firstOnOrAfter = (date: ISODate, wd: number): ISODate => {
  const diff = (wd - weekday(date) + 7) % 7;
  return addDays(date, diff);
};

const nextActiveDate = (from: ISODate, active: number[]): ISODate => {
  let d = from;
  for (let i = 0; i < 8; i++, d = addDays(d, 1)) if (active.includes(weekday(d))) return d;
  return from;
};

const KIND_ORDER = ['kitchen', 'bathroom', 'bedroom', 'living', 'dining', 'office', 'laundry', 'hallway'];

export const assignSchedule = (tasks: Task[], c: Ctx, meta: PlanMeta): { resetDays: number; resetMinutes: number } => {
  const start = meta.startDate;
  const active = c.activeDays;
  const session = c.sessionMinutes;
  const fresh = meta.resetCount === 0;

  const live = tasks.filter((t) => !t.backlog);
  for (const t of tasks) { t.startDate = null; t.cadence = { kind: 'once' }; }

  // ── 1. one-time tasks (reset phases first, then guest/event prep) ──
  const onceTasks = live
    .filter((t) => t.frequency === 'once')
    .sort((a, b) => {
      const pa = a.phase ? PHASE_ORDER.indexOf(a.phase) : 100;
      const pb = b.phase ? PHASE_ORDER.indexOf(b.phase) : 100;
      return pa - pb || b.score - a.score;
    });

  // Habits that can run during the reset window.
  const habits = live.filter((t) => t.habit && t.frequency !== 'once');
  const heavyReset = c.mess >= 3 && fresh;
  const immediateHabits = habits.filter((t) => !heavyReset || c.mess < 4 || t.minutes <= 4);
  const habitLoad = immediateHabits.reduce((s, t) => s + t.minutes * (t.frequency === 'daily' ? 1 : t.frequency === 'twice-weekly' ? 2 / 7 : 1 / 7), 0);

  let resetEnd: ISODate = start;
  let resetDays = 0;
  let resetMinutes = 0;
  if (onceTasks.length) {
    let date = nextActiveDate(start, active);
    let used = 0;
    const dayCap = Math.max(session * 1.1 - (heavyReset ? habitLoad : 0), session * 0.5);
    let daysUsed = 1;
    for (const t of onceTasks) {
      if (used > 0 && used + t.minutes > dayCap) {
        date = nextActiveDate(addDays(date, 1), active);
        used = 0;
        daysUsed++;
      }
      t.startDate = date;
      used += t.minutes;
      if (t.tier === 'reset') resetMinutes += t.minutes;
    }
    resetEnd = date;
    resetDays = daysUsed;
  }

  // Maintenance starts after a heavy reset, so the user isn't buried on day one.
  const offset = heavyReset && c.mess >= 3 ? Math.min(c.mess >= 4 ? 21 : 10, diffDays(resetEnd, start) + 1) : 0;
  const minStart = addDays(start, Math.max(0, offset));

  // ── 2. daily & habit tasks ──
  const baseLoad = new Array(7).fill(0) as number[];
  const addBase = (days: number[], minutes: number) => days.forEach((d) => { baseLoad[d] += minutes; });
  // Two well-spaced weekdays for twice-a-week habits (Tue + Fri).
  const HABIT_PAIR = [2, 5];

  for (const t of live) {
    if (t.frequency === 'once' || t.frequency === 'deep') continue;
    if (t.frequency === 'daily') {
      const days = t.habit ? ALL_DAYS : active;
      t.cadence = { kind: 'days', days };
      const from = t.habit && immediateHabits.includes(t) ? start : minStart;
      let d = from;
      for (let i = 0; i < 7 && !days.includes(weekday(d)); i++) d = addDays(d, 1);
      t.startDate = d;
      addBase(days, t.minutes);
    } else if (t.frequency === 'twice-weekly' && t.habit) {
      t.cadence = { kind: 'days', days: HABIT_PAIR };
      const from = immediateHabits.includes(t) ? start : minStart;
      let d = from;
      for (let i = 0; i < 7 && !(t.cadence.kind === 'days' && t.cadence.days.includes(weekday(d))); i++) d = addDays(d, 1);
      t.startDate = d;
      addBase(t.cadence.days, t.minutes);
    }
  }

  // ── 3. weekly → seasonal slotting ──
  const L: number[][] = Array.from({ length: 4 }, () => [...baseLoad]);
  const slotsFor = (t: Task, q: number): number[] =>
    t.frequency === 'weekly' ? [0, 1, 2, 3] : t.frequency === 'biweekly' ? [q, q + 2] : [q];

  const zoneLoad = new Map<string, number>();
  const toSlot = live.filter((t) => t.tier === 'maintenance' && !t.habit && t.frequency !== 'once' && t.frequency !== 'deep' && t.frequency !== 'daily');
  toSlot.forEach((t) => zoneLoad.set(t.zone, (zoneLoad.get(t.zone) ?? 0) + t.minutes));
  const zonePref = new Map<string, number>();
  const zoneList = [...zoneLoad.entries()].sort((a, b) => b[1] - a[1]).map(([z]) => z);
  if (zoneList.length > 1) zoneList.forEach((z, i) => zonePref.set(z, active[i % active.length]));
  const roomDays = new Map<string, Set<number>>();

  const ordered = [...toSlot].sort((a, b) => (a.frequency === 'twice-weekly' ? -1 : 0) - (b.frequency === 'twice-weekly' ? -1 : 0) || b.minutes - a.minutes);
  const cap = session * 1.1;
  const bestSlot = (t: Task, exclude: number[] = []): { wd: number; q: number } => {
    let best = { wd: active[0], q: 0, score: Infinity };
    const qs = t.frequency === 'weekly' || t.frequency === 'twice-weekly' ? [0] : t.frequency === 'biweekly' ? [0, 1] : [0, 1, 2, 3];
    for (const wd of active) {
      if (exclude.includes(wd)) continue;
      for (const q of qs) {
        const slots = t.frequency === 'twice-weekly' ? [0, 1, 2, 3] : slotsFor(t, q);
        const peak = Math.max(...slots.map((p) => L[p][wd]));
        let score = peak + t.minutes;
        if (score > cap) score += 1000 + (score - cap);
        if (zonePref.get(t.zone) === wd) score -= 8;
        if (roomDays.get(t.roomId)?.has(wd)) score -= 4;
        score += q * 0.5; // earlier is slightly better
        if (score < best.score) best = { wd, q, score };
      }
    }
    return { wd: best.wd, q: best.q };
  };

  for (const t of ordered) {
    const rd = roomDays.get(t.roomId) ?? new Set<number>();
    roomDays.set(t.roomId, rd);
    if (t.frequency === 'twice-weekly') {
      if (active.length < 2) { t.frequency = 'weekly'; }
      else {
        const a = bestSlot(t).wd;
        const far = active.filter((d) => { const gap = Math.min((d - a + 7) % 7, (a - d + 7) % 7); return gap >= 2; });
        const b = far.length ? bestSlot(t, active.filter((d) => !far.includes(d))).wd : bestSlot(t, [a]).wd;
        const days = [a, b].sort((x, y) => x - y);
        t.cadence = { kind: 'days', days };
        days.forEach((d) => { [0, 1, 2, 3].forEach((p) => { L[p][d] += t.minutes; }); rd.add(d); });
        let d = minStart;
        for (let i = 0; i < 7 && !days.includes(weekday(d)); i++) d = addDays(d, 1);
        t.startDate = d;
        continue;
      }
    }
    const { wd, q } = bestSlot(t);
    const every = t.frequency === 'weekly' ? 7 : t.frequency === 'biweekly' ? 14 : t.frequency === 'monthly' ? 28 : 91;
    t.cadence = { kind: 'every', every };
    slotsFor(t, q).forEach((p) => { L[p][wd] += t.minutes; });
    rd.add(wd);
    const lead = t.frequency === 'seasonal' ? 7 * (q + 1) : 7 * q;
    t.startDate = addDays(firstOnOrAfter(minStart, wd), lead);
  }

  // ── 4. deep clean goal: use leftover capacity ──
  if (c.goals.has('deep-clean')) {
    const deep = live
      .filter((t) => t.tier === 'deep')
      .sort((a, b) => {
        const ka = KIND_ORDER.indexOf(a.roomKind); const kb = KIND_ORDER.indexOf(b.roomKind);
        return (ka < 0 ? 99 : ka) - (kb < 0 ? 99 : kb) || b.score - a.score;
      });
    let date = nextActiveDate(minStart, active);
    let guard = 0;
    for (const t of deep) {
      while (guard++ < 400) {
        const wd = weekday(date);
        const p = Math.min(3, Math.floor(diffDays(date, minStart) / 7) % 4);
        const free = session - L[p][wd];
        if (free >= Math.min(t.minutes, session) * 0.6 || free >= session * 0.4) {
          t.startDate = date;
          t.cadence = { kind: 'once' };
          L[p][wd] += t.minutes;
          break;
        }
        date = nextActiveDate(addDays(date, 1), active);
        if (diffDays(date, minStart) > 120) break;
      }
      date = nextActiveDate(addDays(date, 1), active);
      if (diffDays(date, minStart) > 120) break;
    }
  }

  return { resetDays, resetMinutes };
};
