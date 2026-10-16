import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { PublicConfig } from '../domain/billing/account';
import { Button } from '../ui/primitives';
import * as api from './api';
import { describeAuthError, type Described } from './errors';
import { Field } from './Field';
import { AuthFrame, Notice } from './Screens';
import { checkCurrentPassword, checkEmail, checkName, checkNewPassword, passwordHint } from './validation';

/**
 * The signed-out screens: sign in, create an account, "check your email", forgot password, choose a new password, and "that link did not
 * work". One small state machine, one screen at a time. Nothing here decides who may use what: a screen only sends the form to the
 * server's own account endpoints (Better Auth) and shows its answer in plain words.
 */
export type FlowStart =
  | { view: 'sign-in'; notice?: string; noticeKind?: 'info' | 'good'; email?: string }
  | { view: 'sign-up' }
  | { view: 'reset'; token: string }
  | { view: 'link-problem'; what: 'verify' | 'reset' | 'unknown' };

type View =
  | { v: 'sign-in'; notice?: string; noticeKind?: 'info' | 'good'; email?: string }
  | { v: 'sign-up' }
  | { v: 'check-email'; email: string }
  | { v: 'forgot'; email?: string }
  | { v: 'forgot-sent'; email: string }
  | { v: 'reset'; token: string }
  | { v: 'link-problem'; what: 'verify' | 'reset' | 'unknown' };

const fromStart = (s: FlowStart): View => {
  switch (s.view) {
    case 'sign-in': return { v: 'sign-in', notice: s.notice, noticeKind: s.noticeKind, email: s.email };
    case 'sign-up': return { v: 'sign-up' };
    case 'reset': return { v: 'reset', token: s.token };
    case 'link-problem': return { v: 'link-problem', what: s.what };
  }
};

type Legal = NonNullable<PublicConfig['accounts']>['legal'];

export const AuthFlow = ({ start, legal, mailDelivers, onSignedIn }: { start: FlowStart; legal: Legal; mailDelivers: boolean; onSignedIn: () => void }) => {
  const [view, setView] = useState<View>(() => fromStart(start));
  const go = (v: View) => setView(v);
  switch (view.v) {
    case 'sign-in': return <SignIn key="in" initialEmail={view.email} notice={view.notice} noticeKind={view.noticeKind} onSignedIn={onSignedIn} go={go} mailDelivers={mailDelivers} />;
    case 'sign-up': return <SignUp key="up" go={go} legal={legal} />;
    case 'check-email': return <CheckEmail email={view.email} go={go} mailDelivers={mailDelivers} />;
    case 'forgot': return <Forgot key="forgot" initialEmail={view.email} go={go} />;
    case 'forgot-sent': return <ForgotSent email={view.email} go={go} mailDelivers={mailDelivers} />;
    case 'reset': return <Reset key="reset" token={view.token} go={go} />;
    case 'link-problem': return <LinkProblem what={view.what} go={go} />;
  }
};

type Go = (v: View) => void;

/** Focuses the first field that has an error, so a keyboard or screen-reader user lands where the problem is. */
const useFocusFirst = () => {
  const refs = useRef<Record<string, HTMLInputElement | null>>({});
  const reg = (name: string) => (el: HTMLInputElement | null) => { refs.current[name] = el; };
  const focus = (names: string[]) => { for (const n of names) { const el = refs.current[n]; if (el) { el.focus(); return; } } };
  return { reg, focus };
};

const FormError = ({ d, onResend, onNewLink, onRetry, busy }: { d: Described; onResend?: () => void; onNewLink?: () => void; onRetry?: () => void; busy?: boolean }) => (
  <Notice kind="error">
    <p>{d.message}</p>
    {d.action === 'resend-verification' && onResend && <button type="button" className="link-btn" disabled={busy} onClick={onResend}>Send the confirmation email again</button>}
    {d.action === 'request-new-link' && onNewLink && <button type="button" className="link-btn" onClick={onNewLink}>Ask for a new link</button>}
    {d.action === 'retry' && onRetry && <button type="button" className="link-btn" disabled={busy} onClick={onRetry}>Try again</button>}
  </Notice>
);

// ───────────────────────────── sign in ─────────────────────────────

const SignIn = ({ initialEmail, notice, noticeKind, onSignedIn, go, mailDelivers }: { initialEmail?: string; notice?: string; noticeKind?: 'info' | 'good'; onSignedIn: () => void; go: Go; mailDelivers: boolean }) => {
  const [email, setEmail] = useState(initialEmail ?? '');
  const [password, setPassword] = useState('');
  const [errs, setErrs] = useState<{ email?: string; password?: string }>({});
  const [fail, setFail] = useState<Described | null>(null);
  const [busy, setBusy] = useState(false);
  const [resent, setResent] = useState(false);
  const { reg, focus } = useFocusFirst();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const ce = checkEmail(email);
    const cp = checkCurrentPassword(password);
    const next = { email: ce.ok ? undefined : ce.message, password: cp.ok ? undefined : cp.message };
    setErrs(next); setFail(null); setResent(false);
    if (!ce.ok || !cp.ok) { focus([next.email ? 'email' : '', next.password ? 'password' : ''].filter(Boolean)); return; }
    setBusy(true);
    try { await api.signIn(ce.value, cp.value); onSignedIn(); }
    catch (err) { setFail(describeAuthError(err, 'sign-in')); setBusy(false); }
  };
  const resend = async () => {
    const ce = checkEmail(email);
    if (!ce.ok) return;
    setBusy(true);
    try { await api.resendVerification(ce.value); go({ v: 'check-email', email: ce.value }); }
    catch (err) { setFail(describeAuthError(err, 'resend')); setBusy(false); }
  };

  return (
    <AuthFrame title="Sign in" lead="Welcome back." footer={<>New here? <button type="button" className="link-btn" onClick={() => go({ v: 'sign-up' })}>Create an account</button></>}>
      {notice && <Notice kind={noticeKind ?? 'good'}>{notice}</Notice>}
      {!mailDelivers && <DevMailNote />}
      <form className="stack" onSubmit={(e) => void submit(e)} noValidate aria-busy={busy}>
        <Field label="Email" type="email" name="email" autoComplete="email" inputMode="email" value={email} onChange={setEmail} error={errs.email} inputRef={reg('email')} autoFocus={!initialEmail} />
        <Field label="Password" type="password" name="password" autoComplete="current-password" value={password} onChange={setPassword} error={errs.password} inputRef={reg('password')} autoFocus={!!initialEmail} />
        {fail && <FormError d={fail} busy={busy} onResend={() => void resend()} />}
        {resent && <Notice>Sent.</Notice>}
        <Button type="submit" block disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</Button>
        <button type="button" className="link-btn center" onClick={() => go({ v: 'forgot', email: checkEmail(email).ok ? email.trim() : undefined })}>Forgot your password?</button>
      </form>
    </AuthFrame>
  );
};

// ───────────────────────────── sign up ─────────────────────────────

const SignUp = ({ go, legal }: { go: Go; legal: Legal }) => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errs, setErrs] = useState<{ name?: string; email?: string; password?: string }>({});
  const [fail, setFail] = useState<Described | null>(null);
  const [busy, setBusy] = useState(false);
  const { reg, focus } = useFocusFirst();
  const hint = passwordHint(password);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const ce = checkEmail(email);
    const cp = checkNewPassword(password);
    const cn = checkName(name, ce.ok ? ce.value : email);
    const next = { name: cn.ok ? undefined : cn.message, email: ce.ok ? undefined : ce.message, password: cp.ok ? undefined : cp.message };
    setErrs(next); setFail(null);
    if (!ce.ok || !cp.ok || !cn.ok) { focus([next.name ? 'name' : '', next.email ? 'email' : '', next.password ? 'password' : ''].filter(Boolean)); return; }
    setBusy(true);
    try { await api.signUp(ce.value, cp.value, cn.value); go({ v: 'check-email', email: ce.value }); }
    catch (err) { setFail(describeAuthError(err, 'sign-up')); setBusy(false); }
  };

  return (
    <AuthFrame title="Create your account" lead="It takes a minute. We will email you a link to confirm your address." footer={<>Already have an account? <button type="button" className="link-btn" onClick={() => go({ v: 'sign-in' })}>Sign in</button></>}>
      <form className="stack" onSubmit={(e) => void submit(e)} noValidate aria-busy={busy}>
        <Field label="Your name (optional)" name="name" autoComplete="given-name" value={name} onChange={setName} error={errs.name} inputRef={reg('name')} maxLength={80} />
        <Field label="Email" type="email" name="email" autoComplete="email" inputMode="email" value={email} onChange={setEmail} error={errs.email} inputRef={reg('email')} autoFocus />
        <Field label="Password" type="password" name="new-password" autoComplete="new-password" value={password} onChange={setPassword} error={errs.password} inputRef={reg('password')}
          hint={<span aria-live="polite" className={hint.met ? 'pw-ok' : undefined}>{hint.text}</span>} />
        {fail && <FormError d={fail} />}
        <Button type="submit" block disabled={busy}>{busy ? 'Creating your account…' : 'Create account'}</Button>
        <LegalLine legal={legal} />
      </form>
    </AuthFrame>
  );
};

const LegalLine = ({ legal }: { legal: Legal }) => {
  const links = [legal.terms && <a key="t" href={legal.terms} target="_blank" rel="noreferrer noopener">terms</a>, legal.privacy && <a key="p" href={legal.privacy} target="_blank" rel="noreferrer noopener">privacy policy</a>].filter(Boolean);
  if (!links.length) return <p className="small muted center">Your plan and history stay on this device. Creating an account does not upload them.</p>;
  return <p className="small muted center">By creating an account you agree to the {links[0]}{links[1] ? <> and the {links[1]}</> : null}. Your plan and history stay on this device.</p>;
};

const DevMailNote = () => <Notice>This server is in development mode and does not send email: confirmation and reset links are printed in the server log instead.</Notice>;

// ───────────────────────────── check your email ─────────────────────────────

const RESEND_WAIT = 30;

const CheckEmail = ({ email, go, mailDelivers }: { email: string; go: Go; mailDelivers: boolean }) => {
  const [wait, setWait] = useState(RESEND_WAIT);
  const [msg, setMsg] = useState<{ kind: 'good' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (wait <= 0) return;
    const t = window.setTimeout(() => setWait((w) => w - 1), 1000);
    return () => window.clearTimeout(t);
  }, [wait]);
  const resend = async () => {
    setBusy(true); setMsg(null);
    try { await api.resendVerification(email); setMsg({ kind: 'good', text: 'We sent another email.' }); setWait(RESEND_WAIT); }
    catch (err) { setMsg({ kind: 'error', text: describeAuthError(err, 'resend').message }); }
    setBusy(false);
  };
  return (
    <AuthFrame title="Check your email" lead={<>We sent a link to <b>{email}</b>. Open it on this device to confirm your address and finish. The link works for 24 hours.</>}
      footer={<button type="button" className="link-btn" onClick={() => go({ v: 'sign-in', email })}>I have confirmed: sign in</button>}>
      {!mailDelivers && <DevMailNote />}
      <p className="small muted">Nothing arrived? Look in your spam folder, and check the address above for typos.</p>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      <Button variant="secondary" block disabled={busy || wait > 0} onClick={() => void resend()}>{wait > 0 ? `Send again in ${wait}s` : 'Send the email again'}</Button>
      <button type="button" className="link-btn center" onClick={() => go({ v: 'sign-up' })}>Use a different email</button>
    </AuthFrame>
  );
};

// ───────────────────────────── forgot / reset ─────────────────────────────

const Forgot = ({ initialEmail, go }: { initialEmail?: string; go: Go }) => {
  const [email, setEmail] = useState(initialEmail ?? '');
  const [err, setErr] = useState<string | null>(null);
  const [fail, setFail] = useState<Described | null>(null);
  const [busy, setBusy] = useState(false);
  const { reg, focus } = useFocusFirst();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const ce = checkEmail(email);
    setErr(ce.ok ? null : ce.message); setFail(null);
    if (!ce.ok) { focus(['email']); return; }
    setBusy(true);
    try { await api.requestReset(ce.value); go({ v: 'forgot-sent', email: ce.value }); }
    catch (er) { setFail(describeAuthError(er, 'forgot')); setBusy(false); }
  };
  return (
    <AuthFrame title="Reset your password" lead="Enter your email address and we will send you a link to choose a new password." footer={<button type="button" className="link-btn" onClick={() => go({ v: 'sign-in' })}>Back to sign in</button>}>
      <form className="stack" onSubmit={(e) => void submit(e)} noValidate aria-busy={busy}>
        <Field label="Email" type="email" name="email" autoComplete="email" inputMode="email" value={email} onChange={setEmail} error={err} inputRef={reg('email')} autoFocus />
        {fail && <FormError d={fail} />}
        <Button type="submit" block disabled={busy}>{busy ? 'Sending…' : 'Send the link'}</Button>
      </form>
    </AuthFrame>
  );
};

const ForgotSent = ({ email, go, mailDelivers }: { email: string; go: Go; mailDelivers: boolean }) => (
  <AuthFrame title="Check your email" lead={<>If there is an account for <b>{email}</b>, we have sent a link to choose a new password. It works for one hour.</>}
    footer={<button type="button" className="link-btn" onClick={() => go({ v: 'sign-in', email })}>Back to sign in</button>}>
    {!mailDelivers && <DevMailNote />}
    <p className="small muted">We say this either way, so nobody can use this page to find out who has an account. Nothing arrived? Check your spam folder, or try again with another address.</p>
    <Button variant="secondary" block onClick={() => go({ v: 'forgot', email })}>Use a different address</Button>
  </AuthFrame>
);

const Reset = ({ token, go }: { token: string; go: Go }) => {
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [fail, setFail] = useState<Described | null>(null);
  const [busy, setBusy] = useState(false);
  const { reg, focus } = useFocusFirst();
  const hint = passwordHint(password);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const cp = checkNewPassword(password);
    setErr(cp.ok ? null : cp.message); setFail(null);
    if (!cp.ok) { focus(['password']); return; }
    setBusy(true);
    try { await api.resetPassword(token, cp.value); go({ v: 'sign-in', notice: 'Your password was changed. Sign in with the new one. Any other device was signed out.' }); }
    catch (er) { setFail(describeAuthError(er, 'reset')); setBusy(false); }
  };
  return (
    <AuthFrame title="Choose a new password" lead="Pick something you do not use anywhere else.">
      <form className="stack" onSubmit={(e) => void submit(e)} noValidate aria-busy={busy}>
        <Field label="New password" type="password" name="new-password" autoComplete="new-password" value={password} onChange={setPassword} error={err} inputRef={reg('password')} autoFocus
          hint={<span aria-live="polite" className={hint.met ? 'pw-ok' : undefined}>{hint.text}</span>} />
        {fail && <FormError d={fail} onNewLink={() => go({ v: 'forgot' })} />}
        <Button type="submit" block disabled={busy}>{busy ? 'Saving…' : 'Save the new password'}</Button>
      </form>
    </AuthFrame>
  );
};

const LinkProblem = ({ what, go }: { what: 'verify' | 'reset' | 'unknown'; go: Go }) => (
  <AuthFrame
    title={what === 'reset' ? 'This reset link did not work' : what === 'verify' ? 'This confirmation link did not work' : 'This link did not work'}
    lead={what === 'reset' ? 'It may have expired (they last one hour) or already been used. You can ask for a new one.' : 'It may have expired (they last 24 hours) or already been used. If you can sign in, your address is already confirmed. Otherwise sign in and we will send a fresh email.'}
  >
    {what === 'reset'
      ? <Button block onClick={() => go({ v: 'forgot' })}>Ask for a new link</Button>
      : <Button block onClick={() => go({ v: 'sign-in' })}>Go to sign in</Button>}
    {what === 'reset' && <button type="button" className="link-btn center" onClick={() => go({ v: 'sign-in' })}>Back to sign in</button>}
  </AuthFrame>
);
