import { useMemo, useRef, useState } from 'react';
import { formatShort } from '../../domain/dates';
import { PATTERN_RULES, PATTERN_WINDOWS, computePatterns, type PatternDay, type PatternWindow, type Patterns as PatternsData } from '../../domain/patterns';
import { useApp } from '../../state/store';
import { I } from '../../ui/icons';
import { PageHead, Segmented } from '../../ui/primitives';
import { CoachPanel } from './CoachPanel';

const STATUS_WORD: Record<PatternDay['status'], string> = { opened: 'opened', acted: 'used, but not tracked', 'not-opened': 'not opened', unknown: 'unknown' };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const Row = ({ label, note, value, testid }: { label: string; note?: string; value: number; testid?: string }) => (
  <div className="facts-row">
    <dt>{label}{note && <span className="small muted facts-note">{note}</span>}</dt>
    <dd data-testid={testid}>{value}</dd>
  </div>
);

const DaysCard = ({ p }: { p: PatternsData }) => (
  <section className="card stack" aria-labelledby="pt-days">
    <h2 id="pt-days" className="h3">Days in this window</h2>
    <ol className="pday-strip" aria-label="Each day in the window, oldest first">
      {p.days.list.map((d) => (
        <li key={d.date}><span className={`pday ${d.status}`} aria-hidden /><span className="sr-only">{formatShort(d.date)}: {STATUS_WORD[d.status]}</span></li>
      ))}
    </ol>
    <dl className="facts">
      <Row label="Opened" note="The app was open and Today was recorded." value={p.days.opened} testid="pt-days-opened" />
      <Row label="Not opened" note="No record of the app being opened, and nothing logged." value={p.days.notOpened} testid="pt-days-not-opened" />
      <Row label="Used, but not tracked" note="Something was logged, but the day was recorded before the app tracked what Today showed." value={p.days.acted} testid="pt-days-acted" />
      <Row label="Unknown" note="Not enough was recorded to say (before tracking began, or history was removed)." value={p.days.unknown} testid="pt-days-unknown" />
    </dl>
    <ul className="pday-legend small muted" aria-hidden>
      <li><span className="pday opened" /> opened</li><li><span className="pday not-opened" /> not opened</li><li><span className="pday acted" /> used, not tracked</li><li><span className="pday unknown" /> unknown</li>
    </ul>
  </section>
);

const NotEnough = ({ p }: { p: PatternsData }) => (
  <section className="card sun stack" aria-labelledby="pt-few" role="status" data-testid="patterns-insufficient">
    <h2 id="pt-few" className="h3">Not enough recorded yet</h2>
    <p className="small">
      To show patterns, CleanFlow needs at least {plural(PATTERN_RULES.minOpenedDays, 'day')} when the app was opened and {plural(PATTERN_RULES.minSeenTasks, 'task')} shown on Today within the window.
      This window has {plural(p.days.opened, 'opened day')} and {plural(p.seen.tasks, 'shown task')}.
    </p>
    <p className="small">Patterns build up with normal use. Days from before the app began recording what Today shows stay "unknown" and are never filled in from older records.</p>
  </section>
);

const Facts = ({ p }: { p: PatternsData }) => (
  <>
    <section className="card stack" aria-labelledby="pt-seen">
      <h2 id="pt-seen" className="h3">Tasks shown on Today</h2>
      <p className="big-num" data-testid="pt-seen-total">{p.seen.tasks}</p>
      <dl className="facts">
        <Row label="Completed" value={p.seen.completed} testid="pt-completed" />
        <Row label="Skipped" note="You chose Skip." value={p.seen.skipped} testid="pt-skipped" />
        <Row label="Snoozed" value={p.seen.snoozed} testid="pt-snoozed" />
        <Row label="Moved to another day" value={p.seen.moved} testid="pt-moved" />
        <Row label="Timer stopped early" value={p.seen.stopped} testid="pt-stopped" />
        <Row label="Shown, with no recorded action" note="The app has no record of anything being done with these. That is all this says: it does not know why, and it is not a skip." value={p.seen.noAction} testid="pt-no-action" />
        {p.seen.pendingToday > 0 && <Row label="Shown today, day not over" note="Not counted as 'no recorded action' until the day ends." value={p.seen.pendingToday} testid="pt-pending" />}
        {p.seen.actionsRemoved > 0 && <Row label="Outcome unknown" note="History for these days was removed to save space." value={p.seen.actionsRemoved} testid="pt-actions-removed" />}
      </dl>
      <p className="small muted">"Shown" means Today displayed the task while the page was visible. It does not mean it was read.</p>
    </section>

    <section className="card stack" aria-labelledby="pt-notshown">
      <h2 id="pt-notshown" className="h3">Selected, but not shown</h2>
      <dl className="facts"><Row label="Tasks selected for a day but not shown on Today" note="For example, in a group that stayed closed." value={p.notShown} testid="pt-not-shown" /></dl>
    </section>

    <section className="card stack" aria-labelledby="pt-left">
      <h2 id="pt-left" className="h3">Left out by the planner</h2>
      <p className="small muted">These were left out by the app's own rules. They are not something you skipped, and they are not counted as shown.</p>
      <dl className="facts">
        <Row label="Not enough time" note="Left out to keep the day within your time." value={p.leftOut.notEnoughTime} testid="pt-left-time" />
        <Row label="Low-energy day" note="Left out because the day was set to low energy." value={p.leftOut.lowEnergyDay} testid="pt-left-energy" />
        <Row label="Not a cleaning day" note="Saved for one of your cleaning days." value={p.leftOut.notACleaningDay} testid="pt-left-rest" />
        {p.leftOut.reasonNotRecorded > 0 && <Row label="Reason not recorded" note="From days recorded before the planner's reason was kept." value={p.leftOut.reasonNotRecorded} testid="pt-left-unknown" />}
      </dl>
    </section>

    {(p.areas.home.seen > 0 || p.areas.habits.seen > 0) && (
      <section className="card stack" aria-labelledby="pt-area">
        <h2 id="pt-area" className="h3">By area</h2>
        <div className="table-wrap">
          <table className="facts-table">
            <thead><tr><th scope="col">Area</th><th scope="col">Shown</th><th scope="col">Completed</th><th scope="col">No recorded action</th></tr></thead>
            <tbody>
              {p.areas.home.seen > 0 && <tr><th scope="row">Home cleaning</th><td>{p.areas.home.seen}</td><td>{p.areas.home.completed}</td><td>{p.areas.home.noAction}</td></tr>}
              {p.areas.habits.seen > 0 && <tr><th scope="row">Daily habits</th><td>{p.areas.habits.seen}</td><td>{p.areas.habits.completed}</td><td>{p.areas.habits.noAction}</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    )}
  </>
);

const Notes = ({ p }: { p: PatternsData }) => {
  const notes: { id: string; text: string }[] = [];
  if (p.history.daysRemovedInWindow > 0) notes.push({ id: 'history', text: `Older history was removed to save space. ${plural(p.history.daysRemovedInWindow, 'day')} in this window fall in that gap, so what happened on them cannot be counted. They are not treated as quiet days.` });
  if (p.displayUnknown > 0) notes.push({ id: 'legacy', text: `${plural(p.displayUnknown, 'task')} fall on days recorded before CleanFlow tracked what Today showed. Whether they were shown is unknown, so they are left out of these counts.` });
  if (!notes.length) return null;
  return (
    <section className="stack" aria-label="What these counts leave out">
      {notes.map((n) => <div className="hint" role="note" key={n.id} data-testid={`patterns-note-${n.id}`}><I.info size={18} aria-hidden /><div>{n.text}</div></div>)}
    </section>
  );
};

export const Patterns = () => {
  const { data, today } = useApp();
  const [win, setWin] = useState<PatternWindow>(14);
  const p = useMemo(() => computePatterns(data, today, win), [data, today, win]);
  const askedFor = useRef<{ from: string; to: string } | null>(null);
  return (
    <div className="page">
      <PageHead title="Your patterns" sub="What the app recorded. It is not a score, and it does not say why." />
      <Segmented label="Time window" value={String(win)} onChange={(v) => setWin(Number(v) as PatternWindow)} options={PATTERN_WINDOWS.map((w) => ({ value: String(w), label: `${w} days` }))} />
      <p className="small muted" data-testid="patterns-window">{formatShort(p.from)} to {formatShort(p.to)} · {plural(p.windowDays, 'day')}</p>

      <DaysCard p={p} />
      {p.evidence.sufficient ? <Facts p={p} /> : <NotEnough p={p} />}
      <Notes p={p} />
      <CoachPanel p={p} windowKey={win} askedFor={askedFor} />
    </div>
  );
};
