import { useState } from 'react';
import { addDays, formatDay, formatShort, startOfWeek } from '../../domain/dates';
import { entriesFor, mealState } from '../../domain/meals/planner';
import type { MealEntry } from '../../domain/meals/types';
import { useApp } from '../../state/store';
import { I } from '../../ui/icons';
import { Button, Tag } from '../../ui/primitives';
import { PlannedActivities } from '../sections/SectionPage';
import { SLOT_LABEL, SLOT_ORDER, STATUS_LABEL, useMealActions } from './actions';

export const MealRow = ({ e, compact }: { e: MealEntry; compact?: boolean }) => {
  const { data, today, openSheet } = useApp();
  const { setStatus } = useMealActions();
  const state = mealState(data, e, today);
  const done = state === 'eaten' || state === 'skipped';
  return (
    <div className="row between wrap" style={{ gap: 8 }} data-testid="meal-row" data-state={state}>
      <button className="grow plain-btn" style={{ minHeight: 44 }} onClick={() => openSheet({ kind: 'mealEdit', id: e.id })} aria-label={`${e.name}, ${e.servings} serving${e.servings === 1 ? '' : 's'}, ${STATUS_LABEL[state]}. Open details`}>
        <b>{e.name}</b>{' '}
        <Tag kind={state === 'eaten' || state === 'prepared' ? 'green' : state === 'unrecorded' ? 'lav' : undefined}>{STATUS_LABEL[state]}</Tag>
        {!compact && <><br /><span className="small muted">{e.servings} serving{e.servings === 1 ? '' : 's'}{e.kcal ? ` · ${e.kcal} kcal (your number)` : ''}</span></>}
      </button>
      {!done && (
        <span className="row" style={{ gap: 6 }}>
          <Button size="sm" variant="soft" onClick={() => setStatus(e, 'eaten')}>Ate it</Button>
          {state !== 'prepared' && state !== 'unrecorded' && <Button size="sm" variant="ghost" onClick={() => setStatus(e, 'skipped')} aria-label={`Skip ${e.name}`}>Skip</Button>}
          {state === 'unrecorded' && <Button size="sm" variant="ghost" onClick={() => setStatus(e, 'skipped')} aria-label={`Did not eat ${e.name}`}>Didn't</Button>}
        </span>
      )}
    </div>
  );
};

/** A week of meals. Past days with nothing recorded say "Not recorded", never "skipped". */
export const PlanTab = () => {
  const { data, today, openSheet } = useApp();
  const [start, setStart] = useState(startOfWeek(today));
  const slots = SLOT_ORDER.filter((s) => data.meals.prefs.slots[s].on);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const anyPlanned = data.meals.plan.some((e) => e.date >= start && e.date <= addDays(start, 6));
  return (
    <div className="stack">
      <div className="row between wrap" style={{ gap: 8 }}>
        <div className="row wrap" style={{ gap: 6 }}>
          <Button size="sm" variant="secondary" icon={I.left} aria-label="Previous week" onClick={() => setStart(addDays(start, -7))} />
          <Button size="sm" variant="secondary" icon={I.right} aria-label="Next week" onClick={() => setStart(addDays(start, 7))} />
          {start !== startOfWeek(today) && <Button size="sm" variant="ghost" onClick={() => setStart(startOfWeek(today))}>This week</Button>}
          <Button size="sm" variant="soft" icon={I.sparkles} onClick={() => openSheet({ kind: 'assist', feature: 'meals' })}>Suggest meals</Button>
        </div>
        <h2 className="h3" aria-live="polite">{formatShort(start)} to {formatShort(addDays(start, 6))}</h2>
      </div>
      {!anyPlanned && <p className="small muted">Nothing planned this week. Add a meal to any day, or log what you eat without a plan.</p>}
      <div className="stack">
        {days.map((date) => {
          const entries = entriesFor(data, date);
          return (
            <section className="card stack" key={date} aria-label={formatDay(date, today)} style={date === today ? { borderColor: 'var(--primary)' } : undefined}>
              <h3>{formatDay(date, today)}</h3>
              {slots.map((slot) => {
                const here = entries.filter((e) => e.slot === slot);
                const time = data.meals.prefs.slots[slot].time;
                return (
                  <div className="stack" key={slot} style={{ gap: 6 }} data-slot={slot}>
                    <div className="row between"><span className="small strong">{SLOT_LABEL[slot]}{time ? <span className="muted"> · {time}</span> : null}</span>
                      <Button size="sm" variant="ghost" icon={I.plus} onClick={() => openSheet({ kind: 'mealPicker', date, slot })} aria-label={`Add ${SLOT_LABEL[slot].toLowerCase()} on ${formatDay(date, today)}`}>{here.length ? 'Add' : 'Add a meal'}</Button></div>
                    {here.map((e) => <MealRow key={e.id} e={e} />)}
                  </div>
                );
              })}
              {entries.filter((e) => !slots.includes(e.slot)).map((e) => <MealRow key={e.id} e={e} />)}
            </section>
          );
        })}
      </div>
      <PlannedActivities module="meals" />
    </div>
  );
};
