import type { ReactNode } from 'react';
import { describePlanCounts, type DataCounts } from '../storage/backupPlan';

/** The ordinary plan data in a list, or a plain sentence when there is none. */
export const PlanLines = ({ counts, empty = 'No plan data yet.' }: { counts: DataCounts | null; empty?: string }) => {
  const lines = counts ? describePlanCounts(counts) : [];
  return lines.length ? <ul className="data-list">{lines.map((l) => <li key={l}>{l}</li>)}</ul> : <p className="small muted">{empty}</p>;
};

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** The two private groups, each described on its own because each is its own choice. */
export const PrivateLines = ({ counts }: { counts: DataCounts }) => (
  <ul className="data-list">
    <li>Private journal: {counts.journalEntries === 0 && counts.checkinNotes === 0 ? 'none' : `${plural(counts.journalEntries, 'entry', 'entries')} and ${plural(counts.checkinNotes, 'check-in note')}`}</li>
    <li>Health readings: {counts.healthDays === 0 ? 'none' : plural(counts.healthDays, 'day')}</li>
  </ul>
);

/** One side of a comparison. Its title is a heading one level below the section it sits in (`level` 3 under a card’s h2, 4 under a panel’s h3). */
export const Side = ({ title, children, testId, level = 3 }: { title: string; children: ReactNode; testId?: string; level?: 3 | 4 }) => {
  const H = level === 3 ? 'h3' : 'h4';
  return (
    <div data-testid={testId}>
      <H>{title}</H>
      {children}
    </div>
  );
};
