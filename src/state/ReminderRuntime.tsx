import { useEffect, useRef } from 'react';
import { dueNow, planReminders } from '../domain/reminders/plan';
import { syncReminders } from '../domain/reminders/sync';
import { getPlatform, readScheduled, setDueHandler, setNativeActionHandler, writeScheduled, announce } from './reminderPlatform';
import { useApp } from './store';

/**
 * Keeps this device's reminders in step with the plan, and shows an in-app reminder when the browser is the only place one can appear.
 * It renders nothing. Whenever the plan, completions or reminder settings change (and once a minute) it works out what should exist,
 * compares that with what this device was last told, and sets up or cancels the difference: a reminder for something done, moved,
 * archived or deleted is cancelled by the very same comparison, never by a separate list that could be forgotten.
 */
export const ReminderRuntime = () => {
  const { ready, data, dispatch, toast, today } = useApp();
  const live = useRef(data);
  live.current = data;

  useEffect(() => {
    if (!ready) return;
    const snooze = (key: string) => dispatch({ type: 'REMINDER_SNOOZE', key, until: new Date(Date.now() + live.current.reminders.prefs.snoozeMinutes * 60_000).toISOString() });
    // The same on-screen reminder whether the browser's own timer or the once-a-minute check notices it first; shown once either way.
    setDueHandler((o) => {
      if ((live.current.reminders.shown[o.key] ?? '') >= o.at) return;
      dispatch({ type: 'REMINDER_SHOWN', key: o.key, at: o.at });
      const mins = live.current.reminders.prefs.snoozeMinutes;
      toast(`${o.title}${o.time ? `, planned for ${o.time}` : ''}`, { label: `Snooze ${mins} min`, run: () => snooze(o.key) });
    });
    setNativeActionHandler((actionId, key) => { if (actionId === 'snooze' && key) snooze(key); });
    return () => { setNativeActionHandler(null); setDueHandler(null); };
  }, [ready, dispatch, toast]);

  useEffect(() => {
    if (!ready) return;
    let alive = true;
    const run = async () => {
      const d = live.current;
      const platform = await getPlatform();
      if (!alive) return;
      const now = new Date();
      const plan = planReminders(d, now);
      const res = await syncReminders(platform, plan, readScheduled(), d.reminders.prefs.enabled);
      if (!alive) return;
      writeScheduled(res.record);
      // Only where a reminder cannot reach the person on its own: the browser, while the app is open.
      if (d.reminders.prefs.enabled && !platform.info.background) {
        for (const o of dueNow(plan, d.reminders.shown, now)) announce(o);
      }
    };
    const first = window.setTimeout(() => void run(), 500);
    const every = window.setInterval(() => void run(), 60_000);
    const onShow = () => { if (document.visibilityState === 'visible') void run(); };
    document.addEventListener('visibilitychange', onShow);
    return () => { alive = false; window.clearTimeout(first); window.clearInterval(every); document.removeEventListener('visibilitychange', onShow); };
  }, [ready, data.activities, data.sessions, data.reminders, today, dispatch, toast]);

  return null;
};
