import { useMemo } from 'react';
import { useDraftState } from '../../state/DraftScope';
import { uid } from '../../domain/appdata';
import { starterOf } from '../../domain/interests/catalog';
import type { Feedback, Interest, InterestSession } from '../../domain/interests/types';
import { adhocTask } from '../../domain/modules/adhoc';
import { dueInfo } from '../../domain/schedule';
import { reducer } from '../../state/reducer';
import { useApp } from '../../state/store';
import { I } from '../../ui/icons';
import { Button, Chip, Sheet } from '../../ui/primitives';
import { customInterest, FEEDBACK_LABEL, interestFromCatalog } from './shared';
import { CATALOG_BY_ID } from '../../domain/interests/catalog';

/**
 * Log a session of an interest: how long, what you thought, and optionally which book or resource. One session is one log entry with the
 * minutes; if it was something you planned for today you can say so and it is recorded once, against the plan.
 */
export const LogSessionSheet = ({ interestId, starterId, bookId, minutes: m0, taskId }: { interestId?: string; starterId?: string; bookId?: string; minutes?: number; taskId?: string }) => {
  const { data, view, today, closeSheet, dispatch, stamp, toast } = useApp();
  const interest = interestId ? data.interests.items.find((i) => i.id === interestId) : undefined;
  const starter = interest ? starterOf(interest.catalogId, starterId ?? null) : null;
  const book = bookId ? data.interests.books.find((b) => b.id === bookId) : undefined;
  const [minutes, setMinutes] = useDraftState('minutes', String(m0 ?? starter?.minutes ?? 15), 'text');
  const [note, setNote] = useDraftState('note', '', 'text');
  const [resource, setResource] = useDraftState('resource', '', 'text');
  const [feedback, setFeedback] = useDraftState<Feedback | null>('feedback', null);
  const [planned, setPlanned] = useDraftState('planned', taskId ?? '');
  const [pages, setPages] = useDraftState('pages', '', 'text');
  const mins = Math.round(Number(minutes));
  const valid = Number.isFinite(mins) && mins >= 1 && mins <= 600;
  const waiting = useMemo(() => view.tasks.filter((t) => t.module === 'learning' && t.userPlanned && t.ref?.kind === 'interest' && t.ref.id === interestId && dueInfo(t, view.states[t.id], today).due === today), [view, interestId, today]);

  if (!interest) return <Sheet title="Log a session" onClose={closeSheet}><p>This interest is no longer in your list.</p></Sheet>;

  const save = () => {
    if (!valid) return;
    const entryId = uid('e');
    const target = planned ? view.byId.get(planned) : undefined;
    const task = target ?? adhocTask({ kind: 'learning', id: interest.id, name: book ? `Reading: ${book.title}` : starter ? `${interest.name}: ${starter.title}` : interest.name, minutes: mins, domain: 'learning', intensity: 'gentle', difficulty: 1 });
    const st = stamp();
    const action = { type: 'TASK_COMPLETE', task, stamp: st, minutes: mins, via: 'timer', entryId, surface: 'learning' } as const;
    const after = reducer(data, action).taskStates[task.id] ?? null;
    dispatch(action);
    const session: InterestSession = { id: uid('ses'), interestId: interest.id, entryId, date: st.today, at: st.now, bookId: book?.id ?? null, starterId: starter?.id ?? null, note: note.trim().slice(0, 500), feedback, resource: resource.trim().slice(0, 120) };
    dispatch({ type: 'SESSION_ADD', session });
    if (book && pages.trim() !== '' && Number.isFinite(Number(pages))) dispatch({ type: 'BOOK_PROGRESS', id: book.id, pagesRead: Number(pages) });
    if (book && book.status === 'want') dispatch({ type: 'BOOK_STATUS', id: book.id, status: 'reading', at: st.now });
    closeSheet();
    const undo = () => { dispatch({ type: 'UNDO', entryId, taskId: task.id, before: data.taskStates[task.id] ?? null, after }); dispatch({ type: 'SESSION_DELETE', id: session.id }); };
    if (feedback === 'not-for-me' && interest.status !== 'not-for-me') {
      toast(`Logged ${mins} min. Stop suggesting ${interest.name}?`, { label: 'Yes, not for me', run: () => dispatch({ type: 'INTEREST_STATUS', id: interest.id, status: 'not-for-me' }) });
    } else toast(`Logged: ${interest.name}, ${mins} min.`, { label: 'Undo', run: undo });
  };

  return (
    <Sheet title={book ? `Reading: ${book.title}` : starter ? starter.title : `Log ${interest.name}`} onClose={closeSheet} label="Log a session"
      footer={<><Button variant="secondary" onClick={closeSheet}>Cancel</Button><Button icon={I.check} disabled={!valid} onClick={save}>Log it</Button></>}>
      <div className="field">
        <label htmlFor="ls-min">How long (minutes)?</label>
        <div className="chips" style={{ marginBottom: 6 }}>{[5, 10, 15, 20, 30, 45].map((x) => <Chip small key={x} on={mins === x} onClick={() => setMinutes(String(x))}>{x}</Chip>)}</div>
        <input id="ls-min" className="input" type="number" min={1} max={600} inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} style={{ width: 130 }} aria-invalid={!valid} />
      </div>
      {book && book.pagesTotal !== null && <div className="field"><label htmlFor="ls-pg">Page you reached (optional)</label><input id="ls-pg" className="input" inputMode="numeric" value={pages} onChange={(e) => setPages(e.target.value)} placeholder={book.pagesRead !== null ? `Now at ${book.pagesRead}` : 'e.g. 42'} style={{ width: 130 }} /></div>}
      <div className="field"><span className="label" id="ls-fb">How was it? (optional)</span>
        <div className="chips" role="radiogroup" aria-labelledby="ls-fb">{(['enjoyed', 'try-again', 'not-for-me'] as const).map((f) => <Chip key={f} role="radio" on={feedback === f} onClick={() => setFeedback(feedback === f ? null : f)}>{FEEDBACK_LABEL[f]}</Chip>)}</div>
        <span className="small muted">This only changes what is suggested next, in a simple way. It says nothing about you.</span>
      </div>
      <div className="field"><label htmlFor="ls-res">What did you use? (optional)</label><input id="ls-res" className="input" maxLength={120} value={resource} onChange={(e) => setResource(e.target.value)} placeholder="A book, a video, a person: your own words" /></div>
      <div className="field"><label htmlFor="ls-note">A note (optional)</label><textarea id="ls-note" className="textarea" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></div>
      {waiting.length > 0 && (
        <div className="field"><label htmlFor="ls-plan">Is this one of the things you planned for today?</label>
          <select id="ls-plan" className="select" value={planned} onChange={(e) => setPlanned(e.target.value)}><option value="">No, log it on its own</option>{waiting.map((t) => <option key={t.id} value={t.id}>Yes: {t.name}</option>)}</select>
          <span className="small muted">If yes, it is recorded once, against that plan.</span></div>
      )}
    </Sheet>
  );
};

export { customInterest, interestFromCatalog, CATALOG_BY_ID };
export type { Interest };
