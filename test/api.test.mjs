// test/api.test.mjs — the payment path, without a network.
//
// These are the assertions that matter when money is involved: the price cannot be set by the
// caller, a zone cannot be sold twice, and fulfilment can run as many times as PayPal decides
// to tell us about it without charging or emailing anyone twice. Every outbound call is
// stubbed, so this suite is safe to run anywhere.

import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ZONES } from '../zones.js';

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
process.env.PAYPAL_ENV = 'sandbox';
process.env.PAYPAL_CLIENT_ID = 'client';
process.env.PAYPAL_CLIENT_SECRET = 'secret';
process.env.PAYPAL_WEBHOOK_ID = 'wh-1';
process.env.PAYPAL_CURRENCY = 'USD';
process.env.SITE_URL = 'https://example.test';
process.env.RESEND_API_KEY = '';

let calls = [];
let plan = [];
const realFetch = globalThis.fetch;

/** Queue a canned reply for the next matching outbound call. */
function reply(match, body, ok = true, status = 200) { plan.push({ match, body, ok, status }); }

globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  calls.push({ url: u, method: opts.method || 'GET', body: opts.body ? safeParse(opts.body) : null, headers: opts.headers });
  const i = plan.findIndex(p => u.includes(p.match));
  if (i === -1) throw new Error(`No stub for ${opts.method || 'GET'} ${u}`);
  const [p] = plan.splice(i, 1);
  return { ok: p.ok, status: p.status, text: async () => JSON.stringify(p.body), json: async () => p.body };
};
const safeParse = b => { try { return JSON.parse(b); } catch { return '<binary>'; } };

beforeEach(() => { calls = []; plan = []; });

const res = () => {
  const r = { statusCode: 200, headers: {}, body: null, ended: false };
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; };
  r.status = c => { r.statusCode = c; return r; };
  r.send = b => { r.body = b; r.ended = true; return r; };
  r.writeHead = (c, h) => { r.statusCode = c; Object.assign(r.headers, h); return r; };
  r.end = () => { r.ended = true; return r; };
  return r;
};
const payload = r => (r.body ? JSON.parse(r.body) : null);

const ARTWORK = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64');
const buyer = { url: 'acme.com', artwork: ARTWORK };   // the whole form

// ── the price is the server's, not the caller's ──────────────────────────────

test('checkout charges the zone price from zones.js, whatever the caller claims', async () => {
  const { default: checkout } = await import('../api/checkout.js');
  const zone = ZONES.find(z => z.id === 'H5');            // the XXL, $12,000
  reply('/rpc/release_expired_holds', 1);
  reply('/rest/v1/purchases', [{ id: 'p-1', zone_id: 'H5' }]);
  reply('/storage/v1/object/artwork/', {});
  reply('/v1/oauth2/token', { access_token: 't', expires_in: 3600 });
  reply('/v2/checkout/orders', { id: 'ORDER-1', links: [{ rel: 'approve', href: 'https://paypal.test/approve' }] });
  reply('/rest/v1/purchases?id=eq.p-1', {});

  const r = res();
  await checkout({ method: 'POST', headers: { host: 'x' }, body: { zoneId: 'H5', ...buyer, price: 1, amount: 1, price_cents: 1 } }, r);

  assert.equal(r.statusCode, 200, r.body);
  const order = calls.find(c => c.url.includes('/v2/checkout/orders'));
  assert.equal(order.body.purchase_units[0].amount.value, '12000.00');
  assert.equal(zone.price, 12000);
  // and the row we inserted carried the same number
  const insert = calls.find(c => c.url.includes('/rest/v1/purchases') && c.method === 'POST');
  assert.equal(insert.body[0].price_cents, 1200000);
  assert.equal(payload(r).approveUrl, 'https://paypal.test/approve');
});

test('checkout refuses a zone that does not exist', async () => {
  const { default: checkout } = await import('../api/checkout.js');
  const r = res();
  await checkout({ method: 'POST', headers: {}, body: { zoneId: 'NOPE', ...buyer } }, r);
  assert.equal(r.statusCode, 400);
  assert.match(payload(r).error, /No such zone/);
  assert.equal(calls.length, 0, 'must not touch the database for an unknown zone');
});

test('checkout validates the two fields it asks for, before reserving anything', async () => {
  const { default: checkout } = await import('../api/checkout.js');
  for (const [bad, why] of [
    [{ ...buyer, url: 'not a website' }, /website/i],
    [{ ...buyer, url: 'localhost' }, /website/i],
    [{ ...buyer, url: '' }, /website/i],
    [{ ...buyer, artwork: '' }, /icon/i],
  ]) {
    const r = res();
    await checkout({ method: 'POST', headers: {}, body: { zoneId: 'H5', ...bad } }, r);
    assert.equal(r.statusCode, 400, JSON.stringify(bad));
    assert.match(payload(r).error, why);
  }
  assert.equal(calls.length, 0, 'nothing reserved for an invalid buyer');
});

test('the brand shown on the board is the domain, not anything the caller typed', async () => {
  const { websiteOf } = await import('../api/_lib.js');
  assert.deepEqual(websiteOf('acme.com'),          { url: 'https://acme.com', label: 'acme.com' });
  assert.deepEqual(websiteOf('http://www.ACME.com/x/'), { url: 'https://www.acme.com/x', label: 'acme.com' });
  for (const bad of ['', 'not a website', 'localhost', 'javascript:alert(1)', 'http://127.0.0.1', 'acme']) {
    assert.equal(websiteOf(bad), null, bad);
  }
});

test('a paid order takes the buyer identity from PayPal, not from the form', async () => {
  const { markPaid } = await import('../api/_fulfil.js');
  reply('/rest/v1/purchases?id=eq.p-7', [{ id: 'p-7', zone_id: 'H5', brand_name: 'acme.com', price_cents: 100 }]);
  await markPaid({ id: 'p-7' }, 'CAP-7',
    { name: { given_name: 'Alex', surname: 'Rivera' }, email_address: 'Alex@Acme.COM' });
  const patch = calls.at(-1).body;
  assert.equal(patch.buyer_name, 'Alex Rivera');
  assert.equal(patch.buyer_email, 'alex@acme.com');
});

test('a zone already held or sold comes back as 409, not a second PayPal order', async () => {
  const { default: checkout } = await import('../api/checkout.js');
  reply('/rpc/release_expired_holds', 1);
  reply('/rest/v1/purchases', { code: '23505', message: 'duplicate key' }, false, 409);
  const r = res();
  await checkout({ method: 'POST', headers: {}, body: { zoneId: 'H5', ...buyer } }, r);
  assert.equal(r.statusCode, 409);
  assert.match(payload(r).error, /just been taken/);
  assert.equal(calls.filter(c => c.url.includes('paypal')).length, 0, 'no order was opened');
});

test('a PayPal failure releases the hold instead of stranding the zone', async () => {
  const { default: checkout } = await import('../api/checkout.js');
  reply('/rpc/release_expired_holds', 1);
  reply('/rest/v1/purchases', [{ id: 'p-9', zone_id: 'B7' }]);
  reply('/storage/v1/object/artwork/', {});
  reply('/v1/oauth2/token', { access_token: 't', expires_in: 3600 });
  reply('/v2/checkout/orders', { message: 'PayPal is down' }, false, 502);
  reply('/rest/v1/purchases?id=eq.p-9', {});
  const r = res();
  await checkout({ method: 'POST', headers: {}, body: { zoneId: 'B7', ...buyer } }, r);
  assert.equal(r.statusCode, 502);
  const release = calls.find(c => c.method === 'PATCH' && c.body?.status === 'released');
  assert.ok(release, 'the hold must be released so the zone goes back on the board');
});

// ── fulfilment runs more than once, on purpose ───────────────────────────────

test('markPaid only flips a pending row, so a second webhook changes nothing', async () => {
  const { markPaid } = await import('../api/_fulfil.js');
  reply('/rest/v1/purchases?id=eq.p-2', [{ id: 'p-2', zone_id: 'H5', buyer_email: 'a@b.co', price_cents: 1200000 }]);
  assert.equal(await markPaid({ id: 'p-2' }, 'CAP-1'), true, 'first call takes it');

  const guarded = calls.at(-1);
  assert.match(guarded.url, /status=eq\.pending/, 'the update is guarded on still being pending');
  assert.equal(guarded.body.status, 'paid');
  assert.equal(guarded.body.paypal_capture_id, 'CAP-1');

  reply('/rest/v1/purchases?id=eq.p-2', []);                 // nothing left to flip
  assert.equal(await markPaid({ id: 'p-2' }, 'CAP-1'), false, 'second call is a no-op');
});

// ── the webhook believes nobody until PayPal says so ─────────────────────────

test('an unverified webhook is rejected and changes nothing', async () => {
  const { default: hook } = await import('../api/paypal-webhook.js');
  reply('/v1/oauth2/token', { access_token: 't', expires_in: 3600 });
  reply('/v1/notifications/verify-webhook-signature', { verification_status: 'FAILURE' });
  const req = fakeWebhook({ event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { id: 'CAP-9', custom_id: 'p-3' } });
  const r = res();
  await hook(req, r);
  assert.equal(r.statusCode, 401);
  assert.equal(calls.filter(c => c.url.includes('/rest/v1/purchases')).length, 0, 'the database was never touched');
});

test('a verified capture marks the zone sold', async () => {
  const { default: hook } = await import('../api/paypal-webhook.js');
  reply('/v1/oauth2/token', { access_token: 't', expires_in: 3600 });
  reply('/v1/notifications/verify-webhook-signature', { verification_status: 'SUCCESS' });
  reply('/rest/v1/purchases?id=eq.p-4', [{ id: 'p-4', zone_id: 'LF11', status: 'pending', buyer_email: 'a@b.co', price_cents: 600000 }]);
  reply('/rest/v1/purchases?id=eq.p-4', [{ id: 'p-4', zone_id: 'LF11', buyer_email: 'a@b.co', price_cents: 600000 }]);
  const r = res();
  await hook(fakeWebhook({ event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { id: 'CAP-4', custom_id: 'p-4' } }), r);
  assert.equal(r.statusCode, 200);
  const paid = calls.find(c => c.method === 'PATCH' && c.body?.status === 'paid');
  assert.ok(paid, 'the purchase was marked paid');
});

test('a refund puts the panel back on the board', async () => {
  const { default: hook } = await import('../api/paypal-webhook.js');
  reply('/v1/oauth2/token', { access_token: 't', expires_in: 3600 });
  reply('/v1/notifications/verify-webhook-signature', { verification_status: 'SUCCESS' });
  reply('/rest/v1/purchases', {});
  const r = res();
  await hook(fakeWebhook({ event_type: 'PAYMENT.CAPTURE.REFUNDED', resource: { id: 'CAP-5', custom_id: 'p-5' } }), r);
  assert.equal(r.statusCode, 200);
  assert.equal(calls.find(c => c.method === 'PATCH').body.status, 'refunded');
});

function fakeWebhook(event) {
  const raw = JSON.stringify(event);
  const req = {
    method: 'POST',
    headers: { 'paypal-auth-algo': 'SHA256withRSA', 'paypal-cert-url': 'https://paypal.test/cert',
               'paypal-transmission-id': 'tx', 'paypal-transmission-sig': 'sig', 'paypal-transmission-time': 'now' },
    on(ev, fn) { if (ev === 'data') fn(Buffer.from(raw)); if (ev === 'end') fn(); return req; },
  };
  return req;
}

// ── the board ────────────────────────────────────────────────────────────────

test('/api/zones reports sold and held separately', async () => {
  const { default: zones } = await import('../api/zones.js');
  reply('/rest/v1/purchases?paypal_order_id=like.DEMO-', null, true, 204);   // the one-off purge
  reply('/rpc/release_expired_holds', 2);
  reply('/rest/v1/purchases', [
    { zone_id: 'H5', status: 'paid', brand_name: 'Acme', brand_url: 'https://acme.com', artwork_url: 'https://cdn/a.svg', paid_at: '2026-01-01T00:00:00Z' },
    { zone_id: 'R3', status: 'pending' },
  ]);
  const r = res();
  await zones({ method: 'GET', headers: {} }, r);
  const out = payload(r);
  assert.deepEqual(out.sold, [{ zone: 'H5', brand: 'Acme', url: 'https://acme.com', artwork: 'https://cdn/a.svg', at: '2026-01-01T00:00:00Z' }]);
  assert.deepEqual(out.held, ['R3']);
});

test('the board clears the rows demo mode left behind', async () => {
  // Temporary. Delete this test and the code it covers once the live board reads zero.
  const { default: zones } = await import('../api/zones.js');
  reply('/rest/v1/purchases?paypal_order_id=like.DEMO-', null, true, 204);
  reply('/rpc/release_expired_holds', 0);
  reply('/rest/v1/purchases', []);
  await zones({ method: 'GET', headers: {} }, res());
  const purge = calls.find(c => c.method === 'DELETE');
  assert.ok(purge, 'a DELETE must be issued');
  assert.match(purge.url, /paypal_order_id=like\.DEMO-\*/,
    'and it must be narrowed to demo orders — nothing else may ever be deleted here');
});

test('the board is cacheable at the edge but never in the browser', () => {
  // Every visitor polls this every 15 seconds, so it has to be absorbed by the CDN rather
  // than reaching Supabase once per visitor per poll. max-age=0 keeps the browser out of it,
  // so a reload is always current; s-maxage lets the edge answer for everyone else.
  const src = readFileSync(new URL('../api/zones.js', import.meta.url), 'utf8');
  const m = src.match(/'(public,[^']*)'/);
  assert.ok(m, 'zones.js must pass an explicit cache directive to json()');
  assert.match(m[1], /max-age=0/, 'the browser must not hold a stale board across a reload');
  assert.match(m[1], /s-maxage=\d+/, 'the edge is the whole point');
});

test('everything that moves money is still no-store', async () => {
  // The default in json() is what protects these; only the board opts out of it.
  const { default: checkout } = await import('../api/checkout.js');
  const r = res();
  await checkout({ method: 'GET', headers: {}, query: {}, body: {} }, r);
  assert.equal(r.headers['cache-control'], 'no-store');
});

test('the board survives the database being down', async () => {
  const { default: zones } = await import('../api/zones.js');
  reply('/rest/v1/purchases?paypal_order_id=like.DEMO-', null, true, 204);
  reply('/rpc/release_expired_holds', {}, false, 500);
  reply('/rest/v1/purchases', { message: 'boom' }, false, 500);
  const r = res();
  await zones({ method: 'GET', headers: {} }, r);
  assert.equal(r.statusCode, 500);
  assert.ok(payload(r).error, 'and it says so, rather than pretending everything is open');
});

test('every zone id the client can ask for resolves to a price', async () => {
  const { zone } = await import('../api/_lib.js');
  for (const z of ZONES) assert.equal(zone(z.id).price, z.price);
  assert.throws(() => zone('../etc/passwd'), /No such zone/);
  assert.throws(() => zone(''), /No such zone/);
});

after(() => { globalThis.fetch = realFetch; });

// ── the diagnosis that matters when nothing works ────────────────────────────

test('credentials for the wrong PayPal environment say so, by name', async () => {
  // "Client Authentication failed" is what PayPal returns when a live key pair is offered to
  // sandbox, or the reverse. Guessing at that costs an afternoon, so the code checks.
  const { paypalToken } = await import('../api/_lib.js');
  process.env.PAYPAL_ENV = 'sandbox';
  process.env.PAYPAL_CLIENT_ID = 'live-pair';       // a different pair, so no cached token applies
  reply('sandbox.paypal.com/v1/oauth2/token', { error: 'invalid_client', error_description: 'Client Authentication failed' }, false, 401);
  reply('api-m.paypal.com/v1/oauth2/token', { access_token: 'live-token', expires_in: 3600 });

  await assert.rejects(() => paypalToken(), err => {
    assert.match(err.message, /work on live/);
    assert.match(err.message, /PAYPAL_ENV=live/);
    assert.match(err.message, /Nothing was charged/);
    return true;
  });
});

test('credentials that work nowhere get the other message, not the misleading one', async () => {
  const { paypalToken } = await import('../api/_lib.js');
  process.env.PAYPAL_ENV = 'sandbox';
  process.env.PAYPAL_CLIENT_ID = 'nonsense-pair';
  reply('sandbox.paypal.com/v1/oauth2/token', { error_description: 'Client Authentication failed' }, false, 401);
  reply('api-m.paypal.com/v1/oauth2/token', { error_description: 'Client Authentication failed' }, false, 401);
  await assert.rejects(() => paypalToken(), err => {
    assert.match(err.message, /same app/);
    assert.doesNotMatch(err.message, /work on live/);
    return true;
  });
});

test('a secret pasted with a trailing newline is trimmed, not sent as-is', async () => {
  const { env } = await import('../api/_lib.js');
  process.env.PAYPAL_CLIENT_SECRET = '  a-secret\n';
  assert.equal(env('PAYPAL_CLIENT_SECRET'), 'a-secret');
  process.env.PAYPAL_CLIENT_SECRET = 'secret';
});

test('/api/health reports what is wrong without printing a secret', async () => {
  const { default: health } = await import('../api/health.js');
  process.env.PAYPAL_ENV = 'sandbox';
  process.env.PAYPAL_CLIENT_ID = 'health-pair';
  process.env.PAYPAL_CLIENT_SECRET = 'super-secret-value';
  reply('/rest/v1/purchases', [{ id: 'x' }]);
  reply('sandbox.paypal.com/v1/oauth2/token', { error_description: 'Client Authentication failed' }, false, 401);
  reply('api-m.paypal.com/v1/oauth2/token', { access_token: 't', expires_in: 3600 });
  const r = res();
  await health({ method: 'GET', headers: { host: 'x' } }, r);
  const body = r.body;
  assert.equal(r.statusCode, 503, 'a broken configuration is not a healthy one');
  assert.ok(!body.includes('super-secret-value'), 'the secret must never appear in the response');
  const out = JSON.parse(body);
  assert.match(out.paypal.fix, /sandbox credentials|are sandbox|PAYPAL_ENV=live/);
  assert.equal(out.supabase.status.startsWith('reachable'), true);
});

test('PAYPAL_ENV is read forgivingly — Live and LIVE mean live', async () => {
  const { paypalMode, paypalBase } = await import('../api/_lib.js');
  for (const v of ['live', 'Live', 'LIVE', ' live ', 'production', 'prod']) {
    process.env.PAYPAL_ENV = v;
    assert.equal(paypalMode(), 'live', `"${v}" should mean live`);
    assert.equal(paypalBase(), 'https://api-m.paypal.com');
  }
  for (const v of ['sandbox', 'Sandbox', '', 'test', 'staging']) {
    process.env.PAYPAL_ENV = v;
    assert.equal(paypalMode(), 'sandbox', `"${v}" must not silently mean live`);
  }
  process.env.PAYPAL_ENV = 'sandbox';
});
