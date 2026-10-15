import { useState } from 'react';
import { uid } from '../../domain/appdata';
import { WEEKDAY_SHORT } from '../../domain/dates';
import { activityTaskId, describeSchedule } from '../../domain/modules/activities';
import { ACTIVITY_LABEL, activityModulesOn, isClock } from '../../domain/modules/registry';
import type { ActivityDefaults, ActivityKind, ActivityModule, PlannedActivity } from '../../domain/modules/types';
import type { Intensity } from '../../domain/types';
import { useApp } from '../../state/store';
import { I } from '../../ui/icons';
import { Button, Chip, Hint, Sheet } from '../../ui/primitives';
import { navigate } from '../../ui/router';

const KIND_LABEL: Record<ActivityKind, { label: string; hint: string }> = {
  fixed: { label: 'At a set time', hint: 'A class, a call or a routine with a clock time. Nothing moves it.' },
  flexible: { label: 'Some time that day', hint: 'Counts toward the day, whenever you get to it.' },
  optional: { label: 'Just an idea', hint: 'Kept in view. Never counted, never due, never an obligation.' },
};
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

export const ActivityFormSheet = ({ editId, defaults }: { editId?: string; defaults?: ActivityDefaults }) => {
  const { data, today, closeSheet, dispatch, toast } = useApp();
  const existing = data.activities.find((a) => a.id === editId);
  const modules = activityModulesOn(data.modules);
  // An activity can belong to a section that is off now (the person switched it off later), so editing it still works.
  const available: ActivityModule[] = existing && !modules.includes(existing.module) ? [existing.module, ...modules] : modules;
  const seed = existing ?? defaults;
  const [module, setModule] = useState<ActivityModule>(seed?.module && available.includes(seed.module) ? seed.module : (available[0] ?? 'movement'));
  const [name, setName] = useState(seed?.name ?? '');
  const [kind, setKind] = useState<ActivityKind>(seed?.kind ?? 'flexible');
  const [once, setOnce] = useState(seed?.schedule?.kind === 'once');
  const [weekdays, setWeekdays] = useState<number[]>(seed?.schedule?.kind === 'weekly' ? seed.schedule.weekdays : [1, 3, 5]);
  const [date, setDate] = useState(seed?.schedule?.kind === 'once' ? seed.schedule.date : today);
  const [time, setTime] = useState(seed?.time ?? '');
  const [minutes, setMinutes] = useState(String(seed?.minutes ?? 20));
  const [intensity, setIntensity] = useState<Intensity>(seed?.intensity ?? 'gentle');
  const [note, setNote] = useState(seed?.note ?? '');
  const [touched, setTouched] = useState(false);

  const mins = Number(minutes);
  const errors = {
    name: name.trim() ? '' : 'Give it a name.',
    minutes: Number.isFinite(mins) && mins >= 1 && mins <= 480 ? '' : 'Enter 1 to 480 minutes.',
    days: once || weekdays.length ? '' : 'Pick at least one day.',
    time: kind === 'fixed' && !isClock(time) ? 'A set time needs a time.' : time && !isClock(time) ? 'Enter a time like 18:30.' : '',
  };
  const valid = !errors.name && !errors.minutes && !errors.days && !errors.time;

  const save = () => {
    setTouched(true);
    if (!valid) return;
    const a: PlannedActivity = {
      id: existing?.id ?? uid('act'), module, kind, name: name.trim(), minutes: Math.round(mins),
      schedule: once ? { kind: 'once', date } : { kind: 'weekly', weekdays: [...weekdays].sort((x, y) => x - y) },
      time: isClock(time) ? time : null, startDate: existing?.startDate ?? (once ? date : today), endDate: existing?.endDate ?? null,
      ref: existing?.ref ?? defaults?.ref ?? null, intensity: module === 'movement' ? intensity : 'gentle',
      difficulty: existing?.difficulty ?? defaults?.difficulty ?? (intensity === 'vigorous' ? 3 : intensity === 'moderate' ? 2 : 1),
      note: note.trim(), createdAt: existing?.createdAt ?? new Date().toISOString(), archived: existing?.archived ?? false,
    };
    dispatch({ type: 'ACTIVITY_SAVE', activity: a, today });
    toast(existing ? 'Activity updated.' : `Planned: ${describeSchedule(a).toLowerCase()}.`, existing ? undefined : { label: 'Undo', run: () => dispatch({ type: 'ACTIVITY_DELETE', id: a.id }) });
    closeSheet();
  };

  if (!available.length) {
    return (
      <Sheet title="Plan an activity" onClose={closeSheet}>
        <p>Activities live in a section, such as Movement or Learning &amp; hobbies. None is switched on yet.</p>
        <Button icon={I.settings} onClick={() => { closeSheet(); navigate('settings'); }}>Choose sections in Settings</Button>
      </Sheet>
    );
  }

  return (
    <Sheet title={existing ? 'Edit activity' : 'Plan an activity'} onClose={closeSheet}
      footer={<><Button variant="secondary" onClick={closeSheet}>Cancel</Button><Button icon={I.check} onClick={save}>{existing ? 'Save' : 'Add to my plan'}</Button></>}>
      <div className="field">
        <label htmlFor="a-name">What are you planning?</label>
        <input id="a-name" className="input" data-autofocus value={name} maxLength={80} placeholder="e.g. Evening walk, Guitar practice, Sunday meal prep" onChange={(e) => setName(e.target.value)} aria-invalid={touched && !!errors.name} />
        {touched && errors.name && <span className="small" style={{ color: 'var(--clay-ink)' }} role="alert">{errors.name}</span>}
      </div>
      {available.length > 1 && (
        <div className="field">
          <span className="label" id="a-sec">Section</span>
          <div className="chips" role="radiogroup" aria-labelledby="a-sec">{available.map((m) => <Chip key={m} role="radio" on={module === m} onClick={() => setModule(m)}>{ACTIVITY_LABEL[m]}</Chip>)}</div>
        </div>
      )}
      <div className="field">
        <span className="label" id="a-kind">How firm is it?</span>
        <div className="chips" role="radiogroup" aria-labelledby="a-kind">{(Object.keys(KIND_LABEL) as ActivityKind[]).map((k) => <Chip key={k} role="radio" on={kind === k} onClick={() => setKind(k)}>{KIND_LABEL[k].label}</Chip>)}</div>
        <span className="small muted">{KIND_LABEL[kind].hint}</span>
      </div>
      <div className="field">
        <span className="label" id="a-when">When?</span>
        <div className="chips" role="radiogroup" aria-labelledby="a-when">
          <Chip role="radio" on={!once} onClick={() => setOnce(false)}>Repeating</Chip>
          <Chip role="radio" on={once} onClick={() => setOnce(true)}>One day</Chip>
        </div>
        {once ? (
          <input className="input" type="date" aria-label="Date" value={date} min={today} onChange={(e) => setDate(e.target.value)} style={{ maxWidth: 220 }} />
        ) : (
          <div className="chips" role="group" aria-label="Days of the week">
            {WEEK_ORDER.map((d) => <Chip small key={d} on={weekdays.includes(d)} onClick={() => setWeekdays((w) => (w.includes(d) ? w.filter((x) => x !== d) : [...w, d]))} aria-label={WEEKDAY_SHORT[d]}>{WEEKDAY_SHORT[d]}</Chip>)}
          </div>
        )}
        {touched && errors.days && <span className="small" style={{ color: 'var(--clay-ink)' }} role="alert">{errors.days}</span>}
      </div>
      <div className="field">
        <label htmlFor="a-time">{kind === 'fixed' ? 'Time' : 'Time (optional)'}</label>
        <input id="a-time" className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} style={{ maxWidth: 160 }} aria-invalid={touched && !!errors.time} />
        {touched && errors.time && <span className="small" style={{ color: 'var(--clay-ink)' }} role="alert">{errors.time}</span>}
      </div>
      <div className="field">
        <label htmlFor="a-min">How long (minutes)?</label>
        <div className="chips" style={{ marginBottom: 6 }}>{[5, 10, 15, 20, 30, 45, 60].map((m) => <Chip small key={m} on={mins === m} onClick={() => setMinutes(String(m))}>{m}</Chip>)}</div>
        <input id="a-min" className="input" type="number" min={1} max={480} inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} style={{ maxWidth: 140 }} aria-invalid={touched && !!errors.minutes} />
        {touched && errors.minutes && <span className="small" style={{ color: 'var(--clay-ink)' }} role="alert">{errors.minutes}</span>}
      </div>
      {module === 'movement' && (
        <div className="field">
          <span className="label" id="a-int">How hard does it feel?</span>
          <div className="chips" role="radiogroup" aria-labelledby="a-int">{(['gentle', 'moderate', 'vigorous'] as const).map((i) => <Chip key={i} role="radio" on={intensity === i} onClick={() => setIntensity(i)} style={{ textTransform: 'capitalize' }}>{i}</Chip>)}</div>
          {intensity === 'vigorous' && <Hint icon={I.shield}>On a day you say your energy is low, a vigorous activity is left out of Today. You can still choose to do it from its own page.</Hint>}
        </div>
      )}
      <div className="field">
        <label htmlFor="a-note">Notes (optional)</label>
        <textarea id="a-note" className="textarea" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="Anything you want to remember" />
      </div>
      {existing && (
        <div className="row wrap" style={{ gap: 8 }}>
          <Button variant="ghost" size="sm" icon={I.archive} onClick={() => { dispatch({ type: 'ACTIVITY_ARCHIVE', id: existing.id, archived: !existing.archived }); toast(existing.archived ? 'Back in your plan.' : 'Taken out of your plan. Its history stays.'); closeSheet(); }}>{existing.archived ? 'Put back in my plan' : 'Take out of my plan'}</Button>
          <Button variant="ghost" size="sm" icon={I.trash} onClick={() => { const state = data.taskStates[activityTaskId(existing.id)] ?? null; dispatch({ type: 'ACTIVITY_DELETE', id: existing.id }); toast('Activity deleted. Your history is kept.', { label: 'Undo', run: () => dispatch({ type: 'ACTIVITY_RESTORE', activity: existing, state }) }); closeSheet(); }}>Delete</Button>
        </div>
      )}
    </Sheet>
  );
};
