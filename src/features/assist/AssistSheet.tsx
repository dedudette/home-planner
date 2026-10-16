import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { describeChosen, itemKey, nameOf, proposalActions } from '../../domain/assist/apply';
import { buildLearningRequest, buildMealsRequest, buildMovementRequest, type Built } from '../../domain/assist/build';
import type { AssistFeature, AssistProposal, ProposalOrigin } from '../../domain/assist/types';
import { addDays, formatDay } from '../../domain/dates';
import { CATALOG_BY_ID } from '../../domain/interests/catalog';
import type { DiscoverAnswers } from '../../domain/interests/types';
import { MEAL_SLOTS, type MealSlot } from '../../domain/meals/types';
import { useApp } from '../../state/store';
import { I } from '../../ui/icons';
import { Owl } from '../../ui/Owl';
import { Button, Chip, Hint, Sheet } from '../../ui/primitives';
import { interestFromCatalog } from '../learning/shared';
import { SLOT_LABEL } from '../meals/actions';
import { createAssistController } from './assistController';

const TITLE: Record<AssistFeature, string> = { meals: 'Suggest meals', movement: 'Plan my movement', learning: 'Ideas to try' };
const DEFAULT_ANSWERS: DiscoverAnswers = { minutes: 15, budget: 'free', setting: 'either', social: 'either' };

/**
 * One assistant, three jobs. The app first filters what could be suggested using the person's own settings, here on the device. Then
 * either the app's own simple rules (no AI, no network) or, if they choose and it is set up, the AI picks among those candidates and
 * says why. Both paths end in the same review: nothing is added until it is approved, line by line.
 */
export const AssistSheet = ({ feature }: { feature: AssistFeature }) => {
  const { data, today, closeSheet, dispatch, toast, openSheet } = useApp();
  const ctl = useMemo(() => createAssistController(), []);
  const state = useSyncExternalStore(ctl.subscribe, ctl.get);
  const [avail, setAvail] = useState<'checking' | 'available' | 'not-set-up' | 'unreachable'>('checking');
  const [wish, setWish] = useState('');
  const [own, setOwn] = useState(false);
  const [days, setDays] = useState(feature === 'meals' ? 5 : 7);
  const enabledSlots = MEAL_SLOTS.filter((s) => data.meals.prefs.slots[s].on && s !== 'snack');
  const [slots, setSlots] = useState<MealSlot[]>(enabledSlots.length ? enabledSlots.slice(0, 2) : ['lunch', 'dinner']);
  const [sessions, setSessions] = useState(3);
  const [maxMin, setMaxMin] = useState<number | null>(30);
  // What is ticked in the review. Kept here so the buttons that act on it can sit in the sheet's footer, always in view.
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  useEffect(() => { if (state.s === 'done' && state.proposal) setChosen(new Set(state.proposal.items.map(itemKey))); }, [state]);

  useEffect(() => {
    let live = true;
    void ctl.probe().then((r) => { if (live) setAvail(r); });
    return () => { live = false; ctl.reset(); };
  }, [ctl]);

  const built: Built = useMemo(() => {
    const dayList = Array.from({ length: days }, (_, i) => addDays(today, i));
    if (feature === 'meals') return buildMealsRequest(data, { days: dayList, slots, wish, includeOwnDishes: own });
    if (feature === 'movement') return buildMovementRequest(data, { today, days, maxItems: sessions, maxMinutes: maxMin, wish, includeOwn: own });
    return buildLearningRequest(data, data.interests.discover ?? DEFAULT_ANSWERS, wish);
  }, [feature, data, today, days, slots, wish, own, sessions, maxMin]);
  const nothing = built.request.candidates.length === 0;

  const idle = state.s === 'idle';
  const approve = (p: AssistProposal) => {
    const res = proposalActions(data, p, chosen, today);
    for (const a of res.actions) dispatch(a);
    closeSheet();
    const undo = () => { for (const a of res.actions) { if (a.type === 'MEAL_SAVE') dispatch({ type: 'MEAL_DELETE', id: a.entry.id }); else if (a.type === 'ACTIVITY_SAVE') dispatch({ type: 'ACTIVITY_DELETE', id: a.activity.id }); } };
    toast(res.skipped ? `Added ${res.added}. ${res.skipped} already in your plan or no longer available.` : `Added ${res.added} to your plan.`, res.added ? { label: 'Undo', run: undo } : undefined);
  };
  const footer = (() => {
    if (state.s === 'review') return <><Button variant="secondary" onClick={() => ctl.reset()}>Back</Button><Button icon={I.arrow} onClick={() => void ctl.send()}>Send to the AI</Button></>;
    if (state.s === 'done') {
      const p = state.proposal;
      if (!p || p.feature === 'learning') return <><Button variant="secondary" onClick={() => ctl.reset()}>Back</Button><Button variant="ghost" onClick={closeSheet}>Close</Button></>;
      return <><Button variant="secondary" onClick={() => ctl.reset()}>Back</Button><Button icon={I.check} disabled={chosen.size === 0} onClick={() => approve(p)}>Add {describeChosen(p, chosen)} to my plan</Button></>;
    }
    if (state.s === 'sending' || state.s === 'checking') return <Button variant="secondary" onClick={() => ctl.reset()}>Cancel</Button>;
    if (state.s === 'unavailable' || state.s === 'error') return <><Button variant="secondary" onClick={() => ctl.reset()}>Back</Button><Button icon={I.sparkles} disabled={nothing} onClick={() => ctl.local(built.request)}>Suggest with the app</Button></>;
    return <><Button variant="secondary" onClick={closeSheet}>Close</Button><Button variant="soft" icon={I.sparkles} disabled={nothing} onClick={() => ctl.local(built.request)}>Suggest with the app</Button><Button icon={I.arrow} disabled={nothing || avail !== 'available'} onClick={() => void ctl.open(built.request)}>Ask the AI</Button></>;
  })();

  const toggleSlot = (s: MealSlot) => setSlots((x) => (x.includes(s) ? (x.length > 1 ? x.filter((y) => y !== s) : x) : [...x, s]));

  return (
    <Sheet title={TITLE[feature]} onClose={closeSheet} label={TITLE[feature]} full footer={footer}>
      {idle && (
        <>
          <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
            <Owl size={52} state={avail === 'available' ? 'idle' : avail === 'checking' ? 'thinking' : 'unavailable'} />
            <p className="small" style={{ margin: 0 }} role="status">
              {avail === 'checking' ? 'Checking whether the AI assistant is set up…'
                : avail === 'available' ? 'The AI assistant is set up on this server. It is optional: the app can make a suggestion by itself too.'
                : 'The AI assistant is not set up here, so only the app\'s own suggestion is available. It works the same way and needs no internet.'}
            </p>
          </div>
          {feature === 'meals' && (
            <>
              <div className="field"><span className="label" id="as-days">How many days?</span><div className="chips" role="radiogroup" aria-labelledby="as-days">{[3, 5, 7].map((n) => <Chip small key={n} role="radio" on={days === n} onClick={() => setDays(n)}>{n} days</Chip>)}</div></div>
              <div className="field"><span className="label" id="as-slots">Which meals?</span><div className="chips" role="group" aria-labelledby="as-slots">{(['breakfast', 'lunch', 'dinner'] as const).map((s) => <Chip small key={s} role="checkbox" on={slots.includes(s)} onClick={() => toggleSlot(s)}>{SLOT_LABEL[s]}</Chip>)}</div></div>
            </>
          )}
          {feature === 'movement' && (
            <>
              <div className="field"><span className="label" id="as-n">How many sessions?</span><div className="chips" role="radiogroup" aria-labelledby="as-n">{[1, 2, 3, 4, 5].map((n) => <Chip small key={n} role="radio" on={sessions === n} onClick={() => setSessions(n)}>{n}</Chip>)}</div></div>
              <div className="field"><span className="label" id="as-m">Longest session</span><div className="chips" role="radiogroup" aria-labelledby="as-m">{[10, 20, 30, 45].map((n) => <Chip small key={n} role="radio" on={maxMin === n} onClick={() => setMaxMin(n)}>{n} min</Chip>)}<Chip small role="radio" on={maxMin === null} onClick={() => setMaxMin(null)}>No limit</Chip></div></div>
            </>
          )}
          {feature === 'learning' && <p className="small muted">This uses your answers on the Discover tab (time, budget, place, company), and leaves out anything you marked "not for me".</p>}
          <div className="field"><label htmlFor="as-wish">A note about what you would like (optional)</label>
            <input id="as-wish" className="input" maxLength={200} value={wish} onChange={(e) => setWish(e.target.value)} placeholder={feature === 'meals' ? 'e.g. something quick on weeknights' : feature === 'movement' ? 'e.g. gentle, on days I work from home' : 'e.g. something creative and quiet'} />
            <span className="small muted">Only the AI reads this, and only if you send it. The app's own suggestion ignores it.</span></div>
          {feature !== 'learning' && (
            <label className="row between switch-row"><span><b>Include my own {feature === 'meals' ? 'dishes' : 'workouts'}</b><br /><span className="small muted">Names only. Off by default: only the built-in {feature === 'meals' ? 'recipes' : 'workouts'} are used.</span></span>
              <input type="checkbox" role="switch" aria-label={`Include my own ${feature === 'meals' ? 'dishes' : 'workouts'}`} checked={own} onChange={(e) => setOwn(e.target.checked)} style={{ width: 24, height: 24 }} /></label>
          )}
          <p className="small" role="status">{nothing ? 'Nothing fits your settings with those choices. Try fewer limits' + (feature === 'meals' ? ', or change your diet and allergen settings in Meals → Setup.' : '.') : `${built.request.candidates.length} option${built.request.candidates.length === 1 ? '' : 's'} fit what you told us.`}</p>
        </>
      )}

      {state.s === 'checking' && <div className="row" style={{ gap: 12 }}><Owl size={52} state="thinking" /><p role="status">Checking whether the AI is set up…</p></div>}

      {state.s === 'unavailable' && (
        <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}><Owl size={52} state="unavailable" />
          <p role="status">{state.why === 'not-set-up' ? 'The AI assistant is not set up on this server, so nothing was sent.' : 'The AI assistant could not be reached, so nothing was sent.'} The app's own suggestion works without it.</p></div>
      )}

      {state.s === 'review' && (
        <>
          <Hint icon={I.info}>Nothing has been sent yet. This is everything that would be.</Hint>
          <section className="card stack" aria-labelledby="as-send"><h3 id="as-send" className="h3">What will be sent</h3>
            <ul style={{ margin: 0, paddingLeft: 18 }}>{built.preview.map((l) => <li key={l}>{l}</li>)}</ul>
            <details><summary>Show the options</summary><ul className="small" style={{ margin: '6px 0 0', paddingLeft: 18 }}>{state.request.candidates.map((c) => <li key={c.id}>{c.name}, {c.minutes} min{c.tags.length ? `, ${c.tags.join(', ')}` : ''}</li>)}</ul></details></section>
          <section className="card stack" aria-labelledby="as-keep"><h3 id="as-keep" className="h3">What stays on this device</h3>
            <ul style={{ margin: 0, paddingLeft: 18 }}>{built.kept.map((l) => <li key={l}>{l}</li>)}</ul>
            <p className="small muted">Journals, mood and check-ins, water and health notes are never part of this.</p></section>
          <p className="small muted">It goes to {state.status.provider ?? 'the AI provider'}{state.status.model ? ` (model ${state.status.model})` : ''} through this app's own server, which holds the key. Usage is billed to the provider account behind that key. You choose what is added afterwards.</p>
        </>
      )}

      {state.s === 'sending' && <div className="row" style={{ gap: 12 }}><Owl size={52} state="thinking" /><p role="status">Asking the AI. Nothing is changed while it thinks.</p></div>}

      {state.s === 'error' && <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}><Owl size={52} state="unavailable" /><p role="alert">{state.message}</p></div>}

      {state.s === 'done' && (
        <Review proposal={state.proposal} origin={state.origin} notice={state.notice} meta={state.meta} chosen={chosen} toggle={(k) => setChosen((x) => { const n = new Set(x); if (n.has(k)) n.delete(k); else n.add(k); return n; })}
          openStarter={(catalogId, starterId) => { closeSheet(); openSheet({ kind: 'starter', catalogId, starterId }); }}
          addInterest={(catalogId) => { const c = CATALOG_BY_ID.get(catalogId); if (!c || data.interests.items.some((i) => i.catalogId === catalogId)) return; const it = interestFromCatalog(c, 'exploring'); dispatch({ type: 'INTEREST_SAVE', interest: it }); toast(`${c.name} added to your interests.`, { label: 'Undo', run: () => dispatch({ type: 'INTEREST_DELETE', id: it.id }) }); }} />
      )}
    </Sheet>
  );
};

const Review = ({ proposal, origin, notice, meta, chosen, toggle, openStarter, addInterest }: {
  proposal: AssistProposal | null; origin: ProposalOrigin; notice?: 'unreliable' | 'empty'; meta?: { provider: string; model: string };
  chosen: ReadonlySet<string>; toggle: (key: string) => void; openStarter: (catalogId: string, starterId: string) => void; addInterest: (catalogId: string) => void;
}) => {
  const { data, today } = useApp();
  if (!proposal) {
    return (
      <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}><Owl size={52} state="unavailable" />
        <p role="status">{notice === 'unreliable' ? 'The AI answered, but its answer could not be checked, so none of it is shown. Nothing was changed.' : 'Nothing fits those choices.'}</p></div>
    );
  }
  const learning = proposal.feature === 'learning';
  return (
    <>
      <div className="row wrap" style={{ gap: 8 }}>
        <span className={origin === 'ai' ? 'badge-ai' : 'badge-app'} data-testid="origin">{origin === 'ai' ? <><I.sparkles size={12} aria-hidden /> AI suggestion{meta ? ` · ${meta.model}` : ''}</> : <><I.check size={12} aria-hidden /> Suggested by the app, no AI</>}</span>
        {origin === 'ai' && <span className="small muted">Check it before you use it. The AI can be wrong.</span>}
      </div>
      {proposal.note && <p className="small">{proposal.note}</p>}
      <ul className="stack" style={{ margin: 0, padding: 0 }} aria-label="Suggestions">
        {proposal.items.map((i) => {
          const k = itemKey(i);
          const catalogId = learning ? i.candidateId.split(':')[0] : '';
          const starterId = learning ? i.candidateId.split(':')[1] : '';
          const name = learning ? `${CATALOG_BY_ID.get(catalogId)?.name ?? ''}: ${CATALOG_BY_ID.get(catalogId)?.starters.find((s) => s.id === starterId)?.title ?? ''}` : (nameOf(data, proposal.feature, i.candidateId) ?? i.candidateId);
          const when = i.date ? `${formatDay(i.date, today)}${i.slot ? `, ${SLOT_LABEL[i.slot].toLowerCase()}` : ''}` : '';
          return (
            <li key={k} className="card stack" style={{ listStyle: 'none', padding: 12, gap: 6 }} data-testid="proposal-item">
              {learning ? (
                <div><b>{name}</b><br /><span className="small muted">{i.reason}</span></div>
              ) : (
                <label className="row" style={{ gap: 10, alignItems: 'flex-start', minHeight: 44 }}>
                  <input type="checkbox" checked={chosen.has(k)} onChange={() => toggle(k)} style={{ width: 24, height: 24, flex: 'none', marginTop: 2 }} aria-label={`${name}, ${when}`} />
                  <span style={{ minWidth: 0 }}><b>{name}</b> <span className="muted">· {when}</span><br /><span className="small muted">{i.reason}</span></span>
                </label>
              )}
              {learning && <div className="row wrap" style={{ gap: 8 }}><Button size="sm" icon={I.play} onClick={() => openStarter(catalogId, starterId)}>Try it</Button><Button size="sm" variant="soft" icon={I.plus} onClick={() => addInterest(catalogId)}>Add to my interests</Button></div>}
            </li>
          );
        })}
      </ul>
      {!learning && <p className="small muted">Untick anything you do not want. Nothing is added until you press the button below, and you can undo it afterwards.</p>}
    </>
  );
};
