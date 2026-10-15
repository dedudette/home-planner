import { useMemo, useState } from 'react';
import { CATALOG_BY_ID } from '../../domain/interests/catalog';
import { discoverInterests } from '../../domain/interests/discover';
import { bookProgress, READING_ID, readingInterest, recent } from '../../domain/interests/stats';
import type { Book, BookStatus, Budget, DiscoverAnswers, Setting, Social } from '../../domain/interests/types';
import { useApp } from '../../state/store';
import { I } from '../../ui/icons';
import { Button, Chip, Empty, Hint, PageHead, ProgressBar, Segmented, Tag } from '../../ui/primitives';
import { navigate, useRoute } from '../../ui/router';
import { PlannedActivities } from '../sections/SectionPage';
import { OwlTipCard } from '../../ui/OwlTip';
import { CATEGORY_LABEL, interestFromCatalog, STATUS_LABEL } from './shared';

type Tab = 'interests' | 'discover' | 'reading' | 'plan';
const TABS: { value: Tab; label: string }[] = [{ value: 'interests', label: 'Interests' }, { value: 'discover', label: 'Discover' }, { value: 'reading', label: 'Reading' }, { value: 'plan', label: 'Plan' }];

const InterestsTab = () => {
  const { data, today, openSheet, dispatch, toast } = useApp();
  const [showAside, setShowAside] = useState(false);
  const mine = data.interests.items.filter((i) => i.status !== 'not-for-me');
  const aside = data.interests.items.filter((i) => i.status === 'not-for-me');
  return (
    <div className="stack">
      <Hint icon={I.info}>Interests are things you are curious about, not tasks. Nothing here is due, and nothing you add goes into your plan unless you plan it.</Hint>
      {mine.length === 0 ? (
        <Empty icon={I.cap} title="No interests yet">Try <button className="btn ghost sm" onClick={() => navigate('learning?tab=discover')}>Discover</button> for small things to try, or add one you already have in mind.</Empty>
      ) : (
        <div className="stack" aria-label="Your interests">
          {mine.map((i) => {
            const lately = recent(data, i.id, today);
            return (
              <article className="card stack" key={i.id} aria-label={i.name} style={{ padding: 14 }}>
                <div className="row between" style={{ alignItems: 'flex-start', gap: 8 }}>
                  <button className="grow plain-btn" style={{ minHeight: 44 }} onClick={() => openSheet({ kind: 'interest', id: i.id })} aria-label={`${i.name}. Open details`}>
                    <b>{i.name}</b><br /><span className="small muted">{CATEGORY_LABEL[i.category]}{i.goal ? ` · ${i.goal}` : ''}</span>
                  </button>
                  <Button size="sm" icon={I.check} onClick={() => openSheet({ kind: 'logSession', interestId: i.id })} aria-label={`Log a session of ${i.name}`}>Log</Button>
                </div>
                <div className="row wrap small muted" style={{ gap: 8 }}>
                  <Tag kind={i.status === 'paused' ? 'lav' : undefined}>{STATUS_LABEL[i.status]}</Tag>
                  <span>{lately.sessions > 0 ? `${lately.minutes} min in the last four weeks` : 'Nothing logged lately'}</span>
                  {i.weeklyMinutes ? <span>Your idea: {i.weeklyMinutes} min a week</span> : null}
                </div>
              </article>
            );
          })}
        </div>
      )}
      <div className="row wrap" style={{ gap: 8 }}><Button variant="soft" icon={I.plus} onClick={() => openSheet({ kind: 'interestForm' })}>Add an interest</Button></div>
      {aside.length > 0 && (
        <section className="stack">
          <button className="btn ghost block" onClick={() => setShowAside((s) => !s)} aria-expanded={showAside}>{aside.length} marked not for me {showAside ? '▲' : '▼'}</button>
          {showAside && aside.map((i) => (
            <div className="row between" key={i.id}><span>{i.name}</span><Button size="sm" variant="ghost" onClick={() => { dispatch({ type: 'INTEREST_STATUS', id: i.id, status: 'exploring' }); toast(`${i.name} is back in your list.`); }}>Bring back</Button></div>
          ))}
        </section>
      )}
    </div>
  );
};

const MINUTES = [10, 15, 20, 30, 45, 60];
const BUDGETS: { value: Budget; label: string }[] = [{ value: 'free', label: 'Nothing: what I have at home' }, { value: 'low', label: 'A little: pencils, paper, thread' }, { value: 'some', label: 'Some: an instrument or a kit is fine' }];
const SETTINGS: { value: Setting; label: string }[] = [{ value: 'indoor', label: 'Indoors' }, { value: 'outdoor', label: 'Outdoors' }, { value: 'either', label: 'Either' }];
const SOCIALS: { value: Social; label: string }[] = [{ value: 'solo', label: 'On my own' }, { value: 'social', label: 'With others' }, { value: 'either', label: 'Either' }];

const DiscoverTab = () => {
  const { data, dispatch, openSheet, toast } = useApp();
  const a: DiscoverAnswers = data.interests.discover ?? { minutes: 15, budget: 'free', setting: 'either', social: 'either' };
  const set = (patch: Partial<DiscoverAnswers>) => dispatch({ type: 'DISCOVER_SET', answers: { ...a, ...patch } });
  const results = useMemo(() => discoverInterests(data, a), [data, a.minutes, a.budget, a.setting, a.social]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="stack">
      <Hint icon={I.info}>Tell us what you have, and we show a few things worth a first try. These come from a short list written for this app. We do not recommend books, courses or websites: if you use one, you add it yourself.</Hint>
      <section className="card stack" aria-label="What suits you">
        <div className="field"><span className="label" id="d-min">A first try should fit in</span><div className="chips" role="radiogroup" aria-labelledby="d-min">{MINUTES.map((m) => <Chip small key={m} role="radio" on={a.minutes === m} onClick={() => set({ minutes: m })}>{m} min</Chip>)}</div></div>
        <div className="field"><span className="label" id="d-bud">What can you spend?</span><div className="chips" role="radiogroup" aria-labelledby="d-bud">{BUDGETS.map((b) => <Chip small key={b.value} role="radio" on={a.budget === b.value} onClick={() => set({ budget: b.value })}>{b.label}</Chip>)}</div></div>
        <div className="field"><span className="label" id="d-set">Where?</span><div className="chips" role="radiogroup" aria-labelledby="d-set">{SETTINGS.map((b) => <Chip small key={b.value} role="radio" on={a.setting === b.value} onClick={() => set({ setting: b.value })}>{b.label}</Chip>)}</div></div>
        <div className="field"><span className="label" id="d-soc">With whom?</span><div className="chips" role="radiogroup" aria-labelledby="d-soc">{SOCIALS.map((b) => <Chip small key={b.value} role="radio" on={a.social === b.value} onClick={() => set({ social: b.value })}>{b.label}</Chip>)}</div></div>
      </section>
      <p className="small muted" role="status">{results.length === 0 ? 'Nothing on the list fits all of that. Try more time, or relax one answer.' : `${results.length} idea${results.length === 1 ? '' : 's'} fit${results.length === 1 ? 's' : ''}.`}</p>
      {results.map(({ interest: c, reasons, boostedBy }) => (
        <article className="card stack" key={c.id} aria-label={c.name} style={{ padding: 14 }}>
          <div><b>{c.name}</b><br /><span className="small muted">{c.blurb}</span></div>
          <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>{reasons.map((r) => <li key={r}>{r}</li>)}</ul>
          {boostedBy && <p className="small">{boostedBy}</p>}
          <div className="row wrap" style={{ gap: 8 }}>
            {c.starters[0] && <Button size="sm" icon={I.play} onClick={() => openSheet({ kind: 'starter', catalogId: c.id, starterId: c.starters[0].id })} aria-label={`Try ${c.name}: ${c.starters[0].title}`}>Try: {c.starters[0].title} ({c.starters[0].minutes} min)</Button>}
            <Button size="sm" variant="soft" icon={I.plus} onClick={() => { const it = interestFromCatalog(c, 'exploring'); dispatch({ type: 'INTEREST_SAVE', interest: it }); toast(`${c.name} added to your interests.`, { label: 'Undo', run: () => dispatch({ type: 'INTEREST_DELETE', id: it.id }) }); }} aria-label={`Add ${c.name} to my interests`}>Add</Button>
            <Button size="sm" variant="ghost" onClick={() => { const it = interestFromCatalog(c, 'not-for-me'); dispatch({ type: 'INTEREST_SAVE', interest: it }); toast(`${c.name} will not be suggested again.`, { label: 'Undo', run: () => dispatch({ type: 'INTEREST_DELETE', id: it.id }) }); }} aria-label={`${c.name}: not for me`}>Not for me</Button>
          </div>
        </article>
      ))}
    </div>
  );
};

const BOOK_GROUPS: { status: BookStatus; title: string; empty: string }[] = [
  { status: 'reading', title: 'Reading now', empty: 'Nothing in progress.' },
  { status: 'want', title: 'Want to read', empty: 'Nothing on the list yet.' },
  { status: 'finished', title: 'Finished', empty: 'Nothing finished yet. There is no hurry.' },
];

const BookCard = ({ b }: { b: Book }) => {
  const { data, openSheet, dispatch, toast } = useApp();
  const pct = bookProgress(b);
  const logIt = () => {
    let interest = readingInterest(data);
    if (!interest) { interest = interestFromCatalog(CATALOG_BY_ID.get(READING_ID)!, 'active'); dispatch({ type: 'INTEREST_SAVE', interest }); }
    openSheet({ kind: 'logSession', interestId: interest.id, bookId: b.id });
  };
  const move = (status: BookStatus) => { dispatch({ type: 'BOOK_STATUS', id: b.id, status, at: new Date().toISOString() }); toast(status === 'finished' ? `Finished ${b.title}.` : status === 'reading' ? `Started ${b.title}.` : `${b.title} is back on your want-to-read list.`); };
  return (
    <article className="card stack" aria-label={b.title} style={{ padding: 14 }}>
      <div className="row between" style={{ alignItems: 'flex-start', gap: 8 }}>
        <button className="grow plain-btn" style={{ minHeight: 44 }} onClick={() => openSheet({ kind: 'bookForm', editId: b.id })} aria-label={`${b.title}${b.author ? `, by ${b.author}` : ''}. Edit`}><b>{b.title}</b>{b.author && <><br /><span className="small muted">{b.author}</span></>}</button>
        {b.status !== 'finished' && <Button size="sm" icon={I.check} onClick={logIt} aria-label={`Log reading: ${b.title}`}>Log reading</Button>}
      </div>
      {b.status === 'reading' && (pct !== null ? <ProgressBar value={pct / 100} label={`${b.title}: ${pct}% read`} /> : b.pagesRead !== null ? <p className="small muted">Page {b.pagesRead}</p> : null)}
      {b.status === 'reading' && pct !== null && <p className="small muted">Page {b.pagesRead} of {b.pagesTotal}</p>}
      {b.status === 'finished' && b.finishedAt && <p className="small muted">Finished {b.finishedAt.slice(0, 10)}</p>}
      {b.note && <p className="small">{b.note}</p>}
      <div className="chips" role="group" aria-label={`Move ${b.title}`}>
        {BOOK_GROUPS.filter((g) => g.status !== b.status).map((g) => { const label = g.status === 'reading' ? 'Start reading' : g.status === 'finished' ? 'Mark finished' : 'Back to want to read'; return <Chip small key={g.status} onClick={() => move(g.status)} aria-label={`${label}: ${b.title}`}>{label}</Chip>; })}
      </div>
    </article>
  );
};

const ReadingTab = () => {
  const { data, openSheet } = useApp();
  const books = data.interests.books;
  return (
    <div className="stack">
      <Hint icon={I.info}>Add what you are reading or want to read. You type the titles: the app does not suggest or rate books. Page numbers are optional.</Hint>
      <div><Button variant="soft" icon={I.plus} onClick={() => openSheet({ kind: 'bookForm' })}>Add a book</Button></div>
      {books.length === 0 ? <Empty icon={I.cap} title="Your reading list is empty">Add a book you are reading, or one you would like to read someday.</Empty> : BOOK_GROUPS.map((g) => {
        const xs = books.filter((b) => b.status === g.status);
        if (xs.length === 0 && g.status === 'finished') return null;
        return (
          <section className="stack" key={g.status} aria-labelledby={`bk-${g.status}`}>
            <h2 id={`bk-${g.status}`} className="h3">{g.title} <span className="muted small">· {xs.length}</span></h2>
            {xs.length === 0 ? <p className="small muted">{g.empty}</p> : xs.map((b) => <BookCard key={b.id} b={b} />)}
          </section>
        );
      })}
    </div>
  );
};

/** Learning and hobbies: what you are curious about, small things to try, what you are reading, and what you plan. */
export const Learning = () => {
  const route = useRoute();
  const raw = route.query.get('tab');
  const tab: Tab = TABS.some((t) => t.value === raw) ? (raw as Tab) : 'interests';
  return (
    <div className="page">
      <PageHead title="Learning & hobbies" sub="Reading, music, making things and anything you are curious about. Optional, always." />
      <Segmented<Tab> label="Learning sections" value={tab} onChange={(t) => navigate(`learning?tab=${t}`)} options={TABS} />
      <OwlTipCard place="learning" />
      {tab === 'interests' && <InterestsTab />}
      {tab === 'discover' && <DiscoverTab />}
      {tab === 'reading' && <ReadingTab />}
      {tab === 'plan' && <PlannedActivities module="learning" />}
    </div>
  );
};
