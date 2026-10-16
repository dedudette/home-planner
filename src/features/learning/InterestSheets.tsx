import { useState } from 'react';
import { uid } from '../../domain/appdata';
import { CATALOG, CATALOG_BY_ID } from '../../domain/interests/catalog';
import { recent } from '../../domain/interests/stats';
import { INTEREST_CATEGORIES, type Book, type BookStatus, type InterestCategory, type InterestStatus } from '../../domain/interests/types';
import { safeUrl } from '../../storage/interestsSchema';
import { formatDay } from '../../domain/dates';
import { useApp } from '../../state/store';
import { I } from '../../ui/icons';
import { Button, Chip, Hint, Sheet, Tag } from '../../ui/primitives';
import { CATEGORY_LABEL, customInterest, FEEDBACK_LABEL, interestFromCatalog, STATUS_LABEL } from './shared';

const STATUSES: InterestStatus[] = ['exploring', 'active', 'paused', 'not-for-me'];

/** Add an interest: pick one from the short built-in list, or type your own. Nothing is added until you save. */
export const InterestFormSheet = () => {
  const { data, closeSheet, dispatch, toast, openSheet } = useApp();
  const have = new Set(data.interests.items.map((i) => i.catalogId).filter(Boolean));
  const choices = CATALOG.filter((c) => !have.has(c.id));
  const [pick, setPick] = useState<string>('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState<InterestCategory>('making');
  const valid = pick !== '' || name.trim().length > 0;
  const save = () => {
    if (!valid) return;
    const c = pick ? CATALOG_BY_ID.get(pick) : undefined;
    const interest = c ? interestFromCatalog(c, 'exploring') : customInterest(name, category);
    dispatch({ type: 'INTEREST_SAVE', interest });
    closeSheet();
    toast(`${interest.name} added.`, { label: 'Undo', run: () => dispatch({ type: 'INTEREST_DELETE', id: interest.id }) });
    openSheet({ kind: 'interest', id: interest.id });
  };
  return (
    <Sheet title="Add an interest" onClose={closeSheet} footer={<><Button variant="secondary" onClick={closeSheet}>Cancel</Button><Button icon={I.check} disabled={!valid} onClick={save}>Add it</Button></>}>
      <div className="field">
        <span className="label" id="if-pick">From the list</span>
        {choices.length === 0 ? <p className="small muted">You have added everything on the list. You can still type your own below.</p> : (
          <div className="chips" role="radiogroup" aria-labelledby="if-pick">{choices.map((c) => <Chip small key={c.id} role="radio" on={pick === c.id} onClick={() => { setPick(pick === c.id ? '' : c.id); setName(''); }}>{c.name}</Chip>)}</div>
        )}
      </div>
      <div className="field">
        <label htmlFor="if-name">Or something else</label>
        <input id="if-name" className="input" maxLength={60} value={name} placeholder="e.g. Birdwatching, Pottery, Chess" onChange={(e) => { setName(e.target.value); if (e.target.value) setPick(''); }} />
      </div>
      {name.trim() !== '' && (
        <div className="field"><label htmlFor="if-cat">Closest area</label><select id="if-cat" className="select" value={category} onChange={(e) => setCategory(e.target.value as InterestCategory)}>{INTEREST_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}</select></div>
      )}
      <p className="small muted">An interest is something you are curious about. Adding one does not put anything in your plan.</p>
    </Sheet>
  );
};

/** Everything about one interest: what you wrote, the small things to try, links you added yourself, and what you logged. */
export const InterestSheet = ({ id }: { id: string }) => {
  const { data, today, closeSheet, openSheet, dispatch, toast, confirm } = useApp();
  const interest = data.interests.items.find((i) => i.id === id);
  const cat = interest?.catalogId ? CATALOG_BY_ID.get(interest.catalogId) : undefined;
  const [goal, setGoal] = useState(interest?.goal ?? '');
  const [note, setNote] = useState(interest?.note ?? '');
  const [weekly, setWeekly] = useState(interest?.weeklyMinutes ? String(interest.weeklyMinutes) : '');
  const [rTitle, setRTitle] = useState('');
  const [rUrl, setRUrl] = useState('');
  const [rNote, setRNote] = useState('');
  const [rErr, setRErr] = useState('');
  if (!interest) return <Sheet title="Interest" onClose={closeSheet}><p>This interest is no longer in your list.</p></Sheet>;

  const resources = data.interests.resources.filter((r) => r.interestId === id);
  const sessions = data.interests.sessions.filter((s) => s.interestId === id).slice(-8).reverse();
  const entry = (eid: string) => data.sessions.flatMap((s) => s.entries).find((e) => e.id === eid);
  const lately = recent(data, id, today);
  const w = weekly.trim() === '' ? null : Math.round(Number(weekly));
  const weeklyOk = w === null || (Number.isFinite(w) && w >= 5 && w <= 2000);
  const dirty = goal !== interest.goal || note !== interest.note || (weeklyOk && w !== interest.weeklyMinutes);
  const save = () => { if (!weeklyOk) return; dispatch({ type: 'INTEREST_SAVE', interest: { ...interest, goal: goal.trim().slice(0, 300), note: note.trim().slice(0, 500), weeklyMinutes: w } }); toast('Saved.'); };
  const addResource = () => {
    const title = rTitle.trim();
    if (!title) { setRErr('Give it a name first.'); return; }
    let url: string | null = null;
    if (rUrl.trim()) {
      url = safeUrl(rUrl) ?? safeUrl(`https://${rUrl.trim()}`);
      if (!url) { setRErr('That does not look like a web address. Leave the link empty to save just the name.'); return; }
    }
    dispatch({ type: 'RESOURCE_SAVE', resource: { id: uid('res'), interestId: id, title, url, note: rNote.trim().slice(0, 300) } });
    setRTitle(''); setRUrl(''); setRNote(''); setRErr('');
  };
  const planIt = () => { closeSheet(); openSheet({ kind: 'activityForm', defaults: { module: 'learning', name: interest.name, minutes: cat ? Math.max(cat.minutes[0], 15) : 20, ref: { kind: 'interest', id }, intensity: 'gentle', kind: 'flexible', schedule: { kind: 'once', date: today } } }); };

  return (
    <Sheet title={interest.name} onClose={closeSheet} label={`${interest.name}: interest`} full
      footer={<><Button variant="secondary" onClick={closeSheet}>Close</Button>{dirty && <Button variant="secondary" disabled={!weeklyOk} onClick={save}>Save changes</Button>}<Button icon={I.check} onClick={() => { closeSheet(); openSheet({ kind: 'logSession', interestId: id }); }}>Log a session</Button></>}>
      {cat && <p className="muted">{cat.blurb}</p>}
      <div className="field">
        <span className="label" id="is-status">Where it is for you</span>
        <div className="chips" role="radiogroup" aria-labelledby="is-status">{STATUSES.map((s) => <Chip small key={s} role="radio" on={interest.status === s} onClick={() => dispatch({ type: 'INTEREST_STATUS', id, status: s })}>{STATUS_LABEL[s]}</Chip>)}</div>
        {interest.status === 'not-for-me' && <span className="small muted">It is hidden from suggestions. You can bring it back at any time.</span>}
      </div>
      <p className="small muted" role="status">{lately.sessions > 0 ? `Lately: ${lately.sessions} session${lately.sessions === 1 ? '' : 's'}, ${lately.minutes} minutes in the last four weeks.` : 'Nothing logged in the last four weeks. That is fine: logging is optional.'}</p>

      <div className="field"><label htmlFor="is-goal">What you would like from it (optional)</label><input id="is-goal" className="input" maxLength={300} value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="In your own words, e.g. Play one song all the way through" /></div>
      <div className="field"><label htmlFor="is-weekly">Minutes a week you would like to give it (optional)</label><input id="is-weekly" className="input" inputMode="numeric" value={weekly} onChange={(e) => setWeekly(e.target.value)} style={{ width: 130 }} aria-invalid={!weeklyOk} placeholder="None" />{!weeklyOk && <span className="small" style={{ color: 'var(--clay-ink)' }}>Use a number from 5 to 2000, or leave it empty.</span>}</div>
      <div className="field"><label htmlFor="is-note">Notes</label><textarea id="is-note" className="textarea" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></div>

      {cat && (
        <section className="stack" aria-labelledby="is-starters">
          <h3 id="is-starters" className="h3">Small things to try</h3>
          {cat.starters.map((s) => (
            <div className="card row between" key={s.id} style={{ padding: 12, alignItems: 'center' }}>
              <span><b>{s.title}</b><br /><span className="small muted">{s.minutes} min{s.needs.length ? ` · ${s.needs.join(', ')}` : ''}</span></span>
              <Button size="sm" variant="soft" onClick={() => { closeSheet(); openSheet({ kind: 'starter', catalogId: cat.id, starterId: s.id }); }} aria-label={`Open: ${s.title}`}>Open</Button>
            </div>
          ))}
        </section>
      )}

      <section className="stack" aria-labelledby="is-res">
        <h3 id="is-res" className="h3">Your resources</h3>
        <p className="small muted">Books, videos, courses, people: whatever you use. You add them, so the app never vouches for one.</p>
        {resources.map((r) => (
          <div className="row between" key={r.id} style={{ alignItems: 'flex-start', gap: 8 }}>
            <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{r.url ? <a href={r.url} target="_blank" rel="noopener noreferrer">{r.title}</a> : <b>{r.title}</b>}{r.note && <><br /><span className="small muted">{r.note}</span></>}</span>
            <Button size="sm" variant="ghost" icon={I.trash} onClick={() => dispatch({ type: 'RESOURCE_DELETE', id: r.id })} aria-label={`Remove ${r.title}`} />
          </div>
        ))}
        <div className="card stack" style={{ padding: 12 }}>
          <div className="field"><label htmlFor="rs-t">Name</label><input id="rs-t" className="input" maxLength={120} value={rTitle} onChange={(e) => { setRTitle(e.target.value); setRErr(''); }} /></div>
          <div className="field"><label htmlFor="rs-u">Link (optional)</label><input id="rs-u" className="input" inputMode="url" maxLength={500} value={rUrl} onChange={(e) => { setRUrl(e.target.value); setRErr(''); }} placeholder="https://" /></div>
          <div className="field"><label htmlFor="rs-n">Note (optional)</label><input id="rs-n" className="input" maxLength={300} value={rNote} onChange={(e) => setRNote(e.target.value)} /></div>
          {rErr && <p className="small" role="alert" style={{ color: 'var(--clay-ink)' }}>{rErr}</p>}
          <div><Button size="sm" variant="soft" icon={I.plus} onClick={addResource}>Add resource</Button></div>
        </div>
      </section>

      <section className="stack" aria-labelledby="is-sess">
        <h3 id="is-sess" className="h3">What you logged</h3>
        {sessions.length === 0 ? <p className="small muted">Nothing yet.</p> : (
          <ul className="stack" style={{ margin: 0, padding: 0 }}>{sessions.map((s) => { const e = entry(s.entryId); return (
            <li key={s.id} className="card stack" style={{ listStyle: 'none', padding: 10, gap: 2 }}>
              <div className="row between wrap"><b>{formatDay(s.date, today)}{e ? ` · ${e.actualMinutes} min` : ''}</b>{s.feedback && <Tag>{FEEDBACK_LABEL[s.feedback]}</Tag>}</div>
              {s.resource && <span className="small muted">Used: {s.resource}</span>}
              {s.note && <span className="small">{s.note}</span>}
            </li>
          ); })}</ul>
        )}
      </section>

      <div className="row wrap" style={{ gap: 8 }}>
        <Button variant="soft" icon={I.cal} onClick={planIt}>Plan it</Button>
        <Button variant="ghost" icon={I.trash} onClick={() => confirm({ title: `Remove ${interest.name}?`, body: <p>It is removed from your list along with its links. Sessions you logged stay in your history.</p>, confirmLabel: 'Remove it', danger: true, onConfirm: () => { const keep = interest; const res = resources; dispatch({ type: 'INTEREST_DELETE', id }); toast(`${keep.name} removed.`, { label: 'Undo', run: () => { dispatch({ type: 'INTEREST_SAVE', interest: keep }); res.forEach((r) => dispatch({ type: 'RESOURCE_SAVE', resource: r })); } }); } })}>Remove interest</Button>
      </div>
    </Sheet>
  );
};

/** A short first try: what you need, and the steps. "I tried it" adds the interest if it is not there yet and opens the log. */
export const StarterSheet = ({ catalogId, starterId }: { catalogId: string; starterId: string }) => {
  const { data, closeSheet, openSheet, dispatch } = useApp();
  const c = CATALOG_BY_ID.get(catalogId);
  const s = c?.starters.find((x) => x.id === starterId);
  if (!c || !s) return <Sheet title="Try something" onClose={closeSheet}><p>That activity is not available any more.</p></Sheet>;
  const existing = data.interests.items.find((i) => i.catalogId === c.id);
  const tried = () => {
    let id = existing?.id;
    if (!id) { const it = interestFromCatalog(c, 'exploring'); dispatch({ type: 'INTEREST_SAVE', interest: it }); id = it.id; }
    closeSheet();
    openSheet({ kind: 'logSession', interestId: id, starterId: s.id, minutes: s.minutes });
  };
  return (
    <Sheet title={s.title} onClose={closeSheet} label={`Try: ${s.title}`}
      footer={<><Button variant="secondary" onClick={closeSheet}>Not now</Button><Button icon={I.check} onClick={tried}>I tried it</Button></>}>
      <p className="muted">{c.name} · about {s.minutes} minutes</p>
      {s.needs.length > 0 && <div><h3 className="h3">You will need</h3><ul>{s.needs.map((n) => <li key={n}>{n}</li>)}</ul></div>}
      {s.needs.length === 0 && <p className="small muted">You need nothing but yourself.</p>}
      <div><h3 className="h3">Steps</h3><ol style={{ paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6, margin: 0 }}>{s.steps.map((x, i) => <li key={i}>{x}</li>)}</ol></div>
      <Hint icon={I.info}>{existing ? 'When you are done, log it to keep a record, and say how it went if you like.' : 'Nothing is added to your list until you say you tried it. Afterwards you can say how it went, and that only shapes what is suggested next.'}</Hint>
    </Sheet>
  );
};

const BOOK_STATUSES: { value: BookStatus; label: string }[] = [{ value: 'want', label: 'Want to read' }, { value: 'reading', label: 'Reading' }, { value: 'finished', label: 'Finished' }];

/** Add or edit a book. Titles and authors are whatever you type: the app suggests none. */
export const BookFormSheet = ({ editId }: { editId?: string }) => {
  const { data, closeSheet, dispatch, toast, confirm } = useApp();
  const cur = editId ? data.interests.books.find((b) => b.id === editId) : undefined;
  const [title, setTitle] = useState(cur?.title ?? '');
  const [author, setAuthor] = useState(cur?.author ?? '');
  const [status, setStatus] = useState<BookStatus>(cur?.status ?? 'want');
  const [total, setTotal] = useState(cur?.pagesTotal != null ? String(cur.pagesTotal) : '');
  const [read, setRead] = useState(cur?.pagesRead != null ? String(cur.pagesRead) : '');
  const [note, setNote] = useState(cur?.note ?? '');
  const num = (v: string): number | null => (v.trim() === '' ? null : Math.round(Number(v)));
  const pt = num(total), pr = num(read);
  const okNum = (n: number | null) => n === null || (Number.isFinite(n) && n >= 0 && n <= 100000);
  const valid = title.trim().length > 0 && okNum(pt) && okNum(pr);
  const save = () => {
    if (!valid) return;
    const now = new Date().toISOString();
    let pagesRead = pr; if (pagesRead !== null && pt !== null && pagesRead > pt) pagesRead = pt;
    if (status === 'finished' && pt !== null) pagesRead = pt;
    const book: Book = { id: cur?.id ?? uid('bk'), title: title.trim().slice(0, 160), author: author.trim().slice(0, 120), status, pagesTotal: pt, pagesRead, addedAt: cur?.addedAt ?? now, finishedAt: status === 'finished' ? (cur?.finishedAt ?? now) : null, note: note.trim().slice(0, 500) };
    dispatch({ type: 'BOOK_SAVE', book });
    closeSheet();
    toast(cur ? 'Book updated.' : `${book.title} added.`, cur ? undefined : { label: 'Undo', run: () => dispatch({ type: 'BOOK_DELETE', id: book.id }) });
  };
  return (
    <Sheet title={cur ? 'Edit book' : 'Add a book'} onClose={closeSheet} footer={<><Button variant="secondary" onClick={closeSheet}>Cancel</Button><Button icon={I.check} disabled={!valid} onClick={save}>{cur ? 'Save' : 'Add it'}</Button></>}>
      <div className="field"><label htmlFor="bk-t">Title</label><input id="bk-t" className="input" maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} data-autofocus /></div>
      <div className="field"><label htmlFor="bk-a">Author (optional)</label><input id="bk-a" className="input" maxLength={120} value={author} onChange={(e) => setAuthor(e.target.value)} /></div>
      <div className="field"><span className="label" id="bk-s">Where it is</span><div className="chips" role="radiogroup" aria-labelledby="bk-s">{BOOK_STATUSES.map((s) => <Chip small key={s.value} role="radio" on={status === s.value} onClick={() => setStatus(s.value)}>{s.label}</Chip>)}</div></div>
      <div className="row wrap" style={{ gap: 12 }}>
        <div className="field"><label htmlFor="bk-p">Pages in total (optional)</label><input id="bk-p" className="input" inputMode="numeric" value={total} onChange={(e) => setTotal(e.target.value)} style={{ width: 130 }} /></div>
        <div className="field"><label htmlFor="bk-r">Pages read so far (optional)</label><input id="bk-r" className="input" inputMode="numeric" value={read} onChange={(e) => setRead(e.target.value)} style={{ width: 130 }} /></div>
      </div>
      <div className="field"><label htmlFor="bk-n">Notes (optional)</label><textarea id="bk-n" className="textarea" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></div>
      {cur && <div><Button variant="ghost" icon={I.trash} onClick={() => confirm({ title: `Remove ${cur.title}?`, body: <p>It is taken off your reading list. Sessions you logged stay in your history.</p>, confirmLabel: 'Remove it', danger: true, onConfirm: () => { dispatch({ type: 'BOOK_DELETE', id: cur.id }); toast('Book removed.', { label: 'Undo', run: () => dispatch({ type: 'BOOK_SAVE', book: cur }) }); } })}>Remove book</Button></div>}
    </Sheet>
  );
};
