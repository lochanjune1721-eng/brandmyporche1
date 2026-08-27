// GET /api/cancel?purchase=… — the buyer backed out at PayPal. Put the zone straight back on
// the board instead of making the next person wait out the hold.

import { sb, route, env } from './_lib.js';

export default route(async (req, res) => {
  const id = String(req.query.purchase || '');
  let zoneId = '';
  if (id) {
    const [p] = await sb(`purchases?id=eq.${id}&select=id,zone_id,status`);
    if (p && p.status === 'pending') {
      zoneId = p.zone_id;
      await sb(`purchases?id=eq.${id}&status=eq.pending`, { method: 'PATCH', body: { status: 'released' } });
    }
  }
  const site = (env('SITE_URL') || `https://${req.headers.host}`).replace(/\/$/, '');
  res.writeHead(302, { Location: `${site}/?cancelled=${encodeURIComponent(zoneId)}`, 'Cache-Control': 'no-store' });
  res.end();
});
