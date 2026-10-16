import { blockName, exerciseOf } from './planner';
import type { LoggedExercise, Workout } from './types';

/**
 * A guided workout session as a plain state machine. Time is always passed in, never read, so it can be tested and so a tab that was
 * asleep catches up from the wall clock when it wakes. Only RUNNING time counts: a pause (or a phone call) does not make a workout longer.
 */
export interface SessionStep {
  kind: 'work' | 'rest';
  block: number;
  set: number;
  sets: number;
  /** Seconds to count down. Null for a rep-based set, which the person finishes with a tap. */
  seconds: number | null;
  reps?: number;
}

export type SessionStatus = 'running' | 'paused' | 'finished';

export interface BlockResult { setsDone: number; skipped: boolean; easier: boolean }

export interface SessionState {
  workoutId: string;
  steps: SessionStep[];
  index: number;
  status: SessionStatus;
  /** Running milliseconds so far (paused time excluded). */
  activeMs: number;
  /** Running milliseconds in the current step. */
  stepMs: number;
  /** The clock reading at the last update, while running. */
  lastTick: number;
  startedAt: number;
  results: BlockResult[];
}

export const buildSteps = (w: Workout): SessionStep[] => {
  const steps: SessionStep[] = [];
  w.blocks.forEach((b, block) => {
    for (let set = 1; set <= b.sets; set++) {
      steps.push({ kind: 'work', block, set, sets: b.sets, seconds: b.seconds ?? null, ...(b.reps !== undefined ? { reps: b.reps } : {}) });
      const last = block === w.blocks.length - 1 && set === b.sets;
      if (b.restSeconds > 0 && !last) steps.push({ kind: 'rest', block, set, sets: b.sets, seconds: b.restSeconds });
    }
  });
  return steps;
};

export const startSession = (w: Workout, now: number): SessionState => ({
  workoutId: w.id, steps: buildSteps(w), index: 0, status: 'running', activeMs: 0, stepMs: 0, lastTick: now, startedAt: now,
  results: w.blocks.map(() => ({ setsDone: 0, skipped: false, easier: false })),
});

const finishIfDone = (s: SessionState): SessionState => (s.index >= s.steps.length ? { ...s, index: s.steps.length, status: 'finished' } : s);

/** Mark the current step complete and move on. A finished work step counts as a set done for its block. */
const advance = (s: SessionState): SessionState => {
  const step = s.steps[s.index];
  const results = s.results.map((r, i) => (step && step.kind === 'work' && i === step.block ? { ...r, setsDone: r.setsDone + 1 } : r));
  return finishIfDone({ ...s, results, index: s.index + 1, stepMs: 0 });
};

/** Bring the state up to `now`. Timed steps finish by themselves, carrying any time left over into the next step. */
export const tick = (s: SessionState, now: number): SessionState => {
  if (s.status !== 'running') return s;
  let cur: SessionState = { ...s, lastTick: now };
  let add = Math.max(0, now - s.lastTick);
  cur.activeMs += add;
  for (let guard = 0; guard < 500 && cur.status === 'running'; guard++) {
    const step = cur.steps[cur.index];
    if (!step || step.seconds === null) { cur = { ...cur, stepMs: cur.stepMs + add }; break; }
    const need = step.seconds * 1000 - cur.stepMs;
    if (add < need) { cur = { ...cur, stepMs: cur.stepMs + add }; break; }
    add -= need;
    cur = advance(cur);
  }
  return cur;
};

export const pauseSession = (s: SessionState, now: number): SessionState => (s.status === 'running' ? { ...tick(s, now), status: 'paused' } : s);
export const resumeSession = (s: SessionState, now: number): SessionState => (s.status === 'paused' ? { ...s, status: 'running', lastTick: now } : s);

/** "Done" for a rep-based set, or "skip the rest" of a rest step. */
export const nextStep = (s: SessionState, now: number): SessionState => (s.status === 'finished' ? s : advance(tick(s, now)));

/** Move on to the first step of the next exercise, marking this one skipped (unless sets were already done). */
export const skipExercise = (s: SessionState, now: number): SessionState => {
  const cur = tick(s, now);
  const step = cur.steps[cur.index];
  if (!step || cur.status === 'finished') return cur;
  const results = cur.results.map((r, i) => (i === step.block ? { ...r, skipped: r.setsDone === 0 } : r));
  let i = cur.index;
  while (i < cur.steps.length && cur.steps[i].block === step.block) i++;
  return finishIfDone({ ...cur, results, index: i, stepMs: 0 });
};

/** The person is doing the easier version of this exercise. Recorded so the log says what really happened. */
export const markEasier = (s: SessionState): SessionState => {
  const step = s.steps[s.index];
  return step ? { ...s, results: s.results.map((r, i) => (i === step.block ? { ...r, easier: true } : r)) } : s;
};

/** Ends the session now, finished or not. Elapsed running time is what counts, never more than 1440 minutes, and never less than one. */
export const endSession = (s: SessionState, now: number): SessionState => ({ ...tick(s, now), status: 'finished' });

export const sessionMinutes = (s: SessionState): number => Math.min(1440, Math.max(1, Math.round(s.activeMs / 60000)));

export const sessionProgress = (s: SessionState): number => (s.steps.length ? Math.min(1, s.index / s.steps.length) : 1);

/** What happened in each exercise, for the log. No minutes: the workout's minutes are the one number in the log entry. */
export const loggedExercises = (s: SessionState, w: Workout): LoggedExercise[] =>
  w.blocks.map((b, i) => {
    const r = s.results[i];
    const status: LoggedExercise['status'] = r.skipped || (r.setsDone === 0) ? 'skipped' : r.easier ? 'easier' : 'done';
    return { exerciseId: b.exerciseId ?? null, name: blockName(b), status, setsDone: r.setsDone || null, repsDone: b.reps !== undefined && r.setsDone ? b.reps * r.setsDone : null };
  });

export const describeStep = (s: SessionState, w: Workout): { title: string; how: string[]; easier: string | null; detail: string } => {
  const step = s.steps[s.index];
  if (!step) return { title: 'All done', how: [], easier: null, detail: '' };
  const b = w.blocks[step.block];
  const ex = exerciseOf(b);
  if (step.kind === 'rest') return { title: 'Rest', how: ['Breathe and shake out. Next: ' + (s.steps[s.index + 1] ? blockName(w.blocks[s.steps[s.index + 1].block]) : 'finish') + '.'], easier: null, detail: `${step.seconds} seconds` };
  const amount = step.seconds !== null ? `${step.seconds >= 120 && step.seconds % 60 === 0 ? `${step.seconds / 60} minutes` : `${step.seconds} seconds`}` : `${step.reps} repetitions`;
  return { title: blockName(b), how: ex?.how ?? [], easier: ex?.easier ?? null, detail: `Set ${step.set} of ${step.sets} · ${amount}` };
};
