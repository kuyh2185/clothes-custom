/* 고쳐 입기 — studio. A garment cut from a pattern (pattern.js) and hung on the mannequin as cloth (cloth.js, a
   worker). Every edit changes the pattern's numbers and the cloth moves to the new shape: drag the points on the
   garment (sleeve ends, hem, sides, neckline) or pick a card / move a bar in the panel — both change the same numbers.
   No baked garments and no shader cutting: what you see is the cloth. */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { smoothChest, tuckUnder } from './mannequin.js?v=1';
import { BASE, BASE_M } from './pattern.js?v=10';

const $ = id => document.getElementById(id);
const PI = Math.PI;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r1 = v => Math.round(v * 10) / 10;
const ASSET_VER = 2, KEY = 'clothes-custom:studio:v1';

/* ---------- the garment's numbers ---------- */
// sl: each sleeve as one number (cm of sleeve; below 0, cm the shoulder has narrowed toward a strap), L: length from
// the high shoulder point, ease: added to each quarter's width, flare: more at the hem, dNw: wider neck at the shoulder,
// ndF / ndB: neckline depth front / back, neckV: round 0 … V 1
const DEF_TOP = { sl: [20, 20], L: 62, ease: 0, flare: 0, dNw: 0, ndF: 10, ndB: 2.6, neckV: 0, c1: '#f3f1ec', c2: '#24324a', pat: 0, scale: 1 };
const DEF = { body: 'f', bottom: 'jeans', top: DEF_TOP };
let state = load() || structuredClone(DEF);
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && s.top) return { ...structuredClone(DEF), ...s, top: { ...DEF_TOP, ...s.top } };
  } catch (e) { /* none saved, or storage blocked */ }
  return null;
}
const base = () => state.body === 'm' ? BASE_M : BASE;
const shoulderOf = T => base().sw + Math.max(0, T.ease - 3) * .5;   // an oversized top's shoulder drops off the shoulder
const fullOf = T => shoulderOf(T) - (base().nw + T.dNw);   // the shoulder seam's length: how far a strap can narrow
// below the slim fit the top is cut smaller than the body from a knit that stretches round it (rib tank, fitted tee):
// the side seams follow the waist, the hem eases off less (narrower than the hips it rides up), the sleeves hug the arm
const tightOf = e => clamp(-e - 1.5, 0, 6.5);
function params() {
  const b = base(), T = state.top, full = fullOf(T), [l, r] = T.sl, t = tightOf(T.ease), e = T.ease;
  return {
    base: state.body, L: r1(T.L), sleeveL: r1(Math.max(0, l)), sleeveR: r1(Math.max(0, r)),
    strap: l < 1.2 && r < 1.2 && Math.min(l, r) < 0 ? r1(clamp(full + Math.min(l, r), .6, full)) : null,
    cw: r1(b.cw + T.ease), hw: r1(b.hw + (e > 0 ? e : e * .5) + T.flare), sw: r1(shoulderOf(T)), nw: r1(b.nw + T.dNw),
    ndF: r1(T.ndF), ndB: r1(T.ndB), neckV: r1(T.neckV),
    bw: r1(b.bw + (e > 0 ? e * .4 : e * .3)), cuff: r1(b.cuff + (e > 0 ? e * .3 : e * .2)),
    waist: r1(t * 1.35), stretch: Math.round(clamp(t / 2, 0, 1) * 100) / 100,
  };
}
const LIM = () => {
  const b = base(), full = fullOf(state.top);
  return { sl: [-(full - .6), b.arm + b.over], L: [b.ad + 6, 118], ease: [-8, 20], flare: [-4, 22], dNw: [-2, 8], ndF: [3, 30], ndB: [1.5, 26], neckV: [0, 1] };
};
function fix(T) {
  const L = LIM();
  T.sl = T.sl.map(v => clamp(v, ...L.sl));
  for (const k of ['L', 'ease', 'flare', 'dNw', 'ndF', 'ndB', 'neckV']) T[k] = clamp(T[k], ...L[k]);
}

/* ---------- names (panel labels, drag tip) ---------- */
function sleeveName(v) {
  const a = base().arm / 58;
  if (v < 0) return `끈 ${(fullOf(state.top) + v).toFixed(1)}cm`;
  if (v < 1.2) return '민소매';
  const n = v < 10 * a ? '캡' : v < 26 * a ? '반팔' : v < 39 * a ? '5부' : v < 51 * a ? '7부' : v < base().arm + 2 ? '긴팔' : '손 덮는 긴팔';
  return `${n} ${Math.round(v)}cm`;
}
const lenName = L => (L < 50 ? '크롭' : L < 70 ? '기본' : L < 86 ? '롱' : '원피스') + ` ${Math.round(L)}cm`;
const fitName = e => (e < -2.5 ? '밀착' : e < -.5 ? '슬림' : e < 2 ? '기본' : e < 6 ? '여유' : '오버') + ` ${e >= 0 ? '+' : ''}${e.toFixed(1)}cm`;

/* ---------- renderer, stage ---------- */
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const wrap = $('stage'), canvas = renderer.domElement;
canvas.setAttribute('aria-label', '옷을 입은 3D 마네킹 — 끌어서 돌려 보기');
wrap.appendChild(canvas);
const scene = new THREE.Scene();
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), .04).texture;
scene.environmentIntensity = .28;
// backdrop: a deep blue glow behind the figure fading to near black
scene.background = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const x = c.getContext('2d'), g = x.createRadialGradient(256, 230, 10, 256, 256, 400);
  g.addColorStop(0, '#22305a'); g.addColorStop(.45, '#0e1630'); g.addColorStop(1, '#03050b');
  x.fillStyle = g; x.fillRect(0, 0, 512, 512);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();
const camera = new THREE.PerspectiveCamera(26, 1, .05, 100);
const controls = new OrbitControls(camera, canvas);
controls.enablePan = false; controls.enableDamping = true; controls.dampingFactor = .09; controls.rotateSpeed = .75;
controls.minPolarAngle = PI * .3; controls.maxPolarAngle = PI * .56;
// a dark set lit from above, a cool and a warm light behind so the outline glows
scene.add(new THREE.HemisphereLight(0xaebfff, 0x0a0d18, .22));
const key = new THREE.DirectionalLight(0xfff1e4, 2.7);
key.position.set(-.9, 5.2, 2.8); key.castShadow = true; key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -2, right: 2, top: 2.6, bottom: -1.2, near: .5, far: 14 });
key.shadow.bias = -.0003; key.shadow.normalBias = .02; key.shadow.radius = 4;
key.target.position.set(0, .9, 0);
const fill = new THREE.DirectionalLight(0xb8c6ff, .3); fill.position.set(3, 2.2, 3);
const rim = new THREE.DirectionalLight(0x86a8ff, 4.6); rim.position.set(-2.3, 2.6, -3.2);
const rim2 = new THREE.DirectionalLight(0xffc49a, 3.4); rim2.position.set(2.4, 2.8, -3);
scene.add(key, key.target, fill, rim, rim2);
// the plate, a pool of light on the floor and a glowing ring round the plate (the ring is what blooms)
const plate = new THREE.Mesh(new THREE.CylinderGeometry(.31, .32, .025, 96), new THREE.MeshPhysicalMaterial({ color: '#1a2036', roughness: .35, metalness: .2, clearcoat: .6 }));
plate.position.y = -.0125; plate.receiveShadow = true;
const pool = new THREE.Mesh(new THREE.CircleGeometry(2.4, 96), new THREE.MeshBasicMaterial({
  map: (() => {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const x = c.getContext('2d'), g = x.createRadialGradient(128, 128, 0, 128, 128, 128);
    g.addColorStop(0, 'rgba(205,220,255,.55)'); g.addColorStop(.18, 'rgba(150,175,255,.3)'); g.addColorStop(.5, 'rgba(70,95,190,.1)'); g.addColorStop(1, 'rgba(40,60,140,0)');
    x.fillStyle = g; x.fillRect(0, 0, 256, 256);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })(),
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
}));
pool.rotation.x = -PI / 2; pool.position.y = -.024;
const ring = new THREE.Mesh(new THREE.TorusGeometry(.318, .0035, 8, 160), new THREE.MeshBasicMaterial({ color: new THREE.Color('#bcd0ff').multiplyScalar(5) }));
ring.rotation.x = -PI / 2; ring.position.y = -.004;
scene.add(plate, pool, ring);
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), .55, .5, 2.4));
composer.addPass(new OutputPass());

// the figure sits in the open part of the stage between the two panels
let shiftX = 0, H = 1.78, needs = true;
function fit(keepDir = true) {
  const r = wrap.getBoundingClientRect(), w = Math.max(1, r.width), h = Math.max(1, r.height);
  renderer.setSize(w, h, false); composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(w, h);
  camera.aspect = w / h;
  const css = getComputedStyle(document.documentElement), wl = parseFloat(css.getPropertyValue('--wl')), wr = parseFloat(css.getPropertyValue('--wr'));
  shiftX = (wl - wr) / 2;
  camera.setViewOffset(w, h, -shiftX, 0, w, h);
  camera.updateProjectionMatrix();
  const t = Math.tan(camera.fov * PI / 360), d = Math.max((H * .5 + .28) / t, .55 / (t * camera.aspect));
  controls.target.set(0, H * .5, 0);
  const dir = keepDir ? camera.position.clone().sub(controls.target).setY(0) : new THREE.Vector3();
  if (dir.length() < .5) dir.set(0, 0, 1);
  dir.normalize();
  camera.position.copy(controls.target).addScaledVector(dir, d);
  camera.position.y = H * .46;
  controls.minDistance = d * .3; controls.maxDistance = d * 1.4;
  controls.update();
  needs = true;
}
new ResizeObserver(() => fit()).observe(wrap);
controls.addEventListener('change', () => { needs = true; });

/* ---------- mannequin ---------- */
const draco = new DRACOLoader().setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/libs/draco/gltf/');
const loader = new GLTFLoader().setDRACOLoader(draco);
const BODIES = {};
let A = null;   // the shown body: { root, meshes, H, kind, hps, z0, bones }
async function loadBody(kind) {
  if (BODIES[kind]) return BODIES[kind];
  const g = await loader.loadAsync(`assets/studio_${kind}.glb?v=${ASSET_VER}`);
  const root = g.scene, meshes = {};
  root.traverse(o => { if (o.isMesh) { meshes[o.name] = o; o.castShadow = o.receiveShadow = true; o.frustumCulled = false; } });
  for (const [n, m] of Object.entries(meshes)) m.visible = n === 'body' || n === 'jeans' || n === 'shoes';
  const body = meshes.body, h = new THREE.Box3().setFromObject(body).max.y;
  smoothChest(body.geometry, h);   // a mannequin: no nipples
  // the pristine surface (for no trousers) and one tucked a little under the trousers' outline
  const bare = body.geometry.attributes.position.array.slice();
  tuckUnder(body.geometry, 'jeans');
  const tucked = body.geometry.attributes.position.array.slice();
  body.material = new THREE.MeshPhysicalMaterial({ color: '#d4ad97', roughness: .5, clearcoat: .05, sheen: .5, sheenColor: new THREE.Color('#ffc9b0'), sheenRoughness: .6 });
  if (meshes.jeans) {   // plain denim: the asset's distressed texture has see-through rips
    const j = meshes.jeans.material;
    meshes.jeans.material = new THREE.MeshPhysicalMaterial({ color: '#3a5679', roughness: .88, normalMap: j.normalMap || null, sheen: .3, sheenColor: new THREE.Color('#9fb6d6'), side: THREE.DoubleSide });
  }
  root.updateMatrixWorld(true);
  const P = body.geometry.attributes.position, s = h / 1.77;
  let hps = 0;
  const zs = [];
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
    if (Math.abs(x - .075 * s) < .008 && Math.abs(z) < .06 && y > 1.38 * s && y < 1.56 * s) hps = Math.max(hps, y);
  }
  for (let i = 0; i < P.count; i++) if (Math.abs(P.getX(i)) < .12 && Math.abs(P.getY(i) - (hps - .2 * s)) < .02) zs.push(P.getZ(i));
  const sk = body.skeleton, bp = n => sk.getBoneByName(n).getWorldPosition(new THREE.Vector3()).toArray();
  const bones = { l: [bp('upperarm_l'), bp('lowerarm_l'), bp('hand_l')], r: [bp('upperarm_r'), bp('lowerarm_r'), bp('hand_r')] };
  return (BODIES[kind] = { root, meshes, H: h, kind, hps, z0: (Math.min(...zs) + Math.max(...zs)) / 2, bones, bare, tucked });
}
const world = mesh => {   // rest pose = bind pose = world here (the asset's root has no transform)
  const P = mesh.geometry.attributes.position, N = mesh.geometry.attributes.normal;
  return { pos: new Float32Array(P.array), nrm: new Float32Array(N.array) };
};

/* ---------- the cloth ---------- */
const worker = new Worker('cloth.js?v=23', { type: 'module' });
worker.onerror = e => console.error('[cloth]', e.message);
const fabricU = { uC1: { value: new THREE.Color() }, uC2: { value: new THREE.Color() }, uPat: { value: 0 }, uScale: { value: 1 } };
const fabric = new THREE.MeshPhysicalMaterial({ roughness: .86, sheen: .6, sheenRoughness: .8, side: THREE.DoubleSide });
fabric.onBeforeCompile = sh => {
  Object.assign(sh.uniforms, fabricU);
  sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 pat; varying vec2 vPat;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPat = pat;');
  // colour and print follow the fabric's grain (the flat pattern), so stripes run round the body and across a sleeve
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vPat; uniform vec3 uC1; uniform vec3 uC2; uniform float uPat; uniform float uScale;')
    .replace('#include <map_fragment>', `#include <map_fragment>
vec3 base = uC1;
vec2 q = vPat / uScale;
if (uPat > .5 && uPat < 1.5) { if (fract(q.y / .05) < .4) base = uC2; }
else if (uPat > 1.5 && uPat < 2.5) { float b = step(fract(q.y / .06), .42) + step(fract(q.x / .06), .42); base = mix(uC1, uC2, min(1.0, b) * .55 + step(1.5, b) * .3); }
else if (uPat > 2.5) { vec2 g = q / .028; vec2 c = fract(g + vec2(.5 * mod(floor(g.y), 2.0), 0.0)) - .5; if (length(c) < .27) base = uC2; }
diffuseColor.rgb = gl_FrontFacing ? base : base * .72;   // the inside of the garment a shade darker`);
};
let cloth = null, next = null, busy = false, awake = 0, sent = '', simMs = 0;
function sendParams(force) {
  const p = JSON.stringify(params());
  if (!force && p === sent) return;
  sent = p;
  worker.postMessage({ t: 'params', p: JSON.parse(p) });
  awake = 1;
}
worker.onmessage = e => {
  const m = e.data;
  if (m.t === 'log') { if (/ERROR|≠/.test(m.s)) console.warn('[cloth]', m.s); return; }
  if (m.t === 'topo') { next = m; return; }
  if (m.t !== 'frame') return;
  busy = false;
  if (!m.pos) return;
  if (next) {   // a new mesh shows only once it has its first positions (no blank frame)
    const t = next; next = null;
    const g = new THREE.BufferGeometry(), n = t.nV;
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('pat', new THREE.BufferAttribute(t.uv, 2));
    g.setIndex(new THREE.BufferAttribute(t.index, 1));
    if (!cloth) { cloth = new THREE.Mesh(g, fabric); cloth.castShadow = cloth.receiveShadow = true; cloth.frustumCulled = false; scene.add(cloth); }
    else { cloth.geometry.dispose(); cloth.geometry = g; }
    cloth.userData = { map: t.map, marks: t.marks, info: t.info };
    $('loading').hidden = true;
  }
  if (!cloth) return;
  const g = cloth.geometry, map = cloth.userData.map, P = g.attributes.position.array, N = g.attributes.normal.array;
  for (let i = 0; i < map.length; i++) {
    const q = map[i] * 3;
    P[i * 3] = m.pos[q]; P[i * 3 + 1] = m.pos[q + 1]; P[i * 3 + 2] = m.pos[q + 2];
    N[i * 3] = m.nrm[q]; N[i * 3 + 1] = m.nrm[q + 1]; N[i * 3 + 2] = m.nrm[q + 2];
  }
  g.attributes.position.needsUpdate = g.attributes.normal.needsUpdate = true;
  g.computeBoundingSphere();
  awake = m.awake; simMs = simMs * .85 + m.ms * .15;
  needs = true;
};
// the body (and the trousers, when worn) the cloth hangs on: a new collision field, and the cloth hangs again
function initCloth() {
  const B = A.meshes.body, jeans = state.bottom === 'jeans' && A.meshes.jeans;
  B.geometry.attributes.position.array.set(jeans ? A.tucked : A.bare);
  B.geometry.attributes.position.needsUpdate = true;
  if (A.meshes.jeans) A.meshes.jeans.visible = !!jeans;
  if (A.meshes.shoes) A.meshes.shoes.visible = true;
  worker.postMessage({ t: 'init', body: world(B), bottom: jeans ? world(A.meshes.jeans) : null, bones: A.bones, hps: A.hps, z0: A.z0 });
  sendParams(true);
}
async function showBody(kind) {
  $('loading').hidden = false;
  const a = await loadBody(kind);
  if (A) scene.remove(A.root);
  A = a; H = a.H;
  scene.add(A.root);
  fit();
  initCloth();
}

/* ---------- panel ---------- */
// little drawings for the cards: a flat top with these sleeves / length / ease / neckline
function topIcon(o) {
  const T = { ...state.top, ...o }, sl = T.sl[0], e = clamp(T.ease, -4, 9), L = clamp(T.L, 38, 100), fl = Math.max(0, T.flare) * .12;
  const cx = 20, nwid = 3.2 + T.dNw * .35, nd = 1.5 + T.ndF * .2, top = 5, shY = 7.5, sh = 8.5 + e * .25, w = 7 + e * .35, armY = 15, hem = 7 + L * .3;
  const half = sgn => {   // one side, neck → hem
    const pts = [[nwid, top]];
    if (sl < 0) { const st = clamp(4 + sl * .45, .7, 4); pts.push([nwid + st, top], [nwid + st, armY - 3]); }
    else if (sl < 1.2) pts.push([sh, shY]);
    else { const len = clamp(sl * .3, 2.5, 18); pts.push([sh, shY], [sh + len * .85, shY + len], [sh + len * .85 - 4.2, shY + len + 2]); }
    pts.push([w, armY], [w + fl, hem]);
    return pts.map(([x, y]) => [cx + sgn * x, y]);
  };
  const R = half(1), Lf = half(-1).reverse();
  let d = `M${R[0][0]} ${R[0][1]}` + R.slice(1).concat(Lf).map(p => `L${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('');
  d += T.neckV > .5 ? `L${cx} ${top + nd}Z` : `Q${cx} ${top + nd * 1.6} ${R[0][0]} ${R[0][1]}Z`;
  return `<svg viewBox="0 2 40 36" aria-hidden="true"><path d="${d}" fill="${state.top.c1}" stroke="#8d8a83" stroke-width=".8" stroke-linejoin="round"/></svg>`;
}
// a rib tank in one go: a 4 cm strap, a scooped neck, cut smaller than the body (each still its own card / bar after)
const TANK = () => { const s = 4 - (base().sw - base().nw - 1.5); return { sl: [s, s], ease: -5, flare: 0, dNw: 1.5, ndF: 13, ndB: 4, neckV: 0 }; };
const CARDS = {
  sleeve: () => {
    const a = base().arm / 58, full = fullOf(state.top);
    return [['긴팔', { sl: [base().arm, base().arm] }], ['7부', { sl: [45 * a, 45 * a] }], ['5부', { sl: [33 * a, 33 * a] }], ['반팔', { sl: [20 * a, 20 * a] }],
      ['캡', { sl: [7, 7] }], ['민소매', { sl: [0, 0] }], ['넓은 끈', { sl: [3 - full, 3 - full] }], ['얇은 끈', { sl: [.8 - full, .8 - full] }], ['탱크톱', TANK()]];
  },
  len: () => { const k = state.body === 'm' ? 1.1 : 1; return [['크롭', { L: 42 * k }], ['기본', { L: 62 * k }], ['롱', { L: 76 * k }], ['원피스', { L: 96 * k }]]; },
  fit: () => [['밀착', { ease: -5, flare: 0 }], ['슬림', { ease: -1.2, flare: 0 }], ['기본', { ease: 0, flare: 0 }], ['여유', { ease: 4, flare: 1 }], ['오버', { ease: 9, flare: 2 }]],
  neck: () => [['라운드', { dNw: 0, ndF: 10, ndB: 2.6, neckV: 0 }], ['U넥', { dNw: 1.5, ndF: 17, ndB: 3, neckV: 0 }], ['V넥', { dNw: .5, ndF: 15, ndB: 2.6, neckV: 1 }],
    ['깊은 V', { dNw: 1, ndF: 23, ndB: 3, neckV: 1 }], ['보트넥', { dNw: 5, ndF: 4, ndB: 4, neckV: 0 }]],
};
const near = (a, b) => Array.isArray(a) ? a.every((v, i) => Math.abs(v - b[i]) < .6) : Math.abs(a - b) < .6;
function renderCards() {
  for (const k of Object.keys(CARDS)) {
    const el = $('c-' + k);
    el.innerHTML = CARDS[k]().map(([n, o], i) => `<button type="button" data-i="${i}" aria-pressed="${Object.entries(o).every(([kk, v]) => near(state.top[kk], v))}">${topIcon(o)}${n}</button>`).join('');
  }
  const T = state.top;
  $('lbl-sleeve').textContent = T.sl[0] === T.sl[1] ? sleeveName(T.sl[0]) : `${sleeveName(T.sl[0])} / ${sleeveName(T.sl[1])}`;
  $('lbl-len').textContent = lenName(T.L);
  $('lbl-fit').textContent = fitName(T.ease);
  $('lbl-neck').textContent = `앞 ${T.ndF.toFixed(1)} · 뒤 ${T.ndB.toFixed(1)}cm`;
}
for (const k of Object.keys(CARDS)) $('c-' + k).addEventListener('click', e => {
  const b = e.target.closest('button[data-i]');
  if (!b) return;
  const [n, o] = CARDS[k]()[+b.dataset.i];
  Object.assign(state.top, structuredClone(o));
  fix(state.top); apply(); commit(); say(n);
});
// fine bars: the same numbers
const BARS = [
  ['sl0', '왼쪽 소매', () => LIM().sl, .5, T => T.sl[0], (T, v) => { T.sl[0] = v; if ($('sym').checked) T.sl[1] = v; }, sleeveName],
  ['sl1', '오른쪽 소매', () => LIM().sl, .5, T => T.sl[1], (T, v) => { T.sl[1] = v; if ($('sym').checked) T.sl[0] = v; }, sleeveName],
  ['L', '기장', () => LIM().L, .5, T => T.L, (T, v) => { T.L = v; }, lenName],
  ['ease', '품', () => LIM().ease, .1, T => T.ease, (T, v) => { T.ease = v; }, fitName],
  ['flare', '밑단 퍼짐', () => LIM().flare, .1, T => T.flare, (T, v) => { T.flare = v; }, v => `${v >= 0 ? '+' : ''}${v.toFixed(1)}cm`],
  ['ndF', '앞 목 깊이', () => LIM().ndF, .1, T => T.ndF, (T, v) => { T.ndF = v; }, v => `${v.toFixed(1)}cm`],
  ['ndB', '뒤 목 깊이', () => LIM().ndB, .1, T => T.ndB, (T, v) => { T.ndB = v; }, v => `${v.toFixed(1)}cm`],
  ['dNw', '목 넓이', () => LIM().dNw, .1, T => T.dNw, (T, v) => { T.dNw = v; }, v => `${v >= 0 ? '+' : ''}${v.toFixed(1)}cm`],
  ['neckV', '목선 V', () => LIM().neckV, .01, T => T.neckV, (T, v) => { T.neckV = v; }, v => v < .05 ? '둥글게' : v > .95 ? 'V' : `${Math.round(v * 100)}%`],
];
$('bars').innerHTML = BARS.map(([id, n]) => `<div class="bar"><label for="b-${id}">${n} <span id="v-${id}"></span></label><input type="range" id="b-${id}"></div>`).join('');
function renderBars() {
  for (const [id, , lim, step, get, , name] of BARS) {
    const el = $('b-' + id), [a, b] = lim();
    el.min = a; el.max = b; el.step = step; el.value = get(state.top);
    $('v-' + id).textContent = name(get(state.top));
  }
}
for (const [id, , , , , setv] of BARS) {
  const el = $('b-' + id);
  el.addEventListener('input', () => { setv(state.top, +el.value); fix(state.top); apply(true); });
  el.addEventListener('change', commit);
}
// colour
const SW = ['#f3f1ec', '#1c1c1e', '#9a9a98', '#24324a', '#b8352f', '#e8b4b8', '#f0dca0', '#9db59a', '#a9c7e6', '#c98a5a', '#6b4f8a', '#2f6b5a'];
const PATS = [['단색', 0], ['줄무늬', 1], ['체크', 2], ['도트', 3]];
function renderColor() {
  const T = state.top;
  for (const [el, k] of [['sw1', 'c1'], ['sw2', 'c2']]) $(el).innerHTML = SW.map(c => `<button type="button" data-c="${c}" style="background:${c}" aria-label="${c}" aria-pressed="${T[k].toLowerCase() === c}"></button>`).join('');
  $('c1').value = T.c1; $('c1t').textContent = T.c1; $('c2').value = T.c2; $('c2t').textContent = T.c2;
  $('c-pat').innerHTML = PATS.map(([n, v]) => `<button type="button" data-p="${v}" aria-pressed="${T.pat === v}"><svg viewBox="0 0 40 34" aria-hidden="true"><rect x="6" y="3" width="28" height="28" rx="4" fill="${T.c1}"/>${patIcon(v, T.c2)}</svg>${n}</button>`).join('');
  $('pat2').hidden = !T.pat;
  $('scale').value = T.scale; $('lbl-scale').textContent = `×${T.scale.toFixed(2)}`;
}
const patIcon = (v, c) => v === 1 ? [7, 15, 23].map(y => `<rect x="6" y="${y}" width="28" height="4" fill="${c}"/>`).join('')
  : v === 2 ? [10, 20].map(x => `<rect x="${x}" y="3" width="4" height="28" fill="${c}" opacity=".6"/><rect x="6" y="${x - 3}" width="28" height="4" fill="${c}" opacity=".6"/>`).join('')
    : v === 3 ? [[12, 10], [24, 10], [18, 18], [12, 26], [24, 26]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.4" fill="${c}"/>`).join('') : '';
$('sw1').addEventListener('click', e => { const b = e.target.closest('[data-c]'); if (b) { state.top.c1 = b.dataset.c; apply(); commit(); } });
$('sw2').addEventListener('click', e => { const b = e.target.closest('[data-c]'); if (b) { state.top.c2 = b.dataset.c; apply(); commit(); } });
$('c1').addEventListener('input', e => { state.top.c1 = e.target.value; apply(true); }); $('c1').addEventListener('change', commit);
$('c2').addEventListener('input', e => { state.top.c2 = e.target.value; apply(true); }); $('c2').addEventListener('change', commit);
$('c-pat').addEventListener('click', e => { const b = e.target.closest('[data-p]'); if (b) { state.top.pat = +b.dataset.p; apply(); commit(); } });
$('scale').addEventListener('input', e => { state.top.scale = +e.target.value; apply(true); }); $('scale').addEventListener('change', commit);
document.querySelectorAll('.tabs [data-tab]').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.tabs [data-tab]').forEach(x => x.setAttribute('aria-selected', x === b));
  document.querySelectorAll('[data-pane]').forEach(p => { p.hidden = p.dataset.pane !== b.dataset.tab; });
}));
for (const [id, k] of [['body', 'body'], ['bottom', 'bottom']]) $(id).addEventListener('click', async e => {
  const b = e.target.closest('[data-v]');
  if (!b || state[k] === b.dataset.v) return;
  state[k] = b.dataset.v;
  renderSeg(); commit();
  if (k === 'body') { fix(state.top); await showBody(state.body); } else initCloth();
  apply();
});
function renderSeg() {
  for (const [id, k] of [['body', 'body'], ['bottom', 'bottom']]) $(id).querySelectorAll('[data-v]').forEach(b => b.setAttribute('aria-pressed', state[k] === b.dataset.v));
}
document.querySelectorAll('.views [data-a]').forEach(b => b.addEventListener('click', () => {
  const a = +b.dataset.a, t = controls.target, d = camera.position.distanceTo(t), y = camera.position.y;
  const hr = Math.sqrt(Math.max(0, d * d - (y - t.y) ** 2));
  camera.position.set(t.x + hr * Math.sin(a), y, t.z + hr * Math.cos(a)); controls.update(); needs = true;
}));

// state → cloth, colours, panel. light = only what a drag / bar changes every move (no card redraw)
function apply(light) {
  sendParams();
  const T = state.top;
  fabricU.uC1.value.set(T.c1); fabricU.uC2.value.set(T.c2); fabricU.uPat.value = T.pat; fabricU.uScale.value = T.scale;
  fabric.sheenColor.set(T.c1).lerp(new THREE.Color('#ffffff'), .15);
  if (light) { renderBars(); renderCards(); $('c1t').textContent = T.c1; $('c2t').textContent = T.c2; $('lbl-scale').textContent = `×${T.scale.toFixed(2)}`; }
  else { renderBars(); renderCards(); renderColor(); }
  needs = true;
}

/* ---------- undo / save ---------- */
let hist = [JSON.stringify(state)], hi = 0;
function commit() {
  const s = JSON.stringify(state);
  if (s === hist[hi]) return;
  hist = hist.slice(0, hi + 1); hist.push(s); hi = hist.length - 1;
  if (hist.length > 80) { hist.shift(); hi--; }
  save(); undoState();
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* storage full or blocked: still works this session */ } }
function undoState() { $('undo').disabled = hi <= 0; $('redo').disabled = hi >= hist.length - 1; }
async function go(i) {
  const prev = state;
  hi = i; state = JSON.parse(hist[hi]);
  renderSeg();
  if (prev.body !== state.body) await showBody(state.body);
  else if (prev.bottom !== state.bottom) initCloth();
  apply(); save(); undoState();
}
$('undo').addEventListener('click', () => { if (hi > 0) go(hi - 1); });
$('redo').addEventListener('click', () => { if (hi < hist.length - 1) go(hi + 1); });
$('reset').addEventListener('click', () => { state.top = structuredClone(DEF_TOP); fix(state.top); apply(); commit(); say('처음 옷으로'); });
addEventListener('keydown', e => {
  if (e.target.closest('input')) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) $('redo').click(); else $('undo').click(); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); $('redo').click(); }
});

/* ---------- drag points on the garment ---------- */
// sleeve ends (on a side with no sleeve: the end of the shoulder), the hem's middle, the sides, the neckline's middle
// (front and back) and its ends. Each turns a drag into one of the pattern's numbers.
const tip = $('tip'), layer = $('layer');
const DOTS = [
  { k: 'sleeve', i: 0 }, { k: 'sleeve', i: 1 }, { k: 'hem', i: 0 }, { k: 'hem', i: 1 }, { k: 'side', i: 0 }, { k: 'side', i: 1 },
  { k: 'neck', i: 0 }, { k: 'neck', i: 1 }, { k: 'neckSide', i: 0 }, { k: 'neckSide', i: 1 },
];
const LABEL = { sleeve: '소매 끝', hem: '밑단', side: '옆구리 (품)', neck: '목선', neckSide: '목 넓이' };
DOTS.forEach(d => {
  d.el = document.createElement('button');
  d.el.type = 'button';
  d.el.className = 'dot' + (d.k === 'hem' || d.k === 'side' ? ' sq' : '');
  d.el.setAttribute('aria-label', LABEL[d.k] + ' 점 — 끌어서 바꾸기');
  d.el.addEventListener('pointerdown', e => dragStart(e, d));
  d.el.addEventListener('pointerenter', () => { if (!drag) showTip(LABEL[d.k], d.sx, d.sy); });
  d.el.addEventListener('pointerleave', () => { if (!drag) tip.classList.remove('show'); });
  layer.appendChild(d.el);
});
const v3 = new THREE.Vector3(), n3 = new THREE.Vector3(), c3 = new THREE.Vector3();
function vertexOf(d) {
  const mk = cloth.userData.marks, inf = cloth.userData.info;
  if (d.k === 'sleeve') return inf.has[d.i ? 'r' : 'l'] ? mk.sleeve[d.i] : mk.shoulder[d.i];
  return mk[d.k][d.i];
}
function project(p) {
  const r = canvas.getBoundingClientRect();
  c3.copy(p).project(camera);
  return [(c3.x + 1) / 2 * r.width, (1 - c3.y) / 2 * r.height];
}
function placeDots() {
  const ok = cloth && cloth.userData.marks && !next;
  for (const d of DOTS) {
    const vi = ok ? vertexOf(d) : -1;
    if (vi == null || vi < 0) { d.el.hidden = true; continue; }
    const P = cloth.geometry.attributes.position, N = cloth.geometry.attributes.normal;
    v3.fromBufferAttribute(P, vi); n3.fromBufferAttribute(N, vi);
    // shown only on the side you look at (sleeves and sides sit on the outline: shown unless well behind)
    const toCam = new THREE.Vector3().subVectors(camera.position, v3);
    // neckline and hem points by which way they face round the body (a neck edge curls up or over: its normal says little)
    if (d.k === 'neck' || d.k === 'hem') { n3.set(0, 0, d.i ? -1 : 1); toCam.y = 0; }
    const facing = n3.dot(toCam.normalize());
    const lim = d.k === 'sleeve' || d.k === 'side' ? -.55 : d.k === 'neckSide' ? -.3 : 0;
    const [x, y] = project(v3);
    d.sx = x; d.sy = y; d.p = v3.clone();
    d.el.style.transform = `translate(${x}px, ${y}px)`;
    d.el.hidden = drag ? drag !== d : facing < lim;   // while dragging only the point in hand
    d.el.classList.toggle('on', drag === d);
  }
}
function showTip(text, x, y) {
  tip.textContent = text;
  const w = tip.offsetWidth || 100, r = layer.getBoundingClientRect();
  tip.style.left = (x + 16 + w > r.width ? x - 16 - w : x + 16) + 'px'; tip.style.top = (y - 30) + 'px';
  tip.classList.add('show');
}
let drag = null;
function dragStart(e, d) {
  e.preventDefault(); e.stopPropagation();
  drag = d; controls.enabled = false;
  d.el.setPointerCapture(e.pointerId);
  d.x0 = e.clientX; d.y0 = e.clientY; d.start = structuredClone(state.top);
  // which way is "out" on screen: from the body's middle line at that height to the point
  const [ax, ay] = project(new THREE.Vector3(0, d.p.y, A.z0));
  const ox = d.sx - ax, oy = d.sy - ay, ol = Math.hypot(ox, oy);
  d.out = ol > 6 ? [ox / ol, oy / ol] : [1, 0];
  d.mpp = 2 * camera.position.distanceTo(d.p) * Math.tan(camera.fov * PI / 360) / canvas.getBoundingClientRect().height;
  const move = ev => dragMove(ev, d), up = () => {
    d.el.removeEventListener('pointermove', move); d.el.removeEventListener('pointerup', up); d.el.removeEventListener('pointercancel', up);
    drag = null; controls.enabled = true; tip.classList.remove('show'); commit(); apply();
  };
  d.el.addEventListener('pointermove', move); d.el.addEventListener('pointerup', up); d.el.addEventListener('pointercancel', up);
}
function dragMove(e, d) {
  const dx = e.clientX - d.x0, dy = e.clientY - d.y0, down = dy * d.mpp, out = (dx * d.out[0] + dy * d.out[1]) * d.mpp;
  const T = state.top, S = d.start;
  T.sl = S.sl.slice();
  let label;
  if (d.k === 'sleeve') {   // down / out the sleeve grows, up / in it shortens, past nothing the shoulder narrows into a strap
    const v = S.sl[d.i] + (down + out * .6) * 80;
    T.sl[d.i] = v; if ($('sym').checked) T.sl[1 - d.i] = v;
    fix(T); label = sleeveName(T.sl[d.i]);
  } else if (d.k === 'hem') { T.L = S.L + down * 100; fix(T); label = lenName(T.L); }
  else if (d.k === 'side') { T.ease = S.ease + out * 100; fix(T); label = '품 ' + fitName(T.ease); }
  else if (d.k === 'neck') { const k = d.i ? 'ndB' : 'ndF'; T[k] = S[k] + down * 100; fix(T); label = `${d.i ? '뒤' : '앞'} 목 깊이 ${T[k].toFixed(1)}cm`; }
  else { T.dNw = S.dNw + out * 100; fix(T); label = `목 넓이 ${T.dNw >= 0 ? '+' : ''}${T.dNw.toFixed(1)}cm`; }
  apply(true);
  const r = layer.getBoundingClientRect();
  showTip(label, e.clientX - r.left, e.clientY - r.top);
}

/* ---------- PNG ---------- */
$('png').addEventListener('click', () => {
  const w = 1000, h = 1500, keep = [camera.aspect];
  DOTS.forEach(d => { d.el.hidden = true; });
  renderer.setSize(w, h, false); composer.setPixelRatio(1); composer.setSize(w, h);
  camera.aspect = w / h; camera.clearViewOffset(); camera.updateProjectionMatrix();
  composer.render();
  const url = canvas.toDataURL('image/png');
  camera.aspect = keep[0]; fit(); needs = true;
  const a = document.createElement('a'); a.href = url; a.download = '고쳐입기.png'; a.click();
  say('PNG로 저장했어요');
});

/* ---------- loop ---------- */
let sayT = 0;
function say(t) { $('status').textContent = t; sayT = performance.now(); }
let lastStat = 0;
(function frame(t) {
  requestAnimationFrame(frame);
  if (!busy && (awake || next || sent && !cloth)) { busy = true; worker.postMessage({ t: 'tick' }); }
  if (controls.update() || needs) { needs = false; composer.render(); }
  placeDots();
  if (t - lastStat > 400 && t - sayT > 2500) { lastStat = t; $('status').textContent = cloth ? `천 ${awake ? '움직이는 중' : '멈춤'} · 계산 ${simMs.toFixed(1)}ms` : ''; }
})(0);

fix(state.top);
renderSeg(); apply(); undoState();
showBody(state.body);
window.__studio = { get state() { return state; }, apply, camera, controls, get cloth() { return cloth; }, get awake() { return awake; }, get A() { return A; }, composer, renderer, params };
