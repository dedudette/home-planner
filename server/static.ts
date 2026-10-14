import { existsSync, statSync } from 'node:fs';
import { join, normalize, resolve, sep } from 'node:path';

/**
 * Which file the standalone server should send for a URL path. It never leaves `root`, whatever the path says (encoded dots and
 * slashes, backslashes, repeated separators), and any path that is not a file falls back to index.html so the app's own routing works.
 */
export type StaticResult = { kind: 'file'; file: string } | { kind: 'forbidden' } | { kind: 'missing' } | { kind: 'bad-request' };

export const resolveStatic = (rootDir: string, urlPath: string): StaticResult => {
  const root = resolve(rootDir);
  let pathname: string;
  try { pathname = decodeURIComponent(urlPath); } catch { return { kind: 'bad-request' }; }
  if (pathname.includes('\0')) return { kind: 'bad-request' };
  let file = normalize(join(root, pathname.replace(/\\/g, '/')));
  if (file !== root && !file.startsWith(root + sep)) return { kind: 'forbidden' };
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(root, 'index.html');
  return existsSync(file) ? { kind: 'file', file } : { kind: 'missing' };
};
