import { useEffect, useState } from 'react';
import { App } from '../App';
import { AppProvider } from '../state/store';
import { AccountProvider, useAccount } from './AccountProvider';

/**
 * A one-time message from the account side (for example "Email confirmed") once the app is on screen. It draws itself instead of using
 * the app's toast, because that only exists inside the main screens and a first-time person is looking at the welcome page.
 */
const Flash = () => {
  const { takeFlash } = useAccount();
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { const m = takeFlash(); if (m) setMsg(m); }, [takeFlash]);
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

/**
 * The app, inside whatever account scope applies: the original storage when there are no accounts, or the signed-in account's own
 * storage. The key makes the app start fresh when the account changes, so one person's plan can never sit in memory for the next.
 */
export const ScopedApp = () => (
  <AccountProvider>
    {({ repo, scopeKey }) => (
      <AppProvider key={scopeKey} repo={repo}>
        <Flash />
        <App />
      </AppProvider>
    )}
  </AccountProvider>
);
