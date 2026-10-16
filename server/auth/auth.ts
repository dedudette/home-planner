import { betterAuth } from 'better-auth';
import type { AccountsConfig } from '../config';
import type { Db } from '../db/pool';
import type { Mailer } from '../mail/mailer';
import { resetPassword, verifyEmail } from '../mail/templates';

/**
 * Accounts, sessions and credentials come from Better Auth, a maintained library, not from code written here: it hashes passwords (scrypt),
 * issues random session tokens kept in an HttpOnly cookie, sends one-time email-verification and password-reset tokens, checks the request
 * origin on every state-changing call, and rate-limits sign-in and the email endpoints (counters in the database, so limits survive a
 * restart and are shared by every server instance). What this file decides is configuration:
 *
 *  - email + password only. There are no social-login buttons because none is implemented.
 *  - an account must verify its email before a session is created, so everyone who can sign in has a working address.
 *  - passwords of at least 10 characters; a reset ends every other session; sessions last 14 days and refresh daily.
 *  - deleting the account needs the password (a fresh proof), and runs `beforeDelete` first so billing can be stopped; if that fails,
 *    nothing is deleted and the person can retry.
 *  - the tables already exist (migrations/0001_auth.sql); nothing is created at run time.
 */
export interface AuthHooks {
  /** Throw to stop the deletion (for example when the subscription could not be cancelled). */
  beforeDelete?: (user: { id: string; email: string }) => Promise<void>;
  log?: (e: { event: string; code?: string }) => void;
}

export const createAuth = (opts: { db: Db; config: AccountsConfig; mailer: Mailer; hooks?: AuthHooks; rateLimit?: { signIn?: { window: number; max: number } } }) => {
  const { config, mailer } = opts;
  const log = opts.hooks?.log ?? (() => undefined);
  // Mail is sent without waiting, so a slow or failing provider does not change how long a request takes (which would let a caller tell
  // whether an address has an account). A failure is logged by code only; the person can ask for the email again.
  const mail = (to: string, r: { subject: string; text: string }, key: string): void => {
    void mailer.send({ to, subject: r.subject, text: r.text, idempotencyKey: key }).then((res) => { if (res.status === 'failed') log({ event: 'mail.failed', code: res.code }); }, () => log({ event: 'mail.failed', code: 'exception' }));
  };
  const signIn = opts.rateLimit?.signIn ?? { window: 60, max: 8 };
  return betterAuth({
    appName: 'CleanFlow',
    baseURL: config.appOrigin,
    basePath: '/api/auth',
    secret: config.authSecret,
    database: opts.db,
    trustedOrigins: [config.appOrigin],
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      resetPasswordTokenExpiresIn: 60 * 60,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => { mail(user.email, resetPassword(url), `reset:${user.id}:${Math.floor(Date.now() / 60_000)}`); },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      expiresIn: 24 * 60 * 60,
      sendVerificationEmail: async ({ user, url }) => { mail(user.email, verifyEmail(url), `verify:${user.id}:${Math.floor(Date.now() / 60_000)}`); },
    },
    session: { expiresIn: 14 * 24 * 60 * 60, updateAge: 24 * 60 * 60, freshAge: 10 * 60 },
    user: {
      deleteUser: {
        enabled: true,
        beforeDelete: async (user) => { await opts.hooks?.beforeDelete?.({ id: user.id, email: user.email }); },
      },
    },
    advanced: {
      useSecureCookies: config.production,
      cookiePrefix: 'cleanflow',
      defaultCookieAttributes: { sameSite: 'lax', httpOnly: true, secure: config.production, path: '/' },
      // The node adapter sets this header from the connection itself and removes any value the caller sent.
      ipAddress: { ipAddressHeaders: ['x-coach-client'] },
    },
    rateLimit: {
      enabled: true,
      storage: 'database',
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/email': signIn,
        '/sign-up/email': { window: 60 * 60, max: 10 },
        '/request-password-reset': { window: 60 * 60, max: 5 },
        '/send-verification-email': { window: 60 * 60, max: 5 },
        '/reset-password': { window: 60 * 60, max: 10 },
        '/delete-user': { window: 60 * 60, max: 5 },
        '/change-password': { window: 60 * 60, max: 10 },
      },
    },
  });
};

export type Auth = ReturnType<typeof createAuth>;

export interface SessionUser { id: string; email: string; name: string; emailVerified: boolean }

/** The one place a request is turned into an identity: the server-side session behind the cookie. Nothing else the request says counts. */
export const sessionUser = async (auth: Auth, req: Request): Promise<SessionUser | null> => {
  const s = await auth.api.getSession({ headers: req.headers });
  if (!s?.user) return null;
  return { id: s.user.id, email: s.user.email, name: s.user.name, emailVerified: s.user.emailVerified === true };
};
