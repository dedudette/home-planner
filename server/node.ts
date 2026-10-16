import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { createApp } from './createApp';
import { handleNodeRequest } from './nodeAdapter';
import { resolveStatic } from './static';

/**
 * A small production server for self-hosting: it serves the built app (`dist/`) and the AI coach endpoint from one process, so the
 * browser only ever talks to its own origin and the provider key stays in this process's environment.
 *
 *   npm run build && npm run build:server && ANTHROPIC_API_KEY=… npm start
 *
 * With DATABASE_URL set it also runs accounts, the 14-day trial and subscriptions (see docs/deployment.md); without it, it is the
 * original single-device app.
 *
 * PORT (default 8080), HOST (default 127.0.0.1: set 0.0.0.0 inside a container) and COACH_STATIC_DIR (default ./dist) are read here.
 * Static hosting alone (GitHub Pages and the like) cannot run this: without a server the app simply shows the coach as unavailable.
 */
const root = resolve(process.env.COACH_STATIC_DIR ?? 'dist');
const app = createApp();
if (app.problems.length) {
  // Fail closed: a half-configured accounts setup must not quietly serve the app without protection.
  console.error('CleanFlow did not start. Fix these settings (values are never printed):');
  for (const p of app.problems) console.error(`  - ${p}`);
  process.exit(1);
}
const handler = app.handler;
const trustProxy = process.env.TRUST_PROXY === '1' || process.env.COACH_TRUST_PROXY === '1';
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2',
};

const server = createServer((req, res) => {
  handleNodeRequest(handler, req, res, { trustProxy }).then((handled) => {
    if (handled) return;
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.statusCode = 405; res.end(); return; }
    const found = resolveStatic(root, new URL(req.url ?? '/', 'http://x').pathname);
    if (found.kind === 'bad-request') { res.statusCode = 400; res.end(); return; }
    if (found.kind === 'forbidden') { res.statusCode = 403; res.end(); return; }
    if (found.kind === 'missing') { res.statusCode = 404; res.end('Build the app first: npm run build'); return; }
    const file = found.file;
    res.setHeader('content-type', TYPES[extname(file)] ?? 'application/octet-stream');
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'no-referrer');
    if (file.includes(`${sep}assets${sep}`)) res.setHeader('cache-control', 'public, max-age=31536000, immutable');
    createReadStream(file).pipe(res);
  }, () => { res.statusCode = 500; res.end(); });
});

const port = Number(process.env.PORT ?? 8080);
const host = process.env.HOST ?? '127.0.0.1';
server.listen(port, host, () => {
  console.log(`CleanFlow on http://${host}:${port}`);
  console.log(`[ai] ${handler.describe()}`);
  console.log(app.runtime ? `[accounts] on (billing: ${app.runtime.billing?.status().available ? 'available' : `unavailable (${app.runtime.billing?.status().reason ?? 'not configured'})`}; mail: ${app.runtime.mailer.provider}${app.runtime.mailer.delivers ? '' : ', NOT delivered'})` : '[accounts] off (local mode: no sign-in, no subscription)');
});
// Housekeeping that must happen even with no traffic: stale AI reservations, billing notices.
const timer = app.runtime ? setInterval(() => { void app.runtime!.tick(); }, 60_000) : null;
timer?.unref();
const stop = () => { timer && clearInterval(timer); server.close(() => { void app.close().then(() => process.exit(0)); }); setTimeout(() => process.exit(0), 10_000).unref(); };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
