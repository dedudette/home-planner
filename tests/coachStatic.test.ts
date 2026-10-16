import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveStatic } from '../server/static';

const site = () => {
  const base = mkdtempSync(join(tmpdir(), 'cleanflow-static-'));
  const root = join(base, 'dist');
  mkdirSync(join(root, 'assets'), { recursive: true });
  writeFileSync(join(root, 'index.html'), '<html></html>');
  writeFileSync(join(root, 'assets', 'app.js'), 'x');
  writeFileSync(join(base, 'secret.txt'), 'outside the folder');
  return { base, root };
};

describe('the standalone server only ever sends files from the built folder', () => {
  it('serves real files, and falls back to the app for anything else', () => {
    const { root } = site();
    expect(resolveStatic(root, '/assets/app.js')).toEqual({ kind: 'file', file: join(root, 'assets', 'app.js') });
    expect(resolveStatic(root, '/')).toEqual({ kind: 'file', file: join(root, 'index.html') });
    expect(resolveStatic(root, '/schedule/tomorrow')).toEqual({ kind: 'file', file: join(root, 'index.html') });
    expect(resolveStatic(root, '/assets')).toEqual({ kind: 'file', file: join(root, 'index.html') });         // a directory is not a file
  });

  it('REGRESSION: no way of writing a path reaches a file outside it', () => {
    const { root, base } = site();
    for (const bad of ['/../secret.txt', '/..%2fsecret.txt', '/%2e%2e%2fsecret.txt', '/..%5csecret.txt', '/assets/../../secret.txt', '/assets/..%2f..%2fsecret.txt', '//..//secret.txt', '/%2e%2e/%2e%2e/secret.txt', `/${base}/secret.txt`]) {
      const r = resolveStatic(root, bad);
      expect(r.kind === 'file' ? r.file : r.kind, bad).not.toBe(join(base, 'secret.txt'));
      if (r.kind === 'file') expect(r.file.startsWith(root), bad).toBe(true);
    }
    expect(resolveStatic(root, '/..%2fsecret.txt')).toEqual({ kind: 'forbidden' });
  });

  it('refuses broken encodings and null bytes, and says so when nothing has been built', () => {
    const { root } = site();
    expect(resolveStatic(root, '/%E0%A4%A')).toEqual({ kind: 'bad-request' });
    expect(resolveStatic(root, '/a%00b')).toEqual({ kind: 'bad-request' });
    expect(resolveStatic(join(root, 'nothing-here'), '/')).toEqual({ kind: 'missing' });
  });
});
