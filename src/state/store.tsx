import {
  createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode,
} from 'react';
import { emptyAppData, uid } from '../domain/appdata';
import { todayISO } from '../domain/dates';
import { generatePlan, type Plan } from '../domain/engine';
import { buildExposure, hasNewExposure } from '../domain/exposure';
import { planVersionOf, snapshotPlanVersion } from '../domain/planVersion';
import {
  extendTimer, pauseTimer, resolveTimerTask, resumeTimer, startTimer, tick, elapsedMinutes, type TimerState,
} from '../domain/timer';
import type { AppData, ISODate, RecommendationEvent, Task } from '../domain/types';
import { buildView, type PlanView } from '../domain/view';
import { LocalStorageRepository, type LoadResult, type Repository } from '../storage/repository';
import { hasUserData } from '../storage/schema';
import { reducer, type Action, type Stamp } from './reducer';
import { playChime } from './chime';

export type EditSection = 'type' | 'size' | 'rooms' | 'people' | 'pets' | 'state' | 'style' | 'energy' | 'goals' | 'focus';

export interface ConfirmOptions {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  /** Optional extra action shown next to Cancel (for example "Download a backup first"). */
  extra?: { label: string; run: () => void };
  onConfirm: () => void;
}

export type Sheet =
  | { kind: 'task'; id: string; task?: Task }
  | { kind: 'timerPick'; task: Task }
  | { kind: 'timer' }
  | { kind: 'five' }
  | { kind: 'timebox' }
  | { kind: 'emergency' }
  | { kind: 'roughDay' }
  | { kind: 'taskForm'; editId?: string }
  | { kind: 'reschedule'; task: Task }
  | { kind: 'editHome'; section: EditSection }
  | ({ kind: 'confirm' } & ConfirmOptions);

export interface Toast { id: number; message: string; actionLabel?: string; onAction?: () => void }

export interface Recovery { raw: string; reason: string }

interface Store {
  ready: boolean;
  data: AppData;
  dispatch: (a: Action) => void;
  plan: Plan;
  view: PlanView;
  today: ISODate;
  /** Local hour of day (0-23). Drives the Now / Later / Evening split on Today. */
  hour: number;
  stamp: () => Stamp;
  repo: Repository;
  // data safety
  recovery: Recovery | null;
  startFresh: () => void;
  loadNotice: string[] | null;
  dismissNotice: () => void;
  saveError: 'quota' | 'blocked' | null;
  /** Replace everything with `next` after taking an automatic backup. Always call this instead of dispatching LOAD for user-initiated replacement. */
  replaceAll: (next: AppData, reason: string, message: string) => void;
  confirm: (o: ConfirmOptions) => void;
  // task actions
  complete: (task: Task, opts?: { minutes?: number; via?: 'checkoff' | 'timer' | 'five' | 'timebox' | 'reset' | 'plan'; quiet?: boolean }) => void;
  skip: (task: Task, opts?: { quiet?: boolean }) => void;
  snooze: (task: Task) => void;
  moveTo: (task: Task, date: ISODate, label?: string) => void;
  recordRec: (e: Omit<RecommendationEvent, 'id' | 'at' | 'date' | 'localHour' | 'planVersion'>) => void;
  // ui
  sheets: Sheet[];
  openSheet: (s: Sheet) => void;
  closeSheet: () => void;
  closeAllSheets: () => void;
  toasts: Toast[];
  toast: (message: string, action?: { label: string; run: () => void }) => void;
  // timer
  timer: TimerState | null;
  timerNow: number;
  beginTimer: (task: Task, minutes: number) => void;
  pauseResume: () => void;
  addTime: (minutes: number) => void;
  finishTimer: (outcome: 'complete' | 'skip' | 'stop') => void;
  discardTimer: () => void;
}

const Ctx = createContext<Store | null>(null);

export const useApp = (): Store => {
  const s = useContext(Ctx);
  if (!s) throw new Error('useApp must be used inside <AppProvider>');
  return s;
};

const TIMER_KEY = 'cleanflow:timer';
const DONE_LINES = ['Nice. That counts.', 'Done. One less thing.', 'Good work.', 'That helps.', 'Progress made.'];
const SAVE_DELAY = 250;

export const defaultRepo: Repository = new LocalStorageRepository();

// ───────────── state: data plus a sequence number, so we know exactly which actions a save contains ─────────────

interface Wrapped { data: AppData; seq: number }
interface Pending { seq: number; a: Action }
type Internal =
  | { kind: 'act'; a: Action; seq: number }
  | { kind: 'adopt'; data: AppData; replay: Pending[]; seq: number };

const wrappedReducer = (s: Wrapped, i: Internal): Wrapped =>
  i.kind === 'act'
    ? { data: reducer(s.data, i.a), seq: i.seq }
    // Someone else changed the saved data: take theirs as the base and re-apply our own unsaved actions on top.
    : { data: i.replay.reduce((d, p) => reducer(d, p.a), i.data), seq: i.seq };

const nowStamp = (): Stamp => { const d = new Date(); return { now: d.toISOString(), today: todayISO(), hour: d.getHours(), tz: d.getTimezoneOffset() }; };

export const AppProvider = ({ children, repo = defaultRepo }: { children: ReactNode; repo?: Repository }) => {
  const [state, rawDispatch] = useReducer(wrappedReducer, undefined, () => ({ data: emptyAppData(), seq: 0 }));
  const data = state.data;
  const [ready, setReady] = useState(false);
  const [recovery, setRecovery] = useState<Recovery | null>(null);
  const [loadNotice, setLoadNotice] = useState<string[] | null>(null);
  const [saveError, setSaveError] = useState<'quota' | 'blocked' | null>(null);
  const [today, setToday] = useState<ISODate>(todayISO());
  const [hour, setHour] = useState(new Date().getHours());

  // Mirror of the data that updates *synchronously* on dispatch, so back-to-back actions in one tick see each other.
  const mirror = useRef<AppData>(data);
  const stateRef = useRef(state);
  stateRef.current = state;
  const seqRef = useRef(0);
  const pending = useRef<Pending[]>([]);
  const savedSeq = useRef(0);
  const rev = useRef(0);
  const saveBlocked = useRef(true); // true until a load decides what is safe to write
  const timerRef0 = useRef<number | null>(null);

  const dispatch = useCallback((a: Action) => {
    const seq = ++seqRef.current;
    mirror.current = reducer(mirror.current, a);
    pending.current.push({ seq, a });
    rawDispatch({ kind: 'act', a, seq });
  }, []);

  /** Take `base` as the truth and put our unsaved actions back on top of it. */
  const adopt = useCallback((base: AppData, baseRev: number, opts: { clean?: boolean } = {}) => {
    const seq = ++seqRef.current;
    const replay = opts.clean ? [] : [...pending.current];
    mirror.current = replay.reduce((d, p) => reducer(d, p.a), base);
    rev.current = baseRev;
    if (opts.clean) { pending.current = []; savedSeq.current = seq; }
    rawDispatch({ kind: 'adopt', data: base, replay, seq });
  }, []);

  // ── load once ──
  useEffect(() => {
    let alive = true;
    repo.load().then((r: LoadResult) => {
      if (!alive) return;
      if (r.status === 'unreadable') {
        setRecovery({ raw: r.raw ?? '', reason: r.reason ?? 'The saved data could not be read.' });
        saveBlocked.current = true; // never write over data we could not read
      } else {
        saveBlocked.current = false;
        if (r.data) {
          // A migrated or repaired file should be rewritten in the current format; a "newer" one stays untouched until the user acts.
          adopt(r.data, r.rev, { clean: r.status === 'ok' || r.status === 'newer' });
          if (r.status === 'repaired' || r.status === 'newer') setLoadNotice(r.repairs.length ? r.repairs : ['Your data was opened in a compatible way.']);
        } else rev.current = r.rev;
      }
      setReady(true);
    });
    return () => { alive = false; };
  }, [repo, adopt]);

  // ── saving: debounced, revision-checked, merged on conflict ──
  const saveNow = useCallback(async () => {
    if (saveBlocked.current) return;
    const snap = stateRef.current;
    if (snap.seq <= savedSeq.current) return;
    const res = await repo.save(snap.data, rev.current);
    if (res.ok) {
      rev.current = res.rev; savedSeq.current = Math.max(savedSeq.current, snap.seq);
      pending.current = pending.current.filter((p) => p.seq > snap.seq);
      setSaveError(null);
    } else if (res.conflict) {
      adopt(res.conflict, res.rev); // another tab saved first: merge, and the effect below saves the merged result
    } else if (res.error) setSaveError(res.error);
  }, [repo, adopt]);

  useEffect(() => {
    if (!ready || saveBlocked.current) return;
    if (state.seq <= savedSeq.current) return;
    timerRef0.current = window.setTimeout(() => { void saveNow(); }, SAVE_DELAY);
    return () => { if (timerRef0.current) window.clearTimeout(timerRef0.current); };
  }, [state.seq, ready, saveNow]);

  // Flush right away when the page is hidden or closing: the debounce must never cost the user their last action.
  useEffect(() => {
    const flush = () => {
      if (saveBlocked.current || !repo.saveSync) return;
      const snap = stateRef.current;
      if (snap.seq <= savedSeq.current) return;
      let toSave = mirror.current;
      for (let i = 0; i < 2; i++) {
        const res = repo.saveSync(toSave, rev.current);
        if (res.ok) { rev.current = res.rev; savedSeq.current = snap.seq; pending.current = []; return; }
        if (!res.conflict) return;
        toSave = pending.current.reduce((d, p) => reducer(d, p.a), res.conflict);
        rev.current = res.rev;
      }
    };
    const onVis = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', onVis);
    return () => { window.removeEventListener('pagehide', flush); window.removeEventListener('beforeunload', flush); document.removeEventListener('visibilitychange', onVis); };
  }, [repo]);

  // ── other tabs: merge their changes in as soon as they happen (and when this tab wakes up) ──
  useEffect(() => {
    const merge = (r: LoadResult) => {
      if (saveBlocked.current || !r.data || r.rev <= rev.current) return;
      adopt(r.data, r.rev);
    };
    const unsub = repo.subscribe?.(merge);
    const onShow = () => { if (document.visibilityState === 'visible') void repo.load().then(merge); };
    document.addEventListener('visibilitychange', onShow);
    window.addEventListener('pageshow', onShow);
    return () => { unsub?.(); document.removeEventListener('visibilitychange', onShow); window.removeEventListener('pageshow', onShow); };
  }, [repo, adopt]);

  // roll over at midnight / when the tab wakes up; keep the hour fresh for Now / Later
  useEffect(() => {
    const check = () => { setToday((cur) => { const n = todayISO(); return n === cur ? cur : n; }); setHour(new Date().getHours()); };
    const id = window.setInterval(check, 30_000);
    document.addEventListener('visibilitychange', check);
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', check); };
  }, []);

  const stamp = useCallback((): Stamp => nowStamp(), []);

  const plan = useMemo(
    () => generatePlan(data.home, data.preferences, data.plan),
    [data.home, data.preferences, data.plan],
  );
  const view = useMemo(() => buildView(data, plan, today), [data, plan, today]);

  // ── analytics foundation: plan versions and what was scheduled each day ──
  const pvId = useMemo(() => planVersionOf(data), [data.home, data.preferences, data.plan.resetCount]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!ready || recovery || !data.onboardingComplete) return;
    if (data.planVersions[data.planVersions.length - 1]?.id === pvId) return;
    dispatch({ type: 'RECORD_PLAN_VERSION', version: snapshotPlanVersion(data, new Date().toISOString()) });
  }, [ready, recovery, pvId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!ready || recovery || !data.onboardingComplete) return;
    const rec = buildExposure(view, new Date().toISOString(), new Date().getTimezoneOffset());
    if (hasNewExposure(view, rec) && rec.items.length) dispatch({ type: 'RECORD_EXPOSURE', record: rec });
  }, [ready, recovery, view, dispatch]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── toasts ──
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);
  const toast = useCallback((message: string, action?: { label: string; run: () => void }) => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-1), { id, message, actionLabel: action?.label, onAction: action?.run }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), action ? 6500 : 3200);
  }, []);

  /**
   * Run an action and offer to undo exactly that action. Undo removes this action's log entry and restores this task's state
   * (if nothing newer touched it). Anything done since, on this or any other task, is left alone.
   */
  const act = useCallback((message: string | null, a: Action, taskId: string, entryId: string) => {
    const prev = mirror.current;
    const next = reducer(prev, a);
    if (next === prev) return false; // a duplicate: nothing happened, so there is nothing to confirm or undo
    dispatch(a);
    if (message) {
      toast(message, {
        label: 'Undo',
        run: () => dispatch({
          type: 'UNDO', entryId, taskId, before: prev.taskStates[taskId] ?? null, after: next.taskStates[taskId] ?? null,
          undoReset: prev.resetRun ? !prev.resetRun.doneIds.includes(taskId) && !!next.resetRun?.doneIds.includes(taskId) : false,
          fiveBefore: next.fiveRecent !== prev.fiveRecent ? prev.fiveRecent : undefined,
        }),
      });
    }
    return true;
  }, [dispatch, toast]);

  const complete: Store['complete'] = useCallback((task, opts = {}) => {
    const entryId = uid('e');
    const a: Action = { type: 'TASK_COMPLETE', task, stamp: nowStamp(), minutes: opts.minutes, via: opts.via ?? 'checkoff', entryId };
    act(opts.quiet ? null : DONE_LINES[Math.floor(Math.random() * DONE_LINES.length)], a, task.id, entryId);
  }, [act]);
  const skip: Store['skip'] = useCallback((task, opts = {}) => {
    const entryId = uid('e');
    act(opts.quiet ? null : 'Skipped. It will come back around when it fits.', { type: 'TASK_SKIP', task, stamp: nowStamp(), entryId }, task.id, entryId);
  }, [act]);
  const snooze: Store['snooze'] = useCallback((task) => {
    const entryId = uid('e');
    act('Snoozed for two days.', { type: 'TASK_SNOOZE', task, stamp: nowStamp(), entryId }, task.id, entryId);
  }, [act]);
  const moveTo: Store['moveTo'] = useCallback((task, date, label) => {
    const entryId = uid('e');
    act(label ?? 'Moved.', { type: 'TASK_MOVE', task, to: date, stamp: nowStamp(), entryId }, task.id, entryId);
  }, [act]);

  const recordRec: Store['recordRec'] = useCallback((e) => {
    const s = nowStamp();
    dispatch({ type: 'REC_EVENT', event: { ...e, id: uid('r'), at: s.now, date: s.today, localHour: s.hour ?? 0, planVersion: planVersionOf(mirror.current) } });
  }, [dispatch]);

  // ── destructive replacement: always backed up, always undoable ──
  const replaceAll: Store['replaceAll'] = useCallback((next, reason, message) => {
    const prev = mirror.current;
    const protect = hasUserData(prev);
    if (protect) repo.backup(prev, reason);
    dispatch({ type: 'LOAD', data: next });
    toast(message, protect ? { label: 'Undo', run: () => dispatch({ type: 'LOAD', data: prev }) } : undefined);
  }, [repo, dispatch, toast]);

  const startFresh = useCallback(() => {
    // The unreadable text is already stashed under its own key; dropping the main key never destroys it.
    repo.dropMain();
    saveBlocked.current = false;
    setRecovery(null);
    adopt(emptyAppData(), 0, { clean: true });
  }, [repo, adopt]);

  // ── sheets ──
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const openSheet = useCallback((s: Sheet) => setSheets((x) => [...x, s]), []);
  const closeSheet = useCallback(() => setSheets((x) => x.slice(0, -1)), []);
  const closeAllSheets = useCallback(() => setSheets([]), []);
  const confirm = useCallback((o: ConfirmOptions) => setSheets((x) => [...x, { kind: 'confirm', ...o }]), []);

  // ── timer ──
  const [timer, setTimer] = useState<TimerState | null>(() => {
    try {
      const raw = window.localStorage.getItem(TIMER_KEY);
      return raw ? (JSON.parse(raw) as TimerState) : null;
    } catch { return null; }
  });
  const [timerNow, setTimerNow] = useState(Date.now());
  const timerTaskRef = useRef<Task | null>(null);
  const timerRef = useRef(timer);
  timerRef.current = timer;
  const viewRef = useRef(view);
  viewRef.current = view;

  useEffect(() => {
    try {
      if (timer) window.localStorage.setItem(TIMER_KEY, JSON.stringify(timer)); else window.localStorage.removeItem(TIMER_KEY);
    } catch { /* ignore */ }
  }, [timer]);

  useEffect(() => {
    if (!timer || timer.status !== 'running') return;
    const id = window.setInterval(() => {
      const now = Date.now();
      setTimerNow(now);
      const cur = timerRef.current;
      if (!cur) return;
      const next = tick(cur, now);
      if (next !== cur) {
        setTimer(next);
        if (next.status === 'finished') {
          playChime();
          try { navigator.vibrate?.([200, 100, 200]); } catch { /* ignore */ }
        }
      }
    }, 250);
    return () => window.clearInterval(id);
  }, [timer?.status, timer?.taskId]); // eslint-disable-line react-hooks/exhaustive-deps

  const beginTimer = useCallback((task: Task, minutes: number) => {
    timerTaskRef.current = task;
    const now = Date.now();
    setTimerNow(now);
    setTimer(startTimer(task, minutes, now));
    playChime(true); // unlock audio on this user gesture (silent)
    setSheets((x) => [...x.filter((s) => s.kind !== 'timerPick'), { kind: 'timer' }]);
  }, []);

  const pauseResume = useCallback(() => {
    const t = timerRef.current;
    if (!t) return;
    const now = Date.now();
    setTimerNow(now);
    setTimer(t.status === 'running' ? pauseTimer(t, now) : t.status === 'paused' ? resumeTimer(t, now) : t);
  }, []);

  const addTime = useCallback((minutes: number) => {
    const t = timerRef.current;
    if (t) setTimer(extendTimer(t, minutes, Date.now()));
  }, []);

  const finishTimer = useCallback((outcome: 'complete' | 'skip' | 'stop') => {
    const t = timerRef.current;
    if (!t) return;
    // The timer carries its own task, so a reload can never turn a "Take 5 slow breaths" into generic cleaning.
    const task = resolveTimerTask(t, timerTaskRef.current, viewRef.current.byId.get(t.taskId));
    const minutes = elapsedMinutes(t, Date.now());
    const st = nowStamp();
    const entryId = uid('e');
    if (outcome === 'complete') dispatch({ type: 'TASK_COMPLETE', task, stamp: st, minutes: Math.max(1, minutes), via: 'timer', entryId });
    else if (outcome === 'skip') dispatch({ type: 'TASK_SKIP', task, stamp: st, via: 'timer', entryId });
    else dispatch({ type: 'TASK_STOP', task, stamp: st, minutes, entryId });
    setTimer(null);
    setSheets((x) => x.filter((s) => s.kind !== 'timer'));
  }, [dispatch]);

  const discardTimer = useCallback(() => { setTimer(null); setSheets((x) => x.filter((s) => s.kind !== 'timer')); }, []);

  const value: Store = {
    ready, data, dispatch, plan, view, today, hour, stamp, repo, recovery, startFresh, loadNotice, dismissNotice: () => setLoadNotice(null), saveError,
    replaceAll, confirm, complete, skip, snooze, moveTo, recordRec,
    sheets, openSheet, closeSheet, closeAllSheets, toasts, toast,
    timer, timerNow, beginTimer, pauseResume, addTime, finishTimer, discardTimer,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
};
