import { emptyInterests } from '../domain/interests/defaults';
import { INTEREST_CATEGORIES, type Book, type DiscoverAnswers, type Feedback, type Interest, type InterestSession, type InterestsData, type Resource } from '../domain/interests/types';
import { Ctx, date, intn, isObj, isoStamp, keepNewest, oneOf, oneOfOrNull, str } from './primitives';

/** Validation for learning and hobby data (schema v3). A link is stored only if it is a plain http(s) address. */
export const MAX_INTERESTS = { items: 200, sessions: 6000, books: 500, resources: 400 };
const STATUS = ['exploring', 'active', 'paused', 'not-for-me'] as const;
const FEEDBACK: readonly Feedback[] = ['enjoyed', 'try-again', 'not-for-me'];
const BOOK_STATUS = ['want', 'reading', 'finished'] as const;

/** Only a web address a browser can open as a page. Anything else (javascript:, data:, file:…) is dropped, never kept as text to be followed. */
export const safeUrl = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t || t.length > 500) return null;
  try { const u = new URL(t); return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null; } catch { return null; }
};

const pages = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? intn(v, 0, 0, 100000) : null);

export const validateInterests = (raw: unknown, c: Ctx): InterestsData => {
  const d = emptyInterests();
  if (raw === undefined) return d;
  if (!isObj(raw)) { c.note('Your learning and hobby data was unreadable and was reset.'); return d; }
  const ids = new Set<string>();
  const items: Interest[] = [];
  for (const x of (Array.isArray(raw.items) ? raw.items : []).slice(0, MAX_INTERESTS.items)) {
    if (!isObj(x) || typeof x.id !== 'string' || !str(x.name).trim() || ids.has(x.id)) { c.dropped++; continue; }
    ids.add(x.id);
    items.push({
      id: x.id.slice(0, 60), name: str(x.name, '', 60).trim(), catalogId: typeof x.catalogId === 'string' ? x.catalogId.slice(0, 40) : null, category: oneOf(x.category, INTEREST_CATEGORIES, 'making'),
      status: oneOf(x.status, STATUS, 'exploring'), goal: str(x.goal, '', 300), weeklyMinutes: typeof x.weeklyMinutes === 'number' && x.weeklyMinutes >= 5 ? intn(x.weeklyMinutes, 30, 5, 2000) : null,
      note: str(x.note, '', 500), createdAt: isoStamp(x.createdAt, new Date(0).toISOString()),
    });
  }
  const bookIds = new Set<string>();
  const books: Book[] = [];
  for (const x of (Array.isArray(raw.books) ? raw.books : []).slice(0, MAX_INTERESTS.books)) {
    if (!isObj(x) || typeof x.id !== 'string' || !str(x.title).trim() || bookIds.has(x.id)) { c.dropped++; continue; }
    bookIds.add(x.id);
    const total = pages(x.pagesTotal);
    let read = pages(x.pagesRead);
    if (read !== null && total !== null && read > total) read = total;
    const status = oneOf(x.status, BOOK_STATUS, 'want');
    books.push({
      id: x.id.slice(0, 60), title: str(x.title, '', 160).trim(), author: str(x.author, '', 120).trim(), status, pagesTotal: total, pagesRead: read, addedAt: isoStamp(x.addedAt, new Date(0).toISOString()),
      finishedAt: status === 'finished' && typeof x.finishedAt === 'string' && !Number.isNaN(Date.parse(x.finishedAt)) ? x.finishedAt : null, note: str(x.note, '', 500),
    });
  }
  const sessIds = new Set<string>();
  const sessions: InterestSession[] = [];
  for (const x of Array.isArray(raw.sessions) ? raw.sessions : []) {
    if (!isObj(x) || typeof x.id !== 'string' || typeof x.interestId !== 'string' || typeof x.entryId !== 'string' || !date(x.date) || typeof x.at !== 'string' || Number.isNaN(Date.parse(x.at)) || sessIds.has(x.id)) { c.dropped++; continue; }
    sessIds.add(x.id);
    sessions.push({
      id: x.id.slice(0, 60), interestId: x.interestId.slice(0, 60), entryId: x.entryId.slice(0, 60), date: x.date as string, at: x.at, bookId: typeof x.bookId === 'string' ? x.bookId.slice(0, 60) : null,
      starterId: typeof x.starterId === 'string' ? x.starterId.slice(0, 60) : null, note: str(x.note, '', 500), feedback: oneOfOrNull(x.feedback, FEEDBACK), resource: str(x.resource, '', 120),
    });
  }
  sessions.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  const resIds = new Set<string>();
  const resources: Resource[] = [];
  for (const x of (Array.isArray(raw.resources) ? raw.resources : []).slice(0, MAX_INTERESTS.resources)) {
    if (!isObj(x) || typeof x.id !== 'string' || typeof x.interestId !== 'string' || !str(x.title).trim() || resIds.has(x.id)) { c.dropped++; continue; }
    resIds.add(x.id);
    resources.push({ id: x.id.slice(0, 60), interestId: x.interestId.slice(0, 60), title: str(x.title, '', 120).trim(), url: safeUrl(x.url), note: str(x.note, '', 300) });
  }
  let discover: DiscoverAnswers | null = null;
  if (isObj(raw.discover)) {
    const m = raw.discover.minutes;
    discover = { minutes: typeof m === 'number' ? intn(m, 15, 5, 120) : 15, budget: oneOf(raw.discover.budget, ['free', 'low', 'some'] as const, 'free'), setting: oneOf(raw.discover.setting, ['indoor', 'outdoor', 'either'] as const, 'either'), social: oneOf(raw.discover.social, ['solo', 'social', 'either'] as const, 'either') };
  }
  return { items, sessions: keepNewest(sessions, MAX_INTERESTS.sessions, c, 'hobby sessions'), books, resources, discover };
};
