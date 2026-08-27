// app.js — the board: what is sold, what is free, and getting someone to PayPal.
//
// There is no bidding. Every zone has one price, set in zones.js, and the first person to pay
// it owns the panel. That is why nothing here computes a minimum or tracks an increment.
//
// This file never talks to Supabase or PayPal. It reads /api/zones and posts to /api/checkout,
// and the server decides what a zone costs — a price that travels through a browser is a
// price anyone can edit.

import { CONFIG, ZONES, TIERS, GOAL, PANELS, PANEL_LABEL, askTotal } from './config.js';
import { applyDecal, removeDecal, focusZone, setPanel } from './viewer.js';

const $ = id => document.getElementById(id);
const zoneById = new Map(ZONES.map(z => [z.id, z]));

let currency = CONFIG.currency;
let sold = new Map();            // zoneId -> { brand, url, artwork, at }
let held = new Set();            // someone is at the PayPal checkout for these
let panelFilter = 'all', tierFilter = 'all';
let openPanels = new Set(['hood']);
let pollTimer = null;

// ── money ────────────────────────────────────────────────────────────────────

const RATE = { $: 1, '€': 0.92 };
const fmt = cents => currency + Math.round(cents / 100 * RATE[currency]).toLocaleString('en-US');
const chargeFmt = cents => '$' + (cents / 100).toLocaleString('en-US');

const raisedCents = () => [...sold.keys()]
  .reduce((a, id) => a + (zoneById.get(id)?.price ?? 0) * 100, 0);
const closed = () => Date.now() >= new Date(CONFIG.endsAt).getTime();
const stateOf = id => sold.has(id) ? 'sold' : held.has(id) ? 'held' : 'open';

// ── boot ─────────────────────────────────────────────────────────────────────

export function initApp() {
  assertTheMaths();
  $('model-credit').textContent = CONFIG.modelCredit;

  refresh();
  pollTimer = setInterval(refresh, 15000);
  addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });

  tick(); setInterval(tick, 1000);
  addEventListener('currency', e => { currency = e.detail; renderAll(); });
  addEventListener('zones-ready', renderDecals);
  addEventListener('zone-hover', e => highlightRow(e.detail));

  $('modal-bg').onclick = closeModal;
  $('modal-x').onclick = closeModal;
  $('buy-form').onsubmit = submitBuy;
  $('f-file').onchange = onFile;
  addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

  wirePills('panel-pills', 'panel', v => {
    panelFilter = v;
    setPanel(v === 'all' ? 'all' : v);
    if (v !== 'all') openPanels = new Set([v]);
    renderTable();
  });
  wirePills('tier-pills', 'tier', v => { tierFilter = v; renderTable(); });

  window.__openBuy = openBuy;
  showReturnMessage();
  renderAll();
}

/** The one number the whole site rests on. If this ever fails, say so loudly rather than
 *  quietly selling a car that does not add up. */
function assertTheMaths() {
  if (ZONES.length !== 82 || askTotal() !== GOAL) {
    const msg = `Zone map does not add up: ${ZONES.length} zones at ` +
                `$${askTotal().toLocaleString()} (expected 82 / $${GOAL.toLocaleString()}).`;
    console.error(msg);
    banner(msg, 'bad');
  }
}

function banner(text, kind = 'bad') {
  const el = $('error-banner');
  el.textContent = text;
  el.className = 'error-banner ' + kind;
  el.style.display = text ? 'block' : 'none';
}

/** PayPal sends people back here with a verdict in the query string. */
function showReturnMessage() {
  const q = new URLSearchParams(location.search);
  const bought = q.get('bought'), failed = q.get('paid'), cancelled = q.get('cancelled');
  if (bought) {
    const z = zoneById.get(bought);
    banner(`Zone ${bought}${z ? ` — ${z.tier}, ${z.wCm} cm` : ''} is yours. A receipt is on its way, ` +
           `and your artwork is on the car below.`, 'good');
    setTimeout(() => { if (z) focusZone(bought); }, 2500);
  } else if (failed) {
    banner(`That payment did not go through${q.get('zone') ? ` for zone ${q.get('zone')}` : ''}. ` +
           `Nothing was charged — the zone is back on the board.`, 'bad');
  } else if (cancelled !== null) {
    banner(`Checkout cancelled${cancelled ? ` — zone ${cancelled} is free again` : ''}. No charge.`, 'warn');
  }
  if (bought || failed || cancelled !== null) history.replaceState({}, '', location.pathname + location.hash);
}

async function refresh() {
  try {
    const res = await fetch('/api/zones', { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`/api/zones ${res.status}`);
    const data = await res.json();
    sold = new Map((data.sold || []).map(s => [s.zone, s]));
    held = new Set(data.held || []);
    $('data-status').textContent = 'Live';
    renderAll();
  } catch (err) {
    // A dead board is worse than a stale one: keep whatever we had and say so quietly.
    console.warn('[app]', err.message);
    $('data-status').textContent = 'Reconnecting…';
  }
}

// ── render ───────────────────────────────────────────────────────────────────

function renderAll() { renderMeter(); renderCountdown(); renderTable(); renderDecals(); }

function renderMeter() {
  const raised = raisedCents(), goalCents = GOAL * 100;
  const pct = Math.round(raised / goalCents * 100);
  $('raised').textContent = fmt(raised);
  $('goal-label').textContent = 'of ' + fmt(goalCents);
  $('spots-taken').textContent = `${sold.size} of 82 zones taken`;
  $('meter-pct').textContent = pct + '% of the car';
  const bar = $('bar');
  bar.style.width = Math.min(100, Math.max(raised > 0 ? 2 : 0, pct)) + '%';
  bar.classList.toggle('over', raised >= goalCents);
  $('goal-over').hidden = raised < goalCents;
  $('goal-over').textContent = `· paid for · ${pct}%`;
  $('sticky-taken').textContent = `${sold.size} of 82 zones taken`;
  $('sticky-raised').textContent = `${fmt(raised)} of ${fmt(goalCents)}`;
}

function fmtLeft(ms) {
  if (ms <= 0) return 'closed';
  const d = Math.floor(ms / 864e5), h = Math.floor(ms % 864e5 / 36e5),
        m = Math.floor(ms % 36e5 / 6e4), s = Math.floor(ms % 6e4 / 1e3);
  return `${d}d ${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
}

function renderCountdown() {
  const left = Math.max(0, new Date(CONFIG.endsAt).getTime() - Date.now());
  $('hero-countdown').textContent = fmtLeft(left);
  $('auction-meta').textContent = closed()
    ? `Closed · ${sold.size} of 82 zones sold`
    : `${sold.size} of 82 zones taken · ${82 - sold.size} still open`;
}

function renderTable() {
  const el = $('table');
  el.innerHTML = '';
  let rows = ZONES.filter(z =>
    (panelFilter === 'all' || z.panel === panelFilter) &&
    (tierFilter === 'all' || z.tier === tierFilter));

  // Open zones first, dearest at the top — the board should read as things you can still have.
  const rank = z => (stateOf(z.id) === 'open' ? 0 : stateOf(z.id) === 'held' ? 1 : 2);
  rows.sort((a, b) => rank(a) - rank(b) || b.price - a.price || a.n - b.n);

  if (!rows.length) { el.innerHTML = '<p class="empty">No zones match that filter.</p>'; return; }

  const grouped = new Map();
  for (const z of rows) {
    if (!grouped.has(z.panel)) grouped.set(z.panel, []);
    grouped.get(z.panel).push(z);
  }

  for (const panel of PANELS) {
    const list = grouped.get(panel);
    if (!list) continue;
    const all = ZONES.filter(z => z.panel === panel);
    const taken = all.filter(z => sold.has(z.id)).length;
    const raised = all.reduce((a, z) => a + (sold.has(z.id) ? z.price * 100 : 0), 0);

    const sec = document.createElement('details');
    sec.className = 'panel-group';
    sec.open = panelFilter !== 'all' || tierFilter !== 'all' || openPanels.has(panel);
    sec.addEventListener('toggle', () => sec.open ? openPanels.add(panel) : openPanels.delete(panel));
    sec.innerHTML = `<summary><span class="pg-name">${PANEL_LABEL[panel]} — ${taken} of ${all.length} taken</span>` +
                    `<span class="pg-sum tabular">${fmt(raised)} paid</span></summary>`;

    for (const z of list) {
      const state = stateOf(z.id);
      const owner = sold.get(z.id);
      const row = document.createElement('div');
      row.className = 'row is-' + state;
      row.dataset.zone = z.id;
      row.innerHTML =
        `<div class="spot"><span class="chip t-${z.tier}">${z.tier}</span>` +
        `<div><b>${z.id}</b> <span class="rowsub">${esc(z.row)}</span><br>` +
        `<span class="rowsub">${z.wCm} cm${z.on !== 'bodywork' ? ' · ' + z.on : ''}</span></div></div>` +
        `<div class="held">${owner
          ? (owner.url
              ? `<a class="owner" href="${esc(owner.url)}" target="_blank" rel="noopener noreferrer">${owner.artwork ? `<img src="${esc(owner.artwork)}" alt="">` : ''}<span>${esc(owner.brand)}</span></a>`
              : `${owner.artwork ? `<img src="${esc(owner.artwork)}" alt="">` : ''}<span>${esc(owner.brand)}</span>`)
          : `<span class="rowsub">${state === 'held' ? 'reserved — someone is paying' : 'open'}</span>`}</div>` +
        `<div class="bid"><b class="tabular">${fmt(z.price * 100)}</b>` +
        `<small>buys the car</small></div>` +
        `<div class="rowact">${
          state === 'sold' ? '<span class="tag-sold">Sold</span>'
          : state === 'held' ? '<span class="tag-held">Reserved</span>'
          : closed() ? '<span class="tag-held">Closed</span>'
          : `<button class="btn-buy" data-zone="${z.id}">Buy</button>`}</div>`;
      sec.appendChild(row);
    }
    el.appendChild(sec);
  }

  el.querySelectorAll('.btn-buy').forEach(b => {
    b.onclick = e => { e.stopPropagation(); openBuy(b.dataset.zone); };
  });
  el.querySelectorAll('.row').forEach(r => { r.onclick = () => focusZone(r.dataset.zone); });
}

function highlightRow(id) {
  document.querySelectorAll('.row.hot').forEach(r => r.classList.remove('hot'));
  if (id) document.querySelector(`.row[data-zone="${id}"]`)?.classList.add('hot');
}

/** Logos on the car. Sold zones stay full opacity in every view — sold inventory is the best
 *  advertising the board has. */
const shownLogos = new Map();
function renderDecals() {
  for (const [id, url] of shownLogos) {
    if (sold.get(id)?.artwork !== url) { removeDecal(id); shownLogos.delete(id); }
  }
  for (const [id, s] of sold) {
    if (!s.artwork || shownLogos.get(id) === s.artwork) continue;
    const z = zoneById.get(id);
    if (z && applyDecal(z, s.artwork, s.url)) shownLogos.set(id, s.artwork);
  }
}

function tick() { renderMeter(); renderCountdown(); }

function wirePills(containerId, attr, cb) {
  const box = $(containerId);
  box.querySelectorAll('button').forEach(b => {
    b.onclick = () => {
      box.querySelectorAll('button').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      cb(b.dataset[attr]);
    };
  });
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ── buying ───────────────────────────────────────────────────────────────────

let activeZone = null, artwork = '';

function openBuy(id) {
  const z = zoneById.get(id);
  if (!z || closed()) return;
  const state = stateOf(id);
  // Someone already owns this panel — a tap on their icon belongs to them, not to us.
  const owner = sold.get(id);
  if (owner?.url) { open(owner.url, '_blank', 'noopener,noreferrer'); return; }
  if (state !== 'open') {
    banner(state === 'sold' ? `Zone ${id} has already sold.` : `Zone ${id} is reserved — someone is at the checkout. It frees up if they do not finish.`, 'warn');
    return;
  }
  activeZone = z;
  focusZone(id);
  $('modal-kicker').textContent = `${z.id} · ${PANEL_LABEL[z.panel]}`;
  $('modal-title').textContent = `${TIERS[z.tier].label} — ${z.wCm} cm`;
  $('modal-meta').textContent = `${z.row}${z.on !== 'bodywork' ? ' · on ' + z.on : ''}`;
  $('modal-price').textContent = chargeFmt(z.price * 100);
  $('modal-note').textContent = 'This zone is part of the $135,000 that buys the car.';
  artwork = '';
  $('f-file').value = '';
  $('f-url').value = '';
  $('preview').innerHTML = '<span class="rowsub">No artwork yet</span>';
  hideErr();
  $('submit-btn').disabled = false;
  $('submit-btn').textContent = `Buy for ${chargeFmt(z.price * 100)}`;
  $('modal').classList.add('open');
  $('f-url').focus();
}

function closeModal() { $('modal').classList.remove('open'); }
function showErr(m) { const e = $('form-err'); e.textContent = m; e.style.display = 'block'; }
function hideErr() { $('form-err').style.display = 'none'; }

function onFile(e) {
  const f = e.target.files[0];
  if (!f) return;
  if (!['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'].includes(f.type)) {
    showErr('Artwork must be PNG, JPG, WebP or SVG.'); e.target.value = ''; return;
  }
  if (f.size > 3 * 1024 * 1024) { showErr('Max 3 MB. Vector or 300dpi PNG is plenty.'); e.target.value = ''; return; }
  hideErr();
  const r = new FileReader();
  r.onload = () => { artwork = r.result; $('preview').innerHTML = `<img src="${artwork}" alt="artwork preview">`; };
  r.readAsDataURL(f);
}

/** Accept "acme.com" as readily as "https://acme.com" — nobody types a scheme. */
function normaliseUrl(raw) {
  const t = raw.trim().replace(/^\s*https?:\/\//i, '');
  if (!/^[\w-]+(\.[\w-]+)+(\/|$)/.test(t)) return null;
  return 'https://' + t.replace(/\/+$/, '');
}

async function submitBuy(e) {
  e.preventDefault();
  hideErr();
  const url = normaliseUrl($('f-url').value);

  if (!url) return showErr('That does not look like a website. Something like acme.com.');
  if (!artwork) return showErr('Upload your icon — it goes straight onto the car.');

  const btn = $('submit-btn');
  btn.disabled = true;
  btn.textContent = 'Taking you to PayPal…';
  try {
    const res = await fetch('/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ zoneId: activeZone.id, url, artwork }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Checkout failed (${res.status}).`);
    // Full redirect rather than a popup: popups get blocked, and this has to work on a phone.
    location.href = data.approveUrl;
  } catch (err) {
    showErr(err.message);
    btn.disabled = false;
    btn.textContent = `Buy for ${chargeFmt(activeZone.price * 100)}`;
    refresh();                        // if it was taken while they filled the form, show that
  }
}
