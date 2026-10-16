import { maxLifeTasks } from '../../domain/life';
import { FOCUS_OPTIONS } from '../../domain/options';
import type { GoalCoverage as Coverage } from '../../domain/types';
import { useApp } from '../../state/store';
import { I } from '../../ui/icons';
import { Button } from '../../ui/primitives';

const LABEL = new Map(FOCUS_OPTIONS.map((f) => [f.value, f.label]));
const SHORT: Record<string, string> = {
  active: 'Being active', discipline: 'Discipline', morning: 'Morning routine', evening: 'Evening routine', focus: 'Focus', phone: 'Less phone',
  selfcare: 'Self-care', study: 'Study', organize: 'Organizing', healthy: 'Healthy routines', consistent: 'Consistency',
};
export const goalName = (g: string): string => SHORT[g] ?? LABEL.get(g as never) ?? g;

/**
 * Plain-language reason a goal is not in the plan: the actual cause, never a generic excuse. Never blames the user, and always says
 * what would change it.
 */
export const deferredReason = (c: Coverage, budget: number): string => {
  switch (c.reason) {
    case 'budget': {
      const need = c.needMinutes ?? 0;
      return need <= budget
        ? `Your other goals used the ${budget} min of habit time first. It needs only ${need} min once there is room.`
        : `It needs at least ${need} min, and your day only has room for about ${budget} min of habits.`;
    }
    case 'cap': return `There was room in the minutes, but to stay manageable your plan holds at most ${maxLifeTasks(budget)} habits a day, only a few of one kind, and no near-duplicates.`;
    case 'safety': return "Every task for it is too demanding for your current fitness level or energy, so we left it out to keep you safe. It will open up as you build up.";
    case 'context': return "Its tasks need something you haven't set up yet, such as equipment or an outdoor space. You can add it under My Home.";
    default: return 'Nothing suits your current level yet.';
  }
};

/**
 * Which goals got a real task and which did not. Shown wherever the plan is shown, because quietly dropping a goal the user
 * chose is the one thing a planner must never do.
 */
export const GoalCoverageCard = ({ compact = false }: { compact?: boolean }) => {
  const { plan, openSheet, data } = useApp();
  const all = plan.goalCoverage;
  const deferred = all.filter((c) => c.status === 'deferred');
  if (!all.length || (compact && !deferred.length)) return null;
  const budget = plan.lifeBudget;
  const homeOn = data.preferences.focus.includes('home');

  return (
    <section className={`card ${deferred.length ? 'sun' : 'tint'} stack`} aria-labelledby={compact ? 'gc-compact' : 'gc-full'} data-testid="goal-coverage">
      <div className="row">
        {deferred.length ? <I.info size={20} aria-hidden /> : <I.checkCircle size={20} aria-hidden />}
        <h2 id={compact ? 'gc-compact' : 'gc-full'} className="h3">
          {deferred.length ? `${all.length - deferred.length} of ${all.length} goals fit your plan` : `All ${all.length} goals have a task in your plan`}
        </h2>
      </div>
      {deferred.length > 0 && <p className="small">These goals are <b>not</b> in your plan right now. You didn't do anything wrong, there just isn't room:</p>}
      <ul className="gc-list">
        {(compact ? deferred : all).map((c) => (
          <li key={c.goal}>
            <span className="strong">{c.status === 'covered' ? '✓ ' : '• '}{goalName(c.goal)}</span>
            {c.status === 'deferred' && <span className="small">{` · deferred. ${deferredReason(c, budget)}`}</span>}
            {!compact && c.cover.length > 0 && (
              <ul className="gc-tasks" aria-label={`Tasks for ${goalName(c.goal)}`}>
                {c.cover.map((x) => (
                  <li key={x.taskId}>
                    <span><b>{x.name}</b> · {x.minutes} min · <span className={x.role === 'primary' ? 'gc-role primary' : 'gc-role'}>{x.role === 'primary' ? 'Primary' : 'Supporting'}</span></span>
                    <span className="xs block gc-why">{x.why}</span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
      {deferred.length > 0 && (
        <div className="row wrap" style={{ gap: 8 }}>
          <Button size="sm" variant="soft" onClick={() => openSheet({ kind: 'editHome', section: 'style' })}>{homeOn ? 'Change my daily time' : 'Give it more time'}</Button>
          <Button size="sm" variant="secondary" onClick={() => openSheet({ kind: 'editHome', section: 'focus' })}>Change my goals</Button>
        </div>
      )}
    </section>
  );
};
