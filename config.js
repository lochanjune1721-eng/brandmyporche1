// config.js — everything you would change without touching code.
// The zone map itself lives in zones.js; the numbers there are load-bearing.

import { ZONES, TIERS, GOAL, PANELS, PANEL_LABEL, askTotal, tally } from './zones.js';

export const CONFIG = {
  currency: '$',
  /** Minimum raise over the standing bid. */
  minIncrement: 50,
  /** The car. Every priced zone at ask adds up to exactly this — see zones.js. */
  goal: GOAL,
  endsAt: '2026-09-15T20:00:00Z',

  modelUrl: './model.glb',
  modelCredit: 'Porsche 911 model — CC0 (Sketchfab). Porsche and 911 are trademarks of Dr. Ing. h.c. F. Porsche AG.',

  /** Live bids. Leave blank and the site runs on localStorage as a demo. */
  supabaseUrl: '',
  supabaseAnonKey: '',
  /** Winners pay after the close, never before. */
  paypal: { paypalMe: 'your-paypal-me', clientId: '', currency: 'USD' },

  /** What a winner actually gets. No invented impressions — see /media. */
  reach: { wrapDays: 14, events: 3, city: 'San Francisco' },

  spots: ZONES,
  tiers: TIERS,
  panels: PANELS,
  panelLabel: PANEL_LABEL,
};

export { ZONES, TIERS, GOAL, PANELS, PANEL_LABEL, askTotal, tally };
