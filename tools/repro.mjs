// node tools/repro.mjs <saved value or case: a .json file, or the JSON itself> [--root <studio folder>] [--out <folder>]
// A bug report straight to numbers: the saved value someone copied from the console
// (copy(localStorage['clothes-custom:studio:v1'])) or a case from tools/cases, played and measured as check / fuzz do,
// with a picture of the whole figure and a close one of the worst point (<out>/repro.png, repro-near.png).
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { start, run, judge, line } from './harness.mjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const src = process.argv[2];
if (!src) { console.log('사용법: node tools/repro.mjs <저장값.json | 저장값 JSON> [--root 폴더] [--out 폴더]'); process.exit(2); }
const v = JSON.parse(existsSync(src) ? readFileSync(src, 'utf8') : src);
const cas = v.state ? v : { name: '저장값', state: v };
const out = arg('out', '.'), h = await start({ root: arg('root') }), page = h.pages[0];
try {
  const r = await run(h, page, cas), bad = judge(r, cas.lim);
  console.log(`${cas.name || ''}\n${r.m ? line(r) : r.err}\n${bad.length ? '실패: ' + bad.join('; ') : '통과'}`);
  if (r.m) {
    console.log(`몸 ${cas.state.body} · 패널 값 ${JSON.stringify(await page.evaluate(() => window.__studio.params()))}`);
    await page.screenshot({ path: join(out, 'repro.png') });
    // close up: 45 cm off the worst ear point (else the hem's front), from in front of (or behind) it and a little to
    // its side: straight out from the body's axis a side point is seen through the hanging arm
    const P = r.m.earP || await page.evaluate(() => { const c = window.__studio.cloth.userData.marks.hem[0], p = window.__studio.cloth.geometry.attributes.position; return [p.getX(c), p.getY(c), p.getZ(c)]; });
    await page.evaluate(P => {
      const s = window.__studio, c = s.camera, t = s.controls.target, dx = P[0] * .5, dz = P[2] < s.A.z0 ? -1 : 1, l = Math.hypot(dx, dz);
      t.set(P[0], P[1], P[2]); c.position.set(P[0] + dx / l * .45, P[1] + .08, P[2] + dz / l * .45);
      s.controls.minDistance = .1; s.controls.update();
    }, P);
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(out, 'repro-near.png') });
    console.log(`사진: ${join(out, 'repro.png')}, ${join(out, 'repro-near.png')}`);
  }
  process.exitCode = bad.length ? 1 : 0;
} finally { await h.close(); }
