import type { PlannedActivity } from '../modules/types';
import { clockMinutes, localInstant } from './plan';
import type { ReminderOccurrence } from './types';

/**
 * A calendar file (.ics) for planned activities. This makes calendar EVENTS, not notifications and not alarms: once the file is opened
 * the events belong to the person's calendar app, which can alert on its own, and this app can no longer change or remove them.
 *
 * Times are "floating" local times (no time zone), so an event stays at 18:30 on the wall clock wherever the person is. Each event has
 * a stable id (the occurrence key), so opening the same file again updates events in most calendars instead of duplicating them.
 */
const esc = (s: string): string => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const pad = (n: number) => String(n).padStart(2, '0');
const floating = (d: Date): string => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
const utc = (d: Date): string => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;

/** Lines are folded at 75 octets, continuing with a space, as the format asks. */
const fold = (line: string): string[] => {
  const enc = new TextEncoder();
  const out: string[] = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > (out.length === 0 ? 75 : 74)) { out.push(cur); cur = ''; bytes = 0; }
    cur += ch; bytes += n;
  }
  out.push(cur);
  return out.map((l, i) => (i === 0 ? l : ` ${l}`));
};

export interface IcsOptions { now: Date; /** Minutes before the start for the calendar's own alert; null for none. */ alertMinutes: number | null; activities: Map<string, PlannedActivity> }

export const buildIcs = (occ: ReminderOccurrence[], o: IcsOptions): string => {
  const lines: string[] = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//CleanFlow//Planned activities//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  for (const x of occ) {
    const a = o.activities.get(x.activityId);
    if (!a || !a.time || clockMinutes(a.time) === null) continue;
    const start = localInstant(x.date, a.time);
    const end = new Date(start.getTime() + Math.max(1, a.minutes) * 60_000);
    lines.push('BEGIN:VEVENT', `UID:${x.key}@cleanflow.local`, `DTSTAMP:${utc(o.now)}`, `DTSTART:${floating(start)}`, `DTEND:${floating(end)}`, `SUMMARY:${esc(a.name)}`);
    if (a.note) lines.push(`DESCRIPTION:${esc(a.note)}`);
    if (o.alertMinutes !== null) lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(a.name)}`, `TRIGGER:-PT${Math.max(0, Math.round(o.alertMinutes))}M`, 'END:VALARM');
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.flatMap(fold).join('\r\n') + '\r\n';
};
