import { useState } from 'react';
import {
  WEEKDAY_SHORT, addDays, formatDay, formatLong, formatMinutes, fromISO, startOfMonth, startOfWeek, weekday,
} from '../../domain/dates';
import { needsFreshStart } from '../../domain/learning';
import { dayPlan, monthPlan, overdueItems, weekPlan, type DayPlan } from '../../domain/view';
import type { ISODate } from '../../domain/types';
import { useApp } from '../../state/store';
import { I } from '../../ui/icons';
import { Button, Empty, PageHead, Segmented } from '../../ui/primitives';
import { TaskCard } from '../tasks/TaskCard';

type Range = 'today' | 'tomorrow' | 'week' | 'next' | 'month';

const DayList = ({ day, showHeader }: { day: DayPlan; showHeader?: boolean }) => {
  const { today, plan } = useApp();
  const rest = !plan.activeDays.includes(weekday(day.date)) && day.tasks.every((t) => !t.habit);
  return (
    <div className={`daycard ${day.date === today ? 'today' : ''}`}>
      {showHeader && (
        <div className="row between" style={{ marginBottom: 8 }}>
          <div><h2 className="h3">{formatDay(day.date, today)}</h2></div>
          <span className="small muted">{day.tasks.length ? `${day.tasks.length} · ${formatMinutes(day.minutes)}${day.budget ? ` of ${day.budget} min` : ''}` : rest ? 'Rest day' : 'Free'}</span>
        </div>
      )}
      {!showHeader && day.tasks.length > 0 && day.budget > 0 && <p className="small muted" data-testid="day-total">{formatMinutes(day.minutes)} planned, out of your {day.budget} min</p>}
      {day.tasks.length === 0 && day.done.length === 0 && <p className="small muted">{rest ? 'A rest day, with nothing planned.' : 'Nothing planned.'}</p>}
      <div className="tasklist">
        {day.tasks.map((t) => <TaskCard key={t.id} task={t} compact hideTimer={day.date !== today} />)}
      </div>
      {day.overBy > 0 && <p className="small" style={{ marginTop: 8 }} role="status">{day.overBy} min over the {day.budget}-minute goal, because of urgent tasks you added.</p>}
      {day.deferred.some((d) => d.reason === 'time') && (
        <p className="small muted" style={{ marginTop: 8 }} data-testid="left-out">
          Left out to keep to your {day.budget} minutes: {day.deferred.filter((d) => d.reason === 'time').slice(0, 3).map((d) => d.task.name).join(', ')}
          {day.deferred.filter((d) => d.reason === 'time').length > 3 ? ` and ${day.deferred.filter((d) => d.reason === 'time').length - 3} more` : ''}. They stay due.
        </p>
      )}
      {day.done.length > 0 && <p className="small muted" style={{ marginTop: 8 }}>✓ {day.done.length} done · {formatMinutes(day.done.reduce((s, e) => s + e.actualMinutes, 0))}</p>}
    </div>
  );
};

const Month = () => {
  const { view, today } = useApp();
  const [sel, setSel] = useState<ISODate>(today);
  const [anchor, setAnchor] = useState<ISODate>(startOfMonth(today));
  const m = monthPlan(view, anchor);
  const lead = (weekday(m.start) + 6) % 7;
  const max = Math.max(1, view.plan.sessionMinutes, ...m.days.map((d) => d.minutes));
  const selected = m.days.find((d) => d.date === sel) ?? dayPlan(view, sel);
  const label = fromISO(anchor).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const shift = (n: number) => { const d = fromISO(anchor); d.setMonth(d.getMonth() + n); const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; setAnchor(iso); setSel(iso); };
  return (
    <div className="stack">
      <div className="row between">
        <button className="icon-btn" aria-label="Previous month" onClick={() => shift(-1)}><I.left size={22} /></button>
        <h2>{label}</h2>
        <button className="icon-btn" aria-label="Next month" onClick={() => shift(1)}><I.right size={22} /></button>
      </div>
      <div className="month" role="grid" aria-label={label}>
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <div key={i} className="dow" role="columnheader">{d}</div>)}
        {Array.from({ length: lead }, (_, i) => <div key={`l${i}`} className="mday out" />)}
        {m.days.map((d) => (
          <button key={d.date} className={`mday ${d.date === today ? 'today' : ''} ${d.date === sel ? 'sel' : ''}`} onClick={() => setSel(d.date)}
            aria-label={`${formatLong(d.date)}: ${d.tasks.length} tasks, ${d.minutes} minutes`} aria-pressed={d.date === sel}>
            <span>{Number(d.date.slice(8))}</span>
            {d.minutes > 0 ? <span className="bar" style={{ width: `${Math.max(20, (d.minutes / max) * 80)}%` }} /> : <span style={{ height: 5 }} />}
            <span className="n">{d.tasks.length || ''}</span>
          </button>
        ))}
      </div>
      <h2 className="h3">{formatLong(sel)}</h2>
      <DayList day={selected} />
    </div>
  );
};

export const Schedule = () => {
  const { view, today, data, dispatch, stamp, toast } = useApp();
  const [range, setRange] = useState<Range>('today');
  const fresh = needsFreshStart(view);
  const overdue = overdueItems(view);
  const weekStart = startOfWeek(today);

  const doReset = () => {
    const prev = data;
    const before = Object.fromEntries(Object.entries(prev.taskStates).map(([id, s]) => [id, { anchor: s.anchor, due: s.due, skipStreak: s.skipStreak }]));
    dispatch({ type: 'RESET_PLAN', stamp: stamp() });
    // Undo restores only what the reset changed, so anything done in the meantime stays done.
    toast('Fresh start. Your plan now begins today.', { label: 'Undo', run: () => dispatch({ type: 'UNDO_RESET_PLAN', plan: prev.plan, lastOpened: prev.lastOpened, before }) });
  };

  return (
    <div className="page">
      <PageHead title="Schedule" sub="Move things around freely. Nothing here is a deadline." />
      <Segmented<Range> label="Schedule range" value={range} onChange={setRange}
        options={[{ value: 'today', label: 'Today' }, { value: 'tomorrow', label: 'Tomorrow' }, { value: 'week', label: 'This week' }, { value: 'next', label: 'Next week' }, { value: 'month', label: 'This month' }]} />

      {range === 'today' && (
        <>
          <DayList day={dayPlan(view, today)} />
          {overdue.length > 0 && (
            <section className="stack">
              <div className="section-title"><h2>Whenever you're ready</h2><span className="small muted">{overdue.length}</span></div>
              <p className="small muted">These slipped past their day. They're optional now, and most will roll to their next slot by themselves.</p>
              <div className="tasklist">{overdue.slice(0, 6).map((o) => <TaskCard key={o.task.id} task={o.task} compact overdue dueLabel={`was ${formatDay(o.due, today)}`} />)}</div>
            </section>
          )}
        </>
      )}
      {range === 'tomorrow' && <DayList day={dayPlan(view, addDays(today, 1))} />}
      {(range === 'week' || range === 'next') && (
        <div className="weekgrid">
          {weekPlan(view, range === 'week' ? weekStart : addDays(weekStart, 7)).map((d) => (
            <div key={d.date}>
              <DayList day={d} showHeader />
              <div className="progress-track" style={{ margin: '6px 4px 0' }} aria-hidden><div className="progress-fill" style={{ width: `${Math.min(100, (d.minutes / Math.max(1, d.budget)) * 100)}%`, background: d.overBy > 0 ? 'var(--clay)' : undefined }} /></div>
            </div>
          ))}
        </div>
      )}
      {range === 'month' && <Month />}

      {view.tasks.length === 0 && <Empty title="No tasks yet" />}

      <section className={`card ${fresh.show ? 'sun' : 'soft'} stack`} aria-label="Reset my plan">
        <div className="row"><I.undo size={20} aria-hidden /><h2 className="h3">{fresh.show ? `Back after ${fresh.daysAway} days? Start fresh.` : 'Fallen behind? Start fresh.'}</h2></div>
        <p className="small">Resetting re-spreads your plan from today. Missed tasks aren't dumped on today. They simply disappear from the backlog. Your history and progress stay.</p>
        <div><Button variant={fresh.show ? 'primary' : 'secondary'} icon={I.undo} onClick={doReset}>Reset my plan</Button></div>
      </section>
      <p className="xs muted center">Week starts Monday · {WEEKDAY_SHORT[weekday(today)]} today</p>
    </div>
  );
};
