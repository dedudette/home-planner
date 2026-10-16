import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { PublicConfig } from '../domain/billing/account';
import { LocalStorageRepository, STORAGE_KEY, type Repository } from '../storage/repository';
import { getNamespace, nsKey } from '../storage/namespace';
import { defaultRepo } from '../state/store';
import * as api from './api';
import { AuthFlow, type FlowStart } from './AuthScreens';
import { LegacyNoticeScreen, ServerUnreachable } from './Screens';
import { markLegacyNoticeSeen, shouldShowLegacyNotice } from './legacy';
import { readAuthLink, stripAuthParams, type AuthLink } from './links';
import { switchNamespace } from './scope';

/**
 * Whether this app is running with accounts, and if so who is signed in. Three situations:
 *
 *  - local   The server has no accounts (or there is no server at all, as on a static host or in the phone app without a server address).
 *            The app runs exactly as it always did, on the original storage keys. No sign-in is shown anywhere.
 *  - accounts, signed out   The sign-in, sign-up and recovery screens.
 *  - accounts, signed in    The app, working in this account's own storage namespace.
 *
 * Who is signed in is whatever the server says (`GET /api/account` with the session cookie); nothing about it is kept in the browser
 * except which MODE the server was last seen in, so that a brief loss of connection does not silently turn an accounts deployment
 * into a local one. This file does not look at subscriptions or entitlements.
 */
export interface AccountUser { id: string; email: string; name: string; emailVerified: boolean }

export interface AccountContextValue {
  mode: 'local' | 'accounts';
  user: AccountUser | null;
  legal: NonNullable<PublicConfig['accounts']>['legal'];
  mailDelivers: boolean;
  /** Ends the session on the server and on this device's screen. Throws an ApiError if the server could not be told. */
  signOut(): Promise<void>;
  /** Called after the server deleted the account: leaves the signed-in state. */
  accountDeleted(): void;
  /** A one-time message to show once the app is on screen (for example "Email confirmed"). */
  takeFlash(): string | null;
}

const NO_LEGAL = { privacy: null, terms: null, billing: null, company: null };
const Ctx = createContext<AccountContextValue>({ mode: 'local', user: null, legal: NO_LEGAL, mailDelivers: true, signOut: async () => undefined, accountDeleted: () => undefined, takeFlash: () => null });
export const useAccount = (): AccountContextValue => useContext(Ctx);

const MODE_KEY = 'cleanflow:mode';
const readMode = (): 'accounts' | 'local' | null => { try { const v = window.localStorage.getItem(MODE_KEY); return v === 'accounts' || v === 'local' ? v : null; } catch { return null; } };
const writeMode = (m: 'accounts' | 'local'): void => { try { window.localStorage.setItem(MODE_KEY, m); } catch { /* the next load simply asks again */ } };

type State =
  | { s: 'loading' }
  | { s: 'local' }
  | { s: 'unreachable'; known: 'accounts' }
  | { s: 'failed' }
  | { s: 'signed-out'; start: FlowStart }
  | { s: 'signed-in'; user: AccountUser; legacyNotice: boolean };

const SESSION_RECHECK_MS = 5 * 60 * 1000;

export const AccountProvider = ({ children }: { children: (scope: { repo: Repository; scopeKey: string }) => ReactNode }) => {
  const [state, setState] = useState<State>({ s: 'loading' });
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const initialLink = useRef<AuthLink>(typeof window === 'undefined' ? { kind: 'none' } : readAuthLink(window.location.search));
  const flash = useRef<string | null>(null);
  const lastCheck = useRef(0);

  const accounts = config?.mode === 'accounts' ? config.accounts : undefined;

  const enter = useCallback((user: AccountUser) => {
    // The namespace is set BEFORE the app mounts, so everything it reads on its first render is this account's.
    switchNamespace(user.id);
    setState({ s: 'signed-in', user, legacyNotice: shouldShowLegacyNotice(user.id) });
  }, []);

  const leave = useCallback((start: FlowStart) => {
    switchNamespace(null);
    setState({ s: 'signed-out', start });
  }, []);

  const load = useCallback(async (opts: { quiet?: boolean } = {}) => {
    if (!opts.quiet) setState({ s: 'loading' });
    let cfg: PublicConfig | null;
    try { cfg = await api.getConfig(); } catch (e) {
      if (opts.quiet) return;
      // A server that answered with an error (an outage, a deploy, a proxy) is there: never fall back to the original storage then, and keep
      // the remembered mode as it was. Only "no answer at all" with no memory of accounts means a plain local app.
      if (e instanceof api.ApiError && e.status > 0) { setState({ s: 'failed' }); return; }
      // Could not reach any server. If this deployment was last seen with accounts, do not pretend it has none.
      if (readMode() === 'accounts') setState({ s: 'unreachable', known: 'accounts' }); else { switchNamespace(null); setState({ s: 'local' }); }
      return;
    }
    setConfig(cfg);
    if (!cfg || cfg.mode === 'local') { writeMode('local'); switchNamespace(null); setState({ s: 'local' }); return; }
    writeMode('accounts');
    // A password-reset link opened in this browser always goes to the new-password form, signed in or not: the person asked for it.
    const first = initialLink.current;
    if (!opts.quiet && (first.kind === 'reset' || (first.kind === 'bad-link' && first.what === 'reset'))) { initialLink.current = { kind: 'none' }; leave(startFor(first)); return; }
    try {
      const a = await api.getAccount();
      lastCheck.current = Date.now();
      const link = initialLink.current;
      if (link.kind === 'verified' && !flash.current) flash.current = 'Email confirmed. You are signed in.';
      initialLink.current = { kind: 'none' };
      if (getNamespace() === a.user.id) { setState((s) => (s.s === 'signed-in' ? s : { s: 'signed-in', user: a.user, legacyNotice: false })); return; }
      enter(a.user);
    } catch (e) {
      if (e instanceof api.ApiError && e.status === 401) {
        if (opts.quiet) { leave({ view: 'sign-in', notice: 'Your session has ended. Sign in again to continue.', noticeKind: 'info' }); return; }
        const link = initialLink.current;
        initialLink.current = { kind: 'none' };
        leave(startFor(link));
        return;
      }
      if (opts.quiet) return;           // offline while checking in the background: keep working, the next check will try again
      if (e instanceof api.ApiError && e.offline) setState({ s: 'unreachable', known: 'accounts' }); else setState({ s: 'failed' });
    }
  }, [enter, leave]);

  useEffect(() => {
    let cancelled = false;
    // Take a one-time code (a confirmation or reset link) out of the address bar straight away so it is not kept in history.
    if (initialLink.current.kind !== 'none') { try { window.history.replaceState(null, '', stripAuthParams(window.location.href)); } catch { /* ignore */ } }
    void Promise.resolve().then(() => { if (!cancelled) return load(); });
    return () => { cancelled = true; };
  }, [load]);

  // A session can end while the app is open (expiry, a password reset elsewhere, a sign-out on another device). Look again when the person
  // comes back to the tab, at most every few minutes. Being offline is not an end of the session.
  useEffect(() => {
    if (state.s !== 'signed-in') return;
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || Date.now() - lastCheck.current < SESSION_RECHECK_MS) return;
      lastCheck.current = Date.now();
      void load({ quiet: true });
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [state.s, load]);

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
    signOut, accountDeleted,
    takeFlash: () => { const f = flash.current; flash.current = null; return f; },
  }), [state, accounts, signOut, accountDeleted]);

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
        ? <LegacyNoticeScreen userId={state.user.id} onContinue={() => { markLegacyNoticeSeen(state.user.id); setState({ ...state, legacyNotice: false }); }} />
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

