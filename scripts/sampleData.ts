import { appDataForDemo } from '../src/domain/demo';
import { addDays } from '../src/domain/dates';
import { generatePlan } from '../src/domain/engine';
import { buildExposure, hasNewExposure } from '../src/domain/exposure';
import { buildView, todayPlan } from '../src/domain/view';
import type { AppData, ISODate } from '../src/domain/types';
import { reducer } from '../src/state/reducer';

/**
 * Fake history for trying "Your patterns" and the AI coach on a machine that has no real history yet.
 *
 * It is generated through the app's own reducer, the way a person's days would be recorded: some days opened, a couple not opened,
 * what Today showed marked as seen, and a mix of completed, skipped and untouched tasks. Nothing in it is real, and importing it
 * REPLACES whatever the app holds (the app asks first and keeps an automatic backup).
 */
export const SAMPLE_DAYS = 21;

export const buildSampleData = (today: ISODate): AppData => {
  const start = addDays(today, -(SAMPLE_DAYS - 1));
  let seed = 424242;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  let d = appDataForDemo('G', { today: start });
  d = { ...d, user: { ...d.user, name: 'Sample data', demo: false } };
  d.preferences = { ...d.preferences, focus: ['home', 'morning', 'evening', 'study', 'discipline', 'active', 'phone'], sessionMinutes: 45, daysPerWeek: 5, lifeLevel: 1 };
  d.plan = { ...d.plan, startDate: addDays(today, -30) };
  const plan = generatePlan(d.home, d.preferences, d.plan);
  const stamp = (date: ISODate, hour: number, minute = 0) => ({ today: date, now: `${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`, hour, tz: 0 });

  for (let i = 0; i < SAMPLE_DAYS; i++) {
    const date = addDays(start, i);
    if (i === 6 || i === 7 || i === 13) continue;                               // days the app was not opened
    if (i === 10 || i === 11) d = reducer(d, { type: 'DAY_ENERGY', level: 'low', stamp: stamp(date, 7) });
    const v = buildView(d, plan, date);
    const rec = buildExposure(v, `${date}T07:00:00.000Z`, 0);
    if (hasNewExposure(v, rec)) d = reducer(d, { type: 'RECORD_EXPOSURE', record: rec });
    const mine = d.exposures.find((e) => e.date === date)!;
    // What Today put on screen: everything selected; and the "left out of today" list opened on some days.
    d = reducer(d, { type: 'RECORD_SEEN', date, ids: mine.items.map((x) => x.taskId), revealed: i % 4 === 0 ? (mine.left ?? []).slice(0, 12).map((x) => x.taskId) : [], at: `${date}T07:05:00.000Z` });
    const today0 = todayPlan(buildView(d, plan, date));
    const tasks = [...today0.life, ...today0.focus, ...today0.catchUp].map((x) => x.task);
    tasks.forEach((task, k) => {
      if (date === today && k >= 2) return;                                     // today is still in progress
      const r = rnd();
      const at = stamp(date, 8 + (k % 10), 5 * k);
      if (r < 0.34) d = reducer(d, { type: 'TASK_COMPLETE', task, stamp: at, via: 'checkoff', entryId: `sample-c-${i}-${k}`, surface: 'today' });
      else if (r < 0.44) d = reducer(d, { type: 'TASK_SKIP', task, stamp: at, entryId: `sample-s-${i}-${k}`, surface: 'today' });
      // otherwise: shown, and no action recorded
    });
  }
  return d;
};
