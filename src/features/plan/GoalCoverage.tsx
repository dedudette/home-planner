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

/** Plain-language reason a goal is not in the plan. Never blames the user, always says what would change it. */
export const deferredReason = (c: Coverage, budget: number): string => {
  if (c.reason === 'budget') {
    const need = c.needMinutes ?? 0;
    return need <= budget
      ? `Your other goals used the ${budget} min of habit time first. It needs only ${need} min once there is room.`
      : `It needs at least ${need} min, and your day only has room for about ${budget} min of habits.`;
  }
  if (c.reason === 'cap') return `Your plan is capped at ${maxLifeTasks(budget)} habits a day so it stays manageable.`;
  return 'Nothing suits your current level, equipment or energy yet.';
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
            <span className="small">{c.status === 'covered' ? ' · has a task' : ` · deferred. ${deferredReason(c, budget)}`}</span>
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
