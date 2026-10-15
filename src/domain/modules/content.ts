import { recipeById } from '../meals/planner';
import type { AppData } from '../types';
import type { ActivityContentResolver } from './activities';

/**
 * What an activity shows from the section it points at. A cooking session shows its recipe's own method; other sections add theirs here
 * as they are built. An activity whose target is gone (a deleted dish) simply shows no extra content and still works.
 */
export const contentFor = (data: Pick<AppData, 'meals'>): ActivityContentResolver => (ref) => {
  if (ref.kind === 'recipe') {
    const r = recipeById(data, ref.id);
    if (!r) return null;
    return { description: `${r.name}: serves ${r.servings}, about ${r.prepMinutes + r.cookMinutes} minutes.`, steps: r.steps, tags: r.tags };
  }
  return null;
};
