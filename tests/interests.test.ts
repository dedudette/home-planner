import { describe, expect, it } from 'vitest';
import { emptyAppData } from '../src/domain/appdata';
import { CATALOG } from '../src/domain/interests/catalog';
import { discoverInterests, feedbackByCategory } from '../src/domain/interests/discover';
import { bookProgress, interestMinutes, readingInterest, recent } from '../src/domain/interests/stats';
import type { Book, Interest, InterestSession } from '../src/domain/interests/types';
import { adhocTask } from '../src/domain/modules/adhoc';
import { dismissKey, nextTip, TIPS } from '../src/domain/owl/tips';
import { interestFromCatalog } from '../src/features/learning/shared';
import { reducer } from '../src/state/reducer';
import { safeUrl, validateInterests } from '../src/storage/interestsSchema';
import { validateAppData } from '../src/storage/schema';
import { TODAY } from './helpers';

const interest = (id: string, catalogId: string | null, category: Interest['category'] = 'music', status: Interest['status'] = 'active'): Interest => ({ id, name: id, catalogId, category, status, goal: '', weeklyMinutes: null, note: '', createdAt: '2026-10-01T09:00:00.000Z' });
const session = (id: string, interestId: string, entryId: string, extra: Partial<InterestSession> = {}): InterestSession => ({ id, interestId, entryId, date: TODAY, at: `${TODAY}T10:00:00.000Z`, bookId: null, starterId: null, note: '', feedback: null, resource: '', ...extra });
const book = (id: string, extra: Partial<Book> = {}): Book => ({ id, title: `Title ${id}`, author: '', status: 'want', pagesTotal: null, pagesRead: null, addedAt: '2026-10-01T09:00:00.000Z', finishedAt: null, note: '', ...extra });
const ctx = () => { const c = { dropped: 0, notes: [] as string[], note(s: string) { this.notes.push(s); } }; return c as never; };

describe('the built-in catalogue names nothing it cannot vouch for', () => {
  const text = JSON.stringify(CATALOG);
  it('has no web addresses, ISBNs, courses, channels or named authors', () => {
    expect(text).not.toMatch(/https?:|www\.|\.com|\.org|isbn|youtube|duolingo|coursera|udemy|spotify|goodreads/i);
    expect(text).not.toMatch(/\bby [A-Z][a-z]+ [A-Z][a-z]+/);
  });
  it('gives every entry a first try that can actually be started: steps, minutes, and things it needs listed', () => {
    for (const c of CATALOG) {
      expect(c.starters.length, c.id).toBeGreaterThan(0);
      for (const s of c.starters) { expect(s.steps.length, `${c.id}/${s.id}`).toBeGreaterThanOrEqual(2); expect(s.minutes).toBeGreaterThanOrEqual(c.minutes[0] - 5); expect(Array.isArray(s.needs)).toBe(true); }
    }
    expect(new Set(CATALOG.map((c) => c.id)).size).toBe(CATALOG.length);
  });
  it('covers what the person asked for: reading, singing, an instrument, dance, drawing, painting, sewing, crafts and languages', () => {
    const ids = CATALOG.map((c) => c.id).join(' ');
    for (const w of ['reading', 'singing', 'instrument', 'dance', 'drawing', 'painting', 'sewing', 'origami', 'language']) expect(ids).toContain(w);
  });
  it('holds no prices and makes no health, personality or "you are the kind of person" claims', () => {
    expect(text).not.toMatch(/[$£€]\s?\d|\bcosts? \d|price/i);
    expect(text).not.toMatch(/introvert|extrovert|personality|your type|burn calories|stress-relief|cure|treat(s|ment)/i);
  });
});

describe('discover: a plain filter, with its reasons', () => {
  const d0 = emptyAppData(TODAY);
  const all = { minutes: 60, budget: 'some', setting: 'either', social: 'either' } as const;
  it('respects time, budget, indoor/outdoor and company', () => {
    const free = discoverInterests(d0, { ...all, budget: 'free' });
    expect(free.every((s) => s.interest.budget === 'free')).toBe(true);
    expect(free.length).toBeGreaterThan(0);
    const some = discoverInterests(d0, all);
    expect(some.length).toBeGreaterThan(free.length);
    const outdoor = discoverInterests(d0, { ...all, setting: 'outdoor' });
    expect(outdoor.every((s) => s.interest.setting !== 'indoor')).toBe(true);
    const social = discoverInterests(d0, { ...all, social: 'social' });
    expect(social.every((s) => s.interest.social !== 'solo')).toBe(true);
    const short = discoverInterests(d0, { ...all, minutes: 5 });
    expect(short.every((s) => s.interest.minutes[0] <= 5)).toBe(true);
  });
  it('every suggestion says why it is shown, in words', () => {
    for (const s of discoverInterests(d0, all)) { expect(s.reasons.length).toBeGreaterThanOrEqual(3); expect(s.reasons[0]).toMatch(/minutes/); }
  });
  it('never suggests what is already in the list, and never what was marked "not for me"', () => {
    const d = { ...d0, interests: { ...d0.interests, items: [interest('i1', 'singing'), interest('i2', 'dance', 'dance', 'not-for-me')] } };
    const ids = discoverInterests(d, all).map((s) => s.interest.id);
    expect(ids).not.toContain('singing');
    expect(ids).not.toContain('dance');
  });
  it('an "enjoyed it" in a category lifts that category a little, and says exactly why; nothing is claimed about the person', () => {
    const base = { ...d0, interests: { ...d0.interests, items: [interest('i1', 'singing', 'music')], sessions: [session('s1', 'i1', 'e1', { feedback: 'enjoyed' })] } };
    const res = discoverInterests(base, all);
    const music = res.filter((s) => s.interest.category === 'music');
    expect(music.length).toBeGreaterThan(0);
    expect(res.slice(0, music.length).map((s) => s.interest.category)).toEqual(music.map(() => 'music'));
    for (const s of music) expect(s.boostedBy).toMatch(/simple rule, not a guess about you/);
    expect(res.filter((s) => s.interest.category !== 'music').every((s) => s.boostedBy === null)).toBe(true);
    expect(feedbackByCategory(base)).toEqual({ music: { enjoyed: 1, notForMe: 0 } });
  });
  it('"not for me" in a category does not lift it', () => {
    const d = { ...d0, interests: { ...d0.interests, items: [interest('i1', 'singing', 'music')], sessions: [session('s1', 'i1', 'e1', { feedback: 'not-for-me' }), session('s2', 'i1', 'e2', { feedback: 'enjoyed' }), session('s3', 'i1', 'e3', { feedback: 'not-for-me' })] } };
    expect(discoverInterests(d, all).every((s) => s.boostedBy === null)).toBe(true);
  });
});

describe('the interests reducer', () => {
  const base = emptyAppData(TODAY);
  it('saves an interest, changes its status, and deleting it keeps the sessions as history', () => {
    let d = reducer(base, { type: 'INTEREST_SAVE', interest: interest('i1', 'singing') });
    d = reducer(d, { type: 'SESSION_ADD', session: session('s1', 'i1', 'e1') });
    d = reducer(d, { type: 'RESOURCE_SAVE', resource: { id: 'r1', interestId: 'i1', title: 'My song book', url: 'https://example.org/x', note: '' } });
    d = reducer(d, { type: 'INTEREST_STATUS', id: 'i1', status: 'paused' });
    expect(d.interests.items[0].status).toBe('paused');
    const same = reducer(d, { type: 'INTEREST_STATUS', id: 'i1', status: 'paused' });
    expect(same).toBe(d);
    d = reducer(d, { type: 'INTEREST_DELETE', id: 'i1' });
    expect(d.interests.items).toHaveLength(0);
    expect(d.interests.resources).toHaveLength(0);
    expect(d.interests.sessions).toHaveLength(1);
  });
  it('a session is added once, however many times the action is replayed, and removed cleanly', () => {
    let d = reducer(base, { type: 'SESSION_ADD', session: session('s1', 'i1', 'e1') });
    d = reducer(d, { type: 'SESSION_ADD', session: session('s1', 'i1', 'e1') });
    d = reducer(d, { type: 'SESSION_ADD', session: session('s2', 'i1', 'e1') });
    expect(d.interests.sessions).toHaveLength(1);
    expect(reducer(d, { type: 'SESSION_DELETE', id: 'zzz' })).toBe(d);
    expect(reducer(d, { type: 'SESSION_DELETE', id: 's1' }).interests.sessions).toHaveLength(0);
  });
  it('books: progress is clamped to the total, finishing sets the end, and the want/reading/finished moves are reversible', () => {
    let d = reducer(base, { type: 'BOOK_SAVE', book: book('b1', { pagesTotal: 200 }) });
    d = reducer(d, { type: 'BOOK_PROGRESS', id: 'b1', pagesRead: 450 });
    expect(d.interests.books[0].pagesRead).toBe(200);
    d = reducer(d, { type: 'BOOK_PROGRESS', id: 'b1', pagesRead: 40 });
    d = reducer(d, { type: 'BOOK_STATUS', id: 'b1', status: 'finished', at: '2026-10-05T10:00:00.000Z' });
    expect(d.interests.books[0]).toMatchObject({ status: 'finished', finishedAt: '2026-10-05T10:00:00.000Z', pagesRead: 200 });
    d = reducer(d, { type: 'BOOK_STATUS', id: 'b1', status: 'reading', at: '2026-10-06T10:00:00.000Z' });
    expect(d.interests.books[0].finishedAt).toBeNull();
    expect(reducer(d, { type: 'BOOK_PROGRESS', id: 'nope', pagesRead: 5 })).toBe(d);
  });
  it('deleting a book keeps its sessions but unlinks them from it', () => {
    let d = reducer(base, { type: 'BOOK_SAVE', book: book('b1') });
    d = reducer(d, { type: 'SESSION_ADD', session: session('s1', 'i1', 'e1', { bookId: 'b1' }) });
    d = reducer(d, { type: 'BOOK_DELETE', id: 'b1' });
    expect(d.interests.sessions[0].bookId).toBeNull();
  });
  it('a link that is not a plain web address is never kept', () => {
    const d = reducer(base, { type: 'RESOURCE_SAVE', resource: { id: 'r1', interestId: 'i1', title: 'x', url: 'javascript:alert(1)', note: '' } });
    expect(d.interests.resources[0].url).toBeNull();
  });
  it('remembers the last "help me find something" answers', () => {
    const d = reducer(base, { type: 'DISCOVER_SET', answers: { minutes: 30, budget: 'low', setting: 'indoor', social: 'solo' } });
    expect(d.interests.discover).toEqual({ minutes: 30, budget: 'low', setting: 'indoor', social: 'solo' });
  });
});

describe('logging a session records minutes once', () => {
  const task = adhocTask({ kind: 'learning', id: 'i1', name: 'Singing', minutes: 15, domain: 'learning', intensity: 'gentle', difficulty: 1 });
  it('an ad hoc learning session has no schedule and no stored task state', () => {
    expect(task.id).toBe('adhoc:learning:i1');
    let d = emptyAppData(TODAY);
    d = reducer(d, { type: 'TASK_COMPLETE', task, stamp: { today: TODAY, now: `${TODAY}T10:00:00.000Z`, hour: 10, tzOffsetMin: 0 } as never, minutes: 15, via: 'timer', entryId: 'e1', surface: 'learning' });
    expect(Object.keys(d.taskStates)).toHaveLength(0);
    expect(d.sessions.flatMap((s) => s.entries)).toHaveLength(1);
  });
  it('interest minutes come from the log entries of its sessions, and a planned activity that points at it, never twice', () => {
    let d = emptyAppData(TODAY);
    d = { ...d, interests: { ...d.interests, items: [interest('i1', 'singing')], sessions: [session('s1', 'i1', 'e1')] }, activities: [{ id: 'a1', module: 'learning', kind: 'flexible', name: 'Sing', minutes: 10, schedule: { kind: 'once', date: TODAY }, time: null, startDate: TODAY, endDate: null, ref: { kind: 'interest', id: 'i1' }, intensity: 'gentle', difficulty: 1, note: '', createdAt: '2026-10-01T00:00:00.000Z', archived: false }] };
    const entry = (id: string, taskId: string, minutes: number) => ({ id, at: `${TODAY}T10:00:00.000Z`, date: TODAY, taskId, name: 'x', roomKind: 'home' as const, roomName: 'x', category: 'x', plannedMinutes: minutes, actualMinutes: minutes, outcome: 'completed' as const, via: 'timer' as const });
    d = { ...d, sessions: [{ id: 'day', date: TODAY, entries: [entry('e1', 'adhoc:learning:i1', 20), entry('e2', 'act:a1', 10), entry('e3', 'task:other', 99)] } as never] };
    expect(interestMinutes(d, 'i1', TODAY, TODAY)).toEqual({ minutes: 30, sessions: 2, days: 1 });
    // the same entry linked through a session AND through the plan is still counted once
    d = { ...d, interests: { ...d.interests, sessions: [session('s1', 'i1', 'e2')] } };
    expect(interestMinutes(d, 'i1', TODAY, TODAY).minutes).toBe(10);
    expect(recent(d, 'i1', TODAY).minutes).toBe(10);
    expect(interestMinutes(d, 'someone-else', TODAY, TODAY).minutes).toBe(0);
  });
});

describe('reading', () => {
  it('progress is a percentage only when both page numbers are known', () => {
    expect(bookProgress(book('b', { pagesTotal: 200, pagesRead: 50 }))).toBe(25);
    expect(bookProgress(book('b', { pagesTotal: 200, pagesRead: null }))).toBeNull();
    expect(bookProgress(book('b', { pagesTotal: null, pagesRead: 50 }))).toBeNull();
    expect(bookProgress(book('b', { pagesTotal: 100, pagesRead: 300 }))).toBe(100);
  });
  it('finds the reading interest unless it was set aside', () => {
    const c = CATALOG.find((x) => x.id === 'reading')!;
    const d = { ...emptyAppData(TODAY), interests: { ...emptyAppData(TODAY).interests, items: [interestFromCatalog(c, 'active')] } };
    expect(readingInterest(d)?.catalogId).toBe('reading');
    expect(readingInterest({ ...d, interests: { ...d.interests, items: [{ ...d.interests.items[0], status: 'not-for-me' }] } })).toBeUndefined();
  });
});

describe('saved learning data is rebuilt, never trusted', () => {
  it('only plain web addresses survive', () => {
    expect(safeUrl('https://example.org/a b')).toBe('https://example.org/a%20b');
    expect(safeUrl('http://example.org')).toBe('http://example.org/');
    for (const bad of ['javascript:alert(1)', 'data:text/html,hi', 'file:///etc/passwd', 'ftp://x.org', '//x.org', 'example.org', '', '   ', 5, null, undefined, `https://x.org/${'a'.repeat(600)}`]) expect(safeUrl(bad), String(bad)).toBeNull();
  });
  it('drops junk records, repairs bad fields, keeps unknown fields out and clamps pages', () => {
    const v = validateInterests({
      items: [{ id: 'i1', name: ' Singing ', category: 'nonsense', status: 'weird', extra: 'x', weeklyMinutes: 99999 }, { id: 'i1', name: 'dup' }, { name: 'no id' }, null, 5],
      books: [{ id: 'b1', title: 'T', pagesTotal: 100, pagesRead: 500, status: 'finished', finishedAt: 'garbage' }, { id: 'b2', title: '' }],
      sessions: [{ id: 's1', interestId: 'i1', entryId: 'e1', date: '2026-10-01', at: '2026-10-01T10:00:00.000Z', feedback: 'adored', note: 5 }, { id: 's2' }],
      resources: [{ id: 'r1', interestId: 'i1', title: 'x', url: 'javascript:alert(1)' }],
      discover: { minutes: 99999, budget: 'x', setting: 'x', social: 'solo' },
    }, ctx());
    expect(v.items).toHaveLength(1);
    expect(v.items[0]).toMatchObject({ name: 'Singing', category: 'making', status: 'exploring', weeklyMinutes: 2000 });
    expect('extra' in v.items[0]).toBe(false);
    expect(v.books).toHaveLength(1);
    expect(v.books[0]).toMatchObject({ pagesRead: 100, finishedAt: null });
    expect(v.sessions).toHaveLength(1);
    expect(v.sessions[0].feedback).toBeNull();
    expect(v.sessions[0].note).toBe('');
    expect(v.resources[0].url).toBeNull();
    expect(v.discover).toEqual({ minutes: 120, budget: 'free', setting: 'either', social: 'solo' });
  });
  it('data saved before learning existed opens with an empty list, and unreadable data is reset with a notice', () => {
    expect(validateInterests(undefined, ctx())).toEqual({ items: [], sessions: [], books: [], resources: [], discover: null });
    const c = ctx() as unknown as { notes: string[] };
    expect(validateInterests('nonsense', c as never).items).toEqual([]);
    expect(c.notes.join(' ')).toMatch(/unreadable/);
  });
  it('a whole saved file round-trips and old files gain the new parts', () => {
    const d = emptyAppData(TODAY);
    const withData = reducer(reducer(d, { type: 'INTEREST_SAVE', interest: interest('i1', 'singing') }), { type: 'BOOK_SAVE', book: book('b1') });
    const back = validateAppData(JSON.parse(JSON.stringify(withData)));
    expect(back?.data.interests.items.map((i) => i.id)).toEqual(['i1']);
    const old = JSON.parse(JSON.stringify(d)); delete old.interests; delete old.appearance;
    const upgraded = validateAppData(old);
    expect(upgraded?.data.interests.items).toEqual([]);
    expect(upgraded?.data.appearance.theme).toBe('system');
  });
});

describe('the owl: plain tips from fixed rules, never AI', () => {
  const d = (patch: object = {}) => ({ ...emptyAppData(TODAY), onboardingComplete: true, ...patch });
  const enabled = (m: string[]) => ({ modules: { ...emptyAppData(TODAY).modules, enabled: { ...emptyAppData(TODAY).modules.enabled, ...Object.fromEntries(m.map((x) => [x, true])) } } });
  it('shows nothing when the owl is off, and at most one tip in a place', () => {
    const data = d({ ...enabled(['learning']) });
    expect(nextTip(data, 'learning', TODAY)?.id).toBe('discover');
    expect(nextTip({ ...data, appearance: { ...data.appearance, owl: false } }, 'learning', TODAY)).toBeNull();
  });
  it('a dismissed tip stays dismissed', () => {
    const data = d({ ...enabled(['learning']) });
    const gone = { ...data, dismissedInsights: { [dismissKey('discover')]: TODAY } };
    expect(nextTip(gone, 'learning', TODAY)).toBeNull();
  });
  it('tips appear only when they apply, and need nothing from the person that they have not given', () => {
    expect(nextTip(d(), 'learning', TODAY)).toBeNull();
    expect(nextTip(d({ ...enabled(['movement']) }), 'today', TODAY)?.id).toBe('plan-yourself');
    expect(nextTip(d({ ...enabled(['water']) }), 'wellbeing', TODAY)).toBeNull(); // no entries yet, so a goal tip would be pushy
    expect(nextTip(d({ ...enabled(['water']), water: { goalMl: null, unit: 'ml', entries: [{ id: 'a', date: TODAY, at: `${TODAY}T09:00:00.000Z`, ml: 250 }] } }), 'wellbeing', TODAY)?.id).toBe('water-goal');
  });
  it('every tip is short, in plain words, and makes no health, guilt or streak claims', () => {
    for (const t of TIPS) {
      expect(t.title.length).toBeLessThan(60);
      expect(t.body.length).toBeLessThan(220);
      expect(`${t.title} ${t.body}`).not.toMatch(/streak|you should|must|behind|failed|guilt|lazy|burn|lose weight|diagnos|medical|AI|assistant/i);
    }
    expect(new Set(TIPS.map((t) => t.id)).size).toBe(TIPS.length);
  });
});
