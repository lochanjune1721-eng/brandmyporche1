// config.js — everything you would change without touching code.
// The zone map itself lives in zones.js; the numbers there are load-bearing.

import { ZONES, TIERS, GOAL, PANELS, PANEL_LABEL, askTotal, tally } from './zones.js';

export const CONFIG = {
  currency: '$',
  /** The car. Every priced zone at ask adds up to exactly this — see zones.js. */
  goal: GOAL,
  /** When the board closes. Zones can be bought right up to it. 30 days from launch on
   *  2026-08-27. The countdown in the hero and the sticky bar both read from here, and the
   *  server does not enforce it — closing is a decision, so move this date rather than
   *  discovering the board has shut itself on a night nobody was watching. */
  endsAt: '2026-09-26T20:00:00Z',

  modelUrl: './model.glb',
  modelCredit: 'Porsche 911 model — CC0 (Sketchfab). Porsche and 911 are trademarks of Dr. Ing. h.c. F. Porsche AG.',

  // No keys here, on purpose. Supabase and PayPal are reached only by the functions in /api,
  // using environment variables — see .env.example. Nothing secret ships to a browser, and a
  // zone's price is decided on the server rather than in a file anyone can read and edit.

  /** What a winner actually gets. No invented impressions — see /media. */
  reach: { wrapDays: 14, events: 3, city: 'San Francisco' },

  spots: ZONES,
  tiers: TIERS,
  panels: PANELS,
  panelLabel: PANEL_LABEL,
};

export { ZONES, TIERS, GOAL, PANELS, PANEL_LABEL, askTotal, tally };
