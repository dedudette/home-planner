import { useMemo, useState } from 'react';
import { addDays, formatDay, startOfWeek, WEEKDAY_SHORT } from '../../domain/dates';
import { allWorkouts, movementSummary, suggestWorkouts, workoutMinutes } from '../../domain/movement/planner';
import { AVOIDS, MOVE_EQUIPMENT, MOVE_LEVELS, MOVE_TYPES, type MoveLevel, type MoveType, type WorkoutLog } from '../../domain/movement/types';
import { dayEnergyOf } from '../../domain/safety';
import { useApp } from '../../state/store';
import { I } from '../../ui/icons';
import { BarChart, Button, Chip, Empty, Hint, PageHead, Segmented, Tag } from '../../ui/primitives';
import { navigate, useRoute } from '../../ui/router';
import { PlannedActivities } from '../sections/SectionPage';
import { OwlTipCard } from '../../ui/OwlTip';
import { HealthMovementCard } from '../health/HealthCard';
import { AVOID_LABEL, EQUIP_LABEL, LEVEL_LABEL, TYPE_LABEL, WorkoutTags } from './shared';

type Tab = 'workouts' | 'plan' | 'progress' | 'setup';
const TABS: { value: Tab; label: string }[] = [{ value: 'workouts', label: 'Workouts' }, { value: 'plan', label: 'Plan' }, { value: 'progress', label: 'Progress' }, { value: 'setup', label: 'Setup' }];
const FELT_LABEL = { easy: 'felt easy', right: 'felt about right', hard: 'felt hard', pain: 'stopped: pain or discomfort' } as const;

const WorkoutsTab = () => {
  const { data, today, openSheet } = useApp();
  const [type, setType] = useState<MoveType | ''>('');
  const [level, setLevel] = useState<MoveLevel | ''>('');
  const [maxMin, setMaxMin] = useState<number | null>(null);
  const [low, setLow] = useState(false);
  const [mine, setMine] = useState(false);
  const [favs, setFavs] = useState(false);
  const [query, setQuery] = useState('');
  const [all, setAll] = useState(false);
  const energy = dayEnergyOf(data, today);
  const prefs = data.movement.prefs;
  const list = useMemo(() => allWorkouts(data).filter((w) => (!mine || w.source === 'personal') && (!favs || data.movement.favourites.includes(w.id))), [data, mine, favs]);
  const f = { type: type || undefined, level: level || undefined, maxMinutes: maxMin ?? undefined, lowImpact: low, query: query || undefined };
  const fits = suggestWorkouts(list, prefs, f, energy);
  const everything = suggestWorkouts(list, prefs, f, energy, true);
  const shown = all ? everything : fits;
  const hidden = everything.length - fits.length;
  return (
    <div className="stack">
      {energy === 'low' && <Hint icon={I.battery}>You said your energy is low today, so only gentler options are offered. You can still look at everything.</Hint>}
      <input className="input" type="search" aria-label="Search workouts" placeholder="Search workouts and exercises" value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className="chips" role="group" aria-label="Kind of movement">{MOVE_TYPES.map((t) => <Chip small key={t} role="checkbox" on={type === t} onClick={() => setType(type === t ? '' : t)}>{TYPE_LABEL[t]}</Chip>)}</div>
      <div className="chips" role="group" aria-label="More filters">
        {MOVE_LEVELS.slice(0, 2).map((l) => <Chip small key={l} role="checkbox" on={level === l} onClick={() => setLevel(level === l ? '' : l)}>{LEVEL_LABEL[l]}</Chip>)}
        {[10, 20, 30].map((m) => <Chip small key={m} role="checkbox" on={maxMin === m} onClick={() => setMaxMin(maxMin === m ? null : m)}>Up to {m} min</Chip>)}
        <Chip small role="checkbox" on={low} onClick={() => setLow(!low)}>Low impact</Chip>
        <Chip small role="checkbox" on={favs} onClick={() => setFavs(!favs)}>Favourites</Chip>
        <Chip small role="checkbox" on={mine} onClick={() => setMine(!mine)}>My workouts</Chip>
      </div>
      {hidden > 0 && !all && <p className="small muted">{hidden} workout{hidden === 1 ? ' is' : 's are'} hidden because of what you told us (equipment, things you would rather not do, today's energy). <button className="btn ghost sm" onClick={() => setAll(true)}>Show them, with why</button></p>}
      {all && <p className="small muted">Showing everything, with the reason when something would normally be hidden. <button className="btn ghost sm" onClick={() => setAll(false)}>Use my settings</button></p>}
      {shown.length === 0 ? <Empty title="Nothing matches">Try fewer filters{all ? '' : ', or show the ones your settings hide'}.</Empty> : (
        <div className="stack" aria-label="Workouts">
          {shown.map(({ workout: w, minutes, flags }) => (
            <article className="card stack" key={w.id} aria-label={w.name} style={{ padding: 14 }}>
              <div className="row between" style={{ alignItems: 'flex-start', gap: 8 }}>
                <button className="grow plain-btn" style={{ minHeight: 44 }} onClick={() => openSheet({ kind: 'workout', id: w.id })} aria-label={`${w.name}, ${minutes} minute${minutes === 1 ? '' : 's'}. Open details`}><b>{w.name}</b><br /><span className="small muted">{w.blurb}</span></button>
                <Button size="sm" icon={I.play} onClick={() => openSheet({ kind: 'workoutSession', workoutId: w.id })} aria-label={`Start ${w.name}`}>Start</Button>
              </div>
              <WorkoutTags w={w} />
              {flags.length > 0 && <p className="small" style={{ color: 'var(--clay-ink)' }}>Normally hidden: it {flags.join('; it ')}.</p>}
            </article>
          ))}
        </div>
      )}
      <div><Button variant="soft" icon={I.plus} onClick={() => openSheet({ kind: 'workoutForm' })}>Make your own workout</Button></div>
    </div>
  );
};

const LogRow = ({ l }: { l: WorkoutLog }) => {
  const { data, today, dispatch, toast } = useApp();
  const entry = data.sessions.flatMap((s) => s.entries).find((e) => e.id === l.entryId);
  const adhoc = entry?.taskId.startsWith('adhoc:');
  const done = l.exercises.filter((x) => x.status !== 'skipped').length;
  return (
    <li className="card stack" style={{ listStyle: 'none', padding: 12, gap: 4 }} data-testid="log-row">
      <div className="row between wrap"><b>{l.name}</b><span className="small muted">{formatDay(l.date, today)}{entry ? ` · ${entry.actualMinutes} min` : ''}{entry && entry.outcome === 'stopped' ? ' · stopped early' : ''}</span></div>
      <div className="row wrap small muted" style={{ gap: 8 }}>
        {l.exercises.length > 0 && <span>{done} of {l.exercises.length} exercises</span>}
        {l.felt && <Tag kind={l.felt === 'pain' ? 'lav' : undefined}>{FELT_LABEL[l.felt]}</Tag>}
      </div>
      {entry && adhoc && <div><Button size="sm" variant="ghost" icon={I.trash} onClick={() => { dispatch({ type: 'UNDO', entryId: l.entryId, taskId: entry.taskId, before: null, after: null }); dispatch({ type: 'MOVE_LOG_DELETE', entryId: l.entryId }); toast('Record removed.', { label: 'Undo', run: () => { /* restoring a removed record is not offered: it was a mistake you chose to remove */ } }); }} aria-label={`Remove the record of ${l.name} on ${l.date}`}>Remove this record</Button></div>}
    </li>
  );
};

const ProgressTab = () => {
  const { data, today } = useApp();
  const wkStart = startOfWeek(today);
  const week = movementSummary(data, wkStart, addDays(wkStart, 6));
  const g = data.movement.goals;
  const weeks = [3, 2, 1, 0].map((n) => { const from = addDays(wkStart, -7 * n); return { label: n === 0 ? 'This week' : `${n}w ago`, value: movementSummary(data, from, addDays(from, 6)).minutes }; });
  const logs = [...data.movement.log].reverse().slice(0, 30);
  return (
    <div className="stack">
      <section className="card stack" aria-labelledby="mp-week">
        <h2 id="mp-week" className="h3">This week</h2>
        {week.sessions === 0
          ? <p className="muted">Nothing logged yet this week. That is not a miss: logging is optional, and a week with nothing written down is simply unknown.</p>
          : <p><b>{week.sessions}</b> session{week.sessions === 1 ? '' : 's'} on <b>{week.days}</b> day{week.days === 1 ? '' : 's'}, <b>{week.minutes}</b> minutes logged.</p>}
        {(g.sessionsPerWeek || g.minutesPerWeek) && (
          <p className="small muted">Your own goal: {[g.sessionsPerWeek ? `${g.sessionsPerWeek} sessions` : '', g.minutesPerWeek ? `${g.minutesPerWeek} minutes` : ''].filter(Boolean).join(' and ')} a week.{week.sessions > 0 ? ` So far: ${week.sessions}${g.sessionsPerWeek ? ` of ${g.sessionsPerWeek}` : ''} sessions, ${week.minutes}${g.minutesPerWeek ? ` of ${g.minutesPerWeek}` : ''} minutes.` : ''} Goals are yours to change at any time.</p>
        )}
        {g.note && <p className="small">{g.note}</p>}
      </section>
      <HealthMovementCard />
      <section className="card stack" aria-labelledby="mp-4w"><h2 id="mp-4w" className="h3">Minutes per week</h2><BarChart label="Movement minutes per week" unit="minutes" data={weeks} /></section>
      <section className="stack" aria-labelledby="mp-log">
        <h2 id="mp-log" className="h3">Recent workouts</h2>
        {logs.length === 0 ? <Empty title="No workouts logged yet">Finish a guided workout and it appears here.</Empty> : <ul className="stack" style={{ margin: 0, padding: 0 }}>{logs.map((l) => <LogRow key={l.entryId} l={l} />)}</ul>}
      </section>
    </div>
  );
};

const SetupTab = () => {
  const { data, dispatch, openSheet } = useApp();
  const m = data.movement;
  const set = <K extends keyof typeof m.prefs>(k: K, v: (typeof m.prefs)[K]) => dispatch({ type: 'MOVE_PREFS', patch: { [k]: v } });
  const toggle = <T,>(xs: T[], x: T) => (xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x]);
  return (
    <div className="stack">
      <section className="card stack" aria-labelledby="ms-eq">
        <h2 id="ms-eq" className="h3">What you have</h2>
        <p className="small muted">Leave empty to see everything. Choose some and workouts that need other things are hidden.</p>
        <div className="chips" role="group" aria-labelledby="ms-eq">{MOVE_EQUIPMENT.map((e) => <Chip small key={e} role="checkbox" on={m.prefs.equipment.includes(e)} onClick={() => set('equipment', toggle(m.prefs.equipment, e))}>{EQUIP_LABEL[e].replace(/^a /, '')}</Chip>)}</div>
      </section>
      <section className="card stack" aria-labelledby="ms-like">
        <h2 id="ms-like" className="h3">What you enjoy</h2>
        <div className="chips" role="group" aria-labelledby="ms-like">{MOVE_TYPES.map((t) => <Chip small key={t} role="checkbox" on={m.prefs.likes.includes(t)} onClick={() => set('likes', toggle(m.prefs.likes, t))}>{TYPE_LABEL[t]}</Chip>)}</div>
        <p className="small muted">These are shown first. Nothing else is hidden because of it.</p>
      </section>
      <section className="card stack" aria-labelledby="ms-av">
        <h2 id="ms-av" className="h3">What you would rather not do</h2>
        <p className="small muted">Workouts that ask for any of these are left out of suggestions. This is your call; the app does not decide what suits your body.</p>
        <div className="chips" role="group" aria-labelledby="ms-av">{AVOIDS.map((a) => <Chip small key={a} role="checkbox" on={m.prefs.avoid.includes(a)} onClick={() => set('avoid', toggle(m.prefs.avoid, a))}>{AVOID_LABEL[a]}</Chip>)}</div>
        <label className="row between switch-row"><span><b>Low impact only</b><br /><span className="small muted">No jumping or hopping</span></span><input type="checkbox" role="switch" aria-label="Low impact only" checked={m.prefs.lowImpactOnly} onChange={(e) => set('lowImpactOnly', e.target.checked)} style={{ width: 24, height: 24 }} /></label>
      </section>
      <section className="card stack" aria-labelledby="ms-rest">
        <h2 id="ms-rest" className="h3">Rest days</h2>
        <p className="small muted">Days you do not want to move on. Nothing is planned for you on them, and if you plan something yourself, it is flagged, not changed.</p>
        <div className="chips" role="group" aria-labelledby="ms-rest">{[1, 2, 3, 4, 5, 6, 0].map((d) => <Chip small key={d} role="checkbox" on={m.restDays.includes(d)} onClick={() => dispatch({ type: 'MOVE_REST_DAYS', days: toggle(m.restDays, d) })} aria-label={WEEKDAY_SHORT[d]}>{WEEKDAY_SHORT[d]}</Chip>)}</div>
      </section>
      <section className="card stack" aria-labelledby="ms-goal">
        <h2 id="ms-goal" className="h3">Your own goal (optional)</h2>
        <p className="small muted">Only if you want one. It is never a target the app sets, and there is no weight or body goal here.</p>
        <div className="row wrap" style={{ gap: 12 }}>
          <div className="field"><label htmlFor="g-s">Sessions a week</label><input id="g-s" className="input" type="number" min={1} max={14} inputMode="numeric" value={m.goals.sessionsPerWeek ?? ''} placeholder="None" onChange={(e) => dispatch({ type: 'MOVE_GOALS', patch: { sessionsPerWeek: e.target.value === '' ? null : Number(e.target.value) } })} style={{ width: 110 }} /></div>
          <div className="field"><label htmlFor="g-m">Minutes a week</label><input id="g-m" className="input" type="number" min={5} max={2000} inputMode="numeric" value={m.goals.minutesPerWeek ?? ''} placeholder="None" onChange={(e) => dispatch({ type: 'MOVE_GOALS', patch: { minutesPerWeek: e.target.value === '' ? null : Number(e.target.value) } })} style={{ width: 110 }} /></div>
        </div>
        <div className="field"><label htmlFor="g-n">In your own words</label><input id="g-n" className="input" maxLength={300} value={m.goals.note} placeholder="e.g. Feel steadier on the stairs" onChange={(e) => dispatch({ type: 'MOVE_GOALS', patch: { note: e.target.value } })} /></div>
      </section>
      <section className="card stack" aria-labelledby="ms-mine">
        <div className="row between"><h2 id="ms-mine" className="h3">Your workouts</h2><Button size="sm" icon={I.plus} onClick={() => openSheet({ kind: 'workoutForm' })}>New</Button></div>
        {m.custom.length === 0 ? <p className="small muted">None yet. Build one from the exercises in the app, or from your own.</p> : m.custom.map((w) => (
          <div className="row between" key={w.id}><span><b>{w.name}</b> <span className="small muted">· {workoutMinutes(w)} min</span></span><Button size="sm" variant="ghost" onClick={() => openSheet({ kind: 'workout', id: w.id })}>Open</Button></div>
        ))}
      </section>
      <p className="xs muted">These workouts are general guidance for healthy adults, not medical advice. Move within what feels comfortable, stop if something hurts, and speak to a health professional if you are unsure or have a condition.</p>
    </div>
  );
};

/** Movement: browse and start workouts, plan them, see what you actually did, and say what suits you. */
export const Movement = () => {
  const { openSheet } = useApp();
  const route = useRoute();
  const raw = route.query.get('tab');
  const tab: Tab = TABS.some((t) => t.value === raw) ? (raw as Tab) : 'workouts';
  return (
    <div className="page">
      <PageHead title="Movement" sub="Walks, stretching and workouts at your own level. Nothing here is a target." />
      <Segmented<Tab> label="Movement sections" value={tab} onChange={(t) => navigate(`movement?tab=${t}`)} options={TABS} />
      <OwlTipCard place="movement" />
      {tab === 'workouts' && <WorkoutsTab />}
      {tab === 'plan' && <div className="stack"><div><Button variant="soft" icon={I.sparkles} onClick={() => openSheet({ kind: 'assist', feature: 'movement' })}>Plan my movement</Button></div><PlannedActivities module="movement" /></div>}
      {tab === 'progress' && <ProgressTab />}
      {tab === 'setup' && <SetupTab />}
    </div>
  );
};
