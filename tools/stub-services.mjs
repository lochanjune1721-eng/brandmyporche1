// tools/stub-services.mjs — a stand-in PayPal and Supabase, for exercising a real purchase
// locally without a key or a card.
//
//   node tools/stub-services.mjs 8124
//   SUPABASE_URL=http://127.0.0.1:8124/sb SUPABASE_SERVICE_ROLE_KEY=x \
//   PAYPAL_API_BASE=http://127.0.0.1:8124/pp PAYPAL_CLIENT_ID=x PAYPAL_CLIENT_SECRET=x \
//   PAYPAL_WEBHOOK_ID=x SITE_URL=http://127.0.0.1:8123 node tools/dev-server.mjs
//
// It keeps purchases in memory and enforces the one rule that matters: a zone can only be
// held or sold once, so the double-sell path is genuinely tested rather than assumed.

import http from 'node:http';

const PORT = Number(process.argv[2] || 8124);
const rows = [];
const orders = new Map();
let n = 0;

const send = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};
const body = req => new Promise(r => {
  const c = []; req.on('data', d => c.push(d)); req.on('end', () => r(Buffer.concat(c).toString()));
});
const matches = (row, filters) => filters.every(([col, op, val]) =>
  op === 'eq' ? String(row[col]) === val
  : op === 'in' ? val.replace(/[()]/g, '').split(',').includes(String(row[col]))
  // PostgREST spells the SQL wildcard `*` in a URL and turns it into `%`.
  : op === 'like' ? new RegExp('^' + val.split('*').map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$').test(String(row[col]))
  : true);

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://x`);
  const path = url.pathname;
  const raw = ['POST', 'PATCH', 'PUT'].includes(req.method) ? await body(req) : '';
  const filters = [...url.searchParams].filter(([k]) => !['select', 'order', 'limit'].includes(k))
    .map(([k, v]) => [k, ...v.split('.', 2).length === 2 ? v.split(/\.(.+)/) : ['eq', v]]);

  // ── Supabase ──────────────────────────────────────────────────────────────
  if (path === '/sb/rest/v1/rpc/release_expired_holds') {
    let freed = 0;
    for (const r of rows) if (r.status === 'pending' && new Date(r.hold_expires_at) < new Date()) { r.status = 'released'; freed++; }
    return send(res, 200, freed);
  }
  if (path === '/sb/rest/v1/purchases') {
    if (req.method === 'GET') return send(res, 200, rows.filter(r => matches(r, filters)));
    if (req.method === 'POST') {
      const [incoming] = JSON.parse(raw);
      // the partial unique indexes, in miniature
      const clash = rows.find(r => r.zone_id === incoming.zone_id && (r.status === 'paid' || r.status === 'pending'));
      if (clash) return send(res, 409, { code: '23505', message: 'duplicate key value violates unique constraint' });
      const row = { id: 'p' + (++n), created_at: new Date().toISOString(), ...incoming };
      rows.push(row);
      return send(res, 201, [row]);
    }
    if (req.method === 'DELETE') {
      const doomed = rows.filter(r => matches(r, filters));
      for (const r of doomed) rows.splice(rows.indexOf(r), 1);
      return send(res, 204, null);
    }
    if (req.method === 'PATCH') {
      const patch = JSON.parse(raw);
      const hit = rows.filter(r => matches(r, filters));
      hit.forEach(r => Object.assign(r, patch));
      return send(res, 200, hit);
    }
  }
  if (path.startsWith('/sb/storage/v1/object/artwork/')) {
    return send(res, 200, { Key: path.split('/').pop() });
  }

  // ── PayPal ────────────────────────────────────────────────────────────────
  if (path === '/pp/v1/oauth2/token') return send(res, 200, { access_token: 'stub-token', expires_in: 3600 });
  if (path === '/pp/v2/checkout/orders' && req.method === 'POST') {
    const order = JSON.parse(raw);
    const id = 'ORDER-' + (++n);
    orders.set(id, order);
    // The approve link goes to our own fake checkout page, which is what a buyer would click.
    return send(res, 201, { id, status: 'CREATED', links: [
      { rel: 'approve', href: `http://127.0.0.1:${PORT}/pp/checkout?order=${id}` }] });
  }
  const cap = /^\/pp\/v2\/checkout\/orders\/([\w-]+)\/capture$/.exec(path);
  if (cap && req.method === 'POST') {
    const order = orders.get(cap[1]);
    if (!order) return send(res, 404, { message: 'order not found' });
    if (order.captured) return send(res, 422, { message: 'ORDER_ALREADY_CAPTURED', details: [{ issue: 'ORDER_ALREADY_CAPTURED' }] });
    order.captured = true;
    return send(res, 201, {
      id: cap[1], status: 'COMPLETED',
      payer: { name: { given_name: 'Alex', surname: 'Rivera' }, email_address: 'alex@acme.test' },
      purchase_units: [{ payments: { captures: [{ id: 'CAP-' + cap[1], status: 'COMPLETED' }] } }],
    });
  }
  if (path === '/pp/v1/notifications/verify-webhook-signature') return send(res, 200, { verification_status: 'SUCCESS' });
  if (path === '/pp/checkout') {
    // Stands in for the PayPal approval page: one button, which returns to the site.
    const id = url.searchParams.get('order');
    const ret = orders.get(id)?.application_context?.return_url || '/';
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(`<!doctype html><meta charset=utf-8><title>Stand-in PayPal</title>
      <body style="font:16px system-ui;display:grid;place-items:center;height:90vh;text-align:center">
      <div><p><b>Stand-in PayPal</b><br>Order ${id}</p>
      <a id="pay" href="${ret}&token=${id}" style="display:inline-block;background:#0070ba;color:#fff;
         padding:12px 28px;border-radius:999px;text-decoration:none;font-weight:700">Pay now</a></div>`);
  }

  send(res, 404, { error: `stub has no route for ${req.method} ${path}` });
}).listen(PORT, () => console.log(`stand-in PayPal + Supabase on http://127.0.0.1:${PORT}`));
