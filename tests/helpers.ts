import { emptyAppData } from '../src/domain/appdata';
import { emptyHome, emptyPreferences } from '../src/domain/context';
import { appDataForDemo, type DemoProfile } from '../src/domain/demo';
import { generatePlan, type Plan } from '../src/domain/engine';
import { ROOM_DEFAULTS } from '../src/domain/options';
import type { AppData, Home, Preferences } from '../src/domain/types';
import { buildView, type PlanView } from '../src/domain/view';

export const TODAY = '2026-10-05'; // a Monday

export const plan = (data: AppData, startDate = TODAY): Plan => generatePlan(data.home, data.preferences, { startDate, resetCount: data.plan.resetCount });

export const view = (data: AppData, today = TODAY): PlanView => buildView(data, plan(data, data.plan.startDate), today);

export const demo = (id: DemoProfile['id'], opts: { withHistory?: boolean } = {}) => appDataForDemo(id, { today: TODAY, ...opts });

export const custom = (
  type: NonNullable<Home['type']>,
  homePatch: Partial<Home> = {},
  rooms: Partial<Home['rooms']> = {},
  prefs: Partial<Preferences> = {},
): AppData => {
  const d = ROOM_DEFAULTS[type];
  const base = emptyAppData(TODAY);
  return {
    ...base,
    onboardingComplete: true,
    home: { ...emptyHome(), type, rooms: { ...d.rooms, ...rooms }, floors: d.floors, roomsTouched: true, cleanliness: 'mostly-clean', sizeBand: '61-80', ...homePatch },
    preferences: { ...emptyPreferences(), style: 'several-short', sessionMinutes: 30, daysPerWeek: 4, energy: 'medium', ...prefs },
  };
};

// ── realistic history ──
import { addDays } from '../src/domain/dates';
import { buildExposure, hasNewExposure } from '../src/domain/exposure';
import { reducer } from '../src/state/reducer';
import { todayPlan } from '../src/domain/view';
import type { SessionEntry } from '../src/domain/types';

let cachedEntries: SessionEntry[] | null = null;
/**
 * A few hundred log entries produced by the real reducer from a real plan, with every analytics field the app records today.
 * Size tests clone these, so characters-per-entry in a test is the characters-per-entry in the app.
 */
export const realEntries = (): SessionEntry[] => {
  if (cachedEntries) return cachedEntries;
  const START = '2026-06-01';
  let d = appDataForDemo('G', { today: START });
  d.preferences = { ...d.preferences, focus: ['home', 'morning', 'evening', 'study', 'discipline', 'active', 'phone'], sessionMinutes: 45, daysPerWeek: 5, lifeLevel: 1 };
  const p = generatePlan(d.home, d.preferences, d.plan);
  let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  for (let day = 0; day < 60; day++) {
    const today = addDays(START, day);
    const v = buildView(d, p, today);
    const rec = buildExposure(v, `${today}T06:00:00.000Z`, -120);
    if (hasNewExposure(v, rec) && rec.items.length) d = reducer(d, { type: 'RECORD_EXPOSURE', record: rec });
    const tp = todayPlan(buildView(d, p, today));
    [...tp.life, ...tp.focus].forEach((i, k) => {
      const now = new Date(`${today}T00:00:00Z`); now.setUTCMinutes(7 * 60 + k * 9);
      const stamp = { now: now.toISOString(), today, hour: now.getUTCHours(), tz: -120 };
      d = rnd() < 0.3 ? d : reducer(d, { type: 'TASK_COMPLETE', task: i.task, stamp, via: 'checkoff', entryId: `h${day}_${k}` });
    });
  }
  cachedEntries = d.sessions.flatMap((s) => s.entries);
  return cachedEntries;
};
