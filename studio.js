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
import { BASE, BASE_M, fitSide, halfOk, resample, sleeves, sleeveOk } from './pattern.js?v=30';

const $ = id => document.getElementById(id);
const PI = Math.PI;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r1 = v => Math.round(v * 10) / 10;
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const ASSET_VER = 2, KEY = 'clothes-custom:studio:v1';

/* ---------- the garment's numbers ---------- */
// sl: each sleeve as one number (cm of sleeve; below 0, cm the shoulder has narrowed toward a strap), L: length from
// the high shoulder point, ease: added to each quarter's width below the underarm, sEase: the same round the sleeves
// (the underarm, armhole, shoulder and sleeve width), flare: more at the hem, dNw: wider neck at the shoulder,
// ndF / ndB: neckline depth front / back, neckV: round 0 … V 1
const DEF_TOP = { sl: [20, 20], L: 62, ease: 0, sEase: 0, flare: 0, dNw: 0, ndF: 10, ndB: 2.6, neckV: 0, c1: '#f3f1ec', c2: '#24324a', pat: 0, scale: 1 };
const DEF = { body: 'f', bottom: 'jeans', top: DEF_TOP };
let state = load() || structuredClone(DEF);
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && s.top) return { ...structuredClone(DEF), ...s, top: { ...DEF_TOP, sEase: s.top.ease ?? 0, ...s.top } };   // saved before sEase: the sleeves had the body's
  } catch (e) { /* none saved, or storage blocked */ }
  return null;
}
const base = () => state.body === 'm' ? BASE_M : BASE;
const shoulderOf = T => base().sw + Math.max(0, T.sEase - 3) * .5 * sstep(Math.max(...T.sl) / 8);   // an oversized top's shoulder drops off the shoulder
// (with its sleeve: under 8 cm of sleeve it comes back, and a sleeveless or strap top has the body's shoulder. Dropped,
// the armhole lay over the arm and the arm came through it)
const fullOf = T => shoulderOf(T) - (base().nw + T.dNw);   // the shoulder seam's length: how far a strap can narrow
// below the slim fit the top is cut to the body from a knit that stretches round it (rib tank, fitted tee): fitOf
// 0 … 1 is how far the side seams follow the mannequin's own outline (measure()) instead of the tee's straight side
const tightOf = e => clamp(-e - 1.5, 0, 6.5);
const fitOf = e => sstep(tightOf(e) / 3.5);
// a slim top is shaped, not just narrower: from the regular fit's edge its side seams take in at the waist with the
// mannequin's outline (fully by the fitted), never out past the tee's straight side. Only the side: the knit, the
// armhole and the sleeves stay the tee's until the fitted (fitOf); cut straight, a slim top was the regular one 1 cm in
const shapeOf = e => sstep((-e - .5) / 1.5);
// a wider body puts the underarm further out along the sloping arm: the armhole drops with it, or the underarm would
// sit inside the arm and the cloth twist over or under it. A fitted one rises to just under the real armpit: the
// tee's deep armhole would leave a web of cloth between the arm and the side, standing off the body under the arm.
// So does a fitted sleeve on a looser body: in the deep armhole its narrow cap stood tall and dragged the sleeve up the arm
const adOf = T => {
  const ad = base().ad + Math.max(0, T.sEase - 2) * .85, m = A && measure();
  return m ? lerp(ad, Math.min(ad, m.armpit + 2.5), fitOf(Math.min(T.ease, T.sEase))) : ad;
};
// cm down the arm's bones from the shoulder joint to the elbow, and to the wrist (a sleeve's cm sit about as far down)
const elbowOf = () => { const [J, E] = A.bones.l; return Math.hypot(E[0] - J[0], E[1] - J[1], E[2] - J[2]) * 100; };
const wristOf = () => { const [, E, W] = A.bones.l; return elbowOf() + Math.hypot(W[0] - E[0], W[1] - E[1], W[2] - E[2]) * 100; };
function params(T = state.top) {
  const b = base(), full = fullOf(T), [l, r] = T.sl, e = T.ease, es = T.sEase, t = tightOf(Math.min(e, es));
  const ad = adOf(T), w = fitOf(e), ws = shapeOf(e), wa = fitOf(es), m = (ws > 0 || wa > 0) && A ? measure() : null;
  // fitted: the quarter round of the body at each depth (cm below the high shoulder point) from the armhole down
  // past the hem, less a little round the chest (a stretch knit sits a few cm smaller than the body), back to the
  // body's own round by the waist, as far as the top reaches down onto the widening below the waist (W): cloth pulled
  // tight where the body widens downward (a crop's hem between waist and hips) slides up the slope to the waist and
  // rolls over, and it is let out from 8 cm above the waist so it is loose before the slope starts. A top ending
  // before the body widens keeps the knit's stretch to the hem: let out there, on the body narrowing down to the
  // waist, the cloth stood off the sides a few cm above the hem like ears (and so on the men's long flat waist).
  // A hem on the widening slope is cut a little under the body, as a fitted tee's hem hugs: cut to the body, the
  // cloth at the squared side corner stood out from the slope like a small ear. It comes in from 8 cm above the hem, fully
  // by 2 (from 7, a hem just where the hips start to widen still stood out at its corners; cut deeper, others did;
  // from 10, a strap top taken in at the hem took 20 s to settle)
  let fit = null, cw = b.cw + es;
  if (m) {
    const off = (e + 2.5) * .4, q = [], y0 = Math.floor(ad), L = Math.max(T.L, ad + 6), n = Math.ceil(L) + 3 - y0;
    const qm = y => m.q[clamp(Math.round(y), 0, m.q.length - 1)];
    const band = -1.6 * clamp((qm(L) - qm(L - 4)) / 4 / .3, 0, 1), W = sstep((qm(L) - qm(m.waist)) / 1.2);
    for (let i = 0; i <= n; i++) {
      const y = y0 + i, low = W * sstep((y - m.waist + 8) / 8), hem = sstep((y - L + 8) / 6);
      const v = qm(y) + off * (1 - low);
      q.push(r1(lerp(v, Math.min(v, qm(y) + band), hem)));
    }
    // the sleeve: half the arm's round (a sleeve's cm sit about as far down the bones), a little under it on the upper
    // arm like the body, a little over it past the elbow (pulled tight round the bony wrist, the skin came through)
    const ar = m.arm, last = ar.findLastIndex(v => v > 0), arm = [], elbow = elbowOf();
    const offS = (es + 2.5) * .4;
    for (let y = 0; y <= b.arm + 1; y++) arm.push(r1(ar[Math.min(last, y)] / 2 + lerp(offS * .25, .5, sstep((y - elbow + 3) / 6))));
    fit = { w: Math.round(w * 100) / 100, ws: Math.round(ws * 100) / 100, wa: Math.round(wa * 100) / 100, y0, q, arm };
    cw = lerp(cw, q[0] + (q[1] - q[0]) * (ad - y0), w);
  }
  // a long sleeve's rib cuff: the arm's round where the sleeve ends and a little ease, starting past the elbow
  let rib = null;
  if (A) {
    const ar = measure().arm, last = ar.findLastIndex(v => v > 0), r = [];
    for (let y = 0; y <= last; y++) r.push(r1(ar[y] / 2 + 1 + Math.max(0, es) * .1));
    rib = { r, e: r1(elbowOf() + 14) };
  }
  return {
    base: state.body, L: r1(T.L), sleeveL: r1(Math.max(0, l)), sleeveR: r1(Math.max(0, r)),
    strap: l < 1.2 && r < 1.2 && Math.min(l, r) < 0 ? r1(clamp(full + Math.min(l, r), .6, full)) : null,
    cw: r1(cw), bx: r1(cw + e - es), hw: r1(b.hw + (e > 0 ? e : e * .5) + T.flare), sw: r1(shoulderOf(T)), nw: r1(b.nw + T.dNw),
    ad: r1(ad), flare: r1(T.flare), fit, rib,
    ndF: r1(T.ndF), ndB: r1(T.ndB), neckV: r1(T.neckV),
    bw: r1(b.bw + (es > 0 ? es * .4 : es * .3)), cuff: r1(b.cuff + (es > 0 ? es * .3 : es * .2)),
    stretch: Math.round(clamp(t / 2, 0, 1) * 100) / 100,
    edit: T.edit && Object.values(T.edit).some(l => l.length) ? T.edit : undefined,
  };
}
// the hem taken in (the hem's corners dragged in, or the bar): down to 1 cm over the body's round at the hem, no further.
// A hem cut under the hips slid up the slope and rolled at the waist; a crop's hem sits in the waist and comes in a long
// way (cut right to the body there, its side corners still rolled up)
const hemFloor = T => {
  if (!A) return -12;   // not measured yet: a saved hem is not cut back before the mannequin is in
  const P = params({ ...T, flare: 0 }), q = measure().q, L = Math.max(P.L, P.ad + 6);
  const hem = P.fit ? fitSide(P, L, P.hw) : P.hw;
  return clamp(r1(q[clamp(Math.round(L), 0, q.length - 1)] - hem + 1), -12, 0);
};
// the hem's range: its side seam runs no flatter than 45° from the underarm, out or in. Further out, a short top's side
// lay nearly flat, and hung it fell into a tongue below the hem or folded through itself (a crop flared like a cape);
// further in, the crop's hem pulled its side corners up
const flareLim = T => {
  if (!A) return [-12, 22];   // not measured yet (as hemFloor): the tee's deep armhole guessed for a fitted one cut a saved hem
  const P = params({ ...T, flare: 0 }), drop = Math.max(P.L, P.ad + 6) - P.ad, run = P.hw - P.cw;
  const lo = Math.max(hemFloor(T), r1(-drop - run));
  return [lo, Math.max(lo, Math.min(22, r1(drop - run)))];
};
// the body's and the sleeves' ease at most 20 apart: further, the body flared straight out under the arm into wings, or
// the underarm sat inside the arm
const GAP = 20;
const LIM = () => {
  const b = base(), T = state.top, full = fullOf(T);
  return { sl: [-(full - .6), b.arm + b.over], L: [A ? adOf(T) + 6 : 0, 118], ease: [Math.max(-8, T.sEase - GAP), Math.min(20, T.sEase + GAP)], sEase: [Math.max(-8, T.ease - GAP), Math.min(20, T.ease + GAP)], flare: flareLim(state.top), dNw: [-2, 8], ndF: [3, 30], ndB: [1.5, 26], neckV: [0, 1] };
};
function fix(T) {
  // the sleeves on their own range, the body then within the gap of them: a dragged side stops there (the bars' own
  // ranges already keep each to the other). First: the shortest length and the hem's range are measured on them (taken
  // before, a side dragged past -8 had its hem's range measured on a body that then stopped at -8)
  T.sEase = clamp(T.sEase, -8, 20);
  T.ease = clamp(T.ease, Math.max(-8, T.sEase - GAP), Math.min(20, T.sEase + GAP));
  const L = LIM();
  T.sl = T.sl.map(v => clamp(v, ...L.sl));
  for (const k of ['L', 'dNw', 'ndF', 'ndB', 'neckV']) T[k] = clamp(T[k], ...L[k]);
  T.flare = clamp(T.flare, ...flareLim(T));   // (on the length just set)
  fitEdit(T);
}
// the outline pulled by hand on a shape a card or bar has since changed: the bumps shrunk till the pieces are whole
// again (else they rode on the new shape unchecked: a narrower body under an old side bump crossed itself)
function fitEdit(T) {
  if (!A || !T.edit) return;
  const from = sleeves(params({ ...T, edit: undefined }));
  if (piecesOk(T, from)) return;
  const E0 = structuredClone(T.edit), scale = k => { for (const key in E0) T.edit[key] = E0[key].map(b => [b[0], b[1], r1(b[2] * k), r1(b[3] * k), ...b.slice(4)]); };
  let lo = 0, hi = 1;
  for (let it = 0; it < 7; it++) { const m = (lo + hi) / 2; scale(m); if (piecesOk(T, from)) lo = m; else hi = m; }
  scale(lo);
  for (const key in T.edit) T.edit[key] = T.edit[key].filter(b => b[2] || b[3]);   // (shrunk to nothing: gone)
}
// the pieces still whole (pattern.js halfOk, sleeveOk), each against `from`'s (a side or an underarm comes in no further
// than the body or arm allows, or than it already was)
function piecesOk(T, from) {
  const m = measure(), s = sleeves(params(T)), h = s.h, h0 = from.h;
  return ['Fp', 'Fm', 'Bp', 'Bm'].every(k => halfOk(h[k], h0[k], m.q, h[k[0]]))
    && ['l', 'r'].every(k => !s[k] || sleeveOk(s[k].H, (from[k] || s[k]).H, s.sl[k].capb, m.arm, h.P.arm + h.P.over));
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
// the shown body's torso, measured for a fitted top (with the trousers when worn, they are what the hem sits on):
// q[y] = a quarter of the round a cloth wrapped tight would take (convex outline of the slice, the arms left out by
// their skin weights) y cm below the high shoulder point, below the hips never past the hips' round (a tight top hangs
// straight from them, and over 15 cm in to the thighs' outline under them: held at the hips' round, a fitted dress
// ending on the thighs stood off them at its side corners; in at once, a hem just under the hips did); armpit and
// waist = cm below that point
function measure() {
  const jeans = state.bottom === 'jeans' && !!A.meshes.jeans, k = jeans ? 'mj' : 'm';
  if (A[k]) return A[k];
  const body = A.meshes.body, g = body.geometry, P = jeans ? A.tucked : A.bare;
  const SI = g.attributes.skinIndex.array, SW = g.attributes.skinWeight.array;
  const isArm = body.skeleton.bones.map(b => /upperarm|lowerarm|hand|thumb|index|middle|ring|pinky/i.test(b.name));
  const N = 150, slices = Array.from({ length: N }, () => []), tmax = new Float32Array(N), amin = new Float32Array(N).fill(1);
  const add = (Q, arm) => {
    for (let i = 0; i < Q.length; i += 3) {
      const yc = (A.hps - Q[i + 1]) * 100, y = Math.round(yc);
      if (y < 0 || y >= N || Math.abs(yc - y) > .6) continue;
      const ax = Math.abs(Q[i]);
      if (arm && arm(i / 3)) { amin[y] = Math.min(amin[y], ax); continue; }
      tmax[y] = Math.max(tmax[y], ax); slices[y].push([Q[i], Q[i + 2]]);
    }
  };
  add(P, v => { let w = 0; for (let j = 0; j < 4; j++) if (isArm[SI[v * 4 + j]]) w += SW[v * 4 + j]; return w > .5; });
  if (jeans) add(A.meshes.jeans.geometry.attributes.position.array, null);
  const raw = slices.map(s => s.length > 2 ? hullLen(s) * 25 : 0);
  let armpit = 0;
  while (armpit < 40 && !(amin[armpit] - tmax[armpit] > .008 && armpit > 8)) armpit++;
  const q = raw.map((_, y) => { let s = 0, n = 0; for (let j = y - 2; j <= y + 2; j++) if (raw[j]) { s += raw[j]; n++; } return n ? s / n : 0; });
  let waist = armpit + 10, hip = waist;
  for (let y = armpit + 8; y < armpit + 34; y++) if (q[y] < q[waist]) waist = y;
  for (let y = waist; y < waist + 34; y++) if (q[y] > q[hip]) hip = y;
  for (let y = hip; y < N; y++) q[y] = lerp(q[hip], Math.min(q[y] || q[hip], q[hip]), sstep((y - hip) / 15));
  return (A[k] = { q, armpit, waist, hip, arm: A.arm || (A.arm = armRound(A.bare, isArm, SI, SW)) });
}
// the arm's round (cm) by cm down its bones from the shoulder joint: convex outline of the slice square to the bone
// (left arm, the two are alike; the vertex goes to the bone it lies nearest, so the elbow is not sliced twice), on
// 7 cm past the wrist: a long sleeve ends on the back of the hand
function armRound(P, isArm, SI, SW) {
  const [J, E, W] = A.bones.l, sg = Math.sign(E[0]), N = 80, slices = Array.from({ length: N }, () => []);
  let s0 = 0;
  const segs = [[J, E], [E, W]].map(([a, b]) => {
    const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]), L = d.length(); d.normalize();
    const u = new THREE.Vector3().crossVectors(d, new THREE.Vector3(0, 0, 1)).normalize(), w = new THREE.Vector3().crossVectors(d, u);
    const g = { a: new THREE.Vector3(...a), d, u, w, L, s0 }; s0 += L; return g;
  });
  const r = new THREE.Vector3();
  for (let v = 0; v < P.length / 3; v++) {
    if (Math.sign(P[v * 3]) !== sg) continue;
    let wa = 0; for (let j = 0; j < 4; j++) if (isArm[SI[v * 4 + j]]) wa += SW[v * 4 + j];
    if (wa < .5) continue;
    let best = null;
    for (const g of segs) {
      r.set(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]).sub(g.a);
      const t = r.dot(g.d); if (t < -.02 || t > g.L + (g.s0 ? .07 : 0)) continue;
      const pu = r.dot(g.u), pw = r.dot(g.w), dd = Math.hypot(pu, pw);
      if (!best || dd < best[2]) best = [g.s0 + t, [pu, pw], dd];
    }
    if (!best) continue;
    const sc = best[0] * 100, i = Math.round(sc);
    if (i >= 0 && i < N && Math.abs(sc - i) < .6) slices[i].push(best[1]);
  }
  const raw = slices.map(s => s.length > 8 ? hullLen(s) * 100 : 0);
  return raw.map((_, y) => { let s = 0, n = 0; for (let j = y - 2; j <= y + 2; j++) if (raw[j]) { s += raw[j]; n++; } return n ? r1(s / n) : 0; });
}
function hullLen(pts) {
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]), lo = [], up = [];
  for (const p of pts) { while (lo.length > 1 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length > 1 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  const h = lo.slice(0, -1).concat(up.slice(0, -1));
  let s = 0;
  for (let i = 0; i < h.length; i++) s += Math.hypot(h[i][0] - h[(i + 1) % h.length][0], h[i][1] - h[(i + 1) % h.length][1]);
  return s;
}
const world = mesh => {   // rest pose = bind pose = world here (the asset's root has no transform)
  const P = mesh.geometry.attributes.position, N = mesh.geometry.attributes.normal;
  return { pos: new Float32Array(P.array), nrm: new Float32Array(N.array) };
};

/* ---------- the cloth ---------- */
const worker = new Worker('cloth.js?v=48', { type: 'module' });
worker.onerror = e => console.error('[cloth]', e.message);
const fabricU = { uC1: { value: new THREE.Color() }, uC2: { value: new THREE.Color() }, uPat: { value: 0 }, uScale: { value: 1 } };
// the knit's grain as a normal map over the flat pattern (m): a jersey's columns of V-shaped loops, or for the fitted
// knit a 1×1 rib (every other wale raised). One tile = 8 wales × 8 courses, a little larger than real yarn so it reads
const knitMap = rib => {
  const S = 256, h = new Float32Array(S * S), d = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const fx = x / 32 % 1, fy = y / 32 % 1;
    let v = 0;
    for (const c of [.25, .75]) {   // the loop's two legs lean in toward the bottom: a V
      const t = Math.abs(fx - c - (c < .5 ? 1 : -1) * (fy - .5) * .3) / .24;
      v = Math.max(v, Math.max(0, 1 - t * t) * (.55 + .45 * Math.sin(PI * fy)));
    }
    if (rib) v = v * .35 + .65 * Math.max(0, Math.cos(2 * PI * (x / 64 + .25))) ** .6;
    h[y * S + x] = v;
  }
  const H = (x, y) => h[((y + S) % S) * S + (x + S) % S];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const nx = (H(x - 1, y) - H(x + 1, y)) * 1.5, ny = (H(x, y - 1) - H(x, y + 1)) * 1.5, l = Math.hypot(nx, ny, 1), i = (y * S + x) * 4;
    d[i] = (nx / l * .5 + .5) * 255; d[i + 1] = (ny / l * .5 + .5) * 255; d[i + 2] = (1 / l * .5 + .5) * 255; d[i + 3] = 255;
  }
  const t = new THREE.DataTexture(d, S, S);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1 / .032, 1 / .024);   // wale 4 mm, course 3 mm
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy(); t.needsUpdate = true;
  return t;
};
const jersey = knitMap(false), rib2 = knitMap(true);
const fabric = new THREE.MeshPhysicalMaterial({ roughness: .86, sheen: .6, sheenRoughness: .8, side: THREE.DoubleSide, normalMap: jersey, normalScale: new THREE.Vector2(.45, .45) });
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
let cloth = null, next = null, busy = false, awake = 0, sent = '', laid = '', simMs = 0;
// fresh: the cloth laid out anew for these values (once per shape: laid). While a point or a bar is dragged it is carried
// on from where it hung, so it follows the hand; once an edit ends it is laid afresh, and the top comes out the same
// whatever was done before: carried on through a few edits it kept what they left, a fold, a rolled sleeve, an ear
function sendParams(force, fresh) {
  const p = JSON.stringify(params());
  if (p === laid) fresh = false;
  if (!force && !fresh && p === sent) return;
  sent = p; laid = fresh ? p : '';   // (carried through other values and back, the cloth is no longer as laid)
  worker.postMessage({ t: 'params', p: JSON.parse(p), fresh });
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
    g.setAttribute('uv', g.attributes.pat);   // the knit's normal map follows the pattern too
    g.setIndex(new THREE.BufferAttribute(t.index, 1));
    if (!cloth) { cloth = new THREE.Mesh(g, fabric); cloth.castShadow = cloth.receiveShadow = true; cloth.frustumCulled = false; scene.add(cloth); }
    else { cloth.geometry.dispose(); cloth.geometry = g; }
    cloth.userData = { map: t.map, marks: t.marks, info: t.info, rim: t.rim };
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
  fix(state.top); renderBars();   // the limits (hem floor, shortest length, sleeves) are measured on this mannequin and bottom
  const B = A.meshes.body, jeans = state.bottom === 'jeans' && A.meshes.jeans;
  B.geometry.attributes.position.array.set(jeans ? A.tucked : A.bare);
  B.geometry.attributes.position.needsUpdate = true;
  if (A.meshes.jeans) A.meshes.jeans.visible = !!jeans;
  if (A.meshes.shoes) A.meshes.shoes.visible = true;
  worker.postMessage({ t: 'init', body: world(B), bottom: jeans ? world(A.meshes.jeans) : null, bones: A.bones, hps: A.hps, z0: A.z0 });
  sendParams(true, true);
}
async function showBody(kind) {
  $('loading').hidden = false;
  const a = await loadBody(kind);
  if (kind !== state.body) return;   // switched again while this one loaded: the later call shows its own
  if (A) scene.remove(A.root);
  A = a; H = a.H;
  scene.add(A.root);
  fit();
  initCloth();
}

/* ---------- panel ---------- */
// little drawings for the cards: a flat top with these sleeves / length / ease / neckline
function topIcon(o) {
  const T = { ...state.top, ...o }, sl = T.sl[0], e = clamp(T.ease, -4, 9), es = clamp(T.sEase, -4, 9), L = clamp(T.L, 38, 100), fl = Math.max(0, T.flare) * .12;
  const cx = 20, nwid = 3.2 + T.dNw * .35, nd = 1.5 + T.ndF * .2, top = 5, shY = 7.5, sh = 8.5 + es * .25, w = 7 + e * .35, armY = 15, hem = 7 + L * .3;
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
const TANK = () => { const s = 4 - (base().sw - base().nw - 1.5); return { sl: [s, s], ease: -5, sEase: -5, flare: 0, dNw: 1.5, ndF: 13, ndB: 4, neckV: 0 }; };
const CARDS = {
  sleeve: () => {
    const a = base().arm / 58, full = fullOf(state.top);
    const long = A ? r1(wristOf() + 1.5) : base().arm;   // just past the wrist, where a rib cuff sits
    return [['긴팔', { sl: [long, long] }], ['7부', { sl: [45 * a, 45 * a] }], ['5부', { sl: [33 * a, 33 * a] }], ['반팔', { sl: [20 * a, 20 * a] }],
      ['캡', { sl: [7, 7] }], ['민소매', { sl: [0, 0] }], ['넓은 끈', { sl: [3 - full, 3 - full] }], ['얇은 끈', { sl: [.8 - full, .8 - full] }], ['탱크톱', TANK()]];
  },
  len: () => { const k = state.body === 'm' ? 1.1 : 1; return [['크롭', { L: 42 * k }], ['기본', { L: 62 * k }], ['롱', { L: 76 * k }], ['원피스', { L: 96 * k }]]; },
  fit: () => [['밀착', { ease: -5, sEase: -5, flare: 0 }], ['슬림', { ease: -1.2, sEase: -1.2, flare: 0 }], ['기본', { ease: 0, sEase: 0, flare: 0 }], ['여유', { ease: 4, sEase: 4, flare: 1 }], ['오버', { ease: 9, sEase: 9, flare: 2 }]],
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
  $('lbl-fit').textContent = Math.abs(T.ease - T.sEase) < .05 ? fitName(T.ease) : `${fitName(T.ease)} · 소매 ${fitName(T.sEase)}`;
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
  ['sEase', '소매 품', () => LIM().sEase, .1, T => T.sEase, (T, v) => { T.sEase = v; }, fitName],
  ['flare', '밑단 폭', () => LIM().flare, .1, T => T.flare, (T, v) => { T.flare = v; }, v => `${v >= 0 ? '+' : ''}${v.toFixed(1)}cm`],
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
  renderSeg();
  if (k === 'body') await showBody(state.body); else initCloth();
  apply(); commit();
});
function renderSeg() {
  for (const [id, k] of [['body', 'body'], ['bottom', 'bottom']]) $(id).querySelectorAll('[data-v]').forEach(b => b.setAttribute('aria-pressed', state[k] === b.dataset.v));
}
document.querySelectorAll('.views [data-a]').forEach(b => b.addEventListener('click', () => {
  const a = +b.dataset.a, t = controls.target, d = camera.position.distanceTo(t), y = camera.position.y;
  const hr = Math.sqrt(Math.max(0, d * d - (y - t.y) ** 2));
  camera.position.set(t.x + hr * Math.sin(a), y, t.z + hr * Math.cos(a)); controls.update(); needs = true;
}));

// state → cloth, colours, panel. light = mid-drag (a bar, a colour): the colour labels only, not the whole colour panel
function apply(light) {
  sendParams();
  const T = state.top;
  fabricU.uC1.value.set(T.c1); fabricU.uC2.value.set(T.c2); fabricU.uPat.value = T.pat; fabricU.uScale.value = T.scale;
  fabric.sheenColor.set(T.c1).lerp(new THREE.Color('#ffffff'), .15);
  fabric.normalMap = fitOf(T.ease) > .5 ? rib2 : jersey;
  renderBars(); renderCards();
  if (light) { $('c1t').textContent = T.c1; $('c2t').textContent = T.c2; $('lbl-scale').textContent = `×${T.scale.toFixed(2)}`; }
  else renderColor();
  needs = true;
}

/* ---------- undo / save ---------- */
let hist = [JSON.stringify(state)], hi = 0;
function commit() {
  const s = JSON.stringify(state);
  if (s === hist[hi]) return;
  hist = hist.slice(0, hi + 1); hist.push(s); hi = hist.length - 1;
  sendParams(false, true);
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
  else fix(state.top);   // (the first entry is the saved value as it was, before the mannequin measured its limits)
  sendParams(false, true); apply(); save(); undoState();
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
// sleeve ends (on a side with no sleeve: the end of the shoulder), the hem's middle, its corners at the sides, the
// sides, the neckline's middle (front and back) and its ends. Each turns a drag into one of the pattern's numbers.
const tip = $('tip'), layer = $('layer');
const DOTS = [
  { k: 'sleeve', i: 0 }, { k: 'sleeve', i: 1 }, { k: 'hem', i: 0 }, { k: 'hem', i: 1 }, { k: 'hemSide', i: 0 }, { k: 'hemSide', i: 1 }, { k: 'side', i: 0 }, { k: 'side', i: 1 },
  { k: 'neck', i: 0 }, { k: 'neck', i: 1 }, { k: 'neckSide', i: 0 }, { k: 'neckSide', i: 1 },
];
const LABEL = { sleeve: '소매 끝', hem: '밑단', hemSide: '밑단 폭', side: '옆구리 (품)', neck: '목선', neckSide: '목 넓이' };
DOTS.forEach(d => {
  d.el = document.createElement('button');
  d.el.type = 'button';
  d.el.className = 'dot' + (d.k === 'hem' || d.k === 'hemSide' || d.k === 'side' ? ' sq' : '');
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
    // the point in hand stays where it is while the cloth is re-meshed under it (hiding it lost the drag)
    if (vi == null || vi < 0) { d.el.hidden = drag !== d; continue; }
    const P = cloth.geometry.attributes.position, N = cloth.geometry.attributes.normal;
    v3.fromBufferAttribute(P, vi); n3.fromBufferAttribute(N, vi);
    // shown only on the side you look at (sleeves and sides sit on the outline: shown unless well behind)
    const toCam = new THREE.Vector3().subVectors(camera.position, v3);
    // neckline and hem points by which way they face round the body (a neck edge curls up or over: its normal says little)
    if (d.k === 'neck' || d.k === 'hem') { n3.set(0, 0, d.i ? -1 : 1); toCam.y = 0; }
    const facing = n3.dot(toCam.normalize());
    const lim = d.k === 'sleeve' || d.k === 'side' || d.k === 'hemSide' ? -.55 : d.k === 'neckSide' ? -.3 : 0;
    const [x, y] = project(v3);
    d.sx = x; d.sy = y; d.p = v3.clone();
    d.el.style.transform = `translate(${x}px, ${y}px)`;
    d.el.hidden = drag ? drag !== d : facing < lim || nearBump(d, vi);   // while dragging only the point in hand
    d.el.classList.toggle('on', drag === d);
  }
}
// a fixed point where the outline was pulled by hand: hidden (it sat on the drawn outline but moved a number, which
// carried the drawn bump along off where it was drawn); the edge's own point pulls it there
function nearBump(d, vi) {
  const pc = d.k === 'sleeve' && cloth.userData.info.has[d.i ? 'r' : 'l'] ? 2 + d.i : (d.k === 'hem' || d.k === 'neck') ? d.i : 0;
  const U = cloth.geometry.attributes.pat.array;
  return editNear(pc, U[vi * 2] * 100 - [0, 70, 140, 190][pc], U[vi * 2 + 1] * 100);
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
  d.x0 = e.clientX; d.y0 = e.clientY; d.start = structuredClone(state.top);
  // which way is "out" on screen: from the body's middle line at that height to the point
  const [ax, ay] = project(new THREE.Vector3(0, d.p.y, A.z0));
  const ox = d.sx - ax, oy = d.sy - ay, ol = Math.hypot(ox, oy);
  d.out = ol > 6 ? [ox / ol, oy / ol] : [1, 0];
  d.mpp = 2 * camera.position.distanceTo(d.p) * Math.tan(camera.fov * PI / 360) / canvas.getBoundingClientRect().height;
  // followed on the window, not the point: the point moves (and can be re-placed) under the pointer
  const id = e.pointerId, move = ev => { if (ev.pointerId === id) dragMove(ev, d); }, up = ev => {
    if (ev.pointerId !== id) return;
    removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
    drag = null; controls.enabled = true; tip.classList.remove('show'); commit(); apply();
  };
  addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', up);
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
  else if (d.k === 'hemSide') { T.flare = S.flare + out * 100; fix(T); label = `밑단 폭 ${T.flare >= 0 ? '+' : ''}${T.flare.toFixed(1)}cm`; }
  else if (d.k === 'side') { T.ease = S.ease + out * 100; fix(T); label = '품 ' + fitName(T.ease); }
  else if (d.k === 'neck') { const k = d.i ? 'ndB' : 'ndF'; T[k] = S[k] + down * 100; fix(T); label = `${d.i ? '뒤' : '앞'} 목 깊이 ${T[k].toFixed(1)}cm`; }
  else { T.dNw = S.dNw + out * 100; fix(T); label = `목 넓이 ${T.dNw >= 0 ? '+' : ''}${T.dNw.toFixed(1)}cm`; }
  apply(true);
  const r = layer.getBoundingClientRect();
  showTip(label, e.clientX - r.left, e.clientY - r.top);
}

/* ---------- the outline pulled anywhere ---------- */
// over a body panel's edge (hem, side, neckline, shoulder, armhole) a point shows where the pointer is nearest, and
// dragged it bumps the pattern's outline there (state.top.edit, pattern.js bend): left and right alike unless 왼쪽·오른쪽
// 같이 is off; side, shoulder and armhole front and back together (their seams must match), the hem and neckline too unless 앞뒤 같이 is off
const EDGE = { neck: '목선', shoulder: '어깨선', arm: '진동둘레', side: '옆선', hem: '밑단' }, EDGE_S = { und: '소매 옆선', hem: '소매 끝' };
const edgeName = (R, i) => (R.pc[i] >= 2 ? EDGE_S : EDGE)[R.names[R.curve[i]]];
const edgeDot = document.createElement('button');
edgeDot.type = 'button'; edgeDot.className = 'dot edge'; edgeDot.hidden = true;
edgeDot.setAttribute('aria-label', '옷 가장자리 점 — 끌어서 모양 바꾸기');
layer.appendChild(edgeDot);
let edgeI = -1;   // the rim entry under the point
// how much a rim vertex faces you, by which way it lies round the body (an edge curls: its normal says little)
function rimFacing(p) {
  const ox = p.x, oz = p.z - A.z0, tx = camera.position.x - p.x, tz = camera.position.z - p.z;
  return (ox * tx + oz * tz) / ((Math.hypot(ox, oz) || 1) * (Math.hypot(tx, tz) || 1));
}
// rim entries in view (facing you) → [index, x, y] in canvas px
function rimInView() {
  const R = cloth && !next && cloth.userData.rim, out = [];
  if (!R) return out;
  const P = cloth.geometry.attributes.position, r = canvas.getBoundingClientRect();
  for (let i = 0; i < R.v.length; i++) {
    v3.fromBufferAttribute(P, R.v[i]);
    if (rimFacing(v3) < -.35) continue;
    const [x, y] = project(v3);
    if (x >= 0 && y >= 0 && x <= r.width && y <= r.height) out.push([i, x, y, rimFacing(v3)]);
  }
  return out;
}
function placeEdge() {
  if (drag || edgeI < 0) return;
  const R = cloth && !next && cloth.userData.rim;
  if (!R || edgeI >= R.v.length) { edgeDot.hidden = true; edgeI = -1; return; }
  const [x, y] = project(v3.fromBufferAttribute(cloth.geometry.attributes.position, R.v[edgeI]));
  edgeDot.style.transform = `translate(${x}px, ${y}px)`;
}
const hideEdge = () => { edgeDot.hidden = true; edgeI = -1; tip.classList.remove('show'); };
// (on the window: over a fixed point's wide grip the canvas hears nothing, and the edge's point may still show there)
addEventListener('pointermove', e => {
  if (drag || e.buttons) return;
  if (e.target !== canvas && !(e.target.closest && e.target.closest('#layer'))) { if (edgeI >= 0) hideEdge(); return; }
  const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
  // (a fixed point keeps the spot it is drawn on; around it, where its wider grip reaches, the edge's point is on top)
  const nearDot = DOTS.some(d => !d.el.hidden && Math.hypot(d.sx - x, d.sy - y) < 9);
  let best = -1, bd = 14 * 14;
  if (!nearDot) for (const [i, px, py, f] of rimInView()) { const d = (px - x) ** 2 + (py - y) ** 2 - f * 4; if (d < bd) { bd = d; best = i; } }
  edgeI = best; edgeDot.hidden = best < 0;
  if (best >= 0) { placeEdge(); const R = cloth.userData.rim; showTip(edgeName(R, best), x, y); }
  else if (e.target === canvas || e.target === edgeDot) tip.classList.remove('show');   // (a fixed point shows its own)
});
edgeDot.addEventListener('pointerdown', e => {
  const R = cloth && cloth.userData.rim;
  if (!R || edgeI < 0) return;
  e.preventDefault(); e.stopPropagation();
  const i = edgeI, curve = R.names[R.curve[i]], pc = R.pc[i], half = R.half[i];
  const p = v3.fromBufferAttribute(cloth.geometry.attributes.position, R.v[i]).clone(), [sx, sy] = project(p);
  const d = { k: 'edge', curve, name: edgeName(R, i), t: Math.round(R.t[i] * 1000) / 1000, x0: e.clientX, y0: e.clientY, start: structuredClone(state.top), along: [0, 1] };
  if (pc >= 2) {
    // a sleeve: both alike while 좌우 같이 is on; "down" is along the arm (shoulder → cuff on screen), "out" across it
    // away from the arm's middle line, the line from the shoulder's end to the middle of the cuff
    d.keys = $('sym').checked ? ['Sl', 'Sr'] : [pc === 2 ? 'Sl' : 'Sr'];
    d.local = 0;
    const P = cloth.geometry.attributes.position, c = new THREE.Vector3();
    let n = 0;
    for (let j = 0; j < R.v.length; j++) if (R.pc[j] === pc && R.names[R.curve[j]] === 'hem') { c.add(v3.fromBufferAttribute(P, R.v[j])); n++; }
    const [hx, hy] = project(c.divideScalar(n)), [ux, uy] = project(v3.fromBufferAttribute(P, cloth.userData.marks.shoulder[pc - 2]));
    const al = Math.hypot(hx - ux, hy - uy) || 1, ax = (hx - ux) / al, ay = (hy - uy) / al, sg = (sx - hx) * -ay + (sy - hy) * ax < 0 ? -1 : 1;
    d.along = [ax, ay]; d.out = [-ay * sg, ax * sg];
  } else {
    // which panels, and whether it keeps to its own curve (a free edge pulled on one panel: its corner is sewn to the other)
    const both = !(curve === 'neck' || curve === 'hem') || $('fb').checked;
    d.keys = (both ? ['F', 'B'] : [pc ? 'B' : 'F']).flatMap(k => $('sym').checked ? [k + 'p', k + 'm'] : [k + (half ? 'm' : 'p')]);
    d.local = both ? 0 : 1;
    const [ax, ay] = project(new THREE.Vector3(0, p.y, A.z0)), ox = sx - ax, oy = sy - ay, ol = Math.hypot(ox, oy);
    d.out = ol > 6 ? [ox / ol, oy / ol] : [half ? -1 : 1, 0];
  }
  d.mpp = 2 * camera.position.distanceTo(p) * Math.tan(camera.fov * PI / 360) / canvas.getBoundingClientRect().height;
  drag = d; controls.enabled = false; edgeDot.classList.add('on');
  const id = e.pointerId, move = ev => { if (ev.pointerId === id) edgeMove(ev, d); }, up = ev => {
    if (ev.pointerId !== id) return;
    removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
    drag = null; controls.enabled = true; edgeDot.classList.remove('on'); edgeDot.hidden = true; edgeI = -1;
    tip.classList.remove('show'); commit(); apply();
  };
  addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', up);
});
// the bump at k of (dx, dy): the start's bumps and this one
const withBump = (d, dx, dy, k) => {
  const T = structuredClone(d.start), E = T.edit = T.edit || {};
  for (const key of d.keys) {
    // (as wide as it is far, about: a long pull 6 cm wide was a tongue, and pulls side by side 6 cm wide a sharp zigzag)
    const b = [d.curve, d.t, r1(dx * k), r1(dy * k), r1(Math.max(8, Math.hypot(dx, dy) * k * 1.2))];
    if (!b[2] && !b[3]) continue;   // (a click, or a pull stopped at once: nothing drawn, nothing kept)
    if (d.local) b.push(1);
    E[key] = [...(E[key] || []), b];
  }
  return T;
};
// still whole pieces (piecesOk) against the start; a start that already fails isn't held
function edgeOk(T, d) {
  const s0 = d.s0 || (d.s0 = sleeves(params(d.start)));
  if (d.ok0 == null) d.ok0 = piecesOk(d.start, sleeves(params({ ...d.start, edit: undefined })));
  return !d.ok0 || piecesOk(T, s0);
}
function edgeMove(e, d) {
  const px = e.clientX - d.x0, py = e.clientY - d.y0, down = (px * d.along[0] + py * d.along[1]) * d.mpp * 100, out = (px * d.out[0] + py * d.out[1]) * d.mpp * 100;
  // at most 15 cm at once; dragged further than the outline can take, it stops where it still can
  const l = Math.hypot(out, down), s = l > 15 ? 15 / l : 1, dx = out * s, dy = -down * s;
  let k = 1;
  if (!edgeOk(withBump(d, dx, dy, 1), d)) {
    let lo = 0, hi = 1;
    for (let it = 0; it < 7; it++) { const m = (lo + hi) / 2; if (edgeOk(withBump(d, dx, dy, m), d)) lo = m; else hi = m; }
    k = lo;
  }
  state.top = withBump(d, dx, dy, k);
  apply(true);
  const r = layer.getBoundingClientRect();
  edgeDot.style.transform = `translate(${e.clientX - r.left}px, ${e.clientY - r.top}px)`;
  showTip(`${d.name} ${(Math.hypot(dx, dy) * k).toFixed(1)}cm${k < .999 ? ' · 더는 안 돼요' : ''}`, e.clientX - r.left, e.clientY - r.top);
}
// for the checks (tools/harness.mjs): a rim point on the page — by curve and fraction, or the f-th of those in view
function edgePoint(pc, curve, at, half = 'p') {
  const R = cloth && cloth.userData.rim, ci = R ? R.names.indexOf(curve) : -1, h = half === 'm' ? 1 : 0;
  if (ci < 0) return null;
  const view = new Map(rimInView().map(q => [q[0], q]));
  let best = null, bd = 1e9;
  for (let i = 0; i < R.v.length; i++) if (R.pc[i] === pc && R.half[i] === h && R.curve[i] === ci && view.has(i) && Math.abs(R.t[i] - at) < bd) { bd = Math.abs(R.t[i] - at); best = view.get(i); }
  const r = canvas.getBoundingClientRect();
  return best && [r.left + best[1], r.top + best[2]];
}
function edgeAt(f) {
  const v = rimInView(), q = v[Math.floor(clamp(f, 0, .999) * v.length)], r = canvas.getBoundingClientRect();
  return q ? [r.left + q[1], r.top + q[2]] : null;
}
// a cloth point near a bump (metrics.js: an outline drawn by hand stands where it was drawn, it is no ear)
const editNear = (pc, x, y) => (cloth && cloth.userData.info.bumps || []).some(b => b[0] === pc && Math.hypot(x - b[1], y - b[2]) < b[3] + 2);

/* ---------- PNG ---------- */
$('png').addEventListener('click', () => {
  const w = 1000, h = 1500, keep = [camera.aspect];
  DOTS.forEach(d => { d.el.hidden = true; }); edgeDot.hidden = true;
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
  placeDots(); placeEdge();
  if (t - lastStat > 400 && t - sayT > 2500) { lastStat = t; $('status').textContent = cloth ? `천 ${awake ? '움직이는 중' : '멈춤'} · 계산 ${simMs.toFixed(1)}ms` : ''; }
})(0);

fix(state.top);
renderSeg(); apply(); undoState();
showBody(state.body);
window.__studio = { get state() { return state; }, apply, showBody, camera, controls, get cloth() { return cloth; }, get awake() { return awake; }, get A() { return A; }, composer, renderer, params, edgePoint, edgeAt, editNear,
  editOk: () => piecesOk(state.top, sleeves(params({ ...state.top, edit: undefined }))),
  // how far in (cm) a side's armhole was pulled by hand, at most: its sleeve sits that much further up the arm
  armIn: s => {
    const e = sleeves(params(state.top)).h, o = sleeves(params({ ...state.top, edit: undefined })).h, n = 24;
    return Math.max(0, ...(s === 'l' ? ['Fp', 'Bp'] : ['Fm', 'Bm']).flatMap(k => { const a = resample(o[k].arm, n), b = resample(e[k].arm, n); return a.map((p, i) => p[0] - b[i][0]); }));
  } };
