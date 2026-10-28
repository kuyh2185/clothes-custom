// tools/metrics.js — injected into the studio page by the tools (check / repro / fuzz). window.__metrics() measures the
// cloth where it now hangs and says what looks broken. A plain script, not a module, so it also runs on old commits.
//   pen   cloth points more than 3 mm inside the mannequin (count, deepest cm)
//   ear   the hem standing off the body's outline more than the cloth just inside it and the edge either side of it
//         (cm, the worst point; see below). Not sleeve ends (a tee sleeve's underarm corner hangs off the arm on every
//         regular tee: left to roll / selfx / pen) nor the neckline and a sleeveless armhole (they lie over the sloping
//         shoulders, where a level slice of the body is no outline to measure against)
//   roll  a hem's side corner hanging higher than the middle of its own panel against the pattern (cm), a sleeve end
//         short of its length along the arm's bones (cm). The hem as a whole sits higher than its pattern depth over a
//         chest (reported as roll.hem, not judged)
//   selfx cloth edges passing through the same cloth's triangles
//   dots  drag points shown outside the stage, lim bars whose value is outside their limits, body = panel ≠ mannequin
(() => {
  const S = () => window.__studio;

  // the surface the cloth rests on: the mannequin's points and normals (and the trousers' when worn), hashed in 2 cm cells
  function surface() {
    const A = S().A, P = [], N = [], K = [];
    for (const [name, k] of [['body', 0], ['jeans', 1]]) {
      const m = A.meshes[name];
      if (!m || !m.visible) continue;
      const p = m.geometry.attributes.position.array, n = m.geometry.attributes.normal.array;
      for (let i = 0; i < p.length; i += 3) { P.push(p[i], p[i + 1], p[i + 2]); N.push(n[i], n[i + 1], n[i + 2]); K.push(k); }
    }
    const C = .02, grid = new Map(), key = (x, y, z) => x + ',' + y + ',' + z, c = v => Math.floor(v / C);
    for (let i = 0; i < K.length; i++) { const k = key(c(P[i * 3]), c(P[i * 3 + 1]), c(P[i * 3 + 2])); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i); }
    // signed distance (m) from the nearest surface point's tangent plane, and which surface; capped at 12 cm
    const near = (x, y, z) => {
      const cx = c(x), cy = c(y), cz = c(z);
      let best = -1, bd = Infinity;
      for (let r = 0; r <= 6; r++) {
        for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) for (let k = -r; k <= r; k++) {
          if (Math.max(Math.abs(i), Math.abs(j), Math.abs(k)) !== r) continue;
          for (const v of grid.get(key(cx + i, cy + j, cz + k)) || []) {
            const d = (P[v * 3] - x) ** 2 + (P[v * 3 + 1] - y) ** 2 + (P[v * 3 + 2] - z) ** 2;
            if (d < bd) { bd = d; best = v; }
          }
        }
        if (best >= 0 && Math.sqrt(bd) <= r * C) break;
      }
      if (best < 0) return [.12, -1];
      return [(x - P[best * 3]) * N[best * 3] + (y - P[best * 3 + 1]) * N[best * 3 + 1] + (z - P[best * 3 + 2]) * N[best * 3 + 2], K[best]];
    };
    return near;
  }

  // the mannequin's torso (arms left out by their skin weights) and the trousers sliced every cm of height, each slice's
  // convex outline: what cloth pulled round it would follow. Distance (cm) outside that outline at the point's height:
  // cloth bridging a hollow (beside the groin, between the breasts) is on the outline, not off the body
  function outline() {
    const A = S().A, body = A.meshes.body, g = body.geometry, SI = g.attributes.skinIndex.array, SW = g.attributes.skinWeight.array;
    const isArm = body.skeleton.bones.map(b => /upperarm|lowerarm|hand|thumb|index|middle|ring|pinky/i.test(b.name));
    const sl = new Map(), add = (x, y, z) => { const k = Math.round(y * 100); if (!sl.has(k)) sl.set(k, []); sl.get(k).push([x, z]); };
    const P = g.attributes.position.array;
    for (let v = 0; v < P.length / 3; v++) {
      let w = 0; for (let j = 0; j < 4; j++) if (isArm[SI[v * 4 + j]]) w += SW[v * 4 + j];
      if (w <= .5) add(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]);
    }
    const J = A.meshes.jeans;
    if (J && J.visible) { const Q = J.geometry.attributes.position.array; for (let i = 0; i < Q.length; i += 3) add(Q[i], Q[i + 1], Q[i + 2]); }
    const H = new Map();
    for (const [k, pts] of sl) if (pts.length > 2) H.set(k, hull(pts));
    return (x, y, z) => {
      const h = H.get(Math.round(y * 100)); if (!h) return null;
      let out = -1e9, edge = 1e9;
      for (let i = 0; i < h.length; i++) {
        const a = h[i], b = h[(i + 1) % h.length], ex = b[0] - a[0], ey = b[1] - a[1], el = Math.hypot(ex, ey) || 1e-9;
        out = Math.max(out, ((x - a[0]) * ey - (z - a[1]) * ex) / el);
        const t = Math.max(0, Math.min(1, ((x - a[0]) * ex + (z - a[1]) * ey) / (el * el)));
        edge = Math.min(edge, Math.hypot(a[0] + ex * t - x, a[1] + ey * t - z));
      }
      return (out > 0 ? edge : out) * 100;
    };
  }
  function hull(pts) {   // clockwise in (x, z) seen from above = counter-clockwise for polyDist's sign
    pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]), lo = [], up = [];
    for (const p of pts) { while (lo.length > 1 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
    for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length > 1 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
    return lo.slice(0, -1).concat(up.slice(0, -1));
  }

  // the cloth's pieces (front, back, sleeves: the display mesh's connected parts in vertex order) and free edges
  function topo() {
    const c = S().cloth, g = c.geometry, I = g.index.array, map = c.userData.map, nV = map.length, info = c.userData.info;
    const par = new Int32Array(nV).map((_, i) => i), find = i => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; };
    for (let t = 0; t < I.length; t += 3) for (let e = 0; e < 3; e++) { const a = find(I[t + e]), b = find(I[t + (e + 1) % 3]); if (a !== b) par[Math.max(a, b)] = Math.min(a, b); }
    const roots = [...new Set(Array.from({ length: nV }, (_, i) => find(i)))].sort((a, b) => a - b);
    const names = ['front', 'back', ...(info.has.l ? ['sleeve_l'] : []), ...(info.has.r ? ['sleeve_r'] : [])];
    const piece = new Int8Array(nV);
    for (let i = 0; i < nV; i++) piece[i] = ['front', 'back', 'sleeve_l', 'sleeve_r'].indexOf(names[roots.indexOf(find(i))]);
    // free = a particle edge only one triangle has (seams weld two pieces' edges into one particle edge)
    const pk = (a, b) => { a = map[a]; b = map[b]; return a < b ? a * 1e6 + b : b * 1e6 + a; }, cnt = new Map();
    for (let t = 0; t < I.length; t += 3) for (let e = 0; e < 3; e++) { const k = pk(I[t + e], I[t + (e + 1) % 3]); cnt.set(k, (cnt.get(k) || 0) + 1); }
    const adj = new Map(), link = (a, b) => { if (!adj.has(a)) adj.set(a, []); adj.get(a).push(b); };
    for (let t = 0; t < I.length; t += 3) for (let e = 0; e < 3; e++) {
      const a = I[t + e], b = I[t + (e + 1) % 3];
      if (cnt.get(pk(a, b)) === 1) { link(a, b); link(b, a); }
    }
    return { I, map, nV, piece, adj, info };
  }

  function measure() {
    const st = S(), c = st.cloth, A = st.A, near = surface(), { map, nV, piece, adj, info } = topo();
    const X = c.geometry.attributes.position.array, U = c.geometry.attributes.pat.array;
    const pt = v => [U[v * 2] * 100, U[v * 2 + 1] * 100];   // pattern cm (uv carries each piece's x shift: only y and deltas are used)
    const px = v => U[v * 2] * 100 - [0, 70, 140, 190][piece[v]];
    // signed cloth–surface distance per particle (cm)
    const nP = Math.max(...map) + 1, D = new Float32Array(nP), Kd = new Int8Array(nP), seen = new Uint8Array(nP);
    for (let v = 0; v < nV; v++) {
      const p = map[v]; if (seen[p]) continue; seen[p] = 1;
      const [d, k] = near(X[v * 3], X[v * 3 + 1], X[v * 3 + 2]); D[p] = d * 100; Kd[p] = k;
    }
    let pen = 0, deep = 0;
    for (let p = 0; p < nP; p++) if (Kd[p] === 0 && D[p] < -.3) { pen++; deep = Math.max(deep, -D[p]); }

    // free-edge loops (particle-connected), each named by what it is
    const free = [...adj.keys()], comp = new Map();
    const pAdj = new Map();
    for (const v of free) for (const w of adj.get(v)) { const a = map[v], b = map[w]; if (!pAdj.has(a)) pAdj.set(a, new Set()); pAdj.get(a).add(b); }
    let nc = 0;
    for (const v of free) {
      const p0 = map[v]; if (comp.has(p0)) continue;
      const stack = [p0]; comp.set(p0, nc);
      while (stack.length) { const p = stack.pop(); for (const q of pAdj.get(p) || []) if (!comp.has(q)) { comp.set(q, nc); stack.push(q); } }
      nc++;
    }
    const front = free.filter(v => piece[v] === 0), mid = front.filter(v => Math.abs(px(v)) < .7);
    const lo = mid.reduce((a, v) => (a < 0 || pt(v)[1] < pt(a)[1] ? v : a), -1), hi = mid.reduce((a, v) => (a < 0 || pt(v)[1] > pt(a)[1] ? v : a), -1);
    const kindOf = new Map();
    for (const v of free) {
      const k = comp.get(map[v]);
      if (!kindOf.has(k)) kindOf.set(k, 'arm');
      if (piece[v] >= 2) kindOf.set(k, 'cuff');
    }
    if (lo >= 0) kindOf.set(comp.get(map[lo]), 'hem');
    if (hi >= 0) kindOf.set(comp.get(map[hi]), 'neck');

    // per piece: pattern-space hash of display vertices, to find the cloth a few cm in from an edge point
    const pg = new Map(), pkey = (pc, x, y) => pc + ',' + Math.floor(x / 1.5) + ',' + Math.floor(y / 1.5);
    for (let v = 0; v < nV; v++) { const k = pkey(piece[v], px(v), pt(v)[1]); if (!pg.has(k)) pg.set(k, []); pg.get(k).push(v); }
    const at = (pc, x, y) => {
      let best = -1, bd = 1.2 * 1.2;
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const v of pg.get(pc + ',' + (Math.floor(x / 1.5) + i) + ',' + (Math.floor(y / 1.5) + j)) || []) {
        const d = (px(v) - x) ** 2 + (pt(v)[1] - y) ** 2; if (d < bd) { bd = d; best = v; }
      }
      return best;
    };
    const loops = {}, off = outline();
    for (const v of free) {
      const kind = kindOf.get(comp.get(map[v])), nb = adj.get(v).filter(w => piece[w] === piece[v]);
      if (!nb.length) continue;
      const x = px(v), y = pt(v)[1];
      const a = nb[0], b = nb[nb.length - 1];
      let tx = px(b) - px(a), ty = pt(b)[1] - pt(a)[1];
      if (nb.length === 1) { tx = px(a) - x; ty = pt(a)[1] - y; }
      const tl = Math.hypot(tx, ty) || 1;
      let nx = -ty / tl, ny = tx / tl;
      // which way is into the cloth: up from a hem or sleeve end, away from the neck hole, in from an armhole
      const into = piece[v] >= 2 || kind === 'hem' ? ny : kind === 'neck' ? nx * x + ny * (y - 2) : -nx * Math.sign(x);
      if (into < 0) { nx = -nx; ny = -ny; }
      // an ear: the cloth at the edge standing off the body's outline more than the cloth 6–9 cm in, and more than the
      // edge 4–8 cm along on either side (cloth hanging off over a wide stretch, a tee's back hem below the seat, is
      // drape). Where the edge already hangs loose (an oversized hem's side corners swing out), only what is well past
      // that looseness counts
      if (kind !== 'hem') continue;
      if (st.editNear && st.editNear(piece[v], x, y)) continue;   // (an outline drawn by hand stands where it was drawn)
      // (the cloth further in also as if it hung straight down to the edge's height: below a seat or a chest the body
      // draws in under it, and cloth hanging plumb from there stands off without any ear)
      const val = (d, plumb) => {
        const w = at(piece[v], x + nx * d, y + ny * d); if (w < 0) return null;
        const o = off(X[w * 3], X[w * 3 + 1], X[w * 3 + 2]);
        return plumb && o != null ? Math.max(o, off(X[w * 3], X[v * 3 + 1], X[w * 3 + 2]) ?? o) : o;
      };
      const nearV = [0, 1, 2, 3, 4].map(d => val(d)).filter(s => s != null), refV = [6, 7, 8, 9].map(d => val(d, true)).filter(s => s != null);
      if (refV.length < 2 || !nearV.length) continue;
      const k = comp.get(map[v]), ref = refV.reduce((s, q) => s + q, 0) / refV.length;
      (loops[k] ||= { kind, pts: [] }).pts.push({ v, near: Math.max(...nearV), ref, jump: Math.max(...nearV) - ref });
    }
    const median = a => { const s = a.slice().sort((p, q) => p - q); return s.length ? s[s.length >> 1] : 0; };
    const ears = [], wd = (a, b) => Math.hypot(X[a * 3] - X[b * 3], X[a * 3 + 1] - X[b * 3 + 1], X[a * 3 + 2] - X[b * 3 + 2]) * 100;
    // (and less how much the whole edge waves anyway, past a smooth hem's few mm: a loose hem draped in folds all round
    // has a crest every few cm, each standing off its troughs as far as a single ear on a smooth hem. 2026-10-28: a
    // smooth fitted crop's 10/25 corner ear 0.82 on a hem waving 0.12, an oversized back hem's fold crest 0.82 on 1.39)
    for (const L of Object.values(loops)) {
      const m = median(L.pts.map(p => p.jump));
      for (const p of L.pts) {
        const side = L.pts.filter(q => { const d = wd(p.v, q.v); return d >= 3 && d <= 6; });
        p.lat = side.length ? side.reduce((s, q) => s + q.near, 0) / side.length : p.near;
      }
      const wave = Math.max(0, median(L.pts.map(p => Math.abs(p.near - p.lat))) - .25);
      for (const p of L.pts) ears.push({ kind: L.kind, spike: Math.min(p.jump - m, p.near - p.lat) - 2 * Math.max(0, p.lat - 1, p.ref - 1) - wave, v: p.v });
    }
    ears.sort((a, b) => b.spike - a.spike);
    const earBy = {};
    for (const e of ears) if (!(e.kind in earBy)) earBy[e.kind] = Math.round(e.spike * 10) / 10;
    const ear = ears[0] || { kind: '', spike: 0, v: -1 };

    // roll: the hem's height against the pattern (cm up), a sleeve end's place along the arm (cm short)
    const roll = {};
    const hemV = free.filter(v => kindOf.get(comp.get(map[v])) === 'hem' && piece[v] < 2);
    const dy = v => (X[v * 3 + 1] - (A.hps + U[v * 2 + 1])) * 100;
    if (hemV.length) {
      roll.hem = median(hemV.map(dy));
      // the side corners against the middle of their own panel
      for (const pc of [0, 1]) {
        const H = hemV.filter(v => piece[v] === pc), w = Math.max(...H.map(v => Math.abs(px(v))));
        const mid = median(H.filter(v => Math.abs(px(v)) < 5).map(dy)), side = H.filter(v => Math.abs(px(v)) > w - 3).map(dy);
        if (side.length) roll['side' + pc] = Math.max(...side) - mid;
      }
    }
    for (const [s, pc] of [['l', 2], ['r', 3]]) {
      // (each point against its own sleeve cm: an end drawn by hand isn't straight across)
      const cuff = free.filter(v => piece[v] === pc && kindOf.get(comp.get(map[v])) === 'cuff' && pt(v)[1] < -info.sleeve['u' + s.toUpperCase()] + 1.5 + Math.max(0, ...(st.state.top.edit?.['S' + s] || []).map(e => e[3])));
      if (!cuff.length) continue;
      const [J, E, W] = A.bones[s], seg = [[J, E], [E, W]];
      const along = v => {   // cm down the arm's bones to the closest point
        let best = Infinity, out = 0, s0 = 0;
        for (const [a, b] of seg) {   // the forearm's line runs on past the wrist, over the hand (a sleeve can cover it)
          const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], l2 = d[0] ** 2 + d[1] ** 2 + d[2] ** 2;
          const t = Math.max(0, Math.min(b === W ? 2 : 1, ((X[v * 3] - a[0]) * d[0] + (X[v * 3 + 1] - a[1]) * d[1] + (X[v * 3 + 2] - a[2]) * d[2]) / l2));
          const q = [a[0] + d[0] * t - X[v * 3], a[1] + d[1] * t - X[v * 3 + 1], a[2] + d[2] * t - X[v * 3 + 2]], dd = Math.hypot(...q);
          if (dd < best) { best = dd; out = s0 + Math.sqrt(l2) * t; }
          s0 += Math.sqrt(l2);
        }
        return out * 100;
      };
      roll[s] = -median(cuff.map(v => along(v) + pt(v)[1]));
    }

    // drag points: shown ones inside the stage
    const r = document.getElementById('stage').getBoundingClientRect();
    let dots = 0;
    for (const d of document.querySelectorAll('#layer .dot')) {
      if (d.hidden) continue;
      const b = d.getBoundingClientRect(), x = (b.left + b.right) / 2, y = (b.top + b.bottom) / 2;
      if (x < r.left || x > r.right || y < r.top || y > r.bottom) dots++;
    }
    // the panel's numbers within their bars' limits (re-drawn first, on this mannequin)
    st.apply();
    const T = st.state.top, val = { sl0: T.sl[0], sl1: T.sl[1], L: T.L, ease: T.ease, sEase: T.sEase, flare: T.flare, ndF: T.ndF, ndB: T.ndB, dNw: T.dNw, neckV: T.neckV };
    const lim = [];
    for (const [id, v] of Object.entries(val)) {
      const el = document.getElementById('b-' + id);
      if (el && v != null && (v < +el.min - .05 || v > +el.max + .05)) lim.push(`${id} ${v.toFixed(1)} ∉ [${(+el.min).toFixed(1)}, ${(+el.max).toFixed(1)}]`);
    }
    const r1 = v => Math.round(v * 10) / 10;
    const ep = ear.v >= 0 ? [X[ear.v * 3], X[ear.v * 3 + 1], X[ear.v * 3 + 2]] : null;
    return {
      pen, deep: r1(deep), ear: Math.round(ear.spike * 100) / 100, earAt: ear.kind, earBy, earP: ep, roll: Object.fromEntries(Object.entries(roll).map(([k, v]) => [k, r1(v)])),
      selfx: selfx(), nP, dots, lim, body: A.kind === st.state.body ? '' : `패널 ${st.state.body} · 마네킹 ${A.kind}`,
    };
  }

  // cloth edges that pierce a triangle they share no particle with
  function selfx() {
    const c = S().cloth, g = c.geometry, P = g.attributes.position.array, I = g.index.array, map = c.userData.map;
    const nP = Math.max(...map) + 1, pos = new Float64Array(nP * 3);
    for (let i = 0; i < map.length; i++) for (let k = 0; k < 3; k++) pos[map[i] * 3 + k] = P[i * 3 + k];
    const T = [];
    for (let t = 0; t < I.length; t += 3) { const a = map[I[t]], b = map[I[t + 1]], d = map[I[t + 2]]; if (a !== b && b !== d && a !== d) T.push(a, b, d); }
    const E = new Map();
    for (let t = 0; t < T.length; t += 3) for (let e = 0; e < 3; e++) { const a = T[t + e], b = T[t + (e + 1) % 3]; E.set(a < b ? a * nP + b : b * nP + a, [a, b]); }
    const cell = 0.02, grid = new Map(), cl = v => Math.floor(v / cell);
    for (let t = 0; t < T.length; t += 3) {
      const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
      for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], pos[T[t + j] * 3 + k]); hi[k] = Math.max(hi[k], pos[T[t + j] * 3 + k]); }
      for (let x = cl(lo[0]); x <= cl(hi[0]); x++) for (let y = cl(lo[1]); y <= cl(hi[1]); y++) for (let z = cl(lo[2]); z <= cl(hi[2]); z++) {
        const k = x + ',' + y + ',' + z; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(t);
      }
    }
    const V = i => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], cr = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const hit = (p, q, A, B, C) => {   // Möller–Trumbore, segment p→q
      const d = sub(q, p), e1 = sub(B, A), e2 = sub(C, A), h = cr(d, e2), a = dot(e1, h);
      if (Math.abs(a) < 1e-14) return false;
      const f = 1 / a, s = sub(p, A), u = f * dot(s, h); if (u < 0 || u > 1) return false;
      const qq = cr(s, e1), v = f * dot(d, qq); if (v < 0 || u + v > 1) return false;
      const t = f * dot(e2, qq); return t > 0 && t < 1;
    };
    let n = 0;
    for (const [a, b] of E.values()) {
      const p = V(a), q = V(b), seen = new Set();
      let found = false;
      for (let x = cl(Math.min(p[0], q[0])); x <= cl(Math.max(p[0], q[0])) && !found; x++)
        for (let y = cl(Math.min(p[1], q[1])); y <= cl(Math.max(p[1], q[1])) && !found; y++)
          for (let z = cl(Math.min(p[2], q[2])); z <= cl(Math.max(p[2], q[2])) && !found; z++)
            for (const t of grid.get(x + ',' + y + ',' + z) || []) {
              if (seen.has(t)) continue; seen.add(t);
              const A = T[t], B = T[t + 1], C = T[t + 2];
              if (A === a || A === b || B === a || B === b || C === a || C === b) continue;
              if (hit(p, q, V(A), V(B), V(C))) { found = true; break; }
            }
      if (found) n++;
    }
    return n;
  }

  window.__metrics = measure;
  window.__selfx = selfx;   // (alone: cheap enough to watch the cloth while it falls)
})();
