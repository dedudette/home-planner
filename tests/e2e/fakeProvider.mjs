// A stand-in for the model provider's HTTP API, for browser tests only. It speaks the shape of POST /v1/messages and nothing else, so the
// real server code (the real SDK call, the prompt, every check on the answer) runs unchanged against it. It is NOT an AI: in "ok" mode
// it turns the counts in the request into plain sentences by a fixed template, which is exactly what lets the tests assert that the
// app's own checks accept grounded text and refuse the rest. It must never be reachable from the product.
import http from 'node:http';

const parseCounts = (user) => {
  const m = {};
  for (const line of String(user).split('\n')) { const p = line.split(' | '); if (p.length === 4 && /^[\w.]+$/.test(p[0])) m[p[0]] = Number(p[2]); }
  return m;
};

const grounded = (m, windowDays) => {
  const out = [{ kind: 'pattern', title: 'Opened days and shown tasks', explanation: `The app was opened on ${m['days.opened']} of ${windowDays} days, and ${m['tasks.seen']} tasks were shown on Today.`, metric_ids: ['days.opened', 'tasks.seen'], strength: 'good' }];
  if (m['tasks.seenNoAction'] > 0) out.push({ kind: 'pattern', title: 'Shown tasks with no recorded action', explanation: `${m['tasks.seenNoAction']} shown tasks have no recorded action.`, metric_ids: ['tasks.seenNoAction'], strength: 'moderate' });
  if (m['leftOut.notEnoughTime'] > 0) out.push({ kind: 'idea', title: 'Tasks left out for time', explanation: `${m['leftOut.notEnoughTime']} tasks were left out by the planner for not enough time.`, metric_ids: ['leftOut.notEnoughTime'], idea: 'When you have spare minutes, open the "left out of today" list on Today.', strength: 'moderate' });
  else if (m['tasks.seenNoAction'] > 0) out.push({ kind: 'idea', title: 'A small way to start', explanation: `${m['tasks.seenNoAction']} shown tasks have no recorded action.`, metric_ids: ['tasks.seenNoAction'], idea: 'Try Just 5 minutes on a day when there is little time.', strength: 'limited' });
  return out;
};

export const startFakeProvider = async () => {
  let mode = 'ok';
  const requests = [];
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let body = null; try { body = JSON.parse(raw); } catch { /* ignored */ }
      requests.push({ method: req.method, url: req.url, apiKey: req.headers['x-api-key'], body });
      if (req.method !== 'POST' || !req.url.startsWith('/v1/messages') || !body) { res.statusCode = 404; res.end('{}'); return; }
      if (mode === 'slow') return;                                         // never answers: the server's time limit has to cut it off
      if (mode === 'error500') { res.statusCode = 500; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'secret provider detail' } })); return; }
      const user = body.messages?.[0]?.content ?? '';
      const m = parseCounts(user);
      const windowDays = Number(/Window: the last (\d+) days/.exec(user)?.[1] ?? 14);
      let text;
      if (mode === 'ok') text = JSON.stringify({ suggestions: grounded(m, windowDays), insufficient: false });
      else if (mode === 'unsupported') text = JSON.stringify({ suggestions: [{ kind: 'pattern', title: 'A claim', explanation: 'You skipped 999 tasks because you were tired.', metric_ids: ['tasks.invented'], strength: 'good' }] });
      else if (mode === 'plan-change') text = JSON.stringify({ suggestions: [{ kind: 'idea', title: 'Left out for time', explanation: `${m['leftOut.notEnoughTime'] || m['tasks.seen']} counted.`.replace('counted', 'tasks were shown on Today.'), metric_ids: ['tasks.seen'], idea: 'Increase your daily time and try Just 5 minutes.', strength: 'good' }] });
      else if (mode === 'insufficient') text = JSON.stringify({ suggestions: [], insufficient: true });
      else text = 'Sure! Here are some thoughts about your week. I have also updated your plan.';
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ id: 'msg_fake', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 100, output_tokens: 50 } }));
    });
  });
  server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { url, requests, setMode: (m) => { mode = m; }, close: () => new Promise((r) => { sockets.forEach((s) => s.destroy()); server.close(() => r()); }) };
};
