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
    // (the bump may be shrunk to nothing by the fitted card, and a bump of nothing is dropped: only the pieces are checked)
    check: () => window.__studio.editOk() ? [] : ['카드 뒤 조각이 깨짐'] },
  { name: 'f 밑단 가운데 혹', state: { v: 2, body: 'f', bottom: 'jeans', top: TOP }, steps: [{ t: 'view', a: 0 }, { t: 'wait', ms: 400 }, { t: 'edge', pc: 0, curve: 'hem', at: .8, half: 'p', dx: 0, dy: 40 }, { t: 'settle' }],
    check: () => { const D = document.querySelectorAll('#layer .dot:not(.edge)'); return [...(D[2].hidden ? [] : ['밑단 고정 점이 혹 위에 보임']), ...(D[8].hidden ? ['목선 고정 점까지 숨음'] : [])]; } },
);
// 왼쪽·오른쪽 같이 off: only the half pulled takes the bump (front and back of it where they are sewn), the other half
// none, and the cloth still passes — the side, the armhole (that sleeve's cap then cut to its own armhole), the front hem
for (const [body, curve, at, dx, dy, fb, want] of [['f', 'side', .5, 30, 0, 1, ['Fp', 'Bp']], ['m', 'side', .5, -30, 0, 1, ['Fp', 'Bp']],
  ['f', 'arm', .5, 25, 0, 1, ['Fp', 'Bp']], ['m', 'hem', .5, 0, 40, 0, ['Fp']]])
  cases.push({ name: `${body} 한쪽 ${curve}`, state: { v: 2, body, bottom: 'jeans', top: TOP },
    steps: [{ t: 'view', a: 0 }, { t: 'wait', ms: 400 }, { t: 'toggle', id: 'sym' }, ...(fb ? [] : [{ t: 'toggle', id: 'fb' }]), { t: 'edge', pc: 0, curve, at, half: 'p', dx, dy }, { t: 'settle' }],
    check: new Function(`const E = window.__studio.state.top.edit || {}, want = ${JSON.stringify(want)}, has = k => (E[k] || []).some(e => Math.hypot(e[2], e[3]) >= .5);
      return [...want.filter(k => !has(k)).map(k => k + ' 혹이 안 생김'), ...['Fp', 'Fm', 'Bp', 'Bm'].filter(k => !want.includes(k) && has(k)).map(k => k + '에도 혹'),
        ...(window.__studio.editOk() ? [] : ['조각이 깨짐'])];`) });
// one half's hem pulled down by the middle: the other half follows it over the centre line, the two meeting there
cases.push({ name: 'f 한쪽 밑단 가운데', state: { v: 2, body: 'f', bottom: 'jeans', top: TOP },
  steps: [{ t: 'view', a: 0 }, { t: 'wait', ms: 400 }, { t: 'toggle', id: 'sym' }, { t: 'edge', pc: 0, curve: 'hem', at: .8, half: 'p', dx: 0, dy: 40 }, { t: 'settle' }],
  check: async () => {
    const S = window.__studio, E = S.state.top.edit || {}, { halves } = await import('./pattern.js?v=27'), h = halves(S.params());
    const gap = Math.abs(h.Fp.hem.at(-1)[1] - h.Fm.hem.at(-1)[1]), drop = h.F.hem.at(-1)[1] - h.Fp.hem.at(-1)[1];
    return [...((E.Fp || []).length && !(E.Fm || []).length ? [] : [`혹 Fp ${JSON.stringify(E.Fp)} Fm ${JSON.stringify(E.Fm)}`]),
      ...(gap < .05 && drop > 1 ? [] : [`가운데 어긋남 ${gap.toFixed(2)}cm, 내려감 ${drop.toFixed(2)}cm`]), ...(S.editOk() ? [] : ['조각이 깨짐'])];
  } });
// the scissors (가위, 1단계 of the 2026-10-30 plan): a click on the ring cuts the hem or both sleeves there and nothing
// else; above the underarm nothing; on a sleeve's cap the sleeves come off; a flared hem cut higher is narrower; undo
// puts it back
const cut = (pc, at) => [{ t: 'view', a: 0 }, { t: 'wait', ms: 400 }, { t: 'cut', pc, at }, { t: 'settle' }];
const same = (keep, want) => `const T = window.__studio.state.top, o = ${JSON.stringify(keep)}, w = ${JSON.stringify(want)}, bad = [];
  for (const k in o) if (JSON.stringify(T[k]) !== JSON.stringify(o[k])) bad.push(k + ' 바뀜 ' + JSON.stringify(T[k]));
  for (const k in w) { const v = [].concat(T[k]), x = [].concat(w[k][0]); if (v.some((q, i) => Math.abs(q - x[i]) > w[k][1])) bad.push(k + ' ' + JSON.stringify(T[k]) + ' (바람 ' + JSON.stringify(w[k][0]) + ')'); }
  return bad;`;
const keep = { ease: 0, sEase: 0, dNw: 0, ndF: 10, ndB: 2.6, neckV: 0 };
cases.push(
  { name: 'f 가위 밑단', state: { v: 2, body: 'f', bottom: 'jeans', top: TOP }, steps: cut(0, 45), check: new Function(same({ ...keep, sl: [20, 20] }, { L: [44.5, 1] })) },
  { name: 'm 가위 소매', state: { v: 2, body: 'm', bottom: 'jeans', top: { ...TOP, sl: [45, 45] } }, steps: cut(2, 20), check: new Function(same({ ...keep, L: 62 }, { sl: [[20, 20], 1] })) },
  { name: 'f 가위 소매산', state: { v: 2, body: 'f', bottom: 'jeans', top: TOP }, steps: cut(2, 5), check: new Function(same({ ...keep, L: 62, sl: [0, 0] }, {})) },
  { name: 'f 가위 겨드랑이 위', state: { v: 2, body: 'f', bottom: 'jeans', top: TOP }, steps: cut(0, 14), check: new Function(same({ ...keep, L: 62, sl: [20, 20] }, {})) },
  { name: 'f 가위 플레어 밑단', state: { v: 2, body: 'f', bottom: 'jeans', top: { ...TOP, ease: 4, sEase: 4, flare: 8, L: 70 } }, steps: cut(0, 50),
    check: () => { const T = window.__studio.state.top; return T.flare < 6 && Math.abs(T.L - 49.5) < 1 && window.__studio.editOk() ? [] : [`flare ${T.flare} L ${T.L}`]; } },
  { name: 'm 가위 되돌리기', state: { v: 2, body: 'm', bottom: 'jeans', top: TOP }, steps: [...cut(0, 40), { t: 'undo' }, { t: 'settle' }], check: new Function(same({ ...keep, L: 62, sl: [20, 20] }, {})) },
);
// the scissors drawn (2단계): a line across the front cuts the front only (diagonal too; the side seams sewn only as far
// as both halves reach, open below); over a sleeve's cap that sleeve comes off; a line under the neck scoops one side; one
// from the shoulder down past the armhole takes that armhole, and its sleeve, off; one that would leave no top cuts
// nothing; undo puts it back
const draw = pts => [{ t: 'view', a: 0 }, { t: 'wait', ms: 400 }, { t: 'stroke', pts }, { t: 'settle' }];
const cutsAre = (want, sl) => new Function(`const T = window.__studio.state.top, k = [...new Set((T.cuts || []).map(c => c.k))].sort().join(), bad = [];
  if (k !== ${JSON.stringify(want)}) bad.push('자른 곳 [' + k + ']');
  if (JSON.stringify(T.sl) !== ${JSON.stringify(JSON.stringify(sl))}) bad.push('소매 ' + JSON.stringify(T.sl));
  return bad;`);
const DIAG = [[0, 18, -38], [0, 0, -46], [0, -18, -54]];
cases.push(
  { name: 'f 그어 대각 밑단', state: { v: 2, body: 'f', bottom: 'jeans', top: TOP }, steps: draw(DIAG), check: cutsAre('Fm,Fp', [20, 20]) },
  { name: 'm 그어 앞만 짧게', state: { v: 2, body: 'm', bottom: 'jeans', top: TOP }, steps: draw([[0, 20, -45], [0, -20, -45]]), check: cutsAre('Fm,Fp', [20, 20]) },
  { name: 'f 그어 소매 떼기', state: { v: 2, body: 'f', bottom: 'jeans', top: TOP }, steps: draw([[2, -9, -3], [2, -2, -6]]), check: cutsAre('', [0, 20]) },
  { name: 'f 그어 목선 한쪽', state: { v: 2, body: 'f', bottom: 'jeans', top: TOP }, steps: draw([[0, 2, -17], [0, 4.5, -13], [0, 7, -9]]), check: cutsAre('Fp', [20, 20]) },
  { name: 'f 그어 진동 깊게', state: { v: 2, body: 'f', bottom: 'jeans', top: TOP }, steps: draw([[0, 15, -6], [0, 21, -24], [0, 23, -33]]), check: cutsAre('Fp', [0, 20]) },
  { name: 'f 그어 가운데 다 잘림', state: { v: 2, body: 'f', bottom: 'jeans', top: TOP }, steps: draw([[0, 5, -15], [0, 5, -50]]), check: cutsAre('', [20, 20]) },
  { name: 'm 그어 되돌리기', state: { v: 2, body: 'm', bottom: 'jeans', top: TOP }, steps: [...draw(DIAG), { t: 'undo' }, { t: 'settle' }], check: cutsAre('', [20, 20]) },
);
// --cut: the scissors' cases only
if (process.argv.includes('--cut')) cases.splice(0, cases.length, ...cases.filter(c => /가위|그어/.test(c.name)));
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
