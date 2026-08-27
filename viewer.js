// viewer.js — three.js stage, markers, decals
// DEBUG_PICK: set window.DEBUG_PICK = true in console, then click the model to log pos/normal
// Markers are plain DIVs reprojected each frame; decals are PlaneGeometry textured with logos.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

window.DEBUG_PICK = false;

let scene, camera, renderer, controls, modelRoot, raycaster, pointer, decals=new Map(), markerEls=new Map(), config, onMarkerClick, stageEl, autoRotateSpeed=0.5, hasInteracted=false, floor, animId;

export function initViewer(stage, cfg, clickCb){
  stageEl=stage; config=cfg; onMarkerClick=clickCb;
  window.__stage = stage;
  scene=new THREE.Scene();
  scene.background=new THREE.Color(0x0B0E14);
  camera=new THREE.PerspectiveCamera(42, stage.clientWidth/stage.clientHeight, 0.1, 100);
  camera.position.set(3.2, 1.6, 3.4);
  const isMobile = /iPhone|iPad|Android/i.test(navigator.userAgent) || stage.clientWidth < 560;
  renderer=new THREE.WebGLRenderer({antialias:true, alpha:false, powerPreference: isMobile ? 'low-power' : 'high-performance'});
  renderer.setPixelRatio(Math.min(devicePixelRatio, isMobile ? 1 : 2));
  renderer.setSize(stage.clientWidth, stage.clientHeight);
  renderer.shadowMap.enabled=true;
  renderer.shadowMap.type= isMobile ? THREE.BasicShadowMap : THREE.PCFSoftShadowMap;
  if(isMobile) renderer.shadowMap.enabled=false; // cap draw calls — 60fps hard req
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  stage.prepend(renderer.domElement);

  // lighting — studio
  scene.add(new THREE.HemisphereLight(0xffffff, 0xE8E6E1, .65));
  const key=new THREE.DirectionalLight(0xffffff, 1.25);
  key.position.set(5,8,4); key.castShadow=true;
  key.shadow.mapSize.set(2048,2048);
  key.shadow.camera.near=0.5; key.shadow.camera.far=22;
  key.shadow.camera.left=-6; key.shadow.camera.right=6; key.shadow.camera.top=6; key.shadow.camera.bottom=-6;
  key.shadow.bias=-0.0005;
  scene.add(key);
  const rim=new THREE.DirectionalLight(0xE8FF4A, .35);
  rim.position.set(-4,3,-5); scene.add(rim);
  const fill=new THREE.DirectionalLight(0xffffff, .35); fill.position.set(-3,4,3); scene.add(fill);

  // floor receives shadow
  const fg=new THREE.PlaneGeometry(22,22);
  const fm=new THREE.ShadowMaterial({opacity:.14});
  floor=new THREE.Mesh(fg,fm); floor.rotation.x=-Math.PI/2; floor.position.y=-0.95; floor.receiveShadow=true; scene.add(floor);
  const grid=new THREE.GridHelper(22,22,0xE8E6E1,0xE8E6E1); grid.position.y=-0.94; scene.add(grid);

  controls=new OrbitControls(camera, renderer.domElement);
  controls.enableDamping=true; controls.dampingFactor=0.06;
  controls.enablePan=false;
  controls.minDistance=1.2; controls.maxDistance=7.5;
  controls.maxPolarAngle=Math.PI/2 - 0.06;
  controls.target.set(0,0.25,0);

  raycaster=new THREE.Raycaster(); pointer=new THREE.Vector2();

  // model
  function buildFallback(){
    if(modelRoot) return;
    console.warn('[viewer] building procedural fallback');
    modelRoot=new THREE.Group();
    const body=new THREE.Mesh(new THREE.BoxGeometry(2.2,0.55,4.4), new THREE.MeshStandardMaterial({color:0xE53935, roughness:.35, metalness:.15}));
    body.position.y=0.15; body.castShadow=true; body.receiveShadow=true; modelRoot.add(body);
    const roof=new THREE.Mesh(new THREE.BoxGeometry(1.15,0.45,1.6), new THREE.MeshStandardMaterial({color:0x111, roughness:.5}));
    roof.position.set(0,0.62,-0.15); roof.castShadow=true; modelRoot.add(roof);
    for(const w of [[-1, -0.2],[1,-0.2],[-1,1.1],[1,1.1]]){
      const wh=new THREE.Mesh(new THREE.CylinderGeometry(0.34,0.34,0.22,20), new THREE.MeshStandardMaterial({color:0x111, roughness:.8}));
      wh.rotation.z=Math.PI/2; wh.position.set(w[0], -0.38, w[1]); wh.castShadow=true; modelRoot.add(wh);
    }
    modelRoot.scale.setScalar(config.modelScale); modelRoot.position.y=config.modelYOffset||0;
    scene.add(modelRoot);
    const ld=document.getElementById('model-status'); if(ld) ld.textContent='Showing fallback — model failed to load';
  }
  const loader=new GLTFLoader();
  let fallbackTimer=setTimeout(buildFallback, 4500);
  loader.load(config.modelUrl, gltf=>{
    clearTimeout(fallbackTimer);
    modelRoot=gltf.scene;
    modelRoot.scale.setScalar(config.modelScale);
    modelRoot.rotation.y=THREE.MathUtils.degToRad(config.modelRotationY||0);
    modelRoot.position.y=config.modelYOffset||0;
    modelRoot.traverse(o=>{ if(o.isMesh){ o.castShadow=true; o.receiveShadow=true; if(o.material) o.material.needsUpdate=true; }});
    // center model
    const box=new THREE.Box3().setFromObject(modelRoot);
    const center=box.getCenter(new THREE.Vector3());
    modelRoot.position.sub(center); modelRoot.position.y+=config.modelYOffset||0;
    scene.add(modelRoot);
    const ld=document.getElementById('model-status'); if(ld) ld.textContent='Model loaded';
    console.log('[viewer] model loaded');
  }, xhr=>{
    const ld=document.getElementById('model-status'); if(ld && xhr.total) ld.textContent='Loading model ' + Math.round(xhr.loaded/xhr.total*100)+'%';
  }, err=>{
    clearTimeout(fallbackTimer);
    console.error('[viewer] load error', err);
    buildFallback();
  });

  // markers container — exactly like screenshots: dashed rect, size + from price
  const markersEl=document.getElementById('markers');
  for(const s of config.spots){
    const el=document.createElement('button');
    el.className='marker';
    el.dataset.id=s.id;
    el.dataset.panel=s.panel;
    const sizeLabel = s.tier || s.size || s.wCm;
    el.innerHTML=`<span class="m-label">${sizeLabel}</span><span class="m-price">from $${s.price}</span>`;
    // size marker by spot w/h (scale to px) — keep roll for grid alignment
    const pw = Math.max(48, Math.min(160, (s.w||0.6)*88));
    const ph = Math.max(28, Math.min(120, (s.h||0.4)*88));
    el.style.width = pw+'px';
    el.style.height = ph+'px';
    if(s.roll) el.style.transform = `translate(-50%,-50%) rotate(${s.roll}deg)`;
    el.addEventListener('mouseenter', ()=>{ hoveredId=s.id; });
    el.addEventListener('mouseleave', ()=>{ if(hoveredId===s.id) hoveredId=null; });
    el.onclick=(e)=>{ e.stopPropagation(); onMarkerClick && onMarkerClick(s.id); };
    markersEl.appendChild(el);
    markerEls.set(s.id, el);
  }
  // prevent drag from opening bid: viewer click already handled via controls, not marker
  renderer.domElement.addEventListener('click', (e)=>{
    // if dragging (controls state) don't open modal — OrbitControls handles this, we just ensure marker click is only via marker element
  });

  // auto-rotate then stop on first pointerdown
  renderer.domElement.addEventListener('pointerdown', (e)=>{
    if(!hasInteracted){ hasInteracted=true; autoRotateSpeed=0; }
    if(window.DEBUG_PICK){
      const rect=renderer.domElement.getBoundingClientRect();
      const x=((e.clientX-rect.left)/rect.width)*2-1;
      const y=-((e.clientY-rect.top)/rect.height)*2+1;
      pointer.set(x,y); raycaster.setFromCamera(pointer,camera);
      const hits=modelRoot? raycaster.intersectObject(modelRoot,true):[];
      if(hits[0]){ const p=hits[0].point, n=hits[0].face.normal.clone().transformDirection(hits[0].object.matrixWorld).normalize(); console.log(`pos:[${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)}], normal:[${n.x.toFixed(2)},${n.y.toFixed(2)},${n.z.toFixed(2)}]`); }
    }
  });

  window.addEventListener('resize', ()=>{
    camera.aspect=stage.clientWidth/stage.clientHeight; camera.updateProjectionMatrix();
    renderer.setSize(stage.clientWidth, stage.clientHeight);
  });

  animate();
  return { scene, camera, renderer, controls };
}

function animate(){
  animId=requestAnimationFrame(animate);
  if(!hasInteracted && autoRotateSpeed){
    // slow orbit around target
    const t=Date.now()*0.00018*autoRotateSpeed;
    const r=Math.hypot(camera.position.x - controls.target.x, camera.position.z - controls.target.z);
    camera.position.x = controls.target.x + Math.cos(t)*r;
    camera.position.z = controls.target.z + Math.sin(t)*r;
  }
  controls.update();
  updateMarkers();
  renderer.render(scene,camera);
}

let activePanel='all';
let hoveredId=null;
export function setPanel(panel){ activePanel=panel; }
const panelNormals={ hood:[0,1,0.3], roof:[0,1,0], left:[-1,0.08,0], right:[1,0.08,0], rear:[0,0.12,-1], front:[0,0.10,1]};
function getFacingPanel(camDir){
  let best='roof', bestDot=-Infinity;
  for(const [k,n] of Object.entries(panelNormals)){
    const d=new THREE.Vector3(...n).normalize().dot(camDir.clone().negate());
    if(d>bestDot){ bestDot=d; best=k; }
  }
  return best;
}
function updateMarkers(){
  const camDir=new THREE.Vector3(); camera.getWorldDirection(camDir);
  // panel focus: non-focused at 0.18, sold & hovered always full
  const camDist=camera.position.distanceTo(controls.target);
  const facingPanel = activePanel==='free' || activePanel==='all' ? getFacingPanel(camDir) : activePanel;
  for(const s of config.spots){
    const el=markerEls.get(s.id);
    if(!el) continue;
    const wp=new THREE.Vector3(...s.pos);
    wp.project(camera);
    const x=(wp.x*0.5+0.5)*stageEl.clientWidth;
    const y=(-wp.y*0.5+0.5)*stageEl.clientHeight;
    const visible = wp.z < 1 && wp.z > -1;
    const n=new THREE.Vector3(...s.normal).normalize();
    const facing = n.dot(camDir.clone().negate());
    const hide = facing < 0.10;
    el.style.left=x+'px'; el.style.top=y+'px';
    // far-side ghost prevention
    const isSold = el.classList.contains('sold');
    const isHovered = hoveredId===s.id;
    let opacity = 1;
    if(!isSold && !isHovered){
      if(activePanel==='free' || activePanel==='all'){
        // free spin: dim non-facing panels
        const isFacingPanel = s.panel===facingPanel;
        opacity = isFacingPanel ? 1 : 0.18;
      } else {
        opacity = s.panel===activePanel ? 1 : 0.18;
      }
    }
    el.style.opacity = hide || !visible ? '0' : String(opacity);
    el.style.pointerEvents = (hide || !visible) ? 'none' : 'auto';
    // label degrade by projected screen height
    const dist = camera.position.distanceTo(new THREE.Vector3(...s.pos));
    const screenH = (s.h||0.3) * 820 / Math.max(0.8, dist);
    // zoom to reveal: if camDist <2.2 promote one tier
    const zoomed = camDist < 2.2;
    let mode='full';
    if(!isSold){
      if(screenH > 70) mode='full';
      else if(screenH > 40) mode = zoomed ? 'full' : 'letter';
      else mode = zoomed ? 'letter' : 'outline';
    } else mode='full';
    if(isHovered) mode='full';
    if(mode==='full'){ el.querySelector('.m-label') && (el.querySelector('.m-label').style.display=''); el.querySelector('.m-price') && (el.querySelector('.m-price').style.display=''); }
    else if(mode==='letter'){ el.querySelector('.m-label') && (el.querySelector('.m-label').style.display=''); el.querySelector('.m-price') && (el.querySelector('.m-price').style.display='none'); }
    else { el.querySelector('.m-label') && (el.querySelector('.m-label').style.display='none'); el.querySelector('.m-price') && (el.querySelector('.m-price').style.display='none'); }
    el.classList.toggle('hidden', !visible || hide);
  }
}

// view presets tweened 20 frames easeOutCubic
const views={
  top:{pos:[0,4.4,0.12], target:[0,0.45,0]},
  front:{pos:[0,0.85,3.8], target:[0,0.45,0.35]},
  left:{pos:[-3.8,0.85,0.15], target:[0,0.45,0]},
  right:{pos:[4.0,1.0,0.2], target:[0,0.25,0]},
  rear:{pos:[0,1.05,-4.0], target:[0,0.25,-0.55]},
  hood:{pos:[0,2.4,1.85], target:[0,0.55,1.25]},
};
export function setView(name){
  const v=views[name]; if(!v) return;
  const startPos=camera.position.clone(), startTar=controls.target.clone();
  const endPos=new THREE.Vector3(...v.pos), endTar=new THREE.Vector3(...v.target);
  let f=0; const ease=t=>1-Math.pow(1-t,3);
  function step(){
    f+=1/20; const t=ease(Math.min(1,f));
    camera.position.lerpVectors(startPos,endPos,t);
    controls.target.lerpVectors(startTar,endTar,t);
    if(f<1) requestAnimationFrame(step);
  }
  step();
}

export function applyDecal(spot, logoUrl){
  removeDecal(spot.id);
  const w=spot.w||0.7, h=spot.h||0.4;
  const geo=new THREE.PlaneGeometry(w,h);
  const tex=new THREE.TextureLoader().load(logoUrl);
  tex.colorSpace=THREE.SRGBColorSpace; tex.anisotropy=4;
  const mat=new THREE.MeshStandardMaterial({map:tex, transparent:true, depthWrite:false, polygonOffset:true, polygonOffsetFactor:-4, roughness:.65, metalness:.05, side:THREE.DoubleSide});
  const mesh=new THREE.Mesh(geo, mat);
  const pos=new THREE.Vector3(...spot.pos);
  const normal=new THREE.Vector3(...spot.normal).normalize();
  const p2=pos.clone().add(normal.clone().multiplyScalar(0.035));
  mesh.position.copy(p2);
  mesh.lookAt(pos.clone().add(normal));
  // keep upright: if normal is mostly up, rotate
  mesh.castShadow=false; mesh.receiveShadow=false;
  scene.add(mesh);
  decals.set(spot.id, mesh);
}
export function removeDecal(id){
  const m=decals.get(id); if(m){ scene.remove(m); if(m.material.map) m.material.map.dispose(); m.geometry.dispose(); m.material.dispose(); decals.delete(id); }
}
