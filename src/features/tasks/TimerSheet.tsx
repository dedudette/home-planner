import { useState } from 'react';
import { DURATIONS, formatClock, remainingSec } from '../../domain/timer';
import type { Task } from '../../domain/types';
import { useApp } from '../../state/store';
import { I } from '../../ui/icons';
import { Button, Chip, Sheet } from '../../ui/primitives';

const closest = (m: number) => DURATIONS.reduce((a, b) => (Math.abs(b - m) < Math.abs(a - m) ? b : a), DURATIONS[0]);

export const TimerPickSheet = ({ task }: { task: Task }) => {
  const { closeSheet, beginTimer, timer } = useApp();
  const [choice, setChoice] = useState<number | 'custom'>(closest(task.minutes));
  const [custom, setCustom] = useState('25');
  const minutes = choice === 'custom' ? Number(custom) : choice;
  const valid = Number.isFinite(minutes) && minutes >= 1 && minutes <= 180;
  return (
    <Sheet title="Start a timer" onClose={closeSheet} footer={<><Button variant="secondary" onClick={closeSheet}>Cancel</Button><Button disabled={!valid} icon={I.play} onClick={() => beginTimer(task, minutes)}>Start {valid ? `${minutes} min` : ''}</Button></>}>
      <div>
        <p className="strong">{task.name}</p>
        <p className="small muted">{task.roomName} · estimated {task.minutes} min</p>
      </div>
      {timer && <div className="hint"><I.info size={18} aria-hidden />A timer is already running for "{timer.taskName}". Starting a new one replaces it.</div>}
      <div className="chips" role="radiogroup" aria-label="Timer length">
        {DURATIONS.map((d) => <Chip key={d} role="radio" on={choice === d} onClick={() => setChoice(d)}>{d} min</Chip>)}
        <Chip role="radio" on={choice === 'custom'} onClick={() => setChoice('custom')}>Custom</Chip>
      </div>
      {choice === 'custom' && (
        <div className="field">
          <label htmlFor="custom-min">Minutes</label>
          <input id="custom-min" className="input" type="number" inputMode="numeric" min={1} max={180} value={custom} onChange={(e) => setCustom(e.target.value)} style={{ maxWidth: 140 }} />
          {!valid && <span className="small" style={{ color: 'var(--clay-ink)' }}>Choose between 1 and 180 minutes.</span>}
        </div>
      )}
      <p className="small muted">You can pause, finish early, or add more time. Stopping partway is always fine.</p>
    </Sheet>
  );
};

export const TimerSheet = () => {
  const { timer, timerNow, closeSheet, pauseResume, addTime, finishTimer } = useApp();
  if (!timer) return null;
  const left = remainingSec(timer, timerNow);
  const frac = timer.totalSec ? left / timer.totalSec : 0;
  const r = 118; const c = 2 * Math.PI * r;
  const finished = timer.status === 'finished';
  return (
    <Sheet title={finished ? 'Time is up' : 'Cleaning timer'} onClose={closeSheet} label="Cleaning timer"
      footer={finished ? (
        <><Button variant="secondary" onClick={() => finishTimer('stop')}>Not finished, and that's fine</Button><Button icon={I.check} onClick={() => finishTimer('complete')}>Mark complete</Button></>
      ) : (
        <><Button variant="secondary" icon={I.skip} onClick={() => finishTimer('skip')}>Skip</Button><Button icon={I.check} onClick={() => finishTimer('complete')}>Complete</Button></>
      )}>
      <div className="center">
        <p className="strong" style={{ fontSize: '1.1rem' }}>{timer.taskName}</p>
        <p className="small muted">{timer.roomName}</p>
      </div>
      <div className={finished ? 'ring-wrap celebrate' : 'ring-wrap'}>
        <svg viewBox="0 0 280 280" aria-hidden>
          <circle cx="140" cy="140" r={r} fill="none" strokeWidth="14" className="ring-bg" />
          <circle cx="140" cy="140" r={r} fill="none" strokeWidth="14" className="ring-fg" strokeDasharray={c} strokeDashoffset={c * (1 - Math.max(0, Math.min(1, frac)))} />
        </svg>
        <div className="ring-center">
          {finished ? (
            <div><I.sparkles size={44} aria-hidden style={{ color: 'var(--primary)' }} /><div className="ring-time" style={{ fontSize: '1.6rem' }}>Nice work</div></div>
          ) : (
            <div>
              <div className="ring-time" role="timer" aria-label={`${formatClock(left)} remaining`}>{formatClock(left)}</div>
              <div className="small muted">{timer.status === 'paused' ? 'Paused' : 'remaining'}</div>
            </div>
          )}
        </div>
      </div>
      <div aria-live="polite" className="center small strong">{finished ? 'Your timer finished. Whatever you got done is progress.' : ''}</div>
      {finished ? (
        <div className="row" style={{ justifyContent: 'center' }}>
          <Button variant="soft" onClick={() => addTime(5)}>+5 more minutes</Button>
        </div>
      ) : (
        <div className="row" style={{ justifyContent: 'center', flexWrap: 'wrap' }}>
          <Button variant="soft" size="lg" icon={timer.status === 'paused' ? I.play : I.pause} onClick={pauseResume}>{timer.status === 'paused' ? 'Resume' : 'Pause'}</Button>
          <Button variant="ghost" onClick={() => addTime(5)}>+5 min</Button>
        </div>
      )}
      <p className="small muted center">You can close this window, since the timer keeps running at the bottom of the screen.</p>
    </Sheet>
  );
};

/** Floating mini-timer, visible app-wide while a timer exists and its sheet is closed. */
export const TimerBar = () => {
  const { timer, timerNow, sheets, openSheet, pauseResume } = useApp();
  if (!timer || sheets.some((s) => s.kind === 'timer')) return null;
  const left = remainingSec(timer, timerNow);
  const finished = timer.status === 'finished';
  return (
    <div className="timerbar" role="region" aria-label="Active timer">
      <button className="open" onClick={() => openSheet({ kind: 'timer' })} aria-label={`Open timer for ${timer.taskName}`}>
        <div className="xs" style={{ opacity: 0.85 }}>{finished ? 'Time is up. Tap to finish' : timer.status === 'paused' ? 'Paused' : 'Cleaning'} · {timer.roomName}</div>
        <div className="row" style={{ gap: 10 }}><span className="time">{finished ? 'Done' : formatClock(left)}</span><span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{timer.taskName}</span></div>
      </button>
      {!finished && <button className="icon-btn" onClick={pauseResume} aria-label={timer.status === 'paused' ? 'Resume timer' : 'Pause timer'}>{timer.status === 'paused' ? <I.play size={22} /> : <I.pause size={22} />}</button>}
    </div>
  );
};
