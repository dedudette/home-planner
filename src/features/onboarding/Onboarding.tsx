import { useEffect, useRef, useState } from 'react';
import { useApp } from '../../state/store';
import { I } from '../../ui/icons';
import { Button } from '../../ui/primitives';
import { stepsFor } from './steps';

const KEY = 'cleanflow:onb-step';
const BUILD_LINES = ['Mapping your rooms…', 'Matching tasks to your people and pets…', 'Fitting it to your time and energy…', 'Choosing a gentle starting point…'];

export const Onboarding = ({ onDone, onExit }: { onDone: () => void; onExit: () => void }) => {
  const { data, dispatch, stamp } = useApp();
  const STEPS = stepsFor(data.preferences.focus);
  const [step, setStep] = useState<number>(() => {
    try { const n = Number(window.localStorage.getItem(KEY)); return Number.isFinite(n) && n >= 0 && n <= STEPS.length ? n : 0; } catch { return 0; }
  });
  const [building, setBuilding] = useState(false);
  const [line, setLine] = useState(0);
  const head = useRef<HTMLHeadingElement>(null);
  const finishing = step === STEPS.length;
  const def = STEPS[Math.min(step, STEPS.length - 1)];
  const maxReached = useRef(step);
  maxReached.current = Math.max(maxReached.current, step);

  useEffect(() => {
    try { window.localStorage.setItem(KEY, String(step)); } catch { /* ignore */ }
    window.scrollTo({ top: 0 });
    head.current?.focus({ preventScroll: true });
  }, [step]);

  useEffect(() => {
    if (!building) return;
    const t = window.setInterval(() => setLine((l) => Math.min(l + 1, BUILD_LINES.length - 1)), 520);
    const done = window.setTimeout(() => {
      dispatch({ type: 'FINISH_ONBOARDING', stamp: stamp() });
      try { window.localStorage.removeItem(KEY); } catch { /* ignore */ }
      onDone();
    }, 2300);
    return () => { window.clearInterval(t); window.clearTimeout(done); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [building]);

  if (building) {
    return (
      <div className="onb"><div className="onb-body center" style={{ justifyContent: 'center', alignItems: 'center' }} role="status" aria-live="polite">
        <div className="five-card">
          <div className="big-ic celebrate"><I.sparkles size={38} aria-hidden /></div>
          <h1>Building your plan…</h1>
          <p className="muted">{BUILD_LINES[line]}</p>
        </div>
      </div></div>
    );
  }

  const ok = finishing ? true : def.required(data);
  return (
    <div className="onb">
      <header className="onb-top">
        <div className="row between">
          <button className="btn ghost sm" onClick={onExit} aria-label="Leave setup"><I.left size={16} aria-hidden /> Home</button>
          <span className="small strong" aria-live="polite">{finishing ? 'Almost there' : `Step ${step + 1} of ${STEPS.length}`}</span>
        </div>
        <nav className="onb-steps" aria-label="Progress">
          {STEPS.map((s, i) => (
            <button key={s.key} className={i < step ? 'done' : i === step ? 'cur' : ''} disabled={i > maxReached.current} onClick={() => setStep(i)}
              aria-label={`Step ${i + 1}: ${s.title}`} aria-current={i === step ? 'step' : undefined} />
          ))}
        </nav>
      </header>

      <main className="onb-body">
        {finishing ? (
          <>
            <div>
              <h1 ref={head} tabIndex={-1}>Ready when you are</h1>
              <p className="muted" style={{ marginTop: 6 }}>One last optional thing. Everything you've told us can be edited later from My Home.</p>
            </div>
            <div className="field">
              <label htmlFor="name">What should we call you? (optional)</label>
              <input id="name" className="input" value={data.user.name} maxLength={30} placeholder="Your first name" autoComplete="given-name"
                onChange={(e) => dispatch({ type: 'SET_NAME', name: e.target.value })} />
            </div>
            <div className="card tint">
              <div className="row"><I.leaf size={22} aria-hidden /><p>Your data stays on this device. There's no sign-up, and you can export or erase it any time.</p></div>
            </div>
          </>
        ) : (
          <>
            <div>
              <h1 ref={head} tabIndex={-1}>{def.title}</h1>
              <p className="muted" style={{ marginTop: 6 }}>{def.sub}</p>
            </div>
            <def.Component />
          </>
        )}
      </main>

      <footer className="onb-foot">
        <div className="in">
          {step > 0 && <Button variant="secondary" icon={I.left} onClick={() => setStep(step - 1)} aria-label="Back">Back</Button>}
          {!finishing && def.skippable && !ok && (
            <Button variant="ghost" onClick={() => setStep(step + 1)}>Skip</Button>
          )}
          <Button className="next" size="lg" disabled={!ok} onClick={() => (finishing ? setBuilding(true) : setStep(step + 1))}>
            {finishing ? 'Build my plan' : step === STEPS.length - 1 ? 'Review' : 'Continue'}
            <I.arrow size={18} aria-hidden />
          </Button>
        </div>
      </footer>
    </div>
  );
};
