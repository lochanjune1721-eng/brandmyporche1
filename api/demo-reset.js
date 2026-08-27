// GET /api/demo-reset — clear everything bought in demo mode and put the board back to empty.
//
// Only ever touches rows this site created in demo mode: their paypal_order_id carries the
// DEMO- prefix, and a real purchase never does. Refuses outright unless DEMO_MODE is on, so
// the endpoint cannot be used to wipe a live board even if someone finds the URL.

import { sb, json, route, env, demoMode, DEMO_PREFIX } from './_lib.js';

export default route(async (req, res) => {
  if (!demoMode()) return json(res, 404, { error: 'Not found.' });

  const doomed = await sb(`purchases?paypal_order_id=like.${DEMO_PREFIX}*&select=id,zone_id`);
  await sb(`purchases?paypal_order_id=like.${DEMO_PREFIX}*`, { method: 'DELETE' });

  if (String(req.query.redirect || '') === '1') {
    const site = (env('SITE_URL') || `https://${req.headers.host}`).replace(/\/$/, '');
    res.writeHead(302, { Location: `${site}/?reset=${doomed?.length || 0}`, 'Cache-Control': 'no-store' });
    return res.end();
  }
  json(res, 200, { cleared: doomed?.length || 0, zones: (doomed || []).map(r => r.zone_id) });
});
