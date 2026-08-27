// zone-atlas.js — every zone label, baked once into a single texture.
//
// 82 decals with their own canvas texture is 82 uploads and 82 materials. Instead every
// distinct cell shape gets one cell in one atlas and identical zones share it.
//
// Cells are drawn at the zone's real aspect ratio, so a 96×8cm banner gets a long thin cell
// and its dashes stay the same length as everywhere else on the car.
//
// A marker is a stitched outline and a price. It used to carry the tier letter, the size and
// the price at three levels of detail that swapped as the camera moved — 82 of those on a
// silver car read as a page of black stickers rather than as a car with space on it. The tier
// and the centimetres live on the board and in the modal, where there is room to read them.
const MODES = ['plain'];

const INK = 'rgba(20,22,28,0.92)';
// A tint, not a plate. The dashes carry the shape now, so the fill only has to lift the zone
// off the paint — at 0.7 it buried the car it was supposed to be selling space on.
const FILL = 'rgba(9,10,13,0.20)';
// Dark text, because the fill is now light. The halo is what keeps it legible where the car
// goes dark under a wheel arch or in shadow.
const TEXT = 'rgba(17,19,24,0.94)';
const HALO = 'rgba(255,255,255,0.85)';

/** Cell pixel height from the zone's real height, so big zones stay sharp when you zoom in
 *  and a one-off zone does not burn a 256px row of its own. */
const cellHeight = h => Math.round(Math.min(160, Math.max(40, h * 620)));

export class ZoneAtlas {
  /**
   * @param zones   the 82-zone list
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
        const key = `${mode}|${z.wCm}|${z.price}`;
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

  /** UV rect for a zone. There is one cell per zone shape now, so `mode` is always 'plain';
   *  it stays in the signature because the viewer still addresses cells by (zone, mode). */
  cell(zoneId, mode = 'plain') {
    return this.cells.get(this.keyOf.get(`${zoneId}|${mode}`));
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

    c.fillStyle = FILL;
    roundRect(c, inset, inset, w - inset * 2, h - inset * 2, Math.max(0, r - inset));
    c.fill();

    c.setLineDash([dash, gap]);
    c.lineWidth = lw;
    c.strokeStyle = INK;
    roundRect(c, inset, inset, w - inset * 2, h - inset * 2, Math.max(0, r - inset));
    c.stroke();
    c.setLineDash([]);

    // The price, small, and nothing else. Sized to the cell then shrunk to fit its width, so a
    // long thin zone shows the same number as a square one rather than clipping it.
    const label = `$${zone.price.toLocaleString('en-US')}`;
    const room = w - inset * 2 - Math.max(6, w * 0.10);
    let px = Math.max(7, Math.round(h * 0.22));
    for (let i = 0; i < 26 && px > 7; i++) {
      c.font = `600 ${px}px Inter, system-ui, sans-serif`;
      if (c.measureText(label).width <= room) break;
      px = Math.floor(px * 0.92);
    }
    c.font = `600 ${px}px Inter, system-ui, sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.lineWidth = Math.max(2, px * 0.26);
    c.strokeStyle = HALO;
    c.lineJoin = 'round';
    c.strokeText(label, w / 2, h / 2);
    c.fillStyle = TEXT;
    c.fillText(label, w / 2, h / 2);

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
