/* 고쳐 입기 — 3D stage.
   Mannequins and garments are real assets built in Blender (blender/export_web.py): MPFB (MakeHuman) model bodies,
   CC0 MakeHuman garments fitted by MPFB's proxy system and skinned to one game-engine rig, poses as animations,
   fit variants baked with cloth simulation as morph targets, and a second non-overlapping UV map for brushes.
   Editing happens in the shaders, in rest-pose space (so it stays put in any pose):
   colour/pattern over the fabric's own shading, a free neckline (9 draggable points, front and back), a free hem
   (8 draggable points around) and per-side sleeve ends, brush cutting/restoring and brush painting (canvas masks in
   the brush UVs), washes and rips, and printed graphics (gfx.js composites each print area — front, back, the
   outside of each sleeve — into a canvas; the shader projects it onto the fabric facing that way, and the graphics
   are picked, moved, resized and turned right on the garment). The body is pushed just inside whatever covers it. */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

const cc = window.__cc;
const PI = Math.PI, TAU = PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const VER = 13;   // bump with the assets
const GARMENTS = ['tee', 'long', 'shirt', 'hoodie', 'jeans', 'skirt'];
const TOPS = new Set(['tee', 'long', 'shirt', 'hoodie']);
const NP = 17, NO = 17, NC = 5, HP = 8, MAXD = 16, NA = 9;
// free shape: each garment part (body · left/right sleeve · left/right trouser leg) is a grid of length × angle round it;
// what is pulled out or pushed in is added there and the vertex shader moves the cloth along its normal by that much
const SHW = 48, SHR = 96, BR = 1.92, SLR = 0.8;   // angle bins, length bins; length (m) of the body/leg rows and of the sleeve rows
const RN = [.14, .045, .045, .075, .075];          // rough radius of each part (m): turns an angle round it into a distance
const NL = 24, LEGH = .96;                          // trouser-leg centre line: one point per 4 cm of height
const HANDS = [new THREE.Vector4(), new THREE.Vector4()];   // hand centres (xyz) + radius (w), in the garments' bind space   // neckline: shader samples / garment outline samples / handles per side

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
  // graphics tool: the picked graphic's outline on the garment, with corner (size) and turn handles
  const SVGNS = 'http://www.w3.org/2000/svg';
  const gbox = document.createElementNS(SVGNS, 'svg');
  gbox.setAttribute('class', 'gbox');
  gbox.innerHTML = '<line class="gb-stem"/><polygon class="gb-shape"/>';
  layer.appendChild(gbox);
  const gShape = gbox.querySelector('.gb-shape'), gStem = gbox.querySelector('.gb-stem');
  const gH = ['nw', 'ne', 'se', 'sw', 'rot'].map(k => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'gh ' + k;
    el.setAttribute('aria-label', k === 'rot' ? '그래픽 돌리기' : '그래픽 크기 바꾸기');
    el.addEventListener('pointerdown', e => gStart(e, k === 'rot' ? 'rot' : 'scale'));
    layer.appendChild(el);
    return el;
  });
  gShape.addEventListener('pointerdown', e => gStart(e, 'move'));
  let GS = null, gdrag = null;
  const gPts = new Map();   // pointers on a graphic (two fingers = pinch to resize and turn)

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
  let shAz = null;   // view direction the outline points were placed for
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
    clearance(meshes);
    setupMaterials(asset);
    ASSETS[kind] = asset;
    res(asset);
  }, undefined, rej));

  // what each garment looks like at rest: its height range, sleeve end, and its own neckline/shoulder outline
  // (front and back, as the highest point of the fabric at each x) — the free neckline starts on that outline
  function analyse(mesh, H) {
    const g = mesh.geometry, P = g.attributes.position, h = g.attributes._h, s = g.attributes._s, x = g.attributes._x, cl = g.attributes._c, n = P.count;
    let lo = 1e9, hi = -1e9, smax = 0, lo0 = 1e9, smax0 = 0;
    for (let i = 0; i < n; i++) {
      const v = h.getX(i); lo = Math.min(lo, v); hi = Math.max(hi, v); smax = Math.max(smax, s.getX(i));
      if (!x || x.getX(i) < .5) { lo0 = Math.min(lo0, v); smax0 = Math.max(smax0, s.getX(i)); }
    }
    const span = 0.19 * H / 1.77, xs = Array.from({ length: NO }, (_, i) => lerp(-span, span, i / (NO - 1)));   // out to the shoulder seam
    const outline = sgn => xs.map(x => {
      let best = -1e9;
      for (let i = 0; i < n; i++) {
        if (s.getX(i) > 0.02 || (cl && cl.getX(i) > .5)) continue;
        if (sgn * P.getZ(i) < 0.005 || Math.abs(P.getX(i) - x) > 0.009) continue;
        best = Math.max(best, P.getY(i));
      }
      return [x, best > -1e8 ? best : hi];
    });
    // each sleeve: its centre front-to-back, its length per unit of _s, and which way its outside faces (for the sleeve prints)
    const sl = {}, N = g.attributes.normal;
    for (const sgn of [1, -1]) {
      const bins = [[0, 0, 0, 0], [0, 0, 0, 0]];
      for (let i = 0; i < n; i++) {
        const sv = s.getX(i);
        if (sv <= .02 || sgn * P.getX(i) <= 0) continue;
        const b = sv >= .05 && sv < .15 ? bins[0] : sv >= .25 && sv < .35 ? bins[1] : null;
        if (b) { b[0] += P.getX(i); b[1] += P.getY(i); b[2] += P.getZ(i); b[3]++; }
      }
      if (!bins[0][3] || !bins[1][3] || !N) continue;
      const [c0, c1] = bins.map(b => [b[0] / b[3], b[1] / b[3], b[2] / b[3]]);
      const dx = c1[0] - c0[0], dy = c1[1] - c0[1], dl = Math.hypot(dx, dy) || 1;
      sl[sgn > 0 ? 'lsl' : 'rsl'] = {
        z: c0[2], L: Math.hypot(dx, dy, c1[2] - c0[2]) / .2, o: sgn > 0 ? [-dy / dl, dx / dl, 0] : [dy / dl, -dx / dl, 0],
        c0, dv: [0, 1, 2].map(k => (c1[k] - c0[k]) / .2),
      };
    }
    // sleeveless armhole, 5 points shoulder → armpit: the armpit is just under where the sleeve starts to leave the body,
    // the shoulder point a little in from there, on top of the shoulder; between them a quarter circle (a real armhole's U)
    let arm = null;
    let xa = 1e9, ya = 1e9;
    for (let i = 0; i < n; i++) { const sv = s.getX(i); if (sv > .05 && sv < .15 && P.getX(i) > 0) { xa = Math.min(xa, P.getX(i)); ya = Math.min(ya, P.getY(i)); } }
    if (xa < 1e8) {
      xa -= .008; ya -= .012;
      const xs = xa + .028 * H / 1.77;
      let ys = -1e9;
      for (let i = 0; i < n; i++) if (s.getX(i) < .01 && !(cl && cl.getX(i) > .5) && Math.abs(P.getX(i) - xs) < .012) ys = Math.max(ys, P.getY(i));
      if (ys > ya) arm = [0, 1, 2, 3, 4].map(t => [xa + (xs - xa) * Math.sqrt(1 - (t / 4) ** 2), lerp(ys + .01, ya, t / 4)]);
    }
    let zs = 0, zn = 0, lz = 0, ln = 0;
    for (let i = 0; i < n; i++) {
      if (s.getX(i) > .01) continue;
      zs += P.getZ(i); zn++;
      if (P.getY(i) < hi - .32) { lz += P.getZ(i); ln++; }
    }
    return { lo, lo0, hi, smax, smax0, neckF: outline(1), neckB: outline(-1), sl, arm, zc: zn ? zs / zn : 0, legZ: ln ? lz / ln : 0 };
  }

  // how far each garment vertex is from the body at rest (m): pulled-in shapes and waistbands stop just outside the body
  function clearance(meshes) {
    const B = meshes.body.geometry.attributes.position, cs = .03, grid = new Map();
    const key = (a, b, c) => ((a + 300) * 600 + (b + 300)) * 600 + (c + 300);
    for (let i = 0; i < B.count; i++) {
      const k = key(Math.floor(B.getX(i) / cs), Math.floor(B.getY(i) / cs), Math.floor(B.getZ(i) / cs));
      let c = grid.get(k); if (!c) grid.set(k, c = []); c.push(i);
    }
    for (const id of GARMENTS) {
      const m = meshes[id];
      if (!m) continue;
      const P = m.geometry.attributes.position, out = new Float32Array(P.count);
      for (let i = 0; i < P.count; i++) {
        const x = P.getX(i), y = P.getY(i), z = P.getZ(i), gx = Math.floor(x / cs), gy = Math.floor(y / cs), gz = Math.floor(z / cs);
        let best = 1e9;
        for (let r = 1; r <= 2 && best > 1e8; r++)
          for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) for (let c = -r; c <= r; c++) {
            const L = grid.get(key(gx + a, gy + b, gz + c));
            if (L) for (const j of L) { const d = (B.getX(j) - x) ** 2 + (B.getY(j) - y) ** 2 + (B.getZ(j) - z) ** 2; if (d < best) best = d; }
          }
        out[i] = best > 1e8 ? .06 : Math.sqrt(best);
      }
      m.geometry.setAttribute('_cl', new THREE.BufferAttribute(out, 1));
      // trousers: which leg each vertex belongs to, from its skin weights (+1 left leg bones, −1 right, 0 the hips) —
      // in the rest pose the knees nearly touch, so position alone can't tell
      const lg = new Float32Array(P.count), SI = m.geometry.attributes.skinIndex, SW = m.geometry.attributes.skinWeight;
      if (m.isSkinnedMesh && SI && SW) {
        const side = m.skeleton.bones.map(b => /^(thigh|calf|foot|ball)/.test(b.name) ? (/_l$/.test(b.name) ? 1 : /_r$/.test(b.name) ? -1 : 0) : 0);
        for (let i = 0; i < P.count; i++) for (let k = 0; k < 4; k++) lg[i] += side[SI.getComponent(i, k)] * SW.getComponent(i, k);
      }
      m.geometry.setAttribute('_lg', new THREE.BufferAttribute(lg, 1));
      if (id === 'jeans') {   // the left leg's centre at each height (the legs angle out, so a fixed centre would put the inseam on the wrong side)
        const acc = Array.from({ length: NL }, () => [0, 0, 0]);
        for (let i = 0; i < P.count; i++) {
          if (lg[i] < .6) continue;
          const b = Math.round(P.getY(i) / LEGH * (NL - 1));
          if (b >= 0 && b < NL) { acc[b][0] += P.getX(i); acc[b][1] += P.getZ(i); acc[b][2]++; }
        }
        let last = null;
        const line = acc.map(a => a[2] ? (last = [a[0] / a[2], a[1] / a[2]]) : null);
        for (let i = NL - 1; i >= 0; i--) if (!line[i]) line[i] = i < NL - 1 && line[i + 1] ? line[i + 1] : last;
        for (let i = 0; i < NL; i++) if (!line[i]) line[i] = line.find(Boolean);
        m.userData.legLine = line;
      }
    }
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
  const shapeTex = () => {
    const t = new THREE.DataTexture(new Float32Array(SHW * SHR * 5), SHW, SHR * 5, THREE.RedFormat, THREE.FloatType);
    t.needsUpdate = true;
    return t;
  };
  const brushCanvas = () => {
    const c = document.createElement('canvas'); c.width = c.height = 1024;
    const t = new THREE.CanvasTexture(c); t.flipY = false;
    return { c, x: c.getContext('2d'), t };
  };
  function garmentMaterial(src, keepColour, detail) {
    const st = src.map ? texStats(src.map) : { avgC: new THREE.Vector3(.5, .5, .5), avgL: .5 };
    const mask = brushCanvas(), paint = brushCanvas();
    mask.t.colorSpace = THREE.NoColorSpace; paint.t.colorSpace = THREE.SRGBColorSpace;
    const U = {
      uC1: { value: new THREE.Color() }, uC2: { value: new THREE.Color() }, uPat: { value: 0 }, uScale: { value: 1 },
      uAvg: { value: st.avgL }, uAvgC: { value: st.avgC }, uKeep: { value: keepColour ? 1 : 0 }, uDetail: { value: detail ?? 1 },
      uCutH: { value: -1 }, uSleeveCut: { value: new THREE.Vector2(2, 2) }, uRaw: { value: 0 }, uRawS: { value: 0 }, uTuckH: { value: -1 },
      uHemOff: { value: new Array(HP).fill(0) }, uHemLeg: { value: 0 },
      uNeckF: { value: Array.from({ length: NP }, () => new THREE.Vector2()) }, uNeckB: { value: Array.from({ length: NP }, () => new THREE.Vector2()) }, uNeckOn: { value: 0 },
      uFit: { value: new THREE.Vector4() }, uFitH: { value: new THREE.Vector4() }, uSh: { value: new THREE.Vector2(9, 10) }, uHand: { value: HANDS }, uHandOn: { value: 0 }, uHoodOff: { value: 0 },
      uDmg: { value: Array.from({ length: MAXD }, () => new THREE.Vector4()) }, uDmgN: { value: 0 },
      uG0: { value: null }, uG1: { value: null }, uG2: { value: null }, uG3: { value: null }, uGOn: { value: new THREE.Vector4() },
      uGBox: { value: Array.from({ length: 4 }, () => new THREE.Vector4()) }, uGSL: { value: new THREE.Vector2() },
      uGSO: { value: [new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0)] }, uGuide: { value: -1 },
      uShape: { value: shapeTex() }, uShapeOn: { value: 0 }, uFr: { value: new THREE.Vector4() }, uWaist: { value: 0 }, uLeg: { value: Array.from({ length: NL }, () => new THREE.Vector2(.09, 0)) },
      uSlC: { value: [new THREE.Vector3(), new THREE.Vector3()] }, uSlD: { value: [new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, -1, 0)] },
      uSlO: { value: [new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0)] }, uSlL: { value: new THREE.Vector2(.6, .6) },
      uArmF: { value: Array.from({ length: NA }, () => new THREE.Vector2()) }, uArmB: { value: Array.from({ length: NA }, () => new THREE.Vector2()) }, uArmOn: { value: 0 },
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
attribute float _h; attribute float _s; attribute float _c; attribute float _cl; attribute float _lg;
#ifndef USE_UV1
attribute vec2 uv1;
#endif
varying vec3 vRest; varying float vH; varying float vS; varying vec2 vB; varying float vC; varying vec3 vRN;
uniform vec4 uFit; uniform vec4 uFitH; uniform vec2 uSh; uniform vec4 uHand[2]; uniform float uHandOn;
uniform sampler2D uShape; uniform float uShapeOn; uniform vec4 uFr; uniform float uWaist;
uniform vec3 uSlC[2]; uniform vec3 uSlD[2]; uniform vec3 uSlO[2]; uniform vec2 uSlL; uniform vec2 uLeg[${NL}];
vec2 legCentre(float y) {   // the left leg's centre (x, z) at a height; the right leg mirrors it
  float f = clamp(y / ${LEGH}, 0.0, 1.0) * ${NL - 1}.0;
  int i0 = int(floor(f)), i1 = min(i0 + 1, ${NL - 1});
  vec2 a = uLeg[0], b = uLeg[0];
  for (int i = 0; i < ${NL}; i++) { if (i == i0) a = uLeg[i]; if (i == i1) b = uLeg[i]; }
  return mix(a, b, fract(f));
}
// the free shape grid: rows = length along the part, columns = angle round it (wraps), part r takes rows r*${SHR}..
float shapeCell(int r, float v, float range, float a) {
  float fy = clamp(v / range, 0.0, 1.0) * ${SHR - 1}.0, fx = fract(a / 6.2831853 + 1.0) * ${SHW}.0;
  int y0 = int(floor(fy)), y1 = min(y0 + 1, ${SHR - 1}), x0 = int(floor(fx)) % ${SHW}, x1 = (x0 + 1) % ${SHW}, b = r * ${SHR};
  float ty = fract(fy), tx = fract(fx);
  float a0 = mix(texelFetch(uShape, ivec2(x0, b + y0), 0).r, texelFetch(uShape, ivec2(x1, b + y0), 0).r, tx);
  float a1 = mix(texelFetch(uShape, ivec2(x0, b + y1), 0).r, texelFetch(uShape, ivec2(x1, b + y1), 0).r, tx);
  return mix(a0, a1, ty);
}
// the cloth moves straight out from the middle of its part (not along the vertex normal, which differs on either
// side of a seam and would tear it open). Angle round a sleeve: 0 = its outside; the right one mirrors the left
vec4 shapeOff(vec3 p, float s, float lg) {
  if (uFr.w < 0.5 && s > 0.01) {
    int i = p.x > 0.0 ? 0 : 1;
    vec3 d = normalize(uSlD[i]), q = p - (uSlC[i] + uSlD[i] * (s - 0.1));
    q -= d * dot(q, d);
    vec3 o = uSlO[i], b = cross(d, o) * (i == 0 ? 1.0 : -1.0);
    float v = shapeCell(1 + i, s * (i == 0 ? uSlL.x : uSlL.y), ${SLR}, atan(dot(q, b), dot(q, o))) * smoothstep(0.01, 0.07, s);
    return vec4(normalize(q + 1e-6), v);
  }
  if (uFr.w > 0.5 && uFr.w < 1.5) {   // trousers: each leg round its own centre; the hips (no leg) straight out from the middle
    vec2 lc = legCentre(p.y), ql = vec2(p.x - lc.x, p.z - lc.y), qr = vec2(p.x + lc.x, p.z - lc.y), qb = vec2(p.x, p.z - uFr.x);
    float t = clamp(lg * 0.5 + 0.5, 0.0, 1.0);
    vec2 q = normalize(mix(normalize(qb + 1e-6), normalize((lg > 0.0 ? ql : qr) + 1e-6), smoothstep(0.05, 0.6, abs(lg))) + 1e-6);
    return vec4(q.x, 0.0, q.y, mix(shapeCell(4, p.y, ${BR}, atan(qr.x, qr.y)), shapeCell(3, p.y, ${BR}, atan(ql.x, ql.y)), t));
  }
  vec2 q = vec2(p.x, p.z - uFr.x);
  return vec4(normalize(vec3(q.x, 0.0, q.y) + 1e-6), shapeCell(0, p.y, ${BR}, atan(q.x, q.y)));
}`)
        .replace('#include <skinning_vertex>', `#include <skinning_vertex>
// a hand never goes into the cloth: whatever is inside its sphere is pushed out round it
if (uHandOn > 0.5) for (int i = 0; i < 2; i++) {
  vec3 d = transformed - uHand[i].xyz; float r = length(d);
  if (uHand[i].w > 0.0 && r < uHand[i].w) transformed = uHand[i].xyz + d / max(r, 1e-4) * uHand[i].w;
}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
vRest = position; vH = _h; vS = _s; vB = uv1; vC = _c; vRN = normal;
float off = (vS > 0.01 ? uFit.y : uFit.x * (1.0 - smoothstep(uSh.y, uSh.x, _h)));   // no push at the shoulders: a big top hangs from them
off += uFit.z * max(0.0, uFitH.x - _h);
if (uFitH.y > 0.0) { float t = clamp((uFitH.y - _h) / max(0.01, uFitH.y - uFitH.z), 0.0, 1.0); off += mix(uFit.w, uFitH.w, t); }
transformed += objectNormal * off;
// pulled out / pushed in by hand, never into the body
if (uShapeOn > 0.5) { vec4 so = shapeOff(position, _s, _lg); transformed += so.xyz * max(so.w, 0.003 - _cl); }
// a waistband sits on the body instead of standing off it (drawn in towards the middle)
if (uWaist > 0.0) transformed -= normalize(vec3(position.x, 0.0, position.z - uFr.x) + 1e-6) * max(0.0, _cl - 0.004) * smoothstep(uWaist - 0.08, uWaist - 0.025, _h);`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
varying vec3 vRest; varying float vH; varying float vS; varying vec2 vB; varying float vC; varying vec3 vRN;
uniform float uHoodOff;
uniform vec3 uC1; uniform vec3 uC2; uniform float uPat; uniform float uScale; uniform float uAvg; uniform vec3 uAvgC; uniform float uKeep; uniform float uDetail;
uniform float uCutH; uniform vec2 uSleeveCut; uniform float uRaw; uniform float uRawS; uniform float uTuckH;
uniform float uHemOff[${HP}]; uniform float uHemLeg;
uniform vec2 uNeckF[${NP}]; uniform vec2 uNeckB[${NP}]; uniform float uNeckOn;
uniform vec2 uArmF[${NA}]; uniform vec2 uArmB[${NA}]; uniform float uArmOn;
// sleeveless: the armhole as (height, half-width) points from the armpit up to the shoulder; the body is cut outside it
bool outsideArm(vec2 pts[${NA}], float ax, float y) {
  if (y < pts[0].x) return false;
  if (y >= pts[${NA - 1}].x) return ax > pts[${NA - 1}].y;
  for (int i = 0; i < ${NA - 1}; i++) {
    if (y >= pts[i].x && y <= pts[i + 1].x) return ax > mix(pts[i].y, pts[i + 1].y, (y - pts[i].x) / max(1e-5, pts[i + 1].x - pts[i].x));
  }
  return false;
}
uniform vec4 uDmg[${MAXD}]; uniform int uDmgN;
uniform sampler2D uG0; uniform sampler2D uG1; uniform sampler2D uG2; uniform sampler2D uG3; uniform vec4 uGOn;
uniform vec4 uGBox[4]; uniform vec2 uGSL; uniform vec3 uGSO[2]; uniform float uGuide;
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
if (uHoodOff > 0.5 && vC > 0.5) discard;   // hood taken off
if (uNeckOn > 0.5 && vS < 0.01 && vC < 0.5) {   // the collar / hood stays: the neckline is cut below it
  if (vRest.z > 0.0 && aboveNeck(uNeckF, vRest.x, vRest.y)) discard;
  if (vRest.z <= 0.0 && aboveNeck(uNeckB, vRest.x, vRest.y)) discard;
}
if (uArmOn > 0.5 && vS < 0.01 && vC < 0.5) {
  if (vRest.z >= 0.0 && outsideArm(uArmF, abs(vRest.x), vRest.y)) discard;
  if (vRest.z < 0.0 && outsideArm(uArmB, abs(vRest.x), vRest.y)) discard;
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
float detail = mix(1.0, clamp(dot(blurTex, vec3(0.2126, 0.7152, 0.0722)) / uAvg, 0.5, 1.3), uDetail);   // some textures carry baked shading: keep only a little
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
// printed graphics: the print area facing this way (front, back, outside of a sleeve), projected flat onto the cloth
// (not round the sides, where a flat print would smear: like a real print, it stops before the side seams).
// gu = (across, up) in metres as seen from that side; the area box is (centre across, top, width, height)
int ga = -1; vec2 gu = vec2(0.0);
if (vC < 0.5) {
  if (vS < 0.01) {
    if (vRest.z > 0.0 && vRN.z > 0.3) { ga = 0; gu = vRest.xy; }
    else if (vRest.z < 0.0 && vRN.z < -0.3) { ga = 1; gu = vec2(-vRest.x, vRest.y); }
  }
  else if (vRest.x > 0.0 && dot(vRN, uGSO[0]) > 0.15) { ga = 2; gu = vec2(-vRest.z, -vS * uGSL.x); }
  else if (vRest.x < 0.0 && dot(vRN, uGSO[1]) > 0.15) { ga = 3; gu = vec2(vRest.z, -vS * uGSL.y); }
}
vec4 gb = ga == 0 ? uGBox[0] : ga == 1 ? uGBox[1] : ga == 2 ? uGBox[2] : uGBox[3];
float gon = ga == 0 ? uGOn.x : ga == 1 ? uGOn.y : ga == 2 ? uGOn.z : uGOn.w;
vec2 gq = vec2((gu.x - gb.x) / max(gb.z, 1e-4) + 0.5, (gb.y - gu.y) / max(gb.w, 1e-4));
bool gin = ga >= 0 && gb.z > 0.0 && gq.x > 0.0 && gq.x < 1.0 && gq.y > 0.0 && gq.y < 1.0;
vec2 gt = vec2(gq.x, 1.0 - gq.y);
vec4 g0 = texture2D(uG0, gt), g1 = texture2D(uG1, gt), g2 = texture2D(uG2, gt), g3 = texture2D(uG3, gt);
if (gin && gon > 0.5) {
  vec4 pc = ga == 0 ? g0 : ga == 1 ? g1 : ga == 2 ? g2 : g3;
  diffuseColor.rgb = mix(diffuseColor.rgb, pc.rgb * mix(1.0, detail, 0.5), pc.a);   // ink follows the weave a little
}
if (uGuide > -0.5 && gin && abs(float(ga) - uGuide) < 0.5) {   // the picked graphic's print area as a dashed line, its centre line faintly
  vec2 ge = min(gq, 1.0 - gq) * gb.zw;
  if (min(ge.x, ge.y) < 0.0028 && fract((gu.x + gu.y) * 55.0) < 0.55) diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.16, 0.05), 0.9);
  if (abs(gq.x - 0.5) * gb.z < 0.0011 && fract(gu.y * 45.0) < 0.5) diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9), 0.4);
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
    const U = { uWear: { value: new THREE.Vector4() }, uWear2: { value: new THREE.Vector2() }, uShoes: { value: 1 } };
    const m = new THREE.MeshPhysicalMaterial({ roughness: .55, clearcoat: .1, clearcoatRoughness: .5 });
    m.userData.U = U;
    m.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
attribute float _m_tee; attribute float _m_long; attribute float _m_jeans; attribute float _m_skirt; attribute float _m_shoes;
attribute float _m_shirt; attribute float _m_hoodie;
uniform vec4 uWear; uniform vec2 uWear2; uniform float uShoes;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
float cover = max(max(max(_m_tee * uWear.x, _m_long * uWear.y), max(_m_shirt * uWear2.x, _m_hoodie * uWear2.y)), max(max(_m_jeans * uWear.z, _m_skirt * uWear.w), _m_shoes * uShoes));
transformed -= objectNormal * 0.007 * cover;`);
    };
    m.customProgramCacheKey = () => 'body-v' + VER;
    return m;
  }
  function setupMaterials(asset) {
    const M = asset.meshes;
    M.body.material = bodyMaterial();
    for (const id of GARMENTS) if (M[id]) M[id].material = garmentMaterial(M[id].material, id === 'jeans', id === 'shirt' || id === 'hoodie' ? .12 : 1);
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
  // print areas of a garment as boxes in its rest space: [centre across, top, width, height] in metres
  const GA = ['front', 'back', 'lsl', 'rsl'];
  function gboxes(id) {
    const G = window.__gfx, inf = A.info[id], top = TOPS.has(id), AR = G ? G.AREAS[top ? 'top' : 'bottom'] : {}, mid = (NO - 1) >> 1;
    const box = (a, cx, y) => AR[a] ? [cx, y, AR[a].w / 100, AR[a].h / 100] : null;
    return {
      front: box('front', 0, top ? inf.neckF[mid][1] : inf.hi), back: box('back', 0, top ? inf.neckB[mid][1] : inf.hi),
      lsl: top && inf.sl.lsl ? box('lsl', -inf.sl.lsl.z, 0) : null, rsl: top && inf.sl.rsl ? box('rsl', inf.sl.rsl.z, 0) : null,
    };
  }
  const GTEX = {};
  function gtex(key, C) {
    let t = GTEX[key];
    if (!t || t.image !== C.c) {
      t = GTEX[key] = new THREE.CanvasTexture(C.c);
      t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = renderer.capabilities.getMaxAnisotropy(); t.userData.n = -1;
    }
    if (t.userData.n !== C.n) { t.userData.n = C.n; t.needsUpdate = true; }
    return t;
  }
  let noGuide = false;
  const PAT = { solid: 0, stripe: 1, check: 2, dot: 3 };
  let hoverCut = null;
  const meshOf = (slot, g) => !g ? null : slot === 'top' ? (TOPS.has(g.kind) ? g.kind : 'tee') : (g.kind === 'skirt' ? 'skirt' : 'jeans');
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
  /* ---------- free shape: grid from the list of pulls / brush dabs (stored relative to the mannequin's height) ---------- */
  // a rest-space point → which part it is on, how far along it (m) and the angle round it — the same maths as the shader
  function regionOf(id, p, s, lg) {
    const inf = A.info[id], [x, y, z] = p;
    if (TOPS.has(id) && s > .01) {
      const i = x > 0 ? 0 : 1, sl = inf.sl[i ? 'rsl' : 'lsl'];
      if (sl) {
        const d = new THREE.Vector3(...sl.dv), dn = d.clone().normalize(), c = new THREE.Vector3(...sl.c0).addScaledVector(d, s - .1);
        const q = new THREE.Vector3(x, y, z).sub(c); q.addScaledVector(dn, -q.dot(dn));
        const o = new THREE.Vector3(...sl.o), b = new THREE.Vector3().crossVectors(dn, o).multiplyScalar(i ? -1 : 1);
        return { rg: 1 + i, v: s * sl.L, a: Math.atan2(q.dot(b), q.dot(o)), dir: q.normalize(), o, b };
      }
    }
    const flat = (dx, dz) => { const l = Math.hypot(dx, dz) || 1; return new THREE.Vector3(dx / l, 0, dz / l); };
    if (id === 'jeans') {
      const l = lg != null ? lg >= 0 : x > 0, [cx, cz] = legCentre(y), dx = x - (l ? cx : -cx), dz = z - cz;
      return { rg: l ? 3 : 4, v: y, a: Math.atan2(dx, dz), dir: flat(dx, dz) };
    }
    return { rg: 0, v: y, a: Math.atan2(x, z - inf.zc), dir: flat(x, z - inf.zc) };
  }
  // every vertex's part / length / angle, once per garment (for the outline points)
  function regionTable(mesh) {
    if (mesh.userData.reg) return mesh.userData.reg;
    const g = mesh.geometry, P = g.attributes.position, S = g.attributes._s, C = g.attributes._c, L = g.attributes._lg, n = P.count;
    const t = { rg: new Int8Array(n), v: new Float32Array(n), a: new Float32Array(n) };
    for (let i = 0; i < n; i++) {
      if (C && C.getX(i) > .5) { t.rg[i] = -1; continue; }
      const r = regionOf(mesh.name, [P.getX(i), P.getY(i), P.getZ(i)], S.getX(i), L ? L.getX(i) : null);
      t.rg[i] = r.rg; t.v[i] = r.v; t.a[i] = r.a;
    }
    return (mesh.userData.reg = t);
  }
  function legCentre(y) {
    const L = A.meshes.jeans.userData.legLine, f = clamp(y / LEGH, 0, 1) * (NL - 1), i = Math.floor(f), j = Math.min(i + 1, NL - 1), t = f - i;
    return [lerp(L[i][0], L[j][0], t), lerp(L[i][1], L[j][1], t)];
  }
  function shapeOp(D, op, mirror) {
    const H = A.H;
    let rg = op.rg, a = op.a;
    if (mirror) { if (rg === 0) a = -a; else if (rg < 3) rg = 3 - rg; else { rg = 7 - rg; a = -a; } }
    const range = rg === 1 || rg === 2 ? SLR : BR, dv = range / (SHR - 1), rn = RN[rg];
    const v = op.v * H, r = Math.max(.006, op.r * H), d = (op.d || 0) * H;
    const ya = Math.max(0, Math.floor((v - 3 * r) / dv)), yb = Math.min(SHR - 1, Math.ceil((v + 3 * r) / dv));
    // a ring pull (op.o) widens the whole way round at that height; otherwise only round the spot that was pulled
    const ring = !!op.o, cols = ring ? SHW / 2 : Math.min(SHW / 2, Math.ceil(Math.min(PI, 3 * r / rn) / (TAU / SHW))), c0 = Math.round(a / TAU * SHW);
    for (let y = ya; y <= yb; y++) for (let k = -cols; k < (ring ? cols : cols + 1); k++) {
      const col = ((c0 + k) % SHW + SHW) % SHW, ang = col / SHW * TAU, dA = ring ? 0 : Math.atan2(Math.sin(ang - a), Math.cos(ang - a));
      const q = ((y * dv - v) ** 2 + (rn * dA) ** 2) / (r * r);
      if (q > 9) continue;
      const row = rg * SHR + y, i = row * SHW + col, w = Math.exp(-q);
      if (op.t === 's') {   // smoothing: towards the average of the neighbours
        const nb = [D[row * SHW + (col + 1) % SHW], D[row * SHW + (col + SHW - 1) % SHW], y > 0 ? D[i - SHW] : D[i], y < SHR - 1 ? D[i + SHW] : D[i]];
        D[i] += ((nb[0] + nb[1] + nb[2] + nb[3]) / 4 - D[i]) * w * .6;
      } else D[i] += d * w;
    }
  }
  /* outline points: per part, a width change (m) at a few heights (sleeves: lengths along them), stored as [v/H, d/H].
     Between points a smooth curve; past the last point towards the hem / cuff it carries on, towards the waist /
     armpit / shoulder it fades out (so waistbands and armholes stay as they are). The whole way round changes. */
  const SLEEVE = rg => rg === 1 || rg === 2;
  function profRows(D, rg, pts) {
    const H = A.H, P = pts.map(([v, d]) => [v * H, d * H]).sort((a, b) => a[0] - b[0]);
    if (!P.length || P.every(q => !q[1])) return;
    const range = SLEEVE(rg) ? SLR : BR, dv = range / (SHR - 1), lo = P[0], hi = P[P.length - 1];
    for (let y = 0; y < SHR; y++) {
      const v = y * dv;
      let val;
      if (SLEEVE(rg)) val = v > hi[0] ? hi[1] : v < lo[0] ? lo[1] * clamp(1 - (lo[0] - v) / .06, 0, 1) : P.length > 1 ? mono(P, v) : lo[1];
      else val = v < lo[0] ? lo[1] : v > hi[0] ? hi[1] * clamp(1 - (v - hi[0]) / .08, 0, 1) : P.length > 1 ? mono(P, v) : lo[1];
      if (!val) continue;
      const row = (rg * SHR + y) * SHW;
      for (let c = 0; c < SHW; c++) D[row + c] += val;
    }
  }
  function applyShape(U, mesh, ops, prof) {
    const md = mesh.material.userData, key = A.kind + JSON.stringify(ops) + JSON.stringify(prof || null);
    U.uShapeOn.value = ops.length || (prof && Object.keys(prof).length) ? 1 : 0;
    if (md.shapeKey === key) return;
    md.shapeKey = key;
    const t = U.uShape.value, D = t.image.data;
    D.fill(0);
    if (prof) for (const rg in prof) profRows(D, +rg, prof[rg]);
    for (const op of ops) { shapeOp(D, op, false); if (op.m) shapeOp(D, op, true); }
    t.needsUpdate = true;
  }
  function gridAt(mesh, rg, v, a) {   // the grid value (m) the shader will use at a spot
    const D = mesh.material.userData.U.uShape.value.image.data, range = SLEEVE(rg) ? SLR : BR;
    const fy = clamp(v / range, 0, 1) * (SHR - 1), fx = (((a / TAU) % 1) + 1) % 1 * SHW;
    const y0 = Math.floor(fy), y1 = Math.min(y0 + 1, SHR - 1), x0 = Math.floor(fx) % SHW, x1 = (x0 + 1) % SHW, ty = fy - y0, tx = fx - Math.floor(fx);
    const at = (x, y) => D[(rg * SHR + y) * SHW + x];
    return lerp(lerp(at(x0, y0), at(x1, y0), tx), lerp(at(x0, y1), at(x1, y1), tx), ty);
  }
  // where a part's outline points go (m), when it has none yet: from just above the hem / near the shoulder, every 7–8 cm
  function profLevels(id, rg, U) {
    const inf = A.info[id], step = SLEEVE(rg) ? .07 : TOPS.has(id) ? .07 : .08, out = [];
    let v0, v1;
    if (SLEEVE(rg)) { const sl = inf.sl[rg === 1 ? 'lsl' : 'rsl']; v0 = .12 * sl.L; v1 = (inf.smax - .03) * sl.L; }
    else if (TOPS.has(id)) { v0 = Math.max(U.uCutH.value, inf.lo) + .03; v1 = (inf.arm ? inf.arm[NC - 1][1] : inf.hi - .25) - .02; }
    else { v0 = Math.max(U.uCutH.value, inf.lo) + .03; v1 = inf.hi - .1; }
    for (let v = v0; v <= v1 + 1e-6; v += step) out.push(v);
    return out;
  }
  function frames(U, id) {
    const inf = A.info[id];
    U.uFr.value.set(inf.zc, legC(), inf.legZ, id === 'jeans' ? 1 : id === 'skirt' ? 2 : 0);
    if (id === 'jeans') A.meshes.jeans.userData.legLine.forEach((q, i) => U.uLeg.value[i].set(q[0], q[1]));
    ['lsl', 'rsl'].forEach((k, i) => {
      const sl = inf.sl[k];
      if (!sl) return;
      U.uSlC.value[i].fromArray(sl.c0); U.uSlD.value[i].fromArray(sl.dv); U.uSlO.value[i].fromArray(sl.o);
      U.uSlL.value.setComponent(i, sl.L);
    });
  }
  /* armhole (sleeveless): 5 points per side, shoulder → armpit, as (half-width, height); kept in order, inside the old seam */
  function armCtrl(T, id, side) {
    const st = T && T['arm' + side];
    if (st && st.length === NC) return st.map(([x, y]) => [x * A.H, y * A.H]);
    const d = A.info[id].arm;
    return d ? d.map(p => p.slice()) : null;
  }
  function armCurve(T, id, side) {
    const c = armCtrl(T, id, side).slice().sort((a, b) => a[1] - b[1]), y0 = c[0][1], y1 = c[NC - 1][1];
    return Array.from({ length: NA }, (_, i) => {
      const y = lerp(y0, y1, i / (NA - 1));
      let j = 0;
      while (j < NC - 2 && y > c[j + 1][1]) j++;
      return [y, lerp(c[j][0], c[j + 1][0], clamp((y - c[j][1]) / Math.max(1e-5, c[j + 1][1] - c[j][1]), 0, 1))];
    });
  }
  function fixArm(pts, i, id) {
    const H = A.H, gap = .012 * H / 1.77, seam = A.info[id].arm;
    const xmax = Math.max(...seam.map(p => p[0])) + .03, xmin = .035 * H / 1.77;
    let [x, y] = pts[i];
    const hi = i > 0 ? pts[i - 1][1] - gap : 9, lo = i < NC - 1 ? pts[i + 1][1] + gap : -9;
    pts[i] = [clamp(x, xmin, xmax), clamp(y, lo, hi)];
  }
  function applyState() {
    const st = cc.state, pr = cc.prefs, Y = cc.Y, B = cc.BODY, H = A.H, k = H / 728;
    const toH = y => (750 - y) * k;
    const M = A.meshes, T = st.top, Bt = st.bottom;
    const topMesh = meshOf('top', T), botMesh = meshOf('bottom', Bt);
    for (const id of GARMENTS) if (M[id]) M[id].visible = id === topMesh || id === botMesh;
    M.body.material.userData.U.uWear.value.set(topMesh === 'tee' ? 1 : 0, topMesh === 'long' ? 1 : 0, botMesh === 'jeans' ? 1 : 0, botMesh === 'skirt' ? 1 : 0);
    M.body.material.userData.U.uWear2.value.set(topMesh === 'shirt' ? 1 : 0, topMesh === 'hoodie' ? 1 : 0);
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
      const G = window.__gfx, slot = TOPS.has(id) ? 'top' : 'bottom';
      if (G) {
        const cs = G.canvases(slot), bx = gboxes(id), inf = A.info[id];
        GA.forEach((a, i) => {
          const C = cs[a], b = bx[a], on = C && C.on && b ? 1 : 0;
          U.uGOn.value.setComponent(i, on);
          if (b) U.uGBox.value[i].set(b[0], b[1], b[2], b[3]); else U.uGBox.value[i].set(0, 0, 0, 0);
          if (on) U['uG' + i].value = gtex(slot + ':' + a, C);
        });
        U.uGSL.value.set(inf.sl.lsl ? inf.sl.lsl.L : 0, inf.sl.rsl ? inf.sl.rsl.L : 0);
        if (inf.sl.lsl) U.uGSO.value[0].fromArray(inf.sl.lsl.o);
        if (inf.sl.rsl) U.uGSO.value[1].fromArray(inf.sl.rsl.o);
      }
      // graphics tool: the picked graphic's print area is outlined
      const sel = G && cc.tool === 'gfx' && !noGuide ? G.selected() : null;
      U.uGuide.value = sel && sel.slot === slot ? GA.indexOf(sel.it.a) : -1;
      frames(U, id);
      applyShape(U, M[id], (g.shape || []).filter(o => o.g === id), g.prof);
      U.uWaist.value = TOPS.has(id) ? 0 : A.info[id].hi;
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
      const sp = v => (v - B.st0[1]) / (wristY - B.st0[1]), v0 = (cc.DEF[T.kind] || T).sleeve, vMax = cc.LIMIT['top.sleeve'][1];
      let sb = T.sleeve <= cc.SLEEVELESS ? 0.02 : clamp(sp(T.sleeve), 0.02, 2);
      if (inf.smax0 < inf.smax - .05) {   // this top has sleeve fabric added below its own cuff (the T-shirt)
        sb = T.sleeve <= v0 ? Math.min(sb, inf.smax0) : inf.smax0 + (sp(T.sleeve) - sp(v0)) / Math.max(1e-3, sp(vMax) - sp(v0)) * (inf.smax - inf.smax0);
      }
      const adj = T.sleeveAdj || [0, 0];
      U.uSleeveCut.value.set(clamp(sb + adj[0], .02, 2), clamp(sb + adj[1], .02, 2));
      U.uRawS.value = T.rawSleeve ? 1 : 0;
      U.uTuckH.value = T.tuck && botMesh ? A.info[botMesh].hi - .025 : -1;   // tucked: ends just inside the waistband (jeans or skirt)
      U.uHandOn.value = 1;
      U.uHemLeg.value = 0;
      const nf = neckCurve(T, topMesh, 'F'), nb = neckCurve(T, topMesh, 'B');
      nf.forEach((q, i) => U.uNeckF.value[i].set(q[0], q[1])); nb.forEach((q, i) => U.uNeckB.value[i].set(q[0], q[1]));
      U.uNeckOn.value = 1;
      U.uHoodOff.value = T.hoodOff ? 1 : 0;
      U.uArmOn.value = T.sleeve <= cc.SLEEVELESS && inf.arm ? 1 : 0;
      if (U.uArmOn.value) {
        U.uSleeveCut.value.set(0, 0);   // no sleeve fabric at all: the armhole is the edge
        armCurve(T, topMesh, 'F').forEach((q, i) => U.uArmF.value[i].set(q[0], q[1]));
        armCurve(T, topMesh, 'B').forEach((q, i) => U.uArmB.value[i].set(q[0], q[1]));
      }
      // worn out (not tucked) over trousers or a skirt: the part below their waistband sits outside them
      const loose = clamp((T.fit - 5) / 21, 0, 1), over = !T.tuck ? 1 : 0;
      // lengthened: the old hem band lets go so the added length hangs on smoothly
      const ext = clamp((inf.lo0 - U.uCutH.value) / .03, 0, 1);
      // over jeans, oversized and lengthened each have a shape baked together with "over jeans":
      // use those and take "over jeans" itself out as many extra times as it was counted (it can go negative)
      const oj = botMesh === 'jeans' ? over : 0;
      // waist line: 0.35 is the garment as it comes; up pulls the waist in, down lets it hang straight
      const slim = clamp((5 - T.fit) / 7, 0, 1), cl = T.cling ?? .35;
      const waist = Math.min(1 - slim, cl >= .35 ? (cl - .35) / .65 : -.5 * (.35 - cl) / .35);
      const loose_waist = -loose * clamp((cl - .35) / .65, 0, 1);   // pulling the waist in also takes out the oversize room there
      morph(M[topMesh], oj ? { slim, waist, loose_waist, loose_jeans: loose, ext_jeans: ext, over_jeans: 1 - loose - ext }
        : { slim, waist, loose_waist, loose, ext, over_skirt: botMesh === 'skirt' ? over : 0 });
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
      U.uSleeveCut.value.set(2, 2); U.uRawS.value = 0; U.uTuckH.value = -1; U.uNeckOn.value = 0; U.uHoodOff.value = 0; U.uArmOn.value = 0;
      // a top worn out over the bottom covers its waistband: hide that strip (unless the top has holes or brush cuts there)
      const tc = topMesh && M[topMesh].material.userData.U, holes = T && ((T.strokes || []).length || (T.dmg3 || []).length || (T.hemOff || []).some(v => v));
      U.uUnder.value = T && !T.tuck && tc && !holes && tc.uCutH.value < inf.hi - .05 ? inf.hi - .045 : 99;
      U.uHandOn.value = botMesh === 'skirt' ? 1 : 0;
      U.uHemLeg.value = botMesh === 'jeans' ? legC() : 0;
      U.uHem.value.set(U.uCutH.value > inf.lo + .01 || (Bt.hemOff || []).some(v => v) ? 1 : 0, 0);
      if (botMesh === 'jeans') {
        // thigh, knee and hem each shape their own part of the leg
        const w = {};
        for (const [z, v] of [['thigh', Bt.thigh], ['knee', Bt.knee], ['hem', Bt.hemW]]) {
          w['slim_' + z] = clamp((.42 - v) / .32, 0, 1); w['wide_' + z] = clamp((v - .45) / .38, 0, 1);
        }
        morph(M.jeans, w);
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
    buildGSel();
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
  // hand centres for the cloth shaders: a bit past the wrist along the forearm
  const hW = new THREE.Vector3(), aW = new THREE.Vector3();
  function updateHands() {
    if (!A) return;
    A.root.updateMatrixWorld(true);
    const ref = A.meshes.tee || A.meshes.skirt;
    ['l', 'r'].forEach((s, i) => {
      const hand = A.root.getObjectByName('hand_' + s), arm = A.root.getObjectByName('lowerarm_' + s);
      if (!hand || !arm || !ref) { HANDS[i].w = 0; return; }
      hand.getWorldPosition(hW); arm.getWorldPosition(aW);
      hW.addScaledVector(hW.clone().sub(aW).normalize(), 0.06 * A.H / 1.77);
      hW.applyMatrix4(ref.bindMatrixInverse);
      HANDS[i].set(hW.x, hW.y, hW.z, 0.05 * A.H / 1.77);
    });
  }
  (function frame() {
    requestAnimationFrame(frame);
    if (dirty) { dirty = false; rebuild(); needs = true; }
    if (controls.update() || needs) { needs = false; updateHands(); renderer.render(scene, camera); placeHandles(); placeGSel(); }
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
    const wn = new THREE.Vector3().crossVectors(tmp.subVectors(vB, vA), new THREE.Vector3().subVectors(vC, vA)).normalize();
    const ip = (attr, comp = 0) => {
      const get = i => comp === 0 ? attr.getX(i) : comp === 1 ? attr.getY(i) : attr.getZ(i);
      return get(a) * bary.x + get(b) * bary.y + get(c) * bary.z;
    };
    const uv1 = g.attributes.uv1, N = g.attributes.normal, C = g.attributes._c;
    {   // the posed face normal, turned to point the same way as the vertex normals (out of the cloth)
      const ra = new THREE.Vector3().fromBufferAttribute(P, a), rb = new THREE.Vector3().fromBufferAttribute(P, b), rc = new THREE.Vector3().fromBufferAttribute(P, c);
      const rn = new THREE.Vector3().crossVectors(rb.sub(ra), rc.sub(ra));
      const vn = N ? new THREE.Vector3(N.getX(a) + N.getX(b) + N.getX(c), N.getY(a) + N.getY(b) + N.getY(c), N.getZ(a) + N.getZ(b) + N.getZ(c)) : rn;
      if (rn.dot(vn) < 0) wn.negate();
    }
    // brush UVs per metre at this spot, so a brush of n cm is n cm wherever you paint
    let uvPerM = 1;
    if (uv1) {
      const du = Math.hypot(uv1.getX(b) - uv1.getX(a), uv1.getY(b) - uv1.getY(a)) + Math.hypot(uv1.getX(c) - uv1.getX(a), uv1.getY(c) - uv1.getY(a));
      const dm = vB.distanceTo(vA) + vC.distanceTo(vA);
      uvPerM = dm > 1e-6 ? du / dm : 1;
    }
    return {
      mesh: o.name, slot: TOPS.has(o.name) ? 'top' : 'bottom', rest: [ip(P, 0), ip(P, 1), ip(P, 2)],
      h: g.attributes._h ? ip(g.attributes._h) : 0, s: g.attributes._s ? ip(g.attributes._s) : 0, point: h.point, uv: uv1 ? [ip(uv1, 0), ip(uv1, 1)] : null, uvPerM,
      n: N ? [ip(N, 0), ip(N, 1), ip(N, 2)] : [0, 0, 1], c: C ? ip(C) : 0, wn, lg: g.attributes._lg ? ip(g.attributes._lg) : null,
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
    const P = mesh.geometry.attributes.position, h = mesh.geometry.attributes._h, s = mesh.geometry.attributes._s, c = mesh.geometry.attributes._c;
    let best = -1, bd = 1e9;
    for (let i = 0; i < P.count; i++) { const d = test(P.getX(i), P.getY(i), P.getZ(i), h.getX(i), s.getX(i), c ? c.getX(i) : 0); if (d < bd) { bd = d; best = i; } }
    return best;
  }
  // which garment vertex an edit point sits on, worked out again whenever its value changes
  function locate(hd) {
    const st = cc.state, T = st.top, H = A.H, mesh = hd.mesh;
    if (hd.kind === 'nf' || hd.kind === 'nb') {
      const c = neckCtrl(T, meshOf('top', T), hd.side)[hd.i];
      hd.pt = c;
      hd.vi = nearestVertex(mesh, (vx, vy, vz, vh, vs, vc) => vs > .02 || vc > .5 || (hd.side === 'F' ? vz < 0 : vz > 0) ? 1e9 : (vx - c[0]) ** 2 + (vy - c[1]) ** 2);
    } else if (hd.kind === 'sh') {   // the vertex of this height's ring that sticks out furthest towards this side of the screen
      const reg = regionTable(mesh), S = hd.side;
      let ta;
      if (SLEEVE(hd.rg)) {
        const P = mesh.geometry.attributes.position, k0 = hd.cands[0];
        const r = regionOf(mesh.name, [P.getX(k0), P.getY(k0), P.getZ(k0)], mesh.geometry.attributes._s.getX(k0));
        ta = Math.atan2(S.dot(r.b), S.dot(r.o));
      } else ta = Math.atan2(S.x, S.z);
      let best = -1, bd = -2;
      for (const k of hd.cands) { const c = Math.cos(reg.a[k] - ta); if (c > bd) { bd = c; best = k; } }
      hd.vi = best;
    } else if (hd.kind === 'af' || hd.kind === 'ab') {
      const c = armCtrl(T, mesh.name, hd.side)[hd.i];
      hd.pt = c;
      hd.vi = nearestVertex(mesh, (vx, vy, vz, vh, vs, vc) => vs > .02 || vc > .5 || vx < 0 || (hd.side === 'F' ? vz < 0 : vz > 0) ? 1e9 : (vx - c[0]) ** 2 + (vy - c[1]) ** 2);
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
    shAz = null;
    const tool = cc.tool, st = cc.state, T = st.top, Bt = st.bottom;
    const add = (kind, mesh, extra) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'h3d ' + kind;
      el.setAttribute('aria-label', { nf: '앞 목선 점', nb: '뒤 목선 점', hem: '밑단 점', sl: '소매 끝 점', af: '앞 진동둘레 점', ab: '뒤 진동둘레 점', sh: '윤곽 점 — 좌우로 끌면 폭이 바뀌어요' }[kind]);
      layer.appendChild(el);
      const hd = { kind, mesh, el, ...extra };
      if (kind === 'nf' || kind === 'nb') el.classList.toggle('end', extra.i === 0 || extra.i === NC - 1);
      el.addEventListener('pointerdown', e => startDrag(e, hd));
      if (kind === 'sh') el.classList.toggle('in', extra.out < 0);
      locate(hd);
      if (hd.vi < 0) { el.remove(); return; }
      handles.push(hd);
    };
    if (tool === 'neck' && T) {
      const mesh = A.meshes[meshOf('top', T)];
      for (const side of ['F', 'B']) for (let i = 0; i < NC; i++) add(side === 'F' ? 'nf' : 'nb', mesh, { side, i, slot: 'top' });
    }
    if (tool === 'fit') {
      // outline points: on each side of every part, at its outermost edge as seen from here
      const R = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0), rx = R.x, rz = R.z, rl = Math.hypot(rx, rz) || 1;
      shAz = Math.atan2(rx, rz);
      const sideVec = out => new THREE.Vector3(out * rx / rl, 0, out * rz / rl);
      const nearX = camera.position.x - controls.target.x;
      for (const [slot, g] of [['top', T], ['bottom', Bt]]) {
        if (!g) continue;
        const mesh = A.meshes[meshOf(slot, g)], id = mesh.name, U = mesh.material.userData.U, reg = regionTable(mesh);
        const parts = id === 'jeans' ? [3, 4] : TOPS.has(id) ? [0, 1, 2] : [0];
        for (const rg of parts) {
          if (SLEEVE(rg) && (T.sleeve <= cc.SLEEVELESS || !A.info[id].sl[rg === 1 ? 'lsl' : 'rsl'])) continue;
          // which sides: the body both; a leg / sleeve its outer side — from the side, the near one both sides
          let outs = [1, -1];
          if (rg !== 0) {
            const px = rg === 1 || rg === 3 ? 1 : -1;
            if (Math.abs(rx / rl) > .35) outs = [Math.sign(rx) * px];
            else outs = Math.sign(nearX) === px ? [1, -1] : [];
          }
          const pts = (g.prof && g.prof[rg]) ? g.prof[rg].map(q => q[0] * A.H) : profLevels(id, rg, U);
          const cut = SLEEVE(rg) ? Math.min(U.uSleeveCut.value.x, U.uSleeveCut.value.y, A.info[id].smax) * A.info[id].sl[rg === 1 ? 'lsl' : 'rsl'].L : U.uCutH.value;
          pts.forEach((v, i) => {
            if (SLEEVE(rg) ? v > cut - .02 : v < cut + .015) return;   // cut away: no point
            const tol = .012, cands = [];
            for (let k = 0; k < reg.rg.length; k++) if (reg.rg[k] === rg && Math.abs(reg.v[k] - v) < tol) cands.push(k);
            if (cands.length < 3) return;
            for (const out of outs) add('sh', mesh, { slot, rg, i, v, out, cands, side: sideVec(out) });
          });
        }
      }
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
      } else if (T && A.info[meshOf('top', T)].arm) {   // sleeveless: the armhole points
        const mesh = A.meshes[meshOf('top', T)];
        for (const side of ['F', 'B']) for (let i = 0; i < NC; i++) add(side === 'F' ? 'af' : 'ab', mesh, { side, i, slot: 'top' });
      }
    }
    placeHandles();
  }
  function placeHandles() {
    if (shAz != null && !dragH && cc.tool === 'fit') {
      const R = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0), az = Math.atan2(R.x, R.z);
      if (Math.abs(Math.atan2(Math.sin(az - shAz), Math.cos(az - shAz))) > .12) { buildHandles(); return; }
    }
    if (!handles.length) { guide.innerHTML = ''; return; }
    const camDir = new THREE.Vector3().subVectors(camera.position, controls.target).setY(0).normalize();
    const P0 = new THREE.Vector3();
    for (const hd of handles) {
      hd.mesh.getVertexPosition(hd.vi, tmp);
      if (hd.pt) {   // neckline points sit exactly on their value, not just on the nearest vertex
        P0.fromBufferAttribute(hd.mesh.geometry.attributes.position, hd.vi);
        tmp.x += hd.pt[0] - P0.x; tmp.y += hd.pt[1] - P0.y;
      }
      if (hd.kind === 'sh') {
        const m = hd.mesh, P = m.geometry.attributes.position, reg = regionTable(m), k = hd.vi;
        const rest = [P.getX(k), P.getY(k), P.getZ(k)], r = regionOf(m.name, rest, m.geometry.attributes._s.getX(k), m.geometry.attributes._lg ? m.geometry.attributes._lg.getX(k) : null);
        const d = Math.max(gridAt(m, hd.rg, reg.v[k], reg.a[k]), .003 - m.geometry.attributes._cl.getX(k));
        const a0 = m.applyBoneTransform(k, new THREE.Vector3(...rest)), a1 = m.applyBoneTransform(k, new THREE.Vector3(...rest).addScaledVector(r.dir, d));
        tmp.add(a1.sub(a0));
      }
      tmp.applyMatrix4(hd.mesh.matrixWorld);
      const world = tmp.clone();
      const out = new THREE.Vector3(world.x - controls.target.x, 0, world.z - controls.target.z);
      const facing = hd.kind === 'sh' || out.length() < .02 || out.normalize().dot(camDir) > -0.15;   // outline points sit on the edge: always shown
      const [x, y] = project(world);
      hd.world = world;
      hd.el.style.transform = `translate(${x}px, ${y}px)`;
      // a side's neckline points show only while you look at that side
      const side = hd.kind === 'nf' || hd.kind === 'af' ? 1 : hd.kind === 'nb' || hd.kind === 'ab' ? -1 : 0;
      const look = !side || Math.abs(camDir.z) < .25 || Math.sign(camDir.z) === side;
      hd.el.hidden = (!facing || !look) && hd !== dragH;
      hd.el.classList.toggle('on', hd === dragH);
      hd.sx = x; hd.sy = y;
    }
    // while dragging, the line as it was before stays as a faint dashed line
    guide.innerHTML = dragH && dragH.before ? `<path d="${dragH.before}" fill="none" stroke="#fff" stroke-width="2.2" stroke-dasharray="4 4" opacity=".95"/>` : '';
  }
  const pathOf = hd => {   // the line through the points of the garment being edited, as it was
    const pts = handles.filter(h => h.kind === hd.kind && h.slot === hd.slot && !h.el.hidden && (hd.kind !== 'sh' || (h.rg === hd.rg && h.out === hd.out)))
      .sort((a, b) => hd.kind === 'hem' ? a.sx - b.sx : hd.kind === 'sh' ? a.sy - b.sy : a.i - b.i);
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
    else if (hd.kind === 'af' || hd.kind === 'ab') hd.start = armCtrl(st.top, meshOf('top', st.top), hd.side).map(p => p.slice());
    else if (hd.kind === 'sh') {   // this part's points (heights and values, m), so the drag works from where it started
      const g = st[hd.slot], vs = handles.filter(h => h.kind === 'sh' && h.slot === hd.slot && h.rg === hd.rg).map(h => h.v);
      const old = (g.prof && g.prof[hd.rg]) || [];
      const lv = old.length ? old.map(q => q[0] * A.H) : profLevels(hd.mesh.name, hd.rg, hd.mesh.material.userData.U);
      hd.start = lv.map(v => [v, ((old.find(q => Math.abs(q[0] * A.H - v) < 1e-4) || [0, 0])[1]) * A.H]);
      hd.idx = hd.start.findIndex(q => Math.abs(q[0] - hd.v) < 1e-4);
      hd.vs = vs;
    }
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
    } else if (hd.kind === 'sh') {
      // sideways only: out = wider, in = narrower, the point under the pointer; its neighbours follow part of the way
      const g = st[hd.slot], dd = dx * hd.out;   // dx is along the screen; out says which way is outwards
      const vals = hd.start.map(([v, d], j) => {
        const w = j === hd.idx ? 1 : Math.abs(j - hd.idx) === 1 ? .5 : Math.abs(j - hd.idx) === 2 ? .15 : 0;
        return [r4(v / H), r4(clamp(d + dd * w, -.08, .4) / H)];
      });
      g.prof = { ...(g.prof || {}), [hd.rg]: vals };
      if (cc.ui.shapeSym && hd.rg) g.prof[hd.rg < 3 ? 3 - hd.rg : 7 - hd.rg] = vals.map(q => q.slice());
    } else if (hd.kind === 'af' || hd.kind === 'ab') {
      // the point goes where the pointer is on the body (either side counts: the armholes mirror each other)
      const T = st.top, id = meshOf('top', T), pts = hd.start.map(p => p.slice());
      const b = hit({ clientX: e.clientX + hd.gx, clientY: e.clientY + hd.gy }, ['body']);
      pts[hd.i] = b ? [Math.abs(b.rest[0]), b.rest[1]] : [hd.start[hd.i][0] + dx * camSide, hd.start[hd.i][1] + dy];
      fixArm(pts, hd.i, id);
      const v = pts.map(([x, y]) => [r4(x / H), r4(y / H)]);
      T['arm' + hd.side] = v;
      if (sym) T['arm' + (hd.side === 'F' ? 'B' : 'F')] = v.map(p => p.slice());
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
    if (cc.tool === 'gfx') return gfxDown(e);
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
      if (cc.state.target !== h.slot) cc.setTarget(h.slot);
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
    if (tool === 'gfx' && !e.buttons && !gdrag) {
      const q = gfxAt(e);
      canvas.style.cursor = q && q.it ? 'move' : '';
    } else if (bm && !e.buttons) {
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

  /* ---------- graphics on the 3D stage: pick, move, resize and turn them right on the garment ---------- */
  // a rest-space point of a garment → its print area and where in it (cm): the inverse of the shader's projection
  function areaOf(id, x, y, z, nx, ny, nz, s, c) {
    if (c > .5) return null;
    const inf = A.info[id], B = gboxes(id);
    let a, u, v;
    if (s < .01) {
      if (z > 0 && nz > .3) { a = 'front'; u = x; v = y; }
      else if (z < 0 && nz < -.3) { a = 'back'; u = -x; v = y; }
      else return null;
    } else {
      const sl = inf.sl[x > 0 ? 'lsl' : 'rsl'];
      if (!sl || nx * sl.o[0] + ny * sl.o[1] + nz * sl.o[2] <= .15) return null;
      a = x > 0 ? 'lsl' : 'rsl'; u = x > 0 ? -z : z; v = -s * sl.L;
    }
    const b = B[a];
    return b ? { a, x: (u - b[0]) * 100, y: (b[1] - v) * 100 } : null;
  }
  const areaOfHit = h => areaOf(h.mesh, ...h.rest, ...h.n, h.s, h.c);
  // every vertex's print-area spot, once per garment: finds the cloth under a graphic's corners
  function areaTable(mesh) {
    if (mesh.userData.at) return mesh.userData.at;
    const g = mesh.geometry, P = g.attributes.position, N = g.attributes.normal, S = g.attributes._s, C = g.attributes._c, t = {};
    GA.forEach(a => { t[a] = { i: [], x: [], y: [] }; });
    for (let i = 0; i < P.count; i++) {
      const r = areaOf(mesh.name, P.getX(i), P.getY(i), P.getZ(i), N.getX(i), N.getY(i), N.getZ(i), S.getX(i), C ? C.getX(i) : 0);
      if (r) { const q = t[r.a]; q.i.push(i); q.x.push(r.x); q.y.push(r.y); }
    }
    return (mesh.userData.at = t);
  }
  function nearestIn(mesh, a, x, y) {
    const t = areaTable(mesh)[a];
    let best = -1, bd = 1e9;
    for (let k = 0; k < t.i.length; k++) { const d = (t.x[k] - x) ** 2 + (t.y[k] - y) ** 2; if (d < bd) { bd = d; best = k; } }
    return best < 0 ? null : { vi: t.i[best], x: t.x[best], y: t.y[best], d: Math.sqrt(bd) };
  }
  // what is under the pointer: the garment, its print area spot, and the graphic there (if any)
  function gfxAt(e) {
    const G = window.__gfx, h = G && hit(e);
    if (!h) return null;
    const q = areaOfHit(h);
    return { h, q, it: q ? G.hitTest(h.slot, q.a, q.x, q.y) : null };
  }

  function buildGSel() {
    const G = window.__gfx, s = G && cc.tool === 'gfx' ? G.selected() : null;
    GS = null;
    if (s && !s.it.hid) {
      const mesh = A.meshes[meshOf(s.slot, cc.state[s.slot])], it = s.it;
      const c = mesh && mesh.visible ? nearestIn(mesh, it.a, it.x, it.y) : null;
      if (c) {
        // two spots 3 cm away (towards the middle of the area) tell how a centimetre of cloth looks on screen
        const AR = G.AREAS[s.slot][it.a];
        const bx = nearestIn(mesh, it.a, c.x + (c.x > 0 ? -3 : 3), c.y), by = nearestIn(mesh, it.a, c.x, c.y + (c.y > AR.h / 2 ? -3 : 3));
        if (bx && by) GS = { it, slot: s.slot, mesh, c, bx, by };
      }
    }
    placeGSel();
  }
  function placeGSel() {
    const show = !!GS;
    gbox.style.display = show ? '' : 'none';
    gH.forEach(el => { el.hidden = !show; });
    if (!show) return;
    const sp = vi => { GS.mesh.getVertexPosition(vi, tmp); tmp.applyMatrix4(GS.mesh.matrixWorld); return project(tmp); };
    const p0 = sp(GS.c.vi), p1 = sp(GS.bx.vi), p2 = sp(GS.by.vi);
    const d1 = [GS.bx.x - GS.c.x, GS.bx.y - GS.c.y], d2 = [GS.by.x - GS.c.x, GS.by.y - GS.c.y], det = d1[0] * d2[1] - d2[0] * d1[1];
    if (Math.abs(det) < 1e-3) { gbox.style.display = 'none'; gH.forEach(el => { el.hidden = true; }); return; }
    const i00 = d2[1] / det, i01 = -d2[0] / det, i10 = -d1[1] / det, i11 = d1[0] / det;
    const s1 = [p1[0] - p0[0], p1[1] - p0[1]], s2 = [p2[0] - p0[0], p2[1] - p0[1]];
    const J = [s1[0] * i00 + s2[0] * i10, s1[0] * i01 + s2[0] * i11, s1[1] * i00 + s2[1] * i10, s1[1] * i01 + s2[1] * i11];
    // seen from the other side the cloth's axes come out mirrored: the graphic isn't facing you
    const jdet = J[0] * J[3] - J[1] * J[2];
    const it = GS.it, w = it.w, h = window.__gfx.hOf(it), r = (it.r || 0) * PI / 180, cs = Math.cos(r), sn = Math.sin(r);
    const scr = (ax, ay) => [p0[0] + J[0] * (ax - GS.c.x) + J[1] * (ay - GS.c.y), p0[1] + J[2] * (ax - GS.c.x) + J[3] * (ay - GS.c.y)];
    const at = (lx, ly) => scr(it.x + lx * cs - ly * sn, it.y + lx * sn + ly * cs);
    const P4 = [at(-w / 2, -h / 2), at(w / 2, -h / 2), at(w / 2, h / 2), at(-w / 2, h / 2)], ctr = at(0, 0), topM = at(0, -h / 2);
    const vis = jdet > 0 || !!gdrag;
    gbox.style.display = vis ? '' : 'none';
    gShape.setAttribute('points', P4.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' '));
    const ux = topM[0] - ctr[0], uy = topM[1] - ctr[1], ul = Math.hypot(ux, uy) || 1, rot = [topM[0] + ux / ul * 28, topM[1] + uy / ul * 28];
    gStem.setAttribute('x1', topM[0]); gStem.setAttribute('y1', topM[1]); gStem.setAttribute('x2', rot[0]); gStem.setAttribute('y2', rot[1]);
    [...P4, rot].forEach((p, i) => { gH[i].hidden = !vis; gH[i].style.transform = `translate(${p[0]}px, ${p[1]}px)`; });
    Object.assign(GS, { J, ctr });
  }
  const local = e => { const r = wrap.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  function gStart(e, kind) {
    if (!GS) return;
    e.preventDefault(); e.stopPropagation();
    gPts.set(e.pointerId, local(e));
    if (gdrag && gPts.size === 2) {   // a second finger: pinch
      const [a, b] = [...gPts.values()];
      gdrag = { kind: 'pinch', it: GS.it, d0: Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, a0: Math.atan2(b[1] - a[1], b[0] - a[0]), w0: GS.it.w, r0: GS.it.r || 0 };
      return;
    }
    if (gdrag) return;
    const it = GS.it, h = kind === 'move' ? hit(e, [GS.mesh.name]) : null, q = h && areaOfHit(h);
    gdrag = { kind, it, p0: local(e), sx: it.x, sy: it.y, w0: it.w, r0: it.r || 0, J: GS.J.slice(), ctr: GS.ctr.slice(), mesh: GS.mesh.name, q0: q && q.a === it.a ? q : null };
    controls.enabled = false;
    window.addEventListener('pointermove', gMove);
    window.addEventListener('pointerup', gEnd);
    window.addEventListener('pointercancel', gEnd);
  }
  function gMove(e) {
    const d = gdrag;
    if (!d || !gPts.has(e.pointerId)) return;
    const p = local(e), G = window.__gfx, it = d.it, slot = GS ? GS.slot : cc.state.target, AR = G.AREAS[slot][it.a];
    gPts.set(e.pointerId, p);
    if (d.kind === 'idle') return;
    if (d.kind === 'pinch') {
      if (gPts.size < 2) return;
      const [a, b] = [...gPts.values()];
      it.w = Math.round(clamp(d.w0 * Math.hypot(b[0] - a[0], b[1] - a[1]) / d.d0, 1, AR.w * 1.4) * 10) / 10;
      it.r = snapAngle(d.r0 + (Math.atan2(b[1] - a[1], b[0] - a[0]) - d.a0) * 180 / PI, false);
    } else if (d.kind === 'move') {
      let nx, ny;
      const h = hit(e, [d.mesh]), q = h && areaOfHit(h);
      if (q && d.q0 && q.a === it.a) { nx = d.sx + q.x - d.q0.x; ny = d.sy + q.y - d.q0.y; }
      else {   // off the cloth: by how far the pointer moved, through the screen-per-cm map from the start
        const [j0, j1, j2, j3] = d.J, det = j0 * j3 - j1 * j2 || 1, dx = p[0] - d.p0[0], dy = p[1] - d.p0[1];
        nx = d.sx + (j3 * dx - j1 * dy) / det; ny = d.sy + (-j2 * dx + j0 * dy) / det;
      }
      if (Math.abs(nx) < .8) nx = 0;   // snaps onto the centre line
      it.x = Math.round(clamp(nx, -AR.w / 2, AR.w / 2) * 10) / 10;
      it.y = Math.round(clamp(ny, 0, AR.h) * 10) / 10;
    } else if (d.kind === 'scale') {
      const k = Math.hypot(p[0] - d.ctr[0], p[1] - d.ctr[1]) / (Math.hypot(d.p0[0] - d.ctr[0], d.p0[1] - d.ctr[1]) || 1);
      it.w = Math.round(clamp(d.w0 * k, 1, AR.w * 1.4) * 10) / 10;
    } else {
      const a = Math.atan2(p[1] - d.ctr[1], p[0] - d.ctr[0]) - Math.atan2(d.p0[1] - d.ctr[1], d.p0[0] - d.ctr[0]);
      it.r = snapAngle(d.r0 + a * 180 / PI, e.shiftKey);
    }
    cc.render(); G.sync();
  }
  function snapAngle(deg, step15) {
    let v = ((deg + 180) % 360 + 360) % 360 - 180;
    if (step15) return Math.round(v / 15) * 15;
    const n = Math.round(v / 90) * 90;
    if (Math.abs(v - n) < 4) v = n;   // straight up / sideways / upside down are easy to hit
    return Math.round(v);
  }
  function gEnd(e) {
    gPts.delete(e.pointerId);
    if (gPts.size) { if (gdrag && gdrag.kind === 'pinch') gdrag = { ...gdrag, kind: 'idle' }; return; }
    window.removeEventListener('pointermove', gMove);
    window.removeEventListener('pointerup', gEnd);
    window.removeEventListener('pointercancel', gEnd);
    gdrag = null; controls.enabled = true;
    cc.commit(); cc.renderPanel();
  }
  // pressing the garment with the graphics tool: a graphic there is picked and can be dragged at once;
  // anywhere else lets go of the selection and turns the view as usual
  function gfxDown(e) {
    const G = window.__gfx;
    if (!G) return;
    if (gdrag && e.pointerType === 'touch' && GS) { gStart(e, 'pinch'); e.stopImmediatePropagation(); return; }
    const f = gfxAt(e);
    if (!f || !f.it) {
      if (f && cc.state.target !== f.h.slot) cc.setTarget(f.h.slot);
      if (G.selected()) G.select(null);
      return;
    }
    e.stopImmediatePropagation();
    e.preventDefault();
    if (cc.ui.gsel !== f.it.id) { G.select(f.it.id); applyState(); }
    if (GS) gStart(e, 'move');
  }

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
      hoverCut = null; noGuide = true;
      if (A) applyState();
      noGuide = false;
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
  S3._debug = { camera, controls, scene, renderer, get asset() { return A; }, get handles() { return handles; } };
  cc.attach3D(S3);
}
