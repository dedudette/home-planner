import { describe, expect, it } from 'vitest';
import { emptyAppData } from '../src/domain/appdata';
import { buildResetTasks } from '../src/domain/engine';
import { DEMO_PROFILES } from '../src/domain/demo';
import { buildRooms, deriveContext, emptyHome, emptyPreferences } from '../src/domain/context';
import { custom, demo, plan, TODAY } from './helpers';
import { weekday } from '../src/domain/dates';

const names = (p: ReturnType<typeof plan>) => p.tasks.map((t) => t.name);
const has = (p: ReturnType<typeof plan>, re: RegExp) => p.tasks.some((t) => re.test(t.name));
const count = (p: ReturnType<typeof plan>, id: string) => p.tasks.filter((t) => t.templateId === id).length;

describe('demo profiles produce clearly different plans', () => {
  const HOME_DEMOS = DEMO_PROFILES.filter((d) => ['A', 'B', 'C', 'D'].includes(d.id));
  const plans = Object.fromEntries(HOME_DEMOS.map((d) => [d.id, plan(demo(d.id))]));

  it('have different sizes, rhythms and task sets', () => {
    const counts = HOME_DEMOS.map((d) => plans[d.id].stats.recurringCount);
    expect(new Set(counts).size).toBe(4);
    expect(plans.A.stats.resetCount).toBeGreaterThan(plans.B.stats.resetCount); // very messy vs mostly clean
    expect(plans.B.stats.resetCount).toBe(0);
    expect(plans.C.zones.length).toBeGreaterThan(plans.A.zones.length);
  });

  it('A: studio is compact, low-energy friendly and starts with a reset phase', () => {
    const p = plans.A;
    expect(p.microSteps).toBe(true);
    expect(p.chunkLimit).toBeLessThanOrEqual(10);
    expect(p.tasks.every((t) => !/garage|basement|attic/i.test(t.roomName))).toBe(true);
    expect(p.tasks.some((t) => t.tier === 'reset')).toBe(true);
    expect(p.notes.some((n) => /reset/i.test(n.title))).toBe(true);
    // reset tasks come before maintenance
    const firstMaintenance = Math.min(...p.tasks.filter((t) => t.tier === 'maintenance' && !t.habit && t.startDate).map((t) => +new Date(t.startDate!)));
    const lastReset = Math.max(...p.tasks.filter((t) => t.tier === 'reset').map((t) => +new Date(t.startDate!)));
    expect(firstMaintenance).toBeGreaterThanOrEqual(lastReset);
  });

  it('B: cat tasks exist, no kid or dog tasks', () => {
    const p = plans.B;
    expect(has(p, /litter box/i)).toBe(true);
    expect(has(p, /pet bowls/i)).toBe(true);
    expect(has(p, /paws/i)).toBe(false);
    expect(p.tasks.filter((t) => t.templateId === 'br-bed')).toHaveLength(2);
  });

  it('C: family house gets floors, kids, dog, 2 bathrooms', () => {
    const p = plans.C;
    expect(count(p, 'b-toilet')).toBe(2);
    expect(has(p, /paws/i)).toBe(true);
    expect(has(p, /litter/i)).toBe(false);
    expect(p.rooms.some((r) => r.floor === 1)).toBe(true);
    expect(p.notes.some((n) => /floors/i.test(n.title))).toBe(true);
    const dishes = p.tasks.find((t) => t.templateId === 'k-dishes')!;
    expect(dishes.frequency).toBe('daily');
  });

  it('D: weekend-only, still keeps essentials daily, parks overflow honestly', () => {
    const p = plans.D;
    expect(p.activeDays.sort()).toEqual([0, 6]);
    expect(count(p, 'b-toilet')).toBe(3);
    expect(p.tasks.some((t) => t.habit && t.cadence.kind === 'days' && t.cadence.days.length > 2)).toBe(true);
    expect(p.stats.weeklyMinutes).toBeLessThanOrEqual(p.stats.weeklyCapacity);
    expect(p.stats.backlogCount).toBeGreaterThan(0);
    // all scheduled recurring tasks sit on cleaning days (habits excluded)
    for (const t of p.tasks.filter((x) => x.tier === 'maintenance' && !x.habit && x.cadence.kind === 'every' && x.startDate)) {
      expect(p.activeDays).toContain(weekday(t.startDate!));
    }
    expect(p.notes.some((n) => /Fitted/i.test(n.title))).toBe(true);
  });
});

describe('home type drives which rooms and tasks exist', () => {
  it('dorm: no garage, basement, attic, balcony even if stale answers say otherwise', () => {
    const d = custom('dorm', {}, { garage: '2-car', basement: 'large', attic: 'large', balcony: 'large', bedrooms: 4, diningRooms: 2, bathrooms: 1 });
    const p = plan(d);
    expect(p.rooms.map((r) => r.kind).sort()).toEqual(['bathroom', 'bedroom', 'laundry'].sort());
    expect(p.tasks.some((t) => /garage|basement|attic/i.test(t.roomName))).toBe(false);
  });

  it('studio: one main room doubling as bedroom and living room, bedroom tasks attach to it', () => {
    const d = custom('studio', {}, { bedrooms: 3 });
    const p = plan(d);
    expect(p.rooms.filter((r) => r.sleeps)).toHaveLength(1);
    expect(has(p, /make the bed/i)).toBe(true);
    expect(has(p, /quick tidy/i)).toBe(true);
    expect(p.tasks.filter((t) => t.templateId === 'br-bed')).toHaveLength(1);
  });

  it('house vs apartment: only houses get garages/floors', () => {
    const house = plan(custom('house', {}, { garage: '2-car', basement: 'medium', attic: 'small' }));
    const apt = plan(custom('apartment', {}, { garage: '2-car', basement: 'medium' }));
    expect(house.rooms.some((r) => r.kind === 'garage')).toBe(true);
    expect(apt.rooms.some((r) => r.kind === 'garage' || r.kind === 'basement')).toBe(false);
  });

  it('shared apartment: only your own bedroom gets personal tasks', () => {
    const p = plan(custom('shared', {}, { bedrooms: 4 }));
    expect(p.tasks.filter((t) => t.templateId === 'br-bed')).toHaveLength(1);
  });
});

describe('rule-based adaptation', () => {
  it('more bathrooms → more bathroom tasks', () => {
    const one = plan(custom('apartment', {}, { bathrooms: 1 }));
    const three = plan(custom('house', { floors: 1 }, { bathrooms: 3 }));
    expect(count(one, 'b-toilet')).toBe(1);
    expect(count(three, 'b-toilet')).toBe(3);
  });

  it('more occupants → dishes, laundry, trash are done more often', () => {
    const solo = plan(custom('apartment', { adults: 1 }, {}, { sessionMinutes: 90, daysPerWeek: 7 }));
    const crowd = plan(custom('apartment', { adults: 2, children: 3 }, {}, { sessionMinutes: 90, daysPerWeek: 7 }));
    const freq = (p: ReturnType<typeof plan>, id: string) => p.tasks.find((t) => t.templateId === id)!;
    expect(['weekly']).toContain(freq(solo, 'l-wash').frequency);
    expect(['daily', 'twice-weekly']).toContain(freq(crowd, 'l-wash').frequency);
    expect(freq(crowd, 'h-trash').frequency).not.toBe('weekly');
    expect(freq(crowd, 'k-dishes').minutes).toBeGreaterThan(freq(solo, 'k-dishes').minutes);
  });

  it('pets add vacuuming and pet tasks; no pets means none', () => {
    const base = { sessionMinutes: 90, daysPerWeek: 7 };
    const none = plan(custom('apartment', {}, {}, base));
    const dog = plan(custom('apartment', { pets: { choice: 'dog', types: ['dog'], count: 1, access: ['indoor', 'outdoor'], features: ['feeding', 'beds'] } }, {}, base));
    expect(has(none, /pet|litter|paws/i)).toBe(false);
    expect(has(dog, /paws/i)).toBe(true);
    expect(has(dog, /pet bowls/i)).toBe(true);
    const vac = (p: ReturnType<typeof plan>) => p.tasks.find((t) => t.templateId === 'fl-vac' && t.roomKind === 'living')!.frequency;
    expect(vac(none)).toBe('weekly');
    expect(vac(dog)).toBe('twice-weekly');
  });

  it('cat without a litter box (outdoor cat) gets no litter tasks', () => {
    const p = plan(custom('apartment', { pets: { choice: 'cat', types: ['cat'], count: 1, access: ['outdoor'], features: [] } }));
    expect(has(p, /litter/i)).toBe(false);
  });

  it('multiple floors distribute tasks across floors', () => {
    const p = plan(custom('house', { floors: 3 }, { bedrooms: 4, bathrooms: 3 }));
    const floors = new Set(p.tasks.filter((t) => t.roomKind === 'bedroom').map((t) => t.floor));
    expect(floors.size).toBeGreaterThan(1);
    expect(p.zones.length).toBeGreaterThanOrEqual(3);
  });

  it('low available time → shorter sessions: no task part exceeds the session length', () => {
    const p = plan(custom('house', {}, {}, { sessionMinutes: 10, daysPerWeek: 5, energy: 'high' }));
    for (const t of p.tasks.filter((x) => x.tier === 'maintenance' && !x.habit && x.frequency !== 'daily' && x.startDate)) {
      expect(t.minutes).toBeLessThanOrEqual(10 * 1.25 + 1);
    }
  });

  it('low energy → smaller tasks and tiny steps', () => {
    const hi = plan(custom('house', {}, {}, { energy: 'high', sessionMinutes: 60 }));
    const lo = plan(custom('house', {}, {}, { energy: 'very-low', sessionMinutes: 60 }));
    expect(lo.chunkLimit).toBeLessThan(hi.chunkLimit);
    expect(lo.microSteps).toBe(true);
    expect(Math.max(...lo.tasks.filter((t) => t.tier === 'maintenance' && !t.habit && t.frequency !== 'daily').map((t) => t.minutes))).toBeLessThanOrEqual(Math.max(...hi.tasks.filter((t) => t.tier === 'maintenance').map((t) => t.minutes)));
  });

  it('very messy home → reset tasks first, maintenance deferred; clean home → no reset', () => {
    const messy = plan(custom('apartment', { cleanliness: 'very-messy' }));
    const clean = plan(custom('apartment', { cleanliness: 'quite-clean' }));
    expect(messy.stats.resetCount).toBeGreaterThan(5);
    expect(clean.stats.resetCount).toBe(0);
    const resetStart = Math.max(...messy.tasks.filter((t) => t.tier === 'reset').map((t) => +new Date(t.startDate!)));
    const toilet = messy.tasks.find((t) => t.templateId === 'b-toilet')!;
    expect(+new Date(toilet.startDate!)).toBeGreaterThanOrEqual(resetStart);
  });

  it('small apartment avoids unnecessary tasks vs a large house', () => {
    const small = plan(custom('studio', { exactSizeM2: 22, sizeBand: 'u25' }));
    const big = plan(custom('house', { exactSizeM2: 220, sizeBand: '200+' }));
    expect(small.stats.taskCount).toBeLessThan(big.stats.taskCount / 2);
    expect(small.tasks.every((t) => t.templateId !== 'h-vents')).toBe(true);
  });

  it('goals shape the plan', () => {
    const base = custom('apartment', {}, {}, { goals: [] });
    const goals = custom('apartment', {}, {}, { goals: ['declutter', 'guests', 'daily-routine'] });
    expect(has(plan(base), /evening reset/i)).toBe(false);
    expect(has(plan(goals), /evening reset/i)).toBe(true);
    expect(has(plan(goals), /declutter 10/i)).toBe(true);
    expect(has(plan(goals), /guest-ready/i)).toBe(true);
  });
});

describe('robustness', () => {
  it('missing information still produces a usable plan', () => {
    const d = emptyAppData(TODAY);
    d.home = { ...emptyHome() };
    d.preferences = { ...emptyPreferences() };
    const p = plan(d);
    expect(p.tasks.length).toBeGreaterThan(3);
    expect(p.tasks.every((t) => Number.isFinite(t.minutes) && t.minutes > 0)).toBe(true);
  });

  it('extremes: tiny and huge homes, 5-minute sessions and 90+', () => {
    const tiny = plan(custom('studio', { exactSizeM2: 9 }, {}, { sessionMinutes: 5, daysPerWeek: 7, energy: 'very-low' }));
    const huge = plan(custom('house', { exactSizeM2: 600, children: 4, adults: 4 }, { bedrooms: 8, bathrooms: 6, livingRooms: 4, kitchens: 2, garage: 'large', basement: 'large', attic: 'large' }, { sessionMinutes: 90, daysPerWeek: 7 }));
    expect(tiny.tasks.length).toBeGreaterThan(0);
    expect(huge.tasks.length).toBeGreaterThan(tiny.tasks.length * 3);
    expect(huge.stats.weeklyMinutes).toBeLessThanOrEqual(huge.stats.weeklyCapacity);
    for (const t of [...tiny.tasks, ...huge.tasks]) expect(t.startDate === null || /^\d{4}-\d{2}-\d{2}$/.test(t.startDate)).toBe(true);
  });

  it('editing rooms changes the plan and keeps ids stable for unchanged rooms', () => {
    const a = plan(custom('apartment', {}, { bedrooms: 1 }));
    const b = plan(custom('apartment', {}, { bedrooms: 3 }));
    const ids = new Set(a.tasks.map((t) => t.id));
    expect(b.tasks.filter((t) => t.roomKind === 'bedroom').length).toBeGreaterThan(a.tasks.filter((t) => t.roomKind === 'bedroom').length);
    expect(b.tasks.filter((t) => ids.has(t.id)).length).toBeGreaterThan(10);
    const removed = plan(custom('apartment', {}, { bedrooms: 0 }));
    expect(removed.tasks.some((t) => t.templateId === 'br-bed')).toBe(false);
  });

  it('extra custom rooms get their own tasks', () => {
    const d = custom('apartment', { extraRooms: [{ id: 'x1', name: 'Craft room' }] });
    expect(plan(d).tasks.some((t) => /craft room/i.test(t.roomName))).toBe(true);
  });

  it('every task has the fields the UI relies on', () => {
    for (const dp of DEMO_PROFILES) {
      for (const t of plan(demo(dp.id)).tasks) {
        expect(t.name).toBeTruthy();
        expect(t.roomName).toBeTruthy();
        expect(t.reason).toBeTruthy();
        expect(['URGENT', 'HIGH', 'MEDIUM', 'LOW']).toContain(t.priority);
        expect(t.substeps.length).toBeGreaterThan(0);
      }
    }
  });

  it('task ids are unique', () => {
    for (const dp of DEMO_PROFILES) {
      const ids = plan(demo(dp.id)).tasks.map((t) => t.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('weekly load never exceeds the weekly time budget', () => {
    for (const dp of DEMO_PROFILES) {
      const p = plan(demo(dp.id));
      expect(p.stats.weeklyMinutes).toBeLessThanOrEqual(p.stats.weeklyCapacity);
    }
  });

  it('no scheduled day is overloaded beyond the session length (+10% and one big chunk)', () => {
    for (const dp of DEMO_PROFILES) {
      const p = plan(demo(dp.id));
      const byDay = new Map<string, number>();
      for (const t of p.tasks) {
        if (t.tier !== 'maintenance' || t.habit || t.backlog || t.cadence.kind !== 'every' || !t.startDate) continue;
        byDay.set(t.startDate, (byDay.get(t.startDate) ?? 0) + t.minutes);
      }
      for (const m of byDay.values()) expect(m).toBeLessThanOrEqual(p.sessionMinutes * 1.5 + 5);
    }
  });
});

describe('structure helpers', () => {
  it('rooms: areas sum roughly to home area and ids are stable', () => {
    const d = custom('house', { exactSizeM2: 150 }, {});
    const m = buildRooms(d.home);
    const interior = m.rooms.filter((r) => !['garage', 'balcony', 'basement', 'attic'].includes(r.kind));
    expect(Math.abs(interior.reduce((s, r) => s + r.areaM2, 0) - 150)).toBeLessThan(20);
    expect(m.rooms.map((r) => r.id)).toContain('bedroom-1');
  });

  it('context: unknown size falls back to an estimate', () => {
    const d = custom('apartment', { sizeBand: 'unknown', exactSizeM2: null });
    expect(deriveContext(d.home, d.preferences).area).toBeGreaterThan(20);
  });

  it('reset tasks are built for every phase in order', () => {
    const d = demo('A');
    const tasks = buildResetTasks(d.home, d.preferences);
    const phases = tasks.map((t) => t.phase);
    const order = ['trash', 'dishes', 'laundry', 'clutter', 'surfaces', 'bathroom', 'floors'];
    expect(new Set(phases)).toEqual(new Set(order));
    expect(phases.map((p) => order.indexOf(p!))).toEqual([...phases.map((p) => order.indexOf(p!))].sort((a, b) => a - b));
    expect(names(plan(d))).toBeTruthy();
  });
});
