import { diffSchedule, outgoing, type ScheduledRecord } from './plan';
import type { Permission, ReminderPlatform } from './platform';
import type { ReminderOccurrence } from './types';

/**
 * Makes the device match the plan. `desired` comes from `planReminders`; `record` is what this device was last told (kept on the device
 * only, because scheduled notifications belong to one device). Nothing is scheduled without permission, and when permission is not
 * there the record is emptied so the next time it is granted everything is set up fresh. Safe to run as often as you like.
 */
export interface SyncResult { permission: Permission; scheduled: number; cancelled: number; record: Record<number, ScheduledRecord> }

/** Only the nearest reminders are handed to the device. Apple's pages do not state a limit on pending local notifications and I recall one of 64, which I could not confirm, so this stays well under it. */
export const MAX_ON_DEVICE = 60;

export const syncReminders = async (platform: ReminderPlatform, plan: ReminderOccurrence[], record: Record<number, ScheduledRecord>, enabled: boolean, limit = MAX_ON_DEVICE): Promise<SyncResult> => {
  const permission = await platform.permission();
  if (!enabled || permission !== 'granted') {
    const stale = Object.keys(record).map(Number);
    if (stale.length) await platform.cancel(stale);
    return { permission, scheduled: 0, cancelled: stale.length, record: {} };
  }
  const { add, remove } = diffSchedule(outgoing(plan).slice(0, limit), record);
  if (remove.length) await platform.cancel(remove);
  // a moved reminder replaces its old one: the same id is cancelled first so the platform never holds two
  const moved = add.filter((x) => x.nid in record).map((x) => x.nid);
  if (moved.length) await platform.cancel(moved);
  if (add.length) await platform.schedule(add);
  const next: Record<number, ScheduledRecord> = { ...record };
  for (const id of remove) delete next[id];
  for (const x of add) next[x.nid] = { key: x.key, at: x.at };
  return { permission, scheduled: add.length, cancelled: remove.length, record: next };
};
