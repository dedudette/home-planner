import { useState } from 'react';
import { blockName, exerciseOf, offerFor, workoutById, workoutMinutes } from '../../domain/movement/planner';
import { STOP_LINE } from '../../domain/movement/exercises';
import { useApp } from '../../state/store';
import { I } from '../../ui/icons';
import { Button, Hint, Sheet } from '../../ui/primitives';
import { WorkoutTags } from './shared';

/** One workout: what is in it, how to do each exercise, an easier way, and what to do next. Offers are offers: nothing changes unless asked. */
export const WorkoutDetailSheet = ({ id }: { id: string }) => {
  const { data, closeSheet, openSheet, dispatch } = useApp();
  const w = workoutById(data, id);
  const [open, setOpen] = useState<number | null>(null);
  if (!w) return <Sheet title="Workout" onClose={closeSheet}><p>This workout is no longer here.</p></Sheet>;
  const fav = data.movement.favourites.includes(w.id);
  const easier = w.easierId ? workoutById(data, w.easierId) : null;
  const offer = offerFor(data, w.id);
  return (
    <Sheet title={w.name} onClose={closeSheet} label={`Workout: ${w.name}`}
      footer={<><Button variant="secondary" onClick={closeSheet}>Close</Button><Button icon={I.play} onClick={() => { closeSheet(); openSheet({ kind: 'workoutSession', workoutId: w.id }); }}>Start</Button></>}>
      <p>{w.blurb}</p>
      <WorkoutTags w={w} />
      <Hint icon={I.shield}>{STOP_LINE}</Hint>
      {offer && (
        <div className="card tint stack" role="note" data-testid="workout-offer">
          <p className="small">{offer.reason}</p>
          {offer.kind === 'easier' && easier && <div><Button size="sm" variant="soft" onClick={() => { closeSheet(); openSheet({ kind: 'workout', id: easier.id }); }}>Look at the easier version: {easier.name}</Button></div>}
        </div>
      )}
      <section className="stack" aria-labelledby="wd-ex">
        <h3 id="wd-ex">What is in it</h3>
        <ol className="stack" style={{ margin: 0, paddingLeft: 20, gap: 8 }}>
          {w.blocks.map((b, i) => {
            const ex = exerciseOf(b);
            const amount = b.seconds !== undefined ? `${b.seconds >= 120 && b.seconds % 60 === 0 ? `${b.seconds / 60} min` : `${b.seconds} sec`}` : `${b.reps} reps`;
            return (
              <li key={i}>
                <div className="row between wrap" style={{ gap: 8 }}>
                  <span><b>{blockName(b)}</b> <span className="muted small">· {b.sets} × {amount}{b.restSeconds ? `, rest ${b.restSeconds} sec` : ''}</span></span>
                  {ex && <Button size="sm" variant="ghost" aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)}>{open === i ? 'Hide how' : 'How to'}</Button>}
                </div>
                {ex && open === i && (
                  <div className="stack small" style={{ marginTop: 6 }}>
                    <ol style={{ margin: 0, paddingLeft: 18 }}>{ex.how.map((s, j) => <li key={j}>{s}</li>)}</ol>
                    <p><b>If this is too much:</b> {ex.easier}</p>
                    {ex.harder && <p className="muted"><b>If you want a little more, later:</b> {ex.harder}</p>}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
        <p className="small muted">About {workoutMinutes(w)} minutes, counted once for the whole workout.</p>
      </section>
      <div className="row wrap" style={{ gap: 8 }}>
        <Button variant="soft" size="sm" icon={I.cal} onClick={() => { closeSheet(); openSheet({ kind: 'activityForm', defaults: { module: 'movement', name: w.name, minutes: workoutMinutes(w), ref: { kind: 'workout', id: w.id }, intensity: w.level === 'beginner' ? 'gentle' : 'moderate' } }); }}>Plan it</Button>
        <Button variant="soft" size="sm" icon={I.heart} aria-pressed={fav} onClick={() => dispatch({ type: 'MOVE_FAVOURITE', id: w.id, on: !fav })}>{fav ? 'Favourite' : 'Make a favourite'}</Button>
        {easier && !offer && <Button variant="ghost" size="sm" onClick={() => { closeSheet(); openSheet({ kind: 'workout', id: easier.id }); }}>An easier version</Button>}
        {w.source === 'personal' && <Button variant="ghost" size="sm" icon={I.pencil} onClick={() => openSheet({ kind: 'workoutForm', editId: w.id })}>Edit</Button>}
      </div>
    </Sheet>
  );
};
