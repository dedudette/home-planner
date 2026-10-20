import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { forgetAccountOnDevice } from '../src/account/link';
import { DRAFT_SHEET_KINDS, DraftRegistry, LIMITS, MAX_AGE_MS, draftsKey, pageScope, readDrafts, scopeOfSheet } from '../src/state/drafts';
import type { StorageLike } from '../src/storage/repository';

class Fake implements StorageLike {
  m = new Map<string, string>();
  fail = false;
  writes = 0;
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { if (this.fail) throw new DOMException('full', 'QuotaExceededError'); this.writes++; this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
}

const NOW = Date.parse('2026-10-20T10:00:00Z');
const task = scopeOfSheet({ kind: 'taskForm' })!;
const journal = scopeOfSheet({ kind: 'journal' } as { kind: string })!;
const note = pageScope('checkin-note', 'wellbeing', 'A check-in note');
const reg = (fs: Fake, id = 'acc-1', now = () => NOW) => new DraftRegistry(id, fs, now);
const stored = (fs: Fake, id = 'acc-1') => JSON.parse(fs.getItem(draftsKey(id)) ?? 'null');

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('what has a scope', () => {
  it('only sheets that hold typed text and can be reopened from words', () => {
    expect(scopeOfSheet({ kind: 'taskForm' })?.label).toBe('A task');
    expect(scopeOfSheet({ kind: 'journal', editId: 'j1' } as { kind: string })?.resume).toEqual({ sheet: { kind: 'journal', editId: 'j1' } });
    for (const kind of ['confirm', 'task', 'timer', 'timerPick', 'five', 'emergency', 'roughDay', 'workoutSession', 'reschedule', 'assist', 'shopReview', 'recipe', 'workout']) {
      expect(scopeOfSheet({ kind }), kind).toBeNull();
    }
  });
  it('the same form for the same thing has the same id, a different thing a different one', () => {
    const a = scopeOfSheet({ kind: 'journal', editId: 'a' } as { kind: string })!;
    expect(scopeOfSheet({ kind: 'journal', editId: 'a' } as { kind: string })!.id).toBe(a.id);
    expect(scopeOfSheet({ kind: 'journal', editId: 'b' } as { kind: string })!.id).not.toBe(a.id);
    expect(scopeOfSheet({ kind: 'journal' } as { kind: string })!.id).not.toBe(a.id);
  });
  it('a sheet carrying a function or anything that is not plain data has no scope text beyond what survives JSON', () => {
    const s = scopeOfSheet({ kind: 'taskForm', onDone: () => 1 } as unknown as { kind: string })!;
    expect(JSON.stringify(s.resume)).toBe('{"sheet":{"kind":"taskForm"}}');
  });
  it('lists exactly the kinds it labels', () => { expect([...DRAFT_SHEET_KINDS].sort()).toContain('journal'); expect(DRAFT_SHEET_KINDS.has('confirm')).toBe(false); });
});

describe('typing, finishing, and nothing written before the planner closes', () => {
  it('holds typed text per form and writes NOTHING while the planner is open', () => {
    const fs = new Fake();
    const r = reg(fs);
    r.capture(task, '#t-name', 'Water the plants');
    r.capture(task, '#t-notes', 'the ficus too');
    r.capture(journal, '#j-x', 'something private');
    expect(r.fieldsOf(task.id)).toEqual({ '#t-name': 'Water the plants', '#t-notes': 'the ficus too' });
    vi.advanceTimersByTime(60_000);
    expect(fs.writes).toBe(0);
    expect(fs.m.size).toBe(0);
    expect(r.getSnapshot().drafts).toEqual([]);                      // not "kept": it is only memory until the planner closes
  });
  it('a field emptied again is forgotten, and a form with nothing left has no draft', () => {
    const r = reg(new Fake());
    r.capture(task, '#t-name', 'abc'); r.capture(task, '#t-name', '');
    expect(r.fieldsOf(task.id)).toEqual({});
    r.capture(task, '#t-name', 'x'); r.capture(task, '#t-notes', 'y'); r.capture(task, '#t-name', '');
    expect(r.fieldsOf(task.id)).toEqual({ '#t-notes': 'y' });
  });
  it('finishing a form on purpose (save, cancel, close) drops its text', () => {
    const r = reg(new Fake());
    r.capture(task, '#t-name', 'abc');
    r.dropSheet({ kind: 'taskForm' });
    expect(r.fieldsOf(task.id)).toEqual({});
    r.capture(journal, '#j-x', 'abc');
    r.drop(journal.id);
    expect(r.fieldsOf(journal.id)).toEqual({});
  });
  it('leaving a page on purpose ends that page’s form but not the sheets', () => {
    const r = reg(new Fake());
    r.capture(note, '#ck-n', 'a note'); r.capture(task, '#t-name', 'abc');
    r.dropPagesExcept('wellbeing');
    expect(r.fieldsOf(note.id)).toEqual({ '#ck-n': 'a note' });
    r.dropPagesExcept('today');
    expect(r.fieldsOf(note.id)).toEqual({});
    expect(r.fieldsOf(task.id)).toEqual({ '#t-name': 'abc' });
  });
  it('an oversized field is cut, and the number of fields is capped', () => {
    const r = reg(new Fake());
    r.capture(task, '#a', 'x'.repeat(LIMITS.fieldChars + 500));
    expect(r.fieldsOf(task.id)['#a']).toHaveLength(LIMITS.fieldChars);
    for (let i = 0; i < LIMITS.fields + 10; i++) r.capture(task, `#f${i}`, 'v');
    expect(Object.keys(r.fieldsOf(task.id)).length).toBeLessThanOrEqual(LIMITS.fields);
  });
});

describe('the planner closing keeps the text, for that account only', () => {
  it('writes what is typed and unsaved under THIS account’s key and lists it without the text', () => {
    const fs = new Fake();
    const r = reg(fs);
    r.capture(journal, '#j-x', 'my private words'); r.capture(note, '#ck-n', 'tired');
    expect(r.interrupt()).toBe(2);
    expect([...fs.m.keys()]).toEqual(['cleanflow:drafts@acc-1']);
    const s = stored(fs);
    expect(s.v).toBe(1);
    expect(s.drafts.map((d: { label: string }) => d.label).sort()).toEqual(['A check-in note', 'A journal entry']);
    const snap = r.getSnapshot();
    expect(snap.drafts).toHaveLength(2);
    expect(JSON.stringify(snap)).not.toContain('private words');   // what the screens list is kinds and times, never the text
    expect(JSON.stringify(snap)).not.toContain('tired');
  });
  it('another account never reads it: a registry for another id starts empty and writes only its own key', () => {
    const fs = new Fake();
    const a = reg(fs, 'acc-A');
    a.capture(journal, '#j-x', 'A’s private words'); a.interrupt();
    const b = reg(fs, 'acc-B');
    expect(b.getSnapshot().drafts).toEqual([]);
    expect(b.fieldsOf(journal.id)).toEqual({});
    b.capture(task, '#t-name', 'B’s task'); b.interrupt();
    expect([...fs.m.keys()].sort()).toEqual(['cleanflow:drafts@acc-A', 'cleanflow:drafts@acc-B']);
    expect(fs.m.get('cleanflow:drafts@acc-A')).not.toContain('B’s task');
    expect(fs.m.get('cleanflow:drafts@acc-B')).not.toContain('A’s private words');
    expect(reg(fs, 'acc-A').fieldsOf(journal.id)).toEqual({ '#j-x': 'A’s private words' });   // and A gets its own back
  });
  it('after a reload the same account finds its drafts, and they are kept until finished, discarded or expired', () => {
    const fs = new Fake();
    const r = reg(fs); r.capture(journal, '#j-x', 'words'); r.interrupt(); r.dispose();
    const again = reg(fs);
    expect(again.fieldsOf(journal.id)).toEqual({ '#j-x': 'words' });
    expect(again.getSnapshot().drafts[0].label).toBe('A journal entry');
    again.dropPagesExcept('today');                                   // finishing with other pages does not end a kept draft
    expect(again.getSnapshot().drafts).toHaveLength(1);
  });
  it('typing more in a kept draft updates the stored copy (debounced), and finishing it removes the key', () => {
    const fs = new Fake();
    const r = reg(fs); r.capture(journal, '#j-x', 'one'); r.interrupt();
    r.capture(journal, '#j-x', 'one two');
    expect(stored(fs).drafts[0].fields['#j-x']).toBe('one');          // not yet: the write is debounced
    vi.advanceTimersByTime(300);
    expect(stored(fs).drafts[0].fields['#j-x']).toBe('one two');
    r.dropSheet({ kind: 'journal' });
    vi.advanceTimersByTime(300);
    expect(fs.getItem(draftsKey('acc-1'))).toBeNull();
  });
  it('flush writes a pending change at once (page closing)', () => {
    const fs = new Fake();
    const r = reg(fs); r.capture(journal, '#j-x', 'one'); r.interrupt(); r.capture(journal, '#j-x', 'two');
    r.flush();
    expect(stored(fs).drafts[0].fields['#j-x']).toBe('two');
  });
  it('closing with nothing typed writes nothing and leaves no key', () => {
    const fs = new Fake();
    const r = reg(fs); expect(r.interrupt()).toBe(0);
    expect(fs.m.size).toBe(0);
  });
  it('says so when this device would not keep it, and still holds it in memory', () => {
    const fs = new Fake(); fs.fail = true;
    const r = reg(fs); r.capture(journal, '#j-x', 'words'); r.interrupt();
    expect(r.getSnapshot().persistFailed).toBe(true);
    expect(r.fieldsOf(journal.id)).toEqual({ '#j-x': 'words' });
    fs.fail = false; r.capture(journal, '#j-x', 'words again'); vi.advanceTimersByTime(300);
    expect(r.getSnapshot().persistFailed).toBe(false);
  });
});

describe('deleting drafts deliberately', () => {
  it('discard removes one, discard all removes the key', () => {
    const fs = new Fake();
    const r = reg(fs); r.capture(journal, '#j-x', 'a'); r.capture(task, '#t-name', 'b'); r.interrupt();
    r.discard(task.id); vi.advanceTimersByTime(300);
    expect(stored(fs).drafts).toHaveLength(1);
    r.discardAll();
    expect(fs.getItem(draftsKey('acc-1'))).toBeNull();
    expect(r.getSnapshot().drafts).toEqual([]);
    vi.advanceTimersByTime(1000);
    expect(fs.getItem(draftsKey('acc-1'))).toBeNull();                // nothing writes it back
  });
  it('a disposed registry (the account left) writes and reads nothing more', () => {
    const fs = new Fake();
    const r = reg(fs); r.capture(journal, '#j-x', 'a'); r.interrupt(); r.dispose();
    fs.removeItem(draftsKey('acc-1'));
    r.capture(journal, '#j-x', 'b'); r.flush(); vi.advanceTimersByTime(1000);
    expect(fs.m.size).toBe(0);
  });
  it('account deletion removes the key whatever happens to the plan', () => {
    const fs = new Fake();
    const r = reg(fs); r.capture(journal, '#j-x', 'a'); r.interrupt();
    forgetAccountOnDevice('acc-1', false, fs);
    expect(fs.getItem(draftsKey('acc-1'))).toBeNull();
    const other = reg(fs, 'acc-2'); other.capture(task, '#t-name', 'b'); other.interrupt();
    forgetAccountOnDevice('acc-1', true, fs);
    expect(fs.getItem(draftsKey('acc-2'))).not.toBeNull();            // another account's drafts are not touched
  });
  it('subscribers are told, and the snapshot is the same object until something changes', () => {
    const r = reg(new Fake());
    const seen: number[] = []; const off = r.subscribe(() => seen.push(1));
    const s1 = r.getSnapshot();
    expect(r.getSnapshot()).toBe(s1);
    r.capture(journal, '#j-x', 'a'); r.interrupt();
    expect(seen.length).toBeGreaterThan(0);
    expect(r.getSnapshot()).not.toBe(s1);
    off();
  });
});

describe('what is read back is checked, never trusted', () => {
  const put = (fs: Fake, drafts: unknown[], id = 'acc-1', v: unknown = 1) => fs.m.set(draftsKey(id), JSON.stringify({ v, drafts }));
  const good = () => ({ scope: journal.id, label: 'A journal entry', resume: journal.resume, fields: { '#j-x': 'hello' }, at: new Date(NOW - 1000).toISOString() });
  it('accepts a good record', () => { const fs = new Fake(); put(fs, [good()]); expect(readDrafts(fs, 'acc-1', NOW)).toHaveLength(1); });
  it('ignores damaged JSON, a wrong version and a record that is not a list', () => {
    const fs = new Fake(); fs.m.set(draftsKey('acc-1'), '{not json'); expect(readDrafts(fs, 'acc-1', NOW)).toEqual([]);
    put(fs, [good()], 'acc-1', 2); expect(readDrafts(fs, 'acc-1', NOW)).toEqual([]);
    fs.m.set(draftsKey('acc-1'), JSON.stringify({ v: 1, drafts: 'x' })); expect(readDrafts(fs, 'acc-1', NOW)).toEqual([]);
  });
  it('drops a draft whose description names a different sheet than its id, or a sheet that cannot hold drafts', () => {
    const fs = new Fake();
    put(fs, [{ ...good(), resume: { sheet: { kind: 'taskForm' } } }, { ...good(), scope: 'sheet:{"kind":"confirm"}', resume: { sheet: { kind: 'confirm' } } }, good()]);
    expect(readDrafts(fs, 'acc-1', NOW).map((d) => d.info.id)).toEqual([journal.id]);
  });
  it('drops drafts older than the limit, with bad dates, or with no text', () => {
    const fs = new Fake();
    put(fs, [{ ...good(), at: new Date(NOW - MAX_AGE_MS - 1000).toISOString() }, { ...good(), at: 'yesterday' }, { ...good(), fields: { '#j-x': '' } }, { ...good(), fields: { '#j-x': 5 } }]);
    expect(readDrafts(fs, 'acc-1', NOW)).toEqual([]);
  });
  it('page drafts keep only a plain page name as where to resume', () => {
    const fs = new Fake();
    put(fs, [{ scope: note.id, label: 'A check-in note', resume: { route: 'wellbeing' }, fields: { '#ck-n': 'x' }, at: new Date(NOW).toISOString() }, { scope: 'page:evil', label: 'x', resume: { route: 'javascript:alert(1)' }, fields: { a: 'x' }, at: new Date(NOW).toISOString() }]);
    expect(readDrafts(fs, 'acc-1', NOW).map((d) => d.info.id)).toEqual([note.id]);
  });
  it('applies the size limits to what it reads', () => {
    const fs = new Fake();
    put(fs, Array.from({ length: LIMITS.drafts + 6 }, (_, i) => ({ ...good(), scope: note.id + i, resume: { route: 'wellbeing' }, fields: { a: 'x' } })));
    expect(readDrafts(fs, 'acc-1', NOW).length).toBeLessThanOrEqual(LIMITS.drafts);
    put(fs, [{ ...good(), fields: Object.fromEntries(Array.from({ length: 4 }, (_, i) => [`f${i}`, 'x'.repeat(LIMITS.fieldChars)])) }]);
    expect(readDrafts(fs, 'acc-1', NOW)).toEqual([]);                  // over the per-draft limit: dropped, not truncated into something unreal
  });
  it('a storage that throws on read yields no drafts', () => {
    const bad: StorageLike = { getItem() { throw new Error('blocked'); }, setItem() { /* */ }, removeItem() { /* */ } };
    expect(readDrafts(bad, 'acc-1', NOW)).toEqual([]);
    expect(readDrafts(null, 'acc-1', NOW)).toEqual([]);
  });
});
