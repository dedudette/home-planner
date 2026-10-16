import { useState } from 'react';
import { uid } from '../../domain/appdata';
import { EXERCISES } from '../../domain/movement/exercises';
import { workoutMinutes } from '../../domain/movement/planner';
import { MOVE_LEVELS, MOVE_TYPES, type MoveLevel, type MoveType, type Workout, type WorkoutBlock } from '../../domain/movement/types';
import { useApp } from '../../state/store';
import { I } from '../../ui/icons';
import { Button, Chip, Sheet } from '../../ui/primitives';
import { LEVEL_LABEL, TYPE_LABEL } from './shared';

interface Row { exerciseId: string; name: string; sets: string; mode: 'reps' | 'seconds'; amount: string; rest: string }
const blank = (): Row => ({ exerciseId: '', name: '', sets: '2', mode: 'reps', amount: '10', rest: '30' });

/** A workout of your own: exercises from the catalogue or ones you name, with sets, reps or time, and rests. The minutes are worked out for you. */
export const WorkoutFormSheet = ({ editId }: { editId?: string }) => {
  const { data, closeSheet, dispatch, toast } = useApp();
  const existing = data.movement.custom.find((w) => w.id === editId);
  const [name, setName] = useState(existing?.name ?? '');
  const [type, setType] = useState<MoveType>(existing?.type ?? 'strength');
  const [level, setLevel] = useState<MoveLevel>(existing?.level ?? 'beginner');
  const [blurb, setBlurb] = useState(existing?.blurb ?? '');
  const [rows, setRows] = useState<Row[]>(existing?.blocks.map((b) => ({ exerciseId: b.exerciseId ?? '', name: b.name ?? '', sets: String(b.sets), mode: b.seconds !== undefined ? 'seconds' as const : 'reps' as const, amount: String(b.seconds ?? b.reps ?? 10), rest: String(b.restSeconds) })) ?? [blank(), blank()]);
  const [touched, setTouched] = useState(false);

  const toBlock = (r: Row): WorkoutBlock | null => {
    const sets = Math.round(Number(r.sets)), amount = Math.round(Number(r.amount)), rest = Math.max(0, Math.round(Number(r.rest) || 0));
    if ((!r.exerciseId && !r.name.trim()) || !(sets >= 1) || !(amount >= 1)) return null;
    return { ...(r.exerciseId ? { exerciseId: r.exerciseId } : { name: r.name.trim() }), sets: Math.min(20, sets), ...(r.mode === 'seconds' ? { seconds: Math.min(3600, amount) } : { reps: Math.min(200, amount) }), restSeconds: Math.min(600, rest) };
  };
  const blocks = rows.map(toBlock).filter((b): b is WorkoutBlock => !!b);
  const preview: Workout = { id: 'preview', name, type, level, blurb, blocks, source: 'personal' };
  const errors = { name: name.trim() ? '' : 'Give the workout a name.', blocks: blocks.length ? '' : 'Add at least one exercise with sets and an amount.' };
  const update = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const move = (i: number, d: -1 | 1) => setRows((rs) => { const j = i + d; if (j < 0 || j >= rs.length) return rs; const n = [...rs]; [n[i], n[j]] = [n[j], n[i]]; return n; });

  const save = () => {
    setTouched(true);
    if (errors.name || errors.blocks) return;
    dispatch({ type: 'WORKOUT_SAVE', workout: { id: existing?.id ?? uid('wo'), name: name.trim(), type, level, blurb: blurb.trim(), blocks, source: 'personal' } });
    toast(existing ? 'Workout updated.' : 'Workout saved. You can start it or plan it now.');
    closeSheet();
  };

  return (
    <Sheet title={existing ? 'Edit workout' : 'Make your own workout'} onClose={closeSheet} full
      footer={<><Button variant="secondary" onClick={closeSheet}>Cancel</Button><Button icon={I.check} onClick={save}>Save workout</Button></>}>
      <div className="field"><label htmlFor="wf-name">Name</label><input id="wf-name" className="input" data-autofocus value={name} maxLength={80} onChange={(e) => setName(e.target.value)} aria-invalid={touched && !!errors.name} />{touched && errors.name && <span className="small" role="alert" style={{ color: 'var(--clay-ink)' }}>{errors.name}</span>}</div>
      <div className="field"><span className="label" id="wf-type">Kind</span><div className="chips" role="radiogroup" aria-labelledby="wf-type">{MOVE_TYPES.map((t) => <Chip key={t} role="radio" on={type === t} onClick={() => setType(t)}>{TYPE_LABEL[t]}</Chip>)}</div></div>
      <div className="field"><span className="label" id="wf-level">Level</span><div className="chips" role="radiogroup" aria-labelledby="wf-level">{MOVE_LEVELS.map((l) => <Chip key={l} role="radio" on={level === l} onClick={() => setLevel(l)}>{LEVEL_LABEL[l]}</Chip>)}</div></div>
      <div className="field"><label htmlFor="wf-blurb">A note (optional)</label><input id="wf-blurb" className="input" value={blurb} maxLength={200} onChange={(e) => setBlurb(e.target.value)} /></div>

      <section className="stack" aria-labelledby="wf-ex">
        <h3 id="wf-ex">Exercises</h3>
        {rows.map((r, i) => (
          <div className="card stack" key={i} style={{ padding: 12 }}>
            <div className="row wrap" style={{ gap: 6 }}>
              <select className="select" aria-label={`Exercise ${i + 1}`} value={r.exerciseId} onChange={(e) => update(i, { exerciseId: e.target.value, name: e.target.value ? '' : r.name })} style={{ flex: '2 1 180px' }}>
                <option value="">My own exercise…</option>
                {MOVE_TYPES.map((t) => <optgroup key={t} label={TYPE_LABEL[t]}>{EXERCISES.filter((x) => x.type === t).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</optgroup>)}
              </select>
              {!r.exerciseId && <input className="input" aria-label={`Name of exercise ${i + 1}`} placeholder="Name it" value={r.name} maxLength={60} onChange={(e) => update(i, { name: e.target.value })} style={{ flex: '2 1 160px' }} />}
            </div>
            <div className="row wrap" style={{ gap: 6 }}>
              <label className="small">Sets <input className="input" inputMode="numeric" value={r.sets} onChange={(e) => update(i, { sets: e.target.value })} style={{ width: 64 }} aria-label={`Sets for exercise ${i + 1}`} /></label>
              <div className="chips" role="radiogroup" aria-label={`Measured in, exercise ${i + 1}`}><Chip small role="radio" on={r.mode === 'reps'} onClick={() => update(i, { mode: 'reps' })}>Reps</Chip><Chip small role="radio" on={r.mode === 'seconds'} onClick={() => update(i, { mode: 'seconds' })}>Seconds</Chip></div>
              <input className="input" inputMode="numeric" aria-label={`${r.mode === 'reps' ? 'Reps' : 'Seconds'} for exercise ${i + 1}`} value={r.amount} onChange={(e) => update(i, { amount: e.target.value })} style={{ width: 80 }} />
              <label className="small">Rest (sec) <input className="input" inputMode="numeric" value={r.rest} onChange={(e) => update(i, { rest: e.target.value })} style={{ width: 72 }} aria-label={`Rest after exercise ${i + 1}`} /></label>
            </div>
            <div className="row" style={{ gap: 6 }}>
              <Button size="sm" variant="ghost" icon={I.up} aria-label={`Move exercise ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)} />
              <Button size="sm" variant="ghost" icon={I.down} aria-label={`Move exercise ${i + 1} down`} disabled={i === rows.length - 1} onClick={() => move(i, 1)} />
              <Button size="sm" variant="ghost" icon={I.trash} aria-label={`Remove exercise ${i + 1}`} onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((_, j) => j !== i) : [blank()]))} />
            </div>
          </div>
        ))}
        {touched && errors.blocks && <span className="small" role="alert" style={{ color: 'var(--clay-ink)' }}>{errors.blocks}</span>}
        <div><Button variant="soft" size="sm" icon={I.plus} onClick={() => setRows((rs) => [...rs, blank()])}>Add an exercise</Button></div>
      </section>
      {blocks.length > 0 && <p className="small" aria-live="polite">About <b>{workoutMinutes(preview)} minutes</b> in all, worked out from your sets and rests.</p>}
      {existing && <Button variant="ghost" size="sm" icon={I.trash} onClick={() => { const w = existing; dispatch({ type: 'WORKOUT_DELETE', id: w.id }); closeSheet(); toast('Workout deleted. What you logged with it is kept.', { label: 'Undo', run: () => dispatch({ type: 'WORKOUT_SAVE', workout: w }) }); }}>Delete this workout</Button>}
    </Sheet>
  );
};
