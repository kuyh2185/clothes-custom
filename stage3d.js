/* 고쳐 입기 — 3D stage.
   Mannequins and garments are real assets built in Blender (blender/export_web.py): MPFB (MakeHuman) model bodies,
   CC0 MakeHuman garments fitted by MPFB's proxy system and skinned to one game-engine rig, poses as animations.
   The editor's parameters are applied in the shaders, in rest-pose space (so they stay put in any pose):
   colour/pattern over the fabric's own shading, hem/sleeve cutting (with fraying), neckline carving, fit offsets,
   washes and rips (real holes), and printed images. The body is pushed just inside whatever covers it. */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

const cc = window.__cc;
const PI = Math.PI;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const VER = 6;   // bump with the assets

let renderer = null;
try { renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); } catch (e) { console.warn('고쳐 입기: WebGL 없음, 2D로 그려요', e); }
if (cc && renderer) start();

function start() {
  const wrap = document.querySelector('.stage-wrap');
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const canvas = renderer.domElement;
  canvas.id = 'stage3d';
  canvas.setAttribute('aria-label', '옷을 입은 3D 마네킹 — 끌어서 돌려 보기');
  wrap.insertBefore(canvas, document.getElementById('stage'));

  /* ---------- studio ---------- */
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.6;
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

  scene.add(new THREE.HemisphereLight(0xffffff, 0x8d847a, 0.5));
  const key = new THREE.DirectionalLight(0xfff4e8, 2.6);
  key.position.set(-2.4, 4.6, 3.6);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -2, right: 2, top: 2.6, bottom: -1.2, near: 0.5, far: 14 });
  key.shadow.bias = -0.0003;
  key.shadow.normalBias = 0.02;
  key.shadow.radius = 4;
  key.target.position.set(0, 0.9, 0);
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight(0xeef1ff, 0.75);
  fill.position.set(3, 2.2, 3);
  const rim = new THREE.DirectionalLight(0xffffff, 1.2);
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
  const ASSETS = {};   // kind → { root, meshes, mixer, clips, H }
  let A = null, loading = null;
  const loadBody = kind => {
    if (ASSETS[kind]) return Promise.resolve(ASSETS[kind]);
    return new Promise((res, rej) => loader.load(`assets/body_${kind}.glb?v=${VER}`, g => {
      const root = g.scene, meshes = {};
      root.traverse(o => {
        if (o.isMesh) {
          o.castShadow = o.receiveShadow = true;
          o.frustumCulled = false;
          meshes[o.name] = o;
        }
      });
      const box = new THREE.Box3().setFromObject(meshes.body);
      const ext = {};
      for (const [id, m] of Object.entries(meshes)) {
        const h = m.geometry.attributes._h, sa = m.geometry.attributes._s;
        if (!h) continue;
        let lo = 1e9, hi = -1e9, smax = 0;
        for (let i = 0; i < h.count; i++) { const v = h.getX(i); if (v < lo) lo = v; if (v > hi) hi = v; if (sa && sa.getX(i) > smax) smax = sa.getX(i); }
        ext[id] = { lo, hi, smax };
      }
      const mixer = new THREE.AnimationMixer(root), clips = {};
      g.animations.forEach(c => { clips[c.name] = c; });
      const asset = { root, meshes, mixer, clips, H: box.max.y, ext, kind };
      setupMaterials(asset);
      ASSETS[kind] = asset;
      res(asset);
    }, undefined, rej));
  };

  /* ---------- shaders ---------- */
  const FIN = {
    white: { color: '#e9e6e0', roughness: .55, clearcoat: .08 },
    stone: { color: '#b3aa9c', roughness: .7, clearcoat: 0 },
    black: { color: '#141415', roughness: .45, clearcoat: .25 },
  };
  // average colour of a texture (linear), so recolouring keeps the fabric's own variation (fades, whiskers, weave)
  function avgColor(tex) {
    try {
      const im = tex.image, c = document.createElement('canvas');
      c.width = c.height = 16;
      const x = c.getContext('2d');
      x.drawImage(im, 0, 0, 16, 16);
      const d = x.getImageData(0, 0, 16, 16).data, s = [0, 0, 0];
      for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) s[k] += Math.pow(d[i + k] / 255, 2.2);
      return new THREE.Vector3(...s.map(v => Math.max(.02, v / 256)));
    } catch (e) { return new THREE.Vector3(.5, .5, .5); }
  }
  function avgLum(tex) {
    try {
      const im = tex.image, c = document.createElement('canvas');
      c.width = c.height = 16;
      const x = c.getContext('2d');
      x.drawImage(im, 0, 0, 16, 16);
      const d = x.getImageData(0, 0, 16, 16).data;
      let s = 0;
      for (let i = 0; i < d.length; i += 4) s += (.2126 * d[i] + .7152 * d[i + 1] + .0722 * d[i + 2]) / 255;
      return Math.max(.15, s / 256);
    } catch (e) { return .6; }
  }
  const MAXD = 16;
  // garment material: the asset's own maps for shading/wrinkles, our colour and edits on top
  function garmentMaterial(src, keepColour) {
    const U = {
      uC1: { value: new THREE.Color() }, uC2: { value: new THREE.Color() }, uPat: { value: 0 }, uScale: { value: 1 },
      uAvg: { value: src.map ? avgLum(src.map) : .7 }, uAvgC: { value: src.map ? avgColor(src.map) : new THREE.Vector3(.5, .5, .5) }, uKeep: { value: keepColour ? 1 : 0 }, uMix: { value: 1 },
      uCutH: { value: -1 }, uSleeveCut: { value: 2 }, uRaw: { value: 0 }, uRawS: { value: 0 }, uTuckH: { value: -1 },
      uNeck: { value: new THREE.Vector4(0, 0, 0, 0) }, uNeckY: { value: 1.5 },
      uFit: { value: new THREE.Vector4(0, 0, 0, 0) }, uFitH: { value: new THREE.Vector4(0, 0, 0, 0) },
      uDmg: { value: Array.from({ length: MAXD }, () => new THREE.Vector4()) }, uDmgN: { value: 0 },
      uPrint: { value: null }, uPrintOn: { value: 0 }, uPrintBox: { value: new THREE.Vector4() },
      uHover: { value: -10 }, uHoverS: { value: -10 },
      uBand: { value: new THREE.Vector3(0, 0, 0) }, uHem: { value: new THREE.Vector2(0, 0) },
    };
    const m = new THREE.MeshPhysicalMaterial({
      map: src.map || null, normalMap: src.normalMap || null, aoMap: src.aoMap || null,
      roughness: .9, metalness: 0, sheen: .6, sheenRoughness: .8, sheenColor: new THREE.Color('#ffffff'),
      side: THREE.DoubleSide,
    });
    if (src.normalMap) m.normalScale = src.normalScale ? src.normalScale.clone() : new THREE.Vector2(1, 1);
    m.userData.U = U;
    m.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
attribute float _h; attribute float _s;
varying vec3 vRest; varying float vH; varying float vS;
uniform vec4 uFit; uniform vec4 uFitH;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
vRest = position; vH = _h; vS = _s;
// fit: x = body, y = sleeves, z = flare below uFitH.x; jeans: w (thigh) → uFitH.w (hem) between heights uFitH.y and uFitH.z
float off = (vS > 0.01 ? uFit.y : uFit.x);
off += uFit.z * max(0.0, uFitH.x - _h);
if (uFitH.y > 0.0) { float t = clamp((uFitH.y - _h) / max(0.01, uFitH.y - uFitH.z), 0.0, 1.0); off += mix(uFit.w, uFitH.w, t); }
transformed += objectNormal * off;`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
varying vec3 vRest; varying float vH; varying float vS;
uniform vec3 uC1; uniform vec3 uC2; uniform float uPat; uniform float uScale; uniform float uAvg; uniform vec3 uAvgC; uniform float uKeep; uniform float uMix;
uniform float uCutH; uniform float uSleeveCut; uniform float uRaw; uniform float uRawS; uniform float uTuckH;
uniform vec4 uNeck; uniform float uNeckY;
uniform vec4 uDmg[${MAXD}]; uniform int uDmgN;
uniform sampler2D uPrint; uniform float uPrintOn; uniform vec4 uPrintBox;
uniform float uHover; uniform float uHoverS;
uniform vec3 uBand; uniform vec2 uHem;
float hash(float n) { return fract(sin(n) * 43758.5453); }
float noise1(float x) { float i = floor(x), f = fract(x); return mix(hash(i), hash(i + 1.0), f * f * (3.0 - 2.0 * f)); }`)
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
// hem / sleeve cut (frayed when cut with the scissors) and tuck
float fr = uRaw > 0.5 ? (noise1(vRest.x * 900.0 + vRest.z * 700.0) * 0.006) : 0.0;
if (vS < 0.01 && vH < uCutH + fr) discard;
float frs = uRawS > 0.5 ? noise1(vRest.y * 900.0 + vRest.z * 600.0) * 0.03 : 0.0;
if (vS > 0.01 && vS > uSleeveCut - frs) discard;
if (uTuckH > 0.0 && vS < 0.01 && vH < uTuckH) discard;
// neckline carved in front: U (round) … V (straight)
if (uNeck.w > 0.5 && vRest.z > 0.0 && abs(vRest.x) < uNeck.y) {
  float r = abs(vRest.x) / uNeck.y;
  float shape = mix(sqrt(max(0.0, 1.0 - r * r)), 1.0 - r, uNeck.z);
  if (vRest.y > uNeckY - uNeck.x * shape) discard;
}
// rips: level-3 spots are holes, with white weft threads left across them
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
// our colour over the fabric's own shading (its luminance relative to its average)
// shading from a blurred look at the fabric texture: folds and shadows stay, printed motifs (florals, logos) go
#ifdef USE_MAP
vec3 blurTex = texture2D(map, vMapUv, 6.5).rgb;
#else
vec3 blurTex = vec3(uAvg);
#endif
float lum = dot(blurTex, vec3(0.2126, 0.7152, 0.0722));
float detail = clamp(lum / uAvg, 0.45, 1.35);
vec3 base = uC1;
float s = uScale;
if (uPat > 0.5 && uPat < 1.5) { if (fract(vH / (0.05 * s)) < 0.4) base = uC2; }
else if (uPat > 1.5 && uPat < 2.5) {
  float side = abs(vRest.z) > abs(vRest.x) ? vRest.x : vRest.z;
  float b = step(fract(vH / (0.06 * s)), 0.42) + step(fract(side / (0.06 * s)), 0.42);
  base = mix(uC1, uC2, min(1.0, b) * 0.55 + step(1.5, b) * 0.3);
}
else if (uPat > 2.5) {
  float side = abs(vRest.z) > abs(vRest.x) ? vRest.x : vRest.z;
  vec2 g = vec2(side, vH) / (0.028 * s);
  vec2 c = fract(g + vec2(0.5 * mod(floor(g.y), 2.0), 0.0)) - 0.5;
  if (length(c) < 0.27) base = uC2;
}
// denim keeps its own colour variation (fades, whiskers) shifted to the chosen colour; other fabrics use their shading only
vec3 tinted = uKeep > 0.5 && uPat < 0.5 ? clamp(diffuseColor.rgb / uAvgC, 0.0, 2.5) * base : base * detail;
diffuseColor.rgb = mix(diffuseColor.rgb, tinted, uMix);
// washes / fraying
for (int i = 0; i < ${MAXD}; i++) {
  if (i >= uDmgN) break;
  vec4 d = uDmg[i];
  vec3 q = vRest - d.xyz;
  float rr = 0.035 + d.w * 0.008;
  float k = exp(-(q.x * q.x + q.z * q.z) / (rr * rr) - (q.y * q.y) / (rr * rr * 1.6));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.93, 0.9), k * (0.28 + d.w * 0.12));
  if (d.w > 1.5 && k > 0.35 && fract(vRest.y * 140.0 + hash(float(i))) < 0.18) diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.97), 0.7);
}
// printed image, projected onto the front
if (uPrintOn > 0.5 && vRest.z > 0.0) {
  vec2 pu = (vRest.xy - uPrintBox.xy) / uPrintBox.zw + 0.5;
  if (pu.x > 0.0 && pu.x < 1.0 && pu.y > 0.0 && pu.y < 1.0) { vec4 pc = texture2D(uPrint, vec2(pu.x, pu.y)); diffuseColor.rgb = mix(diffuseColor.rgb, pc.rgb, pc.a); }
}
// waistband (x..y, on z): plain denim band with two rows of amber stitching
if (uBand.z > 0.5 && vH > uBand.x && vS < 0.01) {
  diffuseColor.rgb = uC1 * clamp(detail, 0.8, 1.1) * 0.92;
  float st = min(abs(vH - (uBand.y - 0.007)), abs(vH - (uBand.x + 0.006)));
  if (st < 0.0011 && fract((vRest.x + vRest.z) * 90.0) < 0.55) diffuseColor.rgb = vec3(0.78, 0.57, 0.23);
  if (abs(vH - uBand.x) < 0.0012) diffuseColor.rgb *= 0.7;
}
// a neat folded hem where the scissors cut (not frayed): slightly darker band and a stitch line
if (uHem.x > 0.5 && uRaw < 0.5 && vS < 0.01 && vH < uCutH + 0.02) {
  diffuseColor.rgb *= 0.9;
  if (abs(vH - (uCutH + 0.014)) < 0.0009 && fract((vRest.x + vRest.z) * 70.0) < 0.6) diffuseColor.rgb *= 0.6;
}
if (uHem.y > 0.5 && uRawS < 0.5 && vS > 0.01 && vS > uSleeveCut - 0.05) diffuseColor.rgb *= 0.9;
// raw edge: lighter frayed band just above the cut
if (uRaw > 0.5 && vS < 0.01 && vH < uCutH + 0.012) diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.95), 0.35);
// scissors preview: dashed line where the cut would go
if (abs(vH - uHover) < 0.0016 && vS < 0.01 && fract((vRest.x + vRest.z) * 40.0) < 0.6) diffuseColor.rgb = vec3(0.05);
if (abs(vS - uHoverS) < 0.006 && vS > 0.01 && fract(vRest.y * 60.0) < 0.6) diffuseColor.rgb = vec3(0.05);`);
    };
    m.customProgramCacheKey = () => 'garment-v' + VER;
    return m;
  }
  // mannequin: pushed just inside whatever garment covers it (so it never pokes through, and shows through rips)
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
    for (const id of ['tee', 'long', 'jeans', 'skirt']) if (M[id]) M[id].material = garmentMaterial(M[id].material, id === 'jeans');
    if (M.shoes) {
      // the sneakers come with tall grey socks: keep only a short white ankle sock
      const sm = M.shoes.material, top = asset.H * 0.07;
      sm.side = THREE.FrontSide;
      sm.onBeforeCompile = sh => {
        sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
attribute float _h; varying float vH;`).replace('#include <begin_vertex>', `#include <begin_vertex>
vH = _h;`);
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying float vH;`)
          .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
if (vH > ${top.toFixed(4)}) discard;`)
          .replace('#include <map_fragment>', `#include <map_fragment>
if (vH > ${(top * 0.72).toFixed(4)}) diffuseColor.rgb = vec3(0.92);`);
      };
      sm.customProgramCacheKey = () => 'shoes-v' + VER;
    }
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
  function applyState() {
    const st = cc.state, pr = cc.prefs, Y = cc.Y, B = cc.BODY, H = A.H, k = H / 728;   // editor units → metres
    const toH = y => (750 - y) * k;
    const M = A.meshes;
    const T = st.top, Bt = st.bottom;
    const topMesh = T ? (T.kind === 'long' ? 'long' : 'tee') : null, botMesh = Bt ? (Bt.kind === 'skirt' ? 'skirt' : 'jeans') : null;
    for (const id of ['tee', 'long', 'jeans', 'skirt']) if (M[id]) M[id].visible = id === topMesh || id === botMesh;
    const bu = M.body.material.userData.U;
    bu.uWear.value.set(topMesh === 'tee' ? 1 : 0, topMesh === 'long' ? 1 : 0, botMesh === 'jeans' ? 1 : 0, botMesh === 'skirt' ? 1 : 0);
    const f = FIN[pr.finish] || FIN.white;
    M.body.material.color.set(f.color); M.body.material.roughness = f.roughness; M.body.material.clearcoat = f.clearcoat;
    // fit variants baked with cloth simulation in Blender (morph targets), blended by the fit settings
    const morph = (mesh, w) => {
      const d = mesh.morphTargetDictionary, inf = mesh.morphTargetInfluences;
      if (d && inf) for (const name in d) inf[d[name]] = w[name] || 0;
    };
    const ext = A.ext;
    const common = (U, g, id) => {
      U.uC1.value.set(g.fill.c1); U.uC2.value.set(g.fill.c2); U.uPat.value = PAT[g.fill.type] || 0; U.uScale.value = g.fill.scale || 1;
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
      U.uHover.value = hoverCut && hoverCut.mesh === id && !hoverCut.sleeve ? hoverCut.h : -10;
      U.uHoverS.value = hoverCut && hoverCut.mesh === id && hoverCut.sleeve ? hoverCut.s : -10;
    };
    if (topMesh) {
      const U = M[topMesh].material.userData.U, wristY = B.armO[B.armO.length - 1][0];
      common(U, T, topMesh);
      U.uCutH.value = toH(T.len);
      U.uRaw.value = T.rawHem ? 1 : 0;
      U.uSleeveCut.value = T.sleeve <= cc.SLEEVELESS ? 0.02 : clamp((T.sleeve - B.st0[1]) / (wristY - B.st0[1]), 0.02, 2);
      U.uRawS.value = T.rawSleeve ? 1 : 0;
      U.uTuckH.value = T.tuck && Bt && Bt.kind === 'jeans' ? toH(Y.waist + B.rise + 6) : -1;
      // neckline: only carve when it is deeper / wider / more V than the garment's own crew neck
      const carve = T.neckD > 16 || T.neckW > 24 || T.neckV > .25;
      U.uNeck.value.set(T.neckD * k, T.neckW * k, T.neckV, carve ? 1 : 0);
      U.uNeckY.value = toH(Y.neck) + 0.012;
      // regular = the asset as made; tighter → the shrink-wrapped variant, looser → the draped (cloth-simulated) one
      morph(M[topMesh], { slim: clamp((5 - T.fit) / 7, 0, 1), loose: clamp((T.fit - 5) / 21, 0, 1) });
      U.uFit.value.set(clamp((T.fit - 26) * k * .5, 0, .04), clamp((T.sfit - 2) * k * .4, -.002, .03), Math.max(0, T.flare) * .05, 0);
      U.uFitH.value.set(toH(Y.waist), 0, 0, 0);
      U.uHem.value.set(U.uCutH.value > ext[topMesh].lo + .01 ? 1 : 0, U.uSleeveCut.value < ext[topMesh].smax - .03 ? 1 : 0);
      U.uBand.value.set(0, 0, 0);
    }
    if (botMesh) {
      const U = M[botMesh].material.userData.U;
      common(U, Bt, botMesh);
      U.uCutH.value = toH(Bt.len);
      U.uRaw.value = Bt.rawHem ? 1 : 0;
      U.uSleeveCut.value = 2; U.uRawS.value = 0; U.uTuckH.value = -1; U.uNeck.value.set(0, 0, 0, 0);
      U.uHem.value.set(U.uCutH.value > ext[botMesh].lo + .01 ? 1 : 0, 0);
      if (botMesh === 'jeans') {
        // skinny ← asset → wide-leg (cloth-simulated); a bootcut/flare hem adds a little at the bottom
        const avg = (Bt.thigh + Bt.knee + Bt.hemW) / 3;
        morph(M.jeans, { slim: clamp((.42 - avg) / .32, 0, 1), wide: clamp((avg - .45) / .38, 0, 1) });
        const flareHem = Math.max(0, Bt.hemW - Bt.knee - .1) * 39 * k * .6;
        U.uFit.value.set(0, 0, 0, 0);
        U.uFitH.value.set(0, toH(Y.knee), toH(Y.ankle), flareHem);
        // the men's jeans come from a suit whose waistband was hidden by the shirt: paint a proper one
        U.uBand.value.set(ext.jeans.hi - .042, ext.jeans.hi, A.kind === 'm' ? 1 : 0);
      } else {
        morph(M.skirt, { slim: clamp((.3 - Bt.fit) / .3, 0, 1), flare: clamp((Bt.fit - .3) / .6, 0, 1) });
        U.uFit.value.set(clamp(Bt.hip * .02, 0, .02), 0, Math.max(0, Bt.fit - .9) * .3, 0);
        U.uFitH.value.set(toH(Y.hip), 0, 0, 0);
        U.uBand.value.set(0, 0, 0);
      }
    }
    const clip = A.clips[pr.pose] || A.clips.relaxed;
    if (A.pose !== clip) {
      A.mixer.stopAllAction();
      A.mixer.clipAction(clip).play();
      A.mixer.setTime(0);
      A.pose = clip;
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
    const d = Math.max((H * 0.5 + 0.28) / t, 0.55 / (t * camera.aspect));
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
    if (controls.update() || needs) { needs = false; renderer.render(scene, camera); }
  })();
  controls.addEventListener('change', () => { needs = true; });

  /* ---------- tools on the 3D stage ---------- */
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), tri = new THREE.Triangle(), bary = new THREE.Vector3();
  const vA = new THREE.Vector3(), vB = new THREE.Vector3(), vC = new THREE.Vector3();
  const tip = document.createElement('div');
  tip.className = 'tip3';
  wrap.appendChild(tip);
  function hit(e) {
    if (!A) return null;
    const r = canvas.getBoundingClientRect();
    ndc.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const cands = ['tee', 'long', 'jeans', 'skirt'].map(id => A.meshes[id]).filter(m => m && m.visible);
    const h = ray.intersectObjects(cands, false)[0];
    if (!h) return null;
    // rest-pose position and attributes at the hit, from the posed triangle's barycentric coordinates
    const o = h.object, g = o.geometry, P = g.attributes.position, { a, b, c } = h.face;
    o.getVertexPosition(a, vA); o.getVertexPosition(b, vB); o.getVertexPosition(c, vC);
    tri.set(vA.applyMatrix4(o.matrixWorld), vB.applyMatrix4(o.matrixWorld), vC.applyMatrix4(o.matrixWorld)).getBarycoord(h.point, bary);
    const ip = (attr, comp = 0) => {
      const get = i => comp === 0 ? attr.getX(i) : comp === 1 ? attr.getY(i) : attr.getZ(i);
      return get(a) * bary.x + get(b) * bary.y + get(c) * bary.z;
    };
    return { mesh: o.name, slot: o.name === 'tee' || o.name === 'long' ? 'top' : 'bottom', rest: [ip(P, 0), ip(P, 1), ip(P, 2)], h: ip(g.attributes._h), s: ip(g.attributes._s), point: h.point };
  }
  function cutInfo(h) {
    const st = cc.state, B = cc.BODY, k = A.H / 728, y2 = 750 - h.h / k;
    if (h.slot === 'top' && h.s > 0.01) {
      const T = st.top, wristY = B.armO[B.armO.length - 1][0], ny = lerp(B.st0[1], wristY, h.s);
      const v = ny <= cc.Y.armpit + 8 ? 190 : ny;
      return v >= T.sleeve - 4 ? null : { key: 'sleeve', val: v, label: cc.sleeveName(v), mesh: h.mesh, sleeve: true, s: h.s };
    }
    if (h.slot === 'top') {
      const T = st.top, ny = clamp(y2, cc.LIMIT['top.len'][0], T.len);
      return ny >= T.len - 4 ? null : { key: 'topLen', val: ny, label: cc.topLenName(ny), mesh: h.mesh, h: (750 - ny) * k };
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
    else list.push({ g: h.mesh, p: h.rest.map(v => Math.round(v * 1e4) / 1e4), lv: 1 });
    cc.render();
  }
  let drag = null;
  canvas.addEventListener('pointerdown', e => {
    if (e.button > 0) return;
    const tool = cc.tool;
    if (!['cut', 'dmg', 'color'].includes(tool)) return;
    const h = hit(e);
    if (!h) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    if (tool === 'cut') {
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
    if (drag) {
      const h = hit(e);
      if (drag.type === 'cut') { drag.c = h ? cutInfo(h) : null; showCut(drag.c, e); }
      else if (h && h.slot === drag.slot && h.point.distanceTo(drag.last) > .03) { paintAt(h, false); drag.last = h.point.clone(); }
      return;
    }
    const tool = cc.tool;
    if (tool === 'cut' && e.pointerType === 'mouse' && !e.buttons) {
      const h = hit(e);
      showCut(h ? cutInfo(h) : null, e);
      canvas.style.cursor = h ? 'crosshair' : '';
    } else if ((tool === 'dmg' || tool === 'color') && !e.buttons) {
      canvas.style.cursor = hit(e) ? (tool === 'dmg' ? 'crosshair' : 'pointer') : '';
    } else if (!e.buttons) canvas.style.cursor = '';
  });
  const end = () => {
    if (!drag) return;
    const d = drag; drag = null;
    if (d.type === 'cut') { if (d.c) cc.applyCut(d.c); showCut(null); }
    else cc.commit();
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('pointerleave', () => { if (!drag && hoverCut) showCut(null); });

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
