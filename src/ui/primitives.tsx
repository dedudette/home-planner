import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { I, type IconType } from './icons';

export const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(' ');

// ───────────── Button / Chip ─────────────
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'soft' | 'danger'; size?: 'sm' | 'md' | 'lg'; block?: boolean; icon?: IconType };
export const Button = ({ variant = 'primary', size = 'md', block, icon: Icon, className, children, type = 'button', ...rest }: BtnProps) => (
  <button type={type} className={cx('btn', variant !== 'primary' && variant, size !== 'md' && size, block && 'block', className)} {...rest}>
    {Icon && <Icon size={size === 'sm' ? 16 : 20} aria-hidden />}
    {children}
  </button>
);

export const IconButton = ({ icon: Icon, label, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: IconType; label: string }) => (
  <button type="button" className={cx('icon-btn', className)} aria-label={label} title={label} {...rest}>
    <Icon size={22} aria-hidden />
  </button>
);

export const Chip = ({ on, small, children, onClick, role, ...rest }: { on?: boolean; small?: boolean; children: ReactNode; onClick?: () => void; role?: string } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'>) => (
  <button type="button" className={cx('chip', small && 'sm')} aria-pressed={role ? undefined : !!on} aria-checked={role ? !!on : undefined} role={role} onClick={onClick} {...rest}>
    {children}
  </button>
);

export const Tag = ({ kind, children }: { kind?: string; children: ReactNode }) => <span className={cx('tag', kind)}>{children}</span>;

export const PriorityTag = ({ p }: { p: 'URGENT' | 'HIGH' | 'MEDIUM' | 'LOW' }) => <Tag kind={p}>{p === 'URGENT' ? 'Urgent' : p === 'HIGH' ? 'High' : p === 'MEDIUM' ? 'Medium' : 'Low'} priority</Tag>;

export const Segmented = <T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string }) => (
  <div className="seg" role="tablist" aria-label={label}>
    {options.map((o) => (
      <button key={o.value} role="tab" aria-selected={value === o.value} onClick={() => onChange(o.value)}>{o.label}</button>
    ))}
  </div>
);

// ───────────── Layout bits ─────────────
export const PageHead = ({ title, sub, action }: { title: ReactNode; sub?: ReactNode; action?: ReactNode }) => (
  <div className="page-head">
    <div>
      <h1>{title}</h1>
      {sub && <p className="muted">{sub}</p>}
    </div>
    {action}
  </div>
);

export const Empty = ({ icon: Icon = I.sparkles, title, children }: { icon?: IconType; title: string; children?: ReactNode }) => (
  <div className="empty">
    <Icon size={34} aria-hidden />
    <h3 style={{ marginTop: 8 }}>{title}</h3>
    {children && <div className="small" style={{ marginTop: 6 }}>{children}</div>}
  </div>
);

export const Hint = ({ children, icon: Icon = I.info }: { children: ReactNode; icon?: IconType }) => (
  <div className="hint"><Icon size={18} aria-hidden /><div>{children}</div></div>
);

// ───────────── Sheet (bottom sheet / dialog) ─────────────
export const Sheet = ({ title, onClose, children, footer, full, label }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; full?: boolean; label?: string }) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    el?.querySelector<HTMLElement>('[data-autofocus], button, input, select, textarea, a[href]')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
      if (e.key === 'Tab' && el) {
        const f = [...el.querySelectorAll<HTMLElement>('button:not([disabled]), input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])')].filter((x) => x.offsetParent !== null);
        if (!f.length) return;
        const first = f[0]; const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey, true);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey, true); document.body.style.overflow = prevOverflow; prev?.focus?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={cx('sheet', full && 'full')} role="dialog" aria-modal="true" aria-label={label ?? (typeof title === 'string' ? title : 'Dialog')} ref={ref}>
        <div className="sheet-head">
          <h2>{title}</h2>
          <IconButton icon={I.x} label="Close" onClick={onClose} />
        </div>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>
  );
};

// ───────────── Charts (SVG, no deps) ─────────────
export const ProgressBar = ({ value, label }: { value: number; label?: string }) => (
  <div className="progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)} aria-label={label}>
    <div className="progress-fill" style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
  </div>
);

export const RingStat = ({ value, label, sub, size = 84 }: { value: number; label: string; sub: string; size?: number }) => {
  const r = 34; const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  return (
    <div className="ring-stat">
      <svg viewBox="0 0 84 84" width={size} height={size} aria-hidden>
        <circle cx="42" cy="42" r={r} fill="none" strokeWidth="9" className="ring-bg" />
        <circle cx="42" cy="42" r={r} fill="none" strokeWidth="9" className="ring-fg" strokeDasharray={c} strokeDashoffset={c * (1 - v)} />
      </svg>
      <div>
        <div className="strong" style={{ fontSize: '1.5rem', fontFamily: 'var(--font-head)' }}>{Math.round(v * 100)}%</div>
        <div className="small strong">{label}</div>
        <div className="xs muted">{sub}</div>
      </div>
    </div>
  );
};

export const BarChart = ({ data, unit, label }: { data: { label: string; value: number }[]; unit: string; label: string }) => {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="bars" role="img" aria-label={`${label}: ${data.map((d) => `${d.label} ${d.value} ${unit}`).join(', ')}`}>
      {data.map((d) => (
        <div className="b" key={d.label}>
          <span className="val">{d.value > 0 ? d.value : ''}</span>
          <div className={cx('col', d.value === 0 && 'zero')} style={{ height: `${Math.max(4, (d.value / max) * 82)}%` }} />
          <span className="lab">{d.label}</span>
        </div>
      ))}
    </div>
  );
};

export const Dots = ({ n, of = 3 }: { n: number; of?: number }) => (
  <span className="dots" aria-hidden>
    {Array.from({ length: of }, (_, i) => <i key={i} className={i < n ? 'on' : ''} />)}
  </span>
);
