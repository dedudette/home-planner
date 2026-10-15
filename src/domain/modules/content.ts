import { recipeById } from '../meals/planner';
import { blockName, workoutById } from '../movement/planner';
import type { AppData } from '../types';
import { ROUTINE_BY_ID } from '../wellbeing/content';
import type { ActivityContentResolver } from './activities';

/**
 * What an activity shows from the section it points at. A cooking session shows its recipe's own method; other sections add theirs here
 * as they are built. An activity whose target is gone (a deleted dish) simply shows no extra content and still works.
 */
export const contentFor = (data: Pick<AppData, 'meals' | 'movement'>): ActivityContentResolver => (ref) => {
  if (ref.kind === 'recipe') {
    const r = recipeById(data, ref.id);
    if (!r) return null;
    return { description: `${r.name}: serves ${r.servings}, about ${r.prepMinutes + r.cookMinutes} minutes.`, steps: r.steps, tags: r.tags };
  }
  if (ref.kind === 'routine') {
    const r = ROUTINE_BY_ID.get(ref.id);
    return r ? { description: r.blurb, steps: r.steps } : null;
  }
  if (ref.kind === 'workout') {
    const w = workoutById(data, ref.id);
    return w ? { description: w.blurb, steps: w.blocks.map((b) => `${blockName(b)}: ${b.sets} × ${b.seconds !== undefined ? `${b.seconds} seconds` : `${b.reps} reps`}${b.restSeconds ? `, rest ${b.restSeconds} seconds` : ''}`) } : null;
  }
  return null;
};
