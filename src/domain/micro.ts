import { deriveContext, type Ctx } from './context';
import { DOMAIN_SHORT } from './options';
import type { AppData, LifeDomain, LifeFocus, ProblemArea, Room, RoomKind, Task } from './types';

/**
 * "Just 5 Minutes": a pool of genuinely tiny actions. The picker chooses ONE
 * that fits the home, the user's problem areas and energy, and avoids repeats.
 */
interface Micro {
  id: string;
  name: string;
  rooms: RoomKind[];
  fallback?: RoomKind[];
  category: string;
  impact: number;
  effort: 1 | 2;
  topics?: ProblemArea[];
  steps: string[];
  when?: (c: Ctx) => boolean;
  /** Life-layer micro-task: only offered when the user picked one of these focus areas. */
  life?: { domain: LifeDomain; focus: LifeFocus[] };
}

const M = (m: Micro): Micro => m;

export const MICRO: Micro[] = [
  M({ id: 'trash', name: 'Throw away visible trash', rooms: ['living', 'bedroom', 'kitchen'], category: 'Trash', impact: 10, effort: 1, topics: ['trash'], steps: ['Grab a bag or use the bin', 'Walk once around the room', 'Toss every wrapper, tissue and packaging you see'] }),
  M({ id: 'counter', name: 'Clear one kitchen counter', rooms: ['kitchen'], category: 'Kitchen', impact: 9, effort: 1, topics: ['kitchen', 'kitchen-surfaces'], steps: ['Pick the counter you see most', 'Put things where they belong or in the sink', 'Give it one wipe'] }),
  M({ id: 'five-items', name: 'Put 5 things back where they belong', rooms: ['living', 'bedroom'], category: 'Clutter', impact: 9, effort: 1, topics: ['clutter', 'organization'], steps: ['Pick up 5 things that are out of place', 'Walk each one to its home', 'Done, even if more remain'] }),
  M({ id: 'bath-sink', name: 'Wipe the bathroom sink', rooms: ['bathroom'], category: 'Bathroom', impact: 7, effort: 1, topics: ['bathroom'], when: (c) => c.home.type !== 'dorm', steps: ['Clear the sink edge', 'Wipe the basin and tap with a damp cloth', 'Dry the tap'] }),
  M({ id: 'laundry-load', name: 'Start one load of laundry', rooms: ['laundry'], category: 'Laundry', impact: 8, effort: 1, topics: ['laundry'], steps: ['Grab what is nearest', 'Put it in the machine with detergent', 'Press start'] }),
  M({ id: 'five-dishes', name: 'Wash 5 dishes', rooms: ['kitchen'], fallback: ['bedroom', 'living'], category: 'Dishes', impact: 9, effort: 1, topics: ['dishes'], steps: ['Run hot water', 'Wash 5 items', 'Rack them'] }),
  M({ id: 'vacuum-small', name: 'Vacuum one small area', rooms: ['living', 'bedroom', 'hallway'], category: 'Floors', impact: 7, effort: 2, topics: ['floors', 'pet-hair'], steps: ['Pick the spot you walk through most', 'Vacuum just that patch', 'Stop whenever you like'] }),
  M({ id: 'dish-gather', name: 'Bring every cup and glass to the sink', rooms: ['living', 'bedroom'], category: 'Dishes', impact: 8, effort: 1, topics: ['dishes'], steps: ['Walk around once', 'Carry what you find to the sink', 'Pour out any leftovers'] }),
  M({ id: 'make-bed', name: 'Make the bed', rooms: ['bedroom'], category: 'Bedding', impact: 8, effort: 1, topics: ['bedroom'], steps: ['Pull the sheet straight', 'Pull up the duvet', 'Fluff the pillows'] }),
  M({ id: 'table', name: 'Clear and wipe the table', rooms: ['dining', 'kitchen', 'living'], category: 'Surfaces', impact: 7, effort: 1, topics: ['kitchen-surfaces'], steps: ['Move everything off the table', 'Wipe it', 'Put back only what belongs'] }),
  M({ id: 'bath-counter', name: 'Clear the bathroom counter', rooms: ['bathroom'], category: 'Bathroom', impact: 6, effort: 1, topics: ['bathroom', 'clutter'], when: (c) => c.home.type !== 'dorm', steps: ['Put the daily items in a basket', 'Throw away empties', 'Wipe the counter'] }),
  M({ id: 'fold-five', name: 'Fold 5 items of clean laundry', rooms: ['living', 'bedroom', 'laundry'], category: 'Laundry', impact: 6, effort: 1, topics: ['laundry'], steps: ['Take 5 items from the pile', 'Fold them', 'Put them away'] }),
  M({ id: 'floor-clothes', name: 'Put the clothes on the floor in a hamper', rooms: ['bedroom', 'living'], category: 'Laundry', impact: 8, effort: 1, topics: ['laundry', 'clutter', 'bedroom'], steps: ['Pick up every piece you can see', 'Dirty goes in the hamper', 'Clean goes back on a hanger or shelf'] }),
  M({ id: 'toilet-wipe', name: 'Wipe the toilet seat and handle', rooms: ['bathroom'], category: 'Bathroom', impact: 6, effort: 1, topics: ['bathroom'], when: (c) => c.home.type !== 'dorm', steps: ['Use a disinfectant wipe or a cloth with bathroom cleaner', 'Wipe the seat, lid and handle', 'Throw the wipe away and wash your hands'] }),
  M({ id: 'mirror', name: 'Spot-wipe the mirror', rooms: ['bathroom'], category: 'Bathroom', impact: 4, effort: 1, topics: ['bathroom'], when: (c) => c.home.type !== 'dorm', steps: ['Spray a cloth, not the mirror', 'Wipe the splashes', 'Done'] }),
  M({ id: 'entry', name: 'Tidy the entrance: shoes and coats', rooms: ['hallway'], fallback: ['living'], category: 'Clutter', impact: 6, effort: 1, topics: ['clutter', 'organization'], steps: ['Line up the shoes', 'Hang the coats', 'Take stray bags where they go'] }),
  M({ id: 'litter', name: 'Scoop the litter box', rooms: ['laundry', 'bathroom', 'kitchen'], category: 'Pets', impact: 8, effort: 1, topics: ['pet-hair'], when: (c) => c.pets.cats && c.pets.features.has('litter'), steps: ['Scoop into a bag', 'Tie it and bin it', 'Wash your hands'] }),
  M({ id: 'pet-bowls', name: 'Rinse the pet bowls and wipe the feeding spot', rooms: ['kitchen'], fallback: ['living'], category: 'Pets', impact: 6, effort: 1, when: (c) => c.pets.any && c.pets.features.has('feeding'), steps: ['Rinse and refill the bowls', 'Wipe the mat or floor', 'Done'] }),
  M({ id: 'lint-roll', name: 'Lint-roll the spot on the sofa where you sit', rooms: ['living'], category: 'Pets', impact: 5, effort: 1, topics: ['pet-hair'], when: (c) => c.pets.sheds && c.pets.indoor, steps: ['Grab a lint roller or damp rubber glove', 'Do one seat or cushion', 'Done'] }),
  M({ id: 'crumbs', name: 'Sweep the crumbs from the kitchen floor', rooms: ['kitchen'], category: 'Floors', impact: 6, effort: 1, topics: ['floors', 'kitchen'], steps: ['Grab a broom', 'Sweep the area by the table and stove', 'Dust-pan it and bin it'] }),
  M({ id: 'dish-rack', name: 'Empty the dish rack or dishwasher', rooms: ['kitchen'], category: 'Dishes', impact: 7, effort: 1, topics: ['dishes', 'kitchen'], steps: ['Put clean dishes away', 'Leave the rack or machine empty', 'Done'] }),
  M({ id: 'desk', name: 'Clear your desk of trash and cups', rooms: ['office'], fallback: ['living', 'bedroom'], category: 'Clutter', impact: 6, effort: 1, topics: ['clutter', 'organization'], steps: ['Toss trash', 'Take cups to the kitchen', 'Stack the papers neatly'] }),
  M({ id: 'stove', name: 'Wipe the stovetop splashes', rooms: ['kitchen'], category: 'Kitchen', impact: 6, effort: 1, topics: ['kitchen', 'kitchen-surfaces'], steps: ['Spray the stovetop', 'Wipe the spills', 'Dry'] }),
  M({ id: 'fridge-shelf', name: 'Toss expired food from one fridge shelf', rooms: ['kitchen'], category: 'Kitchen', impact: 6, effort: 1, topics: ['refrigerator'], steps: ['Open the fridge', 'Pick one shelf', 'Throw out anything past its date'] }),
  M({ id: 'ten-items', name: 'Collect 10 things that do not belong in this room', rooms: ['living', 'bedroom'], category: 'Clutter', impact: 8, effort: 1, topics: ['clutter', 'organization'], steps: ['Pick up 10 items that belong elsewhere', 'Put them in a basket', 'Drop the basket at the door of the right room'] }),
  M({ id: 'shelf', name: 'Wipe one shelf or surface', rooms: ['living', 'bedroom', 'office'], category: 'Dust', impact: 5, effort: 1, topics: ['dust'], steps: ['Take things off one shelf', 'Wipe it with a damp cloth', 'Put things back'] }),
  M({ id: 'mat', name: 'Shake out the entry mat', rooms: ['hallway'], fallback: ['living'], category: 'Floors', impact: 4, effort: 1, topics: ['floors'], when: (c) => c.children > 0 || c.pets.outdoor, steps: ['Take the mat outside', 'Shake it well', 'Put it back'] }),
  M({ id: 'put-away-dishes', name: 'Put away clean dishes', rooms: ['kitchen'], category: 'Dishes', impact: 6, effort: 1, topics: ['dishes'], steps: ['Open the dishwasher or rack', 'Put each thing where it lives', 'Done'] }),
  M({ id: 'balcony', name: 'Sweep the balcony quickly', rooms: ['balcony'], category: 'Outdoor', impact: 3, effort: 2, steps: ['Grab a broom', 'Sweep leaves and dust', 'Bin them'] }),
  M({ id: 'windowsill', name: 'Wipe one windowsill', rooms: ['living', 'bedroom', 'kitchen'], category: 'Windows', impact: 4, effort: 1, topics: ['windows', 'dust'], steps: ['Clear the sill', 'Wipe it', 'Put things back'] }),
];


// Life-layer micro tasks. Each takes about five minutes or less and needs no equipment.
const lm = (id: string, name: string, domain: LifeDomain, focus: LifeFocus[], impact: number, steps: string[], category = DOMAIN_SHORT[domain]): Micro =>
  M({ id, name, rooms: [], category, impact, effort: 1, steps, life: { domain, focus } });

export const LIFE_MICRO: Micro[] = [
  lm('l-breathe', 'Take 5 slow breaths', 'breathing', ['selfcare', 'focus', 'discipline'], 6, ['Relax your shoulders', 'Breathe in slowly through your nose', 'Breathe out a little more slowly. Repeat 5 times']),
  lm('l-water', 'Drink a glass of water', 'care', ['selfcare', 'healthy', 'discipline'], 6, ['Fill a glass', 'Drink it slowly']),
  lm('l-stretch', 'Stretch for 5 minutes', 'fitness', ['active', 'healthy', 'selfcare'], 6, ['Reach up tall and roll your shoulders', 'Gently stretch your back, legs and arms, about 20 seconds each', 'Stop if anything hurts']),
  lm('l-walk', 'Walk for 5 minutes', 'fitness', ['active', 'healthy', 'discipline'], 7, ['Put your shoes on', 'Walk at an easy pace around the block or your home', 'Stop if you feel unwell']),
  lm('l-squats', 'Do 8 chair squats', 'fitness', ['active', 'discipline'], 5, ['Stand in front of a sturdy chair', 'Sit back until you lightly touch it, then stand', 'Repeat 8 times at your own pace. Stop if anything hurts']),
  lm('l-top3', "Write today's top 3 priorities", 'mind', ['focus', 'discipline', 'organize', 'consistent'], 7, ['Grab a notebook or your notes app', 'Write the three things that matter most', 'Circle the first one']),
  lm('l-good', 'Write down one thing that went well today', 'mind', ['selfcare', 'consistent', 'evening'], 4, ['Think of one good thing, however small', 'Write it in a sentence']),
  lm('l-read', 'Read 5 pages', 'mind', ['focus', 'study', 'phone', 'evening'], 5, ['Pick up your book', 'Put your phone away', 'Read 5 pages']),
  lm('l-calendar', 'Check your calendar', 'admin', ['organize', 'consistent', 'discipline'], 5, ['Open your calendar', 'Look at today and tomorrow', 'Note anything to prepare']),
  lm('l-reply', 'Answer one message you have been avoiding', 'admin', ['organize', 'discipline'], 6, ['Open the message', 'Write a short reply', 'Send it']),
  lm('l-notify', 'Turn off 3 notifications', 'digital', ['phone', 'focus', 'organize'], 5, ['Open your notification settings', 'Find 3 apps that ping you for no good reason', 'Switch them off']),
  lm('l-nophone', 'Leave your phone in another room for 5 minutes', 'digital', ['phone', 'focus', 'discipline'], 6, ['Put your phone in another room', 'Do something screen-free', 'Come back after 5 minutes']),
  lm('l-study', 'Study for 5 minutes', 'learning', ['study', 'consistent'], 6, ['Pick one small topic', 'Set a 5-minute timer', 'Study only that until it rings']),
  lm('l-clothes', "Lay out tomorrow's clothes", 'sleep', ['evening', 'organize', 'morning'], 5, ['Choose an outfit', 'Put it where you will see it in the morning']),
  lm('l-outside', 'Step outside for 5 minutes', 'outdoor', ['healthy', 'selfcare', 'active'], 6, ['Step outside', 'Look around and take a few slow breaths', 'Come back in after 5 minutes']),
];

const toTask = (m: Micro, room: Room | null, c: Ctx): Task => ({
  id: `five:${m.id}:${room?.id ?? 'home'}`,
  templateId: `five:${m.id}`,
  name: m.name,
  roomId: room?.id ?? (m.life ? `life-${m.life.domain}` : 'home'),
  roomKind: room?.kind ?? 'home',
  roomName: room?.name ?? (m.life ? DOMAIN_SHORT[m.life.domain] : 'Whole home'),
  category: m.category,
  minutes: 5,
  difficulty: 1,
  frequency: 'once',
  cadence: { kind: 'once' },
  priority: 'MEDIUM',
  score: m.impact * 10,
  impact: m.impact,
  reason: 'A tiny, finishable step. Any progress counts.',
  substeps: m.steps,
  tinySteps: m.steps,
  tier: 'maintenance',
  habit: false,
  quickWin: true,
  zone: room?.zone ?? 'Home',
  floor: room?.floor ?? 0,
  startDate: null,
  needs: [],
  domain: m.life?.domain ?? 'home',
  topics: m.topics ?? [],
  notes: c.microSteps ? 'Just the first step is enough.' : undefined,
});

export const microCandidates = (data: AppData): { task: Task; micro: Micro }[] => {
  const c = deriveContext(data.home, data.preferences);
  const out: { task: Task; micro: Micro }[] = [];
  for (const m of LIFE_MICRO) {
    if (m.life && m.life.focus.some((f) => c.focus.has(f))) out.push({ task: toTask(m, null, c), micro: m });
  }
  if (!c.focus.has('home')) return out;
  for (const m of MICRO) {
    if (m.when && !m.when(c)) continue;
    const match = (k: RoomKind): Room[] => c.rooms.filter((r) => r.kind === k || (k === 'bedroom' && r.sleeps) || (k === 'living' && r.sleeps && r.kind === 'bedroom'));
    let rooms: Room[] = [];
    for (const k of m.rooms) { rooms = match(k); if (rooms.length) break; }
    if (!rooms.length && m.fallback) for (const k of m.fallback) { rooms = match(k); if (rooms.length) break; }
    if (!rooms.length) continue;
    // shared apartments: only your own bedroom
    const room = c.shared && rooms[0].kind === 'bedroom' ? rooms.find((r) => r.id === 'bedroom-1') ?? rooms[0] : rooms[0];
    out.push({ task: toTask(m, room, c), micro: m });
  }
  return out;
};

/** Pick ONE five-minute task. `exclude` carries the ids the user just saw/did. */
export const pickJustFive = (data: AppData, exclude: string[] = []): Task | null => {
  const c = deriveContext(data.home, data.preferences);
  const recent = [...exclude, ...data.fiveRecent];
  const scored = microCandidates(data).map(({ task, micro }) => {
    let s = micro.impact * 10;
    const hits = (micro.topics ?? []).filter((t) => c.problems.has(t)).length;
    s += hits * 12;
    if (micro.life) s += micro.life.focus.filter((f) => c.focus.has(f)).length * 10 - 8;
    if (c.mess >= 3 && ['trash', 'dishes', 'clutter'].some((k) => micro.category.toLowerCase().startsWith(k.slice(0, 4)))) s += 10;
    if (c.energyLow && micro.effort === 2) s -= 12;
    const idx = recent.indexOf(task.id);
    if (idx >= 0) s -= 60 - Math.min(40, idx * 5);
    return { task, s };
  });
  scored.sort((a, b) => b.s - a.s);
  return scored[0]?.task ?? null;
};
