import type {
  Blocker, Cleanliness, CleaningStyle, Energy, GarageSize, Goal, HomeType, PetFeature, PetType,
  ProblemArea, RoomCounts, SizeBand, SizeLevel, SupplyCategory,
} from './types';

export interface Option<T extends string> { value: T; label: string; hint?: string }

export const HOME_TYPES: Option<HomeType>[] = [
  { value: 'apartment', label: 'Apartment' },
  { value: 'studio', label: 'Studio apartment' },
  { value: 'house', label: 'House' },
  { value: 'townhouse', label: 'Townhouse' },
  { value: 'duplex', label: 'Duplex' },
  { value: 'dorm', label: 'Dorm room' },
  { value: 'shared', label: 'Shared apartment' },
  { value: 'other', label: 'Other' },
];

export const SIZE_BANDS: (Option<SizeBand> & { m2: number })[] = [
  { value: 'u25', label: 'Under 25 m²', m2: 20 },
  { value: '25-40', label: '25–40 m²', m2: 32 },
  { value: '41-60', label: '41–60 m²', m2: 50 },
  { value: '61-80', label: '61–80 m²', m2: 70 },
  { value: '81-100', label: '81–100 m²', m2: 90 },
  { value: '101-130', label: '101–130 m²', m2: 115 },
  { value: '131-160', label: '131–160 m²', m2: 145 },
  { value: '161-200', label: '161–200 m²', m2: 180 },
  { value: '200+', label: '200+ m²', m2: 230 },
  { value: 'unknown', label: "I don't know", m2: 0 },
];

export const CLEANLINESS: (Option<Cleanliness> & { level: number })[] = [
  { value: 'quite-clean', label: 'Already quite clean', level: 0 },
  { value: 'mostly-clean', label: 'Mostly clean', level: 1 },
  { value: 'little-messy', label: 'A little messy', level: 2 },
  { value: 'quite-messy', label: 'Quite messy', level: 3 },
  { value: 'very-messy', label: 'Very messy', level: 4 },
  { value: 'overwhelming', label: "Overwhelming / I don't know where to start", level: 5 },
  { value: 'long-time', label: "I haven't cleaned properly in a long time", level: 6 },
];

export const PROBLEM_AREAS: Option<ProblemArea>[] = [
  { value: 'dishes', label: 'Dishes' },
  { value: 'laundry', label: 'Laundry' },
  { value: 'floors', label: 'Floors' },
  { value: 'dust', label: 'Dust' },
  { value: 'bathroom', label: 'Bathroom' },
  { value: 'kitchen', label: 'Kitchen' },
  { value: 'bedroom', label: 'Bedroom' },
  { value: 'living-room', label: 'Living room' },
  { value: 'clutter', label: 'Clutter' },
  { value: 'trash', label: 'Trash' },
  { value: 'pet-hair', label: 'Pet hair' },
  { value: 'kitchen-surfaces', label: 'Kitchen surfaces' },
  { value: 'refrigerator', label: 'Refrigerator' },
  { value: 'windows', label: 'Windows' },
  { value: 'organization', label: 'General organization' },
  { value: 'other', label: 'Other' },
];

export const STYLES: (Option<CleaningStyle> & { days: number })[] = [
  { value: 'daily', label: 'A little every day', hint: 'Small daily habits keep things from piling up.', days: 7 },
  { value: 'weekly-session', label: 'One big cleaning session per week', hint: 'Everything in one focused block.', days: 1 },
  { value: 'several-short', label: 'Several short sessions per week', hint: 'A few quick sessions on set days.', days: 4 },
  { value: 'weekend', label: 'Weekend cleaning', hint: 'Saturday and Sunday do the heavy lifting.', days: 2 },
  { value: 'only-necessary', label: 'Only when necessary', hint: 'Just the essentials, nothing extra.', days: 3 },
  { value: 'app-decides', label: "I don't know / I need the app to decide", hint: "We'll pick a rhythm from your time and energy.", days: 4 },
];

export const SESSION_LENGTHS = [5, 10, 15, 20, 30, 45, 60, 90] as const;
export const sessionLabel = (m: number) => (m >= 90 ? '90+ minutes' : `${m} minutes`);

export const ENERGY: Option<Energy>[] = [
  { value: 'very-low', label: 'Very low' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'very-high', label: 'Very high' },
  { value: 'varies', label: 'It changes a lot' },
];

export const BLOCKERS: Option<Blocker>[] = [
  { value: 'where-to-start', label: "I don't know where to start" },
  { value: 'overwhelming', label: 'Tasks feel overwhelming' },
  { value: 'distracted', label: 'I get distracted' },
  { value: 'forget', label: 'I forget what needs to be done' },
  { value: 'procrastinate', label: 'I procrastinate' },
  { value: 'lose-motivation', label: 'I lose motivation' },
  { value: 'no-time', label: "I don't have much time" },
  { value: 'tired', label: 'I get tired quickly' },
  { value: 'clutter', label: 'Clutter makes it difficult' },
  { value: 'too-many-things', label: 'I start too many things at once' },
  { value: 'dont-know-frequency', label: "I don't know how often things should be cleaned" },
  { value: 'other', label: 'Other' },
];

export const GOALS: Option<Goal>[] = [
  { value: 'consistent', label: 'Keep my home consistently clean' },
  { value: 'under-control', label: 'Get my home under control' },
  { value: 'less-overwhelm', label: 'Stop feeling overwhelmed' },
  { value: 'daily-routine', label: 'Build a daily routine' },
  { value: 'weekly-routine', label: 'Build a weekly routine' },
  { value: 'guests', label: 'Prepare for guests' },
  { value: 'deep-clean', label: 'Deep clean my home' },
  { value: 'declutter', label: 'Declutter' },
  { value: 'less-time', label: 'Spend less time cleaning' },
  { value: 'easier', label: 'Make cleaning easier' },
  { value: 'habits', label: 'Create habits' },
  { value: 'recover', label: 'Recover after falling behind' },
  { value: 'moving', label: 'Prepare for moving' },
  { value: 'event', label: 'Prepare for an event' },
  { value: 'other', label: 'Other' },
];

export const PET_CHOICES = [
  { value: 'none', label: 'None' },
  { value: 'dog', label: 'Dog' },
  { value: 'cat', label: 'Cat' },
  { value: 'both', label: 'Dog + cat' },
  { value: 'other', label: 'Other' },
] as const;

export const PET_TYPES: Option<PetType>[] = [
  { value: 'dog', label: 'Dog' },
  { value: 'cat', label: 'Cat' },
  { value: 'rabbit', label: 'Rabbit' },
  { value: 'small', label: 'Hamster / guinea pig / small mammal' },
  { value: 'bird', label: 'Bird' },
  { value: 'fish', label: 'Fish' },
  { value: 'reptile', label: 'Reptile' },
  { value: 'other', label: 'Other' },
];

export const PET_FEATURES: Option<PetFeature>[] = [
  { value: 'litter', label: 'Litter box' },
  { value: 'feeding', label: 'Feeding areas' },
  { value: 'beds', label: 'Pet beds' },
  { value: 'crates', label: 'Crates' },
  { value: 'toys', label: 'Toys' },
];

export const SUPPLY_CATEGORIES: Option<SupplyCategory>[] = [
  { value: 'all-purpose', label: 'All-purpose cleaner' },
  { value: 'dish-soap', label: 'Dish soap' },
  { value: 'glass', label: 'Glass cleaner' },
  { value: 'bathroom', label: 'Bathroom cleaner' },
  { value: 'toilet', label: 'Toilet cleaner' },
  { value: 'floor', label: 'Floor cleaner' },
  { value: 'degreaser', label: 'Kitchen degreaser' },
  { value: 'disinfectant', label: 'Disinfectant' },
  { value: 'bleach', label: 'Bleach' },
  { value: 'descaler', label: 'Descaler / acidic cleaner' },
  { value: 'vinegar', label: 'Vinegar' },
  { value: 'baking-soda', label: 'Baking soda' },
  { value: 'laundry', label: 'Laundry detergent' },
  { value: 'cloths', label: 'Cloths & sponges' },
  { value: 'tools', label: 'Tools (vacuum, mop, broom…)' },
  { value: 'bags', label: 'Trash bags' },
  { value: 'other', label: 'Other' },
];

// ───────── Dynamic question visibility per home type ─────────

export type RoomField = keyof RoomCounts | 'floors';

const ALL: HomeType[] = ['apartment', 'studio', 'house', 'townhouse', 'duplex', 'dorm', 'shared', 'other'];
const LIVING_HOMES: HomeType[] = ['apartment', 'house', 'townhouse', 'duplex', 'shared', 'other'];
const HOUSE_LIKE: HomeType[] = ['house', 'townhouse', 'duplex', 'other'];

const VISIBLE: Record<RoomField, HomeType[]> = {
  bedrooms: ['apartment', 'house', 'townhouse', 'duplex', 'shared', 'other'],
  bathrooms: ALL,
  livingRooms: LIVING_HOMES,
  kitchens: ALL,
  diningRooms: LIVING_HOMES,
  offices: LIVING_HOMES,
  laundryRooms: ['apartment', 'studio', 'house', 'townhouse', 'duplex', 'shared', 'other'],
  hallways: LIVING_HOMES,
  storageRooms: LIVING_HOMES,
  balcony: ['apartment', 'studio', 'house', 'townhouse', 'duplex', 'shared', 'other'],
  garage: HOUSE_LIKE,
  basement: HOUSE_LIKE,
  attic: HOUSE_LIKE,
  floors: ['house', 'townhouse', 'duplex'],
};

export const isRoomFieldVisible = (field: RoomField, type: HomeType | null): boolean =>
  type === null ? true : VISIBLE[field].includes(type);

export const EMPTY_ROOMS: RoomCounts = {
  bedrooms: 0, bathrooms: 1, livingRooms: 0, kitchens: 1, diningRooms: 0, offices: 0, laundryRooms: 0,
  hallways: 0, storageRooms: 0, balcony: 'none', garage: 'none', basement: 'none', attic: 'none',
};

export const ROOM_DEFAULTS: Record<HomeType, { rooms: RoomCounts; floors: number }> = {
  apartment: { rooms: { ...EMPTY_ROOMS, bedrooms: 1, livingRooms: 1, hallways: 1 }, floors: 1 },
  studio: { rooms: { ...EMPTY_ROOMS }, floors: 1 },
  house: {
    rooms: { ...EMPTY_ROOMS, bedrooms: 3, bathrooms: 2, livingRooms: 1, diningRooms: 1, laundryRooms: 1, hallways: 1, storageRooms: 1, garage: '1-car' },
    floors: 2,
  },
  townhouse: {
    rooms: { ...EMPTY_ROOMS, bedrooms: 2, bathrooms: 2, livingRooms: 1, diningRooms: 1, laundryRooms: 1, hallways: 1 },
    floors: 2,
  },
  duplex: { rooms: { ...EMPTY_ROOMS, bedrooms: 2, bathrooms: 1, livingRooms: 1, diningRooms: 1, hallways: 1 }, floors: 2 },
  dorm: { rooms: { ...EMPTY_ROOMS, bathrooms: 0, kitchens: 0 }, floors: 1 },
  shared: { rooms: { ...EMPTY_ROOMS, bedrooms: 3, bathrooms: 1, livingRooms: 1, hallways: 1 }, floors: 1 },
  other: { rooms: { ...EMPTY_ROOMS, bedrooms: 1, livingRooms: 1 }, floors: 1 },
};

export const countLabel = (n: number, max: number) => (n >= max ? `${max}+` : String(n));

export const SIZE_LEVELS: Option<SizeLevel>[] = [
  { value: 'none', label: 'None' },
  { value: 'small', label: 'Small' },
  { value: 'medium', label: 'Medium' },
  { value: 'large', label: 'Large' },
];

export const GARAGE_SIZES: Option<GarageSize>[] = [
  { value: 'none', label: 'None' },
  { value: '1-car', label: '1-car' },
  { value: '2-car', label: '2-car' },
  { value: 'large', label: 'Large' },
];
