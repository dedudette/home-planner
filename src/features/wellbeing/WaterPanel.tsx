import { useState } from 'react';
import { useDraftState } from '../../state/DraftScope';
import { uid } from '../../domain/appdata';
import { formatDay } from '../../domain/dates';
import { checkAmount, CHECK_DAY_ML, dayTotal, formatVolume, fromMl, GOAL_MAX_ML, GOAL_MIN_ML, QUICK_ML, toMl, UNIT_LABEL, waterHistory } from '../../domain/water/water';
import type { WaterEntry, WaterUnit } from '../../domain/water/types';
import { useApp } from '../../state/store';
import { HealthWaterNote } from '../health/HealthCard';
import { I } from '../../ui/icons';
import { Button, Chip, Hint, ProgressBar, Sheet } from '../../ui/primitives';

const timeOf = (at: string) => new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const localHM = (at: string) => { const d = new Date(at); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const localDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Adding water, with an Undo that removes exactly that entry. Big numbers are confirmed, impossible ones refused. */
export const useWater = () => {
  const { data, dispatch, toast, today, confirm } = useApp();
  const unit = data.water.unit;
  const add = (ml: number) => {
    const entry: WaterEntry = { id: uid('w'), date: today, at: new Date().toISOString(), ml };
    dispatch({ type: 'WATER_ADD', entry });
    toast(`Added ${formatVolume(ml, unit)}.`, { label: 'Undo', run: () => dispatch({ type: 'WATER_DELETE', id: entry.id }) });
  };
  const addTyped = (amount: number, u: WaterUnit): string | null => {
    const c = checkAmount(amount, u);
    if (!c.ok) return c.why;
    if ('confirm' in c) { confirm({ title: 'Check this amount', body: <p>{c.confirm}</p>, confirmLabel: `Yes, add ${formatVolume(c.ml, u)}`, cancelLabel: 'Let me change it', onConfirm: () => add(c.ml) }); return null; }
    add(c.ml);
    return null;
  };
  return { add, addTyped, unit };
};

export const WaterEditSheet = ({ id }: { id: string }) => {
  const { data, closeSheet, dispatch, toast } = useApp();
  const e = data.water.entries.find((x) => x.id === id);
  const unit = data.water.unit;
  const [amount, setAmount] = useDraftState('amount', e ? String(Math.round(fromMl(e.ml, unit) * 10) / 10) : '', 'text');
  const [time, setTime] = useDraftState('time', e ? localHM(e.at) : '09:00', 'text');
  const [err, setErr] = useState('');
  if (!e) return <Sheet title="Water" onClose={closeSheet}><p>This entry is gone.</p></Sheet>;
  const save = () => {
    const c = checkAmount(Number(amount.replace(',', '.')), unit);
    if (!c.ok) { setErr(c.why); return; }
    const [h, m] = time.split(':').map(Number);
    const d = new Date(`${e.date}T12:00:00`); d.setHours(h || 0, m || 0, 0, 0);
    dispatch({ type: 'WATER_EDIT', id, ml: c.ml, at: d.toISOString(), date: localDate(d) });
    closeSheet();
  };
  return (
    <Sheet title="Change this entry" onClose={closeSheet}
      footer={<><Button variant="ghost" icon={I.trash} onClick={() => { const old = e; dispatch({ type: 'WATER_DELETE', id }); closeSheet(); toast('Entry removed.', { label: 'Undo', run: () => dispatch({ type: 'WATER_ADD', entry: old }) }); }}>Remove</Button><Button icon={I.check} onClick={save}>Save</Button></>}>
      <div className="row wrap" style={{ gap: 12 }}>
        <div className="field"><label htmlFor="we-a">Amount ({UNIT_LABEL[unit]})</label><input id="we-a" className="input" inputMode="decimal" data-autofocus value={amount} onChange={(ev) => { setAmount(ev.target.value); setErr(''); }} style={{ width: 130 }} /></div>
        <div className="field"><label htmlFor="we-t">Time</label><input id="we-t" className="input" type="time" value={time} onChange={(ev) => setTime(ev.target.value)} style={{ width: 140 }} /></div>
      </div>
      {err && <p className="small" role="alert" style={{ color: 'var(--clay-ink)' }}>{err}</p>}
    </Sheet>
  );
};

const Summary = () => {
  const { data, today } = useApp();
  const { goalMl, unit, entries } = data.water;
  const total = dayTotal(entries, today);
  if (total === null) return <p className="muted" data-testid="water-total">Nothing logged yet today. That is fine: logging is optional.</p>;
  return (
    <div className="stack" style={{ gap: 6 }} data-testid="water-total">
      <p><b style={{ fontSize: '1.4rem', fontFamily: 'var(--font-head)' }}>{formatVolume(total, unit)}</b> <span className="muted">logged today{goalMl ? ` · your goal ${formatVolume(goalMl, unit)}` : ''}</span></p>
      {goalMl && <ProgressBar value={total / goalMl} label="Water today against your own goal" />}
      {goalMl && total >= goalMl && <p className="small">You have reached your own goal for today.</p>}
      {total > CHECK_DAY_ML && <p className="small muted">That is a large total for one day. If a number looks wrong, you can correct it below.</p>}
    </div>
  );
};

const Quick = () => {
  const { add, unit } = useWater();
  return (
    <div className="row wrap" style={{ gap: 8 }} role="group" aria-label="Quick add water">
      {QUICK_ML.map((ml) => <Button key={ml} size="sm" variant="soft" icon={I.drop} onClick={() => add(ml)} aria-label={`Add ${formatVolume(ml, unit)}`}>{formatVolume(ml, unit)}</Button>)}
    </div>
  );
};

/** The Today card: today's total and one-tap amounts. Everything else lives in the section. */
export const TodayWater = () => (
  <section className="card stack" aria-labelledby="tw-h" data-testid="today-water">
    <div className="row between"><h2 id="tw-h" className="h3"><I.drop size={18} aria-hidden style={{ verticalAlign: '-3px' }} /> Water</h2><a className="btn ghost sm" href="#/wellbeing?tab=water">Open</a></div>
    <Summary />
    <Quick />
  </section>
);

/** The Water tab: add, correct, undo, set your own goal and unit, and look back. */
export const WaterTab = () => {
  const { data, today, dispatch, openSheet } = useApp();
  const { addTyped, unit } = useWater();
  const [amount, setAmount] = useState('');
  const [err, setErr] = useState('');
  const [goal, setGoal] = useState(data.water.goalMl ? String(Math.round(fromMl(data.water.goalMl, unit) * 10) / 10) : '');
  const [goalErr, setGoalErr] = useState('');
  const todays = data.water.entries.filter((e) => e.date === today);
  const hist = waterHistory(data.water.entries, today, 14);
  const setGoalNow = () => {
    const ml = toMl(Number(goal.replace(',', '.')), unit);
    if (!(ml >= GOAL_MIN_ML && ml <= GOAL_MAX_ML)) { setGoalErr(`Choose between ${formatVolume(GOAL_MIN_ML, unit)} and ${formatVolume(GOAL_MAX_ML, unit)}.`); return; }
    setGoalErr(''); dispatch({ type: 'WATER_SETTINGS', goalMl: ml });
  };
  return (
    <div className="stack">
      <section className="card stack" aria-labelledby="w-today"><h2 id="w-today" className="h3">Today</h2><Summary /><HealthWaterNote /><Quick />
        <div className="row wrap" style={{ gap: 8 }}>
          <input className="input" inputMode="decimal" aria-label={`Another amount in ${UNIT_LABEL[unit]}`} placeholder={`Another amount (${UNIT_LABEL[unit]})`} value={amount} onChange={(e) => { setAmount(e.target.value); setErr(''); }} style={{ flex: '1 1 160px' }} />
          <Button icon={I.plus} onClick={() => { const r = addTyped(Number(amount.replace(',', '.')), unit); if (r) setErr(r); else setAmount(''); }} disabled={!amount.trim()}>Add</Button>
        </div>
        {err && <p className="small" role="alert" style={{ color: 'var(--clay-ink)' }}>{err}</p>}
        {todays.length > 0 && (
          <ul className="stack" aria-label="Today's entries" style={{ margin: 0, padding: 0, gap: 4 }}>
            {todays.map((e) => (
              <li key={e.id} className="row between" style={{ listStyle: 'none', minHeight: 44 }} data-testid="water-entry"><span>{timeOf(e.at)} · <b>{formatVolume(e.ml, unit)}</b></span><Button size="sm" variant="ghost" icon={I.pencil} onClick={() => openSheet({ kind: 'waterEdit', id: e.id })} aria-label={`Change the ${formatVolume(e.ml, unit)} entry at ${timeOf(e.at)}`}>Change</Button></li>
            ))}
          </ul>
        )}
      </section>

      <section className="card stack" aria-labelledby="w-goal">
        <h2 id="w-goal" className="h3">Your own goal and units</h2>
        <Hint icon={I.info}>There is no amount that suits everyone: it depends on your body, the weather, how active you are and your health. So CleanFlow does not suggest one. Set a goal only if you want your own, and follow your doctor's advice if you have any about fluids.</Hint>
        <div className="field"><span className="label" id="w-unit">Show amounts in</span><div className="chips" role="radiogroup" aria-labelledby="w-unit">{(['ml', 'floz', 'cup'] as const).map((u) => <Chip key={u} role="radio" on={unit === u} onClick={() => { dispatch({ type: 'WATER_SETTINGS', unit: u }); setGoal(data.water.goalMl ? String(Math.round(fromMl(data.water.goalMl, u) * 10) / 10) : ''); }}>{u === 'ml' ? 'Millilitres' : u === 'floz' ? 'Fluid ounces' : 'Cups'}</Chip>)}</div></div>
        <div className="row wrap" style={{ gap: 8 }}>
          <div className="field"><label htmlFor="w-g">Daily goal ({UNIT_LABEL[unit]}), optional</label><input id="w-g" className="input" inputMode="decimal" value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="No goal" style={{ width: 150 }} /></div>
          <Button variant="soft" onClick={setGoalNow} disabled={!goal.trim()}>Set goal</Button>
          {data.water.goalMl !== null && <Button variant="ghost" onClick={() => { dispatch({ type: 'WATER_SETTINGS', goalMl: null }); setGoal(''); }}>No goal</Button>}
        </div>
        {goalErr && <p className="small" role="alert" style={{ color: 'var(--clay-ink)' }}>{goalErr}</p>}
      </section>

      <section className="card stack" aria-labelledby="w-hist">
        <h2 id="w-hist" className="h3">The last two weeks</h2>
        <ul className="stack" style={{ margin: 0, padding: 0, gap: 2 }}>
          {[...hist.days].reverse().map((d) => (
            <li key={d.date} className="row between small" style={{ listStyle: 'none' }}><span>{formatDay(d.date, today)}</span><span className={d.ml === null ? 'muted' : ''}>{d.ml === null ? 'not logged' : `${formatVolume(d.ml, unit)} · ${d.entries} entr${d.entries === 1 ? 'y' : 'ies'}`}</span></li>
          ))}
        </ul>
        <p className="small muted">{hist.averageOnLoggedDays === null ? 'No days logged in this period.' : `On the ${hist.loggedDays} day${hist.loggedDays === 1 ? '' : 's'} you logged, the average was ${formatVolume(hist.averageOnLoggedDays, unit)}. Days with nothing logged are left out, not counted as zero.`}</p>
      </section>
    </div>
  );
};
