import { describe, expect, it } from 'vitest';
import { emptyAppData } from '../src/domain/appdata';
import type { PlannedActivity } from '../src/domain/modules/types';
import { buildIcs } from '../src/domain/reminders/ics';
import { diffSchedule, dueNow, inQuietHours, localInstant, outgoing, planReminders, pruneSnoozed } from '../src/domain/reminders/plan';
import { createNativePlatform, createWebPlatform, type LocalNotificationsLike, type WebEnv } from '../src/domain/reminders/platform';
import { syncReminders } from '../src/domain/reminders/sync';
import { reducer } from '../src/state/reducer';
import { validateAppData } from '../src/storage/schema';
import { validateReminders } from '../src/storage/remindersSchema';
import { Ctx } from '../src/storage/primitives';
import { TODAY } from './helpers';

const at = (date: string, hhmm: string) => localInstant(date, hhmm);
const NOW = at(TODAY, '09:00');

const act = (id: string, over: Partial<PlannedActivity> = {}): PlannedActivity => ({
  id, module: 'movement', kind: 'fixed', name: `Walk ${id}`, minutes: 30, schedule: { kind: 'once', date: TODAY }, time: '18:30', startDate: TODAY, endDate: null, ref: null,
  intensity: 'gentle', difficulty: 1, note: '', createdAt: `${TODAY}T00:00:00.000Z`, archived: false, ...over,
});
const withPlan = (activities: PlannedActivity[], patch: Partial<ReturnType<typeof emptyAppData>['reminders']['prefs']> = {}) => {
  const d = emptyAppData(TODAY);
  return { ...d, activities, reminders: { ...d.reminders, prefs: { ...d.reminders.prefs, enabled: true, ...patch } } };
};

describe('reminders are worked out from the plan, one per occurrence', () => {
  it('nothing exists while reminders are off, whatever is planned', () => {
    const d = emptyAppData(TODAY);
    expect(planReminders({ ...d, activities: [act('a')] }, NOW)).toEqual([]);
  });
  it('an activity with a time becomes one reminder, ten minutes early by default, with a stable number', () => {
    const d = withPlan([act('a')]);
    const [o] = planReminders(d, NOW);
    expect(o).toMatchObject({ key: `a@${TODAY}`, time: '18:30', title: 'Walk a', suppressed: null });
    expect(new Date(o.at).getTime()).toBe(at(TODAY, '18:20').getTime());
    expect(planReminders(d, NOW)[0].nid).toBe(o.nid);
    expect(Number.isInteger(o.nid) && o.nid > 0 && o.nid < 2 ** 31).toBe(true);
  });
  it('a weekly activity gets one reminder per day it is planned, in order, over the next week only', () => {
    const d = withPlan([act('w', { schedule: { kind: 'weekly', weekdays: [0, 1, 2, 3, 4, 5, 6] }, startDate: TODAY })]);
    const xs = planReminders(d, NOW);
    expect(xs.length).toBeGreaterThanOrEqual(7);
    expect(xs.length).toBeLessThanOrEqual(8);
    expect(xs.map((x) => x.at)).toEqual([...xs.map((x) => x.at)].sort());
    expect(new Set(xs.map((x) => x.nid)).size).toBe(xs.length);
  });
  it('says why something will not be sent: no time, turned off for it, off for the section, quiet hours, already passed', () => {
    const d = withPlan([
      act('none', { time: null, kind: 'flexible' }), act('off', { remind: 'off' }), act('sec', { module: 'meals' }), act('quiet', { time: '22:30' }), act('past', { time: '08:00' }), act('ok'),
    ], { modules: { movement: true, meals: false, learning: true, wellbeing: true } });
    const why = Object.fromEntries(planReminders(d, NOW).map((o) => [o.activityId, o.suppressed]));
    expect(why).toEqual({ none: 'no-time', off: 'off', sec: 'section-off', quiet: 'quiet-hours', past: 'past', ok: null });
  });
  it('an activity with a reminder of its own is reminded even where the section default is off, at its own lead time', () => {
    const d = withPlan([act('mine', { module: 'meals', remind: 30 })], { modules: { movement: true, meals: false, learning: true, wellbeing: true } });
    const [o] = planReminders(d, NOW);
    expect(o.suppressed).toBeNull();
    expect(new Date(o.at).getTime()).toBe(at(TODAY, '18:00').getTime());
  });
  it('done, skipped, archived and deleted activities stop being reminders', () => {
    const base = withPlan([act('a')]);
    expect(outgoing(planReminders(base, NOW))).toHaveLength(1);
    const entry = { id: 'e1', at: `${TODAY}T10:00:00.000Z`, date: TODAY, taskId: 'act:a', name: 'x', roomKind: 'home' as const, roomName: 'x', category: 'x', plannedMinutes: 30, actualMinutes: 30, outcome: 'completed' as const, via: 'checkoff' as const };
    const done = { ...base, sessions: [{ id: 's', date: TODAY, startedAt: entry.at, endedAt: entry.at, entries: [entry] }] };
    expect(planReminders(done, NOW)).toEqual([]);
    const skipped = { ...base, sessions: [{ id: 's', date: TODAY, startedAt: entry.at, endedAt: entry.at, entries: [{ ...entry, outcome: 'skipped' as const }] }] };
    expect(planReminders(skipped, NOW)).toEqual([]);
    expect(planReminders({ ...base, activities: [act('a', { archived: true })] }, NOW)).toEqual([]);
    expect(planReminders({ ...base, activities: [] }, NOW)).toEqual([]);
  });
  it('snoozing moves one occurrence and nothing else; the snoozed time still respects quiet hours', () => {
    const d = withPlan([act('a'), act('b', { time: '19:30' })]);
    const key = `a@${TODAY}`;
    const snoozed = { ...d, reminders: { ...d.reminders, snoozed: { [key]: at(TODAY, '18:40').toISOString() } } };
    const xs = planReminders(snoozed, at(TODAY, '18:25'));
    expect(new Date(xs.find((x) => x.key === key)!.at).getTime()).toBe(at(TODAY, '18:40').getTime());
    expect(new Date(xs.find((x) => x.activityId === 'b')!.at).getTime()).toBe(at(TODAY, '19:20').getTime());
    const late = { ...d, reminders: { ...d.reminders, snoozed: { [key]: at(TODAY, '22:15').toISOString() } } };
    expect(planReminders(late, at(TODAY, '18:25')).find((x) => x.key === key)!.suppressed).toBe('quiet-hours');
  });
  it('quiet hours work across midnight and can be turned off', () => {
    const q = { on: true, from: '22:00', to: '07:00' };
    expect(inQuietHours(23 * 60, q)).toBe(true);
    expect(inQuietHours(3 * 60, q)).toBe(true);
    expect(inQuietHours(7 * 60, q)).toBe(false);
    expect(inQuietHours(12 * 60, q)).toBe(false);
    expect(inQuietHours(23 * 60, { ...q, on: false })).toBe(false);
    expect(inQuietHours(9 * 60, { on: true, from: '09:00', to: '17:00' })).toBe(true);
    expect(inQuietHours(17 * 60, { on: true, from: '09:00', to: '17:00' })).toBe(false);
    expect(inQuietHours(600, { on: true, from: '10:00', to: '10:00' })).toBe(false);
  });
  it('is by wall-clock time: a different default lead moves only the reminder, not the planned time', () => {
    const [a] = planReminders(withPlan([act('a')], { leadMinutes: 0 }), NOW);
    const [b] = planReminders(withPlan([act('a')], { leadMinutes: 60 }), NOW);
    expect(new Date(a.at).getTime()).toBe(at(TODAY, '18:30').getTime());
    expect(new Date(b.at).getTime()).toBe(at(TODAY, '17:30').getTime());
    expect(a.time).toBe('18:30');
    expect(b.time).toBe('18:30');
  });
});

describe('the device is made to match the plan, and running it again does nothing', () => {
  const plan = (d = withPlan([act('a'), act('b', { time: '19:30' })])) => planReminders(d, NOW);
  it('adds what is missing, moves what changed, cancels what no longer belongs', () => {
    const p = plan();
    const first = diffSchedule(outgoing(p), {});
    expect(first.add).toHaveLength(2);
    expect(first.remove).toEqual([]);
    const rec = Object.fromEntries(first.add.map((x) => [x.nid, { key: x.key, at: x.at }]));
    expect(diffSchedule(outgoing(p), rec)).toEqual({ add: [], remove: [] });
    const moved = plan(withPlan([act('a', { time: '17:00' }), act('b', { time: '19:30' })]));
    const d = diffSchedule(outgoing(moved), rec);
    expect(d.add.map((x) => x.activityId)).toEqual(['a']);
    const gone = plan(withPlan([act('b', { time: '19:30' })]));
    expect(diffSchedule(outgoing(gone), rec).remove).toEqual([p.find((x) => x.activityId === 'a')!.nid]);
  });
  it('drops snoozed times that have passed, so the list does not grow', () => {
    const old = new Date(NOW.getTime() - 3 * 24 * 3600 * 1000).toISOString();
    const fresh = new Date(NOW.getTime() + 3600 * 1000).toISOString();
    expect(Object.keys(pruneSnoozed({ [`a@${TODAY}`]: old, [`b@${TODAY}`]: fresh }, NOW))).toEqual([`b@${TODAY}`]);
  });
  it('the sync talks to the platform only when something changed, and does nothing without permission', async () => {
    const calls: string[] = [];
    let perm: 'granted' | 'prompt' | 'denied' = 'granted';
    const platform = { info: { kind: 'native' as const, label: 'x', background: true }, permission: async () => perm, request: async () => perm,
      schedule: async (xs: { nid: number }[]) => { calls.push(`schedule ${xs.map((x) => x.nid).length}`); }, cancel: async (ids: number[]) => { calls.push(`cancel ${ids.length}`); } };
    const p = plan();
    const r1 = await syncReminders(platform, p, {}, true);
    expect(r1).toMatchObject({ scheduled: 2, cancelled: 0 });
    const r2 = await syncReminders(platform, p, r1.record, true);
    expect(r2).toMatchObject({ scheduled: 0, cancelled: 0 });
    expect(calls).toEqual(['schedule 2']);
    const r3 = await syncReminders(platform, [], r2.record, true);
    expect(r3.cancelled).toBe(2);
    perm = 'denied';
    const r4 = await syncReminders(platform, p, r1.record, true);
    expect(r4).toMatchObject({ scheduled: 0, permission: 'denied', record: {} });
    const r5 = await syncReminders(platform, p, {}, false);
    expect(r5.scheduled).toBe(0);
  });
  it('a reminder that moved replaces its old one: the old number is cancelled first', async () => {
    const order: string[] = [];
    const platform = { info: { kind: 'native' as const, label: 'x', background: true }, permission: async () => 'granted' as const, request: async () => 'granted' as const, schedule: async () => { order.push('schedule'); }, cancel: async () => { order.push('cancel'); } };
    const a = plan(withPlan([act('a')]));
    const rec = { [a[0].nid]: { key: a[0].key, at: new Date(NOW.getTime() - 1000).toISOString() } };
    await syncReminders(platform, a, rec, true);
    expect(order).toEqual(['cancel', 'schedule']);
  });
  it('in-app: a reminder that just came due is shown once, and again after a snooze', () => {
    const d = withPlan([act('a', { time: '09:10' })]);
    const now = at(TODAY, '09:05'); // the reminder time (09:00) has passed, the activity has not started
    const p = planReminders(d, now);
    const due = dueNow(p, {}, now);
    expect(due.map((x) => x.key)).toEqual([`a@${TODAY}`]);
    expect(dueNow(p, { [due[0].key]: due[0].at }, now)).toEqual([]);
    const later = at(TODAY, '09:30');
    const snoozed = { ...d, reminders: { ...d.reminders, snoozed: { [due[0].key]: at(TODAY, '09:20').toISOString() } } };
    const p2 = planReminders(snoozed, later);
    expect(dueNow(p2, { [due[0].key]: due[0].at }, later).map((x) => x.key)).toEqual([`a@${TODAY}`]);
    expect(dueNow(planReminders(d, at(TODAY, '14:00')), {}, at(TODAY, '14:00'))).toEqual([]);
  });
});

describe('platforms say honestly what they can do', () => {
  const web = (permission: NotificationPermission, withN = true) => {
    const timers: { ms: number; fn: () => void }[] = [];
    const shown: string[] = [];
    class N { static permission = permission; static async requestPermission() { return N.permission; } constructor(title: string) { shown.push(title); } }
    const env: WebEnv = { Notification: withN ? (N as never) : undefined, setTimeout: (fn, ms) => { timers.push({ ms, fn }); return timers.length; }, clearTimeout: () => undefined, now: () => NOW.getTime() };
    return { platform: createWebPlatform(env), timers, shown };
  };
  it('a browser cannot remind you when it is closed, and says so', async () => {
    const { platform } = web('granted');
    expect(platform.info.background).toBe(false);
    expect(platform.info.label).toMatch(/while CleanFlow is open/);
    expect((await web('default', false).platform.permission())).toBe('unsupported');
    expect(await web('default').platform.permission()).toBe('prompt');
    expect(await web('denied').platform.permission()).toBe('denied');
  });
  it('a browser timer shows the notification when its time comes, only if allowed', async () => {
    const g = web('granted');
    await g.platform.schedule(outgoing(planReminders(withPlan([act('a')]), NOW)));
    expect(g.timers).toHaveLength(1);
    g.timers[0].fn();
    expect(g.shown).toEqual(['Walk a']);
    const d = web('denied');
    await d.platform.schedule(outgoing(planReminders(withPlan([act('a')]), NOW)));
    d.timers[0].fn();
    expect(d.shown).toEqual([]);
  });
  it('the phone app schedules with the operating system, inexactly, with a snooze action and a channel', async () => {
    const calls: { fn: string; arg: any }[] = [];
    const plugin: LocalNotificationsLike = {
      checkPermissions: async () => ({ display: 'prompt' }), requestPermissions: async () => ({ display: 'granted' }),
      schedule: async (o) => { calls.push({ fn: 'schedule', arg: o }); return {}; }, cancel: async (o) => { calls.push({ fn: 'cancel', arg: o }); }, getPending: async () => ({ notifications: [{ id: 5 }] }),
      createChannel: async (c) => { calls.push({ fn: 'channel', arg: c }); }, registerActionTypes: async (o) => { calls.push({ fn: 'actions', arg: o }); },
    };
    const p = createNativePlatform(plugin);
    expect(p.info.background).toBe(true);
    expect(await p.permission()).toBe('prompt');
    expect(await p.request()).toBe('granted');
    await p.schedule(outgoing(planReminders(withPlan([act('a')]), NOW)));
    const sched = calls.find((c) => c.fn === 'schedule')!.arg.notifications[0];
    expect(sched).toMatchObject({ title: 'Walk a', schedule: { allowWhileIdle: false }, extra: { key: `a@${TODAY}` } });
    expect(sched.schedule.at).toBeInstanceOf(Date);
    expect(calls.map((c) => c.fn)).toContain('channel');
    expect(calls.find((c) => c.fn === 'actions')!.arg.types[0].actions.map((a: { id: string }) => a.id)).toEqual(['snooze']);
    await p.cancelAll!();
    expect(calls.at(-1)).toEqual({ fn: 'cancel', arg: { notifications: [{ id: 5 }] } });
  });
});

describe('the calendar file', () => {
  const d = withPlan([act('a', { note: 'Bring water, a hat; and a \\ slash' })]);
  const occ = planReminders({ ...d, reminders: { ...d.reminders, prefs: { ...d.reminders.prefs, quiet: { ...d.reminders.prefs.quiet, on: false } } } }, at(TODAY, '08:00'));
  const ics = buildIcs(occ, { now: at(TODAY, '08:00'), alertMinutes: 10, activities: new Map(d.activities.map((a) => [a.id, a])) });
  it('is a valid calendar with CRLF lines, a stable id, floating local times and the calendar\'s own alert', () => {
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics).not.toMatch(/[^\r]\n/);
    expect(ics).toContain(`UID:a@${TODAY}@cleanflow.local`);
    const compact = TODAY.replace(/-/g, '');
    expect(ics).toContain(`DTSTART:${compact}T183000`);
    expect(ics).toContain(`DTEND:${compact}T190000`);
    expect(ics).toContain('TRIGGER:-PT10M');
    expect(ics).toMatch(/DTSTAMP:\d{8}T\d{6}Z/);
  });
  it('escapes commas, semicolons and backslashes, and folds long lines at 75 bytes', () => {
    expect(ics).toContain('DESCRIPTION:Bring water\\, a hat\\; and a \\\\ slash');
    const long = withPlan([act('l', { name: 'A very long activity name '.repeat(8) })]);
    const o = planReminders(long, at(TODAY, '08:00'));
    const text = buildIcs(o, { now: NOW, alertMinutes: null, activities: new Map(long.activities.map((a) => [a.id, a])) });
    for (const line of text.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(text).not.toContain('VALARM');
    expect(text.replace(/\r\n /g, '')).toContain('SUMMARY:A very long activity name');
  });
  it('skips an activity with no time', () => {
    const n = withPlan([act('n', { time: null, kind: 'flexible' })]);
    expect(buildIcs(planReminders(n, NOW).concat([{ key: `n@${TODAY}`, nid: 1, activityId: 'n', date: TODAY, at: NOW.toISOString(), time: '', title: 'x', body: '', suppressed: 'no-time' }]), { now: NOW, alertMinutes: 5, activities: new Map(n.activities.map((a) => [a.id, a])) })).not.toContain('VEVENT');
  });
});

describe('saved reminder settings are rebuilt, not trusted', () => {
  it('clamps numbers, checks times, and keeps only well-formed keys', () => {
    const v = validateReminders({ prefs: { enabled: 'yes', leadMinutes: 999, snoozeMinutes: 0, quiet: { on: true, from: '25:00', to: '07:30' }, modules: { movement: false, meals: 'x' } },
      snoozed: { [`a@${TODAY}`]: NOW.toISOString(), 'not a key': NOW.toISOString(), [`b@${TODAY}`]: 'garbage' }, shown: { [`c@${TODAY}`]: NOW.toISOString() } }, new Ctx());
    expect(v.prefs).toMatchObject({ enabled: false, leadMinutes: 180, snoozeMinutes: 1, quiet: { on: true, from: '22:00', to: '07:30' }, modules: { movement: false, meals: true } });
    expect(Object.keys(v.snoozed)).toEqual([`a@${TODAY}`]);
    expect(Object.keys(v.shown)).toEqual([`c@${TODAY}`]);
  });
  it('an activity keeps its own reminder choice through saving and loading, and a bad one is dropped', () => {
    const d = withPlan([act('a', { remind: 30 }), act('b', { remind: 'off' }), act('c')]);
    const back = validateAppData(JSON.parse(JSON.stringify(d)))!.data;
    expect(back.activities.map((a) => a.remind)).toEqual([30, 'off', undefined]);
    const bad = JSON.parse(JSON.stringify(d)); bad.activities[0].remind = 'soon'; bad.activities[1].remind = 9999;
    expect(validateAppData(bad)!.data.activities.map((a) => a.remind)).toEqual([undefined, 180, undefined]);
  });
  it('the reminder actions are idempotent and cannot store a bad value', () => {
    let d = emptyAppData(TODAY);
    d = reducer(d, { type: 'REMINDER_PREFS', patch: { enabled: true, leadMinutes: 30 } });
    expect(d.reminders.prefs).toMatchObject({ enabled: true, leadMinutes: 30 });
    expect(reducer(d, { type: 'REMINDER_PREFS', patch: { leadMinutes: 30 } })).toBe(d);
    expect(reducer(d, { type: 'REMINDER_PREFS', patch: { leadMinutes: 5000 } }).reminders.prefs.leadMinutes).toBe(180);
    expect(reducer(d, { type: 'REMINDER_PREFS', patch: { quiet: { from: 'nonsense' } } }).reminders.prefs.quiet.from).toBe('22:00');
    const s = reducer(d, { type: 'REMINDER_SNOOZE', key: `a@${TODAY}`, until: NOW.toISOString() });
    expect(reducer(s, { type: 'REMINDER_SNOOZE', key: `a@${TODAY}`, until: NOW.toISOString() })).toBe(s);
    const sh = reducer(d, { type: 'REMINDER_SHOWN', key: `a@${TODAY}`, at: NOW.toISOString() });
    expect(reducer(sh, { type: 'REMINDER_SHOWN', key: `a@${TODAY}`, at: NOW.toISOString() })).toBe(sh);
  });
  it('tidying drops records more than a day old, keeps recent ones, and does nothing when there is nothing to drop', () => {
    const old = new Date(NOW.getTime() - 3 * 24 * 3600 * 1000).toISOString();
    const fresh = new Date(NOW.getTime() + 3600 * 1000).toISOString();
    let d = emptyAppData(TODAY);
    d = reducer(d, { type: 'REMINDER_SNOOZE', key: `old@${TODAY}`, until: old });
    d = reducer(d, { type: 'REMINDER_SNOOZE', key: `new@${TODAY}`, until: fresh });
    d = reducer(d, { type: 'REMINDER_SHOWN', key: `old@${TODAY}`, at: old });
    const tidy = reducer(d, { type: 'REMINDER_TIDY', now: NOW.toISOString() });
    expect(Object.keys(tidy.reminders.snoozed)).toEqual([`new@${TODAY}`]);
    expect(Object.keys(tidy.reminders.shown)).toEqual([]);
    expect(reducer(tidy, { type: 'REMINDER_TIDY', now: NOW.toISOString() })).toBe(tidy);
  });
});
