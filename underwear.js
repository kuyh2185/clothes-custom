// The underwear the mannequin always wears. Two parts:
//  reshape(): the body's own surface under it — the bust smoothed (no nipples) and the covered skin lifted a little,
//             in bind (rest) space, before anything reads the body (collision field, clearance, skinning).
//  patch():   the bra and briefs drawn on the skin in the fragment shader from the rest position, so the edges are
//             crisp curves with an elastic band along them, whatever the mesh density.
// Women: a bra (moulded cups, centre gore, under band, straps over the shoulders) and briefs. Men: trunks.
import * as THREE from 'three';

const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// body landmarks from the rest-pose surface (m). s scales the 177 cm numbers to this body.
export function landmarks(P, H, kind) {
  const s = H / 1.77, n = P.count;
  let ap = [0, 0, -1], yc = 9;
  for (let i = 0; i < n; i++) {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
    // the bust's (or chest's) most forward point, one side
    if (x > .03 * s && x < .15 * s && y > 1.12 * s && y < 1.42 * s && z > ap[2]) ap = [x, y, z];
    // crotch: the lowest point of the torso on the middle line
    if (Math.abs(x) < .004 && y > .55 * s && y < yc) yc = y;
  }
  return { s, f: kind !== 'm', ax: ap[0], ay: ap[1], az: ap[2], yc };
}

// how much of a rest-pose point is under the cups (for smoothing) and under any underwear (for lifting)
function weights(L, x, y, z) {
  const { s, ax, ay, az, yc } = L, X = Math.abs(x);
  const torso = X < .21 * s ? 1 : 0;
  const d = Math.hypot(X - ax, (y - ay) * 1.1);
  const front = sstep(az - .11 * s, az - .06 * s, z);
  const cup = torso * front * (1 - sstep(.055 * s, .085 * s, d));
  let wear = 0;
  if (L.f) {
    const yub = ay - .062 * s;
    wear = Math.max(cup, torso * sstep(yub - .03 * s, yub - .02 * s, y) * (1 - sstep(yub + .02 * s, yub + .035 * s, y)));
  }
  const top = yc + .12 * s, lo = L.f ? yc - .01 * s : yc - .075 * s;
  wear = Math.max(wear, (X < .23 * s ? 1 : 0) * sstep(lo - .01 * s, lo + .005 * s, y) * (1 - sstep(top - .005 * s, top + .01 * s, y)));
  return { cup, wear };
}

export function reshape(geo, L) {
  const P = geo.attributes.position, N = geo.attributes.normal, n = P.count, I = geo.index.array;
  // weld the copies made at UV seams: smoothing and normals work on the surface, not on the copies
  const id = new Int32Array(n), key = new Map();
  let m = 0;
  for (let i = 0; i < n; i++) {
    const k = Math.round(P.getX(i) * 1e5) + ',' + Math.round(P.getY(i) * 1e5) + ',' + Math.round(P.getZ(i) * 1e5);
    if (!key.has(k)) key.set(k, m++);
    id[i] = key.get(k);
  }
  const pos = new Float64Array(m * 3), cup = new Float32Array(m), wear = new Float32Array(m);
  for (let i = 0; i < n; i++) {
    const v = id[i], x = P.getX(i), y = P.getY(i), z = P.getZ(i);
    pos[v * 3] = x; pos[v * 3 + 1] = y; pos[v * 3 + 2] = z;
    const w = weights(L, x, y, z);
    cup[v] = w.cup; wear[v] = w.wear;
  }
  const nb = Array.from({ length: m }, () => new Set());
  for (let t = 0; t < I.length; t += 3) {
    const a = id[I[t]], b = id[I[t + 1]], c = id[I[t + 2]];
    nb[a].add(b).add(c); nb[b].add(a).add(c); nb[c].add(a).add(b);
  }
  const R = [];
  for (let v = 0; v < m; v++) if (cup[v] > 0) R.push(v);
  const adj = R.map(v => [...nb[v]]);
  // the nipple first. It has its own dense little mesh, which smoothing only shrinks into a bead; instead a smooth
  // surface is fitted to the ring of skin round it and everything inside is laid onto that surface
  const nip = new Float32Array(m);
  for (const sx of [1, -1]) {
    const o = [sx * L.ax, L.ay, L.az], r0 = .024 * L.s, r1 = .045 * L.s;
    const ring = [], inner = [];
    let wx = 0, wy = 0, wz = 0;
    for (let i = 0; i < n; i++) {
      const v = id[i], dx = pos[v * 3] - o[0], dy = pos[v * 3 + 1] - o[1], dz = pos[v * 3 + 2] - o[2], d = Math.hypot(dx, dy, dz);
      if (d > r0 * 1.15 && d < r1) { wx += N.getX(i); wy += N.getY(i); wz += N.getZ(i); }
    }
    const wl = Math.hypot(wx, wy, wz) || 1, w = [wx / wl, wy / wl, wz / wl];
    // tangent frame (u across, v up the surface)
    let u = [w[2], 0, -w[0]];
    const ul = Math.hypot(...u) || 1; u = u.map(c => c / ul);
    const vv = [w[1] * u[2] - w[2] * u[1], w[2] * u[0] - w[0] * u[2], w[0] * u[1] - w[1] * u[0]];
    const seen = new Uint8Array(m);
    for (let v = 0; v < m; v++) {
      const d = [pos[v * 3] - o[0], pos[v * 3 + 1] - o[1], pos[v * 3 + 2] - o[2]], dist = Math.hypot(...d);
      if (dist >= r1 || seen[v]) continue;
      seen[v] = 1;
      const q = [d[0] * u[0] + d[1] * u[1] + d[2] * u[2], d[0] * vv[0] + d[1] * vv[1] + d[2] * vv[2], d[0] * w[0] + d[1] * w[1] + d[2] * w[2]];
      (dist > r0 * 1.15 ? ring : inner).push([v, ...q, dist]);
    }
    // least squares: h = a + b·u + c·v + d·u² + e·uv + f·v²
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
    for (const [v, x, y, h, dist] of inner) {
      const fit = co[0] + co[1] * x + co[2] * y + co[3] * x * x + co[4] * x * y + co[5] * y * y;
      const t = 1 - sstep(r0 * .8, r0 * 1.15, dist);
      pos[v * 3] -= w[0] * (h - fit) * t; pos[v * 3 + 1] -= w[1] * (h - fit) * t; pos[v * 3 + 2] -= w[2] * (h - fit) * t;
      nip[v] = Math.max(nip[v], t);
    }
  }
  // then Taubin smoothing (shrink-free) over the cups: a moulded cup's even surface, the bust keeps its size
  const tmp = new Float64Array(R.length * 3);
  for (let it = 0; it < 60; it++) for (const lam of [.5, -.53]) {
    R.forEach((v, k) => {
      const a = adj[k];
      let sx = 0, sy = 0, sz = 0;
      for (const u of a) { sx += pos[u * 3]; sy += pos[u * 3 + 1]; sz += pos[u * 3 + 2]; }
      const w = lam * cup[v];
      tmp[k * 3] = pos[v * 3] + (sx / a.length - pos[v * 3]) * w;
      tmp[k * 3 + 1] = pos[v * 3 + 1] + (sy / a.length - pos[v * 3 + 1]) * w;
      tmp[k * 3 + 2] = pos[v * 3 + 2] + (sz / a.length - pos[v * 3 + 2]) * w;
    });
    R.forEach((v, k) => { pos[v * 3] = tmp[k * 3]; pos[v * 3 + 1] = tmp[k * 3 + 1]; pos[v * 3 + 2] = tmp[k * 3 + 2]; });
  }
  // welded normals, then the covered skin lifted along them (moulded cups a little more)
  const nrm = new Float64Array(m * 3);
  for (let t = 0; t < I.length; t += 3) {
    const a = id[I[t]], b = id[I[t + 1]], c = id[I[t + 2]];
    const ux = pos[b * 3] - pos[a * 3], uy = pos[b * 3 + 1] - pos[a * 3 + 1], uz = pos[b * 3 + 2] - pos[a * 3 + 2];
    const vx = pos[c * 3] - pos[a * 3], vy = pos[c * 3 + 1] - pos[a * 3 + 1], vz = pos[c * 3 + 2] - pos[a * 3 + 2];
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    for (const q of [a, b, c]) { nrm[q * 3] += fx; nrm[q * 3 + 1] += fy; nrm[q * 3 + 2] += fz; }
  }
  for (let v = 0; v < m; v++) {
    const l = Math.hypot(nrm[v * 3], nrm[v * 3 + 1], nrm[v * 3 + 2]) || 1;
    nrm[v * 3] /= l; nrm[v * 3 + 1] /= l; nrm[v * 3 + 2] /= l;
    const lift = wear[v] * .0015 + cup[v] * .0015 * (L.f ? 1 : 0);
    pos[v * 3] += nrm[v * 3] * lift; pos[v * 3 + 1] += nrm[v * 3 + 1] * lift; pos[v * 3 + 2] += nrm[v * 3 + 2] * lift;
  }
  for (let i = 0; i < n; i++) {
    const v = id[i];
    if (wear[v] <= 0 && cup[v] <= 0 && nip[v] <= 0) continue;
    P.setXYZ(i, pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
    N.setXYZ(i, nrm[v * 3], nrm[v * 3 + 1], nrm[v * 3 + 2]);
  }
  P.needsUpdate = N.needsUpdate = true;
  geo.computeBoundingBox(); geo.computeBoundingSphere();
}

// GLSL: coverage of a rest-pose point (x = bra/trunks, y = elastic band along an edge), all in metres
function glsl(L) {
  const f = v => (+v).toFixed(5);
  const { s, ax, ay, az, yc } = L, yub = ay - .062 * s;
  return `
float uwEdge(float d) { float w = max(fwidth(d), 1e-5); return clamp(d / w + .5, 0.0, 1.0); }
vec2 underwear(vec3 p) {
  float X = abs(p.x), cov = 0.0, band = 0.0, inT = step(X, ${f(.21 * s)});
  ${L.f ? `
  // bra: under band all round, cups and centre gore in front, straps up over the shoulders
  float front = smoothstep(${f(az - .13 * s)}, ${f(az - .09 * s)}, p.z);
  float lo = ${f(yub - .022 * s)} + front * ${f(.018 * s)} * smoothstep(0.0, ${f(ax)}, X) * (1.0 - smoothstep(${f(ax)}, ${f(ax + .07 * s)}, X));
  float tF = X < ${f(ax - .012 * s)}
    ? mix(${f(yub + .04 * s)}, ${f(ay + .052 * s)}, smoothstep(0.0, ${f(ax - .012 * s)}, X))
    : mix(${f(ay + .052 * s)}, ${f(yub + .045 * s)}, smoothstep(${f(ax - .012 * s)}, ${f(ax + .085 * s)}, X));
  float tB = ${f(yub + .022 * s)} + ${f(.02 * s)} * smoothstep(${f(.05 * s)}, ${f(.15 * s)}, X);
  float top = mix(tB, tF, front);
  float dBra = min(p.y - lo, top - p.y);
  // straps: from the cup's peak (front) or the band (back) up to the top of the shoulder
  float y0 = mix(${f(yub + .02 * s)}, ${f(ay + .045 * s)}, front), y1 = ${f(1.505 * s)};
  float xs = mix(mix(${f(.098 * s)}, ${f(ax - .006 * s)}, front), ${f(.088 * s)}, clamp((p.y - y0) / (y1 - y0), 0.0, 1.0));
  float dStrap = min(min(${f(.0065 * s)} - abs(X - xs), p.y - y0 + .01), y1 + ${f(.03 * s)} - p.y);
  float d = min(max(dBra, dStrap), ${f(.21 * s)} - X);
  { cov = max(cov, uwEdge(d)); band = max(band, uwEdge(d) * (1.0 - uwEdge(min(p.y - lo, top - p.y) - .007)) * step(dStrap, dBra)); }
  ` : ''}
  // briefs (women: high-cut legs, fuller at the back) / trunks (men: down the top of the thighs)
  float fr = smoothstep(-.04, .05, p.z - ${f(L.f ? .02 : .03)});
  float topB = ${f(yc + .118 * s)} + (1.0 - fr) * ${f(.012 * s)};
  ${L.f
    ? `float leg = ${f(yc - .006 * s)} + max(0.0, X - ${f(.035 * s)}) * mix(.3, .78, fr);`
    : `float leg = ${f(yc - .075 * s)} + max(0.0, X - ${f(.03 * s)}) * .08;`}
  float dB = min(min(topB - p.y, p.y - leg), ${f(.2 * s)} - X);
  cov = max(cov, uwEdge(dB));
  band = max(band, uwEdge(dB) * (1.0 - uwEdge(min(topB - p.y - .012, p.y - leg - .006))));
  return vec2(cov, band);
}`;
}

// add the underwear to a body material (keeps whatever onBeforeCompile it already has)
export function patch(mat, L, color = '#2c2a2e') {
  const prev = mat.onBeforeCompile, U = { uUwC: { value: new THREE.Color(color) } };
  mat.userData.uw = U;
  mat.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vUwP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvUwP = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vUwP; uniform vec3 uUwC;\n${glsl(L)}\nvec2 uwK;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
uwK = underwear(vUwP);
diffuseColor.rgb = mix(diffuseColor.rgb, uUwC * (1.0 - .28 * uwK.y), uwK.x);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, .62 - .2 * uwK.y, uwK.x);`)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
#ifdef USE_SHEEN
material.sheenColor *= 1.0 - .7 * uwK.x;
#endif`);
  };
  const key = mat.customProgramCacheKey ? mat.customProgramCacheKey.bind(mat) : () => '';
  mat.customProgramCacheKey = () => key() + '-uw' + (L.f ? 'f' : 'm') + L.s.toFixed(3);
}
