/** Small response and request helpers shared by the account and billing routes. */
export const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers } });

export const fail = (status: number, code: string, message: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}): Response =>
  json(status, { ok: false, error: { code, message, ...extra } }, headers);

/** A state-changing request must come from the app's own origin. Safe methods are not restricted. */
export const originOk = (req: Request, appOrigin: string): boolean => {
  if (req.method === 'GET' || req.method === 'HEAD') return true;
  const origin = req.headers.get('origin');
  if (origin) return origin === appOrigin;
  const site = req.headers.get('sec-fetch-site');
  return site === 'same-origin';        // no Origin and no browser hint: not a browser acting for a signed-in person, so not accepted
};

export const readBodyText = async (req: Request, max: number): Promise<string | 'too-large'> => {
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > max) return 'too-large';
  if (!req.body) return '';
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { await reader.cancel().catch(() => undefined); return 'too-large'; }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.byteLength; }
  return new TextDecoder().decode(all);
};

export const readJson = async (req: Request, max: number): Promise<{ ok: true; value: unknown } | { ok: false; response: Response }> => {
  if (!(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) return { ok: false, response: fail(415, 'content-type', 'Send JSON.') };
  const text = await readBodyText(req, max);
  if (text === 'too-large') return { ok: false, response: fail(413, 'too-large', 'That request is larger than allowed.') };
  try { return { ok: true, value: text === '' ? {} : JSON.parse(text) }; } catch { return { ok: false, response: fail(400, 'invalid', 'That request could not be read.') }; }
};
