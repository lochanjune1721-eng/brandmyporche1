// GET /api/zones — which zones are gone, and who has them.
// The only thing the browser learns about the database, and it is all public information.

import { sb, sbRpc, json, route } from './_lib.js';

// One-off cleanup, to be deleted once the board reads zero.
//
// Demo mode is gone from the code, but the rows it wrote are still on the board, and the
// endpoint that could have cleared them went with it. A DEMO- order id can never belong to a
// real purchase — nothing writes that prefix any more — so deleting them is always correct.
// Once per cold start, not once per request, and a failure just means the next one retries.
let demoRowsPurged = false;
async function purgeDemoRows() {
  if (demoRowsPurged) return;
  try {
    await sb('purchases?paypal_order_id=like.DEMO-*', { method: 'DELETE' });
    demoRowsPurged = true;
  } catch (err) {
    console.warn('[zones] demo row purge failed, will retry', err.message);
  }
}

export default route(async (req, res) => {
  if (req.method !== 'GET') return json(res, 405, { error: 'GET only' });

  await purgeDemoRows();
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
  json(res, 200, { sold, held, serverTime: new Date().toISOString() },
       'public, max-age=0, s-maxage=10, stale-while-revalidate=60');
});
