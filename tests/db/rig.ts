import { createApp, type App } from '../../server/createApp';
import { createCaptureMailer, type CaptureMailer } from '../../server/mail/mailer';
import type { RuntimeOverrides } from '../../server/app';
import { createTestDb, type TestDb } from './helpers';

/**
 * The real server (real Better Auth, real PostgreSQL, the real routes) driven in-process with Request objects and a cookie jar, the way
 * a browser would use it, with a controllable clock and a mailbox instead of an email provider.
 */
export const ORIGIN = 'http://localhost:5173';
export const PASSWORD = 'correct horse battery';

export interface Rig {
  t: TestDb;
  app: App;
  mailer: CaptureMailer;
  clock: { now: Date };
  env: Record<string, string>;
  client(ip?: string): Client;
  close(): Promise<void>;
}

export interface Reply { status: number; json: any; text: string; headers: Headers }

export class Client {
  jar = new Map<string, string>();
  constructor(private handler: (r: Request) => Promise<Response | null>, public ip: string) {}
  async call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Reply> {
    const h = new Headers({ 'x-coach-client': this.ip, origin: ORIGIN, ...headers });
    if (body !== undefined && !h.has('content-type')) h.set('content-type', 'application/json');
    if (this.jar.size) h.set('cookie', [...this.jar].map(([k, v]) => `${k}=${v}`).join('; '));
    for (const [k, v] of [...h]) if (v === '') h.delete(k);
    const res = await this.handler(new Request(`${ORIGIN}${path}`, { method, headers: h, redirect: 'manual', ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}) }));
    if (!res) throw new Error(`no handler for ${method} ${path}`);
    for (const c of res.headers.getSetCookie()) {
      const [pair, ...attrs] = c.split(';');
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      const expired = attrs.some((a) => /^\s*max-age=0\s*$/i.test(a)) || value === '';
      if (expired) this.jar.delete(name); else this.jar.set(name, value);
    }
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, json, text, headers: res.headers };
  }
  get = (path: string, headers?: Record<string, string>) => this.call('GET', path, undefined, headers);
  post = (path: string, body: unknown = {}, headers?: Record<string, string>) => this.call('POST', path, body, headers);
  hasSession = () => [...this.jar.keys()].some((k) => k.includes('session_token'));
  /** Signs up, follows the emailed link and returns a signed-in client. */
  async register(rig: Pick<Rig, 'mailer'>, email: string, password = PASSWORD): Promise<Reply> {
    const before = rig.mailer.outbox.length;
    const r = await this.post('/api/auth/sign-up/email', { email, password, name: email.split('@')[0], callbackURL: `${ORIGIN}/` });
    if (r.status !== 200) return r;
    await new Promise((res) => setTimeout(res, 30));
    const mail = rig.mailer.outbox.slice(before).find((m) => m.to === email.toLowerCase() && /confirm/i.test(m.subject));
    if (!mail) throw new Error('no verification email');
    const url = mail.text.match(/https?:\/\/\S+/)![0];
    return this.call('GET', url.replace(ORIGIN, ''));
  }
}

export const baseEnv = (extra: Record<string, string> = {}): Record<string, string> => ({
  CLEANFLOW_MODE: 'accounts',
  APP_ORIGIN: ORIGIN,
  DATABASE_URL: 'postgres://unused/unused',
  BETTER_AUTH_SECRET: 'a'.repeat(16) + 'B'.repeat(16) + '1234',
  TRIAL_CLAIM_SECRET: 'z'.repeat(16) + 'Y'.repeat(16) + '5678',
  MAIL_PROVIDER: 'console',
  ...extra,
});

export const makeRig = async (o: { env?: Record<string, string>; overrides?: RuntimeOverrides & { fetch?: typeof fetch }; start?: string } = {}): Promise<Rig> => {
  const t = await createTestDb();
  const mailer = createCaptureMailer();
  const clock = { now: new Date(o.start ?? '2026-03-10T12:00:00Z') };
  const env = baseEnv(o.env);
  const app = createApp(env, { db: t.db, mailer, now: () => clock.now, log: () => undefined, ...o.overrides });
  if (app.problems.length) throw new Error(`rig config: ${app.problems.join(' ')}`);
  let n = 0;
  return { t, app, mailer, clock, env, client: (ip) => new Client(app.handler, ip ?? `10.0.0.${++n}`), close: async () => { await app.close(); await t.close(); } };
};
