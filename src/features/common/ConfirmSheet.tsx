import { useState } from 'react';
import type { ConfirmOptions } from '../../state/store';
import { useApp } from '../../state/store';
import { Button, Sheet } from '../../ui/primitives';

/** A calm "are you sure?" for anything that replaces the user's data. */
export const ConfirmSheet = (o: ConfirmOptions) => {
  const { closeSheet } = useApp();
  const [used, setUsed] = useState(false);
  const locked = !!o.requireExtra && !used;
  return (
    <Sheet title={o.title} onClose={closeSheet} label={o.title}
      footer={(
        <>
          <Button variant="secondary" onClick={closeSheet} data-autofocus>{o.cancelLabel ?? 'Cancel'}</Button>
          {o.extra && <Button variant="soft" onClick={() => { setUsed(true); o.extra!.run(); }}>{o.extra.label}</Button>}
          <Button variant={o.danger ? 'danger' : 'primary'} disabled={locked} aria-disabled={locked} onClick={() => { closeSheet(); o.onConfirm(); }}>{o.confirmLabel}</Button>
        </>
      )}>
      <div className="stack">{typeof o.body === 'string' ? <p>{o.body}</p> : o.body}</div>
    </Sheet>
  );
};
