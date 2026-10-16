import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type MutableRefObject } from 'react';
import { formatShort } from '../../domain/dates';
import { buildCoachPayload, describePayload, METRICS, type CoachPayload } from '../../domain/coach/metrics';
import type { CoachSuggestion } from '../../domain/coach/output';
import { PATTERN_RULES, type Patterns } from '../../domain/patterns';
import { I } from '../../ui/icons';
import { Button } from '../../ui/primitives';
import { createCoachController } from './coachController';

const KIND_LABEL: Record<CoachSuggestion['kind'], string> = { pattern: 'What the records show', idea: 'An optional idea', data_note: 'About the data' };
const STRENGTH_NOTE = { limited: 'limited', moderate: 'moderate', good: 'good' } as const;

const Evidence = ({ s, payload }: { s: CoachSuggestion; payload: CoachPayload }) => (
  <div>
    <p className="small muted" style={{ marginBottom: 4 }}>Based on these counts:</p>
    <ul className="chips-static">
      {s.metricIds.map((id) => <li key={id}><span>{METRICS[id].label}</span> <b>{payload.metrics[id]}</b></li>)}
    </ul>
  </div>
);

/**
 * The optional AI coach. It is closed until asked, shows exactly what would be sent before anything is, and can only ever display
 * text: it has no access to the person's data or plan, so nothing it says can change them.
 */
export const CoachPanel = ({ p, windowKey, askedFor }: { p: Patterns; windowKey: number; askedFor: MutableRefObject<{ from: string; to: string } | null> }) => {
  const ctl = useMemo(() => createCoachController(), []);
  const st = useSyncExternalStore(ctl.subscribe, ctl.get);
  const payload = useMemo(() => buildCoachPayload(p), [p]);
  const [, tick] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const wait = ctl.cooldown();

  // A different window is a different question: drop anything in progress or on screen.
  useEffect(() => { ctl.reset(); }, [windowKey, ctl]);
  useEffect(() => () => ctl.reset(), [ctl]);
  // Keep the "wait N seconds" text honest.
  useEffect(() => {
    if (wait <= 0) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [wait]);
  // Move focus into whatever just appeared, and back to the button when it closes.
  const prev = useRef(st.s);
  useEffect(() => {
    if (prev.current !== st.s) {
      if (['review', 'unavailable', 'done', 'error'].includes(st.s)) heading.current?.focus();
      if (st.s === 'idle' && prev.current !== 'idle') document.getElementById('coach-ask')?.focus();
      prev.current = st.s;
    }
  }, [st.s]);

  const ask = () => { askedFor.current = { from: p.from, to: p.to }; if (payload) void ctl.open(payload); };
  const close = () => ctl.reset();

  return (
    <section className="card stack" aria-labelledby="coach-h" data-testid="coach">
      <div className="row between wrap">
        <h2 id="coach-h" className="h3" ref={heading} tabIndex={-1}>
          {st.s === 'review' ? 'Before anything is sent' : st.s === 'done' ? 'AI suggestions' : 'AI suggestions (optional)'}
        </h2>
        {st.s === 'done' && <span className="tag" data-testid="coach-ai-label">AI-generated</span>}
      </div>

      {st.s === 'idle' && (
        <>
          <p className="small">
            Off unless you ask. If you do, you will see exactly what would be sent first, and you can cancel. The AI only explains the counts above and offers a few optional ideas. It cannot change your plan.
          </p>
          {!payload && <p className="small muted" id="coach-why">Available once this window has at least {PATTERN_RULES.minOpenedDays} days opened and {PATTERN_RULES.minSeenTasks} tasks shown.</p>}
          <div><Button id="coach-ask" icon={I.sparkles} disabled={!payload} aria-describedby={!payload ? 'coach-why' : undefined} onClick={ask}>Ask AI for suggestions</Button></div>
        </>
      )}

      {st.s === 'checking' && <p className="small" role="status">Checking whether AI suggestions are set up. Nothing is being sent.</p>}

      {st.s === 'unavailable' && (
        <>
          <p className="small" role="status" data-testid="coach-unavailable">
            {st.why === 'not-set-up'
              ? "AI suggestions aren't set up for this copy of CleanFlow. They need a server with a provider key (see the README, section “AI coach”)."
              : "Couldn't reach the AI suggestion service. This copy may be hosted without a server."}{' '}
            Nothing was sent.
          </p>
          <div><Button variant="secondary" onClick={close}>Close</Button></div>
        </>
      )}

      {st.s === 'review' && (
        <div className="stack" data-testid="coach-review">
          <p className="small">
            If you continue, CleanFlow sends the counts below to <b>{st.status.provider ?? 'the AI provider'}</b>{st.status.model ? <> (model <b>{st.status.model}</b>)</> : null} so an AI can explain them and offer a few ideas. This is everything that is sent.
          </p>
          <p className="small"><b>Not sent:</b> your name, task names, room names, dates, notes, or any of your saved data.</p>
          <dl className="facts" aria-label="What would be sent">
            <div className="facts-row"><dt>Window</dt><dd>last {st.payload.windowDays} days</dd></div>
            {describePayload(st.payload).map((m) => <div className="facts-row" key={m.id}><dt>{m.label}</dt><dd>{m.value}</dd></div>)}
          </dl>
          <details className="small payload-details">
            <summary>Show the exact data</summary>
            <pre className="payload-json" tabIndex={0} aria-label="Exact data that would be sent">{JSON.stringify(st.payload, null, 2)}</pre>
          </details>
          <p className="small muted">AI answers can be wrong, and they never change anything in your plan. Each request uses the provider's paid service, billed to whoever runs this server, and there is a short wait between requests.</p>
          <div className="row wrap" style={{ gap: 8 }}>
            <Button disabled={wait > 0} onClick={() => void ctl.send()}>{wait > 0 ? `Send in ${wait}s` : 'Send these counts'}</Button>
            <Button variant="secondary" onClick={close}>Cancel</Button>
          </div>
        </div>
      )}

      {st.s === 'sending' && (
        <>
          <p className="small" role="status">Waiting for the AI. This can take a little while.</p>
          <div><Button variant="secondary" onClick={close}>Cancel</Button></div>
        </>
      )}

      {st.s === 'error' && (
        <>
          <p className="small" role="alert" data-testid="coach-error">{st.message}</p>
          <div className="row wrap" style={{ gap: 8 }}>
            {payload && <Button variant="secondary" onClick={ask}>Back to the summary</Button>}
            <Button variant="ghost" onClick={close}>Close</Button>
          </div>
        </>
      )}

      {st.s === 'done' && (
        <div className="stack" data-testid="coach-result">
          <p className="small muted" data-testid="coach-evidence-window">
            Evidence window: last {st.payload.windowDays} days{askedFor.current ? ` (${formatShort(askedFor.current.from)} to ${formatShort(askedFor.current.to)})` : ''} · {st.payload.metrics['days.opened']} days opened · {st.payload.metrics['tasks.seen']} tasks shown · evidence strength: {STRENGTH_NOTE[st.strength]} (this reflects how much was recorded, not anything about you).
          </p>
          {st.suggestions.length === 0 && (
            <p data-testid="coach-fallback">{st.notice === 'insufficient' ? "There isn't enough recorded information for a useful suggestion yet." : "I couldn't create a reliable suggestion from this data."}</p>
          )}
          {st.suggestions.map((s, i) => (
            <article className="card soft stack" key={i} data-testid="coach-suggestion">
              <p className="small muted">{KIND_LABEL[s.kind]} · evidence strength: {STRENGTH_NOTE[s.strength]}</p>
              <h3 className="h3">{s.title}</h3>
              <p>{s.explanation}</p>
              {s.idea && <p><b>Optional idea:</b> {s.idea} <span className="small muted">Nothing changes unless you choose to do it yourself.</span></p>}
              <Evidence s={s} payload={st.payload} />
            </article>
          ))}
          <p className="small muted">AI-generated{st.meta ? ` by ${st.meta.provider} (${st.meta.model})` : ''}. It can be wrong. It did not change anything in your plan.</p>
          <div className="row wrap" style={{ gap: 8 }}>
            <Button variant="secondary" onClick={close}>Dismiss</Button>
            <Button variant="ghost" icon={I.sparkles} onClick={ask}>Ask again</Button>
          </div>
        </div>
      )}
    </section>
  );
};
