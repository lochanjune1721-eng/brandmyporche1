// api/_lib.js — the bits every endpoint needs: Supabase over REST, PayPal over REST, and
// the one rule that matters — the price of a zone comes from zones.js on the server, never
// from the request body.

import { ZONES } from '../zones.js';

const zoneById = new Map(ZONES.map(z => [z.id, z]));

export const env = k => (process.env[k] || '').trim();
export const required = k => {
  const v = env(k);
  if (!v) throw new HttpError(500, `Server is not configured: ${k} is missing.`);
  return v;
};

export class HttpError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; this.extra = extra; }
}

/** The authoritative price. A browser can post whatever it likes; this is what gets charged. */
export function zone(zoneId) {
  const z = zoneById.get(String(zoneId || ''));
  if (!z) throw new HttpError(400, `No such zone: ${zoneId}`);
  return z;
}

// ── Supabase (service role, server side only) ────────────────────────────────

export async function sb(path, { method = 'GET', body, prefer, headers = {} } = {}) {
  const url = `${required('SUPABASE_URL')}/rest/v1/${path}`;
  const key = required('SUPABASE_SERVICE_ROLE_KEY');
  const res = await fetch(url, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    // 23505 is a unique-violation: someone else holds or owns this zone.
    if (data?.code === '23505') throw new HttpError(409, 'That zone has just been taken.', { code: data.code });
    throw new HttpError(res.status, data?.message || `Supabase ${res.status}`, { data });
  }
  return data;
}

export async function sbRpc(fn, args = {}) {
  return sb(`rpc/${fn}`, { method: 'POST', body: args });
}

/** Put a file in the public `artwork` bucket and return its public URL. */
export async function uploadArtwork(purchaseId, dataUrl) {
  const m = /^data:([\w.+-]+\/[\w.+-]+);base64,(.+)$/s.exec(dataUrl || '');
  if (!m) throw new HttpError(400, 'Artwork must be a base64 data URL.');
  const [, mime, b64] = m;
  const ext = { 'image/svg+xml': 'svg', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[mime];
  if (!ext) throw new HttpError(400, 'Artwork must be SVG, PNG, JPG or WebP.');
  const bytes = Buffer.from(b64, 'base64');
  if (bytes.length > 3 * 1024 * 1024) throw new HttpError(413, 'Artwork must be 3 MB or smaller.');

  const path = `${purchaseId}.${ext}`;
  const key = required('SUPABASE_SERVICE_ROLE_KEY');
  const res = await fetch(`${required('SUPABASE_URL')}/storage/v1/object/artwork/${path}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': mime, 'x-upsert': 'true' },
    body: bytes,
  });
  if (!res.ok) throw new HttpError(502, `Could not store the artwork: ${await res.text()}`);
  return `${required('SUPABASE_URL')}/storage/v1/object/public/artwork/${path}`;
}

// ── PayPal ───────────────────────────────────────────────────────────────────

/** 'live', 'Live', 'LIVE', 'production' all mean live. Anything else means sandbox — and
 *  getting that wrong silently is how you end up testing against real money, or wondering why
 *  real credentials are rejected. */
export const paypalMode = () => /^(live|production|prod)$/i.test(env('PAYPAL_ENV')) ? 'live' : 'sandbox';

export const paypalBase = () =>
  // PAYPAL_API_BASE points the whole integration at a stand-in, which is how the checkout is
  // exercised end to end without touching PayPal. Never set it in production.
  env('PAYPAL_API_BASE') ||
  (paypalMode() === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com');

// Keyed by environment and client id: flipping PAYPAL_ENV must not reuse a token minted
// against the other environment.
let tokenCache = { value: '', expires: 0, key: '' };

/** Ask PayPal for a token against a named environment. Returns {ok, token} or {ok:false, why}. */
export async function tryPaypalToken(mode) {
  const id = env('PAYPAL_CLIENT_ID'), secret = env('PAYPAL_CLIENT_SECRET');
  if (!id || !secret) return { ok: false, why: 'PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET is not set' };
  const base = env('PAYPAL_API_BASE') ||
    (mode === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com');
  const res = await fetch(`${base}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, why: data.error_description || data.error || `HTTP ${res.status}` };
  return { ok: true, token: data.access_token, expiresIn: data.expires_in };
}

export async function paypalToken() {
  const mode = paypalMode();
  const key = `${mode}:${env('PAYPAL_CLIENT_ID')}`;
  if (tokenCache.value && tokenCache.key === key && Date.now() < tokenCache.expires) return tokenCache.value;
  const got = await tryPaypalToken(mode);
  if (got.ok) {
    tokenCache = { value: got.token, expires: Date.now() + (got.expiresIn - 60) * 1000, key };
    return tokenCache.value;
  }
  // "Client Authentication failed" almost always means the keys are for the OTHER environment.
  // Rather than make someone guess, find out — then say so, and still refuse to charge anyone
  // against an environment they did not configure.
  const other = mode === 'live' ? 'sandbox' : 'live';
  const cross = await tryPaypalToken(other).catch(() => ({ ok: false }));
  if (cross.ok) {
    throw new HttpError(500,
      `PayPal rejected these credentials on ${mode}, but they work on ${other}. ` +
      `Set PAYPAL_ENV=${other}, or swap in your ${mode} client ID and secret. Nothing was charged.`);
  }
  throw new HttpError(502,
    `PayPal auth failed on ${mode}: ${got.why}. Check PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET ` +
    `are the pair from the same app in the ${mode} dashboard, with no stray spaces. Nothing was charged.`);
}

export async function paypal(path, { method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(`${paypalBase()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${await paypalToken()}`,
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new HttpError(502, data?.message || `PayPal ${res.status}`, { data });
  return data;
}

// ── plumbing ─────────────────────────────────────────────────────────────────

export const money = cents => (cents / 100).toFixed(2);

export function json(res, status, payload) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).send(JSON.stringify(payload));
}

/** Wrap a handler so a thrown HttpError becomes a clean response and anything else becomes a
 *  500 that says nothing about the internals. */
export function route(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (err) {
      if (err instanceof HttpError) {
        if (err.status >= 500) console.error('[api]', err.message, err.extra);
        return json(res, err.status, { error: err.message });
      }
      console.error('[api] unhandled', err);
      return json(res, 500, { error: 'Something went wrong on our side. Nothing was charged.' });
    }
  };
}

/** Vercel parses JSON bodies for us, but the PayPal webhook needs the bytes exactly as sent. */
export function rawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export const isEmail = s => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(s || ''));

/** The buyer types a website and nothing else, so this has to be generous about what it
 *  accepts and strict about what it stores. Returns { url, label } or null.
 *  The label is the bare domain — it is what shows on the board, so nobody gets to inject a
 *  brand name that is not theirs. */
export function websiteOf(raw) {
  let t = String(raw || '').trim();
  if (!t) return null;
  if (!/^https?:\/\//i.test(t)) t = 'https://' + t;
  let u;
  try { u = new URL(t); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.toLowerCase();
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) || host.endsWith('.local')) return null;
  if (['localhost', '127.0.0.1', '0.0.0.0'].includes(host)) return null;
  u.protocol = 'https:'; u.hash = '';
  return { url: u.toString().replace(/\/$/, ''), label: host.replace(/^www\./, '') };
}
export const clean = (s, max) => String(s ?? '').trim().slice(0, max);
