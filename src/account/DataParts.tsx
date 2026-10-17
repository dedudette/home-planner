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

export const Side = ({ title, children, testId }: { title: string; children: ReactNode; testId?: string }) => (
  <div data-testid={testId}>
    <h4>{title}</h4>
    {children}
  </div>
);
