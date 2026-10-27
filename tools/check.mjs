// node tools/check.mjs : open the studio in Chrome (harness.mjs) and fail unless every case in tools/cases/*.json passes
// (old bugs that came back, and tops whose numbers must not get worse: their own limits in "lim") and a short fuzz
// (the same 30 seeds each time) fails no more often than it did on the day it was set.
// Needs Playwright and Chrome: PLAYWRIGHT=<path to the playwright package> if it isn't installed beside the repo.
import { readdirSync, readFileSync } from 'node:fs';
import { start, runAll, gen, line } from './harness.mjs';

const FUZZ = 30, FUZZ_FAILS = 1;   // fuzz seeds 1…30: failures allowed (2026-10-28: seed 25; lower it as it is fixed)
const DIR = new URL('cases/', import.meta.url);
const cases = readdirSync(DIR).filter(f => f.endsWith('.json')).sort().map(f => JSON.parse(readFileSync(new URL(f, DIR), 'utf8')));
const fuzz = Array.from({ length: FUZZ }, (_, i) => gen(i + 1));
const h = await start({ pages: 4 });
let bad = 0, fz = 0;
try {
  await runAll(h, [...cases, ...fuzz], ({ cas, r, bad: b, i }) => {
    if (i < cases.length) { if (b.length) bad++; } else if (b.length) fz++;
    console.log(`${b.length ? 'FAIL' : 'ok  '} ${cas.name}: ${r.m ? line(r) : r.err}${b.length ? ' — ' + b.join('; ') : ''}`);
  });
} finally { await h.close(); }
console.log(`\n사례 ${cases.length - bad}/${cases.length} 통과 · fuzz ${FUZZ}번 중 실패 ${fz} (허용 ${FUZZ_FAILS})`);
process.exit(bad || fz > FUZZ_FAILS ? 1 : 0);
