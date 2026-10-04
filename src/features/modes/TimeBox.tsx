import { useMemo, useState } from 'react';
import { TIME_OPTIONS, timeBox, timeOptionLabel } from '../../domain/modes';
import type { Task } from '../../domain/types';
import { entriesOn } from '../../domain/view';
import { useApp } from '../../state/store';
import { I } from '../../ui/icons';
import { Button, Empty, ProgressBar, Sheet } from '../../ui/primitives';
import { TaskCard } from '../tasks/TaskCard';

export const TimeBoxSheet = () => {
  const { view, closeSheet, openSheet, data, today } = useApp();
  const [sel, setSel] = useState<{ minutes: number; ids: string[]; total: number; fits: boolean } | null>(null);
  const tasks: Task[] = useMemo(() => (sel ? sel.ids.map((id) => view.byId.get(id)).filter((t): t is Task => !!t) : []), [sel, view]);
  const doneIds = new Set(entriesOn(data, today).filter((e) => e.outcome === 'completed').map((e) => e.taskId));
  const doneCount = tasks.filter((t) => doneIds.has(t.id)).length;
  const doneMinutes = tasks.filter((t) => doneIds.has(t.id)).reduce((s, t) => s + t.minutes, 0);

  const choose = (m: number) => {
    const r = timeBox(view, m);
    setSel({ minutes: m, ids: r.tasks.map((t) => t.id), total: r.total, fits: r.everythingFits });
  };

  if (!sel) {
    return (
      <Sheet title="I only have…" onClose={closeSheet} full>
        <p className="muted">Tell us how much time you've got. We'll pick the tasks that make the biggest difference, and never more than fit.</p>
        <div className="time-grid" role="group" aria-label="Available time">
          {TIME_OPTIONS.map((m) => (
            <button key={m} className="time-btn" aria-pressed={false} onClick={() => choose(m)}>
              {m >= 120 ? '2+' : m >= 60 ? (m === 60 ? '1' : '1.5') : m}
              <span className="xs muted" style={{ fontWeight: 500 }}>{m >= 60 ? 'hours' : 'minutes'}</span>
            </button>
          ))}
        </div>
      </Sheet>
    );
  }
  return (
    <Sheet title={`${timeOptionLabel(sel.minutes)[0].toUpperCase()}${timeOptionLabel(sel.minutes).slice(1)}`} onClose={closeSheet} full label="Your time-boxed plan"
      footer={<><Button variant="secondary" onClick={() => setSel(null)}>Change time</Button><Button variant="soft" icon={I.timer} disabled={!tasks.length} onClick={() => { const first = tasks.find((t) => !doneIds.has(t.id)); if (first) openSheet({ kind: 'timerPick', task: first }); }}>Start first task</Button></>}>
      <div className="card tint stack">
        <div className="row between"><span className="strong">{tasks.length} task{tasks.length === 1 ? '' : 's'} · {sel.total} of {sel.minutes >= 120 ? '120+' : sel.minutes} minutes</span><span className="small muted">{doneCount}/{tasks.length} done</span></div>
        <ProgressBar value={sel.total ? doneMinutes / sel.total : 0} label="Time-boxed progress" />
        <p className="small muted">{sel.minutes - sel.total > 1 ? `About ${sel.minutes - sel.total} minutes spare, so go slowly or take a break.` : 'A snug fit. Enjoy.'}{sel.fits ? " That's everything worth doing right now." : ''}</p>
      </div>
      {tasks.length === 0 ? (
        <Empty title="Nothing needs doing right now">Everything that matters is already done. Enjoy the free time.</Empty>
      ) : (
        <div className="tasklist">
          {tasks.map((t) => <TaskCard key={t.id} task={t} compact done={doneIds.has(t.id)} via="timebox" />)}
        </div>
      )}
    </Sheet>
  );
};
