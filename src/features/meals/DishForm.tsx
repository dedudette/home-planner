import { useState } from 'react';
import { uid } from '../../domain/appdata';
import { lookupIngredient } from '../../domain/meals/ingredients';
import { COOK_EQUIPMENT, MEAL_SLOTS, UNITS, type CookEquip, type Ingredient, type MealSlot, type Recipe, type Unit } from '../../domain/meals/types';
import { useApp } from '../../state/store';
import { I } from '../../ui/icons';
import { Button, Chip, Hint, Sheet } from '../../ui/primitives';
import { SLOT_LABEL } from './actions';

interface Row { name: string; qty: string; unit: Unit | ''; optional: boolean }
const blank = (): Row => ({ name: '', qty: '', unit: '', optional: false });

/** A dish the person cooks, with real ingredients and amounts, so it can be planned and shopped for like any recipe. */
export const DishFormSheet = ({ editId }: { editId?: string }) => {
  const { data, closeSheet, dispatch, toast } = useApp();
  const existing = data.meals.dishes.find((d) => d.id === editId);
  const [name, setName] = useState(existing?.name ?? '');
  const [servings, setServings] = useState(String(existing?.servings ?? 2));
  const [prep, setPrep] = useState(String(existing?.prepMinutes ?? 10));
  const [cook, setCook] = useState(String(existing?.cookMinutes ?? 20));
  const [slots, setSlots] = useState<MealSlot[]>(existing?.slots ?? ['lunch', 'dinner']);
  const [equipment, setEquipment] = useState<CookEquip[]>(existing?.equipment ?? []);
  const [rows, setRows] = useState<Row[]>(existing?.ingredients.length ? existing.ingredients.map((i) => ({ name: i.name, qty: i.qty === null ? '' : String(i.qty), unit: i.unit ?? '', optional: !!i.optional })) : [blank(), blank(), blank()]);
  const [steps, setSteps] = useState(existing?.steps.join('\n') ?? '');
  const [kcal, setKcal] = useState(existing?.kcalPerServing ? String(existing.kcalPerServing) : '');
  const [touched, setTouched] = useState(false);

  const filled = rows.filter((r) => r.name.trim());
  const errors = { name: name.trim() ? '' : 'Give the dish a name.', ingredients: filled.length ? '' : 'Add at least one ingredient.', servings: Number(servings) >= 1 && Number(servings) <= 50 ? '' : 'Servings is 1 to 50.' };
  const valid = !errors.name && !errors.ingredients && !errors.servings;
  const update = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const save = () => {
    setTouched(true);
    if (!valid) return;
    const ingredients: Ingredient[] = filled.map((r) => {
      const q = r.qty.trim() === '' ? null : Number(r.qty.replace(',', '.'));
      const qty = q !== null && Number.isFinite(q) && q > 0 ? q : null;
      const ing: Ingredient = { name: r.name.trim(), qty, unit: qty === null ? null : (r.unit || 'piece') };
      if (r.optional) ing.optional = true;
      return ing;
    });
    const dish: Recipe = {
      id: existing?.id ?? uid('dish'), name: name.trim(), source: 'personal', servings: Math.round(Number(servings)), prepMinutes: Math.max(0, Math.round(Number(prep) || 0)), cookMinutes: Math.max(0, Math.round(Number(cook) || 0)),
      slots: slots.length ? slots : ['lunch', 'dinner'], tags: existing?.tags ?? [], equipment, ingredients, steps: steps.split('\n').map((s) => s.trim()).filter(Boolean),
      ...(Number(kcal) > 0 ? { kcalPerServing: Math.round(Number(kcal)) } : {}),
    };
    dispatch({ type: 'DISH_SAVE', dish });
    toast(existing ? 'Dish updated.' : 'Dish saved. You can plan it and shop for it now.');
    closeSheet();
  };

  return (
    <Sheet title={existing ? 'Edit dish' : 'Write down a dish'} onClose={closeSheet} full
      footer={<><Button variant="secondary" onClick={closeSheet}>Cancel</Button><Button icon={I.check} onClick={save}>{existing ? 'Save' : 'Save dish'}</Button></>}>
      <div className="field"><label htmlFor="d-name">Name</label><input id="d-name" className="input" data-autofocus value={name} maxLength={80} placeholder="e.g. Mum's vegetable soup" onChange={(e) => setName(e.target.value)} aria-invalid={touched && !!errors.name} />{touched && errors.name && <span className="small" role="alert" style={{ color: 'var(--clay-ink)' }}>{errors.name}</span>}</div>
      <div className="row wrap" style={{ gap: 12 }}>
        <div className="field"><label htmlFor="d-serv">Serves</label><input id="d-serv" className="input" type="number" min={1} max={50} value={servings} onChange={(e) => setServings(e.target.value)} style={{ width: 90 }} /></div>
        <div className="field"><label htmlFor="d-prep">Prep (min)</label><input id="d-prep" className="input" type="number" min={0} value={prep} onChange={(e) => setPrep(e.target.value)} style={{ width: 100 }} /></div>
        <div className="field"><label htmlFor="d-cook">Cook (min)</label><input id="d-cook" className="input" type="number" min={0} value={cook} onChange={(e) => setCook(e.target.value)} style={{ width: 100 }} /></div>
      </div>
      <div className="field"><span className="label" id="d-slots">Good for</span><div className="chips" role="group" aria-labelledby="d-slots">{MEAL_SLOTS.map((s) => <Chip small key={s} role="checkbox" on={slots.includes(s)} onClick={() => setSlots((x) => (x.includes(s) ? x.filter((y) => y !== s) : [...x, s]))}>{SLOT_LABEL[s]}</Chip>)}</div></div>

      <section className="stack" aria-labelledby="d-ing">
        <h3 id="d-ing">Ingredients</h3>
        <p className="small muted">For the whole dish, as written above. Amounts are optional; the shopping list scales them to the servings you plan.</p>
        {rows.map((r, i) => {
          const hit = r.name.trim() ? lookupIngredient(r.name) : null;
          return (
            <div className="stack" key={i} style={{ gap: 4 }}>
              <div className="row wrap" style={{ gap: 6 }}>
                <input className="input" aria-label={`Ingredient ${i + 1} name`} placeholder="Ingredient" value={r.name} maxLength={80} onChange={(e) => update(i, { name: e.target.value })} style={{ flex: '2 1 150px' }} />
                <input className="input" aria-label={`Ingredient ${i + 1} amount`} placeholder="Amount" inputMode="decimal" value={r.qty} onChange={(e) => update(i, { qty: e.target.value })} style={{ flex: '1 1 70px', minWidth: 70 }} />
                <select className="select" aria-label={`Ingredient ${i + 1} unit`} value={r.unit} onChange={(e) => update(i, { unit: e.target.value as Unit | '' })} style={{ flex: '1 1 90px', minWidth: 90 }}>
                  <option value="">unit</option>{UNITS.map((u) => <option key={u} value={u}>{u === 'piece' ? 'whole / piece' : u}</option>)}
                </select>
                <label className="row small" style={{ gap: 4 }}><input type="checkbox" checked={r.optional} onChange={(e) => update(i, { optional: e.target.checked })} style={{ width: 20, height: 20 }} /> Optional</label>
                <Button size="sm" variant="ghost" icon={I.trash} aria-label={`Remove ingredient ${i + 1}`} onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((_, j) => j !== i) : [blank()]))} />
              </div>
              {r.name.trim() && !hit && <span className="xs muted">Not in the app's ingredient list: it will be on your shopping list, but it cannot be checked for diet or allergens.</span>}
            </div>
          );
        })}
        {touched && errors.ingredients && <span className="small" role="alert" style={{ color: 'var(--clay-ink)' }}>{errors.ingredients}</span>}
        <div><Button variant="soft" size="sm" icon={I.plus} onClick={() => setRows((rs) => [...rs, blank()])}>Add an ingredient</Button></div>
      </section>

      <div className="field"><label htmlFor="d-steps">Method (one step per line)</label><textarea id="d-steps" className="textarea" rows={5} value={steps} onChange={(e) => setSteps(e.target.value)} /></div>
      <div className="field"><span className="label" id="d-eq">Needs (optional)</span><div className="chips" role="group" aria-labelledby="d-eq">{COOK_EQUIPMENT.map((e) => <Chip small key={e} role="checkbox" on={equipment.includes(e)} onClick={() => setEquipment((x) => (x.includes(e) ? x.filter((y) => y !== e) : [...x, e]))}>{e.replace('-', ' ')}</Chip>)}</div></div>
      <div className="field">
        <label htmlFor="d-kcal">Calories per serving (optional)</label>
        <input id="d-kcal" className="input" type="number" min={0} max={5000} inputMode="numeric" value={kcal} onChange={(e) => setKcal(e.target.value)} style={{ width: 140 }} />
        <span className="small muted">Only if you want to note it. It is your own number: the app does not look it up or check it.</span>
      </div>
      {existing && <Button variant="ghost" size="sm" icon={I.trash} onClick={() => { const dish = existing; dispatch({ type: 'DISH_DELETE', id: dish.id }); closeSheet(); toast('Dish deleted. Meals you planned with it keep their name.', { label: 'Undo', run: () => dispatch({ type: 'DISH_SAVE', dish }) }); }}>Delete this dish</Button>}
      <Hint>Meals you already planned with this dish keep working if you edit it. Shopping lists are updated only when you ask.</Hint>
    </Sheet>
  );
};
