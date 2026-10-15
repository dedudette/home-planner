import { addDays, formatDay } from '../../domain/dates';
import { useApp } from '../../state/store';
import { I } from '../../ui/icons';

const NAME = { healthkit: 'Apple Health', 'health-connect': 'Health Connect' } as const;

/**
 * What the health service reported, shown beside the person's own records and labelled as theirs-from-elsewhere. It is never added to
 * their log, their minutes or their plan, and it only appears when they asked for it and something was actually read.
 */
export const HealthMovementCard = () => {
  const { data, today } = useApp();
  const h = data.health;
  if (!h.prefs.enabled) return null;
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, -i)).map((date) => ({ date, d: h.daily[date] })).filter((x) => x.d && (x.d.steps !== undefined || x.d.exerciseMinutes !== undefined || x.d.workouts?.length));
  if (days.length === 0) return null;
  const from = NAME[days[0].d!.platform];
  const workouts = days.flatMap((x) => (x.d!.workouts ?? []).map((w) => ({ ...w, date: x.date }))).slice(0, 5);
  return (
    <section className="card stack" aria-labelledby="hm-h" data-testid="health-movement">
      <h2 id="hm-h" className="h3"><I.heart size={16} aria-hidden /> From {from} (read-only)</h2>
      <ul className="stack" style={{ margin: 0, padding: 0, gap: 4 }} aria-label={`Last days from ${from}`}>
        {days.map(({ date, d }) => (
          <li key={date} className="row between wrap" style={{ listStyle: 'none' }}>
            <span>{formatDay(date, today)}</span>
            <span className="small muted">{[d!.steps !== undefined ? `${d!.steps.toLocaleString()} steps` : '', d!.exerciseMinutes !== undefined ? `${d!.exerciseMinutes} exercise min` : ''].filter(Boolean).join(' · ')}</span>
          </li>
        ))}
      </ul>
      {workouts.length > 0 && <div><b className="small">Workouts recorded elsewhere</b><ul className="small muted" style={{ margin: '4px 0 0', paddingLeft: 18 }}>{workouts.map((w) => <li key={w.id}>{formatDay(w.date, today)}: {w.type}, {w.minutes} min ({w.source})</li>)}</ul></div>}
      <p className="xs muted">Shown here for your information only. It is not part of your plan, not in your log, and not counted in your minutes. A day with nothing listed means nothing was read, not that nothing happened.</p>
    </section>
  );
};

export const HealthWaterNote = () => {
  const { data, today } = useApp();
  const h = data.health;
  const d = h.prefs.enabled ? h.daily[today] : undefined;
  if (!d || d.waterMl === undefined) return null;
  return (
    <p className="small muted" data-testid="health-water">From {NAME[d.platform]}: {d.waterMl} ml today, logged in other apps. Shown separately; it is not added to your log above.</p>
  );
};
