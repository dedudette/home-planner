import { describe, expect, it } from 'vitest';
import { emptyAppData } from '../src/domain/appdata';
import { emptyMovement } from '../src/domain/movement/defaults';
import { EXERCISES, EXERCISE_BY_ID } from '../src/domain/movement/exercises';
import { allWorkouts, blockSeconds, movementSummary, offerFor, suggestWorkouts, workoutById, workoutDemands, workoutDifficulty, workoutIntensity, workoutMinutes, workoutNeeds } from '../src/domain/movement/planner';
import { buildSteps, endSession, loggedExercises, markEasier, nextStep, pauseSession, resumeSession, sessionMinutes, skipExercise, startSession, tick } from '../src/domain/movement/session';
import { MOVE_TYPES, type Workout, type WorkoutLog } from '../src/domain/movement/types';
import { STARTER_WORKOUTS } from '../src/domain/movement/workouts';
import { adhocTask } from '../src/domain/modules/adhoc';
import { activityToTask } from '../src/domain/modules/activities';
import { contentFor } from '../src/domain/modules/content';
import { dayPlan, todayPlan } from '../src/domain/view';
import { planOf } from '../src/domain/planInputs';
import type { AppData } from '../src/domain/types';
import { buildView } from '../src/domain/view';
import { reducer, type Stamp } from '../src/state/reducer';
import { validateAppData } from '../src/storage/schema';
import { custom, TODAY } from './helpers';

const stamp = (today = TODAY, hour = 9): Stamp => ({ now: `${today}T${String(hour).padStart(2, '0')}:00:00.000Z`, today, hour, tz: 0 });
const mv = (patch: Partial<AppData['movement']> = {}): AppData => ({ ...emptyAppData(TODAY), movement: { ...emptyMovement(), ...patch } });
const own = (blocks: Workout['blocks'], over: Partial<Workout> = {}): Workout => ({ id: 'w1', name: 'Mine', type: 'strength', level: 'beginner', blurb: '', blocks, source: 'personal', ...over });

describe('the exercise catalogue', () => {
  it('has unique ids, clear steps and an easier version for every exercise', () => {
    expect(new Set(EXERCISES.map((e) => e.id)).size).toBe(EXERCISES.length);
    for (const e of EXERCISES) {
      expect(e.how.length, e.id).toBeGreaterThanOrEqual(2);
      expect(e.easier.length, `${e.id} needs an easier version`).toBeGreaterThan(10);
      for (const step of e.how) expect(step.length, e.id).toBeGreaterThan(8);
    }
  });
  it('covers every kind of movement the app offers', () => {
    for (const t of MOVE_TYPES) expect(EXERCISES.some((e) => e.type === t), t).toBe(true);
  });
  it('makes no medical, weight or pain-pushing claims', () => {
    const text = JSON.stringify([EXERCISES, STARTER_WORKOUTS]).toLowerCase();
    for (const w of ['cure', 'treat ', 'diagnos', 'weight loss', 'lose weight', 'burn fat', 'burn calories', 'calorie', 'no pain', 'push through', 'to failure', 'shred', 'toned', 'detox', 'punish', 'earn ']) expect(text.includes(w), w).toBe(false);
  });
});

describe('the starter workouts', () => {
  it('are built only from exercises that exist, with an easier workout that exists and is not harder', () => {
    expect(new Set(STARTER_WORKOUTS.map((w) => w.id)).size).toBe(STARTER_WORKOUTS.length);
    const rank = { gentle: 0, moderate: 1, vigorous: 2 };
    for (const w of STARTER_WORKOUTS) {
      for (const b of w.blocks) expect(EXERCISE_BY_ID.has(b.exerciseId!), `${w.id}: ${b.exerciseId}`).toBe(true);
      if (w.easierId) {
        const e = workoutById(emptyAppData(TODAY), w.easierId);
        expect(e, `${w.id} -> ${w.easierId}`).not.toBeNull();
        expect(rank[workoutIntensity(e!)], w.id).toBeLessThanOrEqual(rank[workoutIntensity(w)]);
        expect(workoutDifficulty(e!), w.id).toBeLessThanOrEqual(workoutDifficulty(w));
      }
    }
  });
  it('have durations worked out from their blocks, and sensible ones', () => {
    for (const w of STARTER_WORKOUTS) { const m = workoutMinutes(w); expect(m, w.id).toBeGreaterThanOrEqual(3); expect(m, w.id).toBeLessThanOrEqual(30); }
    expect(workoutMinutes(workoutById(emptyAppData(TODAY), 'easy-walk-10') as Workout)).toBe(10);
    expect(workoutMinutes(workoutById(emptyAppData(TODAY), 'easy-walk-20') as Workout)).toBe(20);
  });
  it('count reps at the exercise\'s pace and add the rests, rounding up to a whole minute', () => {
    const w = own([{ exerciseId: 'bodyweight-squat', sets: 2, reps: 10, restSeconds: 30 }]); // 10 reps x 5 s x 2 = 100 s + 2 x 30 s rest = 160 s
    expect(blockSeconds(w.blocks[0])).toBe(160);
    expect(workoutMinutes(w)).toBe(3);
    expect(workoutMinutes(own([{ name: 'My own thing', sets: 3, reps: 10, restSeconds: 0 }]))).toBe(2); // a custom exercise: 3 s a rep -> 90 s
  });
  it('offer something for every type with only household things (a chair, a wall)', () => {
    for (const t of MOVE_TYPES) {
      const ok = STARTER_WORKOUTS.filter((w) => w.type === t && workoutNeeds(w).every((n) => n === 'chair' || n === 'wall'));
      expect(ok.length, `${t} without special equipment`).toBeGreaterThan(0);
    }
  });
});

describe('suggesting workouts that suit a person', () => {
  const prefs = emptyMovement().prefs;
  const ids = (xs: { workout: Workout }[]) => xs.map((x) => x.workout.id);
  const jumper = own([{ exerciseId: 'dance-jacks', sets: 1, seconds: 120, restSeconds: 0 }], { id: 'jump', type: 'dance', level: 'intermediate' });
  const all = [...STARTER_WORKOUTS, jumper];

  it('with nothing set, everything suited to a normal day is offered', () => {
    const out = suggestWorkouts(all, prefs);
    expect(ids(out)).toContain('jump');
    expect(out.length).toBe(all.length);
  });
  it('hides what asks for something the person would rather not do, and says why when showing everything', () => {
    const p = { ...prefs, avoid: ['jumping' as const] };
    expect(ids(suggestWorkouts(all, p))).not.toContain('jump');
    const shown = suggestWorkouts(all, p, {}, 'ok', true).find((h) => h.workout.id === 'jump')!;
    expect(shown.flags.join(' ')).toMatch(/jumping/);
    const noFloor = suggestWorkouts(all, { ...prefs, avoid: ['floor' as const] });
    for (const h of noFloor) expect(workoutDemands(h.workout)).not.toContain('floor');
    expect(ids(noFloor)).not.toContain('core-glutes-mat');
  });
  it('low-impact-only hides high-impact work', () => {
    expect(ids(suggestWorkouts(all, { ...prefs, lowImpactOnly: true }))).not.toContain('jump');
  });
  it('with equipment listed, hides what needs other things; with none listed, shows it all', () => {
    const p = { ...prefs, equipment: ['chair' as const, 'wall' as const] };
    for (const h of suggestWorkouts(all, p)) for (const n of workoutNeeds(h.workout)) expect(['chair', 'wall']).toContain(n);
    expect(ids(suggestWorkouts(all, p))).not.toContain('full-body-light');
    expect(ids(suggestWorkouts(all, prefs))).toContain('full-body-light');
  });
  it('on a low-energy day nothing vigorous or hard is offered (the one shared safety rule)', () => {
    const out = suggestWorkouts(all, prefs, {}, 'low');
    expect(ids(out)).not.toContain('jump');
    for (const h of out) { expect(workoutIntensity(h.workout)).toBe('gentle'); expect(workoutDifficulty(h.workout)).toBeLessThanOrEqual(2); }
    expect(ids(out)).toEqual(expect.arrayContaining(['seated-gentle', 'morning-mobility', 'easy-walk-10', 'desk-break']));
    expect(ids(out)).not.toContain('bodyweight-basics'); // squats are moderate: fine for the plan's floor, not offered as a gentle option
    expect(ids(suggestWorkouts(all, prefs, {}, 'ok'))).toContain('bodyweight-basics');
    expect(suggestWorkouts(all, prefs, {}, 'low', true).find((h) => h.workout.id === 'bodyweight-basics')!.flags.join(' ')).toMatch(/low-energy day/);
  });
  it('filters by type, level, time and search; puts liked types first', () => {
    expect(suggestWorkouts(all, prefs, { type: 'walking' }).every((h) => h.workout.type === 'walking')).toBe(true);
    expect(suggestWorkouts(all, prefs, { level: 'intermediate' }).every((h) => h.workout.level === 'intermediate')).toBe(true);
    expect(suggestWorkouts(all, prefs, { maxMinutes: 10 }).every((h) => h.minutes <= 10)).toBe(true);
    expect(ids(suggestWorkouts(all, prefs, { query: 'unwind' }))).toEqual(['evening-unwind']);
    expect(suggestWorkouts(all, { ...prefs, likes: ['dance'] })[0].workout.type).toBe('dance');
  });
});

describe('offers are offers, never actions', () => {
  const log = (workoutId: string, felt: WorkoutLog['felt'], n: number): WorkoutLog => ({ entryId: `e${n}`, workoutId, name: 'x', date: TODAY, at: `${TODAY}T10:00:00.000Z`, felt, exercises: [], note: '' });
  it('offers a step up only after three easy sessions of the same workout', () => {
    expect(offerFor(mv({ log: [log('a', 'easy', 1), log('a', 'easy', 2)] }), 'a')).toBeNull();
    expect(offerFor(mv({ log: [log('a', 'easy', 1), log('a', 'easy', 2), log('a', 'easy', 3)] }), 'a')?.kind).toBe('step-up');
    expect(offerFor(mv({ log: [log('a', 'easy', 1), log('a', 'easy', 2), log('a', 'right', 3)] }), 'a')).toBeNull();
    expect(offerFor(mv({ log: [log('b', 'easy', 1), log('b', 'easy', 2), log('b', 'easy', 3)] }), 'a')).toBeNull();
  });
  it('after pain it only ever offers the gentler version, and says nothing is pushed', () => {
    const o = offerFor(mv({ log: [log('a', 'easy', 1), log('a', 'easy', 2), log('a', 'pain', 3)] }), 'a')!;
    expect(o.kind).toBe('easier');
    expect(o.reason).toMatch(/Nothing is being pushed/);
    expect(offerFor(mv({ log: [log('a', 'hard', 1), log('a', 'right', 2), log('a', 'hard', 3)] }), 'a')?.kind).toBe('easier');
  });
});

describe('a guided session', () => {
  const w = own([
    { exerciseId: 'bodyweight-squat', sets: 2, reps: 8, restSeconds: 30 },
    { exerciseId: 'walk-easy', sets: 1, seconds: 60, restSeconds: 20 },
    { exerciseId: 'glute-bridge', sets: 1, reps: 10, restSeconds: 0 },
  ]);
  const T0 = 1_000_000;

  it('lays out work and rest, with no rest after the very last set', () => {
    const steps = buildSteps(w);
    expect(steps.map((s) => `${s.kind}${s.block}`)).toEqual(['work0', 'rest0', 'work0', 'rest0', 'work1', 'rest1', 'work2']);
    expect(steps[0]).toMatchObject({ seconds: null, reps: 8, set: 1, sets: 2 });
    expect(steps[4]).toMatchObject({ seconds: 60 });
  });
  it('a rep set waits for the person; a timed step and a rest count themselves down', () => {
    let s = startSession(w, T0);
    s = tick(s, T0 + 60_000);
    expect(s.index).toBe(0); // reps: waiting for "done", however long it takes
    s = nextStep(s, T0 + 60_000); // done set 1 -> rest
    expect(s.steps[s.index].kind).toBe('rest');
    s = tick(s, T0 + 60_000 + 29_000);
    expect(s.steps[s.index].kind).toBe('rest');
    s = tick(s, T0 + 60_000 + 30_000);
    expect(s.index).toBe(2); // second set of squats
    expect(s.results[0].setsDone).toBe(1);
  });
  it('catches up from the wall clock after the tab slept, carrying leftover time forward', () => {
    let s = startSession(w, T0);
    s = nextStep(s, T0); s = nextStep(s, T0); // set 1 done, skip the rest -> set 2
    s = nextStep(s, T0); // set 2 done -> rest 30 s
    s = tick(s, T0 + 30_000 + 60_000 + 5_000); // rest over, a whole minute of walking over, and 5 s into the next rest
    expect(s.steps[s.index]).toMatchObject({ kind: 'rest', block: 1 });
    expect(s.stepMs).toBe(5_000);
    expect(s.results[1].setsDone).toBe(1);
  });
  it('only running time counts: a pause does not make the workout longer', () => {
    let s = startSession(w, T0);
    s = pauseSession(s, T0 + 120_000);
    s = tick(s, T0 + 3_600_000); // an hour passes while paused: nothing happens
    expect(s.activeMs).toBe(120_000);
    s = resumeSession(s, T0 + 3_600_000);
    s = endSession(s, T0 + 3_600_000 + 60_000);
    expect(s.activeMs).toBe(180_000);
    expect(sessionMinutes(s)).toBe(3);
  });
  it('an exercise can be skipped, done easier, and the log says what really happened', () => {
    let s = startSession(w, T0);
    s = markEasier(s);
    s = nextStep(s, T0 + 20_000); s = nextStep(s, T0 + 20_000); s = nextStep(s, T0 + 40_000); // both squat sets
    s = skipExercise(s, T0 + 40_000); // skip the rest of block 0 (already done) -> into the walk
    expect(s.steps[s.index].block).toBe(1);
    s = skipExercise(s, T0 + 41_000); // skip the walk
    s = endSession(s, T0 + 100_000);
    const log = loggedExercises(s, w);
    expect(log.map((l) => l.status)).toEqual(['easier', 'skipped', 'skipped']);
    expect(log[0]).toMatchObject({ setsDone: 2, repsDone: 16, exerciseId: 'bodyweight-squat' });
    expect(log[1].setsDone).toBeNull();
  });
  it('finishes by itself after the last step, and never reports less than one minute', () => {
    let s = startSession(own([{ exerciseId: 'bodyweight-squat', sets: 1, reps: 5, restSeconds: 0 }]), T0);
    s = nextStep(s, T0 + 5_000);
    expect(s.status).toBe('finished');
    expect(sessionMinutes(s)).toBe(1);
  });
  it('a logged exercise carries no minutes or seconds at all, so nothing can be counted twice', () => {
    const s = endSession(startSession(w, T0), T0 + 60_000);
    for (const l of loggedExercises(s, w)) expect(Object.keys(l).sort()).toEqual(['exerciseId', 'name', 'repsDone', 'setsDone', 'status']);
  });
});

describe('minutes are counted once', () => {
  const workout = STARTER_WORKOUTS.find((x) => x.id === 'bodyweight-basics') as Workout;
  it('a whole workout is one entry with its real duration; the exercise log adds nothing', () => {
    let d = mv();
    const task = adhocTask({ kind: 'workout', id: workout.id, name: workout.name, minutes: workoutMinutes(workout), domain: 'fitness', intensity: workoutIntensity(workout), difficulty: workoutDifficulty(workout) });
    expect(task.id).toBe('adhoc:workout:bodyweight-basics');
    d = reducer(d, { type: 'TASK_COMPLETE', task, stamp: stamp(), minutes: 14, via: 'timer', entryId: 'e1', surface: 'movement' });
    d = reducer(d, { type: 'MOVE_LOG_ADD', log: { entryId: 'e1', workoutId: workout.id, name: workout.name, date: TODAY, at: stamp().now, felt: 'right', note: '', exercises: workout.blocks.map((b) => ({ exerciseId: b.exerciseId!, name: b.exerciseId!, status: 'done' as const, setsDone: b.sets, repsDone: b.reps ?? null })) } });
    expect(movementSummary(d, TODAY, TODAY)).toEqual({ sessions: 1, minutes: 14, days: 1 });
    expect(d.taskStates[task.id]).toBeUndefined(); // an ad-hoc session has no schedule of its own
    const dup = reducer(d, { type: 'TASK_COMPLETE', task, stamp: stamp(), minutes: 14, via: 'timer', entryId: 'e1', surface: 'movement' });
    expect(dup).toBe(d);
  });
  it('a planned workout and an ad-hoc one add up as two different sessions, each once', () => {
    let d: AppData = custom('apartment', {}, {}, { sessionMinutes: 60, focus: ['home'] });
    d = { ...d, modules: { ...d.modules, enabled: { ...d.modules.enabled, movement: true } }, activities: [{ id: 'p1', module: 'movement', kind: 'flexible', name: 'Bodyweight basics', minutes: 14, schedule: { kind: 'once', date: TODAY }, time: null, startDate: TODAY, endDate: null, ref: { kind: 'workout', id: workout.id }, intensity: 'moderate', difficulty: 1, note: '', createdAt: `${TODAY}T08:00:00.000Z`, archived: false }] };
    const planned = activityToTask(d.activities[0], contentFor(d));
    expect(planned.substeps.length).toBe(workout.blocks.length); // the workout's own blocks show on the planned item
    d = reducer(d, { type: 'TASK_COMPLETE', task: planned, stamp: stamp(), minutes: 15, via: 'timer', entryId: 'e1' });
    const task = adhocTask({ kind: 'workout', id: 'easy-walk-10', name: '10-minute easy walk', minutes: 10, domain: 'fitness', intensity: 'gentle', difficulty: 1 });
    d = reducer(d, { type: 'TASK_COMPLETE', task, stamp: stamp(TODAY, 18), minutes: 10, via: 'timer', entryId: 'e2' });
    expect(movementSummary(d, TODAY, TODAY)).toMatchObject({ sessions: 2, minutes: 25 });
    expect(buildView(d, planOf(d), TODAY).byId.get('act:p1')).toBeTruthy();
  });
  it('an undone session leaves no minutes and no log', () => {
    let d = mv();
    const task = adhocTask({ kind: 'workout', id: workout.id, name: workout.name, minutes: 14, domain: 'fitness', intensity: 'moderate', difficulty: 1 });
    d = reducer(d, { type: 'TASK_COMPLETE', task, stamp: stamp(), minutes: 14, via: 'timer', entryId: 'e1' });
    d = reducer(d, { type: 'MOVE_LOG_ADD', log: { entryId: 'e1', workoutId: workout.id, name: workout.name, date: TODAY, at: stamp().now, felt: null, note: '', exercises: [] } });
    d = reducer(d, { type: 'UNDO', entryId: 'e1', taskId: task.id, before: null, after: null });
    d = reducer(d, { type: 'MOVE_LOG_DELETE', entryId: 'e1' });
    expect(movementSummary(d, TODAY, TODAY).minutes).toBe(0);
    expect(d.movement.log).toHaveLength(0);
  });
});

describe('rest days and a day with little energy', () => {
  const base = (): AppData => {
    const d = custom('apartment', {}, {}, { sessionMinutes: 60, focus: ['home'] });
    return { ...d, modules: { ...d.modules, enabled: { ...d.modules.enabled, movement: true } } };
  };
  const act = (id: string, intensity: 'gentle' | 'vigorous', refId?: string) => ({ id, module: 'movement' as const, kind: 'flexible' as const, name: id, minutes: 20, schedule: { kind: 'weekly' as const, weekdays: [1] }, time: null, startDate: TODAY, endDate: null, ref: refId ? { kind: 'workout' as const, id: refId } : null, intensity, difficulty: (intensity === 'vigorous' ? 3 : 1) as 1 | 3, note: '', createdAt: `${TODAY}T08:00:00.000Z`, archived: false });

  it('a planned vigorous workout is left out on a low-energy day, with the reason, and a gentle one stays', () => {
    let d: AppData = { ...base(), activities: [act('hard', 'vigorous'), act('soft', 'gentle')] };
    d = reducer(d, { type: 'DAY_ENERGY', level: 'low', stamp: stamp() });
    const t = todayPlan(buildView(d, planOf(d), TODAY));
    expect(t.life.map((i) => i.task.id)).toContain('act:soft');
    expect(t.deferred.find((x) => x.item.task.id === 'act:hard')?.reason).toBe('energy');
  });
  it('a planned workout on a declared rest day is reported, never silently removed or moved', () => {
    const d: AppData = { ...base(), activities: [act('walk', 'gentle')], movement: { ...emptyMovement(), restDays: [1] } };
    const v = buildView(d, planOf(d), TODAY);
    const day = dayPlan(v, TODAY);
    expect(day.tasks.map((t) => t.id)).toContain('act:walk');
    expect(day.conflicts.some((c) => c.kind === 'rest-day')).toBe(true);
    const other: AppData = { ...d, movement: { ...emptyMovement(), restDays: [3] } };
    expect(dayPlan(buildView(other, planOf(other), TODAY), TODAY).conflicts.some((c) => c.kind === 'rest-day')).toBe(false);
  });
});

describe('saved movement data is validated', () => {
  it('survives a round trip and repairs bad data', () => {
    const good = mv({ restDays: [0, 3], favourites: ['easy-walk-10'], goals: { sessionsPerWeek: 3, minutesPerWeek: 90, note: 'Feel stronger' }, custom: [own([{ exerciseId: 'sit-to-stand', sets: 2, reps: 6, restSeconds: 30 }])] });
    const rt = validateAppData(JSON.parse(JSON.stringify(good)), TODAY)!;
    expect(rt.data.movement).toEqual(good.movement);
    const raw = JSON.parse(JSON.stringify(good));
    raw.movement.prefs = { equipment: ['mat', 'jetpack'], likes: ['dance', 'karate'], avoid: ['jumping', 'flying'], lowImpactOnly: 'yes', secret: 1 };
    raw.movement.restDays = [1, 1, 9, -2, 'x'];
    raw.movement.goals = { sessionsPerWeek: 99, minutesPerWeek: -5, note: 'x'.repeat(5000) };
    raw.movement.custom = [{ id: 'c1', name: 'ok', type: 'strength', level: 'beginner', blocks: [{ exerciseId: 'nope', sets: 0, reps: -1, restSeconds: 99999 }, { name: 'My move', sets: 3, reps: 10, restSeconds: 20 }, 'junk'] }, { id: 'c1', name: 'dup' }, { name: 'no id' }];
    raw.movement.log = [{ entryId: 'e1', date: TODAY, at: `${TODAY}T10:00:00.000Z`, name: 'x', felt: 'ecstatic', exercises: [{ name: 'a', status: 'done', minutes: 99 }, { name: '', status: 'done' }] }, { entryId: 'e1', date: TODAY, at: `${TODAY}T10:00:00.000Z`, name: 'dup' }, { nonsense: true }];
    const r = validateAppData(raw, TODAY)!.data.movement;
    expect(r.prefs).toEqual({ equipment: ['mat'], likes: ['dance'], avoid: ['jumping'], lowImpactOnly: false });
    expect(r.restDays).toEqual([1]);
    expect(r.goals).toEqual({ sessionsPerWeek: 14, minutesPerWeek: null, note: 'x'.repeat(300) });
    expect(r.custom).toHaveLength(1);
    expect(r.custom[0].blocks).toEqual([{ name: 'My move', sets: 3, reps: 10, restSeconds: 20 }]);
    expect(r.log).toHaveLength(1);
    expect(r.log[0].felt).toBeNull();
    expect(Object.keys(r.log[0].exercises[0]).includes('minutes')).toBe(false);
    expect(r.log[0].exercises).toHaveLength(1);
  });
  it('an old file simply has empty movement data', () => {
    const raw = JSON.parse(JSON.stringify(emptyAppData(TODAY))) as Record<string, unknown>;
    delete raw.movement; raw.version = 2; raw.onboardingComplete = true;
    expect(validateAppData(raw, TODAY)!.data.movement).toEqual(emptyMovement());
  });
});

describe('workouts of your own', () => {
  it('can be saved, appear beside the starter ones and be deleted without touching history', () => {
    let d = mv();
    const w = own([{ exerciseId: 'sit-to-stand', sets: 2, reps: 6, restSeconds: 30 }, { name: 'Stairs, slowly', sets: 2, seconds: 60, restSeconds: 30 }]);
    d = reducer(d, { type: 'WORKOUT_SAVE', workout: w });
    expect(allWorkouts(d).map((x) => x.id)).toContain('w1');
    expect(workoutMinutes(w)).toBeGreaterThan(0);
    d = reducer(d, { type: 'MOVE_LOG_ADD', log: { entryId: 'e1', workoutId: 'w1', name: 'Mine', date: TODAY, at: stamp().now, felt: 'right', note: '', exercises: [] } });
    d = reducer(d, { type: 'WORKOUT_DELETE', id: 'w1' });
    expect(allWorkouts(d).map((x) => x.id)).not.toContain('w1');
    expect(d.movement.log).toHaveLength(1);
  });
});
