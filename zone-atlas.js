// zone-atlas.js — every zone label, baked once into a single texture.
//
// 88 decals with their own canvas texture is 88 uploads and 88 materials. Instead every
// distinct (tier, size, detail level) gets one cell in one atlas, and identical zones share
// it. Changing a zone's detail level then costs a UV rewrite, not a canvas redraw — which is
// the whole point, because detail level changes every time the camera moves.
//
// Cells are drawn at the zone's real aspect ratio, so a 96×8cm banner gets a long thin cell
// and its dashes stay the same length as everywhere else on the car.

const MODES = ['full', 'letter', 'outline'];

const INK = 'rgba(255,255,255,0.94)';
const FILL = 'rgba(96,98,104,0.42)';
const FILL_HOT = 'rgba(232,255,74,0.16)';

/** Cell pixel height from the zone's real height, so big zones stay sharp when you zoom in
 *  and the six XS zones do not each burn a 256px row. */
const cellHeight = h => Math.round(Math.min(160, Math.max(40, h * 620)));

export class ZoneAtlas {
  /**
   * @param zones   the 88-zone list
   * @param opts    { size } atlas edge in px (power of two)
   */
  constructor(zones, { size = 2048 } = {}) {
    this.size = size;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = size;
    this.ctx = this.canvas.getContext('2d');
    this.cells = new Map();          // key -> {u, v, w, h} in 0..1 texture space
    this.keyOf = new Map();          // `${zoneId}|${mode}` -> key

    // Work out the distinct cells first so packing can sort by height and waste less.
    const wanted = new Map();
    for (const z of zones) {
      for (const mode of MODES) {
        const key = mode === 'outline'
          ? `outline|${z.wCm}`                       // no text, so only the shape matters
          : `${mode}|${z.tier}|${z.price}|${z.wCm}`;
        this.keyOf.set(`${z.id}|${mode}`, key);
        if (!wanted.has(key)) wanted.set(key, { key, mode, zone: z });
      }
    }

    const items = [...wanted.values()].map(it => {
      const ph = cellHeight(it.zone.h);
      const pw = Math.round(Math.min(size - 8, Math.max(28, ph * (it.zone.w / it.zone.h))));
      return { ...it, pw, ph };
    }).sort((a, b) => b.ph - a.ph);

    let x = 2, y = 2, rowH = 0;
    for (const it of items) {
      if (x + it.pw + 2 > size) { x = 2; y += rowH + 2; rowH = 0; }
      if (y + it.ph + 2 > size) { console.warn('[atlas] out of room, skipping', it.key); continue; }
      this.draw(it, x, y, it.pw, it.ph);
      this.cells.set(it.key, { u: x / size, v: y / size, w: it.pw / size, h: it.ph / size });
      x += it.pw + 2;
      rowH = Math.max(rowH, it.ph);
    }
    this.used = y + rowH;
  }

  /** UV rect for a zone at a detail level, or the outline cell as a fallback. */
  cell(zoneId, mode) {
    return this.cells.get(this.keyOf.get(`${zoneId}|${mode}`))
        || this.cells.get(this.keyOf.get(`${zoneId}|outline`));
  }

  draw({ mode, zone }, x, y, w, h) {
    const c = this.ctx;
    c.save();
    c.translate(x, y);
    c.beginPath();
    c.rect(0, 0, w, h);
    c.clip();

    // Dash length is set in centimetres, not pixels, so every zone on the car shows the
    // same stitch whatever its size.
    const pxPerM = h / zone.h;
    const dash = Math.max(3, Math.round(0.022 * pxPerM));
    const gap = Math.max(2, Math.round(0.016 * pxPerM));
    const lw = Math.max(1.5, Math.min(5, Math.round(0.0055 * pxPerM)));
    const r = Math.min(Math.max(4, Math.round(0.022 * pxPerM)), Math.min(w, h) / 2 - lw);
    const inset = lw;

    c.fillStyle = zone.tier === 'XS' ? FILL_HOT : FILL;
    roundRect(c, inset, inset, w - inset * 2, h - inset * 2, Math.max(0, r - inset));
    c.fill();

    c.setLineDash([dash, gap]);
    c.lineWidth = lw;
    c.strokeStyle = INK;
    roundRect(c, inset, inset, w - inset * 2, h - inset * 2, Math.max(0, r - inset));
    c.stroke();
    c.setLineDash([]);

    if (mode !== 'outline') {
      c.textAlign = 'center';
      c.textBaseline = 'alphabetic';
      c.fillStyle = '#fff';
      c.shadowColor = 'rgba(0,0,0,0.55)';
      c.shadowBlur = Math.max(2, h * 0.06);

      const room = w - inset * 2 - Math.max(6, w * 0.06);
      // Size to the cell's height, then shrink until it fits the cell's width. A 96x8cm
      // banner is mostly width, and "from $3,000" must not run off the end of it.
      const fit = (text, wanted, weight, family) => {
        let px = Math.max(7, Math.round(wanted));
        for (let i = 0; i < 24 && px > 7; i++) {
          c.font = `${weight} ${px}px ${family}`;
          if (c.measureText(text).width <= room) break;
          px = Math.floor(px * 0.92);
        }
        c.font = `${weight} ${px}px ${family}`;
        return px;
      };

      const GROT = '"Space Grotesk", Inter, system-ui, sans-serif';
      const SANS = 'Inter, system-ui, sans-serif';
      const priceText = `from $${zone.price.toLocaleString('en-US')}`;

      if (mode === 'full') {
        const letterPx = fit(zone.tier, h * 0.44, 800, GROT);
        const pricePx = fit(priceText, h * 0.21, 600, SANS);
        const total = letterPx + pricePx * 1.28;
        const top = (h - total) / 2;
        c.font = `800 ${letterPx}px ${GROT}`;
        c.fillText(zone.tier, w / 2, top + letterPx * 0.82);
        c.font = `600 ${pricePx}px ${SANS}`;
        c.globalAlpha = 0.92;
        c.fillText(priceText, w / 2, top + letterPx + pricePx * 1.02);
        c.globalAlpha = 1;
      } else {
        const letterPx = fit(zone.tier, h * 0.6, 800, GROT);
        c.fillText(zone.tier, w / 2, h / 2 + letterPx * 0.36);
      }
    }
    c.restore();
  }
}

function roundRect(c, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  c.beginPath();
  c.moveTo(x + rr, y);
  c.lineTo(x + w - rr, y); c.quadraticCurveTo(x + w, y, x + w, y + rr);
  c.lineTo(x + w, y + h - rr); c.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  c.lineTo(x + rr, y + h); c.quadraticCurveTo(x, y + h, x, y + h - rr);
  c.lineTo(x, y + rr); c.quadraticCurveTo(x, y, x + rr, y);
  c.closePath();
}
