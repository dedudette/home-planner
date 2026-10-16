import { describe, expect, it } from 'vitest';
import { parseStandalone, validateConfig } from '../src/account/config';

describe('the deliberate switch for deployments with no server at all', () => {
  it('is on only for an explicit setting', () => {
    for (const v of ['1', 'true', true]) expect(parseStandalone(v)).toBe(true);
    for (const v of [undefined, null, '', '0', 'false', 'yes', 'TRUE', 1, 0, {}]) expect(parseStandalone(v)).toBe(false);
  });
  it('is off in a normal test or dev environment (nothing sets it)', async () => {
    const { isStandalone } = await import('../src/account/config');
    expect(isStandalone()).toBe(false);
  });
});

describe('validateConfig', () => {
  it('drops unknown fields of local mode and accepts the exact accounts shape', () => {
    expect(validateConfig({ mode: 'local', extra: 1 })).toEqual({ mode: 'local' });
    const ok = { mode: 'accounts', accounts: { billing: { available: true, reason: null, mode: 'test' }, mail: { delivers: true }, legal: { privacy: 'https://x/p', terms: null, billing: null, company: null } } };
    expect(validateConfig(ok)).toEqual(ok);
  });
});
