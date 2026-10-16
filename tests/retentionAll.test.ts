import { describe, expect, it } from 'vitest';
import { emptyAppData } from '../src/domain/appdata';
import { addDays } from '../src/domain/dates';
import { compactHistory, describeRetention, HARD_CHARS, serializedSize, TARGET_CHARS } from '../src/domain/retention';
import { thinHistory, trimOtherBefore } from '../src/domain/thinning';
import { dayTotal } from '../src/domain/water/water';
import type { AppData, CleaningSession, SessionEntry } from '../src/domain/types';
import { exportJSON, importJSON } from '../src/storage/repository';
import { validateAppData } from '../src/storage/schema';
import { reducer } from '../src/state/reducer';
import { TODAY } from './helpers';

const AT = `${TODAY}T10:00:00.000Z`;
const lorem = (n: number) => 'Synthetic words for sizing only. '.repeat(Math.ceil(n / 33)).slice(0, n);

/** A person who uses everything every day, for `days` days ending today: the shape of data the app really writes, with synthetic text. */
const busy = (days: number, journalChars = 600): AppData => {
  const d = emptyAppData(TODAY);
  const sessions: CleaningSession[] = [];
  const meals: AppData['meals']['plan'] = [];
  const log: AppData['movement']['log'] = [];
  const water: AppData['water']['entries'] = [];
  const checkins: AppData['wellbeing']['checkins'] = [];
  const journal: AppData['wellbeing']['journal'] = [];
  const hobby: AppData['interests']['sessions'] = [];
  const lists: AppData['shopping']['lists'] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = addDays(TODAY, -i);
    const entries: SessionEntry[] = Array.from({ length: 5 }, (_, k) => ({ id: `e${i}-${k}`, at: `${date}T${String(8 + k).padStart(2, '0')}:00:00.000Z`, date, taskId: `t${k}`, name: `Task number ${k}`, roomKind: 'home', roomName: 'Kitchen', category: 'Dishes', plannedMinutes: 10, actualMinutes: 10, outcome: 'completed', via: 'checkoff', domain: 'home', templateId: `tpl${k}`, level: 'maintenance' as never, difficulty: 1, intensity: 'gentle', timeOfDay: 'morning', localHour: 8, tzOffsetMin: 0 }));
    sessions.push({ id: `s${i}`, date, startedAt: entries[0].at, endedAt: entries[4].at, entries });
    for (const slot of ['breakfast', 'lunch', 'dinner'] as const) meals.push({ id: `m${i}${slot}`, date, slot, ref: { kind: 'recipe', id: 'lentil-soup' }, name: 'Red lentil soup', servings: 2, status: 'eaten', statusAt: `${date}T19:00:00.000Z`, prepActivityId: null, kcal: null, note: '' });
    log.push({ entryId: `e${i}-0`, workoutId: 'w', name: 'Strength basics', date, at: `${date}T18:00:00.000Z`, felt: 'right', exercises: Array.from({ length: 8 }, (_, n) => ({ exerciseId: `ex${n}`, name: `Exercise number ${n}`, status: 'done' as const, setsDone: 2, repsDone: 10 })), note: '' });
    for (let g = 0; g < 8; g++) water.push({ id: `w${i}-${g}`, date, at: `${date}T${String(8 + g).padStart(2, '0')}:00:00.000Z`, ml: 250 });
    checkins.push({ id: `c${i}`, date, at: `${date}T20:00:00.000Z`, energy: 'ok', mood: 4, note: lorem(60) });
    journal.push({ id: `j${i}`, date, at: `${date}T21:00:00.000Z`, title: 'A title', text: lorem(journalChars) });
    hobby.push({ id: `h${i}`, interestId: 'int1', entryId: `e${i}-1`, date, at: `${date}T19:00:00.000Z`, bookId: null, starterId: null, note: lorem(80), feedback: 'enjoyed', resource: '' });
    if (i % 7 === 0) lists.push({ id: `l${i}`, name: 'Week', createdAt: `${date}T09:00:00.000Z`, range: null, entryIds: [], skipped: [], items: [], ignored: null });
  }
  return { ...d, sessions, meals: { ...d.meals, plan: meals }, movement: { ...d.movement, log }, water: { ...d.water, entries: water }, wellbeing: { checkins, journal }, interests: { ...d.interests, sessions: hobby }, shopping: { ...d.shopping, lists } };
};

describe('measured growth, so the limits are not a guess', () => {
  it('a very busy year (everything, every day) fits in the soft limit, and is mostly the log, workouts, meals, journal and water', () => {
    const d = busy(365);
    const size = serializedSize(d);
    expect(size).toBeGreaterThan(1_200_000);
    expect(size).toBeLessThan(2_200_000);
  });
  it('about two years of that reaches the hard limit, which is why compaction must cover every history, not just the log', () => {
    expect(serializedSize(busy(900))).toBeGreaterThan(HARD_CHARS);
  });
});

describe('thinning keeps the totals and drops the detail', () => {
  const d = busy(200);
  const t = thinHistory(d, TODAY);
  it('old water becomes one total per day, and every old day\'s total is unchanged', () => {
    expect(t.waterDays).toBeGreaterThan(100);
    const day = addDays(TODAY, -100);
    expect(dayTotal(t.data.water.entries, day)).toBe(dayTotal(d.water.entries, day));
    expect(t.data.water.entries.filter((e) => e.date === day)).toHaveLength(1);
    // recent days are left alone, entry by entry
    const recent = addDays(TODAY, -3);
    expect(t.data.water.entries.filter((e) => e.date === recent)).toHaveLength(8);
  });
  it('old workout records keep their date, name, minutes link and how it felt, and lose only the exercise list', () => {
    const old = t.data.movement.log.find((l) => l.date === addDays(TODAY, -100))!;
    const was = d.movement.log.find((l) => l.date === addDays(TODAY, -100))!;
    expect(old).toMatchObject({ entryId: was.entryId, name: was.name, felt: was.felt, date: was.date });
    expect(old.exercises).toEqual([]);
    expect(t.data.movement.log.find((l) => l.date === addDays(TODAY, -5))!.exercises).toHaveLength(8);
  });
  it('is idempotent, and does nothing to data that has nothing to thin', () => {
    const again = thinHistory(t.data, TODAY);
    expect(again.waterDays).toBe(0);
    expect(again.exerciseDetails).toBe(0);
    expect(again.data).toBe(t.data);
    const fresh = emptyAppData(TODAY);
    expect(thinHistory(fresh, TODAY).data).toBe(fresh);
  });
});

describe('making room covers every history, and never touches what the person wrote', () => {
  const d = busy(1000);
  const c = compactHistory(d, TARGET_CHARS, AT);
  it('fits the target, says so in the data, and keeps the newest day of everything', () => {
    expect(serializedSize(d)).toBeGreaterThan(HARD_CHARS);
    expect(c.chars).toBeLessThanOrEqual(TARGET_CHARS);
    const out = c.data;
    expect(out.sessions[out.sessions.length - 1].date).toBe(TODAY);
    expect(out.meals.plan.some((m) => m.date === TODAY)).toBe(true);
    expect(out.water.entries.some((e) => e.date === TODAY)).toBe(true);
    expect(out.movement.log.some((l) => l.date === TODAY)).toBe(true);
    const note = out.retention[out.retention.length - 1];
    expect(note.removedEntries).toBe(c.removedEntries);
    expect(note.removedOther).toEqual(c.removedOther);
    expect(note.thinned).toEqual(c.thinned);
  });
  it('every history starts on the same date, so no screen mixes a complete past with a partial one', () => {
    const o = c.data;
    const first = (xs: { date: string }[]) => xs.reduce((m, x) => (x.date < m ? x.date : m), '9999');
    const horizon = o.sessions[0].date;
    for (const f of [first(o.meals.plan), first(o.movement.log), first(o.interests.sessions), first(o.wellbeing.checkins)]) expect(f >= horizon).toBe(true);
    expect(o.retention[o.retention.length - 1].oldestKept).toBe(horizon);
  });
  it('removes nothing the person wrote: the journal, dishes, workouts, interests, settings are the very same objects', () => {
    const o = c.data;
    expect(o.wellbeing.journal).toBe(d.wellbeing.journal);
    expect(o.meals.dishes).toBe(d.meals.dishes);
    expect(o.meals.prefs).toBe(d.meals.prefs);
    expect(o.movement.custom).toBe(d.movement.custom);
    expect(o.interests.items).toBe(d.interests.items);
    expect(o.interests.books).toBe(d.interests.books);
    expect(o.home).toBe(d.home);
    expect(o.preferences).toBe(d.preferences);
    expect(o.activities).toBe(d.activities);
  });
  it('the counts add up: what was removed is what is missing', () => {
    const o = c.data;
    const r = c.removedOther;
    expect(d.meals.plan.length - o.meals.plan.length).toBe(r.meals);
    expect(d.movement.log.length - o.movement.log.length).toBe(r.workouts);
    expect(d.interests.sessions.length - o.interests.sessions.length).toBe(r.hobbySessions);
    expect(d.wellbeing.checkins.length - o.wellbeing.checkins.length).toBe(r.checkins);
    expect(d.shopping.lists.length - o.shopping.lists.length).toBe(r.shoppingLists);
    expect(d.sessions.reduce((n, s) => n + s.entries.length, 0) - o.sessions.reduce((n, s) => n + s.entries.length, 0)).toBe(c.removedEntries);
  });
  it('is idempotent, deterministic, and safe to replay through the reducer', () => {
    expect(compactHistory(c.data, TARGET_CHARS, AT).data).toBe(c.data);
    expect(compactHistory(d, TARGET_CHARS, AT).data).toEqual(c.data);
    const viaReducer = reducer(d, { type: 'COMPACT_HISTORY', at: AT });
    expect(viaReducer).toEqual(c.data);
  });
  it('says what happened in words that name every kind and promise nothing it does not do', () => {
    const t = describeRetention(c.data.retention[c.data.retention.length - 1]);
    expect(t).toMatch(/Your history starts \d{4}-\d{2}-\d{2}/);
    expect(t).toMatch(/Your journal, your own recipes, workouts and interests, and your settings were not touched/);
    if (c.removedOther.meals) expect(t).toMatch(/planned or eaten meals/);
    if (c.removedOther.water) expect(t).toMatch(/water entries/);
  });
  it('survives being saved, exported and imported', () => {
    const back = validateAppData(JSON.parse(JSON.stringify(c.data)))!.data;
    expect(back.retention).toEqual(c.data.retention);
    const round = importJSON(exportJSON(c.data));
    expect(round.ok).toBe(true);
    expect(round.data!.retention).toEqual(c.data.retention);
    expect(round.data!.wellbeing.journal.length).toBe(d.wellbeing.journal.length);
  });
});

describe('thinning can be enough on its own, and then nothing is removed at all', () => {
  it('a lot of old water and old workouts but a modest log: only detail is reduced', () => {
    let d = busy(120);
    // inflate only the detail that thinning can shrink, until the data is over the line
    const extra = Array.from({ length: 60000 }, (_, i) => ({ id: `x${i}`, date: addDays(TODAY, -90 - (i % 25)), at: `${addDays(TODAY, -90 - (i % 25))}T${String(i % 24).padStart(2, '0')}:00:00.000Z`, ml: 100 }));
    d = { ...d, water: { ...d.water, entries: [...extra, ...d.water.entries] } };
    const target = serializedSize(d) - 50_000;
    const c = compactHistory(d, Math.max(target, 0), AT);
    expect(c.removedEntries).toBe(0);
    expect(c.thinned.waterDays).toBeGreaterThan(0);
    expect(c.data.sessions).toBe(d.sessions);
    expect(c.data.retention[c.data.retention.length - 1].removedEntries).toBe(0);
    expect(describeRetention(c.data.retention[c.data.retention.length - 1])).toMatch(/one total per day/);
  });
});

describe('trimming other history by date', () => {
  it('returns the same arrays where nothing is removed, so unchanged parts keep their identity', () => {
    const d = busy(10);
    const r = trimOtherBefore(d, addDays(TODAY, -100));
    expect(r.data).toBe(d);
    expect(r.removed).toEqual({ meals: 0, workouts: 0, water: 0, hobbySessions: 0, checkins: 0, shoppingLists: 0 });
    const cut = trimOtherBefore(d, addDays(TODAY, -3));
    expect(cut.data.meals.plan.every((m) => m.date >= addDays(TODAY, -3))).toBe(true);
    expect(cut.data.wellbeing.journal).toBe(d.wellbeing.journal);
  });
});
