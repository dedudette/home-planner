import { addDays } from '../src/domain/dates';
import type { AppData } from '../src/domain/types';
import { reducer } from '../src/state/reducer';
import { day, doIt, mk, open, seeAll, selectedIds, viewAt, withEnergy } from './behaviourHelpers';
import { TODAY } from './helpers';

/**
 * A person who opens the app on the given day offsets and sees everything Today shows. On each day they complete the first
 * `doneEach` selected tasks, explicitly skip the next `skipEach`, and leave the rest alone.
 */
export const lived = (offsets: number[], o: { doneEach?: number; skipEach?: number; focus?: Parameters<typeof mk>[0]; energy?: Partial<Record<number, 'low' | 'ok'>>; minutes?: number } = {}): AppData => {
  let d = mk(o.focus ?? ['home', 'discipline', 'morning'], { sessionMinutes: o.minutes ?? 45 }, -45);
  for (const off of offsets) {
    const date = day(off);
    if (o.energy?.[off]) d = withEnergy(d, o.energy[off]!, date, 6);
    d = open(d, date, 7);
    d = seeAll(d, date, 7);
    const ids = selectedIds(d, date);
    const v = viewAt(d, date);
    ids.slice(0, o.doneEach ?? 0).forEach((id, i) => { d = doIt(d, 'TASK_COMPLETE', v.byId.get(id)!, date, 9, {}, `c-${off}-${i}`); });
    ids.slice(o.doneEach ?? 0, (o.doneEach ?? 0) + (o.skipEach ?? 0)).forEach((id, i) => { d = doIt(d, 'TASK_SKIP', v.byId.get(id)!, date, 10, {}, `s-${off}-${i}`); });
  }
  return d;
};

export const range = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => from + i);

/** A contract-2 record rewritten into the shape the app wrote before display tracking: no contract, no left-out list, no seen. */
export const asLegacy = (d: AppData, date: string): AppData => ({
  ...d,
  exposures: d.exposures.map((e) => {
    if (e.date !== date) return e;
    const { contract, left, ...rest } = e;
    void contract; void left;
    return { ...rest, items: e.items.map((i) => { const { selectedAt, seenAt, ...it } = i; void seenAt; return { ...it, shownAt: selectedAt ?? e.recordedAt }; }) };
  }),
});

export { addDays, reducer, TODAY };
