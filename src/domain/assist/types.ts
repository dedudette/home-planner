import type { MealSlot } from '../meals/types';
import type { ISODate } from '../types';

/**
 * The assistant, as contracts. Each feature has one request shape and one proposal shape, and both are checked by plain code on the
 * server AND again in the browser. The model only ever chooses among candidates the app already filtered with its own rules (diet,
 * allergens, equipment, energy, rest days), puts them in order and says why in a few words. It cannot invent a recipe, a workout, a
 * date or an action: anything outside the request is dropped before the person sees it. Nothing changes until they approve it.
 */
export const ASSIST_FEATURES = ['meals', 'movement', 'learning'] as const;
export type AssistFeature = (typeof ASSIST_FEATURES)[number];

/** One thing the assistant may choose. Everything in it is from the built-in lists or typed by the person, and is shown to them before sending. */
export interface Candidate {
  id: string;
  name: string;
  minutes: number;
  tags: string[];
  /** Meals only: the meal slots it suits. */
  slots?: MealSlot[];
}

export interface AssistRequest {
  v: 1;
  feature: AssistFeature;
  /** The days a proposal may use (meals and movement). Empty for learning. */
  days: ISODate[];
  /** Meals only: the slots a proposal may fill. */
  slots: MealSlot[];
  /** The most items a proposal may hold. */
  maxItems: number;
  /** An optional wish in the person's own words, written for this request only. */
  wish: string;
  candidates: Candidate[];
}

export interface ProposalItem {
  candidateId: string;
  date: ISODate | null;
  slot: MealSlot | null;
  /** A few words from the assistant. Checked: no health, nutrition, price or pressure claims; only numbers that come from the request. */
  reason: string;
}

export interface AssistProposal {
  feature: AssistFeature;
  note: string;
  items: ProposalItem[];
}

/** Where a proposal came from. Always shown to the person: the assistant's words are never presented as the app's. */
export type ProposalOrigin = 'ai' | 'app';

export const LIMITS = {
  candidates: 40, days: 7, items: 21, wish: 200, name: 60, tag: 24, tags: 6, reason: 140, note: 200, id: 60, minutes: 600,
} as const;
