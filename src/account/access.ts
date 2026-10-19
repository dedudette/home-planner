import type { AccountView } from '../domain/billing/account';
import { offlineEntitlementOk } from '../domain/billing/entitlement';

/**
 * Whether the planner is open to the signed-in account right now. The decision is the SERVER's (`entitlement.access` in the account view
 * it sent); this file only turns that answer into a screen, and says how long an answer may be relied on. Pure: the caller passes in the
 * time, nothing here reads a clock, a cookie or storage.
 *
 * What it is and is not: it is an interface rule. The planner's code and data live in the browser, so someone who edits the page can still
 * open it; the paid, server-side parts (AI, cloud backup uploads, billing) are enforced by the server whatever this screen does. See
 * docs/billing.md ("Which checks are enforced by the server, and which are only the interface").
 *
 * Time: an answer carries the server's own time. How long it has been relied on is measured as the time that has passed on this device
 * since the answer arrived (not the device's date), so a wrong or changed device clock cannot extend access, and a clock moved backwards
 * means "ask the server again".
 */
export interface AccessSnapshot {
  view: AccountView;
  /** Device time (ms) when the server's answer arrived. */
  verifiedAt: number;
  /** False when the most recent attempt to ask the server again got no answer (offline, a server fault). */
  reachable: boolean;
}

export type AccessStatus =
  | { kind: 'allowed'; offlineUntil: number | null }     // `offlineUntil`: server-time ms until which an unconfirmed answer is being relied on, or null when the server confirmed it
  | { kind: 'blocked' }                                  // the server says account-only: the planner is closed, the account screens are open
  | { kind: 'reconfirm' }                                // the confirmed access has run out by the server's clock: ask again before deciding
  | { kind: 'unconfirmed' };                             // the server cannot be reached and the offline allowance is used up (or never existed)

export const serverNowMs = (s: AccessSnapshot, now: number): number => Date.parse(s.view.serverTime) + Math.max(0, now - s.verifiedAt);

export const decideAccess = (s: AccessSnapshot, now: number): AccessStatus => {
  const ent = s.view.entitlement;
  if (ent.access !== 'full') return { kind: 'blocked' };                 // a "no" stays a "no" with or without the server
  if (!Number.isFinite(Date.parse(s.view.serverTime))) return { kind: 'reconfirm' };
  if (now < s.verifiedAt) return { kind: 'reconfirm' };                  // the device clock went backwards: nothing is extended by that
  const nowServer = serverNowMs(s, now);
  const ends = ent.accessEndsAt ? Date.parse(ent.accessEndsAt) : NaN;
  // An answer given when the end had already passed (the server allows a day for a renewal to be recorded) is the server's own decision for
  // that moment: it is relied on until the next check, not asked about again every second.
  const dueToEnd = Number.isFinite(ends) && ends > Date.parse(s.view.serverTime);
  if (s.reachable) return dueToEnd && nowServer >= ends ? { kind: 'reconfirm' } : { kind: 'allowed', offlineUntil: null };
  // The server could not be asked. The documented allowance (72 hours from the last confirmation, never past the confirmed end) applies.
  if (!offlineEntitlementOk({ entitlement: ent, verifiedAt: s.view.serverTime }, new Date(nowServer))) return { kind: 'unconfirmed' };
  const limit = Date.parse(s.view.serverTime) + OFFLINE_ALLOWANCE_MS;
  return { kind: 'allowed', offlineUntil: Number.isFinite(ends) ? Math.min(limit, ends) : limit };
};

export const OFFLINE_ALLOWANCE_MS = 72 * 60 * 60 * 1000;

/** How long to wait before the confirmed access runs out by the server's clock (so the app asks again then), or null when it does not end. */
export const msUntilAccessEnds = (s: AccessSnapshot, now: number): number | null => {
  const ends = s.view.entitlement.accessEndsAt ? Date.parse(s.view.entitlement.accessEndsAt) : NaN;
  if (s.view.entitlement.access !== 'full' || !Number.isFinite(ends) || ends <= Date.parse(s.view.serverTime)) return null;
  return Math.max(1000, ends - serverNowMs(s, now) + 1000);
};

export const RECHECK_EVERY_MS = 5 * 60 * 1000;
/** A browser timer cannot be set further out than this. */
export const MAX_TIMER_MS = 2 ** 31 - 1;

/** The account screens that stay open when the planner is closed: the subscription and billing, and data (export, restore, delete). Everything else is the planner. */
const OPEN_WHEN_CLOSED = ['account', 'account/data'];
export const routeStaysOpen = (path: string): boolean => OPEN_WHEN_CLOSED.includes(path);

export interface GateCopy { title: string; lead: string }

const KEEP = 'Your plan and history are safe on this device. You can still download your data, restore or delete a cloud backup, manage your plan and billing, and delete your account.';

/** What the closed-planner screen says, from the state the server reported. The details (dates, prices, what to do next) come from the sections below it. */
export const gateCopy = (view: AccountView): GateCopy => {
  const e = view.entitlement;
  // The title says the planner is paused (the sections below carry their own, more specific headings, so the wording is not repeated);
  // the lead says why.
  const paused = 'Your planner is paused';
  switch (e.state) {
    case 'eligible-not-started':
      return e.canStartTrial
        ? { title: 'Start your free trial', lead: `CleanFlow has a 14-day free trial with no card. Start it to open your planner. ${KEEP}` }
        : { title: 'Confirm your email to start', lead: `Confirm your email address with the link we sent, then you can start your free trial. ${KEEP}` };
    case 'trial-expired':
      return { title: paused, lead: `Your free trial has ended. Choose a plan to keep using the planner. ${KEEP}` };
    case 'payment-action-required':
      return { title: paused, lead: `Your first payment is not finished yet, so nothing is active. Finish it to open the planner. ${KEEP}` };
    case 'past-due':
      return { title: paused, lead: `A payment did not go through and the days of grace are over. The planner opens again when a payment succeeds. ${KEEP}` };
    case 'unpaid':
      return { title: paused, lead: `Payments stopped, so the planner is paused until the subscription is paid. ${KEEP}` };
    case 'suspended':
      return { title: paused, lead: `Access is paused while a payment dispute is open. ${KEEP}` };
    case 'expired':
    default:
      return { title: paused, lead: `Your subscription has ended. Choose a plan to start again. ${KEEP}` };
  }
};

export const UNCONFIRMED_COPY: GateCopy = {
  title: 'We cannot confirm your plan right now',
  lead: 'The server could not be reached, and the time the app may rely on its last confirmation is over. Nothing on this device has been changed or deleted. Connect and try again. You can still download your data.',
};
