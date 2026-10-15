import { uid } from '../appdata';
import { allRecipes, recipeById } from '../meals/planner';
import type { MealEntry } from '../meals/types';
import { workoutById, workoutDifficulty, workoutIntensity, workoutMinutes } from '../movement/planner';
import type { PlannedActivity } from '../modules/types';
import type { Action } from '../../state/reducer';
import type { AppData, ISODate } from '../types';
import type { AssistProposal, ProposalItem } from './types';

/**
 * Turning an approved proposal into ordinary actions. This is the only place an assistant proposal can become a change, and it
 * can only make two kinds: a planned meal and a planned workout, each from the app's own catalogue, using the app's own minutes and
 * intensity (never numbers from the assistant). It checks again that the thing still exists and that the same thing is not already in
 * the plan, so approving twice is harmless. Learning ideas change nothing by themselves: each one opens its own screen.
 */
export const itemKey = (i: ProposalItem): string => `${i.candidateId}|${i.date ?? ''}|${i.slot ?? ''}`;

export interface Applied { actions: Action[]; added: number; skipped: number }

export const proposalActions = (d: AppData, proposal: AssistProposal, chosen: ReadonlySet<string>, today: ISODate): Applied => {
  const actions: Action[] = [];
  let skipped = 0;
  for (const i of proposal.items) {
    if (!chosen.has(itemKey(i))) continue;
    if (proposal.feature === 'meals' && i.date && i.slot) {
      const r = recipeById(d, i.candidateId);
      const already = d.meals.plan.some((m) => m.date === i.date && m.slot === i.slot && (m.ref.kind === 'recipe' || m.ref.kind === 'dish') && m.ref.id === i.candidateId);
      if (!r || already || i.date < today) { skipped++; continue; }
      const entry: MealEntry = {
        id: uid('meal'), date: i.date, slot: i.slot, ref: { kind: r.source === 'personal' ? 'dish' : 'recipe', id: r.id }, name: r.name, servings: Math.max(1, d.meals.prefs.household),
        status: 'planned', statusAt: null, prepActivityId: null, kcal: null, note: '',
      };
      actions.push({ type: 'MEAL_SAVE', entry });
    } else if (proposal.feature === 'movement' && i.date) {
      const w = workoutById(d, i.candidateId);
      const already = d.activities.some((a) => !a.archived && a.module === 'movement' && a.ref?.kind === 'workout' && a.ref.id === i.candidateId && a.schedule.kind === 'once' && a.schedule.date === i.date);
      if (!w || already || i.date < today) { skipped++; continue; }
      const activity: PlannedActivity = {
        id: uid('act'), module: 'movement', kind: 'flexible', name: w.name, minutes: workoutMinutes(w), schedule: { kind: 'once', date: i.date }, time: null, startDate: i.date, endDate: null,
        ref: { kind: 'workout', id: w.id }, intensity: workoutIntensity(w), difficulty: workoutDifficulty(w), note: '', createdAt: new Date().toISOString(), archived: false,
      };
      actions.push({ type: 'ACTIVITY_SAVE', activity, today });
    }
  }
  return { actions, added: actions.length, skipped };
};

/** What approving would add, in words, for the button. */
export const describeChosen = (proposal: AssistProposal, chosen: ReadonlySet<string>): string => {
  const n = proposal.items.filter((i) => chosen.has(itemKey(i))).length;
  const noun = proposal.feature === 'meals' ? 'meal' : 'session';
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
};

/** A name for a candidate the proposal points at, for the review list. Falls back to nothing: the review shows only what exists. */
export const nameOf = (d: AppData, feature: AssistProposal['feature'], id: string): string | null => {
  if (feature === 'meals') return recipeById(d, id)?.name ?? allRecipes(d).find((r) => r.id === id)?.name ?? null;
  if (feature === 'movement') return workoutById(d, id)?.name ?? null;
  return null;
};
