import { useCallback, useEffect, useState } from 'react';
import type { HealthAdapter } from '../../domain/health/adapter';
import { readHealth, statusOf, statusText } from '../../domain/health/sync';
import { HEALTH_METRICS, type HealthMetric, type HealthStatus } from '../../domain/health/types';
import { getHealthAdapter } from '../../state/healthPlatform';
import { useApp } from '../../state/store';
import { I } from '../../ui/icons';
import { Button, Chip } from '../../ui/primitives';

const LABEL: Record<HealthMetric, string> = { steps: 'Steps', exercise: 'Workouts and exercise minutes', water: 'Water logged in other apps' };

/**
 * Health data, optional and read-only. "Connected" is only ever said when this device has a health service, the person allowed at
 * least one kind of data, and the last read worked. The switch alone never says it. Nothing read here is used by the plan, the day's
 * minutes, the water log or the AI: it is shown beside the person's own records, with where it came from.
 */
export const HealthPanel = () => {
  const { data, dispatch, today, toast, confirm } = useApp();
  const h = data.health;
  const [adapter, setAdapter] = useState<HealthAdapter | null | undefined>(undefined);
  const [availability, setAvailability] = useState<{ available: boolean; reason?: string } | null>(null);
  const [allowed, setAllowed] = useState<HealthMetric[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const wanted = HEALTH_METRICS.filter((m) => h.prefs.read[m]);

  const refresh = useCallback(async (a: HealthAdapter | null) => {
    if (!a) return;
    try { const av = await a.isAvailable(); setAvailability(av); setAllowed(av.available ? await a.authorized(wanted) : []); setFailed(false); } catch { setFailed(true); }
  }, [wanted.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { let live = true; void getHealthAdapter().then((a) => { if (live) { setAdapter(a); void refresh(a); } }); return () => { live = false; }; }, [refresh]);

  const st: HealthStatus = adapter === undefined ? { s: 'off' } : statusOf(h.prefs, adapter, availability, allowed, h.lastSync, failed);
  const label = adapter?.label ?? 'Apple Health or Health Connect';

  const connect = async () => {
    if (!adapter) return;
    setBusy(true);
    try { await adapter.requestAuthorization(wanted); await refresh(adapter); await read(); } catch { setFailed(true); } finally { setBusy(false); }
  };
  const read = async () => {
    if (!adapter) return;
    setBusy(true);
    try {
      const daily = await readHealth(adapter, h.prefs, today, new Date());
      dispatch({ type: 'HEALTH_MERGE', daily, today, at: new Date().toISOString() });
      setFailed(false);
      toast('Read from ' + adapter.label + '.');
    } catch { setFailed(true); } finally { setBusy(false); }
  };

  return (
    <section className="card stack" aria-labelledby="s-health" data-testid="health">
      <h2 id="s-health" className="h3">Health data (optional)</h2>
      {adapter === null ? (
        <p className="small" role="status" data-testid="health-status">{statusText({ s: 'web' }, label)}</p>
      ) : adapter === undefined ? <p className="small muted">Checking this device…</p> : (
        <>
          <label className="row between switch-row"><span><b>Read from {adapter.label}</b><br /><span className="small muted">Read-only. CleanFlow never writes to {adapter.label}.</span></span>
            <input type="checkbox" role="switch" aria-label={`Read from ${adapter.label}`} checked={h.prefs.enabled} onChange={(e) => dispatch({ type: 'HEALTH_PREFS', enabled: e.target.checked })} style={{ width: 24, height: 24 }} /></label>
          <p className="small" role="status" data-testid="health-status">{statusText(st, adapter.label)}</p>
          {h.prefs.enabled && (
            <>
              <div className="field"><span className="label" id="hl-read">What to read</span>
                <div className="chips" role="group" aria-labelledby="hl-read">{HEALTH_METRICS.map((m) => <Chip small key={m} role="checkbox" on={h.prefs.read[m]} onClick={() => dispatch({ type: 'HEALTH_PREFS', read: { [m]: !h.prefs.read[m] } })}>{LABEL[m]}</Chip>)}</div>
                <span className="small muted">{adapter.platform === 'healthkit' ? 'On an iPhone an app cannot tell the difference between "you said no" and "there is nothing to read", so a missing kind of data may simply mean it is not shared.' : 'Health Connect asks you for each kind of data, and you can change your answers there at any time.'}</span></div>
              <div className="row wrap" style={{ gap: 8 }}>
                <Button icon={I.heart} disabled={busy || wanted.length === 0} onClick={() => void connect()}>{st.s === 'connected' || st.s === 'partial' ? `Choose what ${adapter.label} shares` : `Allow access in ${adapter.label}`}</Button>
                <Button variant="secondary" disabled={busy || (st.s !== 'connected' && st.s !== 'partial')} onClick={() => void read()}>Read now</Button>
              </div>
            </>
          )}
          {Object.keys(h.daily).length > 0 && (
            <div><Button variant="ghost" icon={I.trash} onClick={() => confirm({ title: 'Remove what was read?', body: <p>CleanFlow forgets everything it read from {adapter.label} and stops reading. Your own records are not touched. To stop sharing, change what {adapter.label} allows in your phone's settings: CleanFlow cannot do that for you.</p>, confirmLabel: 'Remove it', danger: true, onConfirm: () => { dispatch({ type: 'HEALTH_CLEAR' }); toast('Removed.'); } })}>Remove what was read</Button></div>
          )}
        </>
      )}
      <p className="xs muted">Used only to show you your own day. It is never part of your plan or your minutes, never changes your water log, and is never sent to the AI. It is stored with your other data on this device, so it is in your backups.</p>
    </section>
  );
};
