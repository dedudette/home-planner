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
import { Patterns } from './features/patterns/Patterns';
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
import { ActivityFormSheet } from './features/activities/ActivityForm';
import { TimerBar, TimerPickSheet, TimerSheet } from './features/tasks/TimerSheet';
import { Meals } from './features/meals/Meals';
import { Movement } from './features/movement/Movement';
import { Wellbeing } from './features/wellbeing/Wellbeing';
import { Learning } from './features/learning/Learning';
import { BookFormSheet, InterestFormSheet, InterestSheet, StarterSheet } from './features/learning/InterestSheets';
import { LogSessionSheet } from './features/learning/LogSession';
import { AssistSheet } from './features/assist/AssistSheet';
import { ReminderRuntime } from './state/ReminderRuntime';
import { JournalSheet } from './features/wellbeing/Journal';
import { WaterEditSheet } from './features/wellbeing/WaterPanel';
import { WorkoutDetailSheet } from './features/movement/WorkoutDetail';
import { WorkoutSessionSheet } from './features/movement/WorkoutSession';
import { WorkoutFormSheet } from './features/movement/WorkoutForm';
import { MealPickerSheet } from './features/meals/MealPicker';
import { MealEditSheet } from './features/meals/MealEdit';
import { DishFormSheet } from './features/meals/DishForm';
import { RecipeDetailSheet } from './features/meals/RecipeDetail';
import { ShopGenSheet, ShopItemSheet, ShopReviewSheet } from './features/meals/ShoppingTab';
import { PRIMARY, SETTINGS_ITEM, sectionsFor } from './features/nav';
import { useApp } from './state/store';
import { I } from './ui/icons';
import { navigate, useRoute } from './ui/router';

const TITLES: Record<string, string> = { today: 'Today', plan: 'Plan', schedule: 'Schedule', progress: 'Progress', patterns: 'Your patterns', home: 'Home', supplies: 'Supplies', settings: 'Settings', more: 'More', movement: 'Movement', meals: 'Meals & shopping', learning: 'Learning & hobbies', wellbeing: 'Wellbeing' };

/** A section the person switched off. The page says so and how to bring it back; their data in it is untouched. */
const SectionOff = ({ path }: { path: string }) => (
  <div className="page">
    <div className="empty">
      <I.info size={34} aria-hidden />
      <h2 className="h3" style={{ marginTop: 8 }}>{TITLES[path]} is switched off</h2>
      <div className="small" style={{ marginTop: 6 }}>Turn it on in Settings. Anything you planned in it is still saved.</div>
      <a className="btn sm" style={{ marginTop: 12 }} href="#/settings">Open Settings</a>
    </div>
  </div>
);

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
    case 'activityForm': return <ActivityFormSheet editId={top.editId} defaults={top.defaults} />;
    case 'recipe': return <RecipeDetailSheet id={top.id} />;
    case 'journal': return <JournalSheet editId={top.editId} />;
    case 'waterEdit': return <WaterEditSheet id={top.id} />;
    case 'workout': return <WorkoutDetailSheet id={top.id} />;
    case 'workoutSession': return <WorkoutSessionSheet workoutId={top.workoutId} taskId={top.taskId} />;
    case 'workoutForm': return <WorkoutFormSheet editId={top.editId} />;
    case 'interest': return <InterestSheet id={top.id} />;
    case 'interestForm': return <InterestFormSheet />;
    case 'starter': return <StarterSheet catalogId={top.catalogId} starterId={top.starterId} />;
    case 'logSession': return <LogSessionSheet interestId={top.interestId} starterId={top.starterId} bookId={top.bookId} minutes={top.minutes} taskId={top.taskId} />;
    case 'bookForm': return <BookFormSheet editId={top.editId} />;
    case 'assist': return <AssistSheet feature={top.feature} />;
    case 'dishForm': return <DishFormSheet editId={top.editId} />;
    case 'mealPicker': return <MealPickerSheet date={top.date} slot={top.slot} tab={top.tab} />;
    case 'mealEdit': return <MealEditSheet id={top.id} />;
    case 'shopGen': return <ShopGenSheet />;
    case 'shopReview': return <ShopReviewSheet listId={top.listId} />;
    case 'shopItem': return <ShopItemSheet listId={top.listId} itemId={top.itemId} />;
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
  const sections = sectionsFor(data);

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
      case 'patterns': return <Patterns />;
      case 'home': return <MyHome isNew={route.query.get('new') === '1'} />;
      case 'supplies': return homeOn ? <Supplies /> : <Today />;
      case 'meals': return sections.some((x) => x.path === path) ? <Meals /> : <SectionOff path={path} />;
      case 'movement': return sections.some((x) => x.path === path) ? <Movement /> : <SectionOff path={path} />;
      case 'wellbeing': return sections.some((x) => x.path === path) ? <Wellbeing /> : <SectionOff path={path} />;
      case 'learning': return sections.some((x) => x.path === path) ? <Learning /> : <SectionOff path={path} />;
      case 'settings': return <Settings />;
      case 'more': return <More />;
      default: return <Today />;
    }
  })();
  const navPath = path === 'patterns' ? 'progress' : path;
  const moreActive = !PRIMARY.some((n) => n.path === navPath);

  return (
    <div className="app">
      <a href="#main" className="sr-only" onClick={(e) => { e.preventDefault(); document.getElementById('main')?.focus(); }}>Skip to content</a>
      <aside className="sidebar" aria-label="Main">
        <a className="brand" href="#/today"><span className="brand-mark"><I.sparkles size={20} aria-hidden /></span>CleanFlow</a>
        <nav className="stack" style={{ gap: 4 }}>
          {[...PRIMARY, ...sections, SETTINGS_ITEM].map((n) => (
            <a key={n.path} href={`#/${n.path}`} aria-current={navPath === n.path ? 'page' : undefined}><n.icon size={20} aria-hidden />{n.label}</a>
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
        {PRIMARY.map((n) => (
          <a key={n.path} href={`#/${n.path}`} aria-current={navPath === n.path ? 'page' : undefined}><n.icon size={22} aria-hidden />{n.label}</a>
        ))}
        <a href="#/more" aria-current={moreActive ? 'page' : undefined}><I.menu size={22} aria-hidden />More</a>
      </nav>

      <TimerBar />
      <SheetHost />
      <Toasts />
      <ReminderRuntime />
    </div>
  );
};
