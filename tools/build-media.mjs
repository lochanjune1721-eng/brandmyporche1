// tools/build-media.mjs — the media kit, generated from the zone map itself.
//
// At $2,748 you can sell on charm. At $135,000 a buyer wants the dimensions before they wire
// anything, so /media has to carry every zone's real size in centimetres. Generating it from
// zones.js is the only way those numbers can never drift from what the car actually shows.
//
//   node tools/build-media.mjs      →  media/index.html, media/zone-map.pdf

import fs from 'node:fs';
import { ZONES, TIERS, GOAL, PANELS, PANEL_LABEL, askTotal, tally } from '../zones.js';
import { Pdf } from './pdf.mjs';

const OUT = new URL('../media/', import.meta.url).pathname;
const TIER_ORDER = ['XXL', 'XL', 'L', 'M', 'S'];
const money = n => '$' + n.toLocaleString('en-US');
const { byPanel } = tally();

const ARTWORK = [
  ['Format', 'Vector preferred - SVG, PDF or EPS with outlined type. Otherwise PNG at 300dpi at final size, with transparency.'],
  ['Colour', 'CMYK-safe. Anything outside CMYK gamut will be matched as closely as the printer allows; neon and metallics will not reproduce.'],
  ['Bleed', 'Add 5mm bleed on every edge. Keep type and logos 8mm inside the trim.'],
  ['Contrast', 'The car is silver. Pure white artwork disappears; give white marks a keyline or a background.'],
  ['File names', 'ZONEID-brand.svg, e.g. H5-acme.svg, so nothing gets applied to the wrong panel.'],
  ['Deadline', 'Files are due 48 hours after the auction closes. Miss it and the zone is re-offered to the next bidder.'],
];

const REACH = [
  ['14 days', 'the wrap stays on, start to finish'],
  ['Daily', 'the car is driven in San Francisco and photographed'],
  ['3 events', 'scheduled cars & coffee meets during the run'],
  ['Every zone', 'appears in the daily photo set, sold or not'],
  ['0', 'impression numbers invented for this page'],
];

// ── panel diagrams ───────────────────────────────────────────────────────────
// Zones are authored as rectangles in a probe plane, which is exactly what a flat zone map is.
// Each diagram plots (u, v) straight through, so the drawing and the car cannot disagree.

// Each diagram is laid out the way the matching view on the site is, so a bidder can hold the
// two side by side. flipV puts larger v at the top of the page; flipU mirrors left for right.
const DIAGRAMS = [
  { key: 'hood',  probe: 'down',  title: 'Hood',         sub: 'from above, nose at the top',        flipV: true },
  { key: 'roof',  probe: 'down',  title: 'Roof',         sub: 'from above, windscreen at the top',  flipV: true },
  { key: 'left',  probe: 'left',  title: 'Left flank',   sub: 'from the kerb, nose to the right',   flipV: true },
  { key: 'rear',  probe: 'down',  title: 'Rear deck',    sub: 'engine lid and spoiler, from above', flipV: true, flipU: true },
  { key: 'rear',  probe: 'rear',  title: 'Rear face',    sub: 'from behind',                        flipV: true, flipU: true },
  { key: 'front', probe: 'front', title: 'Front bumper', sub: 'from the front',                     flipV: true },
];

function bounds(list, pad = 0.06) {
  const u0 = Math.min(...list.map(z => z.u - z.w / 2)) - pad;
  const u1 = Math.max(...list.map(z => z.u + z.w / 2)) + pad;
  const v0 = Math.min(...list.map(z => z.v - z.h / 2)) - pad;
  const v1 = Math.max(...list.map(z => z.v + z.h / 2)) + pad;
  return { u0, u1, v0, v1, w: u1 - u0, h: v1 - v0 };
}

function drawDiagram(pdf, d, x, y, boxW, boxH) {
  const list = ZONES.filter(z => z.panel === d.key && z.probe === d.probe);
  if (!list.length) return;
  const b = bounds(list);
  const scale = Math.min(boxW / b.w, boxH / b.h);
  const ox = x + (boxW - b.w * scale) / 2;
  const oy = y + (boxH - b.h * scale) / 2;
  const px = u => d.flipU ? ox + (b.u1 - u) * scale : ox + (u - b.u0) * scale;
  const py = v => d.flipV ? oy + (b.v1 - v) * scale : oy + (v - b.v0) * scale;

  pdf.text(x, y - 16, d.title, { size: 11, bold: true });
  pdf.text(x + pdf.textWidth(d.title, 11, true) + 8, y - 16, d.sub, { size: 8, gray: 0.45 });
  pdf.rect(ox - 4, oy - 4, b.w * scale + 8, b.h * scale + 8, { stroke: 0.85, lw: 0.5 });

  for (const z of list) {
    const w = z.w * scale, h = z.h * scale;
    const left = px(z.u) - w / 2;
    const top = py(z.v) - h / 2;
    pdf.rect(left, top, w, h, { fill: 0.93, stroke: 0.35, lw: 0.7, dash: [2.4, 1.8], radius: Math.min(3, h / 3) });
    const label = z.id;
    if (h >= 11 && pdf.textWidth(label, 7, true) < w - 3) {
      pdf.text(left, top + h / 2 + 1.5, label, { size: 7, bold: true, align: 'center', width: w });
      if (h >= 22) pdf.text(left, top + h / 2 + 10, z.wCm, { size: 6, gray: 0.4, align: 'center', width: w });
    } else if (pdf.textWidth(label, 5.5, true) < w - 2) {
      pdf.text(left, top + h / 2 + 2, label, { size: 5.5, bold: true, align: 'center', width: w });
    }
  }
  // scale bar, because the whole point of this page is the centimetres
  const barM = 0.5;
  pdf.line(ox, oy + b.h * scale + 12, ox + barM * scale, oy + b.h * scale + 12, { gray: 0.3, lw: 1 });
  pdf.text(ox + barM * scale + 5, oy + b.h * scale + 15, '50 cm', { size: 6.5, gray: 0.4 });
}

// ── the PDF ──────────────────────────────────────────────────────────────────

const pdf = new Pdf({ title: 'Brand My 911 - zone map & media kit', author: 'Brand My 911' });
const M = 42;
const W = pdf.w - M * 2;

function header(sub) {
  pdf.rect(0, 0, pdf.w, 54, { fill: 0.07 });
  pdf.text(M, 24, 'BRAND MY 911', { size: 13, bold: true, gray: 1 });
  pdf.text(M, 40, '82 panels. $135,000. That’s the car.', { size: 9, gray: 0.75 });
  pdf.text(M, 40, sub, { size: 8, gray: 0.75, align: 'right', width: W });
}
function footer(n) {
  pdf.line(M, pdf.h - 34, pdf.w - M, pdf.h - 34, { gray: 0.85 });
  pdf.text(M, pdf.h - 22, 'brandmy911.com/media - hello@brandmy911.com', { size: 7.5, gray: 0.5 });
  pdf.text(M, pdf.h - 22, `Page ${n}`, { size: 7.5, gray: 0.5, align: 'right', width: W });
}

// page 1 — the economics, the tiers, the specs
header('Zone map & media kit');
let y = 92;
pdf.text(M, y, 'The whole pricing argument, on one line', { size: 15, bold: true }); y += 20;
pdf.text(M, y, '82 zones. Every one at ask. They add up to exactly $135,000 - the price of the car, not a', { size: 9.5, gray: 0.25 }); y += 14;
pdf.text(M, y, 'target anyone picked. No side pot: there is no zone on this car that does not buy a piece of it.', { size: 9.5, gray: 0.25 }); y += 26;

const colW = W / 2 - 16;
let ty = y;
pdf.text(M, ty, 'TIERS', { size: 8, bold: true, gray: 0.45 }); ty += 6;
pdf.line(M, ty, M + colW, ty, { gray: 0.8 }); ty += 13;
for (const h of [['Tier', 0], ['Price', 60], ['Zones', 110], ['Subtotal', 155], ['Sizes seen on the car', 210]]) {
  pdf.text(M + h[1], ty, h[0], { size: 7.5, bold: true, gray: 0.5 });
}
ty += 12;
for (const t of TIER_ORDER) {
  const list = ZONES.filter(z => z.tier === t);
  const sub = list.reduce((a, z) => a + z.price, 0);
  const sizes = [...new Set(list.map(z => z.wCm))].sort((a, b) => parseInt(b) - parseInt(a));
  pdf.text(M, ty, t, { size: 9, bold: true });
  pdf.text(M + 60, ty, money(TIERS[t].price), { size: 8.5 });
  pdf.text(M + 110, ty, String(list.length), { size: 8.5 });
  pdf.text(M + 155, ty, money(sub), { size: 8.5 });
  pdf.text(M + 210, ty, sizes.slice(0, 5).join(', ') + (sizes.length > 5 ? ', ...' : '') + ' cm', { size: 7, gray: 0.45 });
  ty += 14;
}
pdf.line(M, ty - 4, M + colW, ty - 4, { gray: 0.8 });
pdf.text(M, ty + 9, '82 zones', { size: 9, bold: true });
pdf.text(M + 155, ty + 9, money(askTotal()), { size: 9, bold: true });

let py = y;
const cx = M + W / 2 + 16;
pdf.text(cx, py, 'PER PANEL', { size: 8, bold: true, gray: 0.45 }); py += 6;
pdf.line(cx, py, cx + colW, py, { gray: 0.8 }); py += 13;
pdf.text(cx, py, 'Panel', { size: 7.5, bold: true, gray: 0.5 });
TIER_ORDER.forEach((t, i) => pdf.text(cx + 92 + i * 26, py, t, { size: 7.5, bold: true, gray: 0.5 }));
pdf.text(cx + 92 + 6 * 26, py, 'At ask', { size: 7.5, bold: true, gray: 0.5 });
py += 12;
for (const p of PANELS) {
  pdf.text(cx, py, `${PANEL_LABEL[p]} (${byPanel[p].total})`, { size: 8.5 });
  TIER_ORDER.forEach((t, i) => pdf.text(cx + 92 + i * 26, py, String(byPanel[p][t] || '-'), { size: 8.5, gray: byPanel[p][t] ? 0 : 0.7 }));
  pdf.text(cx + 92 + 6 * 26, py, money(byPanel[p].ask), { size: 8 });
  py += 14;
}

const specTop = Math.max(ty, py) + 34;
pdf.text(M, specTop, 'ARTWORK SPECIFICATION', { size: 8, bold: true, gray: 0.45 });
pdf.line(M, specTop + 6, pdf.w - M, specTop + 6, { gray: 0.8 });
let sy = specTop + 20;
for (const [k, v] of ARTWORK) {
  pdf.text(M, sy, k, { size: 8.5, bold: true });
  pdf.text(M + 74, sy, v, { size: 8.5, gray: 0.3 });
  sy += 14;
}
footer(1);

// pages 2-3 — the diagrams
pdf.page(); header('Zone map 1 of 2');
drawDiagram(pdf, DIAGRAMS[0], M, 100, W / 2 - 30, 380);
drawDiagram(pdf, DIAGRAMS[1], M + W / 2 + 10, 100, W / 2 - 30, 380);
pdf.text(M, pdf.h - 52, 'Sizes are the printed decal size in centimetres, width x height, measured on the panel.', { size: 7.5, gray: 0.45 });
footer(2);

pdf.page(); header('Zone map 2 of 2');
drawDiagram(pdf, DIAGRAMS[2], M, 92, W, 130);
drawDiagram(pdf, DIAGRAMS[5], M, 278, W, 58);       // the nose is 16:1 — it needs the full width
drawDiagram(pdf, DIAGRAMS[4], M, 396, W * 0.46, 118);
drawDiagram(pdf, DIAGRAMS[3], M + W * 0.53, 396, W * 0.47, 118);
pdf.text(M, pdf.h - 52, 'The right flank mirrors the left exactly: same z, same height, same sizes, ids RF1-RF20.', { size: 7.5, gray: 0.45 });
footer(3);

// pages 4+ — the schedule
const perPage = 34;
let pageNo = 4;
for (let i = 0; i < ZONES.length; i += perPage * 2) {
  pdf.page(); header(`Zone schedule ${Math.floor(i / (perPage * 2)) + 1}`);
  for (const col of [0, 1]) {
    const x = M + col * (W / 2 + 10);
    let ry = 92;
    pdf.text(x, ry, 'Zone', { size: 7.5, bold: true, gray: 0.5 });
    pdf.text(x + 46, ry, 'Panel / row', { size: 7.5, bold: true, gray: 0.5 });
    pdf.text(x + 196, ry, 'Tier', { size: 7.5, bold: true, gray: 0.5 });
    pdf.text(x + 226, ry, 'Size cm', { size: 7.5, bold: true, gray: 0.5 });
    pdf.text(x + 282, ry, 'Ask', { size: 7.5, bold: true, gray: 0.5 });
    pdf.line(x, ry + 4, x + W / 2 - 20, ry + 4, { gray: 0.8 });
    ry += 15;
    for (const z of ZONES.slice(i + col * perPage, i + col * perPage + perPage)) {
      pdf.text(x, ry, z.id, { size: 8, bold: true });
      pdf.text(x + 46, ry, z.row.replace(/^\w+ — /, PANEL_LABEL[z.panel].slice(0, 5) + ' - '), { size: 7.5, gray: 0.35 });
      pdf.text(x + 196, ry, z.tier, { size: 8 });
      pdf.text(x + 226, ry, z.wCm, { size: 8 });
      pdf.text(x + 282, ry, money(z.price), { size: 8 });
      ry += 11.4;
    }
  }
  footer(pageNo++);
}

fs.writeFileSync(OUT + 'zone-map.pdf', pdf.build());

// ── the page ─────────────────────────────────────────────────────────────────

const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const tierRows = TIER_ORDER.map(t => {
  const list = ZONES.filter(z => z.tier === t);
  const sub = list.reduce((a, z) => a + z.price, 0);
  const sizes = [...new Set(list.map(z => z.wCm))].sort((a, b) => parseInt(b) - parseInt(a));
  return `<tr><td><span class="chip t-${t}">${t}</span></td><td class="tabular">${money(TIERS[t].price)}</td>` +
    `<td class="tabular">${list.length}</td><td class="tabular">${money(sub)}</td>` +
    `<td class="muted">${sizes.join(' · ')} cm</td></tr>`;
}).join('\n');

const panelRows = PANELS.map(p =>
  `<tr><td><b>${PANEL_LABEL[p]}</b></td>` +
  TIER_ORDER.map(t => `<td class="tabular${byPanel[p][t] ? '' : ' muted'}">${byPanel[p][t] || '—'}</td>`).join('') +
  `<td class="tabular">${byPanel[p].total}</td><td class="tabular">${money(byPanel[p].ask)}</td></tr>`).join('\n');

const scheduleRows = ZONES.map(z =>
  `<tr><td><b>${z.id}</b></td><td>${esc(z.row)}</td><td><span class="chip t-${z.tier}">${z.tier}</span></td>` +
  `<td class="tabular">${z.wCm}</td><td class="muted">${z.on}</td><td class="tabular">${money(z.price)}</td></tr>`).join('\n');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Media kit — Brand My 911</title>
<meta name="description" content="Every one of the 82 zones on the car, with its real size in centimetres, artwork specification, deadlines and an honest reach statement.">
<link rel="icon" href="../index.html" >
<link rel="stylesheet" href="../style.css">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Space+Grotesk:wght@600;700&display=swap" rel="stylesheet">
<style>
  .kit{max-width:var(--max);margin:0 auto;padding:22px 16px}
  .kit table{width:100%;border-collapse:collapse;margin-top:12px;font-size:13px}
  .kit th,.kit td{text-align:left;padding:7px 8px;border-bottom:1px solid var(--line);vertical-align:middle}
  .kit th{font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);border-bottom-color:var(--ink)}
  .kit h2{margin-top:34px;font-size:22px}
  .kit h3{margin-top:22px;font-size:15px}
  .scroller{overflow-x:auto;-webkit-overflow-scrolling:touch}
  .facts{display:grid;gap:10px;margin-top:12px}
  @media(min-width:760px){.facts{grid-template-columns:repeat(auto-fit,minmax(160px,1fr))}}
  .fact{border:1px solid var(--line);border-radius:12px;padding:12px;background:#fff}
  .fact b{display:block;font-family:"Space Grotesk",Inter,sans-serif;font-size:19px;letter-spacing:-.02em}
  .fact span{font-size:12px;color:var(--muted)}
  .spec{border:1px solid var(--line);border-radius:12px;background:#fff;padding:4px 14px;margin-top:12px}
  .spec div{display:grid;gap:2px;padding:10px 0;border-bottom:1px solid var(--line);font-size:13px}
  @media(min-width:640px){.spec div{grid-template-columns:120px 1fr;gap:14px}}
  .spec div:last-child{border-bottom:0}
  .spec b{font-size:13px}
  .spec span{color:var(--muted)}
  .dl{display:inline-flex;align-items:center;gap:8px}
</style>
</head>
<body>
<nav class="nav"><div class="nav-inner">
  <a class="wordmark" href="../index.html"><i>911</i> Brand My 911</a>
  <div class="nav-links"><a href="../index.html#auction">Live auction</a><a href="../index.html#faq">FAQ</a></div>
  <div class="nav-actions"><a href="zone-map.pdf" class="btn btn-dark" download>Download the PDF</a></div>
</div></nav>

<header class="hero">
  <p class="kicker">Media kit</p>
  <h1>Every zone,<br>to the centimetre.</h1>
  <p class="finish-line">82 panels. $135,000. That's the car.</p>
  <p class="sub">Everything a designer or a print shop needs before anyone wires anything: the full
  zone map, each zone's printed size, the artwork specification, the deadline, and exactly what the
  car will and will not do for you. This page is generated from the same file the 3D car reads, so
  the numbers here and the numbers on the bodywork cannot drift apart.</p>
  <div class="hero-cta">
    <a class="btn btn-dark dl" href="zone-map.pdf" download>Download the zone map (PDF)</a>
    <a class="btn btn-ghost" href="../index.html#auction">See the live board</a>
  </div>
</header>

<section class="kit">
  <h2>The economics</h2>
  <p class="muted">82 zones at ask sum to exactly <b>${money(GOAL)}</b>. There is no side pot and no
  zone that does not count: every spot on this car buys a piece of it, and the board and the invoice
  are the same number.</p>
  <div class="scroller"><table>
    <thead><tr><th>Tier</th><th>Price</th><th>Zones</th><th>Subtotal</th><th>Sizes on the car (w × h cm)</th></tr></thead>
    <tbody>
${tierRows}
      <tr><td colspan="2"><b>82 zones</b></td><td class="tabular"><b>82</b></td><td class="tabular"><b>${money(askTotal())}</b></td><td class="muted">the car</td></tr>
    </tbody>
  </table></div>

  <h3>By panel</h3>
  <div class="scroller"><table>
    <thead><tr><th>Panel</th>${TIER_ORDER.map(t => `<th>${t}</th>`).join('')}<th>Zones</th><th>At ask</th></tr></thead>
    <tbody>
${panelRows}
    </tbody>
  </table></div>

  <h2>What you actually get</h2>
  <p class="muted">No invented impression counts. If a number is not on this page, it is not being claimed.</p>
  <div class="facts">
${REACH.map(([b, s]) => `    <div class="fact"><b>${b}</b><span>${s}</span></div>`).join('\n')}
  </div>

  <h2>Artwork specification</h2>
  <div class="spec">
${ARTWORK.map(([k, v]) => `    <div><b>${k}</b><span>${esc(v)}</span></div>`).join('\n')}
  </div>

  <h2>All 82 zones</h2>
  <p class="muted">Sizes are the printed decal, width × height in centimetres, measured on the panel.
  Zone ids are what goes on your file name and on the invoice.</p>
  <div class="scroller"><table>
    <thead><tr><th>Zone</th><th>Row</th><th>Tier</th><th>Size cm</th><th>Surface</th><th>Ask</th></tr></thead>
    <tbody>
${scheduleRows}
    </tbody>
  </table></div>
</section>

<footer class="footer">
  <p class="small">Generated from <code>zones.js</code> by <code>tools/build-media.mjs</code>.
  Porsche® and 911® are trademarks of Dr. Ing. h.c. F. Porsche AG. This site is not affiliated with Porsche.</p>
</footer>
</body>
</html>
`;
fs.writeFileSync(OUT + 'index.html', html);
console.log(`media/index.html  ${(html.length / 1024).toFixed(1)} KB`);
console.log(`media/zone-map.pdf  ${(fs.statSync(OUT + 'zone-map.pdf').size / 1024).toFixed(1)} KB`);
