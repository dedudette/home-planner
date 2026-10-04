import { useState } from 'react';
import { uid } from '../../domain/appdata';
import { FREQ_LABEL } from '../../domain/schedule';
import type { CustomTask, Frequency, Priority } from '../../domain/types';
import { useApp } from '../../state/store';
import { I } from '../../ui/icons';
import { Button, Chip, Sheet } from '../../ui/primitives';

const FREQS: Frequency[] = ['once', 'daily', 'twice-weekly', 'weekly', 'biweekly', 'monthly', 'seasonal'];
const PRIOS: Priority[] = ['URGENT', 'HIGH', 'MEDIUM', 'LOW'];
const PRIO_LABEL: Record<Priority, string> = { URGENT: 'Urgent', HIGH: 'High', MEDIUM: 'Medium', LOW: 'Low' };

export const TaskFormSheet = ({ editId }: { editId?: string }) => {
  const { data, plan, today, closeSheet, dispatch, toast } = useApp();
  const existing = data.customTasks.find((c) => c.id === editId);
  const [name, setName] = useState(existing?.name ?? '');
  const [roomId, setRoomId] = useState(existing?.roomId ?? 'other');
  const [frequency, setFrequency] = useState<Frequency>(existing?.frequency ?? 'once');
  const [minutes, setMinutes] = useState(String(existing?.minutes ?? 10));
  const [priority, setPriority] = useState<Priority>(existing?.priority ?? 'MEDIUM');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [startDate, setStartDate] = useState(existing?.startDate ?? today);
  const [touched, setTouched] = useState(false);

  const mins = Number(minutes);
  const errors = {
    name: name.trim() ? '' : 'Give the task a name.',
    minutes: Number.isFinite(mins) && mins >= 1 && mins <= 480 ? '' : 'Enter 1 to 480 minutes.',
  };
  const valid = !errors.name && !errors.minutes;
  const save = () => {
    setTouched(true);
    if (!valid) return;
    const t: CustomTask = {
      id: existing?.id ?? uid('c'), name: name.trim(), roomId, frequency, minutes: Math.round(mins), priority, notes: notes.trim(),
      startDate: startDate || today, createdAt: existing?.createdAt ?? today,
    };
    dispatch({ type: 'CUSTOM_SAVE', task: t });
    toast(existing ? 'Task updated.' : frequency === 'once' ? 'Task added.' : `Task added. It repeats ${FREQ_LABEL[frequency].toLowerCase()}.`);
    closeSheet();
  };
  return (
    <Sheet title={existing ? 'Edit task' : 'Add your own task'} onClose={closeSheet}
      footer={<><Button variant="secondary" onClick={closeSheet}>Cancel</Button><Button icon={I.check} onClick={save}>{existing ? 'Save' : 'Add task'}</Button></>}>
      <div className="field">
        <label htmlFor="t-name">Task name</label>
        <input id="t-name" className="input" data-autofocus value={name} maxLength={80} placeholder="e.g. Water the plants" onChange={(e) => setName(e.target.value)} aria-invalid={touched && !!errors.name} />
        {touched && errors.name && <span className="small" style={{ color: 'var(--clay-ink)' }} role="alert">{errors.name}</span>}
      </div>
      <div className="field">
        <label htmlFor="t-room">Room</label>
        <select id="t-room" className="select" value={roomId} onChange={(e) => setRoomId(e.target.value)}>
          {plan.rooms.filter((r) => !r.virtual).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          <option value="other">Other / whole home</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor="t-freq">How often?</label>
        <select id="t-freq" className="select" value={frequency} onChange={(e) => setFrequency(e.target.value as Frequency)}>
          {FREQS.map((f) => <option key={f} value={f}>{f === 'once' ? 'One time only' : FREQ_LABEL[f]}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="t-start">{frequency === 'once' ? 'When?' : 'Starting'}</label>
        <input id="t-start" className="input" type="date" value={startDate} min={today} onChange={(e) => setStartDate(e.target.value)} style={{ maxWidth: 220 }} />
      </div>
      <div className="field">
        <label htmlFor="t-min">Estimated time (minutes)</label>
        <div className="chips" style={{ marginBottom: 6 }}>{[5, 10, 15, 30, 60].map((m) => <Chip small key={m} on={mins === m} onClick={() => setMinutes(String(m))}>{m}</Chip>)}</div>
        <input id="t-min" className="input" type="number" min={1} max={480} inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} style={{ maxWidth: 140 }} aria-invalid={touched && !!errors.minutes} />
        {touched && errors.minutes && <span className="small" style={{ color: 'var(--clay-ink)' }} role="alert">{errors.minutes}</span>}
      </div>
      <div className="field">
        <span className="label">Priority</span>
        <div className="chips" role="radiogroup" aria-label="Priority">{PRIOS.map((p) => <Chip key={p} role="radio" on={priority === p} onClick={() => setPriority(p)}>{PRIO_LABEL[p]}</Chip>)}</div>
      </div>
      <div className="field">
        <label htmlFor="t-notes">Notes (optional)</label>
        <textarea id="t-notes" className="textarea" value={notes} maxLength={300} onChange={(e) => setNotes(e.target.value)} placeholder="Anything you want to remember" />
      </div>
    </Sheet>
  );
};
