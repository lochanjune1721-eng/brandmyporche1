// GET /api/zones — which zones are gone, and who has them.
// The only thing the browser learns about the database, and it is all public information.

import { sb, sbRpc, json, route, demoMode } from './_lib.js';

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
  // Every visitor polls this every 15 seconds. Served from the origin that is one Supabase
  // read per visitor per poll, which is the first thing that falls over under real traffic;
  // served from the edge it is one read per 10 seconds for everybody. The board is allowed to
  // be ten seconds old — it already refreshes on a slower cycle than that — and a buyer never
  // waits for it, because the fetch after a purchase carries a cache-buster.
  // max-age=0 keeps the browser out of it, so a reload is always current.
  json(res, 200, { sold, held, serverTime: new Date().toISOString(), demo: demoMode() || undefined },
       'public, max-age=0, s-maxage=10, stale-while-revalidate=60');
});
