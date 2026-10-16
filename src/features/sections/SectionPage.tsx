import { useState } from 'react';
import { addDays } from '../../domain/dates';
import { activityHistory, describeSchedule, summarizeHistory, type OccurrenceState } from '../../domain/modules/activities';
import { ACTIVITY_LABEL, clockLabel, MODULES } from '../../domain/modules/registry';
import type { ActivityModule, PlannedActivity } from '../../domain/modules/types';
import { useApp } from '../../state/store';
import { I } from '../../ui/icons';
import { Button, Empty, PageHead, Tag } from '../../ui/primitives';

const STATE_TEXT: Record<OccurrenceState, string> = { completed: 'Done', skipped: 'Skipped', moved: 'Moved', scheduled: 'Coming up', unrecorded: 'Not recorded' };

/**
 * What became of each planned day over the last four weeks. Not recorded is its own state, shown plainly: it is not a skip and it is not
 * a failure, it is simply nothing written down.
 */
export const ActivityHistory = ({ activity }: { activity: PlannedActivity }) => {
  const { data, today } = useApp();
  const occ = activityHistory(data, activity, addDays(today, -27), today, today);
  if (!occ.length) return <p className="small muted">Nothing was scheduled in the last four weeks.</p>;
  const sum = summarizeHistory(occ);
  const text = [`${sum.completed} done`, sum.skipped ? `${sum.skipped} skipped` : '', sum.moved ? `${sum.moved} moved` : '', sum.unrecorded ? `${sum.unrecorded} not recorded` : '', sum.scheduled ? `${sum.scheduled} today or coming up` : ''].filter(Boolean).join(' · ');
  return (
    <div className="stack" style={{ gap: 6 }}>
      <ul className="occ" aria-label={`Last four weeks: ${text}`}>
        {occ.map((o) => (
          <li key={o.date} className={`occ-dot ${o.state}`} title={`${o.date}: ${STATE_TEXT[o.state]}`}><span className="sr-only">{o.date}: {STATE_TEXT[o.state]}</span></li>
        ))}
      </ul>
      <p className="small muted">{text}{sum.minutes ? ` · ${sum.minutes} min logged` : ''}</p>
    </div>
  );
};

const ActivityRow = ({ a }: { a: PlannedActivity }) => {
  const { openSheet } = useApp();
  return (
    <article className="card stack" aria-label={a.name}>
      <div className="row between" style={{ alignItems: 'flex-start' }}>
        <div>
          <h3>{a.name}</h3>
          <div className="row wrap small muted" style={{ gap: 10, marginTop: 4 }}>
            <span><I.repeat size={14} aria-hidden /> {describeSchedule(a)}</span>
            {a.time && <span><I.alarm size={14} aria-hidden /> {clockLabel(a.time)}</span>}
            <span><I.clock size={14} aria-hidden /> {a.minutes} min</span>
            <Tag kind={a.kind === 'optional' ? 'lav' : 'green'}>{a.kind === 'fixed' ? 'Set time' : a.kind === 'flexible' ? 'Planned by you' : 'Optional idea'}</Tag>
          </div>
        </div>
        <Button size="sm" variant="ghost" icon={I.pencil} onClick={() => openSheet({ kind: 'activityForm', editId: a.id })} aria-label={`Edit ${a.name}`}>Edit</Button>
      </div>
      <ActivityHistory activity={a} />
    </article>
  );
};

/**
 * The planned activities of one section: what is scheduled, and what became of it. Each activity is the same object Today and the
 * Schedule show, so changing it here changes it everywhere, and completing it anywhere is recorded once.
 */
export const PlannedActivities = ({ module }: { module: ActivityModule }) => {
  const { data, openSheet } = useApp();
  const [showArchived, setShowArchived] = useState(false);
  const mine = data.activities.filter((a) => a.module === module);
  const live = mine.filter((a) => !a.archived);
  const archived = mine.filter((a) => a.archived);
  return (
    <section className="stack" aria-labelledby={`plan-${module}`}>
      <div className="section-title">
        <h2 id={`plan-${module}`}>What you have planned</h2>
        <Button size="sm" icon={I.plus} onClick={() => openSheet({ kind: 'activityForm', defaults: { module } })}>Plan an activity</Button>
      </div>
      {live.length === 0
        ? <Empty title="Nothing planned yet">Plan something in {ACTIVITY_LABEL[module].toLowerCase()} and it appears on Today, in the Schedule and here: one plan, one record.</Empty>
        : live.map((a) => <ActivityRow key={a.id} a={a} />)}
      {archived.length > 0 && (
        <>
          <button className="btn ghost block" onClick={() => setShowArchived((s) => !s)} aria-expanded={showArchived}>{archived.length} taken out of your plan {showArchived ? '▲' : '▼'}</button>
          {showArchived && archived.map((a) => <ActivityRow key={a.id} a={a} />)}
        </>
      )}
    </section>
  );
};

export const SectionPage = ({ module }: { module: ActivityModule }) => {
  const info = MODULES[module];
  return (
    <div className="page">
      <PageHead title={info.label} sub={info.blurb} />
      <PlannedActivities module={module} />
    </div>
  );
};
