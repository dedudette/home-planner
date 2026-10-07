import { CLEANLINESS, EMPTY_ROOMS, ROOM_DEFAULTS, SIZE_BANDS, STYLES, isRoomFieldVisible } from './options';
import type {
  Blocker, Energy, EquipmentNeed, FitnessLevel, Goal, Home, HomeType, LifeFocus, LifeLevel, Preferences, ProblemArea, Room,
  RoomCounts, RoomKind,
} from './types';

export const emptyHome = (): Home => ({
  type: null,
  customType: '',
  sizeBand: null,
  exactSizeM2: null,
  rooms: { ...EMPTY_ROOMS },
  roomsTouched: false,
  floors: 1,
  extraRooms: [],
  adults: 1,
  children: 0,
  pets: { choice: 'none', types: [], count: 1, access: ['indoor'], features: [] },
  cleanliness: null,
  problemAreas: [],
  problemOther: '',
});

export const emptyPreferences = (): Preferences => ({
  style: null,
  sessionMinutes: null,
  daysPerWeek: null,
  daysTouched: false,
  energy: null,
  blockers: [],
  goals: [],
  learnedSessionCap: null,
  focus: ['home'],
  fitnessLevel: 'beginner',
  equipment: 'none',
  lifeLevel: 1,
  levelSince: null,
});

/** Apply the home type's room defaults (used until the user edits counts by hand). */
export const applyTypeDefaults = (home: Home, type: HomeType): Home => {
  const d = ROOM_DEFAULTS[type];
  return home.roomsTouched ? { ...home, type } : { ...home, type, rooms: { ...d.rooms }, floors: d.floors };
};

/**
 * Counts after applying the home type's visibility rules. Hidden questions are
 * forced to zero so stale answers (e.g. a garage picked before switching to
 * "Dorm room") can never leak into the plan.
 */
export const effectiveCounts = (home: Home): { rooms: RoomCounts; floors: number } => {
  const t = home.type;
  const r = { ...home.rooms };
  const z = <K extends keyof RoomCounts>(k: K, zero: RoomCounts[K]) => {
    if (!isRoomFieldVisible(k, t)) r[k] = zero;
  };
  z('bedrooms', 0); z('livingRooms', 0); z('diningRooms', 0); z('offices', 0); z('laundryRooms', 0);
  z('hallways', 0); z('storageRooms', 0); z('balcony', 'none'); z('garage', 'none'); z('basement', 'none');
  z('attic', 'none');
  if (!isRoomFieldVisible('bathrooms', t)) r.bathrooms = 0;
  if (!isRoomFieldVisible('kitchens', t)) r.kitchens = 0;
  if (t === 'studio') r.bedrooms = 0;
  const floors = isRoomFieldVisible('floors', t) ? Math.max(1, Math.min(4, home.floors || 1)) : 1;
  const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(Number.isFinite(n) ? n : 0)));
  r.bedrooms = clamp(r.bedrooms, 0, 8);
  r.bathrooms = clamp(r.bathrooms, 0, 6);
  r.livingRooms = clamp(r.livingRooms, 0, 4);
  r.kitchens = clamp(r.kitchens, 0, 3);
  r.diningRooms = clamp(r.diningRooms, 0, 3);
  r.offices = clamp(r.offices, 0, 3);
  r.laundryRooms = clamp(r.laundryRooms, 0, 3);
  r.hallways = clamp(r.hallways, 0, 4);
  r.storageRooms = clamp(r.storageRooms, 0, 3);
  return { rooms: r, floors };
};

// ─────────────────────── Room model ───────────────────────

const AREA_WEIGHT: Record<string, number> = {
  bedroom: 12, bathroom: 5, living: 22, kitchen: 10, dining: 10, office: 9, laundry: 5, hallway: 6, storage: 5,
};
const LEVEL_AREA = { none: 0, small: 1, medium: 2, large: 3 } as const;
const BALCONY_M2 = [0, 4, 8, 14];
const BASEMENT_M2 = [0, 20, 40, 65];
const ATTIC_M2 = [0, 15, 25, 40];
const GARAGE_M2 = { none: 0, '1-car': 18, '2-car': 36, large: 55 } as const;

const interiorWeightSum = (rooms: RoomCounts, type: HomeType | null): number => {
  let sum = 0;
  sum += rooms.bedrooms * AREA_WEIGHT.bedroom + rooms.bathrooms * AREA_WEIGHT.bathroom;
  sum += rooms.livingRooms * AREA_WEIGHT.living + rooms.kitchens * AREA_WEIGHT.kitchen;
  sum += rooms.diningRooms * AREA_WEIGHT.dining + rooms.offices * AREA_WEIGHT.office;
  sum += rooms.laundryRooms * AREA_WEIGHT.laundry + rooms.hallways * AREA_WEIGHT.hallway;
  sum += rooms.storageRooms * AREA_WEIGHT.storage;
  if (type === 'studio') sum += 18; // main room
  if (type === 'dorm') sum += 12;
  return Math.max(sum, 10);
};

/** Interior floor area in m². Exact size wins, then the band midpoint, then an estimate from rooms. */
export const homeArea = (home: Home): number => {
  if (home.exactSizeM2 && home.exactSizeM2 >= 8 && home.exactSizeM2 <= 2000) return Math.round(home.exactSizeM2);
  const band = SIZE_BANDS.find((b) => b.value === home.sizeBand);
  if (band && band.m2 > 0) return band.m2;
  return Math.round(interiorWeightSum(effectiveCounts(home).rooms, home.type) * 1.12);
};

const FLOOR_LABEL = (f: number, floors: number) =>
  floors === 1 ? 'Home' : f === 0 ? 'Ground floor' : f === 1 && floors === 2 ? 'Upstairs' : `Floor ${f + 1}`;

export interface HomeModel { rooms: Room[]; floors: number; area: number; zones: string[] }

export const buildRooms = (home: Home): HomeModel => {
  const { rooms: c, floors } = effectiveCounts(home);
  const area = homeArea(home);
  const type = home.type;
  const out: Omit<Room, 'zone' | 'areaM2'>[] = [];
  const weights: Record<string, number> = {};
  const add = (kind: RoomKind, n: number, name: (i: number, n: number) => string, floorOf: (i: number) => number, w: number) => {
    for (let i = 0; i < n; i++) {
      const id = `${kind}-${i + 1}`;
      out.push({ id, kind, name: name(i, n), floor: floorOf(i) });
      weights[id] = w;
    }
  };
  const multi = floors > 1;
  const upper = (i: number) => (multi ? 1 + (i % (floors - 1)) : 0);

  if (type === 'studio') {
    out.push({ id: 'living-1', kind: 'living', name: 'Studio (living & sleeping area)', floor: 0, sleeps: true });
    weights['living-1'] = 18;
  }
  if (type === 'dorm') {
    out.push({ id: 'bedroom-1', kind: 'bedroom', name: 'Dorm room', floor: 0, sleeps: true });
    weights['bedroom-1'] = 12;
  }
  add('bedroom', type === 'dorm' ? 0 : c.bedrooms, (i, n) => (n > 1 ? `Bedroom ${i + 1}` : 'Bedroom'), upper, AREA_WEIGHT.bedroom);
  add('bathroom', c.bathrooms, (i, n) => (type === 'dorm' ? 'Shared bathroom' : n > 1 ? `Bathroom ${i + 1}` : 'Bathroom'),
    (i) => (multi ? (i === 0 ? 1 : i === 1 ? 0 : upper(i)) : 0), AREA_WEIGHT.bathroom);
  add('living', type === 'studio' ? 0 : c.livingRooms, (i, n) => (n > 1 ? `Living room ${i + 1}` : 'Living room'), () => 0, AREA_WEIGHT.living);
  add('kitchen', c.kitchens, (i, n) => (type === 'studio' ? 'Kitchenette' : type === 'dorm' ? 'Shared kitchen' : n > 1 ? `Kitchen ${i + 1}` : 'Kitchen'), () => 0, AREA_WEIGHT.kitchen);
  add('dining', c.diningRooms, (i, n) => (n > 1 ? `Dining room ${i + 1}` : 'Dining room'), () => 0, AREA_WEIGHT.dining);
  add('office', c.offices, (i, n) => (n > 1 ? `Office ${i + 1}` : 'Office / study'), (i) => (multi ? Math.min(i, 1) : 0), AREA_WEIGHT.office);
  add('laundry', c.laundryRooms, (i, n) => (n > 1 ? `Laundry room ${i + 1}` : 'Laundry room'), () => 0, AREA_WEIGHT.laundry);
  add('hallway', c.hallways, (i, n) => (n > 1 ? `Hallway ${i + 1}` : 'Hallway'), (i) => (multi ? Math.min(i, floors - 1) : 0), AREA_WEIGHT.hallway);
  add('storage', c.storageRooms, (i, n) => (n > 1 ? `Storage room ${i + 1}` : 'Storage room'), () => 0, AREA_WEIGHT.storage);

  // Laundry always happens somewhere: give it a virtual area when there's no laundry room.
  if (c.laundryRooms === 0) {
    out.push({
      id: 'laundry-1', kind: 'laundry', virtual: true, floor: 0,
      name: type === 'dorm' ? 'Laundry (hamper & laundry day)' : 'Laundry (wherever you wash)',
    });
    weights['laundry-1'] = 0;
  }

  const interiorSum = Object.values(weights).reduce((a, b) => a + b, 0) || 1;
  const sized = out.map((r) => ({ ...r, areaM2: Math.max(2, Math.round(((weights[r.id] ?? 0) / interiorSum) * area)) }));

  const ext: Omit<Room, 'zone'>[] = [];
  if (c.balcony !== 'none') ext.push({ id: 'balcony-1', kind: 'balcony', name: 'Balcony / terrace', floor: 0, areaM2: BALCONY_M2[LEVEL_AREA[c.balcony]] });
  if (c.garage !== 'none') ext.push({ id: 'garage-1', kind: 'garage', name: 'Garage', floor: 0, areaM2: GARAGE_M2[c.garage] });
  if (c.basement !== 'none') ext.push({ id: 'basement-1', kind: 'basement', name: 'Basement', floor: -1, areaM2: BASEMENT_M2[LEVEL_AREA[c.basement]] });
  if (c.attic !== 'none') ext.push({ id: 'attic-1', kind: 'attic', name: 'Attic', floor: 99, areaM2: ATTIC_M2[LEVEL_AREA[c.attic]] });
  home.extraRooms.forEach((x) => ext.push({ id: `other-${x.id}`, kind: 'other', name: x.name || 'Extra space', floor: 0, areaM2: 10 }));

  const large = area >= 120;
  const zoneOf = (r: Omit<Room, 'zone'>): string => {
    if (['balcony', 'garage', 'basement', 'attic'].includes(r.kind)) return 'Outside & utility spaces';
    if (r.kind === 'other') return multi ? 'Ground floor' : large ? 'Living area' : 'Home';
    if (multi) return FLOOR_LABEL(r.floor, floors);
    if (!large) return 'Home';
    if (['bedroom', 'bathroom'].includes(r.kind)) return 'Sleeping & bath area';
    if (['kitchen', 'laundry', 'storage'].includes(r.kind)) return 'Kitchen & utility';
    return 'Living area';
  };
  const all = [...sized, ...ext].map((r) => ({ ...r, zone: zoneOf(r) }));
  const zones = Array.from(new Set(all.map((r) => r.zone)));
  return { rooms: all, floors, area, zones };
};

// ─────────────────────── Planning context ───────────────────────

export type SizeClass = 'tiny' | 'small' | 'medium' | 'large' | 'xl';

export interface Ctx {
  home: Home;
  prefs: Preferences;
  rooms: Room[];
  zones: string[];
  floors: number;
  area: number;
  sizeClass: SizeClass;
  minimal: boolean; // studio / dorm / very small: skip unnecessary tasks, merge floor care
  shared: boolean;
  people: number;
  adults: number;
  children: number;
  occTier: 0 | 1 | 2 | 3;
  kidTier: 0 | 1 | 2;
  pets: { any: boolean; dogs: boolean; cats: boolean; sheds: boolean; indoor: boolean; outdoor: boolean; count: number; types: Set<string>; features: Set<string> };
  mess: number; // 0..6
  problems: Set<ProblemArea>;
  goals: Set<Goal>;
  blockers: Set<Blocker>;
  focus: Set<LifeFocus>;
  lifeLevel: LifeLevel;
  fitnessLevel: FitnessLevel;
  equipment: EquipmentNeed;
  /** True when the user picked at least one non-home focus area. */
  lifeActive: boolean;
  /** True when the user wants a cleaning plan ('home' focus). */
  homeOn: boolean;
  /**
   * How the user's daily time is divided. One budget, shared: 60/40 when both are on, all of it when only one is.
   * (Home keeps a small share when it is off, only so a custom cleaning task the user adds still has somewhere to go.)
   */
  homeShare: number;
  lifeShare: number;
  energy: Energy;
  energyLow: boolean;
  microSteps: boolean; // overwhelm-friendly presentation
  lean: boolean;
  style: 'daily' | 'weekly-session' | 'several-short' | 'weekend' | 'only-necessary';
  sessionMinutes: number;
  daysPerWeek: number;
  activeDays: number[]; // weekdays (0 = Sunday)
  weeklyCapacity: number;
  chunkLimit: number;
  count: (k: RoomKind) => number;
  byKind: (k: RoomKind) => Room[];
}

const ENERGY_CAP: Record<Energy, number> = { 'very-low': 8, low: 12, medium: 30, high: 45, 'very-high': 90, varies: 20 };

const DAY_PATTERNS: Record<number, number[]> = {
  1: [6], 2: [3, 6], 3: [1, 3, 6], 4: [1, 3, 5, 0], 5: [1, 2, 4, 5, 6], 6: [1, 2, 3, 4, 5, 6], 7: [0, 1, 2, 3, 4, 5, 6],
};
const WEEKEND_ORDER = [6, 0, 5, 1, 4, 3, 2];

export const pickActiveDays = (n: number, weekend: boolean): number[] => {
  const k = Math.max(1, Math.min(7, Math.round(n)));
  if (weekend) return WEEKEND_ORDER.slice(0, k).sort((a, b) => a - b);
  return [...DAY_PATTERNS[k]].sort((a, b) => a - b);
};

export const deriveContext = (home: Home, prefs: Preferences): Ctx => {
  const model = buildRooms(home);
  const { rooms } = model;
  const adults = Math.max(1, home.adults || 1);
  const children = Math.max(0, home.children || 0);
  const people = adults + children;
  const occTier = (people <= 1 ? 0 : children >= 2 || people >= 4 ? 3 : people === 3 || children >= 1 ? 2 : 1) as Ctx['occTier'];
  const kidTier = (children === 0 ? 0 : children === 1 ? 1 : 2) as Ctx['kidTier'];

  const petTypes = new Set<string>(home.pets.choice === 'none' ? [] : home.pets.types);
  if (home.pets.choice === 'dog') petTypes.add('dog');
  if (home.pets.choice === 'cat') petTypes.add('cat');
  if (home.pets.choice === 'both') { petTypes.add('dog'); petTypes.add('cat'); }
  const anyPet = home.pets.choice !== 'none' && petTypes.size > 0;
  const access = home.pets.access.length ? home.pets.access : ['indoor'];
  const pets = {
    any: anyPet,
    dogs: petTypes.has('dog'),
    cats: petTypes.has('cat'),
    sheds: petTypes.has('dog') || petTypes.has('cat') || petTypes.has('rabbit'),
    indoor: anyPet && access.includes('indoor'),
    outdoor: anyPet && access.includes('outdoor'),
    count: anyPet ? Math.max(1, home.pets.count) : 0,
    types: petTypes,
    features: new Set<string>(anyPet ? home.pets.features : []),
  };

  const mess = CLEANLINESS.find((c) => c.value === home.cleanliness)?.level ?? 1;
  const energy: Energy = prefs.energy ?? 'medium';
  const energyLow = energy === 'very-low' || energy === 'low';
  const blockers = new Set(prefs.blockers);
  const goals = new Set(prefs.goals);
  // Data saved before the life layer existed has no focus: treat it as the original home-cleaning app.
  const focus = new Set<LifeFocus>(prefs.focus?.length ? prefs.focus : ['home']);
  const microSteps =
    blockers.has('overwhelming') || blockers.has('where-to-start') || blockers.has('too-many-things') ||
    goals.has('less-overwhelm') || energy === 'very-low' || mess >= 5;

  const sessionMinutes = Math.max(5, Math.min(90, prefs.sessionMinutes ?? 20));
  const resolvedStyle = (() => {
    const s = prefs.style;
    if (s && s !== 'app-decides') return s;
    if (sessionMinutes <= 15 || energyLow || blockers.has('no-time')) return 'daily' as const;
    return 'several-short' as const;
  })();
  const defaultDays = STYLES.find((x) => x.value === (prefs.style ?? 'app-decides'))?.days ?? 4;
  const days = prefs.daysPerWeek && prefs.daysPerWeek >= 1 ? prefs.daysPerWeek : resolvedStyle === 'daily' ? 7 : defaultDays;
  const daysPerWeek = Math.max(1, Math.min(7, Math.round(days)));
  const activeDays = pickActiveDays(daysPerWeek, resolvedStyle === 'weekend');

  const homeOn = focus.has('home');
  const lifeActive = [...focus].some((f) => f !== 'home');
  const lifeShare = lifeActive ? (homeOn ? 0.4 : 1) : 0;
  const homeShare = homeOn ? (lifeActive ? 0.6 : 1) : 0.25;

  let chunk = Math.min(sessionMinutes, ENERGY_CAP[energy]);
  if (prefs.learnedSessionCap) chunk = Math.min(chunk, prefs.learnedSessionCap);
  if (microSteps) chunk = Math.min(chunk, 15);
  if (goals.has('easier')) chunk = Math.min(chunk, 20);
  // When cleaning shares the day with habits, a cleaning job must fit inside cleaning's share, not the whole day.
  if (homeOn && lifeActive) chunk = Math.min(chunk, Math.round(sessionMinutes * homeShare));
  chunk = Math.max(5, chunk);

  const area = model.area;
  const sizeClass: SizeClass = area < 30 ? 'tiny' : area < 60 ? 'small' : area < 110 ? 'medium' : area < 190 ? 'large' : 'xl';
  const minimal = home.type === 'studio' || home.type === 'dorm' || area <= 45;
  const lean = resolvedStyle === 'only-necessary' || goals.has('less-time');

  const countKind = (k: RoomKind) => rooms.filter((r) => r.kind === k).length;
  return {
    home, prefs, rooms, zones: model.zones, floors: model.floors, area, sizeClass, minimal,
    shared: home.type === 'shared', people, adults, children, occTier, kidTier, pets, mess,
    problems: new Set(home.problemAreas), goals, blockers, focus, lifeLevel: prefs.lifeLevel ?? 1,
    fitnessLevel: prefs.fitnessLevel ?? 'beginner', equipment: prefs.equipment ?? 'none', lifeActive, homeOn, homeShare, lifeShare, energy, energyLow, microSteps, lean,
    style: resolvedStyle, sessionMinutes, daysPerWeek, activeDays,
    weeklyCapacity: sessionMinutes * daysPerWeek, chunkLimit: chunk,
    count: countKind,
    byKind: (k) => rooms.filter((r) => r.kind === k),
  };
};
