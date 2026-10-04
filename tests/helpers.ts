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
