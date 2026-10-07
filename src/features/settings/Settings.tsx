import { useMemo, useRef, useState } from 'react';
import { DEMO_PROFILES, appDataForDemo } from '../../domain/demo';
import { exportJSON, importJSON } from '../../storage/repository';
import { hasUserData, summarize } from '../../storage/schema';
import { useApp } from '../../state/store';
import { I } from '../../ui/icons';
import { downloadText } from '../../ui/download';
import { Button, PageHead } from '../../ui/primitives';
import { navigate } from '../../ui/router';

const THEME_KEY = 'cleanflow:theme';
const applyTheme = (t: string) => {
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t); else document.documentElement.removeAttribute('data-theme');
};
export const initTheme = () => { try { applyTheme(window.localStorage.getItem(THEME_KEY) ?? 'auto'); } catch { /* ignore */ } };

const when = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); };
const REASON: Record<string, string> = { demo: 'before loading a demo', import: 'before restoring a file', restore: 'before restoring a backup', unreadable: 'unreadable data', repaired: 'before repairing', migrated: 'before upgrading', newer: 'newer version', 'before-restore': 'before a restore' };

export const Settings = () => {
  const { data, dispatch, stamp, view, toast, repo, replaceAll, confirm } = useApp();
  const file = useRef<HTMLInputElement>(null);
  const [history, setHistory] = useState(true);
  const [version, setVersion] = useState(0); // bumps after anything that changes the backup list
  const [theme, setTheme] = useState(() => { try { return window.localStorage.getItem(THEME_KEY) ?? 'auto'; } catch { return 'auto'; } });
  const homeOn = data.preferences.focus.includes('home');
  const backups = useMemo(() => repo.listBackups().filter((b) => repo.readBackup(b.id) !== null), [repo, version, data]); // eslint-disable-line react-hooks/exhaustive-deps

  const download = () => downloadText(`cleanflow-backup-${stamp().today}.json`, exportJSON(data));

  const upload = async (f: File | undefined) => {
    if (!f) return;
    const res = importJSON(await f.text());
    if (!res.ok || !res.data) { toast(res.error ?? "That file doesn't look like a CleanFlow backup."); return; }
    const imported = res.data;
    const sum = summarize(imported);
    confirm({
      title: 'Replace your data with this backup?',
      body: (
        <>
          <p>This file contains <b>{sum.entries}</b> completed or logged actions across <b>{sum.days}</b> days{sum.name ? ` for ${sum.name}` : ''}.</p>
          <p>Restoring <b>replaces everything you have now</b>. CleanFlow keeps an automatic backup of your current data first, so you can undo this.</p>
          {res.repairs.length > 0 && <p className="small muted">The file needed small repairs: {res.repairs.join(' ')}</p>}
        </>
      ),
      confirmLabel: 'Replace my data',
      danger: true,
      extra: hasUserData(data) ? { label: 'Download current data first', run: download } : undefined,
      onConfirm: () => { replaceAll(imported, 'import', 'Backup restored.'); setVersion((v) => v + 1); },
    });
  };

  const tryDemo = (id: (typeof DEMO_PROFILES)[number]['id'], title: string) => {
    const next = appDataForDemo(id, { withHistory: history, today: stamp().today });
    const go = () => { replaceAll({ ...next, supplies: data.supplies }, 'demo', `Loaded: ${title}`); setVersion((v) => v + 1); navigate('today'); };
    // A demo home is throwaway, so replacing one needs no ceremony. Replacing the user's own data does.
    if (!hasUserData(data) || data.user.demo) { go(); return; }
    confirm({
      title: 'Replace your data with a demo?',
      body: (
        <>
          <p>"{title}" is an example home. Loading it <b>replaces your current home, plan and progress.</b></p>
          <p>CleanFlow keeps an automatic backup first, and you can restore it from Settings at any time.</p>
        </>
      ),
      confirmLabel: 'Load the demo',
      danger: true,
      extra: { label: 'Download current data first', run: download },
      onConfirm: go,
    });
  };

  const restoreBackup = (id: string, at: string) => {
    const b = repo.readBackup(id);
    if (!b) { toast('That backup could not be read.'); return; }
    confirm({
      title: 'Restore this backup?',
      body: <p>This replaces your current data with the copy from <b>{when(at)}</b>. Your current data is backed up first.</p>,
      confirmLabel: 'Restore',
      danger: true,
      onConfirm: () => { replaceAll(b, 'restore', 'Backup restored.'); setVersion((v) => v + 1); },
    });
  };

  const erase = () => confirm({
    title: 'Erase everything on this device?',
    body: <p>Your {homeOn ? 'home, ' : ''}plan, progress and supplies will be deleted, <b>including the automatic backups</b>. This can't be undone.</p>,
    confirmLabel: 'Erase everything',
    danger: true,
    extra: { label: 'Download a backup first', run: download },
    onConfirm: async () => {
      await repo.clear();
      try { window.localStorage.removeItem('cleanflow:onb-step'); window.localStorage.removeItem('cleanflow:timer'); } catch { /* ignore */ }
      dispatch({ type: 'RESET_ALL', stamp: stamp() });
      navigate('');
    },
  });

  const setT = (t: string) => { setTheme(t); applyTheme(t); try { window.localStorage.setItem(THEME_KEY, t); } catch { /* ignore */ } };

  return (
    <div className="page">
      <PageHead title="Settings" />
      <section className="card stack" aria-labelledby="s-you">
        <h2 id="s-you" className="h3">About you</h2>
        <div className="field"><label htmlFor="nm">Your name</label><input id="nm" className="input" value={data.user.name} maxLength={30} onChange={(e) => dispatch({ type: 'SET_NAME', name: e.target.value })} /></div>
        <div className="field"><span className="label" id="s-theme">Appearance</span>
          <div className="chips" role="radiogroup" aria-labelledby="s-theme">{['auto', 'light', 'dark'].map((t) => <button key={t} role="radio" aria-checked={theme === t} className="chip" onClick={() => setT(t)} style={{ textTransform: 'capitalize' }}>{t}</button>)}</div>
        </div>
        {data.preferences.learnedSessionCap && (
          <div className="row between wrap"><p className="small">Learned: tasks are split into pieces of up to <b>{data.preferences.learnedSessionCap} min</b>.</p><Button size="sm" variant="secondary" onClick={() => dispatch({ type: 'SET_SESSION_CAP', minutes: null, stamp: stamp() })}>Clear</Button></div>
        )}
        <div><Button variant="secondary" icon={homeOn ? I.home : I.flame} onClick={() => navigate('home')}>{homeOn ? 'Edit my home & preferences' : 'Edit my goals'}</Button></div>
      </section>

      <section className="card stack" aria-labelledby="s-demo">
        <h2 id="s-demo" className="h3">Try a demo</h2>
        <p className="small muted">Replaces your current data with an example so you can compare how different the plans are. You are asked before anything is replaced, and an automatic backup is kept.</p>
        <label className="row small" style={{ gap: 8 }}><input type="checkbox" checked={history} onChange={(e) => setHistory(e.target.checked)} style={{ width: 20, height: 20 }} /> Include three weeks of sample progress</label>
        <div className="demos">
          {DEMO_PROFILES.map((d) => (
            <button key={d.id} className="demo-card" onClick={() => tryDemo(d.id, d.title)}>
              <span className="em" aria-hidden>{d.emoji}</span><span><b>{d.title}</b><br /><span className="small muted">{d.blurb}</span></span>
            </button>
          ))}
        </div>
      </section>

      {view.hidden.length > 0 && (
        <section className="card stack" aria-labelledby="s-rem">
          <h2 id="s-rem" className="h3">Removed tasks</h2>
          {view.hidden.map((t) => (
            <div className="row between" key={t.id}><span className="small">{t.name} <span className="muted">· {t.roomName}</span></span><Button size="sm" variant="soft" onClick={() => dispatch({ type: 'TASK_PATCH', id: t.id, patch: { hidden: false } })}>Restore</Button></div>
          ))}
        </section>
      )}

      <section className="card stack" aria-labelledby="s-data">
        <h2 id="s-data" className="h3">Your data</h2>
        <p className="small muted">CleanFlow stores everything on this device. There is no account and nothing you enter is sent anywhere.</p>
        <div className="row wrap" style={{ gap: 8 }}>
          <Button variant="secondary" icon={I.arrow} onClick={download}>Export backup</Button>
          <Button variant="secondary" onClick={() => file.current?.click()}>Restore from a file</Button>
          <input ref={file} type="file" accept="application/json,.json" hidden aria-label="Backup file" onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ''; }} />
        </div>
        {backups.length > 0 && (
          <div className="stack" aria-label="Automatic backups">
            <p className="strong small">Automatic backups</p>
            <p className="small muted">A copy is kept before anything replaces your data.</p>
            {backups.map((b) => (
              <div className="row between wrap" key={b.id} style={{ gap: 8 }}>
                <span className="small">{when(b.at)} <span className="muted">· {REASON[b.reason] ?? b.reason} · {b.entries} actions</span></span>
                <Button size="sm" variant="soft" onClick={() => restoreBackup(b.id, b.at)}>Restore</Button>
              </div>
            ))}
          </div>
        )}
        <div><Button variant="danger" icon={I.trash} onClick={erase}>Erase all my data</Button></div>
      </section>
      <p className="xs muted center">CleanFlow v0.2 · Exercise and breathing tasks are general guidance, not medical advice. Not a substitute for product safety labels. Always read and follow manufacturer instructions.</p>
    </div>
  );
};
