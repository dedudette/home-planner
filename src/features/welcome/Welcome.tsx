import { useState } from 'react';
import { DEMO_PROFILES } from '../../domain/demo';
import { useAccount } from '../../account/AccountProvider';
import { SignedInBar } from '../../account/SignedInBar';
import { useApp } from '../../state/store';
import { I } from '../../ui/icons';
import { Button } from '../../ui/primitives';

export const Welcome = ({ onStart, onDemo }: { onStart: () => void; onDemo: () => void }) => {
  const { dispatch, stamp } = useApp();
  const { mode } = useAccount();
  const [history, setHistory] = useState(true);
  return (
    <div className="onb">
      <SignedInBar />
      <div className="hero">
        <span className="brand"><span className="brand-mark"><I.sparkles size={20} aria-hidden /></span>CleanFlow</span>
        <span className="badge"><I.leaf size={16} aria-hidden /> Your home and everyday life, without the overwhelm</span>
        <h1>One calm plan for your home, your body and your day</h1>
        <p className="lead">Choose what you want help with: cleaning, movement, meals and shopping, learning and hobbies, wellbeing. CleanFlow builds one realistic daily plan around the minutes and energy you really have, with tiny steps for the days when everything feels like too much.</p>
        <Button size="lg" onClick={onStart} icon={I.arrow}>Build my plan</Button>
        <p className="small muted">About 3 minutes · {mode === 'accounts' ? 'Your plan stays on this device' : 'No account needed · Your data stays on this device'}</p>
      </div>

      <div className="features">
        {[
          { ic: I.home, t: 'Built for you', d: 'Only the sections you pick. A dorm room never gets garage chores, and nobody gets a diet they did not ask for.' },
          { ic: I.timer, t: 'Just 5 minutes', d: 'One tiny task, a timer, and a kind word. No shame if you stop.' },
          { ic: I.sparkles, t: 'Your plan, your say', d: 'Nothing you planned is moved or removed without asking, and not logging something is never counted against you.' },
        ].map((f) => (
          <div className="card feature" key={f.t}>
            <div className="ic"><f.ic size={22} aria-hidden /></div>
            <h2 className="h3">{f.t}</h2>
            <p className="small muted" style={{ marginTop: 4 }}>{f.d}</p>
          </div>
        ))}
      </div>

      <section className="hero" style={{ paddingTop: 36, maxWidth: 860, width: '100%' }} aria-labelledby="demo-h">
        <h2 id="demo-h">Just looking? Try a demo home</h2>
        <p className="muted">Seven very different people, each with their own generated plan.</p>
        <label className="row small" style={{ gap: 8 }}>
          <input type="checkbox" checked={history} onChange={(e) => setHistory(e.target.checked)} style={{ width: 20, height: 20 }} />
          Include three weeks of sample progress
        </label>
        <div className="demos" style={{ width: '100%' }}>
          {DEMO_PROFILES.map((d) => (
            <button key={d.id} className="demo-card" onClick={() => { dispatch({ type: 'LOAD_DEMO', id: d.id, withHistory: history, stamp: stamp() }); onDemo(); }}>
              <span className="em" aria-hidden>{d.emoji}</span>
              <span><b>{d.title}</b><br /><span className="small muted">{d.blurb}</span></span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
};
