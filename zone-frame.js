// zone-frame.js — how a zone finds its place on the bodywork.
//
// Shared by the viewer and by tools/verify-zones.mjs so that what the verifier passes is
// exactly what the browser draws. Plain arrays, no three.js, no DOM.
//
// A zone is authored as a rectangle in a probe plane. To place it we fire the probe ray at
// the centre and at four points around it, fit a plane to what comes back, and use that
// plane's normal. Fitting beats taking one triangle's normal: on a faceted panel a single
// face can sit degrees off the surface the zone actually covers, which tilts the decal and
// makes it clip at one corner and float at the other.

export const v = {
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: a => Math.hypot(a[0], a[1], a[2]),
  norm: a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
};

/** Orthonormal decal frame: +Z the surface normal, +X the panel's u-axis flattened into
 *  the tangent plane. Flattening rather than re-deriving is what keeps a row square. */
export function frameFrom(normal, axisU) {
  const n = v.norm(normal);
  let x = v.sub(axisU, v.mul(n, v.dot(axisU, n)));
  if (v.len(x) < 1e-4) x = v.sub([0, 0, 1], v.mul(n, v.dot([0, 0, 1], n)));
  if (v.len(x) < 1e-4) x = [1, 0, 0];
  x = v.norm(x);
  return { x, y: v.norm(v.cross(n, x)), z: n };
}

/**
 * Snap one zone to the bodywork.
 * @param zone   an entry from ZONES
 * @param probe  the PROBE descriptor for zone.probe
 * @param cast   (origin, dir, maxT) => {point, normal} | null — the caller's raycaster
 * @returns {position, normal, frame, samples} or null when the zone misses entirely
 */
export function snapZone(zone, probe, cast) {
  const shoot = (u, vv) => {
    const hit = cast(probe.origin(u, vv), probe.ray, 12);
    if (!hit) return null;
    return hit.point;
  };
  const centre = shoot(zone.u, zone.v);
  if (!centre) return null;

  // Four satellites at 40% of the footprint — far enough to span the real curvature,
  // close enough not to walk off the panel.
  const du = zone.w * 0.4, dv = zone.h * 0.4;
  const pts = [centre];
  for (const [a, b] of [[-du, 0], [du, 0], [0, -dv], [0, dv]]) {
    const p = shoot(zone.u + a, zone.v + b);
    if (p) pts.push(p);
  }

  let normal = planeNormal(pts);
  if (!normal) normal = v.mul(v.norm(probe.ray), -1);
  if (v.dot(normal, probe.ray) > 0) normal = v.mul(normal, -1);   // always face the ray back

  return { position: centre, normal, frame: frameFrom(normal, probe.axisU), samples: pts };
}

/** Least-squares plane normal through >=3 points, via the covariance matrix's smallest
 *  eigenvector. Returns null if the points are collinear or too few. */
export function planeNormal(pts) {
  if (pts.length < 3) return null;
  const c = pts.reduce((a, p) => v.add(a, p), [0, 0, 0]).map(k => k / pts.length);
  let xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0;
  for (const p of pts) {
    const d = v.sub(p, c);
    xx += d[0] * d[0]; xy += d[0] * d[1]; xz += d[0] * d[2];
    yy += d[1] * d[1]; yz += d[1] * d[2]; zz += d[2] * d[2];
  }
  // The largest cofactor picks the numerically stable axis to solve along.
  const detX = yy * zz - yz * yz, detY = xx * zz - xz * xz, detZ = xx * yy - xy * xy;
  const m = Math.max(detX, detY, detZ);
  if (m <= 1e-12) return null;
  let n;
  if (m === detX)      n = [detX, xz * yz - xy * zz, xy * yz - xz * yy];
  else if (m === detY) n = [xz * yz - xy * zz, detY, xy * xz - yz * xx];
  else                 n = [xy * yz - xz * yy, xy * xz - yz * xx, detZ];
  return v.norm(n);
}
