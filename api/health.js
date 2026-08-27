// GET /api/health — what is actually configured, and does it work.
//
// Answers the questions you would otherwise answer by redeploying with console.log: is each
// variable set, does Supabase accept the key, does PayPal accept the pair, and — the one that
// catches most people — are the PayPal credentials for the environment PAYPAL_ENV names.
//
// Never prints a secret. Client IDs are public; secrets are reported only as a length and a
// warning if they look like they were pasted with whitespace.

import { env, sb, tryPaypalToken, paypalMode, json, route } from './_lib.js';

const raw = k => process.env[k] || '';
const shape = k => {
  const v = raw(k);
  if (!v) return { set: false };
  return {
    set: true,
    length: v.trim().length,
    ...(v !== v.trim() ? { warning: 'has leading or trailing whitespace — paste it again without the newline' } : {}),
  };
};

export default route(async (req, res) => {
  const mode = paypalMode();
  // Show what was typed next to what it was read as — 'Live' meaning sandbox is a nasty surprise.
  const declared = env('PAYPAL_ENV') || '(unset, defaults to sandbox)';
  const out = {
    ok: true,
    paypal: { env: mode, envVar: declared, clientId: env('PAYPAL_CLIENT_ID').slice(0, 8) + '…', secret: shape('PAYPAL_CLIENT_SECRET'),
              webhookId: shape('PAYPAL_WEBHOOK_ID'), currency: env('PAYPAL_CURRENCY') || 'USD' },
    supabase: { url: env('SUPABASE_URL') || null, serviceKey: shape('SUPABASE_SERVICE_ROLE_KEY') },
    site: { url: env('SITE_URL') || `https://${req.headers.host}`, holdMinutes: Number(env('HOLD_MINUTES') || 20) },
    receipts: raw('RESEND_API_KEY') ? 'on' : 'off (payments still work; buyers just get no email)',
  };

  // Supabase: can we actually read the table?
  try {
    const rows = await sb('purchases?select=id&limit=1');
    out.supabase.status = `reachable, ${Array.isArray(rows) ? 'purchases table found' : 'unexpected response'}`;
  } catch (err) {
    out.ok = false;
    out.supabase.status = `FAILED — ${err.message}`;
    if (/relation .* does not exist|Could not find the table/i.test(err.message)) {
      out.supabase.fix = 'Run supabase/schema.sql in the Supabase SQL editor.';
    }
  }

  // PayPal: try the configured environment, and if it fails, try the other one and say so.
  const got = await tryPaypalToken(mode).catch(err => ({ ok: false, why: err.message }));
  if (got.ok) {
    out.paypal.status = `authenticated against ${mode}`;
  } else {
    out.ok = false;
    const other = mode === 'live' ? 'sandbox' : 'live';
    const cross = await tryPaypalToken(other).catch(() => ({ ok: false }));
    out.paypal.status = `FAILED on ${mode} — ${got.why}`;
    out.paypal.fix = cross.ok
      ? `These credentials are ${other} credentials. Either set PAYPAL_ENV=${other}, or replace them with the pair from your ${mode} app.`
      : 'The pair is rejected by both environments. Take the Client ID and Secret from the same app in the PayPal developer dashboard — the secret is the one you generate under the app, not your account password — and paste them with no trailing newline.';
  }

  json(res, out.ok ? 200 : 503, out);
});
