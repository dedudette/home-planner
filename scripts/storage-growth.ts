/**
 * Measures how fast saved data grows, by simulating a busy person through the app's own reducer (so the sizes are those of real
 * records, not guesses), and prints where the characters go. Run it with:  npx vite-node scripts/storage-growth.ts
 *
 * "Busy" here is deliberately generous: every day a few cleaning or habit tasks, a guided workout, eight glasses of water, a
 * check-in, three planned meals and a hobby session; a short journal entry on most days; a shopping list each week; every
 * entry is added through the same actions the screens use. The simulation uses synthetic text only.
 */
import { emptyAppData, uid } from '../src/domain/appdata';
import { addDays } from '../src/domain/dates';
import { serializedSize, SOFT_CHARS, HARD_CHARS } from '../src/domain/retention';
import { STARTER_RECIPES } from '../src/domain/meals/recipes';
import { reducer } from '../src/state/reducer';
import type { AppData, ISODate, Task } from '../src/domain/types';
import { adhocTask } from '../src/domain/modules/adhoc';

const START: ISODate = '2024-01-01';
const day = (n: number) => addDays(START, n);
const stampFor = (date: ISODate, hour: number, minute = 0) => ({ now: `${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`, today: date, hour, tz: 0 });
const lorem = (n: number) => 'Synthetic journal words for sizing. '.repeat(Math.ceil(n / 36)).slice(0, n);

export interface Row { label: string; chars: number }

const breakdown = (d: AppData): Row[] => {
  const parts: [string, unknown][] = [['sessions (the one log of everything done)', d.sessions], ['exposures (what Today showed)', d.exposures], ['recEvents', d.recEvents], ['meals.plan', d.meals.plan], ['shopping.lists', d.shopping.lists], ['movement.log', d.movement.log], ['water.entries', d.water.entries], ['wellbeing.checkins', d.wellbeing.checkins], ['wellbeing.journal', d.wellbeing.journal], ['interests.sessions', d.interests.sessions], ['activities', d.activities], ['everything else', null]];
  const rows = parts.slice(0, -1).map(([label, v]) => ({ label, chars: JSON.stringify(v).length }));
  rows.push({ label: 'everything else', chars: serializedSize(d) - rows.reduce((n, r) => n + r.chars, 0) });
  return rows;
};

const simulate = (days: number, journalEvery = 1, journalChars = 600): AppData => {
  let d = emptyAppData(START);
  const dishes = STARTER_RECIPES.filter((r) => r.slots.includes('dinner'));
  d = reducer(d, { type: 'INTEREST_SAVE', interest: { id: 'int1', name: 'Drawing', catalogId: 'drawing', category: 'visual-art', status: 'active', goal: '', weeklyMinutes: null, note: '', createdAt: `${START}T00:00:00.000Z` } });
  for (let i = 0; i < days; i++) {
    const date = day(i);
    // cleaning and habit tasks, through the real completion action
    for (let k = 0; k < 4; k++) {
      const task = { ...adhocTask({ kind: 'learning', id: `x${k}`, name: `Task ${k}`, minutes: 10, domain: 'home', intensity: 'gentle', difficulty: 1 }), id: `t${k}` } as Task;
      d = reducer(d, { type: 'TASK_COMPLETE', task, stamp: stampFor(date, 8 + k), minutes: 10, via: 'check', entryId: uid('e'), surface: 'today' });
    }
    // a guided workout
    const eid = uid('e');
    const w = adhocTask({ kind: 'workout', id: 'wk', name: 'Strength basics', minutes: 20, domain: 'fitness', intensity: 'moderate', difficulty: 2 });
    d = reducer(d, { type: 'TASK_COMPLETE', task: w, stamp: stampFor(date, 18), minutes: 20, via: 'timer', entryId: eid, surface: 'movement' });
    d = reducer(d, { type: 'MOVE_LOG_ADD', log: { entryId: eid, workoutId: 'strength-basics', name: 'Strength basics', date, at: `${date}T18:00:00.000Z`, felt: 'right', exercises: Array.from({ length: 8 }, (_, n) => ({ exerciseId: `ex${n}`, name: `Exercise number ${n}`, status: 'done' as const, sets: 2, reps: 10 })) as never, note: '' } });
    for (let g = 0; g < 8; g++) d = reducer(d, { type: 'WATER_ADD', entry: { id: uid('w'), date, at: `${date}T${String(8 + g).padStart(2, '0')}:00:00.000Z`, ml: 250 } });
    d = reducer(d, { type: 'CHECKIN_SAVE', checkin: { id: uid('c'), date, at: `${date}T20:00:00.000Z`, energy: 'ok', mood: 4, note: lorem(60) } });
    if (i % journalEvery === 0) d = reducer(d, { type: 'JOURNAL_SAVE', entry: { id: uid('j'), date, at: `${date}T21:00:00.000Z`, title: 'A short title', text: lorem(journalChars) } });
    for (const slot of ['breakfast', 'lunch', 'dinner'] as const) {
      const r = dishes[(i + slot.length) % dishes.length];
      d = reducer(d, { type: 'MEAL_SAVE', entry: { id: uid('m'), date, slot, ref: { kind: 'recipe', id: r.id }, name: r.name, servings: 2, status: 'eaten', statusAt: `${date}T19:00:00.000Z`, prepActivityId: null, kcal: null, note: '' } });
    }
    const eid2 = uid('e');
    d = reducer(d, { type: 'TASK_COMPLETE', task: adhocTask({ kind: 'learning', id: 'int1', name: 'Drawing', minutes: 15, domain: 'learning', intensity: 'gentle', difficulty: 1 }), stamp: stampFor(date, 19), minutes: 15, via: 'timer', entryId: eid2, surface: 'learning' });
    d = reducer(d, { type: 'SESSION_ADD', session: { id: uid('s'), interestId: 'int1', entryId: eid2, date, at: `${date}T19:00:00.000Z`, bookId: null, starterId: null, note: lorem(80), feedback: 'enjoyed', resource: '' } });
  }
  return d;
};

const kb = (n: number) => `${(n / 1000).toFixed(0)} k`;
for (const [days, label] of [[365, '1 year'], [730, '2 years']] as const) {
  const d = simulate(days);
  console.log(`\n== ${label}, a very busy person (journal every day, ~600 characters): ${kb(serializedSize(d))} characters (soft limit ${kb(SOFT_CHARS)}, hard limit ${kb(HARD_CHARS)})`);
  for (const r of breakdown(d).sort((a, b) => b.chars - a.chars)) console.log(`   ${kb(r.chars).padStart(7)}  ${r.label}`);
}
const light = simulate(365, 7, 400);
console.log(`\n== 1 year, a lighter person (journal weekly): ${kb(serializedSize(light))} characters`);
