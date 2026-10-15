/**
 * Breathing patterns and starter routines. These are relaxation and routine ideas, not treatments, and nothing here claims to improve a
 * condition or sleep. Words are written for this app.
 */
export interface BreathingPattern { id: string; name: string; blurb: string; /** seconds: in, hold, out, hold */ cycle: [number, number, number, number] }

export const BREATHING: BreathingPattern[] = [
  { id: 'slow', name: 'Slow breathing', blurb: 'In through the nose for 4, out slowly for 6.', cycle: [4, 0, 6, 0] },
  { id: 'box', name: 'Box breathing', blurb: 'In 4, hold 4, out 4, hold 4. A steady square.', cycle: [4, 4, 4, 4] },
  { id: 'soft', name: 'Soft and easy', blurb: 'In for 3, out for 3. The gentlest start.', cycle: [3, 0, 3, 0] },
];

export const BREATHING_NOTE = 'A relaxation exercise, not a treatment. Breathe gently and stop if you feel lightheaded or uncomfortable.';

export interface Routine { id: string; name: string; minutes: number; blurb: string; steps: string[]; time: 'morning' | 'evening' | 'anytime' }

export const ROUTINES: Routine[] = [
  { id: 'winddown', name: 'Wind-down', minutes: 15, time: 'evening', blurb: 'A calm way to end the day.', steps: [
    'Dim the lights and put your phone somewhere out of reach.', 'Do a few slow stretches: neck, shoulders and hamstrings.', 'Take five slow breaths.', 'Write down anything on your mind, or the one thing you want to do tomorrow.', 'Get your things ready for the morning.',
  ] },
  { id: 'morning-start', name: 'Gentle morning start', minutes: 10, time: 'morning', blurb: 'An easy start before the day takes over.', steps: [
    'Drink a glass of water.', 'Open a window or step outside for a moment of daylight.', 'Stretch for two minutes.', 'Decide the one thing that matters most today.',
  ] },
  { id: 'reset-5', name: 'Five-minute reset', minutes: 5, time: 'anytime', blurb: 'For a moment when you need to slow down.', steps: [
    'Put down what you are doing and sit comfortably.', 'Take five slow breaths.', 'Roll your shoulders and unclench your jaw.', 'Choose one small next step.',
  ] },
];

export const ROUTINE_BY_ID = new Map(ROUTINES.map((r) => [r.id, r]));

export const MOOD_LABEL = ['', 'Very low', 'Low', 'Okay', 'Good', 'Very good'] as const;
