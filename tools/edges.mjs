// node tools/edges.mjs [--pages 4] [--panels]: the outline pulled by hand (2단계) — three places on each edge of a top (hem, side,
// neckline, shoulder, armhole, a sleeve's end and underarm), each dragged out and in, the way a person does it with the
// point that shows on the edge. Each must take (a bump in the pattern where it was dragged) and the cloth still pass
// every check (harness.mjs LIMITS); then once more after undo, which must take the bumps back off.
import { start, run, judge, line } from './harness.mjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const TOP = { sl: [20, 20], L: 62, ease: 0, sEase: 0, flare: 0, dNw: 0, ndF: 10, ndB: 2.6, neckV: 0 };
const EDGES = [
  // [name, piece, curve, half, view, drag px (out, then the second one in)]
  ['밑단', 0, 'hem', 'p', 0], ['옆선', 0, 'side', 'p', 0], ['목선', 0, 'neck', 'p', 0], ['어깨선', 0, 'shoulder', 'p', 0],
  ['진동둘레', 0, 'arm', 'p', 0], ['소매 끝', 2, 'hem', 's', 0], ['소매 옆선', 2, 'und', 's', 2], ['뒤 밑단', 1, 'hem', 'm', 3],
];
// --panels: the body panels' edges only (the sleeves' come with 2-2)
const cases = [];
for (const body of ['f', 'm']) for (const [name, pc, curve, half, view] of EDGES.filter(e => !process.argv.includes('--panels') || e[1] < 2)) {
  const steps = [{ t: 'view', a: view }, { t: 'wait', ms: 400 }];
  [.25, .5, .8].forEach((at, i) => steps.push({ t: 'edge', pc, curve, at, half, dx: i === 1 ? -14 : 18, dy: i === 2 ? 16 : -10 }, { t: 'settle' }));
  cases.push({ name: `${body} ${name}`, state: { v: 2, body, bottom: 'jeans', top: { ...TOP, sl: curve === 'und' || pc === 2 ? [45, 45] : [20, 20] } }, steps, want: pc >= 2 ? 'S' : pc ? 'B' : 'F' });
}
const h = await start({ pages: +arg('pages', 4) });
let fail = 0;
try {
  for (let i = 0; i < cases.length; i += h.pages.length) await Promise.all(h.pages.map(async (page, j) => {
    const cas = cases[i + j]; if (!cas) return;
    const r = await run(h, page, cas), bad = judge(r, cas.lim);
    const ed = await page.evaluate(() => window.__studio.state.top.edit || {});
    const bumps = Object.entries(ed).filter(([k]) => k[0] === cas.want).flatMap(([, l]) => l).filter(e => Math.hypot(e[2], e[3]) >= .5);
    if (bumps.length < 3) bad.push(`편집이 안 먹힘 (${cas.want} 혹 ${bumps.length}개: ${JSON.stringify(ed)})`);
    // undo three times: back to no bumps
    for (let k = 0; k < 3; k++) await page.click('#undo').catch(() => {});
    await page.waitForTimeout(300);
    const left = await page.evaluate(() => Object.values(window.__studio.state.top.edit || {}).flat().length);
    if (left) bad.push(`되돌리기 뒤에도 혹 ${left}개`);
    if (bad.length) fail++;
    console.log(`${bad.length ? 'FAIL' : 'ok  '} ${cas.name}: ${r.m ? line(r) : r.err}${bad.length ? '\n     ' + bad.join('; ') : ''}`);
  }));
} finally { await h.close(); }
console.log(fail ? `실패 ${fail}/${cases.length}` : `전부 통과 ${cases.length}`);
process.exit(fail ? 1 : 0);
