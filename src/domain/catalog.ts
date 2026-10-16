import type { Ctx } from './context';
import type {
  Difficulty, Frequency, ProblemArea, ResetPhase, Room, RoomKind, SupplyNeed, Tier, TimeOfDay,
} from './types';

/**
 * The task catalog. Templates are *rules*, not tasks: the engine instantiates
 * each one per matching room/floor, scales the minutes, adjusts the frequency
 * for people/pets/kids, and decides whether it belongs in this home at all.
 */

type Fn<T> = T | ((c: Ctx, r: Room | null) => T);

export type Tag = 'habit' | 'essential' | 'extra' | 'nicety' | 'quick';

export interface Adjust { steps?: number; note?: string; minutesMult?: number; capUp?: number }

export interface Template {
  id: string;
  /** Room kinds this applies to (first available is used for scope 'home'). */
  rooms: RoomKind[] | 'home';
  /** Used when the home has none of `rooms`. */
  fallback?: RoomKind[];
  scope?: 'room' | 'home' | 'floor';
  name: Fn<string>;
  category: string;
  minutes: Fn<number>;
  difficulty: Difficulty;
  freq: Frequency;
  tier?: Tier;
  phase?: ResetPhase;
  /** Suggested time of day; marks the task as part of a morning/afternoon/evening routine. */
  time?: TimeOfDay;
  impact: number;
  base: number;
  tags?: Tag[];
  topics?: ProblemArea[];
  needs?: SupplyNeed[];
  steps: Fn<string[]>;
  tiny?: Fn<string[]>;
  reason: Fn<string>;
  when?: (c: Ctx, r: Room | null) => boolean;
  /** Frequency step-ups (towards "more often") per household factor. 0 = ignore. */
  step?: { occ?: 0 | 1 | 2; kids?: 0 | 1; pets?: 0 | 1; max?: number; petRooms?: RoomKind[] };
  adjust?: (c: Ctx, r: Room | null) => Adjust | null;
  /**
   * Protect this task from the weekly time-fitting (it stays at its base frequency and runs every day like a habit)
   * when it is the anchor of something the user explicitly asked for.
   */
  keep?: (c: Ctx, r: Room | null) => boolean;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
/** Scale base minutes by room area relative to a reference room size. */
const sz = (base: number, ref: number, lo = 0.7, hi = 1.9): ((c: Ctx, r: Room | null) => number) =>
  (c, r) => base * clamp((r?.areaM2 ?? c.area) / ref, lo, hi);
const mm = (c: Ctx) => 0.75 + Math.max(c.mess, 2) * 0.13; // mess multiplier for reset work
const own = (c: Ctx, r: Room | null) => !c.shared || r === null || r.id === 'bedroom-1' || r.kind !== 'bedroom';
const notDorm = (c: Ctx) => c.home.type !== 'dorm';
const OUTSIDE: RoomKind[] = ['balcony', 'garage', 'basement', 'attic'];
const floorRooms = (c: Ctx, r: Room | null) =>
  c.rooms.filter((x) => !x.virtual && !OUTSIDE.includes(x.kind) && (r ? x.floor === r.floor : true));
const roomList = (rs: Room[]) => rs.map((x) => x.name).join(', ');

/** Bathrooms beyond what the household needs get used less; roomy bathrooms-per-person ratios skip step-ups. */
const lessUsedBathroom: Template['adjust'] = (c, r) => {
  if (!r) return null;
  const baths = Math.max(1, c.count('bathroom'));
  const perBath = c.people / baths;
  const idx = Number(r.id.split('-')[1]) - 1;
  if (baths >= 2 && idx >= 1 && perBath <= 1.5) return { steps: -1, capUp: 0, note: `${r.name} is probably used less than the main bathroom, so it gets a lighter rhythm.` };
  if (perBath < 2) return { capUp: 0 };
  return null;
};

/** Bedrooms see less traffic than shared rooms, so floor care there runs on a lighter rhythm. */
const quietRoom: Template['adjust'] = (_c, r) => (r?.kind === 'bedroom' && !r.sleeps ? { steps: -1 } : null);

const T = (t: Template): Template => t;

// ───────────────────────── Kitchen ─────────────────────────
const kitchen: Template[] = [
  T({
    id: 'k-dishes', time: 'evening', rooms: ['kitchen'], fallback: ['bedroom', 'living'], scope: 'room',
    name: (_c, r) => (r?.kind === 'kitchen' ? 'Do the dishes' : 'Wash your cups and dishes'),
    category: 'Dishes', minutes: (c) => clamp(5 + 1.6 * (c.people - 1), 5, 18), difficulty: 1, freq: 'daily',
    impact: 8, base: 62, tags: ['habit', 'essential'], topics: ['dishes', 'kitchen'], needs: ['dish-soap', 'sponge'],
    steps: ['Scrape plates and stack them next to the sink', 'Load the dishwasher or fill the sink with hot soapy water', 'Wash glasses and cutlery first, then plates, then pots', 'Rack or dry everything', 'Wipe the sink and the counter beside it'],
    tiny: ['Bring any dishes near you to the sink', 'Start the water', 'Wash just 3 dishes', 'Put 3 clean things on the rack', 'Choose: 3 more, or stop here'],
    reason: (c) => `Dishes pile up fastest and make the whole kitchen look worse.${c.people > 2 ? ` With ${c.people} people there are more of them, so this stays daily.` : ''}`,
  }),
  T({
    id: 'k-counters', rooms: ['kitchen'], name: 'Wipe kitchen counters', category: 'Kitchen',
    minutes: sz(4, 10, 0.8, 1.6), difficulty: 1, freq: 'weekly', impact: 7, base: 52, topics: ['kitchen', 'kitchen-surfaces'],
    needs: ['all-purpose', 'cloth'], step: { occ: 1, kids: 1, max: 1 },
    steps: ['Clear everything off the counter', 'Spray cleaner (or use a cloth with a drop of dish soap)', 'Wipe from back to front', 'Wipe the splash zone around the sink', 'Put only the things you use daily back'],
    tiny: ['Move 5 items off one counter', 'Wipe that bare space', 'Put the items back or away'],
    reason: 'Counters are where food prep happens, so a quick wipe keeps the kitchen hygienic and visibly tidy.',
  }),
  T({
    id: 'k-stove', rooms: ['kitchen'], name: 'Wipe the stovetop and splashes', category: 'Kitchen', minutes: 6, difficulty: 1,
    freq: 'weekly', impact: 6, base: 44, topics: ['kitchen', 'kitchen-surfaces'], needs: ['degreaser', 'cloth'], step: { occ: 1, max: 1 },
    steps: ['Wait until the stove is cool', 'Lift off grates or burners if you can', 'Spray degreaser or soapy water and let it sit a minute', 'Wipe the surface and the wall behind it', 'Dry and replace the grates'],
    tiny: ['Spray the stovetop', 'Wipe the surface once', 'Wipe the knobs'],
    reason: 'Fresh splashes wipe off in seconds; baked-on ones take 20 minutes.',
  }),
  T({
    id: 'k-sink', rooms: ['kitchen'], name: 'Clean the kitchen sink', category: 'Kitchen', minutes: 5, difficulty: 1, freq: 'biweekly',
    impact: 5, base: 40, topics: ['kitchen'], needs: ['dish-soap', 'sponge'], when: (c) => !c.minimal || c.mess < 5,
    steps: ['Clear the sink of dishes', 'Sprinkle soap or baking soda and scrub the basin', 'Scrub around the tap and drain', 'Rinse well', 'Wipe the tap dry so it shines'],
    reason: 'The sink touches raw food, dishes and hands. A weekly scrub keeps it fresh.',
  }),
  T({
    id: 'k-sweep', rooms: ['kitchen'], name: 'Sweep the kitchen floor', category: 'Floors', minutes: sz(5, 10, 0.8, 1.6), difficulty: 1, freq: 'weekly',
    impact: 6, base: 42, topics: ['floors', 'kitchen', 'pet-hair'], needs: ['broom'], step: { kids: 1, pets: 1, max: 1 }, when: (c) => !c.minimal,
    steps: ['Move chairs out of the way', 'Sweep from the edges toward the middle', 'Sweep under the table and by the bin', 'Dispose of the pile'],
    tiny: ['Sweep one corner', 'Sweep the area in front of the stove', 'Sweep the pile into the bin'],
    reason: (c) => (c.kidTier || c.pets.sheds ? 'Crumbs and hair collect fast in kitchens with kids or pets.' : 'Crumbs on the floor are one of the first things you notice.'),
  }),
  T({
    id: 'k-mop', rooms: ['kitchen'], name: 'Mop the kitchen floor', category: 'Floors', minutes: sz(12, 10, 0.8, 1.6), difficulty: 2, freq: 'biweekly',
    impact: 6, base: 36, topics: ['floors', 'kitchen'], needs: ['mop', 'floor'], step: { kids: 1, max: 1 }, when: (c) => !c.minimal,
    steps: ['Sweep or vacuum first', 'Fill a bucket with warm water and a little floor cleaner', 'Mop from the far corner toward the door', 'Let it air dry'],
    reason: 'Sticky patches build up under foot traffic and are easy to miss until they are really noticeable.',
  }),
  T({
    id: 'k-fridge-check', rooms: ['kitchen'], name: 'Fridge check: toss anything expired', category: 'Kitchen', minutes: 5, difficulty: 1, freq: 'weekly',
    impact: 5, base: 38, topics: ['refrigerator', 'kitchen'], tags: ['quick'], needs: ['bags'], step: { occ: 0 },
    steps: ['Open the fridge and take one shelf at a time', 'Throw out expired or questionable food', 'Wipe any spills you see', 'Put things back with older items in front'],
    tiny: ['Open the fridge', 'Throw out 3 things you know are bad', 'Wipe one visible spill'],
    reason: 'A weekly look prevents smells and makes it easy to plan meals and shopping.',
  }),
  T({
    id: 'k-fridge-wipe', rooms: ['kitchen'], name: 'Wipe fridge shelves and handle', category: 'Kitchen', minutes: 12, difficulty: 2, freq: 'monthly',
    impact: 4, base: 30, topics: ['refrigerator', 'kitchen'], needs: ['all-purpose', 'cloth'],
    steps: ['Take out food from one shelf at a time', 'Wipe the shelf with warm soapy water', 'Dry and put food back', 'Wipe the door seal and handle'],
    reason: 'Spills hide on shelves, and a monthly wipe-down keeps the fridge odor-free.',
  }),
  T({
    id: 'k-microwave', rooms: ['kitchen'], name: 'Wipe the microwave', category: 'Kitchen', minutes: 5, difficulty: 1, freq: 'monthly',
    impact: 4, base: 28, topics: ['kitchen', 'kitchen-surfaces'], tags: ['nicety'], needs: ['dish-soap', 'cloth'],
    steps: ['Heat a bowl of water for 2 minutes to loosen splatters', 'Carefully remove the bowl', 'Wipe the inside, the door and the handle', 'Wipe the turntable'],
    reason: 'Splatters bake on each time you reheat food. Steam makes this a 5-minute job.',
  }),
  T({
    id: 'k-appliances', rooms: ['kitchen'], name: 'Wipe appliance fronts and handles', category: 'Kitchen', minutes: 6, difficulty: 1, freq: 'biweekly',
    impact: 4, base: 28, topics: ['kitchen', 'kitchen-surfaces'], tags: ['extra'], needs: ['all-purpose', 'cloth'], step: { occ: 1, max: 1 },
    steps: ['Spray a cloth, not the appliance', 'Wipe the fridge, dishwasher and oven doors', 'Wipe handles and buttons', 'Buff dry'],
    reason: 'Handles are the most-touched surface in a kitchen. Fingerprints add up quickly.',
  }),
  // Deep clean
  T({ id: 'k-d-stovetop', rooms: ['kitchen'], name: 'Deep clean the stovetop and burners', category: 'Kitchen', minutes: 25, difficulty: 2, freq: 'deep', tier: 'deep', impact: 5, base: 34, topics: ['kitchen', 'kitchen-surfaces'], needs: ['degreaser', 'sponge'], steps: ['Remove grates, drip pans and knobs', 'Soak them in hot soapy water', 'Scrub the stovetop with degreaser', 'Scrub the removed parts and rinse', 'Dry everything and reassemble'], reason: 'Baked-on grease is the biggest kitchen eyesore, and soaking does most of the work.' }),
  T({ id: 'k-d-oven', rooms: ['kitchen'], name: 'Clean the oven', category: 'Kitchen', minutes: 45, difficulty: 3, freq: 'deep', tier: 'deep', impact: 5, base: 30, topics: ['kitchen'], needs: ['degreaser', 'sponge', 'gloves'], steps: ['Remove racks and wipe out loose crumbs', 'Apply an oven cleaner exactly as the label says (ventilate well)', 'Wait the recommended time', 'Wipe out the residue with a damp cloth', 'Clean the racks in the sink and replace them'], reason: 'An oven that is clean smokes less and keeps food tasting like food.' }),
  T({ id: 'k-d-microwave', rooms: ['kitchen'], name: 'Deep clean the microwave', category: 'Kitchen', minutes: 10, difficulty: 1, freq: 'deep', tier: 'deep', impact: 3, base: 26, topics: ['kitchen'], needs: ['dish-soap', 'sponge'], steps: ['Steam a bowl of water for 3 minutes', 'Remove and scrub the turntable in the sink', 'Wipe the ceiling, walls and door seal', 'Dry the interior'], reason: 'Gets rid of old splatters and smells.' }),
  T({ id: 'k-d-fridge', rooms: ['kitchen'], name: 'Empty and clean the refrigerator', category: 'Kitchen', minutes: 35, difficulty: 2, freq: 'deep', tier: 'deep', impact: 6, base: 38, topics: ['refrigerator', 'kitchen'], needs: ['dish-soap', 'cloth'], steps: ['Take everything out and toss expired items', 'Remove shelves and drawers and wash them', 'Wipe the inside with warm soapy water', 'Dry everything and put food back organized'], reason: 'A reset every few months stops smells at the source.' }),
  T({ id: 'k-d-cabinets', rooms: ['kitchen'], name: 'Wipe cabinet fronts and handles', category: 'Kitchen', minutes: 20, difficulty: 1, freq: 'deep', tier: 'deep', impact: 4, base: 28, topics: ['kitchen', 'kitchen-surfaces'], needs: ['dish-soap', 'cloth'], steps: ['Dampen a cloth with soapy water', 'Wipe doors, working top to bottom', 'Wipe handles and edges', 'Dry with a clean cloth'], reason: 'Greasy handprints are a common source of a kitchen that never feels fully clean.' }),
  T({ id: 'k-d-backsplash', rooms: ['kitchen'], name: 'Clean the backsplash', category: 'Kitchen', minutes: 12, difficulty: 1, freq: 'deep', tier: 'deep', impact: 4, base: 28, topics: ['kitchen', 'kitchen-surfaces'], needs: ['degreaser', 'cloth'], steps: ['Spray degreaser or soapy water', 'Let it sit for a minute', 'Wipe and scrub grout lines gently', 'Rinse and dry'], reason: 'Splashes land here every time you cook.' }),
  T({ id: 'k-d-sink', rooms: ['kitchen'], name: 'Scrub and descale the sink and tap', category: 'Kitchen', minutes: 12, difficulty: 2, freq: 'deep', tier: 'deep', impact: 4, base: 30, topics: ['kitchen'], needs: ['descaler', 'sponge'], steps: ['Scrub the basin with a non-scratch sponge', 'Treat limescale on the tap with a product made for it (follow the label, use one product at a time)', 'Rinse thoroughly with water', 'Polish the tap dry'], reason: 'Limescale makes fixtures look dull even when they are technically clean.' }),
  T({ id: 'k-d-appliances', rooms: ['kitchen'], name: 'Clean small appliances (kettle, toaster, coffee maker)', category: 'Kitchen', minutes: 20, difficulty: 2, freq: 'deep', tier: 'deep', impact: 3, base: 24, topics: ['kitchen'], needs: ['cloth', 'dish-soap'], steps: ['Unplug everything first', 'Empty crumb trays and wipe the outsides', 'Descale the kettle and coffee maker following their manuals', 'Wipe dry and plug back in'], reason: 'These get used daily and rarely get a proper clean.' }),
  T({ id: 'k-s-pantry', rooms: ['kitchen'], name: 'Sort the pantry and cupboards', category: 'Organization', minutes: 25, difficulty: 2, freq: 'seasonal', impact: 4, base: 26, topics: ['organization', 'kitchen'], tags: ['extra'], steps: ['Take items out of one cupboard at a time', 'Toss expired food', 'Wipe the shelf', 'Put back what you use, donate what you will not'], reason: 'A quarterly sort keeps food from getting lost and wasted.' }),
];

// ───────────────────────── Bathroom ─────────────────────────
const bathroom: Template[] = [
  T({
    id: 'b-toilet', rooms: ['bathroom'], name: 'Clean the toilet', category: 'Bathroom', minutes: 8, difficulty: 2, freq: 'weekly', impact: 8, base: 50,
    tags: ['essential'], topics: ['bathroom'], needs: ['toilet', 'brush', 'gloves'], step: { occ: 1, kids: 1, max: 1 }, when: notDorm, adjust: lessUsedBathroom,
    steps: ['Put on gloves', 'Apply toilet cleaner under the rim and let it sit', 'Scrub the bowl with the brush and flush', 'Wipe the seat, lid and handle', 'Wipe the base and floor around it'],
    tiny: ['Put on gloves', 'Apply cleaner under the rim', 'Scrub for 30 seconds and flush', 'Wipe the seat'],
    reason: (c) => (c.occTier >= 2 ? `${c.people} people share the bathrooms, so toilets get cleaned more often.` : 'Toilets are the highest-hygiene spot in the home and the weekly clean takes minutes.'),
  }),
  T({
    id: 'b-sink', rooms: ['bathroom'], name: 'Wipe the bathroom sink and counter', category: 'Bathroom', minutes: 5, difficulty: 1, freq: 'weekly', impact: 7, base: 44,
    tags: ['quick'], topics: ['bathroom'], needs: ['all-purpose', 'cloth'], step: { occ: 1, max: 1 }, adjust: lessUsedBathroom,
    steps: ['Clear the counter', 'Spray cleaner or use a soapy cloth', 'Wipe the sink, tap and counter', 'Dry the tap so it shines', 'Put back only what you use daily'],
    tiny: ['Clear the counter', 'Wipe the sink once', 'Dry the tap'],
    reason: 'The bathroom sink is used several times a day and shows grime quickly.',
  }),
  T({
    id: 'b-shower', rooms: ['bathroom'], name: 'Wipe the shower and tub', category: 'Bathroom', minutes: 8, difficulty: 2, freq: 'weekly', impact: 6, base: 42,
    topics: ['bathroom'], needs: ['bathroom', 'sponge'], when: notDorm, adjust: lessUsedBathroom,
    steps: ['Spray the walls and tub with bathroom cleaner', 'Let it sit while you do something else', 'Scrub the walls, tub and shower door', 'Rinse with warm water', 'Squeegee or wipe the glass'],
    tiny: ['Spray the shower walls', 'Wait 2 minutes', 'Rinse it down'],
    reason: 'Soap scum and mildew are far easier to remove weekly than monthly.',
  }),
  T({
    id: 'b-mirror', rooms: ['bathroom'], name: 'Wipe the bathroom mirror', category: 'Bathroom', minutes: 3, difficulty: 1, freq: 'monthly', impact: 4, base: 26,
    tags: ['quick', 'nicety'], topics: ['bathroom'], needs: ['glass', 'cloth'],
    steps: ['Spray glass cleaner on a cloth', 'Wipe the mirror in an S pattern', 'Buff dry'],
    reason: 'A clear mirror makes the whole bathroom feel cleaner for the cost of three minutes.',
  }),
  T({
    id: 'b-floor', rooms: ['bathroom'], name: 'Sweep and mop the bathroom floor', category: 'Floors', minutes: sz(8, 5, 0.8, 1.5), difficulty: 2, freq: 'biweekly', impact: 5, base: 38,
    topics: ['bathroom', 'floors'], needs: ['mop', 'floor'], when: notDorm, adjust: lessUsedBathroom,
    steps: ['Lift the bath mat and bin out of the way', 'Sweep or vacuum hair and dust', 'Mop with warm water and a little floor cleaner', 'Let it dry before replacing the mat'],
    reason: 'Hair and dust collect behind the toilet and under cabinets.',
  }),
  T({
    id: 'b-bin', rooms: ['bathroom'], name: 'Empty the bathroom bin', category: 'Trash', minutes: 2, difficulty: 1, freq: 'biweekly', impact: 4, base: 32,
    tags: ['quick', 'nicety'], topics: ['trash', 'bathroom'], needs: ['bags'], when: notDorm,
    steps: ['Tie the bag and take it out', 'Put in a fresh bag'], reason: 'A full bin is the fastest way to a smelly bathroom.',
  }),
  T({
    id: 'b-towels', rooms: ['bathroom'], name: 'Swap in fresh bath towels', category: 'Laundry', minutes: 3, difficulty: 1, freq: 'weekly', impact: 4, base: 30,
    topics: ['bathroom', 'laundry'], needs: ['laundry'], step: { occ: 1, max: 1 }, when: (c, r) => !r || r.id === 'bathroom-1' || c.people >= 3,
    steps: ['Take used towels to the laundry', 'Hang fresh ones'], reason: 'Damp towels develop odors in about a week.',
  }),
  T({ id: 'b-descale', rooms: ['bathroom'], name: 'Descale the showerhead and taps', category: 'Bathroom', minutes: 8, difficulty: 2, freq: 'monthly', impact: 3, base: 24, tags: ['extra'], topics: ['bathroom'], needs: ['descaler'], when: notDorm, steps: ['Treat the tap and showerhead with a limescale remover made for that (read the label, one product at a time)', 'Leave for the recommended time', 'Rinse with plenty of water', 'Polish dry'], reason: 'Limescale slowly reduces water pressure and looks dull.' }),
  T({ id: 'b-s-curtain', rooms: ['bathroom'], name: 'Wash the shower curtain and bath mat', category: 'Laundry', minutes: 10, difficulty: 1, freq: 'seasonal', impact: 3, base: 24, tags: ['extra'], topics: ['bathroom', 'laundry'], needs: ['laundry'], when: (c, r) => notDorm(c) && (!r || r.id === 'bathroom-1' || c.people >= 3), steps: ['Take the curtain and mat down', 'Wash on a gentle cycle with towels', 'Hang to dry', 'Rehang'], reason: 'These collect mildew out of sight.' }),
  // Deep clean
  T({ id: 'b-d-toilet', rooms: ['bathroom'], name: 'Deep clean the toilet (bowl, base and hinges)', category: 'Bathroom', minutes: 15, difficulty: 2, freq: 'deep', tier: 'deep', impact: 6, base: 36, topics: ['bathroom'], needs: ['toilet', 'brush', 'gloves'], when: notDorm, steps: ['Apply toilet cleaner and let it sit', 'Scrub under the rim and the bowl', 'Clean the seat hinges with a small brush', 'Wipe the base and the floor behind it'], reason: 'Hinges and the base are the spots a weekly wipe misses.' }),
  T({ id: 'b-d-shower', rooms: ['bathroom'], name: 'Scrub the shower and tub', category: 'Bathroom', minutes: 25, difficulty: 3, freq: 'deep', tier: 'deep', impact: 6, base: 38, topics: ['bathroom'], needs: ['bathroom', 'sponge', 'gloves'], when: notDorm, steps: ['Spray with bathroom cleaner (ventilate well)', 'Let it sit for the time the label says', 'Scrub corners and edges with a brush', 'Rinse thoroughly with water', 'Wipe the fixtures dry'], reason: 'This is the big reset for soap scum and mildew.' }),
  T({ id: 'b-d-tiles', rooms: ['bathroom'], name: 'Wipe and descale the tiles', category: 'Bathroom', minutes: 20, difficulty: 2, freq: 'deep', tier: 'deep', impact: 4, base: 30, topics: ['bathroom'], needs: ['bathroom', 'cloth'], when: notDorm, steps: ['Spray tile cleaner on the walls', 'Wipe top to bottom', 'Rinse with a damp cloth', 'Dry to prevent streaks'], reason: 'Clean tiles instantly brighten the room.' }),
  T({ id: 'b-d-grout', rooms: ['bathroom'], name: 'Scrub the grout lines', category: 'Bathroom', minutes: 25, difficulty: 3, freq: 'deep', tier: 'deep', impact: 4, base: 28, topics: ['bathroom'], needs: ['brush', 'bathroom'], when: notDorm, steps: ['Apply a cleaner suitable for grout', 'Scrub with a stiff brush, one wall at a time', 'Rinse with clean water', 'Let it dry fully'], reason: 'Grout holds on to dirt and mildew. Brushing gives a big visible change.' }),
  T({ id: 'b-d-mirror', rooms: ['bathroom'], name: 'Polish the mirrors and fixtures', category: 'Bathroom', minutes: 8, difficulty: 1, freq: 'deep', tier: 'deep', impact: 3, base: 24, topics: ['bathroom'], needs: ['glass', 'cloth'], steps: ['Wipe the mirror and glass shelves', 'Polish taps and handles', 'Buff with a dry cloth'], reason: 'The finishing touch that makes a bathroom look cared for.' }),
  T({ id: 'b-d-sink', rooms: ['bathroom'], name: 'Deep clean the sink and vanity', category: 'Bathroom', minutes: 10, difficulty: 1, freq: 'deep', tier: 'deep', impact: 4, base: 28, topics: ['bathroom'], needs: ['bathroom', 'sponge'], steps: ['Empty the counter and wipe the shelves', 'Scrub the basin and around the tap', 'Wipe cabinet fronts and handles', 'Rinse and dry'], reason: 'Toothpaste and soap build-up are easy to forget.' }),
  T({ id: 'b-d-drains', rooms: ['bathroom'], name: 'Clear and clean the drains', category: 'Bathroom', minutes: 10, difficulty: 2, freq: 'deep', tier: 'deep', impact: 3, base: 26, topics: ['bathroom'], needs: ['gloves', 'brush'], when: notDorm, steps: ['Remove the drain cover and pull out visible hair (wear gloves)', 'Scrub the cover and the opening with a brush', 'Flush with hot water', 'Do not mix drain products. Use only one, as the label says.'], reason: 'Hair and soap slowly slow drains and cause odors.' }),
];

// ───────────────────────── Bedroom ─────────────────────────
const bedroom: Template[] = [
  T({ id: 'br-bed', time: 'morning', keep: (c, r) => c.focus.has('morning') && (r?.id === 'bedroom-1' || !!r?.sleeps), rooms: ['bedroom'], name: 'Make the bed', category: 'Bedding', minutes: 2, difficulty: 1, freq: 'daily', impact: 6, base: 36, tags: ['quick', 'nicety'], topics: ['bedroom'], when: own, steps: ['Straighten the sheet', 'Pull up the duvet', 'Place the pillows'], tiny: ['Pull up the duvet', 'Place the pillows'], reason: 'A made bed is the quickest way to make a bedroom look tidy.' }),
  T({ id: 'br-clothes', rooms: ['bedroom'], name: 'Put away clothes and clear the chair', category: 'Clutter', minutes: 4, difficulty: 1, freq: 'weekly', impact: 6, base: 40, tags: ['quick'], topics: ['bedroom', 'clutter', 'laundry'], when: own, steps: ['Gather clothes from the floor, chair and bed', 'Dirty clothes go to the hamper', 'Clean clothes get hung or folded', 'Clear the chair or surface'], tiny: ['Put 5 clothes in the hamper', 'Put 5 clean clothes away'], reason: 'Clothes piles are the most common clutter spot in bedrooms.' }),
  T({ id: 'br-sheets', rooms: ['bedroom'], name: 'Change the bed sheets', category: 'Bedding', minutes: 12, difficulty: 2, freq: 'biweekly', impact: 5, base: 38, topics: ['bedroom', 'laundry'], needs: ['laundry'], when: own, steps: ['Strip the bed', 'Start the sheets in the wash', 'Remake the bed with fresh sheets', 'Put the pillowcases on'], tiny: ['Take the sheets off', 'Start the wash'], reason: 'Fresh sheets every two weeks keep sleep fresh and dust down.' }),
  T({ id: 'br-dust', rooms: ['bedroom'], name: 'Dust the bedroom surfaces', category: 'Dust', minutes: 6, difficulty: 1, freq: 'monthly', impact: 4, base: 32, topics: ['dust', 'bedroom'], needs: ['duster', 'cloth'], when: own, steps: ['Clear the nightstands and dresser', 'Wipe with a slightly damp cloth', 'Put things back'], tiny: ['Wipe the nightstand', 'Wipe the dresser top'], reason: 'Dust collects on bedroom surfaces and is what you breathe overnight.' }),
  T({ id: 'br-bin', rooms: ['bedroom'], name: 'Empty the bedroom bin', category: 'Trash', minutes: 2, difficulty: 1, freq: 'biweekly', impact: 3, base: 28, tags: ['quick', 'nicety'], topics: ['trash'], needs: ['bags'], when: (c, r) => own(c, r) && c.home.type !== 'dorm', steps: ['Tie the bag', 'Replace with a fresh bag'], reason: 'Small habit, big difference in odor.' }),
  T({ id: 'br-d-mattress', rooms: ['bedroom'], name: 'Vacuum the mattress', category: 'Bedding', minutes: 12, difficulty: 1, freq: 'deep', tier: 'deep', impact: 4, base: 30, topics: ['bedroom'], needs: ['vacuum'], when: own, steps: ['Strip the bed', 'Vacuum the entire mattress with the upholstery tool', 'Let it air for 15 minutes', 'Remake the bed'], reason: 'Mattresses collect dust and skin cells.' }),
  T({ id: 'br-d-under', rooms: ['bedroom'], name: 'Clean under the bed', category: 'Floors', minutes: 15, difficulty: 2, freq: 'deep', tier: 'deep', impact: 5, base: 32, topics: ['bedroom', 'dust', 'floors'], needs: ['vacuum'], when: own, steps: ['Pull out anything stored under the bed', 'Vacuum or sweep the space', 'Wipe the floor if it is hard flooring', 'Put back only what needs to be there'], reason: 'Dust bunnies gather where you never look.' }),
  T({ id: 'br-d-closet', rooms: ['bedroom'], name: 'Organize the closet', category: 'Organization', minutes: 35, difficulty: 2, freq: 'deep', tier: 'deep', impact: 6, base: 34, topics: ['organization', 'clutter', 'bedroom'], when: own, steps: ['Take out one section (e.g. shirts)', 'Sort into keep / donate / mend', 'Wipe the shelf', 'Return the keeps neatly'], tiny: ['Pull out 5 things you never wear', 'Put them in a donate bag'], reason: 'A smaller closet is easier to keep tidy.' }),
  T({ id: 'br-d-dust', rooms: ['bedroom'], name: 'Dust thoroughly: shelves, frames and baseboards', category: 'Dust', minutes: 18, difficulty: 1, freq: 'deep', tier: 'deep', impact: 4, base: 30, topics: ['dust', 'bedroom'], needs: ['duster', 'cloth'], when: own, steps: ['Start high: shelves, frames and the top of the wardrobe', 'Move down to nightstands and dresser', 'Wipe baseboards last', 'Vacuum up what fell'], reason: 'The thorough pass that keeps regular dusting light.' }),
  T({ id: 'br-d-bedding', rooms: ['bedroom'], name: 'Wash the duvet, pillows and mattress protector', category: 'Laundry', minutes: 15, difficulty: 2, freq: 'seasonal', tier: 'maintenance', impact: 4, base: 28, topics: ['bedroom', 'laundry'], needs: ['laundry'], when: own, tags: ['nicety'], steps: ['Check the care labels', 'Wash on the right setting (a large machine for the duvet)', 'Dry completely', 'Put back on the bed'], reason: 'Bulky bedding rarely gets washed unless you plan it.' }),
];

// ───────────────────────── Living, dining, office ─────────────────────────
const living: Template[] = [
  T({ id: 'lr-tidy', time: 'evening', rooms: ['living'], name: (_c, r) => (r?.sleeps ? 'Quick tidy of your main room' : 'Quick tidy: put things back where they live'), category: 'Clutter', minutes: sz(5, 20, 0.8, 1.5), difficulty: 1, freq: 'daily', impact: 8, base: 54, tags: ['quick'], topics: ['clutter', 'living-room', 'organization'], steps: ['Grab a basket for stray items', 'Pick up trash and dishes first', 'Return items to their rooms', 'Fluff cushions and fold blankets'], tiny: ['Pick up 5 things and put them where they live', 'Pick up 5 more', 'Stop or repeat'], reason: (c) => (c.blockers.has('clutter') ? 'You said clutter makes cleaning difficult, so a short daily tidy stops it from piling up.' : 'Clutter is what makes a room look messy. A short daily tidy has the biggest visual impact.') }),
  T({ id: 'lr-surfaces', rooms: ['living'], name: 'Wipe the coffee table and surfaces', category: 'Dust', minutes: 5, difficulty: 1, freq: 'biweekly', impact: 5, base: 36, topics: ['living-room', 'dust'], needs: ['all-purpose', 'cloth'], steps: ['Clear the table and side tables', 'Wipe with a damp cloth', 'Put items back, leaving fewer out'], reason: 'Flat surfaces show crumbs, rings and dust first.' }),
  T({ id: 'lr-dust', rooms: ['living'], name: 'Dust shelves, the TV stand and electronics', category: 'Dust', minutes: 8, difficulty: 1, freq: 'biweekly', impact: 4, base: 34, topics: ['dust', 'living-room'], needs: ['duster', 'cloth'], steps: ['Start at the highest shelf', 'Wipe with a dry or slightly damp cloth', 'Dust screens with a dry microfiber cloth', 'Vacuum anything that fell'], reason: 'Dust settles quickly on electronics and shelves.' }),
  T({ id: 'lr-upholstery', rooms: ['living'], name: (c) => (c.pets.sheds ? 'Vacuum pet hair from the sofa and cushions' : 'Vacuum the sofa and cushions'), category: 'Floors', minutes: 8, difficulty: 1, freq: 'biweekly', impact: 5, base: 32, topics: ['pet-hair', 'living-room'], needs: ['vacuum', 'lint-roller'], step: { pets: 1, max: 1 }, when: (c, r) => !r?.sleeps || c.pets.any, steps: ['Remove cushions', 'Vacuum the surface with the upholstery tool', 'Vacuum under the cushions', 'Use a lint roller on any hair that is left'], reason: (c) => (c.pets.sheds ? 'Pet hair clings to fabric, so weekly upholstery cleaning saves your floors and clothes.' : 'Crumbs and dust collect in sofas.') }),
  T({ id: 'lr-d-dust', rooms: ['living'], name: 'Dust everything, including high shelves and lamps', category: 'Dust', minutes: 20, difficulty: 1, freq: 'deep', tier: 'deep', impact: 4, base: 30, topics: ['dust', 'living-room'], needs: ['duster', 'cloth'], steps: ['Start with the ceiling corners and light fixtures', 'Move to shelves and frames', 'Wipe furniture and electronics', 'Vacuum last'], reason: 'The full dusting pass.' }),
  T({ id: 'lr-d-vacuum', rooms: ['living'], name: 'Vacuum thoroughly: edges, corners and vents', category: 'Floors', minutes: 20, difficulty: 2, freq: 'deep', tier: 'deep', impact: 5, base: 32, topics: ['floors', 'living-room'], needs: ['vacuum'], steps: ['Use the crevice tool along baseboards', 'Vacuum corners and under reachable furniture', 'Vacuum the whole floor in overlapping rows'], reason: 'Edges collect what the quick vacuum misses.' }),
  T({ id: 'lr-d-upholstery', rooms: ['living'], name: 'Clean upholstery where appropriate', category: 'Living room', minutes: 25, difficulty: 2, freq: 'deep', tier: 'deep', impact: 4, base: 28, topics: ['living-room'], needs: ['vacuum', 'dish-soap'], when: (c, r) => !r?.sleeps || c.pets.any || c.kidTier > 0, steps: ['Check the care label of every piece first', 'Vacuum thoroughly', 'Spot clean only as the label allows, testing a hidden spot first', 'Let it dry fully'], reason: 'Fabric absorbs odors and stains over time. Always follow the care label.' }),
  T({ id: 'lr-d-under', rooms: ['living'], name: 'Clean under and behind the furniture', category: 'Floors', minutes: 20, difficulty: 2, freq: 'deep', tier: 'deep', impact: 4, base: 28, topics: ['floors', 'dust', 'living-room'], needs: ['vacuum'], steps: ['Move what you can move safely', 'Vacuum or sweep underneath', 'Wipe baseboards', 'Put furniture back'], reason: 'Dust balls and lost items collect where it is hardest to reach.' }),
  T({ id: 'lr-d-organize', rooms: ['living'], name: 'Organize clutter: shelves, media and baskets', category: 'Organization', minutes: 25, difficulty: 2, freq: 'deep', tier: 'deep', impact: 6, base: 34, topics: ['clutter', 'organization', 'living-room'], steps: ['Pick one shelf or basket', 'Empty it and wipe it down', 'Keep what you use, donate the rest', 'Return items neatly'], reason: 'A home for everything makes the daily tidy 3x faster.' }),
  T({ id: 'lr-s-textiles', rooms: ['living'], name: 'Wash throw blankets and cushion covers', category: 'Laundry', minutes: 15, difficulty: 1, freq: 'seasonal', impact: 3, base: 24, tags: ['extra'], topics: ['living-room', 'laundry'], needs: ['laundry'], when: (c, r) => !r?.sleeps || c.pets.any, steps: ['Check the care labels', 'Wash on a gentle cycle', 'Dry fully', 'Put them back'], reason: 'Soft furnishings collect dust and dander.' }),
];

const dining: Template[] = [
  T({ id: 'd-table', rooms: ['dining'], name: 'Wipe the dining table and chairs', category: 'Kitchen', minutes: 4, difficulty: 1, freq: 'weekly', impact: 6, base: 40, topics: ['kitchen-surfaces'], needs: ['all-purpose', 'cloth'], step: { kids: 1, occ: 1, max: 1 }, steps: ['Clear the table', 'Wipe the table with a damp soapy cloth', 'Wipe chair seats and backs', 'Dry the table'], tiny: ['Clear the table', 'Wipe it once'], reason: (c) => (c.kidTier ? 'With kids at the table, spills and crumbs happen daily.' : 'The table is where crumbs and rings collect.') }),
  T({ id: 'd-d-chairs', rooms: ['dining'], name: 'Deep clean the dining chairs and table underside', category: 'Living room', minutes: 15, difficulty: 2, freq: 'deep', tier: 'deep', impact: 3, base: 24, needs: ['dish-soap', 'cloth'], steps: ['Vacuum fabric seats', 'Wipe chair legs and rungs', 'Wipe the underside of the table edge'], reason: 'Sticky hand spots hide out of sight.' }),
];

const office: Template[] = [
  T({ id: 'o-desk', rooms: ['office'], name: 'Clear and wipe your desk', category: 'Clutter', minutes: 5, difficulty: 1, freq: 'weekly', impact: 5, base: 36, tags: ['quick'], topics: ['clutter', 'organization'], needs: ['cloth'], steps: ['Throw away trash and cups', 'File or stack papers', 'Wipe the desk', 'Put back only what you use daily'], tiny: ['Throw away trash on the desk', 'Return cups to the kitchen'], reason: 'A clear desk makes it easier to start work (and cleaning).' }),
  T({ id: 'o-dust', rooms: ['office'], name: 'Dust the desk, screen and electronics', category: 'Dust', minutes: 5, difficulty: 1, freq: 'biweekly', impact: 3, base: 26, tags: ['nicety'], topics: ['dust'], needs: ['duster', 'cloth'], steps: ['Use a dry microfiber cloth on screens', 'Dust the keyboard and desk', 'Dust the shelves'], reason: 'Electronics attract dust.' }),
  T({ id: 'o-paper', rooms: ['office'], name: 'Sort the paper pile', category: 'Organization', minutes: 10, difficulty: 2, freq: 'monthly', impact: 5, base: 32, topics: ['organization', 'clutter'], steps: ['Make three piles: shred, file, act on', 'Process the "act on" pile first', 'Shred or recycle the rest'], tiny: ['Take the top 5 papers and decide on each'], reason: 'Paper piles are the number one source of office clutter.' }),
  T({ id: 'o-d-electronics', rooms: ['office'], name: 'Clean the keyboard, screens and cables', category: 'Dust', minutes: 12, difficulty: 1, freq: 'deep', tier: 'deep', impact: 3, base: 22, needs: ['cloth'], steps: ['Turn everything off and unplug', 'Wipe screens with a dry cloth', 'Shake out and wipe the keyboard', 'Dust behind the desk and tidy cables'], reason: 'The corners of an office hide the most dust.' }),
  T({ id: 'o-d-files', rooms: ['office'], name: 'Declutter drawers and files', category: 'Organization', minutes: 30, difficulty: 2, freq: 'deep', tier: 'deep', impact: 5, base: 28, topics: ['organization', 'clutter'], steps: ['Empty one drawer', 'Toss what is expired or old', 'Wipe the drawer and put back only keepers'], reason: 'Makes everyday work far smoother.' }),
];

// ───────────────────────── Laundry, hall, storage ─────────────────────────
const utility: Template[] = [
  T({ id: 'l-wash', rooms: ['laundry'], name: 'Start a load of laundry', category: 'Laundry', minutes: 4, difficulty: 1, freq: 'weekly', impact: 6, base: 50, tags: ['quick', 'essential'], topics: ['laundry'], needs: ['laundry'], step: { occ: 2, max: 2 }, steps: ['Sort one load (colors or whites)', 'Check pockets', 'Add detergent and start the machine', 'Set a timer so you remember to move it'], tiny: ['Pick up what is on the floor', 'Put it in the machine', 'Add detergent and press start'], reason: (c) => (c.occTier >= 2 ? `With ${c.people} people there is more laundry, so loads happen more often.` : 'One load a week keeps laundry from becoming a mountain.') }),
  T({ id: 'l-fold', rooms: ['laundry'], name: 'Fold and put away clean laundry', category: 'Laundry', minutes: (c) => clamp(8 + 2 * (c.people - 1), 8, 20), difficulty: 1, freq: 'weekly', impact: 6, base: 48, tags: ['essential'], topics: ['laundry', 'clutter'], step: { occ: 2, max: 2 }, steps: ['Take the clean laundry out right away', 'Fold or hang by person or room', 'Put each pile in its place'], tiny: ['Fold 5 items', 'Put those 5 away'], reason: 'Clean laundry waiting in a basket is a top source of clutter.' }),
  T({ id: 'l-lint', rooms: ['laundry'], name: 'Empty the dryer lint filter', category: 'Laundry', minutes: 2, difficulty: 1, freq: 'weekly', impact: 3, base: 30, tags: ['nicety'], when: (_c, r) => !r?.virtual, steps: ['Pull out the lint filter', 'Peel off the lint', 'Replace the filter'], reason: 'A clogged lint filter makes the dryer work harder, and lint can be a fire hazard.' }),
  T({ id: 'l-machine', rooms: ['laundry'], name: 'Wipe the washer and dryer', category: 'Laundry', minutes: 6, difficulty: 1, freq: 'monthly', impact: 3, base: 24, tags: ['extra'], steps: ['Wipe the door seal and detergent drawer', 'Wipe the outside of both machines', 'Leave the door open to air out'], reason: 'Prevents musty smells on clothes.' }),
  T({ id: 'l-d-washer', rooms: ['laundry'], name: 'Deep clean the washing machine', category: 'Laundry', minutes: 20, difficulty: 2, freq: 'deep', tier: 'deep', impact: 3, base: 24, steps: ['Run the machine\'s own cleaning cycle (see the manual)', 'Remove and wash the detergent drawer', 'Wipe the door seal and the drum'], reason: 'A clean machine means fresher clothes.' }),
];

const hallway: Template[] = [
  T({ id: 'hl-shoes', rooms: ['hallway'], name: 'Tidy shoes, coats and bags at the entrance', category: 'Clutter', minutes: 3, difficulty: 1, freq: 'weekly', impact: 6, base: 36, tags: ['quick'], topics: ['clutter', 'organization'], step: { kids: 1, occ: 1, max: 1 }, steps: ['Line up shoes', 'Hang coats and bags', 'Put away anything that does not belong at the door'], tiny: ['Put 5 shoes in place'], reason: 'The entrance is the first thing you see every day.' }),
  T({ id: 'hl-mat', rooms: ['hallway'], name: 'Shake out the entry mat', category: 'Floors', minutes: 2, difficulty: 1, freq: 'weekly', impact: 3, base: 28, tags: ['quick', 'nicety'], when: (c) => c.pets.outdoor || c.children > 0, topics: ['floors', 'pet-hair'], steps: ['Take the mat outside', 'Shake it out', 'Sweep the area under it'], reason: 'The entry mat catches what would otherwise end up on your floors.' }),
  T({ id: 'hl-d-baseboards', rooms: ['hallway'], name: 'Wipe baseboards, door frames and scuffs', category: 'Dust', minutes: 15, difficulty: 1, freq: 'deep', tier: 'deep', impact: 3, base: 22, steps: ['Wipe baseboards with a damp cloth', 'Wipe door frames and light switches', 'Use a magic eraser on scuffs'], reason: 'Scuffs and fingerprints show up in hallways.' }),
];

const storage: Template[] = [
  T({ id: 'st-tidy', rooms: ['storage'], name: 'Put stray items back in the storage room', category: 'Organization', minutes: 8, difficulty: 1, freq: 'monthly', impact: 3, base: 22, tags: ['extra'], topics: ['organization'], steps: ['Return what is left in other rooms', 'Stack boxes neatly', 'Sweep the floor'], reason: 'Storage rooms quietly turn into dumping grounds.' }),
  T({ id: 'st-d-sort', rooms: ['storage'], name: 'Sort and declutter the storage room', category: 'Organization', minutes: 40, difficulty: 2, freq: 'deep', tier: 'deep', impact: 4, base: 26, topics: ['organization', 'clutter'], steps: ['Pick one shelf or box', 'Decide: keep, donate, toss', 'Wipe the shelf', 'Label what you keep'], reason: 'Freeing space makes the rest of the home easier to keep tidy.' }),
];

// ───────────────────────── Outdoors & extra spaces ─────────────────────────
const outdoors: Template[] = [
  T({ id: 'bal-sweep', rooms: ['balcony'], name: 'Sweep the balcony', category: 'Outdoor', minutes: sz(6, 8, 0.7, 2), difficulty: 1, freq: 'monthly', impact: 3, base: 24, tags: ['extra'], needs: ['broom'], steps: ['Move chairs aside', 'Sweep leaves and dust', 'Wipe the railing'], reason: 'Quick outdoor upkeep before it builds up.' }),
  T({ id: 'bal-s-furniture', rooms: ['balcony'], name: 'Wash the balcony furniture and railing', category: 'Outdoor', minutes: sz(15, 8, 0.8, 2), difficulty: 2, freq: 'seasonal', impact: 3, base: 22, tags: ['extra'], needs: ['dish-soap', 'cloth'], steps: ['Wipe furniture with warm soapy water', 'Rinse and dry', 'Wash the railing'], reason: 'Outdoor furniture collects pollen and grime between seasons.' }),
  T({ id: 'bal-d-floor', rooms: ['balcony'], name: 'Scrub the balcony floor', category: 'Outdoor', minutes: sz(25, 8, 0.8, 2), difficulty: 2, freq: 'deep', tier: 'deep', impact: 3, base: 22, needs: ['broom', 'dish-soap'], steps: ['Sweep thoroughly', 'Scrub with warm soapy water', 'Rinse away'], reason: 'Gets rid of ground-in dirt.' }),
  T({ id: 'ga-sweep', rooms: ['garage'], name: 'Sweep the garage floor', category: 'Outdoor', minutes: sz(12, 18, 0.8, 2.6), difficulty: 2, freq: 'monthly', impact: 3, base: 22, tags: ['extra'], needs: ['broom'], steps: ['Move bins and bikes aside', 'Sweep to the door', 'Put things back neatly'], reason: 'Keeps dirt and leaves from tracking into the house.' }),
  T({ id: 'ga-s-tidy', rooms: ['garage'], name: 'Tidy one garage zone', category: 'Organization', minutes: 25, difficulty: 2, freq: 'seasonal', impact: 3, base: 24, tags: ['extra'], topics: ['organization', 'clutter'], steps: ['Pick one zone (tools, sports, bins)', 'Pull out what does not belong', 'Group like with like'], reason: 'One zone at a time beats an overwhelming weekend.' }),
  T({ id: 'ga-d-organize', rooms: ['garage'], name: 'Declutter and organize the garage shelves', category: 'Organization', minutes: 60, difficulty: 3, freq: 'deep', tier: 'deep', impact: 4, base: 26, topics: ['organization', 'clutter'], steps: ['Empty one shelf at a time', 'Toss, donate or keep', 'Wipe and put back neatly'], reason: 'Makes space for what you actually use.' }),
  T({ id: 'ba-check', rooms: ['basement'], name: 'Check the basement for damp, pests and clutter', category: 'Organization', minutes: 8, difficulty: 1, freq: 'monthly', impact: 3, base: 24, tags: ['extra'], steps: ['Look for damp patches or smells', 'Check corners for pests', 'Return stray items to their place'], reason: 'Early notice stops small problems from becoming expensive ones.' }),
  T({ id: 'ba-s-sweep', rooms: ['basement'], name: 'Dust and sweep the basement', category: 'Floors', minutes: sz(20, 40, 0.7, 1.8), difficulty: 2, freq: 'seasonal', impact: 3, base: 22, tags: ['extra'], needs: ['broom', 'vacuum'], steps: ['Dust shelves', 'Sweep or vacuum', 'Empty the dehumidifier if you have one'], reason: 'Basements gather dust and damp.' }),
  T({ id: 'ba-d-sort', rooms: ['basement'], name: 'Sort the basement storage', category: 'Organization', minutes: 60, difficulty: 3, freq: 'deep', tier: 'deep', impact: 4, base: 24, topics: ['organization', 'clutter'], steps: ['Choose one corner', 'Sort into keep, donate, toss', 'Label what stays'], reason: 'Basements fill quickly with things nobody decides on.' }),
  T({ id: 'at-s-check', rooms: ['attic'], name: 'Check the attic for leaks and pests', category: 'Organization', minutes: 10, difficulty: 1, freq: 'seasonal', impact: 3, base: 20, tags: ['extra'], steps: ['Look for water stains or droppings', 'Check storage boxes', 'Note anything that needs repair'], reason: 'A quarterly check catches issues early.' }),
  T({ id: 'at-d-sort', rooms: ['attic'], name: 'Declutter the attic', category: 'Organization', minutes: 60, difficulty: 3, freq: 'deep', tier: 'deep', impact: 3, base: 22, topics: ['organization', 'clutter'], steps: ['Take one box down at a time', 'Decide: keep, donate, toss', 'Re-pack and label'], reason: 'Attics are the biggest hidden clutter in many homes.' }),
  T({ id: 'ot-tidy', rooms: ['other'], name: (_c, r) => `Tidy ${r?.name ?? 'the extra space'}`, category: 'Clutter', minutes: 5, difficulty: 1, freq: 'weekly', impact: 4, base: 34, tags: ['quick'], topics: ['clutter'], steps: ['Pick up anything that belongs elsewhere', 'Straighten the surfaces', 'Take stray items to where they live'], reason: 'A quick reset keeps this space from becoming a dumping ground.' }),
  T({ id: 'ot-wipe', rooms: ['other'], name: (_c, r) => `Dust and wipe ${r?.name ?? 'the extra space'}`, category: 'Dust', minutes: 6, difficulty: 1, freq: 'biweekly', impact: 3, base: 28, topics: ['dust'], needs: ['cloth'], steps: ['Dust the surfaces', 'Wipe with a damp cloth'], reason: 'Keeps dust from building up.' }),
];

// ───────────────────────── Floors (generic) ─────────────────────────
const floors: Template[] = [
  T({
    id: 'fl-vac', rooms: ['living', 'bedroom', 'office', 'dining', 'hallway', 'other'], name: (_c, r) => (r?.kind === 'hallway' ? 'Sweep or vacuum the hallway' : r?.sleeps ? 'Vacuum your main room' : `Vacuum ${r?.name ?? 'the floor'}`),
    category: 'Floors', minutes: (_c, r) => clamp(3 + (r?.areaM2 ?? 12) * 0.26, 3, 18), difficulty: 1, freq: 'weekly', impact: 6, base: 42, topics: ['floors', 'pet-hair'], needs: ['vacuum', 'broom'], step: { pets: 1, kids: 1, max: 1, petRooms: ['living', 'dining', 'hallway', 'kitchen'] },
    when: (c, r) => !c.minimal && own(c, r), adjust: quietRoom,
    steps: ['Pick up anything on the floor', 'Vacuum or sweep from the far corner toward the door', 'Do the edges and under easy-to-move furniture', 'Empty the vacuum if it is full'], tiny: ['Pick up what is on the floor', 'Vacuum just the walkway', 'Stop or do one more corner'],
    reason: (c) => (c.pets.sheds && c.pets.indoor ? 'Shedding pets mean twice the vacuuming to keep hair under control.' : c.kidTier ? 'Kids bring in crumbs and dirt, which makes the floor worth a regular vacuum.' : 'Floors are the biggest surface in your home. Vacuuming keeps dust from rising.'),
  }),
  T({
    id: 'fl-all', rooms: ['living', 'bedroom'], scope: 'home', name: 'Vacuum or sweep all floors', category: 'Floors', minutes: (c) => clamp(3 + c.area * 0.2, 5, 14), difficulty: 1, freq: 'weekly', impact: 6, base: 44,
    topics: ['floors', 'pet-hair'], needs: ['vacuum', 'broom'], step: { pets: 1, kids: 1, max: 1 }, when: (c) => c.minimal,
    steps: ['Pick up anything on the floor', 'Vacuum or sweep the whole space in one pass', 'Do the kitchenette and entrance last', 'Empty the vacuum'], tiny: ['Pick up what is on the floor', 'Vacuum the walkway', 'Stop or do the rest'],
    reason: 'In a compact home one quick pass covers everything, so there is no need to split it room by room.',
  }),
  T({
    id: 'fl-mop-all', rooms: ['kitchen', 'bathroom', 'living'], scope: 'home', name: 'Mop the hard floors', category: 'Floors', minutes: (c) => clamp(5 + c.area * 0.15, 7, 14), difficulty: 2, freq: 'biweekly', impact: 5, base: 34,
    topics: ['floors'], needs: ['mop', 'floor'], when: (c) => c.minimal && c.home.type !== 'dorm', steps: ['Sweep first', 'Mop with warm water and a little floor cleaner', 'Let it dry'], reason: 'Sticky patches build up even in small homes.',
  }),
];

// ───────────────────────── Whole home ─────────────────────────
const home: Template[] = [
  T({
    id: 'h-trash', rooms: ['kitchen'], fallback: ['living', 'bedroom'], scope: 'home', name: 'Take out the trash', category: 'Trash', minutes: 3, difficulty: 1, freq: 'twice-weekly',
    impact: 7, base: 60, tags: ['habit', 'essential', 'quick'], topics: ['trash'], needs: ['bags'], step: { occ: 2, kids: 0, max: 1 },
    steps: ['Tie up the kitchen bag', 'Check small bins around the home', 'Take everything outside', 'Put in a fresh bag'], tiny: ['Tie the bag', 'Carry it out', 'Put in a new one'],
    reason: (c) => (c.occTier >= 3 ? 'A busy household fills bins quickly, so trash goes out more often.' : 'Trash is the quickest route to smells and pests.'),
  }),
  T({ id: 'h-handles', rooms: ['hallway', 'living', 'bedroom'], scope: 'home', name: 'Wipe door handles, light switches and remotes', category: 'Hygiene', minutes: 5, difficulty: 1, freq: 'biweekly', impact: 5, base: 34, tags: ['nicety'], needs: ['all-purpose', 'cloth'], step: { kids: 1, occ: 1, max: 1 }, steps: ['Dampen a cloth with cleaner (not directly on electronics)', 'Wipe door handles and light switches', 'Wipe remotes and the fridge handle'], reason: 'The most-touched surfaces carry the most germs, so a short wipe has a high hygiene payoff.' }),
  T({ id: 'h-windows', rooms: ['living', 'bedroom'], scope: 'home', name: 'Clean the windows (inside)', category: 'Windows', minutes: (c) => clamp(c.area * 0.22, 10, 60), difficulty: 2, freq: 'seasonal', impact: 5, base: 28, tags: ['nicety'], topics: ['windows'], needs: ['glass', 'cloth'], steps: ['Dust the frames and sills', 'Spray glass cleaner on a cloth', 'Wipe in an S pattern', 'Buff dry with a clean cloth'], reason: 'Clean windows bring more light and make the whole space look fresher.' }),
  T({ id: 'h-bins', rooms: ['kitchen'], fallback: ['living', 'bedroom'], scope: 'home', name: 'Wash the trash and recycling bins', category: 'Trash', minutes: 8, difficulty: 2, freq: 'seasonal', impact: 3, base: 22, tags: ['extra'], topics: ['trash'], needs: ['dish-soap', 'brush'], steps: ['Empty the bins', 'Scrub with soapy water', 'Rinse and let them dry in the sun'], reason: 'Even with liners, bins pick up odors.' }),
  T({ id: 'h-vents', rooms: ['living', 'bedroom'], scope: 'home', name: 'Dust vents, ceiling fans and light fixtures', category: 'Dust', minutes: (c) => clamp(c.area * 0.12, 8, 25), difficulty: 2, freq: 'seasonal', impact: 3, base: 22, tags: ['extra'], topics: ['dust'], needs: ['duster'], steps: ['Dust the tops of fans and fixtures', 'Wipe vent covers', 'Vacuum what fell'], reason: 'High surfaces drop dust back onto everything below.' }),
  T({ id: 'h-supplies', rooms: ['kitchen'], fallback: ['living', 'bedroom'], scope: 'home', name: 'Check and restock cleaning supplies', category: 'Organization', minutes: 5, difficulty: 1, freq: 'monthly', impact: 3, base: 20, tags: ['nicety'], steps: ['Open the cleaning cupboard', 'Note what is low', 'Add it to your shopping list'], reason: 'Running out mid-clean is a classic way to lose momentum.' }),
  T({ id: 'h-d-baseboards', rooms: ['living', 'bedroom'], scope: 'home', name: 'Wipe baseboards and door frames', category: 'Dust', minutes: (c) => clamp(c.area * 0.2, 12, 40), difficulty: 1, freq: 'deep', tier: 'deep', impact: 3, base: 22, topics: ['dust'], needs: ['cloth'], steps: ['Dust or vacuum baseboards first', 'Wipe with a damp cloth', 'Wipe door frames and light switches'], reason: 'Baseboards frame every room, and clean ones make the floor look better.' }),
  // Goal-driven
  T({ id: 'g-declutter', rooms: ['living', 'bedroom'], scope: 'home', name: 'Declutter 10 items (donate, recycle or toss)', category: 'Clutter', minutes: 10, difficulty: 2, freq: 'weekly', impact: 6, base: 46, topics: ['clutter', 'organization'], when: (c) => c.goals.has('declutter') || c.blockers.has('clutter') || c.problems.has('clutter'), tiny: ['Find 3 things you no longer need', 'Put them in a bag', 'Find 3 more'], steps: ['Grab a bag or box', 'Walk through one room and pick 10 items', 'Sort: donate, recycle, toss', 'Take the bag to the door or car right away'], reason: 'You chose decluttering. Ten items a week is small enough to keep going.' }),
  T({ id: 'g-evening', time: 'evening', rooms: ['kitchen'], fallback: ['living', 'bedroom'], scope: 'home', name: 'Evening reset: dishes, trash and one clear surface', category: 'Routine', minutes: 10, difficulty: 1, freq: 'daily', impact: 7, base: 58, topics: ['dishes', 'clutter'], when: (c) => c.goals.has('daily-routine') || c.goals.has('habits') || c.goals.has('consistent'), steps: ['Put away or wash the dishes from the evening', 'Take out any full bin', 'Clear one surface (table, counter or desk)', 'Switch off the light and call it done'], tiny: ['Bring dishes to the sink', 'Clear one surface', 'Done for the day'], reason: 'You asked for a daily routine. A 10-minute evening reset is the anchor that everything else hangs on.' }),
  T({ id: 'h-room-reset', rooms: ['living', 'bedroom'], scope: 'home', name: '10-minute room reset', category: 'Clutter', minutes: 10, difficulty: 1, freq: 'weekly', impact: 7, base: 46, topics: ['clutter', 'organization'], steps: ['Pick the room that bothers you most', 'Set a 10-minute timer', 'Trash first, then dishes, then put things back where they belong', 'Stop when the timer ends. It does not have to be perfect'], tiny: ['Pick one room', 'Throw away anything that is obviously trash', 'Put 5 things back where they belong'], reason: 'A timed reset is a small, finishable way to keep any room from slipping.' }),
  T({ id: 'g-weekly', rooms: ['living', 'bedroom'], scope: 'home', name: 'Weekly reset: a 20-minute home walk-through', category: 'Routine', minutes: 20, difficulty: 1, freq: 'weekly', impact: 7, base: 54, when: (c) => c.goals.has('weekly-routine'), steps: ['Walk through every room with a basket', 'Return stray items', 'Check what is due this week', 'Write down the next 3 priorities'], reason: 'You asked for a weekly routine. This is your weekly checkpoint.' }),
  T({ id: 'g-moving-pack', rooms: ['living', 'bedroom'], scope: 'home', name: 'Sort and pack one category (books, decor, kitchen…)', category: 'Organization', minutes: 20, difficulty: 2, freq: 'weekly', impact: 6, base: 56, when: (c) => c.goals.has('moving'), steps: ['Pick one category', 'Decide: pack, donate, toss', 'Box and label what stays'], reason: 'You are preparing to move. Packing a category a week is steadier than a last-minute rush.' }),
  T({ id: 'g-moving-purge', rooms: ['living', 'bedroom'], scope: 'home', name: 'Donate and toss pass', category: 'Clutter', minutes: 15, difficulty: 1, freq: 'biweekly', impact: 5, base: 48, when: (c) => c.goals.has('moving'), steps: ['Check the donate box', 'Drop it off or schedule a pickup', 'Remove bulky trash'], reason: 'Less to pack means less to carry and less to unpack.' }),
  T({ id: 'g-guest-1', rooms: ['living', 'bedroom'], scope: 'home', name: 'Guest-ready: clear the entrance and living space', category: 'Guests', minutes: 15, difficulty: 1, freq: 'once', impact: 8, base: 66, when: (c) => c.goals.has('guests') || c.goals.has('event'), steps: ['Clear the entrance of shoes and bags', 'Tidy the seating area', 'Wipe the coffee table'], reason: 'You are preparing for guests. These are the spaces they see first.' }),
  T({ id: 'g-guest-2', rooms: ['bathroom'], scope: 'home', name: 'Guest-ready: refresh the bathroom', category: 'Guests', minutes: 12, difficulty: 1, freq: 'once', impact: 8, base: 64, when: (c) => (c.goals.has('guests') || c.goals.has('event')) && c.home.type !== 'dorm' && c.count('bathroom') > 0, steps: ['Wipe the sink and mirror', 'Quick toilet clean', 'Put out a fresh towel and soap', 'Empty the bin'], reason: 'The bathroom is the one room every guest visits.' }),
  T({ id: 'g-event', rooms: ['kitchen'], fallback: ['living'], scope: 'home', name: 'Event prep: wipe kitchen surfaces and clear the fridge', category: 'Guests', minutes: 20, difficulty: 2, freq: 'once', impact: 7, base: 60, when: (c) => c.goals.has('event'), steps: ['Wipe counters and the stovetop', 'Clear space in the fridge', 'Empty the bin'], reason: 'Hosting is easier with a clear kitchen.' }),
];

// ───────────────────────── Pets ─────────────────────────
const hasKind = (k: string) => (c: Ctx) => c.pets.types.has(k);
const petRoom = ['kitchen', 'laundry', 'bathroom', 'living'] as RoomKind[];
const pets: Template[] = [
  T({ id: 'p-litter', rooms: ['laundry', 'bathroom', 'kitchen'], fallback: ['living'], scope: 'home', name: 'Scoop the litter box', category: 'Pets', minutes: 3, difficulty: 1, freq: 'daily', impact: 7, base: 66, tags: ['habit', 'essential', 'quick'], topics: ['pet-hair'], needs: ['bags', 'gloves'], when: (c) => c.pets.cats && c.pets.features.has('litter'), steps: ['Scoop clumps and waste into a bag', 'Tie and bin the bag', 'Top up litter if low', 'Wash your hands'], tiny: ['Scoop what you see', 'Bag it and bin it'], reason: 'Daily scooping keeps odor low and your cat happy.' }),
  T({ id: 'p-litter-change', rooms: ['laundry', 'bathroom', 'kitchen'], fallback: ['living'], scope: 'home', name: 'Fully change and wash the litter box', category: 'Pets', minutes: 10, difficulty: 2, freq: 'weekly', impact: 5, base: 46, topics: ['pet-hair'], needs: ['dish-soap', 'gloves'], when: (c) => c.pets.cats && c.pets.features.has('litter'), step: { pets: 0 }, steps: ['Empty all the litter', 'Wash the box with hot soapy water (no strong chemicals)', 'Dry fully', 'Refill with fresh litter'], reason: 'A full change stops odors that scooping alone cannot.' }),
  T({ id: 'p-feeding', rooms: petRoom, scope: 'home', name: 'Wash pet bowls and wipe the feeding area', category: 'Pets', minutes: 4, difficulty: 1, freq: 'daily', impact: 6, base: 56, tags: ['habit', 'quick'], topics: ['pet-hair', 'floors'], needs: ['dish-soap', 'sponge'], when: (c) => c.pets.any && c.pets.features.has('feeding') && (c.pets.dogs || c.pets.cats), steps: ['Wash bowls with warm soapy water', 'Wipe the mat and floor around them', 'Refill water'], tiny: ['Rinse the water bowl', 'Wipe the floor around the bowls'], reason: 'Bowls and feeding spots grow bacteria quickly.' }),
  T({ id: 'p-beds', rooms: ['living', 'bedroom'], scope: 'home', name: 'Wash pet bedding', category: 'Pets', minutes: 8, difficulty: 1, freq: 'biweekly', impact: 5, base: 40, topics: ['pet-hair', 'laundry'], needs: ['laundry', 'lint-roller'], when: (c) => c.pets.any && c.pets.features.has('beds'), steps: ['Shake off hair outside', 'Wash on a hot, pet-safe cycle', 'Dry fully and put back'], reason: 'Pet beds hold hair, dander and odor.' }),
  T({ id: 'p-crate', rooms: ['living', 'bedroom'], scope: 'home', name: 'Wipe the pet crate', category: 'Pets', minutes: 6, difficulty: 1, freq: 'biweekly', impact: 4, base: 34, needs: ['dish-soap', 'cloth'], when: (c) => c.pets.any && c.pets.features.has('crates'), steps: ['Remove bedding and toys', 'Wipe the tray and bars with pet-safe soap', 'Dry and replace the bedding'], reason: 'Crates are small spaces and get smelly quickly.' }),
  T({ id: 'p-toys', rooms: ['living', 'bedroom'], scope: 'home', name: 'Wash and sort pet toys', category: 'Pets', minutes: 6, difficulty: 1, freq: 'monthly', impact: 3, base: 28, needs: ['dish-soap'], when: (c) => c.pets.any && c.pets.features.has('toys'), steps: ['Collect the toys from around the home', 'Wash what can be washed', 'Toss anything broken'], reason: 'Toys can hide dirt and clutter the floor.' }),
  T({ id: 'p-hair', rooms: ['living', 'bedroom'], scope: 'home', name: 'Brush your pet to cut down hair on the floors', category: 'Pets', minutes: 8, difficulty: 1, freq: 'weekly', impact: 5, base: 38, topics: ['pet-hair'], when: (c) => c.pets.sheds && c.pets.indoor && (c.pets.dogs || c.pets.cats), steps: ['Brush outside or on an easy-to-clean spot', 'Bag the hair', 'Wipe your brush'], reason: 'Less hair on the pet means less on your floors and furniture.' }),
  T({ id: 'p-paws', rooms: ['hallway', 'living', 'kitchen'], scope: 'home', name: 'Wipe paws and shake out the entry mat', category: 'Pets', minutes: 3, difficulty: 1, freq: 'daily', impact: 5, base: 42, tags: ['quick'], needs: ['cloth'], topics: ['floors', 'pet-hair'], when: (c) => c.pets.dogs && c.pets.outdoor, steps: ['Wipe paws with a damp towel', 'Shake out the mat'], reason: 'Wiping paws stops mud before it spreads across your floors.' }),
  T({ id: 'p-cage', rooms: petRoom, scope: 'home', name: 'Spot clean the cage or enclosure', category: 'Pets', minutes: 8, difficulty: 1, freq: 'twice-weekly', impact: 6, base: 52, needs: ['gloves', 'bags'], when: (c) => ['rabbit', 'small', 'bird', 'reptile'].some((k) => c.pets.types.has(k)), steps: ['Remove soiled bedding and food', 'Wipe the tray', 'Refresh bedding, food and water'], reason: 'Small enclosures need frequent attention to stay healthy.' }),
  T({ id: 'p-cage-deep', rooms: petRoom, scope: 'home', name: 'Full clean of the cage or enclosure', category: 'Pets', minutes: 20, difficulty: 2, freq: 'weekly', impact: 5, base: 44, needs: ['dish-soap'], when: (c) => ['rabbit', 'small', 'bird', 'reptile'].some((k) => c.pets.types.has(k)), steps: ['Move your pet to a safe spot', 'Empty and wash the enclosure with pet-safe soap', 'Rinse and dry fully', 'Refill'], reason: 'A weekly full clean prevents odor and illness.' }),
  T({ id: 'p-fish', rooms: petRoom, scope: 'home', name: 'Wipe the tank glass and check the filter', category: 'Pets', minutes: 10, difficulty: 1, freq: 'weekly', impact: 4, base: 40, needs: ['cloth'], when: hasKind('fish'), steps: ['Wipe algae from the glass', 'Check the filter flow', 'Wipe the lid and the stand'], reason: 'Weekly upkeep keeps the water healthy.' }),
];

// ───────────────────────── Reset (emergency) tasks ─────────────────────────
const rst = (t: Omit<Template, 'tier' | 'freq' | 'difficulty'> & { difficulty?: Difficulty }): Template => ({ tier: 'reset', freq: 'once', difficulty: 1, ...t });

const reset: Template[] = [
  rst({ id: 'r-trash-round', phase: 'trash', rooms: 'home', scope: 'floor', name: (c, r) => (c.floors > 1 ? `Trash round: ${r?.zone ?? 'this floor'}` : 'Trash round: collect all visible trash'), category: 'Trash', minutes: (c, r) => clamp((2 + (r?.areaM2 ?? c.area) * 0.05) * mm(c), 3, 14), impact: 10, base: 70, topics: ['trash'], needs: ['bags'], steps: (c, r) => ['Grab a trash bag', `Walk through: ${roomList(floorRooms(c, r)) || 'every room'}`, 'Pick up wrappers, packaging, tissues and anything obviously trash', 'Tie the bag and leave it by the door'], tiny: ['Grab one bag', 'Fill it with the first 10 pieces of trash you see', 'Tie it'], reason: 'Removing trash is the fastest, most visible change you can make.' }),
  rst({ id: 'r-trash-out', phase: 'trash', rooms: 'home', scope: 'home', name: 'Take the trash and recycling outside', category: 'Trash', minutes: 4, impact: 9, base: 68, topics: ['trash'], needs: ['bags'], steps: ['Take every full bag outside', 'Replace the liners', 'Take recycling out too'], tiny: ['Carry the bag to the bin'], reason: 'Gets the smell and the visual noise out of the house.' }),
  rst({ id: 'r-dishes-gather', phase: 'dishes', rooms: 'home', scope: 'home', name: 'Gather every dish, cup and glass in one place', category: 'Dishes', minutes: 4, impact: 9, base: 68, topics: ['dishes'], steps: ['Check bedrooms, living areas and desks', 'Bring everything to the sink or counter', 'Pour out any liquids'], tiny: ['Bring 5 things to the sink'], reason: 'Seeing all of it makes the next step far easier.' }),
  rst({ id: 'r-dishes-wash', phase: 'dishes', rooms: ['kitchen'], fallback: ['bedroom', 'living'], name: 'Wash or load all the dishes', category: 'Dishes', difficulty: 2, minutes: (c) => clamp((8 + 2.5 * (c.people - 1)) * mm(c), 8, 40), impact: 10, base: 68, topics: ['dishes', 'kitchen'], needs: ['dish-soap', 'sponge'], steps: ['Scrape plates and stack by type', 'Fill the sink with hot soapy water or load the dishwasher', 'Wash glasses first, then plates, then pots', 'Dry or rack everything', 'Empty the sink and wipe it'], tiny: ['Put dishes in the sink', 'Wash 3 dishes', 'Wash 3 more', 'Put clean dishes away'], reason: 'A clear sink changes how the whole kitchen feels.' }),
  rst({ id: 'r-dishes-wipe', phase: 'dishes', rooms: ['kitchen'], fallback: ['bedroom', 'living'], name: 'Wipe the sink and the counters', category: 'Kitchen', minutes: 5, impact: 8, base: 64, topics: ['kitchen-surfaces', 'kitchen'], needs: ['all-purpose', 'cloth'], steps: ['Clear one counter section', 'Wipe that section', 'Clear and wipe the rest', 'Rinse and wipe the sink'], tiny: ['Clear one section of counter', 'Wipe that section'], reason: 'This is where the "clean" feeling shows up fastest.' }),
  rst({ id: 'r-laundry-gather', phase: 'laundry', rooms: 'home', scope: 'home', name: 'Gather all the dirty laundry in one place', category: 'Laundry', minutes: 4, impact: 7, base: 64, topics: ['laundry'], steps: ['Check bedrooms, bathrooms and the floor behind doors', 'Put it in one basket or bag', 'Decide the first load: whites or colors'], tiny: ['Put 10 items in the hamper'], reason: 'Once the laundry is in one place, floors and chairs clear up instantly.' }),
  rst({ id: 'r-laundry-start', phase: 'laundry', rooms: ['laundry'], name: 'Start the first load of laundry', category: 'Laundry', minutes: 4, impact: 8, base: 64, topics: ['laundry'], needs: ['laundry'], steps: ['Load the machine', 'Add detergent', 'Press start and set a timer'], tiny: ['Put one load in', 'Press start'], reason: 'The machine does the work while you do the next step.' }),
  rst({ id: 'r-laundry-fold', phase: 'laundry', rooms: 'home', scope: 'home', name: 'Fold or hang clean clothes and put them away', category: 'Laundry', minutes: (c) => clamp((8 + 3 * (c.people - 1)) * mm(c), 8, 30), impact: 6, base: 56, topics: ['laundry', 'clutter'], steps: ['Take clothes out of the machine or basket', 'Fold or hang in one place', 'Put each pile away'], tiny: ['Fold 5 items', 'Put them away'], reason: 'Clean clothes in a pile are still clutter.' }),
  rst({ id: 'r-clutter', phase: 'clutter', rooms: ['living', 'bedroom', 'office', 'dining', 'hallway', 'other'], name: (_c, r) => `Clear visible clutter: ${r?.name ?? 'this room'}`, category: 'Clutter', difficulty: 2, minutes: (c, r) => clamp((4 + (r?.areaM2 ?? 12) * 0.32) * mm(c), 5, 24), impact: 9, base: 62, topics: ['clutter', 'organization'], when: (c, r) => !(c.shared && r?.kind === 'bedroom' && r.id !== 'bedroom-1'), steps: ['Grab a basket or bag', 'Pick up trash and dishes first', 'Put things back in their rooms', 'Put the rest in one "decide later" box'], tiny: ['Pick up 5 things and put them where they belong', 'Pick up 5 more', 'Stop or repeat'], reason: 'Clearing clutter makes every surface visible and easy to wipe.' }),
  rst({ id: 'r-surf-kitchen', phase: 'surfaces', rooms: ['kitchen'], name: 'Wipe kitchen counters and stovetop', category: 'Kitchen', minutes: (c) => 7 * mm(c), impact: 8, base: 60, topics: ['kitchen-surfaces', 'kitchen'], needs: ['all-purpose', 'degreaser', 'cloth'], steps: ['Clear one section at a time', 'Spray and wipe counters', 'Wipe the stovetop and splashes', 'Put back only what you use daily'], tiny: ['Wipe one counter section'], reason: 'Clean surfaces turn a tidy kitchen into a clean one.' }),
  rst({ id: 'r-surf-living', phase: 'surfaces', rooms: ['living', 'dining', 'office'], name: (_c, r) => `Wipe and dust the main surfaces: ${r?.name ?? 'this room'}`, category: 'Dust', minutes: (c, r) => clamp((3 + (r?.areaM2 ?? 12) * 0.16) * mm(c), 4, 12), impact: 6, base: 54, topics: ['dust', 'living-room'], needs: ['cloth', 'duster'], steps: ['Wipe the table', 'Dust the shelves and TV stand', 'Wipe any sticky spots'], tiny: ['Wipe the table'], reason: 'Dust and rings on surfaces make a room look neglected.' }),
  rst({ id: 'r-surf-bedroom', phase: 'surfaces', rooms: ['bedroom'], name: (_c, r) => `Clear and wipe the bedside tables: ${r?.name ?? 'bedroom'}`, category: 'Dust', minutes: 5, impact: 5, base: 50, topics: ['bedroom', 'dust'], needs: ['cloth'], when: (c, r) => !c.shared || r?.id === 'bedroom-1', steps: ['Remove cups and trash', 'Wipe the surfaces', 'Put back only what you use'], reason: 'A clear nightstand makes the bedroom feel calmer.' }),
  rst({ id: 'r-bath', phase: 'bathroom', rooms: ['bathroom'], name: (_c, r) => `Bathroom reset: ${r?.name ?? 'bathroom'}`, category: 'Bathroom', difficulty: 2, minutes: (c) => clamp(12 * mm(c), 10, 30), impact: 8, base: 62, topics: ['bathroom'], needs: ['bathroom', 'toilet', 'brush', 'cloth', 'gloves'], when: (c) => c.home.type !== 'dorm', steps: ['Clear the counter and the floor', 'Spray the sink, shower and toilet with their cleaners (never mix products)', 'Scrub the toilet and flush', 'Wipe the sink, mirror and counter', 'Rinse the shower', 'Empty the bin and hang a fresh towel'], tiny: ['Clear the bathroom counter', 'Wipe the sink', 'Wipe the toilet seat', 'Hang a fresh towel'], reason: 'A clean bathroom resets how clean the whole home feels.' }),
  rst({ id: 'r-floors', phase: 'floors', rooms: 'home', scope: 'floor', name: (c, r) => (c.floors > 1 ? `Vacuum or sweep: ${r?.zone ?? 'this floor'}` : 'Vacuum or sweep all floors'), category: 'Floors', difficulty: 2, minutes: (c, r) => clamp(((r?.areaM2 ?? c.area) * 0.22 + 4) * (c.pets.sheds ? 1.25 : 1), 6, 60), impact: 8, base: 58, topics: ['floors', 'pet-hair'], needs: ['vacuum', 'broom'], steps: (c, r) => ['Pick up anything on the floor first', c.pets.sheds ? 'Do the pet hair hot spots first' : 'Start at the far corner', `Work through: ${roomList(floorRooms(c, r)) || 'each room'}`, 'Empty the vacuum when you are done'], tiny: ['Pick up what is on the floor', 'Vacuum the walkway only', 'Stop or do the next area'], reason: 'Floors come last because they only look clean once the clutter is gone.' }),
  rst({ id: 'r-floors-mop', phase: 'floors', rooms: 'home', scope: 'home', name: 'Mop the kitchen and bathroom floors', category: 'Floors', difficulty: 2, minutes: (c) => clamp(10 * mm(c), 8, 25), impact: 6, base: 50, topics: ['floors'], needs: ['mop', 'floor'], when: (c) => c.mess >= 3 && c.count('kitchen') + c.count('bathroom') > 0 && c.home.type !== 'dorm', steps: ['Sweep first', 'Mop the kitchen from the far corner to the door', 'Mop the bathroom', 'Let everything dry'], reason: 'The final touch: it makes the finished home feel really clean.' }),
];

export const TEMPLATES: Template[] = [
  ...kitchen, ...bathroom, ...bedroom, ...living, ...dining, ...office, ...utility, ...hallway, ...storage,
  ...outdoors, ...floors, ...home, ...pets, ...reset,
];

export const PHASE_ORDER: ResetPhase[] = ['trash', 'dishes', 'laundry', 'clutter', 'surfaces', 'bathroom', 'floors'];
export const PHASE_LABEL: Record<ResetPhase, string> = {
  trash: 'Trash', dishes: 'Dishes', laundry: 'Laundry', clutter: 'Visible clutter', surfaces: 'Surfaces', bathroom: 'Bathroom', floors: 'Floors',
};
export const PHASE_WHY: Record<ResetPhase, string> = {
  trash: 'Biggest visual change for the least effort.',
  dishes: 'A clear sink and counter changes how the whole home feels.',
  laundry: 'Gets clothes off floors and chairs.',
  clutter: 'Makes every surface visible and easy to wipe.',
  surfaces: 'Where the "clean" feeling shows up.',
  bathroom: 'The room that makes the biggest hygiene difference.',
  floors: 'Floors come last because they only look clean once the clutter is gone.',
};
