import { emptyAppData } from './appdata';
import { emptyHome, emptyPreferences } from './context';
import { addDays, diffDays, toISO, todayISO, weekday } from './dates';
import { generatePlan } from './engine';
import { ROOM_DEFAULTS } from './options';
import type { AppData, CleaningSession, Home, Preferences, SessionEntry, TaskState } from './types';

export interface DemoProfile {
  id: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G';
  title: string;
  blurb: string;
  emoji: string;
  name: string;
  home: Home;
  prefs: Preferences;
}

const base = (type: Home['type'], patch: Partial<Home>, rooms: Partial<Home['rooms']> = {}): Home => {
  const d = ROOM_DEFAULTS[type!];
  return { ...emptyHome(), type, rooms: { ...d.rooms, ...rooms }, floors: d.floors, roomsTouched: true, ...patch };
};

export const DEMO_PROFILES: DemoProfile[] = [
  {
    id: 'A', title: 'Studio, low energy', emoji: '🛋️', name: 'Alex',
    blurb: 'Studio · 30 m² · 1 person · very messy · low energy · 10 min a day',
    home: base('studio', { sizeBand: '25-40', exactSizeM2: 30, adults: 1, children: 0, cleanliness: 'very-messy', problemAreas: ['dishes', 'laundry', 'clutter', 'trash'] }),
    prefs: { ...emptyPreferences(), style: 'daily', sessionMinutes: 10, daysPerWeek: 7, daysTouched: true, energy: 'low', blockers: ['overwhelming', 'where-to-start', 'tired'], goals: ['under-control', 'less-overwhelm', 'habits'] },
  },
  {
    id: 'B', title: '2-bed apartment with a cat', emoji: '🐈', name: 'Sam',
    blurb: 'Apartment · 75 m² · 2 adults · 1 cat · mostly clean · 30 min a day',
    home: base('apartment', { sizeBand: '61-80', exactSizeM2: 75, adults: 2, children: 0, cleanliness: 'mostly-clean', problemAreas: ['dust', 'pet-hair'], pets: { choice: 'cat', types: ['cat'], count: 1, access: ['indoor'], features: ['litter', 'feeding', 'beds', 'toys'] } },
      { bedrooms: 2, bathrooms: 1, livingRooms: 1, kitchens: 1, hallways: 1, balcony: 'small', diningRooms: 0 }),
    prefs: { ...emptyPreferences(), style: 'several-short', sessionMinutes: 30, daysPerWeek: 5, daysTouched: true, energy: 'medium', blockers: ['forget'], goals: ['consistent', 'weekly-routine'] },
  },
  {
    id: 'C', title: 'Family house with a dog', emoji: '🏡', name: 'Jordan',
    blurb: 'House · 150 m² · 2 adults + 2 kids · dog · quite messy · 45 min a day',
    home: base('house', { sizeBand: '131-160', exactSizeM2: 150, adults: 2, children: 2, cleanliness: 'quite-messy', floors: 2, problemAreas: ['floors', 'dishes', 'laundry', 'pet-hair', 'clutter'], pets: { choice: 'dog', types: ['dog'], count: 1, access: ['indoor', 'outdoor'], features: ['feeding', 'beds', 'toys'] } },
      { bedrooms: 3, bathrooms: 2, livingRooms: 1, kitchens: 1, diningRooms: 1, laundryRooms: 1, hallways: 2, storageRooms: 1, garage: '1-car', balcony: 'none', offices: 0 }),
    prefs: { ...emptyPreferences(), style: 'several-short', sessionMinutes: 45, daysPerWeek: 6, daysTouched: true, energy: 'medium', blockers: ['forget', 'too-many-things'], goals: ['under-control', 'daily-routine', 'declutter'] },
  },
  {
    id: 'D', title: 'Large house, weekends only', emoji: '🏠', name: 'Riley',
    blurb: 'House · 220 m² · 4 bed / 3 bath · 2 adults + 3 kids · 2 dogs · weekends',
    home: base('house', { sizeBand: '200+', exactSizeM2: 220, adults: 2, children: 3, cleanliness: 'little-messy', floors: 3, problemAreas: ['floors', 'laundry', 'pet-hair'], pets: { choice: 'dog', types: ['dog'], count: 2, access: ['indoor', 'outdoor'], features: ['feeding', 'beds', 'crates', 'toys'] } },
      { bedrooms: 4, bathrooms: 3, livingRooms: 2, kitchens: 1, diningRooms: 1, offices: 1, laundryRooms: 1, hallways: 2, storageRooms: 1, garage: '2-car', balcony: 'medium', basement: 'medium', attic: 'small' }),
    prefs: { ...emptyPreferences(), style: 'weekend', sessionMinutes: 45, daysPerWeek: 2, daysTouched: true, energy: 'low', blockers: ['no-time', 'tired'], goals: ['less-time', 'weekly-routine', 'consistent'] },
  },
  {
    id: 'E', title: 'Beginner: discipline & fitness', emoji: '🌱', name: 'Mia',
    blurb: 'No cleaning plan · 15 min a day · beginner fitness · discipline + movement',
    home: base('apartment', { sizeBand: '25-40', exactSizeM2: 35, adults: 1, cleanliness: 'mostly-clean' }, { bedrooms: 1, hallways: 0, livingRooms: 1 }),
    prefs: { ...emptyPreferences(), style: 'daily', sessionMinutes: 15, daysPerWeek: 7, daysTouched: true, energy: 'medium', blockers: ['procrastinate'], goals: ['habits'], focus: ['active', 'discipline'], fitnessLevel: 'beginner', equipment: 'none', lifeLevel: 1 },
  },
  {
    id: 'F', title: '60 minutes: home & organization', emoji: '🗂️', name: 'Noor',
    blurb: 'Apartment · 70 m² · 60 min · home + organize my life',
    home: base('apartment', { sizeBand: '61-80', exactSizeM2: 70, adults: 2, cleanliness: 'little-messy', problemAreas: ['clutter', 'dishes', 'organization'] }, { bedrooms: 2, bathrooms: 1, livingRooms: 1, kitchens: 1, offices: 1, hallways: 1 }),
    prefs: { ...emptyPreferences(), style: 'several-short', sessionMinutes: 60, daysPerWeek: 4, daysTouched: true, energy: 'high', blockers: ['clutter'], goals: ['declutter', 'weekly-routine'], focus: ['home', 'organize'], fitnessLevel: 'intermediate', equipment: 'none', lifeLevel: 2 },
  },
  {
    id: 'G', title: 'Student: study, focus & less phone', emoji: '📚', name: 'Sam K.',
    blurb: 'Dorm room · 30 min a day · study, focus, evening routine, phone-free time',
    home: base('dorm', { sizeBand: 'u25', exactSizeM2: 16, adults: 1, cleanliness: 'little-messy' }, { bathrooms: 0, kitchens: 0 }),
    prefs: { ...emptyPreferences(), style: 'daily', sessionMinutes: 30, daysPerWeek: 7, daysTouched: true, energy: 'medium', blockers: ['distracted'], goals: ['habits'], focus: ['home', 'study', 'focus', 'phone', 'evening'], fitnessLevel: 'beginner', equipment: 'none', lifeLevel: 1 },
  },
];

export const demoById = (id: DemoProfile['id']) => DEMO_PROFILES.find((d) => d.id === id)!;

export const appDataForDemo = (id: DemoProfile['id'], opts: { withHistory?: boolean; today?: string } = {}): AppData => {
  const today = opts.today ?? todayISO();
  const d = demoById(id);
  const data: AppData = {
    ...emptyAppData(today),
    user: { id: `demo_${id}`, name: d.name, createdAt: new Date().toISOString(), demo: true },
    home: structuredClone(d.home),
    preferences: structuredClone(d.prefs),
    onboardingComplete: true,
    plan: { startDate: opts.withHistory ? addDays(today, -21) : today, resetCount: 0 },
  };
  return opts.withHistory ? seedHistory(data, today) : data;
};

// Small deterministic PRNG so demo history is stable for a given profile.
const mulberry32 = (seed: number) => () => {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** Three weeks of believable activity so charts, streaks and insights have something to show. */
export const seedHistory = (data: AppData, today: string): AppData => {
  const rand = mulberry32(data.user.id.split('').reduce((a, ch) => a + ch.charCodeAt(0), 7));
  const plan = generatePlan(data.home, data.preferences, { startDate: addDays(today, -21), resetCount: 0 });
  const pool = plan.tasks.filter((t) => t.tier === 'maintenance' && !t.backlog && t.frequency !== 'once');
  const sessions: CleaningSession[] = [];
  const states: Record<string, TaskState> = {};
  const sessionMinutes = plan.sessionMinutes;

  for (let back = 21; back >= 1; back--) {
    const date = addDays(today, -back);
    const isActive = plan.activeDays.includes(weekday(date));
    // a few rest / missed days further back, but always some recent activity so the demo feels current
    if (back > 2 && !isActive && rand() > 0.3) continue;
    if (back > 2 && rand() < 0.22) continue;
    if (back <= 2 && !isActive && back === 2) continue;
    const entries: SessionEntry[] = [];
    let used = 0;
    const candidates = [...pool].sort(() => rand() - 0.5).sort((a, b) => b.score - a.score + (rand() - 0.5) * 30);
    let minute = 18 * 60;
    for (const t of candidates) {
      if (used + t.minutes > sessionMinutes * 1.05 || entries.length >= 6) continue;
      // skip long tasks sometimes (the learning rules pick up on that)
      const skipChance = t.minutes >= 20 ? 0.5 : 0.08;
      const skipped = rand() < skipChance;
      const at = new Date(`${date}T00:00:00`);
      at.setMinutes(minute);
      minute += t.minutes + 1;
      entries.push({
        id: `seed_${date}_${entries.length}`, at: at.toISOString(), date, taskId: t.id, name: t.name, roomKind: t.roomKind,
        roomName: t.roomName, category: t.category, plannedMinutes: t.minutes,
        actualMinutes: skipped ? 0 : Math.max(2, Math.round(t.minutes * (0.8 + rand() * 0.4))),
        outcome: skipped ? 'skipped' : 'completed', via: 'plan',
      });
      const st = states[t.id] ?? {};
      if (skipped) { st.skipStreak = (st.skipStreak ?? 0) + 1; st.skipTotal = (st.skipTotal ?? 0) + 1; }
      else { st.skipStreak = 0; st.lastDone = date; st.doneCount = (st.doneCount ?? 0) + 1; }
      states[t.id] = st;
      if (!skipped) used += t.minutes;
    }
    if (entries.length) sessions.push({ id: `seedS_${date}`, date, startedAt: entries[0].at, endedAt: entries[entries.length - 1].at, entries });
  }
  void diffDays; void toISO;
  return { ...data, sessions, taskStates: { ...data.taskStates, ...states } };
};
