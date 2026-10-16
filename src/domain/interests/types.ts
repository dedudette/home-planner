import type { ISODate } from '../types';

/**
 * Learning, reading and hobbies.
 *
 * What is NOT here, on purpose: no book titles, authors, course names or links supplied by the app. Everything a person reads, follows
 * or links to is typed by them. The starter activities are short things anyone can try with what is already at home.
 * Minutes live in the one log entry the app keeps for everything; a session record holds what the session was, not a second copy of its minutes.
 */
export const INTEREST_CATEGORIES = ['reading', 'music', 'dance', 'visual-art', 'crafts', 'languages', 'writing', 'nature', 'games', 'photography', 'making'] as const;
export type InterestCategory = (typeof INTEREST_CATEGORIES)[number];

export type Budget = 'free' | 'low' | 'some';
export type Setting = 'indoor' | 'outdoor' | 'either';
export type Social = 'solo' | 'social' | 'either';

export interface Starter { id: string; title: string; minutes: number; needs: string[]; steps: string[] }

export interface CatalogInterest {
  id: string;
  name: string;
  category: InterestCategory;
  blurb: string;
  /** A typical session, in minutes: the shortest it is worth doing and a comfortable longest. */
  minutes: [number, number];
  /** free: things most homes have. low: a small purchase such as pencils and paper. some: an instrument, a kit or equipment. The app holds no prices. */
  budget: Budget;
  setting: Setting;
  social: Social;
  needs: string[];
  starters: Starter[];
}

export type InterestStatus = 'exploring' | 'active' | 'paused' | 'not-for-me';
export type Feedback = 'enjoyed' | 'try-again' | 'not-for-me';

export interface Interest {
  id: string;
  name: string;
  /** The catalogue entry it came from, or null for an interest the person made up. */
  catalogId: string | null;
  category: InterestCategory;
  status: InterestStatus;
  /** In the person's own words. */
  goal: string;
  weeklyMinutes: number | null;
  note: string;
  createdAt: string;
}

export interface InterestSession {
  id: string;
  interestId: string;
  /** The log entry that holds this session's minutes. */
  entryId: string;
  date: ISODate;
  at: string;
  bookId: string | null;
  starterId: string | null;
  note: string;
  feedback: Feedback | null;
  /** A resource the person used, as they wrote it. */
  resource: string;
}

export type BookStatus = 'want' | 'reading' | 'finished';
export interface Book {
  id: string;
  title: string;
  author: string;
  status: BookStatus;
  pagesTotal: number | null;
  pagesRead: number | null;
  addedAt: string;
  finishedAt: string | null;
  note: string;
}

export interface Resource { id: string; interestId: string; title: string; url: string | null; note: string }

export interface DiscoverAnswers { minutes: number; budget: Budget; setting: Setting; social: Social }

export interface InterestsData {
  items: Interest[];
  sessions: InterestSession[];
  books: Book[];
  resources: Resource[];
  /** The last answers given to "help me find something", kept so the question is not asked from scratch every time. */
  discover: DiscoverAnswers | null;
}
