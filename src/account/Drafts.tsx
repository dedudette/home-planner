import { useId } from 'react';
import { DRAFT_SHEET_KINDS, MAX_AGE_DAYS, scopeOfSheet, type DraftSummary } from '../state/drafts';
import { useDrafts, useDraftsSnapshot } from '../state/draftsContext';
import { useApp, type Sheet } from '../state/store';
import { I } from '../ui/icons';
import { Button } from '../ui/primitives';
import { navigate, useRoute } from '../ui/router';

const timeOf = (at: number) => new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const countWords = (n: number) => (n === 1 ? 'one draft' : `${n} drafts`);
const kinds = (ds: DraftSummary[]) => [...new Set(ds.map((d) => d.label.toLowerCase()))].join(', ');

/**
 * Shown in the planner after the planner has been closed and has opened again (for example after paying and coming back, which is a whole
 * new page load): text typed into a form and not saved is still here, kept on this device only. It says what each draft is (never the text),
 * lets the person open the form again to finish it (the form's own button saves it: nothing is submitted by this), or discard it.
 */
export const DraftsBanner = () => {
  const drafts = useDrafts();
  const snap = useDraftsSnapshot();
  const { sheets, openSheet } = useApp();
  const route = useRoute();
  if (!drafts || snap.bannerHidden) return null;
  const open = new Set(sheets.map((s) => scopeOfSheet(s)?.id).filter((x): x is string => !!x));
  const items = snap.drafts.filter((d) => !open.has(d.scope) && !(d.page !== null && d.page === route.path.split('/')[0]));
  if (!items.length) return null;
  const resume = (d: DraftSummary) => {
    if ('sheet' in d.resume && typeof d.resume.sheet.kind === 'string' && DRAFT_SHEET_KINDS.has(d.resume.sheet.kind)) openSheet(d.resume.sheet as unknown as Sheet);
    else if ('route' in d.resume) navigate(d.resume.route);
  };
  return (
    <section className="banner" role="region" aria-label="Text you had not saved" data-testid="drafts-banner">
      <I.info size={18} aria-hidden />
      <div className="stack" style={{ gap: 8 }}>
        <p><b>Text you had not saved is still here.</b></p>
        <p className="small">It was kept on this device, under your account, when your plan paused. It was not saved into your plan and nothing was sent to the server. Open it to finish, or discard it.</p>
        <ul className="drafts-list">
          {items.map((d) => (
            <li key={d.scope}>
              <span>{d.label}, typed {timeOf(d.at)}</span>
              <span className="row wrap" style={{ gap: 6 }}>
                <Button size="sm" onClick={() => resume(d)}>Resume</Button>
                <Button size="sm" variant="ghost" onClick={() => drafts.discard(d.scope)}>Discard</Button>
              </span>
            </li>
          ))}
        </ul>
        <div className="row wrap" style={{ gap: 6 }}>
          {items.length > 1 && <Button size="sm" variant="ghost" onClick={() => drafts.discardAll()}>Discard all</Button>}
          <Button size="sm" variant="ghost" onClick={() => drafts.hideBanner()}>Not now</Button>
        </div>
      </div>
    </section>
  );
};

/**
 * On the screens that stay open when the planner is closed (Trial & plans, Data & backup, "cannot confirm"): what was kept, where, for how
 * long, and a way to delete it. Says plainly when this device would not let it be kept.
 */
export const DraftsNote = () => {
  const drafts = useDrafts();
  const snap = useDraftsSnapshot();
  const h = useId();
  if (!drafts || (!snap.drafts.length && !snap.persistFailed)) return null;
  return (
    <section className="card stack" aria-labelledby={h} data-testid="drafts-note">
      <h2 id={h} className="h3">Text you had not saved</h2>
      {snap.drafts.length > 0 && (
        <>
          <p className="small">
            {countWords(snap.drafts.length)} ({kinds(snap.drafts)}) {snap.drafts.length === 1 ? 'is' : 'are'} kept so you can finish {snap.drafts.length === 1 ? 'it' : 'them'} when your plan is open again.
            {' '}{snap.drafts.length === 1 ? 'It is' : 'They are'} stored only on this device, under your account: never sent to the server, and not part of a backup or a download.
            {' '}{snap.drafts.length === 1 ? 'It is' : 'They are'} removed after {MAX_AGE_DAYS} days, or sooner if you discard {snap.drafts.length === 1 ? 'it' : 'them'} or delete your account.
          </p>
          <div><Button size="sm" variant="secondary" onClick={() => drafts.discardAll()}>Discard {snap.drafts.length === 1 ? 'it' : 'all'}</Button></div>
        </>
      )}
      {snap.persistFailed && (
        <p className="small" role="status">This device would not let us keep your unsaved text. It stays only while this page stays open; reloading or leaving the page will lose it.</p>
      )}
    </section>
  );
};
