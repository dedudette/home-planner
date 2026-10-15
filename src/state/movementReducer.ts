import { MAX_MOVE } from '../storage/movementSchema';
import type { MovementData, MovementGoals, MovementPrefs, Workout, WorkoutLog } from '../domain/movement/types';
import type { AppData } from '../domain/types';

/** Movement data. The minutes of a session are in the log entry the app keeps for everything; this holds only what the session was. */
export type MovementAction =
  | { type: 'MOVE_PREFS'; patch: Partial<MovementPrefs> }
  | { type: 'MOVE_GOALS'; patch: Partial<MovementGoals> }
  | { type: 'MOVE_REST_DAYS'; days: number[] }
  | { type: 'WORKOUT_SAVE'; workout: Workout }
  | { type: 'WORKOUT_DELETE'; id: string }
  | { type: 'MOVE_FAVOURITE'; id: string; on: boolean }
  | { type: 'MOVE_LOG_ADD'; log: WorkoutLog }
  | { type: 'MOVE_LOG_DELETE'; entryId: string }
  | { type: 'MOVE_LOG_FELT'; entryId: string; felt: WorkoutLog['felt']; note?: string };

const withMove = (d: AppData, f: (m: MovementData) => MovementData): AppData => { const next = f(d.movement); return next === d.movement ? d : { ...d, movement: next }; };

export const movementReducer = (d: AppData, a: MovementAction): AppData => {
  switch (a.type) {
    case 'MOVE_PREFS': return withMove(d, (m) => ({ ...m, prefs: { ...m.prefs, ...a.patch } }));
    case 'MOVE_GOALS': return withMove(d, (m) => ({ ...m, goals: { ...m.goals, ...a.patch } }));
    case 'MOVE_REST_DAYS': return withMove(d, (m) => ({ ...m, restDays: [...new Set(a.days.filter((x) => Number.isInteger(x) && x >= 0 && x <= 6))].sort() }));
    case 'WORKOUT_SAVE': return withMove(d, (m) => ({ ...m, custom: (m.custom.some((w) => w.id === a.workout.id) ? m.custom.map((w) => (w.id === a.workout.id ? { ...a.workout, source: 'personal' as const } : w)) : [...m.custom, { ...a.workout, source: 'personal' as const }]).slice(-MAX_MOVE.custom) }));
    case 'WORKOUT_DELETE': return withMove(d, (m) => (m.custom.some((w) => w.id === a.id) ? { ...m, custom: m.custom.filter((w) => w.id !== a.id), favourites: m.favourites.filter((x) => x !== a.id) } : m));
    case 'MOVE_FAVOURITE': return withMove(d, (m) => (m.favourites.includes(a.id) === a.on ? m : { ...m, favourites: a.on ? [...m.favourites, a.id] : m.favourites.filter((x) => x !== a.id) }));
    case 'MOVE_LOG_ADD': return withMove(d, (m) => (m.log.some((l) => l.entryId === a.log.entryId) ? m : { ...m, log: [...m.log, a.log].slice(-MAX_MOVE.log) }));
    case 'MOVE_LOG_DELETE': return withMove(d, (m) => (m.log.some((l) => l.entryId === a.entryId) ? { ...m, log: m.log.filter((l) => l.entryId !== a.entryId) } : m));
    case 'MOVE_LOG_FELT': return withMove(d, (m) => (m.log.some((l) => l.entryId === a.entryId) ? { ...m, log: m.log.map((l) => (l.entryId === a.entryId ? { ...l, felt: a.felt, ...(a.note !== undefined ? { note: a.note.slice(0, 300) } : {}) } : l)) } : m));
    default: return d;
  }
};
