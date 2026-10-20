import { useEffect, useRef, type ReactNode } from 'react';
import type { ScopeInfo } from './drafts';
import { useDrafts } from './draftsContext';
import { useApp } from './store';

const TEXT_TYPES = new Set(['', 'text', 'search', 'number', 'date', 'time', 'tel', 'url', 'email']);
type Field = HTMLInputElement | HTMLTextAreaElement;

/** A control whose typed text can be kept: a text-like field that is editable and not a password. */
const draftable = (el: Element | null): el is Field => {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled && !el.closest('[data-no-draft]');
  if (el instanceof HTMLInputElement) return TEXT_TYPES.has(el.type) && !el.readOnly && !el.disabled && !el.closest('[data-no-draft]');
  return false;
};

/** A stable name for each field inside one form: its id, else its label, else its name, else its place. Two with the same name are told apart by order. */
const keyed = (root: HTMLElement): Map<string, Field> => {
  const out = new Map<string, Field>();
  const seen = new Map<string, number>();
  let place = 0;
  for (const el of root.querySelectorAll('input, textarea')) {
    if (!draftable(el)) continue;
    const base = el.id ? `#${el.id}` : el.getAttribute('aria-label') ? `@${el.getAttribute('aria-label')}` : el.name ? `n:${el.name}` : `i:${place}`;
    place++;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    out.set(n === 0 ? base : `${base}~${n}`, el);
  }
  return out;
};

/** Puts text into a field the way typing would, so a React-controlled field updates its own state (and nothing is submitted). */
const putText = (el: Field, text: string): void => {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, text);
  el.dispatchEvent(new Event('input', { bubbles: true }));
};

/**
 * Keeps the text typed into the form inside it, per account, and puts it back when the form is opened again for the same thing. See
 * state/drafts.ts for what is kept and when it is written down. It does not read or change anything else about the form, does not submit
 * it, and renders nothing of its own (`display: contents`). With no account (local mode) it is just its children.
 */
export const DraftScope = ({ scope, children }: { scope: ScopeInfo; children: ReactNode }) => {
  const drafts = useDrafts();
  const { toast } = useApp();
  const root = useRef<HTMLDivElement>(null);
  const restoring = useRef(false);
  const told = useRef(false);
  const say = useRef(toast);
  say.current = toast;

  useEffect(() => {
    const el = root.current;
    if (!drafts || !el) return;
    const saved = drafts.fieldsOf(scope.id);
    const names = Object.keys(saved);
    if (!names.length) return;
    const fields = keyed(el);
    let placed = 0;
    restoring.current = true;
    try {
      for (const name of names) {
        const f = fields.get(name);
        if (!f) continue;
        if (f.value !== saved[name]) putText(f, saved[name]);
        placed++;
      }
    } finally { restoring.current = false; }
    if (placed > 0 && !told.current) {
      told.current = true;
      say.current(placed === names.length
        ? 'We put back the text you had typed. Nothing was saved or sent.'
        : 'We put back some of the text you had typed. Part of it could not be placed because this form is laid out differently now. Nothing was saved or sent.');
    }
  }, [drafts, scope.id]);

  if (!drafts) return <>{children}</>;
  return (
    <div
      ref={root}
      className="draft-scope"
      onInput={(e) => {
        if (restoring.current || !root.current || !draftable(e.target as Element)) return;
        const target = e.target as Field;
        for (const [name, f] of keyed(root.current)) if (f === target) { drafts.capture(scope, name, target.value); break; }
      }}
    >
      {children}
    </div>
  );
};
