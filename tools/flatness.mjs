// tools/flatness.mjs — how flat is the bodywork under each zone, really?
//
// A decal is a flat rectangle projected along a single normal. That reads as a crisp
// rectangle only while the surface under it stays near that plane. Where the panel rolls
// away — a hood shoulder, a bumper corner — the projection drapes over the curve and the
// outline comes out as a leaning parallelogram. No amount of shader work fixes that; the
// zone is simply in the wrong place.
//
// So measure it. For every zone, sample the footprint and report:
//   tilt  the worst angle between the surface normal at a sample and the zone's own normal
//   sag   the worst out-of-plane distance, as a percentage of the zone's shorter side
//
// Both are properties of the car, not of the renderer, so they can be measured once here
// and the map fixed accordingly.
//
//   node tools/flatness.mjs [--all]

import { loadGlb, collectTriangles, normalise, Grid } from './mesh.mjs';
import { ZONES, PROBE } from '../zones.js';
import { snapZone, v as V } from '../zone-frame.js';

const { sub, add, mul, dot, len, norm } = V;
const ALL = process.argv.includes('--all');

const glb = loadGlb(new URL('../model.glb', import.meta.url).pathname);
const tris = collectTriangles(glb);
normalise(tris);
const grid = new Grid(tris.filter(t => t.mat !== 'Material'), 0.05);
const cast = (o, d, maxT) => grid.raycast(o, d, maxT);

const rows = [];
for (const z of ZONES) {
  const P = PROBE[z.probe];
  const snapped = snapZone(z, P, cast);
  if (!snapped) { rows.push({ z, tilt: 999, sag: 999 }); continue; }
  const { position: centre, normal, frame: f } = snapped;

  let tilt = 0, sag = 0, off = 0;
  const N = 7;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const du = (i / (N - 1) - 0.5) * z.w;
      const dv = (j / (N - 1) - 0.5) * z.h;
      // Sample the way tools/verify-zones.mjs does: a short ray straight down the frame
      // normal from just above the footprint. A long probe ray over a raked panel skids
      // away and lands somewhere else, which reads as curvature that is not there.
      const flat = add(add(centre, mul(f.x, du)), mul(f.y, dv));
      const hit = cast(add(flat, mul(f.z, 0.14)), mul(f.z, -1), 0.28);
      if (!hit) { off++; continue; }
      const a = Math.acos(Math.min(1, Math.abs(dot(norm(hit.normal), normal)))) * 180 / Math.PI;
      if (a > tilt) tilt = a;
      const d = Math.abs(dot(sub(hit.point, centre), normal));
      if (d > sag) sag = d;
    }
  }
  rows.push({ z, tilt, sag: sag / Math.min(z.w, z.h) * 100, off });
}

rows.sort((a, b) => b.tilt - a.tilt);
const show = ALL ? rows : rows.slice(0, 24);
console.log('zone   panel  tier  size      tilt°   sag%');
for (const r of show) {
  const bad = r.off ? `  <-- ${r.off} samples off the panel`
            : r.tilt >= 22 ? '  <-- bends' : r.tilt >= 15 ? '  <-- marginal' : '';
  console.log(
    `${r.z.id.padEnd(6)} ${r.z.panel.padEnd(6)} ${r.z.tier.padEnd(4)} ${(r.z.wCm + 'cm').padEnd(9)} ` +
    `${r.tilt.toFixed(1).padStart(5)}  ${r.sag.toFixed(1).padStart(5)}${bad}`);
}
const bends = rows.filter(r => r.tilt >= 22).length;
const marg  = rows.filter(r => r.tilt >= 15 && r.tilt < 22).length;
console.log(`\n${rows.length} zones · ${bends} bend (>=22°) · ${marg} marginal (15-22°)`);
