import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../state/store';
import { downloadText } from '../ui/download';
import { exportJSON } from '../storage/repository';
import { Button } from '../ui/primitives';
import { useAccount } from './AccountProvider';
import { formatWhen } from './cloudBackup';
import { PlanLines, PrivateLines, Side } from './DataParts';
import { intentOutcome, linkSituation, performLink, readClaim, readLegacy, settleIntent, undoClaim, type LinkFailure, type LinkResult } from './link';
import { Notice } from './Screens';

/**
 * Data from before accounts: look at it, then (only if the person says so) copy it into this account. See link.ts for the order of steps.
 * Copying never touches the original, never starts a trial and never talks to the server. Replacing an account's plan is a separate,
 * explicit choice that is never the default.
 */
const FAIL_TEXT: Record<LinkFailure, string> = {
  'no-room-for-copy': 'There is not enough room on this device to keep a restore point first, so nothing was copied and nothing changed. Download the earlier data as a file, free some space, or try again.',
  'not-replaced': 'The copy could not be completed, so nothing was changed. Your earlier data is untouched on this device.',
  'not-saved': 'The copy could not be saved on this device (storage may be full or blocked), so your account’s previous plan was put back. Nothing was lost and your earlier data is untouched.',
};

export const DeviceDataCard = () => {
  const { user, access } = useAccount();
  const app = useApp();
  const accountId = user?.id ?? '';
  const [tick, setTick] = useState(0);
  const [intent, setIntent] = useState(() => intentOutcome(accountId));
  const [choice, setChoice] = useState<'keep' | 'replace'>('keep');
  const [confirming, setConfirming] = useState(false);
  const [alsoOther, setAlsoOther] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<LinkResult | null>(null);
  const [undone, setUndone] = useState(false);
  const previous = useRef(app.data);
  const confirmRef = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);

  const read = useMemo(() => readLegacy(), [tick]);                           // eslint-disable-line react-hooks/exhaustive-deps
  const claim = useMemo(() => readClaim(), [tick, result]);                   // eslint-disable-line react-hooks/exhaustive-deps
  const sit = useMemo(() => linkSituation({ read, own: app.data, accountId, claim }), [read, app.data, accountId, claim]);

  // An earlier copy that was cut short: if its work is in fact done, record that (idempotent); the notice stays until the person has seen it.
  useEffect(() => { if (accountId) settleIntent(accountId, false); }, [accountId]);
  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
    else if (wasConfirming.current) opener.current?.focus();
    wasConfirming.current = confirming;
  }, [confirming]);

  if (!accountId) return null;
  const legacy = sit.legacy;
  const today = app.stamp().today;
  const needsReplace = sit.kind === 'replace' || sit.kind === 'linked';

  const run = () => {
    if (!legacy || busy) return;
    setBusy(true);
    previous.current = app.data;
    const r = performLink({
      accountId,
      repo: app.repo,
      current: app.data,
      replace: (next) => { const ok = app.replaceAll(next, 'before-link', 'Your earlier data was copied into this account.'); if (!ok) app.closeAllSheets(); return ok; },
      revert: (prev) => app.dispatch({ type: 'LOAD', data: prev }),
      flush: () => { try { window.dispatchEvent(new Event('pagehide')); } catch { /* no window */ } },
    }, legacy, needsReplace ? 'replace' : 'copy');
    setResult(r); setConfirming(false); setBusy(false); setUndone(false); setTick((t) => t + 1);
  };

  const undo = () => {
    app.dispatch({ type: 'LOAD', data: previous.current });
    try { window.dispatchEvent(new Event('pagehide')); } catch { /* no window */ }
    undoClaim(accountId);
    setUndone(true); setResult(null); setTick((t) => t + 1);
  };

  const dismissIntent = () => { settleIntent(accountId, true); setIntent({ kind: 'none' }); };
  const downloadEarlier = () => legacy && downloadText(`cleanflow-before-accounts-${today}.json`, exportJSON(legacy.data));

  return (
    <section className="card stack" aria-labelledby="dev-h">
      <h2 id="dev-h" className="h3">Data from before accounts</h2>

      {intent.kind === 'completed' && (
        <div className="stack" role="status"><Notice kind="good">A copy that was started earlier did finish: this account already holds your earlier data. Nothing else is needed.</Notice><div><Button size="sm" variant="secondary" onClick={dismissIntent}>OK</Button></div></div>
      )}
      {intent.kind === 'unchanged' && (
        <div className="stack" role="status"><Notice>A copy that was started earlier did not finish. Nothing was changed: this account’s plan is exactly as it was, and your earlier data is untouched on this device. You can start the copy again below.</Notice><div><Button size="sm" variant="secondary" onClick={dismissIntent}>OK</Button></div></div>
      )}

      {result?.ok && (
        <div className="stack" role="status">
          <Notice kind="good">Done. This account now has your earlier data{result.keptPrevious ? ', and the plan it had before is kept as a restore point' : ''}. Your earlier data is still on this device, untouched, with its own restore point. Nothing was uploaded and nothing about your trial or subscription changed.</Notice>
          <div className="row wrap">
            <Button size="sm" variant="secondary" onClick={undo}>Undo this copy</Button>
            {access.status.kind === 'allowed' && <a className="btn sm ghost" href="#/settings">Restore points in Settings</a>}
          </div>
        </div>
      )}
      {result && !result.ok && (
        <div className="stack"><Notice kind="error">{FAIL_TEXT[result.reason]}</Notice>{legacy && <div><Button size="sm" variant="secondary" onClick={downloadEarlier}>Download my earlier data</Button></div>}</div>
      )}
      {undone && <div role="status"><Notice>Undone. This account is as it was before the copy. Your earlier data is still on this device.</Notice></div>}

      {sit.kind === 'nothing' && !result?.ok && <p data-testid="device-empty">No data from before accounts was found on this device, so there is nothing to copy.</p>}
      {sit.kind === 'unreadable' && read.kind === 'unreadable' && (
        <div className="stack">
          <Notice>This device holds saved data from before accounts that CleanFlow cannot read ({read.reason}). It has been left exactly as it is, and it cannot be copied into an account. You can download the raw text to keep or to send for help.</Notice>
          <div><Button size="sm" variant="secondary" onClick={() => downloadText(`cleanflow-unreadable-${today}.txt`, read.raw)}>Download the unreadable data</Button></div>
        </div>
      )}
      {sit.kind === 'identical' && !result?.ok && !undone && <p data-testid="device-identical">This account already holds exactly the data that is on this device, so there is nothing to copy.</p>}

      {legacy && (sit.kind === 'ready' || needsReplace) && !result?.ok && (
        <div className="stack">
          {sit.kind === 'linked' && <p>Your earlier data was copied into this account on <b>{formatWhen(sit.claim?.at ?? '')}</b>. You have used the plan since, so it is not the same any more. The original is unchanged on this device.</p>}
          {sit.kind === 'ready' && <p>This device holds a plan from before accounts. This account has no plan yet, so copying it replaces nothing.</p>}
          {sit.kind === 'replace' && <p>This device holds a plan from before accounts, and this account already has a plan of its own. Nothing will be merged and nothing is replaced unless you choose that below.</p>}
          {legacy.status !== 'ok' && <p className="small muted">{legacy.status === 'newer' ? 'This data was saved by a newer version of CleanFlow and is read as far as this version understands it.' : legacy.status === 'migrated' ? 'This data was saved by an older version and is brought up to date in the copy.' : 'A few details in this data had to be repaired in the copy.'} The original is left as it is.</p>}

          <div className={needsReplace ? 'compare' : undefined}>
            <Side title="On this device, from before accounts" testId="link-preview">
              {legacy.counts.name && <p className="small">For {legacy.counts.name}</p>}
              <PlanLines counts={legacy.counts} />
              <PrivateLines counts={legacy.counts} />
            </Side>
            {needsReplace && (
              <Side title="In this account, on this device now" testId="link-own">
                <PlanLines counts={sit.own} empty="No plan data." />
                <PrivateLines counts={sit.own ?? { ...legacy.counts, journalEntries: 0, checkinNotes: 0, healthDays: 0 }} />
              </Side>
            )}
          </div>

          {sit.claimedByOther && (
            <label className="check-row small">
              <input type="checkbox" checked={alsoOther} onChange={(e) => setAlsoOther(e.target.checked)} />
              <span>This device’s earlier data was already copied into another account on this device. I understand that copying it here puts the same data, including any private journal, into this account too.</span>
            </label>
          )}

          {needsReplace && (
            <fieldset className="choice-opts">
              <legend className="small muted">What should happen to this account’s plan?</legend>
              <label className={`plan-opt ${choice === 'keep' ? 'on' : ''}`}><input type="radio" name="link-choice" checked={choice === 'keep'} onChange={() => { setChoice('keep'); setConfirming(false); }} /><span className="plan-opt-body"><span className="plan-opt-title">Keep this account’s plan as it is</span><span className="small muted">Nothing changes. Your earlier data stays on this device only.</span></span></label>
              <label className={`plan-opt ${choice === 'replace' ? 'on' : ''}`}><input type="radio" name="link-choice" checked={choice === 'replace'} onChange={() => setChoice('replace')} /><span className="plan-opt-body"><span className="plan-opt-title">Replace it with my earlier data</span><span className="small muted">This account’s current plan is kept as a restore point first, so you can bring it back.</span></span></label>
            </fieldset>
          )}

          {!confirming && (!needsReplace || choice === 'replace') && (
            <div><button ref={opener} type="button" className="btn sm" disabled={busy || (sit.claimedByOther && !alsoOther)} onClick={() => setConfirming(true)}>{needsReplace ? 'Replace my plan with my earlier data…' : 'Copy into my account…'}</button></div>
          )}
          {confirming && (
            <div ref={confirmRef} tabIndex={-1} role="group" aria-labelledby="link-confirm-h" className="confirm-box stack" data-testid="link-confirm">
              <h3 id="link-confirm-h" className="h3">{needsReplace ? 'Replace this account’s plan?' : 'Copy your earlier data into this account?'}</h3>
              <ol className="small data-list">
                <li>A restore point of your earlier data{needsReplace ? ' and of this account’s current plan' : ''} is kept first. If it cannot be kept, nothing is copied.</li>
                <li>{needsReplace ? 'This account’s plan is replaced by' : 'This account receives'} a copy of your earlier data. The original on this device is not changed or deleted.</li>
                <li>Nothing is uploaded. Your trial and subscription are not touched.</li>
              </ol>
              <div className="row wrap">
                <Button size="sm" variant={needsReplace ? 'danger' : 'primary'} disabled={busy} onClick={run}>{busy ? 'Copying…' : needsReplace ? 'Yes, replace my plan' : 'Yes, copy it'}</Button>
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => setConfirming(false)}>Cancel</Button>
              </div>
            </div>
          )}
          <div><Button size="sm" variant="ghost" onClick={downloadEarlier}>Download my earlier data</Button></div>
        </div>
      )}
    </section>
  );
};
