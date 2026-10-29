// What check / repro / fuzz share: serve a copy of the studio, open it in Chrome, load a saved state, play a list of
// edits the way a person makes them, let the cloth stop and measure it (metrics.js), then judge the numbers.
// Needs Playwright and Chrome: PLAYWRIGHT=<path to the playwright package> if it isn't installed beside the repo.
// A case: { name, state: <saved value, as in localStorage>, steps: [...], lim: {…limits for this case only} }, a step one of
//   { t: 'card', g: 'sleeve'|'len'|'fit'|'neck', i }   { t: 'bar', id: 'L'|'ease'|…, v (or f: 0…1 of its range) }
//   { t: 'set', o: {…top} }
//   { t: 'drag', dot: 0…11 (DOTS order), dx, dy (px) }   { t: 'body', v: 'f'|'m' }   { t: 'bottom', v: 'jeans'|'none' }
//   { t: 'undo' }   { t: 'redo' }   { t: 'view', a: 0|1|2|3 }   { t: 'wait', ms }   { t: 'settle' }
//   { t: 'edge', f: 0…1 (of the edge points in view), dx, dy } or { t: 'edge', pc, curve, at (0…1 along it), half?, dx, dy }:
//   the outline pulled by hand there   { t: 'toggle', id: 'sym'|'fb' }
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
const METRICS = fileURLToPath(new URL('metrics.js', import.meta.url));
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT || 'playwright');
const KEY = 'clothes-custom:studio:v1';

// what counts as broken (2026-10-27, measured against six old bugs and twelve good tops: ideastorage PLAN.md 0단계).
// s seconds to settle, pen points through the body, ear cm, side / sleeve cm rolled up, selfx self-crossings
export const LIMITS = { s: 15, pen: 0, ear: .8, side: 3.5, sleeve: 4, selfx: 200 };
export function judge(r, lim) {
  const m = r.m, bad = [], L = { ...LIMITS, ...lim };
  if (!m) return [r.err || '측정 못 함'];
  // (per amount of cloth, as selfx below: each step of a top twice the size takes twice as long)
  const big = Math.max(1, (m.nP || 0) / 6000), s = lim && lim.s != null ? lim.s : L.s * big;
  if (r.n0 && r.s0 > (lim && lim.s != null ? lim.s : L.s * Math.max(1, r.n0 / 6000))) bad.push(`처음 멈춤 ${r.s0 === Infinity ? '30초 넘게' : r.s0.toFixed(1) + 's'}`);
  if (r.s > s) bad.push(`멈춤 ${r.s === Infinity ? '30초 넘게' : r.s.toFixed(1) + 's'}`);
  if (m.pen > L.pen) bad.push(`뚫림 ${m.pen}점 (최대 ${m.deep}cm)`);
  if (m.ear > L.ear) bad.push(`귀 ${m.earAt} +${m.ear}cm`);
  for (const [k, v] of Object.entries(m.roll)) {
    if (k.startsWith('side') && v > L.side) bad.push(`말림 ${k === 'side0' ? '앞' : '뒤'} 밑단 옆 ${v}cm`);
    if ((k === 'l' || k === 'r') && v > L.sleeve) bad.push(`말림 ${k === 'l' ? '왼소매' : '오른소매'} ${v}cm`);
  }
  // (per amount of cloth: a top twice the size, a long balloon-sleeved one, settles with twice the small folds touching
  // through each other, unseen; a case's own limit is for that one top)
  const sx = lim && lim.selfx != null ? lim.selfx : L.selfx * big;
  if (m.selfx > sx) bad.push(`겹침 ${m.selfx} (한도 ${Math.round(sx)})`);
  if (m.dots) bad.push(`화면 밖 점 ${m.dots}`);
  if (m.lim.length) bad.push(`한계 밖 ${m.lim.join(', ')}`);
  if (m.body) bad.push(`몸 어긋남 ${m.body}`);
  if (r.errors.length) bad.push(`페이지 오류 ${r.errors.join(' / ')}`);
  return bad;
}
export const line = r => `멈춤 ${r.s === Infinity ? '∞' : r.s.toFixed(1)}s · 뚫림 ${r.m.pen}(${r.m.deep}) · 귀 ${r.m.ear}(${r.m.earAt}) ${JSON.stringify(r.m.earBy)} · 말림 ${JSON.stringify(r.m.roll)} · 겹침 ${r.m.selfx}`;

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.glb': 'model/gltf-binary', '.json': 'application/json', '.png': 'image/png' };
// root: the studio's folder (an old commit's worktree to see a bug before its fix); pages: how many to run side by side
export async function start({ root = ROOT, pages = 1 } = {}) {
  root = resolve(root) + (root.endsWith('/') || root.endsWith('\\') ? '' : '/');
  root = normalize(root);
  const server = createServer(async (req, res) => {
    const p = normalize(join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
    try {
      const f = p.endsWith('\\') || p.endsWith('/') ? join(p, 'index.html') : p;
      if (!f.startsWith(root)) throw 0;
      const body = await readFile(f);   // (read before the head goes out: a missing file still gets its 404)
      res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream' }).end(body);
    } catch { res.writeHead(404).end(); }
  }).listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const metrics = await readFile(METRICS, 'utf8');
  const br = await chromium.launch({ channel: 'chrome', args: ['--use-angle=d3d11', '--enable-gpu'] });
  const list = [];
  for (let i = 0; i < pages; i++) {
    const ctx = await br.newContext({ viewport: { width: 1440, height: 900 } });   // own storage each
    const page = await ctx.newPage();
    page.errors = [];
    page.on('pageerror', e => page.errors.push(e.message));
    list.push(page);
  }
  return { url, metrics, pages: list, close: async () => { await br.close(); server.close(); } };
}

const settle = async page => {   // seconds until the cloth stops (Infinity if it never does within 30 s)
  const t0 = Date.now();
  await page.waitForTimeout(500);
  // (and no mannequin still loading: between a body button and its cloth the old cloth may be at rest)
  const ok = await page.waitForFunction(() => window.__studio.cloth && !window.__studio.awake && document.getElementById('loading').hidden, null, { timeout: 30000, polling: 200 }).then(() => true, () => false);
  return ok ? (Date.now() - t0) / 1000 : Infinity;
};
const click = (page, sel) => page.evaluate(s => { const el = document.querySelector(s); if (el) el.click(); return !!el; }, sel);

async function step(page, st) {
  switch (st.t) {
    case 'card': return click(page, `#c-${st.g} button[data-i="${st.i}"]`);
    case 'bar': return page.evaluate(({ id, v, f }) => {
      const el = document.getElementById('b-' + id); if (!el) return;
      el.value = v ?? +el.min + f * (el.max - el.min); el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change'));
    }, st);
    case 'set': return page.evaluate(o => { Object.assign(window.__studio.state.top, o); window.__studio.apply(); }, st.o);
    case 'body': case 'bottom': return click(page, `#${st.t} [data-v="${st.v}"]`);
    case 'undo': case 'redo': return click(page, '#' + st.t);
    case 'view': return click(page, `.views [data-a]:nth-child(${st.a + 1})`);
    case 'wait': return page.waitForTimeout(st.ms);
    case 'settle': return settle(page);
    case 'toggle': return click(page, '#' + st.id);
    case 'drag': case 'edge': {
      const b = st.t === 'edge' ? await page.evaluate(s => s.curve ? window.__studio.edgePoint(s.pc, s.curve, s.at, s.half) : window.__studio.edgeAt(s.f), st)
        : await page.evaluate(i => {
          const d = document.querySelectorAll('#layer .dot:not(.edge)')[i];
          if (!d || d.hidden) return null;
          const r = d.getBoundingClientRect(); return [(r.left + r.right) / 2, (r.top + r.bottom) / 2];
        }, st.dot);
      if (!b) return;
      if (st.t === 'edge') { await page.mouse.move(b[0] + 3, b[1] + 3); await page.mouse.move(b[0], b[1]); await page.waitForTimeout(60); }
      await page.mouse.move(b[0], b[1]); await page.mouse.down();
      for (let k = 1; k <= 8; k++) { await page.mouse.move(b[0] + st.dx * k / 8, b[1] + st.dy * k / 8); await page.waitForTimeout(30); }
      return page.mouse.up();
    }
  }
}

// load the case's saved state, play its steps, let the cloth stop, measure → { s, m, errors }
export async function run(h, page, cas) {
  page.errors.length = 0;
  try {
    await page.goto(h.url);
    await page.evaluate(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [KEY, cas.state]);
    await page.goto(h.url);
    await page.waitForFunction(() => window.__studio && window.__studio.cloth && window.__studio.A, null, { timeout: 60000 });
    await page.addScriptTag({ content: h.metrics });
    const s0 = await settle(page);
    // (the top as loaded judged by its own amount of cloth: a big one may take longer than the one the edits leave)
    const n0 = s0 > LIMITS.s && cas.steps && cas.steps.length ? await page.evaluate(() => window.__metrics().nP) : 0;
    for (const st of cas.steps || []) await step(page, st);
    const s1 = await settle(page), s = n0 ? s1 : Math.max(s0, s1);
    await page.waitForFunction(() => window.__studio.A && window.__studio.cloth, null, { timeout: 30000 });
    const m = await page.evaluate(() => window.__metrics());
    return { s, s0, n0, m, errors: page.errors.slice() };
  } catch (e) {
    return { s: Infinity, m: null, err: e.message.split('\n')[0], errors: page.errors.slice() };
  }
}

// a random top and a random few edits, the same for the same seed (mulberry32)
export function gen(seed) {
  let a = seed >>> 0;
  const rnd = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const pick = l => l[Math.floor(rnd() * l.length)], U = (lo, hi) => Math.round((lo + rnd() * (hi - lo)) * 10) / 10;
  const ease = U(-8, 16), sl = rnd() < .5 ? pick([0, 7, 20, 33, 45, 53, 58, 70, -8, -15]) : U(-15, 72);
  const top = {
    sl: rnd() < .8 ? [sl, sl] : [sl, U(-15, 72)], L: U(20, 110), ease, sEase: rnd() < .6 ? ease : U(-8, 16), flare: rnd() < .5 ? 0 : U(-12, 15),
    dNw: rnd() < .6 ? 0 : U(-2, 6), ndF: U(4, 26), ndB: U(1.5, 12), neckV: pick([0, 0, 1, U(0, 1)]),
  };
  const state = { body: pick(['f', 'm']), bottom: rnd() < .85 ? 'jeans' : 'none', top };
  const CARDS = { sleeve: 9, len: 4, fit: 5, neck: 5 }, BARS = ['sl0', 'sl1', 'L', 'ease', 'sEase', 'flare', 'ndF', 'ndB', 'dNw', 'neckV'];
  const steps = [], n = 1 + Math.floor(rnd() * 5);
  for (let i = 0; i < n; i++) {
    const r = rnd();
    if (r < .25) { const g = pick(Object.keys(CARDS)); steps.push({ t: 'card', g, i: Math.floor(rnd() * CARDS[g]) }); }
    else if (r < .4) steps.push({ t: 'bar', id: pick(BARS), f: Math.round(rnd() * 100) / 100 });
    else if (r < .55) steps.push({ t: 'drag', dot: Math.floor(rnd() * 12), dx: Math.round(U(-90, 90)), dy: Math.round(U(-90, 90)) });
    else if (r < .77) {
      // the outline pulled anywhere in view (2단계), now and then one side alone or one panel's hem / neckline alone
      if (rnd() < .3) steps.push({ t: 'toggle', id: 'sym' });
      if (rnd() < .2) steps.push({ t: 'toggle', id: 'fb' });
      steps.push({ t: 'edge', f: Math.round(rnd() * 1000) / 1000, dx: Math.round(U(-90, 90)), dy: Math.round(U(-90, 90)) });
    }
    else if (r < .84) steps.push({ t: 'undo' });
    else if (r < .87) steps.push({ t: 'redo' });
    else if (r < .93) steps.push({ t: 'body', v: pick(['f', 'm']) });
    else if (r < .96) steps.push({ t: 'bottom', v: pick(['jeans', 'none']) });
    else steps.push({ t: 'view', a: Math.floor(rnd() * 4) });
    const w = rnd();   // a person's pause: none, a moment, or until the cloth stops
    if (w < .3) steps.push({ t: 'settle' }); else if (w < .7) steps.push({ t: 'wait', ms: Math.round(rnd() * 1200) });
  }
  return { name: `fuzz ${seed}`, seed, state, steps };
}

// run cases on h's pages side by side → results in order; each({ cas, r, bad, i }) as each one finishes
export async function runAll(h, cases, each = () => {}) {
  const out = [];
  let next = 0;
  await Promise.all(h.pages.map(async page => {
    while (next < cases.length) {
      const i = next++, cas = cases[i], r = await run(h, page, cas), bad = judge(r, cas.lim);
      out[i] = { cas, r, bad };
      each({ cas, r, bad, i });
    }
  }));
  return out;
}
