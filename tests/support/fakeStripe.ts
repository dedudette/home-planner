import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import Stripe from 'stripe';

/**
 * A local stand-in for the parts of Stripe's REST API that CleanFlow calls. The REAL Stripe SDK talks to it (so request encoding, the
 * SDK's idempotency keys, retries, error classes and response parsing are the real ones), and webhook signatures are real HMACs made
 * with the SDK's own test helper and checked by the SDK's own verifier.
 *
 * What this proves: CleanFlow's logic given plausible Stripe behaviour. What it does NOT prove: that Stripe behaves this way. Tests
 * using it are labelled "fake provider"; the sandbox procedure in docs/billing-sandbox.md is the check against the real service.
 * Object shapes follow the SDK's types for API version 2026-09-30 (the subscription's period is on its item).
 */
export interface Req { method: string; path: string; query: Record<string, string>; form: any; headers: Record<string, string | string[] | undefined> }

const parseForm = (body: string): any => {
  const root: any = {};
  for (const pair of body.split('&').filter(Boolean)) {
    const [rawK, rawV = ''] = pair.split('=');
    const k = decodeURIComponent(rawK.replace(/\+/g, ' '));
    const v = decodeURIComponent(rawV.replace(/\+/g, ' '));
    const parts = k.split(/[[\]]/).filter(Boolean);
    let cur = root;
    parts.forEach((p, i) => {
      const last = i === parts.length - 1;
      const nextIsIndex = /^\d+$/.test(parts[i + 1] ?? '');
      if (last) cur[p] = v;
      else { cur[p] ??= nextIsIndex ? [] : {}; cur = cur[p]; }
    });
  }
  return root;
};

let counter = 1000;
const id = (prefix: string): string => `${prefix}_${(++counter).toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export class FakeStripe {
  server!: Server;
  port = 0;
  requests: Req[] = [];
  prices = new Map<string, any>();
  customers = new Map<string, any>();
  sessions = new Map<string, any>();
  subs = new Map<string, any>();
  charges = new Map<string, any>();
  disputes = new Map<string, any>();
  portalSessions: any[] = [];
  idem = new Map<string, { body: string; res: { status: number; json: any } }>();
  /** When set, the next matching call fails this way (for failure tests). */
  failNext: { match: RegExp; status: number; type?: string; code?: string; times?: number } | null = null;
  webhookSecret = 'whsec_test_fake_0123456789abcdef';
  private signer = new Stripe('sk_test_signer');

  async start(): Promise<this> {
    this.server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const url = new URL(req.url ?? '/', 'http://x');
        const form = parseForm(Buffer.concat(chunks).toString());
        const r: Req = { method: req.method ?? 'GET', path: url.pathname, query: Object.fromEntries(url.searchParams), form, headers: req.headers };
        this.requests.push(r);
        const out = this.route(r);
        res.statusCode = out.status;
        res.setHeader('content-type', 'application/json');
        res.setHeader('request-id', id('req'));
        res.end(JSON.stringify(out.json));
      });
    });
    await new Promise<void>((ok) => this.server.listen(0, '127.0.0.1', ok));
    this.port = (this.server.address() as AddressInfo).port;
    return this;
  }
  close = () => new Promise<void>((ok) => this.server.close(() => ok()));
  get base() { return `http://127.0.0.1:${this.port}`; }

  private err(status: number, type: string, code: string, message: string) { return { status, json: { error: { type, code, message } } }; }
  private missing(what: string, key: string) { return this.err(404, 'invalid_request_error', 'resource_missing', `No such ${what}: '${key}'`); }

  seedPrice(priceId: string, o: { amount: number; interval: 'month' | 'year'; currency?: string; tax_behavior?: 'inclusive' | 'exclusive' | 'unspecified'; active?: boolean }) {
    this.prices.set(priceId, { id: priceId, object: 'price', active: o.active ?? true, currency: o.currency ?? 'eur', unit_amount: o.amount, type: 'recurring', tax_behavior: o.tax_behavior ?? 'inclusive', lookup_key: null, recurring: { interval: o.interval, interval_count: 1, usage_type: 'licensed' } });
  }

  private subscriptionObject(o: { customer: string; priceId: string; status: string; metadata?: any }) {
    const price = this.prices.get(o.priceId);
    const start = Math.floor(Date.now() / 1000);
    const end = start + (price.recurring.interval === 'year' ? 365 : 30) * 86400;
    const sub = {
      id: id('sub'), object: 'subscription', status: o.status, customer: o.customer, start_date: start, created: start, cancel_at_period_end: false, cancel_at: null, canceled_at: null,
      currency: price.currency, latest_invoice: id('in'), metadata: o.metadata ?? {},
      items: { object: 'list', has_more: false, data: [{ id: id('si'), object: 'subscription_item', quantity: 1, price, current_period_start: start, current_period_end: end }] },
    };
    this.subs.set(sub.id, sub);
    return sub;
  }

  /** What the customer does on the hosted page. */
  completeCheckout(sessionId: string, how: 'paid' | 'requires-action' = 'paid') {
    const s = this.sessions.get(sessionId);
    const sub = this.subscriptionObject({ customer: s.customer, priceId: s.line_items.data[0].price, status: how === 'paid' ? 'active' : 'incomplete', metadata: s.subscription_metadata });
    s.status = how === 'paid' ? 'complete' : 'open';
    s.payment_status = how === 'paid' ? 'paid' : 'unpaid';
    if (how === 'paid') s.subscription = sub.id;
    return sub;
  }
  patchSub(subId: string, patch: Record<string, any>, itemPatch: Record<string, any> = {}) {
    const s = this.subs.get(subId);
    Object.assign(s, patch);
    Object.assign(s.items.data[0], itemPatch);
    return s;
  }
  renew(subId: string) {
    const s = this.subs.get(subId);
    const it = s.items.data[0];
    it.current_period_start = it.current_period_end;
    it.current_period_end += (it.price.recurring.interval === 'year' ? 365 : 30) * 86400;
    s.status = 'active';
    return s;
  }
  changePlan(subId: string, priceId: string) {
    const s = this.subs.get(subId);
    s.items.data[0].price = this.prices.get(priceId);
    return s;
  }
  addCharge(customer: string, o: { amount: number; refunded?: boolean }) {
    const ch = { id: id('ch'), object: 'charge', customer, amount: o.amount, refunded: o.refunded ?? false, amount_refunded: o.refunded ? o.amount : 0 };
    this.charges.set(ch.id, ch);
    return ch;
  }
  addDispute(chargeId: string, status: string) {
    const d = { id: id('dp'), object: 'dispute', charge: chargeId, status, amount: 2500, currency: 'eur' };
    this.disputes.set(d.id, d);
    return d;
  }

  /** A signed webhook delivery: the exact bytes and the Stripe-Signature header for them. */
  event(type: string, object: any, o: { id?: string; secret?: string; ageSeconds?: number } = {}) {
    const evt = { id: o.id ?? id('evt'), object: 'event', api_version: '2026-09-30.endive', created: Math.floor(Date.now() / 1000), type, data: { object }, livemode: false, pending_webhooks: 1, request: { id: null, idempotency_key: null } };
    const payload = JSON.stringify(evt);
    const timestamp = Math.floor(Date.now() / 1000) - (o.ageSeconds ?? 0);
    const header = this.signer.webhooks.generateTestHeaderString({ payload, secret: o.secret ?? this.webhookSecret, timestamp });
    return { id: evt.id, payload, header };
  }

  private route(r: Req): { status: number; json: any } {
    if (this.failNext && this.failNext.match.test(`${r.method} ${r.path}`)) { const f = this.failNext; f.times = (f.times ?? 1) - 1; if (f.times <= 0) this.failNext = null; return this.err(f.status, f.type ?? 'api_error', f.code ?? 'unexpected', 'Injected failure'); }
    const key = r.headers['idempotency-key'] as string | undefined;
    if (key && r.method === 'POST') {
      const prev = this.idem.get(key);
      const body = JSON.stringify(r.form);
      if (prev) return prev.body === body ? prev.res : this.err(400, 'idempotency_error', 'idempotency_key_in_use', 'Keys for idempotent requests can only be used with the same parameters');
      const res = this.dispatch(r);
      if (res.status < 500) this.idem.set(key, { body, res });
      return res;
    }
    return this.dispatch(r);
  }

  private dispatch(r: Req): { status: number; json: any } {
    let m: RegExpMatchArray | null;
    const p = r.path.replace(/^\/v1/, '');
    if (r.method === 'POST' && p === '/customers') {
      const c = { id: id('cus'), object: 'customer', email: r.form.email ?? null, metadata: r.form.metadata ?? {} };
      this.customers.set(c.id, c);
      return { status: 200, json: c };
    }
    if (r.method === 'GET' && (m = p.match(/^\/prices\/([^/]+)$/))) { const x = this.prices.get(m[1]); return x ? { status: 200, json: x } : this.missing('price', m[1]); }
    if (r.method === 'POST' && p === '/products') return { status: 200, json: { id: id('prod'), object: 'product', name: r.form.name, metadata: r.form.metadata ?? {} } };
    if (r.method === 'POST' && p === '/prices') {
      const f = r.form;
      const pr = { id: id('price'), object: 'price', active: true, currency: f.currency, unit_amount: Number(f.unit_amount), type: 'recurring', tax_behavior: f.tax_behavior ?? 'unspecified', lookup_key: f.lookup_key ?? null, product: f.product, recurring: { interval: f.recurring?.interval, interval_count: Number(f.recurring?.interval_count ?? 1), usage_type: 'licensed' } };
      this.prices.set(pr.id, pr);
      return { status: 200, json: pr };
    }
    if (r.method === 'GET' && p === '/prices') {
      const keys = ([] as string[]).concat(r.query['lookup_keys[0]'] ?? [], r.query['lookup_keys[1]'] ?? []);
      return { status: 200, json: { object: 'list', has_more: false, data: [...this.prices.values()].filter((x) => x.lookup_key && keys.includes(x.lookup_key)) } };
    }
    if (r.method === 'POST' && p === '/billing_portal/configurations') return { status: 200, json: { id: id('bpc'), object: 'billing_portal.configuration', ...r.form } };
    if (r.method === 'POST' && p === '/checkout/sessions') {
      const f = r.form;
      const cust = this.customers.get(f.customer);
      if (!cust) return this.missing('customer', f.customer);
      const priceId = f.line_items?.[0]?.price;
      if (!this.prices.has(priceId)) return this.missing('price', priceId);
      const sid = id('cs_test');
      const s = {
        id: sid, object: 'checkout.session', mode: f.mode, status: 'open', payment_status: 'unpaid', customer: f.customer, client_reference_id: f.client_reference_id ?? null, subscription: null,
        url: `https://checkout.stripe.test/c/pay/${sid}`, expires_at: Number(f.expires_at ?? Math.floor(Date.now() / 1000) + 86400), metadata: f.metadata ?? {},
        automatic_tax: { enabled: f.automatic_tax?.enabled === 'true', status: null }, line_items: { data: [{ price: priceId, quantity: Number(f.line_items[0].quantity ?? 1) }] },
        subscription_metadata: f.subscription_data?.metadata ?? {}, custom_text: f.custom_text ?? null, success_url: f.success_url, cancel_url: f.cancel_url,
      };
      this.sessions.set(sid, s);
      return { status: 200, json: s };
    }
    if ((m = p.match(/^\/checkout\/sessions\/([^/]+)\/expire$/)) && r.method === 'POST') {
      const s = this.sessions.get(m[1]);
      if (!s) return this.missing('checkout.session', m[1]);
      if (s.status !== 'open') return this.err(400, 'invalid_request_error', 'checkout_session_not_open', 'Only open sessions can be expired');
      s.status = 'expired';
      return { status: 200, json: s };
    }
    if ((m = p.match(/^\/checkout\/sessions\/([^/]+)$/)) && r.method === 'GET') { const s = this.sessions.get(m[1]); return s ? { status: 200, json: s } : this.missing('checkout.session', m[1]); }
    if (r.method === 'GET' && p === '/subscriptions') {
      const data = [...this.subs.values()].filter((s) => s.customer === r.query.customer && (r.query.status === 'all' || !r.query.status ? true : s.status === r.query.status));
      return { status: 200, json: { object: 'list', has_more: false, data } };
    }
    if ((m = p.match(/^\/subscriptions\/([^/]+)$/))) {
      const s = this.subs.get(m[1]);
      if (!s) return this.missing('subscription', m[1]);
      if (r.method === 'GET') return { status: 200, json: s };
      if (r.method === 'POST') {
        if (s.status === 'canceled') return this.err(400, 'invalid_request_error', 'resource_already_canceled', 'A canceled subscription can only update its cancellation_details.');
        if (r.form.cancel_at_period_end !== undefined) { s.cancel_at_period_end = r.form.cancel_at_period_end === 'true'; s.canceled_at = s.cancel_at_period_end ? Math.floor(Date.now() / 1000) : null; }
        return { status: 200, json: s };
      }
      if (r.method === 'DELETE') {
        if (s.status === 'canceled') return this.err(404, 'invalid_request_error', 'resource_missing', `No such subscription: '${m[1]}'`);
        s.status = 'canceled'; s.canceled_at = Math.floor(Date.now() / 1000);
        return { status: 200, json: s };
      }
    }
    if (r.method === 'GET' && (m = p.match(/^\/charges\/([^/]+)$/))) { const c = this.charges.get(m[1]); return c ? { status: 200, json: c } : this.missing('charge', m[1]); }
    if (r.method === 'GET' && (m = p.match(/^\/disputes\/([^/]+)$/))) { const d = this.disputes.get(m[1]); return d ? { status: 200, json: d } : this.missing('dispute', m[1]); }
    if (r.method === 'POST' && p === '/billing_portal/sessions') {
      if (!this.customers.has(r.form.customer)) return this.missing('customer', r.form.customer);
      const s = { id: id('bps'), object: 'billing_portal.session', customer: r.form.customer, url: `https://billing.stripe.test/p/session/${id('s')}`, return_url: r.form.return_url, configuration: r.form.configuration ?? null };
      this.portalSessions.push(s);
      return { status: 200, json: s };
    }
    return this.err(404, 'invalid_request_error', 'unknown_url', `Unrecognized request URL (${r.method}: ${r.path})`);
  }
}

export const startFakeStripe = (): Promise<FakeStripe> => new FakeStripe().start();
