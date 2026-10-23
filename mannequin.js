// The mannequin's surface, made ready before anything reads it (collision field, picking):
//  - no nipples: each one (its own dense little mesh) is laid onto a smooth surface fitted to the skin round it
//  - under the trousers the skin sits a few mm inside them, so it can't show through
// All in bind (rest) space; the mesh's normals are recomputed where it moved.

export function smoothChest(geo, H) {
  const P = geo.attributes.position, N = geo.attributes.normal, n = P.count, s = H / 1.77;
  // the chest's most forward point, one side (the nipple's tip)
  let ap = [0, 0, -1];
  for (let i = 0; i < n; i++) {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
    if (x > .03 * s && x < .15 * s && y > 1.12 * s && y < 1.42 * s && z > ap[2]) ap = [x, y, z];
  }
  const r0 = .024 * s, r1 = .045 * s;
  const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const moved = new Uint8Array(n);
  for (const sx of [1, -1]) {
    const o = [sx * ap[0], ap[1], ap[2]];
    // the skin's facing round it, and a tangent frame (u across, v up the surface)
    let wx = 0, wy = 0, wz = 0;
    for (let i = 0; i < n; i++) {
      const d = Math.hypot(P.getX(i) - o[0], P.getY(i) - o[1], P.getZ(i) - o[2]);
      if (d > r0 * 1.15 && d < r1) { wx += N.getX(i); wy += N.getY(i); wz += N.getZ(i); }
    }
    const wl = Math.hypot(wx, wy, wz) || 1, w = [wx / wl, wy / wl, wz / wl];
    let u = [w[2], 0, -w[0]];
    const ul = Math.hypot(...u) || 1; u = u.map(c => c / ul);
    const v = [w[1] * u[2] - w[2] * u[1], w[2] * u[0] - w[0] * u[2], w[0] * u[1] - w[1] * u[0]];
    const ring = [], inner = [];
    for (let i = 0; i < n; i++) {
      const d = [P.getX(i) - o[0], P.getY(i) - o[1], P.getZ(i) - o[2]], dist = Math.hypot(...d);
      if (dist >= r1) continue;
      const q = [d[0] * u[0] + d[1] * u[1] + d[2] * u[2], d[0] * v[0] + d[1] * v[1] + d[2] * v[2], d[0] * w[0] + d[1] * w[1] + d[2] * w[2]];
      (dist > r0 * 1.15 ? ring : inner).push([i, ...q, dist]);
    }
    // least squares: h = a + b·u + c·v + d·u² + e·uv + f·v² over the ring
    const A = Array.from({ length: 6 }, () => new Float64Array(7));
    for (const [, x, y, h] of ring) {
      const f = [1, x, y, x * x, x * y, y * y];
      for (let r = 0; r < 6; r++) { for (let c = 0; c < 6; c++) A[r][c] += f[r] * f[c]; A[r][6] += f[r] * h; }
    }
    for (let c = 0; c < 6; c++) {   // Gauss–Jordan
      let p = c;
      for (let r = c + 1; r < 6; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
      [A[c], A[p]] = [A[p], A[c]];
      const k = A[c][c] || 1e-12;
      for (let cc = c; cc < 7; cc++) A[c][cc] /= k;
      for (let r = 0; r < 6; r++) if (r !== c) { const t = A[r][c]; for (let cc = c; cc < 7; cc++) A[r][cc] -= t * A[c][cc]; }
    }
    const co = A.map(r => r[6]);
    for (const [i, x, y, h, dist] of inner) {
      const fit = co[0] + co[1] * x + co[2] * y + co[3] * x * x + co[4] * x * y + co[5] * y * y;
      const t = 1 - ss(r0 * .8, r0 * 1.15, dist), dh = (h - fit) * t;
      P.setXYZ(i, P.getX(i) - w[0] * dh, P.getY(i) - w[1] * dh, P.getZ(i) - w[2] * dh);
      moved[i] = 1;
    }
  }
  fixNormals(geo, moved);
}

// skin covered by a garment of the asset (attribute _m_<id>) pulled a few mm in
export function tuckUnder(geo, id, depth = .006) {
  const m = geo.attributes['_m_' + id];
  if (!m) return;
  const P = geo.attributes.position, N = geo.attributes.normal;
  for (let i = 0; i < P.count; i++) {
    const k = m.getX(i) * depth;
    if (k) P.setXYZ(i, P.getX(i) - N.getX(i) * k, P.getY(i) - N.getY(i) * k, P.getZ(i) - N.getZ(i) * k);
  }
  P.needsUpdate = true;
  geo.computeBoundingBox(); geo.computeBoundingSphere();
}

// normals of moved vertices from the surface around them (copies made at UV seams welded by position)
function fixNormals(geo, moved) {
  const P = geo.attributes.position, N = geo.attributes.normal, I = geo.index.array, n = P.count;
  const id = new Int32Array(n), key = new Map();
  let m = 0;
  for (let i = 0; i < n; i++) {
    const k = Math.round(P.getX(i) * 1e5) + ',' + Math.round(P.getY(i) * 1e5) + ',' + Math.round(P.getZ(i) * 1e5);
    if (!key.has(k)) key.set(k, m++);
    id[i] = key.get(k);
  }
  const want = new Uint8Array(m);
  for (let i = 0; i < n; i++) if (moved[i]) want[id[i]] = 1;
  const acc = new Float64Array(m * 3);
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t], b = I[t + 1], c = I[t + 2];
    if (!want[id[a]] && !want[id[b]] && !want[id[c]]) continue;
    const ux = P.getX(b) - P.getX(a), uy = P.getY(b) - P.getY(a), uz = P.getZ(b) - P.getZ(a);
    const vx = P.getX(c) - P.getX(a), vy = P.getY(c) - P.getY(a), vz = P.getZ(c) - P.getZ(a);
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    for (const q of [id[a], id[b], id[c]]) { acc[q * 3] += fx; acc[q * 3 + 1] += fy; acc[q * 3 + 2] += fz; }
  }
  for (let i = 0; i < n; i++) {
    const q = id[i];
    if (!want[q]) continue;
    const l = Math.hypot(acc[q * 3], acc[q * 3 + 1], acc[q * 3 + 2]) || 1;
    N.setXYZ(i, acc[q * 3] / l, acc[q * 3 + 1] / l, acc[q * 3 + 2] / l);
  }
  P.needsUpdate = N.needsUpdate = true;
  geo.computeBoundingBox(); geo.computeBoundingSphere();
}
