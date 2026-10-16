import { useMemo, useState } from 'react';
import type { Repository } from '../../storage/repository';
import { downloadText } from '../../ui/download';

interface Props {
  /** 'unreadable': the saved data could not be understood. 'crash': the app failed while showing it. */
  mode: 'unreadable' | 'crash';
  repo: Repository;
  reason?: string;
  /** Raw text of the unreadable save, when we already have it. */
  raw?: string;
  /** Called after "Start fresh" (unreadable mode inside the provider). */
  onStartFresh?: () => void;
}

const stamp = () => new Date().toISOString().slice(0, 10);
const when = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); };

/**
 * Shown instead of a blank screen. It deliberately depends on nothing but the repository, so it still works when the app's own
 * state is the thing that is broken. The user's data is never deleted from here: "start fresh" keeps a copy first.
 */
export const RecoveryScreen = ({ mode, repo, reason, raw, onStartFresh }: Props) => {
  const [confirm, setConfirm] = useState(false);
  const [message, setMessage] = useState('');
  const backups = useMemo(() => repo.listBackups().filter((b) => repo.readBackup(b.id) !== null), [repo]);
  const text = raw ?? repo.readRaw() ?? '';

  const download = () => { downloadText(`cleanflow-recovery-${stamp()}.json`, text || '{}'); setMessage('Saved to your downloads.'); };
  const restore = (id: string) => {
    const d = repo.readBackup(id);
    if (!d) { setMessage('That backup could not be read.'); return; }
    const res = repo.overwrite(d);
    if (res.ok) window.location.reload(); else setMessage('Could not write the backup back. Please download your data first.');
  };
  const fresh = () => {
    if (text) repo.stashRaw(text);
    if (onStartFresh) onStartFresh(); else { repo.dropMain(); window.location.reload(); }
  };

  return (
    <div className="onb" role="alert">
      <main className="onb-body" style={{ justifyContent: 'center' }}>
        <div className="stack-lg">
          <div>
            <h1>{mode === 'crash' ? 'Something went wrong' : "We couldn't open your saved data"}</h1>
            <p className="muted" style={{ marginTop: 8 }}>
              {mode === 'crash'
                ? 'CleanFlow hit an unexpected problem while showing your plan.'
                : (reason ?? 'The saved data is not in a form CleanFlow can read.')}
              {' '}<b>Nothing has been deleted.</b> Your data is still on this device.
            </p>
          </div>

          <div className="stack">
            <button className="btn" onClick={download} disabled={!text}>Download my data</button>
            {mode === 'crash' && <button className="btn secondary" onClick={() => window.location.reload()}>Try again</button>}
            {message && <p className="small" role="status">{message}</p>}
          </div>

          {backups.length > 0 && (
            <section className="card stack" aria-labelledby="rec-b">
              <h2 id="rec-b" style={{ fontSize: '1.15rem' }}>Restore an automatic backup</h2>
              <p className="small muted">CleanFlow keeps a copy before anything risky. Restoring replaces what is saved now.</p>
              {backups.map((b) => (
                <button key={b.id} className="btn secondary" onClick={() => restore(b.id)}>Restore {when(b.at)} · {b.entries} completions</button>
              ))}
            </section>
          )}

          <section className="card warn stack" aria-labelledby="rec-f">
            <h2 id="rec-f" style={{ fontSize: '1.15rem' }}>Start fresh</h2>
            <p className="small">Opens a new, empty CleanFlow. A copy of your current data is kept on this device so it can still be recovered later.</p>
            {confirm
              ? <div className="row wrap"><button className="btn secondary" onClick={() => setConfirm(false)}>Cancel</button><button className="btn danger" onClick={fresh}>Yes, start fresh</button></div>
              : <button className="btn danger" onClick={() => setConfirm(true)}>Start fresh…</button>}
          </section>
        </div>
      </main>
    </div>
  );
};
