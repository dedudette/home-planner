import { useEffect, useRef, type ReactNode } from 'react';
import { syncReminders } from '../domain/reminders/sync';
import { getPlatform, readScheduled, writeScheduled } from '../state/reminderPlatform';
import { useRoute } from '../ui/router';
import { Button } from '../ui/primitives';
import { useDrafts } from '../state/draftsContext';
import { routeStaysOpen, UNCONFIRMED_COPY } from './access';
import { DraftsNote } from './Drafts';
import { useAccount } from './AccountProvider';
import { AuthFrame } from './Screens';

/**
 * The planner's gate, in accounts mode only. It sits between the account and the planner and shows the planner only while the SERVER says
 * the account has full access (a running trial, a paid period, a short grace after a failed payment). Otherwise it shows the Trial & plans
 * screen in its "paused" form: why, what to do next, and everything that stays open (billing, export, deletion, Data & backup, sign-out).
 *
 * What it does when access changes while the app is open: it writes out whatever the app is holding first, and it never unmounts the app's
 * state, so nothing pending is lost and the planner comes back exactly where it was when access returns. Reminders already handed to this
 * device are cancelled while the planner is closed (the app re-plans them from the plan when it opens again).
 *
 * It is an interface rule. The browser holds the planner's code and data, so this cannot be made tamper-proof; the paid, server-side parts
 * (AI, cloud backup uploads, checkout, billing) are enforced by the server whatever this screen does. Local mode has no accounts and no gate.
 */
export const AccessGateHost = ({ children }: { children: ReactNode }) => {
  const { mode, user, access } = useAccount();
  const route = useRoute();
  const open = access.status.kind === 'allowed';
  const wasOpen = useRef(true);
  const gated = mode === 'accounts' && !!user;
  const drafts = useDrafts();

  // Closing the planner: write out what the app holds before anything else happens (the same path the browser uses when the page closes).
  useEffect(() => {
    if (!gated) return;
    if (wasOpen.current && !open) { try { window.dispatchEvent(new Event('pagehide')); } catch { /* no window */ } }
    wasOpen.current = open;
  }, [gated, open]);

  // While the server says no (or cannot be asked and the allowance is over), nothing on this device should keep reminding. A moment of
  // "checking" is not a "no" and does not cancel anything.
  const closed = access.status.kind === 'blocked' || access.status.kind === 'unconfirmed';
  useEffect(() => {
    if (!gated || !closed) return;
    let alive = true;
    void (async () => {
      const platform = await getPlatform();
      if (!alive) return;
      const res = await syncReminders(platform, [], readScheduled(), false);
      writeScheduled(res.record);
    })().catch(() => undefined);
    return () => { alive = false; };
  }, [gated, closed]);

  // Typed, unsaved text is kept (on this device, for this account) when the planner closes, so access coming back, or a trip to the payment page
  // and back, does not cost it. The registry holds the text itself, so this does not depend on the forms still being on screen.
  useEffect(() => { if (gated && closed) drafts?.interrupt(); }, [gated, closed, drafts]);
  // Moving to another page while the planner is open is the person finishing with the forms left behind; while it is closed, it is not.
  useEffect(() => { if (gated && open) drafts?.dropPagesExcept(route.path.split('/')[0]); }, [gated, open, route.path, drafts]);

  useEffect(() => {
    if (!gated || open || routeStaysOpen(route.path) || access.status.kind === 'blocked') return;
    document.title = 'Your planner is paused · CleanFlow';
  }, [gated, open, route.path, access.status.kind]);

  if (!gated) return <>{children}</>;
  // One shape for every case that shows the app, so the app is never remounted by a change of access.
  const until = access.status.kind === 'allowed' ? access.status.offlineUntil : null;
  const banner = until !== null ? (
    <div className="access-note" role="status">
      Offline: the server could not be reached. Your plan was last confirmed on this device, so the planner stays open until {new Date(until).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}, and then needs a connection.
      {' '}<button type="button" className="link-btn" onClick={() => void access.recheck()}>Check now</button>
    </div>
  ) : null;
  const showApp = open || routeStaysOpen(route.path) || access.status.kind === 'blocked';     // a "blocked" app shows Trial & plans itself (App.tsx)
  if (showApp) return <>{banner}{children}</>;
  return access.status.kind === 'unconfirmed' ? <Unconfirmed /> : <Checking />;
};

const Checking = () => (
  <AuthFrame title="Checking your plan…">
    <p role="status" className="muted">Asking the server what your account can use. This takes a moment.</p>
  </AuthFrame>
);

const Unconfirmed = () => {
  const { access } = useAccount();
  return (
    <AuthFrame title={UNCONFIRMED_COPY.title} lead={UNCONFIRMED_COPY.lead} footer={<a href="#/account/data">Data &amp; backup</a>}>
      <DraftsNote />
      <div className="row wrap">
        <Button onClick={() => void access.recheck()}>Try again</Button>
        <a className="btn secondary" href="#/account/data">Download my data</a>
      </div>
    </AuthFrame>
  );
};
