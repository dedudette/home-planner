import { useState, type FormEvent } from 'react';
import { useDrafts } from '../state/draftsContext';
import { useApp } from '../state/store';
import { nsKey } from '../storage/namespace';
import { Button } from '../ui/primitives';
import * as api from './api';
import { useAccount } from './AccountProvider';
import { describeAuthError, type Described } from './errors';
import { Field } from './Field';
import { forgetAccountOnDevice } from './link';
import { Notice } from './Screens';
import { checkCurrentPassword } from './validation';

/**
 * Account deletion, in one place so Settings → Account and the Trial & plans screen offer exactly the same thing. It needs the password, the
 * server stops any subscription first (and refuses to delete if it cannot), and this device's copy of the plan is erased only if the person
 * ticks the box. It works whatever the state of the trial or subscription: an ended plan never blocks it.
 */
export const DeleteAccountBox = ({ warning }: { warning?: string }) => {
  const { accountDeleted, user } = useAccount();
  const { repo } = useApp();
  const drafts = useDrafts();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [erase, setErase] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [fail, setFail] = useState<Described | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const cp = checkCurrentPassword(password);
    setErr(cp.ok ? null : cp.message); setFail(null);
    if (!cp.ok) return;
    setBusy(true);
    try {
      await api.deleteAccount(cp.value);
      if (erase) {
        await repo.clear();
        try { for (const k of ['cleanflow:onb-step', 'cleanflow:timer', 'cleanflow:workout', 'cleanflow:scheduled', 'cleanflow:legacy-seen']) window.localStorage.removeItem(nsKey(k)); } catch { /* ignore */ }
      }
      drafts?.discardAll();                                           // unsent text of an account that no longer exists is never kept, whatever is chosen about the plan
      if (user) forgetAccountOnDevice(user.id, erase);
      accountDeleted();
    } catch (er) { setFail(describeAuthError(er, 'delete')); setBusy(false); }
  };

  if (!open) return <div><Button variant="danger" size="sm" onClick={() => setOpen(true)}>Delete my account…</Button></div>;
  return (
    <form className="stack delete-box" onSubmit={(e) => void submit(e)} noValidate aria-busy={busy} aria-label="Delete account">
      <h3 className="h3">Delete my account</h3>
      <p className="small">This permanently deletes your sign-in and everything the server holds for your account. It cannot be undone. Download a backup of your plan first (Settings → Your data) if you want a copy.</p>
      {warning && <p className="small"><b>{warning}</b></p>}
      <Field label="Your password, to confirm" type="password" name="current-password" autoComplete="current-password" value={password} onChange={setPassword} error={err} autoFocus />
      <label className="check-row small">
        <input type="checkbox" checked={erase} onChange={(e) => setErase(e.target.checked)} />
        <span>Also erase this account's plan and history from this device. If you leave this unticked it stays in this browser's storage but can no longer be opened from the app.</span>
      </label>
      {fail && <Notice kind="error">{fail.message}</Notice>}
      <div className="row wrap">
        <Button type="submit" size="sm" variant="danger" disabled={busy}>{busy ? 'Deleting…' : 'Delete my account'}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => { setOpen(false); setPassword(''); setErr(null); setFail(null); }}>Cancel</Button>
      </div>
    </form>
  );
};
