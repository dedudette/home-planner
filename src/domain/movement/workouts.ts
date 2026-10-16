import type { Workout, WorkoutBlock } from './types';

/** Starter workouts, built from the exercise catalogue. Durations are computed from the blocks, never written by hand. */
const B = (exerciseId: string, sets: number, amount: { reps?: number; seconds?: number }, restSeconds: number): WorkoutBlock => ({ exerciseId, sets, ...amount, restSeconds });
const W = (id: string, name: string, type: Workout['type'], level: Workout['level'], blurb: string, blocks: WorkoutBlock[], easierId?: string): Workout =>
  ({ id, name, type, level, blurb, blocks, ...(easierId ? { easierId } : {}), source: 'starter' });

export const STARTER_WORKOUTS: Workout[] = [
  W('morning-mobility', 'Gentle morning mobility', 'mobility', 'beginner', 'Loosen up your neck, shoulders, hips and ankles before the day starts. Standing or seated.', [
    B('neck-rolls', 1, { reps: 6 }, 5), B('shoulder-rolls', 1, { reps: 8 }, 5), B('arm-circles', 1, { reps: 10 }, 5), B('hip-circles', 1, { reps: 8 }, 5), B('ankle-circles', 1, { reps: 8 }, 5), B('seated-twist', 1, { reps: 6 }, 0),
  ]),
  W('desk-break', 'Desk break stretch', 'stretching', 'beginner', 'Five minutes in your chair for a stiff neck and shoulders.', [
    B('neck-side-stretch', 2, { seconds: 20 }, 5), B('cross-body-stretch', 2, { seconds: 20 }, 5), B('seated-twist', 1, { reps: 6 }, 5), B('hamstring-stretch', 2, { seconds: 20 }, 0),
  ]),
  W('seated-gentle', 'Seated gentle workout', 'gentle', 'beginner', 'A kind, low-effort routine done from a chair. Good for low-energy days.', [
    B('seated-march', 2, { seconds: 45 }, 15), B('seated-leg-ext', 2, { reps: 8 }, 15), B('seated-arm-raise', 2, { reps: 8 }, 15), B('seated-twist', 1, { reps: 6 }, 0),
  ]),
  W('easy-walk-20', '20-minute easy walk', 'walking', 'beginner', 'A steady, comfortable walk. Outside or up and down the hallway.', [B('walk-easy', 1, { seconds: 1200 }, 0)], 'easy-walk-10'),
  W('easy-walk-10', '10-minute easy walk', 'walking', 'beginner', 'A short, easy walk. Plenty counts.', [B('walk-easy', 1, { seconds: 600 }, 0)]),
  W('brisk-intervals', 'Brisk walk with easy breaks', 'walking', 'intermediate', 'Brisk stretches with easy walking in between.', [
    B('walk-easy', 1, { seconds: 300 }, 0), B('walk-brisk', 4, { seconds: 120 }, 0), B('walk-easy', 1, { seconds: 300 }, 0),
  ], 'easy-walk-20'),
  W('bodyweight-basics', 'Bodyweight basics', 'strength', 'beginner', 'Squats, wall push-ups and bridges with plenty of rest.', [
    B('bodyweight-squat', 2, { reps: 8 }, 45), B('wall-pushup', 2, { reps: 8 }, 45), B('glute-bridge', 2, { reps: 10 }, 45), B('heel-raises', 2, { reps: 10 }, 30),
  ], 'chair-wall-strength'),
  W('chair-wall-strength', 'Chair and wall strength', 'strength', 'beginner', 'Strength work that needs no floor: sit-to-stand, wall push-ups and heel raises.', [
    B('sit-to-stand', 2, { reps: 6 }, 45), B('wall-pushup', 2, { reps: 6 }, 45), B('heel-raises', 2, { reps: 8 }, 30), B('seated-arm-raise', 2, { reps: 8 }, 20),
  ], 'seated-gentle'),
  W('full-body-light', 'Full body with light weights', 'strength', 'intermediate', 'A fuller session with light weights or filled water bottles.', [
    B('bodyweight-squat', 3, { reps: 10 }, 45), B('bottle-row', 3, { reps: 10 }, 45), B('incline-pushup', 3, { reps: 8 }, 45), B('reverse-lunge', 2, { reps: 8 }, 45), B('plank-knees', 2, { seconds: 20 }, 30),
  ], 'bodyweight-basics'),
  W('core-glutes-mat', 'Core and glutes on the mat', 'strength', 'beginner', 'Floor work for your middle and hips.', [
    B('glute-bridge', 3, { reps: 10 }, 40), B('bird-dog', 2, { reps: 6 }, 40), B('plank-knees', 2, { seconds: 15 }, 30), B('childs-pose', 1, { seconds: 30 }, 0),
  ], 'chair-wall-strength'),
  W('dance-warmup', 'Easy dance warm-up', 'dance', 'beginner', 'Sway, step and swing to a couple of songs.', [B('dance-sway', 1, { seconds: 240 }, 15), B('step-touch', 1, { seconds: 180 }, 15), B('dance-free', 1, { seconds: 180 }, 0)], 'seated-gentle'),
  W('dance-freestyle-15', '15-minute freestyle dance', 'dance', 'beginner', 'Put on your favourite songs and move however you like.', [B('dance-sway', 1, { seconds: 180 }, 0), B('dance-grapevine', 1, { seconds: 240 }, 20), B('dance-free', 1, { seconds: 480 }, 0)], 'dance-warmup'),
  W('evening-unwind', 'Evening unwind stretch', 'stretching', 'beginner', 'Slow stretches to finish the day.', [
    B('neck-side-stretch', 2, { seconds: 20 }, 5), B('chest-opener', 2, { seconds: 20 }, 5), B('quad-stretch', 2, { seconds: 20 }, 5), B('hamstring-stretch', 2, { seconds: 25 }, 5), B('childs-pose', 1, { seconds: 45 }, 0),
  ], 'desk-break'),
  W('hips-hamstrings', 'Hips and hamstrings', 'stretching', 'beginner', 'Longer holds for tight legs and hips.', [
    B('hip-circles', 1, { reps: 8 }, 10), B('hamstring-stretch', 3, { seconds: 30 }, 10), B('calf-stretch', 2, { seconds: 30 }, 10), B('quad-stretch', 2, { seconds: 30 }, 0),
  ], 'desk-break'),
];

export const STARTER_WORKOUT_BY_ID: Map<string, Workout> = new Map(STARTER_WORKOUTS.map((w) => [w.id, w]));
