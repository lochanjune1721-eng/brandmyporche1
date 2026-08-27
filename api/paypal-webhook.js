// POST /api/paypal-webhook — PayPal telling us money moved.
//
// The buyer's browser is not a reliable narrator: they can close the tab between approving
// and being redirected back. This is the path that makes the sale stick anyway.
//
// Every call is verified against PayPal before it is believed. An unverified webhook is
// rejected outright — otherwise anyone who can POST here could mark the hood sold.

import { sb, paypal, json, route, rawBody, required } from './_lib.js';
import { markPaid } from './_fulfil.js';

export const config = { api: { bodyParser: false } };   // verification needs the exact bytes

export default route(async (req, res) => {
  if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });

  const raw = await rawBody(req);
  let event;
  try { event = JSON.parse(raw); } catch { return json(res, 400, { error: 'Not JSON' }); }

  const verification = await paypal('/v1/notifications/verify-webhook-signature', {
    method: 'POST',
    body: {
      auth_algo: req.headers['paypal-auth-algo'],
      cert_url: req.headers['paypal-cert-url'],
      transmission_id: req.headers['paypal-transmission-id'],
      transmission_sig: req.headers['paypal-transmission-sig'],
      transmission_time: req.headers['paypal-transmission-time'],
      webhook_id: required('PAYPAL_WEBHOOK_ID'),
      webhook_event: event,
    },
  });
  if (verification.verification_status !== 'SUCCESS') {
    console.warn('[webhook] rejected an unverified call', event.event_type);
    return json(res, 401, { error: 'Signature did not verify' });
  }

  const type = event.event_type;
  const resource = event.resource || {};
  // custom_id is the purchase row id; we put it there when the order was created.
  const purchaseId = resource.custom_id
    || resource.purchase_units?.[0]?.custom_id
    || resource.supplementary_data?.related_ids?.order_id && null;

  if (type === 'PAYMENT.CAPTURE.COMPLETED' || type === 'CHECKOUT.ORDER.APPROVED') {
    const [p] = purchaseId
      ? await sb(`purchases?id=eq.${purchaseId}&select=*`)
      : await sb(`purchases?paypal_order_id=eq.${resource.id}&select=*`);
    if (!p) { console.warn('[webhook] no purchase for', type, purchaseId || resource.id); return json(res, 200, { ok: true }); }

    if (type === 'CHECKOUT.ORDER.APPROVED' && p.status === 'pending') {
      // The buyer approved but may never come back to /api/return. Take the money here.
      try {
        const captured = await paypal(`/v2/checkout/orders/${p.paypal_order_id}/capture`, {
          method: 'POST', headers: { 'PayPal-Request-Id': `capture-${p.id}` }, body: {},
        });
        await markPaid(p, captured?.purchase_units?.[0]?.payments?.captures?.[0]?.id, captured?.payer);
      } catch (err) {
        if (!JSON.stringify(err.extra || '').includes('ORDER_ALREADY_CAPTURED')) throw err;
        await markPaid(p, null, null);
      }
    } else if (type === 'PAYMENT.CAPTURE.COMPLETED') {
      await markPaid(p, resource.id, resource.payer || event.resource?.payer);
    }
    return json(res, 200, { ok: true });
  }

  if (type === 'PAYMENT.CAPTURE.REFUNDED' || type === 'PAYMENT.CAPTURE.REVERSED') {
    // Money went back, so the panel goes back on the board.
    const target = purchaseId ? `id=eq.${purchaseId}` : `paypal_capture_id=eq.${resource.id}`;
    await sb(`purchases?${target}`, { method: 'PATCH', body: { status: 'refunded' } });
    return json(res, 200, { ok: true });
  }

  json(res, 200, { ok: true, ignored: type });
});
