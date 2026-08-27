// tools/pdf.mjs — a very small PDF writer.
//
// The media kit has to be downloadable as a PDF a print shop can open, and pulling a PDF
// library in for four pages of rectangles and Helvetica is not worth the dependency. This
// writes the objects by hand: catalog, pages, one content stream per page, base-14 fonts.

const esc = s => String(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
  // base-14 Helvetica is WinAnsi; keep the typography to what it can actually render
  .replace(/×/g, 'x').replace(/[—–]/g, '-').replace(/·/g, '-')
  .replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/€/g, 'EUR ')
  .replace(/[^\x20-\x7E]/g, '');

export class Pdf {
  constructor({ width = 842, height = 595, title = '', author = '' } = {}) {
    this.w = width; this.h = height; this.title = title; this.author = author;
    this.pages = []; this.cur = null;
    this.page();
  }
  page() { this.cur = []; this.pages.push(this.cur); return this; }

  /** PDF's origin is bottom-left; everything above is written top-left because that is how
   *  a page reads. This is the only place the flip happens. */
  y(v) { return this.h - v; }

  text(x, y, str, { size = 10, bold = false, gray = 0, align = 'left', width = 0 } = {}) {
    const s = esc(str);
    const font = bold ? '/F2' : '/F1';
    let tx = x;
    if (align !== 'left' && width) {
      const w = this.textWidth(str, size, bold);
      tx = align === 'center' ? x + (width - w) / 2 : x + width - w;
    }
    this.cur.push(`BT ${font} ${size} Tf ${gray} g 1 0 0 1 ${tx.toFixed(2)} ${this.y(y).toFixed(2)} Tm (${s}) Tj ET`);
    return this;
  }
  /** Helvetica advance widths, enough for centring and right-alignment. */
  textWidth(str, size, bold) {
    const W = bold ? 0.556 : 0.52;
    let n = 0;
    for (const ch of esc(str)) n += /[ijltI.,:;'!|]/.test(ch) ? 0.28 : /[mwMW@]/.test(ch) ? 0.86 : W;
    return n * size;
  }
  rect(x, y, w, h, { fill = null, stroke = null, lw = 0.6, dash = null, radius = 0 } = {}) {
    const parts = [];
    if (fill !== null) parts.push(`${fill} g`);
    if (stroke !== null) parts.push(`${stroke} G ${lw} w`);
    if (dash) parts.push(`[${dash.join(' ')}] 0 d`); else parts.push('[] 0 d');
    parts.push(radius > 0
      ? roundedPath(x, this.y(y + h), w, h, Math.min(radius, w / 2, h / 2))
      : `${x.toFixed(2)} ${this.y(y + h).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re`);
    parts.push(fill !== null && stroke !== null ? 'B' : fill !== null ? 'f' : 'S');
    this.cur.push(parts.join(' '));
    return this;
  }
  line(x1, y1, x2, y2, { gray = 0.8, lw = 0.6 } = {}) {
    this.cur.push(`${gray} G ${lw} w [] 0 d ${x1.toFixed(2)} ${this.y(y1).toFixed(2)} m ${x2.toFixed(2)} ${this.y(y2).toFixed(2)} l S`);
    return this;
  }

  build() {
    const objs = [];
    const add = body => { objs.push(body); return objs.length; };      // 1-based object numbers
    const pagesId = 2;
    add('<< /Type /Catalog /Pages 2 0 R >>');
    add('');                                                           // placeholder for /Pages
    const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const kids = [];
    for (const ops of this.pages) {
      const stream = ops.join('\n');
      const cId = add(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
      kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${this.w} ${this.h}] ` +
        `/Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${cId} 0 R >>`));
    }
    objs[pagesId - 1] = `<< /Type /Pages /Count ${kids.length} /Kids [${kids.map(k => `${k} 0 R`).join(' ')}] >>`;
    const infoId = add(`<< /Title (${esc(this.title)}) /Author (${esc(this.author)}) /Producer (brandmy911) >>`);

    let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
    const offsets = [0];
    objs.forEach((body, i) => {
      offsets.push(Buffer.byteLength(out, 'latin1'));
      out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xref = Buffer.byteLength(out, 'latin1');
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
    for (let i = 1; i <= objs.length; i++) out += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info ${infoId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(out, 'latin1');
  }
}

function roundedPath(x, y, w, h, r) {
  const k = r * 0.5523;
  const X = n => n.toFixed(2), Y = n => n.toFixed(2);
  return [
    `${X(x + r)} ${Y(y)} m`,
    `${X(x + w - r)} ${Y(y)} l`,
    `${X(x + w - r + k)} ${Y(y)} ${X(x + w)} ${Y(y + r - k)} ${X(x + w)} ${Y(y + r)} c`,
    `${X(x + w)} ${Y(y + h - r)} l`,
    `${X(x + w)} ${Y(y + h - r + k)} ${X(x + w - r + k)} ${Y(y + h)} ${X(x + w - r)} ${Y(y + h)} c`,
    `${X(x + r)} ${Y(y + h)} l`,
    `${X(x + r - k)} ${Y(y + h)} ${X(x)} ${Y(y + h - r + k)} ${X(x)} ${Y(y + h - r)} c`,
    `${X(x)} ${Y(y + r)} l`,
    `${X(x)} ${Y(y + r - k)} ${X(x + r - k)} ${Y(y)} ${X(x + r)} ${Y(y)} c`,
    'h',
  ].join(' ');
}
