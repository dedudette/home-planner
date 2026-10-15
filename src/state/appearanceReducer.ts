import { readAppearance } from '../domain/appearance/apply';
import type { Appearance } from '../domain/appearance/types';
import type { AppData } from '../domain/types';

export type AppearanceAction = { type: 'APPEARANCE_SET'; patch: Partial<Appearance> };

/** Appearance changes are idempotent: a patch that changes nothing returns the same data, so nothing is saved or announced. */
export const appearanceReducer = (d: AppData, a: AppearanceAction): AppData => {
  if (a.type !== 'APPEARANCE_SET') return d;
  const next = readAppearance({ ...d.appearance, ...a.patch });
  return JSON.stringify(next) === JSON.stringify(d.appearance) ? d : { ...d, appearance: next };
};
