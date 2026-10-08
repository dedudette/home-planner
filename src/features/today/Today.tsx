import { useState } from 'react';
import { addDays, formatMinutes, formatLong } from '../../domain/dates';
import { needsFreshStart } from '../../domain/learning';
import { bucketLife, dayPlan, todayPlan, type DeferReason, type DueItem } from '../../domain/view';
import { GoalCoverageCard } from '../plan/GoalCoverage';
import { TIME_LABEL } from '../../domain/options';
import { TIME_ICON } from '../../ui/icons';
import { useApp } from '../../state/store';
import { I } from '../../ui/icons';
import { Button, Chip, Empty, IconButton, PageHead, ProgressBar } from '../../ui/primitives';
import { TaskCard } from '../tasks/TaskCard';
import { InsightCard, useInsights } from './Insights';

const greeting = () => {
  const h = new Date().getHours();
  return h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
};

/** Why something due is not in today's list. Every left-out task says so, in plain words. */
const DEFER_NOTE: Record<DeferReason, (budget: number) => string> = {
  time: (b) => `Left out so today stays within your ${b} minutes. It stays due.`,
  energy: () => 'Left out because you said your energy is low today. It will come back.',
  'rest-day': () => 'Saved for one of your cleaning days.',
};

export const FreshStartCard = ({ days }: { days: number }) => {
  const { dispatch, stamp, toast } = useApp();
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;
  return (
    <div className="card sun stack" role="region" aria-label="Fresh start">
      <div className="row"><I.sun size={22} aria-hidden /><h2 className="h3">Welcome back. Life happens.</h2></div>
      <p className="small">It's been {days} days. Instead of piling everything you missed onto today, we can start your plan fresh from today. Nothing is lost and nothing is owed.</p>
      <div className="row wrap" style={{ gap: 8 }}>
        <Button onClick={() => { dispatch({ type: 'RESET_PLAN', stamp: stamp() }); toast('Fresh start. Your plan now begins today.'); }} icon={I.undo}>Reset my plan</Button>
        <Button variant="secondary" onClick={() => setHidden(true)}>Keep it as is</Button>
      </div>
    </div>
  );
};

export const Today = () => {
  const { view, data, today, hour, openSheet, dispatch, stamp, plan } = useApp();
  const t = todayPlan(view);
  const insights = useInsights().filter((i) => !(data.dismissedInsights[i.id] && data.dismissedInsights[i.id] === today)).slice(0, 2);
  const fresh = needsFreshStart(view);
  const [showExtra, setShowExtra] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [openBuckets, setOpenBuckets] = useState<Record<string, boolean>>({});
  const tomorrow = dayPlan(view, addDays(today, 1));
  const name = data.user.name.trim();

  const homeOn = data.preferences.focus.includes('home') || data.preferences.focus.length === 0;
  const lifeOn = plan.lifeActive;
  const focusLeft = t.focus.length + t.life.length;
  const doneN = t.done.length;
  const totalN = focusLeft + doneN;
  const nonHabitFocus = t.focus.filter((f) => !f.task.habit);
  const restDay = homeOn && !t.isActiveDay;
  const plannedMinutes = t.totalPlanned;
  const buckets = bucketLife(t.life, hour);
  // Home routines that belong to a part of the day (the evening dish reset, making the bed) follow the same Now / Later rules as
  // habits. Untimed cleaning is always "now". Timed ones that are not for this part of the day are tucked away, never hidden or pushed.
  const homeBuckets = bucketLife(t.focus, hour);
  const nowCount = buckets.now.length + homeBuckets.now.length;
  const laterCount = buckets.later.length + buckets.evening.length + homeBuckets.later.length + homeBuckets.evening.length;
  const mins = (xs: DueItem[]) => xs.reduce((n, i) => n + i.task.minutes, 0);
  const PhaseIcon = TIME_ICON[buckets.phase];

  /** A part of the day that is not "now". Collapsed by default so an evening routine never looks like a task for this morning. */
  const quietBucket = (key: string, title: string, Ic: typeof PhaseIcon, items: DueItem[], hint: string, scope = 'life') => items.length > 0 && (
    <div className="stack" key={`${scope}-${key}`} data-bucket={key} data-scope={scope}>
      <button className="bucket-toggle" aria-expanded={!!openBuckets[`${scope}-${key}`]} onClick={() => setOpenBuckets((o) => ({ ...o, [`${scope}-${key}`]: !o[`${scope}-${key}`] }))}>
        <Ic size={16} aria-hidden />
        <span className="grow"><b>{title}</b> <span className="muted small">· {items.length} · about {formatMinutes(mins(items))}</span><span className="xs muted bucket-hint">{hint}</span></span>
        <span aria-hidden>{openBuckets[key] ? '▲' : '▼'}</span>
      </button>
      {openBuckets[`${scope}-${key}`] && <div className="tasklist">{items.map((f) => <TaskCard key={f.task.id} task={f.task} />)}</div>}
    </div>
  );

  const lifeSection = t.life.length > 0 && (
    <section aria-labelledby="life-h" className="stack" data-phase={buckets.phase}>
      <div className="section-title"><h2 id="life-h">Habits &amp; routine</h2><span className="small muted">{t.life.length} · about {formatMinutes(t.lifeMinutes)}</span></div>
      {buckets.now.length > 0 && (
        <div className="stack" data-bucket="now" data-scope="life">
          <div className="group-title"><PhaseIcon size={16} aria-hidden /> Now · {TIME_LABEL[buckets.phase]}</div>
          <div className="tasklist">{buckets.now.map((f) => <TaskCard key={f.task.id} task={f.task} />)}</div>
        </div>
      )}
      {quietBucket('later', 'Later today', TIME_ICON.afternoon, buckets.later, 'Coming up this afternoon')}
      {quietBucket('evening', 'This evening', TIME_ICON.evening, buckets.evening, 'Wind-down habits. They will be here tonight.')}
      {quietBucket('earlier', 'Earlier today', TIME_ICON.morning, buckets.earlier, 'Still open, and that is fine. No rush.')}
    </section>
  );
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
        <p className="small" style={{ opacity: 0.9 }}>{restDay ? (lifeOn ? 'Rest day from cleaning' : 'Rest day') : 'Today'}</p>
        <h2 style={{ marginTop: 4 }}>
          {totalN === 0 ? (restDay ? 'Nothing planned. Enjoy it.' : 'Nothing due today.')
            : focusLeft === 0 ? 'All done for today. Nice work.'
            : restDay && t.life.length === 0 ? `Just ${focusLeft} tiny daily habit${focusLeft === 1 ? '' : 's'}`
            : `${focusLeft} thing${focusLeft === 1 ? '' : 's'} left · about ${formatMinutes(plannedMinutes)}`}
        </h2>
        {totalN > 0 && (
          <div style={{ marginTop: 14 }}>
            <ProgressBar value={totalN ? doneN / totalN : 0} label="Today's progress" />
            <p className="small" style={{ marginTop: 8, opacity: 0.92 }}>
              {doneN} done{t.doneMinutes ? ` · ${formatMinutes(t.doneMinutes)} ${lifeOn ? 'logged' : 'cleaned'}` : ''}
              {lifeOn ? (t.totalBudget ? ` · daily goal ${t.totalBudget} min` : '') : (homeOn && !restDay && t.budget ? ` · session goal ${plan.sessionMinutes} min` : '')}
            </p>
            {focusLeft > 0 && laterCount > 0 && (
              <p className="small" style={{ marginTop: 4, opacity: 0.92 }}>{nowCount} for right now · {laterCount} for later today</p>
            )}
            {t.overBy > 0 && (
              <p className="small" style={{ marginTop: 4, opacity: 0.92 }} role="status">
                That is {t.overBy} min over your {t.totalBudget}-minute goal, because {t.overBecause.map((x) => `"${x.name}"`).join(' and ')} {t.overBecause.length === 1 ? 'is an urgent task' : 'are urgent tasks'} you added. Everything else was left out to keep to your time.
              </p>
            )}
          </div>
        )}
        {restDay && <p className="small" style={{ marginTop: 10, opacity: 0.92 }}>It's not one of your cleaning days. If you're feeling it anyway, try one of the quick options below.</p>}
      </section>

      <section aria-label="Quick actions" className={`quick-actions${homeOn ? '' : ' two'}`}>
        <button className="qa five" onClick={() => openSheet({ kind: 'five' })}>
          <span className="ic"><I.timer size={24} aria-hidden /></span>
          <span><b>Just 5 minutes</b><span className="s">One tiny task. Then stop or keep going.</span></span>
        </button>
        <button className="qa time" onClick={() => openSheet({ kind: 'timebox' })}>
          <span className="ic"><I.clock size={24} aria-hidden /></span>
          <span><b>I only have…</b><span className="s">Pick your minutes. We pick the tasks.</span></span>
        </button>
        {homeOn && (
          <button className="qa mess" onClick={() => openSheet({ kind: 'emergency' })}>
            <span className="ic"><I.sparkles size={24} aria-hidden /></span>
            <span><b>My home is a mess</b><span className="s">A calm reset, most visible things first.</span></span>
          </button>
        )}
      </section>

      {lifeOn && (
        <button className="card soft row between" style={{ textAlign: 'left', width: '100%' }} onClick={() => openSheet({ kind: 'roughDay' })}>
          <span className="row" style={{ gap: 12 }}><I.heart size={22} aria-hidden style={{ color: 'var(--primary)' }} /><span><b>Rough day?</b><br /><span className="small muted">A few tiny, gentle things to get back on track. No catching up.</span></span></span>
          <I.right size={20} aria-hidden />
        </button>
      )}

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

      <GoalCoverageCard compact />

      {lifeSection}

      {(homeOn || t.focus.length > 0) && (
      <section aria-labelledby="today-h" className="stack">
        <div className="section-title"><h2 id="today-h">{restDay ? 'Daily basics' : 'Your list for today'}</h2>{nonHabitFocus.length > 0 && <span className="small muted">{nonHabitFocus.length} task{nonHabitFocus.length === 1 ? '' : 's'}</span>}</div>
        {t.focus.length === 0 ? (
          <Empty title={doneN > 0 ? 'Everything on today\'s list is done' : restDay ? 'No cleaning planned today' : 'Nothing due today'}>
            {doneN > 0 ? "That's a good day's work." : 'Enjoy the breathing room. You can still grab a quick win below.'}
          </Empty>
        ) : (
          <>
            {homeBuckets.now.length > 0
              ? <div className="tasklist" data-bucket="now" data-scope="home">{homeBuckets.now.map((f) => <TaskCard key={f.task.id} task={f.task} />)}</div>
              : <p className="small muted">Nothing for right now. What is planned for later is below.</p>}
            {quietBucket('later', 'Later today', TIME_ICON.afternoon, homeBuckets.later, 'Coming up this afternoon', 'home')}
            {quietBucket('evening', 'This evening', TIME_ICON.evening, homeBuckets.evening, 'Winds the day down. It will be here tonight.', 'home')}
            {quietBucket('earlier', 'Earlier today', TIME_ICON.morning, homeBuckets.earlier, 'Still open, and that is fine. No rush.', 'home')}
          </>
        )}
      </section>
      )}

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
            {showExtra ? 'Hide' : 'Show'} {t.extra.length} more, left out of today
          </button>
          {showExtra && (
            <div className="tasklist">
              {t.deferred.slice(0, 12).map((d) => <TaskCard key={d.item.task.id} task={d.item.task} compact note={DEFER_NOTE[d.reason](t.totalBudget)} />)}
            </div>
          )}
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
