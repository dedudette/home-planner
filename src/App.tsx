import { useEffect } from 'react';
import { ConfirmSheet } from './features/common/ConfirmSheet';
import { RecoveryScreen } from './features/recovery/Recovery';
import { ErrorBoundary } from './ui/ErrorBoundary';
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
/** Home and Supplies only exist for people who asked for a cleaning plan. Everyone else gets "My goals" instead of a pretend home. */
const sideExtra = (homeOn: boolean) => [
  { path: 'home', label: homeOn ? 'My Home' : 'My goals', icon: homeOn ? I.home : I.flame },
  ...(homeOn ? [{ path: 'supplies', label: 'Supplies', icon: I.package }] : []),
  { path: 'settings', label: 'Settings', icon: I.settings },
];

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
    case 'confirm': { const { kind: _k, ...o } = top; void _k; return <ConfirmSheet {...o} />; }
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

const Banners = () => {
  const { loadNotice, dismissNotice, saveError } = useApp();
  return (
    <>
      {saveError && (
        <div className="banner warn" role="alert">
          <I.info size={18} aria-hidden />
          <div>
            <b>Your latest changes could not be saved on this device.</b>
            <p className="small">{saveError === 'quota' ? 'Browser storage is full.' : 'Browser storage is blocked (private mode?).'} Export a backup in Settings so nothing is lost.</p>
          </div>
          <a className="btn sm secondary" href="#/settings">Settings</a>
        </div>
      )}
      {loadNotice && (
        <div className="banner" role="status">
          <I.info size={18} aria-hidden />
          <div><b>We tidied up your saved data.</b><p className="small">{loadNotice.join(' ')} A copy of the original is kept in Settings under Automatic backups.</p></div>
          <button className="btn sm secondary" onClick={dismissNotice}>Got it</button>
        </div>
      )}
    </>
  );
};

export const App = () => {
  const { ready, data, openSheet, recovery, startFresh, repo } = useApp();
  const route = useRoute();
  const homeOn = data.preferences.focus.includes('home');

  useEffect(() => {
    const p = route.path.split('/')[0];
    document.title = `${TITLES[p] ?? 'CleanFlow'} · CleanFlow`;
    window.scrollTo({ top: 0 });
  }, [route.path]);

  if (!ready) return <div className="onb" role="status" aria-label="Loading"><div className="onb-body center" style={{ justifyContent: 'center' }}><p className="muted">Loading CleanFlow…</p></div></div>;

  if (recovery) return <RecoveryScreen mode="unreadable" repo={repo} raw={recovery.raw} reason={recovery.reason} onStartFresh={startFresh} />;

  if (!data.onboardingComplete) {
    return route.path === 'onboarding'
      ? <Onboarding onDone={() => navigate(homeOn ? 'home?new=1' : 'today')} onExit={() => navigate('')} />
      : <Welcome onStart={() => navigate('onboarding')} onDemo={() => navigate('today')} />;
  }

  const path = route.path.split('/')[0] || 'today';
  const page = (() => {
    switch (path) {
      case 'plan': return <Plan tab={route.query.get('tab')} />;
      case 'schedule': return <Schedule />;
      case 'progress': return <Progress />;
      case 'home': return <MyHome isNew={route.query.get('new') === '1'} />;
      case 'supplies': return homeOn ? <Supplies /> : <Today />;
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
          {[...NAV, ...sideExtra(homeOn)].map((n) => (
            <a key={n.path} href={`#/${n.path}`} aria-current={path === n.path ? 'page' : undefined}><n.icon size={20} aria-hidden />{n.label}</a>
          ))}
        </nav>
        <div className="spacer" />
        <button className="btn soft" onClick={() => openSheet({ kind: 'five' })}><I.timer size={18} aria-hidden /> Just 5 minutes</button>
        <button className="btn secondary" onClick={() => openSheet({ kind: 'taskForm' })}><I.plus size={18} aria-hidden /> Add a task</button>
      </aside>

      <main className="main" id="main" tabIndex={-1} style={{ outline: 'none' }}>
        <Banners />
        <ErrorBoundary scope="page" resetKey={path}>{page}</ErrorBoundary>
      </main>

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
