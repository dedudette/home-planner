import { emptyWater, emptyWellbeing } from '../domain/wellbeing/defaults';
import { GOAL_MAX_ML, GOAL_MIN_ML, MAX_ENTRY_ML } from '../domain/water/water';
import type { WaterData, WaterEntry, WaterUnit } from '../domain/water/types';
import type { Checkin, JournalEntry, WellbeingData } from '../domain/wellbeing/types';
import { Ctx, date, isObj, isoStamp, keepNewest, oneOf, oneOfOrNull, str } from './primitives';

/** Validation for water and wellbeing data (schema v3). A water entry has an amount and a time and nothing else; a day with none is not a zero. */

export const MAX_WELL = { water: 30000, checkins: 4000, journal: 3000, journalText: 8000 };
const UNITS: readonly WaterUnit[] = ['ml', 'floz', 'cup'];
const ENERGY = ['low', 'ok', 'high'] as const;

export const validateWater = (raw: unknown, c: Ctx): WaterData => {
  const d = emptyWater();
  if (raw === undefined) return d;
  if (!isObj(raw)) { c.note('Your water log was unreadable and was reset.'); return d; }
  const seen = new Set<string>();
  const entries: WaterEntry[] = [];
  for (const x of Array.isArray(raw.entries) ? raw.entries : []) {
    if (!isObj(x) || typeof x.id !== 'string' || typeof x.at !== 'string' || Number.isNaN(Date.parse(x.at)) || !date(x.date) || typeof x.ml !== 'number' || !Number.isFinite(x.ml) || x.ml < 5 || x.ml > MAX_ENTRY_ML || seen.has(x.id)) { c.dropped++; continue; }
    seen.add(x.id); entries.push({ id: x.id.slice(0, 60), date: x.date as string, at: x.at, ml: Math.round(x.ml) });
  }
  entries.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  return {
    goalMl: typeof raw.goalMl === 'number' && raw.goalMl >= GOAL_MIN_ML && raw.goalMl <= GOAL_MAX_ML ? Math.round(raw.goalMl) : null,
    unit: oneOf(raw.unit, UNITS, 'ml'), entries: keepNewest(entries, MAX_WELL.water, c, 'water entries'),
  };
};

const mood = (v: unknown): Checkin['mood'] => (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 5 ? (v as Checkin['mood']) : null);

export const validateWellbeing = (raw: unknown, c: Ctx): WellbeingData => {
  const d = emptyWellbeing();
  if (raw === undefined) return d;
  if (!isObj(raw)) { c.note('Your wellbeing data was unreadable and was reset.'); return d; }
  const cs = new Set<string>();
  const checkins: Checkin[] = [];
  for (const x of Array.isArray(raw.checkins) ? raw.checkins : []) {
    if (!isObj(x) || typeof x.id !== 'string' || !date(x.date) || typeof x.at !== 'string' || Number.isNaN(Date.parse(x.at)) || cs.has(x.id)) { c.dropped++; continue; }
    const energy = oneOfOrNull(x.energy, ENERGY);
    const m = mood(x.mood);
    if (energy === null && m === null && !str(x.note).trim()) { c.dropped++; continue; }
    cs.add(x.id); checkins.push({ id: x.id.slice(0, 60), date: x.date as string, at: isoStamp(x.at, x.at), energy, mood: m, note: str(x.note, '', 300) });
  }
  checkins.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  const js = new Set<string>();
  const journal: JournalEntry[] = [];
  for (const x of Array.isArray(raw.journal) ? raw.journal : []) {
    if (!isObj(x) || typeof x.id !== 'string' || !date(x.date) || typeof x.at !== 'string' || Number.isNaN(Date.parse(x.at)) || !str(x.text).trim() || js.has(x.id)) { c.dropped++; continue; }
    js.add(x.id); journal.push({ id: x.id.slice(0, 60), date: x.date as string, at: isoStamp(x.at, x.at), title: str(x.title, '', 80), text: str(x.text, '', MAX_WELL.journalText) });
  }
  journal.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  return { checkins: keepNewest(checkins, MAX_WELL.checkins, c, 'check-ins'), journal: keepNewest(journal, MAX_WELL.journal, c, 'journal entries') };
};
