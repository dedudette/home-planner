import { CATALOG } from './catalog';
import type { AppData } from '../types';
import type { Budget, CatalogInterest, DiscoverAnswers, Feedback, InterestCategory } from './types';

const BUDGET_RANK: Record<Budget, number> = { free: 0, low: 1, some: 2 };
const BUDGET_TEXT: Record<Budget, string> = { free: 'uses things most homes have', low: 'needs only a small purchase, if anything', some: 'may need an instrument or a kit' };

export interface Suggestion { interest: CatalogInterest; reasons: string[]; boostedBy: string | null }

/** How the person has answered after sessions, by category. Counts only what they said: "enjoyed it" and "not for me". */
export const feedbackByCategory = (d: Pick<AppData, 'interests'>): Record<string, { enjoyed: number; notForMe: number }> => {
  const out: Record<string, { enjoyed: number; notForMe: number }> = {};
  const cat = new Map(d.interests.items.map((i) => [i.id, i.category]));
  for (const s of d.interests.sessions) {
    const c = cat.get(s.interestId);
    if (!c || !s.feedback) continue;
    const slot = (out[c] ??= { enjoyed: 0, notForMe: 0 });
    if (s.feedback === 'enjoyed') slot.enjoyed++;
    if (s.feedback === 'not-for-me') slot.notForMe++;
  }
  return out;
};

const FB_LABEL: Record<Feedback, string> = { enjoyed: 'enjoyed it', 'try-again': 'wanted to try again', 'not-for-me': 'said it was not for you' };
void FB_LABEL;

/**
 * Interests worth trying, given what the person said about time, budget, place and company. A plain filter plus one simple rule:
 * categories they said "enjoyed it" about rank a little higher, and anything they marked "not for me" is left out. That is all: it
 * claims nothing about who they are, and each suggestion says exactly why it is shown.
 */
export const discoverInterests = (d: Pick<AppData, 'interests'>, a: DiscoverAnswers, catalog: CatalogInterest[] = CATALOG): Suggestion[] => {
  const have = new Set(d.interests.items.filter((i) => i.catalogId && i.status !== 'not-for-me').map((i) => i.catalogId));
  const rejected = new Set(d.interests.items.filter((i) => i.status === 'not-for-me').map((i) => i.catalogId));
  const fb = feedbackByCategory(d);
  const out: Suggestion[] = [];
  for (const c of catalog) {
    if (have.has(c.id) || rejected.has(c.id)) continue;
    if (BUDGET_RANK[c.budget] > BUDGET_RANK[a.budget]) continue;
    if (a.setting !== 'either' && c.setting !== 'either' && c.setting !== a.setting) continue;
    if (a.social !== 'either' && c.social !== 'either' && c.social !== a.social) continue;
    if (c.minutes[0] > a.minutes) continue;
    const reasons = [`a first try fits in your ${a.minutes} minutes`, BUDGET_TEXT[c.budget], c.setting === 'outdoor' ? 'outdoors' : c.setting === 'indoor' ? 'indoors' : 'indoors or out', c.social === 'solo' ? 'on your own' : c.social === 'social' ? 'with other people' : 'alone or with others'];
    const f = fb[c.category as InterestCategory];
    out.push({ interest: c, reasons, boostedBy: f && f.enjoyed > f.notForMe ? `You said you enjoyed ${f.enjoyed === 1 ? 'a session' : `${f.enjoyed} sessions`} in this area, so it is shown a little higher. That is a simple rule, not a guess about you.` : null });
  }
  return out.sort((x, y) => Number(!!y.boostedBy) - Number(!!x.boostedBy) || x.interest.name.localeCompare(y.interest.name));
};
