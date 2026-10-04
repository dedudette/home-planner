import { useRef, useState } from 'react';
import { DEMO_PROFILES } from '../../domain/demo';
import { exportJSON, importJSON } from '../../storage/repository';
import { useApp } from '../../state/store';
import { I } from '../../ui/icons';
import { Button, PageHead } from '../../ui/primitives';
import { navigate } from '../../ui/router';

const THEME_KEY = 'cleanflow:theme';
const applyTheme = (t: string) => {
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t); else document.documentElement.removeAttribute('data-theme');
};
export const initTheme = () => { try { applyTheme(window.localStorage.getItem(THEME_KEY) ?? 'auto'); } catch { /* ignore */ } };

export const Settings = () => {
  const { data, dispatch, stamp, view, toast } = useApp();
  const file = useRef<HTMLInputElement>(null);
  const [history, setHistory] = useState(true);
  const [confirmReset, setConfirmReset] = useState(false);
  const [theme, setTheme] = useState(() => { try { return window.localStorage.getItem(THEME_KEY) ?? 'auto'; } catch { return 'auto'; } });

  const download = () => {
    const blob = new Blob([exportJSON(data)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `cleanflow-backup-${stamp().today}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const upload = async (f: File | undefined) => {
    if (!f) return;
    const d = importJSON(await f.text());
    if (!d) { toast("That file doesn't look like a CleanFlow backup."); return; }
    dispatch({ type: 'LOAD', data: d });
    toast('Backup restored.');
  };
  const setT = (t: string) => { setTheme(t); applyTheme(t); try { window.localStorage.setItem(THEME_KEY, t); } catch { /* ignore */ } };

  return (
    <div className="page">
      <PageHead title="Settings" />
      <section className="card stack">
        <h3>About you</h3>
        <div className="field"><label htmlFor="nm">Your name</label><input id="nm" className="input" value={data.user.name} maxLength={30} onChange={(e) => dispatch({ type: 'SET_NAME', name: e.target.value })} /></div>
        <div className="field"><span className="label">Appearance</span>
          <div className="chips" role="radiogroup" aria-label="Theme">{['auto', 'light', 'dark'].map((t) => <button key={t} role="radio" aria-checked={theme === t} className="chip" aria-pressed={theme === t} onClick={() => setT(t)} style={{ textTransform: 'capitalize' }}>{t}</button>)}</div>
        </div>
        {data.preferences.learnedSessionCap && (
          <div className="row between wrap"><p className="small">Learned: tasks are split into pieces of up to <b>{data.preferences.learnedSessionCap} min</b>.</p><Button size="sm" variant="secondary" onClick={() => dispatch({ type: 'SET_SESSION_CAP', minutes: null, stamp: stamp() })}>Clear</Button></div>
        )}
        <div><Button variant="secondary" icon={I.home} onClick={() => navigate('home')}>Edit my home &amp; preferences</Button></div>
      </section>

      <section className="card stack">
        <h3>Try a demo home</h3>
        <p className="small muted">Replaces your current home with an example so you can compare how different the plans are. Your supplies are kept. Export a backup first if you want to return to your own data.</p>
        <label className="row small" style={{ gap: 8 }}><input type="checkbox" checked={history} onChange={(e) => setHistory(e.target.checked)} style={{ width: 20, height: 20 }} /> Include three weeks of sample progress</label>
        <div className="demos">
          {DEMO_PROFILES.map((d) => (
            <button key={d.id} className="demo-card" onClick={() => { dispatch({ type: 'LOAD_DEMO', id: d.id, withHistory: history, stamp: stamp() }); toast(`Loaded: ${d.title}`); navigate('today'); }}>
              <span className="em" aria-hidden>{d.emoji}</span><span><b>{d.title}</b><br /><span className="small muted">{d.blurb}</span></span>
            </button>
          ))}
        </div>
      </section>

      {view.hidden.length > 0 && (
        <section className="card stack">
          <h3>Removed tasks</h3>
          {view.hidden.map((t) => (
            <div className="row between" key={t.id}><span className="small">{t.name} <span className="muted">· {t.roomName}</span></span><Button size="sm" variant="soft" onClick={() => dispatch({ type: 'TASK_PATCH', id: t.id, patch: { hidden: false } })}>Restore</Button></div>
          ))}
        </section>
      )}

      <section className="card stack">
        <h3>Your data</h3>
        <p className="small muted">CleanFlow stores everything on this device. There is no account and nothing is sent anywhere.</p>
        <div className="row wrap" style={{ gap: 8 }}>
          <Button variant="secondary" icon={I.arrow} onClick={download}>Export backup</Button>
          <Button variant="secondary" onClick={() => file.current?.click()}>Restore backup</Button>
          <input ref={file} type="file" accept="application/json" hidden onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ''; }} />
        </div>
        {confirmReset ? (
          <div className="card warn stack">
            <p className="strong">Erase everything on this device?</p>
            <p className="small">Your home, plan, progress and supplies will be deleted. This can't be undone.</p>
            <div className="row"><Button variant="secondary" onClick={() => setConfirmReset(false)}>Keep my data</Button><Button variant="danger" onClick={() => { dispatch({ type: 'RESET_ALL', stamp: stamp() }); try { window.localStorage.removeItem('cleanflow:onb-step'); } catch { /* ignore */ } navigate(''); }}>Erase everything</Button></div>
          </div>
        ) : <div><Button variant="danger" icon={I.trash} onClick={() => setConfirmReset(true)}>Erase all my data</Button></div>}
      </section>
      <p className="xs muted center">CleanFlow v0.1 · Not a substitute for product safety labels. Always read and follow manufacturer instructions.</p>
    </div>
  );
};
