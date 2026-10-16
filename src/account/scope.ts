import { setNamespace } from '../storage/namespace';

/**
 * Changes which account's storage the app works in. Before it does, the running app is asked to write what it is holding (the same
 * `pagehide` path the browser uses when the page closes). Without this a debounced save that is pending when the session ends, the account
 * changes or the person signs out is cancelled when the old app unmounts, and the last edits are lost. The flush runs while the OLD
 * namespace is still set, so it lands in the old account's storage and never in the next one's.
 */
export const switchNamespace = (accountId: string | null): void => {
  try { window.dispatchEvent(new Event('pagehide')); } catch { /* no window (tests, server rendering): nothing to flush */ }
  setNamespace(accountId);
};
