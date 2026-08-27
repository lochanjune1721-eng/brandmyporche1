// POST /api/checkout — reserve a zone and open a PayPal order for it.
//
// The order of operations is the point. We reserve the zone in Postgres *first*, on a unique
// index, so two people cannot both be sent to PayPal for the same panel. Only then do we ask
// PayPal for an order. If PayPal says no, the hold is released immediately rather than left
// to expire.
//
// The amount comes from zones.js on this server. Nothing in the request body sets a price.

import { zone, sb, sbRpc, uploadArtwork, paypal, json, route, money, env,
         HttpError, websiteOf } from './_lib.js';

export const config = { api: { bodyParser: { sizeLimit: '5mb' } } };   // artwork rides along

export default route(async (req, res) => {
  if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });

  const b = req.body || {};
  const z = zone(b.zoneId);                       // 404s an unknown zone before anything else

  // Two fields. Everything else about the buyer arrives from PayPal when the money does, so
  // there is nothing here for someone to mistype and nothing extra for us to hold.
  const site = websiteOf(b.url);
  if (!site) throw new HttpError(400, 'That does not look like a website. Something like acme.com.');
  if (!b.artwork) throw new HttpError(400, 'Upload your icon — it goes straight onto the car.');

  const currency = env('PAYPAL_CURRENCY') || 'USD';
  const holdMinutes = Number(env('HOLD_MINUTES') || 20);

  await sbRpc('release_expired_holds').catch(() => {});

  // Reserve. The partial unique indexes make this the moment the zone becomes ours; a second
  // buyer arriving here gets a 409 rather than a second PayPal order for the same panel.
  const [purchase] = await sb('purchases', {
    method: 'POST',
    prefer: 'return=representation',
    body: [{
      zone_id: z.id,
      status: 'pending',
      price_cents: z.price * 100,
      currency,
      brand_name: site.label,
      brand_url: site.url,
      hold_expires_at: new Date(Date.now() + holdMinutes * 60_000).toISOString(),
    }],
  });

  const release = async why => {
    await sb(`purchases?id=eq.${purchase.id}`, { method: 'PATCH', body: { status: 'released' } }).catch(() => {});
    throw why;
  };

  try {
    const artworkUrl = await uploadArtwork(purchase.id, b.artwork);
    const origin = (env('SITE_URL') || `https://${req.headers.host}`).replace(/\/$/, '');

    const order = await paypal('/v2/checkout/orders', {
      method: 'POST',
      headers: { 'PayPal-Request-Id': purchase.id },        // idempotency, in case of a retry
      body: {
        intent: 'CAPTURE',
        purchase_units: [{
          reference_id: z.id,
          custom_id: purchase.id,
          description: `Brand My 911 — zone ${z.id} (${z.tier}, ${z.wCm} cm)`.slice(0, 127),
          amount: { currency_code: currency, value: money(z.price * 100) },
        }],
        application_context: {
          brand_name: 'Brand My 911',
          user_action: 'PAY_NOW',
          shipping_preference: 'NO_SHIPPING',
          return_url: `${origin}/api/return?purchase=${purchase.id}`,
          cancel_url: `${origin}/api/cancel?purchase=${purchase.id}`,
        },
      },
    });

    const approve = (order.links || []).find(l => l.rel === 'approve' || l.rel === 'payer-action');
    if (!approve) throw new HttpError(502, 'PayPal did not return a checkout link.');

    await sb(`purchases?id=eq.${purchase.id}`, {
      method: 'PATCH',
      body: { paypal_order_id: order.id, artwork_url: artworkUrl },
    });

    json(res, 200, { purchaseId: purchase.id, orderId: order.id, approveUrl: approve.href,
                     zone: z.id, amount: money(z.price * 100), currency, holdMinutes });
  } catch (err) {
    await release(err);
  }
});
