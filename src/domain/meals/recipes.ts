import type { CookEquip, Ingredient, MealSlot, Recipe, Unit } from './types';

/**
 * Starter recipes. Written for this app (the wording is original), built from everyday staples, and aimed at being inexpensive, simple and
 * meat-free where possible. "Inexpensive" here means the ingredients are common low-cost staples; the app holds no prices and does not
 * claim any amount. There are no nutrition figures anywhere in this file: the app has no verified source for them, so it shows none.
 */

const g = (name: string, qty: number | null, unit: Unit | null, extra: Partial<Ingredient> = {}): Ingredient => ({ name, qty, unit, ...extra });
const R = (
  id: string, name: string, slots: MealSlot[], servings: number, prep: number, cook: number, tags: string[], equipment: CookEquip[],
  ingredients: Ingredient[], steps: string[],
): Recipe => ({ id, name, source: 'starter', servings, prepMinutes: prep, cookMinutes: cook, slots, tags, equipment, ingredients, steps });

export const STARTER_RECIPES: Recipe[] = [
  // ── breakfast ──
  R('porridge-banana', 'Banana cinnamon porridge', ['breakfast'], 2, 2, 6, ['vegetarian', 'quick', 'inexpensive'], ['hob', 'microwave'], [
    g('rolled oats', 80, 'g'), g('milk', 400, 'ml', { note: 'or any plant milk' }), g('banana', 1, 'piece'), g('ground cinnamon', 0.5, 'tsp'), g('honey', 1, 'tsp', { optional: true }), g('salt', 1, 'pinch'),
  ], [
    'Put the oats, milk and salt in a small pan.', 'Heat gently, stirring, for 5 to 6 minutes until thick and creamy. Add a splash more milk if it gets too stiff.',
    'Slice the banana. Spoon the porridge into bowls and top with banana and cinnamon, and honey if you like.',
  ]),
  R('scrambled-eggs-toast', 'Scrambled eggs on toast', ['breakfast', 'lunch'], 2, 3, 5, ['vegetarian', 'quick', 'inexpensive'], ['hob'], [
    g('egg', 4, 'piece'), g('bread', 4, 'slice'), g('butter', 10, 'g'), g('milk', 2, 'tbsp'), g('salt', 1, 'pinch'), g('black pepper', 1, 'pinch'),
  ], [
    'Beat the eggs with the milk, salt and pepper.', 'Melt the butter in a non-stick pan over a low to medium heat and pour in the eggs.',
    'Stir slowly with a spatula, pulling the eggs from the edges to the middle, until just set but still soft. Take off the heat while they still look a little glossy.',
    'Toast the bread meanwhile and serve the eggs on top.',
  ]),
  R('pb-banana-toast', 'Peanut butter and banana toast', ['breakfast', 'snack'], 1, 3, 0, ['vegetarian', 'vegan', 'quick', 'inexpensive', 'no-cook'], [], [
    g('bread', 2, 'slice'), g('peanut butter', 2, 'tbsp'), g('banana', 1, 'piece'), g('ground cinnamon', 1, 'pinch', { optional: true }),
  ], ['Toast the bread.', 'Spread with peanut butter.', 'Slice the banana on top and finish with a pinch of cinnamon if you like.']),
  R('overnight-oats', 'Overnight oats with fruit', ['breakfast'], 2, 5, 0, ['vegetarian', 'inexpensive', 'no-cook', 'make-ahead'], [], [
    g('rolled oats', 100, 'g'), g('plain yogurt', 200, 'g'), g('milk', 150, 'ml', { note: 'or any plant milk' }), g('berries', 150, 'g', { note: 'fresh or frozen' }), g('honey', 2, 'tsp', { optional: true }),
  ], [
    'Mix the oats, yogurt and milk in a bowl or two jars.', 'Cover and leave in the fridge overnight, or at least 4 hours.',
    'Stir, loosen with a little milk if needed, and top with the fruit and honey.',
  ]),
  // ── lunch ──
  R('chickpea-salad', 'Chickpea and cucumber salad', ['lunch'], 2, 10, 0, ['vegetarian', 'vegan', 'inexpensive', 'no-cook', 'quick'], [], [
    g('tinned chickpeas', 1, 'can', { note: '400 g tin, drained' }), g('cucumber', 0.5, 'piece'), g('tomato', 2, 'piece'), g('red onion', 0.25, 'piece'), g('olive oil', 1, 'tbsp'),
    g('lemon', 0.5, 'piece', { note: 'juice' }), g('fresh parsley', 1, 'tbsp', { optional: true }), g('salt', 1, 'pinch'),
  ], [
    'Drain and rinse the chickpeas.', 'Chop the cucumber and tomatoes into bite-sized pieces and slice the onion very thinly.',
    'Toss everything with the oil, lemon juice and salt. Taste and adjust. It keeps well in the fridge for a day.',
  ]),
  R('lentil-soup', 'Red lentil soup', ['lunch', 'dinner'], 4, 10, 25, ['vegetarian', 'vegan', 'inexpensive', 'batch-friendly'], ['hob'], [
    g('red lentils', 200, 'g'), g('onion', 1, 'piece'), g('carrot', 2, 'piece'), g('garlic', 2, 'clove'), g('olive oil', 1, 'tbsp'), g('ground cumin', 1, 'tsp'),
    g('vegetable stock cube', 1, 'piece'), g('lemon', 0.5, 'piece', { optional: true, note: 'juice, to finish' }), g('salt', 1, 'pinch'),
  ], [
    'Chop the onion and carrots and crush the garlic.', 'Soften the onion and carrot in the oil for 5 minutes, then add the garlic and cumin for one more minute.',
    'Add the rinsed lentils, the stock cube and 1 litre of water. Bring to the boil, then simmer for 20 minutes until the lentils are soft.',
    'Blend part or all of it if you like it smooth. Season, and add a squeeze of lemon if you have it.',
  ]),
  R('cheese-quesadilla', 'Cheese and veg quesadillas', ['lunch', 'dinner'], 2, 8, 8, ['vegetarian', 'quick', 'inexpensive'], ['hob'], [
    g('flour tortillas', 4, 'piece'), g('hard cheese', 120, 'g', { note: 'grated' }), g('bell pepper', 1, 'piece'), g('sweetcorn', 80, 'g', { optional: true }), g('olive oil', 1, 'tsp'),
  ], [
    'Slice the pepper thinly and soften it in a little oil for 3 minutes.', 'Lay half the cheese, pepper and corn on two tortillas and cover with the other two.',
    'Cook in a dry pan over a medium heat for 2 to 3 minutes a side, pressing down, until golden and the cheese has melted. Cut into wedges.',
  ]),
  R('egg-fried-rice', 'Egg fried rice with peas', ['lunch', 'dinner'], 2, 5, 10, ['vegetarian', 'quick', 'inexpensive', 'uses-leftovers'], ['hob'], [
    g('rice', 150, 'g', { note: 'cooked and cooled, or cook fresh first' }), g('egg', 2, 'piece'), g('frozen peas', 100, 'g'), g('spring onion', 2, 'piece'), g('soy sauce', 1.5, 'tbsp'), g('olive oil', 1, 'tbsp'),
  ], [
    'Cook the rice if you have none ready and let it cool; cold rice fries better.', 'Heat the oil in a large pan, add the peas and the white parts of the spring onion for 2 minutes.',
    'Push to one side, scramble the eggs in the gap, then stir everything together with the rice and soy sauce for 3 minutes until hot.', 'Top with the green spring onion.',
  ]),
  R('tomato-garlic-pasta', 'Tomato and garlic pasta', ['lunch', 'dinner'], 2, 5, 15, ['vegetarian', 'vegan', 'inexpensive', 'quick'], ['hob'], [
    g('pasta', 200, 'g'), g('tinned chopped tomatoes', 1, 'can', { note: '400 g tin' }), g('garlic', 3, 'clove'), g('olive oil', 2, 'tbsp'), g('dried oregano', 1, 'tsp'), g('chilli flakes', 1, 'pinch', { optional: true }), g('salt', 1, 'pinch'),
  ], [
    'Cook the pasta in well-salted boiling water following the packet.', 'Meanwhile warm the oil, add the sliced garlic and cook for 30 seconds without browning.',
    'Add the tomatoes, oregano and chilli. Simmer 10 minutes until slightly thick. Season.', 'Toss the drained pasta in the sauce with a spoon of the pasta water.',
  ]),
  // ── dinner ──
  R('chickpea-curry', 'Chickpea and tomato curry', ['dinner'], 3, 10, 25, ['vegetarian', 'vegan', 'inexpensive', 'batch-friendly'], ['hob'], [
    g('tinned chickpeas', 2, 'can', { note: '400 g tins, drained' }), g('onion', 1, 'piece'), g('garlic', 3, 'clove'), g('fresh ginger', 1, 'tbsp', { note: 'grated' }), g('curry powder', 2, 'tsp'),
    g('tinned chopped tomatoes', 1, 'can'), g('olive oil', 1, 'tbsp'), g('rice', 225, 'g'), g('fresh coriander', 1, 'bunch', { optional: true }), g('salt', 1, 'pinch'),
  ], [
    'Start the rice following the packet.', 'Soften the chopped onion in the oil for 6 minutes. Add the garlic, ginger and curry powder and stir for a minute.',
    'Add the tomatoes, drained chickpeas and a small cup of water. Simmer for 15 minutes, stirring now and then, until thick.', 'Season and serve over the rice with coriander.',
  ]),
  R('veggie-chili', 'Three-bean veg chili', ['dinner'], 4, 10, 30, ['vegetarian', 'vegan', 'inexpensive', 'batch-friendly', 'freezes-well'], ['hob'], [
    g('tinned kidney beans', 2, 'can'), g('tinned black beans', 1, 'can'), g('tinned chopped tomatoes', 2, 'can'), g('onion', 1, 'piece'), g('bell pepper', 2, 'piece'), g('garlic', 3, 'clove'),
    g('ground cumin', 2, 'tsp'), g('paprika', 2, 'tsp'), g('chilli flakes', 1, 'tsp', { optional: true }), g('olive oil', 1, 'tbsp'), g('rice', 300, 'g', { note: 'to serve' }), g('salt', 1, 'pinch'),
  ], [
    'Soften the chopped onion and pepper in the oil for 8 minutes. Add the garlic and spices for one minute.', 'Add the tomatoes and the drained, rinsed beans.',
    'Simmer for 25 minutes, stirring now and then, adding a splash of water if it gets dry. Cook the rice meanwhile.', 'Season well. It tastes better the next day.',
  ]),
  R('veg-stir-fry', 'Vegetable stir-fry with noodles', ['dinner'], 2, 10, 8, ['vegetarian', 'vegan', 'quick', 'inexpensive'], ['hob'], [
    g('rice noodles', 150, 'g'), g('frozen mixed vegetables', 300, 'g', { note: 'stir-fry mix, or fresh' }), g('garlic', 2, 'clove'), g('fresh ginger', 1, 'tsp', { note: 'grated' }), g('soy sauce', 2, 'tbsp'), g('olive oil', 1, 'tbsp'),
  ], [
    'Soak or boil the noodles as the packet says, then drain.', 'Heat the oil in a large pan or wok on high. Stir-fry the vegetables for 4 to 5 minutes, adding the garlic and ginger for the last minute.',
    'Add the noodles and soy sauce and toss for 2 minutes until hot.',
  ]),
  R('beans-baked-potato', 'Baked potatoes with beans and cheese', ['lunch', 'dinner'], 2, 5, 60, ['vegetarian', 'inexpensive', 'low-effort'], ['oven', 'microwave'], [
    g('potato', 2, 'piece', { note: 'large baking potatoes' }), g('baked beans', 1, 'can'), g('hard cheese', 60, 'g', { note: 'grated' }), g('butter', 10, 'g', { optional: true }),
  ], [
    'Scrub the potatoes and prick them with a fork. Bake at 200 °C for about an hour until the skin is crisp and the middle is soft. (Or microwave for 8 to 10 minutes, then crisp in the oven for 10.)',
    'Warm the beans in a small pan. Split the potatoes, add butter if using, then beans and cheese.',
  ]),
  R('shakshuka', 'Shakshuka (eggs in spiced tomato)', ['dinner', 'lunch'], 2, 10, 20, ['vegetarian', 'inexpensive', 'one-pan'], ['hob'], [
    g('egg', 4, 'piece'), g('tinned chopped tomatoes', 1, 'can'), g('onion', 1, 'piece'), g('bell pepper', 1, 'piece'), g('garlic', 2, 'clove'), g('ground cumin', 1, 'tsp'), g('paprika', 1, 'tsp'),
    g('olive oil', 1, 'tbsp'), g('bread', 4, 'slice', { optional: true, note: 'to serve' }), g('salt', 1, 'pinch'),
  ], [
    'Soften the chopped onion and pepper in the oil for 8 minutes. Add the garlic and spices for one minute.', 'Add the tomatoes and simmer for 10 minutes until thick. Season.',
    'Make four wells, crack an egg into each, cover and cook on low for 5 to 8 minutes until the whites are set. Serve with bread.',
  ]),
  R('veg-omelette', 'Veggie omelette', ['breakfast', 'lunch', 'dinner'], 1, 5, 5, ['vegetarian', 'quick', 'inexpensive'], ['hob'], [
    g('egg', 3, 'piece'), g('mushroom', 80, 'g'), g('spinach', 30, 'g'), g('hard cheese', 20, 'g', { optional: true }), g('butter', 10, 'g'), g('salt', 1, 'pinch'),
  ], [
    'Slice the mushrooms and soften them in half the butter for 3 minutes. Add the spinach until it wilts, then tip onto a plate.', 'Beat the eggs with the salt and cook in the rest of the butter over a medium heat.',
    'When almost set, add the filling and cheese to one half, fold over, and slide out.',
  ]),
  R('pasta-peas-cheese', 'Pasta with peas and cheese', ['dinner', 'lunch'], 2, 5, 12, ['vegetarian', 'inexpensive', 'quick'], ['hob'], [
    g('pasta', 200, 'g'), g('frozen peas', 150, 'g'), g('hard cheese', 60, 'g', { note: 'grated' }), g('olive oil', 1, 'tbsp'), g('garlic', 1, 'clove'), g('lemon', 0.5, 'piece', { optional: true, note: 'zest and juice' }), g('black pepper', 1, 'pinch'),
  ], [
    'Boil the pasta; add the peas for the last 3 minutes.', 'Drain, keeping a mug of the water. Return to the pot with the oil, crushed garlic, half the cheese and a splash of the water.',
    'Stir until glossy, finish with lemon and pepper, and top with the rest of the cheese.',
  ]),
  R('tuna-sweetcorn-pasta', 'Tuna and sweetcorn pasta', ['dinner', 'lunch'], 2, 5, 12, ['pescatarian', 'inexpensive', 'quick'], ['hob'], [
    g('pasta', 200, 'g'), g('tinned tuna', 1, 'can', { note: 'drained' }), g('sweetcorn', 80, 'g'), g('tinned chopped tomatoes', 0.5, 'can'), g('olive oil', 1, 'tbsp'), g('garlic', 1, 'clove'),
  ], [
    'Cook the pasta following the packet.', 'Warm the oil, add the crushed garlic, tomatoes and corn and simmer 5 minutes. Stir in the flaked tuna to warm through.', 'Toss with the pasta.',
  ]),
  R('chicken-veg-traybake', 'Chicken and vegetable traybake', ['dinner'], 3, 15, 40, ['inexpensive', 'one-pan', 'batch-friendly'], ['oven'], [
    g('chicken thighs', 6, 'piece'), g('potato', 600, 'g'), g('carrot', 3, 'piece'), g('onion', 2, 'piece'), g('olive oil', 2, 'tbsp'), g('paprika', 2, 'tsp'), g('dried oregano', 1, 'tsp'), g('salt', 1, 'pinch'),
  ], [
    'Heat the oven to 200 °C. Cut the potatoes, carrots and onions into chunky, even pieces.', 'Toss everything with the oil, paprika, oregano and salt in a roasting tin, skin side up for the chicken.',
    'Roast for 40 minutes, turning the vegetables once, until the chicken is golden and cooked through with no pink inside (juices run clear). Check the thickest piece.',
  ]),
  R('red-dal', 'Red lentil dal with rice', ['dinner'], 3, 10, 25, ['vegetarian', 'vegan', 'inexpensive', 'batch-friendly'], ['hob'], [
    g('red lentils', 250, 'g'), g('onion', 1, 'piece'), g('garlic', 3, 'clove'), g('fresh ginger', 1, 'tbsp', { note: 'grated' }), g('ground turmeric', 1, 'tsp'), g('ground cumin', 1, 'tsp'), g('olive oil', 1, 'tbsp'),
    g('tinned chopped tomatoes', 0.5, 'can'), g('rice', 225, 'g'), g('salt', 1, 'pinch'),
  ], [
    'Soften the chopped onion in the oil for 6 minutes. Add the garlic, ginger, turmeric and cumin for a minute.', 'Add the rinsed lentils, tomatoes and 700 ml water. Simmer 20 to 25 minutes, stirring, until soft and thick. Cook the rice meanwhile.',
    'Season with salt and serve over the rice.',
  ]),
  // ── snacks ──
  R('apple-peanut-butter', 'Apple with peanut butter', ['snack'], 1, 2, 0, ['vegetarian', 'vegan', 'quick', 'no-cook', 'inexpensive'], [], [g('apple', 1, 'piece'), g('peanut butter', 1, 'tbsp')], ['Slice the apple and dip it in the peanut butter.']),
  R('hummus-veg', 'Hummus with carrot and cucumber', ['snack', 'lunch'], 1, 5, 0, ['vegetarian', 'vegan', 'quick', 'no-cook'], [], [g('hummus', 60, 'g'), g('carrot', 1, 'piece'), g('cucumber', 0.25, 'piece')], ['Cut the carrot and cucumber into sticks and serve with the hummus.']),
  R('yogurt-fruit', 'Yogurt with fruit and honey', ['snack', 'breakfast'], 1, 2, 0, ['vegetarian', 'quick', 'no-cook'], [], [g('plain yogurt', 150, 'g'), g('berries', 60, 'g'), g('honey', 1, 'tsp', { optional: true })], ['Spoon the yogurt into a bowl, add the fruit and a little honey.']),
  R('stovetop-popcorn', 'Stovetop popcorn', ['snack'], 2, 2, 5, ['vegetarian', 'vegan', 'inexpensive'], ['hob'], [g('popcorn kernels', 60, 'g'), g('olive oil', 1, 'tbsp'), g('salt', 1, 'pinch')], [
    'Warm the oil in a large pan with a lid, add 3 kernels and wait for them to pop.', 'Add the rest, cover, and shake the pan gently over medium heat until the popping slows to a couple of seconds apart. Salt and serve.',
  ]),
];

export const STARTER_BY_ID: Map<string, Recipe> = new Map(STARTER_RECIPES.map((r) => [r.id, r]));
