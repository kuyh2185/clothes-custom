// A top made the way a real one is: flat pattern pieces (front, back, two set-in sleeves) in cm, and the flat mesh of
// each piece. Ported from blender/pattern_tee.py (branch wip-blender-pattern). x across (+x = the wearer's left),
// y up with the high shoulder point at 0. One chain of shapes, all continuous: a sleeve of any length down to nothing,
// then the shoulder narrowing to a thin strap (the neckline and armhole open into a camisole on the way).
import Delaunator from 'https://cdn.jsdelivr.net/npm/delaunator@5.0.1/+esm';
import Constrainautor from 'https://cdn.jsdelivr.net/npm/@kninnug/constrainautor@4.0.0/+esm';

export const S = 1.3;   // mesh spacing (cm)
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

// women's regular-fit tee on the 177 cm model (cm). sleeve = length from the top of the cap (0 = none);
// strap = shoulder width left (only without sleeves; full = sw - nw); arm = the arm's length shoulder → wrist;
// over: how far a sleeve can run on past the wrist, over the hand; hand: its half width there, wide enough to go round
// the hand and thumb (the widest of the hand is about 7 cm past the wrist)
// sleeveL / sleeveR: each sleeve's own length (default: sleeve); waist: cm the side seams come in at the waist;
// nw: half the neck's width at the shoulder, ndF / ndB: its depth front and back, neckV: 0 round … 1 V
export const BASE = { nw: 9.6, ndF: 10.0, ndB: 2.6, sw: 19.0, ss: 4.6, ad: 23.5, cw: 25.5, hw: 26.0, L: 65.0,
  bw: 18.0, cuff: 16.8, wrist: 11.5, ease: -0.4, sleeve: 20, strap: null, arm: 58, over: 15, hand: 19, waist: 0 };
// men's regular tee on the 188 cm model
export const BASE_M = { ...BASE, nw: 10.6, ndF: 9.0, ndB: 2.6, sw: 22.6, ss: 5.0, ad: 26.0, cw: 29.0, hw: 28.5, L: 72.0,
  bw: 20.5, cuff: 19.0, wrist: 12.5, arm: 63, over: 16, hand: 22.5 };

/* ---------- 2D curves (arrays of [x, y]) ---------- */
function bez(p0, p1, p2, p3, n = 48) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push([u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]]);
  }
  return out;
}
const line = (a, b) => [a.slice(), b.slice()];
const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const plen = pts => { let s = 0; for (let i = 1; i < pts.length; i++) s += dist(pts[i - 1], pts[i]); return s; };
const rev = pts => pts.slice().reverse();
const mirror = pts => pts.map(p => [-p[0], p[1]]);
// the polyline between arc fractions t0..t1
function sub(pts, t0, t1) {
  const L = plen(pts), a = t0 * L, b = t1 * L, out = [];
  let acc = 0;
  out.push(at(pts, t0));
  for (let i = 1; i < pts.length; i++) {
    acc += dist(pts[i - 1], pts[i]);
    if (acc > a + 1e-6 && acc < b - 1e-6) out.push(pts[i].slice());
  }
  out.push(at(pts, t1));
  return out;
}
function at(pts, t) {
  const L = plen(pts) * clamp(t, 0, 1);
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = dist(pts[i - 1], pts[i]);
    if (acc + d >= L) { const k = d < 1e-9 ? 0 : (L - acc) / d; return [lerp(pts[i - 1][0], pts[i][0], k), lerp(pts[i - 1][1], pts[i][1], k)]; }
    acc += d;
  }
  return pts[pts.length - 1].slice();
}
// n equal steps (n + 1 points, ends kept)
function resample(pts, n) {
  const out = [];
  for (let i = 0; i <= n; i++) out.push(at(pts, i / n));
  return out;
}
// arc fraction where a curve going down first reaches height y
function fracAtY(pts, y) {
  const L = plen(pts);
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = dist(pts[i - 1], pts[i]);
    if (pts[i][1] <= y) { const k = (pts[i - 1][1] - y) / Math.max(1e-9, pts[i - 1][1] - pts[i][1]); return (acc + d * k) / L; }
    acc += d;
  }
  return 1;
}
const nseg = pts => Math.max(1, Math.round(plen(pts) / S));

/* ---------- the pattern ---------- */
// the +x half of a body panel, every curve in its natural direction: neck centre → shoulder, shoulder neck → out,
// armhole shoulder → underarm, side underarm → hem, hem side → centre
function bodyHalf(P, front) {
  const full = P.sw - P.nw, w = P.strap == null ? full : clamp(P.strap, 0.5, full);
  const r = sstep((full - w) / (full - 1.2));   // 0 full shoulder … 1 a thin strap (camisole)
  const shY = x => -P.ss * (x - P.nw) / full;
  // the strap moves in a little as it narrows (a thin one far out on the shoulder's slope would slide off)
  const c = lerp((P.nw + P.sw) / 2, P.nw + 3.2, r), xi = Math.max(P.nw, c - w / 2), xo = xi + w;
  const I = [xi, shY(xi)], O = [xo, shY(xo)];
  // the neckline keeps its own depth: only its width opens out to the strap (a camisole's low edge is a deep neckline)
  const nd = front ? P.ndF : P.ndB;
  const neck = bez([0, -nd], [xi * lerp(.55, .8, r), -nd], [xi, I[1] + (-nd - I[1]) * lerp(.45, .92, r)], I);
  if (P.neckV) neck.forEach((q, i) => {   // toward a V: the curve straightens into a line from the point to the shoulder
    const t = i / (neck.length - 1);
    q[0] = lerp(q[0], xi * t, P.neckV); q[1] = lerp(q[1], -nd + (I[1] + nd) * t, P.neckV);
  });
  const shoulder = line(I, O);
  const k = front ? 0.55 : 0.75;
  const ad = P.ad;
  const arm = bez(O, [O[0] - lerp(.8, 0, r), O[1] + (-ad - O[1]) * lerp(.45, .8, r)],
    [lerp(P.cw - (P.cw - P.sw + 2.2) * (1 - k) - 1.2, O[0] + (P.cw - O[0]) * .35, r), -ad + lerp(.3, .1, r)], [P.cw, -ad]);
  const L = Math.max(P.L, ad + 6), dl = L - ad;
  const side = bez([P.cw, -ad], [P.cw + .2, -ad - dl * .29], [P.hw - .3, -L + dl * .33], [P.hw, -L]);
  if (P.waist) {   // taken in round the waist (17 cm under the arm), easing out above and below
    const yw = -(ad + 17);
    for (const q of side) q[0] -= P.waist * Math.exp(-(((q[1] - yw) / 7.5) ** 2));
  }
  // the hem starts where the side seam ends (a crop's hem sits in the waist's taking-in: from P.hw it left a flap)
  const hx = side[side.length - 1][0];
  const hem = bez([hx, -L], [hx * .6, -L - .3], [hx * .2, -L - .5], [0, -L - .5]);
  return { neck, shoulder, arm, side, hem };
}

// set-in sleeve, x < 0 the front half. Cap height solved so the cap's two halves match their armholes.
function sleeveOutline(P, frontLen, backLen) {
  const bw = P.bw;
  const cap = (ch, s) => {
    const dip = s < 0 ? 0.55 : 0.4;
    return bez([0, 0], [s * bw * .42, 0], [s * bw * (1 - dip * .45), -ch * .78], [s * bw, -ch]);
  };
  let ch = 10;
  for (let i = 0; i < 60; i++) {
    const err = (frontLen + backLen + 2 * P.ease) - (plen(cap(ch, -1)) + plen(cap(ch, 1)));
    ch = Math.max(4, ch + err * .5);
  }
  // half width down a sleeve of length u: bicep at the underarm, the tee's cuff at 20 cm, a wrist at the arm's length,
  // then past the wrist out round the hand (a sleeve that narrows on would start inside the hand and pass through it).
  // Once the sleeve runs on over the hand its narrowest part draws back up the arm, clear of the thumb's root.
  const knotsOf = u => {
    const w = P.arm - clamp(u - P.arm, 0, 6);
    return [[ch, bw], [20, P.cuff], [w, P.wrist], [w + 6, Math.max(P.wrist, P.hand)]];
  };
  const halfW = (y, u) => {
    const knots = knotsOf(u);
    if (y <= knots[0][0]) return knots[0][1];
    for (let i = 1; i < knots.length; i++) if (y <= knots[i][0]) return lerp(knots[i - 1][1], knots[i][1], (y - knots[i - 1][0]) / (knots[i][0] - knots[i - 1][0]));
    return knots[knots.length - 1][1];
  };
  return { capf: cap(ch, -1), capb: cap(ch, 1), ch, halfW, knotsOf };
}

/* ---------- flat mesh of a piece ---------- */
// segs: [name, points, n, reversed] in CCW order, each starting where the last ended. Interior points sit on a lattice
// fixed to the pattern's origin, so a changed outline leaves the inside of the piece where it was.
function pieceMesh(segs) {
  const pts = [], bound = {};
  for (const [name, p, n, reversed] of segs) {
    const rs = resample(p, n), start = pts.length, idx = [];
    for (let i = 0; i < n; i++) { idx.push(start + i); pts.push(rs[i]); }
    idx.push(-1);   // = first point of the next segment
    bound[name] = { idx, reversed };
  }
  const nb = pts.length;
  const names = segs.map(s => s[0]);
  names.forEach((nm, i) => { const b = bound[nm].idx; b[b.length - 1] = bound[names[(i + 1) % names.length]].idx[0]; });
  for (const nm of names) if (bound[nm].reversed) bound[nm].idx.reverse();
  for (const nm of names) bound[nm] = bound[nm].idx;
  const poly = pts.slice();
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (const [x, y] of poly) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const h = S * Math.sqrt(3) / 2;
  for (let r = Math.ceil(y0 / h); r * h < y1; r++) {
    const y = r * h, off = (r & 1) ? S / 2 : 0;
    for (let k = Math.ceil((x0 - off) / S); k * S + off < x1; k++) {
      const p = [k * S + off, y];
      if (inside(p, poly) && minDist(p, poly) > S * .62) pts.push(p);
    }
  }
  const flat = new Float64Array(pts.length * 2);
  pts.forEach((p, i) => { flat[i * 2] = p[0]; flat[i * 2 + 1] = p[1]; });
  const del = new Delaunator(flat), con = new Constrainautor(del);
  for (let i = 0; i < nb; i++) { const j = (i + 1) % nb; if (dist(pts[i], pts[j]) > 1e-6) try { con.constrainOne(i, j); } catch (e) { /* collinear clash: leave it */ } }
  const T = del.triangles, tris = [];
  for (let t = 0; t < T.length; t += 3) {
    const a = T[t], b = T[t + 1], c = T[t + 2];
    const m = [(pts[a][0] + pts[b][0] + pts[c][0]) / 3, (pts[a][1] + pts[b][1] + pts[c][1]) / 3];
    if (inside(m, poly)) tris.push(a, b, c);
  }
  return { pts, tris, bound, nb };
}
function inside(p, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}
function minDist(p, poly) {
  let best = 1e9;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], ab = [b[0] - a[0], b[1] - a[1]];
    const t = clamp(((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / Math.max(1e-9, ab[0] * ab[0] + ab[1] * ab[1]), 0, 1);
    best = Math.min(best, Math.hypot(a[0] + ab[0] * t - p[0], a[1] + ab[1] * t - p[1]));
  }
  return best;
}

/* ---------- the whole garment ---------- */
// → { pieces: [{ name, pc, pts, tris, bound }], seams: [[kind, [pieceA, segA], [pieceB, segB]]], info }
// seam kinds: 1 shoulder, 2 armhole, 3 side, 4 sleeve underarm
export function build(params) {
  const P = { ...(params.base === 'm' ? BASE_M : BASE), ...params };
  const full = P.sw - P.nw;
  // each sleeve its own length; a sleeve shorter than this is none at all
  const uS = { l: Math.min(P.sleeveL ?? P.sleeve, P.arm + P.over), r: Math.min(P.sleeveR ?? P.sleeve, P.arm + P.over) };
  const has = { l: uS.l >= 1.2, r: uS.r >= 1.2 };
  if (has.l || has.r) P.strap = null;   // a strap only once both sleeves are gone
  const F = bodyHalf(P, true), B = bodyHalf(P, false);
  const fl = plen(F.arm), bl = plen(B.arm);
  const sl = sleeveOutline(P, fl, bl);
  // per side: how much of each armhole is sewn to the sleeve (arc fraction from the shoulder), cap cut or not
  const n = { neckF: nseg(F.neck), neckB: nseg(B.neck), sh: Math.max(1, Math.round(plen(F.shoulder) / S)), side: nseg(F.side),
    hem: nseg(F.hem), armF: nseg(F.arm), armB: nseg(B.arm) };
  const split = (nTot, t) => { const a = t <= 0 ? 0 : t >= 1 ? nTot : clamp(Math.round(nTot * t), 1, nTot - 1); return [a, nTot - a]; };
  const SD = {};
  for (const k of ['l', 'r']) {
    const u = uS[k], capCut = has[k] && u < sl.ch;
    const tf = !has[k] ? 0 : capCut ? fracAtY(sl.capf, -u) : 1, tb = !has[k] ? 0 : capCut ? fracAtY(sl.capb, -u) : 1;
    const [nfS, nfF] = split(n.armF, tf), [nbS, nbF] = split(n.armB, tb);
    SD[k] = { u, capCut, tf, tb, nfS, nfF, nbS, nbF };
  }

  // a panel's +x half (the left sleeve's side) then the other half mirrored, CCW: hem → side → armhole (free part,
  // then sewn part) → shoulder → neck → …
  function panel(H, front) {
    const arms = k => {
      const d = SD[k], [nS, nF] = front ? [d.nfS, d.nfF] : [d.nbS, d.nbF], t = front ? d.tf : d.tb;
      return { nS, nF, armS: nS ? sub(H.arm, 0, t) : null, armF: nF ? sub(H.arm, nS ? t : 0, 1) : null };
    };
    const L = arms('l'), R = arms('r');
    const nk = front ? n.neckF : n.neckB, segs = [];
    // [name, points in traversal order, n, reversed?]  (bound lists come back in the curve's natural direction)
    segs.push(['hem_p', rev(H.hem), n.hem, true], ['side_p', rev(H.side), n.side, true]);
    if (L.armF) segs.push(['armF_p', rev(L.armF), L.nF, true]);
    if (L.armS) segs.push(['armS_p', rev(L.armS), L.nS, true]);
    segs.push(['sh_p', rev(H.shoulder), n.sh, true], ['neck_p', rev(H.neck), nk, true]);
    segs.push(['neck_m', mirror(H.neck), nk, false], ['sh_m', mirror(H.shoulder), n.sh, false]);
    if (R.armS) segs.push(['armS_m', mirror(R.armS), R.nS, false]);
    if (R.armF) segs.push(['armF_m', mirror(R.armF), R.nF, false]);
    segs.push(['side_m', mirror(H.side), n.side, false], ['hem_m', mirror(H.hem), n.hem, false]);
    return pieceMesh(segs);
  }
  const pieces = [
    { name: 'front', pc: 0, ...panel(F, true) },
    { name: 'back', pc: 1, ...panel(B, false) },
  ];
  const seams = [
    [1, ['front', 'sh_p'], ['back', 'sh_p']], [1, ['front', 'sh_m'], ['back', 'sh_m']],
    [3, ['front', 'side_p'], ['back', 'side_p']], [3, ['front', 'side_m'], ['back', 'side_m']],
  ];
  for (const [k, name, pc, half] of [['l', 'sleeve_l', 2, 'p'], ['r', 'sleeve_r', 3, 'm']]) {
    if (!has[k]) continue;
    const d = SD[k], u = d.u;
    let segs;
    if (d.capCut) {
      const cf = sub(sl.capf, 0, d.tf), cb = sub(sl.capb, 0, d.tb);
      const hemN = Math.max(1, Math.round(dist(cf[cf.length - 1], cb[cb.length - 1]) / S));
      segs = [['hem', [cf[cf.length - 1], cb[cb.length - 1]], hemN, false], ['capb', rev(cb), d.nbS, true], ['capf', cf, d.nfS, false]];
    } else {
      const und = sg => { const out = []; for (let i = 0; i <= 24; i++) { const y = lerp(sl.ch, u, i / 24); out.push([sg * sl.halfW(y, u), -y]); } return out; };
      const uf = und(-1), ub = und(1), nu = nseg(uf), hw = sl.halfW(u, u);
      segs = [['hem', line([-hw, -u], [hw, -u]), Math.max(1, Math.round(2 * hw / S)), false], ['und_b', rev(ub), nu, true],
        ['capb', rev(sl.capb), d.nbS, true], ['capf', sl.capf, d.nfS, false], ['und_f', uf, nu, false]];
    }
    pieces.push({ name, pc, ...pieceMesh(segs) });
    seams.push([2, ['front', 'armS_' + half], [name, 'capf']], [2, ['back', 'armS_' + half], [name, 'capb']]);
    if (!d.capCut) seams.push([4, [name, 'und_b'], [name, 'und_f']]);
  }
  const sleeve = { ch: sl.ch, bw: P.bw, u: Math.max(uS.l, uS.r), uL: uS.l, uR: uS.r, knotsL: sl.knotsOf(uS.l), knotsR: sl.knotsOf(uS.r) };
  // where the hem and the shoulder sit (cm below the high shoulder point), for the site's edit points
  return { pieces, seams, info: { P, sleeve, full, has, hemL: P.L + .5 } };
}
