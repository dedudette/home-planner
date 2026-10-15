import { useState } from 'react';
import { checkRecipe, mealMinutes, recipeById } from '../../domain/meals/planner';
import { formatAmount, scaleAmount } from '../../domain/meals/units';
import { ALLERGENS, MEAL_SLOTS, type Recipe } from '../../domain/meals/types';
import { pluralName } from '../../domain/meals/shopping';
import { useApp } from '../../state/store';
import { I } from '../../ui/icons';
import { Button, Chip, Hint, Sheet, Tag } from '../../ui/primitives';
import { SLOT_LABEL, useMealActions } from './actions';

export const ALLERGEN_LABEL: Record<(typeof ALLERGENS)[number], string> = {
  gluten: 'Gluten', milk: 'Milk', egg: 'Egg', peanut: 'Peanut', 'tree-nut': 'Tree nuts', soy: 'Soy', fish: 'Fish', shellfish: 'Shellfish', sesame: 'Sesame', mustard: 'Mustard', celery: 'Celery', sulphites: 'Sulphites',
};

export const ServingsStepper = ({ value, onChange, label = 'Servings' }: { value: number; onChange: (n: number) => void; label?: string }) => (
  <div className="row" style={{ gap: 8 }} role="group" aria-label={label}>
    <Button size="sm" variant="secondary" icon={I.minus} aria-label={`Fewer ${label.toLowerCase()}`} disabled={value <= 0.5} onClick={() => onChange(value > 1 ? value - 1 : 0.5)} />
    <span className="strong" style={{ minWidth: 28, textAlign: 'center' }} aria-live="polite">{value}</span>
    <Button size="sm" variant="secondary" icon={I.plus} aria-label={`More ${label.toLowerCase()}`} disabled={value >= 50} onClick={() => onChange(Math.min(50, value < 1 ? 1 : Math.floor(value) + 1))} />
  </div>
);

/**
 * One recipe: its method, its ingredients scaled to the servings chosen, and what it is made of, said as plainly as the app can know it.
 */
export const RecipeDetailSheet = ({ id }: { id: string }) => {
  const { data, closeSheet, openSheet, dispatch, today } = useApp();
  const r = recipeById(data, id);
  const [servings, setServings] = useState(r?.servings ?? 2);
  const actions = useMealActions();
  const [date, setDate] = useState(today);
  const [slot, setSlot] = useState(r?.slots[0] ?? 'dinner');
  if (!r) return <Sheet title="Recipe" onClose={closeSheet}><p>This recipe is no longer here.</p></Sheet>;
  const check = checkRecipe(r);
  const fav = data.meals.favourites.includes(r.id);
  const factor = servings / r.servings;
  const mine = r.source === 'personal';
  return (
    <Sheet title={r.name} onClose={closeSheet} label={`Recipe: ${r.name}`}
      footer={<><Button variant="secondary" onClick={closeSheet}>Close</Button><Button icon={I.cal} onClick={() => { actions.add({ date, slot, ref: { kind: mine ? 'dish' : 'recipe', id: r.id }, name: r.name, servings }); closeSheet(); }}>Add to my plan</Button></>}>
      <div className="row wrap" style={{ gap: 6 }}>
        <Tag><I.clock size={12} aria-hidden /> {mealMinutes(r)} min ({r.prepMinutes} prep{r.cookMinutes ? `, ${r.cookMinutes} cook` : ''})</Tag>
        {r.tags.slice(0, 6).map((t) => <Tag key={t} kind={t === 'vegan' || t === 'vegetarian' ? 'green' : undefined}>{t.replace(/-/g, ' ')}</Tag>)}
        {mine && <Tag kind="lav">Your dish</Tag>}
      </div>

      <div className="card soft stack">
        <div className="row between wrap"><span className="strong">Cooking for</span><ServingsStepper value={servings} onChange={setServings} /></div>
        <p className="small muted">The recipe serves {r.servings}. Amounts below are scaled to {servings}.</p>
      </div>

      <section className="stack" aria-labelledby="rd-ing">
        <h3 id="rd-ing">Ingredients</h3>
        <ul className="stack" style={{ margin: 0, paddingLeft: 18, gap: 4 }}>
          {r.ingredients.map((ing, i) => {
            const a = ing.unit === 'pinch' ? { qty: null, unit: null } : scaleAmount({ qty: ing.qty, unit: ing.unit }, factor);
            const amt = a.unit === 'piece' ? formatAmount(a.qty, a.unit) : formatAmount(a.qty, a.unit);
            return <li key={i} className="small">{amt ? `${amt} ` : ''}{pluralName(ing.name, a.qty, a.unit)}{ing.optional ? ' (optional)' : ''}{ing.note ? <span className="muted"> · {ing.note}</span> : null}</li>;
          })}
        </ul>
      </section>

      <section className="stack" aria-labelledby="rd-steps">
        <h3 id="rd-steps">Method</h3>
        <ol className="stack" style={{ margin: 0, paddingLeft: 20, gap: 8 }}>{r.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
      </section>

      <Hint icon={I.shield}>
        <b>What is in it, from the listed ingredients:</b>{' '}
        {check.allergens.length ? `contains ${check.allergens.map((a) => ALLERGEN_LABEL[a].toLowerCase()).join(', ')}` : 'none of the common allergens the app tracks'}.
        {check.unchecked.length ? ` Not checked, because the app does not know them: ${check.unchecked.join(', ')}.` : ''} This is a filter, not a guarantee. Always read the packaging, and ask a professional about an allergy.
      </Hint>

      <div className="stack">
        <h3>Plan it</h3>
        <div className="row wrap" style={{ gap: 8 }}>
          <input className="input" type="date" aria-label="Date" value={date} onChange={(e) => setDate(e.target.value)} style={{ maxWidth: 190 }} />
          <div className="chips" role="radiogroup" aria-label="Meal">{MEAL_SLOTS.map((s) => <Chip small key={s} role="radio" on={slot === s} onClick={() => setSlot(s)}>{SLOT_LABEL[s]}</Chip>)}</div>
        </div>
        <div className="row wrap" style={{ gap: 8 }}>
          <Button variant="soft" size="sm" icon={I.timer} onClick={() => openSheet({ kind: 'activityForm', defaults: { module: 'meals', name: `Cook: ${r.name}`, minutes: Math.max(5, mealMinutes(r)), ref: { kind: 'recipe', id: r.id }, schedule: { kind: 'once', date } } })}>Plan a cooking session</Button>
          <Button variant="soft" size="sm" icon={I.heart} aria-pressed={fav} onClick={() => dispatch({ type: 'FAVOURITE', id: r.id, on: !fav })}>{fav ? 'Favourite' : 'Make a favourite'}</Button>
          {mine && <Button variant="ghost" size="sm" icon={I.pencil} onClick={() => openSheet({ kind: 'dishForm', editId: r.id })}>Edit</Button>}
        </div>
      </div>
    </Sheet>
  );
};

export type { Recipe };
