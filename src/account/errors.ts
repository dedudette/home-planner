import { ApiError } from './api';

/**
 * What to tell a person when an account request fails. The server's own text is not shown as it is (it is for developers); each case is
 * turned into a calm sentence that says what happened and what to do next. Nothing here reveals whether an email address has an account:
 * a wrong password and an unknown email give the same sentence, which is also what the server does.
 */
export type AuthContext = 'sign-in' | 'sign-up' | 'forgot' | 'reset' | 'resend' | 'change-password' | 'delete' | 'sign-out' | 'load' | 'start-trial' | 'checkout' | 'sync' | 'portal' | 'cancel' | 'resume' | 'export'
  | 'backup-load' | 'backup-save' | 'backup-restore' | 'backup-delete';

export interface Described {
  message: string;
  /** What the screen may offer next. */
  action?: 'resend-verification' | 'retry' | 'request-new-link';
}

const TOO_MANY = 'Too many attempts. Wait a minute, then try again.';
// Money screens say what matters: that nothing was charged.
const nothing = (ctx: AuthContext): string => (ctx === 'checkout' ? 'Nothing was charged.' : ctx === 'portal' || ctx === 'cancel' || ctx === 'resume' ? 'Your subscription was not changed.' : 'Nothing was changed.');
const OFFLINE = (ctx: AuthContext): string => `The server could not be reached. Check your connection and try again. ${nothing(ctx)}`;
const GENERIC = (ctx: AuthContext): string => `Something went wrong on our side. ${nothing(ctx)} Try again in a moment.`;

/**
 * Cloud backup failures. What matters here is two facts, stated every time: what happened to the data on this device (nothing: the app
 * only ever COPIES to and from the cloud, and keeps a restore point before it replaces anything) and what is now true of the cloud copy.
 * For an upload that failed without an answer the cloud copy may have changed, and the text says so instead of claiming either way.
 */
const describeBackup = (e: unknown, ctx: 'backup-load' | 'backup-save' | 'backup-restore' | 'backup-delete'): Described => {
  const status = e instanceof ApiError ? e.status : -1;
  const code = e instanceof ApiError ? e.code : '';
  const ended = 'Your session has ended. Sign in again to continue. Nothing was changed.';
  if (status === 401) return { message: ended };
  if (status === 429) return { message: TOO_MANY };
  if (ctx === 'backup-save') {
    if (code === 'no-room') return { message: 'There is not enough room on this device to keep a copy of the cloud backup first, so nothing was uploaded and the cloud copy is unchanged. Download your data as a file, or free some space.' };
    if (status === 402) return { message: 'Backing up needs an active trial or subscription, so nothing was uploaded. Your cloud copy, if there is one, is unchanged, and you can still restore it or delete it.' };
    if (status === 413) return { message: 'This backup is larger than the 5 MB limit, so nothing was uploaded. Leave out the journal or the health readings, or download your data as a file instead.' };
    if (status === 422) return { message: 'The server could not accept this data as a CleanFlow backup, so nothing was uploaded. Your data on this device is unchanged.' };
    if (status === 409 || code === 'conflict') return { message: 'The cloud copy changed since this device last saw it. Nothing was overwritten.' };
    if (status === 400 || status === 403) return { message: 'The request was refused, so nothing was uploaded. Reload the page and try again. Your data on this device is unchanged.', action: 'retry' };
    return { message: 'The upload did not finish, so we cannot tell whether the cloud copy was updated. Your data on this device is unchanged. Check the cloud copy below before trying again.', action: 'retry' };
  }
  if (ctx === 'backup-restore') {
    if (code === 'newer-backup') return { message: 'The cloud copy was made by a newer version of CleanFlow than this one, so it was not restored. Update the app, then try again. Your data on this device is unchanged.' };
    if (code === 'no-room') return { message: 'There is not enough room on this device to keep a restore point of what is here now, so nothing was restored. Download your data as a file first, or free some space.' };
    if (code === 'not-saved') return { message: 'The restored data could not be saved on this device (storage may be full or blocked), so the previous plan was put back. Nothing was lost.' };
    if (status === 422 || code === 'unreadable-backup') return { message: 'The cloud copy could not be read as CleanFlow data, so nothing was restored. Your data on this device is unchanged.' };
    return { message: e instanceof ApiError && e.offline ? 'The server could not be reached, so nothing was restored. Your data on this device is unchanged. Try again when you are online.' : 'The cloud copy could not be fetched, so nothing was restored. Your data on this device is unchanged. Try again in a moment.', action: 'retry' };
  }
  if (ctx === 'backup-delete') return { message: e instanceof ApiError && e.offline ? 'The server could not be reached, so the cloud copy was not deleted. It is still there. Try again when you are online.' : 'The cloud copy could not be deleted, so it is still there. Your data on this device is unchanged. Try again in a moment.', action: 'retry' };
  return { message: e instanceof ApiError && e.offline ? 'The server could not be reached, so your cloud backup could not be checked. Your data on this device is unchanged. Try again when you are online.' : 'Your cloud backup could not be checked just now. Your data on this device is unchanged.', action: 'retry' };
};

export const describeAuthError = (e: unknown, ctx: AuthContext): Described => {
  if (ctx === 'backup-load' || ctx === 'backup-save' || ctx === 'backup-restore' || ctx === 'backup-delete') return describeBackup(e, ctx);
  if (!(e instanceof ApiError)) return { message: GENERIC(ctx), action: 'retry' };
  if (e.offline) return { message: OFFLINE(ctx), action: 'retry' };
  if (ctx === 'sync') {
    if (e.status === 429) return { message: 'One moment, then check again.', action: 'retry' };
    return { message: 'We could not check your payment with the payment provider. Nothing is assumed: your plan changes only when the provider confirms it. Try again in a moment.', action: 'retry' };
  }
  if (e.status === 429) return { message: TOO_MANY };
  if (e.code === 'billing-unavailable' || e.code === 'billing-not-configured') {
    // The server answers 503 with this code when the payment provider cannot be reached or is not set up. It says what is true for each action.
    if (ctx === 'checkout') return { message: 'Subscriptions are not available just now. Nothing was charged.' };
    if (ctx === 'portal') return { message: 'Billing management is not available just now. Your subscription was not changed.', action: 'retry' };
    if (ctx === 'cancel') return { message: 'The payment provider is not available just now, so the cancellation was not made. Your subscription is unchanged. Try again in a moment.', action: 'retry' };
    if (ctx === 'resume') return { message: 'The payment provider is not available just now, so nothing was resumed. Your subscription is unchanged. Try again in a moment.', action: 'retry' };
  }
  if (e.status >= 500) return { message: GENERIC(ctx), action: 'retry' };
  const code = e.code;
  switch (ctx) {
    case 'sign-in':
      // Only the server's own "not confirmed" code: a 403 can also be a refused origin or a proxy, which must not tell the person to check email.
      if (code === 'EMAIL_NOT_VERIFIED') return { message: 'This address has not been confirmed yet. Open the link in the email we sent, or ask for a new one.', action: 'resend-verification' };
      if (e.status === 403) return { message: 'The request was refused. Reload the page and try again. Nothing was changed.', action: 'retry' };
      return { message: 'The email or password is not right. Check both and try again, or reset your password.' };
    case 'sign-up':
      if (code === 'PASSWORD_TOO_SHORT') return { message: 'That password is too short. Use at least 10 characters.' };
      if (code === 'PASSWORD_TOO_LONG') return { message: 'That password is too long. Use at most 128 characters.' };
      if (code === 'INVALID_EMAIL') return { message: 'That does not look like an email address.' };
      return { message: 'The account could not be created with those details. Check them and try again.' };
    case 'forgot':
      return { message: 'The request could not be sent. Check the address and try again.' };
    case 'reset':
      if (code === 'INVALID_TOKEN' || code === 'TOKEN_EXPIRED' || e.status === 400 && /token/i.test(e.message)) return { message: 'This reset link has expired or was already used. Ask for a new one.', action: 'request-new-link' };
      if (code === 'PASSWORD_TOO_SHORT') return { message: 'That password is too short. Use at least 10 characters.' };
      if (code === 'PASSWORD_TOO_LONG') return { message: 'That password is too long. Use at most 128 characters.' };
      return { message: 'The password could not be changed. Ask for a new reset link and try again.', action: 'request-new-link' };
    case 'resend':
      return { message: 'The email could not be sent. Try again in a minute.' };
    case 'change-password':
      if (code === 'INVALID_PASSWORD' || e.status === 401 || e.status === 400 && /password/i.test(e.message)) return { message: 'Your current password is not right.' };
      if (code === 'PASSWORD_TOO_SHORT') return { message: 'The new password is too short. Use at least 10 characters.' };
      return { message: 'The password could not be changed. Nothing was changed.' };
    case 'delete':
      if (code === 'INVALID_PASSWORD' || e.status === 401 || e.status === 400 && /password/i.test(e.message)) return { message: 'That password is not right, so nothing was deleted.' };
      return { message: 'The account could not be deleted, so nothing was changed. If you have a subscription it has to be stopped first; try again in a moment.', action: 'retry' };
    case 'sign-out':
      return { message: 'Signing out could not be completed on the server. You may still be signed in on other devices.', action: 'retry' };
    case 'start-trial':
      if (code === 'already-used' || e.status === 409) return { message: 'The 14-day trial has already been used for this address, so it cannot start again. You can choose a plan instead.' };
      if (code === 'unverified') return { message: 'Confirm your email address first, using the link we sent. Then you can start the trial.' };
      if (e.status === 401) return { message: 'Your session has ended. Sign in again to continue.' };
      return { message: 'The trial could not be started, so nothing was changed. Try again in a moment.', action: 'retry' };
    case 'checkout':
      if (code === 'already-subscribed') return { message: 'You already have a subscription. Nothing was charged.' };
      if (e.status === 401) return { message: 'Your session has ended. Sign in again to continue.' };
      return { message: 'Payment could not be started, so nothing was charged. Try again in a moment.', action: 'retry' };
    case 'portal':
      if (e.status === 401) return { message: 'Your session has ended. Sign in again to continue.' };
      if (code === 'no-billing-account') return { message: 'There is no billing account yet, so there is nothing to manage. Choose a plan first.' };
      return { message: 'The billing page could not be opened. Your subscription was not changed.', action: 'retry' };
    case 'cancel':
      if (e.status === 401) return { message: 'Your session has ended. Sign in again to continue.' };
      if (code === 'no-subscription') return { message: 'There is no active subscription to cancel. Reload to see where things stand.' };
      return { message: 'The cancellation could not be completed, so your subscription is unchanged. Try again in a moment.', action: 'retry' };
    case 'resume':
      if (e.status === 401) return { message: 'Your session has ended. Sign in again to continue.' };
      if (code === 'no-subscription') return { message: 'There is no subscription to resume. Reload to see where things stand.' };
      return { message: 'The subscription could not be resumed, so it is unchanged. Try again in a moment.', action: 'retry' };
    case 'export':
      if (e.status === 401) return { message: 'Your session has ended. Sign in again to continue.' };
      return { message: 'Your data could not be prepared for download. Nothing was changed. Try again in a moment.', action: 'retry' };
    case 'load':
      return { message: e.status === 401 ? 'Your session has ended. Sign in again.' : GENERIC(ctx), action: 'retry' };
  }
};
