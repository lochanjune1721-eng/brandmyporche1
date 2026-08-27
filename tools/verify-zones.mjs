// tools/verify-zones.mjs — run the whole zone map against the real model.glb, offline.
//
// This is DEBUG_PICK done 88 times by machine. For every zone it casts the same probe ray
// the viewer casts at load, snaps to the hit, builds the decal frame, then samples the
// footprint on a grid and asks the questions the acceptance checks ask:
//   • does every corner land on bodywork, or does the zone hang off an edge?
//   • is the surface under it continuous, or does it straddle a step?
//   • is the substrate one you can actually put vinyl on?
//   • does it cross a keep-out — plate, handle, arch, light, grille, shut line?
//   • does it touch its neighbour?
//
//   node tools/verify-zones.mjs [--verbose]

import { loadGlb, collectTriangles, normalise, Grid } from './mesh.mjs';
import { ZONES, PROBE, KEEPOUTS } from '../zones.js';
import { snapZone, v as V } from '../zone-frame.js';

const VERBOSE = process.argv.includes('--verbose');
const MODEL = new URL('../model.glb', import.meta.url).pathname;

// Substrates you can wrap. Everything else is a lens, a plate, a tyre or a hole.
const WRAPPABLE = new Set(['paint', 'coat', 'plastic', 'silver', 'full_black', 'tex_shiny']);
const GLAZING = new Set(['window']);
const NEVER = new Set(['license', 'lights', 'glass', 'logo', 'rubber', 'Material.001', 'Material']);

const { sub, add, mul, dot } = V;

const glb = loadGlb(MODEL);
const tris = collectTriangles(glb);
const info = normalise(tris);
const grid = new Grid(tris.filter(t => t.mat !== 'Material'), 0.05);
const cast = (o, d, maxT) => grid.raycast(o, d, maxT);

const inBox = (p, b) =>
  p[0] >= b.x[0] && p[0] <= b.x[1] && p[1] >= b.y[0] && p[1] <= b.y[1] && p[2] >= b.z[0] && p[2] <= b.z[1];

const SPACING = 0.04;                              // aim for a sample every 4cm
const MAX_STEP = 0.025;                            // adjacent-sample jump that reads as an edge
const MAX_SAG = 0.10;                              // how far a zone may bend away from flat
const problems = [];
const solved = [];

for (const z of ZONES) {
  const P = PROBE[z.probe];
  const snapped = snapZone(z, P, cast);
  if (!snapped) { problems.push([z.id, 'probe ray misses the model entirely']); continue; }
  const { position: centre, normal, frame: f } = snapped;

  // Sample density follows the zone, so a 94cm banner is read as finely as a 14cm sticker
  // and gentle curvature never masquerades as an edge.
  const NU = Math.min(15, Math.max(5, Math.ceil(z.w / SPACING) + 1));
  const NV = Math.min(15, Math.max(5, Math.ceil(z.h / SPACING) + 1));
  const off = [], pts = [], mats = new Set();
  let missed = 0;
  for (let i = 0; i < NU; i++) {
    off[i] = [];
    for (let j = 0; j < NV; j++) {
      const du = (i / (NU - 1) - 0.5) * z.w;
      const dv = (j / (NV - 1) - 0.5) * z.h;
      const flat = add(add(centre, mul(f.x, du)), mul(f.y, dv));
      // Launch close in: a long ray over a raked panel skids away and lands somewhere else.
      const h = cast(add(flat, mul(f.z, 0.14)), mul(f.z, -1), 0.28);
      if (!h) { missed++; off[i][j] = null; continue; }
      pts.push(h.point);
      mats.add(h.tri.mat);
      off[i][j] = dot(sub(h.point, flat), f.z);
    }
  }

  const id = z.id;
  if (missed) problems.push([id, `${missed}/${NU * NV} samples hang off the bodywork`]);
  if (!pts.length) continue;

  // Curvature is fine — a decal wraps. A STEP is not: that is a shut line, a lip or an edge.
  let step = 0, sag = 0;
  for (let i = 0; i < NU; i++) for (let j = 0; j < NV; j++) {
    const a = off[i][j]; if (a == null) continue;
    sag = Math.max(sag, Math.abs(a));
    for (const [di, dj] of [[1, 0], [0, 1]]) {
      const b = off[i + di]?.[j + dj];
      if (b != null) step = Math.max(step, Math.abs(a - b));
    }
  }
  if (step > MAX_STEP) problems.push([id, `${(step * 100).toFixed(1)}cm step between adjacent samples — a shut line, lip or edge runs through it`]);
  if (sag > MAX_SAG) problems.push([id, `bends ${(sag * 100).toFixed(1)}cm away from flat — too curved to read as one rectangle`]);

  const bad = [...mats].filter(m => NEVER.has(m));
  if (bad.length) problems.push([id, `sits on ${bad.join(', ')}`]);
  const glassy = [...mats].filter(m => GLAZING.has(m));
  const expectGlass = z.on.includes('glass');
  if (glassy.length && !expectGlass) problems.push([id, `runs onto glazing (${glassy.join(', ')}) but is not declared a glass zone`]);
  if (expectGlass && !glassy.length) problems.push([id, `declared a glass zone but lands on ${[...mats].join(', ')}`]);
  const unknown = [...mats].filter(m => !WRAPPABLE.has(m) && !GLAZING.has(m) && !NEVER.has(m));
  if (unknown.length) problems.push([id, `unknown substrate ${unknown.join(', ')}`]);

  for (const k of KEEPOUTS) {
    if (pts.some(p => inBox(p, k))) problems.push([id, `crosses keep-out: ${k.name}`]);
  }

  solved.push({ z, centre, normal, pts, mats: [...mats], step, sag });
}

// Neighbour clearance — pairwise, on the real surface points, not on paper.
const MIN_GAP = 0.012;
for (let a = 0; a < solved.length; a++) for (let b = a + 1; b < solved.length; b++) {
  const A = solved[a], B = solved[b];
  if (Math.hypot(...sub(A.centre, B.centre)) > 1.6) continue;
  let best = Infinity;
  for (const p of A.pts) for (const q of B.pts) {
    const d = Math.hypot(...sub(p, q));
    if (d < best) best = d;
  }
  if (best < MIN_GAP) problems.push([`${A.z.id}/${B.z.id}`, `only ${(best * 100).toFixed(1)}cm apart`]);
}

console.log(`model normalised: scale ${info.scale.toFixed(4)}, ${tris.length} triangles`);
console.log(`checked ${ZONES.length} zones, ${solved.length} snapped\n`);

if (VERBOSE) {
  for (const s of solved) {
    console.log(
      s.z.id.padEnd(5), s.z.tier.padEnd(3), s.z.panel.padEnd(6),
      'pos [' + s.centre.map(v => v.toFixed(2).padStart(5)).join(',') + ']',
      'n [' + s.normal.map(v => v.toFixed(2).padStart(5)).join(',') + ']',
      'step ' + (s.step * 100).toFixed(1) + 'cm',
      s.mats.join('/'));
  }
  console.log('');
}

if (!problems.length) { console.log('✓ all clear'); process.exit(0); }
console.log(`${problems.length} problem(s):`);
for (const [id, msg] of problems) console.log('  ' + String(id).padEnd(12) + msg);
process.exit(1);
