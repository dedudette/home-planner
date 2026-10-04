import { useState, type ReactNode } from 'react';
import { effectiveCounts, homeArea } from '../../domain/context';
import {
  EQUIPMENT_OPTIONS, FITNESS_LEVELS, FOCUS_OPTIONS, LIFE_LEVELS,
  BLOCKERS, CLEANLINESS, ENERGY, GARAGE_SIZES, GOALS, HOME_TYPES, PET_CHOICES, PET_FEATURES, PET_TYPES, PROBLEM_AREAS, SESSION_LENGTHS,
  SIZE_BANDS, SIZE_LEVELS, STYLES, countLabel, isRoomFieldVisible, sessionLabel, type RoomField,
} from '../../domain/options';
import type { Home, LifeFocus, LifeLevel, PetChoice, PetType, RoomCounts } from '../../domain/types';
import { useApp } from '../../state/store';
import { I, type IconType } from '../../ui/icons';
import { Chip, Hint } from '../../ui/primitives';

// ───────────── tiny shared widgets ─────────────
const toggle = <T,>(arr: T[], v: T): T[] => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

const Choice = ({ on, onClick, icon: Icon, label, hint, multi }: { on: boolean; onClick: () => void; icon?: IconType; label: string; hint?: string; multi?: boolean }) => (
  <button type="button" className="choice" role={multi ? 'checkbox' : 'radio'} aria-checked={on} onClick={onClick}>
    {Icon && <span className="ic"><Icon size={20} aria-hidden /></span>}
    <span>{label}{hint && <small>{hint}</small>}</span>
  </button>
);

const Group = ({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) => (
  <div className="stack" role="group" aria-label={label}>
    <div><h3>{label}</h3>{hint && <p className="small muted">{hint}</p>}</div>
    {children}
  </div>
);

const Pills = ({ options, value, onChange, label }: { options: { value: string | number; label: string }[]; value: string | number; onChange: (v: never) => void; label: string }) => (
  <div className="opts" role="group" aria-label={label}>
    {options.map((o) => (
      <button key={String(o.value)} type="button" className="pill" aria-pressed={value === o.value} onClick={() => onChange(o.value as never)}>{o.label}</button>
    ))}
  </div>
);

const NumPills = ({ max, value, onChange, label, min = 0 }: { max: number; value: number; onChange: (n: number) => void; label: string; min?: number }) => (
  <Pills label={label} value={Math.min(value, max)} onChange={onChange as (v: never) => void}
    options={Array.from({ length: max - min + 1 }, (_, i) => ({ value: min + i, label: countLabel(min + i, max) }))} />
);

// ───────────── Step: What to improve (life layer) ─────────────
const FOCUS_ICON: Record<LifeFocus, IconType> = {
  home: I.home, active: I.dumbbell, discipline: I.flame, morning: I.sunrise, evening: I.sunset, focus: I.brain, phone: I.phone,
  selfcare: I.heart, study: I.cap, organize: I.clipboard, healthy: I.leaf, consistent: I.repeat,
};

export const StepFocus = () => {
  const { data, dispatch, stamp } = useApp();
  const p = data.preferences;
  const set = (patch: Partial<typeof p>) => dispatch({ type: 'SET_PREFS', patch, stamp: stamp() });
  const life = p.focus.some((f) => f !== 'home');
  return (
    <div className="stack-lg">
      <div className="choice-grid single" role="group" aria-label="What to improve">
        {FOCUS_OPTIONS.map((o) => (
          <Choice key={o.value} multi on={p.focus.includes(o.value)} icon={FOCUS_ICON[o.value]} label={o.label} hint={o.hint}
            onClick={() => set({ focus: toggle(p.focus, o.value) })} />
        ))}
      </div>
      {p.focus.length === 0 && <Hint>Pick at least one. You can change this any time in My Home.</Hint>}
      {!p.focus.includes('home') && p.focus.length > 0 && <Hint icon={I.home}>No cleaning plan this time. We'll skip the questions about your home. You can add it later.</Hint>}
      {p.focus.includes('active') && (
        <>
          <Group label="How would you describe your fitness?" hint="This keeps exercises at a sensible level. Nothing here is medical advice.">
            <div className="choice-grid single" role="radiogroup" aria-label="Fitness level">
              {FITNESS_LEVELS.map((o) => <Choice key={o.value} on={p.fitnessLevel === o.value} label={o.label} hint={o.hint} onClick={() => set({ fitnessLevel: o.value })} />)}
            </div>
          </Group>
          <Group label="Do you have exercise equipment?">
            <div className="choice-grid single" role="radiogroup" aria-label="Equipment">
              {EQUIPMENT_OPTIONS.map((o) => <Choice key={o.value} on={p.equipment === o.value} label={o.label} hint={o.hint} onClick={() => set({ equipment: o.value })} />)}
            </div>
          </Group>
        </>
      )}
      {life && (
        <Group label="Where would you like to start?" hint="Tasks get a little bigger over time, only when you're ready.">
          <div className="choice-grid single" role="radiogroup" aria-label="Starting pace">
            {([1, 2] as LifeLevel[]).map((l) => <Choice key={l} on={p.lifeLevel === l} label={LIFE_LEVELS[l].label} hint={LIFE_LEVELS[l].hint} onClick={() => set({ lifeLevel: l })} />)}
          </div>
        </Group>
      )}
    </div>
  );
};

// ───────────── Step 1: Home type ─────────────
const TYPE_ICON: Record<string, IconType> = {
  apartment: I.building, studio: I.sofa, house: I.home, townhouse: I.layers, duplex: I.layers, dorm: I.bed, shared: I.users, other: I.pencil,
};
export const StepHomeType = () => {
  const { data, dispatch, stamp } = useApp();
  const h = data.home;
  return (
    <div className="stack-lg">
      <div className="choice-grid" role="radiogroup" aria-label="Home type">
        {HOME_TYPES.map((o) => (
          <Choice key={o.value} on={h.type === o.value} icon={TYPE_ICON[o.value]} label={o.label}
            onClick={() => dispatch({ type: 'SET_HOME_TYPE', homeType: o.value, stamp: stamp() })} />
        ))}
      </div>
      {h.type === 'other' && (
        <div className="field">
          <label htmlFor="custom-type">Tell us a bit more</label>
          <input id="custom-type" className="input" placeholder="e.g. loft, tiny house, caravan…" value={h.customType} maxLength={40}
            onChange={(e) => dispatch({ type: 'SET_HOME', patch: { customType: e.target.value }, stamp: stamp() })} />
        </div>
      )}
      {h.type === 'studio' && <Hint>In a studio your main room counts as both bedroom and living room, so you'll get one set of tasks for it, not two.</Hint>}
      {h.type === 'dorm' && <Hint>We'll focus on your own space and keep shared bathroom and kitchen tasks light.</Hint>}
      {h.type === 'shared' && <Hint>We'll plan your own room plus the shared areas, which you can split with housemates.</Hint>}
    </div>
  );
};

// ───────────── Step 2: Size ─────────────
export const StepSize = () => {
  const { data, dispatch, stamp } = useApp();
  const h = data.home;
  const [text, setText] = useState(h.exactSizeM2 ? String(h.exactSizeM2) : '');
  const set = (patch: Partial<Home>) => dispatch({ type: 'SET_HOME', patch, stamp: stamp() });
  const exactValid = h.exactSizeM2 !== null;
  return (
    <div className="stack-lg">
      <Hint icon={I.smile}>A rough guess is fine. Nothing here needs to be measured.</Hint>
      <div className="choice-grid cols3" role="radiogroup" aria-label="Approximate size">
        {SIZE_BANDS.map((o) => (
          <button key={o.value} type="button" className="choice" role="radio" aria-checked={h.sizeBand === o.value && !exactValid}
            onClick={() => { setText(''); set({ sizeBand: o.value, exactSizeM2: null }); }} style={{ minHeight: 56 }}>
            <span>{o.label}</span>
          </button>
        ))}
      </div>
      <div className="field">
        <label htmlFor="exact">Or enter the exact size</label>
        <div className="row">
          <input id="exact" className="input" inputMode="decimal" placeholder="75" style={{ maxWidth: 160 }} value={text}
            onChange={(e) => {
              const raw = e.target.value.replace(/[^0-9.,]/g, '');
              setText(raw);
              const n = Number(raw.replace(',', '.'));
              set(Number.isFinite(n) && n >= 8 && n <= 2000 ? { exactSizeM2: Math.round(n), sizeBand: h.sizeBand ?? 'unknown' } : { exactSizeM2: null });
            }} />
          <span className="muted">m²</span>
        </div>
        {text && !exactValid && <span className="small" style={{ color: 'var(--clay-ink)' }}>Please enter a number between 8 and 2000.</span>}
        {exactValid && <span className="small muted">Using your exact size: {h.exactSizeM2} m².</span>}
        {!exactValid && h.sizeBand === 'unknown' && <span className="small muted">No problem. We'll estimate from your rooms (about {homeArea(h)} m²).</span>}
      </div>
    </div>
  );
};

// ───────────── Step 3: Rooms ─────────────
interface Counter { key: keyof RoomCounts; label: string; icon: IconType; max: number; min?: number }
const COUNTERS: Counter[] = [
  { key: 'bedrooms', label: 'Bedrooms', icon: I.bed, max: 5 },
  { key: 'bathrooms', label: 'Bathrooms', icon: I.bath, max: 4 },
  { key: 'livingRooms', label: 'Living rooms', icon: I.sofa, max: 3 },
  { key: 'kitchens', label: 'Kitchens', icon: I.pot, max: 2 },
  { key: 'diningRooms', label: 'Dining rooms', icon: I.pot, max: 2 },
  { key: 'offices', label: 'Office / study', icon: I.laptop, max: 2 },
  { key: 'laundryRooms', label: 'Laundry room', icon: I.shirt, max: 2 },
  { key: 'hallways', label: 'Hallways', icon: I.door, max: 3 },
  { key: 'storageRooms', label: 'Storage rooms', icon: I.archive, max: 2 },
];

export const StepRooms = () => {
  const { data, dispatch, stamp } = useApp();
  const h = data.home;
  const t = h.type;
  const [extra, setExtra] = useState('');
  const setRooms = (patch: Partial<RoomCounts>) => dispatch({ type: 'SET_HOME', patch: { rooms: { ...h.rooms, ...patch } }, stamp: stamp() });
  const eff = effectiveCounts(h);
  const vis = (f: RoomField) => isRoomFieldVisible(f, t);
  return (
    <div className="stack-lg">
      <Hint>Only the questions that make sense for your type of home are shown. Leave anything that doesn't apply at 0 or None.</Hint>
      <div className="stack">
        {COUNTERS.filter((c) => vis(c.key)).map((c) => (
          <div className="counter" key={c.key}>
            <span className="name"><span className="ic"><c.icon size={20} aria-hidden /></span>{c.label}</span>
            <Pills label={c.label} value={Math.min(h.rooms[c.key] as number, c.max)} onChange={(v) => setRooms({ [c.key]: v } as Partial<RoomCounts>)}
              options={Array.from({ length: c.max - (c.key === 'bathrooms' && t !== 'dorm' ? 1 : 0) + 1 }, (_, i) => {
                const n = i + (c.key === 'bathrooms' && t !== 'dorm' ? 1 : 0);
                return { value: n, label: countLabel(n, c.max) };
              })} />
          </div>
        ))}
        {vis('balcony') && <LevelCounter label="Balcony" icon={I.sun} value={h.rooms.balcony} onChange={(v) => setRooms({ balcony: v })} />}
        {vis('garage') && (
          <div className="counter stack-sm">
            <span className="name"><span className="ic"><I.garage size={20} aria-hidden /></span>Garage</span>
            <Pills label="Garage" value={h.rooms.garage} onChange={(v) => setRooms({ garage: v })} options={GARAGE_SIZES} />
          </div>
        )}
        {vis('basement') && <LevelCounter label="Basement" icon={I.mountain} value={h.rooms.basement} onChange={(v) => setRooms({ basement: v })} />}
        {vis('attic') && <LevelCounter label="Attic" icon={I.home} value={h.rooms.attic} onChange={(v) => setRooms({ attic: v })} />}
        {vis('floors') && (
          <div className="counter">
            <span className="name"><span className="ic"><I.layers size={20} aria-hidden /></span>Number of floors</span>
            <Pills label="Floors" value={eff.floors} onChange={(v) => dispatch({ type: 'SET_HOME', patch: { floors: v }, stamp: stamp() })}
              options={[1, 2, 3, 4].map((n) => ({ value: n, label: countLabel(n, 4) }))} />
          </div>
        )}
      </div>
      <Group label="Anything else?" hint="Add a space that isn't listed (sunroom, craft room, studio…). It gets its own simple tasks.">
        <div className="row">
          <input className="input" placeholder="e.g. Sunroom" value={extra} maxLength={30} aria-label="Extra space name" onChange={(e) => setExtra(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && extra.trim()) { e.preventDefault(); add(); } }} />
          <button type="button" className="btn soft" onClick={add} disabled={!extra.trim()}>Add</button>
        </div>
        {h.extraRooms.length > 0 && (
          <div className="chips">
            {h.extraRooms.map((x) => (
              <span key={x.id} className="chip on" style={{ paddingRight: 6 }}>
                {x.name}
                <button type="button" className="icon-btn" style={{ width: 32, height: 32, color: 'inherit' }} aria-label={`Remove ${x.name}`}
                  onClick={() => dispatch({ type: 'SET_HOME', patch: { extraRooms: h.extraRooms.filter((r) => r.id !== x.id) }, stamp: stamp() })}><I.x size={16} /></button>
              </span>
            ))}
          </div>
        )}
      </Group>
    </div>
  );
  function add() {
    const name = extra.trim();
    if (!name) return;
    dispatch({ type: 'SET_HOME', patch: { extraRooms: [...h.extraRooms, { id: Math.random().toString(36).slice(2, 7), name }] }, stamp: stamp() });
    setExtra('');
  }
};

const LevelCounter = ({ label, icon: Icon, value, onChange }: { label: string; icon: IconType; value: RoomCounts['balcony']; onChange: (v: RoomCounts['balcony']) => void }) => (
  <div className="counter stack-sm">
    <span className="name"><span className="ic"><Icon size={20} aria-hidden /></span>{label}</span>
    <Pills label={label} value={value} onChange={onChange as (v: never) => void} options={SIZE_LEVELS} />
  </div>
);

// ───────────── Step 4: People & pets ─────────────
export const StepPeople = () => {
  const { data, dispatch, stamp } = useApp();
  const h = data.home;
  const set = (patch: Partial<Home>) => dispatch({ type: 'SET_HOME', patch, stamp: stamp() });
  const pets = h.pets;
  const setPets = (patch: Partial<Home['pets']>) => set({ pets: { ...pets, ...patch } });
  const hasPets = pets.choice !== 'none';
  const pickChoice = (c: PetChoice) => {
    const types: PetType[] = c === 'none' ? [] : c === 'dog' ? ['dog'] : c === 'cat' ? ['cat'] : c === 'both' ? ['dog', 'cat'] : [];
    setPets({
      choice: c, types, access: pets.access.length ? pets.access : ['indoor'],
      features: c === 'none' ? [] : pets.features.length ? pets.features : [...(types.includes('cat') ? ['litter' as const] : []), 'feeding' as const],
    });
  };
  return (
    <div className="stack-lg">
      <div className="stack">
        <div className="counter">
          <span className="name"><span className="ic"><I.users size={20} aria-hidden /></span>Adults</span>
          <NumPills label="Adults" min={1} max={4} value={h.adults} onChange={(n) => set({ adults: n })} />
        </div>
        <div className="counter">
          <span className="name"><span className="ic"><I.baby size={20} aria-hidden /></span>Children</span>
          <NumPills label="Children" max={4} value={h.children} onChange={(n) => set({ children: n })} />
        </div>
      </div>
      <Group label="Pets">
        <div className="chips" role="radiogroup" aria-label="Pets">
          {PET_CHOICES.map((o) => <Chip key={o.value} role="radio" on={pets.choice === o.value} onClick={() => pickChoice(o.value)}>{o.label}</Chip>)}
        </div>
      </Group>
      {hasPets && (
        <>
          <Group label="What type of pet?" hint="Choose all that apply.">
            <div className="chips">
              {PET_TYPES.map((o) => (
                <Chip key={o.value} role="checkbox" on={pets.types.includes(o.value)} onClick={() => setPets({ types: toggle(pets.types, o.value) })}>{o.label}</Chip>
              ))}
            </div>
          </Group>
          <div className="counter">
            <span className="name"><span className="ic"><I.paw size={20} aria-hidden /></span>How many pets?</span>
            <NumPills label="Number of pets" min={1} max={3} value={pets.count} onChange={(n) => setPets({ count: n })} />
          </div>
          <Group label="Do your pets have…" hint="This shapes which pet tasks you get.">
            <div className="chips">
              {([['indoor', 'Indoor access'], ['outdoor', 'Outdoor access']] as const).map(([v, l]) => (
                <Chip key={v} role="checkbox" on={pets.access.includes(v)} onClick={() => setPets({ access: toggle(pets.access, v) })}>{l}</Chip>
              ))}
              {PET_FEATURES.map((o) => (
                <Chip key={o.value} role="checkbox" on={pets.features.includes(o.value)} onClick={() => setPets({ features: toggle(pets.features, o.value) })}>{o.label}</Chip>
              ))}
            </div>
          </Group>
        </>
      )}
    </div>
  );
};

// ───────────── Step 5: Current state ─────────────
export const StepState = () => {
  const { data, dispatch, stamp } = useApp();
  const h = data.home;
  const set = (patch: Partial<Home>) => dispatch({ type: 'SET_HOME', patch, stamp: stamp() });
  return (
    <div className="stack-lg">
      <div className="choice-grid single" role="radiogroup" aria-label="Current cleanliness">
        {CLEANLINESS.map((o) => <Choice key={o.value} on={h.cleanliness === o.value} label={o.label} onClick={() => set({ cleanliness: o.value })} />)}
      </div>
      {(h.cleanliness === 'overwhelming' || h.cleanliness === 'long-time') && <Hint icon={I.heart}>That's more common than you'd think, and it's okay. We'll start with a gentle reset, one small step at a time, before any routine.</Hint>}
      <Group label="Which areas are the biggest problem right now?" hint="Choose as many as you like. These get extra priority.">
        <div className="chips">
          {PROBLEM_AREAS.map((o) => <Chip key={o.value} role="checkbox" on={h.problemAreas.includes(o.value)} onClick={() => set({ problemAreas: toggle(h.problemAreas, o.value) })}>{o.label}</Chip>)}
        </div>
        {h.problemAreas.includes('other') && (
          <input className="input" aria-label="Other problem area" placeholder="What else is bugging you?" value={h.problemOther} maxLength={60} onChange={(e) => set({ problemOther: e.target.value })} />
        )}
      </Group>
    </div>
  );
};

// ───────────── Step 6: Style ─────────────
export const StepStyle = () => {
  const { data, dispatch, stamp } = useApp();
  const p = data.preferences;
  const set = (patch: Partial<typeof p>) => dispatch({ type: 'SET_PREFS', patch, stamp: stamp() });
  return (
    <div className="stack-lg">
      {p.focus.includes('home') && (
        <Group label="How do you prefer to clean?">
          <div className="choice-grid single" role="radiogroup" aria-label="Cleaning style">
            {STYLES.map((o) => (
              <Choice key={o.value} on={p.style === o.value} label={o.label} hint={o.hint}
                onClick={() => set({ style: o.value, ...(p.daysTouched ? {} : { daysPerWeek: o.days }) })} />
            ))}
          </div>
        </Group>
      )}
      <Group label={p.focus.includes('home') ? 'How long can you realistically clean at once?' : 'How much time can you give this each day?'} hint="Be honest. Shorter sessions you actually do beat longer ones you skip.">
        <div className="chips" role="radiogroup" aria-label="Session length">
          {SESSION_LENGTHS.map((m) => <Chip key={m} role="radio" on={p.sessionMinutes === m} onClick={() => set({ sessionMinutes: m })}>{sessionLabel(m)}</Chip>)}
        </div>
      </Group>
      <Group label={p.focus.includes('home') ? 'How many days per week do you want to clean?' : 'How many days a week?'}>
        <div className="chips" role="radiogroup" aria-label="Days per week">
          {[1, 2, 3, 4, 5, 6, 7].map((n) => <Chip key={n} role="radio" on={p.daysPerWeek === n} onClick={() => set({ daysPerWeek: n, daysTouched: true })}>{n}</Chip>)}
        </div>
        {p.sessionMinutes && p.daysPerWeek && (
          <p className="small muted">That's about {Math.round((p.sessionMinutes * p.daysPerWeek) / 6) / 10} hours a week. We'll build your plan to fit inside it.</p>
        )}
      </Group>
    </div>
  );
};

// ───────────── Step 7: Energy ─────────────
export const StepEnergy = () => {
  const { data, dispatch, stamp } = useApp();
  const p = data.preferences;
  const set = (patch: Partial<typeof p>) => dispatch({ type: 'SET_PREFS', patch, stamp: stamp() });
  return (
    <div className="stack-lg">
      <Group label="How is your energy usually?">
        <div className="chips" role="radiogroup" aria-label="Energy">
          {ENERGY.map((o) => <Chip key={o.value} role="radio" on={p.energy === o.value} onClick={() => set({ energy: o.value })}>{o.label}</Chip>)}
        </div>
        {p.energy === 'varies' && <Hint>On Today you'll be able to say "low / okay / high" for the day, and the list adjusts.</Hint>}
      </Group>
      <Group label="What usually makes cleaning difficult?" hint="Choose all that apply. This changes how tasks are presented.">
        <div className="chips">
          {BLOCKERS.map((o) => <Chip key={o.value} role="checkbox" on={p.blockers.includes(o.value)} onClick={() => set({ blockers: toggle(p.blockers, o.value) })}>{o.label}</Chip>)}
        </div>
        {(p.blockers.includes('overwhelming') || p.blockers.includes('where-to-start')) && (
          <Hint icon={I.list}>Big jobs will be broken into tiny steps, like "put dishes in the sink" instead of "clean the kitchen".</Hint>
        )}
      </Group>
    </div>
  );
};

// ───────────── Step 8: Goals ─────────────
export const StepGoals = () => {
  const { data, dispatch, stamp } = useApp();
  const p = data.preferences;
  return (
    <div className="stack-lg">
      <div className="choice-grid single" role="group" aria-label="Goals">
        {GOALS.map((o) => (
          <Choice key={o.value} multi on={p.goals.includes(o.value)} label={o.label}
            onClick={() => dispatch({ type: 'SET_PREFS', patch: { goals: toggle(p.goals, o.value) }, stamp: stamp() })} />
        ))}
      </div>
    </div>
  );
};

// ───────────── Step registry ─────────────
export interface StepDef {
  key: string;
  title: string;
  sub: string;
  Component: () => JSX.Element;
  required: (d: ReturnType<typeof useApp>['data']) => boolean;
  skippable?: boolean;
}

const FOCUS_STEP: StepDef = { key: 'focus', title: 'What do you want to improve?', sub: 'Choose as many as you like. You only get tasks for what you pick.', Component: StepFocus, required: (d) => d.preferences.focus.length > 0 };
const HOME_STEPS: StepDef[] = [
  { key: 'type', title: 'What type of home do you live in?', sub: "This decides which questions come next, so we never ask about a garage in a dorm room.", Component: StepHomeType, required: (d) => d.home.type !== null },
  { key: 'size', title: 'How large is your home?', sub: 'Pick whatever feels closest.', Component: StepSize, required: (d) => d.home.sizeBand !== null || d.home.exactSizeM2 !== null, skippable: true },
  { key: 'rooms', title: 'How many rooms does your home have?', sub: "Tell us what's really there and we'll plan around it.", Component: StepRooms, required: () => true },
  { key: 'people', title: 'Who lives in your home?', sub: 'People and pets change how fast things get messy.', Component: StepPeople, required: () => true },
  { key: 'state', title: 'How would you describe your home right now?', sub: 'No judgement. This only helps us pick the right starting point.', Component: StepState, required: (d) => d.home.cleanliness !== null, skippable: true },
];

/** The onboarding path adapts to what the user wants to improve. Home questions are skipped when they don't want a cleaning plan. */
export const stepsFor = (focus: LifeFocus[]): StepDef[] => {
  const home = focus.includes('home');
  return [
    FOCUS_STEP,
    ...(home ? HOME_STEPS : []),
    {
      key: 'style', title: home ? 'How do you prefer to clean?' : 'How much time do you have?', sub: home ? 'Your rhythm and time budget shape the whole plan.' : 'A small, realistic amount beats an ambitious one.', Component: StepStyle,
      required: (d) => (d.preferences.focus.includes('home') ? !!d.preferences.style : true) && !!d.preferences.sessionMinutes && !!d.preferences.daysPerWeek, skippable: home,
    },
    { key: 'energy', title: 'How is your energy usually?', sub: 'And what gets in the way. We use this to make tasks easier to start.', Component: StepEnergy, required: (d) => d.preferences.energy !== null, skippable: true },
    ...(home ? [{ key: 'goals', title: 'What do you want CleanFlow to help you achieve at home?', sub: 'Pick as many as you like.', Component: StepGoals, required: () => true } as StepDef] : []),
  ];
};
