import type { Allergen, Diet, ShopCategory } from './types';

/**
 * The ingredient catalogue: what a name means. It gives every ingredient one identity (so "tomatoes", "tomato" and "fresh tomato" are one
 * line on a shopping list), a shop category, the allergens the ingredient commonly contains, and the strictest diet it fits.
 *
 * Allergen flags are deliberately cautious (an ingredient is flagged when it commonly contains the allergen or is often cross-contacted),
 * and they are a filter for suggestions only. They are NOT a guarantee that anything is safe: packaging and a doctor decide that.
 */
export interface IngredientInfo { id: string; name: string; aliases: string[]; category: ShopCategory; allergens: Allergen[]; diet: Diet }

const I = (id: string, name: string, category: ShopCategory, diet: Diet = 'vegan', allergens: Allergen[] = [], aliases: string[] = []): IngredientInfo => ({ id, name, aliases, category, allergens, diet });

export const INGREDIENTS: IngredientInfo[] = [
  // produce
  I('onion', 'onion', 'produce', 'vegan', [], ['onions', 'yellow onion', 'brown onion']),
  I('red-onion', 'red onion', 'produce', 'vegan', [], ['red onions']),
  I('spring-onion', 'spring onion', 'produce', 'vegan', [], ['spring onions', 'scallion', 'scallions', 'green onion', 'green onions']),
  I('garlic', 'garlic', 'produce', 'vegan', [], ['garlic clove', 'garlic cloves', 'cloves of garlic']),
  I('ginger', 'fresh ginger', 'produce', 'vegan', [], ['ginger', 'root ginger']),
  I('tomato', 'tomato', 'produce', 'vegan', [], ['tomatoes', 'fresh tomato', 'fresh tomatoes', 'ripe tomato']),
  I('cucumber', 'cucumber', 'produce', 'vegan', [], ['cucumbers']),
  I('carrot', 'carrot', 'produce', 'vegan', [], ['carrots']),
  I('potato', 'potato', 'produce', 'vegan', [], ['potatoes', 'baking potato', 'baking potatoes']),
  I('sweet-potato', 'sweet potato', 'produce', 'vegan', [], ['sweet potatoes']),
  I('bell-pepper', 'bell pepper', 'produce', 'vegan', [], ['bell peppers', 'red pepper', 'green pepper', 'red bell pepper']),
  I('courgette', 'courgette', 'produce', 'vegan', [], ['courgettes', 'zucchini']),
  I('spinach', 'spinach', 'produce', 'vegan', [], ['baby spinach']),
  I('cabbage', 'cabbage', 'produce', 'vegan', [], []),
  I('broccoli', 'broccoli', 'produce', 'vegan', [], []),
  I('mushroom', 'mushroom', 'produce', 'vegan', [], ['mushrooms']),
  I('lettuce', 'lettuce', 'produce', 'vegan', [], ['salad leaves', 'mixed leaves']),
  I('lemon', 'lemon', 'produce', 'vegan', [], ['lemons', 'lemon juice']),
  I('lime', 'lime', 'produce', 'vegan', [], ['limes']),
  I('banana', 'banana', 'produce', 'vegan', [], ['bananas']),
  I('apple', 'apple', 'produce', 'vegan', [], ['apples']),
  I('berries', 'berries', 'produce', 'vegan', [], ['berry', 'fresh berries', 'blueberries', 'strawberries']),
  I('parsley', 'fresh parsley', 'produce', 'vegan', [], ['parsley']),
  I('coriander', 'fresh coriander', 'produce', 'vegan', [], ['coriander', 'cilantro']),
  I('basil', 'fresh basil', 'produce', 'vegan', [], ['basil']),
  // dairy and eggs
  I('egg', 'egg', 'dairy-eggs', 'vegetarian', ['egg'], ['eggs']),
  I('milk', 'milk', 'dairy-eggs', 'vegetarian', ['milk'], ['whole milk', 'semi-skimmed milk']),
  I('plant-milk', 'plant milk', 'drinks', 'vegan', [], ['oat milk', 'soya milk', 'almond milk']),
  I('yogurt', 'plain yogurt', 'dairy-eggs', 'vegetarian', ['milk'], ['yogurt', 'yoghurt', 'natural yogurt', 'plain yoghurt']),
  I('butter', 'butter', 'dairy-eggs', 'vegetarian', ['milk'], []),
  I('cheese', 'hard cheese', 'dairy-eggs', 'vegetarian', ['milk'], ['cheese', 'cheddar', 'grated cheese', 'mature cheddar']),
  I('feta', 'feta', 'dairy-eggs', 'vegetarian', ['milk'], ['feta cheese']),
  // meat and fish
  I('chicken-thigh', 'chicken thighs', 'meat-fish', 'omnivore', [], ['chicken thigh', 'chicken', 'chicken pieces']),
  I('tuna', 'tinned tuna', 'tinned', 'pescatarian', ['fish'], ['tuna', 'canned tuna', 'tuna chunks']),
  // bakery
  I('bread', 'bread', 'bakery', 'vegan', ['gluten'], ['sliced bread', 'wholemeal bread', 'toast']),
  I('tortilla', 'flour tortillas', 'bakery', 'vegan', ['gluten'], ['tortilla', 'tortillas', 'wraps', 'flour tortilla']),
  // dry goods
  I('oats', 'rolled oats', 'pantry', 'vegan', ['gluten'], ['oats', 'porridge oats', 'jumbo oats']),
  I('rice', 'rice', 'pantry', 'vegan', [], ['long grain rice', 'basmati rice', 'white rice', 'brown rice']),
  I('pasta', 'pasta', 'pantry', 'vegan', ['gluten'], ['spaghetti', 'penne', 'fusilli', 'dried pasta']),
  I('rice-noodles', 'rice noodles', 'pantry', 'vegan', [], ['noodles']),
  I('red-lentils', 'red lentils', 'pantry', 'vegan', [], ['lentils', 'split red lentils', 'dried red lentils']),
  I('green-lentils', 'green or brown lentils', 'pantry', 'vegan', [], ['brown lentils', 'green lentils']),
  I('couscous', 'couscous', 'pantry', 'vegan', ['gluten'], []),
  I('flour', 'plain flour', 'pantry', 'vegan', ['gluten'], ['flour', 'all-purpose flour']),
  I('sugar', 'sugar', 'pantry', 'vegan', [], []),
  I('honey', 'honey', 'pantry', 'vegetarian', [], []),
  I('peanut-butter', 'peanut butter', 'pantry', 'vegan', ['peanut'], []),
  I('nuts', 'mixed nuts', 'pantry', 'vegan', ['tree-nut', 'peanut'], ['nuts', 'almonds', 'walnuts', 'cashews']),
  I('raisins', 'raisins', 'pantry', 'vegan', [], ['sultanas', 'dried fruit']),
  I('popcorn-kernels', 'popcorn kernels', 'pantry', 'vegan', [], ['popcorn']),
  // tinned and jarred
  I('chickpeas', 'tinned chickpeas', 'tinned', 'vegan', [], ['chickpeas', 'canned chickpeas', 'chickpeas tin']),
  I('kidney-beans', 'tinned kidney beans', 'tinned', 'vegan', [], ['kidney beans', 'canned kidney beans']),
  I('black-beans', 'tinned black beans', 'tinned', 'vegan', [], ['black beans', 'canned black beans']),
  I('baked-beans', 'baked beans', 'tinned', 'vegan', [], ['tinned baked beans']),
  I('chopped-tomatoes', 'tinned chopped tomatoes', 'tinned', 'vegan', [], ['chopped tomatoes', 'canned tomatoes', 'tinned tomatoes', 'tin of tomatoes']),
  I('sweetcorn', 'sweetcorn', 'tinned', 'vegan', [], ['corn', 'tinned sweetcorn', 'canned sweetcorn']),
  I('coconut-milk', 'coconut milk', 'tinned', 'vegan', [], ['tinned coconut milk', 'canned coconut milk']),
  I('tomato-paste', 'tomato paste', 'tinned', 'vegan', [], ['tomato puree', 'tomato purée']),
  I('hummus', 'hummus', 'tinned', 'vegan', ['sesame'], ['houmous']),
  // frozen
  I('peas', 'frozen peas', 'frozen', 'vegan', [], ['peas', 'garden peas']),
  I('frozen-veg', 'frozen mixed vegetables', 'frozen', 'vegan', [], ['mixed vegetables', 'frozen vegetables', 'stir-fry vegetables', 'stir fry vegetables']),
  I('frozen-spinach', 'frozen spinach', 'frozen', 'vegan', [], []),
  // oils, sauces, condiments
  I('olive-oil', 'olive oil', 'oils-sauces', 'vegan', [], ['oil', 'vegetable oil', 'cooking oil', 'rapeseed oil']),
  I('soy-sauce', 'soy sauce', 'oils-sauces', 'vegan', ['soy', 'gluten'], ['soya sauce']),
  I('vinegar', 'vinegar', 'oils-sauces', 'vegan', [], ['white wine vinegar', 'cider vinegar']),
  I('mustard', 'mustard', 'oils-sauces', 'vegan', ['mustard'], ['dijon mustard']),
  I('stock-cube', 'vegetable stock cube', 'oils-sauces', 'vegan', ['celery'], ['stock cube', 'vegetable stock', 'veg stock cube', 'stock cubes']),
  I('curry-paste', 'curry paste', 'oils-sauces', 'vegan', [], []),
  // spices
  I('salt', 'salt', 'spices', 'vegan', [], []),
  I('black-pepper', 'black pepper', 'spices', 'vegan', [], ['ground black pepper']),
  I('cumin', 'ground cumin', 'spices', 'vegan', [], ['cumin']),
  I('paprika', 'paprika', 'spices', 'vegan', [], ['smoked paprika']),
  I('curry-powder', 'curry powder', 'spices', 'vegan', ['mustard'], []),
  I('turmeric', 'ground turmeric', 'spices', 'vegan', [], ['turmeric']),
  I('cinnamon', 'ground cinnamon', 'spices', 'vegan', [], ['cinnamon']),
  I('chilli-flakes', 'chilli flakes', 'spices', 'vegan', [], ['chili flakes', 'chilli powder', 'chili powder']),
  I('oregano', 'dried oregano', 'spices', 'vegan', [], ['oregano', 'mixed herbs', 'dried mixed herbs']),
  I('coriander-seed', 'ground coriander', 'spices', 'vegan', [], []),
];

/** A name as it is compared: lowercase, no punctuation, single spaces, plural endings folded. */
export const normalizeName = (s: string): string => {
  const base = s.toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim();
  return base.split(' ').map(singular).join(' ');
};

const singular = (w: string): string => {
  if (w.length <= 3) return w;
  if (/(ss|us|is)$/.test(w)) return w;
  if (/ies$/.test(w)) return w.slice(0, -3) + 'y';
  if (/(tomato|potato|mango)es$/.test(w)) return w.slice(0, -2);
  if (/(ches|shes|xes|sses)$/.test(w)) return w.slice(0, -2);
  if (/ves$/.test(w)) return w.slice(0, -1);
  if (w.endsWith('s')) return w.slice(0, -1);
  return w;
};

const INDEX = new Map<string, IngredientInfo>();
for (const info of INGREDIENTS) for (const n of [info.name, info.id, ...info.aliases]) INDEX.set(normalizeName(n), info);

/** The catalogue entry for a typed ingredient name, or null when the app does not know it. */
export const lookupIngredient = (name: string): IngredientInfo | null => INDEX.get(normalizeName(name)) ?? null;

export interface Identity { key: string; name: string; category: ShopCategory; allergens: Allergen[]; /** null when the name is not in the catalogue: nothing is assumed about it. */ diet: Diet | null; known: boolean }

/** One identity for any ingredient name. Unknown names get a stable key of their own and the "other" category, and are never checked. */
export const identify = (name: string): Identity => {
  const hit = lookupIngredient(name);
  if (hit) return { key: hit.id, name: hit.name, category: hit.category, allergens: hit.allergens, diet: hit.diet, known: true };
  const n = normalizeName(name);
  return { key: `custom:${n}`, name: name.trim().toLowerCase(), category: 'other', allergens: [], diet: null, known: false };
};
