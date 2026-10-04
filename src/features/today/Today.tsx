import { useState } from 'react';
import { addDays, formatMinutes, formatLong } from '../../domain/dates';
import { needsFreshStart } from '../../domain/learning';
import { dayPlan, todayPlan } from '../../domain/view';
import { useApp } from '../../state/store';
import { I } from '../../ui/icons';
import { Button, Chip, Empty, IconButton, PageHead, ProgressBar } from '../../ui/primitives';
import { TaskCard } from '../tasks/TaskCard';
import { InsightCard, useInsights } from './Insights';

const greeting = () => {
  const h = new Date().getHours();
  return h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
};

export const FreshStartCard = ({ days }: { days: number }) => {
  const { dispatch, stamp, toast } = useApp();
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;
  return (
    <div className="card sun stack" role="region" aria-label="Fresh start">
      <div className="row"><I.sun size={22} aria-hidden /><h3>Welcome back. Life happens.</h3></div>
      <p className="small">It's been {days} days. Instead of piling everything you missed onto today, we can start your plan fresh from today. Nothing is lost and nothing is owed.</p>
      <div className="row wrap" style={{ gap: 8 }}>
        <Button onClick={() => { dispatch({ type: 'RESET_PLAN', stamp: stamp() }); toast('Fresh start. Your plan now begins today.'); }} icon={I.undo}>Reset my plan</Button>
        <Button variant="secondary" onClick={() => setHidden(true)}>Keep it as is</Button>
      </div>
    </div>
  );
};

export const Today = () => {
  const { view, data, today, openSheet, dispatch, stamp, plan } = useApp();
  const t = todayPlan(view);
  const insights = useInsights().filter((i) => !(data.dismissedInsights[i.id] && data.dismissedInsights[i.id] === today)).slice(0, 2);
  const fresh = needsFreshStart(view);
  const [showExtra, setShowExtra] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const tomorrow = dayPlan(view, addDays(today, 1));
  const name = data.user.name.trim();

  const focusLeft = t.focus.length;
  const doneN = t.done.length;
  const totalN = focusLeft + doneN;
  const nonHabitFocus = t.focus.filter((f) => !f.task.habit);
  const restDay = !t.isActiveDay;
  const showEnergy = data.preferences.energy === 'varies' || t.energy !== 'ok';

  return (
    <div className="page">
      <PageHead
        title={`${greeting()}${name ? `, ${name}` : ''}`}
        sub={formatLong(today)}
        action={<IconButton icon={I.plus} label="Add your own task" onClick={() => openSheet({ kind: 'taskForm' })} className="btn soft" style={{ width: 48, height: 48 }} />}
      />

      {fresh.show && <FreshStartCard days={fresh.daysAway} />}

      <section className="hero-card" aria-label="Today at a glance">
        <p className="small" style={{ opacity: 0.9 }}>{restDay ? 'Rest day' : 'Today'}</p>
        <h2 style={{ marginTop: 4 }}>
          {totalN === 0 ? (restDay ? 'Nothing planned. Enjoy it.' : 'Nothing due today.')
            : focusLeft === 0 ? 'All done for today. Nice work.'
            : restDay ? `Just ${focusLeft} tiny daily habit${focusLeft === 1 ? '' : 's'}`
            : `${focusLeft} thing${focusLeft === 1 ? '' : 's'} left · about ${formatMinutes(t.plannedMinutes)}`}
        </h2>
        {totalN > 0 && (
          <div style={{ marginTop: 14 }}>
            <ProgressBar value={totalN ? doneN / totalN : 0} label="Today's progress" />
            <p className="small" style={{ marginTop: 8, opacity: 0.92 }}>{doneN} done{t.doneMinutes ? ` · ${formatMinutes(t.doneMinutes)} cleaned` : ''}{!restDay && t.budget ? ` · session goal ${plan.sessionMinutes} min` : ''}</p>
          </div>
        )}
        {restDay && <p className="small" style={{ marginTop: 10, opacity: 0.92 }}>It's not one of your cleaning days. If you're feeling it anyway, try one of the quick options below.</p>}
      </section>

      <section aria-label="Quick actions" className="quick-actions">
        <button className="qa five" onClick={() => openSheet({ kind: 'five' })}>
          <span className="ic"><I.timer size={24} aria-hidden /></span>
          <span><b>Just 5 minutes</b><span className="s">One tiny task. Then stop or keep going.</span></span>
        </button>
        <button className="qa time" onClick={() => openSheet({ kind: 'timebox' })}>
          <span className="ic"><I.clock size={24} aria-hidden /></span>
          <span><b>I only have…</b><span className="s">Pick your minutes. We pick the tasks.</span></span>
        </button>
        <button className="qa mess" onClick={() => openSheet({ kind: 'emergency' })}>
          <span className="ic"><I.sparkles size={24} aria-hidden /></span>
          <span><b>My home is a mess</b><span className="s">A calm reset, most visible things first.</span></span>
        </button>
      </section>

      {showEnergy && (
        <div className="card soft row between wrap" role="group" aria-label="Energy today">
          <div><p className="strong">How's your energy today?</p><p className="small muted">We'll adjust today's list.</p></div>
          <div className="chips">
            {([['low', 'Low'], ['ok', 'Okay'], ['high', 'High']] as const).map(([v, l]) => (
              <Chip key={v} role="radio" on={t.energy === v} onClick={() => dispatch({ type: 'DAY_ENERGY', level: v, stamp: stamp() })}>{l}</Chip>
            ))}
          </div>
        </div>
      )}

      {insights.map((i) => <InsightCard key={i.id} insight={i} />)}

      <section aria-labelledby="today-h" className="stack">
        <div className="section-title"><h2 id="today-h">{restDay ? 'Daily basics' : 'Your list for today'}</h2>{nonHabitFocus.length > 0 && <span className="small muted">{nonHabitFocus.length} task{nonHabitFocus.length === 1 ? '' : 's'}</span>}</div>
        {t.focus.length === 0 ? (
          <Empty title={doneN > 0 ? 'Everything on today\'s list is done' : restDay ? 'No cleaning planned today' : 'Nothing due today'}>
            {doneN > 0 ? "That's a good day's work." : 'Enjoy the breathing room. You can still grab a quick win below.'}
          </Empty>
        ) : (
          <div className="tasklist">{t.focus.map((f) => <TaskCard key={f.task.id} task={f.task} />)}</div>
        )}
      </section>

      {t.catchUp.length > 0 && (
        <section aria-labelledby="catch-h" className="stack">
          <div className="section-title"><h2 id="catch-h">Gentle catch-up</h2><span className="small muted">only if you want</span></div>
          <p className="small muted">A couple of things slipped by. No pressure. The rest will simply roll to their next slot.</p>
          <div className="tasklist">{t.catchUp.map((f) => <TaskCard key={f.task.id} task={f.task} overdue />)}</div>
        </section>
      )}

      {t.extra.length > 0 && (
        <section className="stack" aria-label="Extra tasks">
          <button className="btn secondary block" onClick={() => setShowExtra((s) => !s)} aria-expanded={showExtra}>
            {showExtra ? 'Hide' : 'Show'} {t.extra.length} more if you have extra energy
          </button>
          {showExtra && <div className="tasklist">{t.extra.slice(0, 12).map((f) => <TaskCard key={f.task.id} task={f.task} compact />)}</div>}
        </section>
      )}

      {t.done.length > 0 && (
        <section className="stack" aria-label="Done today">
          <button className="btn ghost block" onClick={() => setShowDone((s) => !s)} aria-expanded={showDone}><I.checkCircle size={18} aria-hidden /> {t.done.length} done today {showDone ? '▲' : '▼'}</button>
          {showDone && (
            <div className="tasklist">
              {t.done.map((e) => (
                <div className="task" key={e.id} style={{ gridTemplateColumns: '44px 1fr', opacity: 0.8 }}>
                  <span className="check on"><I.check size={22} strokeWidth={3} aria-hidden /></span>
                  <div><div className="task-name">{e.name}</div><div className="task-meta"><span>{e.roomName}</span><span>{e.actualMinutes} min</span></div></div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <div className="card soft row between">
        <div><p className="strong">Tomorrow</p><p className="small muted">{tomorrow.tasks.length ? `${tomorrow.tasks.length} task${tomorrow.tasks.length === 1 ? '' : 's'} · about ${formatMinutes(tomorrow.minutes)}` : 'A free day.'}</p></div>
        <a className="btn ghost sm" href="#/schedule">See schedule</a>
      </div>
    </div>
  );
};
