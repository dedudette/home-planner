import { useApp } from '../../state/store';
import { I, type IconType } from '../../ui/icons';
import { PageHead } from '../../ui/primitives';
import { sectionsFor, SETTINGS_ITEM } from '../nav';

const Row = ({ href, onClick, icon: Icon, title, sub }: { href?: string; onClick?: () => void; icon: IconType; title: string; sub: string }) => {
  const inner = <><span className="ic" style={{ width: 44, height: 44, borderRadius: 14, background: 'var(--primary-soft)', color: 'var(--primary)', display: 'grid', placeItems: 'center' }}><Icon size={22} aria-hidden /></span><span className="grow"><b>{title}</b><br /><span className="small muted">{sub}</span></span><I.right size={20} aria-hidden /></>;
  return href ? <a className="card row" style={{ textDecoration: 'none', color: 'inherit' }} href={href}>{inner}</a> : <button className="card row" style={{ textAlign: 'left', width: '100%' }} onClick={onClick}>{inner}</button>;
};

/** The phone's "everything else": the sections that are switched on, the quick tools, and Settings. */
export const More = () => {
  const { openSheet, data } = useApp();
  const sections = sectionsFor(data);
  return (
    <div className="page">
      <PageHead title="More" sub={data.user.name ? `Hi ${data.user.name}` : undefined} />
      <div className="stack">
        <h2 className="h3" id="more-sections">Your sections</h2>
        {sections.map((s) => <Row key={s.path} href={`#/${s.path}`} icon={s.icon} title={s.label} sub={s.sub} />)}
        <h2 className="h3" id="more-tools" style={{ marginTop: 8 }}>Quick tools</h2>
        <Row onClick={() => openSheet({ kind: 'activityForm' })} icon={I.cal} title="Plan an activity" sub="A workout, meal prep, practice or routine, once or repeating" />
        <Row onClick={() => openSheet({ kind: 'taskForm' })} icon={I.plus} title="Add your own task" sub="One-off or repeating" />
        <Row onClick={() => openSheet({ kind: 'five' })} icon={I.timer} title="Just 5 minutes" sub="One tiny task" />
        <Row href="#/patterns" icon={I.chart} title="Your patterns" sub="What the app recorded, plus optional AI suggestions" />
        <Row href={`#/${SETTINGS_ITEM.path}`} icon={SETTINGS_ITEM.icon} title={SETTINGS_ITEM.label} sub={SETTINGS_ITEM.sub} />
      </div>
    </div>
  );
};
