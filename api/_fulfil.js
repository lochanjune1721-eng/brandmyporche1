// api/_fulfil.js — the one place a purchase becomes real.
//
// Called from two directions: the buyer returning from PayPal, and PayPal's webhook. Both can
// arrive, in either order, and one of them may arrive twice. So this is written to be safe to
// run any number of times: the update is conditional on the row still being pending, and the
// receipt only goes out on the call that actually flipped it.

import { sb, env } from './_lib.js';

/**
 * @param purchase  the row
 * @param captureId PayPal capture id, when we have one
 * @param payer     PayPal's payer block — the only place we learn who bought it
 */
export async function markPaid(purchase, captureId, payer) {
  const patch = { status: 'paid', paid_at: new Date().toISOString() };
  if (captureId) patch.paypal_capture_id = captureId;
  // The form never asked for these. PayPal has already verified them, which is better than
  // anything we could have collected in a text box.
  const name = [payer?.name?.given_name, payer?.name?.surname].filter(Boolean).join(' ').trim();
  if (name) patch.buyer_name = name.slice(0, 120);
  if (payer?.email_address) patch.buyer_email = String(payer.email_address).toLowerCase().slice(0, 190);

  // status=eq.pending is the guard. If another path already marked it paid, this updates
  // nothing and returns an empty array — which is exactly how we know not to email twice.
  const rows = await sb(`purchases?id=eq.${purchase.id}&status=eq.pending`, {
    method: 'PATCH', prefer: 'return=representation', body: patch,
  });
  const flipped = Array.isArray(rows) && rows.length > 0;
  if (flipped && rows[0].buyer_email) await sendReceipt(rows[0]).catch(err => console.error('[receipt]', err.message));
  return flipped;
}

/** Best effort. A receipt that fails to send must never fail a payment that succeeded. */
async function sendReceipt(p) {
  const key = env('RESEND_API_KEY');
  if (!key) return;
  const amount = (p.price_cents / 100).toLocaleString('en-US', { style: 'currency', currency: p.currency || 'USD' });
  const site = (env('SITE_URL') || 'https://brandmy911.com').replace(/\/$/, '');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env('RECEIPT_FROM') || 'Brand My 911 <hello@brandmy911.com>',
      to: p.buyer_email,
      subject: `Zone ${p.zone_id} is yours — ${amount}`,
      html: `<div style="font-family:system-ui,sans-serif;line-height:1.6;max-width:34em">
        <p><b>Zone ${p.zone_id} is yours.</b></p>
        <p>${amount} received for ${p.brand_name}. Your icon goes on that panel, it links to
        <a href="${p.brand_url}">${p.brand_name}</a> on the site, the wrap stays on for 14 days,
        and every zone appears in the daily photo set.</p>
        <p>Sizes, artwork specification and the deadline for final files are all in the
        <a href="${site}/media/">media kit</a>. If what you sent is already print-ready, there
        is nothing else for you to do.</p>
        <p>Reply to this email if anything needs changing.</p>
        <p style="color:#666;font-size:13px">Order ${p.paypal_order_id || p.id}</p>
      </div>`,
    }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
}
