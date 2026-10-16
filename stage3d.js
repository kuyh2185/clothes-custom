/* 고쳐 입기 — 3D stage.
   Mannequins and garments are real assets built in Blender (blender/export_web.py): MPFB (MakeHuman) model bodies,
   CC0 MakeHuman garments fitted by MPFB's proxy system and skinned to one game-engine rig, poses as animations,
   fit variants baked with cloth simulation as morph targets, and a second non-overlapping UV map for brushes.
   Editing happens in the shaders, in rest-pose space (so it stays put in any pose):
   colour/pattern over the fabric's own shading, a free neckline (9 draggable points, front and back), a free hem
   (8 draggable points around) and per-side sleeve ends, brush cutting/restoring and brush painting (canvas masks in
   the brush UVs), washes and rips, and printed images. The body is pushed just inside whatever covers it. */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

const cc = window.__cc;
const PI = Math.PI, TAU = PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const VER = 11;   // bump with the assets
const GARMENTS = ['tee', 'long', 'jeans', 'skirt'];
const NP = 17, NO = 17, NC = 5, HP = 8, MAXD = 16;   // neckline: shader samples / garment outline samples / handles per side

let renderer = null;
try { renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); } catch (e) { console.warn('고쳐 입기: WebGL 없음, 2D로 그려요', e); }
if (cc && renderer) start();

function start() {
  const wrap = document.querySelector('.stage-wrap');
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // Khronos PBR Neutral: made for product shots — colours come out as picked (true black, true white)
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const canvas = renderer.domElement;
  canvas.id = 'stage3d';
  canvas.setAttribute('aria-label', '옷을 입은 3D 마네킹 — 끌어서 돌려 보기');
  wrap.insertBefore(canvas, document.getElementById('stage'));
  const layer = document.createElement('div');   // draggable edit points live here, over the canvas
  layer.className = 'h3d-layer';
  wrap.appendChild(layer);
  const guide = document.createElementNS('http://www.w3.org/2000/svg', 'svg');   // dashed line through the neckline points
  guide.setAttribute('class', 'h3d-guide');
  layer.appendChild(guide);
  const brushRing = document.createElement('div');
  brushRing.className = 'brush3d';
  wrap.appendChild(brushRing);

  /* ---------- studio ---------- */
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.45;
  const camera = new THREE.PerspectiveCamera(26, 1, 0.05, 100);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 0.9, 0);
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.09;
  controls.rotateSpeed = 0.75;
  controls.minPolarAngle = PI * 0.3;
  controls.maxPolarAngle = PI * 0.56;
  camera.position.set(0, 1.0, 5);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x8d847a, 0.55));
  const key = new THREE.DirectionalLight(0xfff6ee, 2.3);
  key.position.set(-2.4, 4.6, 3.6);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -2, right: 2, top: 2.6, bottom: -1.2, near: 0.5, far: 14 });
  key.shadow.bias = -0.0003;
  key.shadow.normalBias = 0.02;
  key.shadow.radius = 4;
  key.target.position.set(0, 0.9, 0);
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight(0xf1f3ff, 0.7);
  fill.position.set(3, 2.2, 3);
  const rim = new THREE.DirectionalLight(0xffffff, 1.0);
  rim.position.set(1, 3.4, -3.6);
  scene.add(fill, rim);
  const BACK = { studio: '#e4e1dc', grey: '#a9a6a0', dark: '#373634' };
  const floorMat = new THREE.MeshStandardMaterial({ color: BACK.studio, roughness: 1 });
  const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 96), floorMat);
  floor.rotation.x = -PI / 2;
  floor.position.y = -0.025;
  floor.receiveShadow = true;
  scene.add(floor);
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.31, 0.025, 72),
    new THREE.MeshPhysicalMaterial({ color: '#1f1f1f', roughness: 0.22, clearcoat: 0.9, clearcoatRoughness: 0.15 }));
  plate.position.y = -0.0125;
  plate.receiveShadow = true;
  scene.add(plate);

  /* ---------- assets ---------- */
  const draco = new DRACOLoader().setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/libs/draco/gltf/');
  const loader = new GLTFLoader().setDRACOLoader(draco);
  const ASSETS = {};
  let A = null, loading = null;
  let handles = [], dragH = null;   // 3D edit points (neckline / hem / sleeve ends)
  const loadBody = kind => new Promise((res, rej) => loader.load(`assets/body_${kind}.glb?v=${VER}`, g => {
    const root = g.scene, meshes = {};
    root.traverse(o => {
      if (o.isMesh) { o.castShadow = o.receiveShadow = true; o.frustumCulled = false; meshes[o.name] = o; }
    });
    const H = new THREE.Box3().setFromObject(meshes.body).max.y;
    const mixer = new THREE.AnimationMixer(root), clips = {};
    g.animations.forEach(c => { clips[c.name] = c; });
    const asset = { root, meshes, mixer, clips, H, kind, info: {} };
    for (const id of GARMENTS) if (meshes[id]) asset.info[id] = analyse(meshes[id], H);
    setupMaterials(asset);
    ASSETS[kind] = asset;
    res(asset);
  }, undefined, rej));

  // what each garment looks like at rest: its height range, sleeve end, and its own neckline/shoulder outline
  // (front and back, as the highest point of the fabric at each x) — the free neckline starts on that outline
  function analyse(mesh, H) {
    const g = mesh.geometry, P = g.attributes.position, h = g.attributes._h, s = g.attributes._s, x = g.attributes._x, n = P.count;
    let lo = 1e9, hi = -1e9, smax = 0, lo0 = 1e9;
    for (let i = 0; i < n; i++) {
      const v = h.getX(i); lo = Math.min(lo, v); hi = Math.max(hi, v); smax = Math.max(smax, s.getX(i));
      if (!x || x.getX(i) < .5) lo0 = Math.min(lo0, v);
    }
    const span = 0.19 * H / 1.77, xs = Array.from({ length: NO }, (_, i) => lerp(-span, span, i / (NO - 1)));   // out to the shoulder seam
    const outline = sgn => xs.map(x => {
      let best = -1e9;
      for (let i = 0; i < n; i++) {
        if (s.getX(i) > 0.02) continue;
        if (sgn * P.getZ(i) < 0.005 || Math.abs(P.getX(i) - x) > 0.009) continue;
        best = Math.max(best, P.getY(i));
      }
      return [x, best > -1e8 ? best : hi];
    });
    return { lo, lo0, hi, smax, neckF: outline(1), neckB: outline(-1) };
  }

  /* ---------- materials ---------- */
  const FIN = {
    white: { color: '#e9e6e0', roughness: .55, clearcoat: .08 },
    stone: { color: '#b3aa9c', roughness: .7, clearcoat: 0 },
    black: { color: '#121213', roughness: .45, clearcoat: .25 },
  };
  function texStats(tex) {
    try {
      const c = document.createElement('canvas'); c.width = c.height = 16;
      const x = c.getContext('2d'); x.drawImage(tex.image, 0, 0, 16, 16);
      const d = x.getImageData(0, 0, 16, 16).data, s = [0, 0, 0];
      let l = 0;
      for (let i = 0; i < d.length; i += 4) {
        const lin = [0, 1, 2].map(k => Math.pow(d[i + k] / 255, 2.2));
        lin.forEach((v, k) => { s[k] += v; });
        l += .2126 * lin[0] + .7152 * lin[1] + .0722 * lin[2];
      }
      return { avgC: new THREE.Vector3(...s.map(v => Math.max(.02, v / 256))), avgL: Math.max(.05, l / 256) };
    } catch (e) { return { avgC: new THREE.Vector3(.5, .5, .5), avgL: .5 }; }
  }
  const brushCanvas = () => {
    const c = document.createElement('canvas'); c.width = c.height = 1024;
    const t = new THREE.CanvasTexture(c); t.flipY = false;
    return { c, x: c.getContext('2d'), t };
  };
  function garmentMaterial(src, keepColour) {
    const st = src.map ? texStats(src.map) : { avgC: new THREE.Vector3(.5, .5, .5), avgL: .5 };
    const mask = brushCanvas(), paint = brushCanvas();
    mask.t.colorSpace = THREE.NoColorSpace; paint.t.colorSpace = THREE.SRGBColorSpace;
    const U = {
      uC1: { value: new THREE.Color() }, uC2: { value: new THREE.Color() }, uPat: { value: 0 }, uScale: { value: 1 },
      uAvg: { value: st.avgL }, uAvgC: { value: st.avgC }, uKeep: { value: keepColour ? 1 : 0 },
      uCutH: { value: -1 }, uSleeveCut: { value: new THREE.Vector2(2, 2) }, uRaw: { value: 0 }, uRawS: { value: 0 }, uTuckH: { value: -1 },
      uHemOff: { value: new Array(HP).fill(0) }, uHemLeg: { value: 0 },
      uNeckF: { value: Array.from({ length: NP }, () => new THREE.Vector2()) }, uNeckB: { value: Array.from({ length: NP }, () => new THREE.Vector2()) }, uNeckOn: { value: 0 },
      uFit: { value: new THREE.Vector4() }, uFitH: { value: new THREE.Vector4() }, uSh: { value: new THREE.Vector2(9, 10) },
      uDmg: { value: Array.from({ length: MAXD }, () => new THREE.Vector4()) }, uDmgN: { value: 0 },
      uPrint: { value: null }, uPrintOn: { value: 0 }, uPrintBox: { value: new THREE.Vector4() },
      uHover: { value: -10 }, uBand: { value: new THREE.Vector3() }, uHem: { value: new THREE.Vector2() }, uUnder: { value: 99 },
      uMask: { value: mask.t }, uPaint: { value: paint.t }, uBrushOn: { value: 0 },
    };
    const m = new THREE.MeshPhysicalMaterial({
      map: src.map || null, normalMap: src.normalMap || null, aoMap: src.aoMap || null,
      roughness: .92, metalness: 0, sheen: .25, sheenRoughness: .85, sheenColor: new THREE.Color('#ffffff'),
      side: THREE.DoubleSide,
    });
    if (src.normalMap) m.normalScale = src.normalScale ? src.normalScale.clone() : new THREE.Vector2(1, 1);
    m.userData = { U, mask, paint, brushKey: '' };
    m.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
attribute float _h; attribute float _s;
#ifndef USE_UV1
attribute vec2 uv1;
#endif
varying vec3 vRest; varying float vH; varying float vS; varying vec2 vB;
uniform vec4 uFit; uniform vec4 uFitH; uniform vec2 uSh;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
vRest = position; vH = _h; vS = _s; vB = uv1;
float off = (vS > 0.01 ? uFit.y : uFit.x * (1.0 - smoothstep(uSh.y, uSh.x, _h)));   // no push at the shoulders: a big top hangs from them
off += uFit.z * max(0.0, uFitH.x - _h);
if (uFitH.y > 0.0) { float t = clamp((uFitH.y - _h) / max(0.01, uFitH.y - uFitH.z), 0.0, 1.0); off += mix(uFit.w, uFitH.w, t); }
transformed += objectNormal * off;`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
varying vec3 vRest; varying float vH; varying float vS; varying vec2 vB;
uniform vec3 uC1; uniform vec3 uC2; uniform float uPat; uniform float uScale; uniform float uAvg; uniform vec3 uAvgC; uniform float uKeep;
uniform float uCutH; uniform vec2 uSleeveCut; uniform float uRaw; uniform float uRawS; uniform float uTuckH;
uniform float uHemOff[${HP}]; uniform float uHemLeg;
uniform vec2 uNeckF[${NP}]; uniform vec2 uNeckB[${NP}]; uniform float uNeckOn;
uniform vec4 uDmg[${MAXD}]; uniform int uDmgN;
uniform sampler2D uPrint; uniform float uPrintOn; uniform vec4 uPrintBox;
uniform float uHover; uniform vec3 uBand; uniform vec2 uHem; uniform float uUnder;
uniform sampler2D uMask; uniform sampler2D uPaint; uniform float uBrushOn;
float hash(float n) { return fract(sin(n) * 43758.5453); }
float noise1(float x) { float i = floor(x), f = fract(x); return mix(hash(i), hash(i + 1.0), f * f * (3.0 - 2.0 * f)); }
// hem height offset around the garment (8 points; trousers use the angle round each leg, mirrored)
float hemOff() {
  float ax = uHemLeg > 0.5 ? abs(vRest.x) - uHemLeg : vRest.x;
  if (uHemLeg > 0.0) ax = abs(vRest.x) - uHemLeg;
  float a = atan(ax, vRest.z); if (a < 0.0) a += 6.2831853;
  float f = a / 6.2831853 * ${HP}.0;
  int i0 = int(floor(f)); float t = f - floor(f); t = t * t * (3.0 - 2.0 * t);
  int i1 = i0 + 1; if (i1 >= ${HP}) i1 = 0;
  float o0 = 0.0, o1 = 0.0;
  for (int i = 0; i < ${HP}; i++) { if (i == i0) o0 = uHemOff[i]; if (i == i1) o1 = uHemOff[i]; }
  return mix(o0, o1, t);
}
// free neckline: piecewise-linear curve through 9 points (x sorted), cut whatever is above it
bool aboveNeck(vec2 pts[${NP}], float x, float y) {
  if (x < pts[0].x || x > pts[${NP - 1}].x) return false;
  for (int i = 0; i < ${NP - 1}; i++) {
    if (x >= pts[i].x && x <= pts[i + 1].x) {
      float t = (x - pts[i].x) / max(1e-5, pts[i + 1].x - pts[i].x);
      return y > mix(pts[i].y, pts[i + 1].y, t);
    }
  }
  return false;
}`)
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
float cutH = uCutH + (vS < 0.01 ? hemOff() : 0.0);
float fr = uRaw > 0.5 ? noise1(vRest.x * 900.0 + vRest.z * 700.0) * 0.006 : 0.0;
if (vS < 0.01 && vH < cutH + fr) discard;
float sc = vRest.x > 0.0 ? uSleeveCut.x : uSleeveCut.y;
float frs = uRawS > 0.5 ? noise1(vRest.y * 900.0 + vRest.z * 600.0) * 0.03 : 0.0;
if (vS > 0.01 && vS > sc - frs) discard;
if (uTuckH > 0.0 && vS < 0.01 && vH < uTuckH) discard;
if (vH > uUnder) discard;   // waistband and belt loops under a top worn out over them
if (uNeckOn > 0.5 && vS < 0.01) {
  if (vRest.z > 0.0 && aboveNeck(uNeckF, vRest.x, vRest.y)) discard;
  if (vRest.z <= 0.0 && aboveNeck(uNeckB, vRest.x, vRest.y)) discard;
}
if (uBrushOn > 0.5 && texture2D(uMask, vB).r < 0.5) discard;
for (int i = 0; i < ${MAXD}; i++) {
  if (i >= uDmgN) break;
  vec4 d = uDmg[i];
  if (d.w > 2.5) {
    vec3 q = vRest - d.xyz;
    float e = (q.x * q.x + q.z * q.z) / (0.026 * 0.026) + (q.y * q.y) / (0.013 * 0.013);
    if (e < 1.0 && fract(vRest.y * 260.0) > 0.28) discard;
  }
}`)
        .replace('#include <map_fragment>', `#include <map_fragment>
#ifdef USE_MAP
vec3 blurTex = texture2D(map, vMapUv, 6.5).rgb;
#else
vec3 blurTex = vec3(uAvg);
#endif
float detail = clamp(dot(blurTex, vec3(0.2126, 0.7152, 0.0722)) / uAvg, 0.5, 1.3);
vec3 base = uC1;
float s = uScale;
float side = abs(vRest.z) > abs(vRest.x) ? vRest.x : vRest.z;
if (uPat > 0.5 && uPat < 1.5) { if (fract(vH / (0.05 * s)) < 0.4) base = uC2; }
else if (uPat > 1.5 && uPat < 2.5) {
  float b = step(fract(vH / (0.06 * s)), 0.42) + step(fract(side / (0.06 * s)), 0.42);
  base = mix(uC1, uC2, min(1.0, b) * 0.55 + step(1.5, b) * 0.3);
}
else if (uPat > 2.5) {
  vec2 g = vec2(side, vH) / (0.028 * s);
  vec2 c = fract(g + vec2(0.5 * mod(floor(g.y), 2.0), 0.0)) - 0.5;
  if (length(c) < 0.27) base = uC2;
}
// denim keeps its own colour variation shifted to the chosen colour; everything else: the colour × the fabric's shading
diffuseColor.rgb = uKeep > 0.5 && uPat < 0.5 ? clamp(diffuseColor.rgb / uAvgC, 0.0, 2.2) * base : base * detail;
if (uBrushOn > 0.5) { vec4 pc = texture2D(uPaint, vB); diffuseColor.rgb = mix(diffuseColor.rgb, pc.rgb * detail, pc.a); }
for (int i = 0; i < ${MAXD}; i++) {
  if (i >= uDmgN) break;
  vec4 d = uDmg[i];
  vec3 q = vRest - d.xyz;
  float rr = 0.035 + d.w * 0.008;
  float k = exp(-(q.x * q.x + q.z * q.z) / (rr * rr) - (q.y * q.y) / (rr * rr * 1.6));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.88, 0.88, 0.85), k * (0.28 + d.w * 0.12));
  if (d.w > 1.5 && k > 0.35 && fract(vRest.y * 140.0 + hash(float(i))) < 0.18) diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93), 0.7);
}
if (uPrintOn > 0.5 && vRest.z > 0.0) {
  vec2 pu = (vRest.xy - uPrintBox.xy) / uPrintBox.zw + 0.5;
  if (pu.x > 0.0 && pu.x < 1.0 && pu.y > 0.0 && pu.y < 1.0) { vec4 pc = texture2D(uPrint, vec2(pu.x, pu.y)); diffuseColor.rgb = mix(diffuseColor.rgb, pc.rgb, pc.a); }
}
if (uBand.z > 0.5 && vH > uBand.x && vS < 0.01) {
  diffuseColor.rgb = uC1 * clamp(detail, 0.85, 1.1) * 0.92;
  float st = min(abs(vH - (uBand.y - 0.007)), abs(vH - (uBand.x + 0.006)));
  if (st < 0.0011 && fract((vRest.x + vRest.z) * 90.0) < 0.55) diffuseColor.rgb = vec3(0.6, 0.42, 0.15);
  if (abs(vH - uBand.x) < 0.0012) diffuseColor.rgb *= 0.7;
}
if (uHem.x > 0.5 && uRaw < 0.5 && vS < 0.01 && vH < cutH + 0.02) {
  diffuseColor.rgb *= 0.9;
  if (abs(vH - (cutH + 0.014)) < 0.0009 && fract((vRest.x + vRest.z) * 70.0) < 0.6) diffuseColor.rgb *= 0.6;
}
if (uHem.y > 0.5 && uRawS < 0.5 && vS > 0.01 && vS > sc - 0.05) diffuseColor.rgb *= 0.9;
if (uRaw > 0.5 && vS < 0.01 && vH < cutH + 0.012) diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92), 0.35);
if (abs(vH - uHover) < 0.0016 && vS < 0.01 && fract((vRest.x + vRest.z) * 40.0) < 0.6) diffuseColor.rgb = vec3(0.05);`);
    };
    m.customProgramCacheKey = () => 'garment-v' + VER;
    return m;
  }
  function bodyMaterial() {
    const U = { uWear: { value: new THREE.Vector4() }, uShoes: { value: 1 } };
    const m = new THREE.MeshPhysicalMaterial({ roughness: .55, clearcoat: .1, clearcoatRoughness: .5 });
    m.userData.U = U;
    m.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
attribute float _m_tee; attribute float _m_long; attribute float _m_jeans; attribute float _m_skirt; attribute float _m_shoes;
uniform vec4 uWear; uniform float uShoes;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
float cover = max(max(_m_tee * uWear.x, _m_long * uWear.y), max(max(_m_jeans * uWear.z, _m_skirt * uWear.w), _m_shoes * uShoes));
transformed -= objectNormal * 0.007 * cover;`);
    };
    m.customProgramCacheKey = () => 'body-v' + VER;
    return m;
  }
  function setupMaterials(asset) {
    const M = asset.meshes;
    M.body.material = bodyMaterial();
    for (const id of GARMENTS) if (M[id]) M[id].material = garmentMaterial(M[id].material, id === 'jeans');
    if (M.shoes) {
      const sm = M.shoes.material, top = asset.H * 0.07;
      sm.side = THREE.FrontSide;
      sm.userData.uSock = { value: new THREE.Color() };   // above the shoe collar is the ankle: mannequin colour, not a white sock
      sm.onBeforeCompile = sh => {
        sh.uniforms.uSock = sm.userData.uSock;
        sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
attribute float _h; varying float vH;`).replace('#include <begin_vertex>', `#include <begin_vertex>
vH = _h;`);
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying float vH; uniform vec3 uSock;`)
          .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
if (vH > ${top.toFixed(4)}) discard;`)
          .replace('#include <map_fragment>', `#include <map_fragment>
if (vH > ${(top * 0.72).toFixed(4)}) diffuseColor.rgb = uSock;`);
      };
      sm.customProgramCacheKey = () => 'shoes-v' + VER;
    }
  }

  /* ---------- brush strokes (cut / restore / paint / erase) → canvases in the brush UVs ---------- */
  const hexRgb = h => { const n = parseInt(h.slice(1), 16); return `${n >> 16},${n >> 8 & 255},${n & 255}`; };
  function redrawBrush(mesh, strokes) {
    const md = mesh.material.userData, W = 1024;
    const last = JSON.stringify(strokes[strokes.length - 1] || null);
    if (md.brushN === strokes.length && md.lastStroke === last) return;
    // add only the new strokes when the list just grew; redraw everything after undo / clearing
    const grew = md.brushN != null && strokes.length > md.brushN && JSON.stringify(strokes[md.brushN - 1] || null) === md.lastStroke;
    const { mask, paint } = md;
    if (!grew) { mask.x.fillStyle = '#fff'; mask.x.fillRect(0, 0, W, W); paint.x.clearRect(0, 0, W, W); }
    for (let i = grew ? md.brushN : 0; i < strokes.length; i++) {
      const k = strokes[i], x = k.uv[0] * W, y = k.uv[1] * W, r = Math.max(1, k.r * W);
      if (k.t === 'cut' || k.t === 'keep') {
        mask.x.fillStyle = k.t === 'cut' ? '#000' : '#fff';
        mask.x.beginPath(); mask.x.arc(x, y, r, 0, TAU); mask.x.fill();
      } else {
        const p = paint.x;
        p.save();
        p.globalCompositeOperation = k.t === 'erase' ? 'destination-out' : 'source-over';
        const c = k.t === 'erase' ? '0,0,0' : hexRgb(k.c), a = k.t === 'erase' ? 1 : k.a;
        const gr = p.createRadialGradient(x, y, 0, x, y, r);
        gr.addColorStop(0, `rgba(${c},${a})`); gr.addColorStop(.7, `rgba(${c},${a * .85})`); gr.addColorStop(1, `rgba(${c},0)`);
        p.fillStyle = gr; p.beginPath(); p.arc(x, y, r, 0, TAU); p.fill();
        p.restore();
      }
    }
    md.brushN = strokes.length;
    md.lastStroke = last;
    mask.t.needsUpdate = paint.t.needsUpdate = true;
  }

  /* ---------- apply the editor state ---------- */
  const IMG = {};
  function printTexture(id) {
    if (!cc.images[id]) return null;
    if (!IMG[id]) { const t = new THREE.TextureLoader().load(cc.images[id], () => S3.update()); t.colorSpace = THREE.SRGBColorSpace; IMG[id] = t; }
    return IMG[id];
  }
  const PAT = { solid: 0, stripe: 1, check: 2, dot: 3 };
  let hoverCut = null;
  const meshOf = (slot, g) => !g ? null : slot === 'top' ? (g.kind === 'long' ? 'long' : 'tee') : (g.kind === 'skirt' ? 'skirt' : 'jeans');
  const legC = () => 0.09 * A.H / 1.77;
  const r4 = v => Math.round(v * 1e4) / 1e4;
  /* top length (the editor's y, 750 = floor) ↔ cut height in metres. Up to TOP_FULL the top ends where the asset ends
     (as it always did); longer than that uses the fabric added below the asset's hem. */
  const TOP_FULL = 380;
  function topCut(id, len) {
    const k = A.H / 728, lo0 = A.info[id].lo0, h = (750 - len) * k;
    if (h >= lo0) return h;
    return len <= TOP_FULL ? lo0 : lo0 - (len - TOP_FULL) * k;
  }
  function topLen(id, h) {
    const k = A.H / 728, lo0 = A.info[id].lo0;
    return h >= lo0 ? 750 - h / k : TOP_FULL + (lo0 - h) / k;
  }
  /* neckline: 5 points per side (two ends on the shoulder line, two in between, one in the middle).
     The cut follows a smooth curve through them (straight lines for a V) and never rises above the garment's own edge. */
  const NSPAN = H => 0.115 * H / 1.77;
  function ownY(id, side, x) {
    const o = A.info[id][side === 'F' ? 'neckF' : 'neckB'];
    if (x <= o[0][0]) return o[0][1];
    for (let i = 0; i < NO - 1; i++) if (x <= o[i + 1][0]) return lerp(o[i][1], o[i + 1][1], (x - o[i][0]) / (o[i + 1][0] - o[i][0]));
    return o[NO - 1][1];
  }
  const edgeY = (id, side, x) => ownY(id, side, x) + 0.004;
  function neckCtrl(T, id, side) {
    let st = T && T['neck' + side];
    if (st && st.length === 9) st = [0, 2, 4, 6, 8].map(i => st[i]);   // saved before the 5-point version
    if (st && st.length === NC) return st.map(([x, y]) => [x * A.H, y * A.H]);
    const w = NSPAN(A.H);
    return [-w, -w / 2, 0, w / 2, w].map(x => [x, edgeY(id, side, x)]);
  }
  function mono(P, x) {   // monotone cubic through points sorted by x: smooth, no overshoot
    const n = P.length, d = [], m = [];
    for (let i = 0; i < n - 1; i++) d[i] = (P[i + 1][1] - P[i][1]) / Math.max(1e-5, P[i + 1][0] - P[i][0]);
    m[0] = d[0]; m[n - 1] = d[n - 2];
    for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
    for (let i = 0; i < n - 1; i++) {
      if (!d[i]) { m[i] = m[i + 1] = 0; continue; }
      const a = m[i] / d[i], b = m[i + 1] / d[i], q = a * a + b * b;
      if (q > 9) { const t = 3 / Math.sqrt(q); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
    }
    let i = 0;
    while (i < n - 2 && x > P[i + 1][0]) i++;
    const h = Math.max(1e-5, P[i + 1][0] - P[i][0]), t = clamp((x - P[i][0]) / h, 0, 1), t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * P[i][1] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * P[i + 1][1] + (t3 - t2) * h * m[i + 1];
  }
  function neckCurve(T, id, side) {
    if (!T['neck' + side]) return A.info[id][side === 'F' ? 'neckF' : 'neckB'].map(([x, y]) => [x, y + 0.004]);
    const c = neckCtrl(T, id, side).sort((a, b) => a[0] - b[0]), sharp = side === 'F' && T.neckV;
    return Array.from({ length: NP }, (_, i) => {
      const x = lerp(c[0][0], c[NC - 1][0], i / (NP - 1));
      let y;
      if (sharp) { let j = 0; while (j < NC - 2 && x > c[j + 1][0]) j++; y = lerp(c[j][1], c[j + 1][1], clamp((x - c[j][0]) / Math.max(1e-5, c[j + 1][0] - c[j][0]), 0, 1)); }
      else y = mono(c, x);
      return [x, Math.min(y, edgeY(id, side, x))];
    });
  }
  // keep a dragged neckline point sensible: in order left to right, ends on the shoulder line, not too deep, never above the fabric
  function fixCtrl(pts, i, id, side, sym) {
    const H = A.H, gap = 0.012 * H / 1.77, wmax = 0.19 * H / 1.77, wmin = 0.03 * H / 1.77, mid = (NC - 1) / 2;
    let x = pts[i][0], y = pts[i][1];
    if (sym && i === mid) x = 0;
    else {
      let lo = i > 0 ? pts[i - 1][0] + gap : -wmax, hi = i < NC - 1 ? pts[i + 1][0] - gap : wmax;
      if (sym) { if (i < mid) hi = Math.min(hi, -gap); else lo = Math.max(lo, gap); }
      if (i === 0) hi = Math.min(hi, -wmin);
      if (i === NC - 1) lo = Math.max(lo, wmin);
      x = clamp(x, lo, hi);
    }
    const top = edgeY(id, side, x), deep = (side === 'F' ? 0.33 : 0.38) * H / 1.77;
    y = i === 0 || i === NC - 1 ? top : clamp(y, edgeY(id, side, 0) - deep, top);
    pts[i] = [x, y];
    if (sym && i !== mid) pts[NC - 1 - i] = [-x, y];
  }
  function applyState() {
    const st = cc.state, pr = cc.prefs, Y = cc.Y, B = cc.BODY, H = A.H, k = H / 728;
    const toH = y => (750 - y) * k;
    const M = A.meshes, T = st.top, Bt = st.bottom;
    const topMesh = meshOf('top', T), botMesh = meshOf('bottom', Bt);
    for (const id of GARMENTS) if (M[id]) M[id].visible = id === topMesh || id === botMesh;
    M.body.material.userData.U.uWear.value.set(topMesh === 'tee' ? 1 : 0, topMesh === 'long' ? 1 : 0, botMesh === 'jeans' ? 1 : 0, botMesh === 'skirt' ? 1 : 0);
    const f = FIN[pr.finish] || FIN.white;
    M.body.material.color.set(f.color); M.body.material.roughness = f.roughness; M.body.material.clearcoat = f.clearcoat;
    if (M.shoes) M.shoes.material.userData.uSock.value.set(f.color);
    const morph = (mesh, w) => { const d = mesh.morphTargetDictionary, inf = mesh.morphTargetInfluences; if (d && inf) for (const n in d) inf[d[n]] = w[n] || 0; };
    const common = (U, g, id) => {
      const mat = M[id].material;
      U.uC1.value.set(g.fill.c1); U.uC2.value.set(g.fill.c2); U.uPat.value = PAT[g.fill.type] || 0; U.uScale.value = g.fill.scale || 1;
      // the sheen follows the fabric colour: a black tee must not get a white haze
      mat.sheenColor.set(g.fill.c1).lerp(new THREE.Color('#ffffff'), .15);
      const ds = (g.dmg3 || []).filter(d => d.g === id && d.p).slice(-MAXD);
      ds.forEach((d, i) => U.uDmg.value[i].set(d.p[0], d.p[1], d.p[2], d.lv));
      U.uDmgN.value = ds.length;
      const p = g.print, p3 = g.print3 && g.print3.g === id && g.print3.p ? g.print3 : null, tex = p && printTexture(p.img);
      U.uPrintOn.value = tex && tex.image ? 1 : 0;
      if (U.uPrintOn.value) {
        U.uPrint.value = tex;
        const c = p3 ? p3.p : (id === 'jeans' || id === 'skirt') ? [0.08 * (H / 1.77), toH(470), 0] : [0, toH(226), 0];
        U.uPrintBox.value.set(c[0], c[1], p.w * k, p.w * p.ar * k);
      }
      const strokes = (g.strokes || []).filter(s => s.g === id);
      U.uBrushOn.value = strokes.length ? 1 : 0;
      redrawBrush(M[id], strokes);
      const off = g.hemOff || [];
      for (let i = 0; i < HP; i++) U.uHemOff.value[i] = (off[i] || 0) * H;
      U.uHover.value = hoverCut && hoverCut.mesh === id && !hoverCut.sleeve ? hoverCut.h : -10;
    };
    if (topMesh) {
      const U = M[topMesh].material.userData.U, wristY = B.armO[B.armO.length - 1][0], inf = A.info[topMesh];
      common(U, T, topMesh);
      U.uCutH.value = topCut(topMesh, T.len);
      // over a full skirt a top worn out ends just past the skirt's waistband (it can't hang down over the skirt's volume)
      if (botMesh === 'skirt' && !T.tuck) U.uCutH.value = Math.max(U.uCutH.value, A.info.skirt.hi - .07);
      U.uSh.value.set(inf.hi - .06, inf.hi - .2);
      U.uRaw.value = T.rawHem ? 1 : 0;
      const sb = T.sleeve <= cc.SLEEVELESS ? 0.02 : clamp((T.sleeve - B.st0[1]) / (wristY - B.st0[1]), 0.02, 2), adj = T.sleeveAdj || [0, 0];
      U.uSleeveCut.value.set(clamp(sb + adj[0], .02, 2), clamp(sb + adj[1], .02, 2));
      U.uRawS.value = T.rawSleeve ? 1 : 0;
      U.uTuckH.value = T.tuck && botMesh === 'jeans' ? A.info.jeans.hi - .025 : -1;   // tucked: ends just inside the waistband
      U.uHemLeg.value = 0;
      const nf = neckCurve(T, topMesh, 'F'), nb = neckCurve(T, topMesh, 'B');
      nf.forEach((q, i) => U.uNeckF.value[i].set(q[0], q[1])); nb.forEach((q, i) => U.uNeckB.value[i].set(q[0], q[1]));
      U.uNeckOn.value = 1;
      // worn out (not tucked) over trousers or a skirt: the part below their waistband sits outside them
      const loose = clamp((T.fit - 5) / 21, 0, 1), over = !T.tuck ? 1 : 0;
      // lengthened: the old hem band lets go so the added length hangs on smoothly
      const ext = clamp((inf.lo0 - U.uCutH.value) / .03, 0, 1);
      // over jeans, oversized and lengthened each have a shape baked together with "over jeans":
      // use those and take "over jeans" itself out as many extra times as it was counted (it can go negative)
      const oj = botMesh === 'jeans' ? over : 0;
      morph(M[topMesh], oj ? { slim: clamp((5 - T.fit) / 7, 0, 1), loose_jeans: loose, ext_jeans: ext, over_jeans: 1 - loose - ext }
        : { slim: clamp((5 - T.fit) / 7, 0, 1), loose, ext, over_skirt: botMesh === 'skirt' ? over : 0 });
      U.uFit.value.set(clamp((T.fit - 26) * k * .5, 0, .04), clamp((T.sfit - 2) * k * .4, -.002, .03), Math.max(0, T.flare) * .05, 0);
      U.uFitH.value.set(toH(Y.waist), 0, 0, 0);
      U.uHem.value.set(Math.abs(U.uCutH.value - inf.lo0) > .01 || (T.hemOff || []).some(v => v) ? 1 : 0, Math.min(U.uSleeveCut.value.x, U.uSleeveCut.value.y) < inf.smax - .03 ? 1 : 0);
      U.uBand.value.set(0, 0, 0);
    }
    if (botMesh) {
      const U = M[botMesh].material.userData.U, inf = A.info[botMesh];
      common(U, Bt, botMesh);
      U.uCutH.value = toH(Bt.len);
      U.uRaw.value = Bt.rawHem ? 1 : 0;
      U.uSleeveCut.value.set(2, 2); U.uRawS.value = 0; U.uTuckH.value = -1; U.uNeckOn.value = 0;
      // a top worn out over the bottom covers its waistband: hide that strip (unless the top has holes or brush cuts there)
      const tc = topMesh && M[topMesh].material.userData.U, holes = T && ((T.strokes || []).length || (T.dmg3 || []).length || (T.hemOff || []).some(v => v));
      U.uUnder.value = T && !T.tuck && tc && !holes && tc.uCutH.value < inf.hi - .1 ? inf.hi - .045 : 99;
      U.uHemLeg.value = botMesh === 'jeans' ? legC() : 0;
      U.uHem.value.set(U.uCutH.value > inf.lo + .01 || (Bt.hemOff || []).some(v => v) ? 1 : 0, 0);
      if (botMesh === 'jeans') {
        const avg = (Bt.thigh + Bt.knee + Bt.hemW) / 3;
        morph(M.jeans, { slim: clamp((.42 - avg) / .32, 0, 1), wide: clamp((avg - .45) / .38, 0, 1) });
        U.uFit.value.set(0, 0, 0, 0);
        U.uFitH.value.set(0, toH(Y.knee), toH(Y.ankle), Math.max(0, Bt.hemW - Bt.knee - .1) * 39 * k * .6);
        U.uBand.value.set(inf.hi - .042, inf.hi, A.kind === 'm' ? 1 : 0);
      } else {
        morph(M.skirt, { slim: clamp((.3 - Bt.fit) / .3, 0, 1), flare: clamp((Bt.fit - .3) / .6, 0, 1) });
        U.uFit.value.set(clamp(Bt.hip * .02, 0, .02), 0, Math.max(0, Bt.fit - .9) * .3, 0);
        U.uFitH.value.set(toH(Y.hip), 0, 0, 0);
        U.uBand.value.set(0, 0, 0);
      }
    }
    const clip = A.clips[pr.pose] || A.clips.relaxed;
    if (A.pose !== clip) { A.mixer.stopAllAction(); A.mixer.clipAction(clip).play(); A.mixer.setTime(0); A.pose = clip; }
    if (!dragH) buildHandles();
    else handles.filter(hd => hd.kind === dragH.kind && hd.slot === dragH.slot).forEach(locate);
    // while a point is being dragged the garment turns see-through, so the body and the new line show clearly
    for (const id of GARMENTS) {
      const m = M[id] && M[id].material, see = !!dragH && (dragH.slot === 'top' ? id === topMesh : id === botMesh);
      if (!m || m.transparent === see) continue;
      m.transparent = see; m.opacity = see ? .5 : 1; m.depthWrite = !see;
    }
  }

  /* ---------- frame loop ---------- */
  let dirty = true, needs = true, backKey = '', buildMs = 0, shown = null;
  function rebuild() {
    const t0 = performance.now(), pr = cc.prefs;
    if (pr.backdrop !== backKey) {
      backKey = pr.backdrop;
      const col = BACK[backKey] || BACK.studio;
      floorMat.color.set(col);
      scene.background = new THREE.Color(col);
      scene.fog = new THREE.Fog(col, 8, 22);
      wrap.style.background = col;
    }
    const kind = pr.body === 'm' ? 'm' : 'f';
    if (!ASSETS[kind]) {
      if (!loading) loading = loadBody(kind).then(() => { loading = null; dirty = true; }).catch(e => { loading = null; console.error(e); cc.say('3D 마네킹을 불러오지 못했어요'); });
      return;
    }
    A = ASSETS[kind];
    if (shown !== A) { if (shown) scene.remove(shown.root); scene.add(A.root); shown = A; fit(); }
    applyState();
    buildMs = performance.now() - t0;
  }
  function fit() {
    const r = wrap.getBoundingClientRect(), w = Math.max(1, r.width), h = Math.max(1, r.height);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const H = A ? A.H : 1.8, t = Math.tan(camera.fov * PI / 360);
    controls.target.set(0, H * 0.5, 0);
    const pad = w < 700 ? 0.5 : 0.28;   // phones: room for the bars above and below the mannequin
    const d = Math.max((H * 0.5 + pad) / t, 0.55 / (t * camera.aspect));
    const dir = camera.position.clone().sub(controls.target).setY(0);
    if (dir.length() < .5) dir.set(0, 0, 1);
    dir.normalize();
    camera.position.copy(controls.target).addScaledVector(dir, d);
    camera.position.y = H * 0.55;
    controls.minDistance = d * 0.35;
    controls.maxDistance = d * 1.4;
    controls.update();
    needs = true;
  }
  new ResizeObserver(fit).observe(wrap);
  fit();
  (function frame() {
    requestAnimationFrame(frame);
    if (dirty) { dirty = false; rebuild(); needs = true; }
    if (controls.update() || needs) { needs = false; renderer.render(scene, camera); placeHandles(); }
  })();
  controls.addEventListener('change', () => { needs = true; });

  /* ---------- picking ---------- */
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), tri = new THREE.Triangle(), bary = new THREE.Vector3();
  const vA = new THREE.Vector3(), vB = new THREE.Vector3(), vC = new THREE.Vector3(), tmp = new THREE.Vector3();
  const tip = document.createElement('div');
  tip.className = 'tip3';
  wrap.appendChild(tip);
  function hit(e, ids) {
    if (!A) return null;
    const r = canvas.getBoundingClientRect();
    ndc.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const cands = (ids || GARMENTS).map(id => A.meshes[id]).filter(m => m && m.visible);
    const h = ray.intersectObjects(cands, false)[0];
    if (!h) return null;
    const o = h.object, g = o.geometry, P = g.attributes.position, { a, b, c } = h.face;
    o.getVertexPosition(a, vA); o.getVertexPosition(b, vB); o.getVertexPosition(c, vC);
    vA.applyMatrix4(o.matrixWorld); vB.applyMatrix4(o.matrixWorld); vC.applyMatrix4(o.matrixWorld);
    tri.set(vA, vB, vC).getBarycoord(h.point, bary);
    const ip = (attr, comp = 0) => {
      const get = i => comp === 0 ? attr.getX(i) : comp === 1 ? attr.getY(i) : attr.getZ(i);
      return get(a) * bary.x + get(b) * bary.y + get(c) * bary.z;
    };
    const uv1 = g.attributes.uv1;
    // brush UVs per metre at this spot, so a brush of n cm is n cm wherever you paint
    let uvPerM = 1;
    if (uv1) {
      const du = Math.hypot(uv1.getX(b) - uv1.getX(a), uv1.getY(b) - uv1.getY(a)) + Math.hypot(uv1.getX(c) - uv1.getX(a), uv1.getY(c) - uv1.getY(a));
      const dm = vB.distanceTo(vA) + vC.distanceTo(vA);
      uvPerM = dm > 1e-6 ? du / dm : 1;
    }
    return {
      mesh: o.name, slot: o.name === 'tee' || o.name === 'long' ? 'top' : 'bottom', rest: [ip(P, 0), ip(P, 1), ip(P, 2)],
      h: g.attributes._h ? ip(g.attributes._h) : 0, s: g.attributes._s ? ip(g.attributes._s) : 0, point: h.point, uv: uv1 ? [ip(uv1, 0), ip(uv1, 1)] : null, uvPerM,
    };
  }
  // metres per screen pixel at a world point (for dragging edit points and sizing the brush ring)
  function mPerPx(p) {
    const d = camera.position.distanceTo(p), r = canvas.getBoundingClientRect();
    return 2 * d * Math.tan(camera.fov * PI / 360) / r.height;
  }
  function project(p) {
    const r = canvas.getBoundingClientRect(), r2 = wrap.getBoundingClientRect();
    tmp.copy(p).project(camera);
    return [(tmp.x + 1) / 2 * r.width + r.left - r2.left, (1 - tmp.y) / 2 * r.height + r.top - r2.top];
  }

  /* ---------- edit points: neckline (9 front / 9 back), hem (8 around), sleeve ends ---------- */
  function nearestVertex(mesh, test) {
    const P = mesh.geometry.attributes.position, h = mesh.geometry.attributes._h, s = mesh.geometry.attributes._s;
    let best = -1, bd = 1e9;
    for (let i = 0; i < P.count; i++) { const d = test(P.getX(i), P.getY(i), P.getZ(i), h.getX(i), s.getX(i)); if (d < bd) { bd = d; best = i; } }
    return best;
  }
  // which garment vertex an edit point sits on, worked out again whenever its value changes
  function locate(hd) {
    const st = cc.state, T = st.top, H = A.H, mesh = hd.mesh;
    if (hd.kind === 'nf' || hd.kind === 'nb') {
      const c = neckCtrl(T, meshOf('top', T), hd.side)[hd.i];
      hd.pt = c;
      hd.vi = nearestVertex(mesh, (vx, vy, vz, vh, vs) => vs > .02 || (hd.side === 'F' ? vz < 0 : vz > 0) ? 1e9 : (vx - c[0]) ** 2 + (vy - c[1]) ** 2);
    } else if (hd.kind === 'hem') {
      const g = st[hd.slot], id = mesh.name, U = mesh.material.userData.U, lc = id === 'jeans' ? legC() : 0;
      const a = hd.i / HP * TAU, ch = Math.max(U.uCutH.value, A.info[id].lo) + ((g.hemOff || [])[hd.i] || 0) * H;
      hd.vi = nearestVertex(mesh, (vx, vy, vz, vh, vs) => {
        if (vs > .02 || (lc && vx < 0)) return 1e9;   // trousers: points round the left leg (the right one mirrors it)
        const ax = lc ? Math.abs(vx) - lc : vx, ang = Math.atan2(ax, vz), da = Math.atan2(Math.sin(ang - a), Math.cos(ang - a));
        return da * da * 0.02 + Math.max(0, ch - vh) ** 2 * 400 + (vh - ch) ** 2 * 40;
      });
    } else {
      const sc = mesh.material.userData.U.uSleeveCut.value, sx = hd.side === 0 ? 1 : -1;
      const target = Math.min(hd.side === 0 ? sc.x : sc.y, A.info[mesh.name].smax) - .01;
      hd.vi = nearestVertex(mesh, (vx, vy, vz, vh, vs) => vs < .02 || Math.sign(vx) !== sx ? 1e9 : (vs - target) ** 2 * 50 + vz * vz * .2);
    }
  }
  function buildHandles() {
    handles.forEach(hd => hd.el.remove());
    handles = [];
    if (!A) return;
    const tool = cc.tool, st = cc.state, T = st.top, Bt = st.bottom;
    const add = (kind, mesh, extra) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'h3d ' + kind;
      el.setAttribute('aria-label', { nf: '앞 목선 점', nb: '뒤 목선 점', hem: '밑단 점', sl: '소매 끝 점' }[kind]);
      layer.appendChild(el);
      const hd = { kind, mesh, el, ...extra };
      if (kind === 'nf' || kind === 'nb') el.classList.toggle('end', extra.i === 0 || extra.i === NC - 1);
      el.addEventListener('pointerdown', e => startDrag(e, hd));
      locate(hd);
      if (hd.vi < 0) { el.remove(); return; }
      handles.push(hd);
    };
    if (tool === 'neck' && T) {
      const mesh = A.meshes[meshOf('top', T)];
      for (const side of ['F', 'B']) for (let i = 0; i < NC; i++) add(side === 'F' ? 'nf' : 'nb', mesh, { side, i, slot: 'top' });
    }
    if (tool === 'cut' && cc.ui.cutMode === 'line') {
      for (const [slot, g] of [['top', T], ['bottom', Bt]]) {
        if (!g) continue;
        const mesh = A.meshes[meshOf(slot, g)];
        for (let i = 0; i < HP; i++) add('hem', mesh, { slot, i });
      }
      if (T && T.sleeve > cc.SLEEVELESS) {
        const mesh = A.meshes[meshOf('top', T)];
        for (const side of [0, 1]) add('sl', mesh, { side, slot: 'top' });
      }
    }
    placeHandles();
  }
  function placeHandles() {
    if (!handles.length) { guide.innerHTML = ''; return; }
    const camDir = new THREE.Vector3().subVectors(camera.position, controls.target).setY(0).normalize();
    const P0 = new THREE.Vector3();
    for (const hd of handles) {
      hd.mesh.getVertexPosition(hd.vi, tmp);
      if (hd.pt) {   // neckline points sit exactly on their value, not just on the nearest vertex
        P0.fromBufferAttribute(hd.mesh.geometry.attributes.position, hd.vi);
        tmp.x += hd.pt[0] - P0.x; tmp.y += hd.pt[1] - P0.y;
      }
      tmp.applyMatrix4(hd.mesh.matrixWorld);
      const world = tmp.clone();
      const out = new THREE.Vector3(world.x - controls.target.x, 0, world.z - controls.target.z);
      const facing = out.length() < .02 || out.normalize().dot(camDir) > -0.15;
      const [x, y] = project(world);
      hd.world = world;
      hd.el.style.transform = `translate(${x}px, ${y}px)`;
      // a side's neckline points show only while you look at that side
      const side = hd.kind === 'nf' ? 1 : hd.kind === 'nb' ? -1 : 0;
      const look = !side || Math.abs(camDir.z) < .25 || Math.sign(camDir.z) === side;
      hd.el.hidden = (!facing || !look) && hd !== dragH;
      hd.el.classList.toggle('on', hd === dragH);
      hd.sx = x; hd.sy = y;
    }
    // while dragging, the line as it was before stays as a faint dashed line
    guide.innerHTML = dragH && dragH.before ? `<path d="${dragH.before}" fill="none" stroke="#fff" stroke-width="2.2" stroke-dasharray="4 4" opacity=".95"/>` : '';
  }
  const pathOf = hd => {   // the line through the points of the garment being edited, as it was
    const pts = handles.filter(h => h.kind === hd.kind && h.slot === hd.slot && !h.el.hidden).sort((a, b) => hd.kind === 'hem' ? a.sx - b.sx : a.i - b.i);
    return hd.kind !== 'sl' && pts.length > 1 ? 'M' + pts.map(h => h.sx.toFixed(1) + ' ' + h.sy.toFixed(1)).join('L') : '';
  };
  function startDrag(e, hd) {
    e.preventDefault(); e.stopPropagation();
    // finger-sized grab areas overlap where points are close: take the point nearest the touch, not the one on top
    const r0 = layer.getBoundingClientRect();
    let best = hd, bd = 1e9;
    for (const h of handles) {
      if (h.el.hidden) continue;
      const d = (h.sx + r0.left - e.clientX) ** 2 + (h.sy + r0.top - e.clientY) ** 2;
      if (d < bd) { bd = d; best = h; }
    }
    hd = best;
    dragH = hd;
    controls.enabled = false;   // a finger on a point must not also turn the view
    hd.el.setPointerCapture(e.pointerId);
    hd.x0 = e.clientX; hd.y0 = e.clientY;
    const st = cc.state;
    hd.before = pathOf(hd);
    const r = hd.el.getBoundingClientRect();
    hd.gx = r.left + r.width / 2 - e.clientX; hd.gy = r.top + r.height / 2 - e.clientY;   // grab offset, so the point doesn't jump
    if (hd.kind === 'nf' || hd.kind === 'nb') hd.start = neckCtrl(st.top, meshOf('top', st.top), hd.side).map(p => p.slice());
    else if (hd.kind === 'hem') hd.start = (st[hd.slot].hemOff || new Array(HP).fill(0)).slice();
    else hd.start = (st.top.sleeveAdj || [0, 0]).slice();
    hd.mpp = mPerPx(hd.world || controls.target);
    const move = ev => dragMove(ev, hd), up = () => {
      hd.el.removeEventListener('pointermove', move); hd.el.removeEventListener('pointerup', up); hd.el.removeEventListener('pointercancel', up);
      hd.before = ''; dragH = null; controls.enabled = true; cc.commit(); dirty = true;
    };
    hd.el.addEventListener('pointermove', move); hd.el.addEventListener('pointerup', up); hd.el.addEventListener('pointercancel', up);
  }
  function dragMove(e, hd) {
    const st = cc.state, H = A.H, dx = (e.clientX - hd.x0) * hd.mpp, dy = -(e.clientY - hd.y0) * hd.mpp;
    // screen-right in rest space: +x seen from the front, −x from behind
    const camSide = (camera.position.z - controls.target.z) >= 0 ? 1 : -1;
    const sym = cc.ui.neckSym;
    if (hd.kind === 'nf' || hd.kind === 'nb') {
      const T = st.top, id = meshOf('top', T), pts = hd.start.map(p => p.slice());
      // the point goes where the pointer is on the body underneath (exact from any angle); off the body, by distance moved
      const b = hit({ clientX: e.clientX + hd.gx, clientY: e.clientY + hd.gy }, ['body']);
      pts[hd.i] = b ? [b.rest[0], b.rest[1]] : [hd.start[hd.i][0] + dx * camSide, hd.start[hd.i][1] + dy];
      fixCtrl(pts, hd.i, id, hd.side, sym);
      const mid = (NC - 1) / 2;
      if (hd.i === mid) for (const j of [mid - 1, mid + 1]) {   // the points either side follow the middle part-way, so it deepens into a U, not a slit
        pts[j] = [hd.start[j][0], hd.start[j][1] + (pts[mid][1] - hd.start[mid][1]) * .55];
        fixCtrl(pts, j, id, hd.side, false);
      }
      T['neck' + hd.side] = pts.map(([x, y]) => [r4(x / H), r4(y / H)]);
    } else if (hd.kind === 'hem') {
      const g = st[hd.slot], off = hd.start.slice();
      const id = hd.mesh.name, base = Math.max(hd.mesh.material.userData.U.uCutH.value, A.info[id].lo);
      off[hd.i] = r4(clamp(hd.start[hd.i] + dy / H, (A.info[id].lo - base) / H, (A.info[id].hi - .08 - base) / H));   // can't add fabric below the hem
      if (sym) { const j = (HP - hd.i) % HP; if (j !== hd.i) off[j] = off[hd.i]; }   // left ↔ right around the body
      g.hemOff = off;
    } else {
      const T = st.top, adj = hd.start.slice();
      adj[hd.side] = Math.round((hd.start[hd.side] - dy * 1.6) * 1e3) / 1e3;
      if (sym) adj[1 - hd.side] = adj[hd.side];
      T.sleeveAdj = adj;
    }
    cc.render();
  }

  /* ---------- tools on the 3D stage: scissors (line / brush cut / restore), damage, colour (pick / print / paint) ---------- */
  function cutInfo(h) {
    const st = cc.state, B = cc.BODY, k = A.H / 728, y2 = 750 - h.h / k;
    if (h.slot === 'top' && h.s > 0.01) {
      const T = st.top, wristY = B.armO[B.armO.length - 1][0], ny = lerp(B.st0[1], wristY, h.s);
      const v = ny <= cc.Y.armpit + 8 ? 190 : ny;
      return v >= T.sleeve - 4 ? null : { key: 'sleeve', val: v, label: cc.sleeveName(v), mesh: h.mesh, sleeve: true, s: h.s };
    }
    if (h.slot === 'top') {
      const T = st.top, ny = clamp(topLen(h.mesh, h.h), cc.LIMIT['top.len'][0], T.len);
      return ny >= T.len - 4 ? null : { key: 'topLen', val: ny, label: cc.topLenName(ny), mesh: h.mesh, h: topCut(h.mesh, ny) };
    }
    const Bt = st.bottom, lim = cc.bottomLenLimit(Bt), ny = clamp(y2, lim[0], Bt.len);
    return ny >= Bt.len - 4 ? null : { key: 'bottomLen', val: ny, label: cc.bottomLenName(Bt, ny), mesh: h.mesh, h: (750 - ny) * k };
  }
  function showCut(c, e) {
    hoverCut = c;
    dirty = true;
    if (!c) { tip.classList.remove('show'); return; }
    const r = wrap.getBoundingClientRect();
    tip.textContent = '✂ ' + c.label;
    tip.style.left = (e.clientX - r.left + 14) + 'px'; tip.style.top = (e.clientY - r.top - 12) + 'px';
    tip.classList.add('show');
  }
  function paintAt(h, first) {
    const g = cc.state[h.slot];
    if (!g) return;
    const list = g.dmg3 || (g.dmg3 = []);
    const dist = q => Math.hypot(q.p[0] - h.rest[0], q.p[1] - h.rest[1], q.p[2] - h.rest[2]);
    const near = list.reduce((best, q, i) => { if (q.g !== h.mesh || !q.p) return best; const d = dist(q); return d < (best ? best.d : .035) ? { i, d } : best; }, null);
    if (cc.dmgMode === 'erase') { if (near) list.splice(near.i, 1); }
    else if (near) { if (first) list[near.i].lv = Math.min(3, list[near.i].lv + 1); }
    else list.push({ g: h.mesh, p: h.rest.map(r4), lv: 1 });
    cc.render();
  }
  // one brush dab into the garment's brush canvas (cut / keep / paint / erase)
  function brushAt(h, t) {
    if (!h.uv) return;
    const g = cc.state[h.slot], ui = cc.ui, list = g.strokes || (g.strokes = []);
    const k = { t, g: h.mesh, uv: h.uv.map(r4), r: r4(ui.brushSize / 100 * h.uvPerM) };
    if (t === 'paint') { k.c = ui.brushColor; k.a = ui.brushAlpha; }
    list.push(k);
    if (list.length > 4000) list.splice(0, list.length - 4000);
    cc.render();
  }
  const brushMode = () => {
    const tool = cc.tool, ui = cc.ui;
    if (tool === 'cut' && ui.cutMode !== 'line') return ui.cutMode === 'free' ? 'cut' : 'keep';
    if (tool === 'color' && ui.paintOn) return ui.paintErase ? 'erase' : 'paint';
    return null;
  };
  function showBrush(e, h) {
    if (!brushMode() || !h) { brushRing.classList.remove('show'); return; }
    const r = wrap.getBoundingClientRect(), px = cc.ui.brushSize / 100 / mPerPx(h.point);
    brushRing.style.width = brushRing.style.height = (px * 2) + 'px';
    brushRing.style.transform = `translate(${e.clientX - r.left - px}px, ${e.clientY - r.top - px}px)`;
    brushRing.classList.add('show');
  }
  let drag = null;
  canvas.addEventListener('pointerdown', e => {
    if (e.button > 0) return;
    const tool = cc.tool, bm = brushMode();
    if (!['cut', 'dmg', 'color'].includes(tool)) return;
    const h = hit(e);
    if (!h) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    if (bm) {
      brushAt(h, bm);
      drag = { type: 'brush', mode: bm, slot: h.slot, last: h.point.clone() };
    } else if (tool === 'cut') {
      const c = cutInfo(h);
      if (e.pointerType === 'mouse') { if (c) { cc.applyCut(c); showCut(null); } return; }
      drag = { type: 'cut', c };
      showCut(c, e);
    } else if (tool === 'dmg') {
      paintAt(h, true);
      drag = { type: 'dmg', slot: h.slot, last: h.point.clone() };
    } else {
      const g = cc.state[h.slot];
      if (cc.state.target !== h.slot) { cc.setTarget(h.slot); return; }
      if (g && g.print) { g.print3 = { g: h.mesh, p: h.rest }; cc.render(); cc.commit(); cc.say('프린트를 옮겼어요'); }
      return;
    }
    canvas.setPointerCapture(e.pointerId);
  }, { capture: true });
  canvas.addEventListener('pointermove', e => {
    const bm = brushMode();
    if (drag) {
      const h = hit(e);
      if (drag.type === 'cut') { drag.c = h ? cutInfo(h) : null; showCut(drag.c, e); }
      else if (drag.type === 'brush') {
        showBrush(e, h);
        if (h && h.slot === drag.slot && h.point.distanceTo(drag.last) > cc.ui.brushSize / 100 * 0.4) { brushAt(h, drag.mode); drag.last = h.point.clone(); }
      } else if (h && h.slot === drag.slot && h.point.distanceTo(drag.last) > .03) { paintAt(h, false); drag.last = h.point.clone(); }
      return;
    }
    const tool = cc.tool;
    if (bm && !e.buttons) {
      const h = hit(e);
      showBrush(e, h);
      canvas.style.cursor = h ? 'none' : '';
    } else if (tool === 'cut' && e.pointerType === 'mouse' && !e.buttons) {
      const h = hit(e);
      showCut(h ? cutInfo(h) : null, e);
      canvas.style.cursor = h ? 'crosshair' : '';
    } else if ((tool === 'dmg' || tool === 'color') && !e.buttons) {
      canvas.style.cursor = hit(e) ? (tool === 'dmg' ? 'crosshair' : 'pointer') : '';
    } else if (!e.buttons) { canvas.style.cursor = ''; brushRing.classList.remove('show'); }
  });
  const end = () => {
    if (!drag) return;
    const d = drag; drag = null;
    if (d.type === 'cut') { if (d.c) cc.applyCut(d.c); showCut(null); }
    else cc.commit();
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('pointerleave', () => { if (!drag) { if (hoverCut) showCut(null); brushRing.classList.remove('show'); } });

  /* ---------- public ---------- */
  const VIEWS = { front: 0, side: -PI / 2, back: PI };
  const S3 = {
    update() { dirty = true; },
    get lastBuildMs() { return buildMs; },
    setView(v) {
      const ang = VIEWS[v] ?? 0, t = controls.target, d = camera.position.distanceTo(t), y = camera.position.y;
      const hr = Math.sqrt(Math.max(0, d * d - (y - t.y) ** 2));
      camera.position.set(t.x + hr * Math.sin(ang), y, t.z + hr * Math.cos(ang));
      controls.update(); needs = true;
    },
    // neckline presets drawn as the 9 points: depth/width/U↔V like the 2D presets, never above the garment's own line
    neckPreset(id) {
      const T = cc.state.top;
      if (!T || !A) return;
      const p = { round: [12, 30, 0], u: [62, 36, 0], v: [58, 30, 1], deepv: [112, 32, 1], boat: [10, 62, 0] }[id];
      const mesh = meshOf('top', T), k = A.H / 728, H = A.H;
      const depth = p[0] * k, w = p[1] * k * 1.1, base = edgeY(mesh, 'F', 0);
      const mk = (side, dep) => [-w, -w / 2, 0, w / 2, w].map((x, i) => {
        const top = edgeY(mesh, side, x), y = i === 0 || i === 4 ? top : Math.min(top, edgeY(mesh, side, 0) - dep * (i === 2 ? 1 : p[2] ? .5 : .87));
        return [r4(x / H), r4(y / H)];
      });
      T.neckF = mk('F', depth);
      T.neckB = id === 'boat' ? mk('B', .01) : null;
      T.neckV = p[2] ? 1 : 0;
      cc.render(); cc.commit();
    },
    savePNG() {
      const w = 1000, h = 1500, prev = new THREE.Vector2();
      renderer.getSize(prev);
      const pa = camera.aspect, pr = renderer.getPixelRatio(), hv = hoverCut;
      hoverCut = null;
      if (A) applyState();
      renderer.setPixelRatio(1); renderer.setSize(w, h, false);
      camera.aspect = w / h; camera.updateProjectionMatrix();
      renderer.render(scene, camera);
      canvas.toBlob(b => {
        hoverCut = hv;
        renderer.setPixelRatio(pr); renderer.setSize(prev.x, prev.y, false);
        camera.aspect = pa; camera.updateProjectionMatrix(); dirty = needs = true;
        if (!b) return cc.say('저장에 실패했어요');
        const a = document.createElement('a');
        a.href = URL.createObjectURL(b); a.download = '고쳐입기.png'; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        cc.say('PNG로 저장했어요');
      }, 'image/png');
    },
  };
  S3._debug = { camera, controls, scene, renderer, get asset() { return A; } };
  cc.attach3D(S3);
}
