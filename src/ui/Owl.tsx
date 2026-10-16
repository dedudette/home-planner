import type { CSSProperties } from 'react';

export type OwlState = 'idle' | 'thinking' | 'success' | 'unavailable';

/**
 * The owl: CleanFlow's helper. Original vector artwork drawn from a few simple shapes, coloured from the page's own colour variables so it
 * follows every palette and both themes. It has four calm states: idle (an occasional blink), thinking (head tilted, three dots),
 * success (happy eyes) and unavailable (asleep). With reduced motion it does not move at all and the states still read from the drawing.
 * It is decorative unless given a label, and it is never placed over a control.
 */
export const Owl = ({ state = 'idle', size = 56, label, className, style }: { state?: OwlState; size?: number; label?: string; className?: string; style?: CSSProperties }) => {
  const asleep = state === 'unavailable';
  const happy = state === 'success';
  return (
    <svg className={`owl owl-${state}${className ? ` ${className}` : ''}`} viewBox="0 0 120 120" width={size} height={size} style={style} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} focusable="false">
      <g className="owl-all">
        {/* feet */}
        <ellipse cx="46" cy="112" rx="9" ry="4" fill="#d9a441" /><ellipse cx="74" cy="112" rx="9" ry="4" fill="#d9a441" />
        {/* body and ear tufts */}
        <path d="M26 34 L36 14 L48 30 Z" fill="var(--primary)" /><path d="M94 34 L84 14 L72 30 Z" fill="var(--primary)" />
        <ellipse cx="60" cy="66" rx="36" ry="42" fill="var(--primary)" />
        <ellipse cx="60" cy="78" rx="22" ry="27" fill="var(--primary-soft)" />
        {/* wings */}
        <ellipse cx="27" cy="74" rx="9" ry="22" fill="var(--primary-hover)" transform="rotate(8 27 74)" /><ellipse cx="93" cy="74" rx="9" ry="22" fill="var(--primary-hover)" transform="rotate(-8 93 74)" />
        {/* eyes */}
        <g className="owl-eyes">
          {asleep ? (
            <><path d="M34 54 Q45 62 56 54" fill="none" stroke="var(--primary-ink)" strokeWidth="4" strokeLinecap="round" /><path d="M64 54 Q75 62 86 54" fill="none" stroke="var(--primary-ink)" strokeWidth="4" strokeLinecap="round" /></>
          ) : happy ? (
            <><circle cx="45" cy="52" r="13" fill="var(--surface)" /><circle cx="75" cy="52" r="13" fill="var(--surface)" /><path d="M36 54 Q45 44 54 54" fill="none" stroke="var(--ink)" strokeWidth="4" strokeLinecap="round" /><path d="M66 54 Q75 44 84 54" fill="none" stroke="var(--ink)" strokeWidth="4" strokeLinecap="round" /></>
          ) : (
            <><circle cx="45" cy="52" r="13" fill="var(--surface)" /><circle cx="75" cy="52" r="13" fill="var(--surface)" />
              <circle className="owl-pupil" cx={45} cy={state === 'thinking' ? 49 : 53} r="6" fill="var(--ink)" /><circle className="owl-pupil" cx={75} cy={state === 'thinking' ? 49 : 53} r="6" fill="var(--ink)" />
              <circle cx="47" cy={state === 'thinking' ? 47 : 51} r="1.8" fill="var(--surface)" /><circle cx="77" cy={state === 'thinking' ? 47 : 51} r="1.8" fill="var(--surface)" /></>
          )}
        </g>
        {/* beak */}
        <path d="M54 62 L66 62 L60 73 Z" fill="#d9a441" />
        {state === 'thinking' && <g className="owl-dots" fill="var(--primary)"><circle cx="86" cy="14" r="3" /><circle cx="96" cy="8" r="3.6" /><circle cx="108" cy="4" r="4.2" /></g>}
        {asleep && <text x="88" y="22" fontSize="16" fontWeight="700" fill="var(--muted)">z</text>}
        {happy && <path className="owl-spark" d="M92 20 l3 7 7 3 -7 3 -3 7 -3 -7 -7 -3 7 -3 Z" fill="var(--primary)" />}
      </g>
    </svg>
  );
};
