import type { Ctx } from './context';
import type {
  Difficulty, EquipmentNeed, Frequency, Intensity, LifeDomain, LifeFocus, LifeLevel, TimeOfDay,
} from './types';

/**
 * Life-layer catalog: personal discipline and lifestyle tasks.
 *
 * Instead of near-duplicate tasks ("5-minute walk", "10-minute walk", …) each
 * template has a progression *ladder*. The engine picks the step that fits the
 * user's level and time, and offers the next step up as an optional challenge.
 * Defaults at template level are inherited by every step.
 */

export interface LifeStep {
  level: LifeLevel;
  minutes: number;
  name: string;
  description?: string;
  steps?: string[];
  difficulty?: Difficulty;
  intensity?: Intensity;
  equipment?: EquipmentNeed;
  lowImpact?: boolean;
  beginner?: boolean;
}

export interface LifeTemplate {
  id: string;
  domain: LifeDomain;
  sub: string; // subcategory
  focus: LifeFocus[]; // which user goals pull this task in
  freq: Frequency;
  time?: TimeOfDay;
  routine?: boolean;
  repeatable?: boolean;
  setting?: 'indoor' | 'outdoor' | 'either';
  tags?: string[];
  impact: number; // 1..10
  base: number; // 0..100, ranking among candidates
  description: string;
  reason: string;
  steps: string[];
  tiny?: string[];
  difficulty?: Difficulty;
  intensity?: Intensity;
  equipment?: EquipmentNeed;
  lowImpact?: boolean;
  beginner?: boolean;
  /** Suitable for the gentle "rough day" reset. */
  reset?: boolean;
  when?: (c: Ctx) => boolean;
  ladder: LifeStep[];
}

const S = (level: LifeLevel, minutes: number, name: string, extra: Partial<LifeStep> = {}): LifeStep => ({ level, minutes, name, ...extra });
const L = (t: LifeTemplate): LifeTemplate => t;

const hasOutdoorSpace = (c: Ctx) => c.rooms.some((r) => r.kind === 'balcony') || ['house', 'townhouse', 'duplex'].includes(c.home.type ?? '');

// ───────────────────────── Fitness & movement ─────────────────────────
// All bodyweight by default. Volumes are deliberately modest; every fitness task also gets a
// "stop if anything hurts" step appended by the engine.
const fitness: LifeTemplate[] = [
  L({ id: 'f-walk', domain: 'fitness', sub: 'Walking', focus: ['active', 'healthy', 'discipline', 'selfcare'], freq: 'daily', time: 'anytime', setting: 'outdoor', repeatable: true, lowImpact: true, tags: ['cardio', 'full-body'], impact: 8, base: 74,
    description: 'Walking is the easiest habit to keep. Go at a pace where you could still hold a conversation.', reason: 'A daily walk is gentle, needs no equipment and builds the habit of moving every day.',
    steps: ['Put on comfortable shoes', 'Head out the door (a route near home is fine)', 'Walk at an easy, steady pace', 'Head home and drink some water'], tiny: ['Put your shoes on', 'Step outside', 'Walk to the end of the street, then decide if you want to keep going'],
    ladder: [S(1, 5, '5-minute walk'), S(1, 10, '10-minute walk'), S(2, 20, '20-minute walk', { intensity: 'moderate' }), S(3, 30, '30-minute walk', { intensity: 'moderate' })] }),
  L({ id: 'f-stretch', domain: 'fitness', sub: 'Stretching', focus: ['active', 'healthy', 'selfcare', 'evening', 'morning'], freq: 'twice-weekly', time: 'anytime', setting: 'indoor', lowImpact: true, tags: ['flexibility', 'full-body'], impact: 6, base: 56,
    description: 'Slow, easy stretches. You should feel a mild pull, never pain.', reason: 'Regular gentle stretching keeps you moving comfortably and is a calm way to start or end the day.',
    steps: ['Stand or sit comfortably', 'Reach up tall, then slowly bend side to side', 'Gently stretch each shoulder, chest and the backs of your legs, holding each for about 20 seconds', 'Breathe slowly the whole time'],
    ladder: [S(1, 5, '5-minute stretch'), S(2, 10, '10-minute full-body stretch')] }),
  L({ id: 'f-mobility', domain: 'fitness', sub: 'Mobility', focus: ['active', 'healthy', 'selfcare'], freq: 'twice-weekly', time: 'morning', setting: 'indoor', lowImpact: true, tags: ['mobility', 'full-body'], impact: 6, base: 52,
    description: 'Slow joint circles and easy movements to loosen up.', reason: 'Joint-friendly movement helps you feel looser, especially if you sit a lot.',
    steps: ['Roll your neck slowly each way, 5 times', 'Do 8 shoulder rolls backwards', 'Circle your hips and ankles gently', 'Do 6 slow cat-cow movements on hands and knees (or seated)'],
    ladder: [S(1, 8, 'Mobility routine')] }),
  L({ id: 'f-desk-stretch', domain: 'fitness', sub: 'Stretching', focus: ['active', 'healthy', 'focus'], freq: 'daily', time: 'afternoon', setting: 'indoor', lowImpact: true, repeatable: true, tags: ['flexibility', 'upper-body'], impact: 4, base: 40,
    description: 'A quick reset for neck, shoulders and wrists if you sit for long periods.', reason: 'Short movement breaks help when you have been sitting for a while.',
    steps: ['Stand up', 'Roll your shoulders back 8 times', 'Gently tilt your head to each side', 'Stretch your wrists and reach overhead'],
    ladder: [S(1, 3, 'Desk stretch break')] }),
  L({ id: 'f-squats', domain: 'fitness', sub: 'Lower body', focus: ['active', 'healthy', 'discipline'], freq: 'twice-weekly', time: 'anytime', setting: 'indoor', repeatable: false, tags: ['lower-body', 'strength'], intensity: 'moderate', impact: 6, base: 50,
    description: 'Sit back like you are sitting into a chair, keep your chest up and your knees tracking over your toes.', reason: 'Squats are a simple, useful movement for everyday strength.',
    steps: ['Stand with feet about shoulder-width apart', 'Sit your hips back and down, as far as is comfortable (touch a chair if it helps)', 'Press through your feet to stand tall', 'Rest between sets'],
    ladder: [S(1, 3, '8 chair squats', { intensity: 'gentle', lowImpact: true }), S(2, 4, '2 sets of 10 squats', { difficulty: 2 }), S(3, 6, '3 sets of 12 squats', { difficulty: 2 })] }),
  L({ id: 'f-lunges', domain: 'fitness', sub: 'Lower body', focus: ['active', 'healthy'], freq: 'twice-weekly', time: 'anytime', setting: 'indoor', tags: ['lower-body', 'strength', 'balance'], intensity: 'moderate', impact: 5, base: 44,
    description: 'Step back with control and keep your front knee comfortable. Hold a wall or chair for balance if you need to.', reason: 'Lunges build leg strength and balance, one side at a time.',
    steps: ['Stand tall, holding a chair or wall if needed', 'Step one foot back and lower gently', 'Push through the front foot to return', 'Alternate legs and keep the movement slow'],
    ladder: [S(1, 4, '5 supported lunges per leg', { lowImpact: true }), S(2, 5, '2 sets of 8 reverse lunges per leg', { difficulty: 2 }), S(3, 7, '3 sets of 10 lunges per leg', { difficulty: 2 })] }),
  L({ id: 'f-pushups', domain: 'fitness', sub: 'Upper body', focus: ['active', 'healthy'], freq: 'twice-weekly', time: 'anytime', setting: 'indoor', tags: ['upper-body', 'strength', 'chest'], intensity: 'moderate', impact: 5, base: 46,
    description: 'Start at the angle that is comfortable for you. Hands on the wall is the easiest, hands on a counter or sofa is next, then the floor.', reason: 'Push-ups are a classic upper-body move you can scale to any level.',
    steps: ['Place your hands at shoulder height or slightly wider', 'Keep your body in one straight line', 'Lower your chest slowly, then press away', 'Rest when your form slips'],
    ladder: [S(1, 3, '2 sets of 8 wall push-ups', { lowImpact: true }), S(2, 4, '2 sets of 8 incline push-ups (hands on a sofa or counter)', { difficulty: 2 }), S(3, 5, '3 sets of 8 push-ups', { difficulty: 3, beginner: false })] }),
  L({ id: 'f-plank', domain: 'fitness', sub: 'Core', focus: ['active', 'healthy'], freq: 'twice-weekly', time: 'anytime', setting: 'indoor', tags: ['core', 'strength'], intensity: 'moderate', lowImpact: true, impact: 5, base: 44,
    description: 'Keep a straight line from head to knees (or heels). Breathe normally and stop when your form drops.', reason: 'Planks build the core strength that supports everyday movement.',
    steps: ['Set up on forearms and knees (or toes)', 'Tighten your tummy gently, keep your back flat', 'Hold for the target time while breathing', 'Rest, then repeat'],
    ladder: [S(1, 3, '3 knee planks of 15 seconds'), S(2, 4, '3 planks of 20 seconds', { difficulty: 2 }), S(3, 5, '3 planks of 40 seconds', { difficulty: 2 })] }),
  L({ id: 'f-crunches', domain: 'fitness', sub: 'Core', focus: ['active', 'healthy'], freq: 'twice-weekly', time: 'anytime', setting: 'indoor', tags: ['core', 'strength'], intensity: 'moderate', lowImpact: true, impact: 4, base: 38,
    description: 'Small, slow movements. Keep your neck relaxed and look at the ceiling.', reason: 'A short core session supports your back and posture.',
    steps: ['Lie on your back with knees bent', 'Hands lightly behind your head or crossed on your chest', 'Curl your shoulders up a few centimetres, then lower slowly', 'Breathe out as you lift'],
    ladder: [S(1, 3, '2 sets of 8 slow crunches'), S(2, 4, '2 sets of 12 crunches', { difficulty: 2 })] }),
  L({ id: 'f-leg-raises', domain: 'fitness', sub: 'Core', focus: ['active'], freq: 'twice-weekly', time: 'anytime', setting: 'indoor', tags: ['core', 'lower-body'], intensity: 'moderate', lowImpact: true, impact: 4, base: 34,
    description: 'Press your lower back gently into the floor and move slowly. Bend your knees if it feels strained.', reason: 'Leg raises train the lower abs without any equipment.',
    steps: ['Lie on your back, hands under your hips if helpful', 'Lift your legs (knees bent for the easier version)', 'Lower slowly without arching your back', 'Rest between sets'],
    ladder: [S(1, 3, '2 sets of 6 bent-knee leg raises'), S(2, 4, '2 sets of 10 leg raises', { difficulty: 2 })] }),
  L({ id: 'f-glute-bridge', domain: 'fitness', sub: 'Lower body', focus: ['active', 'healthy'], freq: 'twice-weekly', time: 'anytime', setting: 'indoor', tags: ['lower-body', 'strength', 'back-friendly'], intensity: 'gentle', lowImpact: true, impact: 4, base: 36,
    description: 'A back-friendly move for glutes and hips.', reason: 'Glute bridges are gentle and help counter long periods of sitting.',
    steps: ['Lie on your back, knees bent, feet flat', 'Press through your heels and lift your hips', 'Pause for a second, then lower slowly', 'Repeat at an easy pace'],
    ladder: [S(1, 3, '2 sets of 8 glute bridges'), S(2, 4, '3 sets of 10 glute bridges', { intensity: 'moderate' })] }),
  L({ id: 'f-jacks', domain: 'fitness', sub: 'Cardio', focus: ['active', 'healthy'], freq: 'twice-weekly', time: 'morning', setting: 'indoor', tags: ['cardio', 'full-body'], intensity: 'moderate', impact: 5, base: 42,
    description: 'Step jacks are the low-impact version. Jumping jacks add a little more intensity (and impact).', reason: 'Quick cardio to raise your heart rate and wake you up.',
    steps: ['Stand with feet together, arms by your sides', 'Step (or jump) your feet out as your arms rise', 'Return to the start and keep a steady rhythm', 'Slow down whenever you need to'],
    ladder: [S(1, 3, '2 rounds of 20 step jacks (low-impact)', { lowImpact: true }), S(2, 3, '2 rounds of 20 jumping jacks', { difficulty: 2, intensity: 'vigorous', lowImpact: false })] }),
  L({ id: 'f-climbers', domain: 'fitness', sub: 'Cardio', focus: ['active'], freq: 'twice-weekly', time: 'anytime', setting: 'indoor', tags: ['cardio', 'core', 'full-body'], intensity: 'vigorous', impact: 4, base: 30, beginner: false, difficulty: 3,
    description: 'A higher-intensity move. Keep your hands under your shoulders and move at a pace you can control.', reason: 'An optional higher-intensity challenge for when you feel strong.',
    steps: ['Start in a high plank, hands under shoulders', 'Drive one knee towards your chest, then switch', 'Keep your hips low and steady', 'Stop and rest as soon as you lose control'],
    ladder: [S(3, 4, '3 rounds of 20 seconds of mountain climbers')] }),
  L({ id: 'f-jump-rope', domain: 'fitness', sub: 'Cardio', focus: ['active'], freq: 'twice-weekly', time: 'anytime', setting: 'either', equipment: 'basic', tags: ['cardio'], intensity: 'vigorous', impact: 4, base: 28, beginner: false, difficulty: 2,
    description: 'Needs a skipping rope. Higher impact, so land softly.', reason: 'An optional cardio challenge if you own a skipping rope.',
    steps: ['Check you have room to swing the rope', 'Do 30 seconds of easy skipping', 'Rest for 30 seconds', 'Repeat 4 times'],
    ladder: [S(2, 5, 'Skipping rope intervals (4 x 30 seconds)')] }),
  L({ id: 'f-low-cardio', domain: 'fitness', sub: 'Cardio', focus: ['active', 'healthy', 'selfcare'], freq: 'twice-weekly', time: 'anytime', setting: 'indoor', lowImpact: true, tags: ['cardio', 'full-body'], repeatable: true, impact: 6, base: 50,
    description: 'Marching on the spot, step-touches and easy arm swings, with no jumping.', reason: 'Easy on the joints and still gets your heart rate up.',
    steps: ['March on the spot for a minute to warm up', 'Add step-touches side to side with arm swings', 'Mix in knee lifts and gentle punches', 'Cool down with slow marching'],
    ladder: [S(1, 10, '10-minute low-impact cardio'), S(2, 15, '15-minute low-impact cardio', { intensity: 'moderate' }), S(3, 20, '20-minute cardio session', { intensity: 'moderate', difficulty: 2 })] }),
  L({ id: 'f-full-body', domain: 'fitness', sub: 'Workouts', focus: ['active', 'healthy', 'discipline'], freq: 'twice-weekly', time: 'anytime', setting: 'indoor', tags: ['full-body', 'strength', 'cardio'], intensity: 'moderate', impact: 7, base: 58,
    description: 'A simple circuit of bodyweight moves with rests. Go at your own pace.', reason: 'A short full-body session covers strength and cardio in one go.',
    steps: ['Warm up with 2 minutes of marching and arm circles', 'Circuit: chair squats, wall or incline push-ups, glute bridges, march in place', 'Rest 30 seconds between moves and 1 minute between rounds', 'Cool down and stretch for 2 minutes'],
    ladder: [S(1, 12, 'Beginner full-body workout (2 gentle rounds)', { lowImpact: true }), S(2, 20, '20-minute full-body workout', { difficulty: 2 }), S(3, 30, '30-minute full-body workout', { difficulty: 3, beginner: false })] }),
  L({ id: 'f-core-workout', domain: 'fitness', sub: 'Workouts', focus: ['active', 'healthy'], freq: 'weekly', time: 'anytime', setting: 'indoor', tags: ['core', 'strength'], intensity: 'moderate', lowImpact: true, impact: 5, base: 44,
    description: 'Slow, controlled core exercises. Quality beats quantity.', reason: 'A weekly core session supports your back and posture.',
    steps: ['Warm up with gentle cat-cow movements', 'Do knee planks, slow crunches and glute bridges, 2 rounds', 'Rest as needed between moves', 'Finish with a gentle child\'s pose'],
    ladder: [S(1, 8, 'Beginner core workout'), S(2, 12, '12-minute core workout', { difficulty: 2 }), S(3, 15, '15-minute core workout', { difficulty: 2 })] }),
  L({ id: 'f-lower-workout', domain: 'fitness', sub: 'Workouts', focus: ['active', 'healthy'], freq: 'weekly', time: 'anytime', setting: 'indoor', tags: ['lower-body', 'strength'], intensity: 'moderate', impact: 5, base: 42,
    description: 'Squats, lunges and bridges in short rounds.', reason: 'Lower-body strength makes stairs, walking and daily life easier.',
    steps: ['Warm up with a minute of marching', 'Do chair squats, supported lunges and glute bridges, 2 rounds', 'Rest 30–60 seconds between moves', 'Stretch your legs for a minute'],
    ladder: [S(1, 10, 'Gentle lower-body workout', { lowImpact: true }), S(2, 15, '15-minute lower-body workout', { difficulty: 2 }), S(3, 20, '20-minute lower-body workout', { difficulty: 2 })] }),
  L({ id: 'f-upper-workout', domain: 'fitness', sub: 'Workouts', focus: ['active', 'healthy'], freq: 'weekly', time: 'anytime', setting: 'indoor', tags: ['upper-body', 'strength'], intensity: 'moderate', impact: 5, base: 40,
    description: 'Wall and incline push-ups plus shoulder and back work. Water bottles or a backpack can add resistance if you like.', reason: 'Upper-body strength helps with carrying, posture and everyday tasks.',
    steps: ['Warm up with arm circles and shoulder rolls', 'Do wall or incline push-ups, 2 rounds', 'Do slow arm raises (with water bottles if you have them)', 'Stretch your chest and shoulders'],
    ladder: [S(1, 10, 'Gentle upper-body workout', { lowImpact: true }), S(2, 15, '15-minute upper-body workout', { difficulty: 2 }), S(2, 15, '15-minute upper-body workout with weights (bottles or backpack)', { difficulty: 2, equipment: 'basic' })] }),
  L({ id: 'f-dance', domain: 'fitness', sub: 'Workouts', focus: ['active', 'healthy', 'selfcare'], freq: 'weekly', time: 'anytime', setting: 'indoor', tags: ['cardio', 'full-body', 'fun'], intensity: 'moderate', lowImpact: true, repeatable: true, impact: 5, base: 40,
    description: 'Put on music you love and move however feels good. Keep it low-impact if you prefer.', reason: 'Exercise works best when it is fun, and dancing is one of the most fun ways to move.',
    steps: ['Pick 2–3 songs you enjoy', 'Start with easy steps and arm swings', 'Add bigger movements as you warm up', 'Slow down for the last song and stretch'],
    ladder: [S(1, 10, '10-minute dance workout'), S(2, 20, '20-minute dance workout', { difficulty: 2 })] }),
  L({ id: 'f-recovery', domain: 'fitness', sub: 'Recovery', focus: ['active', 'healthy', 'selfcare'], freq: 'weekly', time: 'evening', setting: 'indoor', lowImpact: true, tags: ['recovery', 'mobility', 'flexibility'], impact: 5, base: 38, reset: true,
    description: 'A slow, easy session for rest days: gentle movement, stretching and calm breathing.', reason: 'Recovery days help your body rest and are a good habit for staying consistent.',
    steps: ['Walk slowly for 2–3 minutes', 'Do gentle stretches for legs, back and shoulders', 'Finish with a few slow breaths while lying down'],
    ladder: [S(1, 10, 'Recovery & mobility session')] }),
];

// ───────────────────────── Breathing & reset ─────────────────────────
// General relaxation exercises only: no claims about treating anything.
const breathing: LifeTemplate[] = [
  L({ id: 'b-breath', domain: 'breathing', sub: 'Slow breathing', focus: ['selfcare', 'discipline', 'focus', 'consistent'], freq: 'daily', time: 'anytime', setting: 'either', repeatable: true, lowImpact: true, reset: true, impact: 6, base: 62,
    description: 'Breathe in gently through the nose and let the breath out a little more slowly than it came in.', reason: 'A minute or two of slow breathing is a simple way to pause and reset during the day.',
    steps: ['Sit or stand comfortably and relax your shoulders', 'Breathe in slowly through your nose', 'Breathe out slowly, a little longer than the in-breath', 'Keep going for the time you set'], tiny: ['Relax your shoulders', 'Take 3 slow breaths'],
    ladder: [S(1, 1, '1-minute slow breathing'), S(1, 2, '2-minute breathing reset'), S(2, 5, '5-minute breathing session')] }),
  L({ id: 'b-box', domain: 'breathing', sub: 'Pattern breathing', focus: ['selfcare', 'focus'], freq: 'twice-weekly', time: 'anytime', setting: 'either', lowImpact: true, impact: 4, base: 40, difficulty: 2,
    description: 'Breathe in for 4, hold for 4, out for 4, hold for 4. Skip the holds or shorten them if it is uncomfortable.', reason: 'A steady, structured pattern gives your mind something simple to follow.',
    steps: ['Sit comfortably', 'Breathe in for a count of 4', 'Hold gently for 4 (skip if uncomfortable)', 'Breathe out for 4, hold for 4, and repeat for 4 minutes'],
    ladder: [S(2, 4, 'Box breathing (4-4-4-4)')] }),
  L({ id: 'b-46', domain: 'breathing', sub: 'Pattern breathing', focus: ['selfcare', 'evening', 'focus'], freq: 'daily', time: 'evening', routine: true, setting: 'indoor', lowImpact: true, reset: true, impact: 5, base: 48,
    description: 'Breathe in for 4 and out for 6. A longer out-breath feels calming for many people.', reason: 'A slow 4–6 pattern is an easy way to wind down.',
    steps: ['Sit or lie comfortably', 'Breathe in through your nose for 4', 'Breathe out gently through your mouth for 6', 'Repeat for 3 minutes'],
    ladder: [S(1, 3, '4–6 slow breathing')] }),
  L({ id: 'b-wake', domain: 'breathing', sub: 'Routine', focus: ['morning', 'selfcare', 'consistent'], freq: 'daily', time: 'morning', routine: true, setting: 'indoor', lowImpact: true, impact: 4, base: 46,
    description: 'Before you reach for your phone, take a few slow breaths.', reason: 'A calm first minute sets a gentler tone for the morning.',
    steps: ['Sit up on the edge of the bed', 'Place a hand on your belly', 'Take 8 slow breaths', 'Stretch your arms up and start your day'],
    ladder: [S(1, 2, 'Breathing after waking')] }),
  L({ id: 'b-sleep', domain: 'breathing', sub: 'Routine', focus: ['evening', 'selfcare', 'healthy'], freq: 'daily', time: 'evening', routine: true, setting: 'indoor', lowImpact: true, impact: 5, base: 54,
    description: 'Slow breathing in bed or just before it, with the lights low.', reason: 'A slow breathing habit is a calm way to end the day and signal that it is time to rest.',
    steps: ['Get comfortable in bed or on a chair', 'Breathe in gently, breathe out slowly', 'Let your shoulders and jaw soften', 'Continue for a few minutes, then rest'],
    ladder: [S(1, 3, 'Breathing before sleep')] }),
  L({ id: 'b-ground', domain: 'breathing', sub: 'Grounding', focus: ['selfcare', 'focus', 'discipline'], freq: 'daily', time: 'anytime', setting: 'either', lowImpact: true, repeatable: true, reset: true, impact: 5, base: 44,
    description: 'Notice your surroundings to bring your attention back to the present.', reason: 'A short grounding exercise helps you pause and reset when your mind is racing.',
    steps: ['Name 5 things you can see', 'Notice 4 things you can feel (feet on the floor, your clothes…)', 'Notice 3 things you can hear', 'Take 2 slow breaths and carry on'],
    ladder: [S(1, 3, '5-4-3-2-1 grounding reset')] }),
];

// ───────────────────────── Personal care ─────────────────────────
const care: LifeTemplate[] = [
  L({ id: 'c-shower', domain: 'care', sub: 'Hygiene', focus: ['selfcare', 'morning', 'healthy', 'discipline'], freq: 'daily', time: 'morning', routine: true, setting: 'indoor', impact: 6, base: 56,
    description: 'A shower resets your body and your mood.', reason: 'Showering is one of the quickest ways to feel like a new person.', steps: ['Gather a towel and clean clothes first', 'Shower, with just soap and water if you are short on time', 'Dry off and dress'], tiny: ['Put a towel on the rack', 'Step in the shower'],
    ladder: [S(1, 10, 'Take a shower')] }),
  L({ id: 'c-teeth', domain: 'care', sub: 'Hygiene', focus: ['selfcare', 'morning', 'healthy', 'consistent'], freq: 'daily', time: 'morning', routine: true, setting: 'indoor', impact: 6, base: 58,
    description: 'Two minutes to start the day with a clean mouth.', reason: 'The smallest habit with the biggest long-term payoff.', steps: ['Brush for two minutes', 'Brush your tongue gently', 'Floss if you have a moment'],
    ladder: [S(1, 2, 'Brush your teeth')] }),
  L({ id: 'c-teeth-night', domain: 'care', sub: 'Hygiene', focus: ['selfcare', 'evening', 'healthy', 'consistent'], freq: 'daily', time: 'evening', routine: true, setting: 'indoor', impact: 6, base: 56,
    description: 'Two minutes before bed. It also marks the end of the day.', reason: 'Brushing before bed is the evening half of the smallest habit with the biggest long-term payoff.', steps: ['Brush for two minutes', 'Brush your tongue gently', 'Floss if you have a moment'],
    ladder: [S(1, 2, 'Brush your teeth before bed')] }),
  L({ id: 'c-skincare', domain: 'care', sub: 'Grooming', focus: ['selfcare', 'evening'], freq: 'daily', time: 'evening', routine: true, setting: 'indoor', impact: 3, base: 36,
    description: 'Cleanse and moisturise (a basic routine is enough).', reason: 'A short evening ritual that feels like looking after yourself.', steps: ['Wash your face with lukewarm water', 'Pat dry', 'Apply moisturiser'],
    ladder: [S(1, 3, 'Skincare routine')] }),
  L({ id: 'c-hair', domain: 'care', sub: 'Grooming', focus: ['selfcare'], freq: 'twice-weekly', time: 'anytime', setting: 'indoor', impact: 3, base: 30,
    description: 'Wash, condition or style your hair, whatever it needs this time.', reason: 'Regular hair care is part of feeling put-together.', steps: ['Wash or brush your hair', 'Apply conditioner or any treatment if needed', 'Style or let it dry'],
    ladder: [S(1, 8, 'Hair care')] }),
  L({ id: 'c-clothes', domain: 'care', sub: 'Hygiene', focus: ['selfcare', 'morning', 'discipline'], freq: 'daily', time: 'morning', routine: true, setting: 'indoor', impact: 5, base: 50,
    description: 'Getting dressed properly changes how the day feels, even if you are staying in.', reason: 'Changing into clean clothes signals the start of the day.', steps: ['Pick a clean outfit', 'Put it on', 'Put yesterday\'s clothes in the laundry'],
    ladder: [S(1, 3, 'Change into clean clothes')] }),
  L({ id: 'c-water', domain: 'care', sub: 'Nutrition', focus: ['selfcare', 'healthy', 'discipline', 'consistent'], freq: 'daily', time: 'anytime', setting: 'either', repeatable: true, lowImpact: true, impact: 5, base: 52,
    description: 'Keep a glass or bottle where you can see it.', reason: 'Drinking enough water is easy to forget and easy to fix.', steps: ['Fill a glass or bottle', 'Drink it slowly', 'Refill it for later'], tiny: ['Fill a glass of water'],
    ladder: [S(1, 1, 'Drink a glass of water')] }),
  L({ id: 'c-breakfast', domain: 'care', sub: 'Meals', focus: ['selfcare', 'healthy', 'morning'], freq: 'daily', time: 'morning', routine: true, setting: 'indoor', impact: 5, base: 50,
    description: 'Eat something real, even if it is small.', reason: 'A proper breakfast gives you steady energy for the morning.', steps: ['Choose something simple (eggs, yoghurt, oats, toast…)', 'Sit down to eat it', 'Put the dishes in the sink'],
    ladder: [S(1, 10, 'Eat a proper breakfast')] }),
  L({ id: 'c-lunch', domain: 'care', sub: 'Meals', focus: ['selfcare', 'healthy'], freq: 'daily', time: 'afternoon', routine: true, setting: 'indoor', impact: 5, base: 46,
    description: 'Step away from screens for a few minutes and eat.', reason: 'Regular meals help your energy and mood hold up through the day.', steps: ['Make or heat something', 'Sit down away from your screen', 'Eat slowly'],
    ladder: [S(1, 15, 'Eat a proper lunch')] }),
  L({ id: 'c-dinner', domain: 'care', sub: 'Meals', focus: ['selfcare', 'healthy', 'evening'], freq: 'daily', time: 'evening', routine: true, setting: 'indoor', impact: 5, base: 46,
    description: 'Eat dinner at a table if you can.', reason: 'A proper evening meal makes the rest of the evening easier.', steps: ['Prepare something simple', 'Sit down to eat', 'Clear your plate afterwards'],
    ladder: [S(1, 20, 'Eat a proper dinner')] }),
  L({ id: 'c-cook', domain: 'care', sub: 'Meals', focus: ['selfcare', 'healthy'], freq: 'twice-weekly', time: 'evening', setting: 'indoor', difficulty: 2, impact: 6, base: 48,
    description: 'Cook something simple from real ingredients. Make extra for tomorrow if you like.', reason: 'Cooking a proper meal a few times a week supports healthier eating.', steps: ['Pick a simple recipe', 'Prep your ingredients', 'Cook and eat', 'Save any leftovers'],
    ladder: [S(2, 30, 'Prepare a proper meal')] }),
];

// ───────────────────────── Mind & focus ─────────────────────────
const mind: LifeTemplate[] = [
  L({ id: 'm-top3', domain: 'mind', sub: 'Planning', focus: ['focus', 'discipline', 'morning', 'consistent', 'organize'], freq: 'daily', time: 'morning', routine: true, setting: 'indoor', impact: 7, base: 66,
    description: 'Three things, not thirty.', reason: 'Choosing your top three priorities makes it much easier to start.', steps: ['Open a notebook or notes app', 'Write the three things that matter most today', 'Put the most important one first'],
    ladder: [S(1, 3, "Write today's top 3 priorities")] }),
  L({ id: 'm-journal', domain: 'mind', sub: 'Journaling', focus: ['selfcare', 'evening', 'focus'], freq: 'daily', time: 'evening', routine: true, setting: 'indoor', impact: 5, base: 50,
    description: 'Write whatever comes. It doesn\'t have to be neat or deep.', reason: 'A few minutes of writing helps you clear your head.', steps: ['Set a 5-minute timer', 'Write about your day, how you feel, or what you want to remember', 'Stop when the timer ends'],
    ladder: [S(1, 5, '5-minute journal')] }),
  L({ id: 'm-brain-dump', domain: 'mind', sub: 'Journaling', focus: ['selfcare', 'focus', 'organize'], freq: 'twice-weekly', time: 'anytime', setting: 'indoor', reset: true, impact: 5, base: 44,
    description: 'Get it out of your head and onto paper.', reason: 'Writing down what is bothering you often makes it feel smaller and more manageable.', steps: ['Write down everything that is on your mind', 'Circle anything you can act on', 'Pick one small next step for the circled item'],
    ladder: [S(1, 5, "Write down what's bothering you")] }),
  L({ id: 'm-gratitude', domain: 'mind', sub: 'Journaling', focus: ['selfcare', 'evening', 'consistent'], freq: 'daily', time: 'evening', routine: true, setting: 'indoor', lowImpact: true, reset: true, impact: 3, base: 38,
    description: 'Something small is fine: a good coffee, a kind message, sunshine.', reason: 'Noticing one good thing a day is a tiny habit that builds up.', steps: ['Think of one thing from today you are grateful for', 'Write it down in one sentence'],
    ladder: [S(1, 1, "Write one thing you're grateful for")] }),
  L({ id: 'm-read', domain: 'mind', sub: 'Reading', focus: ['focus', 'evening', 'study', 'phone', 'selfcare'], freq: 'daily', time: 'evening', setting: 'indoor', lowImpact: true, impact: 5, base: 52,
    description: 'Any book you enjoy counts.', reason: 'A little reading each day beats scrolling and adds up quickly.', steps: ['Pick up your book', 'Put your phone out of reach', 'Read for the time you set'], tiny: ['Open your book', 'Read one page'],
    ladder: [S(1, 5, 'Read 5 pages'), S(1, 10, 'Read for 10 minutes'), S(2, 20, 'Read for 20 minutes')] }),
  L({ id: 'm-focus', domain: 'mind', sub: 'Focus', focus: ['focus', 'discipline', 'study'], freq: 'daily', time: 'morning', setting: 'indoor', difficulty: 2, impact: 7, base: 60,
    description: 'Pick one task, silence notifications and work on only that.', reason: 'Short, protected focus blocks are the easiest way to get meaningful work done.', steps: ['Choose one task', 'Silence your phone and close other tabs', 'Set a timer and work on only that task', 'Take a proper break afterwards'],
    ladder: [S(1, 10, '10-minute focus block'), S(1, 15, '15-minute focused work session'), S(2, 25, '25-minute focused work session'), S(3, 45, '45-minute focused work session', { difficulty: 3 })] }),
  L({ id: 'm-review', domain: 'mind', sub: 'Planning', focus: ['focus', 'discipline', 'evening', 'consistent', 'organize'], freq: 'daily', time: 'evening', routine: true, setting: 'indoor', impact: 5, base: 48,
    description: 'Look at what you did, not what you didn\'t.', reason: 'A quick review helps you notice progress and adjust gently.', steps: ['Write down 1–3 things you completed today', 'Note one thing that helped', 'Note one thing to try tomorrow'],
    ladder: [S(1, 3, "Review today's progress")] }),
  L({ id: 'm-mental-todo', domain: 'mind', sub: 'Planning', focus: ['organize', 'focus', 'selfcare'], freq: 'weekly', time: 'anytime', setting: 'indoor', impact: 5, base: 42,
    description: 'Move every loose "I should…" out of your head.', reason: 'An overloaded mental list is tiring. Writing it down frees up space.', steps: ['List everything you are carrying in your head', 'Cross out what no longer matters', 'Schedule or delegate the rest'],
    ladder: [S(1, 10, 'Clean your mental to-do list')] }),
];

// ───────────────────────── Digital discipline ─────────────────────────
const digital: LifeTemplate[] = [
  L({ id: 'd-phone-free', domain: 'digital', sub: 'Phone-free time', focus: ['phone', 'focus', 'selfcare', 'discipline'], freq: 'daily', time: 'anytime', setting: 'either', lowImpact: true, impact: 7, base: 60,
    description: 'Leave your phone in another room and do something else.', reason: 'Short phone-free stretches rebuild your attention.', steps: ['Put your phone in another room (or in a drawer)', 'Do something screen-free', 'Pick it up again when the time is up'],
    ladder: [S(1, 5, 'Spend 5 minutes without your phone'), S(1, 10, 'Spend 10 minutes without your phone'), S(2, 30, '30 minutes without your phone'), S(3, 60, 'An hour without your phone')] }),
  L({ id: 'd-social-break', domain: 'digital', sub: 'Social media', focus: ['phone', 'focus', 'discipline'], freq: 'daily', time: 'afternoon', setting: 'either', lowImpact: true, impact: 6, base: 54,
    description: 'Close the apps and do something else for a set time.', reason: 'Taking planned breaks from social media makes it easier to use it on purpose.', steps: ['Close your social media apps', 'Set a timer', 'Do something else until it rings'],
    ladder: [S(1, 15, '15-minute social media break'), S(2, 30, '30-minute social media break')] }),
  L({ id: 'd-nophone-morning', domain: 'digital', sub: 'Routines', focus: ['phone', 'morning', 'discipline'], freq: 'twice-weekly', time: 'morning', routine: true, setting: 'indoor', difficulty: 2, impact: 6, base: 50,
    description: 'Keep your phone away until you have done a few things for yourself.', reason: 'Starting the day without a screen puts you in charge of your attention.', steps: ['Leave your phone in another room overnight (or in airplane mode)', 'Get ready, have breakfast or stretch first', 'Check your phone only after that'],
    ladder: [S(2, 20, 'No-phone morning: first 20 minutes')] }),
  L({ id: 'd-nophone-bed', domain: 'digital', sub: 'Routines', focus: ['phone', 'evening', 'healthy'], freq: 'daily', time: 'evening', routine: true, setting: 'indoor', impact: 6, base: 56,
    description: 'Charge your phone away from the bed.', reason: 'Less late-night scrolling makes it easier to fall asleep.', steps: ['Plug your phone in across the room', 'Set your alarm first if you use your phone for it', 'Do a calm activity instead (read, stretch, breathe)'],
    ladder: [S(1, 1, 'Put your phone away for the night'), S(2, 30, 'No phone for 30 minutes before bed', { difficulty: 2 }), S(3, 60, 'No phone for an hour before bed', { difficulty: 2 })] }),
  L({ id: 'd-notifications', domain: 'digital', sub: 'Tidying', focus: ['phone', 'organize', 'focus'], freq: 'monthly', time: 'anytime', setting: 'indoor', impact: 5, base: 44,
    description: 'Fewer pings, more calm.', reason: 'Every notification you switch off is one fewer interruption.', steps: ['Open your notification settings', 'Turn off everything that is not urgent or useful', 'Keep only calls, messages from people and key alerts'],
    ladder: [S(1, 10, 'Clear unnecessary notifications')] }),
  L({ id: 'd-apps', domain: 'digital', sub: 'Tidying', focus: ['phone', 'organize'], freq: 'monthly', time: 'anytime', setting: 'indoor', impact: 4, base: 36,
    description: 'Put the apps you use daily on page one and bury the rest.', reason: 'A tidy home screen makes it easier to avoid mindless apps.', steps: ['Delete apps you have not used in months', 'Put the most used apps on page one', 'Move distracting apps off the home screen'],
    ladder: [S(1, 15, 'Organize your phone apps')] }),
  L({ id: 'd-photos', domain: 'digital', sub: 'Tidying', focus: ['phone', 'organize'], freq: 'biweekly', time: 'anytime', setting: 'indoor', impact: 3, base: 32,
    description: 'Delete screenshots, blurry shots and duplicates.', reason: 'A small regular clear-out stops your photo library from becoming overwhelming.', steps: ['Open your photos', 'Delete screenshots and blurry duplicates', 'Empty the recently-deleted folder when you are sure'],
    ladder: [S(1, 15, 'Delete unnecessary photos')] }),
  L({ id: 'd-downloads', domain: 'digital', sub: 'Tidying', focus: ['organize', 'phone', 'focus'], freq: 'biweekly', time: 'anytime', setting: 'indoor', impact: 3, base: 32,
    description: 'File what matters, delete the rest.', reason: 'Clearing your Downloads folder takes minutes and makes everything easier to find.', steps: ['Open your Downloads folder', 'Sort by date and delete old installers and duplicates', 'Move anything important to its proper folder'],
    ladder: [S(1, 10, 'Clean your Downloads folder')] }),
  L({ id: 'd-files', domain: 'digital', sub: 'Tidying', focus: ['organize'], freq: 'monthly', time: 'anytime', setting: 'indoor', impact: 4, base: 34,
    description: 'A simple folder structure beats a perfect one.', reason: 'Organised files save you minutes every time you need something.', steps: ['Pick one messy folder', 'Create 3–5 clear folders', 'Move files in and delete what you don\'t need'],
    ladder: [S(1, 20, 'Organize your computer files')] }),
  L({ id: 'd-desktop', domain: 'digital', sub: 'Tidying', focus: ['organize', 'focus'], freq: 'weekly', time: 'anytime', setting: 'indoor', impact: 3, base: 34,
    description: 'A clear desktop is a clear head.', reason: 'Five minutes keeps the clutter from building up.', steps: ['Move loose files into folders', 'Delete what you don\'t need', 'Empty the trash'],
    ladder: [S(1, 5, 'Clean your computer desktop')] }),
];

// ───────────────────────── Life admin ─────────────────────────
const admin: LifeTemplate[] = [
  L({ id: 'a-calendar', domain: 'admin', sub: 'Planning', focus: ['organize', 'consistent', 'discipline', 'focus'], freq: 'daily', time: 'morning', routine: true, setting: 'indoor', impact: 5, base: 54,
    description: 'Know what is coming before it surprises you.', reason: 'A quick calendar check prevents missed appointments and double-booking.', steps: ['Open your calendar', 'Look at today and tomorrow', 'Note anything you need to prepare'],
    ladder: [S(1, 2, 'Check your calendar')] }),
  L({ id: 'a-plan-tomorrow', domain: 'admin', sub: 'Planning', focus: ['organize', 'evening', 'discipline', 'focus', 'consistent'], freq: 'daily', time: 'evening', routine: true, setting: 'indoor', impact: 7, base: 62,
    description: 'Decide tomorrow\'s first task tonight.', reason: 'Planning tomorrow in advance removes the hardest part, deciding where to start.', steps: ['Check tomorrow on your calendar', 'Write your top 3 for tomorrow', 'Note the very first action you will take'],
    ladder: [S(1, 5, 'Plan tomorrow')] }),
  L({ id: 'a-expenses', domain: 'admin', sub: 'Money', focus: ['organize', 'consistent', 'discipline'], freq: 'daily', time: 'evening', routine: true, setting: 'indoor', impact: 4, base: 40,
    description: 'Just write down what you spent.', reason: 'Seeing your spending is the first step to controlling it.', steps: ['Open your notes or budgeting app', 'Record what you spent today', 'Note any surprise costs'],
    ladder: [S(1, 3, "Record today's expenses")] }),
  L({ id: 'a-budget', domain: 'admin', sub: 'Money', focus: ['organize', 'discipline'], freq: 'weekly', time: 'anytime', setting: 'indoor', difficulty: 2, impact: 6, base: 50,
    description: 'A short weekly look at your money.', reason: 'A regular budget check catches problems early and reduces money stress.', steps: ['List the week\'s income and spending', 'Compare to your budget', 'Adjust one thing for next week'],
    ladder: [S(2, 20, 'Review your budget')] }),
  L({ id: 'a-bill', domain: 'admin', sub: 'Money', focus: ['organize', 'discipline'], freq: 'monthly', time: 'anytime', setting: 'indoor', impact: 6, base: 46,
    description: 'Pay one bill, or schedule it so you never need to remember.', reason: 'Paying bills on time avoids late fees and stress.', steps: ['Find the next bill due', 'Pay it or set up an automatic payment', 'Save the receipt'],
    ladder: [S(1, 10, 'Pay a bill')] }),
  L({ id: 'a-reply', domain: 'admin', sub: 'Communication', focus: ['organize', 'discipline', 'consistent'], freq: 'daily', time: 'afternoon', setting: 'indoor', impact: 5, base: 46,
    description: 'Short and honest is fine.', reason: 'Replying to one message you have been avoiding takes less time than you fear.', steps: ['Open the message or email you have been putting off', 'Write a short reply', 'Send it'],
    ladder: [S(1, 5, 'Answer one important message'), S(1, 10, 'Reply to an email you have been avoiding'), S(2, 20, 'Clear your 5 oldest emails')] }),
  L({ id: 'a-docs', domain: 'admin', sub: 'Organizing', focus: ['organize'], freq: 'monthly', time: 'anytime', setting: 'indoor', impact: 4, base: 36,
    description: 'Put important papers where you can find them.', reason: 'Organised documents save you from stressful searching later.', steps: ['Gather loose papers', 'Sort: keep, scan, shred', 'File the keepers in one place'],
    ladder: [S(1, 20, 'Organize your documents')] }),
  L({ id: 'a-appointment', domain: 'admin', sub: 'Communication', focus: ['organize', 'healthy', 'selfcare'], freq: 'monthly', time: 'anytime', setting: 'indoor', impact: 5, base: 40,
    description: 'Dentist, doctor, haircut, whatever you have been putting off.', reason: 'Booking it now means one less thing hanging over you.', steps: ['Decide which appointment to book', 'Call or book online', 'Add it to your calendar'],
    ladder: [S(1, 10, 'Make an appointment')] }),
  L({ id: 'a-prep-tomorrow', domain: 'admin', sub: 'Planning', focus: ['organize', 'evening', 'discipline', 'morning'], freq: 'daily', time: 'evening', routine: true, setting: 'indoor', impact: 5, base: 50,
    description: 'Bag, keys, charger, documents, anything you will need.', reason: 'Preparing tomorrow\'s essentials tonight makes mornings calm.', steps: ['Think about what you need tomorrow', 'Put it by the door or in your bag', 'Charge your phone and other devices'],
    ladder: [S(1, 5, "Prepare tomorrow's essentials")] }),
];

// ───────────────────────── Learning & self-development ─────────────────────────
const learning: LifeTemplate[] = [
  L({ id: 'l-study', domain: 'learning', sub: 'Study', focus: ['study', 'focus', 'consistent', 'discipline'], freq: 'daily', time: 'afternoon', setting: 'indoor', difficulty: 2, impact: 8, base: 68,
    description: 'Short, regular study beats occasional long sessions.', reason: 'A little every day is the most reliable way to learn.', steps: ['Choose one topic', 'Silence your phone', 'Study for the time you set', 'Write one thing you learned'],
    ladder: [S(1, 5, 'Study for 5 minutes'), S(1, 10, 'Study for 10 minutes'), S(2, 20, 'Study for 20 minutes'), S(3, 30, 'Study for 30 minutes')] }),
  L({ id: 'l-practice', domain: 'learning', sub: 'Skills', focus: ['study', 'consistent', 'discipline'], freq: 'daily', time: 'anytime', setting: 'indoor', impact: 6, base: 56,
    description: 'Pick a skill and do a small piece of it.', reason: 'Skills grow with frequent, short practice.', steps: ['Pick one thing to practise', 'Do it slowly and carefully', 'Note one thing to improve next time'],
    ladder: [S(1, 5, 'Practice a skill for 5 minutes'), S(1, 10, 'Practice a skill'), S(2, 20, 'Practice a skill for 20 minutes'), S(3, 30, 'Practice a skill for 30 minutes')] }),
  L({ id: 'l-learn-new', domain: 'learning', sub: 'Curiosity', focus: ['study', 'selfcare'], freq: 'twice-weekly', time: 'anytime', setting: 'indoor', impact: 4, base: 40,
    description: 'Watch a short explainer, read an article or try a tutorial.', reason: 'Curiosity is a habit, and small doses keep it alive.', steps: ['Pick a topic you are curious about', 'Spend 10 minutes learning about it', 'Write down one new thing'],
    ladder: [S(1, 10, 'Learn something new')] }),
  L({ id: 'l-instrument', domain: 'learning', sub: 'Music', focus: ['study', 'selfcare', 'consistent'], freq: 'daily', time: 'anytime', setting: 'indoor', impact: 5, base: 46,
    description: 'Warm up, work on one passage, play something you enjoy.', reason: 'Short daily instrument practice beats one long weekly session.', steps: ['Warm up with scales or easy exercises', 'Work slowly on one tricky passage', 'Finish by playing something fun'],
    ladder: [S(1, 10, 'Practice an instrument'), S(2, 20, 'Practice an instrument for 20 minutes'), S(3, 30, 'Practice an instrument for 30 minutes')] }),
  L({ id: 'l-singing', domain: 'learning', sub: 'Music', focus: ['study', 'selfcare'], freq: 'daily', time: 'anytime', setting: 'indoor', impact: 4, base: 38,
    description: 'Warm up gently and never strain your voice.', reason: 'Regular gentle practice builds your voice and confidence.', steps: ['Hum or lip-trill for a minute to warm up', 'Sing a few scales or easy phrases', 'Work on one song', 'Drink some water'],
    ladder: [S(1, 5, 'Singing warm-up'), S(1, 10, 'Practice singing'), S(2, 20, 'Practice singing for 20 minutes')] }),
  L({ id: 'l-music', domain: 'learning', sub: 'Music', focus: ['study'], freq: 'twice-weekly', time: 'anytime', setting: 'indoor', impact: 3, base: 32,
    description: 'Music theory, ear training or playing along to a track.', reason: 'Understanding music makes playing and singing easier.', steps: ['Pick one concept (a scale, a chord, a rhythm)', 'Practise it for a few minutes', 'Try it with a song'],
    ladder: [S(1, 10, 'Practice music (theory or ear training)')] }),
  L({ id: 'l-project', domain: 'learning', sub: 'Projects', focus: ['study', 'discipline', 'focus', 'consistent'], freq: 'twice-weekly', time: 'anytime', setting: 'indoor', difficulty: 2, impact: 6, base: 52,
    description: 'Make a little progress on something that matters to you.', reason: 'Small steady sessions are how personal projects actually get finished.', steps: ['Open the project', 'Decide on one small next step', 'Work on only that step for the set time', 'Note what to do next time'],
    ladder: [S(1, 10, 'Work on a personal project for 10 minutes'), S(1, 15, 'Work on a personal project'), S(2, 30, 'Work on a personal project for 30 minutes'), S(3, 60, 'A one-hour project session', { difficulty: 3 })] }),
  L({ id: 'l-read-edu', domain: 'learning', sub: 'Reading', focus: ['study', 'focus'], freq: 'twice-weekly', time: 'anytime', setting: 'indoor', lowImpact: true, impact: 5, base: 44,
    description: 'An article, a chapter, a paper, whatever teaches you something.', reason: 'Reading something educational keeps your knowledge growing.', steps: ['Choose an article or chapter', 'Read it without switching apps', 'Write one takeaway'],
    ladder: [S(1, 15, 'Read an educational article or book chapter')] }),
  L({ id: 'l-review', domain: 'learning', sub: 'Study', focus: ['study', 'evening', 'consistent'], freq: 'daily', time: 'evening', routine: true, setting: 'indoor', impact: 5, base: 46,
    description: 'Recall beats re-reading.', reason: 'Quickly reviewing what you learned makes it far more likely to stick.', steps: ['Close your notes', 'Write down what you remember from today', 'Check your notes and fill the gaps'],
    ladder: [S(1, 5, 'Review something you learned today')] }),
];

// ───────────────────────── Outdoors & lifestyle ─────────────────────────
const outdoor: LifeTemplate[] = [
  L({ id: 'o-outside', domain: 'outdoor', sub: 'Fresh air', focus: ['healthy', 'selfcare', 'active', 'phone'], freq: 'daily', time: 'anytime', setting: 'outdoor', lowImpact: true, repeatable: true, impact: 6, base: 58,
    description: 'Step outside, even if just to stand and look around.', reason: 'Fresh air and a change of scenery help you feel better.', steps: ['Step outside, leave the phone in your pocket if you can', 'Look around and take a few slow breaths', 'Stay for the time you set'],
    ladder: [S(1, 5, 'Go outside for 5 minutes'), S(1, 15, 'Go outside for 15 minutes'), S(2, 30, 'Take a 30-minute walk or visit a park')] }),
  L({ id: 'o-daylight', domain: 'outdoor', sub: 'Daylight', focus: ['healthy', 'morning', 'selfcare'], freq: 'daily', time: 'morning', routine: true, setting: 'either', lowImpact: true, impact: 5, base: 50,
    description: 'Natural light early in the day helps set your body clock.', reason: 'Morning daylight supports a healthy daily rhythm.', steps: ['Open the curtains and a window', 'Stand by the window or step outside', 'Take a few slow breaths in the light'],
    ladder: [S(1, 5, 'Get some daylight')] }),
  L({ id: 'o-park', domain: 'outdoor', sub: 'Nature', focus: ['healthy', 'selfcare', 'active'], freq: 'weekly', time: 'afternoon', setting: 'outdoor', lowImpact: true, difficulty: 1, impact: 5, base: 40,
    description: 'Somewhere green, even a small one.', reason: 'Time in green spaces is a pleasant, low-effort way to look after yourself.', steps: ['Pick a nearby park or green spot', 'Walk there without rushing', 'Sit or stroll for a while'],
    ladder: [S(2, 30, 'Visit a park')] }),
  L({ id: 'o-plants', domain: 'outdoor', sub: 'Plants', focus: ['selfcare', 'healthy', 'consistent'], freq: 'twice-weekly', time: 'morning', setting: 'either', when: hasOutdoorSpace, impact: 3, base: 32,
    description: 'Check the soil first. Water only if it is dry.', reason: 'Caring for plants is a small, rewarding routine.', steps: ['Check the soil with a finger', 'Water the dry ones', 'Remove dead leaves'],
    ladder: [S(1, 5, 'Water plants')] }),
  L({ id: 'o-groceries', domain: 'outdoor', sub: 'Planning', focus: ['healthy', 'organize', 'selfcare'], freq: 'weekly', time: 'anytime', setting: 'indoor', impact: 5, base: 44,
    description: 'Plan a few meals, then write the list.', reason: 'A little planning makes healthy eating and shopping easier.', steps: ['Pick 3–4 simple meals for the week', 'Check what you already have', 'Write your shopping list'],
    ladder: [S(1, 10, 'Grocery planning')] }),
];

// ───────────────────────── Sleep routine ─────────────────────────
const sleep: LifeTemplate[] = [
  L({ id: 's-bedtime', domain: 'sleep', sub: 'Routine', focus: ['evening', 'healthy', 'discipline', 'consistent'], freq: 'daily', time: 'evening', routine: true, setting: 'indoor', impact: 7, base: 64,
    description: 'Do the same few calm things in the same order each night.', reason: 'A consistent bedtime routine helps your body learn when it is time to sleep.', steps: ['Pick a regular time to start winding down', 'Do your teeth and get ready for bed', 'Switch to calm activities and dim the lights'],
    ladder: [S(1, 20, 'Start your bedtime routine')] }),
  L({ id: 's-clothes', domain: 'sleep', sub: 'Preparation', focus: ['evening', 'morning', 'organize', 'selfcare'], freq: 'daily', time: 'evening', routine: true, setting: 'indoor', impact: 4, base: 44,
    description: 'One less decision in the morning.', reason: 'Choosing tomorrow\'s outfit tonight makes mornings smoother.', steps: ['Choose an outfit for tomorrow', 'Lay it out or hang it ready', 'Check the weather if you need to'],
    ladder: [S(1, 3, 'Prepare clothes for tomorrow')] }),
  L({ id: 's-dim', domain: 'sleep', sub: 'Environment', focus: ['evening', 'healthy'], freq: 'daily', time: 'evening', routine: true, setting: 'indoor', lowImpact: true, impact: 3, base: 36,
    description: 'Softer light tells your body the day is ending.', reason: 'Dim lights in the evening help you wind down.', steps: ['Turn off the main light', 'Use a lamp or low light instead'],
    ladder: [S(1, 1, 'Dim the lights')] }),
  L({ id: 's-tidy', domain: 'sleep', sub: 'Preparation', focus: ['evening', 'discipline', 'organize'], freq: 'daily', time: 'evening', routine: true, setting: 'indoor', when: (c) => !c.focus.has('home'), impact: 5, base: 46,
    description: 'Clear the floor, put clothes in the hamper and reset your space.', reason: 'Going to sleep in a tidy room feels calmer, and waking up in one is a good start.', steps: ['Put clothes in the hamper or on a hanger', 'Clear any surface you will see first in the morning', 'Take dishes and trash out of the room'],
    ladder: [S(1, 5, 'Tidy your room for 5 minutes')] }),
  L({ id: 's-alarm', domain: 'sleep', sub: 'Preparation', focus: ['evening', 'morning', 'consistent'], freq: 'daily', time: 'evening', routine: true, setting: 'indoor', lowImpact: true, impact: 3, base: 34,
    description: 'Set it, then leave the phone across the room.', reason: 'Setting your alarm is the last small act that makes the morning easier.', steps: ['Set your alarm for tomorrow', 'Place your phone out of arm\'s reach'],
    ladder: [S(1, 1, 'Set your alarm')] }),
  L({ id: 's-read', domain: 'sleep', sub: 'Wind-down', focus: ['evening', 'phone', 'healthy'], freq: 'daily', time: 'evening', routine: true, setting: 'indoor', lowImpact: true, impact: 5, base: 50,
    description: 'A paper book or an e-reader with the screen dimmed.', reason: 'Reading instead of scrolling is an easy swap that helps you wind down.', steps: ['Put your phone away', 'Pick up a book', 'Read until you feel sleepy'],
    ladder: [S(1, 10, 'Read instead of scrolling'), S(2, 20, 'Read for 20 minutes before bed')] }),
  L({ id: 's-make-bed', domain: 'sleep', sub: 'Morning', focus: ['discipline', 'morning', 'consistent', 'healthy'], freq: 'daily', time: 'morning', routine: true, setting: 'indoor', when: (c) => !c.focus.has('home'), impact: 6, base: 70,
    description: 'The smallest first win of the day.', reason: 'Making your bed takes two minutes and starts the day with something finished.', steps: ['Straighten the sheet', 'Pull up the duvet', 'Fluff the pillows'], tiny: ['Pull up the duvet', 'Place the pillows'],
    ladder: [S(1, 2, 'Make your bed')] }),
];

export const LIFE_TEMPLATES: LifeTemplate[] = [
  ...fitness, ...breathing, ...care, ...mind, ...digital, ...admin, ...learning, ...outdoor, ...sleep,
];

/** Plain-language safety lines appended to tasks, so they are never forgotten. */
export const SAFETY_LINE: Partial<Record<LifeDomain, string>> = {
  fitness: 'Stop if anything hurts, you feel dizzy or something feels wrong. Go at your own pace. This is general guidance, not medical advice.',
  breathing: 'If you feel light-headed, return to your normal breathing. This is a simple relaxation exercise, not a medical treatment.',
};

export const LIFE_DOMAINS: LifeDomain[] = ['fitness', 'breathing', 'care', 'mind', 'digital', 'admin', 'learning', 'outdoor', 'sleep'];

/**
 * Tasks that do (nearly) the same job. A plan may hold at most `cap` from each group, so nobody gets a 10-minute walk, a separate
 * "go outside" and a park visit all in the same day, or four near-identical "planning" chores.
 */
export interface RedundancyGroup { id: string; cap: number; members: string[] }
export const REDUNDANCY_GROUPS: RedundancyGroup[] = [
  { id: 'walking', cap: 1, members: ['f-walk', 'o-outside', 'o-park'] },
  { id: 'stretching', cap: 1, members: ['f-stretch', 'f-mobility', 'f-desk-stretch', 'f-recovery'] },
  { id: 'strength-micro', cap: 2, members: ['f-squats', 'f-lunges', 'f-pushups', 'f-plank', 'f-crunches', 'f-leg-raises', 'f-glute-bridge'] },
  { id: 'workouts', cap: 2, members: ['f-full-body', 'f-core-workout', 'f-lower-workout', 'f-upper-workout', 'f-dance', 'f-low-cardio', 'f-jacks', 'f-climbers', 'f-jump-rope'] },
  { id: 'breathing-day', cap: 1, members: ['b-breath', 'b-ground', 'b-box'] },
  { id: 'breathing-night', cap: 1, members: ['b-46', 'b-sleep'] },
  { id: 'reflection', cap: 1, members: ['m-journal', 'm-review', 'l-review', 'm-gratitude'] },
  { id: 'plan-tomorrow', cap: 1, members: ['a-plan-tomorrow', 'a-prep-tomorrow'] },
  { id: 'plan-today', cap: 1, members: ['m-top3', 'a-calendar'] },
  { id: 'reading', cap: 1, members: ['m-read', 's-read'] },
  { id: 'phone-at-bed', cap: 1, members: ['d-nophone-bed', 's-alarm'] },
  { id: 'phone-free', cap: 1, members: ['d-phone-free', 'd-social-break'] },
  { id: 'study-daily', cap: 1, members: ['l-study', 'l-practice'] },
  { id: 'music', cap: 1, members: ['l-instrument', 'l-singing', 'l-music'] },
  { id: 'bedtime', cap: 1, members: ['s-bedtime', 'c-teeth-night'] },
  { id: 'dinner', cap: 1, members: ['c-dinner', 'c-cook'] },
  { id: 'digital-tidying', cap: 2, members: ['d-notifications', 'd-apps', 'd-photos', 'd-downloads', 'd-files', 'd-desktop'] },
  { id: 'money', cap: 2, members: ['a-expenses', 'a-budget', 'a-bill'] },
];

const GROUP_OF = new Map<string, RedundancyGroup[]>();
for (const g of REDUNDANCY_GROUPS) for (const m of g.members) GROUP_OF.set(m, [...(GROUP_OF.get(m) ?? []), g]);
export const groupsOf = (templateId: string): RedundancyGroup[] => GROUP_OF.get(templateId) ?? [];
