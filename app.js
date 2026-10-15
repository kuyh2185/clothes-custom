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
const pt = p => r1(p[0]) + ' ' + r1(p[1]);
const mir = p => [400 - p[0], p[1]];
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
const TORSO = [[146, 64], [198, 54], [240, 50], [290, 44], [330, 49], [372, 58], [420, 60], [520, 60]];
const bodyHalf = y => table(TORSO, y);
const ARM_O = [[146, 140], [186, 127], [256, 117], [300, 112], [360, 108], [420, 105]];
const ARM_I = [[206, 147], [256, 140], [300, 136], [360, 130], [420, 126]];
const armO = y => table(ARM_O, y), armI = y => table(ARM_I, y);
const neckY = x => 123 + Math.max(0, 188 - x) * 0.42;   // shoulder line height at x (left side)

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
  // tops: fit = body ease, sfit = sleeve ease, drop = shoulder drop, flare = hem flare (all in px)
  tee:   { kind: 'tee',   neckD: 12, neckW: 20, neckV: 0, len: 400, sleeve: 238, fit: 6, sfit: 2, drop: 3, flare: 0, fill: SOLID('#f3f1ec'), dmg: [], print: null, rawHem: false, rawSleeve: false },
  long:  { kind: 'long',  neckD: 10, neckW: 19, neckV: 0, len: 410, sleeve: 424, fit: 3, sfit: 1, drop: 2, flare: 0, fill: { type: 'stripe', c1: '#f3f1ec', c2: '#24324a', scale: 1 }, dmg: [], print: null, rawHem: false, rawSleeve: false },
  // jeans: thigh / knee / hem width, 0..1 each
  jeans: { kind: 'jeans', len: 732, thigh: .32, knee: .33, hemW: .36, fill: { type: 'solid', c1: '#4a6787', c2: '#f3f1ec', scale: 1 }, dmg: [], print: null, rawHem: false },
  // skirt: hip = ease over the hips, fit = hem flare, 0..1 each
  skirt: { kind: 'skirt', len: 476, hip: .06, fit: 0.3, fill: { type: 'solid', c1: '#c7b299', c2: '#3b3b3b', scale: 1 }, dmg: [], print: null, rawHem: false },
};
const SLOT = { tee: 'top', long: 'top', jeans: 'bottom', skirt: 'bottom' };
const NAME = { tee: '반팔 티', long: '긴팔 티', jeans: '청바지', skirt: '치마' };
const SLEEVELESS = 200;
const LIMIT = {
  'top.len': [225, 470], 'top.sleeve': [190, 424], 'top.fit': [-3, 40],
  'top.sfit': [-4, 30], 'top.drop': [0, 34], 'top.flare': [-12, 36],
  'top.neckD': [8, 150], 'top.neckW': [14, 58], 'top.neckV': [0, 1],
  'bottom.fit': [0, 1], 'bottom.hip': [0, 1], 'bottom.thigh': [0, 1], 'bottom.knee': [0, 1], 'bottom.hemW': [0, 1],
};
// half-widths of a jeans leg (px) from the 0..1 settings
const LEG = { thigh: t => 27 + 17 * t, knee: k => 18 + 22 * k, hem: h => 13 + 39 * h };
// older saves had a single `fit` per garment: spread it over the new per-part settings
function upgrade(g) {
  if (!g) return g;
  const f = g.fit ?? 0;
  if (SLOT[g.kind] === 'top' && g.sfit == null) Object.assign(g, { sfit: Math.round(f * .32), drop: Math.max(0, f * .55), flare: 0 });
  if (g.kind === 'jeans' && g.thigh == null) {
    const j = g.fit ?? .4;
    Object.assign(g, { thigh: (3 + 6 * j) / 17, knee: (2 + 13 * j) / 22, hemW: (2 + 30 * j) / 39 });
    delete g.fit;
  }
  if (g.kind === 'skirt' && g.hip == null) g.hip = f * .2;
  return g;
}
const bottomLenLimit = b => b.kind === 'jeans' ? [425, 735] : [372, 720];

const topLenName = y => y < 285 ? '크롭' : y < 345 ? '숏' : y < 425 ? '기본' : '롱';
const sleeveName = y => y <= SLEEVELESS ? '민소매' : y < 255 ? '반팔' : y < 330 ? '5부' : y < 395 ? '7부' : '긴팔';
const bottomLenName = (b, y) => b.kind === 'jeans'
  ? (y < 465 ? '숏팬츠' : y < 590 ? '버뮤다' : y < 680 ? '7부' : y < 722 ? '9부' : '기본')
  : (y < 405 ? '마이크로 미니' : y < 480 ? '미니' : y < 565 ? '무릎' : y < 660 ? '미디' : '맥시');
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

function topGeo(t) {
  const e = t.fit, hy = t.len, sy = t.sleeve, nl = sy <= SLEEVELESS;
  const ST = nl ? [152 - e * .3, neckY(152 - e * .3) + 1] : [139 - t.drop, 147 + t.drop * .55];
  const nw = Math.min(t.neckW, CX - ST[0] - 12);
  const NL = [CX - nw, neckY(CX - nw)];
  const C0 = [CX, Math.max(NL[1] + 6, 123 + t.neckD)];
  const dy = C0[1] - NL[1];
  const uA = [NL[0], NL[1] + dy * .8], uB = [CX - nw * .55, C0[1]];
  const vA = mix(NL, C0, 1 / 3), vB = mix(NL, C0, 2 / 3);
  const nA = mix(uA, vA, t.neckV), nB = mix(uB, vB, t.neckV);
  const apY = (nl ? 208 : 200) + e * .25;
  const half = y => {
    const b = bodyHalf(y), fl = t.flare * Math.pow(clamp((y - apY) / Math.max(1, hy - apY), 0, 1), 1.6);
    return Math.max(b + 1, Math.max(b, .25 * b + .75 * 54) + 2 + e + fl);
  };
  const AP = [nl ? Math.max(CX - half(apY), armI(apY) + 1) : CX - half(apY), apY];   // sleeveless armhole stops at the arm
  const side = [AP];
  for (let y = apY + 26; y < hy - 12; y += 26) side.push([CX - half(y), y]);
  const HL = [CX - half(hy), hy];
  side.push(HL);
  const armhole = nl ? { t: 'C', a: [ST[0] + 3, ST[1] + 30], b: [AP[0] - 8, AP[1] - 14], p: AP }
                     : { t: 'C', a: [ST[0] + 2, ST[1] + 24], b: [AP[0] - 2, AP[1] - 20], p: AP };
  // shoulder seam rides just above the mannequin's shoulder, even when dropped for oversized fits
  const sx = clamp(150, ST[0] + 6, NL[0] - 6);
  const shoulder = NL[0] - ST[0] > 14 ? crSegs([NL, [sx, neckY(sx) - 3], ST]) : [{ t: 'L', p: ST }];
  const body = symD(C0, [
    { t: 'C', a: nB, b: nA, p: NL },
    ...shoulder,
    armhole, ...crSegs(side),
    { t: 'C', a: [HL[0] + 30, hy + 2], b: [176, hy + 3], p: [CX, hy + 3] },
  ]);
  const G = { body, C0, NL, nw, ST, AP, HL, hy, half, nl, sy, apY };
  G.Um = cubicMid(NL, uA, uB, C0); G.Vm = cubicMid(NL, vA, vB, C0); G.mid = cubicMid(NL, nA, nB, C0);
  const NR = mir(NL);
  // shoulder yoke above the armpits: the bare arm is hidden under it
  G.yokeD = pathD(NL, [...shoulder, armhole, { t: 'L', p: mir(AP) }, ...reverseSegs(NL, [...shoulder, armhole]).map(mirSeg)]);
  G.backD = `M${pt(NL)}Q${pt([CX, NL[1] - 9])} ${pt(NR)}C${pt(mir(nA))} ${pt(mir(nB))} ${pt(C0)}C${pt(nB)} ${pt(nA)} ${pt(NL)}Z`;
  G.backBandD = `M${pt(NL)}Q${pt([CX, NL[1] - 9])} ${pt(NR)}`;
  G.bandD = `M${pt(NL)}C${pt(nA)} ${pt(nB)} ${pt(C0)}C${pt(mir(nB))} ${pt(mir(nA))} ${pt(NR)}`;
  if (!nl) {
    const se = Math.max(1, (t.kind === 'tee' ? 9 : 3) + t.sfit), si = se * .45;
    const outs = [ST];
    for (let y = ST[1] + 34; y < sy - 8; y += 34) outs.push([armO(y) - se, y]);
    const SO = [armO(sy) - se, sy], SI = [armI(sy) + si, sy];
    const AQ = [Math.max(AP[0], armI(apY) + si), apY];   // sleeve's underarm point always covers the arm
    const sArm = { t: 'C', a: [ST[0] + 2, ST[1] + 24], b: [AQ[0] - 2, AQ[1] - 20], p: AQ };
    outs.push(SO);
    const ins = [SI];
    for (let y = sy - 34; y > apY + 16; y -= 34) ins.push([armI(y) + si, y]);
    ins.push(AQ);
    const segs = [...crSegs(outs), { t: 'L', p: SI }, ...crSegs(ins), { t: 'C', a: sArm.b, b: sArm.a, p: ST }];
    G.sleeveL = pathD(ST, segs);
    G.sleeveR = pathD(mir(ST), segs.map(mirSeg));
    G.se = se; G.si = si; G.SO = SO; G.SI = SI;
  }
  return G;
}

function jeansGeo(b) {
  const hy = b.len, wy = 296;
  const wh = bodyHalf(wy) + 3;
  const hipH = y => bodyHalf(y) + 3 + b.thigh * 5;
  const cxT = [[414, 171], [440, 172], [560, 177], [735, 181]];
  const T = LEG.thigh(b.thigh);
  const lhT = [[414, T + 1], [450, T], [560, LEG.knee(b.knee)], [735, LEG.hem(b.hemW)]];
  // legs keep a small gap between them; wider legs grow outward instead of overlapping
  const inMax = y => table([[416, 199.3], [470, 198.5], [735, 195.5]], y);
  const lh = y => table(lhT, y);
  const cx = y => Math.min(table(cxT, y), inMax(y) - lh(y));
  const inX = y => cx(y) + lh(y);
  const WL = [CX - wh, wy];
  const outer = [WL, [CX - hipH(334), 334], [CX - hipH(372), 372]];
  for (let y = 440; y < hy - 14; y += 50) outer.push([cx(y) - lh(y), y]);
  const HO = [cx(hy) - lh(hy), hy], HI = [inX(hy), hy];
  outer.push(HO);
  const inner = [HI];
  for (let y = hy - 50; y > 446; y -= 50) inner.push([inX(y), y]);
  if (hy > 446) inner.push([inX(436), 436]);
  inner.push([CX, 416]);
  const d = symD([CX, wy], [{ t: 'L', p: WL }, ...crSegs(outer), { t: 'L', p: HI }, ...crSegs(inner)]);
  return { d, wy, wh, hipH, cx, lh, inX, hy, handle: [cx(hy - 12) - lh(hy - 12), hy - 12] };
}

function skirtGeo(b) {
  const fl = b.fit, hy = b.len, wy = 290, hipY = 362;
  const wh = bodyHalf(wy) + 2.5, hipH = bodyHalf(hipY) + 3 + fl * 3 + b.hip * 14;
  const hemH = hy <= hipY ? lerp(wh, hipH, (hy - wy) / (hipY - wy)) + fl * 6
                          : hipH - 3 + (hy - hipY) * (.04 + .6 * fl) + fl * 8;
  const pts = [[CX - wh, wy]];
  if (hy > 340) pts.push([CX - bodyHalf(330) - 3 - fl * 2 - b.hip * 8, 330]);
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
  return { d: symD([CX, wy], segs), wy, wh, hipY, hipH, hemH, hy, baseY, folds, handle: [HL[0] + 2, hy - 8] };
}

/* ---------- state ---------- */
let state = { top: clone(DEF.tee), bottom: clone(DEF.jeans), target: 'top' };
let tool = 'neck', dmgMode = 'paint';
let images = {};
const blobUrls = {};
try {
  const s = JSON.parse(localStorage.getItem(STORE) || 'null');
  if (s) { state.top = upgrade(s.top ?? null); state.bottom = upgrade(s.bottom ?? null); images = s.images || {}; }
} catch (e) { /* storage unavailable: start fresh */ }
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
const OUTLINE = 'rgba(22,22,22,.34)';
const SKIN = '#d6cbbf', SKIN_EDGE = '#a89a8b', HOLE = '#cbbfb2';

$('#static-defs').innerHTML = `
  <linearGradient id="skin" x1="0" x2="1"><stop offset="0" stop-color="#c8bcae"/><stop offset=".35" stop-color="${SKIN}"/><stop offset=".65" stop-color="${SKIN}"/><stop offset="1" stop-color="#c8bcae"/></linearGradient>
  <linearGradient id="shade" x1="0" x2="1"><stop offset="0" stop-color="#000" stop-opacity=".17"/><stop offset=".2" stop-color="#000" stop-opacity="0"/><stop offset=".8" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".17"/></linearGradient>
  <radialGradient id="fade"><stop offset="0" stop-color="#fff" stop-opacity=".26"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
  <pattern id="twill" patternUnits="userSpaceOnUse" width="4" height="4" patternTransform="rotate(-35)"><rect width="4" height="1.3" fill="#fff" opacity=".08"/></pattern>
  <filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="4"/></filter>`;

// mannequin (static)
(function drawMannequin() {
  const torso = symD([CX, 96], [
    { t: 'L', p: [189, 96] }, { t: 'L', p: [188, 123] },
    { t: 'C', a: [176, 130], b: [150, 136], p: [140, 146] },
    { t: 'C', a: [132, 154], b: [140, 180], p: [146, 198] },
    ...crSegs([[146, 198], [150, 240], [156, 290], [151, 330], [142, 372], [141, 400]]),
    ...crSegs([[141, 400], [146, 440], [154, 500], [160, 560], [166, 640], [173, 726]]),
    { t: 'C', a: [173, 736], b: [166, 744], p: [168, 750] }, { t: 'L', p: [192, 750] },
    { t: 'C', a: [193, 742], b: [191, 734], p: [191, 726] },
    ...crSegs([[191, 726], [194, 640], [195, 560], [196, 500], [198, 440], [200, 414]]),
  ]);
  const head = `<ellipse cx="200" cy="62" rx="29" ry="35"/>`;
  L('man').innerHTML =
    `<g stroke="${SKIN_EDGE}" stroke-width="2.6" fill="${SKIN}"><path d="${torso}"/>${head}</g>` +
    `<g fill="url(#skin)"><path d="${torso}"/></g><g fill="${SKIN}">${head}</g>`;
  const armSegs = [
    ...crSegs([[140, 146], [127, 186], [117, 256], [112, 300], [108, 360], [105, 420]]),
    { t: 'C', a: [103, 436], b: [102, 458], p: [110, 468] },
    { t: 'C', a: [116, 474], b: [125, 468], p: [126, 452] }, { t: 'L', p: [126, 420] },
    ...crSegs([[126, 420], [130, 360], [136, 300], [140, 256], [147, 206]]),
  ];
  const fill = pathD([140, 146], [...armSegs, { t: 'C', a: [150, 184], b: [148, 152], p: [140, 146] }]);
  const edge = pathD([140, 146], armSegs, false);
  const arm = (d, e) => `<path d="${d}" fill="${SKIN}"/><path d="${e}" fill="none" stroke="${SKIN_EDGE}" stroke-width="1.3"/>`;
  L('arms').innerHTML = arm(fill, edge) + `<g transform="matrix(-1 0 0 1 400 0)">${arm(fill, edge)}</g>`;
})();

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
    const r = rng(Math.round(d.x * 131 + d.y * 7)), x = r1(d.x), y = r1(d.y);
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
      s += `<ellipse cx="${x}" cy="${y}" rx="12" ry="6.5" fill="${HOLE}"/>` +
           `<ellipse cx="${x}" cy="${y}" rx="12.5" ry="7" fill="none" stroke="#f3f1ea" stroke-width="1.6" stroke-dasharray="1.2 1.4"/>` +
           `<path d="${th}" stroke="#f3f1ea" stroke-width="1.2" fill="none" stroke-linecap="round"/>`;
    }
    return s;
  }).join('');
}

function frayD(x0, x1, y, seed) {
  const r = rng(seed); let d = '';
  for (let x = x0 + 1; x < x1 - 1; x += 2.4) d += `M${r1(x)} ${r1(y - 1)}l${r1((r() - .5) * 2)} ${r1(2.5 + r() * 3.5)}`;
  return d;
}

function printSVG(p) {
  if (!p || !images[p.img]) return '';
  const w = p.w, h = p.w * p.ar;
  return `<image data-img="${p.img}" href="${imgURL(p.img)}" x="${r1(p.cx - w / 2)}" y="${r1(p.cy - h / 2)}" width="${r1(w)}" height="${r1(h)}" preserveAspectRatio="none"/>`;
}

function piece(id, d, fill, pre, post, outer) {
  return `<clipPath id="clip-${id}"><path d="${d}"/></clipPath>` +
    `<g clip-path="url(#clip-${id})"><path d="${d}" fill="${fill}"/>${pre}<path d="${d}" fill="url(#shade)"/>${post}</g>` +
    `<path id="hit-${id}" d="${d}" fill="none" stroke="${OUTLINE}" stroke-width="1.1" stroke-linejoin="round"/>${outer || ''}`;
}

let geo = { top: null, bottom: null };

function renderTop() {
  const t = state.top;
  if (!t) { L('back').innerHTML = L('topbody').innerHTML = L('sleeves').innerHTML = ''; geo.top = null; return; }
  const G = geo.top = topGeo(t), c = t.fill.c1, fill = fillOf(t.fill, 'top');
  const stitch = `stroke="${shade(c, -.38)}" stroke-opacity=".5" stroke-width=".9" stroke-dasharray="3 2.5" fill="none"`;
  const dm = dmgSVG(t.dmg);
  L('back').innerHTML = `<path d="${G.backD}" fill="${shade(c, -.32)}"/><path d="${G.backBandD}" fill="none" stroke="${shade(c, -.2)}" stroke-width="4"/>`;
  let pre = '', outer = `<path d="${G.bandD}" fill="none" stroke="${shade(c, -.1)}" stroke-width="5" stroke-linecap="round"/><path d="${G.bandD}" fill="none" stroke="${shade(c, -.3)}" stroke-opacity=".35" stroke-width=".8" transform="translate(0 2.6)"/>`;
  const hx = G.HL[0], hy = G.hy;
  if (!t.rawHem) pre += `<path d="M${pt([hx + 1, hy - 6])}Q${pt([CX, hy])} ${pt([400 - hx - 1, hy - 6])}" ${stitch}/>`;
  else outer += `<path d="${frayD(hx, 400 - hx, hy + 1, hy)}" stroke="${shade(c, -.15)}" stroke-width=".9" fill="none"/>`;
  L('topbody').innerHTML = piece('body', G.body, fill, pre, dm + printSVG(t.print), outer);
  if (G.nl) { L('sleeves').innerHTML = ''; return; }
  let sl = '';
  ['L', 'R'].forEach((side, i) => {
    const m = i ? mir : (p => p);
    let spre = '', sout = '';
    if (t.rawSleeve) {
      const a = m(G.SO), b = m(G.SI);
      sout = `<path d="${frayD(Math.min(a[0], b[0]), Math.max(a[0], b[0]), G.sy + 1, G.sy + i)}" stroke="${shade(c, -.15)}" stroke-width=".9" fill="none"/>`;
    } else {
      const y = G.sy - (t.kind === 'long' && G.sy > 380 ? 15 : 7);
      const a = m([armO(y) - G.se + 1, y]), b = m([armI(y) + G.si - 1, y]);
      spre = t.kind === 'long' && G.sy > 380
        ? `<path d="M${pt(a)}L${pt(b)}" stroke="${shade(c, -.25)}" stroke-opacity=".6" stroke-width="1"/>`
        : `<path d="M${pt(a)}L${pt(b)}" ${stitch}/>`;
    }
    sl += piece('s' + side.toLowerCase(), i ? G.sleeveR : G.sleeveL, fill, spre, dm, sout);
  });
  L('sleeves').innerHTML = sl;
}

function renderBottom() {
  const b = state.bottom;
  if (!b) { L('bottom').innerHTML = ''; geo.bottom = null; return; }
  const c = b.fill.c1, fill = fillOf(b.fill, 'bottom');
  const post = dmgSVG(b.dmg) + printSVG(b.print);
  let pre = '', outer = '';
  if (b.kind === 'jeans') {
    const G = geo.bottom = jeansGeo(b), { wy, wh, hipH, cx, lh, inX, hy } = G;
    const amber = `stroke="#c8913a" stroke-width=".9" stroke-dasharray="2.6 1.8" fill="none"`;
    const wh2 = bodyHalf(wy + 13) + 3;
    pre += `<rect x="0" y="0" width="400" height="780" fill="url(#twill)"/>`;
    [[cx(470), 470, lh(470) * .75, 46], [cx(565), 565, lh(565) * .8, 40]].forEach(([x, y, rx, ry]) => {
      pre += `<ellipse cx="${r1(x)}" cy="${y}" rx="${r1(rx)}" ry="${ry}" fill="url(#fade)"/><ellipse cx="${r1(400 - x)}" cy="${y}" rx="${r1(rx)}" ry="${ry}" fill="url(#fade)"/>`;
    });
    pre += `<path d="M180 428q-10 -4 -20 -12M184 438q-12 -3 -24 -11M220 428q10 -4 20 -12M216 438q12 -3 24 -11" stroke="#fff" stroke-opacity=".22" stroke-width="2" fill="none" stroke-linecap="round" filter="url(#soft)"/>`;
    pre += `<path d="M${pt([CX - wh, wy])}L${pt([CX + wh, wy])}L${pt([CX + wh2, wy + 13])}L${pt([CX - wh2, wy + 13])}Z" fill="${shade(c, -.1)}"/>`;
    pre += `<path d="M${pt([CX - wh, wy + 3])}L${pt([CX + wh, wy + 3])}M${pt([CX - wh2, wy + 10])}L${pt([CX + wh2, wy + 10])}" ${amber}/>`;
    [-wh + 7, -31, 31, wh - 7].forEach(dx => { pre += `<rect x="${r1(CX + dx - 2)}" y="${wy - 1}" width="4" height="17" fill="${shade(c, -.2)}"/>`; });
    pre += `<circle cx="200" cy="${wy + 6.5}" r="3.6" fill="#b08d57" stroke="#6f5530" stroke-width=".8"/>`;
    pre += `<path d="M200 ${wy + 13}L200 412" stroke="#000" stroke-opacity=".3" stroke-width="1.1"/><path d="M209 ${wy + 14}L209 366Q209 378 200 384" ${amber}/>`;
    pre += `<path d="M166 ${wy + 13}Q164 ${wy + 44} ${r1(CX - hipH(wy + 50) + 1)} ${wy + 50}M234 ${wy + 13}Q236 ${wy + 44} ${r1(CX + hipH(wy + 50) - 1)} ${wy + 50}" ${amber}/>`;
    pre += `<path d="M226 ${wy + 16}L228 ${wy + 32}L241 ${wy + 30}L240 ${wy + 15}" ${amber}/>`;
    const hemLegs = [[cx(hy) - lh(hy), inX(hy)], [400 - inX(hy), 400 - cx(hy) + lh(hy)]];
    hemLegs.forEach(([a, z], i) => {
      if (b.rawHem) outer += `<path d="${frayD(a, z, hy + 1, hy + i)}" stroke="${shade(c, .65)}" stroke-width="1" fill="none"/>`;
      else pre += `<path d="M${r1(a + 1)} ${hy - 7}L${r1(z - 1)} ${hy - 7}" ${amber}/>`;
    });
    L('bottom').innerHTML = piece('bottom', G.d, fill, pre, post, outer);
  } else {
    const G = geo.bottom = skirtGeo(b), { wy, wh, hipY, hipH, hemH, hy, baseY } = G;
    const wh2 = bodyHalf(wy + 12) + 2.5;
    pre += `<path d="M${pt([CX - wh, wy])}L${pt([CX + wh, wy])}L${pt([CX + wh2, wy + 12])}L${pt([CX - wh2, wy + 12])}Z" fill="${shade(c, -.1)}"/>`;
    pre += `<path d="M${pt([CX - wh2, wy + 12])}L${pt([CX + wh2, wy + 12])}" stroke="#000" stroke-opacity=".18" stroke-width=".8"/>`;
    G.folds.forEach(x => {
      const tx = CX - (CX - x) * (hipH / hemH) * .95;
      [[tx, x], [400 - tx, 400 - x]].forEach(([a, z]) => {
        pre += `<path d="M${r1(a)} ${hipY + 6}L${r1(z)} ${r1(baseY(z) - 1)}" stroke="#000" stroke-opacity=".1" stroke-width="3.2" stroke-linecap="round" filter="url(#soft)"/>`;
      });
    });
    if (b.rawHem) outer += `<path d="${frayD(CX - hemH, CX + hemH, hy + 2, hy)}" stroke="${shade(c, -.15)}" stroke-width=".9" fill="none"/>`;
    L('bottom').innerHTML = piece('bottom', G.d, fill, pre, post, outer);
  }
}

function render() {
  $('#defs').innerHTML = (state.top ? patDef('top', state.top.fill) : '') + (state.bottom ? patDef('bottom', state.bottom.fill) : '');
  renderBottom();
  renderTop();
  if (geo.top) {
    $('#defs').insertAdjacentHTML('beforeend', `<clipPath id="arm-clip"><path clip-rule="evenodd" d="M0 0H400V800H0Z${geo.top.yokeD}"/></clipPath>`);
    L('arms').setAttribute('clip-path', 'url(#arm-clip)');
  } else L('arms').removeAttribute('clip-path');
  renderOverlay();
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
const adj = (p, key, scale, side) =>
  `<g data-h="adj" data-key="${key}" data-scale="${r1(scale)}" data-side="${side}"><circle cx="${r1(p[0])}" cy="${r1(p[1])}" r="14" fill="transparent"/><circle cx="${r1(p[0])}" cy="${r1(p[1])}" r="7" fill="#fff" stroke="#161616" stroke-width="2"/></g>`;
const handle = (p, h, side, shape) => shape === 'diamond'
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
    s += tag(CX, G.C0[1] + 26, neckName(T));
  }
  if (tool === 'fit') {
    // one pair of handles per body part; shoulder/sleeve labels sit on the left, body/hem/leg labels on the right
    const labels = [];
    const pair = (p, key, scale, text, labelSide) => {
      s += adj(p, key, scale, -1) + adj(mir(p), key, scale, 1);
      const q = labelSide > 0 ? mir(p) : p;
      labels.push(tag(q[0] + 13 * labelSide, q[1] + 4, text, labelSide > 0 ? 'start' : 'end'));
    };
    if (T && geo.top) {
      const G = geo.top;
      if (!G.nl) {
        pair(G.ST, 'top.drop', 1, '어깨 · ' + dropName(T.drop), -1);
        const y = (G.ST[1] + G.sy) / 2;
        pair([armO(y) - G.se, y], 'top.sfit', 1, '소매 · ' + sleeveFitName(T.sfit), -1);
      }
      const yb = (G.apY + G.hy) / 2, yh = G.hy - 6;
      pair([CX - G.half(yb), yb], 'top.fit', 1, '몸통 · ' + topFitName(T.fit), 1);
      pair([CX - G.half(yh), yh], 'top.flare', 1, '밑단 · ' + flareName(T.flare), 1);
    }
    if (B && geo.bottom) {
      const G = geo.bottom;
      if (B.kind === 'jeans') {
        const at = y => [G.cx(y) - G.lh(y), y], yh = G.hy - 12;
        if (G.hy > 490) pair(at(452), 'bottom.thigh', 17, '허벅지', 1);
        if (G.hy > 610) {
          pair(at(560), 'bottom.knee', 22, '무릎', 1);
          pair(at(yh), 'bottom.hemW', Math.max(8, 39 * (yh - 560) / 175), '밑단 · ' + bottomFitName(B), 1);
        } else if (G.hy > 490) pair(at(yh), 'bottom.knee', Math.max(6, 22 * (yh - 450) / 110), '밑단 · ' + bottomFitName(B), 1);
        else pair(at(yh), 'bottom.thigh', 17, '밑단 · ' + bottomFitName(B), 1);
      } else {
        if (G.hy > G.hipY + 20) pair([CX - G.hipH, G.hipY], 'bottom.hip', 14, '엉덩이', 1);
        pair(G.handle, 'bottom.fit', Math.max(10, (G.hy - G.hipY) * .6 + 8), '밑단 · ' + bottomFitName(B), 1);
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
      const p = g.print, w = p.w, h = p.w * p.ar;
      s += `<rect x="${r1(p.cx - w / 2)}" y="${r1(p.cy - h / 2)}" width="${r1(w)}" height="${r1(h)}" fill="none" stroke="#161616" stroke-width="1.2" stroke-dasharray="4 3"/>`;
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
function pieceAt(p) { return ['sl', 'sr', 'body', 'bottom'].find(id => inside(id, p[0], p[1])) || null; }
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

function cutAt(p) {
  const id = pieceAt(p);
  if (!id) return null;
  const y = p[1];
  if (id === 'sl' || id === 'sr') {
    const T = state.top, ny = y <= 206 ? 190 : y;
    if (ny >= T.sleeve - 4) return null;
    const ex = extent(id, Math.max(y, 150));
    return ex && { key: 'sleeve', val: ny, x0: ex[0], x1: ex[1], y, label: sleeveName(ny) };
  }
  if (id === 'body') {
    const T = state.top, ny = clamp(y, LIMIT['top.len'][0], T.len);
    if (ny >= T.len - 4) return null;
    const ex = extent('body', ny);
    return ex && { key: 'topLen', val: ny, x0: ex[0], x1: ex[1], y: ny, label: topLenName(ny) };
  }
  const B = state.bottom, ny = clamp(y, bottomLenLimit(B)[0], B.len);
  if (ny >= B.len - 4) return null;
  const ex = extent('bottom', ny);
  return ex && { key: 'bottomLen', val: ny, x0: ex[0], x1: ex[1], y: ny, label: bottomLenName(B, ny) };
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
    case 'neckD': T.neckD = clamp(p[1] - 123, ...LIMIT['top.neckD']); break;
    case 'neckW': T.neckW = clamp(d.side < 0 ? CX - p[0] : p[0] - CX, ...LIMIT['top.neckW']); break;
    case 'neckV': {
      // how far the handle sits from the straight NL→C0 line: on the line = V, at the round bulge = U
      const G = geo.top, q = d.side > 0 ? mir(p) : p, A = G.NL, B = G.C0;
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
  const list = state[g].dmg;
  const near = list.reduce((best, d, i) => { const dist = Math.hypot(d.x - p[0], d.y - p[1]); return dist < (best ? best.dist : 16) ? { i, dist } : best; }, null);
  if (dmgMode === 'erase') { if (near) list.splice(near.i, 1); }
  else if (near) { if (first) list[near.i].lv = Math.min(3, list[near.i].lv + 1); }
  else list.push({ x: r1(p[0]), y: r1(p[1]), lv: 1 });
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
function iconSVG(kind) {
  const g = DEF[kind], c = g.fill.c1 === '#f3f1ec' ? '#fbfaf7' : g.fill.c1, st = 'stroke="#161616" stroke-opacity=".55" stroke-width="2" stroke-linejoin="round"';
  if (SLOT[kind] === 'top') {
    const G = topGeo(g), f = kind === 'long' ? '#fbfaf7' : c;
    const stripes = kind === 'long' ? `<clipPath id="ic-${kind}"><path d="${G.body}"/><path d="${G.sleeveL}"/><path d="${G.sleeveR}"/></clipPath><g clip-path="url(#ic-${kind})">${Array.from({ length: 16 }, (_, i) => `<rect x="80" y="${120 + i * 20}" width="240" height="8" fill="#24324a"/>`).join('')}</g>` : '';
    return `<svg viewBox="92 108 216 ${kind === 'long' ? 330 : 312}" aria-hidden="true"><path d="${G.body}" fill="${f}" ${st}/><path d="${G.sleeveL}" fill="${f}" ${st}/><path d="${G.sleeveR}" fill="${f}" ${st}/>${stripes}<path d="${G.sleeveL}" fill="none" ${st}/><path d="${G.sleeveR}" fill="none" ${st}/></svg>`;
  }
  const d = kind === 'jeans' ? jeansGeo(g).d : skirtGeo(g).d;
  return `<svg viewBox="${kind === 'jeans' ? '118 284 164 462' : '108 280 184 220'}" aria-hidden="true"><path d="${d}" fill="${c}" ${st}/></svg>`;
}
function renderCards() {
  [['top', ['tee', 'long']], ['bottom', ['jeans', 'skirt']]].forEach(([slot, kinds]) => {
    $('#cards-' + slot).innerHTML = kinds.map(k => `<button type="button" class="card" data-kind="${k}" aria-pressed="${state[slot]?.kind === k}">${iconSVG(k)}<span>${NAME[k]}</span></button>`).join('');
  });
}
document.querySelector('.wardrobe').addEventListener('click', e => {
  const b = e.target.closest('[data-kind]');
  if (!b) return;
  const k = b.dataset.kind, slot = SLOT[k];
  if (state[slot]?.kind === k) { state[slot] = null; say(NAME[k] + '을(를) 벗었어요'); }
  else { state[slot] = clone(DEF[k]); state.target = slot; say(NAME[k] + ' 입었어요'); }
  if (!state[state.target]) state.target = state.top ? 'top' : 'bottom';
  renderAll(); commit();
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
$('#toolbar').innerHTML = TOOLS.map(([id, name], i) =>
  `<button type="button" class="tool" data-tool="${id}" aria-pressed="false" title="${name} (${i + 1})"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[id]}</svg>${name}</button>`).join('');
$('#toolbar').addEventListener('click', e => { const b = e.target.closest('[data-tool]'); if (b) setTool(b.dataset.tool); });
function setTool(id) {
  tool = id; hover = null; svg.dataset.tool = id; svg.style.cursor = '';
  document.querySelectorAll('.tool').forEach(b => b.setAttribute('aria-pressed', b.dataset.tool === id));
  renderPanel(); renderOverlay();
}

const COLORS = [['흰색', '#f3f1ec'], ['아이보리', '#e9e1cf'], ['베이지', '#c7b299'], ['카키', '#8b8256'], ['올리브', '#556045'], ['그린', '#2f5d46'], ['하늘', '#a9c8e0'], ['연청', '#8aa4bf'], ['중청', '#4a6787'],
  ['네이비', '#24324a'], ['그레이', '#9a9a96'], ['차콜', '#3b3b3b'], ['블랙', '#1c1c1c'], ['브라운', '#6b4a33'], ['버건디', '#6e2533'], ['레드', '#b8382e'], ['핑크', '#e8b4b8'], ['버터', '#efd98a']];
const PATS = [['solid', '단색'], ['stripe', '스트라이프'], ['check', '체크'], ['dot', '도트']];
const FIT_PRESETS = {
  top: [['슬림', { fit: -1, sfit: -2, drop: 0, flare: -4 }], ['레귤러', { fit: 6, sfit: 2, drop: 3, flare: 0 }],
        ['오버핏', { fit: 26, sfit: 16, drop: 20, flare: 2 }], ['박시', { fit: 30, sfit: 10, drop: 14, flare: -6 }]],
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
  'top.sfit': () => sleeveFitName(state.top.sfit), 'top.drop': () => dropName(state.top.drop), 'top.flare': () => flareName(state.top.flare),
  'bottom.thigh': () => wideName(state.bottom.thigh), 'bottom.knee': () => wideName(state.bottom.knee),
  'bottom.hemW': () => bottomFitName(state.bottom), 'bottom.hip': () => wideName(state.bottom.hip),
  'cur.fill.scale': () => '×' + (getK('cur.fill.scale') || 1).toFixed(1),
  'cur.print.w': () => Math.round(getK('cur.print.w') || 0) + '',
};
const slider = (k, label, min, max, step) =>
  `<label class="row"><span class="lab">${label}<b data-out="${k}"></b></span><input type="range" data-k="${k}" min="${min}" max="${max}" step="${step}"></label>`;
const wideName = v => v < .25 ? '좁게' : v < .6 ? '보통' : '넓게';
const hexRow = (c, label) =>
  `<div class="hexrow"><input type="color" data-k="cur.fill.${c}" aria-label="${label} 고르기"><input type="text" class="hex" data-hex="${c}" maxlength="7" spellcheck="false" autocomplete="off" placeholder="#ffffff" aria-label="${label} 코드"><span class="note" style="margin:0">색상 코드 입력</span></div>`;
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
          ${slider('top.fit', '몸통 품', ...LIMIT['top.fit'], .5)}
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
        ${hexRow('c1', '색')}
        <div class="swatches">${COLORS.map(([n, c]) => `<button type="button" class="sw" data-c1="${c}" style="background:${c}" aria-label="${n}" title="${n} ${c}"></button>`).join('')}</div>
        <span class="label-sm">무늬</span>
        <div class="chips">${PATS.map(([id, n]) => `<button type="button" class="chip" data-pat="${id}">${n}</button>`).join('')}</div>
        ${pat ? `<span class="label-sm">무늬 색</span>
          ${hexRow('c2', '무늬 색')}
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
  $('#panel').innerHTML = `<h3>${name}</h3>` + panelHTML();
  syncPanel();
}
function syncPanel() {
  const P = $('#panel');
  P.querySelectorAll('[data-k]').forEach(el => { const v = getK(el.dataset.k); if (v != null && document.activeElement !== el) el.value = v; });
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
    P.querySelectorAll('[data-pat]').forEach(b => b.setAttribute('aria-pressed', b.dataset.pat === g.fill.type));
    P.querySelectorAll('[data-c1]').forEach(b => b.setAttribute('aria-pressed', b.dataset.c1 === g.fill.c1));
    P.querySelectorAll('[data-c2]').forEach(b => b.setAttribute('aria-pressed', b.dataset.c2 === g.fill.c2));
  }
  if (state.top) P.querySelectorAll('[data-preset]').forEach(b => { const p = PRESETS[b.dataset.preset]; b.setAttribute('aria-pressed', state.top.neckD === p[1] && state.top.neckW === p[2] && state.top.neckV === p[3]); });
}
const P = $('#panel');
P.addEventListener('pointerdown', e => {
  if (e.target.matches('input[type=range]')) { sliderAdjust = true; startAdjust(); renderOverlay(); }
});
document.addEventListener('pointerup', () => { if (sliderAdjust) { sliderAdjust = false; endAdjust(); } });
document.addEventListener('pointercancel', () => { if (sliderAdjust) { sliderAdjust = false; endAdjust(); } });
P.addEventListener('input', e => {
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
  if (d.preset) { const p = PRESETS[d.preset]; Object.assign(state.top, { neckD: p[1], neckW: p[2], neckV: p[3] }); }
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
      const pos = state.target === 'top' ? [CX, 238] : g.kind === 'jeans' ? [170, 470] : [CX, Math.min(400, (g.len + 300) / 2)];
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
  c.setAttribute('width', 800); c.setAttribute('height', 1520);
  c.querySelectorAll('image[data-img]').forEach(im => im.setAttribute('href', images[im.dataset.img]));
  const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  Object.entries({ x: 0, y: 10, width: 400, height: 760, fill: getComputedStyle($('.stage-wrap')).backgroundColor }).forEach(([k, v]) => bg.setAttribute(k, v));
  c.insertBefore(bg, c.firstChild);
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
  if (!typing && !e.altKey && /^[1-5]$/.test(e.key)) setTool(TOOLS[+e.key - 1][0]);
});

function renderAll() { renderCards(); render(); renderPanel(); }
setTool('neck');
renderAll();
commit();
})();
