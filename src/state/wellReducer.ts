import { MAX_WELL } from '../storage/wellSchema';
import type { WaterEntry, WaterUnit } from '../domain/water/types';
import type { Checkin, JournalEntry } from '../domain/wellbeing/types';
import { GOAL_MAX_ML, GOAL_MIN_ML } from '../domain/water/water';
import type { AppData } from '../domain/types';

/** Water, check-ins and the journal. Pure and idempotent; a check-in's energy is applied to Today by the screen, as a separate, visible step. */
export type WellAction =
  | { type: 'WATER_ADD'; entry: WaterEntry }
  | { type: 'WATER_EDIT'; id: string; ml?: number; at?: string; date?: string }
  | { type: 'WATER_DELETE'; id: string }
  | { type: 'WATER_SETTINGS'; goalMl?: number | null; unit?: WaterUnit }
  | { type: 'CHECKIN_SAVE'; checkin: Checkin }
  | { type: 'CHECKIN_DELETE'; id: string }
  | { type: 'JOURNAL_SAVE'; entry: JournalEntry }
  | { type: 'JOURNAL_DELETE'; id: string };

const sortBy = <T extends { at: string }>(xs: T[]): T[] => [...xs].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

export const wellReducer = (d: AppData, a: WellAction): AppData => {
  switch (a.type) {
    case 'WATER_ADD': return d.water.entries.some((e) => e.id === a.entry.id) ? d : { ...d, water: { ...d.water, entries: sortBy([...d.water.entries, a.entry]).slice(-MAX_WELL.water) } };
    case 'WATER_EDIT': {
      const cur = d.water.entries.find((e) => e.id === a.id);
      if (!cur) return d;
      const next = { ...cur, ...(a.ml !== undefined ? { ml: Math.round(a.ml) } : {}), ...(a.at !== undefined ? { at: a.at } : {}), ...(a.date !== undefined ? { date: a.date } : {}) };
      return JSON.stringify(next) === JSON.stringify(cur) ? d : { ...d, water: { ...d.water, entries: sortBy(d.water.entries.map((e) => (e.id === a.id ? next : e))) } };
    }
    case 'WATER_DELETE': return d.water.entries.some((e) => e.id === a.id) ? { ...d, water: { ...d.water, entries: d.water.entries.filter((e) => e.id !== a.id) } } : d;
    case 'WATER_SETTINGS': {
      const goal = a.goalMl === undefined ? d.water.goalMl : a.goalMl === null ? null : a.goalMl >= GOAL_MIN_ML && a.goalMl <= GOAL_MAX_ML ? Math.round(a.goalMl) : d.water.goalMl;
      return { ...d, water: { ...d.water, goalMl: goal, unit: a.unit ?? d.water.unit } };
    }
    case 'CHECKIN_SAVE': {
      const has = d.wellbeing.checkins.some((c) => c.id === a.checkin.id);
      const checkins = has ? d.wellbeing.checkins.map((c) => (c.id === a.checkin.id ? a.checkin : c)) : [...d.wellbeing.checkins, a.checkin];
      return { ...d, wellbeing: { ...d.wellbeing, checkins: sortBy(checkins).slice(-MAX_WELL.checkins) } };
    }
    case 'CHECKIN_DELETE': return d.wellbeing.checkins.some((c) => c.id === a.id) ? { ...d, wellbeing: { ...d.wellbeing, checkins: d.wellbeing.checkins.filter((c) => c.id !== a.id) } } : d;
    case 'JOURNAL_SAVE': {
      const has = d.wellbeing.journal.some((j) => j.id === a.entry.id);
      const journal = has ? d.wellbeing.journal.map((j) => (j.id === a.entry.id ? a.entry : j)) : [...d.wellbeing.journal, a.entry];
      return { ...d, wellbeing: { ...d.wellbeing, journal: sortBy(journal).slice(-MAX_WELL.journal) } };
    }
    case 'JOURNAL_DELETE': return d.wellbeing.journal.some((j) => j.id === a.id) ? { ...d, wellbeing: { ...d.wellbeing, journal: d.wellbeing.journal.filter((j) => j.id !== a.id) } } : d;
    default: return d;
  }
};
