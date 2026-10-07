import { useMemo } from 'react';
import { WEEKDAY_SHORT, formatMinutes, weekday } from '../../domain/dates';
import { computeProgress } from '../../domain/progress';
import { useApp } from '../../state/store';
import { DOMAIN_ICON, I, ROOM_ICON } from '../../ui/icons';
import { BarChart, Empty, PageHead, RingStat } from '../../ui/primitives';
import { InsightCard, useInsights } from '../today/Insights';

export const Progress = () => {
  const { view, data } = useApp();
  const focus = data.preferences.focus;
  const homeOnly = focus.every((f) => f === 'home');
  const homeOn = focus.includes('home');
  const p = useMemo(() => computeProgress(view), [view]);
  const insights = useInsights();
  const maxRoom = Math.max(1, ...p.rooms.map((r) => r.tasks));
  const maxArea = Math.max(1, ...p.areas.map((a) => a.tasks));
  const empty = p.tasksCompleted === 0;
  const msg = p.streak >= 3 ? `${p.streak} days in a row. Rest days don't break it.` : p.streak > 0 ? 'You have momentum. Keep it gentle.' : 'Every task you finish starts the count.';
  return (
    <div className="page">
      <PageHead title="Your progress" sub="A record of what you've done, not a scorecard." />

      <div className="stat-grid">
        <div className="stat"><div className="v">{p.tasksCompleted}</div><div className="l">Tasks completed</div></div>
        <div className="stat"><div className="v">{formatMinutes(p.minutesCleaned)}</div><div className="l">{homeOnly ? 'Minutes cleaned' : 'Active minutes'}</div></div>
        <div className="stat"><div className="v">{p.streak}<span className="small muted"> {p.streak === 1 ? 'day' : 'days'}</span></div><div className="l">Current streak</div></div>
        <div className="stat"><div className="v">{p.sessions}</div><div className="l">{homeOnly ? 'Cleaning sessions' : 'Sessions'}</div></div>
      </div>
      <div className="card tint row"><I.sparkles size={20} aria-hidden style={{ color: 'var(--primary)' }} /><p className="small">{msg}{p.bestStreak > p.streak ? ` Your best so far: ${p.bestStreak} days.` : ''}</p></div>

      {empty && <Empty title="Your first completed task will show up here">Start with "Just 5 minutes" on the Today tab. It counts.</Empty>}

      <div className="profile-grid">
        <section className="card stack" aria-labelledby="wk">
          <h2 id="wk" className="h3">Weekly completion</h2>
          <RingStat value={p.weekPlanned ? p.weekDone / p.weekPlanned : 0} label="This week" sub={`${p.weekDone} of ${p.weekPlanned} planned tasks`} />
          <hr className="sep" />
          <RingStat value={p.monthPlanned ? p.monthDone / p.monthPlanned : 0} label="This month" sub={`${p.monthDone} of ${p.monthPlanned} planned tasks`} />
        </section>
        <section className="card stack" aria-labelledby="l7">
          <h2 id="l7" className="h3">Last 7 days · {homeOnly ? 'minutes cleaned' : 'active minutes'}</h2>
          <BarChart label={`${homeOnly ? 'Minutes cleaned' : 'Active minutes'} in the last 7 days`} unit="minutes" data={p.last7.map((d) => ({ label: WEEKDAY_SHORT[weekday(d.date)], value: d.minutes }))} />
        </section>
        <section className="card stack" aria-labelledby="w4">
          <h2 id="w4" className="h3">Last 4 weeks · tasks completed</h2>
          <BarChart label="Tasks completed per week" unit="tasks" data={p.weeks.map((w) => ({ label: w.label, value: w.tasks }))} />
        </section>
        {(homeOn || p.rooms.length > 0) && <section className="card stack" aria-labelledby="rm">
          <div className="row between"><h2 id="rm" className="h3">Rooms completed</h2><span className="small muted">{p.roomsRefreshedThisWeek} refreshed this week</span></div>
          {p.rooms.length === 0 ? <p className="small muted">Rooms will appear as you finish tasks.</p> : p.rooms.slice(0, 7).map((r) => {
            const R = ROOM_ICON[r.kind];
            return (
              <div className="hbar" key={r.kind}>
                <span className="row" style={{ gap: 6 }}><R size={16} aria-hidden />{r.name}</span>
                <div className="track"><div className="fill" style={{ width: `${(r.tasks / maxRoom) * 100}%` }} /></div>
                <span className="small strong">{r.tasks}</span>
              </div>
            );
          })}
        </section>}
        {p.areas.length > 0 && (
          <section className="card stack" aria-labelledby="areas">
            <h2 id="areas" className="h3">Life areas</h2>
            {p.areas.map((a) => {
              const Ic = DOMAIN_ICON[a.domain];
              return (
                <div className="hbar" key={a.domain}>
                  <span className="row" style={{ gap: 6 }}><Ic size={16} aria-hidden />{a.name}</span>
                  <div className="track"><div className="fill" style={{ width: `${(a.tasks / maxArea) * 100}%` }} /></div>
                  <span className="small strong">{a.tasks}</span>
                </div>
              );
            })}
          </section>
        )}
      </div>

      <section className="stack" aria-labelledby="learn">
        <div className="section-title"><h2 id="learn">What CleanFlow has noticed</h2></div>
        {insights.length ? insights.map((i) => <InsightCard key={i.id} insight={i} />) : (
          <div className="card soft"><p className="small muted">As you use CleanFlow it learns what works for you. If you often skip long sessions, it will suggest shorter ones. If a routine is going well, it will keep it as is. Nothing changes without asking you first.</p></div>
        )}
      </section>
    </div>
  );
};
