import { useEffect, useState } from 'react';
import { App } from '../App';
import { AppProvider } from '../state/store';
import { navigate } from '../ui/router';
import { AccessGateHost } from './AccessGate';
import { AccountProvider, useAccount } from './AccountProvider';
import { readBillingReturn, stripBillingParams } from './billingReturn';

/**
 * A one-time message from the account side (for example "Email confirmed") once the app is on screen. It draws itself instead of using
 * the app's toast, because that only exists inside the main screens and a first-time person is looking at the welcome page.
 */
const Flash = () => {
  const { takeFlash, announced, clearAnnounced } = useAccount();
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { const m = takeFlash(); if (m) setMsg(m); }, [takeFlash]);
  useEffect(() => { if (announced) { setMsg(announced); clearAnnounced(); } }, [announced, clearAnnounced]);
  useEffect(() => {
    if (!msg) return;
    const t = window.setTimeout(() => setMsg(null), 7000);
    return () => window.clearTimeout(t);
  }, [msg]);
  if (!msg) return null;
  return (
    <div className="auth-flash" role="status">
      <span>{msg}</span>
      <button type="button" onClick={() => setMsg(null)} aria-label="Dismiss">×</button>
    </div>
  );
};

/** Coming back from the payment page lands on `/?billing=…`: tidy the address and open Trial & plans, which asks the server what happened. */
const BillingReturnRouter = () => {
  const { mode, user } = useAccount();
  useEffect(() => {
    // The address itself says whether the person has just come back from the payment page (the screen that handles the return reads it separately).
    if (mode !== 'accounts' || !user || readBillingReturn(window.location.search).kind === 'none') return;
    try { window.history.replaceState(null, '', stripBillingParams(window.location.href)); } catch { /* ignore */ }
    navigate('account');
  }, [mode, user]);
  return null;
};

/**
 * The app, inside whatever account scope applies: the original storage when there are no accounts, or the signed-in account's own
 * storage. The key makes the app start fresh when the account changes, so one person's plan can never sit in memory for the next.
 * With accounts, the planner is behind the access gate (AccessGate.tsx): the app's state stays mounted whatever the gate does.
 */
export const ScopedApp = () => (
  <AccountProvider>
    {({ repo, scopeKey }) => (
      <AppProvider key={scopeKey} repo={repo}>
        <Flash />
        <BillingReturnRouter />
        <AccessGateHost><App /></AccessGateHost>
      </AppProvider>
    )}
  </AccountProvider>
);
