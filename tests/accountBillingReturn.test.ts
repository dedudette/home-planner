import { describe, expect, it } from 'vitest';
import { readBillingReturn, stripBillingParams } from '../src/account/billingReturn';

describe('coming back from the payment page is only a hint', () => {
  it('reads success with the checkout session id, cancel and portal returns', () => {
    expect(readBillingReturn('?billing=success&session_id=cs_test_a1B2c3D4')).toEqual({ kind: 'success', sessionId: 'cs_test_a1B2c3D4' });
    expect(readBillingReturn('?billing=cancelled')).toEqual({ kind: 'cancelled' });
    expect(readBillingReturn('?billing=returned')).toEqual({ kind: 'returned' });
  });
  it('an invented or malformed session id is dropped (the server is asked without it)', () => {
    for (const id of ['', 'x', 'cs_', 'sub_123456', 'cs_test_<script>', 'cs_test_' + 'a'.repeat(300)]) {
      expect(readBillingReturn(`?billing=success&session_id=${encodeURIComponent(id)}`)).toEqual({ kind: 'success', sessionId: null });
    }
    expect(readBillingReturn('?billing=success')).toEqual({ kind: 'success', sessionId: null });
  });
  it('anything else is nothing', () => {
    for (const q of ['', '?billing=paid', '?billing=', '?session_id=cs_test_aaaa', '?verified=1']) expect(readBillingReturn(q)).toEqual({ kind: 'none' });
  });
  it('the return parameters are removed from the address, the rest kept', () => {
    expect(stripBillingParams('https://app.example/?billing=success&session_id=cs_test_aaaa&x=1#/account')).toBe('/?x=1#/account');
    expect(stripBillingParams('https://app.example/?billing=cancelled')).toBe('/');
  });
});
