import { uid } from '../../domain/appdata';
import type { CatalogInterest, Feedback, Interest, InterestCategory, InterestStatus } from '../../domain/interests/types';

export const CATEGORY_LABEL: Record<InterestCategory, string> = {
  reading: 'Reading', music: 'Music', dance: 'Dance', 'visual-art': 'Drawing and painting', crafts: 'Sewing and crafts', languages: 'Languages', writing: 'Writing', nature: 'Nature and plants', games: 'Puzzles and games', photography: 'Photography', making: 'Making things',
};
export const STATUS_LABEL: Record<InterestStatus, string> = { exploring: 'Trying it out', active: 'Active', paused: 'Paused', 'not-for-me': 'Not for me' };
export const FEEDBACK_LABEL: Record<Feedback, string> = { enjoyed: 'Enjoyed it', 'try-again': 'I would try it again', 'not-for-me': 'Not for me' };

export const interestFromCatalog = (c: CatalogInterest, status: InterestStatus): Interest => ({ id: uid('int'), name: c.name, catalogId: c.id, category: c.category, status, goal: '', weeklyMinutes: null, note: '', createdAt: new Date().toISOString() });
export const customInterest = (name: string, category: InterestCategory): Interest => ({ id: uid('int'), name: name.trim(), catalogId: null, category, status: 'active', goal: '', weeklyMinutes: null, note: '', createdAt: new Date().toISOString() });
