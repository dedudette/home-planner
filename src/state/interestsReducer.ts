import { MAX_INTERESTS, safeUrl } from '../storage/interestsSchema';
import type { Book, BookStatus, DiscoverAnswers, Interest, InterestSession, InterestStatus, Resource } from '../domain/interests/types';
import type { AppData } from '../domain/types';

export type InterestsAction =
  | { type: 'INTEREST_SAVE'; interest: Interest }
  | { type: 'INTEREST_STATUS'; id: string; status: InterestStatus }
  | { type: 'INTEREST_DELETE'; id: string }
  | { type: 'SESSION_ADD'; session: InterestSession }
  | { type: 'SESSION_DELETE'; id: string }
  | { type: 'BOOK_SAVE'; book: Book }
  | { type: 'BOOK_STATUS'; id: string; status: BookStatus; at: string }
  | { type: 'BOOK_PROGRESS'; id: string; pagesRead: number | null }
  | { type: 'BOOK_DELETE'; id: string }
  | { type: 'RESOURCE_SAVE'; resource: Resource }
  | { type: 'RESOURCE_DELETE'; id: string }
  | { type: 'DISCOVER_SET'; answers: DiscoverAnswers };

const upsert = <T extends { id: string }>(xs: T[], x: T): T[] => (xs.some((y) => y.id === x.id) ? xs.map((y) => (y.id === x.id ? x : y)) : [...xs, x]);

export const interestsReducer = (d: AppData, a: InterestsAction): AppData => {
  const i = d.interests;
  switch (a.type) {
    case 'INTEREST_SAVE': return { ...d, interests: { ...i, items: upsert(i.items, a.interest).slice(-MAX_INTERESTS.items) } };
    case 'INTEREST_STATUS': return i.items.some((x) => x.id === a.id && x.status !== a.status) ? { ...d, interests: { ...i, items: i.items.map((x) => (x.id === a.id ? { ...x, status: a.status } : x)) } } : d;
    case 'INTEREST_DELETE': {
      if (!i.items.some((x) => x.id === a.id)) return d;
      // Sessions stay in the log as history; only the interest and its own links go.
      return { ...d, interests: { ...i, items: i.items.filter((x) => x.id !== a.id), resources: i.resources.filter((r) => r.interestId !== a.id) } };
    }
    case 'SESSION_ADD': return i.sessions.some((s) => s.entryId === a.session.entryId || s.id === a.session.id) ? d : { ...d, interests: { ...i, sessions: [...i.sessions, a.session].slice(-MAX_INTERESTS.sessions) } };
    case 'SESSION_DELETE': return i.sessions.some((s) => s.id === a.id) ? { ...d, interests: { ...i, sessions: i.sessions.filter((s) => s.id !== a.id) } } : d;
    case 'BOOK_SAVE': return { ...d, interests: { ...i, books: upsert(i.books, a.book).slice(-MAX_INTERESTS.books) } };
    case 'BOOK_STATUS': {
      const cur = i.books.find((b) => b.id === a.id);
      if (!cur || cur.status === a.status) return d;
      return { ...d, interests: { ...i, books: i.books.map((b) => (b.id === a.id ? { ...b, status: a.status, finishedAt: a.status === 'finished' ? a.at : null, pagesRead: a.status === 'finished' && b.pagesTotal !== null ? b.pagesTotal : b.pagesRead } : b)) } };
    }
    case 'BOOK_PROGRESS': {
      const cur = i.books.find((b) => b.id === a.id);
      if (!cur) return d;
      const read = a.pagesRead === null ? null : Math.max(0, cur.pagesTotal !== null ? Math.min(cur.pagesTotal, Math.round(a.pagesRead)) : Math.round(a.pagesRead));
      return read === cur.pagesRead ? d : { ...d, interests: { ...i, books: i.books.map((b) => (b.id === a.id ? { ...b, pagesRead: read } : b)) } };
    }
    case 'BOOK_DELETE': return i.books.some((b) => b.id === a.id) ? { ...d, interests: { ...i, books: i.books.filter((b) => b.id !== a.id), sessions: i.sessions.map((s) => (s.bookId === a.id ? { ...s, bookId: null } : s)) } } : d;
    case 'RESOURCE_SAVE': return { ...d, interests: { ...i, resources: upsert(i.resources, { ...a.resource, url: safeUrl(a.resource.url) }).slice(-MAX_INTERESTS.resources) } };
    case 'RESOURCE_DELETE': return i.resources.some((r) => r.id === a.id) ? { ...d, interests: { ...i, resources: i.resources.filter((r) => r.id !== a.id) } } : d;
    case 'DISCOVER_SET': return { ...d, interests: { ...i, discover: a.answers } };
    default: return d;
  }
};
