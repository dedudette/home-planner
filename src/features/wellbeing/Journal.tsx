import { useDraftState } from '../../state/DraftScope';
import { uid } from '../../domain/appdata';
import { formatDay } from '../../domain/dates';
import { useApp } from '../../state/store';
import { I } from '../../ui/icons';
import { Button, Empty, Hint, Sheet } from '../../ui/primitives';

export const JournalSheet = ({ editId }: { editId?: string }) => {
  const { data, today, closeSheet, dispatch, toast, stamp } = useApp();
  const e = data.wellbeing.journal.find((x) => x.id === editId);
  const [title, setTitle] = useDraftState('title', e?.title ?? '', 'text');
  const [text, setText] = useDraftState('text', e?.text ?? '', 'text');
  const save = () => {
    if (!text.trim()) return;
    const st = stamp();
    dispatch({ type: 'JOURNAL_SAVE', entry: { id: e?.id ?? uid('jr'), date: e?.date ?? st.today, at: e?.at ?? st.now, title: title.trim().slice(0, 80), text: text.slice(0, 8000) } });
    toast(e ? 'Entry saved.' : 'Entry saved. It stays on this device.');
    closeSheet();
  };
  return (
    <Sheet title={e ? `Entry from ${formatDay(e.date, today)}` : 'A new entry'} onClose={closeSheet} full
      footer={<>{e && <Button variant="ghost" icon={I.trash} onClick={() => { const old = e; dispatch({ type: 'JOURNAL_DELETE', id: e.id }); closeSheet(); toast('Entry deleted.', { label: 'Undo', run: () => dispatch({ type: 'JOURNAL_SAVE', entry: old }) }); }}>Delete</Button>}<Button icon={I.check} onClick={save} disabled={!text.trim()}>Save</Button></>}>
      <div className="field"><label htmlFor="j-t">Title (optional)</label><input id="j-t" className="input" maxLength={80} value={title} onChange={(ev) => setTitle(ev.target.value)} /></div>
      <div className="field"><label htmlFor="j-x">What is on your mind?</label><textarea id="j-x" className="textarea" data-autofocus rows={12} maxLength={8000} value={text} onChange={(ev) => setText(ev.target.value)} /></div>
      <Hint icon={I.shield}>Private: kept on this device, never sent anywhere, and never read by the AI unless you choose to share something yourself.</Hint>
    </Sheet>
  );
};

export const JournalTab = () => {
  const { data, today, openSheet } = useApp();
  const list = [...data.wellbeing.journal].reverse();
  return (
    <div className="stack">
      <div className="row between wrap"><h2 className="h3">Your journal</h2><Button icon={I.plus} onClick={() => openSheet({ kind: 'journal' })}>New entry</Button></div>
      <Hint icon={I.shield}>Private to this device. Nothing here is analysed, and the AI never sees it automatically.</Hint>
      {list.length === 0 ? <Empty title="Nothing written yet">Write whenever you like. There is no streak and nothing to keep up.</Empty> : (
        <ul className="stack" style={{ margin: 0, padding: 0 }}>
          {list.map((j) => (
            <li key={j.id} className="card" style={{ listStyle: 'none', padding: 12 }}>
              <button className="plain-btn" style={{ width: '100%', minHeight: 44 }} onClick={() => openSheet({ kind: 'journal', editId: j.id })} aria-label={`Open the entry from ${formatDay(j.date, today)}${j.title ? `: ${j.title}` : ''}`}>
                <b>{j.title || formatDay(j.date, today)}</b>{j.title ? <span className="muted small"> · {formatDay(j.date, today)}</span> : null}<br /><span className="small muted">{j.text.slice(0, 140)}{j.text.length > 140 ? '…' : ''}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
