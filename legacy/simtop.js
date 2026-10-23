// The top on the stage as real cloth: the pattern (pattern.js) sewn and hung on the body by the cloth worker
// (cloth.js), shown through the garment mesh the stage already has (same material, same edit tools). The worker works
// in the rest pose; the cloth follows the pose by the skin weights of the body under each point.
import * as THREE from 'three';

const VER = 5;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class SimTop {
  // asset: the stage's loaded body (meshes, H, kind); on: { frame(), topo(mesh), settled(mesh) } callbacks
  constructor(asset, on) {
    this.A = asset; this.on = on;
    this.mesh = null; this.geo = null; this.next = null; this.map = null;
    this.busy = false; this.awake = 0; this.sent = ''; this.botKey = '';
    const body = asset.meshes.body, P = body.geometry.attributes.position, N = body.geometry.attributes.normal, H = asset.H, s = H / 1.77;
    // the body at rest (bind space = world here), for the collision field and for skin weights
    this.bodyGrid = grid(P);
    let hps = 0;
    const zs = [];
    for (let i = 0; i < P.count; i++) {
      const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
      if (Math.abs(x - .075 * s) < .008 && Math.abs(z) < .06 && y > 1.38 * s && y < 1.56 * s) hps = Math.max(hps, y);
    }
    for (let i = 0; i < P.count; i++) if (Math.abs(P.getX(i)) < .12 && Math.abs(P.getY(i) - (hps - .2 * s)) < .02) zs.push(P.getZ(i));
    this.hps = hps;
    const z0 = (Math.min(...zs) + Math.max(...zs)) / 2;
    const sk = body.skeleton, bp = n => sk.getBoneByName(n).getWorldPosition(new THREE.Vector3()).toArray();
    asset.root.updateMatrixWorld(true);
    const bones = { l: [bp('upperarm_l'), bp('lowerarm_l'), bp('hand_l')], r: [bp('upperarm_r'), bp('lowerarm_r'), bp('hand_r')] };
    this.worker = new Worker(`cloth.js?v=${VER}`, { type: 'module' });
    this.worker.onerror = e => console.error('[cloth]', e.message);
    this.worker.onmessage = e => this.message(e.data);
    this.worker.postMessage({ t: 'init', body: { pos: new Float32Array(P.array), nrm: new Float32Array(N.array) }, bottom: null, bones, hps, z0 });
  }
  // the pattern's numbers (cm) — sent only when they change; the cloth then moves to the new shape
  params(p) {
    const key = JSON.stringify(p);
    if (key === this.sent) return;
    this.sent = key;
    this.worker.postMessage({ t: 'params', p });
    this.awake = 1;
  }
  // the bottom worn under it (radius table), or null when there is none or the top is tucked in
  bottom(tab, key, mesh) {
    if ((mesh || null) !== (this.botMesh || null)) { this.botMesh = mesh || null; this.skin(); }
    if (key === this.botKey) return;
    this.botKey = key;
    this.worker.postMessage({ t: 'bottom', tab });
    this.awake = 1;
  }
  // which of the stage's garment meshes shows the cloth (tee or long)
  use(mesh) {
    if (this.mesh === mesh) return;
    this.mesh = mesh;
    if (this.geo) this.attach();
  }
  tick() {
    if (this.busy || !(this.awake || this.next)) return;
    this.busy = true;
    this.worker.postMessage({ t: 'tick' });
  }
  get moving() { return !!(this.awake || this.next); }

  message(m) {
    if (m.t === 'log') { if (/ERROR|≠/.test(m.s)) console.warn('[cloth]', m.s); return; }
    if (m.t === 'topo') { this.next = m; return; }
    if (m.t !== 'frame') return;
    this.busy = false;
    if (!m.pos) return;
    const fresh = !!this.next;
    if (this.next) { this.build(this.next); this.next = null; }
    if (!this.geo) return;
    const g = this.geo, map = this.map, n = map.length;
    const P = g.attributes.position.array, N = g.attributes.normal.array, h = g.attributes._h.array, cl = g.attributes._cl.array, cn = g.attributes._cn.array;
    for (let i = 0; i < n; i++) {
      const q = map[i];
      P[i * 3] = m.pos[q * 3]; P[i * 3 + 1] = m.pos[q * 3 + 1]; P[i * 3 + 2] = m.pos[q * 3 + 2];
      N[i * 3] = m.nrm[q * 3]; N[i * 3 + 1] = m.nrm[q * 3 + 1]; N[i * 3 + 2] = m.nrm[q * 3 + 2];
      h[i] = m.pos[q * 3 + 1];
      cl[i] = m.cl[q]; cn[i * 3] = m.cn[q * 3]; cn[i * 3 + 1] = m.cn[q * 3 + 1]; cn[i * 3 + 2] = m.cn[q * 3 + 2];
    }
    for (const k of ['position', 'normal', '_h', '_cl', '_cn']) g.attributes[k].needsUpdate = true;
    g.computeBoundingSphere(); g.computeBoundingBox();
    if (this.mesh) this.mesh.boundingSphere = this.mesh.boundingBox = null;   // picking tests the skinned bounds: work them out again
    const was = this.awake;
    this.awake = m.awake;
    if (fresh || (was && !m.awake)) this.skin(!m.awake);   // new points, or the cloth has come to rest: weights from where it is now
    if (fresh) this.on.topo(this.mesh);
    else if (was && !m.awake) this.on.settled(this.mesh);
    this.on.frame();
  }

  // a new mesh from the worker: the attributes the stage's garment shader reads
  build(t) {
    const n = t.nV, g = new THREE.BufferGeometry(), arm = t.info.P.arm;
    this.map = t.map; this.pc = t.pc;
    const f = k => new THREE.BufferAttribute(new Float32Array(n * k), k);
    g.setAttribute('position', f(3)); g.setAttribute('normal', f(3));
    g.setAttribute('_h', f(1)); g.setAttribute('_cl', f(1)); g.setAttribute('_cn', f(3));
    // pattern → texture space: the four pieces in a 2×2 atlas, fixed scale, so brush strokes stay put on the fabric
    const uv1 = new Float32Array(n * 2), s = new Float32Array(n), zero = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const pc = t.pc[i], x = t.uv[i * 2] - [0, .7, 1.4, 1.9][pc], y = t.uv[i * 2 + 1];
      uv1[i * 2] = (pc & 1) * .5 + clamp((x + .375) / .75, 0, 1) * .5;
      uv1[i * 2 + 1] = (pc >> 1) * .5 + clamp((y + 1.05) / 1.1, 0, 1) * .5;
      s[i] = pc >= 2 ? Math.max(.02, -y * 100 / arm) : 0;   // along the sleeve, shoulder 0 → wrist 1
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv1.slice(), 2));
    g.setAttribute('uv1', new THREE.BufferAttribute(uv1, 2));
    g.setAttribute('_s', new THREE.BufferAttribute(s, 1));
    for (const k of ['_c', '_lg', '_x']) g.setAttribute(k, new THREE.BufferAttribute(zero.slice(), 1));
    g.setAttribute('skinIndex', new THREE.BufferAttribute(new Uint16Array(n * 4), 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(new Float32Array(n * 4), 4));
    g.setIndex(new THREE.BufferAttribute(t.index, 1));
    this.info = t.info;
    const old = this.geo;
    this.geo = g;
    this.attach();
    if (old) old.dispose();
  }
  attach() {
    const m = this.mesh;
    if (!m || m.geometry === this.geo) return;
    const hadMorph = !!(m.geometry.morphAttributes && m.geometry.morphAttributes.position);
    if (!m.userData.glb) m.userData.glb = m.geometry;   // the asset's own (kept: shirt / hoodie never use the cloth)
    m.geometry = this.geo;
    m.morphTargetInfluences = undefined; m.morphTargetDictionary = undefined;
    // the skin weights are copied from the body: bones numbered as the body's skeleton numbers them
    const body = this.A.meshes.body;
    if (m.skeleton !== body.skeleton) m.bind(body.skeleton, body.bindMatrix);
    if (hadMorph || m.material.map) { m.material.map = null; m.material.needsUpdate = true; }
    this.skin();
  }
  // each point moves with the bones of the surface under it: the body's, or where it hangs over the bottom, the
  // bottom's (so in any pose the two move together). Weights are blended from every surface point nearly as near
  // and then smoothed across the cloth, so neighbouring points never follow different bones and fold through.
  skin(full = false) {
    const g = this.geo, m = this.mesh;
    if (!g || !m) return;
    const nb = this.A.meshes.body.skeleton.bones.length, map = this.map, nP = map.reduce((a, q) => Math.max(a, q), -1) + 1;
    const srcs = [{ grid: this.bodyGrid, geo: this.A.meshes.body.geometry }];
    const bm = this.botMesh;
    if (bm) {
      if (!this.botGrid || this.botGrid.mesh !== bm) this.botGrid = { mesh: bm, ...grid(bm.geometry.attributes.position) };
      srcs.push({ grid: this.botGrid, geo: bm.geometry });
    }
    const P = g.attributes.position, rep = new Int32Array(nP).fill(-1);
    for (let i = 0; i < map.length; i++) if (rep[map[i]] < 0) rep[map[i]] = i;
    let W = new Float32Array(nP * nb);
    for (let q = 0; q < nP; q++) {
      const i = rep[q];
      if (i < 0) continue;
      const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
      let d0 = 1e9;
      for (const s of srcs) { const j = s.grid.nearest(x, y, z); if (j >= 0) { const SP = s.geo.attributes.position; d0 = Math.min(d0, Math.hypot(SP.getX(j) - x, SP.getY(j) - y, SP.getZ(j) - z)); } }
      if (d0 > 1e8) continue;
      const r = full ? d0 + .012 : d0 + 1e-6;   // while the shape changes: the nearest point only (fast)
      for (const s of srcs) {
        const SP = s.geo.attributes.position, SI = s.geo.attributes.skinIndex, SW = s.geo.attributes.skinWeight;
        s.grid.within(x, y, z, r, (j, d) => {
          const w = 1 / (d + .004) ** 2;
          for (let k = 0; k < 4; k++) { const wt = SW.getComponent(j, k); if (wt) W[q * nb + SI.getComponent(j, k)] += wt * w; }
        });
      }
    }
    // smooth over the cloth's own connections (seams included: one particle each)
    const I = g.index.array, adj = Array.from({ length: nP }, () => new Set());
    for (let t = 0; t < I.length; t += 3) {
      const a = map[I[t]], b = map[I[t + 1]], c = map[I[t + 2]];
      adj[a].add(b).add(c); adj[b].add(a).add(c); adj[c].add(a).add(b);
    }
    const A = adj.map(s => [...s]);
    const norm = q => { let s = 0; for (let k = 0; k < nb; k++) s += W[q * nb + k]; if (s > 0) for (let k = 0; k < nb; k++) W[q * nb + k] /= s; };
    for (let q = 0; q < nP; q++) norm(q);
    for (let it = 0; it < 6; it++) {
      const W2 = new Float32Array(W.length);
      for (let q = 0; q < nP; q++) {
        const a = A[q], o = q * nb;
        for (let k = 0; k < nb; k++) W2[o + k] = W[o + k] * .5;
        if (!a.length) { for (let k = 0; k < nb; k++) W2[o + k] = W[o + k]; continue; }
        const f = .5 / a.length;
        for (const u of a) for (let k = 0; k < nb; k++) W2[o + k] += W[u * nb + k] * f;
      }
      W = W2;
    }
    // the four strongest bones per point
    const SI = g.attributes.skinIndex, SW = g.attributes.skinWeight, top = [];
    for (let i = 0; i < map.length; i++) {
      const o = map[i] * nb;
      top.length = 0;
      for (let k = 0; k < nb; k++) if (W[o + k] > 1e-4) top.push(k);
      top.sort((p, q) => W[o + q] - W[o + p]);
      let s = 0;
      for (let k = 0; k < 4 && k < top.length; k++) s += W[o + top[k]];
      for (let k = 0; k < 4; k++) {
        const b = top[k];
        SI.setComponent(i, k, b ?? 0); SW.setComponent(i, k, b == null || !s ? (k === 0 && !s ? 1 : 0) : W[o + b] / s);
      }
    }
    SI.needsUpdate = SW.needsUpdate = true;
  }
}

// nearest-vertex lookup on a uniform grid (3 cm cells)
function grid(P) {
  const cs = .03, cells = new Map(), key = (a, b, c) => ((a + 300) * 600 + (b + 300)) * 600 + (c + 300);
  for (let i = 0; i < P.count; i++) {
    const k = key(Math.floor(P.getX(i) / cs), Math.floor(P.getY(i) / cs), Math.floor(P.getZ(i) / cs));
    let c = cells.get(k); if (!c) cells.set(k, c = []); c.push(i);
  }
  return {
    nearest(x, y, z) {
      const gx = Math.floor(x / cs), gy = Math.floor(y / cs), gz = Math.floor(z / cs);
      let best = 1e9, bj = -1;
      for (let r = 1; r <= 4 && bj < 0; r++)
        for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) for (let c = -r; c <= r; c++) {
          const L = cells.get(key(gx + a, gy + b, gz + c));
          if (L) for (const j of L) { const d = (P.getX(j) - x) ** 2 + (P.getY(j) - y) ** 2 + (P.getZ(j) - z) ** 2; if (d < best) { best = d; bj = j; } }
        }
      return bj;
    },
    // every point within r, with its distance
    within(x, y, z, r, f) {
      const n = Math.ceil(r / cs), gx = Math.floor(x / cs), gy = Math.floor(y / cs), gz = Math.floor(z / cs), r2 = r * r;
      for (let a = -n; a <= n; a++) for (let b = -n; b <= n; b++) for (let c = -n; c <= n; c++) {
        const L = cells.get(key(gx + a, gy + b, gz + c));
        if (L) for (const j of L) { const d = (P.getX(j) - x) ** 2 + (P.getY(j) - y) ** 2 + (P.getZ(j) - z) ** 2; if (d <= r2) f(j, Math.sqrt(d)); }
      }
    },
  };
}
