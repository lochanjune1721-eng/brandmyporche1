// Offline GLB mesh loader + uniform-grid raycaster.
// Reproduces exactly the normalisation the viewer applies, so probe results == runtime.
import fs from 'node:fs';

export function loadGlb(path){
  const buf = fs.readFileSync(path);
  let off = 12, json = null, bin = null;
  while (off < buf.length) {
    const cl = buf.readUInt32LE(off), ct = buf.toString('utf8', off + 4, off + 8);
    if (ct === 'JSON') json = JSON.parse(buf.toString('utf8', off + 8, off + 8 + cl));
    else if (ct.startsWith('BIN')) bin = buf.subarray(off + 8, off + 8 + cl);
    off += 8 + cl;
  }
  return { json, bin };
}

const COMP = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const NUM = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function readAccessor(json, bin, idx){
  const a = json.accessors[idx];
  const n = NUM[a.type], T = COMP[a.componentType];
  const bv = json.bufferViews[a.bufferView];
  const base = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const stride = bv.byteStride || 0;
  const out = new (a.componentType === 5126 ? Float32Array : Float64Array)(a.count * n);
  const bpe = T.BYTES_PER_ELEMENT;
  if (!stride || stride === n * bpe) {
    const src = new T(bin.buffer, bin.byteOffset + base, a.count * n);
    for (let i = 0; i < out.length; i++) out[i] = src[i];
  } else {
    for (let i = 0; i < a.count; i++) {
      const src = new T(bin.buffer, bin.byteOffset + base + i * stride, n);
      for (let k = 0; k < n; k++) out[i * n + k] = src[k];
    }
  }
  return out;
}

const I4 = () => [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
function mul(a, b){ const o = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++){ let s = 0; for (let k = 0; k < 4; k++) s += a[k*4+r]*b[c*4+k]; o[c*4+r] = s; }
  return o; }
function trs(n){
  if (n.matrix) return n.matrix.slice();
  const t = n.translation || [0,0,0], r = n.rotation || [0,0,0,1], s = n.scale || [1,1,1];
  const [x,y,z,w] = r, x2 = x+x, y2 = y+y, z2 = z+z;
  const xx = x*x2, xy = x*y2, xz = x*z2, yy = y*y2, yz = y*z2, zz = z*z2, wx = w*x2, wy = w*y2, wz = w*z2;
  return [(1-(yy+zz))*s[0], (xy+wz)*s[0], (xz-wy)*s[0], 0,
          (xy-wz)*s[1], (1-(xx+zz))*s[1], (yz+wx)*s[1], 0,
          (xz+wy)*s[2], (yz-wx)*s[2], (1-(xx+yy))*s[2], 0,
          t[0], t[1], t[2], 1]; }
function xf(m, x, y, z){ return [ m[0]*x+m[4]*y+m[8]*z+m[12], m[1]*x+m[5]*y+m[9]*z+m[13], m[2]*x+m[6]*y+m[10]*z+m[14] ]; }

/** Collect all triangles in raw model space, tagged with material name. */
export function collectTriangles({ json, bin }){
  const tris = [];   // {mat, a:[x,y,z], b, c}
  const scene = json.scenes[json.scene || 0];
  const walk = (ni, parent) => {
    const n = json.nodes[ni];
    const world = mul(parent, trs(n));
    if (n.mesh != null) {
      for (const p of json.meshes[n.mesh].primitives) {
        const mat = json.materials[p.material]?.name ?? 'none';
        const pos = readAccessor(json, bin, p.attributes.POSITION);
        const idx = p.indices != null ? readAccessor(json, bin, p.indices) : null;
        const count = idx ? idx.length : pos.length / 3;
        for (let i = 0; i < count; i += 3) {
          const i0 = idx ? idx[i] : i, i1 = idx ? idx[i+1] : i+1, i2 = idx ? idx[i+2] : i+2;
          tris.push({ mat,
            a: xf(world, pos[i0*3], pos[i0*3+1], pos[i0*3+2]),
            b: xf(world, pos[i1*3], pos[i1*3+1], pos[i1*3+2]),
            c: xf(world, pos[i2*3], pos[i2*3+1], pos[i2*3+2]) });
        }
      }
    }
    for (const c of (n.children || [])) walk(c, world);
  };
  for (const r of scene.nodes) walk(r, I4());
  return tris;
}

/** The exact normalisation the viewer uses: uniform scale to a target length,
 *  wheels on y=0, centred in x/z. Ground helper planes excluded. */
export const GROUND_MATS = new Set(['Material']);          // Plane_0 shadow catcher
export const TARGET_LENGTH = 4.499;                        // 991 Carrera 4S, metres

export function normalise(tris){
  let mn = [1e9,1e9,1e9], mx = [-1e9,-1e9,-1e9];
  for (const t of tris) {
    if (GROUND_MATS.has(t.mat)) continue;
    for (const p of [t.a, t.b, t.c]) for (let k = 0; k < 3; k++) { if (p[k] < mn[k]) mn[k] = p[k]; if (p[k] > mx[k]) mx[k] = p[k]; }
  }
  const s = TARGET_LENGTH / (mx[2] - mn[2]);
  const off = [ -(mn[0] + mx[0]) / 2 * s, -mn[1] * s, -(mn[2] + mx[2]) / 2 * s ];
  for (const t of tris) for (const p of [t.a, t.b, t.c]) {
    p[0] = p[0] * s + off[0]; p[1] = p[1] * s + off[1]; p[2] = p[2] * s + off[2];
  }
  return { scale: s, offset: off, rawMin: mn, rawMax: mx };
}

/** Uniform-grid raycaster over a triangle subset. */
export class Grid {
  constructor(tris, cell = 0.06){
    this.tris = tris; this.cell = cell;
    let mn = [1e9,1e9,1e9], mx = [-1e9,-1e9,-1e9];
    for (const t of tris) for (const p of [t.a, t.b, t.c]) for (let k = 0; k < 3; k++){ if (p[k] < mn[k]) mn[k] = p[k]; if (p[k] > mx[k]) mx[k] = p[k]; }
    mn = mn.map(v => v - cell); mx = mx.map(v => v + cell);
    this.mn = mn; this.mx = mx;
    this.dim = mx.map((v, i) => Math.max(1, Math.ceil((v - mn[i]) / cell)));
    this.buckets = new Map();
    tris.forEach((t, ti) => {
      const lo = [0,1,2].map(k => Math.floor((Math.min(t.a[k], t.b[k], t.c[k]) - mn[k]) / cell));
      const hi = [0,1,2].map(k => Math.floor((Math.max(t.a[k], t.b[k], t.c[k]) - mn[k]) / cell));
      for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++){
        const key = (x * this.dim[1] + y) * this.dim[2] + z;
        let b = this.buckets.get(key); if (!b) this.buckets.set(key, b = []);
        b.push(ti);
      }
    });
  }
  /** Nearest hit along ray origin+t*dir (dir need not be normalised). Returns {t, point, normal, tri} or null. */
  raycast(origin, dir, maxT = 12){
    const L = Math.hypot(...dir); const d = dir.map(v => v / L);
    // slab clip against grid bounds
    let t0 = 0, t1 = maxT;
    for (let k = 0; k < 3; k++){
      if (Math.abs(d[k]) < 1e-9) { if (origin[k] < this.mn[k] || origin[k] > this.mx[k]) return null; continue; }
      let a = (this.mn[k] - origin[k]) / d[k], b = (this.mx[k] - origin[k]) / d[k];
      if (a > b) { const s = a; a = b; b = s; }
      t0 = Math.max(t0, a); t1 = Math.min(t1, b);
      if (t0 > t1) return null;
    }
    const c = this.cell;
    let t = t0 + 1e-6;
    const cur = [0,1,2].map(k => Math.min(this.dim[k]-1, Math.max(0, Math.floor((origin[k] + d[k]*t - this.mn[k]) / c))));
    const step = d.map(v => v > 0 ? 1 : -1);
    const tMax = [0,1,2].map(k => Math.abs(d[k]) < 1e-9 ? Infinity
      : ((this.mn[k] + (cur[k] + (d[k] > 0 ? 1 : 0)) * c) - origin[k]) / d[k]);
    const tDelta = [0,1,2].map(k => Math.abs(d[k]) < 1e-9 ? Infinity : c / Math.abs(d[k]));
    let best = null;
    const seen = new Set();
    for (let guard = 0; guard < 4096; guard++){
      const key = (cur[0] * this.dim[1] + cur[1]) * this.dim[2] + cur[2];
      const b = this.buckets.get(key);
      if (b) for (const ti of b){
        if (seen.has(ti)) continue; seen.add(ti);
        const h = this._tri(origin, d, this.tris[ti]);
        if (h && h.t > 1e-5 && h.t <= maxT && (!best || h.t < best.t)) best = { ...h, tri: this.tris[ti] };
      }
      const axis = tMax[0] < tMax[1] ? (tMax[0] < tMax[2] ? 0 : 2) : (tMax[1] < tMax[2] ? 1 : 2);
      if (best && best.t < tMax[axis]) break;
      if (tMax[axis] > t1) break;
      cur[axis] += step[axis];
      if (cur[axis] < 0 || cur[axis] >= this.dim[axis]) break;
      tMax[axis] += tDelta[axis];
    }
    if (!best) return null;
    return { t: best.t, point: [origin[0]+d[0]*best.t, origin[1]+d[1]*best.t, origin[2]+d[2]*best.t], normal: best.normal, tri: best.tri };
  }
  _tri(o, d, T){
    const [ax,ay,az] = T.a, [bx,by,bz] = T.b, [cx,cy,cz] = T.c;
    const e1 = [bx-ax, by-ay, bz-az], e2 = [cx-ax, cy-ay, cz-az];
    const p = [ d[1]*e2[2]-d[2]*e2[1], d[2]*e2[0]-d[0]*e2[2], d[0]*e2[1]-d[1]*e2[0] ];
    const det = e1[0]*p[0] + e1[1]*p[1] + e1[2]*p[2];
    if (Math.abs(det) < 1e-12) return null;
    const inv = 1/det;
    const tv = [o[0]-ax, o[1]-ay, o[2]-az];
    const u = (tv[0]*p[0] + tv[1]*p[1] + tv[2]*p[2]) * inv;
    if (u < -1e-6 || u > 1+1e-6) return null;
    const q = [ tv[1]*e1[2]-tv[2]*e1[1], tv[2]*e1[0]-tv[0]*e1[2], tv[0]*e1[1]-tv[1]*e1[0] ];
    const v = (d[0]*q[0] + d[1]*q[1] + d[2]*q[2]) * inv;
    if (v < -1e-6 || u + v > 1+1e-6) return null;
    const t = (e2[0]*q[0] + e2[1]*q[1] + e2[2]*q[2]) * inv;
    let n = [ e1[1]*e2[2]-e1[2]*e2[1], e1[2]*e2[0]-e1[0]*e2[2], e1[0]*e2[1]-e1[1]*e2[0] ];
    const nl = Math.hypot(...n); n = n.map(v2 => v2/nl);
    return { t, normal: n };
  }
}
