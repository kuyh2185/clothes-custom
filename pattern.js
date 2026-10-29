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
// sleeveL / sleeveR: each sleeve's own length (default: sleeve); fit: { w, y0, q } a fitted side seam (see bodyHalf);
// nw: half the neck's width at the shoulder, ndF / ndB: its depth front and back, neckV: 0 round … 1 V
export const BASE = { nw: 9.6, ndF: 10.0, ndB: 2.6, sw: 19.0, ss: 4.6, ad: 23.5, cw: 25.5, hw: 26.0, L: 65.0,
  bw: 18.0, cuff: 16.8, wrist: 11.5, ease: -0.4, sleeve: 20, strap: null, arm: 58, over: 15, hand: 19, fit: null };
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
export function resample(pts, n) {
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
// fitted (P.fit = { w, y0, q }, q[i] the body's quarter round i cm below y0): the side seam's x at depth y follows
// the body's outline from the underarm, w of the way from the tee's straight side x0. Slim (ws, before w): ws of the
// way in to the waist with that outline, but below the waist it keeps the waist's width until the hips come within
// 2 cm of it: kept the underarm's ease down the hip slope, a crop's hem stood off the body in a flare. Never out past
// x0, and soft min / max (none at the underarm, where they start together) so the side doesn't turn corners.
// The flare is all let out by 7 cm above the hem, the hem's last few cm then keep to the body as the cloth above them
// does: let out toward the hem itself (on a fitted knit that clings above), the side seam kicked out into an ear
export function fitSide(P, y, x0) {
  const { w, ws = 0, y0, q } = P.fit, L = Math.max(P.L, P.ad + 6);
  const qa = y => { const i = clamp(y - y0, 0, q.length - 1.001), j = Math.floor(i); return lerp(q[j], q[j + 1], i - j); };
  const fl = (P.flare || 0) * sstep((y - P.ad) / Math.max(1, L - 7 - P.ad)), t = P.cw + qa(y) - qa(P.ad) + fl;
  if (!ws) return lerp(x0, t, w);
  const k = 4 * clamp((y - P.ad) / 6, 0, 1), sm = (a, b, d, j = k) => (a + b + d * Math.sqrt((a - b) * (a - b) + j * j)) / 2;
  let lo = qa(P.ad);
  for (let v = P.ad; v < y; v++) lo = Math.min(lo, qa(v));
  lo = Math.min(lo, qa(y));
  const ease = clamp(P.cw - qa(P.ad), 0, 2);
  const slim = sm(x0, sm(P.cw + lo - qa(P.ad), qa(y) + ease, 1, k * 2) + fl, -1);
  return lerp(lerp(x0, slim, ws), t, w);
}
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
    [lerp(P.cw - (P.cw - P.sw + 2.2) * (1 - k) - 3.5, O[0] + (P.cw - O[0]) * .35, r), -ad], [P.cw, -ad]);
  const L = Math.max(P.L, ad + 6);
  const sideTo = Ls => {
    // (P.bx: the body's own width under the arm, when it is cut wider or narrower than the sleeves' underarm P.cw)
    const dl = Ls - ad, s = bez([P.cw, -ad], [P.bx ?? P.cw, -ad - dl * .29], [P.hw - .3, -Ls + dl * .33], [P.hw, -Ls]);
    if (P.fit) for (const p of s) p[0] = fitSide(P, -p[1], p[0]);
    return s;
  };
  // the hem leaves the side seam square to it: a side running out at the hem (a fitted crop over the hips) met by a
  // straight hem made a sharp corner on each panel, and the two sewn together a point that folded up at the side.
  // The corner rises by what squaring takes (m: cm out per cm down at the hem), the centre stays at the length.
  // A side running in (a fitted crop above the waist) the other way: its corner drops, the hem rising from it to the
  // centre. Left straight, the two blunt corners sewn together made a notch up at the side that sometimes folded up
  // 3 cm, by the mesh alone (fuzz 128: 34.5 cm long sat, 34.75 folded)
  const end = s => { const a = s[s.length - 2], b = s[s.length - 1]; return (b[0] - a[0]) / Math.max(.01, a[1] - b[1]); };
  const s0 = sideTo(L), hx0 = s0[s0.length - 1][0], m0 = end(s0);
  const d = m0 < 0 ? .5 + Math.max(-3, m0 * hx0 * .45) : clamp(m0 * hx0 * .45, .5, 3);
  let side = d !== .5 ? sideTo(L + .5 - d) : s0;
  // a side seam running far out (a flared hem) is longer than the drop it hangs from: hung, it fell straight down and
  // its corner hung below the hem in a point. The corner rises until the seam, measured straight underarm → corner, is
  // as long as that drop, the hem curving up to it as a flared skirt's does. Only outward: a side taken in is held by the
  // body, and a fitted side's curve in to the waist and out again lies on it. (The run is the corner's before rising, a
  // little more than after: a flare rises a little more than it must, and the corner at most to 1.5 cm under the arm)
  const cr = side[side.length - 1], dl = L + .5 - d - ad, run = Math.max(0, cr[0] - Math.max(P.cw, P.bx ?? P.cw));
  const rise = dl - Math.sqrt(Math.max(2.25, dl * dl - run * run));
  if (rise >= .3) side = sideTo(L + .5 - d - rise);
  // the hem starts where the side seam ends (a fitted crop's hem sits in the waist: from P.hw it left a flap)
  const cn = side[side.length - 1], hx = cn[0], m = end(side), h = m > 1e-3 ? Math.min(hx * .45, Math.max(d, .5) / m) : hx * .45;
  const hem = bez(cn, [hx - h, cn[1] - h * m], [hx * .2, -L - .5], [0, -L - .5]);
  return { neck, shoulder, arm, side, hem };
}

// set-in sleeve, x < 0 the front half. Cap height solved so the cap's two halves match their armholes.
// fitted (P.fit.arm[y] = the arm's half round y cm down the sleeve): the sleeve is cut to the arm, P.fit.wa of the way
function sleeveOutline(P, frontLen, backLen, chMax) {
  const fa = P.fit && P.fit.arm, fw = fa ? P.fit.wa ?? P.fit.w : 0;
  const armAt = y => { const i = clamp(y, 0, fa.length - 1.001), j = Math.floor(i); return lerp(fa[j], fa[j + 1], i - j); };
  let bw = P.bw;
  const cap = (ch, s) => {
    const dip = s < 0 ? 0.55 : 0.4;
    return bez([0, 0], [s * bw * .42, 0], [s * bw * (1 - dip * .6), -ch], [s * bw, -ch]);
  };
  let ch = 10;
  const solve = () => {
    for (let i = 0; i < 60; i++) {
      const err = (frontLen + backLen + 2 * P.ease) - (plen(cap(ch, -1)) + plen(cap(ch, 1)));
      ch = Math.max(4, ch + err * .5);
    }
  };
  solve();
  // a fitted sleeve: as narrow as the arm round the underarm (the arm a little below the shoulder, at 0.6 of the
  // armhole's depth: nearer the shoulder its slices take in the deltoid), its cap as much taller (a set-in sleeve's)
  if (fw > 0) {
    bw = lerp(P.bw, Math.min(P.bw, armAt(P.ad * .6)), fw); solve();
    chMax = lerp(chMax, Math.max(chMax, ch), fw);
  }
  // a deep, dropped armhole (a wide body) would want a cap nearly as tall as a short sleeve, which then stands off the
  // arm and rolls up: as on a real oversized tee the cap stays low and the sleeve gets wider instead
  if (ch > chMax) {
    ch = chMax;
    for (let i = 0; i < 60; i++) {
      const err = (frontLen + backLen + 2 * P.ease) - (plen(cap(ch, -1)) + plen(cap(ch, 1)));
      bw = Math.max(P.bw, bw + err * .25);
    }
  }
  // a sleeve widened for its cap is as much wider at the short sleeve's hem (else it narrows sharply under the arm)
  const cuff = P.cuff + (bw - P.bw);
  // half width down a sleeve of length u: bicep at the underarm, the tee's cuff at 20 cm, a wrist at the arm's length,
  // then past the wrist out round the hand (a sleeve that narrows on would start inside the hand and pass through it).
  // Once the sleeve runs on over the hand its narrowest part draws back up the arm, clear of the thumb's root.
  // Fitted, the knots run down the arm every 3 cm to the wrist (the hand's part is the tee's: it has to go over the hand)
  // (letting go again as the sleeve runs on toward the hand: past the wrist it has to go round the hand)
  const ribK = u => { const w = P.arm - clamp(u - P.arm, 0, 6); return P.rib && u < w - .5 ? sstep((u - P.rib.e) / 8) * sstep((w - .5 - u) / 3) : 0; };
  // where the cuff starts coming in (sleeve cm), or null: the cloth lays it round the arm afresh (cloth.js)
  const ribAt = u => ribK(u) > 0 ? Math.max(ch + 1, u - 5) : null;
  // A long sleeve ending on the forearm or at the wrist closes in over its last 5 cm to a rib cuff round the arm there
  // (P.rib = { r: half the arm's round + the rib's ease by sleeve cm, e: sleeve cm where it starts to come in}); a
  // tee's straight sleeve hung open round the thin wrist like a bell
  const knotsOf = u => {
    const w = P.arm - clamp(u - P.arm, 0, 6);
    const tee = [[ch, bw], [Math.max(20, ch + 10), cuff], [w, P.wrist], [w + 6, Math.max(P.wrist, P.hand)]];
    let out = tee;
    if (fw) {
      const at = y => { for (let i = 1; i < 3; i++) if (y <= tee[i][0]) return lerp(tee[i - 1][1], tee[i][1], (y - tee[i - 1][0]) / (tee[i][0] - tee[i - 1][0])); return tee[2][1]; };
      out = [[ch, bw]];
      // (no wider than the underarm down the upper arm, where the slices still take in some of the shoulder)
      for (let y = ch + 3; y < w - 1.5; y += 3) out.push([y, Math.min(y < 25 ? bw : 99, lerp(at(y), Math.min(at(y), armAt(y)), fw))]);
      out.push([w, lerp(P.wrist, Math.min(P.wrist, armAt(w)), fw)], tee[3]);
    }
    const k = ribK(u);
    if (k > 0) {
      const at = y => { for (let i = 1; i < out.length; i++) if (y <= out[i][0]) return lerp(out[i - 1][1], out[i][1], (y - out[i - 1][0]) / (out[i][0] - out[i - 1][0])); return out[out.length - 1][1]; };
      const ri = j => P.rib.r[clamp(Math.round(j), 0, P.rib.r.length - 1)];
      const r = Math.min(ri(u), ri(u - 2), ri(u - 4)), y0 = Math.max(ch + 1, u - 5);   // the wrist, if the end is just past it
      out = [...out.filter(q => q[0] < y0), [y0, at(y0)], [u, lerp(at(u), Math.min(at(u), r), k)], ...out.filter(q => q[0] > u)];
    }
    return out;
  };
  const halfW = (y, u) => {
    const knots = knotsOf(u);
    if (y <= knots[0][0]) return knots[0][1];
    for (let i = 1; i < knots.length; i++) if (y <= knots[i][0]) return lerp(knots[i - 1][1], knots[i][1], (y - knots[i - 1][0]) / (knots[i][0] - knots[i - 1][0]));
    return knots[knots.length - 1][1];
  };
  return { capf: cap(ch, -1), capb: cap(ch, 1), ch, bw, halfW, knotsOf, ribAt };
}

/* ---------- the outline drawn by hand ---------- */
// P.edit: bumps pulled on the outline by hand, per half: Fp / Fm / Bp / Bm (front / back; the +x half, the −x half in
// its own mirrored frame), Sl / Sr (a sleeve, its front and back halves alike). A bump [curve, t, dx, dy, r] moves the
// point t of the way along that curve dx out from the centre line and dy up (cm), the outline r cm along either side
// of it following smoothly. A body half's chain runs neck → shoulder → armhole → side → hem, a sleeve's underarm → hem
// (its +x half); where a chain meets the centre line it stays on it, and a sleeve's underarm stays put (the cap is
// cut to its armhole). Seams keep matching: side, shoulder and armhole are moved front and back together (studio.js).
// A bump with a sixth element (local) keeps to its own curve and holds where it meets a seam: a neckline or hem pulled
// on the front alone, its corner sewn to the back's stays put
const fall = d => d < 1 ? (1 - d * d) ** 2 : 0;
const dense = pts => {   // at most 0.5 cm apart, the curve's own points kept
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const n = Math.ceil(dist(pts[i - 1], pts[i]) / .5);
    for (let k = 1; k <= n; k++) out.push([lerp(pts[i - 1][0], pts[i][0], k / n), lerp(pts[i - 1][1], pts[i][1], k / n)]);
  }
  return out;
};
const hasEdit = b => b && b.some(e => e[2] || e[3]);
// chain: { name: points } in order, each starting where the last ended → the same, bent; sleeve: its underarm end held.
// other: the other half's own neckline and hem bumps (pulled with 왼쪽·오른쪽 같이 off), carried over the centre line
// mirrored, so the two halves still meet there (else a hem pulled down near the middle stepped at it)
function bend(chain, bumps, sleeve, other = []) {
  const names = Object.keys(chain), len = names.map(k => plen(chain[k])), tot = len.reduce((a, b) => a + b, 0), s0 = {};
  names.reduce((a, k, i) => { s0[k] = a; return a + len[i]; }, 0);
  const sAt = (k, t) => s0[k] + clamp(t, 0, 1) * len[names.indexOf(k)];
  const B = [...bumps.filter(e => e[0] in s0).map(([k, t, dx, dy, r, local]) => [sAt(k, t), dx, dy, r, local && k]),
    ...other.filter(e => e[0] in s0 && (e[0] === 'neck' || e[0] === 'hem')).map(([k, t, dx, dy, r, local]) => [k === 'neck' ? -sAt(k, t) : 2 * tot - sAt(k, t), -dx, dy, r, local && k])];
  const out = {};
  for (const k of names) {
    let s = s0[k];
    const e = s0[k] + len[names.indexOf(k)];
    out[k] = dense(chain[k]).map((p, j, a) => {
      if (j) s += dist(a[j - 1], p);
      let dx = 0, dy = 0;
      for (const [sb, bx, by, r, own] of B) {
        if (own && own !== k) continue;
        // (held at the seam end: the hem's side end, the neckline's shoulder end)
        const w = fall(Math.abs(s - sb) / r) * (!own ? 1 : k === 'hem' ? sstep((s - s0[k]) / 3) : sstep((e - s) / 3));
        dx += bx * w; dy += by * w;
      }
      const hold = sstep(s / 3), end = sstep((tot - s) / 3);
      return sleeve ? [p[0] + dx * hold * end, p[1] + dy * hold] : [p[0] + dx * hold * end, p[1] + dy];
    });
  }
  return out;
}
const edited = (H, bumps = [], other = []) => hasEdit(bumps) || hasEdit(other) ? { ...H, ...bend({ neck: H.neck, shoulder: H.shoulder, arm: H.arm, side: H.side, hem: H.hem }, bumps, false, other) } : H;
// the bumps in a that b hasn't (pulled on a's half alone)
const solo = (a = [], b = []) => { const s = new Set(b.map(e => e.join())); return a.filter(e => !s.has(e.join())); };
// where each bump sits on the pattern, for the checks (an outline drawn by hand stands where it was drawn): [pc, x, y, r]
const bumpsAt = (H, bumps, pc, sg) => (hasEdit(bumps) ? bumps : []).filter(e => H[e[0]]).map(([k, t, , , r]) => { const p = at(H[k], t); return [pc, sg * p[0], p[1], r]; });
// the four body halves as cut: front / back, the +x half and the −x half (each in its own +x frame), with the bumps on
export function halves(params) {
  const P = { ...(params.base === 'm' ? BASE_M : BASE), ...params };
  const uS = { l: Math.min(P.sleeveL ?? P.sleeve, P.arm + P.over), r: Math.min(P.sleeveR ?? P.sleeve, P.arm + P.over) };
  if (uS.l >= 1.2 || uS.r >= 1.2) P.strap = null;   // a strap only once both sleeves are gone
  const F = bodyHalf(P, true), B = bodyHalf(P, false), E = P.edit || {};
  return { P, uS, F, B, Fp: edited(F, E.Fp, solo(E.Fm, E.Fp)), Fm: edited(F, E.Fm, solo(E.Fp, E.Fm)), Bp: edited(B, E.Bp, solo(E.Bm, E.Bp)), Bm: edited(B, E.Bm, solo(E.Bp, E.Bm)) };
}
// a sleeve's +x half as cut (underarm → hem → the middle line), its bumps on; null: a cap cut short, no underarm
function sleeveHalf(sl, u, bumps) {
  if (u < sl.ch) return null;
  const und = [];
  for (let i = 0; i <= 24; i++) { const y = lerp(sl.ch, u, i / 24); und.push([sl.halfW(y, u), -y]); }
  const H = { und, hem: line([sl.halfW(u, u), -u], [0, -u]) };
  return hasEdit(bumps) ? { ...bend(H, bumps, true), edited: true } : H;
}
// the body halves and the sleeves as cut: sl l / r each sleeve's outline (its cap cut to its own side's armhole: the
// left sleeve to the +x halves'), l / r { H with its bumps, H0 without } or null
export function sleeves(params) {
  const h = halves(params), { P, uS } = h, E = P.edit || {};
  // the cap no taller than about half the regular armhole's depth
  const chMax = (params.base === 'm' ? BASE_M : BASE).ad * .5 + 1, lf = plen(h.Fp.arm), lb = plen(h.Bp.arm), rf = plen(h.Fm.arm), rb = plen(h.Bm.arm);
  const l = sleeveOutline(P, lf, lb, chMax), sl = { l, r: lf === rf && lb === rb ? l : sleeveOutline(P, rf, rb, chMax) };
  const side = (s, u, b) => { const H0 = sleeveHalf(s, u); return H0 && { H0, H: hasEdit(b) ? sleeveHalf(s, u, b) : H0 }; };
  return { h, sl, l: side(sl.l, uS.l, E.Sl), r: side(sl.r, uS.r, E.Sr) };
}
// a half's outline still a piece: it doesn't cross itself or the centre line, and (q: the body's quarter round by depth)
// a side taken in stops 1 cm over the body, or where it was if it was already in further; and the armhole stays within
// 25% of the uncut one's length (base): the sleeve's cap is cut to it, and a zigzag along it made the sleeve half as wide
// again (now a quarter at most)
export function halfOk(H, H0, q, base) {
  if (base && Math.abs(plen(H.arm) / plen(base.arm) - 1) > .25) return false;
  const pts = [];
  for (const k of ['neck', 'shoulder', 'arm', 'side', 'hem']) {
    const r = resample(H[k], Math.max(1, Math.round(plen(H[k]))));
    for (const p of pts.length ? r.slice(1) : r) pts.push(p);
  }
  // (the curves' own points too: resampled, a pull beside the middle crossing it by 3 mm went unseen, and the tiny loop
  // left a point out of every triangle, falling on its own: fuzz 252, 283)
  if (pts.some(p => p[0] < -.01) || ['neck', 'shoulder', 'arm', 'side', 'hem'].some(k => H[k].some(p => p[0] < -.01) || folds(H[k]))) return false;
  for (let i = 1; i < pts.length; i++) for (let j = i + 2; j < pts.length; j++) if (cross(pts[i - 1], pts[i], pts[j - 1], pts[j])) return false;
  // the neckline no higher than the high shoulder point, or the shoulder line beside it pulled up (over it, it stood up
  // off the neck in a flap; a back neck pulled near flat, its corner lowered a little, may stay a little over the corner)
  const sh = H.shoulder, shY = x => { if (x <= sh[0][0]) return sh[0][1]; for (let i = 1; i < sh.length; i++) if (sh[i][0] >= x) return lerp(sh[i - 1][1], sh[i][1], (x - sh[i - 1][0]) / Math.max(1e-9, sh[i][0] - sh[i - 1][0])); return sh[sh.length - 1][1]; };
  if (H.neck.some(([x, y]) => y > Math.max(0, shY(x)) + .05)) return false;
  if (base) {
    // the shoulder line within 1.5 cm of the uncut one (past its end, lower as far again as it reaches out: the arm
    // falls away there). Further down the shoulder seam sat inside the body and the cloth went through it (fuzz 117);
    // further up it stood off the shoulder, and settling down onto it hitched that side's hem up 4 cm (fuzz 186)
    const [a, b] = [base.shoulder[0], base.shoulder.at(-1)], y0 = x => a[1] + (b[1] - a[1]) * (x - a[0]) / Math.max(1e-9, b[0] - a[0]);
    if (H.shoulder !== base.shoulder && H.shoulder.some(([x, y]) => y < y0(x) - 1.5 - Math.max(0, x - b[0]) || y > y0(x) + 1.5)) return false;
    // and the armhole turns in no steeper than 45° going down: steeper, the shoulder's end stood out over it like
    // eaves, up off the sleeve sewn under it: fuzz 57 (only where the uncut one doesn't already)
    // (its upper half: low down a side pulled in draws the armhole's end in across, which is no eaves)
    const steep = c => { const r = resample(c, Math.max(2, Math.round(plen(c)))); return r.some((p, i) => i && i <= r.length / 2 && r[i - 1][0] - p[0] > r[i - 1][1] - p[1] + .3); };
    if (H.arm !== base.arm && steep(H.arm) && !steep(base.arm)) return false;
    // a side or armhole pulled out running across no flatter than 45°, or than it was cut: flatter, the seam stood out
    // level and the cloth added there folded down through itself, as a hem flared past 45° did (studio.js flareLim):
    // fuzz 237, 125, 229 (the user's choice, 2026-10-29, over raising the self-crossing limit by the bump). Only where it
    // stands out past the cut: taken in, it lies on the body (an armhole's middle pulled in only scoops it deeper)
    for (const k of ['side', 'arm']) {
      if (H[k] === base[k]) continue;
      const n = Math.max(2, Math.round(plen(base[k]))), e = resample(H[k], n), o = resample(base[k], n);
      for (let i = 1; i < n; i++) if ((e[i][0] > o[i][0] + .1 || e[i - 1][0] > o[i - 1][0] + .1)
        && Math.abs(e[i][0] - e[i - 1][0]) > Math.max(e[i - 1][1] - e[i][1], Math.abs(o[i][0] - o[i - 1][0])) + .05) return false;
    }
  }
  if (q && H.side !== H0.side) {
    const x0 = y => { const s = H0.side; for (let i = 1; i < s.length; i++) if (s[i][1] <= y) return lerp(s[i - 1][0], s[i][0], (s[i - 1][1] - y) / Math.max(1e-9, s[i - 1][1] - s[i][1])); return s[s.length - 1][0]; };
    for (const [x, y] of H.side) {
      const d = Math.round(-y);
      if (d >= 0 && d < q.length && x < Math.min(x0(y), q[d] + 1) - .05) return false;
    }
  }
  return true;
}
// a sleeve's half the same way (cap: its cap's half above it, the underarm's start): it doesn't cross itself or the
// middle line, an underarm taken in stops 1 cm over the arm's half round (ar: the arm's full round by sleeve cm) or
// where it was, and nothing hangs past the longest sleeve (lo cm down)
export function sleeveOk(H, H0, cap, ar, lo, base) {
  const pts = [];
  for (const c of [cap, H.und, H.hem]) {
    const r = resample(c, Math.max(1, Math.round(plen(c))));
    for (const p of pts.length ? r.slice(1) : r) pts.push(p);
  }
  if (pts.some(p => p[0] < -.01 || p[1] < -lo) || [H.und, H.hem].some(c => c.some(p => p[0] < -.01) || folds(c))) return false;
  for (let i = 1; i < pts.length; i++) for (let j = i + 2; j < pts.length; j++) if (cross(pts[i - 1], pts[i], pts[j - 1], pts[j])) return false;
  // the underarm pulled out no flatter than 45° or than it was cut (base: the sleeve uncut), as a body's side (halfOk):
  // a 5부 sleeve's underarm pulled 9 cm out folded its spare cloth through itself under the arm (fuzz 179)
  if (base && H.und !== base.und) {
    const n = Math.max(2, Math.round(plen(base.und))), e = resample(H.und, n), o = resample(base.und, n);
    for (let i = 1; i < n; i++) if ((e[i][0] > o[i][0] + .1 || e[i - 1][0] > o[i - 1][0] + .1)
      && Math.abs(e[i][0] - e[i - 1][0]) > Math.max(e[i - 1][1] - e[i][1], Math.abs(o[i][0] - o[i - 1][0])) + .05) return false;
  }
  if (ar && H.und !== H0.und) {
    const u = H0.und, x0 = y => { for (let i = 1; i < u.length; i++) if (u[i][1] <= y) return lerp(u[i - 1][0], u[i][0], (u[i - 1][1] - y) / Math.max(1e-9, u[i - 1][1] - u[i][1])); return u[u.length - 1][0]; };
    for (const [x, y] of H.und) {
      const d = Math.round(-y);
      if (d < ar.length && ar[d] > 0 && x < Math.min(x0(y), ar[d] / 2 + 1) - .05) return false;
    }
  }
  return true;
}
// a curve turning back on itself (over 120° from one point to the next): bumps side by side pulling a seam down by
// different amounts folded it into a Z a millimetre across, lying along itself where no two segments cross, and the
// mesh left a point out of every triangle there: fuzz 26
const folds = c => c.some((p, i) => {
  if (i < 2) return false;
  const ax = c[i - 1][0] - c[i - 2][0], ay = c[i - 1][1] - c[i - 2][1], bx = p[0] - c[i - 1][0], by = p[1] - c[i - 1][1];
  return ax * bx + ay * by < -.5 * Math.hypot(ax, ay) * Math.hypot(bx, by);
});
const cross = (a, b, c, d) => {
  const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
};

/* ---------- flat mesh of a piece ---------- */
// segs: [name, points, n, reversed] in CCW order, each starting where the last ended. Interior points sit on a lattice
// fixed to the pattern's origin, so a changed outline leaves the inside of the piece where it was.
function pieceMesh(segs) {
  const pts = [], bound = {}, hinge = [];
  for (const [name, p, n, reversed] of segs) {
    const rs = resample(p, n), start = pts.length, idx = [];
    if (name === 'side_p' || name === 'hem_m') hinge.push(start);   // a body panel's hem side corners
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
  // a straight run of the outline (a sleeve's hem) leaves triangles of no area along it, three points in a line: their
  // long side is a stiff strut along the run, and rolled round the arm the hem's corner was thrown across it. Each is
  // flipped away into the triangle across its long side, which the middle point then splits in two
  for (let it = 0, again = true; again && it < tris.length; it++) {
    again = false;
    for (let t = 0; t < tris.length; t += 3) {
      const v = [tris[t], tris[t + 1], tris[t + 2]], P3 = v.map(i => pts[i]);
      const ar = Math.abs((P3[1][0] - P3[0][0]) * (P3[2][1] - P3[0][1]) - (P3[2][0] - P3[0][0]) * (P3[1][1] - P3[0][1]));
      const len = [0, 1, 2].map(k => dist(P3[(k + 1) % 3], P3[(k + 2) % 3])), k = len.indexOf(Math.max(...len));
      if (ar > 1e-4 * len[k] * len[k]) continue;
      const r = v[k], p = v[(k + 1) % 3], q = v[(k + 2) % 3];
      tris.splice(t, 3);
      for (let u = 0; u < tris.length; u += 3) {
        const w = [tris[u], tris[u + 1], tris[u + 2]], j = w.findIndex((x, i) => x === q && w[(i + 1) % 3] === p);
        if (j < 0) continue;
        const x = w[(j + 2) % 3];
        tris.splice(u, 3, q, r, x, r, p, x);
        break;
      }
      again = true;
      break;
    }
  }
  // a hem's side corner held by one triangle is a hinge: it flipped over into a small flap folded up 3 cm, or not, by
  // the mesh alone (fuzz 128, 394: a fitted crop 34.5 cm long sat, 34.6 folded). Its far side is flipped with the
  // triangle across it, so the corner holds two. Only there: done to every such corner (the neck's, the sleeves'),
  // some tops never settled (fuzz 64, 112, 160)
  const cr = (a, b, c) => (pts[b][0] - pts[a][0]) * (pts[c][1] - pts[a][1]) - (pts[c][0] - pts[a][0]) * (pts[b][1] - pts[a][1]);
  for (const v of hinge) {
    const ts = [];
    for (let t = 0; t < tris.length; t += 3) if (tris[t] === v || tris[t + 1] === v || tris[t + 2] === v) ts.push(t);
    if (ts.length !== 1) continue;
    const t = ts[0], j = [0, 1, 2].find(k => tris[t + k] === v), p = tris[t + (j + 1) % 3], q = tris[t + (j + 2) % 3];
    for (let u = 0; u < tris.length; u += 3) {
      const w = [tris[u], tris[u + 1], tris[u + 2]], i = w.findIndex((x, k) => x === q && w[(k + 1) % 3] === p);
      if (i < 0) continue;
      const x = w[(i + 2) % 3];
      const s = cr(v, p, q);
      if (cr(v, p, x) * s > 0 && cr(v, x, q) * s > 0) tris.splice(t, 3, v, p, x), tris.splice(u, 3, v, x, q);   // only where the four make a convex quad
      break;
    }
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
  // each sleeve its own length; a sleeve shorter than this is none at all (a strap only once both are gone: halves)
  const { h: { P, uS, Fp: F, Fm, Bp: B, Bm }, sl, ...SH } = sleeves(params), full = P.sw - P.nw;
  const has = { l: uS.l >= 1.2, r: uS.r >= 1.2 };
  const E = P.edit || {}, bumps = [...bumpsAt(F, E.Fp, 0, 1), ...bumpsAt(Fm, E.Fm, 0, -1), ...bumpsAt(B, E.Bp, 1, 1), ...bumpsAt(Bm, E.Bm, 1, -1)];
  for (const [k, pc] of [['l', 2], ['r', 3]]) if (has[k] && SH[k] && SH[k].H.edited) for (const sg of [1, -1]) bumps.push(...bumpsAt(SH[k].H, E['S' + k], pc, sg));
  // per side (l the +x halves, r the −x): segment counts, the same front and back where they are sewn, and how much of
  // each armhole is sewn to the sleeve (arc fraction from the shoulder), cap cut or not
  const cnt = (Fh, Bh) => ({ neckF: nseg(Fh.neck), neckB: nseg(Bh.neck), sh: Math.max(1, Math.round(plen(Fh.shoulder) / S)), side: nseg(Fh.side), armF: nseg(Fh.arm), armB: nseg(Bh.arm) });
  const n = { l: cnt(F, B), r: cnt(Fm, Bm) };
  const split = (nTot, t) => { const a = t <= 0 ? 0 : t >= 1 ? nTot : clamp(Math.round(nTot * t), 1, nTot - 1); return [a, nTot - a]; };
  const SD = {};
  for (const k of ['l', 'r']) {
    const u = uS[k], s = sl[k], capCut = has[k] && u < s.ch;
    const tf = !has[k] ? 0 : capCut ? fracAtY(s.capf, -u) : 1, tb = !has[k] ? 0 : capCut ? fracAtY(s.capb, -u) : 1;
    const [nfS, nfF] = split(n[k].armF, tf), [nbS, nbF] = split(n[k].armB, tb);
    SD[k] = { u, capCut, tf, tb, nfS, nfF, nbS, nbF };
  }

  // a panel's +x half (the left sleeve's side) then the other half mirrored, CCW: hem → side → armhole (free part,
  // then sewn part) → shoulder → neck → …
  function panel(H, Hm, front) {
    const arms = (k, A) => {
      const d = SD[k], [nS, nF] = front ? [d.nfS, d.nfF] : [d.nbS, d.nbF], t = front ? d.tf : d.tb;
      return { nS, nF, armS: nS ? sub(A, 0, t) : null, armF: nF ? sub(A, nS ? t : 0, 1) : null };
    };
    const L = arms('l', H.arm), R = arms('r', Hm.arm);
    const nl = n.l, nr = n.r, segs = [];
    // [name, points in traversal order, n, reversed?]  (bound lists come back in the curve's natural direction)
    segs.push(['hem_p', rev(H.hem), nseg(H.hem), true], ['side_p', rev(H.side), nl.side, true]);
    if (L.armF) segs.push(['armF_p', rev(L.armF), L.nF, true]);
    if (L.armS) segs.push(['armS_p', rev(L.armS), L.nS, true]);
    segs.push(['sh_p', rev(H.shoulder), nl.sh, true], ['neck_p', rev(H.neck), front ? nl.neckF : nl.neckB, true]);
    segs.push(['neck_m', mirror(Hm.neck), front ? nr.neckF : nr.neckB, false], ['sh_m', mirror(Hm.shoulder), nr.sh, false]);
    if (R.armS) segs.push(['armS_m', mirror(R.armS), R.nS, false]);
    if (R.armF) segs.push(['armF_m', mirror(R.armF), R.nF, false]);
    segs.push(['side_m', mirror(Hm.side), nr.side, false], ['hem_m', mirror(Hm.hem), nseg(Hm.hem), false]);
    return pieceMesh(segs);
  }
  const pieces = [
    { name: 'front', pc: 0, ...panel(F, Fm, true) },
    { name: 'back', pc: 1, ...panel(B, Bm, false) },
  ];
  const seams = [
    [1, ['front', 'sh_p'], ['back', 'sh_p']], [1, ['front', 'sh_m'], ['back', 'sh_m']],
    [3, ['front', 'side_p'], ['back', 'side_p']], [3, ['front', 'side_m'], ['back', 'side_m']],
  ];
  for (const [k, name, pc, half] of [['l', 'sleeve_l', 2, 'p'], ['r', 'sleeve_r', 3, 'm']]) {
    if (!has[k]) continue;
    const d = SD[k], u = d.u, s = sl[k];
    let segs;
    if (d.capCut) {
      const cf = sub(s.capf, 0, d.tf), cb = sub(s.capb, 0, d.tb);
      const hemN = Math.max(1, Math.round(dist(cf[cf.length - 1], cb[cb.length - 1]) / S));
      segs = [['hem', [cf[cf.length - 1], cb[cb.length - 1]], hemN, false], ['capb', rev(cb), d.nbS, true], ['capf', cf, d.nfS, false]];
    } else {
      // (the +x half pulled by hand: the −x half alike, its hem both halves of the one edge)
      const H = SH[k].H, ub = H.und, uf = mirror(ub), nu = nseg(uf), hem = H.edited ? [...mirror(H.hem), ...rev(H.hem).slice(1)] : line([-ub.at(-1)[0], -u], [ub.at(-1)[0], -u]);
      segs = [['hem', hem, Math.max(1, Math.round(plen(hem) / S)), false], ['und_b', rev(ub), nu, true],
        ['capb', rev(s.capb), d.nbS, true], ['capf', s.capf, d.nfS, false], ['und_f', uf, nu, false]];
    }
    // (an outline pulled by hand: the cloth lays each row of the sleeve round the arm as wide as the row is cut)
    pieces.push({ name, pc, ...pieceMesh(segs), ...(!d.capCut && SH[k].H.edited && { und: SH[k].H.und }) });
    seams.push([2, ['front', 'armS_' + half], [name, 'capf']], [2, ['back', 'armS_' + half], [name, 'capb']]);
    if (!d.capCut) seams.push([4, [name, 'und_b'], [name, 'und_f']]);
  }
  const sleeve = { chL: sl.l.ch, chR: sl.r.ch, u: Math.max(uS.l, uS.r), uL: uS.l, uR: uS.r, knotsL: sl.l.knotsOf(uS.l), knotsR: sl.r.knotsOf(uS.r), ribL: sl.l.ribAt(uS.l), ribR: sl.r.ribAt(uS.r) };
  // where the hem and the shoulder sit (cm below the high shoulder point), for the site's edit points
  return { pieces, seams, info: { P, sleeve, full, has, hemL: P.L + .5, bumps } };
}
