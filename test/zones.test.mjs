// test/zones.test.mjs — the zone map's contract.
//
//   node --test test/
//
// The headline claim of this site is that 82 priced zones add up to exactly $135,000. That is
// not a slogan, it is an invariant, and if a future edit breaks it the site is lying to
// bidders. Everything below is here so that edit goes red instead of live.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ZONES, TIERS, GOAL, PANELS, KEEPOUTS, PROBE, askTotal, tally, buildZones, isPriced }
  from '../zones.js';
import { PLACEMENTS } from '../placements.js';
import { frameFrom, planeNormal, v as V } from '../zone-frame.js';

// The distribution the whole thing is designed around.
const TIER_COUNT = { XXL: 1, XL: 4, L: 10, M: 22, S: 45, XS: 6 };
const TIER_PRICE = { XXL: 12000, XL: 6000, L: 3000, M: 1500, S: 800, XS: 250 };
// Where the 88 sit. The tier counts above are the $135,000 and never move; this is only how
// they are spread, and it follows the bodywork. The nose carries five zones because five is
// what fits there without looking like damage — the XS row moved to the sills instead.
const PANEL_PLAN = {
  hood:  { XXL: 1, XL: 1, L: 2, M: 3, S: 4,  total: 11 },
  roof:  {          XL: 1, L: 2, M: 4, S: 5,  total: 12 },
  left:  {          XL: 1, L: 2, M: 5, S: 13, XS: 3, total: 24 },
  right: {          XL: 1, L: 2, M: 5, S: 13, XS: 3, total: 24 },
  rear:  {                 L: 2, M: 4, S: 8,  total: 14 },
  front: {                       M: 1, S: 2,  total: 3  },
};

// ── the money ────────────────────────────────────────────────────────────────

test('82 priced zones sum to exactly $135,000', () => {
  const priced = ZONES.filter(z => z.priced);
  assert.equal(priced.length, 82);
  assert.equal(askTotal(), 135000);
  assert.equal(askTotal(), GOAL);
});

test('the XS zones are $250 and sit outside the car fund', () => {
  const xs = ZONES.filter(z => z.tier === 'XS');
  assert.equal(xs.length, 6);
  for (const z of xs) {
    assert.equal(z.price, 250);
    assert.equal(z.priced, false, `${z.id} must not count toward the goal`);
    assert.equal(isPriced(z.tier), false);
  }
  assert.equal(ZONES.reduce((a, z) => a + z.price, 0), 135000 + 6 * 250);
});

test('the tier table reproduces the total from its own counts', () => {
  let sum = 0;
  for (const [tier, want] of Object.entries(TIER_COUNT)) {
    assert.equal(TIERS[tier].count, want, `${tier} count in TIERS`);
    assert.equal(TIERS[tier].price, TIER_PRICE[tier], `${tier} price`);
    if (tier !== 'XS') sum += want * TIER_PRICE[tier];
  }
  assert.equal(sum, GOAL);
});

test('every zone is priced at its tier price — no one-off discounts', () => {
  for (const z of ZONES) assert.equal(z.price, TIER_PRICE[z.tier], `${z.id} (${z.tier})`);
});

// ── the map ──────────────────────────────────────────────────────────────────

test('88 zones, unique ids, ordered numbering', () => {
  assert.equal(ZONES.length, 88);
  assert.equal(new Set(ZONES.map(z => z.id)).size, 88);
  ZONES.forEach((z, i) => assert.equal(z.n, i + 1));
});

test('tier counts match the distribution', () => {
  assert.deepEqual(tally().byTier, TIER_COUNT);
});

test('each panel carries exactly the zones it is planned to', () => {
  const { byPanel } = tally();
  for (const [panel, plan] of Object.entries(PANEL_PLAN)) {
    const got = byPanel[panel];
    assert.ok(got, `${panel} has no zones`);
    assert.equal(got.total, plan.total, `${panel} zone count`);
    for (const tier of Object.keys(TIER_COUNT)) {
      assert.equal(got[tier] || 0, plan[tier] || 0, `${panel} ${tier} count`);
    }
  }
  assert.deepEqual(Object.keys(byPanel).sort(), [...PANELS].sort());
});

test('the flanks mirror each other exactly', () => {
  const left = ZONES.filter(z => z.panel === 'left');
  const right = ZONES.filter(z => z.panel === 'right');
  assert.equal(left.length, PANEL_PLAN.left.total);
  assert.equal(right.length, PANEL_PLAN.right.total);
  left.forEach((l, i) => {
    const r = right[i];
    assert.equal(r.id, 'R' + l.id.slice(1), 'mirrored id');
    assert.equal(r.tier, l.tier);
    assert.equal(r.u, l.u, `${l.id} z position`);
    assert.equal(r.v, l.v, `${l.id} height`);
    assert.equal(r.w, l.w);
    assert.equal(r.h, l.h);
  });
});

test('the nose carries three zones, the same size as the rest of the car', () => {
  const front = ZONES.filter(z => z.panel === 'front');
  assert.equal(front.length, 3,
    'the strip between the plate and the headlights is 14cm tall and 90cm wide — three ' +
    'full-size zones fit it. More only fit by shrinking them, which is what looked wrong.');
  assert.deepEqual(front.map(z => z.tier), ['S', 'M', 'S']);

  // "The same size as the rest" is the actual requirement, so measure it rather than assume it.
  const areaOf = z => z.w * z.h;
  for (const tier of ['S', 'M']) {
    const here = ZONES.filter(z => z.panel === 'front' && z.tier === tier).map(areaOf);
    const elsewhere = ZONES.filter(z => z.panel !== 'front' && z.tier === tier).map(areaOf);
    const lo = Math.min(...elsewhere), hi = Math.max(...elsewhere);
    for (const a of here) {
      assert.ok(a >= lo * 0.9 && a <= hi * 1.1,
        `a front ${tier} is ${Math.round(a * 1e4)}cm² but ${tier} elsewhere runs ` +
        `${Math.round(lo * 1e4)}–${Math.round(hi * 1e4)}cm². It has to look like the others.`);
    }
  }
  for (const z of front) assert.ok(z.w / z.h < 2.2, `${z.id} is ${z.wCm}cm — too long and thin`);
});

test('every zone declares a real probe and a positive footprint', () => {
  for (const z of ZONES) {
    assert.ok(PROBE[z.probe], `${z.id} probe ${z.probe}`);
    assert.ok(z.w > 0.02 && z.w < 1.4, `${z.id} width ${z.w}`);
    assert.ok(z.h > 0.02 && z.h < 0.6, `${z.id} height ${z.h}`);
    assert.match(z.wCm, /^\d+×\d+$/, `${z.id} cm label`);
  }
});

test('within a row every zone shares the same line and height — rows read square', () => {
  const rows = new Map();
  for (const z of ZONES) {
    const key = `${z.panel}|${z.row}`;
    if (!rows.has(key)) rows.set(key, []);
    rows.get(key).push(z);
  }
  for (const [key, list] of rows) {
    const [first] = list;
    for (const z of list) {
      assert.equal(z.probe, first.probe, `${z.id} is probed differently from the rest of ${key}`);
      // A row shares one line and one height, so it reads as a row. One deliberate exception:
      // a lead zone may be cut taller, and then it must stay centred on the same band.
      const taller = z.h !== first.h;
      if (!taller) assert.equal(z.v, first.v, `${z.id} sits off ${key}'s line`);
      else assert.ok(Math.abs((z.v + z.h / 2) - (first.v + first.h / 2)) < 0.04
                  || Math.abs(z.v - first.v) < 0.04,
        `${z.id} is a different height from ${key} and is not centred on the same band`);
    }
  }
});

test('no two zones in a row overlap, and each keeps a visible gap', () => {
  const rows = new Map();
  for (const z of ZONES) {
    const key = `${z.panel}|${z.row}`;
    if (!rows.has(key)) rows.set(key, []);
    rows.get(key).push(z);
  }
  for (const [key, list] of rows) {
    const sorted = [...list].sort((a, b) => a.u - b.u);
    for (let i = 1; i < sorted.length; i++) {
      const gap = (sorted[i].u - sorted[i].w / 2) - (sorted[i - 1].u + sorted[i - 1].w / 2);
      assert.ok(gap >= 0.012,
        `${sorted[i - 1].id} and ${sorted[i].id} in ${key} are ${(gap * 100).toFixed(1)}cm apart`);
    }
  }
});

test('rows on the same panel and probe do not collide with each other', () => {
  const byPanel = new Map();
  for (const z of ZONES) {
    const key = `${z.panel}|${z.probe}`;
    if (!byPanel.has(key)) byPanel.set(key, []);
    byPanel.get(key).push(z);
  }
  for (const [key, list] of byPanel) {
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if (a.row === b.row) continue;
      const dU = Math.abs(a.u - b.u) - (a.w + b.w) / 2;
      const dV = Math.abs(a.v - b.v) - (a.h + b.h) / 2;
      assert.ok(dU >= 0.012 || dV >= 0.012, `${a.id} and ${b.id} overlap on ${key}`);
    }
  }
});

// ── the bodywork ─────────────────────────────────────────────────────────────

test('every zone has a baked placement on the model', () => {
  for (const z of ZONES) {
    const pl = PLACEMENTS[z.id];
    assert.ok(pl, `${z.id} missing from placements.js — re-run tools/build-placements.mjs`);
    assert.equal(pl.p.length, 3);
    assert.ok(Math.abs(V.len(pl.n) - 1) < 1e-3, `${z.id} normal is not unit length`);
    assert.ok(Math.abs(V.len(pl.x) - 1) < 1e-3, `${z.id} x-axis is not unit length`);
    assert.ok(Math.abs(V.dot(pl.n, pl.x)) < 1e-3, `${z.id} frame is not orthogonal`);
  }
});

test('placements face outward and sit on the car, not in space', () => {
  for (const z of ZONES) {
    const { p, n } = PLACEMENTS[z.id];
    const ray = PROBE[z.probe].ray;
    assert.ok(V.dot(n, ray) < 0, `${z.id} normal faces away from the viewer`);
    assert.ok(p[1] > 0.15 && p[1] < 1.35, `${z.id} y=${p[1]} is off the bodywork`);
    assert.ok(Math.abs(p[0]) < 1.05, `${z.id} x=${p[0]} is outside the car`);
    assert.ok(Math.abs(p[2]) < 2.30, `${z.id} z=${p[2]} is beyond nose or tail`);
  }
});

test('no zone crosses a keep-out — plate, handle, arch, light, grille or shut line', () => {
  const inBox = (pt, b) =>
    pt[0] >= b.x[0] && pt[0] <= b.x[1] && pt[1] >= b.y[0] && pt[1] <= b.y[1] &&
    pt[2] >= b.z[0] && pt[2] <= b.z[1];
  for (const z of ZONES) {
    const pl = PLACEMENTS[z.id];
    const f = frameFrom(pl.n, PROBE[z.probe].axisU);
    for (const su of [-0.5, -0.25, 0, 0.25, 0.5]) for (const sv of [-0.5, -0.25, 0, 0.25, 0.5]) {
      const pt = V.add(V.add(pl.p, V.mul(f.x, su * z.w)), V.mul(f.y, sv * z.h));
      for (const k of KEEPOUTS) {
        assert.ok(!inBox(pt, k), `${z.id} crosses "${k.name}"`);
      }
    }
  }
});

test('glass zones are declared, and only where there is glass', () => {
  const onGlass = ZONES.filter(z => z.on.includes('glass')).map(z => z.id).sort();
  assert.deepEqual(onGlass,
    ['LF1', 'LF2', 'LF3', 'RF1', 'RF2', 'RF3', 'R8', 'R9', 'R10', 'R11', 'R12'].sort());
});

// ── the maths of the frame itself ────────────────────────────────────────────

test('frameFrom returns an orthonormal basis even for a degenerate axis', () => {
  const f = frameFrom([0, 1, 0], [0, 1, 0]);            // axisU parallel to the normal
  for (const a of [f.x, f.y, f.z]) assert.ok(Math.abs(V.len(a) - 1) < 1e-6);
  assert.ok(Math.abs(V.dot(f.x, f.y)) < 1e-6);
  assert.ok(Math.abs(V.dot(f.x, f.z)) < 1e-6);
  assert.ok(Math.abs(V.dot(f.y, f.z)) < 1e-6);
});

test('planeNormal recovers a known plane and refuses a degenerate one', () => {
  const n = planeNormal([[0, 0, 0], [1, 0, 0.2], [0, 1, -0.1], [1, 1, 0.1]]);
  assert.ok(n);
  for (const p of [[1, 0, 0.2], [0, 1, -0.1]]) {
    assert.ok(Math.abs(V.dot(n, p)) < 1e-6, 'points should lie in the plane');
  }
  assert.equal(planeNormal([[0, 0, 0], [1, 1, 1]]), null);
  assert.equal(planeNormal([[0, 0, 0], [1, 1, 1], [2, 2, 2]]), null);  // collinear
});

test('buildZones is pure — calling it twice gives the same map', () => {
  const a = buildZones(), b = buildZones();
  assert.deepEqual(a, b);
  assert.deepEqual(a, ZONES);
  assert.equal(askTotal(a), GOAL);
});
