// node tools/check.mjs : open the studio in Chrome, let a few garments settle, and fail if the cloth takes too long to
// stop or passes through itself (mesh edges that pierce a triangle of the same cloth) more than it does today.
// Needs Playwright and Chrome: PLAYWRIGHT=<path to the playwright package> if it isn't installed beside the repo.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT || 'playwright');

// [name, body, saved top, then (applied like a card after it settles), limits]
// limits: seconds to settle, self-crossings — 2026-10-27 measured 3.3 s/35, 4.5 s/92, 6 s/125 (crossings repeat exactly)
const CASES = [
  ['남 기본 반팔', 'm', {}, null, { s: 10, x: 40 }],
  ['여 오버', 'f', { ease: 9, flare: 2 }, null, { s: 10, x: 100 }],
  ['여 오버 반팔→긴팔', 'f', { ease: 9, flare: 2 }, { sl: [53, 53] }, { s: 10, x: 135 }],
];

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.glb': 'model/gltf-binary', '.json': 'application/json', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  const p = normalize(join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
  try {
    const f = p.endsWith('\\') || p.endsWith('/') ? join(p, 'index.html') : p;
    if (!f.startsWith(ROOT)) throw 0;
    res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream' }).end(await readFile(f));
  } catch { res.writeHead(404).end(); }
}).listen(0, '127.0.0.1');
await new Promise(r => server.once('listening', r));
const URL0 = `http://127.0.0.1:${server.address().port}/`;

// in page: count cloth edges that pierce a triangle they share no particle with
function selfx() {
  const c = window.__studio.cloth, g = c.geometry, P = g.attributes.position.array, I = g.index.array, map = c.userData.map;
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

const br = await chromium.launch({ channel: 'chrome', args: ['--use-angle=d3d11', '--enable-gpu'] });
const page = await br.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const settle = async () => {   // seconds until the cloth stops (Infinity if it never does within 30 s)
  const t0 = Date.now();
  await page.waitForTimeout(500);
  const ok = await page.waitForFunction(() => !window.__studio.awake, null, { timeout: 30000, polling: 200 }).then(() => true, () => false);
  return ok ? (Date.now() - t0) / 1000 : Infinity;
};
let bad = 0;
try {
  await page.goto(URL0);
  for (const [name, body, top, then, lim] of CASES) {
    await page.evaluate(([body, top]) => localStorage.setItem('clothes-custom:studio:v1', JSON.stringify({ body, bottom: 'jeans', top })), [body, top]);
    await page.goto(URL0);
    await page.waitForFunction(() => window.__studio && window.__studio.cloth, null, { timeout: 60000 });
    let s = await settle();
    if (then) { await page.evaluate(o => { Object.assign(window.__studio.state.top, o); window.__studio.apply(); }, then); s = await settle(); }
    const x = await page.evaluate(selfx);
    const ok = s <= lim.s && x <= lim.x;
    if (!ok) bad++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: 멈춤 ${s.toFixed(1)}s (한도 ${lim.s}) · 겹침 ${x} (한도 ${lim.x})`);
  }
  if (errors.length) { bad++; console.log('FAIL 페이지 오류:', errors.join(' / ')); }
} finally {
  await br.close();
  server.close();
}
process.exit(bad ? 1 : 0);
