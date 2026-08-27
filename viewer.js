// viewer.js — the car, and 82 zones painted onto it.
//
// Every zone is a real DecalGeometry: the bodywork is clipped against the zone's projector
// box, so a decal wraps the curve of the panel it sits on and the car's own depth buffer
// hides the ones on the far side. Nothing is faked with screen-space overlays.
//
// The hard part at 82 zones is legibility, not geometry. Four rules do that work:
//   1. panel focus   — the panel you are looking at is solid, the rest sit back at 0.52
//   2. label decay   — a small zone drops its price, then its tier letter. Never its size.
//   3. zoom promotes — leaning in gives a zone its detail back, which is how you read a crowded row
//   4. hover and sold always win, whatever the other three say
// Nothing is hover-only. Every zone shows what it is and how big it is without being touched.
// All of it is recomputed when the camera changes, never per frame.
//
// Draw calls stay flat: the zones of a panel share one merged BufferGeometry and one
// material, so 82 zones cost six draws, not 82. Detail level is a per-vertex UV rewrite into
// the label atlas; opacity is a per-vertex float. Neither rebuilds geometry.
//
// DEBUG_PICK: set window.DEBUG_PICK = true, then click the car to log a probe coordinate you
// can paste straight into a row in zones.js.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';
import { ZONES, PROBE } from './zones.js';
import { PLACEMENTS, NORMALISE } from './placements.js';
import { ZoneAtlas } from './zone-atlas.js';
import { frameFrom } from './zone-frame.js';

window.DEBUG_PICK = false;

const DIM = 0.52;              // what a non-focused panel drops to — still readable, not gone
const FULL_PX = 58;            // above this: tier, size and price
const SIZE_PX = 24;            // above this: tier and size. Below it, the size alone.
const ZOOM_PROMOTE = 2.4;      // camera distance under which every zone gains one level
const DECAL_DEPTH = 0.16;      // projector depth — deep enough to catch a curved panel

let scene, camera, renderer, controls, stageEl, modelRoot, carMeshes = [];
let raycaster, pointer, atlas, panels = new Map(), zoneState = new Map();
let onZoneClick, hoveredId = null, activePanel = 'all', cameraDirty = true;
let autoSpin = true, spinT = 0, spinStarted = false;
let basePixelRatio = 1, pixelScale = 1, frameAvg = 16, frameSamples = 0, baseTargetY = 0.66;
const logoDecals = new Map();
const clock = new THREE.Clock();
const scratchA = new THREE.Vector3(), scratchB = new THREE.Vector3();

const isMobile = () => /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || innerWidth < 640;

export function initViewer(stage, cfg, clickCb) {
  stageEl = stage; onZoneClick = clickCb;
  const mobile = isMobile();

  scene = new THREE.Scene();
  // No background of its own: the canvas is transparent and the page shows through, so the car
  // sits on the site rather than in a black box cut out of it.

  camera = new THREE.PerspectiveCamera(38, stage.clientWidth / stage.clientHeight, 0.1, 60);
  camera.position.set(...VIEWS.hero.pos);      // land on the whole car, not on a detail

  renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    powerPreference: mobile ? 'low-power' : 'high-performance',
  });
  renderer.setClearAlpha(0);
  // A phone's screen is 3x. Rendering at 1x is what made the car look soft; 2x is sharp, and
  // pacePixels() walks it back down if the frame budget cannot hold it.
  basePixelRatio = Math.min(devicePixelRatio, 2);
  renderer.setPixelRatio(basePixelRatio);
  renderer.setSize(stage.clientWidth, stage.clientHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  // No shadow map. A real one means drawing the whole 650k-triangle car a second time every
  // frame, which is exactly the budget a mid-range phone does not have. A painted contact
  // shadow costs one quad and, in a dark studio, reads the same.
  renderer.shadowMap.enabled = false;
  stage.prepend(renderer.domElement);

  scene.environment = studioEnvironment(renderer);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xc9c5bd, 0.5));
  const key = new THREE.DirectionalLight(0xffffff, 1.15); key.position.set(4.5, 7.5, 4.5); scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.5); fill.position.set(-4.5, 3, 4); scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffffff, 0.7); rim.position.set(-5.5, 2.2, -5); scene.add(rim);

  // The car needs to sit on something or it floats. One soft ellipse, no grid.
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(7.0, 3.6),
    new THREE.MeshBasicMaterial({ map: contactShadowTexture(), transparent: true, depthWrite: false, opacity: 0.5 }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.004; shadow.renderOrder = 1; scene.add(shadow);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.07;
  controls.enablePan = false;
  controls.minDistance = 1.4; controls.maxDistance = 8;
  controls.maxPolarAngle = Math.PI / 2 - 0.05;
  controls.target.set(...VIEWS.hero.target);
  baseTargetY = VIEWS.hero.target[1];
  controls.addEventListener('start', () => { autoSpin = false; });
  controls.addEventListener('change', () => { cameraDirty = true; });

  raycaster = new THREE.Raycaster();
  pointer = new THREE.Vector2();

  atlas = new ZoneAtlas(ZONES);
  const tex = new THREE.CanvasTexture(atlas.canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;

  for (const z of ZONES) zoneState.set(z.id, { zone: z, mode: 'full', opacity: 1, sold: false, screenPx: 0 });

  fitLens();
  bindPointer(renderer.domElement);
  addEventListener('resize', resize);
  addEventListener('orientationchange', () => setTimeout(resize, 250));

  const loader = new GLTFLoader();
  const status = t => { const el = document.getElementById('model-status'); if (el) el.textContent = t; };
  const fallbackTimer = setTimeout(() => { if (!modelRoot) buildFallback(status); }, 12000);

  loader.load(cfg.modelUrl, gltf => {
    clearTimeout(fallbackTimer);
    modelRoot = gltf.scene;
    normaliseModel(modelRoot);
    modelRoot.traverse(o => {
      if (!o.isMesh) return;
      o.frustumCulled = true;
      if (o.material?.name === NORMALISE.groundMaterial) { o.visible = false; return; }  // its own shadow plane
      for (const m of [o.material].flat()) {
        if (!m) continue;
        m.envMapIntensity = 1.15;
        if (/paint|coat|silver/.test(m.name || '')) { m.roughness = Math.min(m.roughness ?? 1, 0.26); m.metalness = 0.88; }
      }
      carMeshes.push(o);
    });
    scene.add(modelRoot);
    // Yield a frame so the car paints before the projection work starts, then project in
    // batches so the page keeps answering input while 82 decals are cut.
    requestAnimationFrame(() => requestAnimationFrame(async () => {
      const t0 = performance.now();
      await buildZoneDecals(tex, done => status(`Projecting zones ${done}/${ZONES.length}…`));
      status(`82 zones · ${Math.round(performance.now() - t0)}ms`);
      setTimeout(() => status(''), 2600);
      cameraDirty = true;
      window.__zoneDebug = {
        ready: true,
        projected: [...zoneState.values()].filter(z => z.geometry).length,
        panelMeshes: panels.size,
        decalVerts: [...panels.values()].reduce((a, p) => a + p.mesh.geometry.attributes.position.count, 0),
        atlasFill: Math.round(atlas.used / atlas.size * 100) + '%',
        buildMs: Math.round(performance.now() - t0),
        cullMs: window.__cullMs,
        drawCalls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
      };
      // A read-only window into the label state, for the screenshot tests and for anyone
      // debugging why a zone is not showing what they expect.
      window.__labelModes = () => {
        const out = { opacity: {} };
        for (const [id, st] of zoneState) {
          (out[st.zone.panel] ||= {})[st.mode] = ((out[st.zone.panel] || {})[st.mode] || 0) + 1;
          (out.opacity[st.zone.panel] ||= new Set()).add(Math.round(st.opacity * 100) / 100);
        }
        for (const k of Object.keys(out.opacity)) out.opacity[k] = [...out.opacity[k]];
        return out;
      };
      // Debug hooks, alongside window.DEBUG_PICK. __zoneScreen tells you where a zone is and
      // what label it is showing; __pickAt answers "what would a tap here hit?".
      // Where a zone currently is on screen, in CSS pixels inside the stage. Used by the
      // screenshot tests to click an actual zone rather than guess at a coordinate.
      window.__zoneScreen = id => {
        const st = zoneState.get(id);
        if (!st?.position) return null;
        const p = st.position.clone().project(camera);
        return { x: (p.x * 0.5 + 0.5) * stageEl.clientWidth,
                 y: (-p.y * 0.5 + 0.5) * stageEl.clientHeight,
                 px: st.screenPx, mode: st.mode, facing: p.z > -1 && p.z < 1,
                 dist: camera.position.distanceTo(controls.target) };
      };
      // Which zone is under a point in the stage, in CSS pixels. The same path a tap takes.
      window.__pickAt = (x, y) => {
        const r = renderer.domElement.getBoundingClientRect();
        const p = pickZone(r.left + x, r.top + y);
        return { id: p?.id ?? null, hit: p ? p.hit.point.toArray().map(n => +n.toFixed(3)) : null,
                 rect: [r.left, r.top, r.width, r.height] };
      };
      window.dispatchEvent(new CustomEvent('zones-ready'));
    }));
  }, xhr => {
    if (xhr.total) status('Loading car ' + Math.round(xhr.loaded / xhr.total * 100) + '%');
  }, err => {
    clearTimeout(fallbackTimer);
    console.error('[viewer] model failed', err);
    buildFallback(status);
  });

  animate();
  return { scene, camera, renderer, controls };
}

/** Put the car in the coordinate system zones.js is written in: 4.499m nose to tail, wheels
 *  on y=0, centred in x and z. tools/mesh.mjs does the identical thing offline, which is what
 *  makes the baked placements line up. */
function normaliseModel(root) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  root.traverse(o => {
    if (o.isMesh && o.material?.name !== NORMALISE.groundMaterial) box.expandByObject(o, true);
  });
  const s = NORMALISE.targetLength / (box.max.z - box.min.z);
  root.scale.setScalar(s);
  root.position.set(-(box.min.x + box.max.x) / 2 * s, -box.min.y * s, -(box.min.z + box.max.z) / 2 * s);
  root.updateMatrixWorld(true);
}

function buildFallback(status) {
  modelRoot = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color: 0xb9bcc2, roughness: 0.32, metalness: 0.2 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.84, 0.62, 4.5), paint);
  body.position.y = 0.62; modelRoot.add(body);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.42, 1.9), paint);
  roof.position.set(0, 1.1, -0.35); modelRoot.add(roof);
  scene.add(modelRoot);
  status('Car model unavailable — showing a stand-in. Zones are not projected.');
}

// ─────────────────────────────────────────────────────────────────────────────
// Projection

/** A studio in a canvas: two softboxes over a dark floor, wrapped to an equirect and run
 *  through PMREM. Without it the car's own paint (a 0.15 grey) renders as a black shape. */
function studioEnvironment(rend) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const g = c.getContext('2d');
  const sky = g.createLinearGradient(0, 0, 0, 256);
  sky.addColorStop(0, '#f4f6fa'); sky.addColorStop(0.40, '#c9ced8');
  sky.addColorStop(0.52, '#6f757f'); sky.addColorStop(1, '#2e3138');
  g.fillStyle = sky; g.fillRect(0, 0, 512, 256);
  for (const [cx, w, a] of [[130, 130, 1], [370, 96, 0.75]]) {   // key softbox, then a colder fill
    const box = g.createRadialGradient(cx, 66, 4, cx, 66, w);
    box.addColorStop(0, `rgba(255,255,255,${a})`);
    box.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = box; g.fillRect(cx - w, 0, w * 2, 150);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  const pmrem = new THREE.PMREMGenerator(rend);
  const env = pmrem.fromEquirectangular(tex).texture;
  pmrem.dispose(); tex.dispose();
  return env;
}

/** A painted ellipse under the car, in place of a shadow-map pass. */
function contactShadowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(128, 128, 6, 128, 128, 126);
  r.addColorStop(0, 'rgba(20,20,24,0.60)');
  r.addColorStop(0.42, 'rgba(20,20,24,0.30)');
  r.addColorStop(1, 'rgba(20,20,24,0)');
  g.fillStyle = r; g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Pull just the triangles inside each zone's projector box out of the car.
 *  Left to itself DecalGeometry walks every vertex of the body for every decal — 82 passes
 *  over 650k triangles. One pre-transformed pass with an oriented-box test does it once. */
function collectNeighbourhoods() {
  const started = performance.now();
  const CELL = 0.30, MARGIN = 0.05;
  const zonesInCell = new Map();
  const boxes = [];
  for (const z of ZONES) {
    const pl = PLACEMENTS[z.id]; if (!pl) continue;
    const n = new THREE.Vector3(...pl.n);
    const xa = new THREE.Vector3(...pl.x);
    const ya = new THREE.Vector3().crossVectors(n, xa).normalize();
    const i = boxes.length;
    boxes.push({ id: z.id, p: pl.p, xa, ya, n,
      hw: z.w / 2 + MARGIN, hh: z.h / 2 + MARGIN, hd: DECAL_DEPTH / 2 + MARGIN, tris: [] });
    const reach = Math.hypot(z.w, z.h) / 2 + DECAL_DEPTH;
    const span = Math.ceil((reach + MARGIN) / CELL);
    const c0 = [Math.floor(pl.p[0] / CELL), Math.floor(pl.p[1] / CELL), Math.floor(pl.p[2] / CELL)];
    for (let a = -span; a <= span; a++) for (let b = -span; b <= span; b++) for (let d = -span; d <= span; d++) {
      const k = `${c0[0] + a},${c0[1] + b},${c0[2] + d}`;
      let arr = zonesInCell.get(k); if (!arr) zonesInCell.set(k, arr = []);
      arr.push(i);
    }
  }

  const inside = (B, x, y, z) => {
    const dx = x - B.p[0], dy = y - B.p[1], dz = z - B.p[2];
    return Math.abs(dx * B.xa.x + dy * B.xa.y + dz * B.xa.z) <= B.hw
        && Math.abs(dx * B.ya.x + dy * B.ya.y + dz * B.ya.z) <= B.hh
        && Math.abs(dx * B.n.x + dy * B.n.y + dz * B.n.z) <= B.hd;
  };

  const nm = new THREE.Matrix3();
  for (const mesh of carMeshes) {
    const g = mesh.geometry;
    const pos = g.attributes.position, nrm = g.attributes.normal;
    if (!pos || !nrm) continue;

    // One pass to world space. Doing it per-triangle instead costs 650k matrix multiplies.
    const n = pos.count;
    const wp = new Float32Array(n * 3), wn = new Float32Array(n * 3);
    const pa = pos.array, na = nrm.array;
    const ps = pos.itemSize, ns = nrm.itemSize;
    const m = mesh.matrixWorld.elements;
    nm.getNormalMatrix(mesh.matrixWorld);
    const e = nm.elements;
    for (let i = 0; i < n; i++) {
      const pi = i * ps, ni = i * ns;
      const x = pa[pi], y = pa[pi + 1], z = pa[pi + 2];
      wp[i * 3] = m[0] * x + m[4] * y + m[8] * z + m[12];
      wp[i * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
      wp[i * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
      const nx = na[ni], ny = na[ni + 1], nz = na[ni + 2];
      const ax = e[0] * nx + e[3] * ny + e[6] * nz;
      const ay = e[1] * nx + e[4] * ny + e[7] * nz;
      const az = e[2] * nx + e[5] * ny + e[8] * nz;
      const l = Math.hypot(ax, ay, az) || 1;
      wn[i * 3] = ax / l; wn[i * 3 + 1] = ay / l; wn[i * 3 + 2] = az / l;
    }

    const ia = g.index ? g.index.array : null;
    const count = ia ? ia.length : n;
    for (let i = 0; i < count; i += 3) {
      const a = (ia ? ia[i] : i) * 3;
      const b = (ia ? ia[i + 1] : i + 1) * 3;
      const c = (ia ? ia[i + 2] : i + 2) * 3;
      const gx = (wp[a] + wp[b] + wp[c]) / 3, gy = (wp[a + 1] + wp[b + 1] + wp[c + 1]) / 3,
            gz = (wp[a + 2] + wp[b + 2] + wp[c + 2]) / 3;
      const cand = zonesInCell.get(`${Math.floor(gx / CELL)},${Math.floor(gy / CELL)},${Math.floor(gz / CELL)}`);
      if (!cand) continue;
      for (const zi of cand) {
        const B = boxes[zi];
        if (!inside(B, gx, gy, gz) && !inside(B, wp[a], wp[a + 1], wp[a + 2])
            && !inside(B, wp[b], wp[b + 1], wp[b + 2]) && !inside(B, wp[c], wp[c + 1], wp[c + 2])) continue;
        B.tris.push(
          wp[a], wp[a + 1], wp[a + 2], wp[b], wp[b + 1], wp[b + 2], wp[c], wp[c + 1], wp[c + 2],
          wn[a], wn[a + 1], wn[a + 2], wn[b], wn[b + 1], wn[b + 2], wn[c], wn[c + 1], wn[c + 2]);
      }
    }
  }
  const out = new Map();
  for (const B of boxes) out.set(B.id, B.tris);
  window.__cullMs = Math.round(performance.now() - started);
  return out;
}

const nextFrame = () => new Promise(r => requestAnimationFrame(r));
const SLICE_MS = 12;                       // longest we will hold the main thread in one go

async function buildZoneDecals(atlasTex, onProgress) {
  const hoods = collectNeighbourhoods();
  const perPanel = new Map();
  let done = 0, slice = performance.now();

  for (const z of ZONES) {
    // Time-sliced, not batch-counted: on a fast machine this yields once or twice, on a slow
    // one it yields more, and either way the page keeps answering taps while zones land.
    if (performance.now() - slice > SLICE_MS) {
      onProgress?.(done); await nextFrame(); slice = performance.now();
    }
    done++;
    const pl = PLACEMENTS[z.id];
    const tri = hoods.get(z.id);
    if (!pl || !tri || tri.length === 0) { console.warn('[viewer] no surface under', z.id); continue; }

    // Rebuild the little patch as a world-space mesh so the decal comes back in world space.
    const patchPos = [], patchNrm = [];
    for (let i = 0; i < tri.length; i += 18) {
      for (let k = 0; k < 9; k++) patchPos.push(tri[i + k]);
      for (let k = 9; k < 18; k++) patchNrm.push(tri[i + k]);
    }
    const patch = new THREE.BufferGeometry();
    patch.setAttribute('position', new THREE.Float32BufferAttribute(patchPos, 3));
    patch.setAttribute('normal', new THREE.Float32BufferAttribute(patchNrm, 3));
    const patchMesh = new THREE.Mesh(patch);
    patchMesh.matrixWorld.identity();
    patchMesh.matrixAutoUpdate = false;

    const n = new THREE.Vector3(...pl.n);
    const xAxis = new THREE.Vector3(...pl.x);
    const yAxis = new THREE.Vector3().crossVectors(n, xAxis).normalize();
    const basis = new THREE.Matrix4().makeBasis(xAxis, yAxis, n);
    const euler = new THREE.Euler().setFromRotationMatrix(basis);
    const geo = new DecalGeometry(patchMesh, new THREE.Vector3(...pl.p), euler,
      new THREE.Vector3(z.w, z.h, DECAL_DEPTH));
    patch.dispose();

    if (!geo.attributes.position || geo.attributes.position.count === 0) {
      console.warn('[viewer] decal came back empty for', z.id); continue;
    }
    const st = zoneState.get(z.id);
    st.geometry = geo;
    st.baseUv = Float32Array.from(geo.attributes.uv.array);
    st.position = new THREE.Vector3(...pl.p);
    st.normal = n; st.xAxis = xAxis; st.yAxis = yAxis;

    if (!perPanel.has(z.panel)) perPanel.set(z.panel, []);
    perPanel.get(z.panel).push(z.id);
  }

  const material = new THREE.ShaderMaterial({
    uniforms: {
      map: { value: atlasTex },
      lightDir: { value: new THREE.Vector3(0.45, 0.78, 0.44).normalize() },
    },
    vertexShader: `
      attribute float aOpacity;
      varying vec2 vUv; varying float vOpacity; varying vec3 vN;
      void main(){
        vUv = uv; vOpacity = aOpacity;
        vN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform sampler2D map; uniform vec3 lightDir;
      varying vec2 vUv; varying float vOpacity; varying vec3 vN;
      void main(){
        vec4 t = texture2D(map, vUv);
        float a = t.a * vOpacity;
        if (a < 0.006) discard;
        float lam = 0.72 + 0.28 * max(dot(normalize(vN), lightDir), 0.0);
        gl_FragColor = vec4(t.rgb * lam, a);
      }`,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -8,
    polygonOffsetUnits: -8,
    side: THREE.FrontSide,
  });

  for (const [panel, ids] of perPanel) {
    const merged = mergePanel(ids);
    const mesh = new THREE.Mesh(merged.geometry, material);
    mesh.frustumCulled = false;                        // one mesh spans a whole panel
    mesh.renderOrder = 3;
    scene.add(mesh);
    panels.set(panel, { mesh, ranges: merged.ranges, ids });
  }
  applyLabels(true);
}

/** One geometry per panel: position, normal, uv, plus a per-vertex opacity we can rewrite. */
function mergePanel(ids) {
  let total = 0;
  for (const id of ids) total += zoneState.get(id).geometry.attributes.position.count;
  const pos = new Float32Array(total * 3), nrm = new Float32Array(total * 3);
  const uv = new Float32Array(total * 2), op = new Float32Array(total);
  const ranges = new Map();
  let v = 0;
  for (const id of ids) {
    const g = zoneState.get(id).geometry;
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array, v * 3);
    nrm.set(g.attributes.normal.array, v * 3);
    uv.set(g.attributes.uv.array, v * 2);
    op.fill(1, v, v + n);
    ranges.set(id, { start: v, count: n });
    v += n;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const opAttr = new THREE.BufferAttribute(op, 1);
  opAttr.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('aOpacity', opAttr);
  geometry.attributes.uv.setUsage(THREE.DynamicDrawUsage);
  return { geometry, ranges };
}

// ─────────────────────────────────────────────────────────────────────────────
// Legibility: focus, decay, promotion, hover

const PANEL_FACING = {
  hood: [0, 0.86, 0.5], roof: [0, 1, -0.05], left: [-1, 0.12, 0],
  right: [1, 0.12, 0], rear: [0, 0.3, -0.95], front: [0, 0.4, 0.92],
};

function facingPanel() {
  const dir = new THREE.Vector3(); camera.getWorldDirection(dir); dir.negate();
  let best = 'hood', bestDot = -Infinity;
  for (const [p, n] of Object.entries(PANEL_FACING)) {
    const d = new THREE.Vector3(...n).normalize().dot(dir);
    if (d > bestDot) { bestDot = d; best = p; }
  }
  return best;
}

/** Screen height of a zone in CSS pixels — the number the decay thresholds are written in. */
function screenHeight(st) {
  scratchA.copy(st.position).addScaledVector(st.yAxis, st.zone.h / 2).project(camera);
  scratchB.copy(st.position).addScaledVector(st.yAxis, -st.zone.h / 2).project(camera);
  return Math.abs(scratchA.y - scratchB.y) * 0.5 * stageEl.clientHeight;
}

const PROMOTE = { tiny: 'size', size: 'full', full: 'full' };

function applyLabels(force = false) {
  if (!panels.size) return;
  const focus = (activePanel === 'all' || activePanel === 'free') ? facingPanel() : activePanel;
  const dist = camera.position.distanceTo(controls.target);
  const zoomed = dist < ZOOM_PROMOTE;

  for (const [panel, rec] of panels) {
    let uvDirty = false, opDirty = false;
    const uvAttr = rec.mesh.geometry.attributes.uv;
    const opAttr = rec.mesh.geometry.attributes.aOpacity;

    for (const id of rec.ids) {
      const st = zoneState.get(id);
      const hovered = hoveredId === id;

      // 1 — panel focus. 2 — decay by projected size. 3 — zoom promotes. 4 — hover and sold win.
      let opacity = st.sold || hovered ? 1 : (panel === focus ? 1 : DIM);
      const px = screenHeight(st);
      let mode = px > FULL_PX ? 'full' : px > SIZE_PX ? 'size' : 'tiny';
      if (zoomed && panel === focus) mode = PROMOTE[mode];
      if (hovered || st.sold) mode = 'full';
      if (st.sold) opacity = 0;                        // the logo decal stands in for the label

      const range = rec.ranges.get(id);
      if (force || mode !== st.mode) {
        const cell = atlas.cell(id, mode);
        if (cell) {
          const base = st.baseUv, arr = uvAttr.array;
          for (let i = 0; i < range.count; i++) {
            arr[(range.start + i) * 2] = cell.u + base[i * 2] * cell.w;
            arr[(range.start + i) * 2 + 1] = 1 - (cell.v + (1 - base[i * 2 + 1]) * cell.h);
          }
          uvDirty = true;
        }
        st.mode = mode;
      }
      if (force || Math.abs(opacity - st.opacity) > 0.001) {
        opAttr.array.fill(opacity, range.start, range.start + range.count);
        st.opacity = opacity; opDirty = true;
      }
      st.screenPx = px;
    }
    if (uvDirty) uvAttr.needsUpdate = true;
    if (opDirty) opAttr.needsUpdate = true;
  }
}

/** Which zone is under a world-space point on the bodywork, if any. */
function zoneAt(point) {
  let best = null, bestD = Infinity;
  for (const [, st] of zoneState) {
    if (!st.geometry) continue;
    const d = point.clone().sub(st.position);
    const along = Math.abs(d.dot(st.normal));
    if (along > DECAL_DEPTH * 0.75) continue;
    const u = Math.abs(d.dot(st.xAxis)), v = Math.abs(d.dot(st.yAxis));
    if (u > st.zone.w / 2 || v > st.zone.h / 2) continue;
    if (along < bestD) { bestD = along; best = st.zone.id; }
  }
  return best;
}

function pickZone(clientX, clientY) {
  if (!carMeshes.length) return null;
  const r = renderer.domElement.getBoundingClientRect();
  pointer.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(carMeshes, false)[0];
  return hit ? { id: zoneAt(hit.point), hit } : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Input. Rotating the car must never open a bid modal.

function bindPointer(dom) {
  let down = null;
  dom.addEventListener('pointerdown', e => {
    down = { x: e.clientX, y: e.clientY, t: performance.now() };
    autoSpin = false;
    if (window.DEBUG_PICK) debugPick(e);
  });
  dom.addEventListener('pointerup', e => {
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    const held = performance.now() - down.t;
    down = null;
    if (moved > 6 || held > 700) return;               // that was a drag, not a tap
    const picked = pickZone(e.clientX, e.clientY);
    if (picked?.id && onZoneClick) onZoneClick(picked.id);
  });
  dom.addEventListener('pointerleave', () => { down = null; setHover(null); });
  let moveThrottle = 0;
  dom.addEventListener('pointermove', e => {
    if (down) return;
    const now = performance.now();
    if (now - moveThrottle < 40) return;
    moveThrottle = now;
    const picked = pickZone(e.clientX, e.clientY);
    setHover(picked?.id || null);
    const owned = picked?.id && zoneState.get(picked.id)?.href;
    dom.style.cursor = picked?.id ? 'pointer' : 'grab';
    dom.title = owned ? 'Open ' + new URL(owned).hostname.replace(/^www\./, '') : '';
  });
}

function setHover(id) {
  if (hoveredId === id) return;
  hoveredId = id;
  applyLabels();
  window.dispatchEvent(new CustomEvent('zone-hover', { detail: id }));
}

function debugPick(e) {
  const picked = pickZone(e.clientX, e.clientY);
  if (!picked) return;
  const p = picked.hit.point;
  const n = picked.hit.face.normal.clone().transformDirection(picked.hit.object.matrixWorld);
  const guess = Math.abs(n.y) > 0.7 ? `probe 'down', u ${p.x.toFixed(2)}, v ${p.z.toFixed(2)}`
    : Math.abs(n.x) > 0.6 ? `probe '${n.x < 0 ? 'left' : 'right'}', u ${p.z.toFixed(2)}, v ${p.y.toFixed(2)}`
    : `probe '${n.z < 0 ? 'rear' : 'front'}', u ${p.x.toFixed(2)}, v ${p.y.toFixed(2)}`;
  console.log(`[DEBUG_PICK] ${guess}   world [${p.x.toFixed(3)}, ${p.y.toFixed(3)}, ${p.z.toFixed(3)}]` +
              `  normal [${n.x.toFixed(2)}, ${n.y.toFixed(2)}, ${n.z.toFixed(2)}]` +
              (picked.id ? `  (inside ${picked.id})` : ''));
}

/** Frame for the shape of the screen. A 38° vertical field of view on a tall narrow phone
 *  leaves almost no horizontal room, which is how a 4.5m car ends up invisible. Widen the
 *  lens as the viewport narrows so the whole car is in shot on any device. */
function fitLens() {
  const aspect = stageEl.clientWidth / stageEl.clientHeight;
  camera.aspect = aspect;
  camera.fov = aspect >= 1.5 ? 38 : THREE.MathUtils.clamp(38 * (1.5 / Math.max(0.45, aspect)), 38, 54);
  camera.updateProjectionMatrix();
  // A tall frame puts the car low and leaves sky above it. Raise what the camera looks at so
  // the car sits in the middle of the shot on a phone the way it does on a laptop.
  if (controls) {
    const lift = aspect >= 1.5 ? 0 : THREE.MathUtils.clamp((1.5 - aspect) * 0.34, 0, 0.34);
    controls.target.y = baseTargetY + lift;
  }
}

function resize() {
  if (!stageEl) return;
  fitLens();
  renderer.setSize(stageEl.clientWidth, stageEl.clientHeight);
  cameraDirty = true;
}

/** If frames start costing more than a 60fps budget, render fewer pixels rather than fewer
 *  zones. Recovers when the pressure comes off. This is what holds 60fps on a mid-range
 *  phone, where fragment cost — not the 82 decals — is the ceiling. */
function pacePixels(dtMs) {
  if (window.__noAdaptive) return;          // screenshot tests want a fixed resolution
  frameAvg += (dtMs - frameAvg) * 0.06;
  if (++frameSamples < 45) return;
  const want = frameAvg > 21 ? Math.max(0.6, pixelScale - 0.12)
             : frameAvg < 13 ? Math.min(1, pixelScale + 0.06) : pixelScale;
  if (Math.abs(want - pixelScale) > 0.01) {
    pixelScale = want;
    renderer.setPixelRatio(basePixelRatio * pixelScale);
    cameraDirty = true;
  }
  frameSamples = 0;
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, clock.getDelta());
  pacePixels(dt * 1000);
  if (autoSpin) {
    if (!spinStarted) { spinStarted = true; spinT = Math.atan2(camera.position.x - controls.target.x, camera.position.z - controls.target.z); }
    spinT += dt * 0.10;
    const r = Math.hypot(camera.position.x - controls.target.x, camera.position.z - controls.target.z);
    camera.position.x = controls.target.x + Math.sin(spinT) * r;
    camera.position.z = controls.target.z + Math.cos(spinT) * r;
    camera.lookAt(controls.target);
    cameraDirty = true;
  }
  controls.update();
  if (cameraDirty) { applyLabels(); cameraDirty = false; }   // never per frame
  renderer.render(scene, camera);
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API

export function setPanel(panel) { activePanel = panel; cameraDirty = true; }

const VIEWS = {
  hero:  { pos: [0, 1.35, 4.6],   target: [0, 0.66, 0] },      // whole car, turntable centred on it
  top:   { pos: [0, 5.0, 0.25],   target: [0, 0.8, 0] },
  hood:  { pos: [0, 2.5, 3.0],    target: [0, 0.78, 1.5] },
  front: { pos: [0, 1.35, 4.2],   target: [0, 0.62, 1.7] },
  left:  { pos: [-4.3, 0.95, 0.1], target: [0, 0.68, 0] },
  right: { pos: [4.3, 0.95, 0.1],  target: [0, 0.68, 0] },
  rear:  { pos: [0, 1.4, -4.4],   target: [0, 0.66, -1.9] },
};

export function setView(name) {
  const v = VIEWS[name]; if (!v) return;
  spinStarted = false;
  flyTo(new THREE.Vector3(...v.pos), new THREE.Vector3(...v.target));
}

const FLY_MS = 560;
let flyToken = 0;
function flyTo(p1, t1) {
  autoSpin = false;
  baseTargetY = t1.y;
  const token = ++flyToken;
  const p0 = camera.position.clone(), t0 = controls.target.clone();
  const start = performance.now();
  const ease = t => 1 - Math.pow(1 - t, 3);
  (function step() {
    if (token !== flyToken) return;
    const t = ease(Math.min(1, (performance.now() - start) / FLY_MS));
    camera.position.lerpVectors(p0, p1, t);
    controls.target.lerpVectors(t0, t1, t);
    cameraDirty = true;
    if (t < 1) requestAnimationFrame(step);
  })();
}

export function freeSpin() {
  spinT = Math.atan2(camera.position.x - controls.target.x, camera.position.z - controls.target.z);
  autoSpin = true;
}

/** Put an owner's icon on their zone — same rectangle, same size, same place.
 *  `href` makes it clickable: tapping a sold zone opens that brand's site. */
export function applyDecal(zone, logoUrl, href) {
  const st = zoneState.get(zone.id ?? zone);
  if (!st || !st.geometry) return false;      // zones not projected yet — caller retries on zones-ready
  removeDecal(st.zone.id);
  const tex = new THREE.TextureLoader().load(logoUrl, () => { cameraDirty = true; });
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mesh = new THREE.Mesh(st.geometry, new THREE.MeshStandardMaterial({
    map: tex, transparent: true, depthWrite: false, depthTest: true,
    polygonOffset: true, polygonOffsetFactor: -10, polygonOffsetUnits: -10,
    roughness: 0.58, metalness: 0.04, side: THREE.FrontSide,
  }));
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  scene.add(mesh);
  logoDecals.set(st.zone.id, mesh);
  st.sold = true;
  st.href = href || null;
  applyLabels(true);
  return true;
}

export function removeDecal(id) {
  const mesh = logoDecals.get(id);
  if (mesh) {
    scene.remove(mesh);
    mesh.material.map?.dispose();
    mesh.material.dispose();
    logoDecals.delete(id);
  }
  const st = zoneState.get(id);
  if (st && st.sold) { st.sold = false; st.href = null; applyLabels(true); }
}

/** Frame one zone — used when a table row is opened, so the car shows what you are bidding on. */
export function focusZone(id) {
  const st = zoneState.get(id);
  if (!st || !st.position) return;
  autoSpin = false;
  setPanel(st.zone.panel);
  const dist = Math.min(controls.maxDistance,
    Math.max(controls.minDistance + 0.1, Math.hypot(st.zone.w, st.zone.h) * 6 + 0.9));
  flyTo(st.position.clone().addScaledVector(st.normal, dist).add(new THREE.Vector3(0, 0.1, 0)),
        st.position.clone());
}
