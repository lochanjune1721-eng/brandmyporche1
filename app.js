// app.js — the auction: money, the table, the bid modal.
//
// The table has to work at 88 rows, which a flat list does not. It groups into panel
// accordions with a running "4 of 11 taken · $21,000 raised" on each header, filters by panel
// and tier, and sorts by standing bid so the hero zones anchor the top.

import { CONFIG, ZONES, TIERS, GOAL, PANELS, PANEL_LABEL, askTotal } from './config.js';
import { applyDecal, removeDecal, focusZone, setPanel } from './viewer.js';

const $ = id => document.getElementById(id);
const zoneById = new Map(ZONES.map(z => [z.id, z]));

let currency = CONFIG.currency;
let bids = [];                 // {id, spot_id, bidder_name, brand_name, logo_url, amount_cents, status}
let supa = null, useSupa = false;
let panelFilter = 'all', tierFilter = 'all';
let openPanels = new Set(['hood']);

// ── money ────────────────────────────────────────────────────────────────────

const RATE = { $: 1, '€': 0.92 };
function fmt(cents) {
  const v = Math.round(cents / 100 * RATE[currency]);
  return currency + v.toLocaleString('en-US');
}

function topBySpot() {
  const m = new Map();
  for (const b of bids) {
    if (b.status !== 'active') continue;
    const cur = m.get(b.spot_id);
    if (!cur || b.amount_cents > cur.amount_cents) m.set(b.spot_id, b);
  }
  return m;
}
const raisedCents = () => [...topBySpot().values()].reduce((a, b) => a + b.amount_cents, 0);
const bidCounts = () => {
  const c = new Map();
  for (const b of bids) c.set(b.spot_id, (c.get(b.spot_id) || 0) + 1);
  return c;
};
const ended = () => Date.now() >= new Date(CONFIG.endsAt).getTime();

// ── boot ─────────────────────────────────────────────────────────────────────

export function initApp() {
  assertTheMaths();
  $('model-credit').textContent = CONFIG.modelCredit;

  connect().then(load);
  tick(); setInterval(tick, 1000);

  addEventListener('currency', e => { currency = e.detail; renderAll(); });
  addEventListener('zones-ready', () => renderDecals());
  addEventListener('zone-hover', e => highlightRow(e.detail));

  $('modal-bg').onclick = closeModal;
  $('modal-x').onclick = closeModal;
  $('bid-form').onsubmit = submitBid;
  $('f-file').onchange = onFile;
  addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

  wirePills('panel-pills', 'panel', v => {
    panelFilter = v;
    setPanel(v === 'all' ? 'all' : v);
    if (v !== 'all') openPanels = new Set([v]);
    renderTable();
  });
  wirePills('tier-pills', 'tier', v => { tierFilter = v; renderTable(); });

  window.__openBid = openBid;
  renderAll();
}

/** The one number the whole site rests on. If this ever fails, say so loudly rather than
 *  quietly selling a car that does not add up. */
function assertTheMaths() {
  const priced = ZONES.filter(z => z.priced);
  const sum = askTotal();
  if (ZONES.length !== 88 || priced.length !== 82 || sum !== GOAL) {
    const msg = `Zone map does not add up: ${ZONES.length} zones, ${priced.length} priced, $${sum.toLocaleString()} at ask (expected 88 / 82 / $${GOAL.toLocaleString()}).`;
    console.error(msg);
    const b = $('error-banner');
    if (b) { b.style.display = 'block'; b.textContent = msg; }
  }
}

async function connect() {
  const status = $('data-status');
  if (!CONFIG.supabaseUrl || !CONFIG.supabaseAnonKey) {
    status.textContent = 'Demo mode — bids are stored in this browser only';
    return;
  }
  try {
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
    supa = createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey);
    useSupa = true;
    status.textContent = 'Live';
    supa.channel('bids-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bids' }, () => load())
      .subscribe();
  } catch (err) {
    console.warn('[app] Supabase unavailable, falling back to local demo', err);
    status.textContent = 'Demo mode — could not reach the bid database';
  }
}

async function load() {
  if (useSupa) {
    const { data, error } = await supa.from('bids').select('*').order('amount_cents', { ascending: false });
    if (!error && data) bids = data;
  } else {
    try { bids = JSON.parse(localStorage.getItem('bmp_bids') || '[]'); } catch { bids = []; }
  }
  renderAll();
}

function saveLocal() { localStorage.setItem('bmp_bids', JSON.stringify(bids)); }

// ── render ───────────────────────────────────────────────────────────────────

function renderAll() { renderMeter(); renderCountdown(); renderTable(); renderDecals(); }

function renderMeter() {
  const raised = raisedCents();
  const goalCents = GOAL * 100;
  const pct = Math.round(raised / goalCents * 100);
  const taken = topBySpot().size;

  $('raised').textContent = fmt(raised);
  $('goal-label').textContent = 'of ' + fmt(goalCents);
  $('spots-taken').textContent = `${taken} of 88 zones taken`;
  $('meter-pct').textContent = pct + '% of the car';
  const bar = $('bar');
  bar.style.width = Math.min(100, Math.max(raised > 0 ? 2 : 0, pct)) + '%';
  bar.classList.toggle('over', raised >= goalCents);
  $('goal-over').style.display = raised >= goalCents ? 'inline' : 'none';
  $('goal-over').textContent = `· goal passed · ${pct}%`;

  $('sticky-taken').textContent = `${taken} of 88 zones taken`;
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
  $('auction-meta').textContent = ended()
    ? `Auction closed · ${topBySpot().size} of 88 zones sold`
    : `${topBySpot().size} of 88 zones taken · ends in ${fmtLeft(left)}`;
}

function renderTable() {
  const top = topBySpot(), counts = bidCounts(), isEnded = ended();
  const el = $('table');
  el.innerHTML = '';

  let rows = ZONES.filter(z =>
    (panelFilter === 'all' || z.panel === panelFilter) &&
    (tierFilter === 'all' || z.tier === tierFilter));

  // Standing bid descending, so whatever is hottest sits at the top of its panel.
  const value = z => top.get(z.id)?.amount_cents ?? z.price * 100;
  rows.sort((a, b) => value(b) - value(a) || a.n - b.n);

  if (!rows.length) {
    el.innerHTML = '<p class="empty">No zones match that filter.</p>';
    return;
  }

  const grouped = new Map();
  for (const z of rows) {
    if (!grouped.has(z.panel)) grouped.set(z.panel, []);
    grouped.get(z.panel).push(z);
  }

  for (const panel of PANELS) {
    const list = grouped.get(panel);
    if (!list) continue;
    const all = ZONES.filter(z => z.panel === panel);
    const taken = all.filter(z => top.has(z.id)).length;
    const raised = all.reduce((a, z) => a + (top.get(z.id)?.amount_cents || 0), 0);

    const sec = document.createElement('details');
    sec.className = 'panel-group';
    sec.open = panelFilter !== 'all' || tierFilter !== 'all' || openPanels.has(panel);
    sec.addEventListener('toggle', () => {
      if (sec.open) openPanels.add(panel); else openPanels.delete(panel);
    });
    sec.innerHTML =
      `<summary><span class="pg-name">${PANEL_LABEL[panel]} — ${taken} of ${all.length} taken</span>` +
      `<span class="pg-sum tabular">${fmt(raised)} raised</span></summary>`;

    for (const z of list) {
      const t = top.get(z.id);
      const n = counts.get(z.id) || 0;
      const row = document.createElement('div');
      row.className = 'row';
      row.dataset.zone = z.id;
      row.innerHTML =
        `<div class="spot"><span class="chip t-${z.tier}">${z.tier}</span>` +
        `<div><b>${z.id}</b> <span class="rowsub">${z.row}</span><br>` +
        `<span class="rowsub">${z.wCm} cm${z.on !== 'bodywork' ? ' · ' + z.on : ''}</span></div></div>` +
        `<div class="held">${t
          ? `${t.logo_url ? `<img src="${t.logo_url}" alt="">` : ''}<span>${esc(t.brand_name)}</span>`
          : '<span class="rowsub">open</span>'}</div>` +
        `<div class="bid"><b class="tabular">${fmt(t ? t.amount_cents : z.price * 100)}</b>` +
        `<small>${t ? `${n} bid${n === 1 ? '' : 's'}${isEnded ? ' · won' : ''}` : `ask${z.priced ? '' : ' · running costs'}`}</small></div>` +
        `<div class="rowact"><button class="btn-out${t ? ' has-bid' : ''}" data-zone="${z.id}">` +
        `${isEnded ? (t ? 'Pay' : 'Closed') : (t ? 'Outbid' : 'Take it')}</button></div>`;
      sec.appendChild(row);
    }
    el.appendChild(sec);
  }

  el.querySelectorAll('.btn-out').forEach(b => {
    b.onclick = e => {
      e.stopPropagation();
      const id = b.dataset.zone;
      if (isEnded) {
        const t = top.get(id);
        if (t) open(`https://paypal.me/${CONFIG.paypal.paypalMe}/${t.amount_cents / 100}`, '_blank', 'noopener');
        return;
      }
      openBid(id);
    };
  });
  el.querySelectorAll('.row').forEach(r => {
    r.onclick = () => focusZone(r.dataset.zone);
  });
}

function highlightRow(id) {
  document.querySelectorAll('.row.hot').forEach(r => r.classList.remove('hot'));
  if (!id) return;
  document.querySelector(`.row[data-zone="${id}"]`)?.classList.add('hot');
}

/** Winning logos on the car. Sold zones stay full opacity in every view — sold inventory is
 *  the best advertising the board has. */
let shownLogos = new Map();
function renderDecals() {
  const top = topBySpot();
  for (const [id, url] of shownLogos) {
    const t = top.get(id);
    if (!t || t.logo_url !== url) { removeDecal(id); shownLogos.delete(id); }
  }
  for (const [id, t] of top) {
    if (!t.logo_url || shownLogos.get(id) === t.logo_url) continue;
    const z = zoneById.get(id);
    // Only remember it once it is actually on the car — before the zones are projected
    // applyDecal has nothing to attach to, and we must try again on zones-ready.
    if (z && applyDecal(z, t.logo_url)) shownLogos.set(id, t.logo_url);
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

// ── bidding ──────────────────────────────────────────────────────────────────

let activeZone = null, pendingLogo = '';

function minFor(zone) {
  const t = topBySpot().get(zone.id);
  return t ? t.amount_cents / 100 + CONFIG.minIncrement : zone.price;
}

function openBid(id) {
  const z = zoneById.get(id);
  if (!z || ended()) return;
  activeZone = z;
  focusZone(id);
  const min = minFor(z);
  $('modal-kicker').textContent = `${z.id} · ${PANEL_LABEL[z.panel]}`;
  $('modal-title').textContent = `${TIERS[z.tier].label} — ${z.wCm} cm`;
  $('modal-meta').textContent = `${z.row}${z.on !== 'bodywork' ? ' · on ' + z.on : ''}`;
  $('modal-min').textContent = `Minimum ${fmt(min * 100)}` +
    (topBySpot().has(z.id) ? ` (${fmt(CONFIG.minIncrement * 100)} over the standing bid)` : ' — the ask');
  $('modal-note').textContent = z.priced
    ? 'This zone is part of the $135,000 that buys the car.'
    : 'XS zones go to running costs — fuel, wrap, wash. They sit outside the $135,000.';
  const amt = $('f-amount');
  amt.value = min; amt.min = min; amt.step = CONFIG.minIncrement;
  pendingLogo = '';
  $('preview').innerHTML = '<span class="rowsub">No artwork yet</span>';
  hideErr();
  $('modal').classList.add('open');
  $('f-name').focus();
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
  r.onload = () => { pendingLogo = r.result; $('preview').innerHTML = `<img src="${pendingLogo}" alt="artwork preview">`; };
  r.readAsDataURL(f);
}

async function submitBid(e) {
  e.preventDefault();
  hideErr();
  const name = $('f-name').value.trim();
  const email = $('f-email').value.trim().toLowerCase();
  const brand = $('f-brand').value.trim();
  const url = $('f-url').value.trim();
  const amt = parseFloat($('f-amount').value);
  const min = minFor(activeZone);

  if (name.length < 2) return showErr('Your name, please.');
  if (!/^\S+@\S+\.\S+$/.test(email)) return showErr('That email address does not look right.');
  if (!brand) return showErr('Which brand goes on the car?');
  if (!Number.isFinite(amt) || amt < min) return showErr(`Minimum bid is ${fmt(min * 100)}.`);
  if (!pendingLogo) return showErr('Upload the artwork — it goes straight onto the car.');

  const btn = $('submit-btn');
  btn.disabled = true; btn.textContent = 'Placing…';
  try {
    let logoUrl = pendingLogo;
    if (useSupa) {
      const file = $('f-file').files[0];
      if (file) {
        const path = `logos/${Date.now()}-${file.name.replace(/[^\w.-]/g, '_')}`;
        const up = await supa.storage.from('logos').upload(path, file);
        if (up.error) throw new Error(up.error.message);
        logoUrl = supa.storage.from('logos').getPublicUrl(path).data.publicUrl;
      }
      const { error } = await supa.rpc('place_bid', {
        p_spot_id: activeZone.id, p_bidder_name: name, p_bidder_email: email,
        p_brand_name: brand, p_brand_url: url, p_logo_url: logoUrl, p_amount_cents: Math.round(amt * 100),
      });
      if (error) throw new Error(error.message);
      await load();
    } else {
      const outbid = bids.filter(b => b.spot_id === activeZone.id && b.status === 'active');
      outbid.forEach(b => { b.status = 'outbid'; });
      bids.unshift({
        id: Math.random().toString(36).slice(2), spot_id: activeZone.id,
        bidder_name: name, bidder_email: email, brand_name: brand, brand_url: url,
        logo_url: logoUrl, amount_cents: Math.round(amt * 100),
        status: 'active', created_at: new Date().toISOString(),
      });
      saveLocal();
      renderAll();
    }
    for (const b of bids.filter(b => b.spot_id === activeZone.id && b.status === 'outbid')) {
      notifyOutbid(b.spot_id, b.bidder_email);
    }
    closeModal();
  } catch (err) {
    showErr(err.message || 'Something went wrong placing that bid.');
  } finally {
    btn.disabled = false; btn.textContent = 'Place bid';
  }
}

function notifyOutbid(spotId, email) {
  if (!email) return;
  fetch('/api/notify', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ spot_id: spotId, email }),
  }).catch(() => { /* the auction does not stop because an email did not send */ });
}
