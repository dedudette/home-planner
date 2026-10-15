import { useMemo, useState } from 'react';
import { allRecipes, suggestRecipes } from '../../domain/meals/planner';
import { MEAL_SLOTS } from '../../domain/meals/types';
import { useApp } from '../../state/store';
import { I } from '../../ui/icons';
import { Button, Chip, Empty } from '../../ui/primitives';
import { SLOT_LABEL } from './actions';
import { RecipeRow } from './MealPicker';

const TAGS = ['quick', 'inexpensive', 'batch-friendly', 'no-cook', 'one-pan'];

/** Browse the starter recipes and the person's own dishes. Filters use what the person said in Preferences, and say what they hid. */
export const RecipesTab = () => {
  const { data, openSheet } = useApp();
  const [query, setQuery] = useState('');
  const [slot, setSlot] = useState<(typeof MEAL_SLOTS)[number] | ''>('');
  const [tag, setTag] = useState('');
  const [mine, setMine] = useState(false);
  const [favs, setFavs] = useState(false);
  const [everything, setEverything] = useState(false);
  const all = useMemo(() => allRecipes(data), [data.meals.dishes]); // eslint-disable-line react-hooks/exhaustive-deps
  const f = { slot: slot || undefined, tag: tag || undefined, query: query || undefined, source: mine ? ('personal' as const) : undefined };
  const matching = useMemo(() => all.filter((r) => (!f.slot || r.slots.includes(f.slot)) && (!f.tag || r.tags.includes(f.tag)) && (!f.source || r.source === f.source) && (!f.query || r.name.toLowerCase().includes(f.query.toLowerCase()) || r.ingredients.some((i) => i.name.toLowerCase().includes((f.query as string).toLowerCase())))), [all, f.slot, f.tag, f.source, f.query]);
  const fits = useMemo(() => new Set(suggestRecipes(all, data.meals.prefs, f).map((s) => s.recipe.id)), [all, data.meals.prefs, f.slot, f.tag, f.source, f.query]); // eslint-disable-line react-hooks/exhaustive-deps
  const list = (everything ? matching : matching.filter((r) => fits.has(r.id))).filter((r) => !favs || data.meals.favourites.includes(r.id)).sort((a, b) => a.name.localeCompare(b.name));
  const hidden = matching.length - fits.size;
  return (
    <div className="stack">
      <div className="row between wrap" style={{ gap: 8 }}>
        <input className="input" type="search" aria-label="Search recipes" placeholder="Search by name or ingredient" value={query} onChange={(e) => setQuery(e.target.value)} style={{ flex: '1 1 220px' }} />
        <Button size="sm" icon={I.plus} onClick={() => openSheet({ kind: 'dishForm' })}>Write down a dish</Button>
      </div>
      <div className="chips" role="group" aria-label="Filter recipes">
        {MEAL_SLOTS.map((s) => <Chip small key={s} role="checkbox" on={slot === s} onClick={() => setSlot(slot === s ? '' : s)}>{SLOT_LABEL[s]}</Chip>)}
        {TAGS.map((t) => <Chip small key={t} role="checkbox" on={tag === t} onClick={() => setTag(tag === t ? '' : t)}>{t.replace(/-/g, ' ')}</Chip>)}
        <Chip small role="checkbox" on={favs} onClick={() => setFavs(!favs)}>Favourites</Chip>
        <Chip small role="checkbox" on={mine} onClick={() => setMine(!mine)}>My dishes</Chip>
      </div>
      {hidden > 0 && !everything && <p className="small muted">{hidden} recipe{hidden === 1 ? ' is' : 's are'} hidden because of what you told us in Preferences (diet, allergens, dislikes, equipment, time). <button className="btn ghost sm" onClick={() => setEverything(true)}>Show them</button></p>}
      {everything && <p className="small muted">Showing everything, including recipes your preferences would hide. <button className="btn ghost sm" onClick={() => setEverything(false)}>Use my preferences</button></p>}
      {list.length === 0 ? <Empty title="No recipes match">Try fewer filters{everything ? '' : ', or show the ones your preferences hide'}.</Empty>
        : <div className="stack" aria-label="Recipes">{list.map((r) => <RecipeRow key={r.id} r={r} fav={data.meals.favourites.includes(r.id)} onOpen={() => openSheet({ kind: 'recipe', id: r.id })} />)}</div>}
      <p className="xs muted">Starter recipes are written for this app and use everyday ingredients. They show no nutrition figures or prices, because the app has no verified source for either.</p>
    </div>
  );
};
