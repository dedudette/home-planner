/**
 * Checks the sign-up, sign-in and password forms run before anything is sent. They mirror the server's own limits (Better Auth config in
 * server/auth/auth.ts: passwords of 10 to 128 characters), but the server stays the authority: these only spare a round trip and
 * say what is wrong in plain words. Every message names the field and what to do, never just "invalid".
 */
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;
export const NAME_MAX = 80;
export const EMAIL_MAX = 254;

export type Check = { ok: true; value: string } | { ok: false; message: string };

export const checkEmail = (raw: string): Check => {
  const v = raw.trim();
  if (!v) return { ok: false, message: 'Enter your email address.' };
  if (v.length > EMAIL_MAX) return { ok: false, message: 'That email address is too long.' };
  // One "@", something on both sides, a dot in the domain, no spaces. The server and the confirmation email are the real test.
  if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(v)) return { ok: false, message: 'That does not look like an email address. Check for a missing @ or a typo.' };
  return { ok: true, value: v };
};

export const checkNewPassword = (pw: string): Check => {
  if (!pw) return { ok: false, message: 'Choose a password.' };
  if (pw.length < PASSWORD_MIN) return { ok: false, message: `Use at least ${PASSWORD_MIN} characters. A few short words in a row works well.` };
  if (pw.length > PASSWORD_MAX) return { ok: false, message: `Use at most ${PASSWORD_MAX} characters.` };
  return { ok: true, value: pw };
};

export const checkCurrentPassword = (pw: string): Check => (pw ? { ok: true, value: pw } : { ok: false, message: 'Enter your password.' });

export const checkName = (raw: string, email: string): Check => {
  const v = raw.trim().replace(/\s+/g, ' ');
  if (v.length > NAME_MAX) return { ok: false, message: `Use at most ${NAME_MAX} characters for your name.` };
  // The name is optional: the server needs one, so fall back to the part of the address before the @.
  return { ok: true, value: v || email.split('@')[0].slice(0, NAME_MAX) || 'there' };
};

/** Live feedback while typing a new password. `met` is true once the length rule is satisfied. */
export const passwordHint = (pw: string): { met: boolean; text: string } => {
  if (!pw) return { met: false, text: `At least ${PASSWORD_MIN} characters.` };
  if (pw.length < PASSWORD_MIN) return { met: false, text: `${PASSWORD_MIN - pw.length} more character${PASSWORD_MIN - pw.length === 1 ? '' : 's'} to go.` };
  if (pw.length > PASSWORD_MAX) return { met: false, text: `${pw.length - PASSWORD_MAX} too many characters.` };
  return { met: true, text: 'Long enough.' };
};
