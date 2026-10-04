import { useEffect } from 'react';
import { Onboarding } from './features/onboarding/Onboarding';
import { Welcome } from './features/welcome/Welcome';
import { Today } from './features/today/Today';
import { Plan } from './features/plan/Plan';
import { Schedule } from './features/schedule/Schedule';
import { Progress } from './features/progress/Progress';
import { MyHome, EditHomeSheet } from './features/home/MyHome';
import { Supplies } from './features/supplies/Supplies';
import { Settings } from './features/settings/Settings';
import { More } from './features/settings/More';
import { JustFiveSheet } from './features/modes/JustFive';
import { TimeBoxSheet } from './features/modes/TimeBox';
import { EmergencySheet } from './features/modes/Emergency';
import { RoughDaySheet } from './features/modes/RoughDay';
import { TaskDetailSheet, RescheduleSheet } from './features/tasks/TaskDetail';
import { TaskFormSheet } from './features/tasks/TaskForm';
import { TimerBar, TimerPickSheet, TimerSheet } from './features/tasks/TimerSheet';
import { useApp } from './state/store';
import { I } from './ui/icons';
import { navigate, useRoute } from './ui/router';

const NAV = [
  { path: 'today', label: 'Today', icon: I.sun },
  { path: 'plan', label: 'Plan', icon: I.list },
  { path: 'schedule', label: 'Schedule', icon: I.calDays },
  { path: 'progress', label: 'Progress', icon: I.chart },
] as const;
const SIDE_EXTRA = [
  { path: 'home', label: 'My Home', icon: I.home },
  { path: 'supplies', label: 'Supplies', icon: I.package },
  { path: 'settings', label: 'Settings', icon: I.settings },
] as const;

const TITLES: Record<string, string> = { today: 'Today', plan: 'Plan', schedule: 'Schedule', progress: 'Progress', home: 'My Home', supplies: 'Supplies', settings: 'Settings', more: 'More' };

const SheetHost = () => {
  const { sheets } = useApp();
  const top = sheets[sheets.length - 1];
  if (!top) return null;
  switch (top.kind) {
    case 'task': return <TaskDetailSheet id={top.id} fallback={top.task} />;
    case 'timerPick': return <TimerPickSheet task={top.task} />;
    case 'timer': return <TimerSheet />;
    case 'five': return <JustFiveSheet />;
    case 'timebox': return <TimeBoxSheet />;
    case 'emergency': return <EmergencySheet />;
    case 'roughDay': return <RoughDaySheet />;
    case 'taskForm': return <TaskFormSheet editId={top.editId} />;
    case 'reschedule': return <RescheduleSheet task={top.task} />;
    case 'editHome': return <EditHomeSheet section={top.section} />;
  }
};

const Toasts = () => {
  const { toasts } = useApp();
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div className="toast" key={t.id}>
          <span>{t.message}</span>
          {t.actionLabel && <button onClick={t.onAction}>{t.actionLabel}</button>}
        </div>
      ))}
    </div>
  );
};

export const App = () => {
  const { ready, data, openSheet } = useApp();
  const route = useRoute();

  useEffect(() => {
    const p = route.path.split('/')[0];
    document.title = `${TITLES[p] ?? 'CleanFlow'} · CleanFlow`;
    window.scrollTo({ top: 0 });
  }, [route.path]);

  if (!ready) return <div className="onb" role="status" aria-label="Loading"><div className="onb-body center" style={{ justifyContent: 'center' }}><p className="muted">Loading CleanFlow…</p></div></div>;

  if (!data.onboardingComplete) {
    return route.path === 'onboarding'
      ? <Onboarding onDone={() => navigate('home?new=1')} onExit={() => navigate('')} />
      : <Welcome onStart={() => navigate('onboarding')} onDemo={() => navigate('today')} />;
  }

  const path = route.path.split('/')[0] || 'today';
  const page = (() => {
    switch (path) {
      case 'plan': return <Plan tab={route.query.get('tab')} />;
      case 'schedule': return <Schedule />;
      case 'progress': return <Progress />;
      case 'home': return <MyHome isNew={route.query.get('new') === '1'} />;
      case 'supplies': return <Supplies />;
      case 'settings': return <Settings />;
      case 'more': return <More />;
      default: return <Today />;
    }
  })();
  const moreActive = ['more', 'home', 'supplies', 'settings'].includes(path);

  return (
    <div className="app">
      <a href="#main" className="sr-only" onClick={(e) => { e.preventDefault(); document.getElementById('main')?.focus(); }}>Skip to content</a>
      <aside className="sidebar" aria-label="Main">
        <a className="brand" href="#/today"><span className="brand-mark"><I.sparkles size={20} aria-hidden /></span>CleanFlow</a>
        <nav className="stack" style={{ gap: 4 }}>
          {[...NAV, ...SIDE_EXTRA].map((n) => (
            <a key={n.path} href={`#/${n.path}`} aria-current={path === n.path ? 'page' : undefined}><n.icon size={20} aria-hidden />{n.label}</a>
          ))}
        </nav>
        <div className="spacer" />
        <button className="btn soft" onClick={() => openSheet({ kind: 'five' })}><I.timer size={18} aria-hidden /> Just 5 minutes</button>
        <button className="btn secondary" onClick={() => openSheet({ kind: 'taskForm' })}><I.plus size={18} aria-hidden /> Add a task</button>
      </aside>

      <main className="main" id="main" tabIndex={-1} style={{ outline: 'none' }}>{page}</main>

      <nav className="bottomnav" aria-label="Main">
        {NAV.map((n) => (
          <a key={n.path} href={`#/${n.path}`} aria-current={path === n.path ? 'page' : undefined}><n.icon size={22} aria-hidden />{n.label}</a>
        ))}
        <a href="#/more" aria-current={moreActive ? 'page' : undefined}><I.menu size={22} aria-hidden />More</a>
      </nav>

      <TimerBar />
      <SheetHost />
      <Toasts />
    </div>
  );
};
