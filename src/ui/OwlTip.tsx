import { dismissKey, nextTip, type TipPlace } from '../domain/owl/tips';
import { useApp } from '../state/store';
import { Owl } from './Owl';
import { Button } from './primitives';
import { navigate } from './router';

/**
 * A tip from the owl, in the page's own flow (never floating over anything). It is labelled "App tip" because it comes from fixed rules
 * in the app, not from an AI model. "Got it" hides it for good; "Hide the owl" switches the owl off everywhere.
 */
export const OwlTipCard = ({ place }: { place: TipPlace }) => {
  const { data, today, dispatch, stamp, openSheet } = useApp();
  const tip = nextTip(data, place, today);
  if (!tip) return null;
  const dismiss = () => dispatch({ type: 'DISMISS_INSIGHT', id: dismissKey(tip.id), stamp: stamp() });
  const act = () => {
    const a = tip.action;
    if (!a) return;
    dismiss();
    if (a.route) navigate(a.route);
    else if (a.sheet === 'shopGen') openSheet({ kind: 'shopGen' });
    else if (a.sheet === 'interestForm') openSheet({ kind: 'interestForm' });
    else if (a.sheet === 'workoutForm') openSheet({ kind: 'workoutForm' });
  };
  return (
    <aside className="card owl-card" aria-label={`App tip: ${tip.title}`} data-testid="owl-tip">
      <Owl size={48} />
      <div className="stack" style={{ gap: 6, minWidth: 0 }}>
        <p className="xs muted" style={{ margin: 0 }}>App tip · not from the AI</p>
        <b>{tip.title}</b>
        <p className="small" style={{ margin: 0 }}>{tip.body}</p>
        <div className="row wrap" style={{ gap: 8 }}>
          {tip.action && <Button size="sm" variant="soft" onClick={act}>{tip.action.label}</Button>}
          <Button size="sm" variant="ghost" onClick={dismiss}>Got it</Button>
          <Button size="sm" variant="ghost" onClick={() => dispatch({ type: 'APPEARANCE_SET', patch: { owl: false } })}>Hide the owl</Button>
        </div>
      </div>
    </aside>
  );
};
