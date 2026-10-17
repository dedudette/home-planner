import { describe, expect, it } from 'vitest';
import { emptyAppData } from '../src/domain/appdata';
import type { AppData } from '../src/domain/types';
import { reducer } from '../src/state/reducer';
import { countData, describePlanCounts, MAX_BACKUP_BYTES, mergeRestore, planUpload, sameData, stableText, stripPrivate } from '../src/storage/backupPlan';
import { validateAppData } from '../src/storage/schema';
import { TODAY } from './helpers';

const rich = (): AppData => {
  let d: AppData = { ...emptyAppData(TODAY), onboardingComplete: true };
  const a = (x: Parameters<typeof reducer>[1]) => { d = reducer(d, x); };
  a({ type: 'JOURNAL_SAVE', entry: { id: 'j1', date: TODAY, at: `${TODAY}T21:00:00.000Z`, title: 'T1', text: 'private words one' } });
  a({ type: 'JOURNAL_SAVE', entry: { id: 'j2', date: TODAY, at: `${TODAY}T22:00:00.000Z`, title: 'T2', text: 'private words two' } });
  a({ type: 'CHECKIN_SAVE', checkin: { id: 'c1', date: TODAY, at: `${TODAY}T20:00:00.000Z`, energy: 'low', mood: 3, note: 'note one' } });
  a({ type: 'CHECKIN_SAVE', checkin: { id: 'c2', date: TODAY, at: `${TODAY}T20:30:00.000Z`, energy: 'ok', mood: 4, note: '' } });
  a({ type: 'HEALTH_PREFS', enabled: true, read: { steps: true } });
  a({ type: 'HEALTH_MERGE', daily: { [TODAY]: { steps: 4321, platform: 'healthkit', at: `${TODAY}T10:00:00.000Z` } }, today: TODAY, at: `${TODAY}T10:00:00.000Z` });
  a({ type: 'WATER_ADD', entry: { id: 'w1', date: TODAY, at: `${TODAY}T09:00:00.000Z`, ml: 300 } });
  return d;
};

describe('what a backup contains', () => {
  it('counts what is there, and keeps the private groups separate from the ordinary plan data', () => {
    const c = countData(rich());
    expect(c).toMatchObject({ journalEntries: 2, checkinNotes: 1, checkins: 2, healthDays: 1, waterEntries: 1, onboarded: true });
    expect(describePlanCounts(c)).toEqual(['1 water entry', '2 check-ins']);
    expect(describePlanCounts(countData(emptyAppData(TODAY)))).toEqual([]);
  });

  it('by default the journal, the text of check-in notes and the health readings are left out; the rest stays', () => {
    const out = stripPrivate(rich(), []);
    expect(out.wellbeing.journal).toEqual([]);
    expect(out.wellbeing.checkins.map((c) => [c.id, c.mood, c.note])).toEqual([['c1', 3, ''], ['c2', 4, '']]);
    expect(out.health.daily).toEqual({});
    expect(out.health.lastSync).toBeNull();
    expect(out.health.prefs.enabled).toBe(true);
    expect(out.water.entries).toHaveLength(1);
  });

  it('each private group is its own choice', () => {
    const j = stripPrivate(rich(), ['journal']);
    expect(j.wellbeing.journal).toHaveLength(2);
    expect(j.wellbeing.checkins[0].note).toBe('note one');
    expect(j.health.daily).toEqual({});
    const h = stripPrivate(rich(), ['health']);
    expect(h.wellbeing.journal).toEqual([]);
    expect(h.wellbeing.checkins[0].note).toBe('');
    expect(Object.keys(h.health.daily)).toEqual([TODAY]);
  });

  it('never changes what it is given', () => {
    const d = rich();
    const before = JSON.stringify(d);
    stripPrivate(d, []);
    planUpload(d, []);
    mergeRestore(stripPrivate(d, []), [], d);
    expect(JSON.stringify(d)).toBe(before);
  });

  it('the upload preview is computed from the exact payload that would be sent', () => {
    const d = rich();
    const none = planUpload(d, []);
    expect(none.includes).toEqual([]);
    expect(none.sent).toMatchObject({ journalEntries: 0, checkinNotes: 0, healthDays: 0 });
    expect(none.withheld).toEqual({ journalEntries: 2, checkinNotes: 1, healthDays: 1 });
    expect(JSON.stringify(none.payload)).not.toContain('private words');
    expect(JSON.stringify(none.payload)).not.toContain('note one');
    expect(JSON.stringify(none.payload)).not.toContain('4321');
    expect(none.bytes).toBe(new TextEncoder().encode(JSON.stringify(none.payload)).length);

    const all = planUpload(d, ['health', 'journal', 'journal']);
    expect(all.includes).toEqual(['journal', 'health']);          // normalised, no repeats
    expect(all.sent).toMatchObject({ journalEntries: 2, checkinNotes: 1, healthDays: 1 });
    expect(all.withheld).toEqual({ journalEntries: 0, checkinNotes: 0, healthDays: 0 });
    expect(all.bytes).toBeGreaterThan(none.bytes);
    expect(JSON.stringify(all.payload)).toContain('private words one');
  });

  it('says when a backup is over the size limit', () => {
    const d = rich();
    d.wellbeing.journal[0].text = 'x'.repeat(MAX_BACKUP_BYTES + 10);
    expect(planUpload(d, ['journal']).tooLarge).toBe(true);
    expect(planUpload(d, []).tooLarge).toBe(false);          // left out, so it does not count
  });
});

describe('restoring never wipes a private part that was not in the backup', () => {
  const cloudWithout = (device: AppData): AppData => stripPrivate(device, []);

  it('keeps this device’s journal, check-in notes and health readings when the backup did not include them', () => {
    const device = rich();
    const { data, kept, replaced } = mergeRestore(cloudWithout(device), [], device);
    expect(data.wellbeing.journal.map((j) => j.id)).toEqual(['j1', 'j2']);
    expect(data.wellbeing.checkins.find((c) => c.id === 'c1')!.note).toBe('note one');
    expect(Object.keys(data.health.daily)).toEqual([TODAY]);
    expect(kept).toEqual({ journalEntries: 2, checkinNotes: 1, healthDays: 1 });
    expect(replaced).toEqual({ journalEntries: 0, healthDays: 0 });
  });

  it('replaces them when the backup does include them', () => {
    const device = rich();
    const cloud = stripPrivate(device, ['journal', 'health']);
    cloud.wellbeing.journal = cloud.wellbeing.journal.slice(0, 1);
    cloud.health.daily = {};
    const { data, kept, replaced } = mergeRestore(cloud, ['journal', 'health'], device);
    expect(data.wellbeing.journal).toHaveLength(1);
    expect(data.health.daily).toEqual({});
    expect(kept).toEqual({ journalEntries: 0, checkinNotes: 0, healthDays: 0 });
    expect(replaced).toEqual({ journalEntries: 2, healthDays: 1 });
  });

  it('takes the plan data from the backup, and a check-in the device does not have simply has no note', () => {
    const device = rich();
    const cloud = cloudWithout(device);
    cloud.water.entries = [];
    cloud.wellbeing.checkins.push({ id: 'c9', date: TODAY, at: `${TODAY}T23:00:00.000Z`, energy: 'high', mood: 5, note: '' });
    const { data } = mergeRestore(cloud, [], device);
    expect(data.water.entries).toEqual([]);
    expect(data.wellbeing.checkins.find((c) => c.id === 'c9')!.note).toBe('');
  });

  it('what it produces is valid app data', () => {
    const device = rich();
    const { data } = mergeRestore(cloudWithout(device), [], device);
    expect(validateAppData(data)).not.toBeNull();
  });
});

describe('same content', () => {
  it('ignores the storage revision counter and key order, and notices a real difference', () => {
    const d = rich();
    expect(sameData(d, { ...d, _rev: 12 })).toBe(true);
    expect(stableText({ b: 1, a: { d: 2, c: 3 } })).toBe(stableText({ a: { c: 3, d: 2 }, b: 1 }));
    const e = rich();
    e.water.entries[0].ml = 301;
    expect(sameData(d, e)).toBe(false);
  });
});
