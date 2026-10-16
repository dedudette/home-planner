import { useState } from 'react';
import { formatDay } from '../../domain/dates';
import { leftoverServings, mealState, recipeOf } from '../../domain/meals/planner';
import { MEAL_SLOTS } from '../../domain/meals/types';
import { useApp } from '../../state/store';
import { I } from '../../ui/icons';
import { Button, Chip, Sheet, Tag } from '../../ui/primitives';
import { SLOT_LABEL, STATUS_LABEL, useMealActions } from './actions';
import { ServingsStepper } from './RecipeDetail';

/** Everything about one planned meal: what it is, when, how many, what became of it, and a cooking session for it. */
export const MealEditSheet = ({ id }: { id: string }) => {
  const { data, today, closeSheet, openSheet, dispatch } = useApp();
  const e = data.meals.plan.find((x) => x.id === id);
  const { setStatus, remove } = useMealActions();
  const [kcal, setKcal] = useState(e?.kcal ? String(e.kcal) : '');
  const [note, setNote] = useState(e?.note ?? '');
  if (!e) return <Sheet title="Meal" onClose={closeSheet}><p>This meal is no longer in your plan.</p></Sheet>;
  const r = recipeOf(data, e.ref);
  const state = mealState(data, e, today);
  const prep = e.prepActivityId ? data.activities.find((a) => a.id === e.prepActivityId) : undefined;
  const save = (patch: Partial<typeof e>) => dispatch({ type: 'MEAL_SAVE', entry: { ...e, ...patch } });
  const batch = e.ref.kind === 'leftover' ? data.meals.plan.find((x) => x.id === (e.ref as { of: string }).of) : null;
  return (
    <Sheet title={e.name} onClose={closeSheet} label={`Meal: ${e.name}`}
      footer={<><Button variant="ghost" icon={I.trash} onClick={() => { remove(e); closeSheet(); }}>Remove</Button><Button onClick={() => { save({ kcal: Number(kcal) > 0 ? Math.round(Number(kcal)) : null, note: note.trim().slice(0, 200) }); closeSheet(); }}>Done</Button></>}>
      <div className="row wrap" style={{ gap: 6 }}>
        <Tag>{formatDay(e.date, today)}</Tag><Tag>{SLOT_LABEL[e.slot]}</Tag>
        <Tag kind={state === 'eaten' || state === 'prepared' ? 'green' : state === 'unrecorded' ? 'lav' : undefined}>{STATUS_LABEL[state]}</Tag>
      </div>
      {state === 'unrecorded' && <p className="small muted">The day has passed and nothing was recorded. That is fine: it is not counted as skipped.</p>}

      <div className="stack">
        <span className="label" id="me-status">What happened?</span>
        <div className="chips" role="radiogroup" aria-labelledby="me-status">
          {(['planned', 'prepared', 'eaten', 'skipped'] as const).map((s) => <Chip key={s} role="radio" on={e.status === s} onClick={() => e.status !== s && setStatus(e, s)}>{s === 'planned' ? 'Not yet' : STATUS_LABEL[s]}</Chip>)}
        </div>
        {prep && <p className="small muted">Linked cooking session: <b>{prep.name}</b>. Completing it marks this meal as prepared.</p>}
      </div>

      <div className="row between wrap"><span className="strong">Servings</span><ServingsStepper value={e.servings} onChange={(n) => save({ servings: n })} /></div>
      {e.ref.kind !== 'free' && e.ref.kind !== 'leftover' && r && <p className="small muted">{r.name} serves {r.servings}. Planning more than you eat at once gives you leftovers to plan for another day.</p>}
      {batch && <p className="small muted">Eaten from the batch of {batch.name} ({formatDay(batch.date, today)}). Adds nothing to shopping.</p>}
      {(e.ref.kind === 'recipe' || e.ref.kind === 'dish') && leftoverServings(data, e) > 0 && e.servings > data.meals.prefs.household && (
        <Button variant="soft" size="sm" onClick={() => { closeSheet(); openSheet({ kind: 'mealPicker', date: e.date, slot: 'lunch' }); }}>Plan the leftovers ({leftoverServings(data, e)} servings)</Button>
      )}

      <div className="row wrap" style={{ gap: 8 }}>
        <div className="field"><label htmlFor="me-date">Day</label><input id="me-date" className="input" type="date" value={e.date} onChange={(ev) => ev.target.value && save({ date: ev.target.value })} style={{ maxWidth: 180 }} /></div>
        <div className="field"><span className="label" id="me-slot">Meal</span><div className="chips" role="radiogroup" aria-labelledby="me-slot">{MEAL_SLOTS.map((s) => <Chip small key={s} role="radio" on={e.slot === s} onClick={() => save({ slot: s })}>{SLOT_LABEL[s]}</Chip>)}</div></div>
      </div>

      {r && (e.ref.kind === 'recipe' || e.ref.kind === 'dish') && (
        <div className="row wrap" style={{ gap: 8 }}>
          <Button variant="secondary" size="sm" icon={I.list} onClick={() => openSheet({ kind: 'recipe', id: r.id })}>See the recipe</Button>
          {!prep && <Button variant="soft" size="sm" icon={I.timer} onClick={() => { closeSheet(); openSheet({ kind: 'activityForm', defaults: { module: 'meals', name: `Cook: ${r.name}`, minutes: Math.max(5, r.prepMinutes + r.cookMinutes), ref: { kind: 'recipe', id: r.id }, schedule: { kind: 'once', date: e.date }, linkMealId: e.id } }); }}>Plan a cooking session</Button>}
        </div>
      )}

      <div className="field"><label htmlFor="me-kcal">Calories (optional)</label><input id="me-kcal" className="input" type="number" min={0} max={10000} value={kcal} onChange={(ev) => setKcal(ev.target.value)} style={{ width: 140 }} /><span className="small muted">Your own number. Never filled in for you.</span></div>
      <div className="field"><label htmlFor="me-note">Note (optional)</label><textarea id="me-note" className="textarea" value={note} maxLength={200} onChange={(ev) => setNote(ev.target.value)} /></div>
    </Sheet>
  );
};
