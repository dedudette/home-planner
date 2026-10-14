import type { IncomingMessage, ServerResponse } from 'node:http';
import type { CoachHandler } from './coach/handler';

/**
 * Glue between Node's http server (also Vite's dev and preview servers, which are Connect apps) and the Request/Response handler.
 * It sets the client identity from the socket itself and deletes any such header the caller sent, so the cooldown cannot be dodged
 * by inventing one. The body is read with a hard cap here as well, before the handler's own check.
 */
const BODY_CAP = 16 * 1024;

const readNodeBody = (req: IncomingMessage): Promise<Buffer | null> =>
  new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let over = false;
    req.on('data', (c: Buffer) => {
      if (over) return;                                   // keep draining, keep nothing
      size += c.length;
      if (size > BODY_CAP) { over = true; chunks.length = 0; resolve(null); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(over ? null : Buffer.concat(chunks)));
    req.on('error', () => resolve(null));
  });

export const handleNodeRequest = async (handler: CoachHandler, req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
  const rawUrl = req.url ?? '/';
  if (!rawUrl.startsWith('/api/coach')) return false;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (v !== undefined && k !== 'x-coach-client') headers.set(k, Array.isArray(v) ? v.join(', ') : v);
  headers.set('x-coach-client', req.socket.remoteAddress ?? 'unknown');
  const method = req.method ?? 'GET';
  let body: Buffer | undefined;
  if (method !== 'GET' && method !== 'HEAD') {
    const b = await readNodeBody(req);
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
  response.headers.forEach((v, k) => res.setHeader(k, v));
  res.end(Buffer.from(await response.arrayBuffer()));
  return true;
};
