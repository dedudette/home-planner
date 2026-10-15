import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { uid } from '../../domain/appdata';
import { adhocTask } from '../../domain/modules/adhoc';
import { describeStep, endSession, loggedExercises, markEasier, nextStep, pauseSession, resumeSession, sessionMinutes, sessionProgress, skipExercise, startSession, tick, type SessionState } from '../../domain/movement/session';
import { workoutById, workoutDifficulty, workoutIntensity } from '../../domain/movement/planner';
import type { Felt } from '../../domain/movement/types';
import { dueInfo } from '../../domain/schedule';
import { reducer } from '../../state/reducer';
import { useApp } from '../../state/store';
import { I } from '../../ui/icons';
import { Button, ProgressBar, Sheet, Hint } from '../../ui/primitives';

const KEY = 'cleanflow:workout';
const read = (workoutId: string): SessionState | null => {
  try { const raw = window.localStorage.getItem(KEY); const s = raw ? (JSON.parse(raw) as SessionState) : null; return s && s.workoutId === workoutId && Array.isArray(s.steps) ? s : null; } catch { return null; }
};
const write = (s: SessionState | null) => { try { if (s) window.localStorage.setItem(KEY, JSON.stringify(s)); else window.localStorage.removeItem(KEY); } catch { /* ignore */ } };

const FELT: { value: Felt; label: string }[] = [{ value: 'easy', label: 'Easy' }, { value: 'right', label: 'About right' }, { value: 'hard', label: 'Hard' }, { value: 'pain', label: 'I stopped: pain or discomfort' }];

/**
 * A guided session: start, pause, rest, next, finish. It keeps its own clock (running time only), survives a reload, and ends with a
 * choice about what to log. One workout is one log entry with its real duration. Nothing is escalated, ever.
 */
export const WorkoutSessionSheet = ({ workoutId, taskId }: { workoutId: string; taskId?: string }) => {
  const { data, view, today, closeSheet, dispatch, stamp, toast } = useApp();
  const w = workoutById(data, workoutId);
  const [s, setS] = useState<SessionState | null>(() => (w ? read(workoutId) ?? startSession(w, Date.now()) : null));
  const [showHow, setShowHow] = useState(false);
  const [felt, setFelt] = useState<Felt | null>(null);
  const [asPlanned, setAsPlanned] = useState<string>('');
  const [saved, setSaved] = useState(false);
  const live = useRef(s);
  live.current = s;

  useEffect(() => { write(s); }, [s]);
  useEffect(() => {
    if (!s || s.status !== 'running') return;
    const id = window.setInterval(() => setS((cur) => (cur ? tick(cur, Date.now()) : cur)), 500);
    return () => window.clearInterval(id);
  }, [s?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // A planned movement activity still waiting today that this session could count as.
  const waiting = useMemo(() => (taskId ? [] : view.tasks.filter((t) => t.module === 'movement' && t.userPlanned && !t.id.startsWith('adhoc:') && dueInfo(t, view.states[t.id], today).due === today)), [view, taskId, today]);
  const finished = s?.status === 'finished';

  const leave = useCallback(() => { write(null); closeSheet(); }, [closeSheet]);
  if (!w || !s) return <Sheet title="Workout" onClose={closeSheet}><p>This workout is no longer here.</p></Sheet>;

  const step = s.steps[s.index];
  const info = describeStep(s, w);
  const timed = step?.seconds != null;
  const left = timed && step ? Math.max(0, Math.ceil((step.seconds as number) - s.stepMs / 1000)) : null;
  const mins = sessionMinutes(s);
  const doneAll = s.index >= s.steps.length;

  const log = (outcome: 'completed' | 'stopped') => {
    const entryId = uid('e');
    const targetId = asPlanned || taskId;
    const planned = targetId ? view.byId.get(targetId) : undefined;
    const task = planned ?? adhocTask({ kind: 'workout', id: w.id, name: w.name, minutes: mins, domain: 'fitness', intensity: workoutIntensity(w), difficulty: workoutDifficulty(w) });
    const st = stamp();
    const action = outcome === 'completed'
      ? ({ type: 'TASK_COMPLETE', task, stamp: st, minutes: mins, via: 'timer', entryId, surface: 'movement' } as const)
      : ({ type: 'TASK_STOP', task, stamp: st, minutes: mins, entryId, surface: 'movement' } as const);
    const after = reducer(data, action).taskStates[task.id] ?? null;
    dispatch(action);
    dispatch({ type: 'MOVE_LOG_ADD', log: { entryId, workoutId: w.id, name: w.name, date: st.today, at: st.now, felt, note: '', exercises: loggedExercises(s, w) } });
    write(null);
    setSaved(true);
    toast(outcome === 'completed' ? `Logged: ${w.name}, ${mins} min.` : `Saved what you did: ${mins} min.`, { label: 'Undo', run: () => { dispatch({ type: 'UNDO', entryId, taskId: task.id, before: data.taskStates[task.id] ?? null, after }); dispatch({ type: 'MOVE_LOG_DELETE', entryId }); } });
  };

  if (saved) {
    return (
      <Sheet title="Nicely done" onClose={leave} footer={<Button onClick={leave}>Close</Button>}>
        <p>That is recorded once, as {mins} minutes for the whole workout.</p>
        {felt === 'pain' && <Hint icon={I.shield}>Thank you for saying so. Nothing is being pushed, and the next time is yours to choose. If pain is sharp or keeps happening, speak to a health professional.</Hint>}
      </Sheet>
    );
  }

  if (finished) {
    return (
      <Sheet title={doneAll ? 'Finished' : 'Workout ended'} onClose={() => { write(s); closeSheet(); }} label="Workout summary"
        footer={<>
          <Button variant="ghost" onClick={leave}>Don't log it</Button>
          {doneAll ? <Button icon={I.check} onClick={() => log('completed')}>Log it ({mins} min)</Button> : <><Button variant="secondary" onClick={() => log('stopped')}>Log what I did</Button><Button icon={I.check} onClick={() => log('completed')}>Log it as done</Button></>}
        </>}>
        <p>{doneAll ? `You did it: about ${mins} minute${mins === 1 ? '' : 's'}.` : `You did about ${mins} minute${mins === 1 ? '' : 's'}. Stopping early is fine.`}</p>
        <ul className="stack small" style={{ margin: 0, paddingLeft: 18 }} aria-label="What you did">
          {loggedExercises(s, w).map((l, i) => <li key={i}>{l.name}: {l.status === 'skipped' ? 'skipped' : l.status === 'easier' ? `${l.setsDone ?? 0} set${l.setsDone === 1 ? '' : 's'}, the easier way` : `${l.setsDone ?? 0} set${l.setsDone === 1 ? '' : 's'}`}</li>)}
        </ul>
        <div className="field"><span className="label" id="ws-felt">How did it feel? (optional)</span>
          <div className="chips" role="radiogroup" aria-labelledby="ws-felt">{FELT.map((f) => <button key={f.value} className="chip" role="radio" aria-checked={felt === f.value} onClick={() => setFelt(felt === f.value ? null : f.value)}>{f.label}</button>)}</div>
        </div>
        {waiting.length > 0 && (
          <div className="field"><label htmlFor="ws-plan">Is this one of the things you planned for today?</label>
            <select id="ws-plan" className="select" value={asPlanned} onChange={(e) => setAsPlanned(e.target.value)}>
              <option value="">No, log it on its own</option>
              {waiting.map((t) => <option key={t.id} value={t.id}>Yes: {t.name}</option>)}
            </select>
            <span className="small muted">If yes, it is recorded once, against that plan. It is never counted twice.</span>
          </div>
        )}
      </Sheet>
    );
  }

  return (
    <Sheet title={w.name} onClose={() => { write(s); closeSheet(); }} label={`Guided workout: ${w.name}`}
      footer={<>
        <Button variant="ghost" onClick={() => setS(endSession(s, Date.now()))}>End workout</Button>
        {s.status === 'paused' ? <Button icon={I.play} onClick={() => setS(resumeSession(s, Date.now()))}>Resume</Button> : <Button variant="secondary" icon={I.pause} onClick={() => setS(pauseSession(s, Date.now()))}>Pause</Button>}
        {step?.kind === 'work' && !timed && <Button icon={I.check} onClick={() => setS(nextStep(s, Date.now()))}>Done</Button>}
        {(step?.kind === 'rest' || timed) && <Button icon={I.skip} onClick={() => setS(nextStep(s, Date.now()))}>{step?.kind === 'rest' ? 'Skip rest' : 'Next'}</Button>}
      </>}>
      <ProgressBar value={sessionProgress(s)} label="Workout progress" />
      <div className="card tint stack center" aria-live="polite" data-testid="session-step">
        <p className="xs muted">{step?.kind === 'rest' ? 'Rest' : 'Now'}</p>
        <h2 style={{ fontSize: '1.6rem' }}>{info.title}</h2>
        <p className="muted">{info.detail}</p>
        {left !== null && <p className="strong" style={{ fontSize: '2.4rem', fontFamily: 'var(--font-head)' }} role="timer" aria-label={`${left} seconds left`}>{Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</p>}
        {s.status === 'paused' && <p className="strong">Paused. Your time is not running.</p>}
      </div>
      {step?.kind === 'work' && info.how.length > 0 && (
        <div className="stack">
          <Button variant="soft" size="sm" aria-expanded={showHow} onClick={() => setShowHow(!showHow)}>{showHow ? 'Hide how to' : 'How to do it'}</Button>
          {showHow && <ol className="stack small" style={{ margin: 0, paddingLeft: 20 }}>{info.how.map((h, i) => <li key={i}>{h}</li>)}</ol>}
          {info.easier && <div className="row wrap" style={{ gap: 8 }}><Button size="sm" variant="ghost" onClick={() => { setS(markEasier(s)); toast(`Easier way: ${info.easier}`); }}>Too much? Do it the easier way</Button><Button size="sm" variant="ghost" onClick={() => setS(skipExercise(s, Date.now()))}>Skip this exercise</Button></div>}
        </div>
      )}
      <p className="xs muted">{`${s.activeMs < 30_000 ? 'Just started' : `About ${mins} minute${mins === 1 ? '' : 's'} so far`}, counting only the time you are moving. Stop whenever you like. If something hurts, stop.`}</p>
    </Sheet>
  );
};
