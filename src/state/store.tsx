import {
  createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode,
} from 'react';
import { emptyAppData } from '../domain/appdata';
import { todayISO } from '../domain/dates';
import { generatePlan, type Plan } from '../domain/engine';
import {
  extendTimer, pauseTimer, resumeTimer, startTimer, tick, elapsedMinutes, type TimerState,
} from '../domain/timer';
import type { AppData, ISODate, Task } from '../domain/types';
import { buildView, type PlanView } from '../domain/view';
import { LocalStorageRepository, type Repository } from '../storage/repository';
import { reducer, type Action, type Stamp } from './reducer';
import { playChime } from './chime';

export type EditSection = 'type' | 'size' | 'rooms' | 'people' | 'pets' | 'state' | 'style' | 'energy' | 'goals' | 'focus';

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
  | { kind: 'editHome'; section: EditSection };

export interface Toast { id: number; message: string; actionLabel?: string; onAction?: () => void }

interface Store {
  ready: boolean;
  data: AppData;
  dispatch: (a: Action) => void;
  plan: Plan;
  view: PlanView;
  today: ISODate;
  stamp: () => Stamp;
  // task actions
  complete: (task: Task, opts?: { minutes?: number; via?: 'checkoff' | 'timer' | 'five' | 'timebox' | 'reset' | 'plan'; quiet?: boolean }) => void;
  skip: (task: Task, opts?: { quiet?: boolean }) => void;
  snooze: (task: Task) => void;
  moveTo: (task: Task, date: ISODate, label?: string) => void;
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

const defaultRepo: Repository = new LocalStorageRepository();

export const AppProvider = ({ children, repo = defaultRepo }: { children: ReactNode; repo?: Repository }) => {
  const [data, rawDispatch] = useReducer(reducer, undefined, () => emptyAppData());
  const [ready, setReady] = useState(false);
  const [today, setToday] = useState<ISODate>(todayISO());
  const dataRef = useRef(data);
  dataRef.current = data;

  // load once
  useEffect(() => {
    let alive = true;
    repo.load().then((d) => {
      if (!alive) return;
      if (d) rawDispatch({ type: 'LOAD', data: d });
      setReady(true);
    });
    return () => { alive = false; };
  }, [repo]);

  // debounced save
  useEffect(() => {
    if (!ready) return;
    const t = window.setTimeout(() => { void repo.save(data); }, 250);
    return () => window.clearTimeout(t);
  }, [data, ready, repo]);

  // roll over at midnight / when the tab wakes up
  useEffect(() => {
    const check = () => setToday((cur) => { const n = todayISO(); return n === cur ? cur : n; });
    const id = window.setInterval(check, 30_000);
    document.addEventListener('visibilitychange', check);
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', check); };
  }, []);

  const stamp = useCallback((): Stamp => ({ now: new Date().toISOString(), today: todayISO() }), []);
  const dispatch = useCallback((a: Action) => rawDispatch(a), []);

  const plan = useMemo(
    () => generatePlan(data.home, data.preferences, data.plan),
    [data.home, data.preferences, data.plan],
  );
  const view = useMemo(() => buildView(data, plan, today), [data, plan, today]);

  // ── toasts ──
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);
  const toast = useCallback((message: string, action?: { label: string; run: () => void }) => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-1), { id, message, actionLabel: action?.label, onAction: action?.run }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), action ? 6500 : 3200);
  }, []);

  const withUndo = useCallback((message: string, a: Action) => {
    const prev = dataRef.current;
    rawDispatch(a);
    toast(message, { label: 'Undo', run: () => rawDispatch({ type: 'LOAD', data: prev }) });
  }, [toast]);

  const complete: Store['complete'] = useCallback((task, opts = {}) => {
    const a: Action = { type: 'TASK_COMPLETE', task, stamp: stamp(), minutes: opts.minutes, via: opts.via ?? 'checkoff' };
    if (opts.quiet) rawDispatch(a); else withUndo(DONE_LINES[Math.floor(Math.random() * DONE_LINES.length)], a);
  }, [stamp, withUndo]);
  const skip: Store['skip'] = useCallback((task, opts = {}) => {
    const a: Action = { type: 'TASK_SKIP', task, stamp: stamp() };
    if (opts.quiet) rawDispatch(a); else withUndo('Skipped. It will come back around when it fits.', a);
  }, [stamp, withUndo]);
  const snooze: Store['snooze'] = useCallback((task) => withUndo('Snoozed for two days.', { type: 'TASK_SNOOZE', task, stamp: stamp() }), [stamp, withUndo]);
  const moveTo: Store['moveTo'] = useCallback((task, date, label) => withUndo(label ?? 'Moved.', { type: 'TASK_MOVE', task, to: date, stamp: stamp() }), [stamp, withUndo]);

  // ── sheets ──
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const openSheet = useCallback((s: Sheet) => setSheets((x) => [...x, s]), []);
  const closeSheet = useCallback(() => setSheets((x) => x.slice(0, -1)), []);
  const closeAllSheets = useCallback(() => setSheets([]), []);

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
    const known = timerTaskRef.current?.id === t.taskId ? timerTaskRef.current : viewRef.current.byId.get(t.taskId);
    const task: Task = known ?? ({
      id: t.taskId, name: t.taskName, roomName: t.roomName, roomKind: 'home', category: 'Cleaning', minutes: Math.round(t.totalSec / 60),
      cadence: { kind: 'once' }, frequency: 'once',
    } as unknown as Task);
    const minutes = elapsedMinutes(t, Date.now());
    const st = { now: new Date().toISOString(), today: todayISO() };
    if (outcome === 'complete') rawDispatch({ type: 'TASK_COMPLETE', task, stamp: st, minutes: Math.max(1, minutes), via: 'timer' });
    else if (outcome === 'skip') rawDispatch({ type: 'TASK_SKIP', task, stamp: st, via: 'timer' });
    else rawDispatch({ type: 'TASK_STOP', task, stamp: st, minutes });
    setTimer(null);
    setSheets((x) => x.filter((s) => s.kind !== 'timer'));
  }, []);

  const discardTimer = useCallback(() => { setTimer(null); setSheets((x) => x.filter((s) => s.kind !== 'timer')); }, []);

  const value: Store = {
    ready, data, dispatch, plan, view, today, stamp, complete, skip, snooze, moveTo,
    sheets, openSheet, closeSheet, closeAllSheets, toasts, toast,
    timer, timerNow, beginTimer, pauseResume, addTime, finishTimer, discardTimer,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
};
