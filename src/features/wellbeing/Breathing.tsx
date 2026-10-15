import { useEffect, useRef, useState } from 'react';
import { uid } from '../../domain/appdata';
import { adhocTask } from '../../domain/modules/adhoc';
import { BREATHING, BREATHING_NOTE, type BreathingPattern } from '../../domain/wellbeing/content';
import { useApp } from '../../state/store';
import { I } from '../../ui/icons';
import { Button, Chip, Hint } from '../../ui/primitives';

const LABELS = ['Breathe in', 'Hold', 'Breathe out', 'Hold'] as const;

/** Where in a breathing cycle `elapsed` seconds falls: which phase, and how many seconds of it are left. */
export const phaseAt = (p: BreathingPattern, elapsed: number): { phase: 0 | 1 | 2 | 3; left: number; progress: number } => {
  const total = p.cycle.reduce((n, x) => n + x, 0);
  let t = elapsed % total;
  for (let i = 0; i < 4; i++) {
    if (p.cycle[i] === 0) continue;
    if (t < p.cycle[i]) return { phase: i as 0 | 1 | 2 | 3, left: Math.ceil(p.cycle[i] - t), progress: t / p.cycle[i] };
    t -= p.cycle[i];
  }
  return { phase: 0, left: p.cycle[0], progress: 0 };
};

/** A guided breathing exercise. A relaxation aid, never a treatment. It moves slowly, and not at all if the person prefers reduced motion. */
export const BreathingTab = () => {
  const { dispatch, stamp, toast } = useApp();
  const [pattern, setPattern] = useState<BreathingPattern>(BREATHING[0]);
  const [minutes, setMinutes] = useState(3);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [done, setDone] = useState<number | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (startedAt === null) return;
    timer.current = window.setInterval(() => setNow(Date.now()), 250);
    return () => { if (timer.current) window.clearInterval(timer.current); };
  }, [startedAt]);
  const elapsed = startedAt === null ? 0 : (now - startedAt) / 1000;
  useEffect(() => { if (startedAt !== null && elapsed >= minutes * 60) { setDone(minutes); setStartedAt(null); } }, [elapsed, minutes, startedAt]);

  const stop = () => { if (startedAt !== null) { const m = Math.max(1, Math.round(elapsed / 60)); setDone(m); } setStartedAt(null); };
  const log = () => {
    if (done === null) return;
    const entryId = uid('e');
    const task = adhocTask({ kind: 'breathing', id: pattern.id, name: pattern.name, minutes: done, domain: 'breathing', intensity: 'gentle', difficulty: 1 });
    dispatch({ type: 'TASK_COMPLETE', task, stamp: stamp(), minutes: done, via: 'timer', entryId, surface: 'wellbeing' });
    toast(`Logged: ${pattern.name}, ${done} min.`, { label: 'Undo', run: () => dispatch({ type: 'UNDO', entryId, taskId: task.id, before: null, after: null }) });
    setDone(null);
  };

  const ph = startedAt !== null ? phaseAt(pattern, elapsed) : null;
  const scale = ph ? (ph.phase === 0 ? 0.6 + 0.4 * ph.progress : ph.phase === 2 ? 1 - 0.4 * ph.progress : ph.phase === 1 ? 1 : 0.6) : 0.6;
  return (
    <div className="stack">
      <section className="card stack center" aria-labelledby="br-h">
        <h2 id="br-h" className="h3">Breathe</h2>
        <div className="breath" aria-hidden><div className="breath-ring" style={{ transform: `scale(${scale})` }} /></div>
        <p className="strong" style={{ fontSize: '1.4rem' }} role="status" aria-live="polite" data-testid="breath-cue">{ph ? `${LABELS[ph.phase]} · ${ph.left}` : done !== null ? 'Finished' : 'Ready when you are'}</p>
        {startedAt === null && done === null && (
          <>
            <div className="chips" role="radiogroup" aria-label="Pattern" style={{ justifyContent: 'center' }}>{BREATHING.map((b) => <Chip key={b.id} role="radio" on={pattern.id === b.id} onClick={() => setPattern(b)}>{b.name}</Chip>)}</div>
            <p className="small muted">{pattern.blurb}</p>
            <div className="chips" role="radiogroup" aria-label="How long" style={{ justifyContent: 'center' }}>{[1, 3, 5].map((m) => <Chip key={m} role="radio" on={minutes === m} onClick={() => setMinutes(m)}>{m} min</Chip>)}</div>
            <div><Button icon={I.play} onClick={() => { setStartedAt(Date.now()); setNow(Date.now()); }}>Begin</Button></div>
          </>
        )}
        {startedAt !== null && <div><Button variant="secondary" onClick={stop}>Stop</Button></div>}
        {done !== null && startedAt === null && (
          <div className="stack">
            <p className="small">About {done} minute{done === 1 ? '' : 's'}. Would you like to log it?</p>
            <div className="row wrap" style={{ gap: 8, justifyContent: 'center' }}><Button icon={I.check} onClick={log}>Log it</Button><Button variant="ghost" onClick={() => setDone(null)}>Not now</Button></div>
          </div>
        )}
      </section>
      <Hint icon={I.shield}>{BREATHING_NOTE}</Hint>
    </div>
  );
};
