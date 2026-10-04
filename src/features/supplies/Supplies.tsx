import { useMemo, useState } from 'react';
import { uid } from '../../domain/appdata';
import { SUPPLY_CATEGORIES } from '../../domain/options';
import {
  NEED_LABEL, NEED_TIP, SAFETY_HEADLINE, SAFETY_POINTS, STARTER_SUPPLIES, TOOL_NEEDS, checkTasks, supplyWarnings,
} from '../../domain/supplies';
import type { RoomKind, Supply, SupplyCategory, SupplyNeed } from '../../domain/types';
import { ROOM_MODE_LABEL, availableRoomModes, roomTasks } from '../../domain/view';
import { useApp } from '../../state/store';
import { I } from '../../ui/icons';
import { Button, Chip, Empty, PageHead } from '../../ui/primitives';

export const SafetyBanner = () => (
  <aside className="safety" role="note" aria-label="Chemical safety">
    <I.shield size={26} aria-hidden style={{ flex: 'none' }} />
    <div>
      <h3>{SAFETY_HEADLINE}</h3>
      <ul>{SAFETY_POINTS.map((p) => <li key={p}>{p}</li>)}</ul>
    </div>
  </aside>
);

const blank = (): Omit<Supply, 'id'> => ({ product: '', category: 'all-purpose', room: 'any', quantity: '1', notes: '', tools: [] });

const SupplyForm = ({ initial, onSave, onCancel }: { initial?: Supply; onSave: (s: Supply) => void; onCancel: () => void }) => {
  const { view } = useApp();
  const [f, setF] = useState<Omit<Supply, 'id'>>(initial ? { ...initial } : blank());
  const [touched, setTouched] = useState(false);
  const rooms = availableRoomModes(view);
  const ok = f.product.trim().length > 0;
  return (
    <form className="card stack" onSubmit={(e) => { e.preventDefault(); setTouched(true); if (ok) onSave({ ...f, id: initial?.id ?? uid('sup'), product: f.product.trim() }); }} aria-label={initial ? 'Edit supply' : 'Add a supply'}>
      <h3>{initial ? 'Edit supply' : 'Add a supply'}</h3>
      <div className="field">
        <label htmlFor="s-prod">Product</label>
        <input id="s-prod" className="input" value={f.product} maxLength={60} placeholder="e.g. Lemon dish soap" onChange={(e) => setF({ ...f, product: e.target.value })} aria-invalid={touched && !ok} />
        {touched && !ok && <span className="small" role="alert" style={{ color: 'var(--clay-ink)' }}>Add a product name.</span>}
      </div>
      <div className="field">
        <label htmlFor="s-cat">Category</label>
        <select id="s-cat" className="select" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as SupplyCategory })}>
          {SUPPLY_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      </div>
      {f.category === 'tools' && (
        <div className="field"><span className="label">Which tools does this cover?</span>
          <div className="chips">{TOOL_NEEDS.map((t) => (
            <Chip key={t.value} role="checkbox" small on={!!f.tools?.includes(t.value)} onClick={() => setF({ ...f, tools: f.tools?.includes(t.value) ? f.tools.filter((x) => x !== t.value) : [...(f.tools ?? []), t.value] })}>{t.label}</Chip>
          ))}</div>
        </div>
      )}
      <div className="field">
        <label htmlFor="s-room">Room</label>
        <select id="s-room" className="select" value={f.room} onChange={(e) => setF({ ...f, room: e.target.value as RoomKind | 'any' })}>
          <option value="any">Anywhere</option>
          {rooms.map((k) => <option key={k} value={k}>{ROOM_MODE_LABEL[k]}</option>)}
        </select>
      </div>
      <div className="field"><label htmlFor="s-qty">Quantity</label><input id="s-qty" className="input" value={f.quantity} maxLength={20} onChange={(e) => setF({ ...f, quantity: e.target.value })} style={{ maxWidth: 160 }} /></div>
      <div className="field"><label htmlFor="s-notes">Notes (optional)</label><input id="s-notes" className="input" value={f.notes} maxLength={120} placeholder="e.g. contains ammonia, check the label" onChange={(e) => setF({ ...f, notes: e.target.value })} /></div>
      <div className="row"><Button variant="secondary" onClick={onCancel}>Cancel</Button><Button type="submit" icon={I.check}>{initial ? 'Save' : 'Add'}</Button></div>
    </form>
  );
};

const WhatCanIClean = () => {
  const { view, data } = useApp();
  const modes = availableRoomModes(view);
  const [room, setRoom] = useState<RoomKind | 'all'>('all');
  const tasks = useMemo(() => {
    const base = room === 'all' ? view.tasks.filter((t) => t.tier !== 'reset') : roomTasks(view, room).filter((t) => t.tier !== 'reset');
    return base.filter((t) => t.needs.length > 0);
  }, [view, room]);
  const res = useMemo(() => checkTasks(tasks, data.supplies), [tasks, data.supplies]);
  const allMissing = useMemo(() => {
    const m = new Map<SupplyNeed, number>();
    res.missing.forEach((x) => x.missing.forEach((n) => m.set(n, (m.get(n) ?? 0) + 1)));
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [res]);
  return (
    <section className="card stack" aria-labelledby="wcic">
      <div><h2 id="wcic">What can I clean with what I already have?</h2><p className="small muted">Pick a space and we'll show what you can do right now, and what's missing (with a safe workaround).</p></div>
      <div className="chips scroll" role="tablist" aria-label="Space">
        <Chip role="tab" on={room === 'all'} onClick={() => setRoom('all')}>Everywhere</Chip>
        {modes.map((k) => <Chip key={k} role="tab" on={room === k} onClick={() => setRoom(k)}>{ROOM_MODE_LABEL[k]}</Chip>)}
      </div>
      {data.supplies.length === 0 && <div className="hint"><I.info size={18} aria-hidden />You haven't added supplies yet, so everything shows as missing. Add yours below, or start with the common basics.</div>}
      <div>
        <h3 style={{ color: 'var(--primary)' }}>✓ You can do these now ({res.ready.length})</h3>
        <ul className="stack" style={{ paddingLeft: 18, margin: '8px 0 0', gap: 4 }}>{res.ready.slice(0, 12).map((r) => <li key={r.task.id} className="small">{r.task.name}{room === 'all' ? <span className="muted"> · {r.task.roomKind === 'home' ? 'Whole home' : r.task.roomName.replace(/ \d+$/, '')}</span> : null}</li>)}{res.ready.length === 0 && <li className="small muted" style={{ listStyle: 'none', marginLeft: -18 }}>Nothing yet. See the workarounds below.</li>}</ul>
      </div>
      {res.missing.length > 0 && (
        <div className="stack">
          <h3>Missing something ({res.missing.length})</h3>
          {allMissing.length > 0 && (
            <div className="card soft stack">
              <p className="small strong">Most-needed items you don't have</p>
              {allMissing.map(([n, c]) => (
                <div key={n} className="small"><b>{NEED_LABEL[n]}</b> <span className="muted">· needed for {c} task{c === 1 ? '' : 's'}</span>{NEED_TIP[n] && <div className="muted">Workaround: {NEED_TIP[n]}</div>}</div>
              ))}
            </div>
          )}
          <ul style={{ paddingLeft: 18, margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {res.missing.slice(0, 10).map((r) => <li key={r.task.id} className="small">{r.task.name} <span className="muted">· needs {r.missing.map((n) => NEED_LABEL[n]).join(', ')}</span></li>)}
          </ul>
        </div>
      )}
    </section>
  );
};

export const Supplies = () => {
  const { data, dispatch, toast } = useApp();
  const [editing, setEditing] = useState<Supply | 'new' | null>(null);
  const warnings = supplyWarnings(data.supplies);
  const groups = useMemo(() => {
    const m = new Map<SupplyCategory, Supply[]>();
    data.supplies.forEach((s) => m.set(s.category, [...(m.get(s.category) ?? []), s]));
    return [...m.entries()];
  }, [data.supplies]);
  return (
    <div className="page">
      <PageHead title="Cleaning supplies" sub="Optional. Add what you own and CleanFlow shows what you can clean right now."
        action={<Button size="sm" variant="soft" icon={I.plus} onClick={() => setEditing('new')}>Add</Button>} />
      <SafetyBanner />
      {warnings.map((w) => <div key={w.id} className="card warn row" role="alert"><I.alert size={22} aria-hidden style={{ flex: 'none' }} /><p className="small strong">{w.text}</p></div>)}

      {editing && (
        <SupplyForm initial={editing === 'new' ? undefined : editing} onCancel={() => setEditing(null)}
          onSave={(s) => { dispatch({ type: 'SUPPLY_SAVE', supply: s }); setEditing(null); toast(editing === 'new' ? 'Added to your supplies.' : 'Saved.'); }} />
      )}

      <WhatCanIClean />

      <section className="stack" aria-labelledby="mine">
        <div className="section-title"><h2 id="mine">My supplies</h2><span className="small muted">{data.supplies.length} item{data.supplies.length === 1 ? '' : 's'}</span></div>
        {data.supplies.length === 0 ? (
          <Empty icon={I.package} title="No supplies yet">
            <div className="stack" style={{ alignItems: 'center' }}><span>Add what you have, or start with the common basics.</span>
              <Button variant="soft" onClick={() => { dispatch({ type: 'SUPPLY_STARTERS', supplies: STARTER_SUPPLIES }); toast('Added 5 common basics. Edit or remove any.'); }}>Add common basics</Button></div>
          </Empty>
        ) : groups.map(([cat, items]) => (
          <div key={cat} className="stack">
            <div className="group-title">{SUPPLY_CATEGORIES.find((c) => c.value === cat)?.label}</div>
            {items.map((s) => (
              <div key={s.id} className="card row between" style={{ padding: 14 }}>
                <div className="grow"><p className="strong">{s.product}</p><p className="small muted">{[s.room === 'any' ? 'Anywhere' : ROOM_MODE_LABEL[s.room], s.quantity && `Qty ${s.quantity}`, s.notes].filter(Boolean).join(' · ')}</p></div>
                <button className="icon-btn" aria-label={`Edit ${s.product}`} onClick={() => setEditing(s)}><I.pencil size={20} /></button>
                <button className="icon-btn" aria-label={`Delete ${s.product}`} onClick={() => dispatch({ type: 'SUPPLY_DELETE', id: s.id })}><I.trash size={20} /></button>
              </div>
            ))}
          </div>
        ))}
      </section>
    </div>
  );
};
