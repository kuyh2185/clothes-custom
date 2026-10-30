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
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { smoothChest, tuckUnder } from './mannequin.js?v=1';
import { BASE, BASE_M, applyCuts, fitSide, halfOk, halves, inside, resample, sleeves, sleeveOk } from './pattern.js?v=34';

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
// So does a fitted sleeve on a looser body: in the deep armhole its narrow cap stood tall and dragged the sleeve up the arm.
// A loose sleeve on a fitted body rises less, the more it is wider than the body (8 cm wider on, up to 4 cm lower): just
// under the armpit its wide flat cap stood out off the shoulder, a cap sleeve 5 cm up the arm (fuzz 162, 394). Only
// with a sleeve: a strap top's armhole dropped by the sleeves' unused ease stood off in an ear (r18)
const adOf = T => {
  const ad = base().ad + Math.max(0, T.sEase - 2) * .85, m = A && measure();
  return m ? lerp(ad, Math.min(ad, m.armpit + 2.5 + (Math.max(...T.sl) >= 1.2 ? clamp((T.sEase - T.ease - 8) * .4, 0, 4) : 0)), fitOf(Math.min(T.ease, T.sEase))) : ad;
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
    cuts: T.cuts && T.cuts.length ? T.cuts : undefined,
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
  const from = sleeves(params({ ...T, edit: undefined, cuts: undefined }));
  if (piecesOk(T, from)) return;
  const E0 = structuredClone(T.edit), scale = k => { for (const key in E0) T.edit[key] = E0[key].map(b => [b[0], b[1], r1(b[2] * k), r1(b[3] * k), ...b.slice(4)]); };
  let lo = 0, hi = 1;
  for (let it = 0; it < 7; it++) { const m = (lo + hi) / 2; scale(m); if (piecesOk(T, from)) lo = m; else hi = m; }
  scale(lo);
  for (const key in T.edit) T.edit[key] = T.edit[key].filter(b => b[2] || b[3]);   // (shrunk to nothing: gone)
}
// the pieces still whole (pattern.js halfOk, sleeveOk), each against `from`'s (a side or an underarm comes in no further
// than the body or arm allows, or than it already was). On the outline before any scissors cut: a cut is its own check
function piecesOk(T, from) {
  const m = measure(), s = sleeves(params({ ...T, cuts: undefined })), h = s.h, h0 = from.h;
  return ['Fp', 'Fm', 'Bp', 'Bm'].every(k => halfOk(h[k], h0[k], m.q, h[k[0]]))
    && ['l', 'r'].every(k => !s[k] || sleeveOk(s[k].H, (from[k] || s[k]).H, s.sl[k].capb, m.arm, h.P.arm + h.P.over, s[k].H0));
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
  const css = getComputedStyle(document.documentElement), wl = parseFloat(css.getPropertyValue('--wl')), wr = parseFloat(css.getPropertyValue('--wr')) + parseFloat(css.getPropertyValue('--wf')) + 14;
  shiftX = (wl - wr) / 2;   // (the flat top's panel beside the right one)
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
const worker = new Worker('cloth.js?v=56', { type: 'module' });
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
  sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 pat; attribute float cut; varying vec2 vPat; varying float vCut;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPat = pat; vCut = cut;');
  // colour and print follow the fabric's grain (the flat pattern), so stripes run round the body and across a sleeve
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vPat; varying float vCut; uniform vec3 uC1; uniform vec3 uC2; uniform float uPat; uniform float uScale;')
    .replace('#include <map_fragment>', `#include <map_fragment>
vec3 base = uC1;
vec2 q = vPat / uScale;
if (uPat > .5 && uPat < 1.5) { if (fract(q.y / .05) < .4) base = uC2; }
else if (uPat > 1.5 && uPat < 2.5) { float b = step(fract(q.y / .06), .42) + step(fract(q.x / .06), .42); base = mix(uC1, uC2, min(1.0, b) * .55 + step(1.5, b) * .3); }
else if (uPat > 2.5) { vec2 g = q / .028; vec2 c = fract(g + vec2(.5 * mod(floor(g.y), 2.0), 0.0)) - .5; if (length(c) < .27) base = uC2; }
diffuseColor.rgb = gl_FrontFacing ? base : base * .72;   // the inside of the garment a shade darker
// what the scissors would cut off: half see-through, in the scissors' gold stripes (see-through alone, a front cut off
// over the back's own white inside hardly showed) (setFade)
float stripe = step(.5, fract((gl_FragCoord.x + gl_FragCoord.y) / 18.0));
float pick = step(1.5, vCut), cutv = min(vCut, 1.0);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.95, .66, .22), cutv * (.3 + .5 * stripe) * (1.0 - .4 * pick)); diffuseColor.a *= 1.0 - .5 * cutv * (1.0 - pick);`);
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
    g.setAttribute('cut', new THREE.BufferAttribute(new Float32Array(n), 1));
    g.setIndex(new THREE.BufferAttribute(t.index, 1));
    if (!cloth) { cloth = new THREE.Mesh(g, fabric); cloth.castShadow = cloth.receiveShadow = true; cloth.frustumCulled = false; scene.add(cloth); }
    else { cloth.geometry.dispose(); cloth.geometry = g; }
    cloth.userData = { map: t.map, marks: t.marks, info: t.info, rim: t.rim, pcv: t.pcv };
    if (grip) gripFade();   // (a new mesh comes without the picked place's stripes)
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
  if (!light) closeGrip();   // (any other change: the bar's start is no longer what is worn)
  drawFlat(!light);
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
// pull moves things the long way only (the user, 2026-10-30): the points that widen are hidden, widths are the 통 tool's
const WIDE = new Set(['hemSide', 'side', 'neckSide']);
DOTS.forEach(d => {
  d.el = document.createElement('button');
  d.el.type = 'button';
  d.el.className = 'dot' + (d.k === 'hem' || d.k === 'hemSide' || d.k === 'side' ? ' sq' : '');
  d.el.setAttribute('aria-label', LABEL[d.k] + ' 점 — 끌어서 바꾸기');
  d.el.addEventListener('pointerdown', e => dragStart(e, d));
  d.el.addEventListener('pointerenter', () => { if (!drag) { showTip(LABEL[d.k], d.sx, d.sy); setPullT(d); } });
  d.el.addEventListener('pointerleave', () => { if (!drag) { tip.classList.remove('show'); if (pullT === d) setPullT(null); } });
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
    d.el.hidden = drag ? drag !== d : tool !== 'pull' || WIDE.has(d.k) || facing < lim || nearBump(d, vi);   // while dragging only the point in hand
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
// bad: why a pull stopped, in red
function showTip(text, x, y, bad) {
  tip.textContent = text; tip.classList.toggle('no', !!bad);
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
  pullBegin(d);
  // followed on the window, not the point: the point moves (and can be re-placed) under the pointer
  const id = e.pointerId, move = ev => { if (ev.pointerId === id) dragMove(ev, d); }, up = ev => {
    if (ev.pointerId !== id) return;
    removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
    drag = null; controls.enabled = true; tip.classList.remove('show'); pullEnd(); commit(); apply();
  };
  addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', up);
}
// why a length stops where fix() held it: [shorter, longer]
const STOP = { sleeve: ['끈은 이보다 좁게 못 해요', '손을 다 덮는 데까지예요'], hem: ['겨드랑이 바로 아래까지예요', '더 길게는 못 해요'], neck: ['목선은 더 못 올려요', '더 깊게는 못 파요'] };
// a length (the sleeve, the hem, a neckline's depth) set to v from the drag's start, held to its range → [label, why it stopped]
function setLen(d, v) {
  const T = state.top, S = d.start;
  T.sl = S.sl.slice();
  let got, label;
  if (d.k === 'sleeve') {   // past nothing the shoulder narrows into a strap
    T.sl[d.i] = v; if ($('sym').checked) T.sl[1 - d.i] = v;
    fix(T); got = T.sl[d.i]; label = sleeveName(got);
  } else if (d.k === 'hem') { T.L = v; fix(T); got = T.L; label = lenName(got); }
  else { const k = d.i ? 'ndB' : 'ndF'; T[k] = v; fix(T); got = T[k]; label = `${d.i ? '뒤' : '앞'} 목 깊이 ${got.toFixed(1)}cm`; }
  return [label, Math.abs(v - got) > .05 ? STOP[d.k][v < got ? 0 : 1] : ''];
}
function dragMove(e, d) {
  const dx = e.clientX - d.x0, dy = e.clientY - d.y0, down = dy * d.mpp, out = (dx * d.out[0] + dy * d.out[1]) * d.mpp;
  const T = state.top, S = d.start;
  let label, why = '';
  // down / out the sleeve grows, up / in it shortens
  if (d.k === 'sleeve') [label, why] = setLen(d, S.sl[d.i] + (down + out * .6) * 80);
  else if (d.k === 'hem') [label, why] = setLen(d, S.L + down * 100);
  else if (d.k === 'neck') [label, why] = setLen(d, S[d.i ? 'ndB' : 'ndF'] + down * 100);
  else {
    T.sl = S.sl.slice();
    if (d.k === 'hemSide') { T.flare = S.flare + out * 100; fix(T); label = `밑단 폭 ${T.flare >= 0 ? '+' : ''}${T.flare.toFixed(1)}cm`; }
    else if (d.k === 'side') { T.ease = S.ease + out * 100; fix(T); label = '품 ' + fitName(T.ease); }
    else { T.dNw = S.dNw + out * 100; fix(T); label = `목 넓이 ${T.dNw >= 0 ? '+' : ''}${T.dNw.toFixed(1)}cm`; }
  }
  apply(true);
  const r = layer.getBoundingClientRect();
  showTip(why ? `${label} · ${why}` : label, e.clientX - r.left, e.clientY - r.top, why);
}

/* ---------- what a pull moves, shown (2026-10-30) ---------- */
// the user: "pulling is hard to read, I can't tell what moves where". Before you press, the edge a point (or the
// edge's point) would move is a gold line on the cloth and on the flat top; while it is dragged, where that edge was
// stays dashed on both (the cloth takes a moment to follow the pattern)
let pullT = null;   // the point or edge under the pointer: a DOTS entry, an edge target, or { k: 'hem' | 'sleeve', i } off the flat top
const setPullT = t => { if (t !== pullT) { pullT = t; if (A) drawFlat(); } };
const hotMat = new LineMaterial({ color: 0xf2c46b, linewidth: 3 }), ghostMat = new LineMaterial({ color: 0xf5f2ea, linewidth: 2, dashed: true, dashSize: .012, gapSize: .009 });
const hotLine = new LineSegments2(new LineSegmentsGeometry(), hotMat), ghostLine = new LineSegments2(new LineSegmentsGeometry(), ghostMat);
for (const l of [hotLine, ghostLine]) { l.visible = false; l.frustumCulled = false; l.renderOrder = 2; scene.add(l); }
// the rim entries (cloth.userData.rim) a pull of t would move
function pullRim(t) {
  const R = cloth && !next && cloth.userData.rim, out = [];
  if (!R || !t) return out;
  const ci = n => R.names.indexOf(n), has = cloth.userData.info.has, pick = f => { for (let j = 0; j < R.v.length; j++) if (f(j)) out.push(j); return out; };
  if (t.k === 'hem') return pick(j => R.pc[j] < 2 && R.curve[j] === ci('hem'));
  if (t.k === 'neck') return pick(j => R.pc[j] === t.i && R.curve[j] === ci('neck'));
  if (t.k === 'sleeve') {
    const sides = $('sym').checked ? [0, 1] : [t.i];   // (a side with no sleeve: its shoulder, which a strap narrows)
    return pick(j => sides.some(i => has[i ? 'r' : 'l'] ? R.pc[j] === 2 + i && R.curve[j] === ci('hem') : R.pc[j] < 2 && R.half[j] === i && R.curve[j] === ci('shoulder')));
  }
  if (t.k !== 'edge') return out;
  // an edge: on each piece and half it bumps, as far along the outline as the bump reaches (pattern.js bend: r cm)
  const U = cloth.geometry.attributes.pat.array, c = ci(t.curve);
  const on = new Set(t.keys.flatMap(k => k[0] === 'S' ? [k === 'Sl' ? '20' : '30', k === 'Sl' ? '21' : '31'] : [(k[0] === 'F' ? '0' : '1') + (k[1] === 'p' ? '0' : '1')]));
  for (let j0 = 0, j1; j0 < R.v.length; j0 = j1) {
    for (j1 = j0; j1 < R.v.length && R.pc[j1] === R.pc[j0] && R.half[j1] === R.half[j0];) j1++;
    if (!on.has(`${R.pc[j0]}${R.half[j0]}`)) continue;
    const s = [0];
    for (let j = j0 + 1; j < j1; j++) s.push(s[s.length - 1] + Math.hypot(U[R.v[j] * 2] - U[R.v[j - 1] * 2], U[R.v[j] * 2 + 1] - U[R.v[j - 1] * 2 + 1]) * 100);
    let a = -1, b = -1;
    for (let j = j0; j < j1; j++) if (R.curve[j] === c) { if (a < 0) a = s[j - j0]; b = s[j - j0]; }
    if (a < 0) continue;
    const st = lerp(a, b, t.t);
    for (let j = j0; j < j1; j++) if (Math.abs(s[j - j0] - st) <= t.r && (!t.local || R.curve[j] === c)) out.push(j);
  }
  return out;
}
// those entries as line segments on the cloth as it hangs now, a little off it along its normal (as the scissors' ring)
function rimSegs(sel) {
  const R = cloth.userData.rim, P = cloth.geometry.attributes.position.array, N = cloth.geometry.attributes.normal.array, on = new Set(sel), out = [];
  const pt = v => [0, 1, 2].map(k => P[v * 3 + k] + N[v * 3 + k] * .004);
  for (const j of sel) if (on.has(j + 1) && R.pc[j + 1] === R.pc[j] && R.half[j + 1] === R.half[j]) out.push(...pt(R.v[j]), ...pt(R.v[j + 1]));
  return out;
}
function setLine(l, segs) {
  l.geometry.dispose(); l.geometry = new LineSegmentsGeometry().setPositions(segs);
  if (l.material.dashed) l.computeLineDistances();
  const r = canvas.getBoundingClientRect(); l.material.resolution.set(r.width, r.height);
  l.visible = segs.length > 0; needs = true;
}
let pullLast = null;
// each frame: the gold line rides on the cloth while it moves (drawn anew only when it moved or another edge is meant)
function drawPull() {
  const t = cloth && !next && (drag || (tool === 'pull' || pullT && pullT.flat) && pullT);   // (the flat top's ends: in any tool)
  if (!t) { if (hotLine.visible) { hotLine.visible = false; needs = true; } pullLast = null; return; }
  const key = [t, t.r, cloth.geometry, $('sym').checked, $('fb').checked];
  if (!awake && pullLast && key.every((v, i) => v === pullLast[i])) return;
  pullLast = key;
  setLine(hotLine, rimSegs(pullRim(t)));
}
// the flat top and the edge as they were when a pull starts, dashed while it is dragged
let flatGhost = null;
function pullBegin(d) {
  pullT = null; flatGhost = flat && { body: flat.body, back: flat.back, sl: ['l', 'r'].map(k => flat.sl[k] && flat.sl[k].poly).filter(Boolean) };
  if (cloth && !next) setLine(ghostLine, rimSegs(pullRim(d)));
}
function pullEnd() { ghostLine.visible = false; flatGhost = null; needs = true; }
// the edge the gold line runs along, on the flat top (a body piece's pattern as is, a sleeve folded along its middle line)
function flatHotPath() {
  const t = !drag && pullT, R = t && cloth && !next && cloth.userData.rim;
  if (!R || !flat) return '';
  const U = cloth.geometry.attributes.pat.array, pcv = cloth.userData.pcv, sel = pullRim(t), on = new Set(sel);
  const fp = v => {
    const pc = pcv[v], x = U[v * 2] * 100 - SHIFT[pc], y = U[v * 2 + 1] * 100;
    if (pc < 2) return [x, -y];
    const F = flat.sl[pc === 2 ? 'l' : 'r'];
    if (!F || !F.m) return null;
    const p = F.m([Math.abs(x), y]);
    return [F.sg * p[0], p[1]];
  };
  let d = '';
  for (const j of sel) if (on.has(j + 1) && R.pc[j + 1] === R.pc[j] && R.half[j + 1] === R.half[j]) {
    const a = fp(R.v[j]), b = fp(R.v[j + 1]);
    if (a && b) d += `M${a[0].toFixed(2)} ${a[1].toFixed(2)}L${b[0].toFixed(2)} ${b[1].toFixed(2)}`;
  }
  return d;
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
const hideEdge = () => { edgeDot.hidden = true; edgeI = -1; tip.classList.remove('show'); if (pullT && pullT.k === 'edge') setPullT(null); };
// (on the window: over a fixed point's wide grip the canvas hears nothing, and the edge's point may still show there)
addEventListener('pointermove', e => {
  if (drag || e.buttons) return;
  if (tool !== 'pull' || e.target !== canvas && !(e.target.closest && e.target.closest('#layer'))) { if (edgeI >= 0) hideEdge(); return; }
  const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
  // (a fixed point keeps the spot it is drawn on; around it, where its wider grip reaches, the edge's point is on top)
  const nearDot = DOTS.some(d => !d.el.hidden && Math.hypot(d.sx - x, d.sy - y) < 9);
  let best = -1, bd = 14 * 14;
  // (not the side seams, a body's or a sleeve's: pulled the long way they only slide along themselves)
  const R0 = cloth && cloth.userData.rim, along = i => { const nm = R0.names[R0.curve[i]]; return nm !== 'side' && nm !== 'und'; };
  if (!nearDot) for (const [i, px, py, f] of rimInView()) { const d = (px - x) ** 2 + (py - y) ** 2 - f * 4; if (d < bd && along(i)) { bd = d; best = i; } }
  if (best !== edgeI || best >= 0 && !pullT) { if (best >= 0) setPullT(edgeTarget(best)); else if (pullT && pullT.k === 'edge') setPullT(null); }
  edgeI = best; edgeDot.hidden = best < 0;
  if (best >= 0) { placeEdge(); const R = cloth.userData.rim; showTip(edgeName(R, best), x, y); }
  else if (e.target === canvas || e.target === edgeDot) tip.classList.remove('show');   // (a fixed point shows its own)
});
edgeDot.addEventListener('pointerdown', e => {
  const R = cloth && cloth.userData.rim;
  if (!R || edgeI < 0) return;
  e.preventDefault(); e.stopPropagation();
  const i = edgeI, pc = R.pc[i];
  const p = v3.fromBufferAttribute(cloth.geometry.attributes.position, R.v[i]).clone();
  const d = Object.assign(edgeTarget(i), { x0: e.clientX, y0: e.clientY, start: structuredClone(state.top), along: [0, 1] });
  if (pc >= 2) {
    // "down" on a sleeve is along the arm (shoulder → cuff on screen)
    const P = cloth.geometry.attributes.position, c = new THREE.Vector3();
    let n = 0;
    for (let j = 0; j < R.v.length; j++) if (R.pc[j] === pc && R.names[R.curve[j]] === 'hem') { c.add(v3.fromBufferAttribute(P, R.v[j])); n++; }
    const [hx, hy] = project(c.divideScalar(n)), [ux, uy] = project(v3.fromBufferAttribute(P, cloth.userData.marks.shoulder[pc - 2]));
    const al = Math.hypot(hx - ux, hy - uy) || 1;
    d.along = [(hx - ux) / al, (hy - uy) / al];
  }
  d.mpp = 2 * camera.position.distanceTo(p) * Math.tan(camera.fov * PI / 360) / canvas.getBoundingClientRect().height;
  pullBegin(d);
  drag = d; controls.enabled = false; edgeDot.classList.add('on');
  const id = e.pointerId, move = ev => { if (ev.pointerId === id) edgeMove(ev, d); }, up = ev => {
    if (ev.pointerId !== id) return;
    removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
    drag = null; controls.enabled = true; edgeDot.classList.remove('on'); edgeDot.hidden = true; edgeI = -1;
    tip.classList.remove('show'); pullEnd(); commit(); apply();
  };
  addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', up);
});
// the edge at rim entry i as a pull's target: which halves it bumps (keys), and whether it keeps to its own curve;
// r: how far along the outline it reaches (withBump's, at least 8 cm)
function edgeTarget(i) {
  const R = cloth.userData.rim, curve = R.names[R.curve[i]], pc = R.pc[i], half = R.half[i], sym = $('sym').checked;
  const d = { k: 'edge', curve, pc, name: edgeName(R, i), t: Math.round(R.t[i] * 1000) / 1000, r: 8, local: 0 };
  // a sleeve: both alike while 좌우 같이 is on
  if (pc >= 2) d.keys = sym ? ['Sl', 'Sr'] : [pc === 2 ? 'Sl' : 'Sr'];
  else {
    // which panels, and whether it keeps to its own curve (a free edge pulled on one panel: its corner is sewn to the other)
    const both = !(curve === 'neck' || curve === 'hem') || $('fb').checked;
    d.keys = (both ? ['F', 'B'] : [pc ? 'B' : 'F']).flatMap(k => sym ? [k + 'p', k + 'm'] : [k + (half ? 'm' : 'p')]);
    d.local = both ? 0 : 1;
  }
  return d;
}
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
  const s0 = d.s0 || (d.s0 = sleeves(params({ ...d.start, cuts: undefined })));
  if (d.ok0 == null) d.ok0 = piecesOk(d.start, sleeves(params({ ...d.start, edit: undefined, cuts: undefined })));
  return !d.ok0 || piecesOk(T, s0);
}
function edgeMove(e, d) {
  // the long way only (down the body, along the arm); at most 15 cm at once; dragged further than the outline can take,
  // it stops where it still can
  const px = e.clientX - d.x0, py = e.clientY - d.y0, down = (px * d.along[0] + py * d.along[1]) * d.mpp * 100;
  const dx = 0, dy = -clamp(down, -15, 15);
  let k = 1;
  if (!edgeOk(withBump(d, dx, dy, 1), d)) {
    let lo = 0, hi = 1;
    for (let it = 0; it < 7; it++) { const m = (lo + hi) / 2; if (edgeOk(withBump(d, dx, dy, m), d)) lo = m; else hi = m; }
    k = lo;
  }
  state.top = withBump(d, dx, dy, k);
  d.r = Math.max(8, Math.hypot(dx, dy) * k * 1.2);   // (withBump's reach: the gold line follows it)
  apply(true);
  const r = layer.getBoundingClientRect();
  edgeDot.style.transform = `translate(${e.clientX - r.left}px, ${e.clientY - r.top}px)`;
  // (the shoulder line and a neckline pulled up have rules of their own, pattern.js halfOk; elsewhere it is the outline's shape)
  const why = k >= .999 ? '' : d.curve === 'shoulder' ? '어깨선은 1.5cm 안에서만 움직여요' : d.curve === 'neck' && dy > 0 ? '목선은 어깨보다 위로 못 올려요' : '여기까지예요 — 더 당기면 옷본 선이 꼬여요';
  showTip(`${d.name} ${(Math.hypot(dx, dy) * k).toFixed(1)}cm${why ? ' · ' + why : ''}`, e.clientX - r.left, e.clientY - r.top, why);
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

/* ---------- tools: scissors and pull ---------- */
// scissors: over the cloth a ring shows where it would be cut — round the body at that depth of the pattern (the hem
// goes there), round both sleeves at that length, or near the top of a sleeve its whole armhole seam (sleeveless);
// a click cuts there. Pull: the fixed points and the edge's point as before (2단계)
let tool = 'cut', hov = null;
const HINT = { cut: '가위 — 옷 위에 올리면 노란 선, 누르면 거기서 잘려요(소매는 양쪽 같이). 누른 채 그으면 그은 대로 잘려요. 잘릴 곳은 반투명하게 보여요.', pull: '당기기 — 흰 점이나 옷 가장자리를 위아래(소매는 팔 방향)로 끌어 길이를 바꿔요. 올리면 움직일 곳이 금색 선, 끄는 동안 원래 자리는 점선. 펼친 모양의 밑단·소매 끝 선을 끌어도 돼요. 폭은 통 도구로.', fit: '통 — 펼친 모양에서 위아래로 끌어 범위를 고르고(옷을 누르면 그 자리), 금색 손잡이나 막대로 한 번에 줄이거나 늘려요.' };
function setTool(t) {
  tool = t;
  document.querySelectorAll('#tools [data-t]').forEach(b => b.setAttribute('aria-pressed', b.dataset.t === t));
  $('hint').textContent = HINT[t] + ' 빈 곳을 끌면 돌려 보기, 휠로 확대.';
  hideRing(); hideEdge(); closeGrip(); pullT = null;
}
$('tools').addEventListener('click', e => { const b = e.target.closest('[data-t]'); if (b) setTool(b.dataset.t); });
const ringMat = new LineMaterial({ color: 0xf2c46b, linewidth: 3 });
const cutLine = new LineSegments2(new LineSegmentsGeometry(), ringMat);
cutLine.visible = false; cutLine.frustumCulled = false; cutLine.renderOrder = 2;
scene.add(cutLine);
function hideRing() { if (hov) { hov = null; cutLine.visible = false; needs = true; tip.classList.remove('show'); setFade(null); } }
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), SHIFT = [0, 70, 140, 190];
// the cloth under the pointer: its piece, the pattern there (cm: x across, y up from the high shoulder point / down the
// sleeve from the cap's top, negative) and the point a little toward you; null off the cloth
function hitAt(e) {
  if (!cloth || next || !cloth.userData.pcv) return null;
  const r = canvas.getBoundingClientRect();
  ray.setFromCamera(ndc.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1), camera);
  const h = ray.intersectObject(cloth)[0];
  if (!h) return null;
  const pc = cloth.userData.pcv[h.face.a];
  return { pc, x: h.uv.x * 100 - SHIFT[pc], y: h.uv.y * 100, p: h.point.clone().addScaledVector(ray.ray.direction, -.004) };
}
// the cloth's vertices that fn(pc, x, y) says would be cut off shown half see-through (null: none); mark 2: the place
// picked to pull, in the same stripes but solid
function setFade(fn, mark = 1) {
  const a = cloth && cloth.geometry.attributes.cut;
  if (!a) return;
  const U = cloth.geometry.attributes.pat.array, pcv = cloth.userData.pcv;
  let any = false;
  for (let v = 0; v < a.count; v++) { const f = fn && fn(pcv[v], U[v * 2] * 100 - SHIFT[pcv[v]], U[v * 2 + 1] * 100) ? mark : 0; a.array[v] = f; any ||= f === 1; }
  a.needsUpdate = true;
  if (fabric.transparent !== any) { fabric.transparent = any; fabric.needsUpdate = true; }
  needs = true;
}
// what the scissors would cut at the pointer, or null off the cloth
function ringAt(e) {
  const h = hitAt(e);
  if (!h) return null;
  const pc = h.pc, v0 = h.y / 100, y = -h.y;
  if (pc < 2) { const L = r1(y - .5); return { kind: 'body', pcs: [0, 1], v0, L, ok: L >= LIM().L[0] }; }
  // (on the cap, above the underarm, a ring would only run part way round: the whole sleeve comes off)
  const S = cloth.userData.info.sleeve;
  if (y < (pc === 2 ? S.chL : S.chR)) return { kind: 'off', ok: true };
  return { kind: 'sleeve', pcs: [2, 3], v0, u: r1(y), ok: true };
}
// the ring on the cloth as it hangs now: where the pattern's y crosses v0 on those pieces, or the sleeves' cap seams;
// a little off the cloth along its normal (else it sank into it in places)
function drawRing() {
  const g = cloth.geometry, P = g.attributes.position.array, N = g.attributes.normal.array, U = g.attributes.pat.array, I = g.index.array, pcv = cloth.userData.pcv, out = [];
  const pt = (a, b, t) => [0, 1, 2].map(k => lerp(P[a * 3 + k], P[b * 3 + k], t) + lerp(N[a * 3 + k], N[b * 3 + k], t) * .003);
  if (hov.kind === 'off') for (const [a, b] of capEdges()) out.push(...pt(a, a, 0), ...pt(b, b, 0));
  else for (let i = 0; i < I.length; i += 3) {
    if (!hov.pcs.includes(pcv[I[i]])) continue;
    const q = [];
    for (let k = 0; k < 3; k++) {
      const a = I[i + k], b = I[i + (k + 1) % 3], da = U[a * 2 + 1] - hov.v0, db = U[b * 2 + 1] - hov.v0;
      if ((da > 0) !== (db > 0)) q.push(...pt(a, b, da / (da - db)));
    }
    if (q.length === 6) out.push(...q);
  }
  cutLine.geometry.dispose(); cutLine.geometry = new LineSegmentsGeometry().setPositions(out);
  ringMat.color.set(hov.ok ? 0xf2c46b : 0xe0533a);
  const r = canvas.getBoundingClientRect(); ringMat.resolution.set(r.width, r.height);
  cutLine.visible = out.length > 0; needs = true;
}
// the sleeves' outline edges no lower than their cap's foot: the seam round the armhole (once per mesh)
function capEdges() {
  const ud = cloth.userData;
  if (ud.cap) return ud.cap;
  const I = cloth.geometry.index.array, U = cloth.geometry.attributes.pat.array, n = new Map(), out = [];
  for (let i = 0; i < I.length; i += 3) for (let k = 0; k < 3; k++) {
    const a = I[i + k], b = I[i + (k + 1) % 3], key = Math.min(a, b) * 1e6 + Math.max(a, b);
    n.set(key, (n.get(key) || 0) + 1);
  }
  for (const [key, c] of n) {
    const a = Math.floor(key / 1e6), b = key % 1e6, pc = ud.pcv[a];
    if (c > 1 || pc < 2) continue;
    const foot = -((pc === 2 ? ud.info.sleeve.chL : ud.info.sleeve.chR) + .05) / 100;
    if (U[a * 2 + 1] > foot && U[b * 2 + 1] > foot) out.push([a, b]);
  }
  return ud.cap = out;
}
const ringName = h => h.kind === 'off' ? '소매 떼기 → 민소매' : h.kind === 'sleeve' ? `소매 ${sleeveName(h.u)} (양쪽)` : h.ok ? `기장 ${lenName(h.L)}` : '여기보다 위로는 못 잘라요 (겨드랑이)';
// what the ring would cut off: below it on those pieces, or the whole sleeves
const ringGone = h => h.kind === 'off' ? pc => pc >= 2 : (pc, x, y) => h.pcs.includes(pc) && y < h.v0 * 100;
addEventListener('pointermove', e => {
  if (tool !== 'cut' || drag || stroke) return;
  if (e.buttons || e.target !== canvas) { hideRing(); return; }
  const h = ringAt(e);
  if (!h) { hideRing(); return; }   // (before hov is cleared: hideRing only hides a ring hov still names)
  hov = h;
  const r = layer.getBoundingClientRect();
  showTip(ringName(hov), e.clientX - r.left, e.clientY - r.top);
  drawRing(); setFade(hov.ok && ringGone(hov));
});
// on the cloth the scissors cut: a click on the ring cuts there, pressed and drawn the line cuts where it was drawn
// (the view turns from beside the cloth)
let stroke = null;
wrap.addEventListener('pointerdown', e => {
  if (tool !== 'cut' || !hov || e.button) return;
  controls.enabled = false;
  const h = hov, id = e.pointerId, first = hitAt(e);
  stroke = { x0: e.clientX, y0: e.clientY, drawn: false, s: first ? [first] : [] };
  const move = ev => { if (ev.pointerId === id) strokeMove(ev); }, up = ev => {
    if (ev.pointerId !== id) return;
    removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
    controls.enabled = true;
    const s = stroke; stroke = null;
    if (s.drawn) strokeEnd(s, ev.type === 'pointerup');
    else if (h.ok) cutAt(h); else say(ringName(h));
  };
  addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', up);
}, true);
const strokeMat = new LineMaterial({ color: 0xf2c46b, linewidth: 3 });
const strokeLine = new LineSegments2(new LineSegmentsGeometry(), strokeMat);
strokeLine.visible = false; strokeLine.frustumCulled = false; strokeLine.renderOrder = 2;
scene.add(strokeLine);
let planT = 0;
function strokeMove(e) {
  const s = stroke;
  if (!s.drawn) {
    if (Math.hypot(e.clientX - s.x0, e.clientY - s.y0) < 6) return;
    s.drawn = true; hideRing();
    s.T = structuredClone(state.top); s.h = halves(params({ ...s.T, cuts: undefined }));
  }
  const q = hitAt(e);
  if (q) s.s.push(q);
  // the line as drawn on the cloth (a jump across the outline, from front to back, is no line)
  const out = [];
  for (let i = 1; i < s.s.length; i++) if (s.s[i].p.distanceTo(s.s[i - 1].p) < .05) out.push(...s.s[i - 1].p.toArray(), ...s.s[i].p.toArray());
  strokeLine.geometry.dispose(); strokeLine.geometry = new LineSegmentsGeometry().setPositions(out);
  const r = canvas.getBoundingClientRect(); strokeMat.resolution.set(r.width, r.height);
  strokeLine.visible = out.length > 0; needs = true;
  const lr = layer.getBoundingClientRect(), tx = e.clientX - lr.left, ty = e.clientY - lr.top;
  if (performance.now() - planT < 50) return;   // (the plan and the fade: some 20 times a second)
  planT = performance.now();
  const pl = s.pl = plan(s);
  strokeMat.color.set(pl.any ? 0xf2c46b : 0xe0533a);
  setFade(pl.any && pl.gone);
  showTip(pl.any ? pl.say + ' — 손을 떼면 잘려요' : pl.err || '옷을 가로질러 그어 보세요', tx, ty);
}
// the drawn line → what it cuts: each stretch of it over one body half a cut of that half (crossing the middle line,
// both halves run on to it), over a sleeve's cap that sleeve off, lower down that sleeve shortened to where it was drawn
function plan(s) {
  const cuts = [], sv = { 2: [], 3: [] }, S = s.s;
  let cur = null;
  for (let i = 0; i < S.length; i++) {
    const q = S[i], pr = S[i - 1];
    if (q.pc >= 2) { sv[q.pc].push(-q.y); cur = null; continue; }
    const k = (q.pc ? 'B' : 'F') + (q.x >= 0 ? 'p' : 'm');
    if (cur && cur.k !== k && pr && pr.pc === q.pc) {
      const y = r1(lerp(pr.y, q.y, pr.x / (pr.x - q.x)));
      cur.pts.push([-.05, y]); cur = { k, pts: [[-.05, y]] }; cuts.push(cur);
    } else if (!cur || cur.k !== k) { cur = { k, pts: [] }; cuts.push(cur); }
    const p = [r1(Math.abs(q.x)), r1(q.y)], l = cur.pts.at(-1);
    if (!l || Math.hypot(p[0] - l[0], p[1] - l[1]) >= .4) cur.pts.push(p);
  }
  const mine = cuts.filter(c => c.pts.length > 1), old = s.T.cuts || [], c = applyCuts(s.h, [...old, ...mine]), res = c.res.slice(old.length);
  const ok = mine.filter((_, i) => res[i] && res[i].H), gone = res.map((r, i) => r && r.H && [mine[i].k, r.gone]).filter(Boolean);
  const sl = {}, I = cloth.userData.info.sleeve;
  for (const pc of [2, 3]) if (sv[pc].length) {
    const u = sv[pc].sort((a, b) => a - b)[sv[pc].length >> 1];
    sl[pc - 2] = u < (pc === 2 ? I.chL : I.chR) ? 0 : r1(u);
  }
  for (const [k, i] of [['l', 0], ['r', 1]]) if (c.arm[k] && !(i in sl)) sl[i] = 0;
  const said = [...new Set(res.filter(r => r && r.H).map(r => r.label + ' 자르기'))];
  for (const i in sl) said.push(`${i === '0' ? '왼쪽' : '오른쪽'} 소매 ${sl[i] ? sleeveName(sl[i]) : '떼기'}`);
  return {
    cuts: ok, sl, any: !!(ok.length || Object.keys(sl).length), say: said.join(' · '), err: (res.find(r => r && r.err) || {}).err,
    // (the half's own frame: the −x halves mirrored)
    gone: (pc, x, y) => pc < 2 ? gone.some(([k, poly]) => (k[0] === 'B') === (pc === 1) && (k[1] === 'p') === (x >= 0) && inside([Math.abs(x), y], poly))
      : (pc - 2) in sl && -y > sl[pc - 2],
  };
}
// the line let go: cut what it showed, every other number as it was (a sleeve only ever shorter; a strap stays one)
function strokeEnd(s, done) {
  strokeLine.visible = false; setFade(null); tip.classList.remove('show'); needs = true;
  if (!done) return;
  const pl = plan(s);
  if (!pl.any) { say(pl.err || '옷을 가로질러 그어 주세요'); return; }
  const T = s.T, E = T.edit || {};
  if (pl.cuts.length) T.cuts = [...(T.cuts || []), ...pl.cuts];
  for (const i in pl.sl) { T.sl[i] = Math.min(T.sl[i], pl.sl[i]); if (E['S' + 'lr'[i]]) E['S' + 'lr'[i]] = E['S' + 'lr'[i]].filter(b => b[0] !== 'hem'); }
  fix(T);
  state.top = T; apply(); commit(); say('잘랐어요 — ' + pl.say);
}
// cut there: the hem (or both sleeves) where the ring was, every other number as it was. The hem is as wide as the
// side seam was at that depth (scissors cut what is there: a flared top cut higher has a narrower hem), and an outline
// drawn by hand below the cut goes with it
function cutAt(h) {
  const T = structuredClone(state.top), E = T.edit || {};
  if (h.kind === 'body') {
    const x0 = sideX(T, h.L + .5);
    T.L = h.L;
    for (const k of ['Fp', 'Fm', 'Bp', 'Bm']) if (E[k]) E[k] = E[k].filter(b => b[0] !== 'hem');
    fix(T);
    let [a, b] = flareLim(T);
    for (let i = 0; i < 12; i++) { T.flare = (a + b) / 2; if (sleeves(params(T)).h.F.side.at(-1)[0] < x0) a = T.flare; else b = T.flare; }
    T.flare = r1((a + b) / 2);
  } else {
    T.sl = T.sl.map(v => Math.min(v, h.kind === 'off' ? 0 : h.u));   // (only ever shorter; a strap stays a strap)
    for (const k of ['Sl', 'Sr']) if (E[k]) E[k] = E[k].filter(b => b[0] !== 'hem');
  }
  fix(T);
  state.top = T; hideRing(); apply(); commit(); say(ringName(h).replace(' (양쪽)', '') + '로 잘랐어요');
}
// x along a curve running down where it is d cm down (d positive); past its ends, its end's
function xAt(c, d) {
  for (let i = 1; i < c.length; i++) if (-c[i][1] >= d) { const [a, b] = [c[i - 1], c[i]]; return lerp(a[0], b[0], clamp((d + a[1]) / (a[1] - b[1]), 0, 1)); }
  return c.at(-1)[0];
}
// the (uncut) front side seam's x at depth y (cm below the high shoulder point)
const sideX = (T, y) => xAt(sleeves(params(T)).h.F.side, y);
/* ---------- 통 (fit): a band picked, its width at once (2026-10-30) ---------- */
// its own tool, apart from pull (the user: pulling and taking in / letting out in one tool was what made pulling hard to read)
// a band picked on the flat top (드래그 위아래, 펼친 모양) or a click on the cloth (5 cm either side): on the body the side
// seams over that stretch, on a sleeve its underarm, all moved in or out alike (a band bump, pattern.js bend), easing back
// over 6 cm past its ends. The bar (or the band's gold handles) runs from as close to the body as the pieces allow
// (piecesOk: 1 cm over it, at the band's tightest) to as loose as they allow, the cloth hanging again as it moves
let grip = null, pickXY = null;
const gripEl = $('grip'), gripBar = $('grip-r');
// t of the way along a curve running down to where it reaches y (cm, down negative)
function tAt(c, y) {
  let L = 0, s = 0;
  for (let i = 1; i < c.length; i++) L += Math.hypot(c[i][0] - c[i - 1][0], c[i][1] - c[i - 1][1]);
  for (let i = 1; i < c.length; i++) {
    const d = Math.hypot(c[i][0] - c[i - 1][0], c[i][1] - c[i - 1][1]);
    if (c[i][1] <= y) return clamp((s + d * clamp((c[i - 1][1] - y) / Math.max(1e-9, c[i - 1][1] - c[i][1]), 0, 1)) / L, 0, 1);
    s += d;
  }
  return 1;
}
// the top as picked with the band dx cm out (in, negative) on every half it covers
function gripTop(g, dx) {
  const T = structuredClone(g.start), E = T.edit = T.edit || {};
  if (Math.abs(dx) >= .05) for (const k of g.keys) E[k] = [...(E[k] || []), [g.curve, g.t, r1(dx), 0, g.r, 0, g.t2]];
  return T;
}
// from 0 toward `to`, as far as the pieces stay whole (a start already failing isn't held, as edgeOk)
function gripEnd(g, to) {
  const ok = dx => !g.ok0 || piecesOk(gripTop(g, dx), g.from);
  if (ok(to)) return to;
  let lo = 0, hi = to;
  for (let i = 0; i < 8; i++) { const m = (lo + hi) / 2; if (ok(m)) lo = m; else hi = m; }
  return Math.trunc(lo * 10) / 10;
}
// the band ya … yb cm down (the body from the high shoulder point, a sleeve from its cap's top) of part 'body', 'l' or
// 'r'; xs: the side the body was picked on (with 왼쪽·오른쪽 같이 off only that side's seams move)
function choose(part, ya, yb, xs) {
  if (!A) return;
  const T = state.top, s = sleeves(params({ ...T, edit: undefined, cuts: undefined })), sym = $('sym').checked;
  let g;
  if (part === 'body') {
    const m = measure(), name = d => [['겨드랑이', -s.h.F.side[0][1]], ['가슴', m.armpit + 4], ['허리', m.waist], ['엉덩이', m.hip], ['밑단', -s.h.F.side.at(-1)[1]]]
      .reduce((a, b) => Math.abs(b[1] - d) < Math.abs(a[1] - d) ? b : a)[0];
    g = { curve: 'side', c: s.h.F.side, pc: 0, keys: (sym ? ['p', 'm'] : [xs >= 0 ? 'p' : 'm']).flatMap(k => ['F' + k, 'B' + k]), name };
  } else {
    if (!s[part]) { closeGrip(); return; }
    g = { curve: 'und', c: s[part].H0.und, pc: part === 'l' ? 2 : 3, keys: sym ? ['Sl', 'Sr'] : ['S' + part], name: () => '소매' };
  }
  const top = -g.c[0][1], bot = -g.c.at(-1)[1];
  ya = clamp(ya, top, bot); yb = clamp(yb, top, bot);
  if (yb - ya < 1) { closeGrip(); say(part === 'body' ? '겨드랑이 아래 몸판을 골라 주세요' : '소매 아래쪽을 골라 주세요'); return; }
  const na = g.name(ya), nb = g.name(yb);
  g.name = (sym ? '' : (part === 'body' ? xs >= 0 : part === 'l') ? '왼쪽 ' : '오른쪽 ') + (part === 'body' ? (na === nb ? na : `${na}~${nb}`) + ' 둘레' : '소매 통');
  // n: how many halves' edges move, so the round changes by n × dx
  Object.assign(g, { ya, yb, x: xs, r: 6, t: Math.round(tAt(g.c, -ya) * 1000) / 1000, t2: Math.round(tAt(g.c, -yb) * 1000) / 1000,
    n: g.curve === 'side' ? g.keys.length : 2, start: structuredClone(T), from: sleeves(params({ ...T, cuts: undefined })) });
  g.ok0 = piecesOk(T, sleeves(params({ ...T, edit: undefined, cuts: undefined })));
  g.lo = gripEnd(g, -15); g.hi = gripEnd(g, 15);
  grip = g;
  gripBar.min = g.lo; gripBar.max = g.hi; gripBar.value = 0;
  $('grip-name').textContent = g.name; gripLabel(0);
  gripEl.hidden = false;
  gripFade(); drawFlat();
}
function pickAt(e) {
  const h = hitAt(e);
  if (!h) { closeGrip(); return; }
  const d = -h.y;
  choose(h.pc < 2 ? 'body' : h.pc === 2 ? 'l' : 'r', d - 5, d + 5, h.x);
}
function gripLabel(dx) {
  const g = grip;
  $('grip-v').textContent = g.lo < 0 && dx <= g.lo + .05 ? '몸에 착' : `둘레 ${dx >= 0 ? '+' : ''}${(dx * g.n).toFixed(1)}cm`;
}
// the picked band striped on the cloth: that band of the halves (or sleeves) it covers
function gripFade() {
  const g = grip, all = g.keys.length === (g.pc < 2 ? 4 : 2);
  setFade((pc, x, y) => (g.pc < 2 ? pc < 2 && (all || (x >= 0) === (g.x >= 0)) : pc >= 2 && (all || pc === g.pc)) && -y >= g.ya && -y <= g.yb, 2);
}
function closeGrip() {
  if (!grip) return;
  grip = null; gripEl.hidden = true; setFade(null); drawFlat();
}
const gripSet = dx => { state.top = gripTop(grip, dx); apply(true); gripLabel(dx); };
gripBar.addEventListener('input', () => { if (grip) gripSet(+gripBar.value); });
gripBar.addEventListener('change', () => { if (grip) commit(); });
$('grip-fit').addEventListener('click', () => { if (!grip) return; gripBar.value = grip.lo; gripBar.dispatchEvent(new Event('input')); commit(); });
$('grip-x').addEventListener('click', closeGrip);

/* ---------- 펼친 모양: the top laid flat, seen from the front (2026-10-30) ---------- */
// the pattern as it is, drawn flat (cm, y down): a body panel as wide as its pattern (half of it is a quarter of the
// round), a sleeve folded along its middle line, as wide as its half; the back behind the front (its neck shows above
// the front's). Drawn on every change; a band dragged up or down on it is the 통 tool's pick
const flatSvg = $('flat-svg'), CH5 = ['neck', 'shoulder', 'arm', 'side', 'hem'];
let flat = null, flatSel = null, flatBox = null;
const chainOf = H => CH5.flatMap((k, i) => i ? H[k].slice(1) : H[k]);
const panelOf = (Hp, Hm) => [...chainOf(Hp).map(([x, y]) => [x, -y]), ...chainOf(Hm).reverse().map(([x, y]) => [-x, -y])];
// a sleeve laid out from its armhole, down and out (a short one nearly level, a long one steeper): its middle line the
// straight top fold from T0, its underarm seam the bottom edge; sg 1 the left sleeve (+x, on the right as you face it)
function flatSleeve(s, k) {
  const H = k === 'l' ? s.h.Fp : s.h.Fm, sg = k === 'l' ? 1 : -1, u = s.h.uS[k];
  if (u < 1.2) return null;
  const O = [H.shoulder.at(-1)[0], -H.shoulder.at(-1)[1]], U = [H.side[0][0], -H.side[0][1]], th = lerp(.5, 1.08, sstep(u / 55));
  const d = [Math.cos(th), Math.sin(th)], n = [Math.sin(th), -Math.cos(th)], M = p => [sg * p[0], p[1]];
  const arm = H.arm.map(([x, y]) => [x, -y]).reverse().slice(1, -1);   // (closed along the armhole: a straight close left a gap under the arm)
  // shortcut: a sleeve shorter than its cap is drawn as a small flap, not cut from the cap; enough to see it is there
  if (!s[k]) return { poly: [O, [O[0] + d[0] * u, O[1] + d[1] * u], [U[0] + d[0] * u * .4, U[1] + d[1] * u * .4], U, ...arm].map(M) };
  const { und, hem } = s[k].H, ch = s.sl[k].ch, w0 = und[0][0], T0 = [U[0] + n[0] * w0, U[1] + n[1] * w0];
  const m = ([x, y]) => [T0[0] + d[0] * (-y - ch) - n[0] * x, T0[1] + d[1] * (-y - ch) - n[1] * x];
  return { poly: [O, T0, ...hem.slice().reverse().map(m), ...und.slice().reverse().map(m), ...arm].map(M), T0, d, n, ch, sg, m, und, cuff: hem.map(m).map(M) };
}
// a sleeve's length (cm from its cap's top) at a flat point
const sleeveLen = (F, p) => F.ch + (F.sg * p[0] - F.T0[0]) * F.d[0] + (p[1] - F.T0[1]) * F.d[1];
const pathOf = pts => 'M' + pts.map(p => p[0].toFixed(2) + ' ' + p[1].toFixed(2)).join('L') + 'Z';
// refit: frame the drawing anew (not while something is dragged: the drawing would shift under the hand)
function drawFlat(refit) {
  const T = state.top, s = sleeves(params());
  flat = { body: panelOf(s.h.Fp, s.h.Fm), back: panelOf(s.h.Bp, s.h.Bm), sl: { l: flatSleeve(s, 'l'), r: flatSleeve(s, 'r') },
    hem: [...s.h.Fm.hem.map(([x, y]) => [-x, -y]).reverse(), ...s.h.Fp.hem.map(([x, y]) => [x, -y])] };
  const all = [...flat.back, ...flat.body, ...['l', 'r'].flatMap(k => flat.sl[k] ? flat.sl[k].poly : [])];
  const w = Math.max(...all.map(p => Math.abs(p[0]))) + 4, ys = all.map(p => p[1]), y0 = Math.min(...ys) - 4, y1 = Math.max(...ys) + 4;
  // (while dragged the frame only grows, as far as the drawing went out of it: a hem pulled down left it)
  const grow = !refit && flatBox && drag && (w > flatBox[2] / 2 || y0 < flatBox[1] || y1 > flatBox[1] + flatBox[3]);
  if (refit || !flatBox || grow) {
    if (grow) { const a = Math.min(y0, flatBox[1]), b = Math.max(y1, flatBox[1] + flatBox[3]), h = Math.max(w, flatBox[2] / 2); flatBox = [-h, a, 2 * h, b - a]; }
    else flatBox = [-w, y0, 2 * w, y1 - y0];
    flatSvg.setAttribute('viewBox', flatBox.map(v => v.toFixed(1)).join(' '));
    flatSvg.style.aspectRatio = flatBox[2] / flatBox[3];   // (as tall as the drawing, at most the CSS max-height)
  }
  const f = T.c1, st = 'stroke="#8d8a83" stroke-width="1.2" vector-effect="non-scaling-stroke" stroke-linejoin="round"';
  let out = `<defs><pattern id="fstripe" width="1.4" height="1.4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width=".7" height="1.4" fill="#f2c46b"/></pattern>
    <clipPath id="fclip-b"><path d="${pathOf(flat.body)}"/></clipPath>${['l', 'r'].map(k => flat.sl[k] ? `<clipPath id="fclip-${k}"><path d="${pathOf(flat.sl[k].poly)}"/></clipPath>` : '').join('')}</defs>`;
  out += `<path d="${pathOf(flat.back)}" fill="${f}" ${st}/><path d="${pathOf(flat.back)}" fill="#000" opacity=".3"/>`;
  for (const k of ['l', 'r']) if (flat.sl[k]) out += `<path d="${pathOf(flat.sl[k].poly)}" fill="${f}" ${st}/>`;
  out += `<path d="${pathOf(flat.body)}" fill="${f}" ${st}/>`;
  // the band picked (or being dragged), and the handles that take it in or let it out
  const b = flatSel ? { part: flatSel.part, ya: Math.min(flatSel.a, flatSel.b), yb: Math.max(flatSel.a, flatSel.b), x: flatSel.x, all: $('sym').checked }
    : grip && { part: grip.pc < 2 ? 'body' : grip.pc === 2 ? 'l' : 'r', ya: grip.ya, yb: grip.yb, x: grip.x, all: grip.keys.length === (grip.pc < 2 ? 4 : 2) };
  if (b) for (const k of b.part === 'body' ? ['b'] : b.all ? ['l', 'r'] : [b.part]) {
    let band;
    if (k === 'b') { const x0 = b.all || b.x < 0 ? -200 : 0, x1 = b.all || b.x >= 0 ? 200 : 0; band = [[x0, b.ya], [x1, b.ya], [x1, b.yb], [x0, b.yb]]; }
    else { const F = flat.sl[k]; if (!F || !F.m) continue; band = [[-3, -b.ya], [-3, -b.yb], [40, -b.yb], [40, -b.ya]].map(F.m).map(p => [F.sg * p[0], p[1]]); }
    out += `<path d="${pathOf(band)}" fill="url(#fstripe)" opacity=".75" clip-path="url(#fclip-${k})" pointer-events="none"/>`;
  }
  if (grip && !flatSel) {
    const ym = (grip.ya + grip.yb) / 2, hs = [];
    if (grip.pc < 2) { for (const h of ['p', 'm']) if (grip.keys.includes('F' + h)) hs.push([h, (h === 'p' ? 1 : -1) * xAt(s.h['F' + h].side, ym), ym]); }
    else for (const k of ['l', 'r']) { const F = flat.sl[k]; if (F && F.m && grip.keys.includes('S' + k)) { const p = F.m([xAt(F.und, ym), -ym]); hs.push([k, F.sg * p[0], p[1]]); } }
    for (const [h, x, y] of hs) out += `<circle data-h="${h}" cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="2.2" fill="#f2c46b" stroke="#1b0d07" stroke-width="1.5" vector-effect="non-scaling-stroke" style="cursor:ew-resize"/>`;
  }
  // a pull: what it would move (gold), and while dragged the top as it was (dashed)
  const hot = flatHotPath();
  if (hot) out += `<path d="${hot}" fill="none" stroke="#f2c46b" stroke-width="3" stroke-linecap="round" vector-effect="non-scaling-stroke" pointer-events="none"/>`;
  if (flatGhost) for (const p of [flatGhost.back, ...flatGhost.sl, flatGhost.body])
    out += `<path d="${pathOf(p)}" fill="none" stroke="#f5f2ea" stroke-width="1.2" stroke-dasharray="4 3" opacity="${p === flatGhost.back ? .45 : .9}" vector-effect="non-scaling-stroke" pointer-events="none"/>`;
  flatSvg.innerHTML = out;
}
// the hem or a sleeve's end (as a pull's target) within 2.2 cm of a point on the flat top, or null
function flatEnd(p) {
  const near = pts => pts.some((q, i) => i && segDist(p, pts[i - 1], q) < 2.2);
  if (near(flat.hem)) return { k: 'hem' };
  for (const [k, i] of [['l', 0], ['r', 1]]) if (flat.sl[k] && flat.sl[k].cuff && near(flat.sl[k].cuff)) return { k: 'sleeve', i, F: flat.sl[k] };
  return null;
}
const segDist = (p, a, b) => {
  const dx = b[0] - a[0], dy = b[1] - a[1], u = clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1), 0, 1);
  return Math.hypot(p[0] - a[0] - u * dx, p[1] - a[1] - u * dy);
};
// over the flat top: on the hem or a sleeve's end the pointer says it pulls (and the cloth shows that edge in gold)
flatSvg.addEventListener('pointermove', e => {
  if (e.buttons || !flat || drag) return;
  const t = flatEnd(flatPt(e)), was = pullT && pullT.flat;
  flatSvg.style.cursor = t ? 'row-resize' : '';
  if (t ? !was || was !== t.k + (t.i ?? '') : was) {
    pullT = t && Object.assign(t, { flat: t.k + (t.i ?? '') });
    drawFlat();
  }
});
flatSvg.addEventListener('pointerleave', () => { if (pullT && pullT.flat && !drag) { pullT = null; drawFlat(); } });
const flatPt = e => { const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(flatSvg.getScreenCTM().inverse()); return [p.x, p.y]; };
// pressed on a handle: the band in or out by how far it is dragged across its seam; elsewhere on the top: a band picked
// by dragging up or down it (a click: 5 cm either side)
flatSvg.addEventListener('pointerdown', e => {
  if (e.button || !flat || !A) return;
  e.preventDefault();
  const p0 = flatPt(e), id = e.pointerId, h = e.target.dataset && e.target.dataset.h;
  let move, up;
  if (h && grip) {
    const v0 = +gripBar.value, F = flat.sl[h];
    move = ev => {
      const p = flatPt(ev), dx = F ? -((p[0] - p0[0]) * F.sg * F.n[0] + (p[1] - p0[1]) * F.n[1]) : (p[0] - p0[0]) * (h === 'p' ? 1 : -1);
      gripBar.value = clamp(r1(v0 + dx), grip.lo, grip.hi); gripSet(+gripBar.value);
    };
    up = () => commit();
  } else if (flatEnd(p0)) {
    // the hem or a sleeve's end: its length, by how far it is dragged down (a sleeve: along it, as laid out at the start)
    // (cm by the scale at the start: the frame may grow under the hand)
    const d = Object.assign(flatEnd(p0), { start: structuredClone(state.top) }), F = d.F, k = flatSvg.getScreenCTM().a;
    if (tool !== 'pull') setTool('pull');
    pullBegin(d); drag = d; drawFlat();
    move = ev => {
      const p = [p0[0] + (ev.clientX - e.clientX) / k, p0[1] + (ev.clientY - e.clientY) / k], [label, why] = d.k === 'hem' ? setLen(d, d.start.L + p[1] - p0[1]) : setLen(d, d.start.sl[d.i] + sleeveLen(F, p) - sleeveLen(F, p0));
      apply(true);
      const r = layer.getBoundingClientRect();
      showTip(why ? `${label} · ${why}` : label, ev.clientX - r.left, ev.clientY - r.top, why);
    };
    up = () => { drag = null; tip.classList.remove('show'); pullEnd(); commit(); apply(); };
  } else {
    const part = inside(p0, flat.body) ? 'body' : ['l', 'r'].find(k => flat.sl[k] && flat.sl[k].m && inside(p0, flat.sl[k].poly));
    if (!part) { closeGrip(); return; }
    if (tool !== 'fit') setTool('fit');
    const depth = p => part === 'body' ? p[1] : sleeveLen(flat.sl[part], p);
    flatSel = { part, a: depth(p0), b: depth(p0), x: p0[0] };
    drawFlat();
    move = ev => { flatSel.b = depth(flatPt(ev)); drawFlat(); };
    up = () => {
      const { a, b, x } = flatSel; flatSel = null;
      if (Math.abs(b - a) < 1.5) choose(part, a - 5, a + 5, x); else choose(part, Math.min(a, b), Math.max(a, b), x);
    };
  }
  flatSvg.setPointerCapture(id);
  const mv = ev => { if (ev.pointerId === id) move(ev); }, end = ev => {
    if (ev.pointerId !== id) return;
    flatSvg.removeEventListener('pointermove', mv); flatSvg.removeEventListener('pointerup', end); flatSvg.removeEventListener('pointercancel', end);
    up();
  };
  flatSvg.addEventListener('pointermove', mv); flatSvg.addEventListener('pointerup', end); flatSvg.addEventListener('pointercancel', end);
});
// a click (not a drag to turn the view) on the cloth picks there, off it closes the bar
wrap.addEventListener('pointerdown', e => { pickXY = tool === 'fit' && !e.button ? [e.clientX, e.clientY] : null; });
wrap.addEventListener('pointerup', e => {
  if (tool === 'fit' && pickXY && Math.hypot(e.clientX - pickXY[0], e.clientY - pickXY[1]) < 5) pickAt(e);
  pickXY = null;
});
setTool('cut');

/* ---------- PNG ---------- */
$('png').addEventListener('click', () => {
  const w = 1000, h = 1500, keep = [camera.aspect];
  DOTS.forEach(d => { d.el.hidden = true; }); edgeDot.hidden = true; hideRing(); hotLine.visible = ghostLine.visible = false; pullT = null;
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
  placeDots(); placeEdge(); drawPull();
  if (hov && awake && cloth && !next) drawRing();   // (the ring rides on the cloth while it moves)
  if (t - lastStat > 400 && t - sayT > 2500) { lastStat = t; $('status').textContent = cloth ? `천 ${awake ? '움직이는 중' : '멈춤'} · 계산 ${simMs.toFixed(1)}ms` : ''; }
})(0);

fix(state.top);
renderSeg(); apply(); undoState();
showBody(state.body);
window.__studio = { get state() { return state; }, apply, showBody, camera, controls, canvas, project, get cloth() { return cloth; }, get awake() { return awake; }, get A() { return A; }, composer, renderer, params, edgePoint, edgeAt, editNear,
  editOk: () => piecesOk(state.top, sleeves(params({ ...state.top, edit: undefined, cuts: undefined }))),
  // the 통 tool's band picked and set (v: cm in or out, or 'fit' for 몸에 착), as the flat top's drag and the bar do → its range
  band: (part, ya, yb, xs, v) => { choose(part, ya, yb, xs); if (!grip) return null; gripBar.value = v === 'fit' ? grip.lo : clamp(v, grip.lo, grip.hi); gripSet(+gripBar.value); commit(); return [grip.lo, grip.hi]; },
  // how far in (cm) a side's armhole was pulled by hand, at most: its sleeve sits that much further up the arm
  armIn: s => {
    const e = sleeves(params({ ...state.top, cuts: undefined })).h, o = sleeves(params({ ...state.top, edit: undefined, cuts: undefined })).h, n = 24;
    return Math.max(0, ...(s === 'l' ? ['Fp', 'Bp'] : ['Fm', 'Bm']).flatMap(k => { const a = resample(o[k].arm, n), b = resample(e[k].arm, n); return a.map((p, i) => p[0] - b[i][0]); }));
  } };
