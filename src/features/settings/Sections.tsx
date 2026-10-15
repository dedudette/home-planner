import { ACTIVITY_LABEL, activityModulesOn, AVAILABLE_MODULES, CARD_LABEL, MODULES } from '../../domain/modules/registry';
import type { ModuleId, TodayCard } from '../../domain/modules/types';
import { useApp } from '../../state/store';
import { I } from '../../ui/icons';
import { Button, Chip } from '../../ui/primitives';
import { navigate } from '../../ui/router';

const TIME_CHOICES = [15, 20, 30, 45, 60, 90];

/**
 * Which parts of the app a person uses. Home cleaning is the existing goal `home`; the others are sections. Switching one off hides it
 * and everything planned in it from Today, and deletes nothing: switch it back on and it is all there.
 */
export const SectionsSettings = () => {
  const { data, dispatch, stamp, toast } = useApp();
  const focus = data.preferences.focus;
  const homeOn = focus.includes('home');
  const on = data.modules.enabled;
  const count = (homeOn ? 1 : 0) + AVAILABLE_MODULES.filter((m) => on[m]).length;
  const minutes = data.preferences.sessionMinutes ?? 20;
  const caps = data.modules.caps;
  const activityOn = activityModulesOn(data.modules);

  const setModule = (id: ModuleId, next: boolean) => {
    if (!next && count <= 1) { toast('Keep at least one section on. You can switch another on first.'); return; }
    dispatch({ type: 'MODULE_SET', id, on: next });
  };
  const setHome = (next: boolean) => {
    if (!next && count <= 1) { toast('Keep at least one section on. You can switch another on first.'); return; }
    dispatch({ type: 'SET_PREFS', patch: { focus: next ? [...new Set([...focus, 'home' as const])] : focus.filter((f) => f !== 'home') }, stamp: stamp() });
    if (next && !data.home.type) navigate('home?new=1');
  };

  const cards = data.modules.order.filter((c) => c === 'plan' || (c === 'meals' && on.meals) || (c === 'water' && on.water) || (c === 'checkin' && on.wellbeing));
  const move = (c: TodayCard, dir: -1 | 1) => {
    const i = cards.indexOf(c), j = i + dir;
    if (j < 0 || j >= cards.length) return;
    const next = [...cards];
    [next[i], next[j]] = [next[j], next[i]];
    // The cards that do not exist for this person keep their place at the end, so turning a section on later puts it where it was.
    const rest = data.modules.order.filter((x) => !next.includes(x));
    dispatch({ type: 'MODULE_CARDS', order: [...next, ...rest], hidden: data.modules.hidden });
  };
  const toggleCard = (c: TodayCard) => {
    const hidden = data.modules.hidden.includes(c) ? data.modules.hidden.filter((x) => x !== c) : [...data.modules.hidden, c];
    dispatch({ type: 'MODULE_CARDS', order: data.modules.order, hidden });
  };

  const rows: { id: 'home' | ModuleId; label: string; blurb: string; on: boolean }[] = [
    { id: 'home', label: 'Home & cleaning', blurb: 'A room-by-room cleaning plan for your home', on: homeOn },
    ...AVAILABLE_MODULES.map((m) => ({ id: m, label: MODULES[m].label, blurb: MODULES[m].blurb, on: on[m] })),
  ];

  return (
    <section className="card stack" aria-labelledby="s-sections" id="sections">
      <h2 id="s-sections" className="h3">What you use CleanFlow for</h2>
      <p className="small muted">Switch on only what you want. Switching a section off hides it and keeps everything in it.</p>
      <div className="stack" role="group" aria-label="Sections">
        {rows.map((r) => (
          <label key={r.id} className="row between wrap switch-row" style={{ gap: 12 }}>
            <span><b>{r.label}</b><br /><span className="small muted">{r.blurb}</span></span>
            <input type="checkbox" role="switch" aria-label={r.label} checked={r.on} onChange={(e) => (r.id === 'home' ? setHome(e.target.checked) : setModule(r.id, e.target.checked))} style={{ width: 24, height: 24, accentColor: 'var(--primary)' }} />
          </label>
        ))}
      </div>

      <hr className="sep" />
      <div className="stack" aria-labelledby="s-time">
        <h3 id="s-time">Your daily time</h3>
        <p className="small">This one number covers everything you plan for a day: {homeOn ? 'cleaning, ' : ''}habits, workouts, hobbies, learning and meal prep. It does <b>not</b> count eating, sleeping or drinking water, and logging things never uses it up.</p>
        <div className="chips" role="radiogroup" aria-label="Daily minutes">
          {TIME_CHOICES.map((m) => <Chip key={m} role="radio" on={minutes === m} onClick={() => dispatch({ type: 'SET_PREFS', patch: { sessionMinutes: m }, stamp: stamp() })}>{m} min</Chip>)}
        </div>
        <p className="small muted">If what you plan is longer than this, Today says by how much. It never quietly removes something you planned.</p>
      </div>

      {activityOn.length > 0 && (
        <div className="stack" aria-labelledby="s-caps">
          <h3 id="s-caps">Daily allowance per section (optional)</h3>
          <p className="small muted">Keep one kind of activity from taking over a day. Leave it empty for no limit. It holds back what CleanFlow suggests; what you plan yourself stays and is flagged.</p>
          {activityOn.map((m) => (
            <div className="row between wrap" key={m} style={{ gap: 8 }}>
              <label htmlFor={`cap-${m}`}>{ACTIVITY_LABEL[m]}</label>
              <span className="row" style={{ gap: 8 }}>
                <input id={`cap-${m}`} className="input" type="number" min={5} max={600} inputMode="numeric" placeholder="No limit" style={{ width: 120 }}
                  value={caps[m] ?? ''} onChange={(e) => dispatch({ type: 'MODULE_CAP', module: m, minutes: e.target.value === '' ? null : Number(e.target.value) })} />
                <span className="small muted">min</span>
              </span>
            </div>
          ))}
        </div>
      )}

      {cards.length > 1 && (
        <div className="stack" aria-labelledby="s-cards">
          <h3 id="s-cards">Today's layout</h3>
          <p className="small muted">Put the parts of Today in the order you like, and hide the ones you do not want.</p>
          <ol className="stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {cards.map((c, i) => (
              <li key={c} className="row between wrap" style={{ gap: 8 }}>
                <span className="strong">{CARD_LABEL[c]}{data.modules.hidden.includes(c) ? <span className="small muted"> · hidden</span> : null}</span>
                <span className="row" style={{ gap: 6 }}>
                  <Button size="sm" variant="secondary" icon={I.up} aria-label={`Move ${CARD_LABEL[c]} up`} disabled={i === 0} onClick={() => move(c, -1)} />
                  <Button size="sm" variant="secondary" icon={I.down} aria-label={`Move ${CARD_LABEL[c]} down`} disabled={i === cards.length - 1} onClick={() => move(c, 1)} />
                  {c !== 'plan' && <Button size="sm" variant="soft" onClick={() => toggleCard(c)}>{data.modules.hidden.includes(c) ? 'Show' : 'Hide'}</Button>}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
};
