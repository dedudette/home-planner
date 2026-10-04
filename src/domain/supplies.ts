import type { Supply, SupplyCategory, SupplyNeed, Task } from './types';

export const SAFETY_HEADLINE = 'Never mix cleaning products.';
export const SAFETY_POINTS = [
  'Bleach + ammonia makes toxic chloramine gas. Bleach + acids (vinegar, descalers, many toilet and limescale cleaners) releases chlorine gas.',
  'Use one product at a time. Rinse the surface with plain water before using a different product.',
  'Open a window or run the fan, wear gloves, and read the label on every product.',
  'Keep products in their original bottles and out of reach of children and pets.',
];

/** What each supply category can stand in for. Only safe, single-product substitutions. */
const COVERS: Record<SupplyCategory, SupplyNeed[]> = {
  'all-purpose': ['all-purpose', 'bathroom'],
  'dish-soap': ['dish-soap', 'all-purpose', 'degreaser', 'glass', 'bathroom', 'floor'],
  glass: ['glass'],
  bathroom: ['bathroom', 'all-purpose'],
  toilet: ['toilet'],
  floor: ['floor'],
  degreaser: ['degreaser', 'all-purpose'],
  disinfectant: ['all-purpose', 'bathroom', 'toilet'],
  bleach: ['toilet'],
  descaler: ['descaler'],
  vinegar: ['descaler'],
  'baking-soda': [],
  laundry: ['laundry'],
  cloths: ['cloth', 'sponge', 'duster'],
  tools: [],
  bags: ['bags'],
  other: [],
};

export const TOOL_NEEDS: { value: SupplyNeed; label: string }[] = [
  { value: 'vacuum', label: 'Vacuum' }, { value: 'broom', label: 'Broom / dustpan' }, { value: 'mop', label: 'Mop & bucket' },
  { value: 'brush', label: 'Scrub / toilet brush' }, { value: 'duster', label: 'Duster' }, { value: 'lint-roller', label: 'Lint roller' },
  { value: 'gloves', label: 'Gloves' }, { value: 'sponge', label: 'Sponge' },
];

export const coveredNeeds = (supplies: Supply[]): Set<SupplyNeed> => {
  const out = new Set<SupplyNeed>();
  for (const s of supplies) {
    COVERS[s.category].forEach((n) => out.add(n));
    s.tools?.forEach((n) => out.add(n));
  }
  if (out.has('vacuum')) out.add('broom');
  return out;
};

export const NEED_LABEL: Record<SupplyNeed, string> = {
  'all-purpose': 'all-purpose cleaner', 'dish-soap': 'dish soap', glass: 'glass cleaner', toilet: 'toilet cleaner', bathroom: 'bathroom cleaner',
  floor: 'floor cleaner', cloth: 'cleaning cloths', sponge: 'a sponge', vacuum: 'a vacuum', broom: 'a broom', mop: 'a mop', bags: 'trash bags',
  laundry: 'laundry detergent', degreaser: 'a degreaser', descaler: 'a limescale remover', gloves: 'gloves', 'lint-roller': 'a lint roller',
  duster: 'a duster or damp cloth', brush: 'a scrub brush',
};

/** Cheap, safe workarounds for common missing items. */
export const NEED_TIP: Partial<Record<SupplyNeed, string>> = {
  'all-purpose': 'Warm water with a few drops of dish soap on a cloth works on most hard surfaces.',
  degreaser: 'Hot water with dish soap cuts most kitchen grease.',
  glass: 'Warm water, a drop of dish soap and a lint-free cloth.',
  bathroom: 'Dish soap and warm water with a sponge handles light soap scum.',
  floor: 'A little dish soap in warm water suits most sealed hard floors (check your floor type).',
  cloth: 'An old cotton T-shirt cut into squares makes a fine cleaning rag.',
  toilet: 'A dedicated toilet cleaner is worth buying. Use it by itself.',
  descaler: 'Use a product made for limescale and follow the label.',
  sponge: 'A cloth or old brush can scrub instead.',
};

export interface SupplyCheck { task: Task; missing: SupplyNeed[] }

export const checkTasks = (tasks: Task[], supplies: Supply[]): { ready: SupplyCheck[]; missing: SupplyCheck[] } => {
  const have = coveredNeeds(supplies);
  const seen = new Set<string>();
  const ready: SupplyCheck[] = [];
  const missing: SupplyCheck[] = [];
  for (const task of tasks) {
    const key = task.templateId ?? task.id;
    if (seen.has(key)) continue;
    seen.add(key);
    const miss = task.needs.filter((n) => !have.has(n));
    (miss.length ? missing : ready).push({ task, missing: miss });
  }
  return { ready, missing };
};

export interface SupplyWarning { id: string; text: string }

/** Heads-up when the user's own stash contains combinations that must never be used together. */
export const supplyWarnings = (supplies: Supply[]): SupplyWarning[] => {
  const cats = new Set(supplies.map((s) => s.category));
  const names = supplies.map((s) => `${s.product} ${s.notes}`.toLowerCase()).join(' ');
  const out: SupplyWarning[] = [];
  const hasBleach = cats.has('bleach') || /bleach/.test(names);
  const hasAmmonia = /ammonia/.test(names);
  const hasAcid = cats.has('descaler') || cats.has('vinegar') || /acid|vinegar|descal/.test(names);
  if (hasBleach && hasAmmonia) out.push({ id: 'bleach-ammonia', text: 'You have bleach and an ammonia-based product. Never use them together or one right after the other.' });
  if (hasBleach && hasAcid) out.push({ id: 'bleach-acid', text: 'You have bleach and an acidic product (vinegar or descaler). Never use them together. Use one at a time and rinse with water in between.' });
  if (cats.has('glass') && hasBleach) out.push({ id: 'glass-bleach', text: 'Some glass cleaners contain ammonia. Check the label, and never use one together with bleach.' });
  return out;
};

export const STARTER_SUPPLIES: Omit<Supply, 'id'>[] = [
  { product: 'Dish soap', category: 'dish-soap', room: 'kitchen', quantity: '1 bottle', notes: '' },
  { product: 'Microfiber cloths', category: 'cloths', room: 'any', quantity: '6', notes: '' },
  { product: 'All-purpose cleaner', category: 'all-purpose', room: 'any', quantity: '1 bottle', notes: '' },
  { product: 'Trash bags', category: 'bags', room: 'any', quantity: '1 roll', notes: '' },
  { product: 'Broom and dustpan', category: 'tools', room: 'any', quantity: '1', notes: '', tools: ['broom'] },
];
