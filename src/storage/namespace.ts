/**
 * Which account's data this browser profile is working with. With accounts on, every key the app keeps on the device (the plan, its
 * backups and recovery copy, the running timer, a workout in progress, onboarding progress, the schedule of notifications) gets the
 * account id appended, so signing in as someone else on the same device never shows, or overwrites, the first person's data.
 * Empty means the original keys, used when the server has no accounts (local mode). The appearance first-paint mirror is not
 * namespaced on purpose: it holds only colours and sizes, read before any account is known.
 */
let ns = '';
export const setNamespace = (accountId: string | null): void => { ns = accountId ? `@${accountId}` : ''; };
export const getNamespace = (): string => ns;
export const nsKey = (base: string): string => `${base}${ns}`;
