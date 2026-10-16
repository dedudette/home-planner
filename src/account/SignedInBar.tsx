import { useState } from 'react';
import { useAccount } from './AccountProvider';
import { describeAuthError } from './errors';

/**
 * Who is signed in, with a way out. Shown on the welcome page, because until a plan exists the app has no menu, and a new account must
 * still be able to sign out. Once there is a plan, the same is under Settings → Account. Renders nothing without accounts.
 */
export const SignedInBar = () => {
  const { mode, user, signOut } = useAccount();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (mode !== 'accounts' || !user) return null;
  const out = async () => {
    setBusy(true); setErr(null);
    try { await signOut(); } catch (e) { setErr(describeAuthError(e, 'sign-out').message); setBusy(false); }
  };
  return (
    <div className="signed-in-bar small" role="group" aria-label="Account">
      <span>Signed in as <b>{user.email}</b></span>
      <button type="button" className="link-btn" disabled={busy} onClick={() => void out()}>{busy ? 'Signing out…' : 'Sign out'}</button>
      {err && <span className="field-error" role="alert">{err}</span>}
    </div>
  );
};
