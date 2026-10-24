// Cloth worker: sews the pattern (pattern.js) into one piece of cloth round the rest-pose body and lets it hang (XPBD,
// small steps). A changed pattern is re-meshed and every new point starts where the same spot of fabric was, so the
// garment moves from its old shape to the new one instead of jumping.
//   in : {t:'init', body:{pos,nrm}, bottom:{pos,nrm}|null, bones:{l:[J,E], r:[J,E]}, hps, z0}
//        {t:'params', p}      {t:'tick'}   (one frame per tick; answered with {t:'frame'})
//   out: {t:'topo', ...} when the mesh changes, {t:'frame', pos, nrm, awake, ms}
import { build, BASE, BASE_M } from './pattern.js?v=12';

const G = -9.8, SUB = 12, DT = 1 / 60, TH = 0.004;
let sdf = null, ctx = null, cloth = null, pending = null, awake = 0, calm = 0;
// the bottom worn under the top: its outer radius round a vertical axis by height and angle (the site's botTable)
let bot = null;

onmessage = e => {
  try { handle(e.data); } catch (err) { postMessage({ t: 'log', s: 'ERROR ' + err.stack }); if (e.data.t === 'tick') postMessage({ t: 'frame', pos: null }); }
};
function handle(m) {
  if (m.t === 'init') {   // (again for another body: the cloth starts over round it)
    ctx = m; cloth = null; bot = null;
    const t0 = performance.now();
    useSDF(buildSDF(m.body, m.bottom, m.bones));
    ctx.axis = { l: armAxis(m.body.pos, m.bones.l), r: armAxis(m.body.pos, m.bones.r) };
    postMessage({ t: 'log', s: `sdf ${(performance.now() - t0).toFixed(0)} ms, ${sdf.nx}×${sdf.ny}×${sdf.nz}` });
  } else if (m.t === 'params') pending = m.p;
  else if (m.t === 'bottom') { bot = m.tab && hull(m.tab); awake = 1; calm = 0; }
  else if (m.t === 'tick') tick(m.hold);
  else if (m.t === 'probe') {   // test: field values across the arm at a few points down its centre line
    const out = [];
    for (const a of ctx.axis.l.filter((_, i) => i % 3 === 0)) {
      const row = [];
      for (let o = -0.07; o <= 0.0701; o += 0.01) row.push(sample(a.c[0], a.c[1] + o, a.c[2]).toFixed(3));
      out.push(a.s.toFixed(2) + ' r' + a.r.toFixed(3) + ' : ' + row.join(' '));
    }
    postMessage({ t: 'log', s: 'probe | ' + out.join(' | ') });
  }
}

function tick(m0) {
  const t0 = performance.now();
  if (pending && sdf) {
    const p = pending; pending = null;
    cloth = assemble(build(p), cloth);
    cloth.stretch = p.stretch || 0;
    postTopo();
    awake = 1; calm = 0;
  }
  if (!cloth) { postMessage({ t: 'frame', pos: null }); return; }
  if (awake && !m0) {
    // still = all but a few particles (one caught where the body and the bottom meet can tremble for ever, unseen)
    const moving = step(cloth);
    calm = moving <= Math.max(4, cloth.nP * .002) ? calm + 1 : 0;
    if (calm > 20) awake = 0;
  }
  const pos = cloth.p.slice(), nrm = normals(cloth), { cl, cn } = toBody(cloth);
  postMessage({ t: 'frame', pos, nrm, cl, cn, awake, ms: performance.now() - t0 }, [pos.buffer, nrm.buffer, cl.buffer, cn.buffer]);
}

/* ---------- collision field: signed distance to the body (and the bottom worn under the top) ---------- */
function buildSDF(body, bottom, bones) {
  const h = 0.008, B = body.pos;
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (let i = 0; i < B.length; i += 3) {
    if (B[i + 1] < 0.3) continue;
    x0 = Math.min(x0, B[i]); x1 = Math.max(x1, B[i]); y0 = Math.min(y0, B[i + 1]); y1 = Math.max(y1, B[i + 1]); z0 = Math.min(z0, B[i + 2]); z1 = Math.max(z1, B[i + 2]);
  }
  const pad = 0.06;
  x0 -= pad; x1 += pad; y0 -= pad; y1 += pad; z0 -= pad; z1 += pad;
  const nx = Math.ceil((x1 - x0) / h) + 1, ny = Math.ceil((y1 - y0) / h) + 1, nz = Math.ceil((z1 - z0) / h) + 1;
  const N = nx * ny * nz, val = new Float32Array(N), best = new Float32Array(N).fill(Infinity);
  const splat = (S, R, d2, v) => {
    const P = S.pos, Nn = S.nrm;
    for (let i = 0; i < P.length; i += 3) {
      const px = P[i], py = P[i + 1], pz = P[i + 2];
      const cx = Math.round((px - x0) / h), cy = Math.round((py - y0) / h), cz = Math.round((pz - z0) / h);
      for (let k = Math.max(0, cz - R); k <= Math.min(nz - 1, cz + R); k++)
        for (let j = Math.max(0, cy - R); j <= Math.min(ny - 1, cy + R); j++)
          for (let q = Math.max(0, cx - R); q <= Math.min(nx - 1, cx + R); q++) {
            const dx = x0 + q * h - px, dy = y0 + j * h - py, dz = z0 + k * h - pz, dd = dx * dx + dy * dy + dz * dz;
            const id = (k * ny + j) * nx + q;
            if (dd < d2[id]) { d2[id] = dd; v[id] = dx * Nn[i] + dy * Nn[i + 1] + dz * Nn[i + 2]; }
          }
    }
  };
  splat(body, 3, best, val);
  // outside the thin band: flood from the box's walls is outside, the rest is inside the body
  const out = new Uint8Array(N), stack = [];
  const push = id => { if (!out[id] && best[id] === Infinity) { out[id] = 1; stack.push(id); } };
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let q = 0; q < nx; q++)
    if (k === 0 || j === 0 || q === 0 || k === nz - 1 || j === ny - 1 || q === nx - 1) push((k * ny + j) * nx + q);
  while (stack.length) {
    const id = stack.pop(), q = id % nx, j = ((id - q) / nx) % ny, k = (id - q - j * nx) / (nx * ny);
    if (q > 0) push(id - 1); if (q < nx - 1) push(id + 1);
    if (j > 0) push(id - nx); if (j < ny - 1) push(id + nx);
    if (k > 0) push(id - nx * ny); if (k < nz - 1) push(id + nx * ny);
  }
  // beyond the band: distance in steps from it (breadth first), so even deep inside there is a way out
  const layer = new Int32Array(N).fill(-1);
  let front = [];
  for (let i = 0; i < N; i++) if (best[i] !== Infinity) { layer[i] = 0; front.push(i); }
  const R = 3 * h;
  for (let L = 1; front.length; L++) {
    const nxt = [];
    for (const id of front) {
      const q = id % nx, j = ((id - q) / nx) % ny;
      const k = (id - q - j * nx) / (nx * ny);
      const nb = [q > 0 ? id - 1 : -1, q < nx - 1 ? id + 1 : -1, j > 0 ? id - nx : -1, j < ny - 1 ? id + nx : -1, k > 0 ? id - nx * ny : -1, k < nz - 1 ? id + nx * ny : -1];
      for (const b of nb) if (b >= 0 && layer[b] < 0) { layer[b] = L; val[b] = (out[b] ? 1 : -1) * (R + L * h); nxt.push(b); }
    }
    front = nxt;
  }
  for (const k of ['l', 'r']) HAND[k] = mitten(val, B, bones[k], { nx, ny, nz, h, x0, y0, z0 });
  if (bottom) {   // an open shell: only near its surface
    const b2 = new Float32Array(N).fill(Infinity), bv = new Float32Array(N);
    splat(bottom, 3, b2, bv);
    for (let i = 0; i < N; i++) if (b2[i] !== Infinity) val[i] = Math.min(val[i], bv[i]);
  }
  return { val, nx, ny, nz, h, x0, y0, z0 };
}
// each hand as a mitten: across the hand, slice by slice, the field is that of the slice's convex outline, so a sleeve
// over the hand slides round it instead of catching between the fingers (and the fingers poking through the cloth).
// The outlines are kept (HAND.l / .r) to lay a sleeve round the hand.
const HAND = {};
function mitten(val, B, [, E, W], g) {
  const { nx, ny, nz, h, x0, y0, z0 } = g;
  const fl = Math.hypot(W[0] - E[0], W[1] - E[1], W[2] - E[2]), d = [0, 1, 2].map(k => (W[k] - E[k]) / fl);
  let u = [d[1], -d[0], 0];
  const ul = Math.hypot(...u); u = u.map(c => c / ul);
  const v = [d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]];
  // the hand's vertices by slice along the forearm's line on past the wrist
  const A0 = 0, A1 = 0.24, n = Math.ceil((A1 - A0) / h), sl = Array.from({ length: n }, () => []);
  for (let i = 0; i < B.length; i += 3) {
    const rx = B[i] - W[0], ry = B[i + 1] - W[1], rz = B[i + 2] - W[2], a = rx * d[0] + ry * d[1] + rz * d[2];
    if (a < A0 || a >= A1) continue;
    const pu = rx * u[0] + ry * u[1] + rz * u[2], pv = rx * v[0] + ry * v[1] + rz * v[2];
    if (pu * pu + pv * pv > 0.12 * 0.12) continue;
    sl[Math.floor((a - A0) / h)].push([pu, pv]);
  }
  const hulls = sl.map(pts => pts.length >= 3 ? hull2(pts) : null);
  let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (let i = 0; i < B.length; i += 3) {
    const rx = B[i] - W[0], ry = B[i + 1] - W[1], rz = B[i + 2] - W[2], a = rx * d[0] + ry * d[1] + rz * d[2];
    if (a < A0 - h || a >= A1 || rx * rx + ry * ry + rz * rz - a * a > 0.12 * 0.12) continue;
    for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], B[i + k]); hi[k] = Math.max(hi[k], B[i + k]); }
  }
  if (lo[0] > hi[0]) return null;
  const pad = 0.03, c0 = [0, 1, 2].map(k => lo[k] - pad), c1 = [0, 1, 2].map(k => hi[k] + pad);
  const gx0 = Math.max(0, Math.floor((c0[0] - x0) / h)), gx1 = Math.min(nx - 1, Math.ceil((c1[0] - x0) / h));
  const gy0 = Math.max(0, Math.floor((c0[1] - y0) / h)), gy1 = Math.min(ny - 1, Math.ceil((c1[1] - y0) / h));
  const gz0 = Math.max(0, Math.floor((c0[2] - z0) / h)), gz1 = Math.min(nz - 1, Math.ceil((c1[2] - z0) / h));
  for (let k = gz0; k <= gz1; k++) for (let j = gy0; j <= gy1; j++) for (let q = gx0; q <= gx1; q++) {
    const rx = x0 + q * h - W[0], ry = y0 + j * h - W[1], rz = z0 + k * h - W[2], a = rx * d[0] + ry * d[1] + rz * d[2];
    const hl = a >= A0 && a < A1 && hulls[Math.floor((a - A0) / h)];
    if (!hl) continue;
    // a little fuller than the outline: the smoothing below rounds it in, and the thumb would show through the cloth
    const dd = polyDist(hl, rx * u[0] + ry * u[1] + rz * u[2], rx * v[0] + ry * v[1] + rz * v[2]) - 0.012, id = (k * ny + j) * nx + q;
    if (dd < val[id]) val[id] = dd;
  }
  // smoothed (the slices step from one outline to the next; cloth sliding over the steps never comes to rest)
  const bx = gx1 - gx0 + 1, by = gy1 - gy0 + 1, bz = gz1 - gz0 + 1, tmp = new Float32Array(bx * by * bz);
  for (let pass = 0; pass < 2; pass++) {
    for (let k = 0; k < bz; k++) for (let j = 0; j < by; j++) for (let q = 0; q < bx; q++) {
      let sum = 0, cnt = 0;
      for (let c = -1; c <= 1; c++) for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) {
        const K = gz0 + k + c, J = gy0 + j + b, Q = gx0 + q + a;
        if (K < 0 || J < 0 || Q < 0 || K >= nz || J >= ny || Q >= nx) continue;
        sum += val[(K * ny + J) * nx + Q]; cnt++;
      }
      tmp[(k * by + j) * bx + q] = sum / cnt;
    }
    for (let k = 0; k < bz; k++) for (let j = 0; j < by; j++) for (let q = 0; q < bx; q++) val[((gz0 + k) * ny + gy0 + j) * nx + gx0 + q] = tmp[(k * by + j) * bx + q];
  }
  return { W, d, u, v, A0, h, hulls };
}
// from a point inside a convex polygon, how far along (dx, dy) to its outline
function rayOut(H, x, y, dx, dy) {
  let best = 1e9;
  for (let i = 0; i < H.length; i++) {
    const a = H[i], b = H[(i + 1) % H.length], ex = b[0] - a[0], ey = b[1] - a[1], den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((a[0] - x) * ey - (a[1] - y) * ex) / den, s = ((a[0] - x) * dy - (a[1] - y) * dx) / den;
    if (t > 0 && s >= 0 && s <= 1) best = Math.min(best, t);
  }
  return best < 1e9 ? best : 0;
}
function hull2(pts) {   // convex hull, counter-clockwise (monotone chain)
  pts.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]), lo = [], up = [];
  for (const p of pts) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
function polyDist(H, x, y) {   // signed distance to a convex polygon (CCW), negative inside
  let out = -1e9, edge = 1e9;
  for (let i = 0; i < H.length; i++) {
    const a = H[i], b = H[(i + 1) % H.length], ex = b[0] - a[0], ey = b[1] - a[1], el = Math.hypot(ex, ey) || 1e-9;
    out = Math.max(out, ((x - a[0]) * ey - (y - a[1]) * ex) / el);   // > 0 outside this edge
    const t = Math.max(0, Math.min(1, ((x - a[0]) * ex + (y - a[1]) * ey) / (el * el)));
    edge = Math.min(edge, Math.hypot(a[0] + ex * t - x, a[1] + ey * t - y));
  }
  return out > 0 ? edge : out;
}
// the field's grid, kept in plain variables (the hot path reads them millions of times a second)
let SV, SNX, SNY, SNZ, SH, SX0, SY0, SZ0;
function useSDF(f) { sdf = f; SV = f.val; SNX = f.nx; SNY = f.ny; SNZ = f.nz; SH = f.h; SX0 = f.x0; SY0 = f.y0; SZ0 = f.z0; }
function sample(x, y, z) {
  let fx = (x - SX0) / SH, fy = (y - SY0) / SH, fz = (z - SZ0) / SH;
  if (fx < 0 || fy < 0 || fz < 0 || fx >= SNX - 1 || fy >= SNY - 1 || fz >= SNZ - 1) return 0.1;
  const ix = fx | 0, iy = fy | 0, iz = fz | 0;
  fx -= ix; fy -= iy; fz -= iz;
  const val = SV, i = (iz * SNY + iy) * SNX + ix, sy = SNX, sz = SNX * SNY;
  const c00 = val[i] + (val[i + 1] - val[i]) * fx, c10 = val[i + sy] + (val[i + sy + 1] - val[i + sy]) * fx;
  const c01 = val[i + sz] + (val[i + sz + 1] - val[i + sz]) * fx, c11 = val[i + sz + sy] + (val[i + sz + sy + 1] - val[i + sz + sy]) * fx;
  const c0 = c00 + (c10 - c00) * fy, c1 = c01 + (c11 - c01) * fy;
  return c0 + (c1 - c0) * fz;
}
const GR = [0, 0, 0];
function grad(x, y, z) {
  const e = SH * .5;
  GR[0] = sample(x + e, y, z) - sample(x - e, y, z);
  GR[1] = sample(x, y + e, z) - sample(x, y - e, z);
  GR[2] = sample(x, y, z + e) - sample(x, y, z - e);
  const l = Math.hypot(GR[0], GR[1], GR[2]) || 1;
  GR[0] /= l; GR[1] /= l; GR[2] /= l;
  return GR;
}

/* ---------- the pattern sewn into one cloth ---------- */
function assemble(g, old) {
  const pieces = g.pieces, off = {};
  let nV = 0;
  for (const pc of pieces) { off[pc.name] = nV; pc.off = nV; nV += pc.pts.length; }
  const byName = Object.fromEntries(pieces.map(p => [p.name, p]));
  // weld every sewn pair into one particle
  const par = new Int32Array(nV).map((_, i) => i);
  const find = i => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; };
  const seamOf = new Uint8Array(nV);
  for (const [kind, [pa, sa], [pb, sb]] of g.seams) {
    const A = byName[pa].bound[sa], Bb = byName[pb].bound[sb];
    if (!A || !Bb || A.length !== Bb.length) { postMessage({ t: 'log', s: `seam ${pa}.${sa}/${pb}.${sb} ${A && A.length} ≠ ${Bb && Bb.length}` }); continue; }
    for (let i = 0; i < A.length; i++) {
      const a = A[i] + off[pa], b = Bb[i] + off[pb];
      seamOf[a] = seamOf[b] = kind;
      const ra = find(a), rb = find(b);
      if (ra !== rb) par[rb] = ra;
    }
  }
  const map = new Int32Array(nV), ids = new Map();
  for (let i = 0; i < nV; i++) { const r = find(i); if (!ids.has(r)) ids.set(r, ids.size); map[i] = ids.get(r); }
  const nP = ids.size;
  // display data: the flat pattern is the UV (m, pieces side by side), piece id per vertex
  const uv = new Float32Array(nV * 2), pcA = new Float32Array(nV), flat = new Float32Array(nV * 2);
  const shift = [0, 0.7, 1.4, 1.9];
  for (const pc of pieces) pc.pts.forEach((p, i) => {
    const v = pc.off + i;
    flat[v * 2] = p[0] / 100; flat[v * 2 + 1] = p[1] / 100;
    uv[v * 2] = p[0] / 100 + shift[pc.pc]; uv[v * 2 + 1] = p[1] / 100; pcA[v] = pc.pc;
  });

  // start positions: where that spot of fabric was (old cloth), else the first placement round the body
  const pos = new Float32Array(nP * 3), cnt = new Float32Array(nP), fresh = new Float32Array(nP * 3), fcnt = new Float32Array(nP);
  // a big jump in width (a card, not a drag) lays the body out afresh: squeezed into the old places the extra cloth
  // buckles into a fold at the side seam that friction then holds
  let jump = 0;
  if (old) for (let yd = 0; yd <= g.info.P.L; yd += 4) jump = Math.max(jump, Math.abs(halfOf(g.info.P, yd) - halfOf(old.info.P, yd)));
  for (const pc of pieces) {
    const o = old && !(jump > 2.5 && pc.pc < 2) && old.pieces.find(q => q.name === pc.name);
    const loc = o ? locator(o, old) : null;
    pc.pts.forEach((p0, i) => {
      const v = pc.off + i, q = map[v];
      // a panel made wider or narrower is looked up across the old one in proportion (side seam on side seam);
      // stepped out past the old side, front and back would cross there and leave a fold the cloth can't undo
      const p = o && pc.pc < 2 ? [p0[0] * halfOf(old.info.P, -p0[1]) / halfOf(g.info.P, -p0[1]), p0[1]] : p0;
      // sleeve past the wrist is laid round the hand afresh each time: carried on from the old cloth (an end hanging
      // below the hand, or caught on the thumb) the hand would come out through the sleeve
      const hand = pc.pc >= 2 && -p0[1] > g.info.sleeve[pc.pc === 2 ? 'knotsL' : 'knotsR'][2][0];
      let w = !hand && loc && loc(p[0], p[1]);
      if (!w && loc && !hand) {
        const k = loc.nearest(p[0], p[1]);
        if (k >= 0) {
          const a = place(pc, p, g.info), b = place(pc, o.pts[k], g.info), q0 = old.map[o.off + k] * 3;
          w = [old.p[q0] + a[0] - b[0], old.p[q0 + 1] + a[1] - b[1], old.p[q0 + 2] + a[2] - b[2]];
        }
      }
      if (w) { pos[q * 3] += w[0]; pos[q * 3 + 1] += w[1]; pos[q * 3 + 2] += w[2]; cnt[q]++; }
      else { const f = place(pc, p0, g.info); fresh[q * 3] += f[0]; fresh[q * 3 + 1] += f[1]; fresh[q * 3 + 2] += f[2]; fcnt[q]++; }
    });
  }
  for (let q = 0; q < nP; q++) for (let k = 0; k < 3; k++) pos[q * 3 + k] = cnt[q] ? pos[q * 3 + k] / cnt[q] : fresh[q * 3 + k] / fcnt[q];

  // triangles (display vertices) and their particle versions; each piece wound so its normal faces away from the body
  const index = [];
  for (const pc of pieces) {
    let s = 0;
    const T = pc.tris;
    for (let t = 0; t < T.length; t += 3) {
      const a = map[T[t] + pc.off], b = map[T[t + 1] + pc.off], c = map[T[t + 2] + pc.off];
      const n = triN(pos, a, b, c), cx = (pos[a * 3] + pos[b * 3] + pos[c * 3]) / 3, cy = (pos[a * 3 + 1] + pos[b * 3 + 1] + pos[c * 3 + 1]) / 3, cz = (pos[a * 3 + 2] + pos[b * 3 + 2] + pos[c * 3 + 2]) / 3;
      // outward = away from the torso's axis (panels) or the arm's axis (sleeves)
      let ox = cx, oy = 0, oz = cz - ctx.z0;
      if (pc.pc >= 2) {
        const [J, E] = pc.pc === 2 ? ctx.bones.l : ctx.bones.r, ax = E[0] - J[0], ay = E[1] - J[1], az = E[2] - J[2], al = ax * ax + ay * ay + az * az;
        const k = ((cx - J[0]) * ax + (cy - J[1]) * ay + (cz - J[2]) * az) / al;
        ox = cx - J[0] - ax * k; oy = cy - J[1] - ay * k; oz = cz - J[2] - az * k;
      }
      s += Math.sign(n[0] * ox + n[1] * oy + n[2] * oz);
    }
    const flip = old && old.flip[pc.name] !== undefined ? old.flip[pc.name] : s < 0;
    pc.flip = flip;
    for (let t = 0; t < T.length; t += 3) {
      const a = T[t] + pc.off, b = T[t + 1] + pc.off, c = T[t + 2] + pc.off;
      if (flip) index.push(a, c, b); else index.push(a, b, c);
    }
  }
  const ptri = new Int32Array(index.length);
  for (let i = 0; i < index.length; i++) ptri[i] = map[index[i]];

  // constraints: every edge keeps its pattern length; across every edge, the two far corners keep the distance they
  // have when the two triangles lie flat (bending, seams included)
  const edges = new Map(), hinge = new Map();
  const key = (a, b) => a < b ? a * nP + b : b * nP + a;
  for (let t = 0; t < index.length; t += 3) {
    const v = [index[t], index[t + 1], index[t + 2]];
    for (let e = 0; e < 3; e++) {
      const i = v[e], j = v[(e + 1) % 3], k = v[(e + 2) % 3];
      const pi = map[i], pj = map[j], pk = map[k];
      if (pi === pj) continue;
      const kk = key(pi, pj);
      const L = Math.hypot(flat[i * 2] - flat[j * 2], flat[i * 2 + 1] - flat[j * 2 + 1]);
      // how much the edge runs across the grain (round the body / arm): a knit gives that way, hardly at all lengthwise
      const wx = ((flat[i * 2] - flat[j * 2]) / (L || 1e-9)) ** 2;
      if (!edges.has(kk)) edges.set(kk, [pi, pj, L, 1, wx]); else { const E = edges.get(kk); E[2] += L; E[3]++; E[4] += wx; }
      // far corner k relative to the edge i→j (canonical direction: lower particle id first)
      const [ia, ib] = pi < pj ? [i, j] : [j, i];
      const ex = flat[ib * 2] - flat[ia * 2], ey = flat[ib * 2 + 1] - flat[ia * 2 + 1], el = Math.hypot(ex, ey) || 1e-9;
      const kx = flat[k * 2] - flat[ia * 2], ky = flat[k * 2 + 1] - flat[ia * 2 + 1];
      const s = (kx * ex + ky * ey) / el, hgt = Math.abs(kx * ey - ky * ex) / el;
      if (!hinge.has(kk)) hinge.set(kk, []);
      hinge.get(kk).push([pk, s, hgt]);
    }
  }
  const nE = edges.size, ec = new Int32Array(nE * 2), er = new Float32Array(nE), ew = new Float32Array(nE);
  let i = 0;
  for (const [a, b, L, n, wx] of edges.values()) { ec[i * 2] = a; ec[i * 2 + 1] = b; er[i] = L / n; ew[i] = wx / n; i++; }
  const bl = [];
  for (const hs of hinge.values()) if (hs.length === 2 && hs[0][0] !== hs[1][0]) bl.push(hs[0][0], hs[1][0], Math.hypot(hs[0][2] + hs[1][2], hs[0][1] - hs[1][1]));
  const nB = bl.length / 3, bc = new Int32Array(nB * 2), br = new Float32Array(nB);
  for (let k = 0; k < nB; k++) { bc[k * 2] = bl[k * 3]; bc[k * 2 + 1] = bl[k * 3 + 1]; br[k] = bl[k * 3 + 2]; }

  return {
    marks: marks(pieces),
    pieces: pieces.map(pc => ({ name: pc.name, pc: pc.pc, pts: pc.pts, tris: pc.tris, off: pc.off })),
    flip: Object.fromEntries(pieces.map(pc => [pc.name, pc.flip])),
    nV, nP, map, uv, pcA, seamOf, index: new Uint32Array(index), ptri,
    p: pos, v: new Float32Array(nP * 3), q: new Float32Array(nP * 3),
    ec, er, ew, bc, br, info: g.info,
  };
}

// where a pattern point (cm) of an old piece sits now: inside one of its triangles, or carried on past the nearest one
function locator(o, old) {
  const P = o.pts, T = o.tris, cell = 4, grid = new Map();
  const vp = i => { const q = old.map[o.off + i] * 3; return [old.p[q], old.p[q + 1], old.p[q + 2]]; };
  for (let t = 0; t < T.length; t += 3) {
    const a = P[T[t]], b = P[T[t + 1]], c = P[T[t + 2]];
    const gx0 = Math.floor(Math.min(a[0], b[0], c[0]) / cell), gx1 = Math.floor(Math.max(a[0], b[0], c[0]) / cell);
    const gy0 = Math.floor(Math.min(a[1], b[1], c[1]) / cell), gy1 = Math.floor(Math.max(a[1], b[1], c[1]) / cell);
    for (let gx = gx0; gx <= gx1; gx++) for (let gy = gy0; gy <= gy1; gy++) {
      const k = gx + ',' + gy;
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(t);
    }
  }
  const bary = (t, x, y) => {
    const a = P[T[t]], b = P[T[t + 1]], c = P[T[t + 2]];
    const d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
    if (Math.abs(d) < 1e-12) return null;
    const l1 = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / d;
    const l2 = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / d;
    return [l1, l2, 1 - l1 - l2];
  };
  const blend = (t, l) => {
    const A = vp(T[t]), B = vp(T[t + 1]), C = vp(T[t + 2]);
    return [A[0] * l[0] + B[0] * l[1] + C[0] * l[2], A[1] * l[0] + B[1] * l[1] + C[1] * l[2], A[2] * l[0] + B[2] * l[1] + C[2] * l[2]];
  };
  const f = (x, y) => {
    const gx = Math.floor(x / cell), gy = Math.floor(y / cell);
    for (const t of grid.get(gx + ',' + gy) || []) {
      const l = bary(t, x, y);
      if (l && l[0] > -1e-4 && l[1] > -1e-4 && l[2] > -1e-4) return blend(t, l);
    }
    return null;
  };
  // nearest old vertex (pattern cm), searched outward cell by cell
  const vg = new Map();
  P.forEach((p, i) => { const k = Math.floor(p[0] / cell) + ',' + Math.floor(p[1] / cell); if (!vg.has(k)) vg.set(k, []); vg.get(k).push(i); });
  f.nearest = (x, y) => {
    const gx = Math.floor(x / cell), gy = Math.floor(y / cell);
    let bi = -1, bd = 1e9;
    for (let r = 0; r <= 40; r++) {
      for (let ix = gx - r; ix <= gx + r; ix++) for (let iy = gy - r; iy <= gy + r; iy++) {
        if (Math.max(Math.abs(ix - gx), Math.abs(iy - gy)) !== r) continue;
        for (const i of vg.get(ix + ',' + iy) || []) { const d = Math.hypot(P[i][0] - x, P[i][1] - y); if (d < bd) { bd = d; bi = i; } }
      }
      if (bi >= 0 && bd < (r - 1) * cell) break;
    }
    return bi;
  };
  return f;
}

// first placement: panels wrapped round an ellipse about the torso, sleeves as tubes round the upper arms
// a body panel's half width (cm) at depth yd below the high shoulder point (without the waist shaping)
function halfOf(P, yd) {
  return yd <= P.ad ? P.cw : P.cw + (P.hw - P.cw) * Math.min(1, (yd - P.ad) / Math.max(1, P.L - P.ad));
}
function place(pc, p, gi) {
  const { hps, z0, bones } = ctx;
  const lift = 0.02;
  if (pc.pc < 2) {
    const front = pc.pc === 0, y = hps + p[1] / 100 + lift, hz = -p[1] / 100;
    // the ellipse's quarter round is the panel's own half width there, so front and back side seams start together
    // at the side (started apart they slide past each other and leave a fold the cloth can't undo)
    const P = gi.P, yd = -p[1];
    // a fitted knit smaller than the body starts round the regular tee's ellipse, stretched, and draws itself in
    // (started round its own smaller ellipse it would begin inside the body)
    const B0 = P.base === 'm' ? BASE_M : BASE, own = halfOf(P, yd) / 100, half = Math.max(own, halfOf({ ...P, cw: B0.cw, hw: B0.hw }, yd) / 100), spread = half / own;
    const ratio = (0.11 + 0.065 * Math.min(1, hz / 0.18)) / (0.205 + 0.045 * Math.min(1, hz / 0.25));
    const Q = Math.PI / 4 * (3 * (1 + ratio) - Math.sqrt((3 + ratio) * (1 + 3 * ratio)));   // Ramanujan, for a = 1
    const a = half / Q, b = a * ratio;
    const arc = Math.abs(p[0] / 100) * spread;
    let th = 0, acc = 0;
    const d = 0.004;
    while (acc < arc && th < Math.PI) {
      acc += Math.hypot(a * (Math.sin(th + d) - Math.sin(th)), b * (Math.cos(th + d) - Math.cos(th)));
      th += d;
    }
    const x = Math.sign(p[0]) * a * Math.sin(th), z = b * Math.cos(th);
    return [x, y, front ? z0 + z : z0 - z];
  }
  const axis = pc.pc === 2 ? ctx.axis.l : ctx.axis.r;
  const kn = gi.sleeve ? gi.sleeve[pc.pc === 2 ? 'knotsL' : 'knotsR'] : [[10, 18], [20, 16.8], [58, 11.5], [64, 19]];
  const y = -p[1];
  let hw = kn[kn.length - 1][1];
  if (y <= kn[0][0]) hw = kn[0][1];
  else for (let i = 1; i < kn.length; i++) if (y <= kn[i][0]) { hw = kn[i - 1][1] + (kn[i][1] - kn[i - 1][1]) * (y - kn[i - 1][0]) / (kn[i][0] - kn[i - 1][0]); break; }
  // the arm's own centre line, from the shoulder joint on down: the cap runs from where the shoulder seam ends to where
  // the body's underarm sits (far down the arm for a wide, dropped armhole), then the sleeve on at its own length, back
  // onto its usual place by the wrist (past it the sleeve is laid round the hand)
  const [aO, aU] = capAlong(pc.pc === 2 ? 1 : -1, gi, axis), ch = gi.sleeve ? gi.sleeve.ch : 10, yw = kn[2][0];
  const along = y <= ch ? aO + (aU - aO) * y / ch
    : y < yw ? aU + (y - ch) / 100 - (aU - 0.015 - ch / 100) * (y - ch) / Math.max(1, yw - ch) : 0.015 + y / 100;
  let k = 1;
  while (k < axis.length - 1 && axis[k].s < along) k++;
  const A0 = axis[k - 1], A1 = axis[k], tt = (along - A0.s) / Math.max(1e-6, A1.s - A0.s);
  const c = [A0.c[0] + (A1.c[0] - A0.c[0]) * tt, A0.c[1] + (A1.c[1] - A0.c[1]) * tt, A0.c[2] + (A1.c[2] - A0.c[2]) * tt];
  let ax = A1.c[0] - A0.c[0], ay = A1.c[1] - A0.c[1], az = A1.c[2] - A0.c[2];
  const al = Math.hypot(ax, ay, az); ax /= al; ay /= al; az /= al;
  // up = world up off the arm's axis, fwd = world front off both
  let ux = -ay * ax, uy = 1 - ay * ay, uz = -ay * az;
  const ul = Math.hypot(ux, uy, uz); ux /= ul; uy /= ul; uz /= ul;
  let fx = -az * ax, fy = -az * ay, fz = 1 - az * az;
  const fu = fx * ux + fy * uy + fz * uz; fx -= fu * ux; fy -= fu * uy; fz -= fu * uz;
  const fl = Math.hypot(fx, fy, fz); fx /= fl; fy /= fl; fz /= fl;
  // the row wrapped once round, loose: well clear of the arm, the cloth pulls itself in
  const ar = A0.r + (A1.r - A0.r) * tt, phi = p[0] / hw * Math.PI, r = Math.max(ar + 0.02, 2 * hw / 100 / (2 * Math.PI) * 1.2);
  const ox = ux * Math.cos(phi) - fx * Math.sin(phi), oy = uy * Math.cos(phi) - fy * Math.sin(phi), oz = uz * Math.cos(phi) - fz * Math.sin(phi);
  // over the hand: round the hand's outline there, a little clear of it, spaced evenly along the outline (a circle clear
  // of the thumb is so much wider than the sleeve that the cloth snaps in and cuts through the thumb; spaced by angle,
  // the cloth over the thumb would start stretched apart and the thumb come through between)
  const HD = HAND[pc.pc === 2 ? 'l' : 'r'];
  if (HD) {
    const rx = c[0] - HD.W[0], ry = c[1] - HD.W[1], rz = c[2] - HD.W[2], a = rx * HD.d[0] + ry * HD.d[1] + rz * HD.d[2];
    const H = a >= HD.A0 && HD.hulls[Math.floor((a - HD.A0) / HD.h)];
    if (H) {
      const to2 = (x, y, z) => [x * HD.u[0] + y * HD.u[1] + z * HD.u[2], x * HD.v[0] + y * HD.v[1] + z * HD.v[2]];
      const d0 = to2(ux, uy, uz), d1 = to2(-fx, -fy, -fz);   // the directions of phi = 0 and phi = π/2
      const ccw = d0[0] * d1[1] - d0[1] * d1[0] > 0;
      let cu = 0, cv = 0;
      for (const q of H) { cu += q[0]; cv += q[1]; }
      cu /= H.length; cv /= H.length;
      // where phi = 0 meets the outline (edge i0, at s0 along it), then on round it by phi's share of its length
      const n = H.length, len = H.map((q, i) => Math.hypot(H[(i + 1) % n][0] - q[0], H[(i + 1) % n][1] - q[1]));
      const per = len.reduce((x, y) => x + y, 0), dl = Math.hypot(...d0) || 1, t0 = rayOut(H, cu, cv, d0[0] / dl, d0[1] / dl);
      const hx = cu + d0[0] / dl * t0, hy = cv + d0[1] / dl * t0;
      let i0 = 0, s0 = 0, bd = 1e9;
      for (let i = 0; i < n; i++) {
        const A = H[i], B = H[(i + 1) % n], ex = B[0] - A[0], ey = B[1] - A[1];
        const t = Math.max(0, Math.min(1, ((hx - A[0]) * ex + (hy - A[1]) * ey) / (len[i] * len[i] || 1e-12)));
        const dd = Math.hypot(A[0] + ex * t - hx, A[1] + ey * t - hy);
        if (dd < bd) { bd = dd; i0 = i; s0 = t * len[i]; }
      }
      const fr = ((phi / (2 * Math.PI)) % 1 + 1) % 1;
      // arc length from vertex 0 going counter-clockwise
      let base = s0;
      for (let i = 0; i < i0; i++) base += len[i];
      let at = ccw ? base + fr * per : base - fr * per;
      at = ((at % per) + per) % per;
      let i = 0;
      while (i < n - 1 && at > len[i]) { at -= len[i]; i++; }
      const A = H[i], B = H[(i + 1) % n], ex = (B[0] - A[0]) / (len[i] || 1), ey = (B[1] - A[1]) / (len[i] || 1);
      const pu = A[0] + ex * at + ey * 0.025, pv = A[1] + ey * at - ex * 0.025;   // (ey, -ex): out of a counter-clockwise outline
      return [0, 1, 2].map(k => HD.W[k] + HD.d[k] * a + HD.u[k] * pu + HD.v[k] * pv + (k === 1 ? lift : 0));
    }
  }
  return [c[0] + ox * r, c[1] + oy * r + lift, c[2] + oz * r];
}

// how far down the arm's centre line (m from the shoulder joint) the body's shoulder seam ends and its underarm sits, as
// first placed: a sleeve's cap is laid between the two. sg: +1 the left side (+x)
function capAlong(sg, gi, axis) {
  const key = sg > 0 ? 'capL' : 'capR';
  if (gi[key]) return gi[key];
  const P = gi.P, body = { pc: 0 };
  const onAxis = w => {   // nearest point of the centre line → its distance along
    let best = 1e9, s = 0;
    for (let i = 1; i < axis.length; i++) {
      const A = axis[i - 1].c, B = axis[i].c, d = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], dd = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
      const t = Math.max(0, Math.min(1, ((w[0] - A[0]) * d[0] + (w[1] - A[1]) * d[1] + (w[2] - A[2]) * d[2]) / dd));
      const e = Math.hypot(A[0] + d[0] * t - w[0], A[1] + d[1] * t - w[1], A[2] + d[2] * t - w[2]);
      if (e < best) { best = e; s = axis[i - 1].s + (axis[i].s - axis[i - 1].s) * t; }
    }
    return s;
  };
  const ch = gi.sleeve ? gi.sleeve.ch : 10;
  const aO = Math.max(0.015, onAxis(place(body, [sg * P.sw, -P.ss], gi)));
  const aU = Math.max(aO + ch / 100 * .5, onAxis(place(body, [sg * P.cw, -P.ad], gi)));
  return (gi[key] = [aO, aU]);
}

// centre line of an arm: slices across the shoulder→elbow→wrist bones, each the middle of the arm's surface there, and
// on past the wrist through the hand (a sleeve longer than the arm is laid round the hand, clear of it)
function armAxis(B, [J, E, W]) {
  const fl = Math.hypot(W[0] - E[0], W[1] - E[1], W[2] - E[2]), F = [0, 1, 2].map(k => W[k] + (W[k] - E[k]) / fl * 0.22);
  const seg = [[J, E], [E, W], [W, F]], out = [];
  let s0 = 0;
  for (const [A, C] of seg) {
    const L = Math.hypot(C[0] - A[0], C[1] - A[1], C[2] - A[2]), d = [(C[0] - A[0]) / L, (C[1] - A[1]) / L, (C[2] - A[2]) / L];
    const n = Math.max(2, Math.round(L / 0.03));
    for (let i = (out.length ? 1 : 0); i <= n; i++) {
      const t = L * i / n, p = [A[0] + d[0] * t, A[1] + d[1] * t, A[2] + d[2] * t];
      let sx = 0, sy = 0, sz = 0, cnt = 0, rr = 0;
      if (s0 + t > 0.09) {   // nearer the shoulder the slice would take in the torso
        for (let v = 0; v < B.length; v += 3) {
          const vx = B[v] - p[0], vy = B[v + 1] - p[1], vz = B[v + 2] - p[2], a = vx * d[0] + vy * d[1] + vz * d[2];
          if (Math.abs(a) > 0.006) continue;
          const ox = vx - a * d[0], oy = vy - a * d[1], oz = vz - a * d[2];
          if (ox * ox + oy * oy + oz * oz > 0.075 * 0.075) continue;
          sx += B[v]; sy += B[v + 1]; sz += B[v + 2]; cnt++;
        }
      }
      const c = cnt > 8 ? [sx / cnt, sy / cnt, sz / cnt] : p;
      if (cnt > 8) for (let v = 0; v < B.length; v += 3) {
        const vx = B[v] - c[0], vy = B[v + 1] - c[1], vz = B[v + 2] - c[2], a = vx * d[0] + vy * d[1] + vz * d[2];
        if (Math.abs(a) > 0.006) continue;
        const o2 = vx * vx + vy * vy + vz * vz - a * a;
        if (o2 < 0.075 * 0.075) rr = Math.max(rr, Math.sqrt(o2));
      }
      out.push({ c, s: s0 + t, r: rr || 0.05 });
    }
    s0 += L;
  }
  // the first slices (inside the shoulder) lean toward the measured line
  return out;
}

function triN(P, a, b, c) {
  const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
  const vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
  return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
}

/* ---------- one frame: SUB small steps, one constraint pass each ---------- */
// knit: how far a fully stretchy fabric (stretch 1, a fitted top smaller than the body) gives across the grain
const K = { stretch: 0, knit: 1.2e-5, squash: 4e-7, bend: 6e-6, damp: 2.5, fric: 0.6 };
function step(c) {
  const { p, v, q, ec, er, ew, bc, br, nP } = c, h = DT / SUB;
  const aS = K.stretch / (h * h), aK = K.knit * (c.stretch || 0) / (h * h), aC = K.squash / (h * h), aB = K.bend / (h * h);
  const damp = Math.exp(-K.damp * h);
  let moving = 0;
  for (let s = 0; s < SUB; s++) {
    for (let i = 0; i < nP; i++) {
      const k = i * 3;
      v[k + 1] += G * h;
      v[k] *= damp; v[k + 1] *= damp; v[k + 2] *= damp;
      q[k] = p[k]; q[k + 1] = p[k + 1]; q[k + 2] = p[k + 2];
      p[k] += v[k] * h; p[k + 1] += v[k + 1] * h; p[k + 2] += v[k + 2] * h;
    }
    dist(p, ec, er, aS, aC, ew, aK);
    dist(p, bc, br, aB, aB);
    dist(p, ec, er, aS, aC, ew, aK);   // a second pass on length: a thin strap carries the whole panel
    for (let i = 0; i < nP; i++) {
      const k = i * 3, x = p[k], y = p[k + 1], z = p[k + 2], d = sample(x, y, z);
      if (d < TH) {
        const n = grad(x, y, z), push = TH - d;
        p[k] += n[0] * push; p[k + 1] += n[1] * push; p[k + 2] += n[2] * push;
        // friction: hold back the sliding part of this step's motion
        const dx = p[k] - q[k], dy = p[k + 1] - q[k + 1], dz = p[k + 2] - q[k + 2], dn = dx * n[0] + dy * n[1] + dz * n[2];
        const tx = dx - dn * n[0], ty = dy - dn * n[1], tz = dz - dn * n[2];
        const f = Math.min(1, K.fric * push / (Math.hypot(tx, ty, tz) + 1e-9));
        p[k] -= tx * f; p[k + 1] -= ty * f; p[k + 2] -= tz * f;
      }
    }
    if (bot) collideBottom(p, q, nP);
    for (let i = 0; i < nP; i++) {
      const k = i * 3;
      v[k] = (p[k] - q[k]) / h; v[k + 1] = (p[k + 1] - q[k + 1]) / h; v[k + 2] = (p[k + 2] - q[k + 2]) / h;
      if (s === SUB - 1 && Math.abs(v[k]) + Math.abs(v[k + 1]) + Math.abs(v[k + 2]) >= 0.02) moving++;
    }
  }
  return moving;
}
// cloth over a bottom bridges every hollow (between the legs, the small of the back): each height's outline becomes
// its convex hull, so the hem hangs across the gap instead of being drawn into it
function hull(tab) {
  const { D, W, N } = tab, out = new Float32Array(D.length);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  for (let r = 0; r < N; r++) {
    const pts = [];
    for (let c = 0; c < W; c++) { const R = D[r * W + c], a = (c + .5) / W * Math.PI * 2; if (R > 0) pts.push([Math.sin(a) * R, Math.cos(a) * R]); }
    if (pts.length < 3) { for (let c = 0; c < W; c++) out[r * W + c] = D[r * W + c]; continue; }
    pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const lo = [], up = [];
    for (const p of pts) { while (lo.length > 1 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
    for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length > 1 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
    const H = lo.slice(0, -1).concat(up.slice(0, -1));
    // the hull's radius along each column's direction (the ray from the centre meets one of its edges)
    for (let c = 0; c < W; c++) {
      const a = (c + .5) / W * Math.PI * 2, dx = Math.sin(a), dz = Math.cos(a);
      let best = D[r * W + c];
      for (let i = 0; i < H.length; i++) {
        const A = H[i], B = H[(i + 1) % H.length], ex = B[0] - A[0], ez = B[1] - A[1];
        const den = dx * ez - dz * ex;
        if (Math.abs(den) < 1e-9) continue;
        const t = (A[0] * ez - A[1] * ex) / den, u = (A[0] * dz - A[1] * dx) / den;
        if (t > 0 && u >= -1e-6 && u <= 1 + 1e-6) best = Math.max(best, t);
      }
      out[r * W + c] = best;
    }
  }
  return { ...tab, D: out };
}
function collideBottom(p, q, nP) {
  const { D, W, N, zc, top } = bot, th = TH + 0.002;
  for (let i = 0; i < nP; i++) {
    const k = i * 3, y = p[k + 1];
    if (y >= top || y <= 0) continue;
    const x = p[k], z = p[k + 2] - zc, r = Math.hypot(x, z);
    if (r < 1e-6) continue;
    // bilinear in the table (rows up the height, columns round the angle, wrapping)
    const fy = Math.min(N - 1.001, Math.max(0, y / top * N - .5)), fa = ((Math.atan2(x, z) / (Math.PI * 2) + 1) * W - .5 + W) % W;
    const r0 = fy | 0, c0 = fa | 0, ty = fy - r0, ta = fa - c0, c1 = (c0 + 1) % W, r1 = Math.min(N - 1, r0 + 1);
    const R = (D[r0 * W + c0] * (1 - ta) + D[r0 * W + c1] * ta) * (1 - ty) + (D[r1 * W + c0] * (1 - ta) + D[r1 * W + c1] * ta) * ty;
    if (!R || r >= R + th) continue;
    const f = (R + th) / r;
    p[k] = x * f; p[k + 2] = z * f + zc;
    // friction against the bottom: hold back the sliding part of this step's motion
    const nx = x / r, nz = z / r, dx = p[k] - q[k], dy = p[k + 1] - q[k + 1], dz = p[k + 2] - q[k + 2], dn = dx * nx + dz * nz;
    const tx = dx - dn * nx, tz = dz - dn * nz, push = R + th - r, g = Math.min(1, K.fric * push / (Math.hypot(tx, dy, tz) + 1e-9));
    p[k] -= tx * g; p[k + 1] -= dy * g; p[k + 2] -= tz * g;
  }
}
// distance to the body and the way to it, per particle (the site's shaders use them: pulled-in shapes, folds)
function toBody(c) {
  const cl = new Float32Array(c.nP), cn = new Float32Array(c.nP * 3), p = c.p;
  for (let i = 0; i < c.nP; i++) {
    const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2], d = sample(x, y, z);
    cl[i] = Math.max(0, Math.min(.06, d));
    const g = grad(x, y, z);
    cn[i * 3] = -g[0] * cl[i]; cn[i * 3 + 1] = -g[1] * cl[i]; cn[i * 3 + 2] = -g[2] * cl[i];
  }
  return { cl, cn };
}
function dist(p, C, R, aS, aC, W, aK) {
  for (let e = 0, n = R.length; e < n; e++) {
    const a = C[e * 2] * 3, b = C[e * 2 + 1] * 3;
    const dx = p[b] - p[a], dy = p[b + 1] - p[a + 1], dz = p[b + 2] - p[a + 2];
    const l = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (l < 1e-9) continue;
    const C0 = l - R[e], al = C0 > 0 ? (W ? aS + aK * W[e] : aS) : aC;
    const lam = -C0 / (2 + al), sx = dx / l * lam * .5, sy = dy / l * lam * .5, sz = dz / l * lam * .5;
    p[a] -= sx; p[a + 1] -= sy; p[a + 2] -= sz;
    p[b] += sx; p[b + 1] += sy; p[b + 2] += sz;
  }
}

function normals(c) {
  const n = new Float32Array(c.nP * 3), T = c.ptri, p = c.p;
  for (let t = 0; t < T.length; t += 3) {
    const a = T[t], b = T[t + 1], d = T[t + 2], f = triN(p, a, b, d);
    for (const i of [a, b, d]) { n[i * 3] += f[0]; n[i * 3 + 1] += f[1]; n[i * 3 + 2] += f[2]; }
  }
  for (let i = 0; i < c.nP; i++) { const l = Math.hypot(n[i * 3], n[i * 3 + 1], n[i * 3 + 2]) || 1; n[i * 3] /= l; n[i * 3 + 1] /= l; n[i * 3 + 2] /= l; }
  return n;
}

// display vertices at the garment's landmarks, for the editor's drag points: sleeve ends (middle of the sleeve hem),
// shoulder ends (where the shoulder seam meets the armhole), hem middles, the side seams a third of the way down,
// neckline middles and the neckline's ends at the shoulder. Each [left, right] or [front, back].
function marks(pieces) {
  const at = (name, seg, f) => { const pc = pieces.find(p => p.name === name), b = pc && pc.bound[seg]; return b ? pc.off + b[Math.round((b.length - 1) * f)] : -1; };
  return {
    sleeve: [at('sleeve_l', 'hem', .5), at('sleeve_r', 'hem', .5)],
    shoulder: [at('front', 'sh_p', 1), at('front', 'sh_m', 1)],
    hem: [at('front', 'hem_p', 1), at('back', 'hem_p', 1)],
    side: [at('front', 'side_p', .35), at('front', 'side_m', .35)],
    neck: [at('front', 'neck_p', 0), at('back', 'neck_p', 0)],
    neckSide: [at('front', 'neck_p', 1), at('front', 'neck_m', 1)],
  };
}
function postTopo() {
  const c = cloth;
  postMessage({ t: 'topo', nV: c.nV, nP: c.nP, map: c.map, uv: c.uv, pc: c.pcA, seam: c.seamOf, index: c.index, info: c.info, marks: c.marks });
}
