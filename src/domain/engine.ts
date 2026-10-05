import { PHASE_ORDER, TEMPLATES, type Template } from './catalog';
import { deriveContext, type Ctx } from './context';
import { assignSchedule } from './planner';
import { buildLifeTasks } from './life';
import { LADDER, isLife, occurrencesPerWeek, priorityOf } from './scoring';
import type {
  Home, Preferences, PlanMeta, ProblemArea, ResetPhase, Room, Task,
} from './types';

/**
 * The personalization engine.
 *
 *   Home + Preferences ──▶ Ctx (derived facts)
 *        ──▶ instantiate catalog templates (per room / floor / home)
 *        ──▶ scale minutes, step frequencies by people / kids / pets
 *        ──▶ split oversized tasks into session-sized parts
 *        ──▶ fit the recurring load into the user's weekly time budget
 *        ──▶ schedule (balanced by weekday, grouped by zone)
 *
 * Every adaptation is recorded as a `PlanNote` so the UI can explain *why*
 * this plan looks the way it does.
 */

export interface PlanNote { id: string; icon: string; title: string; detail: string }

export interface PlanStats {
  taskCount: number;
  recurringCount: number;
  resetCount: number;
  deepCount: number;
  backlogCount: number;
  weeklyMinutes: number;
  naturalWeeklyMinutes: number;
  weeklyCapacity: number;
  habitMinutesPerDay: number;
  resetMinutes: number;
  splitCount: number;
  skippedExtras: number;
  stretched: number;
  lifeCount: number;
  lifeDailyMinutes: number;
  lifeDayBudget: number;
}

export interface Plan {
  tasks: Task[];
  rooms: Room[];
  notes: PlanNote[];
  stats: PlanStats;
  activeDays: number[];
  sessionMinutes: number;
  chunkLimit: number;
  microSteps: boolean;
  zones: string[];
  startDate: string;
  mess: number;
}

export { LADDER, isLife, occurrencesPerWeek, priorityOf };

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const resolve = <T,>(v: T | ((c: Ctx, r: Room | null) => T), c: Ctx, r: Room | null): T =>
  typeof v === 'function' ? (v as (c: Ctx, r: Room | null) => T)(c, r) : v;

const roundMinutes = (m: number): number => {
  if (m < 10) return Math.max(2, Math.round(m));
  if (m < 15) return Math.round(m);
  return Math.round(m / 5) * 5;
};

const OUTSIDE = ['balcony', 'garage', 'basement', 'attic'];

const implicitTopics = (t: Template, r: Room | null): ProblemArea[] => {
  const out = new Set<ProblemArea>(t.topics ?? []);
  const cat = t.category;
  if (cat === 'Floors') out.add('floors');
  if (cat === 'Dust') out.add('dust');
  if (cat === 'Laundry' || cat === 'Bedding') out.add('laundry');
  if (cat === 'Clutter') out.add('clutter');
  if (cat === 'Trash') out.add('trash');
  if (cat === 'Dishes') out.add('dishes');
  if (cat === 'Windows') out.add('windows');
  if (cat === 'Organization') out.add('organization');
  if (r?.kind === 'kitchen') out.add('kitchen');
  if (r?.kind === 'bathroom') out.add('bathroom');
  if (r?.kind === 'bedroom') out.add('bedroom');
  if (r?.kind === 'living') out.add('living-room');
  return [...out];
};

const matchRooms = (c: Ctx, kind: string): Room[] =>
  c.rooms.filter((r) => r.kind === kind || (kind === 'bedroom' && r.sleeps) || (kind === 'living' && r.sleeps && r.kind === 'bedroom'));

const homeRoom = (c: Ctx): Room => ({ id: 'home', kind: 'home', name: 'Whole home', floor: 0, areaM2: c.area, zone: c.zones[0] ?? 'Home' });

const floorPseudoRooms = (c: Ctx): Room[] => {
  const out: Room[] = [];
  for (let f = 0; f < c.floors; f++) {
    const inFloor = c.rooms.filter((r) => !r.virtual && !OUTSIDE.includes(r.kind) && r.floor === f);
    if (!inFloor.length && c.floors > 1) continue;
    const area = c.floors === 1 ? c.area : inFloor.reduce((s, r) => s + r.areaM2, 0);
    const zone = inFloor[0]?.zone ?? 'Home';
    out.push({ id: `home-f${f}`, kind: 'home', name: c.floors > 1 ? zone : 'Whole home', floor: f, areaM2: Math.max(area, 8), zone });
  }
  return out;
};

const messFloor = (c: Ctx): number =>
  Math.max(c.mess, c.goals.has('recover') || c.goals.has('under-control') ? 2 : 0);

const resetIncluded = (phase: ResetPhase | undefined, mess: number): boolean => {
  if (mess >= 3) return true;
  if (mess === 2) return phase === 'trash' || phase === 'dishes' || phase === 'clutter';
  return false;
};

interface Counters { splitCount: number; skippedExtras: number; stretched: number; stepped: Set<string>; lessUsed: number }

interface Instance extends Task { _tpl: Template; _essential: boolean; _keep: boolean; _base?: number }

/** Instantiate one template for one room. Returns null when it does not apply. */
const instantiate = (t: Template, c: Ctx, r: Room | null, mess: number, cnt: Counters): Instance | null => {
  if (t.when && !t.when(c, r)) return null;
  const tags = t.tags ?? [];
  const isReset = t.tier === 'reset';
  const keep = !!t.keep?.(c, r);
  if (!isReset && t.tier !== 'deep' && !keep) {
    if ((tags.includes('extra') && (c.minimal || c.lean)) || (tags.includes('nicety') && c.lean)) { cnt.skippedExtras++; return null; }
  }
  const room = r ?? homeRoom(c);
  const adj = t.adjust?.(c, r) ?? null;
  const notes: string[] = [];

  // minutes
  let minutes = resolve(t.minutes, c, r) * (adj?.minutesMult ?? 1);
  minutes = roundMinutes(minutes);

  // frequency
  let freq = t.freq;
  let delta = 0;
  const idx = LADDER.indexOf(freq);
  if (idx >= 0) {
    const s = t.step ?? {};
    const occBase = c.occTier >= 3 ? 2 : c.occTier >= 2 ? 1 : 0;
    const occ = Math.min(s.occ ?? 0, occBase);
    const kids = s.kids && c.kidTier >= 1 ? 1 : 0;
    const pets = s.pets && c.pets.sheds && c.pets.indoor && (!s.petRooms || (r && s.petRooms.includes(r.kind))) ? 1 : 0;
    const up = Math.min(s.max ?? 2, occ + kids + pets, adj?.capUp ?? 99);
    delta = up + (adj?.steps ?? 0);
    if (up > 0) {
      const why: string[] = [];
      if (occ) why.push(`${c.people} people live here`);
      if (kids) why.push(c.children > 1 ? 'you have kids' : 'you have a child');
      if (pets) why.push('your pets shed');
      notes.push(`Done more often because ${why.join(' and ')}.`);
      cnt.stepped.add(t.id);
    }
    if (adj?.note) { notes.push(adj.note); if ((adj.steps ?? 0) < 0) cnt.lessUsed++; }
    freq = LADDER[clamp(idx + delta, 0, LADDER.length - 1)];
  }

  // low energy → heavy tasks come up less often
  if (!isReset && t.tier !== 'deep' && c.energyLow && t.difficulty === 3 && LADDER.indexOf(freq) > 0 && freq !== 'daily') {
    freq = LADDER[LADDER.indexOf(freq) - 1];
    notes.push('Spaced out a little because it is a heavy task and your energy is low.');
    cnt.stretched++;
  }

  const topics = implicitTopics(t, r);
  const problemHits = topics.filter((p) => c.problems.has(p)).length;
  let score = t.base;
  if (tags.includes('essential')) score += 5;
  if (freq === 'daily') score += 3;
  if (delta > 0) score += 4;
  score += problemHits ? 10 + Math.min(6, (problemHits - 1) * 4) : 0;
  if (isReset) score += 8 + Math.max(0, mess - 3) * 4;
  if (!isReset && t.tier !== 'deep' && mess >= 4 && !tags.includes('essential')) score -= 8;
  if (c.goals.has('declutter') && t.category === 'Clutter') score += 6;
  if (c.goals.has('guests') && room && ['living', 'bathroom', 'hallway'].includes(room.kind)) score += 4;
  if (c.goals.has('less-overwhelm') && tags.includes('quick')) score += 4;
  score = clamp(Math.round(score), 5, 100);
  if (problemHits) notes.push('You listed this as a problem area, so it gets extra priority.');

  const baseReason = resolve(t.reason, c, r);
  if (keep) notes.push('Kept as a daily habit because you want a better morning routine.');
  const reason = [baseReason, ...notes].join(' ');
  const steps = resolve(t.steps, c, r);
  const tiny = t.tiny ? resolve(t.tiny, c, r) : steps;

  const task: Instance = {
    id: `${t.id}:${room.id}`,
    templateId: t.id,
    name: resolve(t.name, c, r),
    roomId: room.id,
    roomKind: room.kind,
    roomName: room.name,
    category: t.category,
    minutes,
    difficulty: t.difficulty,
    frequency: freq,
    cadence: { kind: 'once' },
    priority: priorityOf(score),
    score,
    impact: clamp(t.impact + (problemHits ? 1 : 0), 1, 10),
    reason,
    substeps: steps,
    tinySteps: tiny,
    tier: t.tier ?? 'maintenance',
    phase: t.phase,
    habit: tags.includes('habit') || keep,
    quickWin: tags.includes('quick') || (minutes <= 5 && t.impact >= 7),
    zone: room.zone,
    floor: room.floor,
    startDate: null,
    needs: t.needs ?? [],
    topics,
    domain: 'home',
    timeOfDay: t.time ?? 'anytime',
    routine: !!t.time,
    _tpl: t,
    _essential: tags.includes('essential'),
    _keep: keep,
  };
  if (t.tier === 'deep') { task.frequency = 'deep'; }
  return task;
};

/** Split a long task into sessions that fit the user's realistic chunk size. */
const splitTask = (t: Instance, limit: number, cnt: Counters): Instance[] => {
  if (t.tier === 'deep' || t.frequency === 'daily' || t.habit) return [t];
  if (t.minutes <= limit * 1.25) return [t];
  const parts = Math.min(4, Math.max(2, Math.ceil(t.minutes / limit)));
  const per = Math.max(3, Math.round(t.minutes / parts));
  cnt.splitCount++;
  const sliceSteps = (steps: string[], i: number): string[] => {
    if (steps.length >= parts * 2) {
      const size = Math.ceil(steps.length / parts);
      return steps.slice(i * size, (i + 1) * size);
    }
    return [`Part ${i + 1} of ${parts}: cover about ${Math.round(100 / parts)}% of the space, then stop`, ...steps];
  };
  return Array.from({ length: parts }, (_, i) => ({
    ...t,
    id: `${t.id}#${i + 1}`,
    name: `${t.name} (part ${i + 1} of ${parts})`,
    minutes: per,
    substeps: sliceSteps(t.substeps, i),
    tinySteps: sliceSteps(t.tinySteps, i),
    score: t.score - i,
    part: { index: i + 1, of: parts },
  }));
};

const buildInstances = (c: Ctx, mess: number, cnt: Counters, forceReset: boolean): Instance[] => {
  const out: Instance[] = [];
  for (const t of TEMPLATES) {
    const isReset = t.tier === 'reset';
    if (isReset && !forceReset && !resetIncluded(t.phase, mess)) continue;
    if (isReset && forceReset && t.phase === undefined) continue;

    const targets: (Room | null)[] = [];
    if (t.scope === 'floor') targets.push(...floorPseudoRooms(c));
    else if (t.rooms === 'home') targets.push(null);
    else {
      const matched = new Map<string, Room>();
      for (const k of t.rooms) for (const r of matchRooms(c, k)) matched.set(r.id, r);
      let list = [...matched.values()];
      if (!list.length && t.fallback) {
        for (const k of t.fallback) {
          const m = matchRooms(c, k);
          if (m.length) { list = [m[0]]; break; }
        }
      }
      if (t.scope === 'home') targets.push(list[0] ?? null);
      else targets.push(...list);
    }
    for (const r of targets) {
      const inst = instantiate(t, c, r, mess, cnt);
      if (inst) out.push(inst);
    }
  }
  return out;
};

const strip = (t: Instance): Task => {
  const { _tpl, _essential, _keep, ...rest } = t;
  void _tpl; void _essential; void _keep;
  return rest;
};

/** The "My home is a mess" sequence: reset tasks for every phase, ignoring cleanliness threshold. */
export const buildResetTasks = (home: Home, prefs: Preferences): Task[] => {
  const c = deriveContext(home, prefs);
  const cnt: Counters = { splitCount: 0, skippedExtras: 0, stretched: 0, stepped: new Set(), lessUsed: 0 };
  const mess = Math.max(messFloor(c), 3);
  const inst = buildInstances(c, mess, cnt, true).filter((t) => t.tier === 'reset');
  const cap = Math.max(10, Math.min(15, c.chunkLimit));
  const split = inst.flatMap((t) => splitTask(t, cap, cnt));
  return split
    .map(strip)
    .sort((a, b) => PHASE_ORDER.indexOf(a.phase!) - PHASE_ORDER.indexOf(b.phase!) || b.impact - a.impact || b.score - a.score);
};

const keepScore = (t: Task): number => t.score + t.impact * 3 + (t.priority === 'URGENT' ? 40 : 0);

export const generatePlan = (home: Home, prefs: Preferences, meta: PlanMeta): Plan => {
  const c = deriveContext(home, prefs);
  const cnt: Counters = { splitCount: 0, skippedExtras: 0, stretched: 0, stepped: new Set(), lessUsed: 0 };
  const mess = messFloor(c);
  const homeOn = c.focus.has('home');
  const base = homeOn ? buildInstances(c, mess, cnt, false) : [];
  let tasks: Instance[] = base.flatMap((t) => splitTask(t, c.chunkLimit, cnt));

  // ── Fit recurring load into the weekly time budget ──
  const recurring = () => tasks.filter((t) => t.tier === 'maintenance' && LADDER.includes(t.frequency) && !t.backlog);
  const nonHabit = () => recurring().filter((t) => !t.habit);
  const weeklyLoad = () => nonHabit().reduce((s, t) => s + t.minutes * occurrencesPerWeek(t.frequency, c.activeDays.length, false), 0);
  const habits = () => recurring().filter((t) => t.habit);
  const habitPerDay = () => habits().reduce((s, t) => s + t.minutes * (occurrencesPerWeek(t.frequency, c.activeDays.length, true) / 7), 0);

  // When life-layer goals are on too, home cleaning shares the user's time with them.
  const homeShare = c.lifeActive && homeOn ? 0.65 : 1;
  const cap = c.weeklyCapacity * homeShare * (c.goals.has('deep-clean') ? 0.75 : 1);
  tasks.forEach((t) => { t._base = LADDER.indexOf(t.frequency); });
  const levels = (t: Instance) => (t._base ?? 0) - LADDER.indexOf(t.frequency);
  // Essentials never relax; nice-to-haves relax two levels, everything else one (weekly → biweekly).
  // Anything that still doesn't fit goes to the backlog instead of becoming a quarterly chore.
  const maxLevels = (t: Instance) =>
    t._essential ? 0 : t._tpl.tags?.some((g) => g === 'extra' || g === 'nicety') || t.score < 36 ? 2 : 1;
  const canStretch = (t: Instance) => !t._keep && LADDER.indexOf(t.frequency) > 0 && levels(t) < maxLevels(t);
  const naturalLoad = weeklyLoad();
  let stretched = 0;
  let guard = 0;
  while (weeklyLoad() > cap && guard++ < 3000) {
    // Spread the sacrifice: always relax the task that has given up the least and matters the least.
    const target = nonHabit().filter(canStretch).sort((a, b) => keepScore(a) + 22 * levels(a) - (keepScore(b) + 22 * levels(b)))[0];
    if (target) {
      target.frequency = LADDER[LADDER.indexOf(target.frequency) - 1];
      stretched++;
      continue;
    }
    // Nothing left to relax: park the task with the least value per weekly minute.
    const weekly = (t: Instance) => t.minutes * occurrencesPerWeek(t.frequency, c.activeDays.length, false);
    const pool = nonHabit().sort((a, b) => keepScore(a) / (weekly(a) + 0.5) - keepScore(b) / (weekly(b) + 0.5));
    const parked = pool.find((t) => !t._essential && !t._keep) ?? pool[0];
    if (!parked) break;
    parked.backlog = true;
  }

  // Habits get their own daily micro-budget (they run on non-cleaning days too).
  const habitBudget = Math.max(6, Math.min(c.activeDays.length >= 5 ? 20 : 15, c.sessionMinutes));
  guard = 0;
  while (habitPerDay() > habitBudget && guard++ < 200) {
    const cands = habits().filter((t) => !t._keep && LADDER.indexOf(t.frequency) > LADDER.indexOf('weekly')).sort((a, b) => keepScore(a) - keepScore(b));
    if (!cands.length) break;
    cands[0].frequency = LADDER[LADDER.indexOf(cands[0].frequency) - 1];
    stretched++;
  }
  cnt.stretched += stretched;

  // ── Schedule ──
  const { resetDays, resetMinutes } = assignSchedule(tasks, c, meta);

  const backlogCount = tasks.filter((t) => t.backlog).length;
  const life = buildLifeTasks(c, meta.startDate);
  const final = [...tasks.map(strip), ...life.tasks];

  const stats: PlanStats = {
    taskCount: final.length,
    recurringCount: final.filter((t) => !isLife(t) && t.tier === 'maintenance' && LADDER.includes(t.frequency) && !t.backlog).length,
    resetCount: final.filter((t) => t.tier === 'reset').length,
    deepCount: final.filter((t) => t.tier === 'deep').length,
    backlogCount,
    weeklyMinutes: Math.round(weeklyLoad()),
    naturalWeeklyMinutes: Math.round(naturalLoad),
    weeklyCapacity: c.weeklyCapacity,
    habitMinutesPerDay: Math.round(habitPerDay()),
    resetMinutes,
    splitCount: cnt.splitCount,
    skippedExtras: cnt.skippedExtras,
    stretched: cnt.stretched,
    lifeCount: life.picked,
    lifeDailyMinutes: life.dailyMinutes,
    lifeDayBudget: life.dayBudget,
  };

  const notes = buildNotes(c, stats, cnt, mess, resetDays, final.filter((t) => !isLife(t)), life.tasks);
  return {
    tasks: final, rooms: c.rooms, notes, stats, activeDays: c.activeDays, sessionMinutes: c.sessionMinutes,
    chunkLimit: c.chunkLimit, microSteps: c.microSteps, zones: c.zones, startDate: meta.startDate, mess,
  };
};

// ───────────────────────── Explanations ─────────────────────────

const buildNotes = (c: Ctx, s: PlanStats, cnt: Counters, mess: number, resetDays: number, tasks: Task[], lifeTasks: Task[]): PlanNote[] => {
  const n: PlanNote[] = [];
  const push = (id: string, icon: string, title: string, detail: string) => n.push({ id, icon, title, detail });

  const homeOn = c.focus.has('home');
  if (homeOn) {
    const type = c.home.type;
    if (c.minimal) {
      push('size', 'home', `Compact home (about ${c.area} m²)`, `We merged floor care into one quick pass and skipped ${cnt.skippedExtras} tasks a small space doesn't need.`);
    } else if (c.sizeClass === 'large' || c.sizeClass === 'xl') {
      push('size', 'home', `Larger home (about ${c.area} m²)`, `Cleaning is split into ${c.zones.length} zone${c.zones.length === 1 ? '' : 's'} (${c.zones.join(', ')}) so each session covers one area instead of everything.`);
    } else {
      push('size', 'home', `Mid-size home (about ${c.area} m²)`, 'Room-sized tasks are timed for the rooms you actually have.');
    }
    const baths = c.count('bathroom');
    if (baths >= 2) push('baths', 'bath', `${baths} bathrooms`, 'Every bathroom gets its own tasks. Bathrooms that are used less get a lighter rhythm.');
    if (c.floors > 1) push('floors', 'layers', `${c.floors} floors`, `Tasks are grouped by floor (${c.zones.filter((z) => z !== 'Outside & utility spaces').join(' / ')}) so you are not carrying supplies up and down.`);
    if (c.occTier >= 2) push('people', 'users', `${c.people} people at home`, 'Dishes, laundry, trash and bathroom tasks happen more often and take a bit longer.');
    if (c.children > 0) push('kids', 'baby', c.children > 1 ? 'Kids at home' : 'A child at home', 'Table, floor and entrance tasks are more frequent because kids create more crumbs and clutter.');
    if (c.pets.any) {
      const bits = [c.pets.sheds && c.pets.indoor ? 'extra vacuuming and furniture hair removal' : '', c.pets.features.has('litter') && c.pets.cats ? 'daily litter scooping' : '', c.pets.features.has('feeding') ? 'feeding-area cleanup' : ''].filter(Boolean);
      push('pets', 'paw', 'Pets', bits.length ? `Added ${bits.join(', ')}.` : 'Added pet-specific tasks for what you told us about.');
    }
    if (type === 'shared') push('shared', 'users', 'Shared apartment', 'Only your own bedroom is on your list. Common areas are marked so you can agree on a rotation.');
    if (type === 'dorm') push('dorm', 'home', 'Dorm room', 'Shared bathroom and kitchen tasks are kept light, with the focus on your own space.');
    if (mess >= 4) push('mess', 'sparkles', 'Reset first, maintenance second', `Your home needs a reset, so a gentle reset phase (${s.resetCount} small steps, about ${s.resetMinutes} minutes in total, spread over ${Math.max(1, resetDays)} cleaning day${resetDays === 1 ? '' : 's'}) comes before the regular routine begins.`);
    else if (mess >= 2) push('mess', 'sparkles', 'Light reset included', 'A few quick reset tasks (trash, dishes, clutter) come first, then your routine.');

  }
  push('time', 'clock', `${c.sessionMinutes}-minute sessions, ${c.daysPerWeek} day${c.daysPerWeek === 1 ? '' : 's'} a week`, s.splitCount ? `${s.splitCount} bigger task${s.splitCount === 1 ? ' was' : 's were'} split into parts so no session runs over ${c.chunkLimit} minutes.` : 'Every task fits inside a single session.');
  if (c.energyLow) push('energy', 'battery', 'Low energy mode', 'Smaller tasks, tiny steps, and heavy jobs spaced further apart.');
  if (c.microSteps) push('micro', 'list', 'Tiny steps', 'Tasks open as one-step-at-a-time checklists, so you never face the whole job at once.');
  if (c.activeDays.length < 5 && tasks.some((t) => t.habit)) push('habits', 'repeat', 'Daily micro-habits', `A few essentials (${tasks.filter((t) => t.habit).slice(0, 3).map((t) => t.name.toLowerCase()).join(', ')}) run daily, about ${s.habitMinutesPerDay} min a day, so nothing critical waits for your cleaning days.`);
  if (s.stretched > 0 || s.backlogCount > 0) push('fit', 'scale', 'Fitted to your time', `We spaced out ${s.stretched} lower-impact task${s.stretched === 1 ? '' : 's'}${s.backlogCount ? ` and parked ${s.backlogCount} in your backlog` : ''} so the week fits about ${s.weeklyMinutes} of your ${s.weeklyCapacity} minutes.${s.naturalWeeklyMinutes > s.weeklyCapacity * 1.15 ? ` Covering everything would take about ${s.naturalWeeklyMinutes} minutes a week, so a couple of extra 10-minute sessions would bring more of the backlog into your routine.` : ''}`);
  if (c.lean) push('lean', 'minus', 'Essentials only', 'Nice-to-have tasks were left out to keep cleaning short.');
  if (c.lifeActive) {
    const picked = lifeTasks.filter((t) => !t.challenge);
    const challenges = lifeTasks.length - picked.length;
    push('life', 'sprout', 'Your daily discipline plan', `${picked.length} small habits, about ${s.lifeDailyMinutes} minutes a day, chosen from the ${[...c.focus].filter((f) => f !== 'home').length} area${[...c.focus].filter((f) => f !== 'home').length === 1 ? '' : 's'} you picked (budget ${s.lifeDayBudget} min a day). ${challenges ? `${challenges} optional challenge${challenges === 1 ? '' : 's'} sit one step above your level.` : ''}`.trim());
  }
  return n;
};

export { OUTSIDE };
