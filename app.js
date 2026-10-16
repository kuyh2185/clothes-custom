'use strict';
/* 고쳐 입기 — garments are SVG paths generated from a few parameters (neck depth/width/shape,
   lengths, fit, fill, damage spots, print). Tools edit those parameters by clicking and dragging.
   Coordinates are in the stage's viewBox (400 wide, body centred on x=200, head at the top). */
(() => {
const STORE = 'clothes-custom:v1';
const CX = 200;
const $ = s => document.querySelector(s);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const clone = o => JSON.parse(JSON.stringify(o));
const r1 = n => Math.round(n * 10) / 10;
const mir = p => [400 - p[0], p[1]];
// every garment and mannequin point is written through pt(), which places it on the posed body (see "pose")
const pt = p => { const q = at(p); return r1(q[0]) + ' ' + r1(q[1]); };
const mix = (p, q, t) => [lerp(p[0], q[0], t), lerp(p[1], q[1], t)];

/* ---------- body measurements: [y, value] tables ---------- */
function table(t, y) {
  if (y <= t[0][0]) return t[0][1];
  for (let i = 1; i < t.length; i++) if (y <= t[i][0]) {
    const [a, va] = t[i - 1], [b, vb] = t[i];
    return va + (vb - va) * (y - a) / (b - a);
  }
  return t[t.length - 1][1];
}
/* Mannequin bodies from fashion-model proportions (runway measurements + 9-head croquis landmarks,
   see ideastorage/clothes-custom/ANALYSIS.md). Both stand in the same frame — head 22–107 (one head ≈ 85),
   floor 750 — so landmark heights barely move; widths carry the difference:
   women ≈ shoulders 1⅔ heads, hips ≈ shoulders, small waist; men ≈ shoulders 2 heads, hips clearly narrower,
   straighter waist, thicker neck and limbs. Every garment is built from these tables, so it re-fits on its own.
   TORSO = [y, half-width]; ARM_*, LEG_* = [y, x] of the left outline; SHOULDER = [-x, y] (trapezius). */
const BODIES = {
  f: {
    name: '여성 모델', en: 'Female model', height: 177, bust: 86, waist: 61, hip: 88, sizeKr: '44–55',
    Y: { neck: 122, armpit: 198, bust: 212, waist: 272, hip: 350, crotch: 394, knee: 570, ankle: 722 },
    chest: 53, neckHalf: 14.5, st0: [137.5, 147], strapX: 152, sx: 150, rise: 24, hand: 1,
    torso: [[146, 63], [170, 57], [198, 52], [212, 52], [240, 47], [272, 42], [300, 47], [330, 54], [350, 58], [375, 58], [394, 57], [520, 57]],
    armO: [[146, 137], [160, 131], [180, 129], [205, 129], [240, 127], [268, 124], [290, 123], [330, 120], [365, 117], [392, 115]],
    armI: [[200, 149], [215, 148], [240, 147], [268, 146], [300, 144], [330, 140], [360, 136], [392, 133]],
    shoulder: [[-190, 118], [-185, 120], [-176, 127], [-160, 133], [-146, 139], [-137, 147], [-125, 156]],
    legO: [[394, 143], [430, 145], [480, 150], [530, 155], [565, 159], [595, 160], [630, 160.5], [670, 164], [705, 169.5], [722, 172]],
    legI: [[394, 200], [410, 198], [450, 195], [500, 193], [540, 192.5], [570, 192], [590, 191], [620, 191.5], [660, 190.5], [700, 189.5], [722, 190]],
    leg: { thigh: [27, 17], knee: [18, 22], hem: [13, 39] },
    head: [[200, 22], [186, 25], [175, 36], [170.5, 54], [171.5, 72], [175.5, 86], [182, 97], [190, 104], [200, 107]],
  },
  m: {
    name: '남성 모델', en: 'Male model', height: 188, bust: 100, waist: 78, hip: 94, sizeKr: '100',
    Y: { neck: 120, armpit: 202, bust: 216, waist: 282, hip: 352, crotch: 396, knee: 572, ankle: 722 },
    chest: 58, neckHalf: 18, st0: [121, 150], strapX: 146, sx: 140, rise: 18, hand: 1.12,
    torso: [[150, 79], [172, 71], [202, 59], [216, 59], [245, 55.5], [282, 51], [312, 53], [338, 56], [352, 57], [378, 56.5], [396, 56], [520, 56]],
    armO: [[150, 121], [165, 115], [185, 113], [205, 113.5], [240, 113], [270, 111.5], [292, 111], [330, 109], [365, 106], [396, 104]],
    armI: [[204, 142], [220, 141.5], [240, 140.5], [270, 139], [300, 136.5], [330, 132], [362, 127], [396, 123]],
    shoulder: [[-182, 112], [-176, 118], [-164, 126], [-148, 133], [-134, 140], [-126, 145], [-121, 150], [-110, 160]],
    legO: [[396, 145], [430, 146], [480, 150], [530, 155], [565, 158.5], [595, 159], [630, 160], [670, 163], [705, 168], [722, 170]],
    legI: [[396, 200], [410, 198.5], [450, 196], [500, 194], [540, 193], [572, 192.5], [590, 192], [620, 192], [660, 191], [700, 190.5], [722, 191]],
    leg: { thigh: [28, 17], knee: [19.5, 22], hem: [14, 38] },
    head: [[200, 20], [185.5, 23], [174, 35], [169.5, 54], [170, 72], [172.5, 87], [178.5, 98], [188.5, 105], [200, 107]],
  },
};
let BODY, Y, CHEST, TORSO, ARM_O, ARM_I, SHOULDER, LEG_O, LEG_I, LEG;
function useBody(id) {
  BODY = BODIES[id] || BODIES.f;
  ({ Y, chest: CHEST, torso: TORSO, armO: ARM_O, armI: ARM_I, shoulder: SHOULDER, legO: LEG_O, legI: LEG_I } = BODY);
  // half-widths of a jeans leg (px) from the 0..1 settings
  const { thigh, knee, hem } = BODY.leg;
  LEG = { thigh: t => thigh[0] + thigh[1] * t, knee: k => knee[0] + knee[1] * k, hem: h => hem[0] + hem[1] * h };
}
const bodyHalf = y => table(TORSO, y);
const armO = y => table(ARM_O, y), armI = y => table(ARM_I, y);
const neckY = x => table(SHOULDER, -x);
const legMid = y => (table(LEG_O, y) + table(LEG_I, y)) / 2;

/* ---------- pose: 2D skinning ----------
   Fashion snaps never stand at attention: weight sits on one leg (contrapposto), the pelvis tilts up on that side,
   the shoulders tilt the other way, the free knee bends in and its foot turns out, arms hang loose or rest on a hip.
   Like Spine/Live2D rigs, the body is split into bones (pelvis, chest, head, thighs, shins, upper arms, forearms,
   hands); every point is moved by a smooth blend of the bones around it, so the mannequin and every garment bend
   together and the clothes keep fitting. Angles are in screen degrees (positive = clockwise); legs [thigh, shin,
   foot drop], arms [upper arm, forearm, hand]. Weight leg = the left one on screen. */
const POSES = {
  relaxed: { name: '편하게', pelvis: 5, pShift: -9, chest: -3.5, cShift: -2.5, head: 2.5, legL: [-5.5, 0, 0], legR: [-4.5, -11, 4], armL: [4, 3, 0], armR: [-5, 11, 4] },
  // hand on hip: elbow out at the waist, wrist resting on the hip bone (solved per body so the hand lands there)
  hip: { name: '한 손 허리', pelvis: 5, pShift: -9, chest: -3.5, cShift: -2.5, head: -2, legL: [-5.5, 0, 0], legR: [-4.5, -11, 4], armL: [3, 4, 0], armR: { f: [-40, 87, -30], m: [-34, 85, -32] } },
  stand: { name: '차렷' },
};
const mulM = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
const rotAt = (deg, [px, py]) => { const r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r); return [c, s, -s, c, px - c * px + s * py, py - s * px - c * py]; };
const trM = (dx, dy) => [1, 0, 0, 1, dx, dy];
const applyM = (m, p) => [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
const sstep = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
let BONES = null, CTX = 'body', MIR = false, POSE_OFF = false, ELBOW = 270, WRIST = 392;
function computePose(id) {
  const P = POSES[id] || POSES.relaxed;
  ELBOW = Y.waist - 2; WRIST = ARM_O[ARM_O.length - 1][0];
  if (!P.pelvis) { BONES = null; return; }
  const B = {};
  B.pelvis = mulM(trM(P.pShift, 0), rotAt(P.pelvis, [CX, Y.hip]));
  B.chest = mulM(trM(P.cShift, 0), rotAt(P.chest, [CX, Y.waist]));
  B.head = mulM(B.chest, rotAt(P.head, [CX, Y.neck - 12]));
  ['L', 'R'].forEach(sd => {
    const mx = x => sd === 'L' ? x : 400 - x;
    const H = [mx(legMid(Y.crotch)), Y.crotch - 28], K = [mx(legMid(Y.knee)), Y.knee], A = [mx(legMid(Y.ankle)), Y.ankle];
    const [t, sh, drop] = P['leg' + sd];
    const thigh = mulM(B.pelvis, rotAt(t, H));
    let shin = mulM(thigh, rotAt(sh, K));
    shin = mulM(trM(0, Y.ankle + drop - applyM(shin, A)[1]), shin);   // the foot stays on the floor
    B['thigh' + sd] = thigh; B['shin' + sd] = shin;
    const mid = y => mx((armO(y) + armI(Math.max(y, ARM_I[0][0]))) / 2);
    const arm = P['arm' + sd], [u, f, h] = Array.isArray(arm) ? arm : arm[BODY === BODIES.m ? 'm' : 'f'];
    B['uarm' + sd] = mulM(B.chest, rotAt(u, [mid(BODY.st0[1] + 12), BODY.st0[1] + 12]));
    B['farm' + sd] = mulM(B['uarm' + sd], rotAt(f, [mid(ELBOW), ELBOW]));
    B['hand' + sd] = mulM(B['farm' + sd], rotAt(h, [mid(WRIST), WRIST]));
  });
  BONES = B;
}
// which bones move a rest-pose point, and how much: 'arm' for arms and sleeves, 'skirt' hangs mostly from the hips
function bonesAt(x, y, ctx) {
  const B = BONES, sd = x < CX ? 'L' : 'R';
  if (ctx === 'arm') {
    const u = sstep(BODY.st0[1] + 2, BODY.st0[1] + 44, y), f = sstep(ELBOW - 16, ELBOW + 16, y), h = sstep(WRIST - 4, WRIST + 12, y);
    return [[1 - u, B.chest], [u * (1 - f), B['uarm' + sd]], [u * f * (1 - h), B['farm' + sd]], [u * f * h, B['hand' + sd]]];
  }
  const hd = 1 - sstep(Y.neck - 20, Y.neck - 4, y), c = 1 - sstep(Y.waist - 24, Y.waist + 36, y);
  let l = sstep(Y.crotch - 34, Y.crotch + 20, y) * clamp(Math.abs(x - CX) / 8, 0, 1), k = sstep(Y.knee - 34, Y.knee + 26, y);
  if (ctx === 'skirt') { l *= .45; k = 0; }
  const r = (1 - hd) * (1 - c);
  return [[hd, B.head], [(1 - hd) * c, B.chest], [r * (1 - l), B.pelvis], [r * l * (1 - k), B['thigh' + sd]], [r * l * k, B['shin' + sd]]];
}
function warp(p, ctx = CTX) {
  if (!BONES || POSE_OFF) return p;
  let x = 0, y = 0;
  for (const [w, m] of bonesAt(p[0], p[1], ctx)) if (w > 1e-5) { const q = applyM(m, p); x += w * q[0]; y += w * q[1]; }
  return [x, y];
}
// MIR: building the right half inside a mirroring <g>, so place the real right-side point and mirror it back
const at = p => MIR ? mir(warp(mir(p))) : warp(p);
const inCtx = (ctx, fn) => { const o = CTX; CTX = ctx; try { return fn(); } finally { CTX = o; } };
// screen point → rest pose (Newton steps with the blended bone rotation), for clicks and drags
function unwarp(p, ctx = 'body') {
  if (!BONES) return p;
  let q = p.slice();
  for (let i = 0; i < 8; i++) {
    const w = warp(q, ctx), dx = p[0] - w[0], dy = p[1] - w[1];
    if (Math.abs(dx) + Math.abs(dy) < .05) break;
    let a = 0, b = 0, c = 0, d = 0;
    for (const [wt, m] of bonesAt(q[0], q[1], ctx)) { a += wt * m[0]; b += wt * m[1]; c += wt * m[2]; d += wt * m[3]; }
    const det = a * d - b * c || 1;
    q = [q[0] + (d * dx - c * dy) / det, q[1] + (-b * dx + a * dy) / det];
  }
  return q;
}

/* ---------- path helpers ---------- */
// segment: {t:'L',p} | {t:'Q',a,p} | {t:'C',a,b,p}
function crSegs(pts) {   // smooth Catmull-Rom curve through pts (starts at pts[0])
  const s = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    s.push({ t: 'C', a: [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6],
                     b: [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6], p: p2 });
  }
  return s;
}
const segD = s => s.t === 'L' ? 'L' + pt(s.p) : s.t === 'Q' ? 'Q' + pt(s.a) + ' ' + pt(s.p) : 'C' + pt(s.a) + ' ' + pt(s.b) + ' ' + pt(s.p);
const pathD = (start, segs, close = true) => 'M' + pt(start) + segs.map(segD).join('') + (close ? 'Z' : '');
const mirSeg = s => s.t === 'L' ? { t: 'L', p: mir(s.p) } : s.t === 'Q' ? { t: 'Q', a: mir(s.a), p: mir(s.p) } : { t: 'C', a: mir(s.a), b: mir(s.b), p: mir(s.p) };
function reverseSegs(start, segs) {
  const pts = [start, ...segs.map(s => s.p)], out = [];
  for (let i = segs.length - 1; i >= 0; i--) {
    const s = segs[i], to = pts[i];
    out.push(s.t === 'L' ? { t: 'L', p: to } : s.t === 'Q' ? { t: 'Q', a: s.a, p: to } : { t: 'C', a: s.b, b: s.a, p: to });
  }
  return out;
}
// left half from a centre-line start to a centre-line end, closed by its mirror image
const symD = (start, segs) => pathD(start, [...segs, ...reverseSegs(start, segs).map(mirSeg)]);
const cubicMid = (p0, a, b, p3) => [(p0[0] + 3 * a[0] + 3 * b[0] + p3[0]) / 8, (p0[1] + 3 * a[1] + 3 * b[1] + p3[1]) / 8];

/* ---------- colour ---------- */
function shade(hex, a) {
  const n = parseInt(hex.slice(1), 16), t = a < 0 ? 0 : 255, k = Math.abs(a);
  const c = [n >> 16, n >> 8 & 255, n & 255].map(v => Math.round(v + (t - v) * k));
  return '#' + ((1 << 24) | (c[0] << 16) | (c[1] << 8) | c[2]).toString(16).slice(1);
}
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

/* ---------- garments ---------- */
const SOLID = c1 => ({ type: 'solid', c1, c2: '#24324a', scale: 1 });
const DEF = {
  // tops: fit = body ease, sfit = sleeve ease, drop = shoulder drop, flare = hem flare (px); cling 0..1 = hangs straight → follows the waist
  tee:    { kind: 'tee',    neckD: 12, neckW: 20, neckV: 0, len: 372, sleeve: 234, fit: 5, sfit: 2, drop: 3, flare: 0, cling: .35, fill: SOLID('#f3f1ec'), dmg: [], print: null, rawHem: false, rawSleeve: false },
  crop:   { kind: 'crop',   neckD: 11, neckW: 20, neckV: 0, len: 262, sleeve: 232, fit: 7, sfit: 3, drop: 4, flare: 1, cling: 0, fill: SOLID('#1c1c1c'), dmg: [], print: null, rawHem: false, rawSleeve: false },
  fitted: { kind: 'fitted', neckD: 10, neckW: 18, neckV: 0, len: 360, sleeve: 228, fit: -2, sfit: -2, drop: 0, flare: -2, cling: 1, fill: SOLID('#e8b4b8'), dmg: [], print: null, rawHem: false, rawSleeve: false },
  long:   { kind: 'long',   neckD: 10, neckW: 19, neckV: 0, len: 380, sleeve: 398, fit: 3, sfit: 1, drop: 2, flare: 0, cling: .3, fill: { type: 'stripe', c1: '#f3f1ec', c2: '#24324a', scale: 1 }, dmg: [], print: null, rawHem: false, rawSleeve: false },
  // jeans: thigh / knee / hem width, 0..1 each
  jeans: { kind: 'jeans', len: 732, thigh: .32, knee: .33, hemW: .36, fill: { type: 'solid', c1: '#4a6787', c2: '#f3f1ec', scale: 1 }, dmg: [], print: null, rawHem: false },
  // skirt: hip = ease over the hips, fit = hem flare, 0..1 each
  skirt: { kind: 'skirt', len: 476, hip: .06, fit: 0.3, fill: { type: 'solid', c1: '#c7b299', c2: '#3b3b3b', scale: 1 }, dmg: [], print: null, rawHem: false },
};
const SLOT = { tee: 'top', crop: 'top', fitted: 'top', long: 'top', jeans: 'bottom', skirt: 'bottom' };
const NAME = { tee: '반팔 티', crop: '크롭 티', fitted: '딱 붙는 티', long: '긴팔 티', jeans: '청바지', skirt: '치마' };
const SLEEVE_EASE = { tee: 9, crop: 9, fitted: 2.5, long: 3 };
const SLEEVELESS = 200;
const LIMIT = {
  'top.len': [225, 460], 'top.sleeve': [190, 404], 'top.fit': [-3, 40], 'top.cling': [0, 1],
  'top.sfit': [-4, 30], 'top.drop': [0, 34], 'top.flare': [-12, 36],
  'top.neckD': [8, 150], 'top.neckW': [14, 58], 'top.neckV': [0, 1],
  'bottom.fit': [0, 1], 'bottom.hip': [0, 1], 'bottom.thigh': [0, 1], 'bottom.knee': [0, 1], 'bottom.hemW': [0, 1],
};
// older saves had a single `fit` per garment: spread it over the new per-part settings
function upgrade(g) {
  if (!g) return g;
  const f = g.fit ?? 0;
  if (SLOT[g.kind] === 'top' && g.sfit == null) Object.assign(g, { sfit: Math.round(f * .32), drop: Math.max(0, f * .55), flare: 0 });
  if (SLOT[g.kind] === 'top') {   // body proportions changed: keep old saves inside the new limits
    if (g.cling == null) g.cling = .35;
    g.sleeve = Math.min(g.sleeve, LIMIT['top.sleeve'][1]);
    g.len = Math.min(g.len, LIMIT['top.len'][1]);
  }
  if (g.kind === 'jeans' && g.thigh == null) {
    const j = g.fit ?? .4;
    Object.assign(g, { thigh: (3 + 6 * j) / 17, knee: (2 + 13 * j) / 22, hemW: (2 + 30 * j) / 39 });
    delete g.fit;
  }
  if (g.kind === 'skirt' && g.hip == null) g.hip = f * .2;
  return g;
}
const bottomLenLimit = b => b.kind === 'jeans' ? [412, 735] : [340, 720];

const topLenName = y => y < 285 ? '크롭' : y < 330 ? '숏' : y < 395 ? '기본' : '롱';
const sleeveName = y => y <= SLEEVELESS ? '민소매' : y < 252 ? '반팔' : y < 310 ? '5부' : y < 370 ? '7부' : '긴팔';
const clingName = c => c < .3 ? '일자' : c < .7 ? '살짝 붙게' : '딱 붙게';
const bottomLenName = (b, y) => b.kind === 'jeans'
  ? (y < 465 ? '숏팬츠' : y < 600 ? '버뮤다' : y < 680 ? '7부' : y < 722 ? '9부' : '기본')
  : (y < 405 ? '마이크로 미니' : y < 480 ? '미니' : y < 600 ? '무릎' : y < 680 ? '미디' : '맥시');
const topFitName = e => e < 2 ? '슬림핏' : e < 12 ? '레귤러핏' : e < 24 ? '세미 오버핏' : '오버핏';
const sleeveFitName = s => s < 0 ? '타이트' : s < 8 ? '기본' : s < 18 ? '여유' : '오버';
const dropName = d => d < 6 ? '기본' : d < 18 ? '살짝 드롭' : '드롭 숄더';
const flareName = f => f < -4 ? '좁게' : f < 6 ? '일자' : f < 18 ? '살짝 퍼짐' : '많이 퍼짐';
function bottomFitName(b) {
  if (b.kind !== 'jeans') return b.fit < .2 ? 'H라인' : b.fit < .5 ? 'A라인' : b.fit < .8 ? '플레어' : '풀 플레어';
  const K = LEG.knee(b.knee), H = LEG.hem(b.hemW);
  if (H < 17) return '스키니';
  if (H < K - 3) return '테이퍼드';
  if (H > K + 8 && K < 30) return H > 44 ? '플레어' : '부츠컷';
  return K > 32 ? '와이드' : K > 25 ? '스트레이트' : '슬림';
}
function neckName(t) {
  if (t.neckV >= .65) return t.neckD >= 90 ? '딥 V넥' : 'V넥';
  if (t.neckV > .35) return 'U와 V 사이';
  if (t.neckD < 30) return t.neckW >= 40 ? '보트넥' : '라운드넥';
  return t.neckD >= 90 ? '딥 U넥' : 'U넥';
}

// under(y): half-width of the bottom worn beneath, so a fitted top stretches over it.
// tuck {wy, wh}: the top goes inside the bottom — it narrows into the waistband and ends just under it.
function topGeo(t, under = () => 0, tuck = null) {
  const e = t.fit, sy = t.sleeve, nl = sy <= SLEEVELESS;
  const hy = tuck ? Math.min(t.len, tuck.wy + 18) : t.len;
  const ST = nl ? [BODY.strapX - e * .3, neckY(BODY.strapX - e * .3) + 1] : [BODY.st0[0] - t.drop, BODY.st0[1] + t.drop * .55];
  const nw = Math.min(t.neckW, CX - ST[0] - 12);
  const NL = [CX - nw, neckY(CX - nw)];
  const C0 = [CX, Math.max(NL[1] + 6, Y.neck + t.neckD)];
  const dy = C0[1] - NL[1];
  const uA = [NL[0], NL[1] + dy * .8], uB = [CX - nw * .55, C0[1]];
  const vA = mix(NL, C0, 1 / 3), vB = mix(NL, C0, 2 / 3);
  const nA = mix(uA, vA, t.neckV), nB = mix(uB, vB, t.neckV);
  const apY = Y.armpit + (nl ? 10 : 2) + e * .25;
  const half = y => {
    // fabric either drops straight from the chest (cling 0) or follows the waist curve (cling 1)
    const b = bodyHalf(y), fl = tuck ? 0 : t.flare * Math.pow(clamp((y - apY) / Math.max(1, hy - apY), 0, 1), 1.6);
    const hang = Math.max(b, .2 * b + .8 * CHEST);
    const w = Math.max(b + 1, under(y) + 1.5, lerp(hang, b, t.cling ?? .35) + 2 + e + fl);
    if (!tuck) return w;
    // gathered into the waistband: ease bunches just above it (blouson), then disappears inside
    const k = clamp((y - (tuck.wy - 54)) / 54, 0, 1), s = k * k * (3 - 2 * k);
    return lerp(w, tuck.wh - 1, s) + Math.sin(Math.PI * clamp((y - (tuck.wy - 34)) / 30, 0, 1)) * Math.min(4, 1 + e * .2) * (1 - s * .6);
  };
  const AP = [nl ? Math.max(CX - half(apY), armI(apY) + 1) : CX - half(apY), apY];   // sleeveless armhole stops at the arm
  const side = [AP];
  for (let y = apY + 26; y < hy - 12; y += 26) side.push([CX - half(y), y]);
  const HL = [CX - half(hy), hy];
  side.push(HL);
  const armhole = nl ? { t: 'C', a: [ST[0] + 3, ST[1] + 30], b: [AP[0] - 8, AP[1] - 14], p: AP }
                     : { t: 'C', a: [ST[0] + 2, ST[1] + 24], b: [AP[0] - 2, AP[1] - 20], p: AP };
  // shoulder seam rides just above the mannequin's shoulder, even when dropped for oversized fits
  const sx = clamp(BODY.sx, ST[0] + 6, NL[0] - 6);
  const shoulder = NL[0] - ST[0] > 14 ? crSegs([NL, [sx, neckY(sx) - 3], ST]) : [{ t: 'L', p: ST }];
  const body = symD(C0, [
    { t: 'C', a: nB, b: nA, p: NL },
    ...shoulder,
    armhole, ...crSegs(side),
    { t: 'C', a: [HL[0] + 30, hy + 2], b: [176, hy + 3], p: [CX, hy + 3] },
  ]);
  const G = { body, C0, NL, nw, ST, AP, HL, hy, half, nl, sy, apY, tuck };
  G.Um = cubicMid(NL, uA, uB, C0); G.Vm = cubicMid(NL, vA, vB, C0); G.mid = cubicMid(NL, nA, nB, C0);
  const NR = mir(NL);
  // shoulder yoke above the armpits: the bare arm is hidden under it
  G.yokeD = pathD(NL, [...shoulder, armhole, { t: 'L', p: mir(AP) }, ...reverseSegs(NL, [...shoulder, armhole]).map(mirSeg)]);
  G.backD = `M${pt(NL)}Q${pt([CX, NL[1] - 9])} ${pt(NR)}C${pt(mir(nA))} ${pt(mir(nB))} ${pt(C0)}C${pt(nB)} ${pt(nA)} ${pt(NL)}Z`;
  G.backBandD = `M${pt(NL)}Q${pt([CX, NL[1] - 9])} ${pt(NR)}`;
  G.bandD = `M${pt(NL)}C${pt(nA)} ${pt(nB)} ${pt(C0)}C${pt(mir(nB))} ${pt(mir(nA))} ${pt(NR)}`;
  if (!nl) {
    const se = Math.max(1, (SLEEVE_EASE[t.kind] ?? 9) + t.sfit), si = se * .45;
    const outs = [ST];
    for (let y = ST[1] + 12; y < sy - 8; y += 24) outs.push([armO(y) - se, y]);   // follows the round deltoid
    const SO = [armO(sy) - se, sy], SI = [armI(sy) + si, sy];
    const AQ = [Math.max(AP[0], armI(apY) + si), apY];   // sleeve's underarm point always covers the arm
    const sArm = { t: 'C', a: [ST[0] + 2, ST[1] + 24], b: [AQ[0] - 2, AQ[1] - 20], p: AQ };
    outs.push(SO);
    const ins = [SI];
    for (let y = sy - 34; y > apY + 16; y -= 34) ins.push([armI(y) + si, y]);
    ins.push(AQ);
    // the cuff wraps a cylinder seen from just above: a shallow downward arc, not a straight cut
    const cuff = { t: 'Q', a: [(SO[0] + SI[0]) / 2, sy + 2.5 + (SI[0] - SO[0]) * .05], p: SI };
    const segs = [...crSegs(outs), cuff, ...crSegs(ins), { t: 'C', a: sArm.b, b: sArm.a, p: ST }];
    inCtx('arm', () => { G.sleeveL = pathD(ST, segs); G.sleeveR = pathD(mir(ST), segs.map(mirSeg)); });
    G.se = se; G.si = si; G.SO = SO; G.SI = SI; G.AQ = AQ;
  }
  return G;
}

function jeansGeo(b) {
  const hy = b.len, wy = Y.waist + BODY.rise, c0 = Y.crotch + 4, h1 = Y.hip - 22, h2 = Y.hip + 10;
  const wh = bodyHalf(wy) + 3;
  const hipH = y => bodyHalf(y) + 3 + b.thigh * 5;
  const cxT = [c0, 450, Y.knee, 735].map(y => [y, legMid(y)]);   // leg centre lines follow the body
  const T = LEG.thigh(b.thigh);
  const lhT = [[c0, T + 1], [450, T], [Y.knee, LEG.knee(b.knee)], [735, LEG.hem(b.hemW)]];
  // legs keep a small gap between them; wider legs grow outward instead of overlapping
  const inMax = y => table([[400, 199.3], [460, 198.5], [735, 195.5]], y);
  const lh = y => table(lhT, y);
  const cx = y => Math.min(table(cxT, y), inMax(y) - lh(y));
  const inX = y => cx(y) + lh(y);
  const WL = [CX - wh, wy];
  const outer = [WL, [CX - hipH(h1), h1], [CX - hipH(h2), h2]];
  // real jeans hang from the widest point of the hip: never let the outer seam swell out again below it
  const hipX = CX - hipH(h2), kneeX = cx(Y.knee) - lh(Y.knee);
  const outX = y => y < Y.knee ? Math.max(cx(y) - lh(y), lerp(hipX, kneeX, (y - h2) / (Y.knee - h2))) : cx(y) - lh(y);
  for (let y = 450; y < hy - 14; y += 50) outer.push([outX(y), y]);
  const HO = [outX(hy), hy], HI = [inX(hy), hy];
  outer.push(HO);
  const inner = [HI];
  for (let y = hy - 50; y > 456; y -= 50) inner.push([inX(y), y]);
  if (hy > c0 + 34) inner.push([inX(c0 + 22), c0 + 22]);
  inner.push([CX, c0]);
  const d = symD([CX, wy], [{ t: 'L', p: WL }, ...crSegs(outer), { t: 'L', p: HI }, ...crSegs(inner)]);
  return { d, wy, wh, hipH, cx, lh, inX, outX, hy, c0, h1, h2, handle: [outX(hy - 12), hy - 12] };
}

function skirtGeo(b) {
  const fl = b.fit, hy = b.len, wy = Y.waist + 6, hipY = Y.hip;
  const wh = bodyHalf(wy) + 2.5, hipH = bodyHalf(hipY) + 3 + fl * 3 + b.hip * 14;
  const hemH = hy <= hipY ? lerp(wh, hipH, (hy - wy) / (hipY - wy)) + fl * 6
                          : hipH - 3 + (hy - hipY) * (.04 + .6 * fl) + fl * 8;
  const pts = [[CX - wh, wy]];
  if (hy > hipY - 22) pts.push([CX - bodyHalf(hipY - 34) - 3 - fl * 2 - b.hip * 8, hipY - 34]);
  if (hy > hipY + 14) pts.push([CX - hipH, hipY]);
  const HL = [CX - hemH, hy];
  pts.push(HL);
  const drop = 4 + 6 * fl;
  const baseY = x => hy + drop * (1 - Math.pow((CX - x) / hemH, 2));
  const segs = [{ t: 'L', p: pts[0] }, ...crSegs(pts)];
  const folds = [];
  if (fl > .4) {
    const n = 3, amp = (fl - .4) * 16;
    for (let k = 0; k < n; k++) {
      const x0 = lerp(HL[0], CX, k / n), x1 = lerp(HL[0], CX, (k + 1) / n), xm = (x0 + x1) / 2;
      segs.push({ t: 'Q', a: [xm, baseY(xm) + (k % 2 ? -amp : amp)], p: [x1, baseY(x1)] });
      if (k) folds.push(x0);
    }
  } else {
    segs.push({ t: 'C', a: [HL[0] + hemH * .4, baseY(HL[0] + hemH * .4)], b: [CX - hemH * .3, hy + drop], p: [CX, hy + drop] });
  }
  if (fl > .25 && hy > hipY + 40) [.36, .7].forEach(t => folds.push(lerp(HL[0], CX, t)));
  return { d: inCtx('skirt', () => symD([CX, wy], segs)), wy, wh, hipY, hipH, hemH, hy, baseY, folds, handle: [HL[0] + 2, hy - 8] };
}

/* ---------- state ---------- */
let state = { top: clone(DEF.tee), bottom: clone(DEF.jeans), target: 'top' };
let tool = 'neck', dmgMode = 'paint';
let images = {};
const blobUrls = {};
// look of the studio, kept apart from the undo history
const PREFS = 'clothes-custom:prefs';
let prefs = { body: 'f', pose: 'relaxed', finish: 'white', backdrop: 'studio', guides: true };
try {
  const s = JSON.parse(localStorage.getItem(STORE) || 'null');
  if (s) { state.top = upgrade(s.top ?? null); state.bottom = upgrade(s.bottom ?? null); images = s.images || {}; }
  Object.assign(prefs, JSON.parse(localStorage.getItem(PREFS) || '{}'));
} catch (e) { /* storage unavailable: start fresh */ }
const savePrefs = () => { try { localStorage.setItem(PREFS, JSON.stringify(prefs)); } catch (e) { /* ignore */ } };
useBody(prefs.body);
computePose(prefs.pose);
if (!state[state.target]) state.target = state.top ? 'top' : 'bottom';

function dataURLtoBlob(u) {
  const [h, b] = u.split(','), bin = atob(b), a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return new Blob([a], { type: h.match(/:(.*?);/)[1] });
}
const imgURL = id => blobUrls[id] || (images[id] ? (blobUrls[id] = URL.createObjectURL(dataURLtoBlob(images[id]))) : '');

/* ---------- rendering ---------- */
const svg = $('#stage');
const L = id => document.getElementById('L-' + id);
const OUTLINE = 'rgba(20,18,16,.36)';
/* Display-mannequin finishes (matte FRP) and seamless-paper backdrops. Light comes from the upper left everywhere. */
const FINISH = {
  white: { name: '화이트', base: '#edeae5', rim: '#4a4239', k: .3, hi: .55, line: '#a29b90' },
  stone: { name: '스톤', base: '#c8c0b4', rim: '#3a3229', k: .34, hi: .34, line: '#8a8174' },
  black: { name: '블랙', base: '#2f2e2c', rim: '#000', k: .5, hi: .13, line: '#121211' },
};
const BACKDROP = {
  studio: { name: '스튜디오', c0: '#ece8e2', c1: '#b9b3aa', floor: '#9c968c' },
  grey: { name: '그레이', c0: '#bebbb5', c1: '#83807a', floor: '#6c6964' },
  dark: { name: '다크', c0: '#43423f', c1: '#1c1c1b', floor: '#0e0e0d' },
};
const blur = (id, s) => `<filter id="${id}" filterUnits="userSpaceOnUse" x="-100" y="-100" width="600" height="1000"><feGaussianBlur stdDeviation="${s}"/></filter>`;
const dropF = (id, s, dx, dy, a) => `<filter id="${id}" filterUnits="userSpaceOnUse" x="-100" y="-100" width="600" height="1000"><feGaussianBlur in="SourceAlpha" stdDeviation="${s}"/><feOffset dx="${dx}" dy="${dy}"/><feComponentTransfer><feFuncA type="linear" slope="${a}"/></feComponentTransfer><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;
$('#static-defs').innerHTML = blur('b1', 1) + blur('b2', 1.8) + blur('soft', 4) + blur('b4', 4) + blur('b5', 5) + blur('b8', 8) +
  // contact shadow: every garment layer drops a short, soft shadow down-right onto what lies beneath
  dropF('drop', 2.2, 1.6, 2.4, .34) + dropF('drop-s', 2.6, 1.8, 2.2, .22) + `
  <radialGradient id="fade"><stop offset="0" stop-color="#fff" stop-opacity=".2"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
  <linearGradient id="plate" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4a4946"/><stop offset="1" stop-color="#232321"/></linearGradient>
  <pattern id="twill" patternUnits="userSpaceOnUse" width="4" height="4" patternTransform="rotate(-35)"><rect width="4" height="1.3" fill="#fff" opacity=".08"/></pattern>`;

/* Shape-following light, the 2D stand-in for a body shading map: the piece's own outline, blurred and nudged,
   darkens the far (right/lower) rim and lifts a highlight just inside the near (left) rim. Because it is built
   from each outline, every limb, leg and garment reads as a cylinder whatever its shape. */
const rim = (d, k, hi, dark = '#000') =>
  `<path d="${d}" fill="none" stroke="${dark}" stroke-opacity="${k}" stroke-width="16" filter="url(#b5)" transform="translate(-5 -1.5)"/>` +
  (hi ? `<path d="${d}" fill="none" stroke="#fff" stroke-opacity="${hi}" stroke-width="7" filter="url(#b4)" transform="translate(8.5 0)"/>` : '');
// soft crease: a blurred dark line with a fainter highlight on its lit (upper-left) side
const crease = (d, o = .15, w = 3) => !d || o <= 0 ? '' :
  `<path d="${d}" fill="none" stroke="#000" stroke-opacity="${r1(o * 100) / 100}" stroke-width="${w}" stroke-linecap="round" filter="url(#b2)"/>` +
  `<path d="${d}" fill="none" stroke="#fff" stroke-opacity="${r1(o * 70) / 100}" stroke-width="${r1(w * .55)}" stroke-linecap="round" filter="url(#b1)" transform="translate(-1.6 -1.4)"/>`;
const mirrored = fn => { MIR = true; try { return fn(); } finally { MIR = false; } };
const both = fn => { const a = fn(); return a ? a + `<g transform="matrix(-1 0 0 1 400 0)">${mirrored(fn)}</g>` : ''; };

function shadeMix(a, b, t) {
  const p = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const A = p(a), B = p(b);
  return '#' + A.map((v, i) => Math.round(lerp(v, B[i], t)).toString(16).padStart(2, '0')).join('');
}
function drawBackdrop() {
  const B = BACKDROP[prefs.backdrop] || BACKDROP.studio;
  L('bg').innerHTML = `<radialGradient id="bd" gradientUnits="userSpaceOnUse" cx="190" cy="330" r="560"><stop offset="0" stop-color="${B.c0}"/><stop offset=".55" stop-color="${shadeMix(B.c0, B.c1, .55)}"/><stop offset="1" stop-color="${B.c1}"/></radialGradient>` +
    `<linearGradient id="floor" gradientUnits="userSpaceOnUse" x1="0" y1="660" x2="0" y2="800"><stop offset="0" stop-color="${B.floor}" stop-opacity="0"/><stop offset="1" stop-color="${B.floor}" stop-opacity=".55"/></linearGradient>` +
    `<rect x="-800" y="-600" width="2000" height="2000" fill="url(#bd)"/><rect x="-800" y="660" width="2000" height="800" fill="url(#floor)"/>`;
  $('.stage-wrap').style.background = B.c1;
}

// mannequin, rebuilt from the body tables whenever the body or finish changes
function drawMannequin() {
  const F = FINISH[prefs.finish] || FINISH.white;
  const xy = t => t.map(([y, x]) => [x, y]);
  const nh = BODY.neckHalf, nx = CX - nh, st = BODY.st0, apX = CX - bodyHalf(Y.armpit);
  const shPts = SHOULDER.map(([x, y]) => [-x, y]).filter(([x]) => x < nx - 1 && x > st[0] + .6);
  const torsoPts = TORSO.filter(([y]) => y >= Y.armpit && y <= Y.crotch).map(([y, h]) => [CX - h, y]);
  const ao = LEG_O[LEG_O.length - 1][1], ai = LEG_I[LEG_I.length - 1][1], ay = Y.ankle;
  const torso = symD([CX, 96], [
    { t: 'L', p: [nx, 96] },
    // neck into a sloping trapezius, then the round of the shoulder
    ...crSegs([[nx, 96], [nx - .5, 108], [nx - .5, Y.neck - 3], ...shPts, st]),
    { t: 'C', a: [st[0] - 6.5, st[1] + 9], b: [apX - 5, Y.armpit - 12], p: [apX, Y.armpit] },
    // ribcage → waist → hips, thigh → knee → calf → ankle, foot, then back up the inner leg
    ...crSegs(torsoPts), ...crSegs(xy(LEG_O)),
    { t: 'C', a: [ao + 1, ay + 11], b: [ao - 4, ay + 19], p: [ao - 3, ay + 27] }, { t: 'L', p: [ai + 5, ay + 27] },
    { t: 'C', a: [ai + 7, ay + 20], b: [ai + 1, ay + 11], p: [ai, ay] },
    ...crSegs(xy(LEG_I).reverse()),
  ]);
  const head = symD([CX, BODY.head[0][1]], crSegs(BODY.head));
  // arm: deltoid → elbow → wrist, a relaxed hand against the thigh, back up the inside
  const wo = [ARM_O[ARM_O.length - 1][1], ARM_O[ARM_O.length - 1][0]], wi = ARM_I[ARM_I.length - 1][1];
  const hs = BODY.hand, hw = (wi - wo[0]) / 18, hp = ([dx, dy]) => [wo[0] + dx * hw, wo[1] + dy * hs];
  const HAND = [[[-2, 13], [-5, 29], [-4, 44]], [[-3, 55], [1, 63], [6, 63]], [[11, 63], [14, 55], [15, 45]], [[17, 29], [18, 12], [18, 0]]];
  const ai0 = [ARM_I[0][1], ARM_I[0][0]], ao0 = [ARM_O[0][1], ARM_O[0][0]];
  const armSegs = [...crSegs(xy(ARM_O)), ...HAND.map(([a, b, p]) => ({ t: 'C', a: hp(a), b: hp(b), p: hp(p) })), ...crSegs(xy(ARM_I).reverse())];
  const armClose = [...armSegs, { t: 'C', a: [ai0[0] + 3, ai0[1] - 18], b: [ao0[0] + 10, ao0[1] + 7], p: ao0 }];
  const [armL, armR, edgeL, edgeR] = inCtx('arm', () => [pathD(ao0, armClose), pathD(mir(ao0), armClose.map(mirSeg)), pathD(ao0, armSegs, false), pathD(mir(ao0), armSegs.map(mirSeg), false)]);
  const part = (id, d) => `<clipPath id="mc-${id}"><path d="${d}"/></clipPath><g clip-path="url(#mc-${id})"><path d="${d}" fill="${F.base}"/>${rim(d, F.k, F.hi, F.rim)}</g>`;
  const seam = `stroke="${F.line}" stroke-opacity=".7" stroke-width=".8" fill="none" stroke-linecap="round"`;
  const wY = Y.waist + 14, kY = Y.knee - 4, sY = Y.armpit - 6, rY = wo[1] - 8;
  const details =
    // collarbones and knees (left side, mirrored), the neck joint and the detachable waist joint
    both(() => `<path d="M${pt([nx + 1.5, Y.neck + 6])}C${pt([nx - 8, Y.neck + 9])} ${pt([st[0] + 25, neckY(st[0] + 25) + 1])} ${pt([st[0] + 13, neckY(st[0] + 13)])}" ${seam}/>` +
      `<path d="M${pt([legMid(kY) - 8.5, kY])}Q${pt([legMid(kY), kY + 6])} ${pt([legMid(kY) + 8.5, kY])}" ${seam}/>`) +
    `<path d="M${pt([nx, Y.neck - 13])}Q${pt([CX, Y.neck - 8])} ${pt([CX + nh, Y.neck - 13])}" ${seam}/>` +
    `<path d="M${pt([CX - bodyHalf(wY), wY])}Q${pt([CX, wY + 6])} ${pt([CX + bodyHalf(wY), wY])}" ${seam} stroke-opacity=".45"/>`;
  // smoked-glass base plate and its floor shadow
  const plate = `<ellipse cx="200" cy="760" rx="96" ry="12" fill="#000" opacity=".28" filter="url(#b8)"/>` +
    `<path d="M140 750v5.5a60 8.5 0 0 0 120 0V750z" fill="#1a1a19"/><ellipse cx="200" cy="750" rx="60" ry="8.5" fill="url(#plate)"/>` +
    `<path d="M141.5 749.2a58.5 7.6 0 0 1 117 0" fill="none" stroke="#fff" stroke-opacity=".22" stroke-width="1"/>`;
  L('man').innerHTML = plate + part('torso', torso) + part('head', head) + details +
    `<g fill="none" stroke="${F.line}" stroke-width="1.1" stroke-opacity=".55"><path d="${torso}"/><path d="${head}"/></g>`;
  // shoulder and wrist joints, as on a display mannequin's detachable arms
  const armJoint = m => `<path d="M${pt(m([armO(sY) + 1, sY]))}Q${pt(m([(armO(sY) + ai0[0]) / 2, sY + 5]))} ${pt(m(ai0))}" ${seam}/>` +
    `<path d="M${pt(m([armO(rY) + .5, rY]))}Q${pt(m([(armO(rY) + armI(rY)) / 2, rY + 3]))} ${pt(m([armI(rY) - .5, rY]))}" ${seam}/>`;
  const edge = `fill="none" stroke="${F.line}" stroke-width="1.1" stroke-opacity=".7"`;
  L('arms').innerHTML = part('arml', armL) + part('armr', armR) + inCtx('arm', () => armJoint(p => p) + armJoint(mir)) +
    `<path d="${edgeL}" ${edge}/><path d="${edgeR}" ${edge}/>`;
}

const fillOf = (f, g) => f.type === 'solid' ? f.c1 : `url(#pat-${g})`;
function patDef(g, f) {
  if (f.type === 'solid') return '';
  const s = f.scale || 1, { c1, c2 } = f;
  let w, o, inner;
  if (f.type === 'stripe') { w = 20; o = 0; inner = `<rect width="20" height="20" fill="${c1}"/><rect width="20" height="8" fill="${c2}"/>`; }
  else if (f.type === 'check') { w = 24; o = 5; inner = `<rect width="24" height="24" fill="${c1}"/><rect width="24" height="10" fill="${c2}" opacity=".55"/><rect width="10" height="24" fill="${c2}" opacity=".55"/>`; }
  else { w = 22; o = 5.5; inner = `<rect width="22" height="22" fill="${c1}"/><circle cx="5.5" cy="5.5" r="3" fill="${c2}"/><circle cx="16.5" cy="16.5" r="3" fill="${c2}"/>`; }
  return `<pattern id="pat-${g}" patternUnits="userSpaceOnUse" width="${w}" height="${w}" patternTransform="translate(${r1(CX - o * s)} 0) scale(${s})">${inner}</pattern>`;
}

function dmgSVG(list) {
  return list.map(d => {
    const r = rng(Math.round(d.x * 131 + d.y * 7)), [x, y] = inCtx(d.c || 'body', () => at([d.x, d.y])).map(r1);
    let s = `<ellipse cx="${x}" cy="${y}" rx="${14 + d.lv * 3}" ry="${19 + d.lv * 4}" fill="#fff" opacity="${.2 + .09 * d.lv}" filter="url(#soft)"/>`;
    if (d.lv >= 2) {
      let p = '';
      for (let i = 0; i < 6; i++) {
        const w = 6 + r() * 12, yy = y - 13 + i * 5 + r() * 3, xx = x - w / 2 + (r() - .5) * 8;
        p += `M${r1(xx)} ${r1(yy)}q${r1(w / 2)} ${r1((r() - .5) * 2.4)} ${r1(w)} 0`;
      }
      s += `<path d="${p}" stroke="#fff" stroke-opacity=".75" stroke-width="1.1" fill="none" stroke-linecap="round"/>`;
    }
    if (d.lv >= 3) {
      let th = '';
      for (let k = -4; k <= 4; k += 2.6) th += `M${r1(x - 13)} ${r1(y + k)}q13 ${r1(1 + r() * 2)} 26 ${r1((r() - .5) * 1.5)}`;
      s += `<ellipse cx="${x}" cy="${y}" rx="12" ry="6.5" fill="${shade((FINISH[prefs.finish] || FINISH.white).base, -.12)}"/>` +
           `<ellipse cx="${x}" cy="${y}" rx="12.5" ry="7" fill="none" stroke="#f3f1ea" stroke-width="1.6" stroke-dasharray="1.2 1.4"/>` +
           `<path d="${th}" stroke="#f3f1ea" stroke-width="1.2" fill="none" stroke-linecap="round"/>`;
    }
    return s;
  }).join('');
}

function frayD(x0, x1, y, seed) {
  const r = rng(seed); let d = '';
  for (let x = x0 + 1; x < x1 - 1; x += 2.4) d += `M${pt([x, y - 1])}l${r1((r() - .5) * 2)} ${r1(2.5 + r() * 3.5)}`;
  return d;
}

function printSVG(p) {
  if (!p || !images[p.img]) return '';
  const w = p.w, h = p.w * p.ar, [cx, cy] = at([p.cx, p.cy]);
  return `<image data-img="${p.img}" href="${imgURL(p.img)}" x="${r1(cx - w / 2)}" y="${r1(cy - h / 2)}" width="${r1(w)}" height="${r1(h)}" preserveAspectRatio="none"/>`;
}

// pre: fabric detail, prints and creases (all shaded by the light pass); post: drawn over the light (washes, holes)
function piece(id, d, fill, pre, post, outer) {
  return `<clipPath id="clip-${id}"><path d="${d}"/></clipPath>` +
    `<g clip-path="url(#clip-${id})"><path d="${d}" fill="${fill}"/>${pre}${rim(d, .28, .17)}${post}</g>` +
    `<path id="hit-${id}" d="${d}" fill="none" stroke="${OUTLINE}" stroke-width="1" stroke-linejoin="round"/>${outer || ''}`;
}

/* Creases where real fabric folds (Bridgman's fold types): drag lines from the armpit toward the bust,
   pulls at a fitted waist, long drop folds on loose bodies, gathered folds above a tuck,
   zigzags at the elbow and bunching at the wrist. Left side only; both() mirrors. */
function topFolds(t, G) { return both(() => topFoldsHalf(t, G)); }
function topFoldsHalf(t, G) {
  const ease = t.fit, cl = t.cling ?? .35, { AP, hy, half, apY } = G;
  let s = '';
  if (!G.nl && hy > apY + 30) {
    const k = clamp(1 - ease / 22, 0, 1) * (.45 + cl * .55);
    s += crease(`M${pt([AP[0] + 3, AP[1] + 5])}q9 8 ${r1(20 + ease * .3)} 12M${pt([AP[0] + 2, AP[1] + 17])}q8 5 15 7`, .17 * k);
  }
  if (!G.tuck && cl > .45 && hy > Y.waist + 12) {
    s += crease([Y.waist - 5, Y.waist + 7].map(y => `M${pt([CX - half(y) + 2, y])}q9 2.5 19 .5`).join(''), .13 * cl);
  }
  if (!G.tuck && ease + Math.max(0, t.flare) * .5 > 9 && hy > apY + 60) {
    const y0 = apY + 22, y1 = hy - 5, k = clamp((ease + t.flare * .5 - 9) / 28, 0, 1);
    s += crease([.66, .3].map(f => {
      const x0 = CX - half(y0) * f, x1 = CX - half(y1) * f * 1.04;
      return `M${pt([x0, y0])}Q${pt([x0 - 1.5, (y0 + y1) / 2])} ${pt([x1, y1])}`;
    }).join(''), .06 + .12 * k, 3.6);
  }
  if (G.tuck) {
    const { wy, wh } = G.tuck;
    s += crease(`M${pt([CX - wh + 4, wy - 16])}q5 7 7 14M${pt([CX - wh + 17, wy - 20])}q3 9 4 18M${pt([CX - 18, wy - 14])}q1 7 2 12`, .16);
  }
  return s;
}
function sleeveFolds(t, G) {
  if (G.nl) return '';
  let s = '';
  const w = y => armI(y) + G.si - (armO(y) - G.se);
  if (G.sy < 300) s += crease(`M${pt([G.AQ[0] - 1, G.AQ[1] + 5])}q-7 6 -15 7`, .14);
  else {
    const E = Y.waist - 4, k = clamp(1 - t.sfit / 14, .35, 1);
    s += crease([E - 12, E, E + 13].map((y, i) => `M${pt([armI(y) + G.si - 1, y])}q${r1(-w(y) * .3)} ${i % 2 ? 3 : -3} ${r1(-w(y) * (.55 + i * .08))} -1`).join(''), .15 * k);
    if (G.sy > ARM_I[ARM_I.length - 1][0] - 30)
      s += crease([G.sy - 14, G.sy - 27].map(y => `M${pt([armO(y) - G.se + 2, y])}q${r1(w(y) / 2)} 3 ${r1(w(y) - 4)} 0`).join(''), .13 * k);
  }
  return s;
}

let geo = { top: null, bottom: null };

// half-width of the bottom garment at y (0 where there is none), for a top worn over it
function underHalf() {
  const b = state.bottom, G = geo.bottom;
  if (!b || !G) return () => 0;
  if (b.kind === 'jeans') return y => y < G.wy ? 0 : y <= G.h1 ? lerp(G.wh, G.hipH(G.h1), (y - G.wy) / (G.h1 - G.wy)) : G.hipH(Math.min(y, G.h2));
  return y => y < G.wy || y > G.hy ? 0 : y <= G.hipY ? lerp(G.wh, G.hipH, (y - G.wy) / (G.hipY - G.wy))
    : G.hipH + (y - G.hipY) * (G.hemH - G.hipH) / Math.max(1, G.hy - G.hipY);
}
function renderTop() {
  const t = state.top;
  if (!t) { L('back').innerHTML = L('topbody').innerHTML = L('sleeves').innerHTML = ''; geo.top = null; return; }
  const tk = tucked() ? { wy: geo.bottom.wy, wh: geo.bottom.wh } : null;
  const G = geo.top = topGeo(t, tk ? () => 0 : underHalf(), tk), c = t.fill.c1, fill = fillOf(t.fill, 'top');
  const stitch = `stroke="${shade(c, -.38)}" stroke-opacity=".5" stroke-width=".9" stroke-dasharray="3 2.5" fill="none"`;
  const dm = dmgSVG(t.dmg);
  L('back').innerHTML = `<path d="${G.backD}" fill="${shade(c, -.32)}"/><path d="${G.backBandD}" fill="none" stroke="${shade(c, -.2)}" stroke-width="4"/>`;
  let pre = '', outer = `<path d="${G.bandD}" fill="none" stroke="${shade(c, -.1)}" stroke-width="5" stroke-linecap="round"/><path d="${G.bandD}" fill="none" stroke="${shade(c, -.3)}" stroke-opacity=".35" stroke-width=".8" transform="translate(0 2.6)"/>`;
  const hx = G.HL[0], hy = G.hy;
  if (!t.rawHem) pre += `<path d="M${pt([hx + 1, hy - 6])}Q${pt([CX, hy])} ${pt([400 - hx - 1, hy - 6])}" ${stitch}/>`;
  else outer += `<path d="${frayD(hx, 400 - hx, hy + 1, hy)}" stroke="${shade(c, -.15)}" stroke-width=".9" fill="none"/>`;
  L('topbody').innerHTML = piece('body', G.body, fill, pre + topFolds(t, G) + printSVG(t.print), dm, outer);
  if (G.nl) { L('sleeves').innerHTML = ''; return; }
  let sl = '';
  const prevCtx = CTX; CTX = 'arm';
  ['L', 'R'].forEach((side, i) => {
    const m = i ? mir : (p => p);
    let spre = i ? `<g transform="matrix(-1 0 0 1 400 0)">${mirrored(() => sleeveFolds(t, G))}</g>` : sleeveFolds(t, G), sout = '';
    if (t.rawSleeve) {
      const a = m(G.SO), b = m(G.SI);
      sout = `<path d="${frayD(Math.min(a[0], b[0]), Math.max(a[0], b[0]), G.sy + 1, G.sy + i)}" stroke="${shade(c, -.15)}" stroke-width=".9" fill="none"/>`;
    } else {
      const y = G.sy - (t.kind === 'long' && G.sy > 360 ? 15 : 7);
      const a = m([armO(y) - G.se + 1, y]), b = m([armI(y) + G.si - 1, y]);
      spre = t.kind === 'long' && G.sy > 360
        ? `<path d="M${pt(a)}L${pt(b)}" stroke="${shade(c, -.25)}" stroke-opacity=".6" stroke-width="1"/>`
        : `<path d="M${pt(a)}L${pt(b)}" ${stitch}/>`;
    }
    sl += piece('s' + side.toLowerCase(), i ? G.sleeveR : G.sleeveL, fill, spre, dm, sout);
  });
  CTX = prevCtx;
  L('sleeves').innerHTML = sl;
}

function jeansFolds(b, G) {
  const { cx, lh, hy } = G, across = (y, f) => `M${pt([cx(y) - lh(y) * f, y])}q${r1(lh(y) * f)} 3 ${r1(lh(y) * f * 2)} 0`;
  let s = '';
  // pull lines from the crotch toward the inner thigh
  if (hy > G.c0 + 50) s += crease(`M${pt([G.inX(G.c0 + 8) - 3, G.c0 + 8])}q-8 14 -16 34`, .11);
  // knee break, stronger when the leg is narrow there
  if (hy > Y.knee + 30) s += crease([Y.knee - 9, Y.knee + 5].map(y => across(y, .55)).join(''), .08 + .1 * (1 - b.knee));
  // stacking: a long, narrow hem piles up in soft zigzags above the ankle
  if (hy > Y.ankle - 4 && LEG.hem(b.hemW) < 27) s += crease([hy - 12, hy - 25, hy - 39].map(y => across(y, .8)).join(''), .14);
  // wide legs hang in one long drop fold down the middle
  if (b.knee > .55 && hy > Y.knee) s += crease(`M${pt([cx(440), 440])}L${pt([cx(hy - 10) + 3, hy - 10])}`, .07 + .1 * (b.knee - .55), 4);
  return s;
}

function renderBottom() {
  const b = state.bottom;
  if (!b) { L('bottom').innerHTML = ''; geo.bottom = null; return; }
  const c = b.fill.c1, fill = fillOf(b.fill, 'bottom');
  const post = dmgSVG(b.dmg);
  let pre = '', outer = '';
  if (b.kind === 'jeans') {
    const G = geo.bottom = jeansGeo(b), { wy, wh, hipH, cx, lh, inX, hy, c0 } = G, dc = c0 - 398;
    const amber = `stroke="#c8913a" stroke-width=".9" stroke-dasharray="2.6 1.8" fill="none"`;
    const wh2 = bodyHalf(wy + 13) + 3;
    pre += `<rect x="0" y="0" width="400" height="780" fill="url(#twill)"/>`;
    // worn-in fade down the front of each thigh and shin, nudged toward the light
    // a soft, long worn-in streak down the lit front of each leg (no round blobs: they read as bumps)
    pre += both(() => { const y0 = c0 + 40, y1 = Math.min(hy - 20, Y.knee + 70); if (y1 < y0 + 40) return '';
      const [x, y] = at([cx((y0 + y1) / 2) - lh((y0 + y1) / 2) * .18, (y0 + y1) / 2]);
      return `<ellipse cx="${r1(x)}" cy="${r1(y)}" rx="${r1(lh(y) * .42)}" ry="${r1((y1 - y0) / 2)}" fill="url(#fade)" opacity=".7"/>`; });
    // whiskers fan out from the crotch
    pre += `<path d="M${pt([181, 412 + dc])}q-10 -4 -20 -12M${pt([185, 422 + dc])}q-12 -3 -24 -11M${pt([219, 412 + dc])}q10 -4 20 -12M${pt([215, 422 + dc])}q12 -3 24 -11" stroke="#fff" stroke-opacity=".2" stroke-width="2" fill="none" stroke-linecap="round" filter="url(#soft)"/>`;
    pre += both(() => jeansFolds(b, G));
    pre += `<path d="M${pt([CX - wh, wy])}L${pt([CX + wh, wy])}L${pt([CX + wh2, wy + 13])}L${pt([CX - wh2, wy + 13])}Z" fill="${shade(c, -.1)}"/>`;
    pre += `<path d="M${pt([CX - wh, wy + 3])}L${pt([CX + wh, wy + 3])}M${pt([CX - wh2, wy + 10])}L${pt([CX + wh2, wy + 10])}" ${amber}/>`;
    [-wh + 7, -31, 31, wh - 7].forEach(dx => { const x = CX + dx; pre += `<path d="M${pt([x - 2, wy - 1])}L${pt([x + 2, wy - 1])}L${pt([x + 2, wy + 16])}L${pt([x - 2, wy + 16])}Z" fill="${shade(c, -.2)}"/>`; });
    const btn = at([CX, wy + 6.5]);
    pre += `<circle cx="${r1(btn[0])}" cy="${r1(btn[1])}" r="3.6" fill="#b08d57" stroke="#6f5530" stroke-width=".8"/>`;
    pre += `<path d="M${pt([CX, wy + 13])}L${pt([CX, c0 - 2])}" stroke="#000" stroke-opacity=".3" stroke-width="1.1"/><path d="M${pt([209, wy + 14])}L${pt([209, c0 - 46])}Q${pt([209, c0 - 34])} ${pt([CX, c0 - 28])}" ${amber}/>`;
    pre += `<path d="M${pt([166, wy + 13])}Q${pt([164, wy + 44])} ${pt([CX - hipH(wy + 50) + 1, wy + 50])}M${pt([234, wy + 13])}Q${pt([236, wy + 44])} ${pt([CX + hipH(wy + 50) - 1, wy + 50])}" ${amber}/>`;
    pre += `<path d="M${pt([226, wy + 16])}L${pt([228, wy + 32])}L${pt([241, wy + 30])}L${pt([240, wy + 15])}" ${amber}/>`;
    const hemLegs = [[G.outX(hy), inX(hy)], [400 - inX(hy), 400 - G.outX(hy)]];
    hemLegs.forEach(([a, z], i) => {
      if (b.rawHem) outer += `<path d="${frayD(a, z, hy + 1, hy + i)}" stroke="${shade(c, .65)}" stroke-width="1" fill="none"/>`;
      else pre += `<path d="M${pt([a + 1, hy - 7])}L${pt([z - 1, hy - 7])}" ${amber}/>`;
    });
    L('bottom').innerHTML = piece('bottom', G.d, fill, pre + printSVG(b.print), post, outer);
  } else {
    const G = geo.bottom = skirtGeo(b), { wy, wh, hipY, hipH, hemH, hy, baseY } = G;
    const wh2 = bodyHalf(wy + 12) + 2.5;
    pre += `<path d="M${pt([CX - wh, wy])}L${pt([CX + wh, wy])}L${pt([CX + wh2, wy + 12])}L${pt([CX - wh2, wy + 12])}Z" fill="${shade(c, -.1)}"/>`;
    pre += `<path d="M${pt([CX - wh2, wy + 12])}L${pt([CX + wh2, wy + 12])}" stroke="#000" stroke-opacity=".18" stroke-width=".8"/>`;
    G.folds.forEach(x => {
      const tx = CX - (CX - x) * (hipH / hemH) * .95;
      [[tx, x], [400 - tx, 400 - x]].forEach(([a, z]) => {
        pre += `<path d="M${inCtx('skirt', () => pt([a, hipY + 6]))}L${inCtx('skirt', () => pt([z, baseY(z) - 1]))}" stroke="#000" stroke-opacity=".1" stroke-width="3.2" stroke-linecap="round" filter="url(#soft)"/>`;
      });
    });
    if (b.rawHem) outer += `<path d="${inCtx('skirt', () => frayD(CX - hemH, CX + hemH, hy + 2, hy))}" stroke="${shade(c, -.15)}" stroke-width=".9" fill="none"/>`;
    L('bottom').innerHTML = piece('bottom', G.d, fill, pre + printSVG(b.print), post, outer);
  }
}

// a tucked top only makes sense when it is long enough to reach inside the bottom's waistband
const tucked = () => !!(state.top && state.top.tuck && geo.bottom && state.bottom && state.top.len > geo.bottom.wy + 10);
function render() {
  $('#defs').innerHTML = (state.top ? patDef('top', state.top.fill) : '') + (state.bottom ? patDef('bottom', state.bottom.fill) : '');
  renderBottom();
  renderTop();
  // tucked in, the bottom (and its waistband shadow) sits over the top's body
  svg.insertBefore(L('bottom'), tucked() ? L('arms') : L('topbody'));
  if (geo.top) {
    $('#defs').insertAdjacentHTML('beforeend', `<clipPath id="arm-clip"><path clip-rule="evenodd" d="M0 0H400V800H0Z${geo.top.yokeD}"/></clipPath>`);
    L('arms').setAttribute('clip-path', 'url(#arm-clip)');
  } else L('arms').removeAttribute('clip-path');
  renderOverlay();
  renderLayers();
}

/* ---------- overlay: handles, cut line, brush ---------- */
let hover = null, drag = null;
// while adjusting, garments turn see-through and the shape from before the change stays as a dashed outline
let ghost = null, sliderAdjust = false;
function startAdjust() {
  ghost = [geo.top && geo.top.body, geo.top && geo.top.sleeveL, geo.top && geo.top.sleeveR, geo.bottom && geo.bottom.d].filter(Boolean);
  svg.classList.add('adjusting');
}
function endAdjust() {
  if (!ghost) return;
  ghost = null; svg.classList.remove('adjusting');
  renderOverlay();
}
const adj = (p0, key, scale, side, p = at(p0)) =>
  `<g data-h="adj" data-key="${key}" data-scale="${r1(scale)}" data-side="${side}"><circle cx="${r1(p[0])}" cy="${r1(p[1])}" r="14" fill="transparent"/><circle cx="${r1(p[0])}" cy="${r1(p[1])}" r="7" fill="#fff" stroke="#161616" stroke-width="2"/></g>`;
const handle = (p0, h, side, shape, p = at(p0)) => shape === 'diamond'
  ? `<g data-h="${h}" data-side="${side}"><circle cx="${r1(p[0])}" cy="${r1(p[1])}" r="16" fill="transparent"/><rect x="${r1(p[0] - 6)}" y="${r1(p[1] - 6)}" width="12" height="12" transform="rotate(45 ${r1(p[0])} ${r1(p[1])})" fill="#fff" stroke="#161616" stroke-width="2"/></g>`
  : `<g data-h="${h}" data-side="${side}"><circle cx="${r1(p[0])}" cy="${r1(p[1])}" r="17" fill="transparent"/><circle cx="${r1(p[0])}" cy="${r1(p[1])}" r="7.5" fill="#fff" stroke="#161616" stroke-width="2"/></g>`;
const tag = (x, y, text, anchor = 'middle') =>
  `<text x="${r1(x)}" y="${r1(y)}" text-anchor="${anchor}" pointer-events="none" font-size="12" font-weight="700" fill="#161616" stroke="#fff" stroke-width="3.5" paint-order="stroke" stroke-linejoin="round" font-family="Pretendard Variable, Pretendard, Malgun Gothic, sans-serif">${text}</text>`;

function renderOverlay() {
  let s = '';
  const T = state.top, B = state.bottom;
  if (ghost) s += ghost.map(d => `<path d="${d}" fill="none" stroke="#fff" stroke-width="2.6" opacity=".7"/><path d="${d}" fill="none" stroke="#161616" stroke-width="1.3" stroke-dasharray="5 4"/>`).join('');
  if (tool === 'neck' && T && geo.top) {
    const G = geo.top;
    s += `<path d="${G.bandD}" fill="none" stroke="#161616" stroke-width="1.2" stroke-dasharray="4 3" opacity=".6"/>`;
    s += handle(G.mid, 'neckV', -1, 'diamond') + handle(mir(G.mid), 'neckV', 1, 'diamond');
    s += handle(G.NL, 'neckW', -1) + handle(mir(G.NL), 'neckW', 1) + handle(G.C0, 'neckD', 0);
    const tg = at([CX, G.C0[1] + 26]);
    s += tag(tg[0], tg[1], neckName(T));
  }
  if (tool === 'fit') {
    // one pair of handles per body part; shoulder/sleeve labels sit on the left, body/hem/leg labels on the right
    const labels = [];
    const pair = (p, key, scale, text, labelSide) => {
      s += adj(p, key, scale, -1) + adj(mir(p), key, scale, 1);
      const q = at(labelSide > 0 ? mir(p) : p);
      labels.push(tag(q[0] + 13 * labelSide, q[1] + 4, text, labelSide > 0 ? 'start' : 'end'));
    };
    if (T && geo.top) {
      const G = geo.top;
      if (!G.nl) {
        inCtx('arm', () => {
          pair(G.ST, 'top.drop', 1, '어깨 · ' + dropName(T.drop), -1);
          const y = (G.ST[1] + G.sy) / 2;
          pair([armO(y) - G.se, y], 'top.sfit', 1, '소매 · ' + sleeveFitName(T.sfit), -1);
        });
      }
      const yb = (G.apY + G.hy) / 2, yh = G.hy - 6;
      pair([CX - G.half(yb), yb], 'top.fit', 1, '몸통 · ' + topFitName(T.fit), 1);
      if (!G.tuck) pair([CX - G.half(yh), yh], 'top.flare', 1, '밑단 · ' + flareName(T.flare), 1);
    }
    if (B && geo.bottom) {
      const G = geo.bottom;
      if (B.kind === 'jeans') {
        const atY = y => [G.outX(y), y], yh = G.hy - 12;
        if (G.hy > 490) pair(atY(452), 'bottom.thigh', 17, '허벅지', 1);
        if (G.hy > 620) {
          pair(atY(Y.knee), 'bottom.knee', 22, '무릎', 1);
          pair(atY(yh), 'bottom.hemW', Math.max(8, 39 * (yh - Y.knee) / (735 - Y.knee)), '밑단 · ' + bottomFitName(B), 1);
        } else if (G.hy > 490) pair(atY(yh), 'bottom.knee', Math.max(6, 22 * (yh - 450) / (Y.knee - 450)), '밑단 · ' + bottomFitName(B), 1);
        else pair(atY(yh), 'bottom.thigh', 17, '밑단 · ' + bottomFitName(B), 1);
      } else {
        inCtx('skirt', () => {
          if (G.hy > G.hipY + 20) pair([CX - G.hipH, G.hipY], 'bottom.hip', 14, '엉덩이', 1);
          pair(G.handle, 'bottom.fit', Math.max(10, (G.hy - G.hipY) * .6 + 8), '밑단 · ' + bottomFitName(B), 1);
        });
      }
    }
    s += labels.join('');
  }
  if (tool === 'cut' && hover && hover.cut) {
    const { x0, x1, y, label } = hover.cut;
    s += `<path d="M${r1(x0 - 8)} ${r1(y)}L${r1(x1 + 8)} ${r1(y)}" stroke="#161616" stroke-width="1.6" stroke-dasharray="5 4"/>` +
         `<path d="M${r1(x0 - 8)} ${r1(y)}L${r1(x1 + 8)} ${r1(y)}" stroke="#fff" stroke-width="1.6" stroke-dasharray="5 4" stroke-dashoffset="4.5" opacity=".9"/>` +
         tag(x1 + 14, y + 4, '✂ ' + label, 'start');
  }
  if (tool === 'dmg' && hover && hover.p) {
    const [x, y] = hover.p;
    s += `<circle cx="${r1(x)}" cy="${r1(y)}" r="15" fill="none" stroke="#161616" stroke-width="1.4" stroke-dasharray="3 3"/><circle cx="${r1(x)}" cy="${r1(y)}" r="15" fill="none" stroke="#fff" stroke-width="1.4" stroke-dasharray="3 3" stroke-dashoffset="3"/>`;
    if (dmgMode === 'erase') s += tag(x, y - 22, '지우개');
  }
  if (tool === 'color') {
    const g = state[state.target];
    if (g && g.print && images[g.print.img]) {
      const p = g.print, w = p.w, h = p.w * p.ar, [pcx, pcy] = at([p.cx, p.cy]);
      s += `<rect x="${r1(pcx - w / 2)}" y="${r1(pcy - h / 2)}" width="${r1(w)}" height="${r1(h)}" fill="none" stroke="#161616" stroke-width="1.2" stroke-dasharray="4 3"/>`;
    }
  }
  L('ov').innerHTML = s;
}

/* ---------- hit testing ---------- */
const SP = svg.createSVGPoint();
function inside(id, x, y) {
  const el = document.getElementById('hit-' + id);
  if (!el) return false;
  SP.x = x; SP.y = y;
  return el.isPointInFill(SP);
}
function pieceAt(p) { return (tucked() ? ['sl', 'sr', 'bottom', 'body'] : ['sl', 'sr', 'body', 'bottom']).find(id => inside(id, p[0], p[1])) || null; }
const garmentOf = piece => piece ? (piece === 'bottom' ? 'bottom' : 'top') : null;
function extent(id, y) {
  let a = null, z = null;
  for (let x = 30; x <= 370; x += 2) if (inside(id, x, y)) { if (a === null) a = x; z = x; }
  return a === null ? null : [a, z];
}
function svgPt(e) {
  SP.x = e.clientX; SP.y = e.clientY;
  const q = SP.matrixTransform(svg.getScreenCTM().inverse());
  return [q.x, q.y];
}

const ctxOf = id => id === 'sl' || id === 'sr' ? 'arm' : id === 'bottom' && state.bottom && state.bottom.kind === 'skirt' ? 'skirt' : 'body';
function cutAt(p) {
  const id = pieceAt(p);
  if (!id) return null;
  const y = unwarp(p, ctxOf(id))[1];
  if (id === 'sl' || id === 'sr') {
    const T = state.top, ny = y <= Y.armpit + 8 ? 190 : y;
    if (ny >= T.sleeve - 4) return null;
    const ex = extent(id, Math.max(p[1], 150));
    return ex && { key: 'sleeve', val: ny, x0: ex[0], x1: ex[1], y: p[1], label: sleeveName(ny) };
  }
  // on screen the cut sits where the pointer is, shifted by however much the limit moved it
  const line = (key, ny, label) => {
    const sy = p[1] + ny - y, ex = extent(id, sy);
    return ex && { key, val: ny, x0: ex[0], x1: ex[1], y: sy, label };
  };
  if (id === 'body') {
    const T = state.top, ny = clamp(y, LIMIT['top.len'][0], T.len);
    return ny >= T.len - 4 ? null : line('topLen', ny, topLenName(ny));
  }
  const B = state.bottom, ny = clamp(y, bottomLenLimit(B)[0], B.len);
  return ny >= B.len - 4 ? null : line('bottomLen', ny, bottomLenName(B, ny));
}

/* ---------- pointer ---------- */
svg.addEventListener('pointerdown', e => {
  if (e.button > 0) return;
  const p = svgPt(e), h = e.target.closest('[data-h]');
  const start = () => { svg.setPointerCapture(e.pointerId); svg.classList.add('dragging'); e.preventDefault(); };
  if (h) {
    const key = h.dataset.key;
    drag = { h: h.dataset.h, side: +h.dataset.side, p0: p, key, scale: +h.dataset.scale, v0: key ? getK(key) : 0 };
    startAdjust();
    return start();
  }
  if (tool === 'cut') {
    // touch has no hover: show the cut line while the finger is down, cut on release
    if (e.pointerType !== 'mouse') { drag = { h: 'cut' }; hover = { cut: cutAt(p) }; renderOverlay(); return start(); }
    applyCut(cutAt(p), p);
    return;
  }
  if (tool === 'dmg') {
    const g = garmentOf(pieceAt(p));
    if (!g) return;
    drag = { h: 'paint', g, last: p };
    paint(p, g, true);
    return start();
  }
  if (tool === 'color') {
    const g = state[state.target];
    if (g && g.print) {
      const pr = g.print, w = pr.w, hh = pr.w * pr.ar;
      if (Math.abs(p[0] - pr.cx) < w / 2 && Math.abs(p[1] - pr.cy) < hh / 2) {
        drag = { h: 'print', p0: p, cx: pr.cx, cy: pr.cy };
        return start();
      }
    }
    const tg = garmentOf(pieceAt(p));
    if (tg && tg !== state.target) { state.target = tg; renderPanel(); renderOverlay(); }
  }
});

svg.addEventListener('pointermove', e => {
  const p = svgPt(e);
  if (!drag) {
    if (tool === 'cut') hover = { cut: cutAt(p) };
    else if (tool === 'dmg') hover = { p: pieceAt(p) ? p : null };
    else hover = null;
    if (tool === 'cut' || tool === 'dmg') renderOverlay();
    if (tool === 'color') {
      const g = state[state.target], pr = g && g.print;
      svg.style.cursor = pr && Math.abs(p[0] - pr.cx) < pr.w / 2 && Math.abs(p[1] - pr.cy) < pr.w * pr.ar / 2 ? 'move' : (pieceAt(p) ? 'pointer' : '');
    } else svg.style.cursor = '';
    return;
  }
  const T = state.top, B = state.bottom, d = drag;
  const out = d.side < 0 ? d.p0[0] - p[0] : p[0] - d.p0[0];
  if (d.h === 'cut') { hover = { cut: cutAt(p) }; renderOverlay(); return; }
  switch (d.h) {
    case 'neckD': T.neckD = clamp(unwarp(p)[1] - Y.neck, ...LIMIT['top.neckD']); break;
    case 'neckW': { const q = unwarp(p); T.neckW = clamp(d.side < 0 ? CX - q[0] : q[0] - CX, ...LIMIT['top.neckW']); break; }
    case 'neckV': {
      // how far the handle sits from the straight NL→C0 line: on the line = V, at the round bulge = U
      const G = geo.top, r = unwarp(p), q = d.side > 0 ? mir(r) : r, A = G.NL, B = G.C0;
      const u = [B[0] - A[0], B[1] - A[1]], n = Math.hypot(...u);
      const off = v => ((v[0] - A[0]) * u[1] - (v[1] - A[1]) * u[0]) / n;
      const bulge = off(G.Um);
      if (Math.abs(bulge) > .5) T.neckV = clamp(1 - off(q) / bulge, 0, 1);
      break;
    }
    case 'adj': setK(d.key, r1(clamp(d.v0 + out / d.scale, ...LIMIT[d.key]) * 100) / 100); break;
    case 'print': { const pr = state[state.target].print; pr.cx = d.cx + p[0] - d.p0[0]; pr.cy = d.cy + p[1] - d.p0[1]; break; }
    case 'paint':
      hover = { p };
      if (Math.hypot(p[0] - d.last[0], p[1] - d.last[1]) > 13 && garmentOf(pieceAt(p)) === d.g) { paint(p, d.g, false); d.last = p; }
      else { renderOverlay(); return; }
      break;
  }
  render(); syncPanel();
});
function applyCut(c, p) {
  if (!c) return;
  if (c.key === 'sleeve') { state.top.sleeve = c.val; state.top.rawSleeve = c.val > SLEEVELESS; }
  else if (c.key === 'topLen') { state.top.len = c.val; state.top.rawHem = true; }
  else { state.bottom.len = c.val; state.bottom.rawHem = true; }
  render(); hover = p ? { cut: cutAt(p) } : null; renderOverlay(); syncPanel(); commit();
  say('싹둑! ' + c.label);
}
function endDrag() {
  if (!drag) return;
  if (drag.h === 'cut') { drag = null; svg.classList.remove('dragging'); applyCut(hover && hover.cut, null); renderOverlay(); return; }
  drag = null; svg.classList.remove('dragging');
  endAdjust();
  commit();
}
svg.addEventListener('pointerup', endDrag);
svg.addEventListener('pointercancel', endDrag);
svg.addEventListener('pointerleave', () => { if (!drag && hover) { hover = null; renderOverlay(); } });

function paint(p, g, first) {
  const list = state[g].dmg, c = ctxOf(pieceAt(p)), q = unwarp(p, c);
  const near = list.reduce((best, d, i) => { const dist = Math.hypot(d.x - q[0], d.y - q[1]); return dist < (best ? best.dist : 16) ? { i, dist } : best; }, null);
  if (dmgMode === 'erase') { if (near) list.splice(near.i, 1); }
  else if (near) { if (first) list[near.i].lv = Math.min(3, list[near.i].lv + 1); }
  else list.push(c === 'body' ? { x: r1(q[0]), y: r1(q[1]), lv: 1 } : { x: r1(q[0]), y: r1(q[1]), lv: 1, c });
  hover = { p };
  render();
}

/* ---------- history ---------- */
let hist = [], hi = -1;
const snapshot = () => JSON.stringify({ top: state.top, bottom: state.bottom });
function commit() {
  const s = snapshot();
  if (hist[hi] === s) return;
  hist = hist.slice(0, hi + 1); hist.push(s);
  if (hist.length > 150) hist.shift();
  hi = hist.length - 1;
  save(); updateActs();
}
function restore(s) {
  const o = JSON.parse(s);
  state.top = o.top; state.bottom = o.bottom;
  if (!state[state.target]) state.target = state.top ? 'top' : 'bottom';
  renderAll(); save(); updateActs();
}
const undo = () => { if (hi > 0) { hi--; restore(hist[hi]); say('되돌렸어요'); } };
const redo = () => { if (hi < hist.length - 1) { hi++; restore(hist[hi]); say('다시 했어요'); } };
function updateActs() { $('#undo').disabled = hi <= 0; $('#redo').disabled = hi >= hist.length - 1; }
function save() {
  const used = {};
  [state.top, state.bottom].forEach(g => { if (g && g.print && images[g.print.img]) used[g.print.img] = images[g.print.img]; });
  try { localStorage.setItem(STORE, JSON.stringify({ top: state.top, bottom: state.bottom, images: used })); }
  catch (e) { try { localStorage.setItem(STORE, JSON.stringify({ top: state.top, bottom: state.bottom, images: {} })); } catch (e2) { /* ignore */ } }
}

let sayTimer;
function say(msg) {
  const el = $('#status'); el.textContent = msg; el.classList.add('show');
  clearTimeout(sayTimer); sayTimer = setTimeout(() => el.classList.remove('show'), 1400);
}

/* ---------- wardrobe ---------- */
function iconSVG(kind) { POSE_OFF = true; try { return iconSVGRaw(kind); } finally { POSE_OFF = false; } }
function iconSVGRaw(kind) {
  const g = DEF[kind], c = g.fill.c1 === '#f3f1ec' ? '#fbfaf7' : g.fill.c1, st = 'stroke="currentColor" stroke-opacity=".5" stroke-width="2" stroke-linejoin="round"';
  if (SLOT[kind] === 'top') {
    const G = topGeo(g), f = kind === 'long' ? '#fbfaf7' : c;
    const stripes = kind === 'long' ? `<clipPath id="ic-${kind}"><path d="${G.body}"/><path d="${G.sleeveL}"/><path d="${G.sleeveR}"/></clipPath><g clip-path="url(#ic-${kind})">${Array.from({ length: 16 }, (_, i) => `<rect x="80" y="${120 + i * 20}" width="240" height="8" fill="#24324a"/>`).join('')}</g>` : '';
    return `<svg viewBox="94 104 212 ${Math.max(226, g.len, g.sleeve) - 78}" aria-hidden="true"><path d="${G.body}" fill="${f}" ${st}/><path d="${G.sleeveL}" fill="${f}" ${st}/><path d="${G.sleeveR}" fill="${f}" ${st}/>${stripes}<path d="${G.sleeveL}" fill="none" ${st}/><path d="${G.sleeveR}" fill="none" ${st}/></svg>`;
  }
  const d = kind === 'jeans' ? jeansGeo(g).d : skirtGeo(g).d;
  return `<svg viewBox="${kind === 'jeans' ? '118 284 164 462' : '108 280 184 220'}" aria-hidden="true"><path d="${d}" fill="${c}" ${st}/></svg>`;
}
const NAME_EN = { tee: 'T-shirt', crop: 'Crop tee', fitted: 'Fitted tee', long: 'Long sleeve', jeans: 'Denim', skirt: 'Skirt' };
function renderCards() {
  [['top', ['tee', 'crop', 'fitted', 'long']], ['bottom', ['jeans', 'skirt']]].forEach(([slot, kinds]) => {
    $('#cards-' + slot).innerHTML = kinds.map(k => `<button type="button" class="card" data-kind="${k}" aria-pressed="${state[slot]?.kind === k}">${iconSVG(k)}<span class="nm">${NAME[k]}</span><span class="en">${NAME_EN[k]}</span></button>`).join('');
  });
  $('#w-count').textContent = Object.keys(DEF).length + '벌';
}
// worn garments as layers: pick one to edit, or take it off
function layerSub(slot) {
  const g = state[slot];
  if (slot === 'top') return [topFitName(g.fit), sleeveName(g.sleeve), topLenName(g.len), tucked() ? '넣어 입음' : ''].filter(Boolean).join(' · ');
  return [bottomFitName(g), bottomLenName(g, g.len)].join(' · ');
}
function renderLayers() {
  const rows = ['top', 'bottom'].filter(s => state[s]).map(s => {
    const g = state[s], f = g.fill;
    const bg = f.type === 'solid' ? f.c1 : `linear-gradient(135deg,${f.c1} 0 50%,${f.c2} 50% 100%)`;
    return `<li class="layer" data-layer="${s}" aria-current="${state.target === s}"><span class="sw2" style="background:${bg}"></span>` +
      `<span class="tx"><b>${NAME[g.kind]}</b><span>${layerSub(s)}</span></span>` +
      `<button type="button" class="x" data-off="${s}" aria-label="${NAME[g.kind]} 벗기" title="벗기"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8"/></svg></button></li>`;
  });
  $('#layers').innerHTML = rows.join('') || '<li class="empty-l">아무것도 입지 않았어요.</li>';
  const g = state[state.target];
  $('#insp-target').innerHTML = g ? `<i style="background:${g.fill.c1}"></i>${NAME[g.kind]}` : '';
}
document.querySelector('.wardrobe').addEventListener('click', e => {
  const off = e.target.closest('[data-off]');
  if (off) {
    const s = off.dataset.off, n = NAME[state[s].kind];
    state[s] = null; say(n + '을(를) 벗었어요');
    if (!state[state.target]) state.target = state.top ? 'top' : 'bottom';
    renderAll(); commit(); return;
  }
  const ly = e.target.closest('[data-layer]');
  if (ly) { state.target = ly.dataset.layer; renderPanel(); renderLayers(); return; }
  const b = e.target.closest('[data-kind]');
  if (!b) return;
  const k = b.dataset.kind, slot = SLOT[k];
  if (state[slot]?.kind === k) { state[slot] = null; say(NAME[k] + '을(를) 벗었어요'); }
  else { state[slot] = clone(DEF[k]); state.target = slot; say(NAME[k] + ' 입었어요'); }
  if (!state[state.target]) state.target = state.top ? 'top' : 'bottom';
  renderAll(); commit();
});

/* ---------- studio: body, finish, backdrop, guides ---------- */
function renderStudio() {
  $('#bodybar').innerHTML = Object.entries(BODIES).map(([id, b]) =>
    `<button type="button" class="seg-b" role="radio" data-body="${id}" aria-checked="${prefs.body === id}">${b.name}</button>`).join('') +
    `<span class="sep" aria-hidden="true"></span>` + Object.entries(POSES).map(([id, p]) =>
    `<button type="button" class="seg-b" role="radio" data-pose="${id}" aria-checked="${prefs.pose === id}" aria-label="자세: ${p.name}">${p.name}</button>`).join('');
  const dot = (attr, id, color, name) => `<button type="button" class="dot-b" role="radio" data-${attr}="${id}" aria-checked="${prefs[attr] === id}" aria-label="${name}" title="${name}"><i style="background:${color}"></i></button>`;
  $('#dock').innerHTML =
    `<span class="lbl">마네킹</span><span role="radiogroup" aria-label="마네킹 색" style="display:flex;gap:2px">${Object.entries(FINISH).map(([id, f]) => dot('finish', id, f.base, '마네킹 ' + f.name)).join('')}</span>` +
    `<span class="sep" aria-hidden="true"></span><span class="lbl">배경</span><span role="radiogroup" aria-label="배경" style="display:flex;gap:2px">${Object.entries(BACKDROP).map(([id, b]) => dot('backdrop', id, `radial-gradient(circle at 35% 35%,${b.c0},${b.c1})`, '배경 ' + b.name)).join('')}</span>` +
    `<span class="sep" aria-hidden="true"></span><button type="button" class="ghost-b" data-guides aria-pressed="${prefs.guides}" title="조절 점 보이기/숨기기 (H)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${prefs.guides
      ? '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'
      : '<path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/>'}</svg><span class="t">${prefs.guides ? '점 보기' : '점 숨김'}</span></button>`;
  const B = BODY;
  $('#spec').innerHTML = `<span class="k">${B.en}</span><span class="v">${B.name} · ${B.height}cm</span>` +
    `<dl><dt>가슴</dt><dd>${B.bust}</dd><dt>허리</dt><dd>${B.waist}</dd><dt>엉덩이</dt><dd>${B.hip}</dd><dt>사이즈</dt><dd>${B.sizeKr}</dd></dl>`;
  svg.classList.toggle('no-guides', !prefs.guides);
}
function setBody(id) {
  if (!BODIES[id] || id === prefs.body) return;
  prefs.body = id; savePrefs(); useBody(id); computePose(prefs.pose);
  drawMannequin(); renderStudio(); renderAll();
  say(BODY.name + ' 체형으로 바꿨어요 — 옷이 새 몸에 맞춰져요');
}
function setPose(id) {
  if (!POSES[id] || id === prefs.pose) return;
  prefs.pose = id; savePrefs(); computePose(id);
  drawMannequin(); renderStudio(); render();
  say(POSES[id].name + ' 자세');
}
function toggleGuides() { prefs.guides = !prefs.guides; savePrefs(); renderStudio(); }
$('.stage-wrap').addEventListener('click', e => {
  const b = e.target.closest('[data-body],[data-pose],[data-finish],[data-backdrop],[data-guides]');
  if (!b) return;
  const d = b.dataset;
  if (d.body) return setBody(d.body);
  if (d.pose) return setPose(d.pose);
  if (d.finish) { prefs.finish = d.finish; drawMannequin(); render(); }
  else if (d.backdrop) { prefs.backdrop = d.backdrop; drawBackdrop(); }
  else return toggleGuides();
  savePrefs(); renderStudio();
});

/* ---------- tools & panel ---------- */
const ICON = {
  neck: '<path d="M4 5c1.5 0 3 .2 4 .8C9 9 10.2 12 12 12s3-3 4-6.2c1-.6 2.5-.8 4-.8"/><path d="M4 5v14h16V5"/>',
  cut: '<circle cx="6" cy="18" r="3"/><circle cx="18" cy="18" r="3"/><path d="M8.2 15.8 19 3M15.8 15.8 5 3"/>',
  dmg: '<path d="M5 3v18M19 3v18"/><path d="M8 10q4 -2 8 0M8 13q4 2 8 0M9 11.5h6"/>',
  fit: '<path d="M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4"/>',
  color: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/><path d="M8.5 14.5a3.5 3.5 0 0 0 3.5 3.5"/>',
};
const TOOLS = [['neck', '넥라인'], ['cut', '가위'], ['dmg', '데미지'], ['fit', '통·핏'], ['color', '색·무늬']];
const TOOL_HINT = {
  neck: '목 아래 점을 끌어 깊이·넓이를, 마름모 점으로 U↔V를 바꿔요',
  cut: '자를 높이에 대고 클릭하면 그 자리에서 잘려요',
  dmg: '옷을 누를수록 워싱 → 해짐 → 찢어짐',
  fit: '부위별 점을 바깥으로 끌면 넓어지고 안쪽으로 끌면 좁아져요',
  color: '색을 고르거나 마네킹의 옷을 눌러 고칠 옷을 바꿔요',
};
$('#toolbar').innerHTML = TOOLS.map(([id, name], i) =>
  `<button type="button" class="tool" data-tool="${id}" aria-pressed="false" title="${name} (${i + 1})"><span class="k" aria-hidden="true">${i + 1}</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[id]}</svg>${name}</button>`).join('');
$('#toolbar').addEventListener('click', e => { const b = e.target.closest('[data-tool]'); if (b) setTool(b.dataset.tool); });
function setTool(id) {
  tool = id; hover = null; svg.dataset.tool = id; svg.style.cursor = '';
  document.querySelectorAll('.tool').forEach(b => b.setAttribute('aria-pressed', b.dataset.tool === id));
  $('#foot-hint').innerHTML = `<b>${TOOLS.find(t => t[0] === id)[1]}</b>${TOOL_HINT[id]}`;
  renderPanel(); renderOverlay();
}

const COLORS = [['흰색', '#f3f1ec'], ['아이보리', '#e9e1cf'], ['베이지', '#c7b299'], ['카키', '#8b8256'], ['올리브', '#556045'], ['그린', '#2f5d46'], ['하늘', '#a9c8e0'], ['연청', '#8aa4bf'], ['중청', '#4a6787'],
  ['네이비', '#24324a'], ['그레이', '#9a9a96'], ['차콜', '#3b3b3b'], ['블랙', '#1c1c1c'], ['브라운', '#6b4a33'], ['버건디', '#6e2533'], ['레드', '#b8382e'], ['핑크', '#e8b4b8'], ['버터', '#efd98a']];
const PATS = [['solid', '단색'], ['stripe', '스트라이프'], ['check', '체크'], ['dot', '도트']];
const FIT_PRESETS = {
  top: [['딱 붙게', { fit: -2, sfit: -2, drop: 0, flare: -2, cling: 1 }], ['레귤러', { fit: 5, sfit: 2, drop: 3, flare: 0, cling: .35 }],
        ['오버핏', { fit: 26, sfit: 16, drop: 20, flare: 2, cling: 0 }], ['박시', { fit: 30, sfit: 10, drop: 14, flare: -6, cling: 0 }]],
  jeans: [['스키니', { thigh: .1, knee: .05, hemW: .05 }], ['슬림', { thigh: .3, knee: .25, hemW: .2 }], ['스트레이트', { thigh: .45, knee: .45, hemW: .4 }],
          ['부츠컷', { thigh: .4, knee: .3, hemW: .6 }], ['와이드', { thigh: .8, knee: .85, hemW: .85 }]],
  skirt: [['H라인', { hip: 0, fit: 0 }], ['A라인', { hip: .1, fit: .35 }], ['플레어', { hip: .15, fit: .75 }]],
};
const parseHex = s => {
  let h = String(s).trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(h)) h = h.split('').map(c => c + c).join('');
  return /^[0-9a-f]{6}$/i.test(h) ? '#' + h.toLowerCase() : null;
};
const PRESETS = { round: ['라운드', 12, 20, 0], u: ['U넥', 62, 30, 0], v: ['V넥', 58, 22, 1], deepv: ['딥 V', 112, 26, 1], boat: ['보트넥', 10, 50, 0] };

function getK(k) {
  const [g, ...rest] = k.split('.'), o = g === 'cur' ? state[state.target] : state[g];
  return rest.reduce((a, x) => a == null ? a : a[x], o);
}
function setK(k, v) {
  const [g, ...rest] = k.split('.'), o = g === 'cur' ? state[state.target] : state[g];
  const last = rest.pop(), obj = rest.reduce((a, x) => a[x], o);
  obj[last] = v;
}
const OUT = {
  'top.neckD': () => neckName(state.top), 'top.neckW': () => state.top.neckW >= 40 ? '넓게' : state.top.neckW <= 17 ? '좁게' : '보통',
  'top.neckV': () => state.top.neckV < .35 ? 'U' : state.top.neckV > .65 ? 'V' : '중간',
  'top.len': () => topLenName(state.top.len), 'top.sleeve': () => sleeveName(state.top.sleeve),
  'bottom.len': () => bottomLenName(state.bottom, state.bottom.len),
  'top.fit': () => topFitName(state.top.fit), 'bottom.fit': () => bottomFitName(state.bottom),
  'top.sfit': () => sleeveFitName(state.top.sfit), 'top.cling': () => clingName(state.top.cling), 'top.drop': () => dropName(state.top.drop), 'top.flare': () => flareName(state.top.flare),
  'bottom.thigh': () => wideName(state.bottom.thigh), 'bottom.knee': () => wideName(state.bottom.knee),
  'bottom.hemW': () => bottomFitName(state.bottom), 'bottom.hip': () => wideName(state.bottom.hip),
  'cur.fill.scale': () => '×' + (getK('cur.fill.scale') || 1).toFixed(1),
  'cur.print.w': () => Math.round(getK('cur.print.w') || 0) + '',
};
const slider = (k, label, min, max, step) =>
  `<label class="row"><span class="lab">${label}<b data-out="${k}"></b></span><input type="range" data-k="${k}" min="${min}" max="${max}" step="${step}"></label>`;
const wideName = v => v < .25 ? '좁게' : v < .6 ? '보통' : '넓게';
/* dye picker: a brightness/saturation square with a draggable dot, a rainbow hue bar, and a hex code box — all in sync */
function hexToHsv(hex) {
  const n = parseInt(hex.slice(1), 16), r = (n >> 16) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), d = mx - Math.min(r, g, b);
  let h = 0;
  if (d) { h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; if (h < 0) h += 360; }
  return { h, s: mx ? d / mx : 0, v: mx };
}
function hsvToHex({ h, s, v }) {
  const f = n => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return '#' + [f(5), f(3), f(1)].map(x => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
}
const pickHSV = {};   // remembers hue while a colour is grey/black, where the hex alone loses it
function getHSV(c) {
  const key = state.target + c, hex = state[state.target].fill[c], cur = pickHSV[key];
  return cur && hsvToHex(cur) === hex ? cur : (pickHSV[key] = hexToHsv(hex));
}
function setHSV(c, hsv) {
  pickHSV[state.target + c] = hsv;
  state[state.target].fill[c] = hsvToHex(hsv);
  render(); syncPanel();
}
const RAINBOW = [['빨', 0], ['주', 30], ['노', 58], ['초', 120], ['파', 205], ['남', 238], ['보', 275]];
const picker = (c, label) => `<div class="picker">
    <div class="sv" data-sv="${c}" tabindex="0" role="slider" aria-label="${label} 명암 — 점을 끌어서 밝기와 선명도 조절"><span class="sv-dot"></span></div>
    <input type="range" class="hue" data-hue="${c}" min="0" max="360" step="1" aria-label="${label} 색상 (빨주노초파남보)">
    <div class="hue-names" aria-hidden="true">${RAINBOW.map(([n, h]) => `<span style="left:${(h / 360 * 100).toFixed(1)}%">${n}</span>`).join('')}</div>
    <div class="hexrow"><span class="prev" data-prev="${c}"></span><input type="text" class="hex" data-hex="${c}" maxlength="7" spellcheck="false" autocomplete="off" placeholder="#ffffff" aria-label="${label} 코드"><span class="note" style="margin:0">색상 코드</span></div>
  </div>`;
const fitChips = (slot, list) =>
  `<div class="chips" style="margin:0 0 12px">${list.map(([n], i) => `<button type="button" class="chip" data-fitp="${slot}:${i}">${n}</button>`).join('')}</div>`;
const need = what => `<p class="empty">${what}을 먼저 입혀 주세요. 왼쪽 <b>옷 고르기</b>에서 고를 수 있어요.</p>`;

function panelHTML() {
  const T = state.top, B = state.bottom;
  switch (tool) {
    case 'neck':
      if (!T) return need('상의');
      return `<p class="hint">목 아래 <b>동그란 점</b>을 아래로 끌면 깊어지고, 양옆 점은 넓어져요. <b>마름모 점</b>을 안쪽으로 끌면 V넥, 바깥으로 끌면 U넥이 돼요.</p>
        <div class="chips" style="margin-bottom:18px">${Object.entries(PRESETS).map(([id, p]) => `<button type="button" class="chip" data-preset="${id}">${p[0]}</button>`).join('')}</div>
        ${slider('top.neckD', '깊이', ...LIMIT['top.neckD'], 1)}${slider('top.neckW', '넓이', ...LIMIT['top.neckW'], 1)}${slider('top.neckV', '모양 (U ↔ V)', 0, 1, .01)}`;
    case 'cut':
      if (!T && !B) return need('옷');
      return `<p class="hint">자르고 싶은 높이에 대고 <b>클릭</b>하세요. 소매에 대면 소매가 잘리고, 어깨 가까이 자르면 <b>민소매</b>가 돼요.</p>
        ${T ? slider('top.len', '상의 기장', ...LIMIT['top.len'], 1) + slider('top.sleeve', '소매 기장', ...LIMIT['top.sleeve'], 1) : ''}
        ${B ? slider('bottom.len', '하의 기장', ...bottomLenLimit(B), 1) : ''}
        <p class="note" style="margin-top:4px">가위는 자르기만 해요. 막대를 밀면 다시 길게 만들 수 있어요.</p>`;
    case 'dmg':
      if (!T && !B) return need('옷');
      return `<p class="hint">옷을 <b>클릭</b>하면 워싱이 생기고, 같은 곳을 또 누르면 해지고, 한 번 더 누르면 <b>찢어져요</b>. 누른 채 끌면 붓처럼 칠해져요.</p>
        <div class="btn-row"><button type="button" class="chip" data-mode="paint">칠하기</button><button type="button" class="chip" data-mode="erase">지우개</button><button type="button" class="chip" data-act="clear-dmg">전부 지우기</button></div>`;
    case 'fit':
      if (!T && !B) return need('옷');
      return `<p class="hint">부위마다 <b>점이 따로</b> 있어요. 바깥으로 끌면 넓어지고 안쪽으로 끌면 좁아져요. 조절하는 동안 옷이 <b>반투명</b>해지고 원래 모양이 점선으로 남아요.</p>
        ${T ? `<span class="label-sm">상의 · ${NAME[T.kind]}</span>${fitChips('top', FIT_PRESETS.top)}
          ${B && T.len > Y.waist + BODY.rise + 10 ? `<div class="seg2" role="group" aria-label="입는 방법"><button type="button" class="chip" data-tuck="0">밖으로 빼 입기</button><button type="button" class="chip" data-tuck="1">넣어 입기</button></div>` : ''}
          ${slider('top.fit', '몸통 품', ...LIMIT['top.fit'], .5)}${slider('top.cling', '허리 라인 (일자 ↔ 붙게)', 0, 1, .01)}
          ${geo.top && !geo.top.nl ? slider('top.sfit', '소매 품', ...LIMIT['top.sfit'], .5) + slider('top.drop', '어깨선', ...LIMIT['top.drop'], .5) : ''}
          ${slider('top.flare', '밑단 퍼짐', ...LIMIT['top.flare'], .5)}` : ''}
        ${B ? `<span class="label-sm">하의 · ${NAME[B.kind]}</span>${fitChips(B.kind, FIT_PRESETS[B.kind])}
          ${B.kind === 'jeans'
            ? slider('bottom.thigh', '허벅지', 0, 1, .01) + slider('bottom.knee', '무릎', 0, 1, .01) + slider('bottom.hemW', '밑단', 0, 1, .01)
            : slider('bottom.hip', '엉덩이', 0, 1, .01) + slider('bottom.fit', '밑단 퍼짐', 0, 1, .01)}` : ''}`;
    case 'color': {
      const g = state[state.target];
      if (!g) return need('옷');
      const pat = g.fill.type !== 'solid';
      return `<div class="chips" role="group" aria-label="고칠 옷" style="margin-bottom:6px">
          <button type="button" class="chip" data-target="top" ${T ? '' : 'disabled'}>상의${T ? ' · ' + NAME[T.kind] : ''}</button>
          <button type="button" class="chip" data-target="bottom" ${B ? '' : 'disabled'}>하의${B ? ' · ' + NAME[B.kind] : ''}</button></div>
        <p class="note" style="margin:0 0 4px">마네킹의 옷을 눌러도 바꿀 수 있어요.</p>
        <span class="label-sm">색</span>
        ${picker('c1', '색')}
        <div class="swatches">${COLORS.map(([n, c]) => `<button type="button" class="sw" data-c1="${c}" style="background:${c}" aria-label="${n}" title="${n} ${c}"></button>`).join('')}</div>
        <span class="label-sm">무늬</span>
        <div class="chips">${PATS.map(([id, n]) => `<button type="button" class="chip" data-pat="${id}">${n}</button>`).join('')}</div>
        ${pat ? `<span class="label-sm">무늬 색</span>
          ${picker('c2', '무늬 색')}
          <div class="swatches">${COLORS.map(([n, c]) => `<button type="button" class="sw" data-c2="${c}" style="background:${c}" aria-label="무늬 ${n}" title="${n} ${c}"></button>`).join('')}</div>
          <div style="margin-top:14px">${slider('cur.fill.scale', '무늬 크기', .5, 2.5, .1)}</div>` : ''}
        <span class="label-sm">내 이미지 프린트</span>
        <div class="btn-row"><label class="file">${g.print ? '이미지 바꾸기' : '이미지 올리기'}<input type="file" accept="image/*" id="print-file"></label>
          ${g.print ? '<button type="button" class="chip" data-act="del-print">프린트 지우기</button>' : ''}</div>
        ${g.print ? `<p class="note">프린트를 끌어서 옮길 수 있어요.</p><div style="margin-top:12px">${slider('cur.print.w', '프린트 크기', 24, 220, 1)}</div>` : ''}`;
    }
  }
  return '';
}
function renderPanel() {
  const name = TOOLS.find(t => t[0] === tool)[1];
  $('#panel-title').textContent = name;
  $('#panel').innerHTML = panelHTML();
  syncPanel();
}
function syncPanel() {
  const P = $('#panel');
  P.querySelectorAll('[data-k]').forEach(el => {
    const v = getK(el.dataset.k); if (v != null && document.activeElement !== el) el.value = v;
    el.style.setProperty('--p', ((el.value - el.min) / (el.max - el.min) * 100).toFixed(1) + '%');
  });
  P.querySelectorAll('[data-tuck]').forEach(b => b.setAttribute('aria-pressed', !!state.top && !!state.top.tuck === (b.dataset.tuck === '1')));
  P.querySelectorAll('[data-out]').forEach(el => { const f = OUT[el.dataset.out]; try { el.textContent = f ? f() : ''; } catch (e) { el.textContent = ''; } });
  const g = state[state.target];
  P.querySelectorAll('[data-target]').forEach(b => b.setAttribute('aria-pressed', b.dataset.target === state.target));
  P.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', b.dataset.mode === dmgMode));
  P.querySelectorAll('[data-fitp]').forEach(b => {
    const [slot, i] = b.dataset.fitp.split(':'), g2 = state[slot === 'top' ? 'top' : 'bottom'], p = FIT_PRESETS[slot][+i][1];
    b.setAttribute('aria-pressed', !!g2 && Object.entries(p).every(([k, v]) => Math.abs(g2[k] - v) < 1e-6));
  });
  if (g) {
    P.querySelectorAll('[data-hex]').forEach(el => { if (document.activeElement !== el) { el.value = g.fill[el.dataset.hex]; el.classList.remove('bad'); } });
    P.querySelectorAll('[data-sv]').forEach(el => {
      const c = el.dataset.sv, { h, s, v } = getHSV(c), hex = g.fill[c];
      el.style.background = `linear-gradient(to top,#000,rgba(0,0,0,0)),linear-gradient(to right,#fff,rgba(255,255,255,0)),hsl(${Math.round(h)},100%,50%)`;
      const dot = el.firstElementChild;
      dot.style.left = (s * 100) + '%'; dot.style.top = ((1 - v) * 100) + '%'; dot.style.background = hex;
      el.setAttribute('aria-valuetext', `밝기 ${Math.round(v * 100)}%, 선명도 ${Math.round(s * 100)}%`);
    });
    P.querySelectorAll('[data-hue]').forEach(el => { if (document.activeElement !== el) el.value = Math.round(getHSV(el.dataset.hue).h); });
    P.querySelectorAll('[data-prev]').forEach(el => { el.style.background = g.fill[el.dataset.prev]; });
    P.querySelectorAll('[data-pat]').forEach(b => b.setAttribute('aria-pressed', b.dataset.pat === g.fill.type));
    P.querySelectorAll('[data-c1]').forEach(b => b.setAttribute('aria-pressed', b.dataset.c1 === g.fill.c1));
    P.querySelectorAll('[data-c2]').forEach(b => b.setAttribute('aria-pressed', b.dataset.c2 === g.fill.c2));
  }
  if (state.top) P.querySelectorAll('[data-preset]').forEach(b => { const p = PRESETS[b.dataset.preset]; b.setAttribute('aria-pressed', state.top.neckD === p[1] && state.top.neckW === p[2] && state.top.neckV === p[3]); });
}
const P = $('#panel');
P.addEventListener('pointerdown', e => {
  const sv = e.target.closest('[data-sv]');
  if (sv) {
    // drag the dot: left→right = more vivid, top→bottom = darker
    const c = sv.dataset.sv;
    const pick = ev => {
      const r = sv.getBoundingClientRect();
      setHSV(c, { h: getHSV(c).h, s: clamp((ev.clientX - r.left) / r.width, 0, 1), v: clamp(1 - (ev.clientY - r.top) / r.height, 0, 1) });
    };
    sv.setPointerCapture(e.pointerId);
    pick(e);
    const up = () => { sv.removeEventListener('pointermove', pick); sv.removeEventListener('pointerup', up); sv.removeEventListener('pointercancel', up); commit(); };
    sv.addEventListener('pointermove', pick);
    sv.addEventListener('pointerup', up);
    sv.addEventListener('pointercancel', up);
    e.preventDefault();
    return;
  }
  if (e.target.matches('input[type=range]:not(.hue)')) { sliderAdjust = true; startAdjust(); renderOverlay(); }
});
P.addEventListener('keydown', e => {
  const sv = e.target.closest('[data-sv]');
  if (!sv) return;
  const step = { ArrowLeft: [-.02, 0], ArrowRight: [.02, 0], ArrowUp: [0, .02], ArrowDown: [0, -.02] }[e.key];
  if (!step) return;
  e.preventDefault();
  const c = sv.dataset.sv, cur = getHSV(c);
  setHSV(c, { h: cur.h, s: clamp(cur.s + step[0], 0, 1), v: clamp(cur.v + step[1], 0, 1) });
  commit();
});
document.addEventListener('pointerup', () => { if (sliderAdjust) { sliderAdjust = false; endAdjust(); } });
document.addEventListener('pointercancel', () => { if (sliderAdjust) { sliderAdjust = false; endAdjust(); } });
P.addEventListener('input', e => {
  const hue = e.target.closest('[data-hue]');
  if (hue) { const c = hue.dataset.hue; setHSV(c, { ...getHSV(c), h: +hue.value }); return; }
  const hx = e.target.closest('[data-hex]');
  if (hx) {
    const v = parseHex(hx.value), g = state[state.target];
    hx.classList.toggle('bad', !v && hx.value.trim() !== '');
    if (v && g) { g.fill[hx.dataset.hex] = v; render(); syncPanel(); }
    return;
  }
  const el = e.target.closest('[data-k]');
  if (!el) return;
  setK(el.dataset.k, el.type === 'color' ? el.value : +el.value);
  render(); syncPanel();
});
P.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('[data-hex]')) e.target.blur(); });
P.addEventListener('change', e => {
  if (e.target.matches('[data-hue]')) { commit(); return; }
  if (e.target.matches('[data-hex]')) {
    if (parseHex(e.target.value)) commit();
    else say('색상 코드는 #ffffff처럼 6자리로 써 주세요');
    syncPanel();
    return;
  }
  if (e.target.closest('[data-k]')) {
    if (e.target.dataset.k === 'top.sleeve' && state.top.sleeve <= SLEEVELESS) state.top.sleeve = 190;
    commit();
  }
  if (e.target.id === 'print-file' && e.target.files[0]) loadPrint(e.target.files[0]);
});
P.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b || b.disabled) return;
  const g = state[state.target], d = b.dataset;
  if (d.tuck) { state.top.tuck = d.tuck === '1'; say(state.top.tuck ? '상의를 하의 안에 넣었어요' : '상의를 밖으로 뺐어요'); }
  else if (d.preset) { const p = PRESETS[d.preset]; Object.assign(state.top, { neckD: p[1], neckW: p[2], neckV: p[3] }); }
  else if (d.fitp) { const [slot, i] = d.fitp.split(':'); Object.assign(state[slot === 'top' ? 'top' : 'bottom'], FIT_PRESETS[slot][+i][1]); }
  else if (d.target) { state.target = d.target; renderPanel(); renderOverlay(); return; }
  else if (d.mode) { dmgMode = d.mode; syncPanel(); return; }
  else if (d.c1) g.fill.c1 = d.c1;
  else if (d.c2) g.fill.c2 = d.c2;
  else if (d.pat) { g.fill.type = d.pat; render(); renderPanel(); commit(); return; }
  else if (d.act === 'clear-dmg') { [state.top, state.bottom].forEach(x => x && (x.dmg = [])); say('데미지를 지웠어요'); }
  else if (d.act === 'del-print') { g.print = null; render(); renderPanel(); commit(); return; }
  else return;
  render(); syncPanel(); commit();
});

function loadPrint(file) {
  const fr = new FileReader();
  fr.onload = () => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 600 / Math.max(img.width, img.height));
      const cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.round(img.width * k)); cv.height = Math.max(1, Math.round(img.height * k));
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      const id = 'img' + Date.now().toString(36);
      images[id] = cv.toDataURL('image/png');
      const g = state[state.target];
      const pos = state.target === 'top' ? [CX, 226] : g.kind === 'jeans' ? [171, 460] : [CX, Math.min(390, (g.len + 284) / 2)];
      g.print = { img: id, cx: pos[0], cy: pos[1], w: 70, ar: cv.height / cv.width };
      render(); renderPanel(); commit(); say('프린트를 붙였어요');
    };
    img.onerror = () => say('이미지를 열 수 없어요');
    img.src = fr.result;
  };
  fr.readAsDataURL(file);
}

/* ---------- header actions ---------- */
$('#undo').addEventListener('click', undo);
$('#redo').addEventListener('click', redo);
$('#reset').addEventListener('click', () => {
  state.top = clone(DEF.tee); state.bottom = clone(DEF.jeans); state.target = 'top';
  renderAll(); commit(); say('처음 상태로 돌렸어요 (되돌리기 가능)');
});
$('#save').addEventListener('click', savePNG);
function savePNG() {
  const c = svg.cloneNode(true);
  c.querySelector('#L-ov').remove();
  c.removeAttribute('style');
  c.setAttribute('viewBox', '0 10 400 760'); c.setAttribute('width', 800); c.setAttribute('height', 1520);
  c.querySelectorAll('image[data-img]').forEach(im => im.setAttribute('href', images[im.dataset.img]));
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(c)], { type: 'image/svg+xml' }));
  const img = new Image();
  img.onload = () => {
    const cv = document.createElement('canvas'); cv.width = 800; cv.height = 1520;
    cv.getContext('2d').drawImage(img, 0, 0, 800, 1520);
    URL.revokeObjectURL(url);
    cv.toBlob(b => {
      if (!b) return say('저장에 실패했어요');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b); a.download = '고쳐입기.png'; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      say('PNG로 저장했어요');
    }, 'image/png');
  };
  img.onerror = () => say('저장에 실패했어요');
  img.src = url;
}

document.addEventListener('keydown', e => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) && e.target.type !== 'range';
  if ((e.ctrlKey || e.metaKey) && !typing) {
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); redo(); }
    return;
  }
  if (typing || e.altKey) return;
  if (/^[1-5]$/.test(e.key)) setTool(TOOLS[+e.key - 1][0]);
  else if (e.key === 'h' || e.key === 'H') toggleGuides();
});

$('#theme').addEventListener('click', () => {
  const t = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('clothes-custom:theme', t); } catch (e) { /* ignore */ }
});

function renderAll() { renderCards(); render(); renderPanel(); }
drawBackdrop(); drawMannequin(); renderStudio();
setTool('neck');
renderAll();
commit();
})();
