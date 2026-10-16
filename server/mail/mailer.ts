/**
 * Email delivery, behind one small interface so the provider can be swapped. `send` reports what actually happened, and the callers
 * (the notification queue above all) record exactly that:
 *
 *   sent       the provider accepted the message (HTTP 2xx). This is "handed to the provider", not "read" or even "delivered to the inbox".
 *   simulated  no real provider is configured: nothing left this server. Allowed in development only.
 *   failed     it did not go; `retryable` says whether trying again can help.
 *
 * The Resend adapter below is written against Resend's documented HTTP API and has NOT been exercised against the live service here
 * (no network access to it); its request and error handling are covered by tests against a local stand-in.
 */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  /** Stable key so a retried send is not delivered twice by providers that support it. */
  idempotencyKey?: string;
}

export type SendResult =
  | { status: 'sent'; id?: string }
  | { status: 'simulated' }
  | { status: 'failed'; retryable: boolean; code: string };

export interface Mailer {
  readonly provider: 'resend' | 'console' | 'capture';
  /** True only when messages really leave this server. */
  readonly delivers: boolean;
  send(m: MailMessage): Promise<SendResult>;
}

export const createResendMailer = (opts: { apiKey: string; from: string; fetch?: typeof fetch; baseUrl?: string; timeoutMs?: number }): Mailer => {
  const f = opts.fetch ?? fetch;
  const base = (opts.baseUrl ?? 'https://api.resend.com').replace(/\/+$/, '');
  return {
    provider: 'resend',
    delivers: true,
    async send(m) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 15_000);
      try {
        const res = await f(`${base}/emails`, {
          method: 'POST',
          headers: { authorization: `Bearer ${opts.apiKey}`, 'content-type': 'application/json', ...(m.idempotencyKey ? { 'idempotency-key': m.idempotencyKey } : {}) },
          body: JSON.stringify({ from: opts.from, to: [m.to], subject: m.subject, text: m.text }),
          signal: ctl.signal,
        });
        if (res.ok) {
          const body = (await res.json().catch(() => ({}))) as { id?: unknown };
          return { status: 'sent', id: typeof body.id === 'string' ? body.id : undefined };
        }
        // 429 and 5xx can succeed later; other 4xx (bad address, bad key, bad sender) will not, and retrying a bad key only spams.
        const retryable = res.status === 429 || res.status >= 500;
        return { status: 'failed', retryable, code: `http-${res.status}` };
      } catch {
        return { status: 'failed', retryable: true, code: 'network' };
      } finally { clearTimeout(timer); }
    },
  };
};

/** Development only. Prints the message and says plainly that nothing was delivered. */
export const createConsoleMailer = (print: (line: string) => void = (l) => console.log(l)): Mailer => ({
  provider: 'console',
  delivers: false,
  async send(m) {
    print(`[mail:console] NOT DELIVERED (no mail provider configured) to=${m.to} subject=${JSON.stringify(m.subject)}\n${m.text}`);
    return { status: 'simulated' };
  },
});

/** For tests: keeps messages in memory. */
export interface CaptureMailer extends Mailer { outbox: MailMessage[]; failNext: SendResult | null }
export const createCaptureMailer = (): CaptureMailer => {
  const m: CaptureMailer = {
    provider: 'capture',
    delivers: true,
    outbox: [],
    failNext: null,
    async send(msg) {
      if (m.failNext) { const r = m.failNext; m.failNext = null; return r; }
      m.outbox.push(msg);
      return { status: 'sent', id: `cap_${m.outbox.length}` };
    },
  };
  return m;
};
