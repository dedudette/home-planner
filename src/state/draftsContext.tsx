import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { DraftRegistry, NO_DRAFTS, type DraftsSnapshot } from './drafts';

const Ctx = createContext<DraftRegistry | null>(null);

const browserStorage = () => { try { return typeof window !== 'undefined' ? window.localStorage : null; } catch { return null; } };

/**
 * The drafts of the signed-in account (see state/drafts.ts). Mounted with the same key as the account's app, so the registry of one account
 * never exists while another account's app is on screen. With no account (local mode) there is no registry and nothing here does anything.
 */
export const DraftsProvider = ({ accountId, children }: { accountId: string | null; children: ReactNode }) => {
  const registry = useMemo(() => (accountId ? new DraftRegistry(accountId, browserStorage()) : null), [accountId]);
  useEffect(() => {
    if (!registry) return;
    const onHide = () => registry.flush();
    window.addEventListener('pagehide', onHide);
    return () => { window.removeEventListener('pagehide', onHide); registry.flush(); registry.dispose(); };
  }, [registry]);
  return <Ctx.Provider value={registry}>{children}</Ctx.Provider>;
};

/** The current account's drafts, or null when there is no account (local mode) or no provider. */
export const useDrafts = (): DraftRegistry | null => useContext(Ctx);

const NONE_SUBSCRIBE = () => () => undefined;
const NONE_SNAPSHOT = () => NO_DRAFTS;
/** What is kept (kinds and times, never the text), updating as it changes. */
export const useDraftsSnapshot = (): DraftsSnapshot => {
  const r = useDrafts();
  return useSyncExternalStore(r ? r.subscribe : NONE_SUBSCRIBE, r ? r.getSnapshot : NONE_SNAPSHOT);
};
