import { useMemo, useState } from 'react';
import { useDraftState } from '../../state/DraftScope';
import { allRecipes, leftoverServings, mealMinutes, suggestRecipes } from '../../domain/meals/planner';
import type { MealSlot, Recipe } from '../../domain/meals/types';
import type { ISODate } from '../../domain/types';
import { addDays, formatDay } from '../../domain/dates';
import { useApp } from '../../state/store';
import { I } from '../../ui/icons';
import { Button, Chip, Empty, Segmented, Sheet } from '../../ui/primitives';
import { SLOT_LABEL, useMealActions } from './actions';
import { ServingsStepper } from './RecipeDetail';

type Tab = 'recipes' | 'dishes' | 'log' | 'leftovers';

export const RecipeRow = ({ r, onPick, onOpen, fav }: { r: Recipe; onPick?: () => void; onOpen?: () => void; fav?: boolean }) => (
  <div className="card row between" style={{ gap: 12, padding: 12 }}>
    <button className="grow plain-btn" style={{ minHeight: 44 }} onClick={onOpen ?? onPick} aria-label={`${r.name}, ${mealMinutes(r)} minute${mealMinutes(r) === 1 ? '' : 's'}`}>
      <b>{r.name}</b>{fav ? <I.heart size={14} aria-hidden style={{ marginLeft: 6, color: 'var(--primary)' }} /> : null}
      <br /><span className="small muted">{mealMinutes(r)} min · serves {r.servings}{r.source === 'personal' ? ' · your dish' : ''}</span>
    </button>
    {onPick && onOpen && <Button size="sm" onClick={onPick}>Choose</Button>}
  </div>
);

/**
 * Add a meal to a day. Four ways: a recipe, one of the person's own dishes, just log what was eaten (no recipe needed), or eat from an
 * earlier batch. Suggestions respect what the person said about diet, allergens, dislikes, equipment and time, and say so.
 */
export const MealPickerSheet = ({ date, slot: slot0, tab: tab0 }: { date: ISODate; slot: MealSlot; tab?: 'recipes' | 'log' }) => {
  const { data, today, closeSheet, openSheet } = useApp();
  const { add } = useMealActions();
  const [tab, setTab] = useDraftState<Tab>('tab', tab0 ?? 'recipes');
  const [slot, setSlot] = useDraftState('slot', slot0);
  const [query, setQuery] = useState('');
  const [everything, setEverything] = useDraftState('everything', false);
  const [servings, setServings] = useDraftState('servings', data.meals.prefs.household);
  const [text, setText] = useDraftState('text', '', 'text');
  const prefs = data.meals.prefs;
  const all = useMemo(() => allRecipes(data), [data.meals.dishes]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = useMemo(() => {
    const list = everything
      ? all.filter((r) => r.slots.includes(slot) && (!query || r.name.toLowerCase().includes(query.toLowerCase())))
      : suggestRecipes(all, prefs, { slot, query }).map((s) => s.recipe);
    const rank = (r: Recipe) => (data.meals.favourites.includes(r.id) ? 0 : data.meals.recents.includes(r.id) ? 1 : 2);
    return list.filter((r) => tab !== 'dishes' || r.source === 'personal').sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  }, [all, everything, query, slot, prefs, tab, data.meals.favourites, data.meals.recents]);
  const hidden = useMemo(() => all.filter((r) => r.slots.includes(slot)).length - suggestRecipes(all, prefs, { slot }).length, [all, prefs, slot]);
  const batches = data.meals.plan.filter((e) => (e.ref.kind === 'recipe' || e.ref.kind === 'dish') && e.date <= date && e.date >= addDays(date, -14) && leftoverServings(data, e) > 0).slice(-8);
  const filtersOn = prefs.diet !== 'any' || prefs.avoid.length > 0 || prefs.dislikes.length > 0 || prefs.equipment.length > 0 || prefs.maxPrepMinutes !== null || prefs.simple || prefs.budgetFriendly;

  const pick = (r: Recipe) => { add({ date, slot, ref: { kind: r.source === 'personal' ? 'dish' : 'recipe', id: r.id }, name: r.name, servings }); closeSheet(); };
  return (
    <Sheet title={`${SLOT_LABEL[slot]} · ${formatDay(date, today)}`} onClose={closeSheet} label="Add a meal">
      <div className="chips" role="radiogroup" aria-label="Meal">{(['breakfast', 'lunch', 'dinner', 'snack'] as const).map((s) => <Chip small key={s} role="radio" on={slot === s} onClick={() => setSlot(s)}>{SLOT_LABEL[s]}</Chip>)}</div>
      <Segmented<Tab> label="Where from" value={tab} onChange={setTab} options={[{ value: 'recipes', label: 'Recipes' }, { value: 'dishes', label: 'My dishes' }, { value: 'log', label: 'Just log it' }, { value: 'leftovers', label: 'Leftovers' }]} />

      {(tab === 'recipes' || tab === 'dishes') && (
        <>
          <div className="row between wrap" style={{ gap: 8 }}><span className="small strong">Servings to plan</span><ServingsStepper value={servings} onChange={setServings} /></div>
          <input className="input" type="search" aria-label="Search recipes" placeholder="Search by name or ingredient" value={query} onChange={(e) => setQuery(e.target.value)} />
          {tab === 'recipes' && filtersOn && !everything && <p className="small muted">Showing what fits what you told us{hidden > 0 ? `; ${hidden} left out` : ''}. <button className="btn ghost sm" onClick={() => setEverything(true)}>Show everything</button></p>}
          {everything && <p className="small muted">Showing everything for this meal. <button className="btn ghost sm" onClick={() => setEverything(false)}>Use my preferences</button></p>}
          {shown.length === 0
            ? <Empty title={tab === 'dishes' ? 'No dishes of your own yet' : 'Nothing matches'}>{tab === 'dishes' ? 'Write down a dish you cook and it will be here, ready to plan and shop for.' : 'Try another meal, a different search, or show everything.'}</Empty>
            : <div className="stack">{shown.map((r) => <RecipeRow key={r.id} r={r} fav={data.meals.favourites.includes(r.id)} onPick={() => pick(r)} onOpen={() => openSheet({ kind: 'recipe', id: r.id })} />)}</div>}
          {tab === 'dishes' && <Button variant="soft" icon={I.plus} onClick={() => openSheet({ kind: 'dishForm' })}>Write down a dish</Button>}
        </>
      )}

      {tab === 'log' && (
        <div className="stack">
          <p className="small muted">No recipe needed. {date <= today ? 'This is recorded as eaten.' : 'This is planned for that day.'}</p>
          <div className="field"><label htmlFor="mp-text">What was it?</label><input id="mp-text" className="input" data-autofocus value={text} maxLength={120} placeholder="e.g. Soup and a roll" onChange={(e) => setText(e.target.value)} /></div>
          <Button icon={I.check} disabled={!text.trim()} onClick={() => { add({ date, slot, ref: { kind: 'free', text: text.trim() }, name: text.trim(), servings: 1, status: date <= today ? 'eaten' : 'planned' }); closeSheet(); }}>{date <= today ? 'Log it' : 'Plan it'}</Button>
        </div>
      )}

      {tab === 'leftovers' && (
        batches.length === 0
          ? <Empty title="No leftovers to eat">Plan a meal with more servings than you will eat at once, and the rest shows up here.</Empty>
          : <div className="stack">{batches.map((b) => (
            <div className="card row between" key={b.id} style={{ gap: 12, padding: 12 }}>
              <span><b>{b.name}</b><br /><span className="small muted">{formatDay(b.date, today)} · {leftoverServings(data, b)} serving{leftoverServings(data, b) === 1 ? '' : 's'} left</span></span>
              <Button size="sm" onClick={() => { add({ date, slot, ref: { kind: 'leftover', of: b.id }, name: `${b.name} (leftovers)`, servings: Math.min(servings, leftoverServings(data, b)) || 1 }); closeSheet(); }}>Eat this</Button>
            </div>))}
          </div>
      )}
    </Sheet>
  );
};
