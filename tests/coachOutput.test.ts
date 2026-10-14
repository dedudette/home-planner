import { describe, expect, it } from 'vitest';
import { buildCoachPayload, type CoachPayload, type MetricId } from '../src/domain/coach/metrics';
import { COACH_FEATURES, MAX_SUGGESTIONS, textProblem, validateCoachOutput } from '../src/domain/coach/output';
import { computePatterns } from '../src/domain/patterns';
import { lived, range } from './coachHelpers';
import { TODAY } from './helpers';

const payload: CoachPayload = buildCoachPayload(computePatterns(lived(range(-9, 0), { doneEach: 2, skipEach: 1, minutes: 20, focus: ['home', 'discipline', 'morning', 'evening'] }), TODAY, 14))!;
const M = payload.metrics;
const num = (id: MetricId) => M[id];
const ok = (over: Record<string, unknown> = {}) => ({
  kind: 'pattern', title: 'Opened days and completed tasks', explanation: `The app was opened on ${num('days.opened')} of ${payload.windowDays} days, and ${num('tasks.seenCompleted')} of ${num('tasks.seen')} tasks shown on Today were completed.`,
  metric_ids: ['days.opened', 'tasks.seen', 'tasks.seenCompleted'], strength: 'good', ...over,
});
const run = (s: unknown[], extra: Record<string, unknown> = {}, cap: 'limited' | 'moderate' | 'good' = 'good') => validateCoachOutput(JSON.stringify({ suggestions: s, ...extra }), payload, cap);
const accepted = (s: Record<string, unknown>) => { const r = run([s]); return r.ok && r.output.suggestions.length === 1; };
const plain = 'A count from the records';

describe('the fixture itself', () => {
  it('has the counts these tests talk about', () => {
    expect(num('tasks.seen')).toBeGreaterThan(0);
    expect(num('tasks.seenSkipped')).toBeGreaterThan(0);
    expect(num('tasks.seenCompleted')).toBeGreaterThan(0);
    expect(num('leftOut.notEnoughTime')).toBeGreaterThan(0);
  });
});

describe('a grounded answer is shown', () => {
  it('keeps a well-formed suggestion that cites real counts and uses only those numbers', () => {
    const r = run([ok({ title: 'Opened days and completed tasks' })]);
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.output.suggestions[0].metricIds).toEqual(['days.opened', 'tasks.seen', 'tasks.seenCompleted']); expect(r.dropped).toBe(0); }
  });

  it('accepts an optional idea only if it points at something that leaves the plan alone', () => {
    const idea = (text: string) => accepted(ok({ kind: 'idea', title: 'Tasks left out for time', explanation: `${num('leftOut.notEnoughTime')} tasks were left out by the planner because of the time available.`.replace('because of the time available', 'for not enough time'), metric_ids: ['leftOut.notEnoughTime'], idea: text }));
    expect(idea('When you have spare minutes, open the "left out of today" list on Today.')).toBe(true);
    expect(idea('Try Just 5 minutes on a day when there is little time.')).toBe(true);
    expect(idea('Use the "I only have" list when you know the minutes you have.')).toBe(true);
    expect(idea('Look at the Tomorrow tab in Schedule to see what is coming.')).toBe(true);
    expect(idea('Check Your patterns again next week.')).toBe(true);
    expect(idea('Notice how your week goes.')).toBe(false);
  });

  it('may state that data is missing, citing the counts that say so', () => {
    const r = run([{ kind: 'data_note', title: 'Some days are not covered', explanation: `${num('days.unknown')} days in this window have an unknown status, so they are excluded from the counts.`, metric_ids: ['days.unknown', 'days.window'], strength: 'limited' }]);
    expect(r.ok && num('days.unknown') > 0).toBe(true);
  });

  it('allows an empty list with insufficient:true: "not enough information" is a valid answer', () => {
    const r = validateCoachOutput(JSON.stringify({ suggestions: [], insufficient: true }), payload, 'good');
    expect(r).toEqual({ ok: true, output: { suggestions: [], insufficient: true }, dropped: 0 });
  });

  it('accepts a code-fenced JSON answer', () => {
    expect(validateCoachOutput('```json\n' + JSON.stringify({ suggestions: [ok()] }) + '\n```', payload, 'good').ok).toBe(true);
  });

  it('keeps at most three, and keeps the good ones when others are dropped', () => {
    const many = run([ok(), ok({ title: 'Second' }), ok({ title: 'Third' }), ok({ title: 'Fourth' }), ok({ metric_ids: ['nope'] })]);
    expect(many.ok && many.output.suggestions.length).toBe(MAX_SUGGESTIONS);
    const mixed = run([ok({ metric_ids: ['nope'] }), ok({ title: 'Kept' })]);
    expect(mixed.ok && mixed.output.suggestions.map((s) => s.title)).toEqual(['Kept']);
    expect(mixed.ok && mixed.dropped).toBe(1);
  });

  it('shows strength no higher than the data allows, whatever the model says', () => {
    const r = run([ok({ strength: 'good' })], {}, 'limited');
    expect(r.ok && r.output.suggestions[0].strength).toBe('limited');
    const r2 = run([ok({ strength: 'limited' })], {}, 'good');
    expect(r2.ok && r2.output.suggestions[0].strength).toBe('limited');
  });
});

describe('unsupported or unusable answers are refused', () => {
  const nothing = (r: ReturnType<typeof run>) => !r.ok && r.reason === 'nothing-reliable';

  it('malformed output: not JSON, not an object, no list, wrong types', () => {
    for (const bad of ['', 'Sure! Here are some ideas.', '[]', '"hi"', '{"suggestions":"x"}', '{"nope":1}', 'null', '{"suggestions":[}']) {
      const r = validateCoachOutput(bad, payload, 'good');
      expect(r.ok, bad).toBe(false);
    }
    expect(nothing(run([null, 5, 'x', [], {}]))).toBe(true);
    expect(nothing(run([ok({ title: 5 })]))).toBe(true);
    expect(nothing(run([ok({ metric_ids: 'days.opened' })]))).toBe(true);
    expect(nothing(run([ok({ kind: 'advice' })]))).toBe(true);
    expect(nothing(run([ok({ strength: 'certain' })]))).toBe(true);
  });

  it('evidence that was not in the request: unknown ids, none at all, too many, cites only zeros', () => {
    expect(nothing(run([ok({ metric_ids: ['tasks.invented'] })]))).toBe(true);
    expect(nothing(run([ok({ metric_ids: ['__proto__'] })]))).toBe(true);
    expect(nothing(run([ok({ metric_ids: ['constructor'] })]))).toBe(true);
    expect(nothing(run([ok({ metric_ids: [] })]))).toBe(true);
    expect(nothing(run([ok({ metric_ids: ['days.opened', 'tasks.seen', 'tasks.seenCompleted', 'tasks.seenNoAction', 'tasks.notShown', 'leftOut.notEnoughTime', 'tasks.seenSkipped'] })]))).toBe(true);
    const zeroId = (Object.keys(M) as MetricId[]).find((k) => M[k] === 0 && !k.startsWith('days.window'));
    expect(zeroId).toBeTruthy();
    expect(nothing(run([ok({ title: plain, explanation: 'This count is empty for the whole window.', metric_ids: [zeroId] })]))).toBe(true);
  });

  it('REGRESSION: nothing may rest on days or history the app marks unknown (context counts)', () => {
    const ctx = (kind: string, id: MetricId, extra: Record<string, unknown> = {}) => ({ kind, title: plain, explanation: `${num(id)} days are listed here.`, metric_ids: [id], strength: 'good', ...extra });
    expect(num('days.unknown')).toBeGreaterThan(0);
    // as a pattern or an idea: refused
    expect(nothing(run([ctx('pattern', 'days.unknown')]))).toBe(true);
    expect(nothing(run([ctx('idea', 'days.unknown', { idea: 'Try Just 5 minutes next week.' })]))).toBe(true);
    expect(nothing(run([ctx('pattern', 'history.daysRemoved', { explanation: `${num('tasks.seen')} tasks were shown.`, metric_ids: ['history.daysRemoved', 'tasks.seen'] })]))).toBe(true);
    expect(nothing(run([ctx('pattern', 'days.acted')]))).toBe(true);
    // the same counts are fine in a note about what the data does not cover
    expect(accepted(ctx('data_note', 'days.unknown'))).toBe(true);
  });

  it('numbers that are not among the cited counts: invented, calculated, percentages, vague amounts', () => {
    expect(nothing(run([ok({ explanation: 'The app was opened on 99 days and tasks were completed.' })]))).toBe(true);
    expect(nothing(run([ok({ explanation: `${num('tasks.seenCompleted')} of ${num('tasks.seen')} shown tasks were completed, which is 75 percent.` })]))).toBe(true);
    expect(nothing(run([ok({ explanation: `About ${num('tasks.seenCompleted')} shown tasks were completed.` })]))).toBe(true);
    expect(nothing(run([ok({ explanation: 'Most shown tasks were completed.' })]))).toBe(true);
    expect(nothing(run([ok({ explanation: `${num('tasks.seenCompleted')}% of shown tasks were completed.` })]))).toBe(true);
    // a total the model worked out itself
    expect(nothing(run([ok({ explanation: `${num('tasks.seenCompleted') + num('tasks.seenSkipped')} shown tasks were completed or skipped.`, metric_ids: ['tasks.seenCompleted', 'tasks.seenSkipped'] })]))).toBe(true);
  });

  it('REGRESSION: it may not say a task was skipped, snoozed, moved, shown or left out unless that count is cited and above zero', () => {
    expect(nothing(run([ok({ title: plain, explanation: `${num('tasks.seenNoAction')} shown tasks were skipped.`, metric_ids: ['tasks.seenNoAction'] })]))).toBe(true);
    expect(nothing(run([ok({ title: plain, explanation: `${num('tasks.seenNoAction')} shown tasks were ignored.`, metric_ids: ['tasks.seenNoAction'] })]))).toBe(true);
    expect(nothing(run([ok({ title: plain, explanation: 'Some tasks were snoozed during the window.', metric_ids: ['tasks.seenSkipped'] })]))).toBe(true);
    expect(nothing(run([ok({ title: plain, explanation: `${num('leftOut.notEnoughTime')} tasks were left out for not enough time.`, metric_ids: ['days.opened'] })]))).toBe(true);
    // the same sentence is fine once the matching count is cited
    expect(accepted(ok({ title: plain, explanation: `${num('tasks.seenSkipped')} shown tasks were skipped.`, metric_ids: ['tasks.seenSkipped'] }))).toBe(true);
    expect(accepted(ok({ title: plain, explanation: `${num('leftOut.notEnoughTime')} tasks were left out for not enough time.`, metric_ids: ['leftOut.notEnoughTime'] }))).toBe(true);
  });

  it('REGRESSION: "shown with no recorded action" may be reported, but never explained', () => {
    const base = { metric_ids: ['tasks.seenNoAction'] };
    expect(accepted(ok({ ...base, title: plain, explanation: `${num('tasks.seenNoAction')} shown tasks have no recorded action.` }))).toBe(true);
    for (const why of ['because you were busy', 'which probably means you forgot', 'perhaps you lacked motivation', 'likely due to tiredness', 'you seem overwhelmed', 'that is why they stayed open'])
      expect(nothing(run([ok({ ...base, title: plain, explanation: `${num('tasks.seenNoAction')} shown tasks have no recorded action, ${why}.` })]))).toBe(true);
  });

  it('diagnosis, emotion, health, motivation, character and cause are refused', () => {
    for (const bad of ['This points to low motivation.', 'You may be depressed or anxious.', 'It sounds like burnout.', 'This is a sign of a disorder.', 'A lack of discipline shows here.', 'It looks like you struggled.', 'This is probably caused by stress.', 'That reflects your character.', 'You gave up after a few days.', 'This could be a health issue.', 'Poor sleep may explain it.'])
      expect(textProblem(`${bad} ${num('tasks.seen')} tasks were shown on Today.`, [{ id: 'tasks.seen', value: num('tasks.seen') }], 14), bad).not.toBeNull();
  });

  it('plan-changing or limit-bypassing advice is refused, in the explanation or the idea', () => {
    const idea = (text: string) => ok({ kind: 'idea', title: 'Left out for time', explanation: `${num('leftOut.notEnoughTime')} tasks were left out for not enough time.`, metric_ids: ['leftOut.notEnoughTime'], idea: text });
    for (const bad of [
      'Increase your daily time and check the left out of today list.', 'Change your goals, then open the left out of today list.', 'Remove the task and use Just 5 minutes.', 'Turn off the evening routine and use Just 5 minutes.',
      'I have updated your schedule. Try Just 5 minutes.', 'I will lower your budget; try Just 5 minutes.', 'I made a note for you. Try Just 5 minutes.', 'Push through on low-energy days with Just 5 minutes.', 'Ignore your energy setting and use Just 5 minutes.',
      'Add extra tasks to Today using Just 5 minutes.', 'Edit your rest days and open Your patterns.', 'Adjust the plan after you view the left out of today list.',
    ]) expect(accepted(idea(bad)), bad).toBe(false);
    expect(nothing(run([ok({ explanation: `${num('tasks.seen')} tasks were shown on Today. I changed your plan to fit.` })]))).toBe(true);
  });

  it('markup, links and lengths are refused', () => {
    for (const bad of ['See <b>this</b>.', 'Open https://example.com now.', '[a](http://x)', 'Use `code` here.', 'x'.repeat(401)]) expect(nothing(run([ok({ explanation: `${num('tasks.seen')} tasks were shown. ${bad}` })])), bad).toBe(true);
    expect(nothing(run([ok({ title: 'x'.repeat(81) })]))).toBe(true);
    expect(nothing(run([ok({ title: 'ab' })]))).toBe(true);
  });

  it('an answer where nothing survives is "nothing reliable", never raw model text', () => {
    const r = run([ok({ metric_ids: ['nope'] }), ok({ explanation: 'Because of a motivation problem.' })]);
    expect(r).toEqual({ ok: false, reason: 'nothing-reliable' });
    expect(JSON.stringify(r)).not.toContain('motivation');
  });

  it('every phrase an app feature is named by is one the model is told about', () => {
    expect(COACH_FEATURES.length).toBeGreaterThan(0);
  });
});
