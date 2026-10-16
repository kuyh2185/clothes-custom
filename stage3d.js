/* 고쳐 입기 — 3D stage.
   The mannequin and every garment are generated from the same body tables and garment parameters as the 2D
   editor (app.js exposes them on window.__cc): each body part and garment is a tube of cross-sections
   (super-ellipses whose width comes from the front-view tables and depth from BODY.depth), posed with the
   same 2D skinning rig (poses are in the frontal plane, so z is kept), then garments are pushed out of the arms
   where they collide. Patterns, damage and prints are painted into per-part canvas textures in UV space, so
   stripes wrap round the body and rips become real holes (alpha). */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const cc = window.__cc;
const SC = 0.01, PI = Math.PI, TAU = PI * 2, HALF = PI / 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const sgnPow = (v, e) => Math.sign(v) * Math.abs(v) ** e;
const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const table = (t, y) => cc.table(t, y);
// cache a function of height (quantised to 1/4 unit) — garments ask for the same heights thousands of times
const memo = (fn, res = .25) => { const m = new Map(); return y => { const k = Math.round(y / res); let v = m.get(k); if (v === undefined) { v = fn(k * res); m.set(k, v); } return v; }; };
// smooth (cubic Hermite) interpolation through [x, value] rows
function ctable(t, x) {
  const n = t.length;
  if (x <= t[0][0]) return t[0][1];
  if (x >= t[n - 1][0]) return t[n - 1][1];
  let i = 1;
  while (t[i][0] < x) i++;
  const p0 = t[Math.max(0, i - 2)], p1 = t[i - 1], p2 = t[i], p3 = t[Math.min(n - 1, i + 1)], h = p2[0] - p1[0];
  const m1 = (p2[1] - p0[1]) / (p2[0] - p0[0]) * h, m2 = (p3[1] - p1[1]) / (p3[0] - p1[0]) * h;
  const s = (x - p1[0]) / h, s2 = s * s, s3 = s2 * s;
  return (2 * s3 - 3 * s2 + 1) * p1[1] + (s3 - 2 * s2 + s) * m1 + (-2 * s3 + 3 * s2) * p2[1] + (s3 - s2) * m2;
}

let renderer = null;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
} catch (e) { console.warn('고쳐 입기: WebGL 없음, 2D로 그려요', e); }
if (cc && renderer) start();

function start() {
  const wrap = document.querySelector('.stage-wrap');
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.02;
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
  scene.environmentIntensity = 0.5;
  const camera = new THREE.PerspectiveCamera(24, 1, 0.1, 200);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 3.62, 0);
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.09;
  controls.rotateSpeed = 0.75;
  controls.minDistance = 7;
  controls.maxDistance = 30;
  controls.minPolarAngle = PI * 0.3;
  controls.maxPolarAngle = PI * 0.56;
  camera.position.set(0, 4.3, 20);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x8d847a, 0.55));
  const key = new THREE.DirectionalLight(0xfff5ea, 2.5);
  key.position.set(-5, 11, 8);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -3.5, right: 3.5, top: 8.6, bottom: -0.6, near: 1, far: 30 });
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.025;
  key.shadow.radius = 5;
  key.target.position.set(0, 3.6, 0);
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight(0xeef1ff, 0.65);
  fill.position.set(6, 5, 7);
  const rim = new THREE.DirectionalLight(0xffffff, 1.1);
  rim.position.set(2.5, 8, -9);
  scene.add(fill, rim);

  // seamless paper cyclorama: floor sweeping up into the wall
  const BACK = { studio: '#e3e0da', grey: '#a8a59f', dark: '#363533' };
  const cycMat = new THREE.MeshStandardMaterial({ color: BACK.studio, roughness: 1 });
  {
    const prof = [];
    for (let i = 0; i <= 20; i++) prof.push([30 - i * 34 / 20, 0]);
    for (let i = 1; i <= 24; i++) { const a = i / 24 * HALF; prof.push([-4 - 6 * Math.sin(a), 6 - 6 * Math.cos(a)]); }
    for (let i = 1; i <= 8; i++) prof.push([-10, 6 + i * 4]);
    const W = 90, pos = [], idx = [];
    prof.forEach(([z, y]) => { pos.push(-W / 2, y - 0.07, z, W / 2, y - 0.07, z); });
    for (let i = 0; i < prof.length - 1; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const cyc = new THREE.Mesh(g, cycMat);
    cyc.receiveShadow = true;
    scene.add(cyc);
  }
  // smoked-glass base plate
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.64, 0.07, 72),
    new THREE.MeshPhysicalMaterial({ color: '#1f1f1f', roughness: 0.22, clearcoat: 0.9, clearcoatRoughness: 0.15 }));
  plate.position.y = -0.035;
  plate.receiveShadow = true;
  scene.add(plate);

  /* ---------- mesh helpers ---------- */
  // rows × cols tube; fn(i, j) → { p: [x, y, z] rest (2D units), v }; posed with the rig, then post(x, y, z)
  function tube(rows, cols, fn, { ctx = 'body', mirror = false, post = null } = {}) {
    const W = cols + 1, n = rows * W;
    const pos = new Float32Array(n * 3), uv = new Float32Array(n * 2), ry = new Float32Array(n);
    for (let i = 0; i < rows; i++) for (let j = 0; j <= cols; j++) {
      const r = fn(i, j % cols);
      let x = r.p[0], z = r.p[2];
      if (mirror) x = 400 - x;
      const q = cc.warp([x, r.p[1]], ctx);
      let P = [q[0], q[1], z];
      if (post) P = post(P[0], P[1], P[2]);
      const k = i * W + j;
      pos[k * 3] = (P[0] - 200) * SC; pos[k * 3 + 1] = (750 - P[1]) * SC; pos[k * 3 + 2] = P[2] * SC;
      uv[k * 2] = j / cols; uv[k * 2 + 1] = r.v ?? i / (rows - 1);
      ry[k] = r.p[1];
    }
    const idx = [];
    for (let i = 0; i < rows - 1; i++) for (let j = 0; j < cols; j++) {
      const a = i * W + j, b = a + 1, c = a + W, d = c + 1;
      if (mirror) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('ry', new THREE.BufferAttribute(ry, 1));
    g.setIndex(idx);
    g.computeVertexNormals();
    // the seam column is duplicated for the UVs: give both copies the same normal
    const nr = g.attributes.normal;
    for (let i = 0; i < rows; i++) {
      const a = i * W, b = a + cols, v = new THREE.Vector3(nr.getX(a) + nr.getX(b), nr.getY(a) + nr.getY(b), nr.getZ(a) + nr.getZ(b)).normalize();
      nr.setXYZ(a, v.x, v.y, v.z); nr.setXYZ(b, v.x, v.y, v.z);
    }
    return g;
  }
  const disposeMesh = m => { if (m) { m.geometry.dispose(); m.parent && m.parent.remove(m); } };

  /* ---------- body kit: everything the mannequin and the garments need from the body tables ---------- */
  function makeKit() {
    const B = cc.BODY, Y = cc.Y;
    const shInv = B.shoulder.map(([nx, y]) => [y, -nx]).sort((a, b) => a[0] - b[0]);
    const torsoHalf = memo(y => y <= shInv[0][0] ? B.neckHalf : y < B.st0[1] ? Math.max(B.neckHalf, 200 - table(shInv, y)) : cc.bodyHalf(y));
    const DF = B.depth.map(r => [r[0], r[1]]), DB = B.depth.map(r => [r[0], r[2]]);
    const depth = memo(y => [ctable(DF, y), ctable(DB, y)]);
    const lobes = (phi, at, sep, sig) => Math.exp(-((angDiff(phi, at - sep) / sig) ** 2)) + Math.exp(-((angDiff(phi, at + sep) / sig) ** 2));
    const bust = (y, phi) => Math.abs(y - Y.bust) > 60 ? 0 : B.bustBump * Math.exp(-(((y - Y.bust) / 17) ** 2)) * lobes(phi, HALF, .55, .38);
    const seat = (y, phi) => Math.abs(y - Y.hip - 4) > 80 ? 0 : B.seat * Math.exp(-(((y - Y.hip - 4) / 24) ** 2)) * lobes(phi, -HALF, .5, .42);
    const N = 2.25;
    const torsoPt = (y, phi, out = 0) => {
      const c = Math.cos(phi), s = Math.sin(phi);
      let hw = torsoHalf(y), [df, db] = depth(y);
      if (y > Y.crotch) { const k = Math.sqrt(Math.max(0, 1 - ((y - Y.crotch) / 8) ** 2)); hw *= k; df *= k; db *= k; }
      const zf = df + bust(y, phi), zb = db + seat(y, phi);
      return [200 + (hw + out) * sgnPow(c, 2 / N), y, ((s >= 0 ? zf : zb) + out) * sgnPow(s, 2 / N)];
    };
    // arms (left side): round deltoid dome, then the front-view outline, with depth for a real cylinder
    const AO = y => table(B.armO, y), AI = y => table(B.armI, y);
    const apY = Y.armpit, el = B.elbow, wr = B.armO[B.armO.length - 1][0], y0 = B.st0[1];
    const rUp = (AI(apY + 4) - AO(apY + 4)) / 2, capC = y0 + rUp;
    const armRx = y => y >= apY + 4 ? (AI(y) - AO(y)) / 2 : y >= capC ? rUp : Math.sqrt(Math.max(0, rUp * rUp - (capC - y) ** 2));
    const armCx = y => y >= apY + 4 ? (AO(y) + AI(y)) / 2 : AO(Math.max(y, y0)) + rUp;
    const KZ = [[y0, 1.1], [apY, 1.08], [el - 22, 1.03], [el, .96], [el + 22, 1.02], [wr - 34, 1.12], [wr, 1.32]];
    const CZ = [[y0, -1.5], [apY, -1], [el, 0], [wr, 2.5]];
    const armRz = y => armRx(y) * ctable(KZ, y), armCz = y => ctable(CZ, y);
    // relaxed hand: palm to the thigh, fingers curled, in hand units (wrist width 16, length 59)
    const wo = AO(wr), hwU = (AI(wr) - wo) / 16, hs = B.hand;
    const HO = [[0, 0], [12, -2.2], [26, -3.4], [40, -2.6], [50, 0], [57, 4.4], [59, 9.6]];
    const HI = [[0, 16], [9, 19], [20, 20.6], [29, 19.6], [37, 17.8], [47, 16.6], [55.5, 14], [59, 9.6]];
    const HZ = [[0, 10.5], [10, 13], [24, 15.5], [38, 15], [48, 13], [54, 9.5], [57.5, 5.5], [59, 0]];
    const hand = t => {
      const o = ctable(HO, t), i = ctable(HI, t);
      return { cx: wo + hwU * (o + i) / 2, rx: Math.max(0, hwU * (i - o) / 2), y: wr + t * hs, rz: hwU * ctable(HZ, t), cz: armCz(wr) + hwU * t * .05 };
    };
    // legs (left side)
    const LO = y => table(B.legO, Math.max(y, Y.crotch)), LI = y => table(B.legI, Math.max(y, Y.crotch));
    const legRx = memo(y => (LI(y) - LO(y)) / 2), legCx = memo(y => cc.legMid(Math.max(y, Y.crotch)));
    const LZ = [[Y.crotch, 1.0, 1.1, 0], [Y.knee - 40, 1.0, 1.02, 0], [Y.knee, .94, .92, 0], [Y.knee + 45, .86, 1.26, -2], [Y.knee + 95, .86, 1.2, -2], [Y.ankle - 30, .92, 1.02, -1], [Y.ankle, 1.0, 1.05, 0]];
    const LZF = LZ.map(r => [r[0], r[1]]), LZB = LZ.map(r => [r[0], r[2]]), LZC = LZ.map(r => [r[0], r[3]]);
    const legPt = (y, phi, out = 0) => {
      const c = Math.cos(phi), s = Math.sin(phi), rx = legRx(y);
      return [legCx(y) + (rx + out) * c, y, ctable(LZC, y) + (rx * (s >= 0 ? ctable(LZF, y) : ctable(LZB, y)) + out) * s];
    };
    const legFront = memo(y => ctable(LZC, y) + legRx(y) * ctable(LZF, y)), legBack = memo(y => legRx(y) * ctable(LZB, y) - ctable(LZC, y));
    return { B, Y, torsoHalf, depth, bust, seat, torsoPt, armRx, armCx, armRz, armCz, hand, hwU, hs, wr, apY, el, y0, legRx, legCx, legPt, legFront, legBack, AO, AI };
  }

  /* ---------- mannequin ---------- */
  const FIN = {
    white: { color: '#ebe7e1', roughness: .55, clearcoat: .12, clearcoatRoughness: .5 },
    stone: { color: '#b6ad9f', roughness: .72, clearcoat: 0, clearcoatRoughness: .5 },
    black: { color: '#1c1c1d', roughness: .4, clearcoat: .35, clearcoatRoughness: .45 },
  };
  const manMat = new THREE.MeshPhysicalMaterial();
  const man = new THREE.Group();
  scene.add(man);
  let manKey = '', K = null;
  function buildMannequin() {
    man.children.slice().forEach(disposeMesh);
    const { Y, B } = K, add = (g) => { const m = new THREE.Mesh(g, manMat); m.castShadow = m.receiveShadow = true; man.add(m); };
    const C = 72;
    const phiAt = j => -HALF + TAU * j / C;
    // torso, neck to a rounded bottom between the legs
    const yT0 = 100, yT1 = Y.crotch + 8, RT = 170;
    add(tube(RT, C, (i, j) => ({ p: K.torsoPt(lerp(yT0, yT1, i / (RT - 1)), phiAt(j)) })));
    // head: an egg, a little deeper than wide, chin forward
    const HP = B.head.map(([x, y]) => [y, 200 - x]), hy0 = HP[0][0], hy1 = HP[HP.length - 1][0], RH = 48;
    add(tube(RH, C, (i, j) => {
      const y = lerp(hy0, hy1, i / (RH - 1)), r = Math.max(0, ctable(HP, y)), phi = phiAt(j), s = Math.sin(phi);
      return { p: [200 + r * Math.cos(phi), y, (y > 70 ? (y - 70) * .12 : 0) + r * (s >= 0 ? 1.1 : 1.2) * s] };
    }));
    // arms + hands + thumbs, both sides
    const RA = 110, RHd = 46;
    for (const mirror of [false, true]) {
      const o = { ctx: 'arm', mirror };
      add(tube(RA, 40, (i, j) => {
        const y = lerp(K.y0, K.wr + 1, i / (RA - 1)), phi = TAU * j / 40;
        return { p: [K.armCx(y) + K.armRx(y) * Math.cos(phi), y, K.armCz(y) + K.armRz(y) * Math.sin(phi)] };
      }, o));
      add(tube(RHd, 40, (i, j) => {
        const h = K.hand(lerp(-1, 59, i / (RHd - 1))), phi = TAU * j / 40;
        return { p: [h.cx + h.rx * Math.cos(phi), h.y, h.cz + h.rz * Math.sin(phi)] };
      }, o));
      const TH = [[17, 6, 9, 4.6], [16.6, 18, 13.2, 4.3], [14.6, 30, 13.6, 3.7], [12.6, 37.5, 10.6, 2.6], [12, 40, 9.2, 0]];
      const thumb = t => { const k = t * (TH.length - 1), a = Math.min(TH.length - 2, Math.floor(k)), f = k - a; return TH[a].map((v, n) => lerp(v, TH[a + 1][n], f)); };
      add(tube(20, 20, (i, j) => {
        const [x, y, z, r] = thumb(i / 19), phi = TAU * j / 20;
        return { p: [K.hand(0).cx - 8 * K.hwU + x * K.hwU + r * K.hwU * Math.cos(phi), K.wr + y * K.hs, K.armCz(K.wr) + z * K.hwU + r * K.hwU * .85 * Math.sin(phi)] };
      }, o));
      // leg from inside the hip down into the foot
      add(tube(120, 48, (i, j) => ({ p: K.legPt(lerp(Y.crotch - 36, Y.ankle + 8, i / 119), TAU * j / 48) }), { mirror }));
      // foot: heel to toe, flat sole on the plate
      const fl = B.foot || 1, ax = cc.legMid(Y.ankle);
      const FW = [[0, 0], [.05, 6.5], [.14, 10], [.45, 11.5], [.75, 14], [.9, 12.5], [.97, 8], [1, 0]];
      const FT = [[0, 738], [.08, 728], [.2, 722], [.45, 730], [.75, 740], [1, 745]];
      add(tube(44, 36, (i, j) => {
        const t = i / 43, w = ctable(FW, t) * fl, top = ctable(FT, t), hh = (750 - top) / 2 * ctable([[0, .55], [.08, .95], [.9, 1], [1, .6]], t);
        const phi = TAU * j / 36, cx = ax - t * 5, cy = 750 - hh;
        return { p: [cx + w * sgnPow(Math.cos(phi), .8), cy - hh * sgnPow(Math.sin(phi), .8), lerp(-14, 74, t) * fl] };
      }, { mirror }));
    }
  }

  /* ---------- fabric ---------- */
  function normalTex(h, size, strength) {
    const H = new Float32Array(size * size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) H[y * size + x] = h(x / size, y / size);
    const cv = document.createElement('canvas'); cv.width = cv.height = size;
    const ctx = cv.getContext('2d'), img = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const dx = H[y * size + (x + 1) % size] - H[y * size + (x - 1 + size) % size];
      const dy = H[((y + 1) % size) * size + x] - H[((y - 1 + size) % size) * size + x];
      const v = new THREE.Vector3(-dx * strength, -dy * strength, 1).normalize(), k = (y * size + x) * 4;
      img.data[k] = (v.x * .5 + .5) * 255; img.data[k + 1] = (v.y * .5 + .5) * 255; img.data[k + 2] = (v.z * .5 + .5) * 255; img.data[k + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }
  const JERSEY = normalTex((u, v) => Math.abs(Math.sin(PI * u * 40)) * .6 + .4 * Math.sin(TAU * (v * 36 + Math.abs((u * 40) % 1 - .5))), 256, 2.2);
  const TWILL = normalTex((u, v) => Math.sin(TAU * (u + v) * 36) * .6 + Math.sin(TAU * u * 128) * .08, 256, 2.6);

  // one material + painted texture per garment part
  const PARTS = {};
  function part(id, denim) {
    if (PARTS[id]) return PARTS[id];
    const cv = document.createElement('canvas'), ca = document.createElement('canvas');
    cv.width = ca.width = 1024; cv.height = ca.height = 1024;
    const map = new THREE.CanvasTexture(cv), amap = new THREE.CanvasTexture(ca);
    map.colorSpace = THREE.SRGBColorSpace; map.flipY = amap.flipY = false; map.anisotropy = 8;
    const nrm = (denim ? TWILL : JERSEY).clone();
    const mat = new THREE.MeshPhysicalMaterial({
      map, alphaMap: amap, alphaTest: .5, side: THREE.DoubleSide, normalMap: nrm, normalScale: new THREE.Vector2(denim ? .3 : .18, denim ? .3 : .18),
      roughness: denim ? .86 : .92, sheen: denim ? .25 : .7, sheenRoughness: .75, sheenColor: new THREE.Color('#ffffff'),
    });
    return (PARTS[id] = { id, cv, ca, map, amap, nrm, mat, key: '', mesh: null, dims: null, ring: null, slot: null });
  }
  const IMG = {};
  function image(id) {
    if (!cc.images[id]) return null;
    if (!IMG[id]) { const im = new Image(); im.onload = () => S3.update(); im.src = cc.images[id]; IMG[id] = im; }
    return IMG[id].complete && IMG[id].naturalWidth ? IMG[id] : null;
  }
  function rng(seed) { let a = seed >>> 0; return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  /* paint a part: fill + pattern (aligned to absolute body height so body and sleeves match), garment details,
     washes / rips (rips are cut in the alpha map), print, raw-edge fraying at the bottom */
  function paint(P, g, d0, details) {
    const dims = { C: Math.round(d0.C / 12) * 12, H: Math.round(d0.H / 6) * 6, y0: Math.round(d0.y0) };
    const f = g.fill, dmg = (g.dmg3 || []).filter(d => d.part === P.id), pr = g.print && g.print3 && g.print3.part === P.id ? g.print : null;
    const key = JSON.stringify([f, dims, dmg, pr && [pr.img, pr.w, g.print3], details.key, P.raw]);
    if (key === P.key) return;
    P.key = key;
    const x = P.cv.getContext('2d'), a = P.ca.getContext('2d'), W = P.cv.width, H = P.cv.height;
    const pu = W / dims.C, pv = H / dims.H, Y0 = dims.y0;
    const X = u => u * pu, V = y => (y - Y0) * pv;   // physical units → px
    x.globalAlpha = 1;
    x.fillStyle = f.c1; x.fillRect(0, 0, W, H);
    const s = f.scale || 1;
    if (f.type === 'stripe') {
      x.fillStyle = f.c2;
      for (let y = Math.floor(Y0 / (20 * s)) * 20 * s; y < Y0 + dims.H; y += 20 * s) x.fillRect(0, V(y), W, 8 * s * pv);
    } else if (f.type === 'check') {
      x.globalAlpha = .55; x.fillStyle = f.c2;
      for (let y = Math.floor(Y0 / (24 * s)) * 24 * s; y < Y0 + dims.H; y += 24 * s) x.fillRect(0, V(y), W, 10 * s * pv);
      for (let u = 0; u < dims.C; u += 24 * s) x.fillRect(X(u), 0, 10 * s * pu, H);
      x.globalAlpha = 1;
    } else if (f.type === 'dot') {
      x.fillStyle = f.c2;
      for (let y = Math.floor(Y0 / (22 * s)) * 22 * s; y < Y0 + dims.H + 22 * s; y += 11 * s) {
        const odd = Math.round(y / (11 * s)) % 2;
        for (let u = odd ? 11 * s : 0; u < dims.C + 22 * s; u += 22 * s) { x.beginPath(); x.ellipse(X(u), V(y), 3 * s * pu, 3 * s * pv, 0, 0, TAU); x.fill(); }
      }
    }
    details.draw && details.draw(x, X, V, pu, pv);
    a.fillStyle = '#fff'; a.fillRect(0, 0, W, H);
    // washes, frays, rips
    dmg.forEach(d => {
      const r = rng(Math.round(d.u * 9173 + d.v * 7919)), cx = d.u * W, cy = d.v * H;
      [cx - W, cx, cx + W].forEach(px => {
        const g2 = x.createRadialGradient(px, cy, 0, px, cy, (16 + d.lv * 4) * pu);
        g2.addColorStop(0, `rgba(255,255,255,${.28 + .1 * d.lv})`); g2.addColorStop(1, 'rgba(255,255,255,0)');
        x.save(); x.translate(px, cy); x.scale(1, (20 + d.lv * 4) * pv / ((16 + d.lv * 4) * pu)); x.translate(-px, -cy);
        x.fillStyle = g2; x.beginPath(); x.arc(px, cy, (16 + d.lv * 4) * pu, 0, TAU); x.fill(); x.restore();
        if (d.lv >= 2) {
          x.strokeStyle = 'rgba(255,255,255,.75)'; x.lineWidth = 1.1 * pv;
          for (let i = 0; i < 6; i++) {
            const w = (6 + r() * 12) * pu, yy = cy + (-13 + i * 5 + r() * 3) * pv, xx = px - w / 2 + (r() - .5) * 8 * pu;
            x.beginPath(); x.moveTo(xx, yy); x.quadraticCurveTo(xx + w / 2, yy + (r() - .5) * 2.4 * pv, xx + w, yy); x.stroke();
          }
        }
        if (d.lv >= 3) {
          a.fillStyle = '#000'; a.beginPath(); a.ellipse(px, cy, 12 * pu, 6.5 * pv, 0, 0, TAU); a.fill();
          // white weft threads stay across the hole
          a.strokeStyle = '#fff'; x.strokeStyle = '#f3f1ea'; a.lineWidth = x.lineWidth = 1.3 * pv;
          for (let k = -4; k <= 4; k += 2.6) {
            const y1 = cy + k * pv, y2 = y1 + (1 + r() * 2) * pv;
            [a, x].forEach(c => { c.beginPath(); c.moveTo(px - 13 * pu, y1); c.quadraticCurveTo(px, y2, px + 13 * pu, y1 + (r() - .5) * 1.5 * pv); c.stroke(); });
          }
        }
      });
    });
    if (pr) { const im = image(pr.img); if (im) { const w = pr.w * pu, h = pr.w * pr.ar * pv; x.drawImage(im, g.print3.u * W - w / 2, g.print3.v * H - h / 2, w, h); } }
    // raw edge: frayed, uneven bottom
    if (P.raw) {
      const r = rng(dims.H * 13 | 0), yb = H - 1;
      a.fillStyle = '#000';
      for (let px = 0; px < W; px += 2) { const l = (1 + r() * 4.5) * pv; a.fillRect(px, yb - l, 2, l + 2); }
      x.strokeStyle = 'rgba(255,255,255,.55)'; x.lineWidth = 1;
      for (let px = 0; px < W; px += 3) { const l = (3 + r() * 5) * pv; x.beginPath(); x.moveTo(px, yb - l - 6 * pv); x.lineTo(px + (r() - .5) * 3, yb - 2 * pv); x.stroke(); }
    }
    P.map.needsUpdate = P.amap.needsUpdate = true;
    P.nrm.repeat.set(dims.C / 26, dims.H / 26);
  }
  const dash = (x, pts, color, w, d = [6, 4]) => { x.save(); x.strokeStyle = color; x.lineWidth = w; x.setLineDash(d); x.beginPath(); pts.forEach(([u, y], i) => i ? x.lineTo(u, y) : x.moveTo(u, y)); x.stroke(); x.restore(); };

  /* ---------- collisions: garments make room for the arms and hands (and a skirt for the legs) ---------- */
  function capsules(withLegs) {
    const caps = [];
    for (const mirror of [false, true]) {
      const pts = [];
      for (let y = K.apY + 14; y <= K.wr; y += 7) pts.push([K.armCx(y), y, K.armCz(y), (K.armRx(y) + K.armRz(y)) / 2]);
      for (let t = 6; t <= 52; t += 7) { const h = K.hand(t); pts.push([h.cx, h.y, h.cz, h.rx * .55]); }
      const posed = pts.map(([x, y, z, r]) => { const q = cc.warp([mirror ? 400 - x : x, y], 'arm'); return [q[0], q[1], z, r]; });
      for (let i = 0; i < posed.length - 1; i++) caps.push([posed[i], posed[i + 1]]);
      if (withLegs) {
        const lp = [];
        for (let y = K.Y.crotch + 10; y <= K.Y.knee + 50; y += 10) { const q = cc.warp([mirror ? 400 - K.legCx(y) : K.legCx(y), y], 'body'); lp.push([q[0], q[1], 0, Math.max(K.legRx(y), K.legFront(y)) + 1]); }
        for (let i = 0; i < lp.length - 1; i++) caps.push([lp[i], lp[i + 1]]);
      }
    }
    return caps.map(([a, b]) => { const r = Math.max(a[3], b[3]) + 3; return { a, b, lo: Math.min(a[1], b[1]) - r, hi: Math.max(a[1], b[1]) + r, xlo: Math.min(a[0], b[0]) - r, xhi: Math.max(a[0], b[0]) + r, zlo: Math.min(a[2], b[2]) - r, zhi: Math.max(a[2], b[2]) + r }; });
  }
  function pushOut(caps, off = 1.6) {
    return (x, y, z) => {
      for (const c of caps) {
        if (y < c.lo || y > c.hi || x < c.xlo || x > c.xhi || z < c.zlo || z > c.zhi) continue;
        const { a, b } = c, abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
        const t = clamp(((x - a[0]) * abx + (y - a[1]) * aby + (z - a[2]) * abz) / (abx * abx + aby * aby + abz * abz || 1), 0, 1);
        const qx = a[0] + abx * t, qy = a[1] + aby * t, qz = a[2] + abz * t, r = lerp(a[3], b[3], t) + off;
        const dx = x - qx, dy = y - qy, dz = z - qz, d = Math.hypot(dx, dy, dz);
        if (d < r && d > 1e-4) { x = qx + dx / d * r; y = qy + dy / d * r; z = qz + dz / d * r; }
      }
      return [x, y, z];
    };
  }

  /* ---------- garments ---------- */
  const garments = new THREE.Group(), rings = new THREE.Group(), extrasB = new THREE.Group(), extrasT = new THREE.Group();
  scene.add(garments, rings, extrasB, extrasT);
  const clearGroup = g => g.children.slice().forEach(m => { m.geometry.dispose(); g.remove(m); });
  function setMesh(P, geo, slot) {
    if (P.mesh) { P.mesh.geometry.dispose(); P.mesh.geometry = geo; }
    else { P.mesh = new THREE.Mesh(geo, P.mat); P.mesh.castShadow = P.mesh.receiveShadow = true; }
    P.mesh.userData = { part: P.id, slot };
    P.slot = slot;
    if (!P.mesh.parent) garments.add(P.mesh);
  }
  const hide = ids => ids.forEach(id => { const P = PARTS[id]; if (P && P.mesh && P.mesh.parent) garments.remove(P.mesh); });
  const extraMat = new THREE.MeshPhysicalMaterial({ roughness: .85, sheen: .5, sheenRoughness: .8 });
  const loopMat = new THREE.MeshPhysicalMaterial({ roughness: .85, sheen: .3 });
  const metalMat = new THREE.MeshStandardMaterial({ color: '#b08d57', roughness: .35, metalness: .85 });
  let bottomDepth = null;   // the bottom's front/back depth at y, so a tucked top can slip inside it

  function circumference(pt, y, n = 72) {
    let L = 0, p0 = pt(y, 0);
    for (let j = 1; j <= n; j++) { const p = pt(y, TAU * j / n); L += Math.hypot(p[0] - p0[0], p[2] - p0[2]); p0 = p; }
    return L;
  }

  function buildJeans(b, G, caps) {
    const Y = K.Y, wy = G.wy, c0 = G.c0, hy = G.hy;
    const HW = [[wy, G.wh], [G.h1, G.hipH(G.h1)], [G.h2, G.hipH(G.h2)], [c0 + 14, G.hipH(G.h2) - .5]];
    const hwAt = memo(y => ctable(HW, y));
    const depthAt = memo(y => {
      const [df, db] = K.depth(Math.min(y, Y.crotch)), ew = Math.max(0, hwAt(y) - K.torsoHalf(Math.min(y, Y.crotch)));
      const band = y < wy + 13 ? 1 : 0;
      return [df + .5 * ew + 2.5 + band, db + .5 * ew + 2.5 + band];
    });
    bottomDepth = depthAt;
    const N = 2.2;
    const pelvisPt = (y, phi) => {
      const c = Math.cos(phi), s = Math.sin(phi), hw = hwAt(y) + (y < wy + 13 ? 1 : 0), [df, db] = depthAt(y);
      const zf = df, zb = db + K.seat(y, phi);
      return [200 + hw * sgnPow(c, 2 / N), y, (s >= 0 ? zf : zb) * sgnPow(s, 2 / N)];
    };
    const RP = 60, CP = 88, yb = c0 + 14;
    const Pp = part('pelvis', true);
    Pp.raw = false;
    const dimsP = { C: circumference(pelvisPt, (wy + c0) / 2), H: yb - wy, y0: wy };
    const edges = memo(y => { const yy = Math.max(y, c0 + 10); return [G.outX(yy), G.inX(yy)]; });
    const legCxJ = y => { const [o, i] = edges(y); return (o + i) / 2; }, legRxJ = y => { const [o, i] = edges(y); return (i - o) / 2; };
    // knee break, stacking above a long narrow hem, and one long drop fold on wide legs
    const fold = (y, phi) => {
      let w = 0;
      if (hy > Y.knee + 30) w += .9 * (1 - b.knee) * Math.exp(-(((y - Y.knee + 6) / 7) ** 2)) * Math.sin(phi * 2 + .5);
      if (hy > Y.ankle - 4 && cc.LEG.hem(b.hemW) < 27) w += 1.7 * sstep(hy - 46, hy - 6, y) * Math.sin((hy - y) * .42 + phi * 1.3);
      if (b.knee > .55 && y > Y.knee) w += 1.6 * (b.knee - .55) * Math.sin(phi * 3 + .3);
      return w;
    };
    const legPtJ = (y, phi) => {
      const c = Math.cos(phi), s = Math.sin(phi), rx = legRxJ(y) + fold(y, phi);
      const rf = Math.max(rx * .98, K.legFront(y) + 2), rb = Math.max(rx * 1.02, K.legBack(y) + 2);
      return [legCxJ(y) + rx * c, y, ctable([[Y.crotch, 0], [Y.knee + 45, -2], [Y.ankle, 0]], y) + (s >= 0 ? rf : rb) * s];
    };
    const yl0 = c0;
    const dimsL = { C: circumference(legPtJ, (c0 + Math.min(hy, Y.knee)) / 2, 48), H: hy - yl0, y0: yl0 };
    const post = pushOut(caps);
    const phiP = j => -HALF + TAU * j / CP;
    // the seat ends along the crotch seam: right at the crotch in the middle, inside the legs at the sides
    const ybAt = phi => lerp(c0 + 3, yb, Math.abs(Math.cos(phi)) ** .7);
    /* Each leg starts exactly on the seat's lower edge (its half of the crotch-seam curve, closed by the crotch line)
       and is lofted into the round leg over the next 46 units, so seat and legs meet as one surface. */
    const rimHalf = [];
    for (let k = 0; k <= 40; k++) { const phi = HALF + PI * k / 40, p = pelvisPt(ybAt(phi), phi); rimHalf.push([p[0], p[1], p[2]]); }
    const zF = rimHalf[0][2], zB = rimHalf[40][2];
    for (let k = 1; k < 12; k++) rimHalf.push([199.4, c0 + 3, lerp(zB, zF, k / 12)]);
    const lc = [(Math.min(...rimHalf.map(p => p[0])) + 200) / 2, (zF + zB) / 2];
    const rimAt = psi => {   // where a ray from the leg centre at angle psi (0 = inner side, pi/2 = front) leaves the rim
      const dx = Math.cos(psi), dz = Math.sin(psi);
      let best = null;
      for (let k = 0; k < rimHalf.length; k++) {
        const a = rimHalf[k], b = rimHalf[(k + 1) % rimHalf.length], ex = b[0] - a[0], ez = b[2] - a[2];
        const den = dx * ez - dz * ex;
        if (Math.abs(den) < 1e-9) continue;
        const tt = ((a[0] - lc[0]) * ez - (a[2] - lc[1]) * ex) / den, u = ((a[0] - lc[0]) * dz - (a[2] - lc[1]) * dx) / den;
        if (tt > 0 && u >= 0 && u <= 1 && (!best || tt < best.t)) best = { t: tt, p: [a[0] + ex * u, a[1] + (b[1] - a[1]) * u, a[2] + ez * u] };
      }
      return best ? best.p : legPtJ(c0 + 10, psi);
    };
    const KL = 26, LR = 92, LC = 44, yJ = c0 + 46;
    const legRow = (i, psi, rim) => {
      if (i >= KL) { const y = lerp(yJ, hy, (i - KL) / (LR - KL - 1)); return legPtJ(y, psi); }
      const f = i / KL, y = lerp(rim[1], yJ, f), n = legPtJ(y, psi), w = sstep(0, 1, f);
      return [lerp(rim[0], n[0], w), y, lerp(rim[2], n[2], w)];
    };
    setMesh(Pp, tube(RP, CP, (i, j) => { const y = lerp(wy, ybAt(phiP(j)), i / (RP - 1)); return { p: pelvisPt(y, phiP(j)), v: (y - wy) / dimsP.H }; }, { post }), 'bottom');
    Pp.ring = y => ringPts(pelvisPt, y, 'body', false);
    Pp.dims = dimsP;
    const amber = 'rgba(200,145,58,.95)', cH = b.fill.c1;
    paint(Pp, b, dimsP, {
      key: [wy, c0, G.wh],
      draw(x, X, V, pu, pv) {
        const C = dimsP.C, fx = du => X(C / 2 + du), bx = du => X(du), W = x.canvas.width;
        x.fillStyle = cc.shade(cH, -.1); x.fillRect(0, V(wy), W, 13 * pv);
        dash(x, [[0, V(wy + 3)], [W, V(wy + 3)]], amber, 1.2 * pv); dash(x, [[0, V(wy + 10)], [W, V(wy + 10)]], amber, 1.2 * pv);
        x.strokeStyle = 'rgba(0,0,0,.35)'; x.lineWidth = 1.2 * pu;
        x.beginPath(); x.moveTo(fx(0), V(wy + 13)); x.lineTo(fx(0), V(c0 - 2)); x.stroke();
        dash(x, [[fx(9), V(wy + 14)], [fx(9), V(c0 - 46)], [fx(6), V(c0 - 34)], [fx(0), V(c0 - 28)]], amber, 1.1 * pv);
        [-1, 1].forEach(sd => {
          dash(x, [[fx(sd * 34), V(wy + 13)], [fx(sd * 35), V(wy + 30)], [fx(sd * 44), V(wy + 46)], [fx(sd * C * .2), V(wy + 52)]], amber, 1.1 * pv);
          // back yoke and patch pockets
          dash(x, [[bx(sd * C * .22), V(wy + 20)], [bx(0), V(wy + 34)]].map(([u, y]) => [u < 0 ? u + W : u, y]), amber, 1.1 * pv);
          const px = du => { const u = bx(du); return u < 0 ? u + W : u; };
          dash(x, [[px(sd * 14), V(wy + 42)], [px(sd * 44), V(wy + 40)], [px(sd * 42), V(wy + 76)], [px(sd * 29), V(wy + 84)], [px(sd * 16), V(wy + 77)], [px(sd * 14), V(wy + 42)]], amber, 1.1 * pv);
        });
        dash(x, [[fx(26), V(wy + 16)], [fx(28), V(wy + 32)], [fx(41), V(wy + 30)], [fx(40), V(wy + 15)]], amber, 1 * pv);
        // whiskers fanning from the crotch
        x.strokeStyle = 'rgba(255,255,255,.16)'; x.lineWidth = 1.1 * pv; x.filter = `blur(${(.9 * pv).toFixed(1)}px)`;
        [[-1, 0], [-1, 10], [1, 0], [1, 10]].forEach(([sd, k]) => { x.beginPath(); x.moveTo(fx(sd * (19 - k * .4)), V(c0 + 18 + k - 12)); x.quadraticCurveTo(fx(sd * 28), V(c0 + 8 + k - 12), fx(sd * 40), V(c0 - 4 + k - 12)); x.stroke(); });
        x.filter = 'none';
      },
    });
    for (const [id, mirror] of [['legL', false], ['legR', true]]) {
      const P = part(id, true);
      P.raw = !!b.rawHem;
      const rims = Array.from({ length: LC }, (_, j) => rimAt(TAU * j / LC));
      setMesh(P, tube(LR, LC, (i, j) => { const p = legRow(i, TAU * j / LC, rims[j]); return { p, v: (p[1] - yl0) / dimsL.H }; }, { mirror, post }), 'bottom');
      P.ring = y => ringPts(legPtJ, y, 'body', mirror);
      P.dims = dimsL;
      paint(P, b, dimsL, {
        key: [hy, b.rawHem],
        draw(x, X, V, pu, pv) {
          const C = dimsL.C, W = x.canvas.width, front = X(C / 4);
          // lighter wear down the front of the thigh and shin
          [[c0 + 70, 70, .2], [Y.knee + 30, 50, .14]].forEach(([y, ry, o]) => {
            if (y > hy) return;
            const g2 = x.createRadialGradient(front, V(y), 0, front, V(y), C * .2 * pu);
            g2.addColorStop(0, `rgba(255,255,255,${o})`); g2.addColorStop(1, 'rgba(255,255,255,0)');
            x.save(); x.translate(front, V(y)); x.scale(1, ry * pv / (C * .2 * pu)); x.translate(-front, -V(y)); x.fillStyle = g2; x.fillRect(0, 0, W, x.canvas.height); x.restore();
          });
          x.strokeStyle = 'rgba(0,0,0,.18)'; x.lineWidth = 1.2 * pu; x.beginPath(); x.moveTo(X(C / 2), 0); x.lineTo(X(C / 2), x.canvas.height); x.stroke();
          if (!b.rawHem) dash(x, [[0, V(hy - 7)], [W, V(hy - 7)]], amber, 1.2 * pv);
        },
      });
    }
    // belt loops and the shank button
    const loopGeo = new THREE.BoxGeometry(4.2 * SC, 16 * SC, 1.8 * SC), lm = loopMat;
    loopMat.color.set(cc.shade(cH, -.18));
    [[-HALF, 0], [HALF - .62, 0], [HALF + .62, 0], [0.15, 0], [PI - .15, 0], [-HALF - .7, 0], [-HALF + .7, 0]].forEach(([phi]) => {
      const p = pelvisPt(wy + 7, phi), q = cc.warp([p[0], p[1]], 'body');
      const m = new THREE.Mesh(loopGeo, lm);
      m.position.set((q[0] - 200) * SC, (750 - q[1]) * SC, p[2] * SC * 1.03 + Math.sin(phi) * .012);
      m.rotation.y = Math.atan2(p[0] - 200, p[2]);
      m.castShadow = true;
      extrasB.add(m);
    });
    const bp = pelvisPt(wy + 6.5, HALF), bq = cc.warp([bp[0], bp[1]], 'body');
    const btn = new THREE.Mesh(new THREE.CylinderGeometry(3.6 * SC, 3.6 * SC, 1.6 * SC, 24), metalMat);
    btn.rotation.x = HALF; btn.position.set((bq[0] - 200) * SC, (750 - bq[1]) * SC, (bp[2] + 1) * SC);
    extrasB.add(btn);
  }

  function buildSkirt(b, G) {
    const Y = K.Y, fl = b.fit, wy = G.wy, hy = G.hy;
    const x34 = cc.bodyHalf(G.hipY - 34) + 3 + fl * 2 + b.hip * 8;
    const HW = hy > G.hipY + 2 ? [[wy, G.wh], [G.hipY - 34, x34], [G.hipY, G.hipH], [hy, G.hemH]] : [[wy, G.wh], [hy, G.hemH]];
    const hwAt = y => ctable(HW, y), yc = y => Math.min(y, Y.crotch);
    const depthAt = y => {
      const [df, db] = K.depth(yc(y)), ew = Math.max(0, hwAt(y) - K.torsoHalf(yc(y)));
      let f = df + .5 * ew + 2, bk = db + .5 * ew + 2;
      if (y > Y.crotch) { f = Math.max(f, K.legFront(y) + 9); bk = Math.max(bk, K.legBack(y) + 9); }
      return [f, bk];
    };
    bottomDepth = depthAt;
    // flared skirts fall in soft radial folds that deepen toward the hem
    const folds = (y, phi) => y <= G.hipY ? 0 : (1.5 + fl * 13) * ((y - G.hipY) / Math.max(1, hy - G.hipY)) ** 1.2 * (Math.sin(phi * 9 + .4) * .8 + Math.sin(phi * 5 + 1.7) * .2);
    const pt = (y, phi) => {
      const c = Math.cos(phi), s = Math.sin(phi), w = folds(y, phi), hw = hwAt(y) + w, [df, db] = depthAt(y);
      return [200 + hw * sgnPow(c, 2 / 2.1), y, ((s >= 0 ? df : db + K.seat(y, phi)) + w) * sgnPow(s, 2 / 2.1)];
    };
    const P = part('skirt', false);
    P.raw = !!b.rawHem;
    const dims = { C: circumference(pt, (wy + hy) / 2, 96), H: hy - wy, y0: wy };
    setMesh(P, tube(90, 128, (i, j) => { const y = lerp(wy, hy, i / 89); return { p: pt(y, -HALF + TAU * j / 128), v: (y - wy) / dims.H }; }, { ctx: 'skirt', post: pushOut(capsules(true)) }), 'bottom');
    P.ring = y => ringPts(pt, y, 'skirt', false);
    P.dims = dims;
    paint(P, b, dims, { key: [wy], draw(x, X, V, pu, pv) { x.fillStyle = cc.shade(b.fill.c1, -.1); x.fillRect(0, V(wy), x.canvas.width, 12 * pv); } });
  }

  function buildTop(t, G, caps) {
    const Y = K.Y, N = 2.2, hy = G.hy, NLy = G.NL[1], nw = G.nw, C0y = G.C0[1], ST = G.ST, apY = G.apY;
    const sx = clamp(K.B.sx, ST[0] + 6, G.NL[0] - 6);
    const SH = [[NLy, nw], [Math.max(NLy + 1, cc.neckY(sx) - 3), 200 - sx], [Math.max(NLy + 2, ST[1]), 200 - ST[0]]];
    const hwAt = memo(y => y <= NLy ? nw : y <= SH[2][0] ? table(SH, y) : y < apY ? lerp(200 - ST[0], G.half(apY), sstep(SH[2][0], apY, y)) : G.half(y), .1);
    const cl = t.cling ?? .35, dfB = K.depth(Y.bust)[0], dbB = K.depth(Y.armpit + 4)[1];
    const tk = G.tuck;
    const depthAt = memo(y => {
      const [df, db] = K.depth(Math.min(y, Y.crotch)), ew = Math.max(0, hwAt(y) - K.torsoHalf(Math.min(y, Y.crotch)));
      // like the 2D outline, fabric hangs straight down from the bust and shoulder blades unless it clings
      const hf = y > Y.bust ? lerp(Math.max(df, .2 * df + .8 * dfB), df, cl) : df;
      const hb = y > Y.armpit ? lerp(Math.max(db, .3 * db + .7 * dbB), db, cl) : db;
      let f = Math.max(df, hf) + .5 * ew + 2.4, bk = Math.max(db, hb) + .5 * ew + 2.4;
      // worn over the bottom: always stay just outside it
      if (!tk && bottomDepth && y > cc.geo.bottom.wy - 4) { const [jf, jb] = bottomDepth(y); f = Math.max(f, jf + 1.6); bk = Math.max(bk, jb + 1.6); }
      if (tk && bottomDepth) { const k = sstep(tk.wy - 54, tk.wy, y), [jf, jb] = bottomDepth(y); f = Math.max(df + .6, lerp(f, jf - 1.4, k)); bk = Math.max(db + .6, lerp(bk, jb - 1.4, k)); }
      return [f, bk];
    });
    const ewAt = y => Math.max(0, hwAt(y) - K.torsoHalf(Math.min(y, Y.crotch)));
    const drape = (y, phi) => {
      let w = 0;
      if (!tk) w += (clamp((ewAt(y) - 7) / 22, 0, 1) * 2.4 + Math.max(0, t.flare) * .06) * sstep(Y.bust + 10, Y.bust + 70, y) * (Math.sin(7 * phi + .6) * .7 + Math.sin(11 * phi + 2.1) * .3);
      if (tk) w += 1.5 * Math.exp(-(((y - tk.wy + 14) / 10) ** 2)) * Math.sin(14 * phi);
      return w;
    };
    // fabric bridges across the bust instead of dipping between
    // below the bust a loose top keeps hanging from the bust line instead of following the body in
    const bridge = (y, phi) => K.B.bustBump * 1.2 * Math.exp(-((angDiff(phi, HALF) / .9) ** 2)) * (y <= Y.bust ? Math.exp(-(((y - Y.bust) / 20) ** 2)) : lerp(1, Math.exp(-(((y - Y.bust) / 20) ** 2)), cl));
    const pt = (y, phi) => {
      const c = Math.cos(phi), s = Math.sin(phi), w = drape(y, phi), hw = hwAt(y) + w, [df, db] = depthAt(y);
      const zf = df + bridge(y, phi) * (tk ? 1 - sstep(tk.wy - 60, tk.wy - 20, y) : 1), zb = db + K.seat(y, phi);
      return [200 + hw * sgnPow(c, 2 / N), y, ((s >= 0 ? zf : zb) + w) * sgnPow(s, 2 / N)];
    };
    // neckline: front U↔V curve from the neck side point down to the centre-front depth; back sits a little higher
    const shapeY = r => C0y + (NLy - C0y) * lerp(1 - Math.sqrt(Math.max(0, 1 - r * r)), r, t.neckV);
    const dxF = y => { let lo = 0, hi = 1; for (let k = 0; k < 18; k++) { const m = (lo + hi) / 2; if (shapeY(m) > y) lo = m; else hi = m; } return nw * (lo + hi) / 2; };
    const yStart = phi => {
      const c = Math.cos(phi), s = Math.sin(phi);
      if (s < 0) return NLy - 4.5 * (1 - c * c);
      let lo = NLy, hi = C0y;
      for (let k = 0; k < 20; k++) { const m = (lo + hi) / 2; if (hwAt(m) * Math.abs(c) ** (2 / N) < dxF(m)) lo = m; else hi = m; }
      return (lo + hi) / 2;
    };
    const CT = 96, RT = 110, yTop = NLy - 4.5;
    const starts = Array.from({ length: CT }, (_, j) => yStart(-HALF + TAU * j / CT));
    const P = part('body', false);
    P.raw = !!t.rawHem && !tk;
    const dims = { C: circumference(pt, (Y.bust + hy) / 2, 96), H: hy - yTop, y0: yTop };
    const post = pushOut(caps);
    setMesh(P, tube(RT, CT, (i, j) => { const y = lerp(starts[j], hy, (i / (RT - 1)) ** 1.15); return { p: pt(y, -HALF + TAU * j / CT), v: (y - yTop) / dims.H }; }, { post }), 'top');
    P.ring = y => ringPts(pt, y, 'body', false, phi => y >= yStart(phi));
    P.dims = dims;
    const cH = t.fill.c1;
    paint(P, t, dims, {
      key: [hy, t.rawHem, !!tk],
      draw(x, X, V, pu, pv) {
        if (!t.rawHem && !tk) dash(x, [[0, V(hy - 6)], [x.canvas.width, V(hy - 6)]], `${cc.shade(cH, -.38)}aa`, 1 * pv, [3 * pu, 2.5 * pu]);
      },
    });
    // rib collar band following the neckline
    const ring = starts.map((y, j) => { const phi = -HALF + TAU * j / CT, p = pt(y + 1.2, phi), q = cc.warp([p[0], p[1]], 'body'); return new THREE.Vector3((q[0] - 200) * SC, (750 - q[1]) * SC, p[2] * SC * 1.015); });
    const band = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(ring, true), 160, 2.1 * SC, 10, true), extraMat);
    extraMat.color.set(t.fill.type === 'solid' ? cc.shade(cH, -.06) : cH);
    band.castShadow = true;
    extrasT.add(band);

    // sleeves
    if (G.nl) { hide(['sl', 'sr']); return; }
    const se = G.se, si = G.si, sy = G.sy, p = clamp((sy - ST[1]) / Math.max(1, apY - ST[1]), 1, 3);
    const outerY = s => lerp(ST[1], sy, s), innerY = s => sy > apY ? ST[1] + (sy - ST[1]) * s + (apY - ST[1]) * (1 - s) ** p : lerp(apY, sy, s);
    const long = sy > 300, kf = clamp(1 - t.sfit / 14, .35, 1);
    const sFold = (y, phi) => long ? 1.3 * kf * Math.exp(-(((y - K.el) / 16) ** 2)) * Math.sin((y - K.el) * .55 + phi) + (sy > K.wr - 30 ? 1.1 * kf * sstep(sy - 40, sy - 8, y) * Math.sin((sy - y) * .5 + phi * 2) : 0) : 0;
    const spt = (s, phi) => {
      const c = Math.cos(phi), y = lerp(outerY(s), innerY(s), ((1 + c) / 2) ** 2.5), w = sFold(y, phi);
      const cx = K.armCx(y) - (se - si) / 2, rx = K.armRx(y) + (se + si) / 2 + w, rz = K.armRz(y) + (se + si) / 2 * .8 + 1.5 + w;
      let x = cx + rx * c;
      if (s < .4 && c > 0) x = lerp(x, Math.max(x, 200 - G.half(Math.max(y, apY)) - 1), c * (1 - s / .4) ** 2);
      return [x, y, K.armCz(y) + rz * Math.sin(phi)];
    };
    const sdims = { C: circumference((s, phi) => spt(.5, phi), .5, 40), H: sy - ST[1], y0: ST[1] };
    for (const [id, mirror] of [['sl', false], ['sr', true]]) {
      const S = part(id, false);
      S.raw = !!t.rawSleeve;
      setMesh(S, tube(70, 40, (i, j) => { const pp = spt(i / 69, TAU * j / 40); return { p: pp, v: (pp[1] - ST[1]) / sdims.H }; }, { ctx: 'arm', mirror }), 'top');
      S.ring = y => { const pts = []; for (let j = 0; j <= 40; j++) { const phi = TAU * j / 40, c = Math.cos(phi), cx = K.armCx(y) - (se - si) / 2, rx = K.armRx(y) + (se + si) / 2 + 1, rz = K.armRz(y) + (se + si) / 2 * .8 + 2.5; const x0 = cx + rx * c, q = cc.warp([mirror ? 400 - x0 : x0, y], 'arm'); pts.push(new THREE.Vector3((q[0] - 200) * SC, (750 - q[1]) * SC, (K.armCz(y) + rz * Math.sin(phi)) * SC)); } return pts; };
      S.dims = sdims;
      paint(S, t, sdims, {
        key: [sy, t.rawSleeve],
        draw(x, X, V, pu, pv) {
          if (t.rawSleeve) return;
          if (long && sy > 360) { x.fillStyle = 'rgba(0,0,0,.12)'; x.fillRect(0, V(sy - 15), x.canvas.width, 1.2 * pv); }
          else dash(x, [[0, V(sy - 7)], [x.canvas.width, V(sy - 7)]], `${cc.shade(cH, -.38)}aa`, 1 * pv, [3 * pu, 2.5 * pu]);
        },
      });
    }
  }

  // a level loop around a part at rest height y (for the scissors preview)
  function ringPts(pt, y, ctx, mirror, keep = () => true) {
    const pts = [];
    for (let j = 0; j <= 96; j++) {
      const phi = -HALF + TAU * j / 96;
      if (!keep(phi)) continue;
      const p = pt(y, phi), x0 = mirror ? 400 - p[0] : p[0], q = cc.warp([x0, y], ctx);
      const k = 1 + 2 / Math.max(10, Math.hypot(p[0] - 200, p[2]));
      pts.push(new THREE.Vector3((q[0] - 200) * SC, (750 - q[1]) * SC, p[2] * SC * k));
    }
    return pts;
  }

  // rebuild only what changed: the bottom never depends on the top; the top follows the bottom (tuck, worn over it)
  let keyB = '', keyT = '', caps = null;
  function buildGarments(force) {
    const st = cc.state, geo = cc.geo;
    const kb = JSON.stringify([st.bottom, manKey]), kt = JSON.stringify([st.top, kb, st.top && st.top.tuck && cc.tucked()]);
    if (force || !caps) caps = capsules(false);
    if (force || kb !== keyB) {
      keyB = kb; clearGroup(extrasB); bottomDepth = null;
      if (st.bottom && geo.bottom) {
        if (st.bottom.kind === 'jeans') { hide(['skirt']); buildJeans(st.bottom, geo.bottom, caps); }
        else { hide(['pelvis', 'legL', 'legR']); buildSkirt(st.bottom, geo.bottom); }
      } else hide(['pelvis', 'legL', 'legR', 'skirt']);
    }
    if (force || kt !== keyT) {
      keyT = kt; clearGroup(extrasT);
      // belt loops and the button sit under a top worn over the waistband
      extrasB.visible = !(st.top && geo.top && geo.bottom && !geo.top.tuck && geo.top.hy > geo.bottom.wy + 16);
      if (st.top && geo.top) buildTop(st.top, geo.top, caps);
      else hide(['body', 'sl', 'sr']);
    }
  }

  /* ---------- frame loop ---------- */
  let dirty = true, needs = true, backKey = '', buildMs = 0;
  function rebuild() {
    const t0 = performance.now();
    const pr = cc.prefs;
    if (pr.backdrop !== backKey) {
      backKey = pr.backdrop;
      const col = BACK[backKey] || BACK.studio;
      cycMat.color.set(col);
      scene.background = new THREE.Color(col);
      wrap.style.background = col;
    }
    const mk = [pr.body, pr.pose, pr.finish].join('|');
    if (mk !== manKey || !K) {
      manKey = mk;
      K = makeKit();
      const f = FIN[pr.finish] || FIN.white;
      manMat.color.set(f.color); manMat.roughness = f.roughness; manMat.clearcoat = f.clearcoat; manMat.clearcoatRoughness = f.clearcoatRoughness;
      buildMannequin();
      caps = null; keyB = keyT = '';
    }
    buildGarments();
    buildMs = performance.now() - t0;
  }
  // frame the whole figure (head to base plate, plus room for the floating bars) whatever the stage shape
  function fit() {
    const r = wrap.getBoundingClientRect(), w = Math.max(1, r.width), h = Math.max(1, r.height);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const t = Math.tan(camera.fov * PI / 360), dH = 4.75 / t, dW = 1.9 / (t * camera.aspect), d = Math.max(dH, dW);
    const dir = camera.position.clone().sub(controls.target).normalize();
    camera.position.copy(controls.target).addScaledVector(dir, d);
    controls.maxDistance = d * 1.4;
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
  const tip = document.createElement('div');
  tip.className = 'tip3';
  wrap.appendChild(tip);
  function hit(e) {
    const r = canvas.getBoundingClientRect();
    ndc.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1);
    ray.setFromCamera(ndc, camera);
    return ray.intersectObjects(garments.children, false)[0] || null;
  }
  function restY(h) {
    const g = h.object.geometry, pos = g.attributes.position, ry = g.attributes.ry, { a, b, c } = h.face;
    tri.setFromAttributeAndIndices(pos, a, b, c).getBarycoord(h.point, bary);
    return ry.getX(a) * bary.x + ry.getX(b) * bary.y + ry.getX(c) * bary.z;
  }
  function cutInfo(h) {
    const ud = h.object.userData, y = restY(h), st = cc.state;
    if (ud.part === 'sl' || ud.part === 'sr') {
      const T = st.top, ny = y <= cc.geo.top.apY + 8 ? 190 : y;
      return ny >= T.sleeve - 4 ? null : { key: 'sleeve', val: ny, label: cc.sleeveName(ny), parts: ['sl', 'sr'], y: Math.max(ny, cc.geo.top.apY) };
    }
    if (ud.slot === 'top') {
      const T = st.top, ny = clamp(y, cc.LIMIT['top.len'][0], T.len);
      return ny >= T.len - 4 ? null : { key: 'topLen', val: ny, label: cc.topLenName(ny), parts: ['body'], y: ny };
    }
    const B = st.bottom, lim = cc.bottomLenLimit(B), ny = clamp(y, lim[0], B.len);
    return ny >= B.len - 4 ? null : { key: 'bottomLen', val: ny, label: cc.bottomLenName(B, ny), parts: B.kind === 'jeans' ? (ny > cc.geo.bottom.c0 + 10 ? ['legL', 'legR'] : ['pelvis']) : ['skirt'], y: ny };
  }
  const ringMat = new THREE.LineDashedMaterial({ color: 0x161616, dashSize: .05, gapSize: .035, depthTest: false });
  const ringMat2 = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: .7, depthTest: false });
  function showRing(c, e) {
    rings.children.slice().forEach(l => { l.geometry.dispose(); rings.remove(l); });
    if (!c) { tip.classList.remove('show'); needs = true; return; }
    c.parts.forEach(id => {
      const P = PARTS[id];
      if (!P || !P.ring) return;
      const g = new THREE.BufferGeometry().setFromPoints(P.ring(c.y));
      const l2 = new THREE.Line(g, ringMat2), l = new THREE.Line(g, ringMat);
      l.computeLineDistances(); l.renderOrder = l2.renderOrder = 10;
      rings.add(l2, l);
    });
    const r = wrap.getBoundingClientRect();
    tip.textContent = '✂ ' + c.label;
    tip.style.left = (e.clientX - r.left + 14) + 'px'; tip.style.top = (e.clientY - r.top - 12) + 'px';
    tip.classList.add('show');
    needs = true;
  }
  function paintAt(h, first) {
    const ud = h.object.userData, g = cc.state[ud.slot], P = PARTS[ud.part];
    if (!g || !P || !h.uv) return;
    const list = g.dmg3 || (g.dmg3 = []), u = h.uv.x, v = h.uv.y, d = P.dims;
    const dist = q => Math.hypot(angDiff(q.u * TAU, u * TAU) / TAU * d.C, (q.v - v) * d.H);
    const near = list.reduce((best, q, i) => { if (q.part !== ud.part) return best; const k = dist(q); return k < (best ? best.k : 16) ? { i, k } : best; }, null);
    if (cc.dmgMode === 'erase') { if (near) list.splice(near.i, 1); }
    else if (near) { if (first) list[near.i].lv = Math.min(3, list[near.i].lv + 1); }
    else list.push({ part: ud.part, u: Math.round(u * 1e4) / 1e4, v: Math.round(v * 1e4) / 1e4, lv: 1 });
    cc.render();
    return { u, v };
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
    const ud = h.object.userData;
    if (tool === 'cut') {
      const c = cutInfo(h);
      if (e.pointerType === 'mouse') { if (c) { cc.applyCut(c); showRing(null); } return; }
      drag = { type: 'cut', c };
      showRing(c, e);
    } else if (tool === 'dmg') {
      paintAt(h, true);
      drag = { type: 'dmg', slot: ud.slot, last: h.point.clone() };
    } else {
      const g = cc.state[ud.slot];
      if (cc.state.target !== ud.slot) { cc.setTarget(ud.slot); return; }
      if (g && g.print && h.uv) { g.print3 = { part: ud.part, u: h.uv.x, v: h.uv.y }; cc.render(); cc.commit(); cc.say('프린트를 옮겼어요'); }
      return;
    }
    canvas.setPointerCapture(e.pointerId);
  }, { capture: true });
  canvas.addEventListener('pointermove', e => {
    if (drag) {
      if (drag.type === 'cut') { const h = hit(e); drag.c = h ? cutInfo(h) : null; showRing(drag.c, e); }
      else { const h = hit(e); if (h && h.object.userData.slot === drag.slot && h.point.distanceTo(drag.last) > .13) { paintAt(h, false); drag.last = h.point.clone(); } }
      return;
    }
    const tool = cc.tool;
    if (tool === 'cut' && e.pointerType === 'mouse' && !e.buttons) {
      const h = hit(e);
      showRing(h ? cutInfo(h) : null, e);
      canvas.style.cursor = h ? 'crosshair' : '';
    } else if ((tool === 'dmg' || tool === 'color') && !e.buttons) {
      canvas.style.cursor = hit(e) ? (tool === 'dmg' ? 'crosshair' : 'pointer') : '';
    } else if (!e.buttons) canvas.style.cursor = '';
  });
  const end = () => {
    if (!drag) return;
    const d = drag; drag = null;
    if (d.type === 'cut') { if (d.c) cc.applyCut(d.c); showRing(null); }
    else cc.commit();
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('pointerleave', () => { if (!drag) showRing(null); });

  /* ---------- public ---------- */
  const VIEWS = { front: 0, side: -HALF, back: PI };
  const S3 = {
    update() { dirty = true; },
    get lastBuildMs() { return buildMs; },
    setView(v) {
      const a = VIEWS[v] ?? 0, d = camera.position.distanceTo(controls.target), y = camera.position.y;
      const hr = Math.sqrt(Math.max(0, d * d - (y - controls.target.y) ** 2));
      camera.position.set(controls.target.x + hr * Math.sin(a), y, controls.target.z + hr * Math.cos(a));
      controls.update(); needs = true;
    },
    savePNG() {
      const w = 1000, h = 1500, prev = new THREE.Vector2();
      renderer.getSize(prev);
      const pa = camera.aspect, pr = renderer.getPixelRatio();
      renderer.setPixelRatio(1); renderer.setSize(w, h, false);
      camera.aspect = w / h; camera.updateProjectionMatrix();
      rings.visible = false;
      renderer.render(scene, camera);
      canvas.toBlob(b => {
        rings.visible = true;
        renderer.setPixelRatio(pr); renderer.setSize(prev.x, prev.y, false);
        camera.aspect = pa; camera.updateProjectionMatrix(); needs = true;
        if (!b) return cc.say('저장에 실패했어요');
        const a = document.createElement('a');
        a.href = URL.createObjectURL(b); a.download = '고쳐입기.png'; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        cc.say('PNG로 저장했어요');
      }, 'image/png');
    },
  };
  S3._debug = { camera, controls, scene, renderer, PARTS };
  cc.attach3D(S3);
}
