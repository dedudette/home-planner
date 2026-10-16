import type { IncomingMessage, ServerResponse } from 'node:http';
import { isApiPath, type ApiHandler } from './api';

/**
 * Glue between Node's http server (also Vite's dev and preview servers, which are Connect apps) and the Request/Response handler.
 * It sets the client identity from the socket itself and deletes any such header the caller sent, so the cooldown and the sign-in rate
 * limits cannot be dodged by inventing one. Behind your own reverse proxy (TRUST_PROXY=1) the identity is the last hop of
 * X-Forwarded-For, the address the proxy itself appended. The body is read with a hard cap here as well, before the handler's own
 * check, and the bytes are passed on untouched (the Stripe webhook signature is computed over the exact bytes).
 */
const DEFAULT_CAP = 16 * 1024;
const WEBHOOK_CAP = 512 * 1024;
const BACKUP_CAP = 6 * 1024 * 1024;

export const bodyCapFor = (pathname: string): number =>
  pathname === '/api/billing/webhook' ? WEBHOOK_CAP : pathname === '/api/account/backup' ? BACKUP_CAP : DEFAULT_CAP;

const readNodeBody = (req: IncomingMessage, cap: number): Promise<Buffer | null> =>
  new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let over = false;
    req.on('data', (c: Buffer) => {
      if (over) return;                                   // keep draining, keep nothing
      size += c.length;
      if (size > cap) { over = true; chunks.length = 0; resolve(null); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(over ? null : Buffer.concat(chunks)));
    req.on('error', () => resolve(null));
  });

const clientAddress = (req: IncomingMessage, trustProxy: boolean): string => {
  if (trustProxy) {
    const xff = req.headers['x-forwarded-for'];
    const last = (Array.isArray(xff) ? xff.join(',') : xff ?? '').split(',').map((s) => s.trim()).filter(Boolean).pop();
    if (last) return last;
  }
  return req.socket.remoteAddress ?? 'unknown';
};

export const handleNodeRequest = async (handler: ApiHandler, req: IncomingMessage, res: ServerResponse, opts: { trustProxy?: boolean } = {}): Promise<boolean> => {
  const rawUrl = req.url ?? '/';
  if (!isApiPath(rawUrl)) return false;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (v !== undefined && k !== 'x-coach-client') headers.set(k, Array.isArray(v) ? v.join(', ') : v);
  headers.set('x-coach-client', clientAddress(req, opts.trustProxy === true));
  const method = req.method ?? 'GET';
  let body: Buffer | undefined;
  if (method !== 'GET' && method !== 'HEAD') {
    const b = await readNodeBody(req, bodyCapFor(new URL(rawUrl, 'http://x').pathname));
    if (!b) {
      res.statusCode = 413;
      res.setHeader('content-type', 'application/json');
      res.setHeader('connection', 'close');
      res.end(JSON.stringify({ ok: false, error: { code: 'too-large', message: 'That request is larger than anything the app sends.' } }), () => req.destroy());
      return true;
    }
    body = b;
  }
  const request = new Request(`http://${req.headers.host ?? 'localhost'}${rawUrl}`, { method, headers, ...(body ? { body: new Uint8Array(body) } : {}) });
  const response = await handler(request);
  if (!response) return false;
  res.statusCode = response.status;
  const cookies = response.headers.getSetCookie();
  response.headers.forEach((v, k) => { if (k !== 'set-cookie') res.setHeader(k, v); });
  if (cookies.length) res.setHeader('set-cookie', cookies);
  res.end(Buffer.from(await response.arrayBuffer()));
  return true;
};
