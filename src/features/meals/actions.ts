import { useCallback } from 'react';
import { uid } from '../../domain/appdata';
import { MEAL_SLOTS, type MealEntry, type MealRef, type MealSlot, type MealStatus } from '../../domain/meals/types';
import type { ISODate } from '../../domain/types';
import { useApp } from '../../state/store';

export const SLOT_LABEL: Record<MealSlot, string> = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack' };
export const SLOT_ORDER = MEAL_SLOTS;
export const STATUS_LABEL: Record<MealStatus | 'scheduled' | 'unrecorded', string> = {
  planned: 'Planned', scheduled: 'Planned', prepared: 'Prepared', eaten: 'Eaten', skipped: 'Skipped', unrecorded: 'Not recorded',
};

/** What a person can do with a meal, each with an Undo. Everything goes through the reducer; nothing is computed here. */
export const useMealActions = () => {
  const { dispatch, toast } = useApp();

  const add = useCallback((a: { date: ISODate; slot: MealSlot; ref: MealRef; name: string; servings: number; status?: MealStatus; kcal?: number | null; prepActivityId?: string | null }): MealEntry => {
    const status = a.status ?? 'planned';
    const entry: MealEntry = {
      id: uid('meal'), date: a.date, slot: a.slot, ref: a.ref, name: a.name, servings: a.servings, status, statusAt: status === 'planned' ? null : new Date().toISOString(),
      prepActivityId: a.prepActivityId ?? null, kcal: a.kcal ?? null, note: '',
    };
    dispatch({ type: 'MEAL_SAVE', entry });
    toast(status === 'eaten' ? `Logged: ${a.name}.` : `Planned: ${a.name}.`, { label: 'Undo', run: () => dispatch({ type: 'MEAL_DELETE', id: entry.id }) });
    return entry;
  }, [dispatch, toast]);

  const setStatus = useCallback((e: MealEntry, status: MealStatus) => {
    const prev = { status: e.status, at: e.statusAt };
    dispatch({ type: 'MEAL_STATUS', id: e.id, status, at: status === 'planned' ? null : new Date().toISOString() });
    toast(status === 'eaten' ? 'Logged as eaten.' : status === 'skipped' ? 'Marked as skipped.' : status === 'prepared' ? 'Marked as prepared.' : 'Back to planned.', { label: 'Undo', run: () => dispatch({ type: 'MEAL_STATUS', id: e.id, status: prev.status, at: prev.at }) });
  }, [dispatch, toast]);

  const remove = useCallback((e: MealEntry) => {
    dispatch({ type: 'MEAL_DELETE', id: e.id });
    toast('Removed from your plan.', { label: 'Undo', run: () => dispatch({ type: 'MEAL_SAVE', entry: e }) });
  }, [dispatch, toast]);

  return { add, setStatus, remove };
};
