import { emptyMovement } from '../domain/movement/defaults';
import { AVOIDS, MOVE_EQUIPMENT, MOVE_LEVELS, MOVE_TYPES, type Felt, type LoggedExercise, type MovementData, type Workout, type WorkoutBlock, type WorkoutLog } from '../domain/movement/types';
import { EXERCISE_BY_ID } from '../domain/movement/exercises';
import { Ctx, date, intn, isObj, isoStamp, keepNewest, list, oneOf, oneOfOrNull, str, strList } from './primitives';

export const MAX_MOVE = { custom: 100, blocks: 30, log: 3000, exercises: 40, favourites: 100 };
const FELT: readonly Felt[] = ['easy', 'right', 'hard', 'pain'];
const STATUS = ['done', 'skipped', 'easier'] as const;

const validateBlock = (raw: unknown): WorkoutBlock | null => {
  if (!isObj(raw)) return null;
  const exerciseId = typeof raw.exerciseId === 'string' && EXERCISE_BY_ID.has(raw.exerciseId) ? raw.exerciseId : undefined;
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 60) : undefined;
  if (!exerciseId && !name) return null;
  const hasSeconds = typeof raw.seconds === 'number' && raw.seconds > 0;
  const hasReps = typeof raw.reps === 'number' && raw.reps > 0;
  if (!hasSeconds && !hasReps) return null;
  const sets = typeof raw.sets === 'number' && raw.sets >= 1 ? intn(raw.sets, 1, 1, 20) : 0;
  if (!sets) return null;
  return { ...(exerciseId ? { exerciseId } : { name }), sets, ...(hasSeconds ? { seconds: intn(raw.seconds, 30, 1, 3600) } : { reps: intn(raw.reps, 10, 1, 200) }), restSeconds: intn(raw.restSeconds, 30, 0, 600) };
};

export const validateWorkout = (raw: unknown, c: Ctx): Workout | null => {
  if (!isObj(raw) || typeof raw.id !== 'string' || !str(raw.name).trim()) { c.dropped++; return null; }
  const blocks = (Array.isArray(raw.blocks) ? raw.blocks : []).slice(0, MAX_MOVE.blocks).map(validateBlock).filter((b): b is WorkoutBlock => !!b);
  if (!blocks.length) { c.dropped++; return null; }
  return { id: raw.id.slice(0, 60), name: str(raw.name, '', 80).trim(), type: oneOf(raw.type, MOVE_TYPES, 'strength'), level: oneOf(raw.level, MOVE_LEVELS, 'beginner'), blurb: str(raw.blurb, '', 200), blocks, source: 'personal' };
};

const validateLogged = (raw: unknown): LoggedExercise | null => {
  if (!isObj(raw) || !str(raw.name).trim()) return null;
  return {
    exerciseId: typeof raw.exerciseId === 'string' ? raw.exerciseId.slice(0, 60) : null, name: str(raw.name, '', 60).trim(), status: oneOf(raw.status, STATUS, 'done'),
    setsDone: typeof raw.setsDone === 'number' && raw.setsDone > 0 ? intn(raw.setsDone, 1, 1, 50) : null, repsDone: typeof raw.repsDone === 'number' && raw.repsDone > 0 ? intn(raw.repsDone, 1, 1, 5000) : null,
  };
};

const validateLog = (raw: unknown): WorkoutLog | null => {
  if (!isObj(raw) || typeof raw.entryId !== 'string' || !date(raw.date) || typeof raw.at !== 'string' || Number.isNaN(Date.parse(raw.at))) return null;
  return {
    entryId: raw.entryId.slice(0, 60), workoutId: typeof raw.workoutId === 'string' ? raw.workoutId.slice(0, 60) : null, name: str(raw.name, 'Workout', 80), date: raw.date as string, at: isoStamp(raw.at, raw.at),
    felt: oneOfOrNull(raw.felt, FELT), exercises: (Array.isArray(raw.exercises) ? raw.exercises : []).slice(0, MAX_MOVE.exercises).map(validateLogged).filter((x): x is LoggedExercise => !!x), note: str(raw.note, '', 300),
  };
};

export const validateMovement = (raw: unknown, c: Ctx): MovementData => {
  const d = emptyMovement();
  if (raw === undefined) return d;
  if (!isObj(raw)) { c.note('Your movement data was unreadable and was reset.'); return d; }
  const p = isObj(raw.prefs) ? raw.prefs : {};
  const g = isObj(raw.goals) ? raw.goals : {};
  const ids = new Set<string>();
  const custom: Workout[] = [];
  for (const x of (Array.isArray(raw.custom) ? raw.custom : []).slice(0, MAX_MOVE.custom)) {
    const w = validateWorkout(x, c);
    if (w && !ids.has(w.id)) { ids.add(w.id); custom.push(w); } else if (w) c.dropped++;
  }
  const seen = new Set<string>();
  const log: WorkoutLog[] = [];
  for (const x of Array.isArray(raw.log) ? raw.log : []) {
    const l = validateLog(x);
    if (!l || seen.has(l.entryId)) { c.dropped++; continue; }
    seen.add(l.entryId); log.push(l);
  }
  log.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  return {
    prefs: { equipment: list(p.equipment, MOVE_EQUIPMENT), likes: list(p.likes, MOVE_TYPES), avoid: list(p.avoid, AVOIDS), lowImpactOnly: p.lowImpactOnly === true },
    goals: {
      sessionsPerWeek: typeof g.sessionsPerWeek === 'number' && g.sessionsPerWeek >= 1 ? intn(g.sessionsPerWeek, 3, 1, 14) : null,
      minutesPerWeek: typeof g.minutesPerWeek === 'number' && g.minutesPerWeek >= 5 ? intn(g.minutesPerWeek, 90, 5, 2000) : null, note: str(g.note, '', 300),
    },
    restDays: [...new Set((Array.isArray(raw.restDays) ? raw.restDays : []).filter((x): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= 6))].sort(),
    custom, favourites: strList(raw.favourites, MAX_MOVE.favourites).map((x) => x.slice(0, 60)), log: keepNewest(log, MAX_MOVE.log, c, 'workout records'),
  };
};
