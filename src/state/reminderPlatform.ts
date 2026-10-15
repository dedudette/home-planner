import { createNativePlatform, createWebPlatform, nonePlatform, type LocalNotificationsLike, type ReminderPlatform } from '../domain/reminders/platform';
import type { ScheduledRecord } from '../domain/reminders/plan';
import type { ReminderOccurrence } from '../domain/reminders/types';

/**
 * Chooses where this device's reminders are delivered, once. In the phone app the operating system holds them (so they can arrive when
 * the app is closed); in a browser the page can only show them while it is open. The plugin is loaded only in the phone app, so the
 * browser version never downloads it.
 */
const isNative = (): boolean => { try { return (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.() === true; } catch { return false; } };

let dueHandler: ((o: ReminderOccurrence) => void) | null = null;
/** The screen that shows an in-app reminder when the browser is the only place one can appear. */
export const setDueHandler = (fn: ((o: ReminderOccurrence) => void) | null): void => { dueHandler = fn; };

/** Hands an occurrence that is due to the on-screen handler, if the runtime has set one. */
export const announce = (o: ReminderOccurrence): void => dueHandler?.(o);

let nativeActionHandler: ((actionId: string, key: string | null) => void) | null = null;
export const setNativeActionHandler = (fn: ((actionId: string, key: string | null) => void) | null): void => { nativeActionHandler = fn; };

const load = async (): Promise<ReminderPlatform> => {
  if (typeof window === 'undefined') return nonePlatform;
  if (isNative()) {
    try {
      const { LocalNotifications } = await import('@capacitor/local-notifications');
      const plugin = LocalNotifications as unknown as LocalNotificationsLike;
      void plugin.addListener?.('localNotificationActionPerformed', (e) => nativeActionHandler?.(e.actionId, e.notification.extra?.key ?? null));
      return createNativePlatform(plugin);
    } catch { return nonePlatform; }
  }
  return createWebPlatform({
    Notification: typeof Notification !== 'undefined' ? (Notification as unknown as NonNullable<Parameters<typeof createWebPlatform>[0]['Notification']>) : undefined,
    setTimeout: (f, ms) => window.setTimeout(f, ms), clearTimeout: (h) => window.clearTimeout(h as number), now: () => Date.now(),
  }, (o) => dueHandler?.(o));
};

let cached: Promise<ReminderPlatform> | null = null;
export const getPlatform = (): Promise<ReminderPlatform> => (cached ??= load());

// What this device was last told. Kept on the device only, because a scheduled notification belongs to one device.
const KEY = 'cleanflow:scheduled';
export const readScheduled = (): Record<number, ScheduledRecord> => { try { const t = window.localStorage.getItem(KEY); return t ? (JSON.parse(t) as Record<number, ScheduledRecord>) : {}; } catch { return {}; } };
export const writeScheduled = (r: Record<number, ScheduledRecord>): void => { try { window.localStorage.setItem(KEY, JSON.stringify(r)); } catch { /* the next sync simply sets things up again */ } };
