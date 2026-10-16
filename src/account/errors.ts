import { ApiError } from './api';

/**
 * What to tell a person when an account request fails. The server's own text is not shown as it is (it is for developers); each case is
 * turned into a calm sentence that says what happened and what to do next. Nothing here reveals whether an email address has an account:
 * a wrong password and an unknown email give the same sentence, which is also what the server does.
 */
export type AuthContext = 'sign-in' | 'sign-up' | 'forgot' | 'reset' | 'resend' | 'change-password' | 'delete' | 'sign-out' | 'load' | 'start-trial' | 'checkout' | 'sync';

export interface Described {
  message: string;
  /** What the screen may offer next. */
  action?: 'resend-verification' | 'retry' | 'request-new-link';
}

const TOO_MANY = 'Too many attempts. Wait a minute, then try again.';
// Money screens say what matters: that nothing was charged.
const nothing = (ctx: AuthContext): string => (ctx === 'checkout' ? 'Nothing was charged.' : 'Nothing was changed.');
const OFFLINE = (ctx: AuthContext): string => `The server could not be reached. Check your connection and try again. ${nothing(ctx)}`;
const GENERIC = (ctx: AuthContext): string => `Something went wrong on our side. ${nothing(ctx)} Try again in a moment.`;

export const describeAuthError = (e: unknown, ctx: AuthContext): Described => {
  if (!(e instanceof ApiError)) return { message: GENERIC(ctx), action: 'retry' };
  if (e.offline) return { message: OFFLINE(ctx), action: 'retry' };
  if (ctx === 'sync') {
    if (e.status === 429) return { message: 'One moment, then check again.', action: 'retry' };
    return { message: 'We could not check your payment with the payment provider. Nothing is assumed: your plan changes only when the provider confirms it. Try again in a moment.', action: 'retry' };
  }
  if (e.status === 429) return { message: TOO_MANY };
  if (ctx === 'checkout' && (e.code === 'billing-unavailable' || e.code === 'billing-not-configured')) return { message: 'Subscriptions are not available just now. Nothing was charged.' };
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
    case 'load':
      return { message: e.status === 401 ? 'Your session has ended. Sign in again.' : GENERIC(ctx), action: 'retry' };
  }
};
