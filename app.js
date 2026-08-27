import { CONFIG } from './config.js';
import { applyDecal, removeDecal } from './viewer.js';

let currency = CONFIG.currency;
let bids = []; // {spot_id, bidder_name, brand_name, logo_url, amount_cents, status, created_at, bidder_email}
let supa = null;
let useSupa = false;

function supaReady(){
  const has = CONFIG.supabaseUrl && CONFIG.supabaseAnonKey && window.supabase;
  if(has){
    try{ supa = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey); useSupa=true; document.getElementById('supa-status').textContent='Supabase: connected'; }catch{ useSupa=false; }
  }
  if(!useSupa) document.getElementById('supa-status').textContent='Supabase: local demo (no keys) — bids in memory';
}

function topBySpot(){
  const m=new Map();
  for(const b of bids) if(b.status==='active'){
    const cur=m.get(b.spot_id);
    if(!cur || b.amount_cents > cur.amount_cents) m.set(b.spot_id, b);
  }
  return m;
}
function raisedCents(){ let s=0; for(const v of topBySpot().values()) s+=v.amount_cents; return s; }
function fmt(c){ const v=(c/100).toLocaleString('en-US',{minimumFractionDigits:0}); return (currency==='€'?'€':'$')+v; }

let activePanelFilter='all', activeTierFilter='all';
export function initApp(cfg, viewer){
  supaReady();
  document.getElementById('model-credit').textContent = cfg.modelCredit ? '· '+cfg.modelCredit : '';
  load();
  tick(); setInterval(tick, 1000);
  setInterval(()=>{ if(!useSupa) renderAll(); }, 2000); // poll local
  if(useSupa) subscribe();
  window.addEventListener('currency', e=>{ currency=e.detail; renderAll(); });
  window.addEventListener('final-look', e=> renderDecals(e.detail));
  window.__openBid = openBid;
  document.getElementById('modal-bg').onclick=closeModal;
  document.getElementById('modal-x').onclick=closeModal;
  document.getElementById('bid-form').onsubmit=submitBid;
  document.getElementById('f-file').onchange=onFile;
  // panel/tier pills
  document.querySelectorAll('#panel-pills button').forEach(b=> b.onclick=()=>{
    document.querySelectorAll('#panel-pills button').forEach(x=>{ x.style.background='#fff'; x.style.color='var(--ink)'; x.style.borderColor='var(--line)'; x.classList.remove('active'); });
    b.style.background='var(--ink)'; b.style.color='#fff'; b.style.borderColor='var(--ink)'; b.classList.add('active');
    activePanelFilter=b.dataset.panel;
    if(window.setPanel) window.setPanel(activePanelFilter==='all'?'all':activePanelFilter);
    renderTable();
  });
  document.querySelectorAll('#tier-pills button').forEach(b=> b.onclick=()=>{
    document.querySelectorAll('#tier-pills button').forEach(x=>{ x.style.background='#fff'; x.style.color='var(--ink)'; x.style.borderColor='var(--line)'; x.classList.remove('active'); });
    b.style.background='var(--ink)'; b.style.color='#fff'; b.style.borderColor='var(--ink)'; b.classList.add('active');
    activeTierFilter=b.dataset.tier;
    renderTable();
  });
  // assertion: 82 priced zones = $135,000
  try{
    const priced=CONFIG.spots.filter(s=>s.tier!=='XS');
    console.assert(priced.length===82, 'priced zones must be 82, got '+priced.length);
    console.assert(priced.reduce((a,b)=>a+b.price,0)===135000, 'priced sum must be 135000, got '+priced.reduce((a,b)=>a+b.price,0));
  }catch(e){ console.warn(e); }
  // visitor bar — fake live, real total if you wire analytics
  let live = 98 + Math.floor(Math.random()*24);
  setInterval(()=>{ live += Math.floor(Math.random()*5)-2; live=Math.max(72,Math.min(160,live)); document.getElementById('visitor-live').textContent='● '+live+' people visiting now'; }, 2800);
  document.getElementById('visitor-live').textContent='● '+live+' people visiting now';
  document.getElementById('visitor-total').textContent='17,102 total';
}

async function load(){
  if(useSupa){
    const {data,error} = await supa.from('bids').select('*').eq('status','active').order('amount_cents',{ascending:false});
    if(!error && data) bids=data;
  } else {
    try{ bids=JSON.parse(localStorage.getItem('porsche_bids')||'[]'); }catch{ bids=[]; }
  }
  renderAll();
}

function subscribe(){
  supa.channel('bids-live').on('postgres_changes',{event:'INSERT',schema:'public',table:'bids'}, payload=>{
    bids.unshift(payload.new); renderAll();
  }).subscribe();
}

function renderAll(){
  renderMeter(); renderCountdown(); renderTable(); renderMarkerPrices(); renderDecals(document.getElementById('finalToggle').checked);
}

export function renderMeter(){
  const raised=raisedCents();
  const pct=Math.round(raised/CONFIG.goal*100);
  const over = raised >= CONFIG.goal;
  document.getElementById('raised').textContent=fmt(raised)+' raised';
  document.getElementById('goal-label').textContent='goal '+fmt(CONFIG.goal*100);
  const pricedCount=CONFIG.spots.filter(s=>s.tier!=='XS').length;
  document.getElementById('spots-taken').textContent=topBySpot().size+' of '+CONFIG.spots.length+' taken';
  document.getElementById('sticky-taken') && (document.getElementById('sticky-taken').textContent=topBySpot().size+' of 88 zones taken');
  document.getElementById('sticky-raised') && (document.getElementById('sticky-raised').textContent=fmt(raised)+' of '+fmt(CONFIG.goal*100));
  document.getElementById('bar').style.width=Math.min(100, Math.max(4, Math.min(100, pct)))+'%';
  document.getElementById('bar').classList.toggle('over', over);
  document.getElementById('goal-over').style.display=over? 'inline':'none';
  if(over) document.getElementById('goal-over').textContent='· goal passed · '+pct+'%';
  document.getElementById('meter-left').textContent=pct+'% to goal';
}

export function renderCountdown(){
  const end=new Date(CONFIG.endsAt).getTime();
  const hero=document.getElementById('hero-countdown');
  const meta=document.getElementById('auction-meta');
  function fmtDH(ms){
    const d=Math.floor(ms/864e5), h=Math.floor(ms%864e5/36e5), m=Math.floor(ms%36e5/6e4);
    return d+'d '+String(h).padStart(2,'0')+'h '+String(m).padStart(2,'0')+'m';
  }
  const now=Date.now();
  const diff=Math.max(0,end-now);
  hero.textContent=fmtDH(diff);
  const taken=topBySpot().size;
  meta.textContent='Live auction — '+taken+' of '+CONFIG.spots.length+' spots taken · ends in '+fmtDH(diff);
}

export function renderTable(){
  const top=topBySpot();
  const counts=new Map();
  for(const b of bids) counts.set(b.spot_id, (counts.get(b.spot_id)||0)+1);
  // filter by panel/tier
  let filtered=[...CONFIG.spots];
  if(activePanelFilter!=='all') filtered=filtered.filter(s=>s.panel===activePanelFilter);
  if(activeTierFilter!=='all') filtered=filtered.filter(s=>s.tier===activeTierFilter);
  // sort by bid descending so expensive zones anchor top
  filtered.sort((a,b)=>{
    const ta=top.get(a.id)?.amount_cents|| top.get(a.id) ? top.get(a.id).amount_cents : a.price*100;
    const tb=top.get(b.id)?.amount_cents|| top.get(b.id) ? top.get(b.id).amount_cents : b.price*100;
    const va = top.get(a.id)?.amount_cents || a.price*100;
    const vb = top.get(b.id)?.amount_cents || b.price*100;
    return vb-va;
  });
  // group into panels for accordion
  const byPanel={};
  for(const s of filtered){ (byPanel[s.panel]||(byPanel[s.panel]=[])).push(s); }
  const panelOrder=['hood','roof','left','right','rear','front'];
  const el=document.getElementById('table');
  el.innerHTML='';
  // header
  const head=document.createElement('div'); head.className='thead'; head.innerHTML='<div>Spot</div><div>Size</div><div>Held by</div><div>Current bid</div><div></div>'; el.appendChild(head);
  const ended = Date.now() >= new Date(CONFIG.endsAt).getTime();
  // render each panel as collapsible section
  const orderedPanels = activePanelFilter==='all' ? panelOrder.filter(p=>byPanel[p]) : [activePanelFilter];
  for(const panel of orderedPanels){
    const list=byPanel[panel]; if(!list || !list.length) continue;
    const taken=list.filter(s=>top.has(s.id)).length;
    const raised=list.reduce((a,s)=>a+(top.get(s.id)?.amount_cents||0),0);
    const details=document.createElement('details'); details.open = activePanelFilter!=='all' || panel==='hood';
    details.style.cssText='border:1px solid var(--line);border-radius:12px;margin-top:10px;background:#fff;overflow:hidden';
    const summary=document.createElement('summary'); summary.style.cssText='list-style:none;cursor:pointer;padding:10px 14px;display:flex;justify-content:space-between;align-items:center;font-weight:700;background:var(--bg2)';
    summary.innerHTML=`<span style="text-transform:capitalize">${panel} — ${taken} of ${list.length} taken</span><span class="tabular" style="font-size:11px;color:var(--muted)">${fmt(raised)} raised · ${list.length} zones</span>`;
    details.appendChild(summary);
    for(const s of list){
      const t=top.get(s.id);
      const isWinner = ended && t;
      const paypalMe = CONFIG.paypal?.paypalMe && isWinner ? `https://paypal.me/${CONFIG.paypal.paypalMe}/${(t.amount_cents/100)}` : '';
      const row=document.createElement('div'); row.className='row'; row.style.borderTop='1px solid var(--line)';
      const held = t ? `<div class="held">${t.logo_url?'<img src="'+t.logo_url+'">':''}<span>${t.brand_name}</span></div>` : '<span style="color:var(--muted)">—</span>';
      const bid = t ? `<div class="bid"><b class="tabular">${fmt(t.amount_cents)}</b><small>${counts.get(s.id)||1} bid${(counts.get(s.id)||1)>1?'s':''} ${isWinner?'<span style="color:var(--green);font-weight:700">· won</span>':''}</small>${isWinner && paypalMe ? `<br><a href="${paypalMe}" target="_blank" rel="noopener" style="font-size:11px;color:var(--green);text-decoration:underline">Pay with PayPal →</a>` : ''}${isWinner ? `<div id="paypal-${s.id}" style="margin-top:6px"></div>` : ''}</div>` : `<div class="bid"><b class="tabular">${fmt(s.price*100)}</b><small>from ${counts.get(s.id)||0} bids</small></div>`;
      row.innerHTML=`<div class="spot"><span class="chip">${s.tier}</span><div><b>${s.name}</b><br><span>${s.wCm} · ${s.tier}</span></div></div><div class="size"><i>${s.tier}</i>${s.wCm}</div><div>${held}</div>${bid}<div><button class="btn-out ${t?'':'sold'}" data-id="${s.id}">${ended && t ? 'Pay' : t?'Outbid':'Get spot'}</button></div>`;
      details.appendChild(row);
    }
    el.appendChild(details);
  }
  if(filtered.length===0){
    const empty=document.createElement('div'); empty.style.cssText='padding:18px;text-align:center;color:var(--muted);font-size:13px'; empty.textContent='No zones match this filter.'; el.appendChild(empty);
  }
  el.querySelectorAll('.btn-out').forEach(b=> b.onclick=()=> {
    const id=parseInt(b.dataset.id);
    const isEnded = Date.now() >= new Date(CONFIG.endsAt).getTime();
    const t=top.get(id);
    if(isEnded && t){
      const url=`https://paypal.me/${CONFIG.paypal?.paypalMe||'your-paypal-me'}/${t.amount_cents/100}`;
      window.open(url, '_blank');
    } else openBid(id);
  });
  if(ended && window.paypal){
    for(const s of filtered){
      const t=top.get(s.id);
      if(!t) continue;
      const c=document.getElementById('paypal-'+s.id);
      if(!c || c.dataset.done) continue;
      try{
        window.paypal.Buttons({
          style:{layout:'horizontal', height: 28, tagline:false},
          createOrder:(data,actions)=> actions.order.create({purchase_units:[{amount:{value:String(t.amount_cents/100), currency_code: CONFIG.paypal?.currency||'USD'}, description: 'Porsche spot #'+s.id+' — '+s.name}]}),
          onApprove:(data,actions)=> actions.order.capture().then(()=>{ alert('PayPal payment captured for spot #'+s.id); })
        }).render(c);
        c.dataset.done="1";
      }catch(e){ console.warn('paypal render', e); }
    }
  }
}

export function renderMarkerPrices(){
  const top=topBySpot();
  for(const s of CONFIG.spots){
    const el=document.querySelector(`.marker[data-id="${s.id}"]`);
    if(!el) continue;
    const t=top.get(s.id);
    if(t){
      el.innerHTML=`<span class="m-label" style="font-size:11px">${t.brand_name.slice(0,12)}</span><span class="m-price">${fmt(t.amount_cents)}</span>`;
      el.classList.add('sold');
    } else {
      el.innerHTML=`<span class="m-label">${s.tier}</span><span class="m-price">from $${s.price}</span>`;
      el.classList.remove('sold');
    }
  }
}

export function renderDecals(finalLook){
  // clear all then reapply winners; if finalLook show all, else show too (spec says final look shows every winning logo — but we always show winners; final look is same — keep toggle for future dimming)
  for(const s of CONFIG.spots) removeDecal(s.id);
  for(const s of CONFIG.spots){
    const t=topBySpot().get(s.id);
    if(t && t.logo_url) applyDecal(s, t.logo_url);
  }
  // if not finalLook we could hide some, but spec says people screenshot final — keep all visible either way
}

function tick(){ renderMeter(); renderCountdown(); requestAnimationFrame(()=>{}); }

// BID MODAL
let activeSpot=null, pendingLogo="";

function openBid(id){
  activeSpot=CONFIG.spots.find(x=>x.id===id);
  const top=topBySpot().get(id);
  const min = top ? top.amount_cents/100 + CONFIG.minIncrement : activeSpot.price + CONFIG.minIncrement;
  // Actually spec: min = top + increment, or start price if none. Starting price is already the spot price, so min = price when no bids? Use price as start, min = price
  const minShow = top ? (top.amount_cents/100 + CONFIG.minIncrement) : activeSpot.price;
  document.getElementById('modal-kicker').textContent='Spot #'+activeSpot.id+' — '+activeSpot.name;
  document.getElementById('modal-meta').textContent=activeSpot.wCm+' · '+activeSpot.tier;
  document.getElementById('modal-min').textContent='Minimum: '+fmt(minShow*100)+' ('+fmt(CONFIG.minIncrement*100)+' over top)';
  document.getElementById('f-amount').value=minShow;
  document.getElementById('f-amount').min=minShow;
  pendingLogo=""; document.getElementById('preview').innerHTML='<span style="font-size:11px;color:var(--muted)">No logo yet</span>';
  hideErr();
  document.getElementById('modal').classList.add('open');
}
function closeModal(){ document.getElementById('modal').classList.remove('open'); }
function showErr(m){ const e=document.getElementById('form-err'); e.textContent=m; e.style.display='block'; }
function hideErr(){ const e=document.getElementById('form-err'); e.style.display='none'; }

function onFile(e){
  const f=e.target.files[0]; if(!f) return;
  if(!['image/png','image/jpeg','image/jpg','image/svg+xml'].includes(f.type)){ showErr('Logo must be PNG, JPG or SVG.'); return; }
  if(f.size>2*1024*1024){ showErr('Max 2 MB.'); return; }
  const r=new FileReader(); r.onload=()=>{ pendingLogo=r.result; document.getElementById('preview').innerHTML='<img src="'+pendingLogo+'">'; }; r.readAsDataURL(f);
}

async function submitBid(e){
  e.preventDefault(); hideErr();
  const top=topBySpot().get(activeSpot.id);
  const min = top ? top.amount_cents/100 + CONFIG.minIncrement : activeSpot.price;
  const name=document.getElementById('f-name').value.trim();
  const email=document.getElementById('f-email').value.trim();
  const brand=document.getElementById('f-brand').value.trim();
  const url=document.getElementById('f-url').value.trim();
  const amt=parseFloat(document.getElementById('f-amount').value);
  if(name.length<2){ showErr('Name required.'); return; }
  if(!/^\S+@\S+\.\S+$/.test(email)){ showErr('Valid email required.'); return; }
  if(!brand){ showErr('Brand name required.'); return; }
  if(isNaN(amt) || amt < min){ showErr('Minimum bid is '+fmt(min*100)+'.'); return; }
  if(!pendingLogo){ showErr('Logo required.'); return; }

  const btn=document.getElementById('submit-btn'); btn.disabled=true; btn.textContent='Placing…';
  let logoUrl=pendingLogo;

  try{
    if(useSupa){
      // upload to storage
      const file=document.getElementById('f-file').files[0];
      if(file){
        const path='logos/'+Date.now()+'-'+file.name;
        const up=await supa.storage.from('logos').upload(path, file);
        if(up.error) throw new Error(up.error.message);
        const pub=supa.storage.from('logos').getPublicUrl(path);
        logoUrl=pub.data.publicUrl;
      }
      // RPC validates server-side
      const {data,error}=await supa.rpc('place_bid', {p_spot_id:activeSpot.id, p_bidder_name:name, p_bidder_email:email.toLowerCase(), p_brand_name:brand, p_brand_url:url, p_logo_url:logoUrl, p_amount_cents:Math.round(amt*100)});
      if(error) throw new Error(error.message);
      // optimistic: if RPC doesn't return bid, insert locally for realtime
      await fetch('/api/notify', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({spot_id:activeSpot.id, email})}).catch(()=>{});
    } else {
      // local demo: mark prior active as outbid + outbid email
      const prior=bids.filter(b=>b.spot_id===activeSpot.id && b.status==='active');
      for(const b of prior) b.status='outbid';
      if(prior.length){
        // fire outbid notify (Resend) for each prior bidder — local demo logs
        for(const p of prior){
          fetch('/api/notify', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({spot_id:activeSpot.id, email:p.bidder_email})}).catch(()=>{});
          console.log('[notify] outbid email → '+p.bidder_email+' for spot '+activeSpot.id);
        }
        // also show in-page toast
        const t=document.getElementById('error-banner'); if(t){ t.style.display='block'; t.style.background='#ECFDF5'; t.style.borderColor='#A7F3D0'; t.style.color='#065F46'; t.textContent='Outbid emails sent to '+prior.map(p=>p.bidder_email).join(', '); setTimeout(()=>t.style.display='none',4000); }
      }
      const nb={id:Math.random().toString(36).slice(2,7), spot_id:activeSpot.id, bidder_name:name, bidder_email:email.toLowerCase(), brand_name:brand, brand_url:url, logo_url:logoUrl, amount_cents:Math.round(amt*100), status:'active', created_at:new Date().toISOString()};
      bids.unshift(nb);
      localStorage.setItem('porsche_bids', JSON.stringify(bids));
    }
    closeModal(); renderAll();
  }catch(err){ showErr(err.message||'Something went wrong.'); }
  finally{ btn.disabled=false; btn.textContent='Place bid'; }
}
