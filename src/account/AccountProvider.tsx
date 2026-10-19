import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AccountView, PublicConfig } from '../domain/billing/account';
import { LocalStorageRepository, STORAGE_KEY, type Repository } from '../storage/repository';
import { getNamespace, nsKey } from '../storage/namespace';
import { defaultRepo } from '../state/store';
import * as api from './api';
import { AuthFlow, type FlowStart } from './AuthScreens';
import { LegacyNoticeScreen, ServerUnreachable } from './Screens';
import { markLegacyNoticeSeen, shouldShowLegacyNotice } from './legacy';
import { readAuthLink, stripAuthParams, type AuthLink } from './links';
import { switchNamespace } from './scope';
import { isStandalone } from './config';
import { navigate } from '../ui/router';
import { decideAccess, MAX_TIMER_MS, msUntilAccessEnds, RECHECK_EVERY_MS, serverNowMs, type AccessSnapshot, type AccessStatus } from './access';

/**
 * Whether this app is running with accounts, and if so who is signed in. Three situations:
 *
 *  - local   The server answered GET /api/config with `{ mode: 'local' }`, or this build was made for "no server at all"
 *            (VITE_CLEANFLOW_STANDALONE=1: a static host, the phone app). The app runs exactly as it always did, on the original storage keys.
 *  - accounts, signed out   The sign-in, sign-up and recovery screens.
 *  - accounts, signed in    The app, working in this account's own storage namespace.
 *
 * Any other outcome of asking for the config (no answer, an error status, a 404 or 405 from a proxy, an HTML page, malformed JSON) is NOT
 * local mode: the app shows "try again" and does not touch the scope or any stored data.
 *
 * Who is signed in is whatever the server says (`GET /api/account` with the session cookie); nothing about it is kept in the browser.
 *
 * It also holds the server's latest answer about what the account may do (the entitlement in that same view) and turns it into `access`:
 * whether the planner is open (see access.ts). The answer is refreshed on a timer, when the tab comes back, when the connection returns,
 * and at the moment the confirmed access is due to end; the screens that change it (start the trial, cancel, resume) hand the new view in.
 * Whatever the app is holding is written out before the planner is closed, and the planner is never unmounted, so nothing pending is lost.
 */
export interface AccountUser { id: string; email: string; name: string; emailVerified: boolean }

export interface AccessApi {
  status: AccessStatus;
  /** The server's latest account view, or null without accounts. */
  view: AccountView | null;
  /** Take a fresh view from a screen that just got one (it came from the server, so it is as good as a refresh). */
  accept(view: AccountView): void;
  /** Ask the server again now. */
  recheck(): Promise<void>;
}

export interface AccountContextValue {
  mode: 'local' | 'accounts';
  user: AccountUser | null;
  legal: NonNullable<PublicConfig['accounts']>['legal'];
  mailDelivers: boolean;
  /** The payment provider's mode on this server ("test" = no real money), or null when billing is not set up. */
  billingMode: 'test' | 'live' | null;
  /** Ends the session on the server and on this device's screen. Throws an ApiError if the server could not be told. */
  signOut(): Promise<void>;
  /** Called after the server deleted the account: leaves the signed-in state. */
  accountDeleted(): void;
  /** A one-time message to show once the app is on screen (for example "Email confirmed"). */
  takeFlash(): string | null;
  /** Show a one-time message now, on whatever screen comes next (for example "Your trial has started" as the planner opens). */
  announce(message: string): void;
  announced: string | null;
  clearAnnounced(): void;
  access: AccessApi;
}

const NO_LEGAL = { privacy: null, terms: null, billing: null, company: null };
/** Without accounts nothing is gated: the planner is always open. */
const OPEN_ACCESS: AccessApi = { status: { kind: 'allowed', offlineUntil: null }, view: null, accept: () => undefined, recheck: async () => undefined };
const Ctx = createContext<AccountContextValue>({ mode: 'local', user: null, legal: NO_LEGAL, mailDelivers: true, billingMode: null, signOut: async () => undefined, accountDeleted: () => undefined, takeFlash: () => null, announce: () => undefined, announced: null, clearAnnounced: () => undefined, access: OPEN_ACCESS });
export const useAccount = (): AccountContextValue => useContext(Ctx);

type State =
  | { s: 'loading' }
  | { s: 'local' }
  | { s: 'unreachable' }
  | { s: 'failed' }
  | { s: 'signed-out'; start: FlowStart }
  | { s: 'signed-in'; user: AccountUser; legacyNotice: boolean; snap: AccessSnapshot };

/** Coming back to the tab asks again at most this often. */
const VISIBLE_RECHECK_MS = 60 * 1000;
const fresh = (view: AccountView): AccessSnapshot => ({ view, verifiedAt: Date.now(), reachable: true });

export const AccountProvider = ({ children }: { children: (scope: { repo: Repository; scopeKey: string }) => ReactNode }) => {
  const [state, setState] = useState<State>({ s: 'loading' });
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const initialLink = useRef<AuthLink>(typeof window === 'undefined' ? { kind: 'none' } : readAuthLink(window.location.search));
  const flash = useRef<string | null>(null);
  const lastCheck = useRef(0);
  const inflight = useRef(false);
  const userRef = useRef<string | null>(null);
  const [tick, setTick] = useState(0);
  const [announced, setAnnounced] = useState<string | null>(null);

  const accounts = config?.mode === 'accounts' ? config.accounts : undefined;

  const enter = useCallback((view: AccountView) => {
    // The namespace is set BEFORE the app mounts, so everything it reads on its first render is this account's.
    switchNamespace(view.user.id);
    userRef.current = view.user.id;
    setState({ s: 'signed-in', user: view.user, legacyNotice: shouldShowLegacyNotice(view.user.id), snap: fresh(view) });
  }, []);

  const leave = useCallback((start: FlowStart) => {
    switchNamespace(null);
    userRef.current = null;
    setState({ s: 'signed-out', start });
  }, []);

  const load = useCallback(async (opts: { quiet?: boolean } = {}) => {
    if (!opts.quiet) setState({ s: 'loading' });
    if (isStandalone()) { switchNamespace(null); setState({ s: 'local' }); return; }    // a build made for "no server at all"
    let cfg: PublicConfig;
    try { cfg = await api.getConfig(); } catch (e) {
      // No valid answer. This never selects local mode and never touches the scope or any stored data: the person sees a way to try again.
      if (opts.quiet) return;
      setState(e instanceof api.ApiError && e.offline ? { s: 'unreachable' } : { s: 'failed' });
      return;
    }
    setConfig(cfg);
    if (cfg.mode === 'local') { switchNamespace(null); setState({ s: 'local' }); return; }
    // A password-reset link opened in this browser always goes to the new-password form, signed in or not: the person asked for it.
    const first = initialLink.current;
    if (!opts.quiet && (first.kind === 'reset' || (first.kind === 'bad-link' && first.what === 'reset'))) { initialLink.current = { kind: 'none' }; leave(startFor(first)); return; }
    try {
      const a = await api.getAccount();
      lastCheck.current = Date.now();
      const link = initialLink.current;
      if (link.kind === 'verified' && !flash.current) flash.current = 'Email confirmed. You are signed in.';
      initialLink.current = { kind: 'none' };
      if (getNamespace() === a.user.id) { userRef.current = a.user.id; setState((s) => (s.s === 'signed-in' ? { ...s, snap: fresh(a) } : { s: 'signed-in', user: a.user, legacyNotice: false, snap: fresh(a) })); return; }
      enter(a);
    } catch (e) {
      if (e instanceof api.ApiError && e.status === 401) {
        if (opts.quiet) { leave({ view: 'sign-in', notice: 'Your session has ended. Sign in again to continue.', noticeKind: 'info' }); return; }
        const link = initialLink.current;
        initialLink.current = { kind: 'none' };
        leave(startFor(link));
        return;
      }
      if (opts.quiet) return;           // offline while checking in the background: keep working, the next check will try again
      if (e instanceof api.ApiError && e.offline) setState({ s: 'unreachable' }); else setState({ s: 'failed' });
    }
  }, [enter, leave]);

  useEffect(() => {
    let cancelled = false;
    // Take a one-time code (a confirmation or reset link) out of the address bar straight away so it is not kept in history.
    if (initialLink.current.kind !== 'none') { try { window.history.replaceState(null, '', stripAuthParams(window.location.href)); } catch { /* ignore */ } }
    void Promise.resolve().then(() => { if (!cancelled) return load(); });
    return () => { cancelled = true; };
  }, [load]);

  /**
   * Ask the server again: is the session still good, and what may this account do now? A 401 ends the session (the sign-in screen, after the
   * app has written out what it holds). No answer (offline, a server fault) is not an answer: the last one stays, and it is relied on only for
   * as long as access.ts allows. Someone else being signed in now (another tab) starts over.
   */
  const recheck = useCallback(async () => {
    if (inflight.current || !userRef.current) return;
    inflight.current = true;
    try {
      const a = await api.getAccount();
      lastCheck.current = Date.now();
      if (a.user.id !== userRef.current) { void load(); return; }
      setState((s) => (s.s === 'signed-in' ? { ...s, snap: fresh(a) } : s));
    } catch (e) {
      if (e instanceof api.ApiError && e.status === 401) leave({ view: 'sign-in', notice: 'Your session has ended. Sign in again to continue.', noticeKind: 'info' });
      else setState((s) => (s.s === 'signed-in' && s.snap.reachable ? { ...s, snap: { ...s.snap, reachable: false } } : s));
    } finally { inflight.current = false; }
  }, [leave, load]);

  const accept = useCallback((view: AccountView) => {
    setState((s) => (s.s === 'signed-in' && s.user.id === view.user.id ? { ...s, snap: fresh(view) } : s));
  }, []);

  // A session can end, or the plan can change, while the app is open (expiry, a payment, a cancellation, a sign-out on another device).
  // Look again on a timer, when the tab comes back, and when the connection returns. Being offline is not an end of the session.
  useEffect(() => {
    if (state.s !== 'signed-in') return;
    const onVisible = () => { if (document.visibilityState === 'visible' && Date.now() - lastCheck.current >= VISIBLE_RECHECK_MS) void recheck(); };
    const every = window.setInterval(() => { if (document.visibilityState === 'visible') void recheck(); }, RECHECK_EVERY_MS);
    const onOnline = () => void recheck();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    return () => { window.clearInterval(every); document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('online', onOnline); };
  }, [state.s, recheck]);

  const snap = state.s === 'signed-in' ? state.snap : null;
  const status = useMemo<AccessStatus>(() => (snap ? decideAccess(snap, Date.now()) : { kind: 'allowed', offlineUntil: null }), [snap, tick]);   // eslint-disable-line react-hooks/exhaustive-deps

  // At the moment confirmed access is due to end (or the offline allowance is), look again; the server decides what happens next.
  useEffect(() => {
    if (!snap || status.kind !== 'allowed') return;
    const now = Date.now();
    const wait = status.offlineUntil !== null ? Math.max(1000, status.offlineUntil - serverNowMs(snap, now) + 1000) : msUntilAccessEnds(snap, now);
    if (wait === null) return;
    const t = window.setTimeout(() => { setTick((n) => n + 1); void recheck(); }, Math.min(wait, MAX_TIMER_MS));
    return () => window.clearTimeout(t);
  }, [snap, status, recheck]);
  // Confirmed access that has run out by the server's clock is not trusted while the question is open: ask now.
  useEffect(() => { if (status.kind === 'reconfirm') void recheck(); }, [status.kind, recheck]);

  const signOut = useCallback(async () => {
    // Let the app write what it is holding first: the same path the browser uses when the page closes.
    try { window.dispatchEvent(new Event('pagehide')); } catch { /* ignore */ }
    await api.signOut();
    leave({ view: 'sign-in', notice: 'You are signed out. Your plan stays on this device, under your account.' });
  }, [leave]);

  const accountDeleted = useCallback(() => leave({ view: 'sign-in', notice: 'Your account was deleted.', noticeKind: 'info' }), [leave]);

  const value = useMemo<AccountContextValue>(() => ({
    mode: state.s === 'signed-in' || state.s === 'signed-out' || state.s === 'unreachable' ? 'accounts' : 'local',
    user: state.s === 'signed-in' ? state.user : null,
    legal: accounts?.legal ?? NO_LEGAL,
    mailDelivers: accounts?.mail.delivers ?? true,
    billingMode: accounts?.billing.mode ?? null,
    signOut, accountDeleted,
    takeFlash: () => { const f = flash.current; flash.current = null; return f; },
    announce: setAnnounced, announced, clearAnnounced: () => setAnnounced(null),
    access: snap ? { status, view: snap.view, accept, recheck } : OPEN_ACCESS,
  }), [state, accounts, signOut, accountDeleted, snap, status, accept, recheck, announced]);

  const userId = state.s === 'signed-in' ? state.user.id : null;
  const scope = useMemo(() => ({ repo: userId ? new LocalStorageRepository(nsKey(STORAGE_KEY)) : defaultRepo, scopeKey: userId ?? 'local' }), [userId]);

  let body: ReactNode;
  switch (state.s) {
    case 'loading': body = <div className="auth" role="status" aria-live="polite"><p className="muted">Loading…</p></div>; break;
    case 'local': body = children(scope); break;
    case 'unreachable': body = <ServerUnreachable onRetry={() => void load()} />; break;
    case 'failed': body = <ServerUnreachable onRetry={() => void load()} failed />; break;
    case 'signed-out': body = <AuthFlow key="auth" start={state.start} legal={value.legal} mailDelivers={value.mailDelivers} onSignedIn={() => void load()} />; break;
    case 'signed-in':
      body = state.legacyNotice
        ? <LegacyNoticeScreen
            userId={state.user.id}
            onContinue={() => { markLegacyNoticeSeen(state.user.id); setState({ ...state, legacyNotice: false }); }}
            onReview={() => { markLegacyNoticeSeen(state.user.id); navigate('account/data'); setState({ ...state, legacyNotice: false }); }}
          />
        : children(scope);
      break;
  }
  return <Ctx.Provider value={value}>{body}</Ctx.Provider>;
};

const startFor = (link: AuthLink): FlowStart => {
  switch (link.kind) {
    case 'reset': return { view: 'reset', token: link.token };
    case 'verified': return { view: 'sign-in', notice: 'Email confirmed. Sign in to continue.' };
    case 'bad-link': return { view: 'link-problem', what: link.what };
    default: return { view: 'sign-in' };
  }
};

