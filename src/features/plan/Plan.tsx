import { useMemo, useState } from 'react';
import { addDays, formatDay, formatMinutes } from '../../domain/dates';
import { occurrencesPerWeek } from '../../domain/engine';
import {
  ROOM_MODE_LABEL, SECTION_LABEL, availableRoomModes, groupVisual, roomTasks, sectionId, sectionTasks, type SectionId,
} from '../../domain/view';
import { WEEKDAY_SHORT } from '../../domain/dates';
import { DOMAIN_SHORT, TIME_LABEL } from '../../domain/options';
import { SAFETY_LINE } from '../../domain/lifeCatalog';
import type { Domain } from '../../domain/types';
import { DOMAIN_ICON, TIME_ICON } from '../../ui/icons';
import type { RoomKind, Task } from '../../domain/types';
import { useApp } from '../../state/store';
import { I, ROOM_ICON } from '../../ui/icons';
import { Button, Chip, Empty, PageHead, Segmented } from '../../ui/primitives';
import { navigate } from '../../ui/router';
import { TaskCard } from '../tasks/TaskCard';
import { GoalCoverageCard } from './GoalCoverage';

const SECTION_HELP: Record<SectionId, string> = {
  today: "What's on for today, sized to your session length.",
  quick: 'Small jobs with a big visible payoff. Great for when you only have a few minutes.',
  reset: 'One-time steps that bring your home back under control. Done in order, once.',
  daily: 'Short daily habits that stop things piling up.',
  weekly: 'Your weekly rhythm, spread across your cleaning days.',
  biweekly: 'Done every second week.',
  monthly: 'Once a month. Light but easy to forget.',
  seasonal: 'About every three months.',
  routine: 'Habits that belong to a morning, afternoon or evening routine.',
  challenge: 'Optional. One small step above your current level. They are never added to your schedule unless you choose.',
  deep: 'Bigger one-off jobs. Pick a room, and do them when you have the energy.',
  backlog: 'Tasks that did not fit into your weekly time. Add any of them to your week whenever you like.',
};

const DoneRow = ({ task }: { task: Task }) => {
  const { data, dispatch, today } = useApp();
  const st = data.taskStates[task.id];
  if (!st?.done) return <TaskCard task={task} />;
  return (
    <div className="stack" style={{ gap: 6 }}>
      <TaskCard task={task} done hideTimer hideMenu note={st.lastDone ? `Done ${formatDay(st.lastDone, today)}` : 'Done'} />
      <div><Button size="sm" variant="ghost" icon={I.undo} onClick={() => dispatch({ type: 'TASK_PATCH', id: task.id, patch: { done: false, due: null } })}>Do it again</Button></div>
    </div>
  );
};

const GroupTitle = ({ section, task, label }: { section: SectionId; task: Task; label: string }) => {
  const v = groupVisual(section, task);
  const Icon = v.kind === 'time' ? TIME_ICON[v.time] : v.kind === 'domain' ? DOMAIN_ICON[v.domain] : ROOM_ICON[v.room];
  return <div className="group-title" data-group-icon={`${v.kind}:${v.kind === 'time' ? v.time : v.kind === 'domain' ? v.domain : v.room}`}><Icon size={16} aria-hidden /> {label}</div>;
};

const groupBy = (tasks: Task[], key: (t: Task) => string): [string, Task[]][] => {
  const m = new Map<string, Task[]>();
  for (const t of tasks) m.set(key(t), [...(m.get(key(t)) ?? []), t]);
  return [...m.entries()];
};

const Overview = () => {
  const { view, plan, data, openSheet } = useApp();
  const homeOn = data.preferences.focus.includes('home');
  const [section, setSection] = useState<SectionId>('today');
  const [showWhy, setShowWhy] = useState(false);
  const [domain, setDomain] = useState<Domain | 'all'>('all');
  const domains = useMemo(() => [...new Set(view.tasks.map((t) => t.domain ?? 'home'))] as Domain[], [view]);
  const activeDomain = domain === 'all' || domains.includes(domain) ? domain : 'all';
  const counts = useMemo(() => Object.fromEntries(sectionId.map((s) => [s, sectionTasks(view, s, activeDomain).length])) as Record<SectionId, number>, [view, activeDomain]);
  const ids = sectionId.filter((s) => counts[s] > 0 || s === 'today' || (s === 'daily' && homeOn));
  const current = ids.includes(section) ? section : 'today';
  const tasks = sectionTasks(view, current, activeDomain);
  const grouped = ['weekly', 'biweekly', 'monthly', 'seasonal', 'backlog', 'reset', 'routine', 'challenge'].includes(current);
  const groupName = (t: Task) => (current === 'routine' ? TIME_LABEL[t.timeOfDay ?? 'anytime'] : current === 'challenge' ? DOMAIN_SHORT[t.domain ?? 'home'] : t.roomName);
  const showSafety = tasks.some((t) => t.domain && SAFETY_LINE[t.domain as 'fitness' | 'breathing']);
  const days = [...plan.activeDays].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => WEEKDAY_SHORT[d]).join(', ');
  const weekMinutes = Math.round(view.tasks.filter((t) => t.tier === 'maintenance' && !t.backlog && t.frequency !== 'once').reduce((s, t) => s + t.minutes * occurrencesPerWeek(t.frequency, plan.activeDays.length, t.habit), 0));
  return (
    <>
      <div className="card tint stack">
        <div className="row between wrap">
          <div>
            <h2 className="h3">Your plan at a glance</h2>
            <p className="small muted">{homeOn
              ? `${plan.stats.recurringCount} recurring tasks · about ${formatMinutes(weekMinutes)} a week · ${plan.sessionMinutes}-minute sessions on ${days}`
              : `${plan.stats.lifeCount} daily habits · about ${plan.stats.lifeDailyMinutes} min a day · a ${plan.sessionMinutes}-minute daily goal`}</p>
          </div>
          <Button size="sm" variant="soft" onClick={() => setShowWhy((s) => !s)} aria-expanded={showWhy} icon={I.info}>{showWhy ? 'Hide' : 'Why this plan?'}</Button>
        </div>
        {showWhy && (
          <div className="note-list">
            {plan.notes.map((n) => {
              const Ic = (I as Record<string, typeof I.home>)[n.icon] ?? I.sparkles;
              return <div className="note" key={n.id}><span className="ic"><Ic size={18} aria-hidden /></span><div><p className="strong small">{n.title}</p><p className="small muted">{n.detail}</p></div></div>;
            })}
          </div>
        )}
      </div>

      <GoalCoverageCard />

      {domains.length > 1 && (
        <div className="chips scroll" role="group" aria-label="Filter by area">
          <Chip small on={activeDomain === 'all'} onClick={() => setDomain('all')}>All areas</Chip>
          {domains.map((d) => { const Ic = DOMAIN_ICON[d]; return <Chip small key={d} on={activeDomain === d} onClick={() => setDomain(d)}><Ic size={14} aria-hidden /> {DOMAIN_SHORT[d]}</Chip>; })}
        </div>
      )}
      <div className="chips scroll" role="tablist" aria-label="Plan sections">
        {ids.map((s) => (
          <Chip key={s} role="tab" on={current === s} onClick={() => setSection(s)} aria-selected={current === s}>{SECTION_LABEL[s].toUpperCase()} <span className="chip-count">{counts[s]}</span></Chip>
        ))}
      </div>
      <p className="small muted">{SECTION_HELP[current]}</p>
      {showSafety && <div className="hint"><I.shield size={18} aria-hidden /><div>Exercise and breathing tasks are general guidance, not medical advice. Go at your own pace, and stop if anything hurts or feels wrong.</div></div>}
      <div className="stack">
        {tasks.length === 0 && <Empty title="Nothing here right now">{current === 'today' ? 'No tasks are scheduled today.' : 'Nothing in this section.'}</Empty>}
        {grouped
          ? groupBy(tasks, groupName).map(([room, ts]) => (
            <div className="stack" key={room}>
              <GroupTitle section={current} task={ts[0]} label={room} />
              <div className="tasklist">{ts.map((t) => <DoneRow key={t.id} task={t} />)}</div>
            </div>
          ))
          : <div className="tasklist">{tasks.map((t) => <DoneRow key={t.id} task={t} />)}</div>}
      </div>
      {data.customTasks.length === 0 && <Button variant="secondary" icon={I.plus} onClick={() => openSheet({ kind: 'taskForm' })}>Add your own task</Button>}
    </>
  );
};

const ByRoom = () => {
  const { view, data, today } = useApp();
  const modes = availableRoomModes(view);
  const [mode, setMode] = useState<RoomKind>(modes[0] ?? 'kitchen');
  if (!view.tasks.some((t) => (t.domain ?? 'home') === 'home')) return <Empty title="No home tasks in your plan">Room view is for your cleaning plan. Add "Keep my home clean" under My Home to use it.</Empty>;
  const current = modes.includes(mode) ? mode : modes[0];
  const tasks = roomTasks(view, current);
  const upcoming = tasks.filter((t) => t.tier !== 'deep' && !t.backlog);
  const deep = tasks.filter((t) => t.tier === 'deep');
  const backlog = tasks.filter((t) => t.backlog && t.tier !== 'deep');
  const mins = upcoming.filter((t) => t.frequency !== 'once').reduce((s, t) => s + t.minutes * occurrencesPerWeek(t.frequency, view.plan.activeDays.length, t.habit), 0);
  const order = ['daily', 'twice-weekly', 'weekly', 'biweekly', 'monthly', 'seasonal', 'once'];
  const grouped = order.map((f) => [f, upcoming.filter((t) => t.frequency === f)] as const).filter(([, ts]) => ts.length);
  const label = { daily: 'Daily', 'twice-weekly': 'Twice a week', weekly: 'Weekly', biweekly: 'Every 2 weeks', monthly: 'Monthly', seasonal: 'Seasonal', once: 'One-time' } as Record<string, string>;
  void data; void today;
  return (
    <>
      <p className="muted small">Pick a space to see only its tasks. Rooms you don't have aren't listed, and you can add more under My Home.</p>
      <div className="chips scroll" role="tablist" aria-label="Rooms">
        {modes.map((k) => { const R = ROOM_ICON[k]; return <Chip key={k} role="tab" aria-selected={current === k} on={current === k} onClick={() => setMode(k)}><R size={16} aria-hidden /> {ROOM_MODE_LABEL[k]}</Chip>; })}
      </div>
      <div className="card soft row between wrap">
        <div><h2 className="h3">{ROOM_MODE_LABEL[current]}</h2><p className="small muted">{upcoming.length} task{upcoming.length === 1 ? '' : 's'}{mins ? ` · about ${formatMinutes(Math.round(mins))} a week` : ''}</p></div>
      </div>
      {tasks.length === 0 && <Empty title="No tasks for this space yet" />}
      {grouped.map(([f, ts]) => (
        <section className="stack" key={f}>
          <div className="group-title"><I.repeat size={16} aria-hidden /> {label[f]}</div>
          <div className="tasklist">{ts.map((t) => <DoneRow key={t.id} task={t} />)}</div>
        </section>
      ))}
      {deep.length > 0 && (
        <section className="stack">
          <div className="group-title"><I.sparkles size={16} aria-hidden /> Deep clean for this space</div>
          <div className="tasklist">{deep.map((t) => <DoneRow key={t.id} task={t} />)}</div>
        </section>
      )}
      {backlog.length > 0 && (
        <section className="stack">
          <div className="group-title"><I.archive size={16} aria-hidden /> Backlog (didn't fit your week)</div>
          <div className="tasklist">{backlog.map((t) => <DoneRow key={t.id} task={t} />)}</div>
        </section>
      )}
    </>
  );
};

const Deep = () => {
  const { view, dispatch, toast, today, plan } = useApp();
  const tasks = sectionTasks(view, 'deep');
  const rooms = useMemo(() => {
    const m = new Map<string, { kind: RoomKind; tasks: Task[] }>();
    for (const t of tasks) { const e = m.get(t.roomName) ?? { kind: t.roomKind, tasks: [] }; e.tasks.push(t); m.set(t.roomName, e); }
    const order = ['kitchen', 'bathroom', 'bedroom', 'living', 'dining', 'office', 'laundry', 'hallway'];
    return [...m.entries()].sort((a, b) => (order.indexOf(a[1].kind) + 1 || 99) - (order.indexOf(b[1].kind) + 1 || 99));
  }, [tasks]);
  const scheduleRoom = (ts: Task[]) => {
    const todo = ts.filter((t) => !view.states[t.id]?.done);
    let d = addDays(today, 1);
    let n = 0;
    for (const t of todo) {
      while (!plan.activeDays.includes(new Date(`${d}T12:00:00`).getDay())) d = addDays(d, 1);
      dispatch({ type: 'TASK_PATCH', id: t.id, patch: { due: d } });
      d = addDays(d, 1); n++;
    }
    toast(`${n} deep-clean task${n === 1 ? '' : 's'} added to your upcoming days, one per cleaning day.`);
  };
  return (
    <>
      <div className="card tint stack">
        <div className="row"><I.sparkles size={22} aria-hidden style={{ color: 'var(--primary)' }} /><h2 className="h3">Deep clean mode</h2></div>
        <p className="small">The big, satisfying jobs. They only appear for rooms you actually have. Pick one room, schedule it across your cleaning days, or just do a single task when you're in the mood.</p>
      </div>
      {rooms.length === 0 && <Empty title="No deep-clean tasks yet" />}
      {rooms.map(([name, r]) => {
        const R = ROOM_ICON[r.kind];
        const left = r.tasks.filter((t) => !view.states[t.id]?.done);
        const mins = left.reduce((s, t) => s + t.minutes, 0);
        return (
          <section className="stack" key={name} aria-label={`${name} deep clean`}>
            <div className="row between wrap">
              <div className="group-title" style={{ margin: 0 }}><R size={18} aria-hidden /> {name} <span className="muted small">· {left.length} left · {formatMinutes(mins)}</span></div>
              {left.length > 0 && <Button size="sm" variant="soft" icon={I.calDays} onClick={() => scheduleRoom(r.tasks)}>Schedule this room</Button>}
            </div>
            <div className="tasklist">{r.tasks.map((t) => <DoneRow key={t.id} task={t} />)}</div>
          </section>
        );
      })}
    </>
  );
};

export const Plan = ({ tab }: { tab: string | null }) => {
  const { openSheet, data } = useApp();
  const homeOn = data.preferences.focus.includes('home');
  const current = homeOn && (tab === 'rooms' || tab === 'deep') ? tab : 'overview';
  return (
    <div className="page">
      <PageHead title="Your plan" sub="Built from your home, your time and your energy."
        action={<Button variant="soft" size="sm" icon={I.plus} onClick={() => openSheet({ kind: 'taskForm' })}>Add task</Button>} />
      {homeOn && (
        <Segmented label="Plan views" value={current} onChange={(v) => navigate(v === 'overview' ? 'plan' : `plan?tab=${v}`)}
          options={[{ value: 'overview', label: 'Overview' }, { value: 'rooms', label: 'By room' }, { value: 'deep', label: 'Deep clean' }]} />
      )}
      {current === 'overview' ? <Overview /> : current === 'rooms' ? <ByRoom /> : <Deep />}
    </div>
  );
};
