// node tools/fuzz.mjs [N=200] [--seed 1] [--pages 4] [--root <studio folder>] [--report <file.md>]
// Women's and men's mannequin × a random top × a random few edits (cards, bars, dragged points, the outline pulled
// anywhere — both sides or one, undo / redo, body and bottom buttons, views), N runs from seed on. Each run is judged (harness.mjs LIMITS); a failing one is saved as a case
// in tools/cases/fuzz/<seed>.json (replay it with repro.mjs; once fixed, move it up to tools/cases/ to keep it checked).
import { writeFileSync, mkdirSync } from 'node:fs';
import { start, runAll, gen, line } from './harness.mjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const N = +(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 200), seed0 = +arg('seed', 1);
const DIR = new URL('cases/fuzz/', import.meta.url);
const cases = Array.from({ length: N }, (_, i) => gen(seed0 + i));
const t0 = Date.now(), h = await start({ root: arg('root'), pages: +arg('pages', 4) });
let done = 0;
const res = await runAll(h, cases, ({ cas, r, bad }) => {
  done++;
  console.log(`${String(done).padStart(4)}/${N} ${bad.length ? 'FAIL' : 'ok  '} ${cas.name}: ${r.m ? line(r) : r.err}${bad.length ? ' — ' + bad.join('; ') : ''}`);
  if (bad.length) {
    mkdirSync(DIR, { recursive: true });
    writeFileSync(new URL(`${cas.seed}.json`, DIR), JSON.stringify({ ...cas, found: bad }, null, 1));
  }
}).finally(h.close);

// report: failures by kind, and the spread of each number over the passing runs
const fails = res.filter(x => x.bad.length), kinds = {};
for (const x of fails) for (const k of new Set(x.bad.map(b => b.split(' ')[0]))) (kinds[k] ||= []).push(x.cas.seed);
const q = (a, p) => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN; };
const ok = res.filter(x => x.r.m), col = f => ok.map(x => f(x.r));
const spread = [
  ['멈춤 s', col(r => r.s)], ['귀 cm', col(r => r.m.ear)], ['밑단 옆 말림 cm', col(r => Math.max(r.m.roll.side0 ?? -9, r.m.roll.side1 ?? -9))],
  ['소매 말림 cm', col(r => Math.max(r.m.roll.l ?? -99, r.m.roll.r ?? -99)).filter(v => v > -99)], ['겹침', col(r => r.m.selfx)], ['뚫림 점', col(r => r.m.pen)],
];
const md = [
  `# fuzz ${N}번 (seed ${seed0}–${seed0 + N - 1}, ${new Date().toISOString().slice(0, 16).replace('T', ' ')}, ${((Date.now() - t0) / 60000).toFixed(1)}분)`, '',
  `실패 ${fails.length} / ${N}`, '',
  ...Object.entries(kinds).map(([k, s]) => `- ${k} ${s.length}번: seed ${s.join(', ')}`), '',
  '| 숫자 | 중앙값 | 90% | 최대 |', '|---|---|---|---|',
  ...spread.map(([n, a]) => `| ${n} | ${q(a, .5)} | ${q(a, .9)} | ${q(a, 1)} |`), '',
  '## 실패한 경우', '',
  ...fails.map(x => `- seed ${x.cas.seed} (${x.cas.state.body}, ${x.cas.steps.filter(s => s.t !== 'wait' && s.t !== 'settle').map(s => s.t + (s.g ? ':' + s.g + s.i : s.id ? ':' + s.id : s.v ? ':' + s.v : s.dot != null ? ':' + s.dot : '')).join(' → ') || '편집 없음'}): ${x.bad.join('; ')}`),
].join('\n');
console.log('\n' + md);
if (arg('report')) writeFileSync(arg('report'), md + '\n');
process.exit(0);
