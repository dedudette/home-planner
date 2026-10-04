import { useMemo } from 'react';
import { isResetDone, resetSequence } from '../../domain/modes';
import { formatMinutes } from '../../domain/dates';
import { useApp } from '../../state/store';
import { I } from '../../ui/icons';
import { Button, ProgressBar, Sheet } from '../../ui/primitives';
import { TaskCard } from '../tasks/TaskCard';

export const EmergencySheet = () => {
  const { data, plan, closeSheet, dispatch, stamp, complete, toast } = useApp();
  const stages = useMemo(() => resetSequence(data), [data.home, data.preferences]); // eslint-disable-line react-hooks/exhaustive-deps
  const run = data.resetRun && !data.resetRun.finishedAt ? data.resetRun : null;
  const all = stages.flatMap((s) => s.tasks);
  const done = all.filter((t) => isResetDone(data, t.id));
  const totalMin = all.reduce((s, t) => s + t.minutes, 0);
  const remaining = all.filter((t) => !isResetDone(data, t.id)).reduce((s, t) => s + t.minutes, 0);
  const finished = all.length > 0 && done.length === all.length;
  const currentIdx = stages.findIndex((s) => s.tasks.some((t) => !isResetDone(data, t.id)));

  if (!run && !finished) {
    return (
      <Sheet title="My home is a mess" onClose={closeSheet} full label="Home reset"
        footer={<><Button variant="secondary" onClick={closeSheet}>Not now</Button><Button size="lg" icon={I.play} onClick={() => dispatch({ type: 'RESET_RUN_START', stamp: stamp() })}>Start the reset</Button></>}>
        <div className="card tint stack">
          <div className="row"><I.heart size={22} aria-hidden style={{ color: 'var(--primary)' }} /><h3>Take a breath. This is fixable.</h3></div>
          <p>We'll go in the order that changes the room the most for the least effort. Stop whenever you want. Anything you finish counts and is saved.</p>
        </div>
        <div className="stack">
          <h3>Your reset, in order</h3>
          <p className="small muted">Built from your {plan.rooms.filter((r) => !r.virtual).length} rooms · about {formatMinutes(totalMin)} in total{plan.sessionMinutes ? `, in small steps of ${plan.chunkLimit > 15 ? 15 : plan.chunkLimit} minutes or less` : ''}.</p>
          {stages.map((s, i) => (
            <div className="step" key={s.phase}>
              <span className="n">{i + 1}</span>
              <span className="grow"><b>{s.label}</b><br /><span className="small muted">{s.tasks.length} step{s.tasks.length === 1 ? '' : 's'} · {formatMinutes(s.minutes)} · {s.why}</span></span>
            </div>
          ))}
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet title="Home reset" onClose={closeSheet} full label="Home reset in progress"
      footer={finished
        ? <><Button variant="secondary" onClick={() => { dispatch({ type: 'RESET_RUN_FINISH', stamp: stamp() }); dispatch({ type: 'RESET_RUN_START', stamp: stamp() }); }}>Start a fresh reset</Button><Button onClick={() => { dispatch({ type: 'RESET_RUN_FINISH', stamp: stamp() }); closeSheet(); toast('Reset complete. That was real work.'); }}>Finish</Button></>
        : <><Button variant="secondary" block onClick={() => { closeSheet(); toast('Progress saved. Come back whenever you like.'); }}>I'm done for now</Button></>}>
      {finished ? (
        <div className="five-card celebrate" role="status">
          <div className="big-ic" style={{ background: 'var(--sun)', color: 'var(--sun-ink)' }}><I.sparkles size={38} aria-hidden /></div>
          <h1 className="five-name">Reset complete.</h1>
          <p className="muted">Your home has had a proper reset. From here, your regular plan will be much lighter.</p>
        </div>
      ) : (
        <div className="card tint stack">
          <div className="row between"><span className="strong">{done.length} of {all.length} steps</span><span className="small muted">{formatMinutes(remaining)} left</span></div>
          <ProgressBar value={all.length ? done.length / all.length : 0} label="Reset progress" />
          <p className="small muted">Stopping is fine. Whatever you finish stays finished.</p>
        </div>
      )}
      {stages.map((s, i) => {
        const left = s.tasks.filter((t) => !isResetDone(data, t.id));
        const complete_ = left.length === 0;
        const open = i === currentIdx || (!plan.microSteps && !complete_);
        return (
          <section key={s.phase} className={`stage ${complete_ ? 'complete' : ''}`} aria-label={`${s.label} stage`}>
            <div className="stage-head">
              <span className="n">{complete_ ? <I.check size={18} aria-hidden /> : i + 1}</span>
              <div className="grow"><h3>{s.label}</h3><p className="small muted">{complete_ ? 'All done' : `${left.length} left · ${formatMinutes(left.reduce((a, t) => a + t.minutes, 0))}`}{!complete_ && ` · ${s.why}`}</p></div>
            </div>
            {open && !complete_ && (
              <div className="stage-body">
                {s.tasks.map((t) => (
                  <TaskCard key={t.id} task={t} compact done={isResetDone(data, t.id)} via="reset" hideMenu
                    onComplete={() => complete(t, { via: 'reset', quiet: true })} />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </Sheet>
  );
};
