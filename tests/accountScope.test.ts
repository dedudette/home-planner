import { afterEach, describe, expect, it } from 'vitest';
import { getNamespace, nsKey, setNamespace } from '../src/storage/namespace';
import { switchNamespace } from '../src/account/scope';

type G = { window?: EventTarget };
afterEach(() => { delete (globalThis as G).window; setNamespace(null); });

describe('switching account storage never loses the last edits', () => {
  it('asks the app to write what it holds BEFORE the namespace changes, so the write lands in the old account', () => {
    const win = new EventTarget();
    (globalThis as G).window = win;
    setNamespace('alice');
    const seen: string[] = [];
    win.addEventListener('pagehide', () => seen.push(nsKey('cleanflow:v1')));
    switchNamespace('bob');
    expect(seen).toEqual(['cleanflow:v1@alice']);
    expect(getNamespace()).toBe('@bob');
  });
  it('flushes on leaving an account too (session ended, sign-out), and then uses the original keys', () => {
    const win = new EventTarget();
    (globalThis as G).window = win;
    setNamespace('alice');
    let flushed = 0;
    win.addEventListener('pagehide', () => { flushed++; expect(getNamespace()).toBe('@alice'); });
    switchNamespace(null);
    expect(flushed).toBe(1);
    expect(getNamespace()).toBe('');
  });
  it('works where there is no window', () => {
    setNamespace('alice');
    expect(() => switchNamespace('bob')).not.toThrow();
    expect(getNamespace()).toBe('@bob');
  });
});
