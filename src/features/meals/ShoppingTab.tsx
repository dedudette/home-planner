import { useMemo, useState } from 'react';
import { uid } from '../../domain/appdata';
import { addDays, formatDay, formatShort, startOfWeek } from '../../domain/dates';
import { identify } from '../../domain/meals/ingredients';
import { CATEGORY_LABEL, exportText, freshItemsFor, generateItems, itemText, listEntries, proposeUpdate, shoppableEntries, sortItems } from '../../domain/meals/shopping';
import { recipeOf } from '../../domain/meals/planner';
import { formatAmount } from '../../domain/meals/units';
import { SHOP_CATEGORIES, UNITS, type ShoppingItem, type ShoppingList, type Unit } from '../../domain/meals/types';
import { useApp } from '../../state/store';
import { downloadText } from '../../ui/download';
import { I } from '../../ui/icons';
import { Button, Chip, Empty, Hint, Sheet, Tag } from '../../ui/primitives';
import { ServingsStepper } from './RecipeDetail';

const manualItem = (name: string, qty: number | null, unit: Unit | null): ShoppingItem => {
  const id = identify(name);
  return { id: uid('m'), key: id.key, name: name.trim(), qty, unit: qty === null ? null : unit, category: id.category, optional: false, checked: false, atHome: false, manual: true, edited: false, note: '', sources: [] };
};

// ───────────── make a list from the meals in a date range ─────────────
export const ShopGenSheet = () => {
  const { data, today, closeSheet, dispatch, toast } = useApp();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(addDays(startOfWeek(today), 6) < today ? addDays(today, 6) : addDays(startOfWeek(today), 6));
  const [off, setOff] = useState<string[]>([]);
  const [name, setName] = useState('');
  const inRange = shoppableEntries(data.meals.plan, from, to);
  const chosen = inRange.filter((e) => !off.includes(e.id));
  const parts = chosen.flatMap((entry) => { const recipe = recipeOf(data, entry.ref); return recipe ? [{ entry, recipe }] : []; });
  const preview = useMemo(() => generateItems(parts, data.shopping.pantry), [parts.map((p) => `${p.entry.id}:${p.entry.servings}`).join('|'), data.shopping.pantry]); // eslint-disable-line react-hooks/exhaustive-deps
  const quiet = data.meals.plan.filter((e) => e.date >= from && e.date <= to && e.status !== 'skipped' && (e.ref.kind === 'free' || e.ref.kind === 'leftover'));
  const make = () => {
    const list: ShoppingList = {
      id: uid('list'), name: name.trim() || `Shopping, ${formatShort(from)} to ${formatShort(to)}`, createdAt: new Date().toISOString(), range: { from, to },
      entryIds: parts.map((p) => p.entry.id), skipped: off.filter((id) => inRange.some((e) => e.id === id)), items: preview, ignored: null,
    };
    dispatch({ type: 'SHOP_CREATE', list });
    toast(`List made: ${preview.length} item${preview.length === 1 ? '' : 's'}.`, { label: 'Undo', run: () => dispatch({ type: 'SHOP_DELETE', id: list.id }) });
    closeSheet();
    window.location.hash = `#/meals?tab=shopping&list=${list.id}`;
  };
  return (
    <Sheet title="Make a shopping list" onClose={closeSheet} full
      footer={<><Button variant="secondary" onClick={closeSheet}>Cancel</Button><Button icon={I.check} disabled={!parts.length} onClick={make}>Make the list ({preview.length})</Button></>}>
      <div className="row wrap" style={{ gap: 8 }}>
        <Chip small role="radio" on={false} onClick={() => { setFrom(today); setTo(addDays(today, 6)); }}>Next 7 days</Chip>
        <Chip small role="radio" on={false} onClick={() => { const s = startOfWeek(today); setFrom(s > today ? s : today); setTo(addDays(s, 6)); }}>This week</Chip>
        <Chip small role="radio" on={false} onClick={() => { const s = addDays(startOfWeek(today), 7); setFrom(s); setTo(addDays(s, 6)); }}>Next week</Chip>
      </div>
      <div className="row wrap" style={{ gap: 12 }}>
        <div className="field"><label htmlFor="sg-from">From</label><input id="sg-from" className="input" type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} style={{ maxWidth: 180 }} /></div>
        <div className="field"><label htmlFor="sg-to">To</label><input id="sg-to" className="input" type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} style={{ maxWidth: 180 }} /></div>
      </div>
      <div className="field"><label htmlFor="sg-name">Name (optional)</label><input id="sg-name" className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="e.g. Weekly shop" /></div>

      <section className="stack" aria-labelledby="sg-meals">
        <h3 id="sg-meals">Meals to shop for</h3>
        {inRange.length === 0
          ? <Empty title="No meals with a recipe in these dates">Plan meals from a recipe or one of your dishes first. Meals you only logged by name add nothing here.</Empty>
          : inRange.map((e) => (
            <div className="card row between wrap" key={e.id} style={{ gap: 8, padding: 12 }}>
              <label className="row grow" style={{ gap: 10, minHeight: 44 }}>
                <input type="checkbox" checked={!off.includes(e.id)} onChange={(ev) => setOff((o) => (ev.target.checked ? o.filter((x) => x !== e.id) : [...o, e.id]))} style={{ width: 22, height: 22 }} aria-label={`Include ${e.name} on ${formatDay(e.date, today)}`} />
                <span><b>{e.name}</b><br /><span className="small muted">{formatDay(e.date, today)} · {e.slot}</span></span>
              </label>
              <ServingsStepper value={e.servings} label={`Servings of ${e.name}`} onChange={(n) => dispatch({ type: 'MEAL_SAVE', entry: { ...e, servings: n } })} />
            </div>
          ))}
        {quiet.length > 0 && <p className="small muted">{quiet.length} meal{quiet.length === 1 ? '' : 's'} in these dates add nothing (leftovers or meals logged without a recipe): {quiet.map((q) => q.name).slice(0, 4).join(', ')}{quiet.length > 4 ? '…' : ''}.</p>}
      </section>
      {parts.length > 0 && <Hint icon={I.info}>{preview.length} item{preview.length === 1 ? '' : 's'} from {parts.length} meal{parts.length === 1 ? '' : 's'}, scaled to the servings above. Amounts that cannot be added up (like grams and pieces of the same food) stay as separate lines. You can add your own items afterwards.</Hint>}
    </Sheet>
  );
};

// ───────────── review a proposed update ─────────────
export const ShopReviewSheet = ({ listId }: { listId: string }) => {
  const { data, closeSheet, dispatch, toast } = useApp();
  const list = data.shopping.lists.find((l) => l.id === listId);
  const fresh = list ? freshItemsFor(data, list) : null;
  const up = list && fresh ? proposeUpdate(list, fresh.items) : null;
  if (!list || !up || !fresh) return <Sheet title="Update list" onClose={closeSheet}><p>This list already matches your meal plan.</p><Button onClick={closeSheet}>Close</Button></Sheet>;
  const line = (c: (typeof up.changes)[number]): string => {
    switch (c.kind) {
      case 'add': return `Add ${itemText(c.item)}`;
      case 'remove': return c.kept ? `${itemText(c.item)} is no longer needed, but you already bought it, so it stays` : `Remove ${itemText(c.item)} (no meal needs it)`;
      case 'qty': return `${c.item.name}: ${formatAmount(c.from, c.item.unit) || 'no amount'} → ${formatAmount(c.to, c.item.unit) || 'no amount'}`;
      case 'sources': return `${c.item.name}: a different meal now needs it (same amount)`;
    }
  };
  return (
    <Sheet title="Your meal plan changed" onClose={closeSheet}
      footer={<><Button variant="secondary" onClick={() => { dispatch({ type: 'SHOP_IGNORE', listId, signature: up.signature }); closeSheet(); toast('Left as it is. You will only be asked again if the plan changes more.'); }}>Not now</Button>
        <Button icon={I.check} onClick={() => { const before = list; dispatch({ type: 'SHOP_APPLY', listId, next: up.next, entryIds: fresh.entryIds }); closeSheet(); toast('List updated.', { label: 'Undo', run: () => dispatch({ type: 'SHOP_APPLY', listId, next: before.items, entryIds: before.entryIds }) }); }}>Update my list</Button></>}>
      <p>Since you made <b>{list.name}</b>, your meals changed. Here is what would change in the list:</p>
      <ul className="stack" style={{ margin: 0, paddingLeft: 18 }} aria-label="Proposed changes">{up.changes.map((c, i) => <li key={i} className="small">{line(c)}</li>)}</ul>
      <Hint icon={I.shield}>Items you added yourself, what you have already ticked off, what you marked as at home, and any amount you changed by hand are kept exactly as they are.</Hint>
    </Sheet>
  );
};

// ───────────── one item ─────────────
export const ShopItemSheet = ({ listId, itemId }: { listId: string; itemId?: string }) => {
  const { data, closeSheet, dispatch, toast } = useApp();
  const list = data.shopping.lists.find((l) => l.id === listId);
  const item = list?.items.find((i) => i.id === itemId);
  const [name, setName] = useState(item?.name ?? '');
  const [qty, setQty] = useState(item?.qty === null || item?.qty === undefined ? '' : String(item.qty));
  const [unit, setUnit] = useState<Unit | ''>(item?.unit ?? '');
  const [category, setCategory] = useState(item?.category ?? 'other');
  const [note, setNote] = useState(item?.note ?? '');
  if (!list) return <Sheet title="Item" onClose={closeSheet}><p>This list is gone.</p></Sheet>;
  const pantry = item ? data.shopping.pantry.includes(item.key) : false;
  const save = () => {
    const q = qty.trim() === '' ? null : Number(qty.replace(',', '.'));
    const quantity = q !== null && Number.isFinite(q) && q >= 0 ? q : null;
    if (item) {
      const changed = quantity !== item.qty || (quantity !== null && (unit || null) !== item.unit);
      dispatch({ type: 'SHOP_ITEM_SAVE', listId, item: { ...item, name: item.manual ? name.trim() || item.name : item.name, qty: quantity, unit: quantity === null ? null : (unit || item.unit || 'piece'), category, note: note.trim(), edited: item.manual ? false : item.edited || changed } });
    } else {
      if (!name.trim()) return;
      const m = manualItem(name, quantity, (unit || 'piece') as Unit);
      dispatch({ type: 'SHOP_ITEM_SAVE', listId, item: { ...m, category: identify(name).known ? m.category : category, note: note.trim() } });
    }
    closeSheet();
  };
  return (
    <Sheet title={item ? 'Edit item' : 'Add an item'} onClose={closeSheet}
      footer={<><Button variant="secondary" onClick={closeSheet}>Cancel</Button><Button icon={I.check} onClick={save} disabled={!item && !name.trim()}>Save</Button></>}>
      <div className="field"><label htmlFor="si-name">Item</label><input id="si-name" className="input" data-autofocus value={name} readOnly={!!item && !item.manual} maxLength={100} onChange={(e) => setName(e.target.value)} /></div>
      <div className="row wrap" style={{ gap: 8 }}>
        <div className="field"><label htmlFor="si-qty">Amount</label><input id="si-qty" className="input" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} style={{ width: 110 }} /></div>
        <div className="field"><label htmlFor="si-unit">Unit</label><select id="si-unit" className="select" value={unit} onChange={(e) => setUnit(e.target.value as Unit | '')}><option value="">none</option>{UNITS.map((u) => <option key={u} value={u}>{u === 'piece' ? 'whole / piece' : u}</option>)}</select></div>
      </div>
      <div className="field"><label htmlFor="si-cat">Aisle</label><select id="si-cat" className="select" value={category} onChange={(e) => setCategory(e.target.value as ShoppingItem['category'])}>{SHOP_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}</select></div>
      <div className="field"><label htmlFor="si-note">Note (optional)</label><input id="si-note" className="input" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} /></div>
      {item && !item.manual && item.edited && <Button variant="soft" size="sm" onClick={() => { const f = freshItemsFor(data, list).items.find((x) => x.id === item.id); if (f) dispatch({ type: 'SHOP_ITEM_SAVE', listId, item: { ...item, qty: f.qty, unit: f.unit, edited: false } }); closeSheet(); }}>Go back to the amount the plan needs</Button>}
      {item && (
        <div className="row wrap" style={{ gap: 8 }}>
          <Button variant="soft" size="sm" aria-pressed={pantry} onClick={() => dispatch({ type: 'PANTRY', key: item.key, on: !pantry })}>{pantry ? 'Always at home ✓' : 'I always have this'}</Button>
          <Button variant="ghost" size="sm" icon={I.trash} onClick={() => { const it = item; dispatch({ type: 'SHOP_ITEM_DELETE', listId, itemId: it.id }); closeSheet(); toast('Item removed.', { label: 'Undo', run: () => dispatch({ type: 'SHOP_ITEM_SAVE', listId, item: it }) }); }}>Remove</Button>
        </div>
      )}
      {item && item.sources.length > 0 && (
        <section className="stack" aria-labelledby="si-src"><h3 id="si-src">Needed for</h3>
          <ul style={{ margin: 0, paddingLeft: 18 }}>{item.sources.map((s, i) => <li key={i} className="small">{s.recipe}{s.date ? ` · ${formatDay(s.date, data.plan.startDate)}` : ''}{s.qty !== null ? ` · ${formatAmount(s.qty, s.unit)}` : ''}</li>)}</ul>
        </section>
      )}
    </Sheet>
  );
};

// ───────────── the tab ─────────────
const ItemRow = ({ list, item }: { list: ShoppingList; item: ShoppingItem }) => {
  const { dispatch, openSheet } = useApp();
  const text = itemText(item);
  return (
    <li className="card" style={{ padding: 10, listStyle: 'none', opacity: item.atHome ? 0.7 : 1 }} data-testid="shop-item" data-checked={item.checked} data-home={item.atHome}>
      <div className="row between" style={{ gap: 8, alignItems: 'flex-start' }}>
        <label className="row grow" style={{ gap: 10, minHeight: 44, alignItems: 'flex-start' }}>
          <input type="checkbox" checked={item.checked} onChange={(e) => dispatch({ type: 'SHOP_ITEM_CHECK', listId: list.id, itemId: item.id, checked: e.target.checked })} style={{ width: 24, height: 24, marginTop: 10 }} aria-label={`Bought: ${text}`} />
          <span style={{ paddingTop: 8, textDecoration: item.checked ? 'line-through' : 'none' }}>
            <b>{text}</b>{item.optional ? <> <Tag kind="lav">optional</Tag></> : null}{item.manual ? <> <Tag>yours</Tag></> : null}{item.atHome ? <> <Tag kind="green">at home</Tag></> : null}
            {item.note && <><br /><span className="small muted">{item.note}</span></>}
            {item.sources.length > 0 && <><br /><span className="xs muted">For {[...new Set(item.sources.map((s) => s.recipe))].slice(0, 3).join(', ')}{new Set(item.sources.map((s) => s.recipe)).size > 3 ? '…' : ''}</span></>}
          </span>
        </label>
        <span className="row" style={{ gap: 4 }}>
          <Button size="sm" variant="ghost" aria-pressed={item.atHome} onClick={() => dispatch({ type: 'SHOP_ITEM_HOME', listId: list.id, itemId: item.id, atHome: !item.atHome })} aria-label={item.atHome ? `${text}: I need to buy it after all` : `${text}: already at home`}>{item.atHome ? 'Need it' : 'Have it'}</Button>
          <Button size="sm" variant="ghost" icon={I.pencil} aria-label={`Edit ${text}`} onClick={() => openSheet({ kind: 'shopItem', listId: list.id, itemId: item.id })} />
        </span>
      </div>
    </li>
  );
};

export const ShoppingTab = ({ listId }: { listId: string | null }) => {
  const { data, openSheet, dispatch, toast, confirm } = useApp();
  const lists = data.shopping.lists;
  const active = lists.find((l) => l.id === listId) ?? lists[lists.length - 1] ?? null;
  const [name, setName] = useState('');
  const [qty, setQty] = useState('');
  const [unit, setUnit] = useState<Unit | ''>('');
  const fresh = active ? freshItemsFor(data, active) : null;
  const update = active && fresh ? proposeUpdate(active, fresh.items) : null;

  if (!lists.length) {
    return (
      <div className="stack">
        <Empty icon={I.store} title="No shopping lists yet">Plan some meals, then make a list for the days you choose. Amounts are worked out from the servings you plan, and you can add anything of your own.</Empty>
        <div className="row wrap" style={{ gap: 8, justifyContent: 'center' }}><Button icon={I.list} onClick={() => openSheet({ kind: 'shopGen' })}>Make a list from my meals</Button></div>
      </div>
    );
  }
  if (!active) return null;
  const toBuy = active.items.filter((i) => !i.atHome && !i.checked && !i.optional);
  const bought = active.items.filter((i) => i.checked && !i.atHome);
  const home = active.items.filter((i) => i.atHome);
  const text = exportText(active);
  const share = async () => {
    try { if (navigator.share) { await navigator.share({ title: active.name, text }); return; } } catch { /* cancelled */ }
    try { await navigator.clipboard.writeText(text); toast('Copied. Paste it into Notes, Messages or Reminders.'); } catch { downloadText(`${active.name}.txt`, text); }
  };
  const add = () => {
    if (!name.trim()) return;
    const q = qty.trim() === '' ? null : Number(qty.replace(',', '.'));
    const item = manualItem(name, q !== null && Number.isFinite(q) && q > 0 ? q : null, (unit || 'piece') as Unit);
    dispatch({ type: 'SHOP_ITEM_SAVE', listId: active.id, item });
    setName(''); setQty(''); setUnit('');
    toast(`Added ${item.name}.`, { label: 'Undo', run: () => dispatch({ type: 'SHOP_ITEM_DELETE', listId: active.id, itemId: item.id }) });
  };
  return (
    <div className="stack">
      <div className="row between wrap" style={{ gap: 8 }}>
        <div className="chips" role="radiogroup" aria-label="Shopping lists">{lists.map((l) => <Chip key={l.id} role="radio" on={l.id === active.id} onClick={() => { window.location.hash = `#/meals?tab=shopping&list=${l.id}`; }}>{l.name}</Chip>)}</div>
        <Button size="sm" icon={I.plus} onClick={() => openSheet({ kind: 'shopGen' })}>New list</Button>
      </div>

      {update && (
        <div className="card tint stack" role="status" data-testid="shop-update">
          <div className="row"><I.info size={20} aria-hidden /><h3>Your meal plan changed</h3></div>
          <p className="small">{update.changes.filter((c) => c.kind === 'add').length} to add · {update.changes.filter((c) => c.kind === 'remove').length} to remove · {update.changes.filter((c) => c.kind === 'qty').length} amount{update.changes.filter((c) => c.kind === 'qty').length === 1 ? '' : 's'} changed. Nothing changes until you say so.</p>
          <div className="row wrap" style={{ gap: 8 }}><Button size="sm" onClick={() => openSheet({ kind: 'shopReview', listId: active.id })}>Review the changes</Button></div>
        </div>
      )}
      {fresh && fresh.missing > 0 && <p className="small muted">{fresh.missing} planned meal{fresh.missing === 1 ? ' uses' : 's use'} a dish that was deleted, so {fresh.missing === 1 ? 'it adds' : 'they add'} nothing here.</p>}

      <div className="row between wrap"><h2 className="h3">{active.name}</h2><span className="small muted" aria-live="polite">{toBuy.length} to buy · {bought.length} bought{home.length ? ` · ${home.length} at home` : ''}</span></div>

      <div className="card stack" aria-label="Add your own item">
        <div className="row wrap" style={{ gap: 6 }}>
          <input className="input" aria-label="Item to add" placeholder="Add your own item" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} style={{ flex: '2 1 160px' }} />
          <input className="input" aria-label="Amount" placeholder="Amount" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} style={{ flex: '1 1 70px', minWidth: 70 }} />
          <select className="select" aria-label="Unit" value={unit} onChange={(e) => setUnit(e.target.value as Unit | '')} style={{ flex: '1 1 90px', minWidth: 90 }}><option value="">unit</option>{UNITS.map((u) => <option key={u} value={u}>{u === 'piece' ? 'whole / piece' : u}</option>)}</select>
          <Button icon={I.plus} onClick={add} disabled={!name.trim()}>Add</Button>
        </div>
      </div>

      {active.items.length === 0 && <Empty title="This list is empty">Add something above, or plan meals with a recipe and make a new list.</Empty>}
      {SHOP_CATEGORIES.map((cat) => {
        const here = sortItems(active.items.filter((i) => i.category === cat));
        if (!here.length) return null;
        return (
          <section className="stack" key={cat} aria-labelledby={`cat-${cat}`}>
            <h3 id={`cat-${cat}`} className="small strong" style={{ textTransform: 'uppercase', letterSpacing: '.04em' }}>{CATEGORY_LABEL[cat]} <span className="muted">· {here.length}</span></h3>
            <ul className="stack" style={{ margin: 0, padding: 0, gap: 6 }}>{here.map((i) => <ItemRow key={i.id} list={active} item={i} />)}</ul>
          </section>
        );
      })}

      <div className="row wrap" style={{ gap: 8 }}>
        <Button variant="secondary" icon={I.arrow} onClick={() => { void share(); }}>{typeof navigator !== 'undefined' && 'share' in navigator ? 'Share' : 'Copy to share'}</Button>
        <Button variant="secondary" onClick={() => downloadText(`${active.name}.txt`, text)}>Download as text</Button>
        <Button variant="ghost" icon={I.trash} onClick={() => confirm({ title: 'Delete this list?', body: <p>"{active.name}" will be deleted. Your meal plan is not touched.</p>, confirmLabel: 'Delete the list', danger: true, onConfirm: () => { const l = active; dispatch({ type: 'SHOP_DELETE', id: l.id }); toast('List deleted.', { label: 'Undo', run: () => dispatch({ type: 'SHOP_CREATE', list: l }) }); } })}>Delete list</Button>
      </div>
      <p className="xs muted">Amounts are scaled from each recipe; counted things (cans, cloves, pieces) are rounded up to whole ones. {listEntries(data, active).entries.length} meal{listEntries(data, active).entries.length === 1 ? '' : 's'} feed this list.</p>
    </div>
  );
};
