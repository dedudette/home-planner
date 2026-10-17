import { useEffect, useRef, useState } from 'react';
import type { AccountView } from '../domain/billing/account';
import { downloadText } from '../ui/download';
import { Button, ProgressBar } from '../ui/primitives';
import * as api from './api';
import { DeleteAccountBox } from './DeleteAccount';
import { describeAuthError, type Described } from './errors';
import { describeBillingUnavailable, formatDate, safeCheckoutUrl } from './planView';
import { Notice } from './Screens';
import { allowanceView, cancelConfirmation, statusLabel, subscriptionPanel, type SubAction } from './subscriptionView';

/**
 * The subscription section of the Trial & plans screen: what the person has, what it costs, when it renews or ends, and what they can do
 * about it. It shows ONLY what the server says (see subscriptionView.ts) and every button asks the server to do the thing: the browser never
 * supplies a customer, a price or an amount, and nothing here changes what the person is allowed to do. The one place that leaves this app is
 * the payment provider's own page (billing portal, payment page), whose address the server creates.
 */
type Note = { kind: 'good' | 'info' | 'error'; text: string } | null;

export const SubscriptionCard = ({ account, onAccount, onRefresh }: { account: AccountView; onAccount: (a: AccountView) => void; onRefresh: () => void }) => {
  const panel = subscriptionPanel(account);
  const sub = account.subscription;
  const [busy, setBusy] = useState<SubAction | null>(null);
  const [note, setNote] = useState<Note>(null);
  const [fail, setFail] = useState<(Described & { ended?: boolean }) | null>(null);
  const [confirming, setConfirming] = useState(false);
  const confirmRef = useRef<HTMLDivElement>(null);
  const cancelBtn = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);

  // Opening the confirmation moves focus into it; closing it puts focus back on the button that opened it.
  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
    else if (wasConfirming.current) cancelBtn.current?.focus();
    wasConfirming.current = confirming;
  }, [confirming]);

  if (!panel.show || !sub) return null;

  const run = async (which: SubAction, fn: () => Promise<void>, ctx: 'portal' | 'cancel' | 'resume' | 'sync' | 'checkout') => {
    if (busy) return;
    setBusy(which); setFail(null); setNote(null);
    try { await fn(); }
    catch (e) {
      const ended = e instanceof api.ApiError && e.status === 401;
      setFail({ ...describeAuthError(e, ctx), ended });
      if (ended) onRefresh();
    }
    setBusy(null);
  };

  const leaveTo = (raw: string): void => {
    const url = safeCheckoutUrl(raw);
    if (!url) throw new api.ApiError(502, 'bad-url', 'The server gave an address the app will not open.');
    window.location.assign(url);                       // the payment provider's own page; the server created this address
  };

  const portal = () => run('portal', async () => { leaveTo(await api.openPortal()); }, 'portal');
  const finish = () => run('finish-payment', async () => { leaveTo((await api.checkout(sub.plan)).url); }, 'checkout');
  const check = () => run('check-status', async () => {
    const r = await api.syncBilling();
    onAccount(r.account);
    setNote({ kind: 'info', text: r.account.entitlement.state === account.entitlement.state ? 'Checked with the payment provider just now: nothing has changed.' : 'Checked with the payment provider. Your plan has been updated below.' });
  }, 'sync');
  const cancel = () => run('cancel', async () => {
    const a = await api.cancelAtPeriodEnd();
    onAccount(a); setConfirming(false);
    setNote({ kind: 'good', text: a.subscription ? `Cancellation scheduled. You keep full access until ${formatDate(a.subscription.currentPeriodEnd)} and will not be charged again.` : 'Cancellation scheduled.' });
  }, 'cancel');
  const resume = () => run('resume', async () => {
    const a = await api.resumeSubscription();
    onAccount(a);
    setNote({ kind: 'good', text: 'Your subscription will renew as before. Nothing else changed.' });
  }, 'resume');

  const has = (a: SubAction) => panel.actions.includes(a);
  const disabled = busy !== null;
  const label = (a: SubAction, idle: string, working: string) => (busy === a ? working : idle);

  return (
    <section className="card stack" aria-labelledby="sub-h" aria-busy={disabled}>
      <h2 id="sub-h" className="h3">Your subscription</h2>
      <div className="stack">
        <h3 className="h3">{panel.headline}</h3>
        {panel.planLine && <p className="small">{panel.planLine} · status: {statusLabel(sub.status)}</p>}
        {panel.lines.map((l) => <p key={l} className="small">{l}</p>)}
      </div>

      {panel.actionsUnavailable === 'billing-unavailable' && <Notice>{describeBillingUnavailable(account.billing.reason)} Your subscription is shown as it is and is not changed.</Notice>}
      {panel.actionsUnavailable === 'other-provider' && <Notice>This subscription is managed by {sub.provider === 'apple' ? 'Apple' : 'Google'}, so it cannot be changed here.</Notice>}

      <div role="status" aria-live="polite" className="stack">{note && <Notice kind={note.kind}>{note.text}</Notice>}</div>
      {fail && <Notice kind="error">{fail.message}</Notice>}
      {fail?.ended && <div><Button size="sm" onClick={() => window.location.reload()}>Sign in again</Button></div>}

      {confirming && has('cancel') && (
        <div ref={confirmRef} tabIndex={-1} role="group" aria-labelledby="cancel-h" className="confirm-box stack">
          <h3 id="cancel-h" className="h3">Cancel at the end of this period?</h3>
          {cancelConfirmation(account).map((t) => <p key={t} className="small">{t}</p>)}
          <div className="row wrap">
            <Button size="sm" variant="danger" disabled={disabled} onClick={() => void cancel()}>{label('cancel', 'Yes, cancel at period end', 'Cancelling…')}</Button>
            <Button size="sm" variant="secondary" disabled={disabled} onClick={() => setConfirming(false)}>Keep my subscription</Button>
          </div>
        </div>
      )}

      {!confirming && (
        <div className="row wrap">
          {has('finish-payment') && <Button size="sm" disabled={disabled} onClick={() => void finish()}>{label('finish-payment', 'Continue to the payment page', 'Opening…')}</Button>}
          {has('resume') && <Button size="sm" disabled={disabled} onClick={() => void resume()}>{label('resume', 'Resume my subscription', 'Resuming…')}</Button>}
          {has('portal') && <Button size="sm" variant="secondary" disabled={disabled} onClick={() => void portal()}>{label('portal', 'Manage billing and invoices', 'Opening…')}</Button>}
          {has('check-status') && <Button size="sm" variant="secondary" disabled={disabled} onClick={() => void check()}>{label('check-status', 'Check status', 'Checking…')}</Button>}
          {has('cancel') && <button ref={cancelBtn} type="button" className="btn sm ghost" disabled={disabled} onClick={() => { setConfirming(true); setFail(null); setNote(null); }}>Cancel at period end</button>}
        </div>
      )}
      {has('portal') && <p className="small muted">The billing page is run by the payment provider. There you can update your card, see invoices and receipts, and switch between the monthly and the annual plan (it shows the amount before you confirm).</p>}
    </section>
  );
};

export const AllowanceCard = ({ account }: { account: AccountView }) => {
  const v = allowanceView(account);
  return (
    <section className="card stack" aria-labelledby="allow-h">
      <h2 id="allow-h" className="h3">AI allowance</h2>
      <p><b>{v.headline}</b></p>
      {v.kind !== 'none' && <ProgressBar value={v.share} label="AI requests used" valueText={v.valueText} />}
      <p className="small">{v.detail}</p>
    </section>
  );
};

/** Export and deletion. Always shown, whatever the trial or subscription says: ending a plan never takes a person's way out away. */
export const YourDataCard = ({ account }: { account: AccountView }) => {
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState<(Described & { ended?: boolean }) | null>(null);
  const [done, setDone] = useState(false);
  const live = account.entitlement.hasSubscription && account.subscription && account.subscription.status !== 'canceled';
  const exportIt = async () => {
    if (busy) return;
    setBusy(true); setFail(null); setDone(false);
    try { downloadText('cleanflow-account.json', await api.downloadAccountExport()); setDone(true); }
    catch (e) { setFail({ ...describeAuthError(e, 'export'), ended: e instanceof api.ApiError && e.status === 401 }); }
    setBusy(false);
  };
  return (
    <section className="card stack" aria-labelledby="data-h">
      <h2 id="data-h" className="h3">Your data and your account</h2>
      <p className="small">Downloading your data, billing and deleting your account are always available, including after your trial or subscription has ended. Your plan and history live on this device and are exported from Settings → Your data.</p>
      <div className="stack">
        <div><Button size="sm" variant="secondary" disabled={busy} onClick={() => void exportIt()}>{busy ? 'Preparing…' : 'Download my account data'}</Button></div>
        <div role="status" aria-live="polite">{done && <Notice kind="good">Your account data was downloaded.</Notice>}</div>
        {fail && <Notice kind="error">{fail.message}</Notice>}
        {fail?.ended && <div><Button size="sm" onClick={() => window.location.reload()}>Sign in again</Button></div>}
      </div>
      <DeleteAccountBox warning={live ? 'Deleting your account stops your subscription straight away. The rest of the period you paid for is not refunded.' : undefined} />
    </section>
  );
};
