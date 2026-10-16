/**
 * Where the payment provider sends the browser back to: `/?billing=success&session_id=cs_…`, `/?billing=cancelled`, `/?billing=returned`
 * (from the billing portal). The address is only a hint about where the person has been. It never means "paid": the screen that receives it
 * asks the server (which asks the payment provider) and shows what the server answers.
 */
export type BillingReturn =
  | { kind: 'none' }
  | { kind: 'success'; sessionId: string | null }
  | { kind: 'cancelled' }
  | { kind: 'returned' };

const SESSION_ID = /^cs_[A-Za-z0-9_]{4,200}$/;

export const readBillingReturn = (search: string): BillingReturn => {
  const p = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  switch (p.get('billing')) {
    case 'success': { const id = p.get('session_id') ?? ''; return { kind: 'success', sessionId: SESSION_ID.test(id) ? id : null }; }
    case 'cancelled': return { kind: 'cancelled' };
    case 'returned': return { kind: 'returned' };
    default: return { kind: 'none' };
  }
};

export const stripBillingParams = (href: string): string => {
  const u = new URL(href);
  u.searchParams.delete('billing');
  u.searchParams.delete('session_id');
  return `${u.pathname}${u.search}${u.hash}`;
};

// Read once when the page loads, before anything rewrites the address.
let pending: BillingReturn = typeof window === 'undefined' ? { kind: 'none' } : readBillingReturn(window.location.search);
export const peekBillingReturn = (): BillingReturn => pending;
export const takeBillingReturn = (): BillingReturn => { const r = pending; pending = { kind: 'none' }; return r; };
