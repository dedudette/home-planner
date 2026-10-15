import { energyOk } from '../safety';
import type { AppData, EnergyLevel, Intensity, ISODate } from '../types';
import { EXERCISE_BY_ID } from './exercises';
import { STARTER_WORKOUTS, STARTER_WORKOUT_BY_ID } from './workouts';
import type { Exercise, MoveDemand, MoveEquip, MoveLevel, MovementPrefs, MoveType, Workout, WorkoutBlock } from './types';

export const allWorkouts = (d: Pick<AppData, 'movement'>): Workout[] => [...STARTER_WORKOUTS, ...d.movement.custom];
export const workoutById = (d: Pick<AppData, 'movement'>, id: string): Workout | null => STARTER_WORKOUT_BY_ID.get(id) ?? d.movement.custom.find((w) => w.id === id) ?? null;

export const exerciseOf = (b: WorkoutBlock): Exercise | null => (b.exerciseId ? (EXERCISE_BY_ID.get(b.exerciseId) ?? null) : null);
export const blockName = (b: WorkoutBlock): string => exerciseOf(b)?.name ?? b.name ?? 'Exercise';

/** Seconds of effort in one block: timed holds as written, reps at the exercise's own pace (a custom exercise is 3 seconds a rep). */
export const blockWorkSeconds = (b: WorkoutBlock): number => (b.seconds !== undefined ? b.seconds : (b.reps ?? 0) * (exerciseOf(b)?.secPerRep ?? 3)) * b.sets;
export const blockSeconds = (b: WorkoutBlock): number => blockWorkSeconds(b) + b.restSeconds * b.sets;

/** How long a workout takes, worked out from its blocks and rounded up to a whole minute. This is what a plan or a log shows. */
export const workoutMinutes = (w: Workout): number => Math.max(1, Math.ceil(w.blocks.reduce((n, b) => n + blockSeconds(b), 0) / 60));

export const workoutNeeds = (w: Workout): MoveEquip[] => [...new Set(w.blocks.flatMap((b) => exerciseOf(b)?.needs ?? []))];
export const workoutDemands = (w: Workout): MoveDemand[] => [...new Set(w.blocks.flatMap((b) => exerciseOf(b)?.demands ?? []))];
export const workoutImpact = (w: Workout): 'low' | 'high' => (w.blocks.some((b) => exerciseOf(b)?.impact === 'high') ? 'high' : 'low');
const RANK: Record<Intensity, number> = { gentle: 0, moderate: 1, vigorous: 2 };
export const workoutIntensity = (w: Workout): Intensity => w.blocks.reduce<Intensity>((m, b) => { const i = exerciseOf(b)?.intensity ?? 'moderate'; return RANK[i] > RANK[m] ? i : m; }, 'gentle');
export const workoutDifficulty = (w: Workout): 1 | 2 | 3 => (w.level === 'beginner' ? 1 : w.level === 'intermediate' ? 2 : 3);

export interface WorkoutFilter { type?: MoveType; level?: MoveLevel; maxMinutes?: number; lowImpact?: boolean; query?: string; onlyMyEquipment?: boolean }

export interface WorkoutHit { workout: Workout; minutes: number; needs: MoveEquip[]; /** Why it would normally be hidden, when everything is being shown. */ flags: string[] }

const AVOID_LABEL: Record<string, string> = { jumping: 'jumping', kneeling: 'kneeling', floor: 'getting down to the floor', 'wrist-load': 'weight on your wrists', 'standing-balance': 'standing balance' };

/**
 * Workouts that fit this person. A workout is left out when it asks for something they said they would rather not do, needs equipment
 * they did not list (when they listed any), or is not suitable for a day of low energy. `flags` carries the same reasons for the
 * "show everything" view, so nothing is hidden without being able to say why.
 */
export const suggestWorkouts = (list: Workout[], prefs: MovementPrefs, f: WorkoutFilter = {}, energy: EnergyLevel = 'ok', showAll = false): WorkoutHit[] => {
  const q = f.query?.trim().toLowerCase();
  const out: WorkoutHit[] = [];
  for (const w of list) {
    if (f.type && w.type !== f.type) continue;
    if (f.level && w.level !== f.level) continue;
    const minutes = workoutMinutes(w);
    if (f.maxMinutes !== undefined && minutes > f.maxMinutes) continue;
    if (q && !w.name.toLowerCase().includes(q) && !w.blurb.toLowerCase().includes(q) && !w.blocks.some((b) => blockName(b).toLowerCase().includes(q))) continue;
    const needs = workoutNeeds(w);
    const flags: string[] = [];
    const avoided = workoutDemands(w).filter((d) => (prefs.avoid as string[]).includes(d));
    for (const a of avoided) flags.push(`asks for ${AVOID_LABEL[a]}, which you would rather not do`);
    if ((prefs.lowImpactOnly || f.lowImpact) && workoutImpact(w) === 'high') flags.push('is high impact');
    const missing = prefs.equipment.length && (f.onlyMyEquipment ?? true) ? needs.filter((n) => !prefs.equipment.includes(n)) : [];
    if (missing.length) flags.push(`needs ${missing.map((m) => m.replace('-', ' ')).join(', ')}, which you did not list`);
    // The shared safety rule (no vigorous or hard work) is the floor. For what to SUGGEST on a low-energy day the bar is higher: gentle only.
    if (energy === 'low' && (!energyOk({ difficulty: workoutDifficulty(w), intensity: workoutIntensity(w) }, energy) || workoutIntensity(w) !== 'gentle')) flags.push('is more than a low-energy day calls for');
    if (flags.length && !showAll) continue;
    out.push({ workout: w, minutes, needs, flags });
  }
  return out.sort((a, b) => Number(prefs.likes.includes(b.workout.type)) - Number(prefs.likes.includes(a.workout.type)) || a.minutes - b.minutes || a.workout.name.localeCompare(b.workout.name));
};

// ───────────────────────── what actually happened ─────────────────────────

/** Minutes of movement actually logged in a date range: completed log entries in the fitness area, from the one record. */
export const movementSummary = (d: Pick<AppData, 'sessions'>, from: ISODate, to: ISODate): { sessions: number; minutes: number; days: number } => {
  const es = d.sessions.flatMap((s) => s.entries).filter((e) => e.date >= from && e.date <= to && e.domain === 'fitness' && e.outcome === 'completed');
  return { sessions: es.length, minutes: es.reduce((n, e) => n + e.actualMinutes, 0), days: new Set(es.map((e) => e.date)).size };
};

/**
 * An offer, never an action. After a few sessions of the same workout that felt easy, the person may be offered a step up; after
 * discomfort or "hard" they may be offered the easier version. The person decides, and pain only ever leads to the gentler offer.
 */
export type Offer = { kind: 'step-up' | 'easier'; reason: string } | null;
export const offerFor = (d: Pick<AppData, 'movement'>, workoutId: string): Offer => {
  const logs = d.movement.log.filter((l) => l.workoutId === workoutId).slice(-3);
  if (logs.length === 0) return null;
  if (logs.slice(-1)[0].felt === 'pain') return { kind: 'easier', reason: 'Last time you stopped because of pain or discomfort. Nothing is being pushed. The easier version is here if you want it.' };
  if (logs.filter((l) => l.felt === 'hard').length >= 2) return { kind: 'easier', reason: 'The last sessions felt hard. An easier version is here if you want it.' };
  if (logs.length === 3 && logs.every((l) => l.felt === 'easy')) return { kind: 'step-up', reason: 'The last three felt easy. If you would like a little more, you can try a step up. It is entirely up to you.' };
  return null;
};
