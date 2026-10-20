import { entriesFor } from '../../domain/meals/planner';
import { allRecipes } from '../../domain/meals/planner';
import { useApp } from '../../state/store';
import { I } from '../../ui/icons';
import { Button } from '../../ui/primitives';
import { SLOT_LABEL, SLOT_ORDER, useMealActions } from './actions';
import { MealRow } from './PlanTab';

/**
 * Today's meals: planned, prepared, eaten, skipped and not recorded stay different things. Logging is one tap, a recent dish, or a few
 * words, and none of it is required: a day with nothing logged says "nothing logged", never "missed".
 */
export const TodayMeals = () => {
  const { data, today, openSheet } = useApp();
  const { add } = useMealActions();
  const slots = SLOT_ORDER.filter((s) => data.meals.prefs.slots[s].on);
  const entries = entriesFor(data, today);
  const recents = data.meals.recents.map((id) => allRecipes(data).find((r) => r.id === id)).filter((r): r is NonNullable<typeof r> => !!r).slice(0, 3);
  const kcal = entries.filter((e) => e.status === 'eaten' && e.kcal).reduce((n, e) => n + (e.kcal as number), 0);
  const loggedCount = entries.filter((e) => e.status === 'eaten').length;
  return (
    <section className="card stack" aria-labelledby="tm-h" data-testid="today-meals">
      <div className="row between"><h2 id="tm-h" className="h3"><I.pot size={18} aria-hidden style={{ verticalAlign: '-3px' }} /> Meals</h2><a className="btn ghost sm" href="#/meals">Open</a></div>
      {slots.length === 0 && <p className="small muted">All meals are switched off in Preferences.</p>}
      {slots.map((slot) => {
        const here = entries.filter((e) => e.slot === slot);
        const time = data.meals.prefs.slots[slot].time;
        return (
          <div className="stack" key={slot} style={{ gap: 6 }} data-slot={slot}>
            <div className="row between wrap"><span className="small strong">{SLOT_LABEL[slot]}{time ? <span className="muted"> · {time}</span> : null}</span>
              <span className="row wrap" style={{ gap: 4 }}>
                <Button size="sm" variant="ghost" onClick={() => openSheet({ kind: 'mealPicker', date: today, slot, tab: 'log' })} aria-label={`Log ${SLOT_LABEL[slot].toLowerCase()} without a recipe`}>Log</Button>
                <Button size="sm" variant="ghost" icon={I.plus} onClick={() => openSheet({ kind: 'mealPicker', date: today, slot })} aria-label={`Plan ${SLOT_LABEL[slot].toLowerCase()}`}>Plan</Button>
              </span></div>
            {here.length === 0 ? <span className="small muted">Nothing planned or logged.</span> : here.map((e) => <MealRow key={e.id} e={e} compact />)}
          </div>
        );
      })}
      {recents.length > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          <span className="xs muted">Quick log, one tap:</span>
          <div className="row wrap" style={{ gap: 6 }}>{recents.map((r) => {
            const slot = slots.find((s) => r.slots.includes(s)) ?? slots[0] ?? 'dinner';
            return <Button key={r.id} size="sm" variant="soft" onClick={() => add({ date: today, slot, ref: { kind: r.source === 'personal' ? 'dish' : 'recipe', id: r.id }, name: r.name, servings: Math.max(1, Math.min(data.meals.prefs.household, r.servings)), status: 'eaten' })}>Ate {r.name}</Button>;
          })}</div>
        </div>
      )}
      {loggedCount > 0 && kcal > 0 && <p className="xs muted">From the numbers you entered: {kcal} kcal across {entries.filter((e) => e.status === 'eaten' && e.kcal).length} meal{entries.filter((e) => e.status === 'eaten' && e.kcal).length === 1 ? '' : 's'}. Meals without a number are not counted.</p>}
    </section>
  );
};
