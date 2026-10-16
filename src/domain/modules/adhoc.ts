import { DOMAIN_SHORT } from '../options';
import type { Domain, Intensity, Task } from '../types';

/**
 * A one-off session done from a section (a workout picked from the catalogue, a breathing exercise) rather than from a planned
 * activity. It is a task with an id of its own and no schedule, so logging it uses the same entry as everything else, and there is only
 * ever one record of it. The `adhoc:` prefix is what tells the reducer there is no task state to keep.
 */
export const ADHOC_PREFIX = 'adhoc:';
export const isAdhocId = (id: string): boolean => id.startsWith(ADHOC_PREFIX);

export interface AdhocInput { kind: 'workout' | 'breathing' | 'learning'; id: string; name: string; minutes: number; domain: Domain; intensity: Intensity; difficulty: 1 | 2 | 3 }

export const adhocTask = (a: AdhocInput): Task => ({
  id: `${ADHOC_PREFIX}${a.kind}:${a.id}`, templateId: null, name: a.name, roomId: `life-${a.domain}`, roomKind: 'home', roomName: DOMAIN_SHORT[a.domain], category: DOMAIN_SHORT[a.domain],
  minutes: Math.max(1, a.minutes), difficulty: a.difficulty, frequency: 'once', cadence: { kind: 'once' }, priority: 'MEDIUM', score: 50, impact: 5, reason: 'You chose this yourself.',
  substeps: [], tinySteps: [], tier: 'maintenance', habit: false, quickWin: a.minutes <= 5, zone: DOMAIN_SHORT[a.domain], floor: 0, startDate: null, needs: [], topics: [], domain: a.domain,
  intensity: a.intensity, timeOfDay: 'anytime',
});
