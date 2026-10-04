import { useMemo } from 'react';
import { deriveContext } from '../../domain/context';
import { roughDayTasks } from '../../domain/life';
import { entriesOn } from '../../domain/view';
import { useApp } from '../../state/store';
import { I } from '../../ui/icons';
import { Button, ProgressBar, Sheet } from '../../ui/primitives';
import { TaskCard } from '../tasks/TaskCard';

/** A short, forgiving reset for after a bad or unproductive day. */
export const RoughDaySheet = () => {
  const { data, today, closeSheet, complete, toast } = useApp();
  const tasks = useMemo(() => roughDayTasks(deriveContext(data.home, data.preferences)), [data.home, data.preferences]);
  const doneIds = new Set(entriesOn(data, today).filter((e) => e.outcome === 'completed').map((e) => e.taskId));
  const done = tasks.filter((t) => doneIds.has(t.id)).length;
  const finished = tasks.length > 0 && done === tasks.length;
  return (
    <Sheet title="Back on track" onClose={closeSheet} full label="Rough day reset"
      footer={<Button block onClick={() => { closeSheet(); toast(finished ? 'That was enough for today. Rest well.' : 'No pressure. Tomorrow is a fresh start.'); }}>{finished ? 'Finish' : "I'm done for now"}</Button>}>
      <div className="card tint stack">
        <div className="row"><I.heart size={22} aria-hidden style={{ color: 'var(--primary)' }} /><h3>Bad day? That happens.</h3></div>
        <p className="small">Nothing to catch up on. Here are a few tiny, gentle things. Do one, do all, or none. Tomorrow starts fresh either way.</p>
      </div>
      {tasks.length > 0 && <div className="stack"><div className="row between"><span className="strong">{done} of {tasks.length}</span><span className="small muted">about {tasks.reduce((s, t) => s + t.minutes, 0)} minutes</span></div><ProgressBar value={done / tasks.length} label="Reset progress" /></div>}
      <div className="tasklist">
        {tasks.map((t) => <TaskCard key={t.id} task={t} done={doneIds.has(t.id)} hideMenu hideTimer compact onComplete={() => complete(t, { via: 'plan', quiet: true })} />)}
      </div>
      {finished && <div className="five-card celebrate" role="status"><div className="big-ic" style={{ background: 'var(--sun)', color: 'var(--sun-ink)' }}><I.sparkles size={34} aria-hidden /></div><h2>That's enough for today.</h2><p className="muted">You showed up for yourself. That counts.</p></div>}
    </Sheet>
  );
};
