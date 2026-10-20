import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { AppData } from '../domain/types';
import { BACKUP_REASON } from '../storage/backupReasons';
import { countData, mergeRestore, planUpload, sameData, type DataCounts, type Include } from '../storage/backupPlan';
import { hasUserData, validateAppData } from '../storage/schema';
import { useApp } from '../state/store';
import { downloadText } from '../ui/download';
import { exportJSON } from '../storage/repository';
import { Button } from '../ui/primitives';
import * as api from './api';
import { useAccount } from './AccountProvider';
import {
  clearCloudRecord, clearPending, cloudPendingKey, cloudRecordKey, conflictCurrent, formatSize, formatWhen, includesLine, readCloudRecord, readPending,
  uploadVerdict, writeCloudRecord, writePending, type CloudRecord, type PendingUpload,
} from './cloudBackup';
import { PlanLines, PrivateLines, Side } from './DataParts';
import { describeAuthError, type Described } from './errors';
import { Notice } from './Screens';
import { useAccountView } from './useAccountView';

/**
 * Optional, manual cloud backup. Nothing is sent unless the person presses Upload on a preview that lists exactly what will go; the private
 * journal and the health readings are off by default and are separate choices; an upload only ever REPLACES the cloud copy this device last
 * saw (the server checks the revision), and anything else is shown side by side and left to the person. Restoring replaces this device's plan
 * only after a restore point of it is kept. Deleting the cloud copy is always available. Whether backing up is allowed at all is the
 * server's decision (it answers 402 without an active trial or subscription); this card only decides whether to offer the button.
 */
type Load = { s: 'loading' } | { s: 'ready'; meta: api.BackupMeta | null } | { s: 'error'; error: unknown };
type Panel = null | 'backup' | 'restore' | 'delete';
type Busy = null | 'upload' | 'restore' | 'delete' | 'replace';
type Note = { kind: 'good' | 'info'; text: string } | null;
type Cloud = { meta: api.BackupMeta; data: AppData };
type CloudCopy = { s: 'idle' } | { s: 'loading' } | { s: 'ready'; cloud: Cloud } | { s: 'error'; error: unknown };

const n = (count: number, one: string, many = `${one}s`): string => `${count} ${count === 1 ? one : many}`;
const fail = (code: string, message: string): api.ApiError => new api.ApiError(422, code, message);

/** Fetch the cloud copy in full and make sure it is something this version can read. */
const fetchCloud = async (): Promise<Cloud | null> => {
  const r = await api.getBackup();
  if (!r) return null;
  const v = validateAppData(r.data);
  if (!v) throw fail('unreadable-backup', 'The cloud copy is not CleanFlow data.');
  if (v.fromFuture) throw fail('newer-backup', 'The cloud copy is from a newer version.');
  return { meta: r.backup, data: v.data };
};

const useCloudCopy = (active: boolean, revision: number | null): [CloudCopy, () => void] => {
  const [state, setState] = useState<CloudCopy>({ s: 'idle' });
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!active || revision === null) { setState({ s: 'idle' }); return; }
    let live = true;
    setState({ s: 'loading' });
    fetchCloud().then((cloud) => { if (live) setState(cloud ? { s: 'ready', cloud } : { s: 'idle' }); }, (error) => { if (live) setState({ s: 'error', error }); });
    return () => { live = false; };
  }, [active, revision, n]);
  return [state, () => setN((x) => x + 1)];
};

const Counts = ({ counts, title, testId }: { counts: DataCounts; title: string; testId?: string }) => (
  <Side title={title} testId={testId} level={4}><PlanLines counts={counts} /><PrivateLines counts={counts} /></Side>
);

export const CloudBackupCard = () => {
  const { user } = useAccount();
  const app = useApp();
  const accountId = user?.id ?? '';
  const recKey = cloudRecordKey(accountId);
  const pendKey = cloudPendingKey(accountId);
  const acct = useAccountView();
  const [load, setLoad] = useState<Load>({ s: 'loading' });
  const [record, setRecord] = useState<CloudRecord | null>(() => readCloudRecord(recKey));
  const [pending, setPending] = useState<PendingUpload | null>(() => readPending(pendKey));
  const [panel, setPanel] = useState<Panel>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [note, setNote] = useState<Note>(null);
  const [problem, setProblem] = useState<(Described & { ended?: boolean }) | null>(null);
  const [include, setInclude] = useState<Record<Include, boolean>>({ journal: false, health: false });
  const [understood, setUnderstood] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    setLoad({ s: 'loading' });
    try { setLoad({ s: 'ready', meta: await api.getBackupMeta() }); } catch (error) { setLoad({ s: 'error', error }); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { if (panel) panelRef.current?.focus(); }, [panel]);

  const meta = load.s === 'ready' ? load.meta : null;
  const verdict = load.s === 'ready' ? uploadVerdict(record, meta) : null;
  const conflict = verdict && verdict.kind !== 'first' && verdict.kind !== 'update' ? verdict.kind : null;
  const chosen: Include[] = (['journal', 'health'] as const).filter((i) => include[i]);
  const plan = planUpload(app.data, chosen);
  const have = countData(app.data);
  const canOffer = acct.state.s !== 'ready' || acct.state.account.entitlement.access === 'full';      // the server still decides
  const [copy, retryCopy] = useCloudCopy(panel === 'restore' || (panel === 'backup' && !!conflict && !!meta), meta?.revision ?? null);

  const fail409 = (e: unknown): boolean => {
    if (!(e instanceof api.ApiError) || e.status !== 409) return false;
    const cur = conflictCurrent(e.extra);
    if (cur === undefined) void refresh(); else setLoad({ s: 'ready', meta: cur });
    setNote({ kind: 'info', text: 'The cloud copy changed since this device last saw it. Nothing was overwritten. Choose what to do below.' });
    return true;
  };

  const closePanel = () => { setPanel(null); setProblem(null); setUnderstood(false); };

  const upload = async (base: number | null, afterCopyOf?: Cloud) => {
    if (busy) return;
    setBusy(afterCopyOf ? 'replace' : 'upload'); setProblem(null); setNote(null);
    try {
      if (afterCopyOf && !app.repo.backup(afterCopyOf.data, 'cloud-copy')) throw fail('no-room', 'No room for a copy of the cloud backup.');
      writePending(pendKey, { startedAt: new Date().toISOString(), baseRevision: base, includes: plan.includes });
      const saved = await api.putBackup(base, plan.includes, plan.payload);
      writeCloudRecord(recKey, saved); setRecord(readCloudRecord(recKey));
      clearPending(pendKey); setPending(null);
      setLoad({ s: 'ready', meta: saved }); closePanel();
      setNote({ kind: 'good', text: `Backed up. This is revision ${saved.revision}, ${formatSize(saved.sizeBytes)}, saved ${formatWhen(saved.updatedAt)}.${afterCopyOf ? ' A copy of the cloud backup it replaced is kept on this device as a restore point.' : ''}` });
    } catch (e) {
      const definite = e instanceof api.ApiError && e.status >= 400 && e.status < 500 && e.status !== 408;
      if (definite) { clearPending(pendKey); setPending(null); } else setPending(readPending(pendKey));
      if (!fail409(e)) setProblem({ ...describeAuthError(e, 'backup-save'), ended: e instanceof api.ApiError && e.status === 401 });
    }
    setBusy(null);
  };

  const restore = async (cloud: Cloud) => {
    if (busy) return;
    setBusy('restore'); setProblem(null); setNote(null);
    const before = app.data;
    try {
      const merged = mergeRestore(cloud.data, cloud.meta.includes, before);
      if (hasUserData(before) && !app.repo.backup(before, 'before-cloud-restore')) throw fail('no-room', 'No room for a restore point.');
      if (!app.replaceAll(merged.data, 'before-cloud-restore', 'Restored from your cloud backup.')) { app.closeAllSheets(); throw fail('no-room', 'No room for a restore point.'); }
      try { window.dispatchEvent(new Event('pagehide')); } catch { /* no window */ }
      const stored = app.repo.peek?.();
      if (!stored?.data || !sameData(stored.data, merged.data)) {
        app.dispatch({ type: 'LOAD', data: before });
        try { window.dispatchEvent(new Event('pagehide')); } catch { /* no window */ }
        throw fail('not-saved', 'The restored data could not be saved.');
      }
      writeCloudRecord(recKey, cloud.meta); setRecord(readCloudRecord(recKey));
      closePanel();
      setNote({ kind: 'good', text: `Restored revision ${cloud.meta.revision} from ${formatWhen(cloud.meta.updatedAt)} onto this device. What was here before is kept as a restore point.${merged.kept.journalEntries + merged.kept.checkinNotes + merged.kept.healthDays > 0 ? ' Your private journal and health readings that were not in the backup stayed as they were.' : ''}` });
    } catch (e) { setProblem({ ...describeAuthError(e, 'backup-restore'), ended: e instanceof api.ApiError && e.status === 401 }); }
    setBusy(null);
  };

  const remove = async () => {
    if (busy) return;
    setBusy('delete'); setProblem(null); setNote(null);
    try {
      await api.deleteBackup();
      clearCloudRecord(recKey); setRecord(null); clearPending(pendKey); setPending(null);
      setLoad({ s: 'ready', meta: null }); closePanel();
      setNote({ kind: 'good', text: 'The cloud backup was deleted from your account. Your data on this device was not touched.' });
    } catch (e) { setProblem({ ...describeAuthError(e, 'backup-delete'), ended: e instanceof api.ApiError && e.status === 401 }); }
    setBusy(null);
  };

  const downloadHere = () => downloadText(`cleanflow-backup-${app.stamp().today}.json`, exportJSON(app.data));
  // Every time the backup panel opens, the private parts are unticked again: leaving them out is the default each time, not just the first.
  const open = (p: Panel) => { setPanel(p); setProblem(null); setNote(null); setUnderstood(false); if (p === 'backup') setInclude({ journal: false, health: false }); };

  // ───────── the pieces ─────────
  const status: ReactNode = load.s === 'loading' ? <p role="status" className="muted">Checking your cloud backup…</p>
    : load.s === 'error' ? (
      <div className="stack">
        <Notice kind="error">{describeAuthError(load.error, 'backup-load').message}</Notice>
        <div className="row wrap">
          <Button size="sm" onClick={() => void refresh()}>Try again</Button>
          {load.error instanceof api.ApiError && load.error.status === 401 && <Button size="sm" variant="secondary" onClick={() => window.location.reload()}>Sign in again</Button>}
        </div>
      </div>
    ) : !meta ? (
      <div className="stack" data-testid="cloud-empty">
        <p><b>No cloud backup.</b> Nothing from your plan is stored in your account. Backing up is optional and manual: nothing is sent unless you press Back up now.</p>
        {record && <Notice>This device last saw a cloud copy (revision {record.revision}), but it has since been deleted.</Notice>}
      </div>
    ) : (
      <div className="stack" data-testid="cloud-status">
        <p><b>You have a cloud backup.</b> Revision {meta.revision}, saved {formatWhen(meta.updatedAt)}, {formatSize(meta.sizeBytes)}.</p>
        <p className="small">It contains: {includesLine(meta.includes)}.</p>
        <p className="small muted">{!record ? 'This device has not backed up to, or restored from, this copy.' : record.revision === meta.revision ? `This device is up to date with it (last synced ${formatWhen(record.at)}).` : `The cloud copy has changed since this device last saw it (this device saw revision ${record.revision}).`}</p>
      </div>
    );

  const privateChoice = (which: Include, title: string, detail: string, have: number, haveText: string): ReactNode => (
    <label className="check-row small" key={which}>
      <input type="checkbox" checked={include[which]} disabled={busy !== null} onChange={(e) => setInclude((x) => ({ ...x, [which]: e.target.checked }))} />
      <span><b>{title}</b> <span className="muted">{have > 0 ? haveText : 'You have none on this device.'}</span><br />{detail}</span>
    </label>
  );

  const backupPanel = (
    <div ref={panelRef} tabIndex={-1} role="group" aria-labelledby="bk-h" className="confirm-box stack" data-testid="backup-panel">
      <h3 id="bk-h" className="h3">Back up to my account</h3>
      <fieldset className="stack" style={{ border: 0, margin: 0, padding: 0 }}>
        <legend className="small muted">Left out unless you tick them. Each is its own choice.</legend>
        {privateChoice('journal', 'Include my private journal and check-in notes', 'Stored as readable text on the server, which is not end-to-end encrypted.', have.journalEntries + have.checkinNotes, `${n(have.journalEntries, 'journal entry', 'journal entries')} and ${n(have.checkinNotes, 'check-in note')}.`)}
        {privateChoice('health', 'Include my health readings', 'Readings imported from Apple Health or Health Connect.', have.healthDays, `${n(have.healthDays, 'day')} of readings.`)}
      </fieldset>
      <div className="stack" aria-live="polite" data-testid="upload-preview">
        <h4 className="h3">Exactly what will be uploaded</h4>
        <PlanLines counts={plan.sent} empty="No plan data." />
        <ul className="data-list">
          <li data-testid="preview-journal">{plan.includes.includes('journal') ? `Private journal: ${n(plan.sent.journalEntries, 'entry', 'entries')} and ${n(plan.sent.checkinNotes, 'check-in note')}, as readable text` : `Private journal and check-in notes: not uploaded${plan.withheld.journalEntries + plan.withheld.checkinNotes > 0 ? ` (${n(plan.withheld.journalEntries, 'entry', 'entries')} and ${n(plan.withheld.checkinNotes, 'note')} stay on this device)` : ''}`}</li>
          <li data-testid="preview-health">{plan.includes.includes('health') ? `Health readings: ${n(plan.sent.healthDays, 'day')}` : `Health readings: not uploaded${plan.withheld.healthDays > 0 ? ` (${n(plan.withheld.healthDays, 'day')} stay on this device)` : ''}`}</li>
        </ul>
        <p className="small muted">About {formatSize(plan.bytes)}. {meta ? (conflict ? 'It would replace the cloud copy only if you choose that below.' : `It replaces the cloud copy (revision ${meta.revision}, saved ${formatWhen(meta.updatedAt)}).`) : 'This would be your first cloud copy.'}</p>
        {meta && !conflict && meta.includes.includes('journal') && !plan.includes.includes('journal') && <Notice>The current cloud copy includes your journal. This upload leaves it out, so the journal is removed from the cloud.</Notice>}
        {meta && !conflict && meta.includes.includes('health') && !plan.includes.includes('health') && <Notice>The current cloud copy includes your health readings. This upload leaves them out, so they are removed from the cloud.</Notice>}
      </div>
      {!hasUserData(app.data) && <Notice>There is no plan on this device yet, so there is nothing to back up. Backing up an empty plan would replace your cloud copy with nothing. Set up your plan first, or restore the cloud copy.</Notice>}
      {plan.tooLarge && <Notice kind="error">This backup would be {formatSize(plan.bytes)}, over the 5 MB limit, so it cannot be uploaded. Leave out the journal or the health readings, or download your data as a file instead.</Notice>}
      {problem && <Notice kind="error">{problem.message}</Notice>}
      {problem?.ended && <div><Button size="sm" onClick={() => window.location.reload()}>Sign in again</Button></div>}

      {conflict ? (
        <div className="stack" data-testid="conflict-box">
          <h4 className="h3">{conflict === 'unseen' ? 'There is already a cloud copy this device has never seen' : conflict === 'deleted' ? 'The cloud copy this device last saw has been deleted' : 'The cloud copy changed since this device last saw it'}</h4>
          <p className="small">{conflict === 'unseen' ? 'It may come from another device. Nothing is overwritten until you choose.' : conflict === 'deleted' ? 'There is nothing in the cloud to replace now.' : `This device saw revision ${record?.revision}; the cloud now has revision ${meta?.revision}. Nothing is overwritten until you choose.`}</p>
          <div className="compare">
            <Side title="In the cloud" testId="conflict-cloud" level={4}>
              {meta ? (
                <>
                  <p className="small">Revision {meta.revision}, saved {formatWhen(meta.updatedAt)}, {formatSize(meta.sizeBytes)}</p>
                  {copy.s === 'loading' && <p className="small muted" role="status">Loading what it contains…</p>}
                  {copy.s === 'ready' && <><PlanLines counts={countData(copy.cloud.data)} /><PrivateLines counts={countData(copy.cloud.data)} /></>}
                  {copy.s === 'error' && <><p className="small">{describeAuthError(copy.error, 'backup-restore').message}</p><div><Button size="sm" variant="secondary" onClick={retryCopy}>Try again</Button></div></>}
                </>
              ) : <p className="small">Nothing (it was deleted).</p>}
            </Side>
            <Counts title="On this device" counts={countData(app.data)} testId="conflict-device" />
          </div>
          <div className="stack">
            <div><Button size="sm" variant="secondary" disabled={busy !== null} onClick={closePanel}>Keep the cloud copy (upload nothing)</Button></div>
            {meta && <div><Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => open('restore')}>Restore the cloud copy to this device…</Button></div>}
            {meta ? (
              <div className="stack">
                <label className="check-row small"><input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} /><span>I understand the cloud copy will be replaced. A copy of it is kept on this device first.</span></label>
                <div><Button size="sm" variant="danger" disabled={busy !== null || !understood || copy.s !== 'ready' || plan.tooLarge || !hasUserData(app.data) || !canOffer} onClick={() => copy.s === 'ready' && void upload(meta.revision, copy.cloud)}>{busy === 'replace' ? 'Replacing…' : 'Replace the cloud copy with this device'}</Button></div>
              </div>
            ) : (
              <div><Button size="sm" disabled={busy !== null || plan.tooLarge || !hasUserData(app.data) || !canOffer} onClick={() => void upload(null)}>{busy === 'upload' ? 'Uploading…' : 'Upload as a new cloud copy'}</Button></div>
            )}
          </div>
        </div>
      ) : (
        <div className="row wrap">
          <Button size="sm" disabled={busy !== null || plan.tooLarge || !hasUserData(app.data) || !canOffer} onClick={() => void upload(verdict?.kind === 'update' ? verdict.base : null)}>{busy === 'upload' ? 'Uploading…' : 'Upload this backup'}</Button>
          <Button size="sm" variant="secondary" disabled={busy !== null} onClick={closePanel}>Cancel</Button>
        </div>
      )}
      {conflict && <div><Button size="sm" variant="ghost" onClick={downloadHere}>Download my data on this device first</Button></div>}
    </div>
  );

  const restorePanel = (
    <div ref={panelRef} tabIndex={-1} role="group" aria-labelledby="rs-h" className="confirm-box stack" data-testid="restore-panel">
      <h3 id="rs-h" className="h3">Restore from my cloud backup</h3>
      {copy.s === 'loading' && <p role="status" className="muted">Fetching the cloud copy…</p>}
      {copy.s === 'error' && <div className="stack"><Notice kind="error">{describeAuthError(copy.error, 'backup-restore').message}</Notice><div className="row wrap"><Button size="sm" onClick={retryCopy}>Try again</Button><Button size="sm" variant="secondary" onClick={closePanel}>Cancel</Button></div></div>}
      {copy.s === 'idle' && <div className="stack"><p>There is no cloud copy to restore.</p><div><Button size="sm" variant="secondary" onClick={closePanel}>Close</Button></div></div>}
      {copy.s === 'ready' && (() => {
        const merged = mergeRestore(copy.cloud.data, copy.cloud.meta.includes, app.data);
        return (
          <div className="stack">
            <div className="compare">
              <Counts title={`Cloud copy, revision ${copy.cloud.meta.revision}`} counts={countData(copy.cloud.data)} testId="restore-cloud" />
              <Counts title="On this device now" counts={countData(app.data)} testId="restore-device" />
            </div>
            <ul className="small data-list" data-testid="restore-effects">
              <li>This device’s plan and history are replaced by the cloud copy’s ({formatWhen(copy.cloud.meta.updatedAt)}).</li>
              <li>A restore point of what is here now is kept first. If it cannot be kept, nothing is restored.</li>
              <li>{copy.cloud.meta.includes.includes('journal') ? `Your journal on this device (${n(merged.replaced.journalEntries, 'entry', 'entries')}) is replaced by the one in the backup.` : `The backup does not contain your journal, so your journal and check-in notes on this device stay as they are (${n(merged.kept.journalEntries, 'entry', 'entries')}, ${n(merged.kept.checkinNotes, 'note')}).`}</li>
              <li>{copy.cloud.meta.includes.includes('health') ? `Your health readings on this device (${n(merged.replaced.healthDays, 'day')}) are replaced by the ones in the backup.` : `The backup does not contain health readings, so the ones on this device stay as they are (${n(merged.kept.healthDays, 'day')}).`}</li>
              <li>Your trial and subscription are not touched.</li>
            </ul>
            {problem && <Notice kind="error">{problem.message}</Notice>}
            {problem && hasUserData(app.data) && <div><Button size="sm" variant="ghost" onClick={downloadHere}>Download my data on this device</Button></div>}
            <div className="row wrap">
              <Button size="sm" variant="danger" disabled={busy !== null} onClick={() => void restore(copy.cloud)}>{busy === 'restore' ? 'Restoring…' : 'Restore to this device'}</Button>
              <Button size="sm" variant="secondary" disabled={busy !== null} onClick={closePanel}>Cancel</Button>
            </div>
          </div>
        );
      })()}
    </div>
  );

  const deletePanel = (
    <div ref={panelRef} tabIndex={-1} role="group" aria-labelledby="del-h" className="confirm-box stack" data-testid="delete-panel">
      <h3 id="del-h" className="h3">Delete my cloud backup?</h3>
      <p className="small">The copy is removed from your account and cannot be brought back. Your data on this device is not touched, and you can back up again whenever you like.</p>
      {problem && <Notice kind="error">{problem.message}</Notice>}
      <div className="row wrap">
        <Button size="sm" variant="danger" disabled={busy !== null} onClick={() => void remove()}>{busy === 'delete' ? 'Deleting…' : 'Yes, delete the cloud copy'}</Button>
        <Button size="sm" variant="secondary" disabled={busy !== null} onClick={closePanel}>Keep it</Button>
      </div>
    </div>
  );

  return (
    <section className="card stack" aria-labelledby="cloud-h" aria-busy={busy !== null}>
      <h2 id="cloud-h" className="h3">Cloud backup (optional)</h2>
      {status}
      {pending && (
        <div className="stack" role="status" data-testid="pending-upload">
          <Notice>An upload started {formatWhen(pending.startedAt)} did not report back (the page closed or the connection dropped), so it is not certain whether it finished. The cloud copy shown above is what the server holds now. Your data on this device was not changed.</Notice>
          <div><Button size="sm" variant="secondary" onClick={() => { clearPending(pendKey); setPending(null); }}>OK</Button></div>
        </div>
      )}
      <div role="status" aria-live="polite" className="stack">{note && <Notice kind={note.kind}>{note.text}</Notice>}</div>
      {!panel && problem && <Notice kind="error">{problem.message}</Notice>}
      {!canOffer && load.s === 'ready' && <Notice>Backing up needs an active trial or subscription, and yours is not active. You can still restore your cloud copy, delete it, and download your data. <a href="#/account">See Trial &amp; plans</a>.</Notice>}
      {panel === 'backup' && backupPanel}
      {panel === 'restore' && restorePanel}
      {panel === 'delete' && deletePanel}
      {!panel && load.s === 'ready' && (
        <div className="row wrap">
          <Button size="sm" disabled={!canOffer || busy !== null} onClick={() => open('backup')}>Back up now</Button>
          {meta && <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => open('restore')}>Restore from the cloud</Button>}
          {meta && <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => open('delete')}>Delete my cloud backup</Button>}
          <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void refresh()}>Check again</Button>
        </div>
      )}
      <RestorePoints />
    </section>
  );
};

/** The restore points this device keeps (they are restored from Settings). */
const RestorePoints = () => {
  const { repo } = useApp();
  const { access } = useAccount();
  const list = repo.listBackups();
  const open = access.status.kind === 'allowed';
  return (
    <div className="stack" data-testid="restore-points">
      <h3 className="h3">Restore points on this device</h3>
      {list.length === 0 ? <p className="small muted">None yet. A restore point is kept automatically before anything on this screen replaces your plan.</p> : (
        <ul className="small data-list">{list.map((b) => <li key={b.id}>{formatWhen(b.at)} · {BACKUP_REASON[b.reason] ?? b.reason} · {b.entries} logged actions</li>)}</ul>
      )}
      <p className="small muted">They stay on this device only. {open ? <>They are restored from <a href="#/settings">Settings</a>.</> : 'They are restored from Settings once the planner is open again.'}</p>
    </div>
  );
};
