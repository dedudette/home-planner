import { useCallback, useEffect, useRef, useState } from 'react';
import type { AccountView } from '../domain/billing/account';
import * as api from './api';

export type ViewState =
  | { s: 'loading' }
  | { s: 'ready'; account: AccountView }
  | { s: 'error'; error: unknown };

/** The signed-in account as the server describes it. Reads only; every change goes through an explicit call that returns the new view. */
export const useAccountView = () => {
  const [state, setState] = useState<ViewState>({ s: 'loading' });
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const refresh = useCallback(async (opts: { quiet?: boolean } = {}) => {
    if (!opts.quiet) setState({ s: 'loading' });
    try { const account = await api.getAccount(); if (alive.current) setState({ s: 'ready', account }); }
    catch (error) { if (alive.current) setState((cur) => (opts.quiet && cur.s === 'ready' ? cur : { s: 'error', error })); }
  }, []);
  const set = useCallback((account: AccountView) => setState({ s: 'ready', account }), []);
  useEffect(() => { void refresh(); }, [refresh]);
  return { state, refresh, set };
};
