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
  // Same ray, opposite reading. A decal on the engine lid is found from above but looked at
  // from behind, where screen-right is −X and screen-up is +Z. Probing it with `down` is what
  // printed the rear labels back to front.
  deck:  { origin: (u, v) => [u, 3.2, v],  ray: [0, -1, 0], axisU: [-1, 0, 0], axisV: [0, 0, 1]  },
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

  // ── ROOF, 12 ── metal runs z 0.13→−1.02; the last row sits on the rear glass, which is
  // where a rear-window banner goes anyway. Rows are cut deep so an XL can be an XL rather
  // than a 96×22 smear.
  { panel: 'roof', probe: 'down', v: -0.02, h: 0.26, name: 'Roof — hero row', zones: [
    { id: 'R1', tier: 'M',  u: -0.35, w: 0.24 },
    { id: 'R2', tier: 'XL', u:  0.00, w: 0.42 },
    { id: 'R3', tier: 'M',  u:  0.35, w: 0.24 },
  ]},
  { panel: 'roof', probe: 'down', v: -0.36, h: 0.24, name: 'Roof — middle row', zones: [
    { id: 'R4', tier: 'M', u: -0.34, w: 0.24 },
    { id: 'R5', tier: 'L', u:  0.00, w: 0.40 },
    { id: 'R6', tier: 'M', u:  0.34, w: 0.24 },
  ]},
  { panel: 'roof', probe: 'down', v: -0.70, h: 0.24, name: 'Roof — third row', zones: [
    { id: 'R7', tier: 'S', u: -0.33, w: 0.20, h: 0.17 },
    { id: 'R8', tier: 'L', u:  0.00, w: 0.38 },
    { id: 'R9', tier: 'S', u:  0.33, w: 0.20, h: 0.17 },
  ]},
  // A rear-window banner is read from behind, not from above, so it takes the deck probe too.
  { panel: 'roof', probe: 'deck', v: -1.25, h: 0.19, on: 'rear glass', name: 'Roof — rear glass', zones: [
    { id: 'R10', tier: 'S', u: -0.26, w: 0.24 },
    { id: 'R11', tier: 'S', u:  0.00, w: 0.24 },
    { id: 'R12', tier: 'S', u:  0.26, w: 0.24 },
  ]},

  // ── FLANKS, 24 a side ── mirrored below by mirrorFlank(). Keep-outs that shape this:
  // mirror body (z 0.08→0.44 above y 0.83), front arch (z 0.92→1.66 below y 0.70), rear arch
  // (z −1.70→−0.92 below y 0.70), door handle (z −0.08→0.16, y 0.70→0.84), and the two door
  // shut lines. Each band now uses its full height, so nothing here is a stripe.
  { panel: 'left', probe: 'left', v: 1.03, h: 0.135, on: 'side glass', name: 'Left — glass band', zones: [
    { id: 'LF1', tier: 'S', u: -0.80, w: 0.20 },   // the quarter light, aft of the B-pillar
    { id: 'LF2', tier: 'S', u: -0.38, w: 0.20 },
    { id: 'LF3', tier: 'S', u: -0.12, w: 0.20 },
    { id: 'LF4', tier: 'S', u:  0.14, w: 0.20 },
  ]},
  { panel: 'left', probe: 'left', v: 0.768, h: 0.11, name: 'Left — shoulder band', zones: [
    { id: 'LF5',  tier: 'S', u: -1.52, w: 0.22 },
    { id: 'LF6',  tier: 'S', u: -1.26, w: 0.22 },
    { id: 'LF7',  tier: 'S', u: -1.00, w: 0.22 },
    { id: 'LF8',  tier: 'S', u: -0.74, w: 0.22 },
    { id: 'LF9',  tier: 'S', u: -0.30, w: 0.22 },   // between the two shut lines
    { id: 'LF10', tier: 'S', u:  0.52, w: 0.22 },   // clear of the handle and the mirror
    { id: 'LF11', tier: 'S', u:  0.76, w: 0.20 },   // and short of the front shut line
    { id: 'LF12', tier: 'S', u:  1.14, w: 0.22 },
  ]},
  { panel: 'left', probe: 'left', v: 0.578, h: 0.23, name: 'Left — door band', zones: [
    { id: 'LF13', tier: 'L',  u: -0.76, w: 0.28, h: 0.20 },
    { id: 'LF14', tier: 'XL', u: -0.10, w: 0.52 },   // the door. Biggest flat panel on the car.
    { id: 'LF15', tier: 'L',  u:  0.46, w: 0.28, h: 0.20 },
    { id: 'LF16', tier: 'S',  u:  0.76, w: 0.22, h: 0.16 },
  ]},
  { panel: 'left', probe: 'left', v: 0.385, h: 0.13, name: 'Left — sill band', zones: [
    { id: 'LF17', tier: 'M', u: -0.76, w: 0.26 },
    { id: 'LF18', tier: 'M', u: -0.36, w: 0.24 },
    { id: 'LF19', tier: 'M', u: -0.06, w: 0.24 },
    { id: 'LF20', tier: 'M', u:  0.32, w: 0.26 },
    { id: 'LF21', tier: 'M', u:  0.68, w: 0.26 },
  ]},
  // The rocker crowns about 3cm across its height. A sticker does not care; a 24cm plate would
  // sit on it badly. So this band carries the $250 row and nothing larger.
  { panel: 'left', probe: 'left', v: 0.255, h: 0.07, name: 'Left — the $250 row', zones: [
    { id: 'LF22', tier: 'XS', u: 0.30, w: 0.08 },
    { id: 'LF23', tier: 'XS', u: 0.44, w: 0.08 },
    { id: 'LF24', tier: 'XS', u: 0.58, w: 0.08 },
  ]},

  // ── REAR, 14 ── read from behind, so the engine lid is probed with `deck` rather than
  // `down`: same ray, but left and right the way a person standing behind the car sees them.
  // The badge band and the diffuser are 8cm and 5cm tall — nothing fits them that is not a
  // stripe, so nothing is sold there.
  { panel: 'rear', probe: 'deck', v: -1.80, h: 0.13, name: 'Rear — engine lid', zones: [
    { id: 'B1', tier: 'S', u: -0.36, w: 0.16 },
    { id: 'B2', tier: 'S', u: -0.18, w: 0.16 },
    { id: 'B3', tier: 'S', u:  0.00, w: 0.16 },
    { id: 'B4', tier: 'S', u:  0.18, w: 0.16 },
    { id: 'B5', tier: 'S', u:  0.36, w: 0.16 },
  ]},
  { panel: 'rear', probe: 'rear', v: 0.605, h: 0.095, name: 'Rear — above the plate', zones: [
    { id: 'B6', tier: 'S', u: -0.28, w: 0.22 },
    { id: 'B7', tier: 'S', u:  0.00, w: 0.22 },
    { id: 'B8', tier: 'S', u:  0.28, w: 0.22 },
  ]},
  { panel: 'rear', probe: 'rear', v: 0.445, h: 0.185, name: 'Rear — beside the plate', zones: [
    { id: 'B9',  tier: 'M', u: -0.45, w: 0.24 },
    { id: 'B10', tier: 'L', u: -0.74, w: 0.22, h: 0.20, v: 0.47 },
    { id: 'B11', tier: 'L', u:  0.74, w: 0.22, h: 0.20, v: 0.47 },
    { id: 'B12', tier: 'M', u:  0.45, w: 0.24 },
  ]},
  { panel: 'rear', probe: 'rear', v: 0.283, h: 0.085, name: 'Rear — bumper corners', zones: [
    { id: 'B13', tier: 'M', u: -0.78, w: 0.20 },
    { id: 'B14', tier: 'M', u:  0.78, w: 0.20 },
  ]},

  // ── FRONT, 3 ── the plate caps this strip at y 0.445 and the headlights at 0.59, and at
  // that height the fog lenses cap the width at |x| 0.47: 14cm by 90cm. Three full-size zones
  // fit it with room between them. A fourth only fits by shrinking them.
  { panel: 'front', probe: 'front', v: 0.518, h: 0.135, name: 'Front — the nose', zones: [
    { id: 'P1', tier: 'S', u: -0.30, w: 0.22 },
    { id: 'P2', tier: 'M', u:  0.00, w: 0.28 },
    { id: 'P3', tier: 'S', u:  0.30, w: 0.22 },
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
      const v = z.v ?? row.v;
      out.push({
        n: ++n,
        id: z.id,
        panel: row.panel,
        row: row.name,
        tier: z.tier,
        price: tier.price,
        priced: isPriced(z.tier),
        probe: row.probe,
        u: z.u, v,
        w: z.w, h,
        wCm: `${Math.round(z.w * 100)}×${Math.round(h * 100)}`,
        name: `${z.id} · ${PANEL_LABEL[row.panel]} ${z.tier}`,
        on: row.on || 'bodywork',
        // world anchor before the viewer snaps it to the mesh — a starting point, not a value
        anchor: PROBE[row.probe].origin(z.u, v).map(round2),
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
