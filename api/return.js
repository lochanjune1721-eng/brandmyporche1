// GET /api/return?purchase=… — where PayPal sends the buyer after they approve.
// Captures the money, marks the zone sold, then bounces them back to the car.
//
// Capture happens here *and* in the webhook. Both are idempotent, because a buyer who closes
// the tab on the PayPal page still paid and must still get their panel.

import { sb, paypal, route, env, HttpError } from './_lib.js';
import { markPaid } from './_fulfil.js';

export default route(async (req, res) => {
  const site = (env('SITE_URL') || `https://${req.headers.host}`).replace(/\/$/, '');
  const id = String(req.query.purchase || '');
  const back = (q) => { res.writeHead(302, { Location: `${site}/${q}`, 'Cache-Control': 'no-store' }); res.end(); };

  if (!id) return back('?paid=unknown');
  const [p] = await sb(`purchases?id=eq.${id}&select=*`);
  if (!p) return back('?paid=unknown');
  if (p.status === 'paid') return back(`?bought=${encodeURIComponent(p.zone_id)}`);
  if (!p.paypal_order_id) return back(`?paid=failed&zone=${encodeURIComponent(p.zone_id)}`);

  try {
    const captured = await paypal(`/v2/checkout/orders/${p.paypal_order_id}/capture`, {
      method: 'POST',
      headers: { 'PayPal-Request-Id': `capture-${p.id}` },
      body: {},
    });
    const capture = captured?.purchase_units?.[0]?.payments?.captures?.[0];
    if (captured.status !== 'COMPLETED' && capture?.status !== 'COMPLETED') {
      throw new HttpError(502, `PayPal returned ${captured.status}`);
    }
    await markPaid(p, capture?.id, captured?.payer);
    back(`?bought=${encodeURIComponent(p.zone_id)}`);
  } catch (err) {
    // ORDER_ALREADY_CAPTURED means the webhook beat us to it. That is a success, not an error.
    const already = JSON.stringify(err.extra || '').includes('ORDER_ALREADY_CAPTURED');
    if (already) { await markPaid(p, null, null); return back(`?bought=${encodeURIComponent(p.zone_id)}`); }
    console.error('[return] capture failed', err.message, err.extra);
    back(`?paid=failed&zone=${encodeURIComponent(p.zone_id)}`);
  }
});
