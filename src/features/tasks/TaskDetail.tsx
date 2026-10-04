import { useMemo, useState } from 'react';
import { addDays, formatDay, startOfWeek } from '../../domain/dates';
import { dueInfo, FREQ_LABEL } from '../../domain/schedule';
import { coveredNeeds, NEED_LABEL } from '../../domain/supplies';
import type { Task } from '../../domain/types';
import { useApp } from '../../state/store';
import { I, ROOM_ICON } from '../../ui/icons';
import { Button, Dots, PriorityTag, ProgressBar, Sheet, Tag } from '../../ui/primitives';
import { lowerFrequency } from '../../domain/learning';
import { DIFF_LABEL } from './TaskCard';

const Steps = ({ task, micro }: { task: Task; micro: boolean }) => {
  const steps = micro && task.tinySteps.length ? task.tinySteps : task.substeps;
  const [done, setDone] = useState<boolean[]>(() => steps.map(() => false));
  const [list, setList] = useState(!micro);
  if (!steps.length) return null;
  const idx = done.findIndex((d) => !d);
  const n = done.filter(Boolean).length;
  if (!list) {
    return (
      <div className="card tint stack" aria-label="Step by step">
        <div className="row between"><span className="small strong">One step at a time</span><button className="btn ghost sm" onClick={() => setList(true)}>Show full list</button></div>
        <ProgressBar value={n / steps.length} label="Steps done" />
        {idx === -1 ? (
          <div className="center stack"><I.sparkles size={30} style={{ color: 'var(--primary)', margin: '0 auto' }} aria-hidden /><p className="strong">Every step is done. Nice work.</p></div>
        ) : (
          <>
            <p className="xs muted">Step {idx + 1} of {steps.length}</p>
            <p style={{ fontFamily: 'var(--font-head)', fontSize: '1.35rem', lineHeight: 1.3 }}>{steps[idx]}</p>
            <div className="row">
              {idx > 0 && <Button variant="secondary" size="sm" onClick={() => setDone(done.map((d, i) => (i === idx - 1 ? false : d)))}>Back</Button>}
              <Button className="grow" onClick={() => setDone(done.map((d, i) => (i === idx ? true : d)))}>Done, next step</Button>
            </div>
          </>
        )}
      </div>
    );
  }
  return (
    <div className="stack" aria-label="Steps">
      <div className="row between">
        <h3>Steps <span className="small muted" style={{ fontFamily: 'var(--font-body)', fontWeight: 400 }}>({n}/{steps.length})</span></h3>
        {micro && <button className="btn ghost sm" onClick={() => setList(false)}>One at a time</button>}
      </div>
      {steps.map((s, i) => (
        <label key={i} className={`step ${done[i] ? 'done' : i === idx ? 'focus' : ''}`}>
          <input type="checkbox" checked={done[i]} onChange={() => setDone(done.map((d, j) => (j === i ? !d : d)))} style={{ width: 20, height: 20, accentColor: 'var(--primary)' }} />
          <span className="t">{s}</span>
        </label>
      ))}
    </div>
  );
};

export const TaskDetailSheet = ({ id, fallback }: { id: string; fallback?: Task }) => {
  const { view, data, plan, today, closeSheet, openSheet, complete, skip, snooze, moveTo, dispatch, toast } = useApp();
  const task = view.byId.get(id) ?? fallback;
  const supplies = useMemo(() => coveredNeeds(data.supplies), [data.supplies]);
  if (!task) return <Sheet title="Task" onClose={closeSheet}><p>This task is no longer in your plan.</p></Sheet>;
  const st = data.taskStates[task.id];
  const info = dueInfo(task, st, today);
  const RoomIcon = ROOM_ICON[task.roomKind];
  const ephemeral = task.id.startsWith('five:');
  const lower = lowerFrequency(task.frequency);
  const missing = task.needs.filter((n) => !supplies.has(n));
  const alreadyDone = !!st?.done;
  const tomorrow = addDays(today, 1);

  return (
    <Sheet title={task.name} onClose={closeSheet} label={`Task: ${task.name}`}
      footer={ephemeral ? undefined : (
        <>
          <Button variant="soft" icon={I.timer} onClick={() => openSheet({ kind: 'timerPick', task })}>Start timer</Button>
          <Button icon={I.check} disabled={alreadyDone} onClick={() => { complete(task); closeSheet(); }}>{alreadyDone ? 'Done' : 'Mark complete'}</Button>
        </>
      )}>
      <div className="row wrap" style={{ gap: 8 }}>
        <PriorityTag p={task.priority} />
        <Tag><RoomIcon size={12} aria-hidden /> {task.roomName}</Tag>
        <Tag>{task.category}</Tag>
        {task.tier === 'deep' && <Tag kind="lav">Deep clean</Tag>}
        {task.tier === 'reset' && <Tag kind="green">Reset step</Tag>}
        {task.backlog && <Tag>Backlog</Tag>}
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
        <div className="stat"><div className="v">{task.minutes}<span className="small muted"> min</span></div><div className="l">Estimated time</div></div>
        <div className="stat"><div className="v" style={{ fontSize: '1.3rem' }}><Dots n={task.difficulty} /> {DIFF_LABEL[task.difficulty]}</div><div className="l">Difficulty</div></div>
        <div className="stat"><div className="v" style={{ fontSize: '1.3rem' }}>{task.habit && task.frequency === 'daily' ? 'Daily habit' : FREQ_LABEL[task.frequency]}</div><div className="l">Frequency</div></div>
        <div className="stat"><div className="v" style={{ fontSize: '1.3rem' }}>{alreadyDone ? 'Done' : info.due ? formatDay(info.due, today) : 'Not scheduled'}</div><div className="l">{info.overdue ? 'Was due (no rush)' : 'Next up'}</div></div>
      </div>

      <div className="card soft">
        <div className="row" style={{ gap: 8, marginBottom: 4 }}><I.info size={18} aria-hidden style={{ color: 'var(--primary)' }} /><h3>Why this task</h3></div>
        <p className="small">{task.reason}</p>
      </div>

      {task.notes && <div className="card soft"><h3>Your notes</h3><p className="small" style={{ marginTop: 4 }}>{task.notes}</p></div>}

      <Steps key={`${task.id}-${plan.microSteps}`} task={task} micro={plan.microSteps} />

      {task.needs.length > 0 && (
        <div className="stack">
          <h3>You'll need</h3>
          <div className="chips">
            {task.needs.map((n) => (
              <span key={n} className={`tag ${supplies.has(n) ? 'green' : ''}`}>{supplies.has(n) ? '✓ ' : ''}{NEED_LABEL[n]}</span>
            ))}
          </div>
          {data.supplies.length > 0 && missing.length > 0 && <p className="small muted">Not in your supplies yet: {missing.map((n) => NEED_LABEL[n]).join(', ')}. See Supplies for safe alternatives.</p>}
        </div>
      )}

      {!ephemeral && (
        <div className="stack">
          <h3>Not feeling it?</h3>
          <div className="row wrap" style={{ gap: 8 }}>
            <Button variant="secondary" size="sm" icon={I.skip} onClick={() => { skip(task); closeSheet(); }}>Skip</Button>
            <Button variant="secondary" size="sm" icon={I.alarm} onClick={() => { snooze(task); closeSheet(); }}>Snooze</Button>
            <Button variant="secondary" size="sm" icon={I.cal} onClick={() => { moveTo(task, tomorrow, 'Moved to tomorrow.'); closeSheet(); }}>Tomorrow</Button>
            <Button variant="secondary" size="sm" icon={I.calDays} onClick={() => openSheet({ kind: 'reschedule', task })}>Pick a day</Button>
          </div>
          <div className="row wrap" style={{ gap: 8 }}>
            {task.custom ? (
              <>
                <Button variant="ghost" size="sm" icon={I.pencil} onClick={() => openSheet({ kind: 'taskForm', editId: task.id })}>Edit task</Button>
                <Button variant="ghost" size="sm" icon={I.trash} onClick={() => { dispatch({ type: 'CUSTOM_DELETE', id: task.id }); closeSheet(); toast('Task deleted.'); }}>Delete</Button>
              </>
            ) : (
              <>
                {!st?.override?.smaller && task.minutes > 2 && <Button variant="ghost" size="sm" onClick={() => { dispatch({ type: 'TASK_OVERRIDE', id: task.id, override: { smaller: true } }); toast('Made smaller. Half the time, tiny steps.'); }}>Make it smaller</Button>}
                {st?.override && <Button variant="ghost" size="sm" icon={I.undo} onClick={() => { dispatch({ type: 'TASK_OVERRIDE', id: task.id, override: null }); toast('Back to the original.'); }}>Restore original</Button>}
                {lower && task.cadence.kind !== 'once' && <Button variant="ghost" size="sm" onClick={() => { dispatch({ type: 'TASK_OVERRIDE', id: task.id, override: { frequency: lower } }); toast(`Now ${FREQ_LABEL[lower].toLowerCase()}.`); }}>Do it less often</Button>}
                <Button variant="ghost" size="sm" icon={I.trash} onClick={() => { dispatch({ type: 'TASK_PATCH', id: task.id, patch: { hidden: true } }); closeSheet(); toast('Removed from your plan. Restore it in Settings.'); }}>Remove from plan</Button>
              </>
            )}
          </div>
        </div>
      )}
    </Sheet>
  );
};

export const RescheduleSheet = ({ task }: { task: Task }) => {
  const { closeSheet, closeAllSheets, moveTo, today } = useApp();
  const [date, setDate] = useState(addDays(today, 3));
  const sat = addDays(startOfWeek(today), 5);
  const weekend = sat > today ? sat : addDays(sat, 7);
  const nextMon = addDays(startOfWeek(today), 7);
  const go = (d: string, label: string) => { moveTo(task, d, label); closeAllSheets(); };
  return (
    <Sheet title="Move this to…" onClose={closeSheet}>
      <p className="strong">{task.name}</p>
      <div className="stack">
        <Button variant="secondary" block icon={I.cal} onClick={() => go(addDays(today, 1), 'Moved to tomorrow.')}>Tomorrow</Button>
        <Button variant="secondary" block icon={I.sun} onClick={() => go(weekend, `Moved to ${formatDay(weekend, today)}.`)}>This weekend ({formatDay(weekend, today)})</Button>
        <Button variant="secondary" block icon={I.right} onClick={() => go(nextMon, `Moved to ${formatDay(nextMon, today)}.`)}>Next week ({formatDay(nextMon, today)})</Button>
      </div>
      <div className="field">
        <label htmlFor="pick-date">Or pick a date</label>
        <div className="row">
          <input id="pick-date" className="input" type="date" min={addDays(today, 1)} value={date} onChange={(e) => setDate(e.target.value)} />
          <Button disabled={!date || date <= today} onClick={() => go(date, `Moved to ${formatDay(date, today)}.`)}>Move</Button>
        </div>
      </div>
    </Sheet>
  );
};
