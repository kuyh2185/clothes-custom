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
// --panels: the body panels' edges only (and the checks below); --extra: the checks below only
const cases = [], only = process.argv.includes('--extra');
if (!only) for (const body of ['f', 'm']) for (const [name, pc, curve, half, view] of EDGES.filter(e => !process.argv.includes('--panels') || e[1] < 2)) {
  const steps = [{ t: 'view', a: view }, { t: 'wait', ms: 400 }];
  // (the neckline pulled down: pulled up, the shallow back neck soon reaches the shoulder's height and stops there)
  [.25, .5, .8].forEach((at, i) => steps.push({ t: 'edge', pc, curve, at, half, dx: i === 1 ? -14 : 18, dy: i === 2 || curve === 'neck' ? 16 : -10 }, { t: 'settle' }));
  cases.push({ name: `${body} ${name}`, state: { v: 2, body, bottom: 'jeans', top: { ...TOP, sl: curve === 'und' || pc === 2 ? [45, 45] : [20, 20] } }, steps, want: pc >= 2 ? 'S' : pc ? 'B' : 'F' });
}
// what else must hold (page-side checks, each → a list of what's wrong): a neckline pulled up stops at the shoulder's
// height (the back's 2.6 cm deep: its middle 2.6 cm up at most), a side pulled in on a loose top and a card then making
// it fitted leaves whole pieces (the bump shrunk away), a fixed point under a drawn bump is hidden and one away from it not
cases.push(
  { name: 'f 목선 위로', state: { v: 2, body: 'f', bottom: 'jeans', top: TOP }, steps: [{ t: 'view', a: 0 }, { t: 'wait', ms: 400 }, { t: 'edge', pc: 0, curve: 'neck', at: .35, half: 'p', dx: 0, dy: -80 }, { t: 'settle' }],
    check: () => { const b = (window.__studio.state.top.edit || {}).Bp || []; return b.length && b[0][3] >= 1 && b[0][3] <= 2.7 ? [] : [`뒤 목 혹 ${JSON.stringify(b)} (앞 목 ${window.__studio.state.top.ndF})`]; } },
  { name: 'f 카드 뒤 옆선', state: { v: 2, body: 'f', bottom: 'jeans', top: { ...TOP, ease: 6, sEase: 6 } }, steps: [{ t: 'view', a: 0 }, { t: 'wait', ms: 400 }, { t: 'edge', pc: 0, curve: 'side', at: .5, half: 'p', dx: -40, dy: 0 }, { t: 'settle' }, { t: 'card', g: 'fit', i: 0 }, { t: 'settle' }],
    check: () => { const S = window.__studio, b = (S.state.top.edit || {}).Fp || []; return [...(b.length ? [] : ['옆선 혹이 안 생김']), ...(S.editOk() ? [] : ['카드 뒤 조각이 깨짐'])]; } },
  { name: 'f 밑단 가운데 혹', state: { v: 2, body: 'f', bottom: 'jeans', top: TOP }, steps: [{ t: 'view', a: 0 }, { t: 'wait', ms: 400 }, { t: 'edge', pc: 0, curve: 'hem', at: .8, half: 'p', dx: 0, dy: 40 }, { t: 'settle' }],
    check: () => { const D = document.querySelectorAll('#layer .dot:not(.edge)'); return [...(D[2].hidden ? [] : ['밑단 고정 점이 혹 위에 보임']), ...(D[8].hidden ? ['목선 고정 점까지 숨음'] : [])]; } },
);
const h = await start({ pages: +arg('pages', 4) });
let fail = 0;
try {
  for (let i = 0; i < cases.length; i += h.pages.length) await Promise.all(h.pages.map(async (page, j) => {
    const cas = cases[i + j]; if (!cas) return;
    const r = await run(h, page, cas), bad = judge(r, cas.lim);
    if (cas.check) {
      bad.push(...await page.evaluate(cas.check));
      if (bad.length) fail++;
      console.log(`${bad.length ? 'FAIL' : 'ok  '} ${cas.name}: ${r.m ? line(r) : r.err}${bad.length ? '\n     ' + bad.join('; ') : ''}`);
      return;
    }
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
