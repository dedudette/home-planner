import { ROUTINES } from '../../domain/wellbeing/content';
import { useApp } from '../../state/store';
import { I } from '../../ui/icons';
import { Button, PageHead, Segmented } from '../../ui/primitives';
import { OwlTipCard } from '../../ui/OwlTip';
import { navigate, useRoute } from '../../ui/router';
import { PlannedActivities } from '../sections/SectionPage';
import { BreathingTab } from './Breathing';
import { CheckinTab } from './Checkin';
import { JournalTab } from './Journal';
import { WaterTab } from './WaterPanel';

type Tab = 'checkin' | 'water' | 'breathe' | 'journal' | 'routines';

const RoutinesTab = () => {
  const { openSheet } = useApp();
  return (
    <div className="stack">
      <section className="stack" aria-labelledby="rt-h">
        <h2 id="rt-h" className="h3">Routines to start from</h2>
        <p className="small muted">Ideas for a calm start or end to the day. Add one to your plan, change it to suit you, or ignore them all. They are routines, not treatments.</p>
        {ROUTINES.map((r) => (
          <article className="card stack" key={r.id} aria-label={r.name} style={{ padding: 14 }}>
            <div className="row between" style={{ alignItems: 'flex-start', gap: 8 }}><div><b>{r.name}</b> <span className="small muted">· about {r.minutes} min</span><br /><span className="small muted">{r.blurb}</span></div>
              <Button size="sm" icon={I.cal} onClick={() => openSheet({ kind: 'activityForm', defaults: { module: 'wellbeing', name: r.name, minutes: r.minutes, ref: { kind: 'routine', id: r.id }, schedule: { kind: 'weekly', weekdays: [0, 1, 2, 3, 4, 5, 6] } } })} aria-label={`Add ${r.name} to my plan`}>Add</Button></div>
            <ol className="small" style={{ margin: 0, paddingLeft: 20 }}>{r.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
          </article>
        ))}
      </section>
      <PlannedActivities module="wellbeing" />
    </div>
  );
};

/** Wellbeing and water: a check-in, your water, a breathing exercise, a private journal and routines. Each part is optional. */
export const Wellbeing = () => {
  const { data } = useApp();
  const route = useRoute();
  const on = data.modules.enabled;
  const tabs: { value: Tab; label: string }[] = [
    ...(on.wellbeing ? [{ value: 'checkin' as const, label: 'Check-in' }] : []),
    ...(on.water ? [{ value: 'water' as const, label: 'Water' }] : []),
    ...(on.wellbeing ? [{ value: 'breathe' as const, label: 'Breathe' }, { value: 'journal' as const, label: 'Journal' }, { value: 'routines' as const, label: 'Routines' }] : []),
  ];
  const raw = route.query.get('tab');
  const tab = tabs.find((t) => t.value === raw)?.value ?? tabs[0]?.value ?? 'checkin';
  return (
    <div className="page">
      <PageHead title={on.wellbeing ? 'Wellbeing' : 'Water'} sub={on.wellbeing ? 'Check-ins, water, breathing, journaling and routines. Optional, all of it, and private.' : 'Log what you drink, if you want to.'} />
      {tabs.length > 1 && <Segmented<Tab> label="Wellbeing sections" value={tab} onChange={(t) => navigate(`wellbeing?tab=${t}`)} options={tabs} />}
      <OwlTipCard place="wellbeing" />
      {tab === 'checkin' && <CheckinTab />}
      {tab === 'water' && <WaterTab />}
      {tab === 'breathe' && <BreathingTab />}
      {tab === 'journal' && <JournalTab />}
      {tab === 'routines' && <RoutinesTab />}
    </div>
  );
};
