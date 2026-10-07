import type { AppData, Home, PlanVersion, Preferences } from './types';

/** Short, stable hash (FNV-1a). Not cryptographic: it only has to change when the inputs change. */
const fnv = (s: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
};

/**
 * Identifies "the plan the user was looking at". It covers every input that shapes the generated plan, and nothing that is merely
 * user behaviour (completions, skips), so a change of id always means the *plan* changed, never just that the user did something.
 */
export const planVersionId = (home: Home, prefs: Preferences, resetCount: number): string => {
  const { levelSince: _levelSince, ...rest } = prefs;
  void _levelSince;
  return `p${fnv(JSON.stringify([home, rest, resetCount]))}`;
};

export const planVersionOf = (data: AppData): string => planVersionId(data.home, data.preferences, data.plan.resetCount);

export const snapshotPlanVersion = (data: AppData, at: string): PlanVersion => ({
  id: planVersionOf(data), at, focus: [...data.preferences.focus], lifeLevel: data.preferences.lifeLevel, fitnessLevel: data.preferences.fitnessLevel,
  sessionMinutes: data.preferences.sessionMinutes, daysPerWeek: data.preferences.daysPerWeek,
});
