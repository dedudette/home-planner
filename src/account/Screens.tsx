import { useEffect, useRef, type ReactNode } from 'react';
import { exportJSON } from '../storage/repository';
import { downloadText } from '../ui/download';
import { I } from '../ui/icons';
import { Button } from '../ui/primitives';
import { readLegacyData } from './legacy';

/** The plain page every account screen sits on: one centred column, a heading that receives focus when the screen changes. */
export const AuthFrame = ({ title, lead, children, footer, wide }: { title: string; lead?: ReactNode; children?: ReactNode; footer?: ReactNode; wide?: boolean }) => {
  const h = useRef<HTMLHeadingElement>(null);
  useEffect(() => { h.current?.focus({ preventScroll: true }); }, [title]);
  return (
    <main className="auth" aria-labelledby="auth-title">
      <div className={wide ? 'auth-card wide' : 'auth-card'}>
        <div className="auth-brand"><I.sparkles size={22} aria-hidden /><span>CleanFlow</span></div>
        <section className="card stack-lg">
          <div className="stack">
            <h1 id="auth-title" ref={h} tabIndex={-1} className="auth-title">{title}</h1>
            {lead && <p className="muted">{lead}</p>}
          </div>
          {children}
        </section>
        {footer && <div className="auth-foot small muted">{footer}</div>}
      </div>
    </main>
  );
};

export const Notice = ({ kind = 'info', children }: { kind?: 'info' | 'error' | 'good'; children: ReactNode }) => (
  <div className={`auth-notice ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
    {kind === 'error' ? <I.alert size={18} aria-hidden /> : kind === 'good' ? <I.checkCircle size={18} aria-hidden /> : <I.info size={18} aria-hidden />}
    <div>{children}</div>
  </div>
);

export const ServerUnreachable = ({ onRetry, failed }: { onRetry: () => void; failed?: boolean }) => (
  <AuthFrame
    title={failed ? 'Something went wrong' : 'Cannot reach the server'}
    lead={failed ? 'The server answered, but not in a way the app could use. Nothing was changed.' : 'This app signs you in through a server, and it cannot be reached right now. Your data on this device is safe and has not been changed.'}
  >
    <Button onClick={onRetry} block>Try again</Button>
  </AuthFrame>
);

/** Shown once, right after a person's first sign-in on a device that already holds data from before accounts. */
export const LegacyNoticeScreen = ({ userId, onContinue }: { userId: string; onContinue: () => void }) => {
  void userId;
  const legacy = readLegacyData();
  return (
    <AuthFrame
      title="Your earlier data is safe"
      lead={legacy
        ? `This device already holds a plan from before accounts${legacy.name ? ` (for ${legacy.name})` : ''}: ${legacy.entries} logged action${legacy.entries === 1 ? '' : 's'} across ${legacy.days} day${legacy.days === 1 ? '' : 's'}. It has not been touched or uploaded anywhere.`
        : 'This device holds data from before accounts. It has not been touched or uploaded anywhere.'}
    >
      <p className="small">Your account starts with its own, empty plan. Moving your earlier data into it is not available yet. You can download a copy now, and you will find the same download in Settings under Account.</p>
      <div className="stack">
        {legacy && <Button variant="secondary" onClick={() => downloadText(`cleanflow-before-accounts-${new Date().toISOString().slice(0, 10)}.json`, exportJSON(legacy.data))}>Download my earlier data</Button>}
        <Button onClick={onContinue}>Continue</Button>
      </div>
    </AuthFrame>
  );
};
