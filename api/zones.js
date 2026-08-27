// GET /api/zones — which zones are gone, and who has them.
// The only thing the browser learns about the database, and it is all public information.

import { sb, sbRpc, json, route } from './_lib.js';

export default route(async (req, res) => {
  if (req.method !== 'GET') return json(res, 405, { error: 'GET only' });

  await sbRpc('release_expired_holds').catch(() => {});   // best effort; never blocks a read

  const rows = await sb('purchases?select=zone_id,status,brand_name,brand_url,artwork_url,paid_at' +
                        '&status=in.(paid,pending)&order=paid_at.desc.nullslast');

  const sold = [], held = [];
  for (const r of rows || []) {
    if (r.status === 'paid') {
      sold.push({ zone: r.zone_id, brand: r.brand_name, url: r.brand_url, artwork: r.artwork_url, at: r.paid_at });
    } else {
      held.push(r.zone_id);          // someone is at the checkout right now
    }
  }
  res.setHeader('Cache-Control', 'no-store');
  json(res, 200, { sold, held, serverTime: new Date().toISOString() });
});
