import { useMemo } from 'react';
import { computeInsights, type Insight, type InsightAction } from '../../domain/learning';
import { addDays, weekday } from '../../domain/dates';
import { useApp } from '../../state/store';
import { I } from '../../ui/icons';
import { Button } from '../../ui/primitives';

export const useInsights = (): Insight[] => {
  const { view } = useApp();
  return useMemo(() => computeInsights(view), [view]);
};

export const InsightCard = ({ insight }: { insight: Insight }) => {
  const { dispatch, stamp, view, toast, today } = useApp();
  const task = insight.taskId ? view.byId.get(insight.taskId) : undefined;
  const run = (a: InsightAction) => {
    const st = stamp();
    switch (a.id) {
      case 'shorter':
        dispatch({ type: 'SET_SESSION_CAP', minutes: a.minutes ?? 20, stamp: st });
        toast(`Done. Big tasks now come in pieces of ${a.minutes ?? 20} minutes or less.`);
        break;
      case 'smaller':
        if (task) { dispatch({ type: 'TASK_OVERRIDE', id: task.id, override: { smaller: true } }); toast('Made smaller. Half the time, tiny steps.'); }
        break;
      case 'less-often':
        if (task && a.frequency) { dispatch({ type: 'TASK_OVERRIDE', id: task.id, override: { frequency: a.frequency } }); toast('Done. It will come around less often.'); }
        break;
      case 'move':
        if (task) {
          // shift the series to the quietest other weekday
          const cur = weekday(view.states[task.id]?.anchor ?? task.startDate ?? today);
          const target = view.plan.activeDays.find((d) => d !== cur) ?? cur;
          let d = addDays(today, 1);
          for (let i = 0; i < 7 && weekday(d) !== target; i++) d = addDays(d, 1);
          dispatch({ type: 'TASK_PATCH', id: task.id, patch: { anchor: d, due: d, skipStreak: 0 } });
          toast('Moved to a different day.');
        }
        break;
      case 'remove':
        if (task) { dispatch({ type: 'TASK_PATCH', id: task.id, patch: { hidden: true, skipStreak: 0 } }); toast('Removed. You can restore it in Settings.'); }
        break;
      case 'level-up':
      case 'level-down':
        if (a.level) { dispatch({ type: 'SET_PREFS', patch: { lifeLevel: a.level }, stamp: st }); toast(a.id === 'level-up' ? 'Done. Your routines are a little fuller now.' : 'Done. Back to gentler, shorter versions.'); }
        break;
      default: break;
    }
    dispatch({ type: 'DISMISS_INSIGHT', id: insight.id, stamp: st });
  };
  return (
    <div className={`card ${insight.tone === 'celebrate' ? 'tint' : 'soft'} stack`} role="region" aria-label={insight.title}>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        {insight.tone === 'celebrate' ? <I.sparkles size={22} aria-hidden style={{ color: 'var(--primary)', flex: 'none', marginTop: 2 }} /> : <I.sprout size={22} aria-hidden style={{ color: 'var(--primary)', flex: 'none', marginTop: 2 }} />}
        <div><h3>{insight.title}</h3><p className="small" style={{ marginTop: 4 }}>{insight.body}</p></div>
      </div>
      <div className="row wrap" style={{ gap: 8 }}>
        {insight.actions.map((a) => (
          <Button key={a.id} size="sm" variant={a.id === 'dismiss' ? 'ghost' : a.id === 'remove' ? 'secondary' : 'soft'} onClick={() => run(a)}>{a.label}</Button>
        ))}
      </div>
    </div>
  );
};
