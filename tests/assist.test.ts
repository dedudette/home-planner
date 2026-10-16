import { describe, expect, it } from 'vitest';
import { emptyAppData } from '../src/domain/appdata';
import { describeChosen, itemKey, proposalActions } from '../src/domain/assist/apply';
import { buildLearningRequest, buildMealsRequest, buildMovementRequest } from '../src/domain/assist/build';
import { validateProposal, validateRequest } from '../src/domain/assist/contract';
import { localProposal } from '../src/domain/assist/local';
import { textProblem } from '../src/domain/assist/text';
import { LIMITS, type AssistRequest } from '../src/domain/assist/types';
import { STARTER_RECIPES } from '../src/domain/meals/recipes';
import { checkRecipe } from '../src/domain/meals/planner';
import { STARTER_WORKOUTS } from '../src/domain/movement/workouts';
import { reducer } from '../src/state/reducer';
import { TODAY } from './helpers';

const day = (n: number) => { const d = new Date(`${TODAY}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

const mealsReq = (over: Partial<AssistRequest> = {}): AssistRequest => ({
  v: 1, feature: 'meals', days: [day(0), day(1)], slots: ['lunch', 'dinner'], maxItems: 4, wish: '',
  candidates: [
    { id: 'r1', name: 'Red lentil soup', minutes: 30, tags: ['vegan'], slots: ['lunch', 'dinner'] },
    { id: 'r2', name: 'Veg omelette', minutes: 15, tags: ['quick'], slots: ['lunch'] },
    { id: 'r3', name: 'Tray bake', minutes: 45, tags: [], slots: ['dinner'] },
  ], ...over,
});
const moveReq = (over: Partial<AssistRequest> = {}): AssistRequest => ({
  v: 1, feature: 'movement', days: [day(0), day(1), day(2)], slots: [], maxItems: 2, wish: '',
  candidates: [{ id: 'w1', name: 'Easy walk', minutes: 20, tags: ['walking', 'beginner'] }, { id: 'w2', name: 'Stretch', minutes: 10, tags: ['stretching', 'beginner'] }], ...over,
});
const learnReq = (): AssistRequest => ({ v: 1, feature: 'learning', days: [], slots: [], maxItems: 3, wish: '', candidates: [{ id: 'drawing:contour-hand', name: 'Drawing: Draw your hand', minutes: 5, tags: ['visual-art', 'low', 'either'] }, { id: 'singing:hum-sing', name: 'Singing: Hum, then sing', minutes: 5, tags: ['music'] }] });

describe('a request is checked for its exact shape, size and contents', () => {
  it('accepts the three well-formed requests', () => {
    for (const r of [mealsReq(), moveReq(), learnReq()]) expect(validateRequest(JSON.parse(JSON.stringify(r)))).toMatchObject({ ok: true });
  });
  it('refuses extra keys, missing keys, a wrong version and a wrong feature', () => {
    expect(validateRequest({ ...mealsReq(), extra: 1 })).toMatchObject({ ok: false, code: 'invalid' });
    const { wish: _w, ...noWish } = mealsReq(); void _w;
    expect(validateRequest(noWish)).toMatchObject({ ok: false });
    expect(validateRequest({ ...mealsReq(), v: 2 })).toMatchObject({ ok: false });
    expect(validateRequest({ ...mealsReq(), feature: 'journal' })).toMatchObject({ ok: false });
    expect(validateRequest(null)).toMatchObject({ ok: false });
    expect(validateRequest('x')).toMatchObject({ ok: false });
    expect(validateRequest([])).toMatchObject({ ok: false });
  });
  it('refuses a candidate that carries anything beyond id, name, minutes, tags and slots', () => {
    const r = mealsReq(); (r.candidates[0] as unknown as Record<string, unknown>).ingredients = ['x'];
    expect(validateRequest(r)).toMatchObject({ ok: false });
    const r2 = mealsReq(); (r2.candidates[0] as unknown as Record<string, unknown>).journal = 'private';
    expect(validateRequest(r2)).toMatchObject({ ok: false });
  });
  it('refuses markup, links in ids, control characters survive only as spaces, and over-long text', () => {
    expect(validateRequest(mealsReq({ candidates: [{ id: 'r1', name: '<script>', minutes: 5, tags: [], slots: ['lunch'] }] }))).toMatchObject({ ok: false });
    expect(validateRequest(mealsReq({ candidates: [{ id: 'r1 ../../', name: 'x', minutes: 5, tags: [], slots: ['lunch'] }] }))).toMatchObject({ ok: false });
    expect(validateRequest(mealsReq({ wish: 'a'.repeat(LIMITS.wish + 1) }))).toMatchObject({ ok: false });
    const ok = validateRequest(mealsReq({ wish: 'quick\u0000 dinners\u0007' }));
    expect(ok.ok && ok.request.wish).toBe('quick dinners');
    expect(validateRequest(mealsReq({ candidates: Array.from({ length: LIMITS.candidates + 1 }, (_, i) => ({ id: `c${i}`, name: 'x', minutes: 1, tags: [], slots: ['lunch'] as const })) as never }))).toMatchObject({ ok: false });
  });
  it('refuses impossible dates, duplicate days, too many days and impossible numbers', () => {
    expect(validateRequest(mealsReq({ days: ['2026-02-30'] }))).toMatchObject({ ok: false });
    expect(validateRequest(mealsReq({ days: [day(0), day(0)] }))).toMatchObject({ ok: false });
    expect(validateRequest(mealsReq({ days: Array.from({ length: 8 }, (_, i) => day(i)) }))).toMatchObject({ ok: false });
    expect(validateRequest(mealsReq({ maxItems: 0 }))).toMatchObject({ ok: false });
    expect(validateRequest(mealsReq({ maxItems: 1.5 }))).toMatchObject({ ok: false });
    expect(validateRequest(mealsReq({ candidates: [{ id: 'r1', name: 'x', minutes: -1, tags: [], slots: ['lunch'] }] }))).toMatchObject({ ok: false });
  });
  it('each feature needs what it needs and nothing it should not have', () => {
    expect(validateRequest(mealsReq({ slots: [] }))).toMatchObject({ ok: false });
    expect(validateRequest(mealsReq({ days: [] }))).toMatchObject({ ok: false });
    expect(validateRequest(moveReq({ slots: ['lunch'] }))).toMatchObject({ ok: false });
    expect(validateRequest({ ...learnReq(), days: [day(0)] })).toMatchObject({ ok: false });
    expect(validateRequest(mealsReq({ candidates: [{ id: 'r1', name: 'x', minutes: 5, tags: [] }] }))).toMatchObject({ ok: false });
  });
  it('an empty candidate list is "insufficient", not invalid', () => {
    expect(validateRequest(mealsReq({ candidates: [] }))).toMatchObject({ ok: false, code: 'insufficient' });
  });
});

describe('what the assistant may say', () => {
  const ok = (t: string, n: number[] = []) => textProblem(t, n);
  it('allows a neutral reason that uses numbers from the request', () => {
    expect(ok('Quick, 30 minutes, and different from the other days.', [30])).toBeNull();
    expect(ok('A gentle walk to start the week.')).toBeNull();
  });
  it('refuses nutrition, body, medical, safety, price, pressure and change claims', () => {
    for (const t of ['High in protein.', 'Good for weight loss.', 'Helps with your diabetes.', 'This is allergy safe.', 'Only $5 to buy.', 'You should cook this.', 'You must not skip this.', 'A healthy choice.', 'Boosts your immune system.', 'Burns calories.', 'Cheap and easy.', "I've added it to your plan.", "I'll schedule it for you.", 'Make sure you drink water.', 'No streak to break.']) {
      expect(ok(t), t).not.toBeNull();
    }
  });
  it('refuses markup, links and numbers the request did not contain, including spelled-out amounts', () => {
    expect(ok('See <b>this</b>.')).not.toBeNull();
    expect(ok('Read https://example.org now.')).not.toBeNull();
    expect(ok('Ready in 12 minutes.', [30])).toMatch(/number 12/);
    expect(ok('Ready in twenty minutes.')).toBe('spelled-out quantity');
    expect(ok('Makes four servings.')).toBe('spelled-out quantity');
  });
});

describe('a proposal is checked against the exact request it answers', () => {
  const req = mealsReq();
  const item = (over: Record<string, unknown> = {}) => ({ candidateId: 'r1', date: day(0), slot: 'lunch', reason: 'A 30 minute soup.', ...over });
  const run = (items: unknown[], r: AssistRequest = req, note?: unknown) => validateProposal(JSON.stringify({ note, items }), r);

  it('keeps good items and says how many were dropped', () => {
    const v = run([item(), item({ candidateId: 'r3', slot: 'dinner', reason: 'A 45 minute bake.' }), item({ candidateId: 'invented' })]);
    expect(v.ok && v.proposal.items.map((i) => i.candidateId)).toEqual(['r1', 'r3']);
    expect(v.ok && v.dropped).toBe(1);
  });
  it('drops an invented candidate, a day or slot that was not offered, and a candidate that does not suit the slot', () => {
    expect(run([item({ candidateId: 'curry-house' })])).toEqual({ ok: false, reason: 'nothing-reliable' });
    expect(run([item({ date: day(5) })])).toEqual({ ok: false, reason: 'nothing-reliable' });
    expect(run([item({ slot: 'snack' })])).toEqual({ ok: false, reason: 'nothing-reliable' });
    expect(run([item({ candidateId: 'r2', slot: 'dinner', reason: 'A 15 minute omelette.' })])).toEqual({ ok: false, reason: 'nothing-reliable' });
    expect(run([item({ date: null })])).toEqual({ ok: false, reason: 'nothing-reliable' });
  });
  it('one meal per slot: a second item for the same day and slot is dropped', () => {
    const v = run([item(), item({ candidateId: 'r3', slot: 'lunch' })]);
    expect(v.ok && v.proposal.items).toHaveLength(1);
  });
  it('never returns more items than the request allowed', () => {
    const r = mealsReq({ maxItems: 1 });
    const v = run([item(), item({ candidateId: 'r3', slot: 'dinner', reason: 'A 45 minute bake.' })], r);
    expect(v.ok && v.proposal.items).toHaveLength(1);
  });
  it('drops an item whose reason breaks the text rules, but keeps the others', () => {
    const v = run([item({ reason: 'Healthy and high in protein.' }), item({ candidateId: 'r3', slot: 'dinner', reason: 'A 45 minute bake.' })]);
    expect(v.ok && v.proposal.items.map((i) => i.candidateId)).toEqual(['r3']);
  });
  it('drops an item that quotes a number the request did not have', () => {
    expect(run([item({ reason: 'Ready in 10 minutes.' })])).toEqual({ ok: false, reason: 'nothing-reliable' });
  });
  it('an unreliable note is left out; the items stand', () => {
    const v = run([item()], req, 'A healthy week for you!');
    expect(v.ok && v.proposal.note).toBe('');
    const v2 = run([item()], req, 'A simple spread over two days.');
    expect(v2.ok && v2.proposal.note).toBe('A simple spread over two days.');
  });
  it('reads a fenced reply, and refuses anything that is not a proposal', () => {
    expect(validateProposal('```json\n' + JSON.stringify({ items: [item()] }) + '\n```', req)).toMatchObject({ ok: true });
    expect(validateProposal('here you go: lunch!', req)).toEqual({ ok: false, reason: 'malformed' });
    expect(validateProposal(JSON.stringify({ items: 'x' }), req)).toEqual({ ok: false, reason: 'malformed' });
    expect(validateProposal(JSON.stringify({ items: [] }), req)).toEqual({ ok: false, reason: 'malformed' });
    expect(validateProposal(JSON.stringify([item()]), req)).toEqual({ ok: false, reason: 'malformed' });
  });
  it('movement: one session per day, no slot, only offered days; learning: no date and no slot', () => {
    const m = moveReq();
    const mv = validateProposal(JSON.stringify({ items: [{ candidateId: 'w1', date: day(0), reason: 'A 20 minute walk.' }, { candidateId: 'w2', date: day(0), reason: 'A 10 minute stretch.' }, { candidateId: 'w2', date: day(2), reason: 'A 10 minute stretch.' }] }), m);
    expect(mv.ok && mv.proposal.items.map((i) => [i.candidateId, i.date])).toEqual([['w1', day(0)], ['w2', day(2)]]);
    expect(validateProposal(JSON.stringify({ items: [{ candidateId: 'w1', date: day(0), slot: 'lunch', reason: 'A 20 minute walk.' }] }), m)).toEqual({ ok: false, reason: 'nothing-reliable' });
    const l = learnReq();
    const lv = validateProposal(JSON.stringify({ items: [{ candidateId: 'drawing:contour-hand', reason: 'A 5 minute first try.' }, { candidateId: 'drawing:contour-hand', reason: 'again' }] }), l);
    expect(lv.ok && lv.proposal.items).toHaveLength(1);
    expect(validateProposal(JSON.stringify({ items: [{ candidateId: 'drawing:contour-hand', date: day(0), reason: 'A 5 minute first try.' }] }), l)).toEqual({ ok: false, reason: 'nothing-reliable' });
  });
});

describe('candidates are chosen on the device, with the person\'s own settings, before anything could be sent', () => {
  it('meals: nothing that lists an avoided allergen or breaks the diet is ever offered, and the settings themselves are not in the request', () => {
    let d = emptyAppData(TODAY);
    d = reducer(d, { type: 'MEALS_PREFS', patch: { diet: 'vegan', avoid: ['gluten', 'sesame'] } });
    const built = buildMealsRequest(d, { days: [day(0), day(1)], slots: ['lunch', 'dinner'], wish: '', includeOwnDishes: false });
    expect(built.request.candidates.length).toBeGreaterThan(0);
    for (const c of built.request.candidates) {
      const r = STARTER_RECIPES.find((x) => x.id === c.id)!;
      const check = checkRecipe(r);
      expect(check.allergens, c.name).not.toContain('gluten');
      expect(check.allergens, c.name).not.toContain('sesame');
      expect(check.diet, c.name).toBe('vegan');
      expect(check.unchecked, c.name).toEqual([]);
    }
    const text = JSON.stringify(built.request);
    expect(text).not.toMatch(/vegan|vegetarian|pescatarian|inexpensive|avoid|gluten|sesame|household|allerg/i);
    expect(built.kept.join(' ')).toMatch(/can hint at them/);
    expect(validateRequest(JSON.parse(text))).toMatchObject({ ok: true });
  });
  it('meals: the person\'s own dishes are left out unless they say so', () => {
    let d = emptyAppData(TODAY);
    d = reducer(d, { type: 'DISH_SAVE', dish: { id: 'dish_mine', name: 'Nana\'s secret stew', source: 'personal', servings: 2, prepMinutes: 10, cookMinutes: 20, slots: ['dinner'], tags: [], equipment: [], ingredients: [{ name: 'carrot', qty: 2, unit: 'piece' }], steps: ['Cook it'] } });
    const off = buildMealsRequest(d, { days: [day(0)], slots: ['dinner'], wish: '', includeOwnDishes: false });
    expect(JSON.stringify(off.request)).not.toContain('Nana');
    const on = buildMealsRequest(d, { days: [day(0)], slots: ['dinner'], wish: '', includeOwnDishes: true });
    expect(JSON.stringify(on.request)).toContain('Nana');
    expect(on.preview.join(' ')).toMatch(/recipes?, with name, minutes and tags only/);
  });
  it('movement: rest days are not offered as days, and a low-energy day offers only gentle workouts', () => {
    let d = emptyAppData(TODAY);
    const dow = (s: string) => new Date(`${s}T12:00:00`).getDay();
    d = reducer(d, { type: 'MOVE_REST_DAYS', days: [dow(day(1))] });
    const b = buildMovementRequest(d, { today: TODAY, days: 7, maxItems: 3, maxMinutes: null, wish: '', includeOwn: false });
    expect(b.request.days).not.toContain(day(1));
    expect(b.request.days).toContain(day(0));
    const low = { ...d, dayEnergy: { date: TODAY, level: 'low' as const } };
    const lb = buildMovementRequest(low, { today: TODAY, days: 7, maxItems: 3, maxMinutes: null, wish: '', includeOwn: false });
    const ids = new Set(lb.request.candidates.map((c) => c.id));
    expect(ids.size).toBeGreaterThan(0);
    for (const w of STARTER_WORKOUTS.filter((x) => ids.has(x.id))) expect(['beginner']).toContain(w.level);
    expect(lb.request.candidates.length).toBeLessThan(b.request.candidates.length);
  });
  it('learning: ideas marked "not for me" are never offered', () => {
    let d = emptyAppData(TODAY);
    d = reducer(d, { type: 'INTEREST_SAVE', interest: { id: 'i1', name: 'Singing', catalogId: 'singing', category: 'music', status: 'not-for-me', goal: '', weeklyMinutes: null, note: '', createdAt: '2026-10-01T00:00:00.000Z' } });
    const b = buildLearningRequest(d, { minutes: 60, budget: 'some', setting: 'either', social: 'either' }, '');
    expect(b.request.candidates.some((c) => c.id.startsWith('singing:'))).toBe(false);
    expect(b.request.candidates.length).toBeGreaterThan(0);
  });
  it('journals, check-ins, water, health notes and the interests list are not reachable from a request: the shape has nowhere to put them', () => {
    const d = emptyAppData(TODAY);
    const all = [buildMealsRequest(d, { days: [day(0)], slots: ['dinner'], wish: '', includeOwnDishes: true }), buildMovementRequest(d, { today: TODAY, days: 3, maxItems: 2, maxMinutes: 30, wish: '', includeOwn: true }), buildLearningRequest(d, { minutes: 15, budget: 'free', setting: 'either', social: 'either' }, '')];
    for (const b of all) expect(Object.keys(b.request).sort()).toEqual(['candidates', 'days', 'feature', 'maxItems', 'slots', 'v', 'wish']);
  });
});

describe('the app\'s own suggestion: same shape, no AI, nothing invented', () => {
  it('always passes the same checks an AI proposal passes, for all three features', () => {
    for (const req of [mealsReq(), moveReq(), learnReq()]) {
      const p = localProposal(req);
      expect(p.items.length).toBeGreaterThan(0);
      const v = validateProposal({ items: p.items }, req);
      expect(v.ok && v.dropped, req.feature).toBe(0);
    }
  });
  it('meals: fills slots that fit, and does not repeat a dish while there is still something new', () => {
    const p = localProposal(mealsReq({ days: [day(0), day(1), day(2)], slots: ['dinner'], maxItems: 3 }));
    const ids = p.items.map((i) => i.candidateId);
    expect(new Set(ids).size).toBe(Math.min(ids.length, 2));
    expect(p.items.every((i) => i.slot === 'dinner')).toBe(true);
  });
  it('movement: spreads sessions out, never two on one day, never more than allowed', () => {
    const p = localProposal(moveReq({ days: [day(0), day(1), day(2), day(3)], maxItems: 2 }));
    expect(p.items).toHaveLength(2);
    expect(new Set(p.items.map((i) => i.date)).size).toBe(2);
    const dates = p.items.map((i) => i.date!);
    expect(dates[1] > dates[0]).toBe(true);
  });
  it('returns nothing, not something invented, when there are no candidates', () => {
    expect(localProposal(mealsReq({ candidates: [] })).items).toEqual([]);
  });
});

describe('approving a proposal makes ordinary actions, and only from the app\'s own catalogue', () => {
  const d0 = emptyAppData(TODAY);
  const recipe = STARTER_RECIPES.find((r) => r.slots.includes('dinner'))!;
  const workout = STARTER_WORKOUTS[0];
  const mealsP = { feature: 'meals' as const, note: '', items: [{ candidateId: recipe.id, date: day(1), slot: 'dinner' as const, reason: 'x' }, { candidateId: 'not-a-recipe', date: day(1), slot: 'lunch' as const, reason: 'x' }] };
  const moveP = { feature: 'movement' as const, note: '', items: [{ candidateId: workout.id, date: day(2), slot: null, reason: 'x' }] };

  it('only the ticked items become meals, with the household size and the recipe\'s own name', () => {
    const none = proposalActions(d0, mealsP, new Set(), TODAY);
    expect(none.actions).toEqual([]);
    const some = proposalActions(d0, mealsP, new Set(mealsP.items.map(itemKey)), TODAY);
    expect(some.added).toBe(1);
    expect(some.skipped).toBe(1);
    const a = some.actions[0];
    expect(a.type === 'MEAL_SAVE' && a.entry).toMatchObject({ date: day(1), slot: 'dinner', name: recipe.name, status: 'planned', servings: d0.meals.prefs.household, kcal: null });
  });
  it('approving twice adds nothing the second time', () => {
    const chosen = new Set(mealsP.items.map(itemKey));
    let d = d0;
    for (const a of proposalActions(d, mealsP, chosen, TODAY).actions) d = reducer(d, a);
    expect(d.meals.plan).toHaveLength(1);
    const again = proposalActions(d, mealsP, chosen, TODAY);
    expect(again.added).toBe(0);
  });
  it('a workout becomes a planned activity with the workout\'s own minutes, never the assistant\'s', () => {
    const r = proposalActions(d0, moveP, new Set(moveP.items.map(itemKey)), TODAY);
    const a = r.actions[0];
    expect(a.type === 'ACTIVITY_SAVE' && a.activity).toMatchObject({ module: 'movement', kind: 'flexible', name: workout.name, schedule: { kind: 'once', date: day(2) }, ref: { kind: 'workout', id: workout.id } });
    let d = d0; for (const x of r.actions) d = reducer(d, x);
    expect(d.activities).toHaveLength(1);
    expect(proposalActions(d, moveP, new Set(moveP.items.map(itemKey)), TODAY).added).toBe(0);
  });
  it('a day that has already passed is skipped, and learning ideas change nothing by themselves', () => {
    const past = { ...mealsP, items: [{ candidateId: recipe.id, date: day(-1), slot: 'dinner' as const, reason: 'x' }] };
    expect(proposalActions(d0, past, new Set(past.items.map(itemKey)), TODAY)).toMatchObject({ added: 0, skipped: 1 });
    const l = { feature: 'learning' as const, note: '', items: [{ candidateId: 'drawing:contour-hand', date: null, slot: null, reason: 'x' }] };
    expect(proposalActions(d0, l, new Set(l.items.map(itemKey)), TODAY).actions).toEqual([]);
  });
  it('words the button honestly', () => {
    expect(describeChosen(mealsP, new Set([itemKey(mealsP.items[0])]))).toBe('1 meal');
    expect(describeChosen(moveP, new Set())).toBe('0 sessions');
  });
});
