import type { AppData } from '../domain/types';

/**
 * What a cloud backup contains, decided in one place that the app and the server share, so what the person is shown is what the server
 * stores. Pure: no clock, no storage, no network.
 *
 * Two kinds of data are private by default and each has its own choice: the journal (with the text of check-in notes) and the health
 * readings imported from Apple Health or Health Connect. Everything else in the plan is ordinary plan data and is included. A person's
 * own on/off setting for health (`health.prefs`) is a setting, not imported data, and is included.
 */
export type Include = 'journal' | 'health';
export const INCLUDES: readonly Include[] = ['journal', 'health'];
export const MAX_BACKUP_BYTES = 5 * 1024 * 1024;

/** Keeps only what `includes` allows. The server runs this itself; the app runs it before sending so the excluded data never leaves the device. */
export const stripPrivate = (data: AppData, includes: readonly Include[]): AppData => {
  const out: AppData = JSON.parse(JSON.stringify(data));
  if (!includes.includes('journal')) {
    out.wellbeing = { ...out.wellbeing, journal: [], checkins: out.wellbeing.checkins.map((c) => ({ ...c, note: '' })) };
  }
  if (!includes.includes('health')) out.health = { ...out.health, daily: {}, lastSync: null };
  return out;
};

export interface DataCounts {
  actions: number;
  days: number;
  tasks: number;
  plannedMeals: number;
  movementSessions: number;
  waterEntries: number;
  learningSessions: number;
  checkins: number;
  journalEntries: number;
  checkinNotes: number;
  healthDays: number;
  name: string | null;
  onboarded: boolean;
}

export const countData = (d: AppData): DataCounts => ({
  actions: d.sessions.reduce((n, s) => n + s.entries.length, 0),
  days: new Set(d.sessions.map((s) => s.date)).size,
  tasks: d.customTasks.length,
  plannedMeals: d.meals.plan.length,
  movementSessions: d.movement.log.length,
  waterEntries: d.water.entries.length,
  learningSessions: d.interests.sessions.length,
  checkins: d.wellbeing.checkins.length,
  journalEntries: d.wellbeing.journal.length,
  checkinNotes: d.wellbeing.checkins.filter((c) => c.note.trim() !== '').length,
  healthDays: Object.keys(d.health.daily).length,
  name: d.user.name.trim() ? d.user.name.trim() : null,
  onboarded: d.onboardingComplete,
});

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** The ordinary plan data, in words (the journal and health readings are described separately because they are separate choices). */
export const describePlanCounts = (c: DataCounts): string[] => {
  const out: string[] = [];
  if (c.actions > 0) out.push(`${plural(c.actions, 'logged action')} across ${plural(c.days, 'day')}`);
  if (c.tasks > 0) out.push(plural(c.tasks, 'task you added', 'tasks you added'));
  if (c.plannedMeals > 0) out.push(plural(c.plannedMeals, 'planned meal'));
  if (c.movementSessions > 0) out.push(plural(c.movementSessions, 'movement session'));
  if (c.waterEntries > 0) out.push(plural(c.waterEntries, 'water entry', 'water entries'));
  if (c.learningSessions > 0) out.push(plural(c.learningSessions, 'learning session'));
  if (c.checkins > 0) out.push(plural(c.checkins, 'check-in'));
  return out;
};

export interface UploadPlan {
  includes: Include[];
  /** Exactly what would be sent. */
  payload: AppData;
  /** What the payload holds. */
  sent: DataCounts;
  /** What is on this device and stays here because it was not chosen. */
  withheld: { journalEntries: number; checkinNotes: number; healthDays: number };
  bytes: number;
  tooLarge: boolean;
}

const encodedLength = (text: string): number => (typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(text).length : text.length);

export const planUpload = (device: AppData, includes: readonly Include[]): UploadPlan => {
  const chosen = INCLUDES.filter((i) => includes.includes(i));
  const payload = stripPrivate(device, chosen);
  const have = countData(device);
  const sent = countData(payload);
  const bytes = encodedLength(JSON.stringify(payload));
  return {
    includes: chosen,
    payload,
    sent,
    withheld: { journalEntries: have.journalEntries - sent.journalEntries, checkinNotes: have.checkinNotes - sent.checkinNotes, healthDays: have.healthDays - sent.healthDays },
    bytes,
    tooLarge: bytes > MAX_BACKUP_BYTES,
  };
};

/**
 * What a restore puts on the device. The backup's plan data replaces the device's. A private part the backup does not contain (the person
 * did not tick it when they backed up) is NOT erased: the device keeps its own, so restoring can never wipe a journal or health history
 * that was never in the cloud. A part the backup does contain replaces the device's, and the device's copy goes into the restore point
 * the app takes first.
 */
export const mergeRestore = (cloud: AppData, includes: readonly Include[], device: AppData): { data: AppData; kept: { journalEntries: number; checkinNotes: number; healthDays: number }; replaced: { journalEntries: number; healthDays: number } } => {
  const data: AppData = JSON.parse(JSON.stringify(cloud));
  const kept = { journalEntries: 0, checkinNotes: 0, healthDays: 0 };
  const replaced = { journalEntries: 0, healthDays: 0 };
  if (!includes.includes('journal')) {
    data.wellbeing = { ...data.wellbeing, journal: JSON.parse(JSON.stringify(device.wellbeing.journal)) };
    const notes = new Map(device.wellbeing.checkins.map((c) => [c.id, c.note]));
    data.wellbeing.checkins = data.wellbeing.checkins.map((c) => ({ ...c, note: c.note || notes.get(c.id) || '' }));
    kept.journalEntries = data.wellbeing.journal.length;
    kept.checkinNotes = data.wellbeing.checkins.filter((c) => c.note.trim() !== '').length;
  } else replaced.journalEntries = device.wellbeing.journal.length;
  if (!includes.includes('health')) {
    data.health = { ...data.health, daily: JSON.parse(JSON.stringify(device.health.daily)), lastSync: device.health.lastSync };
    kept.healthDays = Object.keys(data.health.daily).length;
  } else replaced.healthDays = Object.keys(device.health.daily).length;
  return { data, kept, replaced };
};

/** Same content? Compared as stable text with the storage revision counter left out, so a copy of something is equal to the original. */
export const stableText = (d: unknown): string => {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v as object).sort().filter((k) => k !== '_rev').map((k) => [k, walk((v as Record<string, unknown>)[k])]));
    return v;
  };
  return JSON.stringify(walk(d));
};
export const sameData = (a: unknown, b: unknown): boolean => stableText(a) === stableText(b);
