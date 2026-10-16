import { describe, expect, it } from 'vitest';
import { checkCurrentPassword, checkEmail, checkName, checkNewPassword, NAME_MAX, PASSWORD_MAX, PASSWORD_MIN, passwordHint } from '../src/account/validation';

describe('account form checks', () => {
  it('emails: accepts ordinary addresses (trimmed), rejects the usual mistakes with a sentence that says what to do', () => {
    expect(checkEmail('  ana@example.com ')).toEqual({ ok: true, value: 'ana@example.com' });
    expect(checkEmail('a.b+tag@mail.example.co.uk').ok).toBe(true);
    for (const bad of ['', '   ', 'ana', 'ana@', '@example.com', 'ana@example', 'ana@@example.com', 'a na@example.com', 'ana@exa mple.com', 'ana@.com', 'ana@example..com']) {
      const r = checkEmail(bad);
      expect(r.ok, bad).toBe(false);
      if (!r.ok) expect(r.message.length).toBeGreaterThan(10);
    }
    expect(checkEmail(`${'a'.repeat(250)}@example.com`).ok).toBe(false);
  });
  it('passwords: 10 to 128 characters, no composition rules, the same limits as the server', () => {
    expect(PASSWORD_MIN).toBe(10);
    expect(PASSWORD_MAX).toBe(128);
    expect(checkNewPassword('a'.repeat(9)).ok).toBe(false);
    expect(checkNewPassword('a'.repeat(10)).ok).toBe(true);
    expect(checkNewPassword('a'.repeat(128)).ok).toBe(true);
    expect(checkNewPassword('a'.repeat(129)).ok).toBe(false);
    expect(checkNewPassword('correct horse battery').ok).toBe(true);        // a passphrase with spaces is fine
    expect(checkNewPassword('').ok).toBe(false);
  });
  it('a password is passed on exactly as typed: never trimmed or altered', () => {
    const r = checkNewPassword('  spaces around me  ');
    expect(r).toEqual({ ok: true, value: '  spaces around me  ' });
    expect(checkCurrentPassword('  x ')).toEqual({ ok: true, value: '  x ' });
    expect(checkCurrentPassword('').ok).toBe(false);
  });
  it('the name is optional: blank falls back to the part of the address before the @', () => {
    expect(checkName('  Ana   Maria ', 'x@example.com')).toEqual({ ok: true, value: 'Ana Maria' });
    expect(checkName('', 'ana.maria@example.com')).toEqual({ ok: true, value: 'ana.maria' });
    expect(checkName('', '').ok).toBe(true);
    expect(checkName('x'.repeat(NAME_MAX + 1), 'a@b.co').ok).toBe(false);
  });
  it('the live hint counts down, then confirms', () => {
    expect(passwordHint('').met).toBe(false);
    expect(passwordHint('abc').text).toBe('7 more characters to go.');
    expect(passwordHint('a'.repeat(9)).text).toBe('1 more character to go.');
    expect(passwordHint('a'.repeat(10))).toEqual({ met: true, text: 'Long enough.' });
    expect(passwordHint('a'.repeat(130)).met).toBe(false);
  });
});
