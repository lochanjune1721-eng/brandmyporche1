// tools/reflow-zones.mjs — find flat ground for the zones that bend.
//
// tools/flatness.mjs says which zones drape over a shoulder. This one does something about
// it: for each offender it searches its own panel for the nearest position where the zone
// sits flat, respecting every rule the verifier already enforces — keep-outs, substrate,
// no step through the footprint, and clearance from every neighbour.
//
// It only ever prints suggested coordinates. Applying them is a human edit to zones.js,
// because a zone is a place on a car and moving one is a design decision, not a refactor.
//
//   node tools/reflow-zones.mjs [--max-tilt 15] [--only LF9,B5]

import { loadGlb, collectTriangles, normalise, Grid } from './mesh.mjs';
import { ZONES, PROBE, KEEPOUTS } from '../zones.js';
import { snapZone, v as V } from '../zone-frame.js';
import require$fs from 'node:fs';

const { sub, add, mul, dot, norm } = V;
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const MAX_TILT = Number(arg('--max-tilt', 15));
const MAX_MOVE = Number(arg('--max-move', 0.20));   // metres a zone may travel and stay itself
const ONLY = (arg('--only', '') || '').split(',').filter(Boolean);

const NEVER = new Set(['license', 'lights', 'glass', 'logo', 'rubber', 'Material.001', 'Material']);
const GLAZING = new Set(['window']);
const MAX_STEP = 0.025;
const MIN_GAP = 0.014;   // verifier demands 1.2cm; a whisker over, so it confirms rather than argues

const glb = loadGlb(new URL('../model.glb', import.meta.url).pathname);
const tris = collectTriangles(glb);
normalise(tris);
const grid = new Grid(tris.filter(t => t.mat !== 'Material'), 0.05);
const cast = (o, d, maxT) => grid.raycast(o, d, maxT);
const inBox = (p, b) =>
  p[0] >= b.x[0] && p[0] <= b.x[1] && p[1] >= b.y[0] && p[1] <= b.y[1] && p[2] >= b.z[0] && p[2] <= b.z[1];

/** Everything the verifier asks of a placement, measured at one candidate (u, v). */
function probeAt(z, u, vv) {
  const wantsGlass = z.on.includes('glass');
  const P = PROBE[z.probe];
  const snapped = snapZone({ ...z, u, v: vv }, P, cast);
  if (!snapped) return null;
  const { position: centre, normal, frame: f } = snapped;

  const N = 13;
  const off = [], pts = [];
  let tilt = 0, sag = 0, missed = 0;
  for (let i = 0; i < N; i++) {
    off[i] = [];
    for (let j = 0; j < N; j++) {
      const du = (i / (N - 1) - 0.5) * z.w, dv = (j / (N - 1) - 0.5) * z.h;
      const flat = add(add(centre, mul(f.x, du)), mul(f.y, dv));
      const h = cast(add(flat, mul(f.z, 0.14)), mul(f.z, -1), 0.28);
      if (!h) { missed++; off[i][j] = null; continue; }
      if (NEVER.has(h.tri.mat)) return null;
      if (GLAZING.has(h.tri.mat) !== wantsGlass) return null;
      if (KEEPOUTS.some(k => inBox(h.point, k))) return null;
      pts.push(h.point);
      off[i][j] = dot(sub(h.point, flat), f.z);
      sag = Math.max(sag, Math.abs(off[i][j]));
      tilt = Math.max(tilt, Math.acos(Math.min(1, Math.abs(dot(norm(h.normal), normal)))) * 180 / Math.PI);
    }
  }
  if (missed) return null;
  let step = 0;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const a = off[i][j]; if (a == null) continue;
    for (const [di, dj] of [[1, 0], [0, 1]]) {
      const b = off[i + di]?.[j + dj];
      if (b != null) step = Math.max(step, Math.abs(a - b));
    }
  }
  if (step > MAX_STEP) return null;
  return { centre, tilt, sag, pts };
}

// Current placement of every zone, so a move can be checked against real neighbours.
const placed = new Map();
for (const z of ZONES) placed.set(z.id, probeAt(z, z.u, z.v));

const clears = (id, cand) => {
  for (const [oid, o] of placed) {
    if (oid === id || !o) continue;
    if (Math.hypot(...sub(cand.centre, o.centre)) > 1.6) continue;
    for (const p of cand.pts) for (const q of o.pts) {
      if (Math.hypot(...sub(p, q)) < MIN_GAP) return false;
    }
  }
  return true;
};

/** Mirror partner, on the panels that author both halves. On hood/roof/rear/front, u is x,
 *  so the twin sits at -u and a move has to be mirrored onto it or the car goes lopsided.
 *  On a flank, u is z: the right rows are generated from the left ones with identical u and
 *  v, so moving the left zone already moves both and there is no partner to solve. */
const partnerOf = z => z.panel === 'left' || z.panel === 'right' ? null
  : ZONES.find(o => o.id !== z.id && o.panel === z.panel && o.tier === z.tier &&
      Math.abs(o.u + z.u) < 1e-6 && Math.abs(o.v - z.v) < 1e-6 && o.w === z.w && o.h === z.h);

const targets = ZONES.filter(z => {
  if (ONLY.length) return ONLY.includes(z.id);
  if (z.panel === 'right') return false;         // generated from the left rows by mirrorFlank
  const p = placed.get(z.id);
  return !p || p.tilt >= MAX_TILT;
});

console.log(`searching for ${targets.length} zones, target tilt < ${MAX_TILT}\n`);
console.log('zone   was      ->  best     tilt   move');

const fixed = [], stuck = [];
for (const z of targets) {
  const before = placed.get(z.id);
  let best = null;
  // Walk outward so the nearest flat spot wins: a zone should move as little as possible.
  // If the whole budget turns up nothing, widen it rather than giving up — a zone that has
  // to cross the panel is still better than a zone that visibly bends.
  for (const budget of [MAX_MOVE, MAX_MOVE * 1.6, MAX_MOVE * 2.4]) {
    const RINGS = Math.round(budget / 0.02);
    for (let r = 0; r <= RINGS && !(best && best.tilt < MAX_TILT * 0.7); r++) {
      for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
        if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue;    // ring only
        const u = +(z.u + i * 0.02).toFixed(3), vv = +(z.v + j * 0.02).toFixed(3);
        const c = probeAt(z, u, vv);
        if (!c || c.tilt >= MAX_TILT || !clears(z.id, c)) continue;
        const mate = partnerOf(z);
        if (mate) {
          const m = probeAt(mate, -u, vv);
          if (!m || m.tilt >= MAX_TILT || !clears(mate.id, m)) continue;
        }
        const d = Math.hypot(i * 0.02, j * 0.02);
        if (!best || c.tilt + d * 8 < best.tilt + best.d * 8) best = { u, v: vv, tilt: c.tilt, d, cand: c };
      }
    }
    if (best) break;
  }
  if (!best) { stuck.push([z, before]); console.log(`${z.id.padEnd(6)} ${String(before ? before.tilt.toFixed(1) : 'miss').padStart(5)}°   ->  nowhere flat enough on ${z.panel}`); continue; }
  placed.set(z.id, best.cand);
  fixed.push([z, before, best]);
  console.log(`${z.id.padEnd(6)} ${(before ? before.tilt.toFixed(1) : 'miss').padStart(5)}°   ->  u ${String(best.u).padStart(6)} v ${String(best.v).padStart(6)}  ${best.tilt.toFixed(1).padStart(5)}°  ${(best.d * 100).toFixed(0)}cm`);
}

if (process.argv.includes('--json')) {
  const patch = {};
  for (const [z, , best] of fixed) {
    patch[z.id] = { u: best.u, v: best.v, tilt: +best.tilt.toFixed(1) };
    const mate = partnerOf(z);
    if (mate) patch[mate.id] = { u: +(-best.u).toFixed(3), v: best.v, tilt: +best.tilt.toFixed(1) };
  }
  require$fs.writeFileSync('reflow.json', JSON.stringify(patch, null, 2));
  console.log(`\nwrote reflow.json — ${Object.keys(patch).length} zones`);
}
console.log(`\n${fixed.length} relocated, ${stuck.length} with nowhere to go`);
if (stuck.length) console.log('stuck: ' + stuck.map(([z]) => `${z.id} (${z.panel} ${z.tier} ${z.wCm}cm)`).join(', '));
