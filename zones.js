// zones.js — the map. 88 surface-conformed ad zones on a Porsche 911.
//
// THE ECONOMICS. 82 priced zones sum to exactly $135,000 — the price of the car.
// The 6 XS zones are $250 each and sit OUTSIDE that maths: they pay running costs.
// `test/zones.test.mjs` asserts every number below. Break one, the suite goes red.
//
// COORDINATES. One world unit = one metre, on the model as the viewer normalises it:
//   X  left −/right +, body half-width ≈ 0.92 (mirrors reach 1.02)
//   Y  ground 0, roof ≈ 1.29
//   Z  nose ≈ +2.25, tail ≈ −2.25
//
// Every row declares a `probe` axis — the direction a ray is cast to find the bodywork —
// and each zone gives (u, v), its position in the two axes perpendicular to that ray.
// At load the viewer re-casts those rays against the real mesh and snaps every zone to
// the hit point and its true surface normal, so no zone floats or sinks. Row geometry is
// authored here; the surface has the final say. Sizes are on-surface metres.
//
//   probe 'down'  ray −Y   u = x   v = z    (hood, roof, engine cover, decklid)
//   probe 'left'  ray +X   u = z   v = y    (left flank)
//   probe 'right' ray −X   u = z   v = y    (right flank)
//   probe 'rear'  ray +Z   u = x   v = y    (rear face)
//   probe 'front' ray −Z   u = x   v = y    (front bumper)

export const TIERS = {
  XXL: { price: 12000, count: 1,  label: 'XXL' },
  XL:  { price: 6000,  count: 4,  label: 'XL'  },
  L:   { price: 3000,  count: 10, label: 'L'   },
  M:   { price: 1500,  count: 22, label: 'M'   },
  S:   { price: 800,   count: 45, label: 'S'   },
  XS:  { price: 250,   count: 6,  label: 'XS'  },   // on-ramp — outside the $135,000
};

/** The car fund. Every priced zone at ask adds up to this and nothing else does. */
export const GOAL = 135000;

/** XS money is ring-fenced for running costs, so it never counts toward the goal. */
export const isPriced = tier => tier !== 'XS';

export const PANELS = ['hood', 'roof', 'left', 'right', 'rear', 'front'];

export const PANEL_LABEL = {
  hood: 'Hood', roof: 'Roof', left: 'Left flank',
  right: 'Right flank', rear: 'Rear', front: 'Front bumper',
};

/** How the viewer turns a probe axis into a decal frame.
 *  `ray` is the cast direction; `axisU`/`axisV` are the world directions that map to the
 *  decal's local +X and +Y, chosen so text reads upright in that panel's view. */
export const PROBE = {
  down:  { origin: (u, v) => [u, 3.2, v],  ray: [0, -1, 0], axisU: [1, 0, 0],  axisV: [0, 0, -1] },
  left:  { origin: (u, v) => [-3.2, v, u], ray: [1, 0, 0],  axisU: [0, 0, 1],  axisV: [0, 1, 0]  },
  right: { origin: (u, v) => [3.2, v, u],  ray: [-1, 0, 0], axisU: [0, 0, -1], axisV: [0, 1, 0]  },
  rear:  { origin: (u, v) => [u, v, -5],   ray: [0, 0, 1],  axisU: [-1, 0, 0], axisV: [0, 1, 0]  },
  front: { origin: (u, v) => [u, v, 5],    ray: [0, 0, -1], axisU: [1, 0, 0],  axisV: [0, 1, 0]  },
};

// Rows read outer-to-inner, or nose-to-tail, in the order they appear in a panel view.
// `v` is the row's line; `h` its on-surface height. Every zone in a row shares both, which
// is what stops 88 zones reading as a wall of dashes — one misaligned zone ruins the grid.
// Rows carry a `probe` and, where the surface is not the panel's usual one, an `on` note.
const ROWS = [

  // ── HOOD, 11 ── the money panel: it is what the default view lands on.
  // Hood sheet runs z 0.94→2.02 between the fender crowns (|x| ≈ 0.70); headlight glass
  // eats |x| ≥ 0.55 from z 1.55 back to 1.95, so band 3 pulls in.
  { panel: 'hood', probe: 'down', v: 1.15, h: 0.26, name: 'Hood — windscreen band', zones: [
    { id: 'H1',  tier: 'L',   u: -0.40, w: 0.28 },
    { id: 'H2',  tier: 'XL',  u:  0.00, w: 0.42 },
    { id: 'H3',  tier: 'L',   u:  0.40, w: 0.28 },
  ]},
  { panel: 'hood', probe: 'down', v: 1.50, h: 0.28, name: 'Hood — centre band', zones: [
    { id: 'H4',  tier: 'M',   u: -0.40, w: 0.22 },
    { id: 'H5',  tier: 'XXL', u:  0.00, w: 0.52 },   // the hero. $12,000. One of these exists.
    { id: 'H6',  tier: 'M',   u:  0.40, w: 0.22 },
  ]},
  { panel: 'hood', probe: 'down', v: 1.83, h: 0.19, name: 'Hood — nose band', zones: [
    { id: 'H7',  tier: 'S',   u: -0.44, w: 0.14 },
    { id: 'H8',  tier: 'S',   u: -0.27, w: 0.17 },
    { id: 'H9',  tier: 'M',   u:  0.00, w: 0.30 },
    { id: 'H10', tier: 'S',   u:  0.27, w: 0.17 },
    { id: 'H11', tier: 'S',   u:  0.44, w: 0.14 },
  ]},

  // ── ROOF, 10 ── the 911 roof is short: metal runs z 0.13→−1.02 only. Rows 5 and 6 sit on
  // the rear glass (z −1.06→−1.68), which is where a rear-window banner goes anyway.
  { panel: 'roof', probe: 'down', v: -0.02, h: 0.16, name: 'Roof — front pair', zones: [
    { id: 'R1',  tier: 'M',   u: -0.20, w: 0.32 },
    { id: 'R2',  tier: 'M',   u:  0.20, w: 0.32 },
  ]},
  { panel: 'roof', probe: 'down', v: -0.28, h: 0.22, name: 'Roof — hero', zones: [
    { id: 'R3',  tier: 'XL',  u:  0.00, w: 0.96 },
  ]},
  { panel: 'roof', probe: 'down', v: -0.55, h: 0.20, name: 'Roof — middle trio', zones: [
    { id: 'R4',  tier: 'M',   u: -0.36, w: 0.22 },
    { id: 'R5',  tier: 'L',   u:  0.00, w: 0.44 },
    { id: 'R6',  tier: 'M',   u:  0.36, w: 0.22 },
  ]},
  { panel: 'roof', probe: 'down', v: -0.81, h: 0.18, name: 'Roof — second hero', zones: [
    { id: 'R7',  tier: 'L',   u:  0.00, w: 0.80 },
  ]},
  { panel: 'roof', probe: 'down', v: -1.24, h: 0.15, on: 'rear glass', name: 'Roof — rear pair', zones: [
    { id: 'R8',  tier: 'S',   u: -0.20, w: 0.30 },
    { id: 'R9',  tier: 'S',   u:  0.20, w: 0.30 },
  ]},
  { panel: 'roof', probe: 'down', v: -1.46, h: 0.12, on: 'rear glass', name: 'Roof — spine strip', zones: [
    { id: 'R10', tier: 'S',   u:  0.00, w: 0.56 },
  ]},

  // ── FLANKS, 20 a side ── mirrored below by mirrorFlank(). Keep-outs that shape this:
  // mirror body (z 0.10→0.42 above y 0.83), front arch (z 0.98→1.60 below y 0.70),
  // rear arch (z −1.62→−0.98 below y 0.70), door handle (z −0.30→−0.02, y 0.70→0.82).
  { panel: 'left', probe: 'left', v: 1.03, h: 0.13, on: 'side glass', name: 'Left — glass band', zones: [
    { id: 'LF1',  tier: 'S',  u: -0.81, w: 0.30 },
    { id: 'LF2',  tier: 'L',  u: -0.34, w: 0.36 },
    { id: 'LF3',  tier: 'L',  u:  0.05, w: 0.34 },
  ]},
  { panel: 'left', probe: 'left', v: 0.762, h: 0.09, name: 'Left — shoulder band', zones: [
    { id: 'LF4',  tier: 'S',  u: -1.50, w: 0.28 },
    { id: 'LF5',  tier: 'M',  u: -1.10, w: 0.38 },
    { id: 'LF6',  tier: 'M',  u: -0.25, w: 0.30 },   // stops short of the rear haunch bulge
    { id: 'LF7',  tier: 'S',  u:  0.50, w: 0.26 },   // gap ahead of it is the handle, gap behind the mirror
    { id: 'LF8',  tier: 'S',  u:  1.16, w: 0.28 },
  ]},
  { panel: 'left', probe: 'left', v: 0.59, h: 0.14, name: 'Left — door band', zones: [
    { id: 'LF9',  tier: 'M',  u: -0.755, w: 0.27 },
    { id: 'LF10', tier: 'S',  u: -0.36, w: 0.24 },
    { id: 'LF11', tier: 'XL', u:  0.18, w: 0.60 },   // the door. Biggest flat panel on the car.
    { id: 'LF12', tier: 'S',  u:  0.70, w: 0.28 },
  ]},
  { panel: 'left', probe: 'left', v: 0.425, h: 0.11, name: 'Left — sill band', zones: [
    { id: 'LF13', tier: 'S',  u: -0.75, w: 0.26 },
    { id: 'LF14', tier: 'S',  u: -0.38, w: 0.24 },
    { id: 'LF15', tier: 'M',  u: -0.02, w: 0.36 },
    { id: 'LF16', tier: 'S',  u:  0.34, w: 0.24 },
    { id: 'LF17', tier: 'M',  u:  0.66, w: 0.30 },
  ]},
  { panel: 'left', probe: 'left', v: 0.29, h: 0.09, name: 'Left — rocker band', zones: [
    { id: 'LF18', tier: 'S',  u: -0.75, w: 0.28 },
    { id: 'LF19', tier: 'S',  u: -0.06, w: 0.44 },
    { id: 'LF20', tier: 'S',  u:  0.56, w: 0.44 },
  ]},

  // ── REAR, 14 ── the surface every car behind you reads at every light.
  // Number plate is x ±0.27, y 0.33→0.53 — routed around, never crossed.
  // Tail-light strip is y 0.68→0.78 full width — same.
  { panel: 'rear', probe: 'down', v: -1.805, h: 0.09, name: 'Rear — engine lid', zones: [
    { id: 'B1',  tier: 'S',   u: -0.42, w: 0.22 },
    { id: 'B2',  tier: 'L',   u:  0.00, w: 0.52 },
    { id: 'B3',  tier: 'S',   u:  0.42, w: 0.22 },
  ]},
  { panel: 'rear', probe: 'down', v: -2.055, h: 0.085, name: 'Rear — spoiler shelf', zones: [
    { id: 'B4',  tier: 'S',   u: -0.31, w: 0.20 },
    { id: 'B5',  tier: 'S',   u:  0.00, w: 0.30 },
    { id: 'B6',  tier: 'S',   u:  0.31, w: 0.20 },
  ]},
  { panel: 'rear', probe: 'rear', v: 0.606, h: 0.076, name: 'Rear — badge band', zones: [
    { id: 'B7',  tier: 'L',   u:  0.00, w: 0.94 },   // under the light bar, over the badges
  ]},
  { panel: 'rear', probe: 'rear', v: 0.435, h: 0.15, name: 'Rear — plate flanks', zones: [
    { id: 'B8',  tier: 'M',   u: -0.71, w: 0.18 },
    { id: 'B9',  tier: 'M',   u: -0.45, w: 0.26 },
    { id: 'B10', tier: 'M',   u:  0.45, w: 0.26 },
    { id: 'B11', tier: 'M',   u:  0.71, w: 0.18 },
  ]},
  { panel: 'rear', probe: 'rear', v: 0.278, h: 0.052, name: 'Rear — lower bumper', zones: [
    { id: 'B12', tier: 'S',   u: -0.73, w: 0.16 },
    { id: 'B13', tier: 'S',   u:  0.00, w: 0.40 },
    { id: 'B14', tier: 'S',   u:  0.73, w: 0.16 },
  ]},

  // ── FRONT BUMPER, 13 ── motorsport contingency band: one dense row across the nose,
  // then the $250 row along the splitter lip. Plate (x ±0.27, y 0.30→0.44), grilles and
  // head/fog-light glass are all routed around.
  { panel: 'front', probe: 'front', v: 0.536, h: 0.062, name: 'Front — contingency band', zones: [
    { id: 'P1',  tier: 'S',   u: -0.785, w: 0.09 },
    { id: 'P2',  tier: 'S',   u: -0.57, w: 0.18 },
    { id: 'P3',  tier: 'S',   u: -0.31, w: 0.20 },
    { id: 'P4',  tier: 'M',   u:  0.00, w: 0.36 },
    { id: 'P5',  tier: 'S',   u:  0.31, w: 0.20 },
    { id: 'P6',  tier: 'S',   u:  0.57, w: 0.18 },
    { id: 'P7',  tier: 'S',   u:  0.785, w: 0.09 },
  ]},
  { panel: 'front', probe: 'front', v: 0.474, h: 0.036, name: 'Front — the $250 row', zones: [
    { id: 'P8',  tier: 'XS',  u: -0.375, w: 0.12 },
    { id: 'P9',  tier: 'XS',  u: -0.225, w: 0.12 },
    { id: 'P10', tier: 'XS',  u: -0.075, w: 0.12 },
    { id: 'P11', tier: 'XS',  u:  0.075, w: 0.12 },
    { id: 'P12', tier: 'XS',  u:  0.225, w: 0.12 },
    { id: 'P13', tier: 'XS',  u:  0.375, w: 0.12 },
  ]},
];

/** Right flank = left flank with the X sign flipped. Same z, same y, same sizes. */
function mirrorFlank(rows) {
  const out = [];
  for (const row of rows) {
    out.push(row);
    if (row.panel !== 'left') continue;
    out.push({
      ...row,
      panel: 'right',
      probe: 'right',
      name: row.name.replace('Left', 'Right'),
      zones: row.zones.map(z => ({ ...z, id: 'R' + z.id.slice(1) })),
    });
  }
  return out;
}

/** Keep-outs. Nothing may cross these: a decal over a plate, a handle, a wheel arch or a
 *  shut line breaks the illusion the whole site runs on. Boxes are world-space AABBs. */
export const KEEPOUTS = [
  // Measured off model.glb with tools/mesh.mjs, then given a centimetre or two of margin.
  { name: 'rear number plate',   x: [-0.31, 0.31], y: [0.31, 0.55], z: [-2.32, -2.10] },
  { name: 'front number plate',  x: [-0.31, 0.31], y: [0.28, 0.445], z: [ 2.10,  2.32] },
  { name: 'tail-light strip',    x: [-0.92, 0.92], y: [0.665, 0.80], z: [-2.32, -2.11] },
  { name: 'tail-light wrap L',   x: [-0.62,-0.44], y: [0.72, 0.86], z: [-2.20, -2.05] },
  { name: 'tail-light wrap R',   x: [ 0.44, 0.62], y: [0.72, 0.86], z: [-2.20, -2.05] },
  { name: 'engine grille',       x: [-0.48, 0.48], y: [0.80, 0.95], z: [-2.00, -1.875] },
  { name: 'headlight glass L',   x: [-0.90,-0.53], y: [0.59, 0.86], z: [ 1.52,  1.92] },
  { name: 'headlight glass R',   x: [ 0.53, 0.90], y: [0.59, 0.86], z: [ 1.52,  1.92] },
  { name: 'front lower lens L',  x: [-0.81,-0.51], y: [0.36, 0.495], z: [ 1.88,  2.32] },
  { name: 'front lower lens R',  x: [ 0.51, 0.81], y: [0.36, 0.495], z: [ 1.88,  2.32] },
  { name: 'front grille L',      x: [-0.76,-0.36], y: [0.25, 0.445], z: [ 1.88,  2.32] },
  { name: 'front grille R',      x: [ 0.36, 0.76], y: [0.25, 0.445], z: [ 1.88,  2.32] },
  { name: 'front lower mesh',    x: [-0.72, 0.72], y: [0.00, 0.19], z: [ 1.88,  2.32] },
  { name: 'rear diffuser mesh',  x: [-0.66, 0.66], y: [0.00, 0.235], z: [-2.32, -2.00] },
  { name: 'left mirror',         x: [-1.12,-0.82], y: [0.83, 1.02], z: [ 0.08,  0.44] },
  { name: 'right mirror',        x: [ 0.82, 1.12], y: [0.83, 1.02], z: [ 0.08,  0.44] },
  { name: 'front wheel arch L',  x: [-1.12,-0.58], y: [0.00, 0.70], z: [ 0.92,  1.66] },
  { name: 'front wheel arch R',  x: [ 0.58, 1.12], y: [0.00, 0.70], z: [ 0.92,  1.66] },
  { name: 'rear wheel arch L',   x: [-1.12,-0.58], y: [0.00, 0.70], z: [-1.70, -0.92] },
  { name: 'rear wheel arch R',   x: [ 0.58, 1.12], y: [0.00, 0.70], z: [-1.70, -0.92] },
  // Panel gaps. The mesh is one smooth shell, so these are where the real car's gaps are —
  // a decal straddling one still looks broken in a photograph.
  { name: 'door handle L',       x: [-1.12,-0.78], y: [0.70, 0.84], z: [-0.08,  0.16] },
  { name: 'door handle R',       x: [ 0.78, 1.12], y: [0.70, 0.84], z: [-0.08,  0.16] },
  { name: 'door shut line fwd',  x: [-1.12, 1.12], y: [0.18, 1.20], z: [ 0.88,  0.96] },
  { name: 'door shut line aft',  x: [-1.12, 1.12], y: [0.18, 1.20], z: [-0.60, -0.52] },
  { name: 'hood shut line L',    x: [-0.72,-0.58], y: [0.60, 0.98], z: [ 0.88,  2.00] },
  { name: 'hood shut line R',    x: [ 0.58, 0.72], y: [0.60, 0.98], z: [ 0.88,  2.00] },
  { name: 'cowl / wiper park',   x: [-0.80, 0.80], y: [0.55, 1.00], z: [ 0.84,  0.96] },
];

const round2 = n => Math.round(n * 100) / 100;

/** Expand the row table into the flat 88-zone list the app and the viewer both consume. */
export function buildZones() {
  const rows = mirrorFlank(ROWS);
  const out = [];
  let n = 0;
  for (const row of rows) {
    for (const z of row.zones) {
      const tier = TIERS[z.tier];
      if (!tier) throw new Error(`zone ${z.id}: unknown tier ${z.tier}`);
      const h = z.h ?? row.h;
      out.push({
        n: ++n,
        id: z.id,
        panel: row.panel,
        row: row.name,
        tier: z.tier,
        price: tier.price,
        priced: isPriced(z.tier),
        probe: row.probe,
        u: z.u, v: row.v,
        w: z.w, h,
        wCm: `${Math.round(z.w * 100)}×${Math.round(h * 100)}`,
        name: `${z.id} · ${PANEL_LABEL[row.panel]} ${z.tier}`,
        on: row.on || 'bodywork',
        // world anchor before the viewer snaps it to the mesh — a starting point, not a value
        anchor: PROBE[row.probe].origin(z.u, row.v).map(round2),
      });
    }
  }
  return out;
}

export const ZONES = buildZones();

/** Sum of every priced zone at ask. Must be GOAL. */
export function askTotal(zones = ZONES) {
  return zones.filter(z => z.priced).reduce((a, z) => a + z.price, 0);
}

/** Per-panel and per-tier tallies, for the table headers and the media kit. */
export function tally(zones = ZONES) {
  const byPanel = {}, byTier = {};
  for (const z of zones) {
    (byPanel[z.panel] ||= { total: 0, ask: 0 });
    byPanel[z.panel].total++;
    if (z.priced) byPanel[z.panel].ask += z.price;
    byPanel[z.panel][z.tier] = (byPanel[z.panel][z.tier] || 0) + 1;
    byTier[z.tier] = (byTier[z.tier] || 0) + 1;
  }
  return { byPanel, byTier };
}
