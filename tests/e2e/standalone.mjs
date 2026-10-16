// The deliberate switch for deployments with no server at all (a static host, the phone app): VITE_CLEANFLOW_STANDALONE=1 at build time.
// Serves a build the way a static host does (every path answers with the app's page, so /api/config is a 200 HTML page) and checks that
//   - the standalone build runs as the local app, and
//   - the normal build, served the same way, does NOT guess "local": it shows the recoverable error screen.
//
//   npm run e2e:standalone        (builds into dist-standalone/ and dist-plain/ itself)
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { launch, runner, watch } from './lib.mjs';

const { check, step, done } = runner('standalone');
const errors = [];
const build = (dir, env) => {
  const r = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--outDir', dir, '--emptyOutDir'], { env: { ...process.env, ...env }, stdio: 'pipe' });
  if (r.status !== 0) throw new Error(`build ${dir} failed: ${String(r.stderr).slice(-300)}`);
};
build('dist-standalone', { VITE_CLEANFLOW_STANDALONE: '1' });
build('dist-plain', { VITE_CLEANFLOW_STANDALONE: '' });

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const serve = (dir, port) => new Promise((ok) => {
  const root = resolve(dir);
  const srv = createServer((req, res) => {
    const p = new URL(req.url, 'http://x').pathname;
    let f = join(root, p);
    if (!f.startsWith(root) || !existsSync(f) || !statSync(f).isFile()) f = join(root, 'index.html');      // single-page-app fallback, like a static host
    res.setHeader('content-type', TYPES[extname(f)] ?? 'application/octet-stream');
    createReadStream(f).pipe(res);
  }).listen(port, '127.0.0.1', () => ok(srv));
});
const servers = [await serve('dist-standalone', 18301), await serve('dist-plain', 18302)];
const browser = await launch();
try {
  await step('a standalone build, served by a static host, runs as the local app', async () => {
    const page = await browser.newPage(); watch(page, errors, 'standalone');
    await page.goto('http://127.0.0.1:18301/');
    await page.getByRole('heading', { name: /One calm plan/ }).waitFor();
    check('no sign-in, no error screen', (await page.getByRole('heading', { name: 'Sign in', exact: true }).count()) === 0 && (await page.getByRole('heading', { name: 'Something went wrong' }).count()) === 0);
    await page.close();
  });
  await step('the normal build behind the same static host does not guess local mode', async () => {
    const page = await browser.newPage(); watch(page, errors, 'plain');
    await page.goto('http://127.0.0.1:18302/');
    await page.getByRole('heading', { name: 'Something went wrong' }).waitFor();
    check('no welcome page', (await page.getByRole('heading', { name: /One calm plan/ }).count()) === 0);
    check('nothing stored', (await page.evaluate(() => Object.keys(localStorage).length)) === 0);
    await page.close();
  });
} finally { await browser.close(); servers.forEach((s) => s.close()); }
done(errors);
process.exit(process.exitCode ?? 0);
