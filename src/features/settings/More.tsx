import { useApp } from '../../state/store';
import { I, type IconType } from '../../ui/icons';
import { PageHead } from '../../ui/primitives';

export const More = () => {
  const { openSheet, data } = useApp();
  const Row = ({ href, onClick, icon: Icon, title, sub }: { href?: string; onClick?: () => void; icon: IconType; title: string; sub: string }) => {
    const inner = <><span className="ic" style={{ width: 44, height: 44, borderRadius: 14, background: 'var(--primary-soft)', color: 'var(--primary)', display: 'grid', placeItems: 'center' }}><Icon size={22} aria-hidden /></span><span className="grow"><b>{title}</b><br /><span className="small muted">{sub}</span></span><I.right size={20} aria-hidden /></>;
    return href ? <a className="card row" style={{ textDecoration: 'none', color: 'inherit' }} href={href}>{inner}</a> : <button className="card row" style={{ textAlign: 'left', width: '100%' }} onClick={onClick}>{inner}</button>;
  };
  return (
    <div className="page">
      <PageHead title="More" sub={data.user.name ? `Hi ${data.user.name}` : undefined} />
      <div className="stack">
        <Row href="#/home" icon={I.home} title="My Home" sub="Rooms, people, pets and preferences" />
        <Row href="#/supplies" icon={I.package} title="Cleaning supplies" sub="What you own and what you can clean with it" />
        <Row onClick={() => openSheet({ kind: 'taskForm' })} icon={I.plus} title="Add your own task" sub="One-off or repeating" />
        <Row onClick={() => openSheet({ kind: 'five' })} icon={I.timer} title="Just 5 minutes" sub="One tiny task" />
        <Row href="#/settings" icon={I.settings} title="Settings" sub="Demo homes, export, backup and reset" />
      </div>
    </div>
  );
};
