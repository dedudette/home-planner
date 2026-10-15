import { useState } from 'react';
import { INGREDIENTS } from '../../domain/meals/ingredients';
import { ALLERGENS, COOK_EQUIPMENT, MEAL_SLOTS, type DietPref } from '../../domain/meals/types';
import { useApp } from '../../state/store';
import { I } from '../../ui/icons';
import { Button, Chip, Hint } from '../../ui/primitives';
import { SLOT_LABEL } from './actions';
import { ALLERGEN_LABEL, ServingsStepper } from './RecipeDetail';

const DIET_LABEL: Record<DietPref, string> = { any: 'No preference', vegetarian: 'Vegetarian', vegan: 'Vegan', pescatarian: 'Pescatarian' };

/** What suggestions should respect. Nothing here is a goal: there is no calorie target, weight goal, fasting window or medical diet. */
export const PrefsTab = () => {
  const { data, dispatch } = useApp();
  const p = data.meals.prefs;
  const [dislike, setDislike] = useState('');
  const [pantryName, setPantryName] = useState('');
  const set = (patch: Partial<Omit<typeof p, 'slots'>>) => dispatch({ type: 'MEALS_PREFS', patch });
  const toggle = <T,>(xs: T[], x: T) => (xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x]);
  return (
    <div className="stack">
      <section className="card stack" aria-labelledby="mp-slots">
        <h2 id="mp-slots" className="h3">Which meals to plan</h2>
        <p className="small muted">Switch on only the meals you want a place for. Times are optional and only ever ones you choose.</p>
        {MEAL_SLOTS.map((s) => (
          <div className="row between wrap switch-row" key={s} style={{ gap: 8 }}>
            <label className="row" style={{ gap: 10 }}><input type="checkbox" role="switch" checked={p.slots[s].on} onChange={(e) => dispatch({ type: 'MEALS_SLOT', slot: s, patch: { on: e.target.checked } })} style={{ width: 24, height: 24 }} aria-label={SLOT_LABEL[s]} /><b>{SLOT_LABEL[s]}</b></label>
            {p.slots[s].on && (
              <span className="row" style={{ gap: 6 }}>
                <input className="input" type="time" aria-label={`${SLOT_LABEL[s]} time`} value={p.slots[s].time ?? ''} onChange={(e) => dispatch({ type: 'MEALS_SLOT', slot: s, patch: { time: e.target.value || null } })} style={{ width: 130 }} />
                {p.slots[s].time && <Button size="sm" variant="ghost" onClick={() => dispatch({ type: 'MEALS_SLOT', slot: s, patch: { time: null } })}>Clear</Button>}
              </span>
            )}
          </div>
        ))}
      </section>

      <section className="card stack" aria-labelledby="mp-house">
        <h2 id="mp-house" className="h3">Who you cook for</h2>
        <div className="row between wrap"><span>People in your household</span><ServingsStepper value={p.household} label="Household size" onChange={(n) => set({ household: Math.max(1, Math.round(n)) })} /></div>
        <p className="small muted">New meals start with this many servings. You can change it for any meal.</p>
      </section>

      <section className="card stack" aria-labelledby="mp-diet">
        <h2 id="mp-diet" className="h3">What suits you</h2>
        <div className="field"><span className="label" id="mp-diet-l">Diet</span>
          <div className="chips" role="radiogroup" aria-labelledby="mp-diet-l">{(Object.keys(DIET_LABEL) as DietPref[]).map((d) => <Chip key={d} role="radio" on={p.diet === d} onClick={() => set({ diet: d })}>{DIET_LABEL[d]}</Chip>)}</div></div>
        <div className="field"><span className="label" id="mp-av">Leave out recipes that list</span>
          <div className="chips" role="group" aria-labelledby="mp-av">{ALLERGENS.map((a) => <Chip small key={a} role="checkbox" on={p.avoid.includes(a)} onClick={() => set({ avoid: toggle(p.avoid, a) })}>{ALLERGEN_LABEL[a]}</Chip>)}</div>
          <Hint icon={I.shield}>This works from the ingredients each recipe lists. It is not an allergy guarantee: always read the packaging, and ask a professional about an allergy or a medical diet. Recipes with ingredients the app cannot identify are left out whenever a diet or allergen filter is on.</Hint></div>
        <div className="field"><label htmlFor="mp-dl">Ingredients you dislike</label>
          <div className="row wrap" style={{ gap: 6 }}>
            <input id="mp-dl" className="input" value={dislike} maxLength={40} placeholder="e.g. mushrooms" onChange={(e) => setDislike(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && dislike.trim()) { set({ dislikes: [...new Set([...p.dislikes, dislike.trim().toLowerCase()])] }); setDislike(''); } }} style={{ flex: '1 1 180px' }} />
            <Button variant="soft" disabled={!dislike.trim()} onClick={() => { set({ dislikes: [...new Set([...p.dislikes, dislike.trim().toLowerCase()])] }); setDislike(''); }}>Add</Button>
          </div>
          {p.dislikes.length > 0 && <div className="chips" aria-label="Disliked ingredients">{p.dislikes.map((d) => <Chip small key={d} on onClick={() => set({ dislikes: p.dislikes.filter((x) => x !== d) })} aria-label={`Remove ${d}`}>{d} ✕</Chip>)}</div>}
        </div>
      </section>

      <section className="card stack" aria-labelledby="mp-how">
        <h2 id="mp-how" className="h3">How you like to cook</h2>
        <div className="field"><span className="label" id="mp-eq">Kit you have</span>
          <div className="chips" role="group" aria-labelledby="mp-eq">{COOK_EQUIPMENT.map((e) => <Chip small key={e} role="checkbox" on={p.equipment.includes(e)} onClick={() => set({ equipment: toggle(p.equipment, e) })}>{e.replace('-', ' ')}</Chip>)}</div>
          <span className="small muted">Leave empty to see everything. Choose some and recipes that need other kit are hidden.</span></div>
        <div className="field"><span className="label" id="mp-t">Most time for one meal</span>
          <div className="chips" role="radiogroup" aria-labelledby="mp-t">{[null, 15, 30, 45, 60].map((m) => <Chip key={String(m)} role="radio" on={p.maxPrepMinutes === m} onClick={() => set({ maxPrepMinutes: m })}>{m === null ? 'No limit' : `${m} min`}</Chip>)}</div></div>
        <label className="row between switch-row"><span><b>Keep it simple</b><br /><span className="small muted">Few ingredients and few steps</span></span><input type="checkbox" role="switch" aria-label="Keep it simple" checked={p.simple} onChange={(e) => set({ simple: e.target.checked })} style={{ width: 24, height: 24 }} /></label>
        <label className="row between switch-row"><span><b>Everyday ingredients</b><br /><span className="small muted">Recipes built from common low-cost staples. The app holds no prices.</span></span><input type="checkbox" role="switch" aria-label="Everyday ingredients" checked={p.budgetFriendly} onChange={(e) => set({ budgetFriendly: e.target.checked })} style={{ width: 24, height: 24 }} /></label>
      </section>

      <section className="card stack" aria-labelledby="mp-pantry">
        <h2 id="mp-pantry" className="h3">Always at home</h2>
        <p className="small muted">Things you always have (salt, oil…). They start as "at home" on every new shopping list.</p>
        {data.shopping.pantry.length > 0 && <div className="chips" aria-label="Always at home">{data.shopping.pantry.map((k) => <Chip small key={k} on onClick={() => dispatch({ type: 'PANTRY', key: k, on: false })} aria-label={`Remove ${k.replace('custom:', '')}`}>{INGREDIENTS.find((i) => i.id === k)?.name ?? k.replace('custom:', '')} ✕</Chip>)}</div>}
        <div className="row wrap" style={{ gap: 6 }}>
          <input className="input" aria-label="Add something you always have" list="pantry-options" placeholder="e.g. olive oil" value={pantryName} onChange={(e) => setPantryName(e.target.value)} style={{ flex: '1 1 180px' }} />
          <datalist id="pantry-options">{INGREDIENTS.map((i) => <option key={i.id} value={i.name} />)}</datalist>
          <Button variant="soft" disabled={!pantryName.trim()} onClick={async () => { const { identify } = await import('../../domain/meals/ingredients'); dispatch({ type: 'PANTRY', key: identify(pantryName).key, on: true }); setPantryName(''); }}>Add</Button>
        </div>
      </section>
      <p className="xs muted">Nothing here sets a calorie target, a weight goal, a fasting window or a medical diet, and the app will not suggest one.</p>
    </div>
  );
};
