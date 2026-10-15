import type { ReminderOccurrence } from './types';

/**
 * Where reminders actually get delivered. The planner decides WHAT should exist; a platform only knows how to put notifications on
 * a device, so the same plan works in a browser, in a phone app, or nowhere at all.
 *
 *   web     a browser tab. A page can show a notification only while it is open: there is no way for a web page to schedule one for later
 *           without a push server, and this app has none. So the browser is honest about that: reminders appear while CleanFlow is open.
 *   native  the phone app (Capacitor). The operating system holds scheduled local notifications, so they can arrive when the app is closed.
 *   none    this device cannot show notifications.
 */
export type Permission = 'granted' | 'denied' | 'prompt' | 'unsupported';

export interface PlatformInfo {
  kind: 'web' | 'native' | 'none';
  label: string;
  /** True only when a reminder can arrive while the app is closed. */
  background: boolean;
}

export interface ReminderPlatform {
  info: PlatformInfo;
  permission(): Promise<Permission>;
  /** Asks the person. A browser only allows this inside a tap, so call it from a click handler. */
  request(): Promise<Permission>;
  schedule(items: ReminderOccurrence[]): Promise<void>;
  cancel(nids: number[]): Promise<void>;
  /** Cancels everything this app scheduled (used when reminders are switched off). */
  cancelAll?(): Promise<void>;
}

// ───────────── web ─────────────
export interface WebEnv {
  Notification?: { permission: NotificationPermission; requestPermission(): Promise<NotificationPermission>; new (title: string, o?: { body?: string; tag?: string }): unknown };
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (h: unknown) => void;
  now: () => number;
}

const MAX_TIMER = 2_000_000_000; // under the 2^31 ms a timer can hold

export const createWebPlatform = (env: WebEnv, onDue?: (o: ReminderOccurrence) => void): ReminderPlatform => {
  const timers = new Map<number, unknown>();
  const N = env.Notification;
  const perm = (): Permission => (!N ? 'unsupported' : N.permission === 'granted' ? 'granted' : N.permission === 'denied' ? 'denied' : 'prompt');
  const clear = (id: number) => { const t = timers.get(id); if (t !== undefined) { env.clearTimeout(t); timers.delete(id); } };
  return {
    info: { kind: N ? 'web' : 'none', label: N ? 'This browser, while CleanFlow is open' : 'Not available in this browser', background: false },
    permission: async () => perm(),
    request: async () => { if (!N) return 'unsupported'; try { await N.requestPermission(); } catch { /* treated as not granted */ } return perm(); },
    schedule: async (items) => {
      for (const x of items) {
        clear(x.nid);
        const wait = Date.parse(x.at) - env.now();
        if (wait < 0 || wait > MAX_TIMER) continue;
        timers.set(x.nid, env.setTimeout(() => {
          timers.delete(x.nid);
          if (N && N.permission === 'granted') { try { new N(x.title, { body: x.body, tag: x.key }); } catch { /* some browsers refuse outside a service worker */ } }
          onDue?.(x);
        }, wait));
      }
    },
    cancel: async (ids) => { ids.forEach(clear); },
    cancelAll: async () => { [...timers.keys()].forEach(clear); },
  };
};

// ───────────── native (Capacitor local notifications) ─────────────
/** The part of @capacitor/local-notifications this app uses, so it can be exercised without a phone. */
export interface LocalNotificationsLike {
  checkPermissions(): Promise<{ display: string }>;
  requestPermissions(): Promise<{ display: string }>;
  schedule(o: { notifications: { id: number; title: string; body: string; schedule: { at: Date; allowWhileIdle?: boolean }; channelId?: string; actionTypeId?: string; extra?: Record<string, string> }[] }): Promise<unknown>;
  cancel(o: { notifications: { id: number }[] }): Promise<void>;
  getPending(): Promise<{ notifications: { id: number }[] }>;
  createChannel?(c: { id: string; name: string; description?: string; importance: 1 | 2 | 3 | 4 | 5; visibility?: -1 | 0 | 1 }): Promise<void>;
  registerActionTypes?(o: { types: { id: string; actions: { id: string; title: string }[] }[] }): Promise<void>;
  addListener?(event: 'localNotificationActionPerformed', fn: (e: { actionId: string; notification: { id: number; extra?: Record<string, string> } }) => void): Promise<{ remove(): Promise<void> }> | { remove(): Promise<void> };
}

export const NATIVE_CHANNEL = 'planned-activities';
export const NATIVE_ACTIONS = 'cleanflow-reminder';

const mapPerm = (d: string): Permission => (d === 'granted' ? 'granted' : d === 'denied' ? 'denied' : 'prompt');

export const createNativePlatform = (plugin: LocalNotificationsLike): ReminderPlatform => {
  let ready: Promise<void> | null = null;
  // Android needs a channel before a notification can show; both calls are optional extras on platforms that lack them.
  const setup = () => (ready ??= (async () => {
    try { await plugin.createChannel?.({ id: NATIVE_CHANNEL, name: 'Planned activities', description: 'Reminders for things you planned', importance: 3, visibility: 1 }); } catch { /* not Android */ }
    try { await plugin.registerActionTypes?.({ types: [{ id: NATIVE_ACTIONS, actions: [{ id: 'snooze', title: 'Snooze' }] }] }); } catch { /* optional */ }
  })());
  return {
    info: { kind: 'native', label: 'This phone, even when CleanFlow is closed', background: true },
    permission: async () => mapPerm((await plugin.checkPermissions()).display),
    request: async () => mapPerm((await plugin.requestPermissions()).display),
    schedule: async (items) => {
      if (!items.length) return;
      await setup();
      // inexact on purpose: precise alarms are for alarm clocks and calendars, and the platform asks that apps avoid them otherwise
      await plugin.schedule({ notifications: items.map((x) => ({ id: x.nid, title: x.title, body: x.body, schedule: { at: new Date(x.at), allowWhileIdle: false }, channelId: NATIVE_CHANNEL, actionTypeId: NATIVE_ACTIONS, extra: { key: x.key } })) });
    },
    cancel: async (ids) => { if (ids.length) await plugin.cancel({ notifications: ids.map((id) => ({ id })) }); },
    cancelAll: async () => { const p = await plugin.getPending(); if (p.notifications.length) await plugin.cancel({ notifications: p.notifications.map((n) => ({ id: n.id })) }); },
  };
};

/** A platform for a device that cannot show notifications at all. */
export const nonePlatform: ReminderPlatform = {
  info: { kind: 'none', label: 'Not available here', background: false },
  permission: async () => 'unsupported', request: async () => 'unsupported', schedule: async () => undefined, cancel: async () => undefined, cancelAll: async () => undefined,
};
