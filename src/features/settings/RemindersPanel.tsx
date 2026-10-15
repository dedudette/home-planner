import { useEffect, useMemo, useState } from 'react';
import { formatDay } from '../../domain/dates';
import { ACTIVITY_LABEL } from '../../domain/modules/registry';
import { ACTIVITY_MODULES } from '../../domain/modules/types';
import { buildIcs } from '../../domain/reminders/ics';
import { planReminders } from '../../domain/reminders/plan';
import type { Permission, PlatformInfo } from '../../domain/reminders/platform';
import type { Suppressed } from '../../domain/reminders/types';
import { getPlatform } from '../../state/reminderPlatform';
import type { RemindersAction } from '../../state/remindersReducer';
import { useApp } from '../../state/store';
import { I } from '../../ui/icons';
import { downloadText } from '../../ui/download';
import { Button, Chip } from '../../ui/primitives';

const LEADS = [0, 5, 10, 15, 30, 60];
const SNOOZES = [5, 10, 15, 30];
const WHY: Record<Suppressed, string> = {
  off: 'Reminder turned off for this one', 'no-time': 'No time set, so no reminder', 'quiet-hours': 'Not sent: quiet hours', past: 'Already passed', 'section-off': 'Reminders are off for this section',
};

/**
 * Reminders, said plainly. What it can and cannot do depends on where the app is running, and the screen says which: in a browser a
 * reminder appears only while CleanFlow is open; in the phone app the phone shows it even when the app is closed. "On" never means
 * "working": the line under the switch is worked out from what this device actually allows.
 */
export const RemindersPanel = () => {
  const { data, dispatch, today, toast } = useApp();
  const r = data.reminders.prefs;
  const [info, setInfo] = useState<PlatformInfo | null>(null);
  const [perm, setPerm] = useState<Permission | null>(null);
  useEffect(() => { let live = true; void getPlatform().then(async (p) => { const pm = await p.permission(); if (live) { setInfo(p.info); setPerm(pm); } }); return () => { live = false; }; }, []);
  const set = (patch: Extract<RemindersAction, { type: 'REMINDER_PREFS' }>['patch']) => dispatch({ type: 'REMINDER_PREFS', patch });
  const plan = useMemo(() => planReminders(data, new Date()), [data]);
  const shown = plan.filter((o) => o.suppressed !== 'past');

  const allow = async () => { const p = await getPlatform(); setPerm(await p.request()); };
  const toggle = async (on: boolean) => {
    set({ enabled: on });
    // a browser only shows its permission question in answer to a tap, so ask now, while this tap is still the reason
    if (on) { const p = await getPlatform(); const cur = await p.permission(); if (cur === 'prompt') setPerm(await p.request()); else setPerm(cur); }
  };

  const status = (() => {
    if (!r.enabled) return 'Off. Nothing will remind you.';
    const where = info?.background ? 'Your phone will show reminders even when CleanFlow is closed.' : 'Reminders appear inside CleanFlow while it is open. They cannot reach you when it is closed.';
    if (perm === 'granted') return `On. ${where}${info?.background ? '' : ' Browser notifications are allowed too.'}`;
    if (perm === 'denied') return `Notifications are blocked here, so you will not get them. Change that in your ${info?.kind === 'native' ? 'phone' : 'browser'} settings. ${info?.background ? '' : 'Reminders still appear inside CleanFlow while it is open, and cannot reach you when it is closed.'}`;
    if (perm === 'unsupported') return `This device cannot show notifications. ${info?.background ? '' : 'Reminders still appear inside CleanFlow while it is open, and cannot reach you when it is closed.'}`;
    if (perm === null) return 'Checking what this device allows…';
    return `Turned on, but notifications are not allowed yet. ${info?.background ? 'Nothing will arrive until you allow them.' : 'Reminders appear inside CleanFlow while it is open; allow notifications to get them as browser notifications too.'}`;
  })();

  // the calendar file does not need reminders to be switched on: it is about what is planned, not about notifying
  const exportIcs = () => {
    const upcoming = planReminders({ ...data, reminders: { ...data.reminders, prefs: { ...r, enabled: true, quiet: { ...r.quiet, on: false } } } }, new Date(), 14).filter((o) => o.time);
    const ics = buildIcs(upcoming, { now: new Date(), alertMinutes: r.leadMinutes, activities: new Map(data.activities.map((a) => [a.id, a])) });
    downloadText('cleanflow-plan.ics', ics, 'text/calendar');
    toast('Calendar file downloaded. Open it to add the events to your calendar.');
  };

  return (
    <section className="card stack" aria-labelledby="s-remind" data-testid="reminders">
      <h2 id="s-remind" className="h3">Reminders</h2>
      <label className="row between switch-row"><span><b>Remind me about things I planned</b><br /><span className="small muted">Only activities with a time. Nothing is reminded unless you planned it.</span></span>
        <input type="checkbox" role="switch" aria-label="Remind me about things I planned" checked={r.enabled} onChange={(e) => void toggle(e.target.checked)} style={{ width: 24, height: 24 }} /></label>
      <p className="small" role="status" data-testid="reminder-status">{status}</p>
      {r.enabled && perm === 'prompt' && <div><Button size="sm" icon={I.alarm} onClick={() => void allow()}>Allow notifications</Button></div>}

      {r.enabled && (
        <>
          <div className="field"><span className="label" id="rm-lead">How long before?</span>
            <div className="chips" role="radiogroup" aria-labelledby="rm-lead">{LEADS.map((n) => <Chip small key={n} role="radio" on={r.leadMinutes === n} onClick={() => set({ leadMinutes: n })}>{n === 0 ? 'At the time' : `${n} min`}</Chip>)}</div>
            <span className="small muted">Each activity can have its own, or none, when you plan it.</span></div>
          <div className="field"><span className="label" id="rm-sec">Which sections?</span>
            <div className="chips" role="group" aria-labelledby="rm-sec">{ACTIVITY_MODULES.map((m) => <Chip small key={m} role="checkbox" on={r.modules[m]} onClick={() => set({ modules: { [m]: !r.modules[m] } })}>{ACTIVITY_LABEL[m]}</Chip>)}</div></div>
          <label className="row between switch-row"><span><b>Quiet hours</b><br /><span className="small muted">No reminder is sent in this window. It is skipped, not saved for later.</span></span>
            <input type="checkbox" role="switch" aria-label="Quiet hours" checked={r.quiet.on} onChange={(e) => set({ quiet: { on: e.target.checked } })} style={{ width: 24, height: 24 }} /></label>
          {r.quiet.on && (
            <div className="row wrap" style={{ gap: 12 }}>
              <div className="field"><label htmlFor="rq-from">From</label><input id="rq-from" className="input" type="time" value={r.quiet.from} onChange={(e) => e.target.value && set({ quiet: { from: e.target.value } })} style={{ width: 130 }} /></div>
              <div className="field"><label htmlFor="rq-to">Until</label><input id="rq-to" className="input" type="time" value={r.quiet.to} onChange={(e) => e.target.value && set({ quiet: { to: e.target.value } })} style={{ width: 130 }} /></div>
            </div>
          )}
          <div className="field"><span className="label" id="rm-snz">Snooze for</span>
            <div className="chips" role="radiogroup" aria-labelledby="rm-snz">{SNOOZES.map((n) => <Chip small key={n} role="radio" on={r.snoozeMinutes === n} onClick={() => set({ snoozeMinutes: n })}>{n} min</Chip>)}</div></div>

          <section className="stack" aria-labelledby="rm-next">
            <h3 id="rm-next" className="h3">Coming up</h3>
            {shown.length === 0 ? <p className="small muted">Nothing planned with a time in the next week.</p> : (
              <ul className="stack" style={{ margin: 0, padding: 0 }} aria-label="Upcoming reminders">
                {shown.slice(0, 12).map((o) => (
                  <li key={o.key} className="row between wrap" style={{ listStyle: 'none', gap: 8, opacity: o.suppressed ? 0.75 : 1 }} data-testid="upcoming">
                    <span><b>{o.title}</b> <span className="muted small">· {formatDay(o.date, today)}{o.time ? `, ${o.time}` : ''}</span></span>
                    <span className="small muted">{o.suppressed ? WHY[o.suppressed] : o.time ? `Reminder at ${new Date(o.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}</span>
                  </li>
                ))}
              </ul>
            )}
            {shown.length > 12 && <p className="small muted">And {shown.length - 12} more.</p>}
          </section>
        </>
      )}

      <section className="stack" aria-labelledby="rm-cal">
        <h3 id="rm-cal" className="h3">Add to your calendar</h3>
        <p className="small muted">This makes calendar <b>events</b> for the next two weeks, with your calendar's own alert. They are not notifications from CleanFlow: after you open the file they belong to your calendar, and CleanFlow cannot change or remove them. Open a new file later to update them; most calendars update the same events instead of repeating them.</p>
        <div><Button variant="secondary" icon={I.cal} onClick={exportIcs}>Download a calendar file (.ics)</Button></div>
      </section>

      <details>
        <summary>What about alarms, Apple Reminders and Notes?</summary>
        <div className="stack small" style={{ marginTop: 8 }}>
          <p><b>Notifications</b> are messages from an app. <b>Calendar events</b> live in your calendar. <b>Apple Reminders</b> is a separate to-do app, and <b>alarms</b> are clock alarms that ring even on silent. These are four different things.</p>
          <p>CleanFlow makes notifications and calendar events. It does <b>not</b> set clock alarms or add items to Apple Reminders, and a notification is not an alarm: it will not ring through silent mode. For Notes, use the Share button on a shopping list or recipe and pick Notes from your phone's share sheet.</p>
        </div>
      </details>
    </section>
  );
};
