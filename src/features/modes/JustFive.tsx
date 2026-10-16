import { useEffect, useRef, useState } from 'react';
import { pickJustFive } from '../../domain/micro';
import type { Task } from '../../domain/types';
import { useApp } from '../../state/store';
import { DOMAIN_ICON, I, ROOM_ICON } from '../../ui/icons';
import { isLife } from '../../domain/scoring';
import { Button, Sheet } from '../../ui/primitives';

export const JustFiveSheet = () => {
  const { data, today, closeSheet, complete, beginTimer, toast, dispatch } = useApp();
  const seen = useRef<string[]>([]);
  const [task, setTask] = useState<Task | null>(() => pickJustFive(data, [], today));
  const [phase, setPhase] = useState<'pick' | 'done'>('pick');
  const [rounds, setRounds] = useState(0);

  useEffect(() => { if (task) seen.current = [task.id, ...seen.current]; }, [task]);

  // A timer started from here completes through the store; notice it.
  useEffect(() => {
    if (task && phase === 'pick' && data.fiveRecent[0] === task.id) { setPhase('done'); setRounds((r) => r + 1); }
  }, [data.fiveRecent, task, phase]);

  const next = () => { setTask(pickJustFive(data, seen.current, today)); setPhase('pick'); };
  const swap = () => { if (task) dispatch({ type: 'FIVE_SEEN', id: task.id }); next(); };
  const didIt = () => { if (!task) return; complete(task, { via: 'five', minutes: 5, quiet: true }); setPhase('done'); setRounds((r) => r + 1); };
  const RoomIcon = task ? (isLife(task) ? DOMAIN_ICON[task.domain!] : ROOM_ICON[task.roomKind]) : I.sparkles;
  const effort = data.preferences.focus.every((f) => f === 'home') ? 'cleaning' : 'effort';

  if (!task) {
    return <Sheet title="Just 5 minutes" onClose={closeSheet} full><p>We couldn't find a small task for your home. Try the "I only have…" option instead.</p></Sheet>;
  }
  return (
    <Sheet title="Just 5 minutes" onClose={closeSheet} full label="Just 5 minutes"
      footer={phase === 'done' ? (
        <><Button variant="secondary" onClick={() => { closeSheet(); toast('Good call. Rest up. This all counts.'); }}>I'm done for now</Button><Button icon={I.timer} onClick={next}>Do another 5 minutes</Button></>
      ) : (
        <><Button variant="secondary" onClick={didIt}>I did it</Button><Button icon={I.play} onClick={() => beginTimer(task, 5)}>Start 5-min timer</Button></>
      )}>
      {phase === 'pick' ? (
        <div className="five-card">
          <div className="big-ic"><RoomIcon size={36} aria-hidden /></div>
          <p className="small muted strong" style={{ textTransform: 'uppercase', letterSpacing: '0.06em' }}>Just one small thing · {task.roomName}</p>
          <h1 className="five-name">{task.name}</h1>
          <p className="muted">That's it. You can stop after this, and that's completely okay.</p>
          <ol className="steps" aria-label="How to do it">
            {task.substeps.map((s, i) => <li key={i} className="step" style={{ listStyle: 'none' }}><span className="n">{i + 1}</span><span>{s}</span></li>)}
          </ol>
          <button className="btn ghost" onClick={swap}><I.repeat size={16} aria-hidden /> Not this one. Show me another.</button>
        </div>
      ) : (
        <div className="five-card" role="status" aria-live="polite">
          <div className="big-ic celebrate" style={{ background: 'var(--sun)', color: 'var(--sun-ink)' }}><I.sparkles size={38} aria-hidden /></div>
          <h1 className="five-name">Nice. You made progress.</h1>
          <p className="muted">{rounds > 1 ? `${rounds} rounds · about ${rounds * 5} minutes of ${effort}. ` : ''}That's more than you had five minutes ago.</p>
          <p className="small muted">Want to keep going? Totally optional.</p>
        </div>
      )}
    </Sheet>
  );
};
