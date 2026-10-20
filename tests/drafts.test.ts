import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { forgetAccountOnDevice } from '../src/account/link';
import { DRAFT_SHEET_KINDS, DraftRegistry, LIMITS, MAX_AGE_MS, draftsKey, pageScope, readDrafts, sameState, scopeOfSheet, shapeOk } from '../src/state/drafts';
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
const dish = scopeOfSheet({ kind: 'dishForm' } as { kind: string })!;
const note = pageScope('checkin-note', 'wellbeing', 'A check-in note');
const reg = (fs: Fake, id = 'acc-1', now = () => NOW) => new DraftRegistry(id, fs, now);
const stored = (fs: Fake, id = 'acc-1') => JSON.parse(fs.getItem(draftsKey(id)) ?? 'null');
/** What a form's useDraftState does when its value changed: text counts as a draft, a choice or a row alone does not. */
const typed = (r: DraftRegistry, scope: typeof task, key: string, value: string) => r.capture(scope, key, value, true, true);
const chose = (r: DraftRegistry, scope: typeof task, key: string, value: unknown) => r.capture(scope, key, value, false, true);

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
  it('a sheet carrying a function keeps only what survives JSON', () => {
    const s = scopeOfSheet({ kind: 'taskForm', onDone: () => 1 } as unknown as { kind: string })!;
    expect(JSON.stringify(s.resume)).toBe('{"sheet":{"kind":"taskForm"}}');
  });
  it('lists exactly the kinds it labels', () => { expect([...DRAFT_SHEET_KINDS].sort()).toContain('journal'); expect(DRAFT_SHEET_KINDS.has('confirm')).toBe(false); });
});

describe('typing, choosing, rows, finishing, and nothing written before the person leaves', () => {
  it('holds each form’s state while the planner is open and writes NOTHING', () => {
    const fs = new Fake();
    const r = reg(fs);
    typed(r, task, 'name', 'Water the plants');
    typed(r, task, 'notes', 'the ficus too');
    chose(r, task, 'priority', 'HIGH');
    typed(r, journal, 'text', 'something private');
    expect(r.stateOf(task.id, 'name')).toBe('Water the plants');
    expect(r.stateOf(task.id, 'priority')).toBe('HIGH');
    vi.advanceTimersByTime(60_000);
    expect(fs.writes).toBe(0);
    expect(fs.m.size).toBe(0);
    expect(r.getSnapshot().drafts).toEqual([]);                      // nothing is "kept": it is only memory until the person leaves
    expect(r.getSnapshot().held).toBe(2);                            // but a sign-out would leave two forms' text behind, and says so
  });
  it('a choice or a row on its own is not a draft; typed text makes the form one, with its choices', () => {
    const r = reg(new Fake());
    chose(r, task, 'priority', 'HIGH');
    expect(r.getSnapshot().held).toBe(0);
    r.capture(dish, 'rows', [{ name: '', qty: '', unit: '', optional: false }], false, true);
    expect(r.getSnapshot().held).toBe(0);
    typed(r, task, 'name', 'x');
    expect(r.getSnapshot().held).toBe(1);
    expect(r.stateOf(task.id, 'priority')).toBe('HIGH');             // the choice made earlier is kept with the text it belongs to
  });
  it('a piece that goes back to what the form starts with is forgotten, and a form with no typed text left has no draft', () => {
    const r = reg(new Fake());
    typed(r, task, 'name', 'abc');
    r.capture(task, 'name', '', true, false);                        // back to the starting value
    expect(r.stateOf(task.id, 'name')).toBeUndefined();
    expect(r.getSnapshot().held).toBe(0);
    typed(r, task, 'name', 'x'); chose(r, task, 'priority', 'HIGH');
    r.capture(task, 'name', '', false, true);                        // emptied: still a change, but no text any more
    expect(r.getSnapshot().held).toBe(0);
    expect(r.stateOf(task.id, 'priority')).toBe('HIGH');             // the option stays with the form, ready for the next time text is typed
  });
  it('rows added with a button come back as they were, and what is read is a copy', () => {
    const r = reg(new Fake());
    const rows = [{ name: 'flour', qty: '200', unit: 'g', optional: false }, { name: 'eggs', qty: '2', unit: '', optional: true }, { name: '', qty: '', unit: '', optional: false }, { name: 'salt', qty: '', unit: '', optional: false }];
    r.capture(dish, 'rows', rows, true, true);
    const got = r.stateOf(dish.id, 'rows') as typeof rows;
    expect(got).toEqual(rows);
    got[0].name = 'changed';
    expect((r.stateOf(dish.id, 'rows') as typeof rows)[0].name).toBe('flour');
  });
  it('finishing a form on purpose (save, cancel, close) drops everything it held', () => {
    const r = reg(new Fake());
    typed(r, task, 'name', 'abc'); chose(r, task, 'priority', 'HIGH');
    r.dropSheet({ kind: 'taskForm' });
    expect(r.stateOf(task.id, 'name')).toBeUndefined();
    expect(r.stateOf(task.id, 'priority')).toBeUndefined();
    typed(r, journal, 'text', 'abc');
    r.drop(journal.id);
    expect(r.getSnapshot().held).toBe(0);
  });
  it('leaving a page on purpose ends that page’s form but not the sheets', () => {
    const r = reg(new Fake());
    typed(r, note, 'note', 'a note'); typed(r, task, 'name', 'abc');
    r.dropPagesExcept('wellbeing');
    expect(r.stateOf(note.id, 'note')).toBe('a note');
    r.dropPagesExcept('today');
    expect(r.stateOf(note.id, 'note')).toBeUndefined();
    expect(r.stateOf(task.id, 'name')).toBe('abc');
  });
  it('plain data only: functions, NaN and oversized pieces are not kept, and the number of pieces is capped', () => {
    const r = reg(new Fake());
    r.capture(task, 'a', 'x'.repeat(LIMITS.stringChars + 1), true, true);
    expect(r.stateOf(task.id, 'a')).toBeUndefined();
    r.capture(task, 'b', Number.NaN, false, true);
    r.capture(task, 'c', () => 1, false, true);
    expect(r.stateOf(task.id, 'b')).toBeUndefined();
    expect(r.stateOf(task.id, 'c')).toBeUndefined();
    typed(r, task, 'ok', 'fine');
    for (let i = 0; i < LIMITS.keys + 10; i++) chose(r, task, `k${i}`, i);
    expect(Object.keys((r as unknown as { map: Map<string, { state: object }> }).map.get(task.id)!.state).length).toBeLessThanOrEqual(LIMITS.keys);
  });
});

describe('leaving keeps the text, for that account only', () => {
  it('writes what is typed and unsaved, with its structure, under THIS account’s key; lists it without the text', () => {
    const fs = new Fake();
    const r = reg(fs);
    typed(r, journal, 'text', 'my private words'); typed(r, note, 'note', 'tired');
    r.capture(dish, 'rows', [{ name: 'flour', qty: '', unit: '', optional: false }], true, true);
    chose(r, dish, 'slots', ['dinner']);
    expect(r.interrupt()).toBe(3);
    expect([...fs.m.keys()]).toEqual(['cleanflow:drafts@acc-1']);
    const s = stored(fs);
    expect(s.v).toBe(2);
    expect(s.drafts.map((d: { label: string }) => d.label).sort()).toEqual(['A check-in note', 'A dish', 'A journal entry']);
    const dishDraft = s.drafts.find((d: { label: string }) => d.label === 'A dish');
    expect(dishDraft.state.rows.v[0].name).toBe('flour');
    expect(dishDraft.state.slots).toEqual({ v: ['dinner'], t: false });
    const snap = r.getSnapshot();
    expect(snap.drafts).toHaveLength(3);
    expect(JSON.stringify(snap)).not.toContain('private words');   // what the screens list is kinds and times, never the text
    expect(JSON.stringify(snap)).not.toContain('tired');
    expect(JSON.stringify(snap)).not.toContain('flour');
  });
  it('a form with only choices is not written', () => {
    const fs = new Fake();
    const r = reg(fs); chose(r, task, 'priority', 'HIGH');
    expect(r.interrupt()).toBe(0);
    expect(fs.m.size).toBe(0);
  });
  it('the app going away (sign-out, session ended, account changed) keeps it: interrupt then dispose, as the provider does on unmount', () => {
    const fs = new Fake();
    const r = reg(fs); typed(r, task, 'name', 'unsent'); chose(r, task, 'frequency', 'weekly');
    r.interrupt(); r.dispose();
    r.capture(task, 'name', 'later', true, true);                     // nothing after the account has gone
    vi.advanceTimersByTime(1000);
    const again = reg(fs);
    expect(again.stateOf(task.id, 'name')).toBe('unsent');
    expect(again.stateOf(task.id, 'frequency')).toBe('weekly');
  });
  it('development’s double mount (cleanup, then setup again) leaves a working registry', () => {
    const fs = new Fake();
    const r = reg(fs); r.activate();
    r.interrupt(); r.dispose(); r.activate();
    typed(r, task, 'name', 'still works');
    expect(r.stateOf(task.id, 'name')).toBe('still works');
  });
  it('account deletion and "also delete" discard first, so leaving writes nothing', () => {
    const fs = new Fake();
    const r = reg(fs); typed(r, task, 'name', 'unsent'); r.interrupt();
    r.discardAll();
    r.interrupt(); r.dispose();
    expect(fs.getItem(draftsKey('acc-1'))).toBeNull();
  });
  it('another account never reads it: a registry for another id starts empty and writes only its own key', () => {
    const fs = new Fake();
    const a = reg(fs, 'acc-A');
    typed(a, journal, 'text', 'A’s private words'); a.interrupt();
    const b = reg(fs, 'acc-B');
    expect(b.getSnapshot().drafts).toEqual([]);
    expect(b.stateOf(journal.id, 'text')).toBeUndefined();
    typed(b, task, 'name', 'B’s task'); b.interrupt();
    expect([...fs.m.keys()].sort()).toEqual(['cleanflow:drafts@acc-A', 'cleanflow:drafts@acc-B']);
    expect(fs.m.get('cleanflow:drafts@acc-A')).not.toContain('B’s task');
    expect(fs.m.get('cleanflow:drafts@acc-B')).not.toContain('A’s private words');
    expect(reg(fs, 'acc-A').stateOf(journal.id, 'text')).toBe('A’s private words');   // and A gets its own back
  });
  it('after a reload the same account finds its drafts, and they are kept until finished, discarded or expired', () => {
    const fs = new Fake();
    const r = reg(fs); typed(r, journal, 'text', 'words'); r.interrupt(); r.dispose();
    const again = reg(fs);
    expect(again.stateOf(journal.id, 'text')).toBe('words');
    expect(again.getSnapshot().drafts[0].label).toBe('A journal entry');
    again.dropPagesExcept('today');
    expect(again.getSnapshot().drafts).toHaveLength(1);
  });
  it('typing more in a kept draft updates the stored copy (debounced), and finishing it removes the key', () => {
    const fs = new Fake();
    const r = reg(fs); typed(r, journal, 'text', 'one'); r.interrupt();
    typed(r, journal, 'text', 'one two');
    expect(stored(fs).drafts[0].state.text.v).toBe('one');            // not yet: the write is debounced
    vi.advanceTimersByTime(300);
    expect(stored(fs).drafts[0].state.text.v).toBe('one two');
    r.dropSheet({ kind: 'journal' });
    vi.advanceTimersByTime(300);
    expect(fs.getItem(draftsKey('acc-1'))).toBeNull();
  });
  it('flush writes a pending change at once, and never keeps anything new', () => {
    const fs = new Fake();
    const r = reg(fs); typed(r, journal, 'text', 'one'); r.interrupt(); typed(r, journal, 'text', 'two');
    typed(r, task, 'name', 'never left');
    r.flush();
    expect(stored(fs).drafts).toHaveLength(1);
    expect(stored(fs).drafts[0].state.text.v).toBe('two');
  });
  it('leaving with nothing typed writes nothing and leaves no key', () => {
    const fs = new Fake();
    const r = reg(fs); expect(r.interrupt()).toBe(0);
    expect(fs.m.size).toBe(0);
  });
  it('says so when this device would not keep it, and still holds it in memory', () => {
    const fs = new Fake(); fs.fail = true;
    const r = reg(fs); typed(r, journal, 'text', 'words'); r.interrupt();
    expect(r.getSnapshot().persistFailed).toBe(true);
    expect(r.stateOf(journal.id, 'text')).toBe('words');
    fs.fail = false; typed(r, journal, 'text', 'words again'); vi.advanceTimersByTime(300);
    expect(r.getSnapshot().persistFailed).toBe(false);
  });
});

describe('deleting drafts deliberately', () => {
  it('discard removes one, discard all removes the key', () => {
    const fs = new Fake();
    const r = reg(fs); typed(r, journal, 'text', 'a'); typed(r, task, 'name', 'b'); r.interrupt();
    r.discard(task.id); vi.advanceTimersByTime(300);
    expect(stored(fs).drafts).toHaveLength(1);
    r.discardAll();
    expect(fs.getItem(draftsKey('acc-1'))).toBeNull();
    expect(r.getSnapshot().drafts).toEqual([]);
    vi.advanceTimersByTime(1000);
    expect(fs.getItem(draftsKey('acc-1'))).toBeNull();                // nothing writes it back
  });
  it('account deletion removes the key whatever happens to the plan, and not another account’s', () => {
    const fs = new Fake();
    const r = reg(fs); typed(r, journal, 'text', 'a'); r.interrupt();
    forgetAccountOnDevice('acc-1', false, fs);
    expect(fs.getItem(draftsKey('acc-1'))).toBeNull();
    const other = reg(fs, 'acc-2'); typed(other, task, 'name', 'b'); other.interrupt();
    forgetAccountOnDevice('acc-1', true, fs);
    expect(fs.getItem(draftsKey('acc-2'))).not.toBeNull();
  });
  it('subscribers are told, and the snapshot is the same object until something changes', () => {
    const r = reg(new Fake());
    const seen: number[] = []; const off = r.subscribe(() => seen.push(1));
    const s1 = r.getSnapshot();
    expect(r.getSnapshot()).toBe(s1);
    typed(r, journal, 'text', 'a'); r.interrupt();
    expect(seen.length).toBeGreaterThan(0);
    expect(r.getSnapshot()).not.toBe(s1);
    off();
  });
});

describe('what is read back is checked, never trusted', () => {
  const put = (fs: Fake, drafts: unknown[], id = 'acc-1', v: unknown = 2) => fs.m.set(draftsKey(id), JSON.stringify({ v, drafts }));
  const good = () => ({ scope: journal.id, label: 'A journal entry', resume: journal.resume, state: { text: { v: 'hello', t: true } }, at: new Date(NOW - 1000).toISOString() });
  it('accepts a good record', () => { const fs = new Fake(); put(fs, [good()]); expect(readDrafts(fs, 'acc-1', NOW)).toHaveLength(1); });
  it('ignores damaged JSON, a wrong or older version and a record that is not a list', () => {
    const fs = new Fake(); fs.m.set(draftsKey('acc-1'), '{not json'); expect(readDrafts(fs, 'acc-1', NOW)).toEqual([]);
    put(fs, [good()], 'acc-1', 1); expect(readDrafts(fs, 'acc-1', NOW)).toEqual([]);
    put(fs, [good()], 'acc-1', 3); expect(readDrafts(fs, 'acc-1', NOW)).toEqual([]);
    fs.m.set(draftsKey('acc-1'), JSON.stringify({ v: 2, drafts: 'x' })); expect(readDrafts(fs, 'acc-1', NOW)).toEqual([]);
  });
  it('drops a draft whose description names a different sheet than its id, or a sheet that cannot hold drafts', () => {
    const fs = new Fake();
    put(fs, [{ ...good(), resume: { sheet: { kind: 'taskForm' } } }, { ...good(), scope: 'sheet:{"kind":"confirm"}', resume: { sheet: { kind: 'confirm' } } }, good()]);
    expect(readDrafts(fs, 'acc-1', NOW).map((d) => d.info.id)).toEqual([journal.id]);
  });
  it('drops drafts older than the limit, with bad dates, with no typed text, or with pieces that are not plain data', () => {
    const fs = new Fake();
    put(fs, [
      { ...good(), at: new Date(NOW - MAX_AGE_MS - 1000).toISOString() }, { ...good(), at: 'yesterday' },
      { ...good(), state: { text: { v: 'x', t: false } } },                    // no typed text: not a draft
      { ...good(), state: { text: { v: 'x', t: true }, bad: { v: { a: { b: { c: { d: { e: { f: { g: 1 } } } } } } }, t: false } } },   // too deep
      { ...good(), state: { 'bad key!': { v: 'x', t: true } } },
      { ...good(), state: { text: { t: true } } },
    ]);
    expect(readDrafts(fs, 'acc-1', NOW)).toEqual([]);
  });
  it('page drafts keep only a plain page name as where to resume', () => {
    const fs = new Fake();
    put(fs, [{ scope: note.id, label: 'A check-in note', resume: { route: 'wellbeing' }, state: { note: { v: 'x', t: true } }, at: new Date(NOW).toISOString() }, { scope: 'page:evil', label: 'x', resume: { route: 'javascript:alert(1)' }, state: { a: { v: 'x', t: true } }, at: new Date(NOW).toISOString() }]);
    expect(readDrafts(fs, 'acc-1', NOW).map((d) => d.info.id)).toEqual([note.id]);
  });
  it('applies the size limits to what it reads', () => {
    const fs = new Fake();
    put(fs, Array.from({ length: LIMITS.drafts + 6 }, (_, i) => ({ ...good(), scope: note.id + i, resume: { route: 'wellbeing' }, state: { a: { v: 'x', t: true } } })));
    expect(readDrafts(fs, 'acc-1', NOW).length).toBeLessThanOrEqual(LIMITS.drafts);
    put(fs, [{ ...good(), state: Object.fromEntries(Array.from({ length: 4 }, (_, i) => [`f${i}`, { v: 'x'.repeat(LIMITS.stringChars), t: true }])) }]);
    expect(readDrafts(fs, 'acc-1', NOW)).toEqual([]);                  // over the per-draft limit: dropped, not truncated into something unreal
  });
  it('a storage that throws on read yields no drafts', () => {
    const bad: StorageLike = { getItem() { throw new Error('blocked'); }, setItem() { /* */ }, removeItem() { /* */ } };
    expect(readDrafts(bad, 'acc-1', NOW)).toEqual([]);
    expect(readDrafts(null, 'acc-1', NOW)).toEqual([]);
  });
});

describe('a put-back value must have the shape the form starts with', () => {
  it('same kind of thing', () => {
    expect(shapeOk('', 'text')).toBe(true);
    expect(shapeOk('', 5)).toBe(false);
    expect(shapeOk(10, 15)).toBe(true);
    expect(shapeOk(true, 'yes')).toBe(false);
    expect(shapeOk(null, 'low')).toBe(true);
    expect(shapeOk(null, 3)).toBe(true);
  });
  it('rows keep the fields of the starting row; lists are lists', () => {
    const blank = { name: '', qty: '', unit: '', optional: false };
    expect(shapeOk([blank, blank], [{ ...blank, name: 'a' }, { ...blank }, { ...blank }, { ...blank }])).toBe(true);
    expect(shapeOk([blank], [{ name: 'a' }])).toBe(false);                   // a row missing fields
    expect(shapeOk([blank], [{ ...blank, qty: 5 }])).toBe(false);            // a field of the wrong kind
    expect(shapeOk([blank], 'not a list')).toBe(false);
    expect(shapeOk([], ['dinner'])).toBe(true);                              // a list that starts empty takes any plain items
    expect(shapeOk([1, 3, 5], [2, 4])).toBe(true);
    expect(shapeOk({ a: 1 }, { a: 'x' })).toBe(false);
  });
  it('compares by content', () => { expect(sameState([{ a: 1 }], [{ a: 1 }])).toBe(true); expect(sameState([{ a: 1 }], [{ a: 2 }])).toBe(false); });
});
