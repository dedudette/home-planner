import { useState, type FormEvent } from 'react';
import { exportJSON } from '../storage/repository';
import { useApp } from '../state/store';
import { downloadText } from '../ui/download';
import { Button } from '../ui/primitives';
import * as api from './api';
import { useAccount } from './AccountProvider';
import { DeleteAccountBox } from './DeleteAccount';
import { describeAuthError, type Described } from './errors';
import { Field } from './Field';
import { readLegacyData } from './legacy';
import { Notice } from './Screens';
import { checkCurrentPassword, checkNewPassword, passwordHint } from './validation';

/**
 * Settings → Account (only when the server has accounts): who is signed in, change password, sign out, the download of data saved before
 * accounts, and account deletion. Nothing here touches subscriptions, cloud backup or any other feature.
 */
export const AccountPanel = () => {
  const { mode, user, signOut } = useAccount();
  const { stamp } = useApp();
  if (mode !== 'accounts' || !user) return null;
  return (
    <section className="card stack-lg" aria-labelledby="s-account">
      <div className="stack">
        <h2 id="s-account" className="h3">Account</h2>
        <p className="small"><span className="muted">Signed in as</span> <b>{user.email}</b> <span className="tag green">{user.emailVerified ? 'Email confirmed' : 'Email not confirmed'}</span></p>
        <p className="small muted">Your plan and history live on this device, under this account. Signing in on another device starts an empty plan there.</p>
      </div>
      <div><a className="btn sm secondary" href="#/account">Trial &amp; plans</a></div>
      <ChangePassword />
      <SignOutRow onSignOut={signOut} />
      <LegacyDownload today={stamp().today} />
      <DeleteAccountBox />
    </section>
  );
};

const ChangePassword = () => {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [errs, setErrs] = useState<{ current?: string; next?: string }>({});
  const [fail, setFail] = useState<Described | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const hint = passwordHint(next);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const cc = checkCurrentPassword(current);
    const cn = checkNewPassword(next);
    setErrs({ current: cc.ok ? undefined : cc.message, next: cn.ok ? undefined : cn.message }); setFail(null); setDone(false);
    if (!cc.ok || !cn.ok) return;
    setBusy(true);
    try { await api.changePassword(cc.value, cn.value); setDone(true); setCurrent(''); setNext(''); setOpen(false); }
    catch (err) { setFail(describeAuthError(err, 'change-password')); }
    setBusy(false);
  };
  if (!open) return (
    <div className="stack">
      {done && <Notice kind="good">Your password was changed. Your other devices were signed out.</Notice>}
      <div><Button variant="secondary" size="sm" onClick={() => { setOpen(true); setDone(false); }}>Change password</Button></div>
    </div>
  );
  return (
    <form className="stack" onSubmit={(e) => void submit(e)} noValidate aria-busy={busy} aria-label="Change password">
      <h3 className="h3">Change password</h3>
      <Field label="Current password" type="password" name="current-password" autoComplete="current-password" value={current} onChange={setCurrent} error={errs.current} autoFocus />
      <Field label="New password" type="password" name="new-password" autoComplete="new-password" value={next} onChange={setNext} error={errs.next} hint={<span aria-live="polite" className={hint.met ? 'pw-ok' : undefined}>{hint.text}</span>} />
      {fail && <Notice kind="error">{fail.message}</Notice>}
      <div className="row wrap">
        <Button type="submit" size="sm" disabled={busy}>{busy ? 'Saving…' : 'Save new password'}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => { setOpen(false); setErrs({}); setFail(null); }}>Cancel</Button>
      </div>
    </form>
  );
};

const SignOutRow = ({ onSignOut }: { onSignOut: () => Promise<void> }) => {
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState<Described | null>(null);
  const run = async () => {
    setBusy(true); setFail(null);
    try { await onSignOut(); } catch (e) { setFail(describeAuthError(e, 'sign-out')); setBusy(false); }
  };
  return (
    <div className="stack">
      {fail && <Notice kind="error">{fail.message}</Notice>}
      <div><Button variant="secondary" size="sm" disabled={busy} onClick={() => void run()}>{busy ? 'Signing out…' : 'Sign out'}</Button></div>
    </div>
  );
};

const LegacyDownload = ({ today }: { today: string }) => {
  const legacy = readLegacyData();
  if (!legacy) return null;
  return (
    <div className="stack">
      <h3 className="h3">Data from before accounts</h3>
      <p className="small muted">This device still holds a plan saved before accounts: {legacy.entries} logged action{legacy.entries === 1 ? '' : 's'} across {legacy.days} day{legacy.days === 1 ? '' : 's'}. It is untouched and was never uploaded. Moving it into an account is not available yet; you can download a copy.</p>
      <div><Button variant="secondary" size="sm" onClick={() => downloadText(`cleanflow-before-accounts-${today}.json`, exportJSON(legacy.data))}>Download my earlier data</Button></div>
    </div>
  );
};
