import { useCallback, useEffect, useRef, useState } from 'react';
import type { AccountView } from '../domain/billing/account';
import * as api from './api';
import { useAccount } from './AccountProvider';

export type ViewState =
  | { s: 'loading' }
  | { s: 'ready'; account: AccountView }
  | { s: 'error'; error: unknown };

/**
 * The signed-in account as the server describes it. Reads only; every change goes through an explicit call that returns the new view.
 * Every view that arrives from the server is also handed to the access gate (see AccessGate.tsx), so a screen that changes the plan (starts
 * the trial, cancels, resumes, confirms a payment) opens or closes the planner without waiting for the next scheduled check.
 */
export const useAccountView = () => {
  const { access } = useAccount();
  const accept = useRef(access.accept);
  accept.current = access.accept;
  const [state, setState] = useState<ViewState>({ s: 'loading' });
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const refresh = useCallback(async (opts: { quiet?: boolean } = {}) => {
    if (!opts.quiet) setState({ s: 'loading' });
    try { const account = await api.getAccount(); accept.current(account); if (alive.current) setState({ s: 'ready', account }); }
    catch (error) { if (alive.current) setState((cur) => (opts.quiet && cur.s === 'ready' ? cur : { s: 'error', error })); }
  }, []);
  const set = useCallback((account: AccountView) => { accept.current(account); setState({ s: 'ready', account }); }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  // The gate looks at the server on its own (a timer, the tab coming back, the connection returning). What it learns is what this screen shows too.
  const latest = access.view;
  useEffect(() => { if (latest) setState((cur) => (cur.s === 'ready' && cur.account === latest ? cur : { s: 'ready', account: latest })); }, [latest]);
  return { state, refresh, set };
};
