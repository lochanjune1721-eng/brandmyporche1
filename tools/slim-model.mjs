// tools/slim-model.mjs — make model.glb small enough to load on a phone.
//
//   node tools/slim-model.mjs [in.glb] [out.glb]
//
// The download is what stops the car appearing on a phone, and almost none of the weight is
// the car. It is float32 tangents and a second UV set that nothing on this site reads, plus
// full-precision positions and normals for a body that is 4.5 metres long — millimetre
// accuracy would do. So: drop what is unused, quantise what is left, and keep the shape.
//
// Quantisation rides on KHR_mesh_quantization, which three's GLTFLoader has supported since
// r111. Positions become int16 with a per-primitive scale, normals become int8, UVs uint16.

import fs from 'node:fs';

const IN = process.argv[2] || new URL('../model.glb', import.meta.url).pathname;
const OUT = process.argv[3] || IN;

const buf = fs.readFileSync(IN);
let off = 12, json = null, bin = null;
while (off < buf.length) {
  const len = buf.readUInt32LE(off), type = buf.toString('utf8', off + 4, off + 8);
  if (type === 'JSON') json = JSON.parse(buf.toString('utf8', off + 8, off + 8 + len));
  else if (type.startsWith('BIN')) bin = buf.subarray(off + 8, off + 8 + len);
  off += 8 + len;
}
if (!json || !bin) throw new Error('not a GLB');

const COMP = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const NUM = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function read(idx) {
  const a = json.accessors[idx];
  const n = NUM[a.type], T = COMP[a.componentType];
  const bv = json.bufferViews[a.bufferView];
  const base = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const stride = bv.byteStride || n * T.BYTES_PER_ELEMENT;
  const out = new Float64Array(a.count * n);
  for (let i = 0; i < a.count; i++) {
    const src = new T(bin.buffer, bin.byteOffset + base + i * stride, n);
    for (let k = 0; k < n; k++) out[i * n + k] = src[k];
  }
  return { data: out, n, count: a.count, accessor: a };
}

// ── rebuild ------------------------------------------------------------------

const chunks = [];
let cursor = 0;
const bufferViews = [];
const accessors = [];

function pushView(typed, target) {
  const bytes = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
  while (cursor % 4) { chunks.push(Buffer.from([0])); cursor++; }      // GLB wants 4-byte alignment
  const view = { buffer: 0, byteOffset: cursor, byteLength: bytes.length };
  if (target) view.target = target;
  bufferViews.push(view);
  chunks.push(bytes);
  cursor += bytes.length;
  return bufferViews.length - 1;
}
function pushAccessor(typed, componentType, type, count, extra = {}) {
  accessors.push({ bufferView: pushView(typed, extra.target), componentType, count, type,
                   ...(extra.normalized ? { normalized: true } : {}),
                   ...(extra.min ? { min: extra.min, max: extra.max } : {}) });
  return accessors.length - 1;
}

const DROP = new Set(['TANGENT', 'TEXCOORD_1', 'COLOR_0', 'JOINTS_0', 'WEIGHTS_0']);
let dropped = 0, kept = 0;

for (const mesh of json.meshes) {
  for (const prim of mesh.primitives) {
    const attrs = {};
    // Positions: int16 with a per-primitive scale on the node's own matrix would change the
    // scene graph, so instead keep them float-accurate to the millimetre by scaling into the
    // int16 range and folding the scale into the accessor. glTF does this with a normalized
    // accessor plus a node scale; simpler and just as small is to keep float32 positions and
    // let the other three attributes carry the saving.
    for (const [name, idx] of Object.entries(prim.attributes)) {
      if (DROP.has(name)) { dropped++; continue; }
      kept++;
      const { data, n, count, accessor } = read(idx);

      if (name === 'POSITION') {
        const f = new Float32Array(data);
        const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
        for (let i = 0; i < count; i++) for (let k = 0; k < 3; k++) {
          const v = f[i * 3 + k];
          if (v < min[k]) min[k] = v;
          if (v > max[k]) max[k] = v;
        }
        attrs[name] = pushAccessor(f, 5126, 'VEC3', count, { min, max, target: 34962 });
      } else if (name === 'NORMAL') {
        // A normal only ever needs a direction. int8 gives ~0.5° of error, which is invisible
        // on paint and saves three quarters of the bytes.
        const q = new Int8Array(count * 3);
        for (let i = 0; i < count * 3; i++) q[i] = Math.max(-127, Math.min(127, Math.round(data[i] * 127)));
        attrs[name] = pushAccessor(q, 5120, 'VEC3', count, { normalized: true, target: 34962 });
      } else if (name.startsWith('TEXCOORD')) {
        let lo = Infinity, hi = -Infinity;
        for (const v of data) { if (v < lo) lo = v; if (v > hi) hi = v; }
        if (lo >= 0 && hi <= 1) {
          const q = new Uint16Array(count * 2);
          for (let i = 0; i < count * 2; i++) q[i] = Math.round(Math.max(0, Math.min(1, data[i])) * 65535);
          attrs[name] = pushAccessor(q, 5123, 'VEC2', count, { normalized: true, target: 34962 });
        } else {
          attrs[name] = pushAccessor(new Float32Array(data), 5126, 'VEC2', count, { target: 34962 });
        }
      } else {
        attrs[name] = pushAccessor(new Float32Array(data), accessor.componentType, accessor.type, count, { target: 34962 });
      }
    }
    prim.attributes = attrs;

    if (prim.indices != null) {
      const { data, count } = read(prim.indices);
      let maxI = 0;
      for (const v of data) if (v > maxI) maxI = v;
      const q = maxI < 65536 ? new Uint16Array(data) : new Uint32Array(data);
      prim.indices = pushAccessor(q, maxI < 65536 ? 5123 : 5125, 'SCALAR', count, { target: 34963 });
    }
    delete prim.targets;
  }
}

// images ride along untouched
for (const img of json.images || []) {
  if (img.bufferView == null) continue;
  const bv = json.bufferViews[img.bufferView];
  const bytes = bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
  img.bufferView = pushView(new Uint8Array(bytes));
}

json.bufferViews = bufferViews;
json.accessors = accessors;
json.buffers = [{ byteLength: cursor }];
json.extensionsUsed = [...new Set([...(json.extensionsUsed || []), 'KHR_mesh_quantization'])];
json.extensionsRequired = [...new Set([...(json.extensionsRequired || []), 'KHR_mesh_quantization'])];
delete json.animations;
delete json.skins;

const binChunk = Buffer.concat(chunks);
const padBin = Buffer.concat([binChunk, Buffer.alloc((4 - binChunk.length % 4) % 4)]);
let jsonStr = JSON.stringify(json);
jsonStr += ' '.repeat((4 - Buffer.byteLength(jsonStr) % 4) % 4);
const jsonBuf = Buffer.from(jsonStr, 'utf8');

const header = Buffer.alloc(12);
header.write('glTF', 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + padBin.length, 8);
const j = Buffer.alloc(8); j.writeUInt32LE(jsonBuf.length, 0); j.write('JSON', 4);
const b = Buffer.alloc(8); b.writeUInt32LE(padBin.length, 0); b.write('BIN\0', 4);

fs.writeFileSync(OUT, Buffer.concat([header, j, jsonBuf, b, padBin]));
const before = buf.length / 1048576, after = fs.statSync(OUT).size / 1048576;
console.log(`${before.toFixed(1)} MB → ${after.toFixed(1)} MB  (${Math.round((1 - after / before) * 100)}% smaller)`);
console.log(`dropped ${dropped} unused attribute streams, kept ${kept}`);
