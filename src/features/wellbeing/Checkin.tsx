import { useState } from 'react';
import { DraftScope } from '../../state/DraftScope';
import { pageScope } from '../../state/drafts';
import { useDrafts } from '../../state/draftsContext';
import { uid } from '../../domain/appdata';
import { formatDay } from '../../domain/dates';
import { dayEnergyOf } from '../../domain/safety';
import { MOOD_LABEL } from '../../domain/wellbeing/content';
import type { Checkin, CheckinEnergy } from '../../domain/wellbeing/types';
import { useApp } from '../../state/store';
import { I } from '../../ui/icons';
import { Button, Chip, Hint } from '../../ui/primitives';

const ENERGY_LABEL: Record<CheckinEnergy, string> = { low: 'Low', ok: 'Okay', high: 'High' };
const timeOf = (at: string) => new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

/**
 * A self-report. Energy is the same answer Today already asks for, so saying it here adjusts today's list, and the screen says so before
 * you save. Mood is only what you say it is. Nothing is scored, interpreted or compared with anyone, and nothing here is a diagnosis.
 */
const NOTE_SCOPE = pageScope('checkin-note', 'wellbeing', 'A check-in note');

export const CheckinForm = ({ compact }: { compact?: boolean }) => {
  const { data, today, dispatch, toast, stamp } = useApp();
  const drafts = useDrafts();
  const [energy, setEnergy] = useState<CheckinEnergy | null>(null);
  const [mood, setMood] = useState<Checkin['mood']>(null);
  const [note, setNote] = useState('');
  const current = dayEnergyOf(data, today);
  const nothing = energy === null && mood === null && !note.trim();
  const save = () => {
    if (nothing) return;
    const st = stamp();
    const c: Checkin = { id: uid('ck'), date: st.today, at: st.now, energy, mood, note: note.trim().slice(0, 300) };
    dispatch({ type: 'CHECKIN_SAVE', checkin: c });
    if (energy && energy !== current) dispatch({ type: 'DAY_ENERGY', level: energy, stamp: st });
    toast(energy && energy !== current ? 'Check-in saved. Today\'s list was adjusted for your energy.' : 'Check-in saved.', { label: 'Undo', run: () => dispatch({ type: 'CHECKIN_DELETE', id: c.id }) });
    setEnergy(null); setMood(null); setNote('');
    drafts?.drop(NOTE_SCOPE.id);                                    // saved: the typed text has done its job
  };
  const form = (
    <div className="stack">
      <div className="field"><span className="label" id={`ck-e-${compact ? 'c' : 'f'}`}>Energy right now</span>
        <div className="chips" role="radiogroup" aria-labelledby={`ck-e-${compact ? 'c' : 'f'}`}>{(['low', 'ok', 'high'] as const).map((e) => <Chip key={e} role="radio" on={energy === e} onClick={() => setEnergy(energy === e ? null : e)}>{ENERGY_LABEL[e]}</Chip>)}</div>
        <span className="small muted">{energy && energy !== current ? "Saving this also tells Today your energy, so today's list adjusts." : `Today's list currently assumes your energy is ${ENERGY_LABEL[current].toLowerCase()}.`}</span></div>
      <div className="field"><span className="label" id={`ck-m-${compact ? 'c' : 'f'}`}>Mood right now</span>
        <div className="chips" role="radiogroup" aria-labelledby={`ck-m-${compact ? 'c' : 'f'}`}>{([1, 2, 3, 4, 5] as const).map((m) => <Chip key={m} role="radio" on={mood === m} onClick={() => setMood(mood === m ? null : m)}>{MOOD_LABEL[m]}</Chip>)}</div></div>
      {!compact && <div className="field"><label htmlFor="ck-n">A note (optional)</label><textarea id="ck-n" className="textarea" rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything you want to remember about today" /></div>}
      <div><Button icon={I.check} onClick={save} disabled={nothing}>Save check-in</Button></div>
    </div>
  );
  // The note is private text typed on a page: kept through the planner closing, like the sheets' text (state/drafts.ts). The compact form has no note.
  return compact ? form : <DraftScope scope={NOTE_SCOPE}>{form}</DraftScope>;
};

export const TodayCheckin = () => {
  const { data, today } = useApp();
  const todays = data.wellbeing.checkins.filter((c) => c.date === today);
  return (
    <section className="card stack" aria-labelledby="tc-h" data-testid="today-checkin">
      <div className="row between"><h2 id="tc-h" className="h3"><I.heart size={18} aria-hidden style={{ verticalAlign: '-3px' }} /> Check-in</h2><a className="btn ghost sm" href="#/wellbeing?tab=checkin">Open</a></div>
      {todays.length > 0 && <p className="small muted">{todays.length} check-in{todays.length === 1 ? '' : 's'} today, last at {timeOf(todays[todays.length - 1].at)}. Optional, always.</p>}
      <CheckinForm compact />
    </section>
  );
};

export const CheckinTab = () => {
  const { data, today, dispatch, toast } = useApp();
  const recent = [...data.wellbeing.checkins].reverse().slice(0, 21);
  return (
    <div className="stack">
      <section className="card stack" aria-labelledby="ct-new"><h2 id="ct-new" className="h3">How are you, right now?</h2><CheckinForm />
        <Hint icon={I.shield}>A check-in is only what you tell it, kept on this device. It is not a test, it is not scored, and it does not diagnose anything. If you are struggling, talking to someone you trust or a health professional can help.</Hint></section>
      <section className="stack" aria-labelledby="ct-hist">
        <h2 id="ct-hist" className="h3">Recent check-ins</h2>
        {recent.length === 0 ? <p className="muted small">None yet. Days without a check-in are just days you did not write one.</p> : (
          <ul className="stack" style={{ margin: 0, padding: 0 }}>
            {recent.map((c) => (
              <li key={c.id} className="card row between wrap" style={{ listStyle: 'none', padding: 12, gap: 8 }} data-testid="checkin-row">
                <span><b>{formatDay(c.date, today)}</b> <span className="muted small">{timeOf(c.at)}</span><br /><span className="small">{[c.mood ? `Mood: ${MOOD_LABEL[c.mood]}` : '', c.energy ? `Energy: ${ENERGY_LABEL[c.energy]}` : ''].filter(Boolean).join(' · ') || 'Note only'}{c.note ? ` · ${c.note}` : ''}</span></span>
                <Button size="sm" variant="ghost" icon={I.trash} aria-label={`Delete the check-in from ${formatDay(c.date, today)} at ${timeOf(c.at)}`} onClick={() => { const old = c; dispatch({ type: 'CHECKIN_DELETE', id: c.id }); toast('Check-in deleted.', { label: 'Undo', run: () => dispatch({ type: 'CHECKIN_SAVE', checkin: old }) }); }} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};
