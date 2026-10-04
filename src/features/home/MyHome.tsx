import { useMemo, type ReactNode } from 'react';
import { effectiveCounts, homeArea } from '../../domain/context';
import { formatMinutes } from '../../domain/dates';
import { occurrencesPerWeek } from '../../domain/engine';
import { BLOCKERS, CLEANLINESS, ENERGY, GOALS, HOME_TYPES, PROBLEM_AREAS, SIZE_BANDS, STYLES, sessionLabel } from '../../domain/options';
import { useApp, type EditSection } from '../../state/store';
import { I, ROOM_ICON, type IconType } from '../../ui/icons';
import { Button, PageHead, Sheet } from '../../ui/primitives';
import { navigate } from '../../ui/router';
import {
  StepEnergy, StepGoals, StepHomeType, StepPeople, StepRooms, StepSize, StepState, StepStyle,
} from '../onboarding/steps';

const SECTION_TITLE: Record<EditSection, string> = {
  type: 'Home type', size: 'Home size', rooms: 'Rooms', people: 'People', pets: 'Pets', state: 'Current state', style: 'Cleaning rhythm',
  energy: 'Energy', goals: 'Goals',
};

export const EditHomeSheet = ({ section }: { section: EditSection }) => {
  const { closeSheet } = useApp();
  const body = (() => {
    switch (section) {
      case 'type': return <StepHomeType />;
      case 'size': return <StepSize />;
      case 'rooms': return <StepRooms />;
      case 'people': case 'pets': return <StepPeople />;
      case 'state': return <StepState />;
      case 'style': return <StepStyle />;
      case 'energy': return <StepEnergy />;
      case 'goals': return <StepGoals />;
    }
  })();
  return (
    <Sheet title={SECTION_TITLE[section]} onClose={closeSheet} full footer={<Button block onClick={closeSheet}>Done. Update my plan</Button>}>
      <p className="small muted">Changes apply right away. Tasks you already have keep their scheduled days.</p>
      {body}
    </Sheet>
  );
};

const Card = ({ icon: Icon, title, section, children }: { icon: IconType; title: string; section: EditSection; children: ReactNode }) => {
  const { openSheet } = useApp();
  return (
    <section className="pcard" aria-label={title}>
      <div className="head"><span className="ic"><Icon size={18} aria-hidden /></span><span className="grow">{title}</span>
        <button className="btn ghost sm" onClick={() => openSheet({ kind: 'editHome', section })} aria-label={`Edit ${title}`}><I.pencil size={14} aria-hidden /> Edit</button>
      </div>
      {children}
    </section>
  );
};

export const MyHome = ({ isNew }: { isNew: boolean }) => {
  const { data, plan, view } = useApp();
  const h = data.home;
  const p = data.preferences;
  const eff = effectiveCounts(h);
  const area = homeArea(h);
  const type = h.type === 'other' && h.customType.trim() ? h.customType.trim() : HOME_TYPES.find((t) => t.value === h.type)?.label ?? 'Not set';
  const bandLabel = SIZE_BANDS.find((b) => b.value === h.sizeBand)?.label;
  const rooms = plan.rooms.filter((r) => !r.virtual);
  const bathrooms = rooms.filter((r) => r.kind === 'bathroom').length;
  const petText = h.pets.choice === 'none' || !h.pets.types.length ? 'No pets' : `${h.pets.count >= 3 ? '3+' : h.pets.count} · ${h.pets.types.join(', ')}`;
  const weekMinutes = useMemo(() => Math.round(view.tasks.filter((t) => t.tier === 'maintenance' && !t.backlog && t.frequency !== 'once').reduce((s, t) => s + t.minutes * occurrencesPerWeek(t.frequency, plan.activeDays.length, t.habit), 0)), [view, plan]);
  const style = STYLES.find((s) => s.value === p.style)?.label;
  const clean = CLEANLINESS.find((c) => c.value === h.cleanliness)?.label;
  const energy = ENERGY.find((e) => e.value === p.energy)?.label;
  const people = `${h.adults} adult${h.adults === 1 ? '' : 's'}${h.children ? ` · ${h.children} child${h.children === 1 ? '' : 'ren'}` : ''}`;
  const kinds: [string, number, IconType][] = [
    ['Bedrooms', rooms.filter((r) => r.kind === 'bedroom').length, I.bed], ['Bathrooms', bathrooms, I.bath], ['Living', rooms.filter((r) => r.kind === 'living').length, I.sofa],
    ['Kitchens', rooms.filter((r) => r.kind === 'kitchen').length, I.pot], ['Dining', rooms.filter((r) => r.kind === 'dining').length, I.pot], ['Offices', rooms.filter((r) => r.kind === 'office').length, I.laptop],
    ['Laundry', rooms.filter((r) => r.kind === 'laundry').length, I.shirt], ['Hallways', rooms.filter((r) => r.kind === 'hallway').length, I.door], ['Storage', rooms.filter((r) => r.kind === 'storage').length, I.archive],
  ];
  return (
    <div className="page">
      <PageHead title={isNew ? "Here's your home" : 'My Home'} sub={isNew ? "We've built your plan around this. Tap Edit on any card to change it." : 'Everything your plan is built on. Edit anything and the plan adapts.'}
        action={isNew ? undefined : <Button variant="soft" size="sm" onClick={() => navigate('plan')} icon={I.list}>View plan</Button>} />

      <div className="stat-grid">
        <div className="stat"><div className="v">{rooms.length}</div><div className="l">Spaces in your plan</div></div>
        <div className="stat"><div className="v">{plan.stats.recurringCount}</div><div className="l">Recurring tasks</div></div>
        <div className="stat"><div className="v">{formatMinutes(weekMinutes)}</div><div className="l">Planned per week</div></div>
        <div className="stat"><div className="v">{plan.zones.length}</div><div className="l">Zone{plan.zones.length === 1 ? '' : 's'}</div></div>
      </div>
      {isNew && <Button size="lg" block icon={I.arrow} onClick={() => navigate('today')}>See my plan for today</Button>}

      <div className="profile-grid">
        <Card icon={I.home} title="Home type" section="type"><div className="big">{type}</div></Card>
        <Card icon={I.layers} title="Approximate size" section="size"><div className="big">{area} m²</div><p className="small muted">{h.exactSizeM2 ? 'Exact size you entered' : bandLabel === "I don't know" ? 'Estimated from your rooms' : bandLabel ?? 'Not set'}</p></Card>
        <Card icon={I.door} title="Number of rooms" section="rooms">
          <div className="big">{rooms.length} spaces</div>
          <div className="roomtiles">
            {kinds.filter(([, n]) => n > 0).map(([label, n, Ic]) => <div className="roomtile" key={label}><Ic size={18} aria-hidden /><b>{n}</b><span className="xs muted">{label}</span></div>)}
            {(['balcony', 'garage', 'basement', 'attic'] as const).filter((k) => eff.rooms[k] !== 'none').map((k) => {
              const R = ROOM_ICON[k]; return <div className="roomtile" key={k}><R size={18} aria-hidden /><b style={{ fontSize: '0.95rem' }}>{eff.rooms[k]}</b><span className="xs muted" style={{ textTransform: 'capitalize' }}>{k}</span></div>;
            })}
            {h.extraRooms.map((x) => <div className="roomtile" key={x.id}><I.layers size={18} aria-hidden /><b style={{ fontSize: '0.95rem' }}>{x.name}</b><span className="xs muted">Extra</span></div>)}
          </div>
        </Card>
        <Card icon={I.bath} title="Number of bathrooms" section="rooms"><div className="big">{bathrooms}</div>{bathrooms === 0 && <p className="small muted">None in your own space</p>}</Card>
        <Card icon={I.layers} title="Number of floors" section="rooms"><div className="big">{eff.floors}</div><p className="small muted">{eff.floors > 1 ? `Tasks are grouped by floor: ${plan.zones.filter((z) => z !== 'Outside & utility spaces').join(', ')}` : 'Single level'}</p></Card>
        <Card icon={I.users} title="People" section="people"><div className="big">{people}</div></Card>
        <Card icon={I.paw} title="Pets" section="pets"><div className="big" style={{ textTransform: 'capitalize' }}>{petText}</div>{h.pets.features.length > 0 && h.pets.choice !== 'none' && <p className="small muted">{h.pets.features.join(', ')}</p>}</Card>
        <Card icon={I.repeat} title="Cleaning frequency" section="style"><div className="big">{p.daysPerWeek ? `${p.daysPerWeek} day${p.daysPerWeek === 1 ? '' : 's'} a week` : 'Not set'}</div><p className="small muted">{style ?? 'Style not set (the app decides)'}</p></Card>
        <Card icon={I.clock} title="Available cleaning time" section="style"><div className="big">{p.sessionMinutes ? sessionLabel(p.sessionMinutes) : 'Not set'}</div><p className="small muted">per session{p.learnedSessionCap ? ` · learned cap ${p.learnedSessionCap} min` : ''}</p></Card>
        <Card icon={I.battery} title="Energy level" section="energy"><div className="big">{energy ?? 'Not set'}</div>{p.blockers.length > 0 && <p className="small muted">{p.blockers.slice(0, 3).map((b) => BLOCKERS.find((x) => x.value === b)?.label).join(' · ')}{p.blockers.length > 3 ? ` +${p.blockers.length - 3}` : ''}</p>}</Card>
        <Card icon={I.sparkles} title="Current cleanliness" section="state"><div className="big" style={{ fontSize: '1.2rem' }}>{clean ?? 'Not set'}</div>{h.problemAreas.length > 0 && <p className="small muted">Focus: {h.problemAreas.map((a) => PROBLEM_AREAS.find((x) => x.value === a)?.label).join(', ')}</p>}</Card>
        <Card icon={I.sprout} title="Goals" section="goals"><div className="row wrap" style={{ gap: 6 }}>{p.goals.length ? p.goals.map((g) => <span key={g} className="tag green">{GOALS.find((x) => x.value === g)?.label}</span>) : <span className="muted small">No goals picked</span>}</div></Card>
      </div>

      <section className="card stack" aria-labelledby="adapt">
        <h2 id="adapt">How your plan was adapted</h2>
        <div className="note-list">
          {plan.notes.map((n) => {
            const Ic = (I as Record<string, IconType>)[n.icon] ?? I.sparkles;
            return <div className="note" key={n.id}><span className="ic"><Ic size={18} aria-hidden /></span><div><p className="strong">{n.title}</p><p className="small muted">{n.detail}</p></div></div>;
          })}
        </div>
      </section>
    </div>
  );
};
