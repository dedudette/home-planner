import { useEffect, useRef, useState } from 'react';
import { FREQ_LABEL } from '../../domain/schedule';
import type { Task } from '../../domain/types';
import { useApp } from '../../state/store';
import { DOMAIN_ICON, I, ROOM_ICON, TIME_ICON } from '../../ui/icons';
import { isLife } from '../../domain/scoring';
import { TIME_LABEL } from '../../domain/options';
import { Button, Dots, PriorityTag, cx } from '../../ui/primitives';

export const DIFF_LABEL = ['', 'Easy', 'Medium', 'Hard'];

export const TaskMenu = ({ task, onClose }: { task: Task; onClose: () => void }) => {
  const { openSheet, skip, snooze, moveTo, today } = useApp();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    ref.current?.querySelector<HTMLElement>('button')?.focus();
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, [onClose]);
  const tomorrow = new Date(`${today}T12:00:00`);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tISO = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
  const act = (fn: () => void) => () => { onClose(); fn(); };
  return (
    <div className="menu-pop" role="menu" ref={ref}>
      <button role="menuitem" onClick={act(() => openSheet({ kind: 'task', id: task.id, task }))}><I.list size={18} /> Details &amp; steps</button>
      <button role="menuitem" onClick={act(() => skip(task))}><I.skip size={18} /> Skip this time</button>
      <button role="menuitem" onClick={act(() => snooze(task))}><I.alarm size={18} /> Snooze 2 days</button>
      <button role="menuitem" onClick={act(() => moveTo(task, tISO, 'Moved to tomorrow.'))}><I.cal size={18} /> Move to tomorrow</button>
      <button role="menuitem" onClick={act(() => openSheet({ kind: 'reschedule', task }))}><I.calDays size={18} /> Pick another day…</button>
    </div>
  );
};

interface Props {
  task: Task;
  done?: boolean;
  overdue?: boolean;
  dueLabel?: string;
  hideTimer?: boolean;
  hideMenu?: boolean;
  compact?: boolean;
  note?: string;
  onComplete?: () => void;
  via?: 'checkoff' | 'timebox' | 'reset' | 'five';
}

export const TaskCard = ({ task, done, overdue, dueLabel, hideTimer, hideMenu, compact, note, onComplete, via }: Props) => {
  const { complete, openSheet, plan } = useApp();
  const [menu, setMenu] = useState(false);
  const life = isLife(task);
  const RoomIcon = life ? DOMAIN_ICON[task.domain!] : ROOM_ICON[task.roomKind];
  const TodIcon = TIME_ICON[task.timeOfDay ?? 'anytime'];
  const toggle = () => { if (done) return; if (onComplete) onComplete(); else complete(task, { via: via ?? 'checkoff' }); };
  return (
    <article className={cx('task', done && 'done')} aria-label={task.name}>
      <button className={cx('check', done && 'on')} aria-label={done ? `${task.name} completed` : `Mark ${task.name} complete`} aria-pressed={!!done} onClick={toggle} disabled={done}>
        <I.check size={22} strokeWidth={3} aria-hidden />
      </button>
      <button className="task-body" onClick={() => openSheet({ kind: 'task', id: task.id, task })}>
        <div className="task-name">{task.name}</div>
        <div className="task-meta">
          <span className="m"><RoomIcon size={14} aria-hidden /> {task.roomName}</span>
          <span className="m"><I.clock size={14} aria-hidden /> {task.minutes} min</span>
          {!compact && <span className="m" title={`Difficulty: ${DIFF_LABEL[task.difficulty]}`}><Dots n={task.difficulty} /> <span className="sr-only">Difficulty {DIFF_LABEL[task.difficulty]}</span>{DIFF_LABEL[task.difficulty]}</span>}
          <span className="m"><I.repeat size={14} aria-hidden /> {task.habit && task.frequency === 'daily' ? 'Daily habit' : FREQ_LABEL[task.frequency]}</span>
          {dueLabel && <span className="m"><I.cal size={14} aria-hidden /> {dueLabel}</span>}
          {life && task.timeOfDay && task.timeOfDay !== 'anytime' && <span className="m"><TodIcon size={14} aria-hidden /> {TIME_LABEL[task.timeOfDay]}</span>}
        </div>
        <div className="row wrap" style={{ marginTop: 8, gap: 6 }}>
          <PriorityTag p={task.priority} />
          {overdue && <span className="tag lav">Whenever you're ready</span>}
          {task.challenge && <span className="tag lav">Challenge</span>}
          {life && task.intensity && task.domain === 'fitness' && <span className="tag">{task.intensity === 'gentle' ? 'Gentle' : task.intensity === 'moderate' ? 'Moderate' : 'Vigorous'}{task.lowImpact ? ' · low impact' : ''}</span>}
          {task.part && <span className="tag green">Part {task.part.index} of {task.part.of}</span>}
          {plan.microSteps && (task.tinySteps.length || task.substeps.length) > 1 && !compact && <span className="tag green">{(task.tinySteps.length || task.substeps.length)} tiny step{(task.tinySteps.length || task.substeps.length) === 1 ? '' : 's'}</span>}
        </div>
        {note && <p className="small muted" style={{ marginTop: 8 }}>{note}</p>}
      </button>
      <div className="task-actions">
        {!hideMenu && (
          <div className="menu">
            <button className="icon-btn" aria-label={`More options for ${task.name}`} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}><I.more size={22} aria-hidden /></button>
            {menu && <TaskMenu task={task} onClose={() => setMenu(false)} />}
          </div>
        )}
      </div>
      {!hideTimer && !done && (
        <div style={{ gridColumn: '2 / 4' }}>
          <Button size="sm" variant="soft" icon={I.timer} onClick={() => openSheet({ kind: 'timerPick', task })}>Start timer</Button>
        </div>
      )}
    </article>
  );
};
