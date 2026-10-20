import { createContext, useContext, useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { sameState, shapeOk, type ScopeInfo } from './drafts';
import { useDrafts } from './draftsContext';
import { useApp } from './store';

interface ScopeValue { info: ScopeInfo; restored: { current: boolean } }
const Ctx = createContext<ScopeValue | null>(null);

/**
 * Marks the form inside it as one whose state is kept per account while the person is typing (state/drafts.ts says what is kept and when it
 * is written down). It draws nothing and changes nothing about the form; the form's own fields opt in with useDraftState. When a form
 * opens with state put back from an earlier draft it says so, once. With no account (local mode) it is just its children.
 */
export const DraftScope = ({ scope, children }: { scope: ScopeInfo; children: ReactNode }) => {
  const drafts = useDrafts();
  const { toast } = useApp();
  const restored = useRef(false);
  const told = useRef(false);
  const say = useRef(toast);
  say.current = toast;
  // The form's fields have already started (children's initial state runs before this effect): if any of them took a draft's value, say so.
  useEffect(() => {
    if (restored.current && !told.current) { told.current = true; say.current('We put back the text you had typed. Nothing was saved or sent.'); }
  }, []);
  const value = useMemo(() => ({ info: scope, restored }), [scope]);
  if (!drafts) return <>{children}</>;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
};

/**
 * `useState` for a piece of a form that is kept while the person types. Behaves exactly like `useState` (and does nothing more) without an
 * account. With one, it starts from the state kept for this form if there is some, and tells the registry whenever it changes.
 *
 * `kind` says what the piece is: 'text' for something typed into a field; 'choice' (the default) for an option, a toggle or the rows added with
 * a button, which are kept so the text can be put back where it belongs but never make a draft by themselves; or a function that says whether
 * a value holds typed text (for rows). A piece equal to what the form starts with is not kept.
 */
export function useDraftState<T>(key: string, initial: T | (() => T), kind: 'text' | 'choice' | ((v: T) => boolean) = 'choice'): [T, Dispatch<SetStateAction<T>>] {
  const ctx = useContext(Ctx);
  const drafts = useDrafts();
  const start = useRef<{ v: T } | null>(null);
  const [value, setValue] = useState<T>(() => {
    const dflt = typeof initial === 'function' ? (initial as () => T)() : initial;
    start.current = { v: dflt };
    if (ctx && drafts) {
      const saved = drafts.stateOf(ctx.info.id, key);
      if (saved !== undefined && shapeOk(dflt, saved)) { ctx.restored.current = true; return saved as T; }
    }
    return dflt;
  });
  useEffect(() => {
    if (!ctx || !drafts) return;
    const dirty = !sameState(value, start.current?.v);
    const text = dirty && (kind === 'text' ? typeof value === 'string' && value !== '' : typeof kind === 'function' ? kind(value) : false);
    drafts.capture(ctx.info, key, value, text, dirty);
  }, [ctx, drafts, key, value, kind]);
  return [value, setValue];
}
