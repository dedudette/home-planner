import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { AccountView } from '../domain/billing/account';
import { TRIAL_DAYS, type PlanId } from '../domain/billing/plans';
import { Button, cx } from '../ui/primitives';
import * as api from './api';
import { useAccount } from './AccountProvider';
import { takeBillingReturn, type BillingReturn } from './billingReturn';
import { describeAuthError, type Described } from './errors';
import { canSubmitTrial, describeBillingUnavailable, formatDate, pricingOptions, safeCheckoutUrl, trialSummary, TRIAL_PROMISE } from './planView';
import { gateCopy } from './access';
import { GateAccountCard } from './GateAccountCard';
import { DraftsNote } from './Drafts';
import { AuthFrame, Notice } from './Screens';
import { AllowanceCard, SubscriptionCard, YourDataCard } from './SubscriptionCards';
import { useAccountView } from './useAccountView';

/**
 * Trial & plans: start the free trial (on purpose, with a tick box), see the trial's dates, and choose a plan to pay for. This screen only
 * ASKS the server and shows its answer. It never decides who has access, never reads the device clock to decide anything, and never treats
 * coming back from the payment page as a payment: the plan changes only when the server reports it.
 */
export const TrialPlans = () => {
  const { mode, user, billingMode, access, announce } = useAccount();
  // When the server says the account has no access, this is the screen the planner is replaced by: the same sections, framed as "paused".
  const paused = access.status.kind === 'blocked';
  const back = paused ? <a href="#/account/data">Data &amp; backup</a> : <a href="#/">Back to the app</a>;
  if (mode !== 'accounts' || !user) {
    return (
      <AuthFrame title="Trial & plans" lead="This setup has no accounts, so there is no trial and nothing to buy. The app works fully on this device." footer={back}>
        <Notice>CleanFlow is running without accounts here. Nothing on this screen is available, and nothing is being charged.</Notice>
      </AuthFrame>
    );
  }
  return <Signed billingMode={billingMode} back={back} paused={paused} announce={announce} />;
};

const Signed = ({ billingMode, back, paused, announce }: { billingMode: 'test' | 'live' | null; back: JSX.Element; paused: boolean; announce: (m: string) => void }) => {
  const { state, refresh, set } = useAccountView();
  const [ret] = useState<BillingReturn>(() => takeBillingReturn());
  const [note, setNote] = useState<{ kind: 'info' | 'good' | 'error'; text: string } | null>(
    ret.kind === 'cancelled' ? { kind: 'info', text: 'Checkout was cancelled. You were not charged and nothing changed.' } : null,
  );
  const [checking, setChecking] = useState(false);
  const checked = useRef(false);

  const confirmPayment = async (sessionId: string | null) => {
    setChecking(true); setNote(null);
    try {
      const r = await api.syncBilling(sessionId ?? undefined);
      set(r.account);
      const e = r.account.entitlement;
      if (e.hasSubscription && (e.state === 'paid-active' || e.state === 'cancellation-scheduled')) setNote({ kind: 'good', text: 'The payment provider confirmed your subscription. Thank you.' });
      else if (e.state === 'payment-action-required') setNote({ kind: 'info', text: 'Your bank needs one more step before the payment completes. Nothing is active yet. Finish it on the payment page, then check again.' });
      else setNote({ kind: 'info', text: 'The payment provider has not confirmed a payment yet. Nothing is assumed: your plan changes only when it confirms. This can take a minute. You can check again.' });
    } catch (e) { setNote({ kind: 'error', text: describeAuthError(e, 'sync').message }); }
    setChecking(false);
  };

  // Coming back from the payment page: ask the server (which asks the provider). The address itself proves nothing.
  useEffect(() => {
    if (state.s !== 'ready' || checked.current || (ret.kind !== 'success' && ret.kind !== 'returned')) return;
    checked.current = true;
    void confirmPayment(ret.kind === 'success' ? ret.sessionId : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.s]);

  if (state.s === 'loading') return <AuthFrame title="Trial & plans" footer={back}><p role="status" className="muted">Loading your plan…</p></AuthFrame>;
  if (state.s === 'error') {
    const d = describeAuthError(state.error, 'load');
    const ended = state.error instanceof api.ApiError && state.error.status === 401;
    return (
      <AuthFrame title="Trial & plans" footer={back}>
        <Notice kind="error">{d.message}</Notice>
        {ended ? <Button onClick={() => window.location.reload()}>Sign in again</Button> : <Button onClick={() => void refresh()}>Try again</Button>}
      </AuthFrame>
    );
  }
  const account = state.account;
  const copy = paused ? gateCopy(account) : null;
  return (
    <AuthFrame title="Trial & plans" lead="Your free trial and your subscription. Nothing here is charged unless you choose a plan and pay on the secure payment page." footer={back} wide>
      {copy && (
        <section className="card stack paused" aria-labelledby="paused-h" data-testid="planner-paused">
          <h2 id="paused-h" className="h3">{copy.title}</h2>
          <p>{copy.lead}</p>
        </section>
      )}
      {paused && <DraftsNote />}
      {billingMode === 'test' && <Notice>This server is connected to the payment provider's test mode. No real money is taken, and test card numbers are used.</Notice>}
      {note && <Notice kind={note.kind}>{note.text}</Notice>}
      {(ret.kind === 'success' || ret.kind === 'returned') && !checking && note?.kind !== 'good' && (
        <div><Button variant="secondary" size="sm" onClick={() => void confirmPayment(ret.kind === 'success' ? ret.sessionId : null)}>Check payment status again</Button></div>
      )}
      <TrialCard account={account} onStarted={(a) => { set(a); setNote({ kind: 'good', text: `Your ${TRIAL_DAYS}-day free trial has started.` }); if (paused) announce(`Your ${TRIAL_DAYS}-day free trial has started. The planner is open.`); }} />
      <SubscriptionCard account={account} onAccount={set} onRefresh={() => void refresh({ quiet: true })} />
      <PlansCard account={account} billingMode={billingMode} onChanged={() => void refresh({ quiet: true })} />
      <AllowanceCard account={account} />
      <YourDataCard account={account} />
      {paused && <GateAccountCard />}
    </AuthFrame>
  );
};

// ───────────────────────────── the trial ─────────────────────────────

const TrialCard = ({ account, onStarted }: { account: AccountView; onStarted: (a: AccountView) => void }) => {
  const t = trialSummary(account);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState<Described | null>(null);
  const canStart = account.entitlement.canStartTrial;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmitTrial({ consent, busy, canStartTrial: canStart })) return;      // Enter in the form can never skip the tick box
    setBusy(true); setFail(null);
    try { onStarted(await api.startTrial()); }
    catch (err) { setFail(describeAuthError(err, 'start-trial')); setBusy(false); }
  };

  if (t.phase === 'subscribed') return null;
  return (
    <section className="card stack" aria-labelledby="trial-h">
      <h2 id="trial-h" className="h3">Free trial</h2>
      {t.phase === 'can-start' && (
        <form className="stack" onSubmit={(e) => void submit(e)} aria-busy={busy}>
          <p>{TRIAL_PROMISE}</p>
          <label className="check-row small">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} aria-describedby="trial-consent-help" />
            <span id="trial-consent-help">I understand that the trial lasts {TRIAL_DAYS} days, needs no card, and that I will not be charged unless I choose a plan and pay for it myself later. A trial can be used once.</span>
          </label>
          {fail && <Notice kind="error">{fail.message}</Notice>}
          <div><Button type="submit" disabled={!canSubmitTrial({ consent, busy, canStartTrial: canStart })}>{busy ? 'Starting…' : `Start my ${TRIAL_DAYS}-day trial`}</Button></div>
        </form>
      )}
      {t.phase === 'active' && t.startedAt && t.endsAt && (
        <div className="stack">
          <p><b>Your free trial is active.</b> {t.daysLeft === 1 ? '1 day left.' : `${t.daysLeft ?? 0} days left.`}</p>
          <p className="small">Started <b>{formatDate(t.startedAt)}</b>. Ends <b>{formatDate(t.endsAt)}</b>. No card is on file and nothing will be charged when it ends.</p>
          <p className="small muted">These dates come from our server, so changing the clock on this device does not change them.</p>
        </div>
      )}
      {t.phase === 'expired' && (
        <div className="stack">
          <p><b>Your free trial has ended{t.endsAt ? ` (on ${formatDate(t.endsAt)})` : ''}.</b> It does not restart. To keep using the parts that need an account, choose a plan below.</p>
        </div>
      )}
      {t.phase === 'unverified' && <p>Confirm your email address with the link we sent, then come back to start the trial.</p>}
      {t.phase === 'unavailable' && <p>The free trial is not available for this account. It can be used once per person.</p>}
    </section>
  );
};

// ───────────────────────────── the plans ─────────────────────────────

const PlansCard = ({ account, billingMode, onChanged }: { account: AccountView; billingMode: 'test' | 'live' | null; onChanged: () => void }) => {
  const e = account.entitlement;
  const options = pricingOptions();
  const [plan, setPlan] = useState<PlanId | null>(null);
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState<Described | null>(null);
  const picked = options.find((o) => o.id === plan) ?? null;
  const available = account.billing.available;

  if (!e.canSubscribe) {
    // A live subscription (or one that needs the person's attention) is described by the Your subscription section above, not here.
    return account.subscription ? null : (
      <section className="card stack" aria-labelledby="plans-h">
        <h2 id="plans-h" className="h3">Choose a plan</h2>
        <p>You cannot choose a plan right now.</p>
      </section>
    );
  }

  const start = async () => {
    if (!picked || busy || !available) return;
    setBusy(true); setFail(null);
    try {
      const r = await api.checkout(picked.id);
      const url = safeCheckoutUrl(r.url);
      if (!url) throw new api.ApiError(502, 'bad-checkout-url', 'The server gave an address the app will not open.');
      window.location.assign(url);                    // the secure payment page; nothing is charged until the person pays there
    } catch (err) {
      const d = describeAuthError(err, 'checkout');
      setFail(d); setBusy(false);
      if (err instanceof api.ApiError && (err.code === 'already-subscribed' || err.code === 'billing-unavailable' || err.code === 'billing-not-configured')) onChanged();
    }
  };

  return (
    <section className="card stack" aria-labelledby="plans-h">
      <h2 id="plans-h" className="h3">Choose a plan</h2>
      <p className="small muted">Both plans include everything. You can cancel at any time and keep access until the end of what you paid for.</p>
      {!available && <Notice>{describeBillingUnavailable(account.billing.reason)}</Notice>}
      <fieldset className="plan-opts" disabled={busy}>
        <legend className="small muted">Plan</legend>
        {options.map((o) => (
          <label key={o.id} className={cx('plan-opt', plan === o.id && 'on')}>
            <input type="radio" name="plan" value={o.id} checked={plan === o.id} onChange={() => { setPlan(o.id); setFail(null); }} />
            <span className="plan-opt-body">
              <span className="plan-opt-title">{o.title}</span>
              <span className="plan-opt-price">{o.priceLine}</span>
              {o.note && <span className="small muted">{o.note}</span>}
            </span>
          </label>
        ))}
      </fieldset>
      <div aria-live="polite" className="stack">
        {picked ? (
          <>
            <Notice>{picked.disclosure}</Notice>
            <p className="small">When you continue you go to the secure payment page of our payment provider. You are charged <b>{picked.chargeNow}</b> only when you pay there.</p>
          </>
        ) : <p className="small muted">Choose a plan to see exactly what you would pay.</p>}
      </div>
      {fail && <Notice kind="error">{fail.message}</Notice>}
      <div>
        <Button disabled={!picked || !available || busy} onClick={() => void start()}>
          {busy ? 'Opening the payment page…' : picked ? `Continue to pay ${picked.priceLine}` : 'Choose a plan'}
        </Button>
      </div>
      {billingMode === 'test' && <p className="small muted">Test mode: no real payment is made.</p>}
    </section>
  );
};
