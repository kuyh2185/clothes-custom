/* 고쳐 입기 — graphics: characters, logos and lettering printed on the clothes.
   Each garment carries layers (g.gfx) on print areas measured in real centimetres: front, back and both sleeves
   (trousers and skirts: front and back). A layer's x is cm right of the area's centre line as you look at that side,
   y is cm down from the area's top edge. Every area is composited into one canvas: the 3D stage projects it onto the
   fabric (stage3d.js) and the print file is the same drawing at 150 dpi.
   Pictures go through a cut-out window first — background removal by a model running in the browser, magic wand,
   eraser / restore brush, soft edge, sticker outline — and are kept in IndexedDB; layers only hold their ids. */
const cc = window.__cc;
const PI = Math.PI;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r1 = v => Math.round(v * 10) / 10;
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const PX = 16;            // canvas pixels per cm on screen
const PRINT_PX = 150 / 2.54;   // 150 dpi
const MAX_SIDE = 1800;    // pictures are kept at most this big (≈ 24 cm at 190 dpi)

export const AREAS = {
  top: {
    front: { n: '앞판', w: 36, h: 52 }, back: { n: '뒷판', w: 38, h: 56 },
    lsl: { n: '왼팔', w: 14, h: 60 }, rsl: { n: '오른팔', w: 14, h: 60 },
  },
  bottom: { front: { n: '앞', w: 42, h: 100 }, back: { n: '뒤', w: 42, h: 100 } },
};
// common print spots: [name, x, y, width] (wearer's left chest is on the viewer's right)
const SPOTS = {
  top: {
    front: [['가슴 가운데', 0, 15, 22], ['왼쪽 가슴', 9, 10, 8], ['배 가운데', 0, 27, 20]],
    back: [['등 위', 0, 13, 24], ['등 가운데', 0, 24, 30], ['목 뒤', 0, 5, 8]],
    lsl: [['어깨 아래', 0, 8, 8], ['팔꿈치 위', 0, 22, 8]], rsl: [['어깨 아래', 0, 8, 8], ['팔꿈치 위', 0, 22, 8]],
  },
  bottom: {
    front: [['왼쪽 허벅지', 11, 24, 12], ['오른쪽 허벅지', -11, 24, 12], ['왼쪽 무릎', 11, 52, 10]],
    back: [['왼쪽 뒷주머니', -10, 14, 10], ['오른쪽 종아리', 10, 72, 10]],
  },
};
const FONTS = {
  bold: { n: '굵은 고딕', css: '"Pretendard Variable",Pretendard,sans-serif', w: 800 },
  bhs: { n: '검은 고딕', css: '"Black Han Sans"', w: 400 },
  dohyeon: { n: '도현', css: '"Do Hyeon"', w: 400 },
  jua: { n: '주아', css: '"Jua"', w: 400 },
  gaegu: { n: '개구 손글씨', css: '"Gaegu"', w: 700 },
  pen: { n: '펜 손글씨', css: '"Nanum Pen Script"', w: 400 },
};
const uid = () => 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const isDark = hex => { const n = parseInt(hex.slice(1), 16); return (.2126 * (n >> 16) + .7152 * (n >> 8 & 255) + .0722 * (n & 255)) < 110; };
const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; };
const toBlob = (c, type = 'image/png', q) => new Promise(res => c.toBlob(res, type, q));

/* ---------- picture store (IndexedDB; memory when it isn't available) ---------- */
const MEM = {};
let dbp = null;
const db = () => dbp || (dbp = new Promise((res, rej) => {
  const r = indexedDB.open('clothes-custom', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('img');
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
}));
async function idb(mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const tx = d.transaction('img', mode), q = fn(tx.objectStore('img'));
    tx.oncomplete = () => res(q && q.result);
    tx.onerror = () => rej(tx.error);
  });
}
async function putRec(id, rec) { MEM[id] = rec; try { await idb('readwrite', s => s.put(rec, id)); } catch (e) { /* kept in memory only */ } }
async function getRec(id) { if (MEM[id]) return MEM[id]; try { return await idb('readonly', s => s.get(id)); } catch (e) { return null; } }

/* ---------- loaded pictures ---------- */
let ver = 0;   // goes up whenever a picture or a font finishes loading: composites redraw
const IMG = {};
function picture(id) {
  const e = IMG[id];
  if (e) return e.el || null;
  IMG[id] = { loading: true };
  (async () => {
    const rec = await getRec(id);
    let blob = rec && rec.out;
    if (!blob && cc.images[id]) blob = await (await fetch(cc.images[id])).blob();
    if (!blob) { IMG[id] = { missing: true }; return; }
    IMG[id] = { el: await createImageBitmap(blob) };
    ver++; cc.render(); refreshThumbs();
  })().catch(() => { IMG[id] = { missing: true }; });
  return null;
}

/* ---------- lettering ---------- */
const TXT = {};
const fontWait = {};
function ensureFont(font, s) {
  if (document.fonts.check(font, s) || fontWait[font + s]) return;
  fontWait[font + s] = 1;
  document.fonts.load(font, s).then(() => { ver++; cc.render(); refreshThumbs(); }).catch(() => {});
}
// one line of lettering, straight or bent into an arch (∩ for arc > 0, ∪ below 0), with an optional outline
function textCanvas(it, fp) {
  const F = FONTS[it.font] || FONTS.bold, s = (it.s || '').trim() || ' ';
  const key = [s, it.font, it.c, it.sc, it.sw, it.arc, fp, ver].join('|');
  if (TXT[key]) return TXT[key];
  const font = `${F.w} ${fp}px ${F.css}`;
  ensureFont(font, s);
  const m = canvas(1, 1).getContext('2d');
  m.font = font;
  const chars = [...s], ws = chars.map(ch => m.measureText(ch).width), total = ws.reduce((a, b) => a + b, 0) || 1;
  const asc = fp * .9, desc = fp * .26, sw = it.sc ? (it.sw ?? 3) * fp * .025 : 0, pad = sw + fp * .05;
  const arc = clamp((it.arc || 0) / 100, -1, 1) * PI, R = Math.abs(arc) > .01 ? total / Math.abs(arc) : 0;
  let cum = 0;
  const G = chars.map((ch, i) => {
    const mid = cum + ws[i] / 2 - total / 2;
    cum += ws[i];
    if (!R) return { ch, x: mid, y: 0, rot: 0, w: ws[i] };
    const phi = mid / R, x = R * Math.sin(phi), dy = R - R * Math.cos(phi);
    return arc > 0 ? { ch, x, y: dy, rot: phi, w: ws[i] } : { ch, x, y: -dy, rot: -phi, w: ws[i] };
  });
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const g of G) for (const [cx, cy] of [[-g.w / 2, -asc], [g.w / 2, -asc], [-g.w / 2, desc], [g.w / 2, desc]]) {
    const px = g.x + cx * Math.cos(g.rot) - cy * Math.sin(g.rot), py = g.y + cx * Math.sin(g.rot) + cy * Math.cos(g.rot);
    x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
  }
  const W = x1 - x0 + pad * 2, H = y1 - y0 + pad * 2;
  if (Math.max(W, H) > 7000) return textCanvas(it, Math.floor(fp * 7000 / Math.max(W, H)));
  const c = canvas(W, H), x = c.getContext('2d');
  x.font = font; x.textBaseline = 'alphabetic'; x.textAlign = 'center'; x.lineJoin = 'round';
  x.translate(pad - x0, pad - y0);
  const each = fn => G.forEach(g => { x.save(); x.translate(g.x, g.y); x.rotate(g.rot); fn(g); x.restore(); });
  if (sw) { x.strokeStyle = it.sc; x.lineWidth = sw * 2; each(g => x.strokeText(g.ch, 0, 0)); }
  x.fillStyle = it.c || '#ffffff';
  each(g => x.fillText(g.ch, 0, 0));
  if (Object.keys(TXT).length > 40) for (const k in TXT) delete TXT[k];
  TXT[key] = c;
  return c;
}

/* ---------- compositing the print areas ---------- */
const items = slot => { const g = cc.state[slot]; return g ? (g.gfx || (g.gfx = [])) : []; };
function source(it, px) {
  if (it.t === 'txt') {
    const c = textCanvas(it, px > PX * 1.5 ? 420 : 150);
    if (px <= PX * 1.5) it.ar = c.height / c.width;
    return c;
  }
  const el = picture(it.img);
  if (el && !it.ar) it.ar = el.height / el.width;
  return el;
}
const hOf = it => it.w * (it.ar || 1);
function drawArea(x, slot, area, px, only) {
  const A = AREAS[slot][area];
  for (const it of items(slot)) {
    if (it.a !== area || it.hid || (only && it !== only)) continue;
    const src = source(it, px);
    if (!src) continue;
    const w = it.w * px, h = hOf(it) * px;
    x.save();
    x.translate((it.x + A.w / 2) * px, it.y * px);
    x.rotate((it.r || 0) * PI / 180);
    if (it.f) x.scale(-1, 1);
    x.drawImage(src, -w / 2, -h / 2, w, h);
    x.restore();
  }
}
const COMP = {};
// the area canvases for the 3D stage; n changes whenever the drawing does
function canvases(slot) {
  const out = {};
  for (const area in AREAS[slot]) {
    const A = AREAS[slot][area], id = slot + ':' + area;
    const C = COMP[id] || (COMP[id] = { c: canvas(A.w * PX, A.h * PX), key: '', n: 0 });
    const list = items(slot).filter(it => it.a === area && !it.hid);
    const key = list.length ? JSON.stringify(list) + ver : '';
    if (key !== C.key) {
      const x = C.c.getContext('2d');
      x.clearRect(0, 0, C.c.width, C.c.height);
      if (list.length) drawArea(x, slot, area, PX);
      C.key = key; C.n++;
    }
    out[area] = { c: C.c, n: C.n, on: list.length > 0 };
  }
  return out;
}
// 2D stage: the front area as one picture
function flat(slot) {
  if (!cc.state[slot] || !items(slot).some(it => it.a === 'front' && !it.hid)) return null;
  const C = canvases(slot).front, A = AREAS[slot].front;
  if (C.url == null || C.urlN !== C.n) { COMP[slot + ':front'].url = C.c.toDataURL(); COMP[slot + ':front'].urlN = C.n; }
  return { url: COMP[slot + ':front'].url, w: A.w, h: A.h };
}

/* ---------- selection & editing ---------- */
const target = () => cc.state.target;
function selected() {
  for (const slot of ['top', 'bottom']) { const it = items(slot).find(x => x.id === cc.ui.gsel); if (it) return { slot, it }; }
  return null;
}
function select(id) {
  if (cc.ui.gsel === id) return;
  cc.ui.gsel = id;
  const s = selected();
  if (s && target() !== s.slot) cc.setTarget(s.slot);
  cc.renderPanel(); cc.render();
}
function addItem(slot, it) {
  const g = cc.state[slot];
  if (!g) return;
  items(slot).push(it);
  cc.ui.gsel = it.id;
  if (target() !== slot) cc.setTarget(slot);
  if (cc.tool !== 'gfx') cc.setTool('gfx');
  cc.render(); cc.renderPanel(); cc.commit();
}
// where a new graphic goes: the area's first spot, kept from running too far down when it is tall
// a hood lying on the back covers its top: spots there move down below it
const hoodDrop = (slot, area) => slot === 'top' && area === 'back' && cc.state.top && cc.state.top.kind === 'hoodie' && !cc.state.top.hoodOff ? 12 : 0;
function spotFor(slot, area, ar) {
  const s = SPOTS[slot][area][0], hMax = Math.max(8, AREAS[slot][area].h * .46), w = Math.min(s[3], hMax / ar), h = w * ar;
  return { x: s[1], y: (slot === 'top' && (area === 'front' || area === 'back') ? Math.max(s[2], 6 + h / 2) : s[2]) + hoodDrop(slot, area), w: r1(w) };
}
function addPicture(id, ar) {
  const slot = cc.state[target()] ? target() : (cc.state.top ? 'top' : 'bottom');
  if (!cc.state[slot]) return cc.say('옷을 먼저 입혀 주세요');
  const p = spotFor(slot, 'front', ar);
  addItem(slot, { id: uid(), t: 'img', img: id, a: 'front', ...p, ar, r: 0 });
  cc.say('옷에 붙였어요 · 끌어서 옮기고 모서리로 크기를 바꿔요');
}
function addText() {
  const slot = target(), g = cc.state[slot];
  if (!g) return cc.say('옷을 먼저 입혀 주세요');
  const dark = isDark(g.fill.c1);
  addItem(slot, { id: uid(), t: 'txt', s: '내 채널', font: 'bhs', c: dark ? '#ffffff' : '#161616', sc: null, sw: 3, arc: 0, a: 'front', x: 0, y: 12, w: 24, r: 0 });
  cc.say('글자를 넣었어요 · 오른쪽에서 글자를 바꿔요');
  setTimeout(() => { const el = $('[data-gtext]'); if (el) { el.focus(); el.select(); } }, 30);
}

/* ---------- panel ---------- */
const SVG = d => `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const IC = {
  eye: SVG('<path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/>'),
  eyeoff: SVG('<path d="M2 2l12 12M6.4 6.5A2 2 0 0 0 9.5 9.6M4.2 4.6C2.5 5.8 1.5 8 1.5 8s2.4 4.5 6.5 4.5c1.3 0 2.4-.4 3.3-1M7 3.6c.3-.1.7-.1 1-.1 4.1 0 6.5 4.5 6.5 4.5s-.5 1-1.5 2"/>'),
  up: SVG('<path d="M8 13V3M4 7l4-4 4 4"/>'), down: SVG('<path d="M8 3v10M4 9l4 4 4-4"/>'),
  dup: SVG('<rect x="5" y="5" width="8.5" height="8.5" rx="1.5"/><path d="M3 10.5V3.8C3 3.3 3.3 3 3.8 3h6.7"/>'),
  del: SVG('<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 8.5h5.6l.7-8.5"/>'),
};
const slider = (k, label, min, max, step, val, out) =>
  `<label class="row"><span class="lab">${label}<b data-gout="${k}">${out}</b></span><input type="range" data-gk="${k}" min="${min}" max="${max}" step="${step}" value="${val}" style="--p:${((val - min) / (max - min) * 100).toFixed(1)}%"></label>`;
const OUTS = { w: it => `${r1(it.w)} × ${r1(hOf(it))}cm`, r: it => `${Math.round(it.r || 0)}°`, sw: it => r1(it.sw ?? 3) + '', arc: it => (it.arc > 0 ? '∩ ' : it.arc < 0 ? '∪ ' : '') + Math.abs(Math.round(it.arc || 0)) };
function thumbOf(it) {
  if (it.t === 'txt') return `<span class="gth txt" style="font-family:${(FONTS[it.font] || FONTS.bold).css.replace(/"/g, "'")};color:${it.c};${it.sc ? `-webkit-text-stroke:1px ${it.sc}` : ''}">${esc((it.s || '').slice(0, 2) || '가')}</span>`;
  return `<canvas class="gth" data-gthumb="${it.img}" width="64" height="64"></canvas>`;
}
function refreshThumbs() {
  document.querySelectorAll('[data-gthumb]').forEach(c => {
    const el = picture(c.dataset.gthumb);
    if (!el) return;
    const x = c.getContext('2d'), k = Math.min(64 / el.width, 64 / el.height);
    x.clearRect(0, 0, 64, 64);
    x.drawImage(el, (64 - el.width * k) / 2, (64 - el.height * k) / 2, el.width * k, el.height * k);
  });
}
function panel() {
  const T = cc.state.top, B = cc.state.bottom, slot = target(), g = cc.state[slot];
  if (!T && !B) return `<p class="empty">옷을 먼저 입혀 주세요. 왼쪽 <b>옷 고르기</b>에서 고를 수 있어요.</p>`;
  const list = items(slot), s = selected(), it = s && s.slot === slot ? s.it : null;
  let h = `<div class="chips" role="group" aria-label="고칠 옷" style="margin-bottom:6px">
      <button type="button" class="chip" data-target="top" ${T ? '' : 'disabled'}>상의${T ? ' · ' + cc.NAME[T.kind] : ''}</button>
      <button type="button" class="chip" data-target="bottom" ${B ? '' : 'disabled'}>하의${B ? ' · ' + cc.NAME[B.kind] : ''}</button></div>
    <div class="gadd">
      <label class="gbig"><input type="file" accept="image/*" data-gfile>${SVG('<rect x="2" y="2.5" width="12" height="11" rx="2"/><circle cx="6" cy="6.5" r="1.3"/><path d="m2.5 12 3.8-3.6 2.4 2.2 2-1.8 3 2.8"/>')}<b>이미지 올리기</b><span>캐릭터·로고·사진</span></label>
      <button type="button" class="gbig" data-gadd="txt">${SVG('<path d="M3 4V2.8h10V4M8 2.8v10.5M6 13.3h4"/>')}<b>글자 넣기</b><span>채널명·문구</span></button>
    </div>
    <p class="note" style="margin:8px 0 0">이미지를 무대에 끌어다 놓거나 <kbd>Ctrl</kbd>+<kbd>V</kbd>로 붙여 넣어도 돼요. 배경은 다음 화면에서 지워요.</p>`;
  if (!g) return h;
  h += `<span class="label-sm">레이어 <span>${list.length}개</span></span>`;
  h += list.length ? `<ul class="glist">${list.map((x, i) => `<li class="gl" data-gsel="${x.id}" aria-current="${x.id === cc.ui.gsel}">
      ${thumbOf(x)}<span class="gtx"><b>${x.t === 'txt' ? '“' + esc((x.s || '').slice(0, 12)) + '”' : '이미지 ' + (list.filter(y => y.t === 'img').indexOf(x) + 1)}</b><span>${AREAS[slot][x.a] ? AREAS[slot][x.a].n : ''} · ${r1(x.w)}cm</span></span>
      <button type="button" class="gi" data-gact="hide" data-gid="${x.id}" aria-label="${x.hid ? '보이기' : '숨기기'}" title="${x.hid ? '보이기' : '숨기기'}">${x.hid ? IC.eyeoff : IC.eye}</button>
      <button type="button" class="gi" data-gact="up" data-gid="${x.id}" aria-label="앞으로" title="앞으로" ${i === list.length - 1 ? 'disabled' : ''}>${IC.up}</button>
      <button type="button" class="gi" data-gact="down" data-gid="${x.id}" aria-label="뒤로" title="뒤로" ${i === 0 ? 'disabled' : ''}>${IC.down}</button>
    </li>`).reverse().join('')}</ul>` : `<p class="empty" style="margin-top:0">아직 넣은 그래픽이 없어요.</p>`;
  if (it) {
    const areas = AREAS[slot];
    h += `<div class="sect gsel"><span class="label-sm">고른 그래픽</span>
      <div class="seg2 gareas" role="group" aria-label="붙일 자리">${Object.entries(areas).map(([a, A]) => `<button type="button" class="chip" data-garea="${a}" aria-pressed="${it.a === a}">${A.n}</button>`).join('')}</div>
      <div class="chips" style="margin-bottom:12px">${(SPOTS[slot][it.a] || []).map((p, i) => `<button type="button" class="chip" data-gspot="${i}">${p[0]}</button>`).join('')}</div>`;
    if (it.t === 'txt') {
      h += `<label class="row"><span class="lab">글자</span><input type="text" class="gtext" data-gtext maxlength="40" value="${esc(it.s || '')}" aria-label="넣을 글자"></label>
        <div class="chips gfonts">${Object.entries(FONTS).map(([id, F]) => `<button type="button" class="chip" data-gfont="${id}" aria-pressed="${it.font === id}" style="font-family:${F.css.replace(/"/g, "'")};font-weight:${F.w}">${F.n}</button>`).join('')}</div>
        <span class="label-sm">글자 색</span>
        <div class="swatches">${cc.COLORS.map(([n, c]) => `<button type="button" class="sw" data-gc="${c}" style="background:${c}" aria-label="${n}" title="${n} ${c}" aria-pressed="${it.c === c}"></button>`).join('')}</div>
        <div class="hexrow"><span class="prev" style="background:${it.c}"></span><input type="text" class="hex" data-ghex="c" maxlength="7" value="${it.c}" aria-label="글자 색 코드"></div>
        <span class="label-sm">테두리</span>
        <div class="chips" style="margin-bottom:10px"><button type="button" class="chip" data-gsc="" aria-pressed="${!it.sc}">없음</button>${[['흰색', '#ffffff'], ['검정', '#161616'], ['주황', '#e8673f'], ['노랑', '#f2c94c'], ['하늘', '#7cc3f0']].map(([n, c]) => `<button type="button" class="chip" data-gsc="${c}" aria-pressed="${it.sc === c}"><i class="dotc" style="background:${c}"></i>${n}</button>`).join('')}</div>
        ${it.sc ? slider('sw', '테두리 두께', .5, 10, .5, it.sw ?? 3, OUTS.sw(it)) : ''}
        ${slider('arc', '아치 (휘기)', -100, 100, 1, it.arc || 0, OUTS.arc(it))}`;
    }
    h += `${slider('w', '크기', 2, Math.round(areas[it.a].w * 1.4), .5, it.w, OUTS.w(it))}
      ${slider('r', '회전', -180, 180, 1, Math.round(it.r || 0), OUTS.r(it))}
      <div class="btn-row">
        <button type="button" class="chip" data-gact="center">가운데로</button>
        <button type="button" class="chip" data-gact="flip" aria-pressed="${!!it.f}">좌우 반전</button>
        ${it.t === 'img' ? '<button type="button" class="chip" data-gact="recut">배경 다시 다듬기</button>' : ''}
        <button type="button" class="chip" data-gact="dup">${IC.dup} 복제</button>
        <button type="button" class="chip danger" data-gact="del">${IC.del} 지우기</button>
      </div>
      <p class="note">옷 위에서 끌어 옮기고, 모서리 점으로 크기, 위의 둥근 점으로 회전해요. 휴대폰은 두 손가락으로 크기·회전. <kbd>Delete</kbd> 지우기, 방향키로 0.5cm씩.</p></div>`;
  } else if (list.length) h += `<p class="note">옷 위의 그래픽이나 목록을 누르면 고를 수 있어요.</p>`;
  const anyGfx = ['top', 'bottom'].some(sl => items(sl).some(x => !x.hid));
  h += `<div class="sect"><span class="label-sm">인쇄용 파일</span>
    <div class="btn-row"><button type="button" class="chip" data-gact="export" ${anyGfx ? '' : 'disabled'}>인쇄용 PNG 받기</button></div>
    <p class="note">자리마다 실제 크기(150dpi) 투명 PNG로 받아요. 제작 주문에 그대로 쓰는 파일이에요.</p></div>`;
  queueMicrotask(refreshThumbs);
  return h;
}
function syncOuts(it) {
  document.querySelectorAll('[data-gout]').forEach(b => { const f = OUTS[b.dataset.gout]; if (f) b.textContent = f(it); });
  document.querySelectorAll('[data-gk]').forEach(el => el.style.setProperty('--p', ((el.value - el.min) / (el.max - el.min) * 100).toFixed(1) + '%'));
}
function move(list, it, d) {
  const i = list.indexOf(it), j = i + d;
  if (j < 0 || j >= list.length) return;
  list.splice(i, 1); list.splice(j, 0, it);
}
const P = $('#panel');
P.addEventListener('click', e => {
  const b = e.target.closest('[data-gadd],[data-gact],[data-garea],[data-gspot],[data-gfont],[data-gc],[data-gsc],[data-gsel]');
  if (!b || b.disabled) return;
  const d = b.dataset;
  if (d.gadd === 'txt') return addText();
  if (d.gsel && !e.target.closest('[data-gact]')) return select(d.gsel === cc.ui.gsel ? null : d.gsel);
  const slot = target(), list = items(slot);
  if (d.gact === 'export') return exportPrint();
  const it = d.gid ? list.find(x => x.id === d.gid) : selected() && selected().it;
  if (!it) return;
  if (d.gact === 'hide') it.hid = !it.hid;
  else if (d.gact === 'up') move(list, it, 1);
  else if (d.gact === 'down') move(list, it, -1);
  else if (d.gact === 'center') it.x = 0;
  else if (d.gact === 'flip') it.f = !it.f;
  else if (d.gact === 'dup') { const c = { ...it, id: uid(), x: it.x + 2, y: it.y + 2 }; list.splice(list.indexOf(it) + 1, 0, c); cc.ui.gsel = c.id; }
  else if (d.gact === 'del') { list.splice(list.indexOf(it), 1); cc.ui.gsel = null; cc.say('그래픽을 지웠어요 (되돌리기 가능)'); }
  else if (d.gact === 'recut') return openCut({ id: it.img, item: it });
  else if (d.garea) {
    if (it.a === d.garea) return;
    const A = AREAS[slot][d.garea], p = spotFor(slot, d.garea, hOf(it) / it.w);
    it.a = d.garea; it.x = p.x; it.y = p.y; it.w = Math.min(it.w, A.w);
    cc.say(A.n + '으로 옮겼어요');
  } else if (d.gspot) { const p = SPOTS[slot][it.a][+d.gspot]; it.x = p[1]; it.y = p[2] + hoodDrop(slot, it.a); it.w = p[3]; }
  else if (d.gfont) it.font = d.gfont;
  else if (d.gc) it.c = d.gc;
  else if ('gsc' in d) it.sc = d.gsc || null;
  cc.render(); cc.renderPanel(); cc.commit();
});
P.addEventListener('input', e => {
  const s = selected(), it = s && s.it;
  const k = e.target.dataset.gk;
  if (k && it) { it[k] = +e.target.value; cc.render(); syncOuts(it); return; }
  if (e.target.matches('[data-gtext]') && it) { it.s = e.target.value; cc.render(); return; }
  if (e.target.matches('[data-ghex]') && it) {
    const v = cc.parseHex(e.target.value);
    e.target.classList.toggle('bad', !v && e.target.value.trim() !== '');
    if (v) { it[e.target.dataset.ghex] = v; e.target.previousElementSibling.style.background = v; cc.render(); }
  }
});
P.addEventListener('change', e => {
  if (e.target.matches('[data-gfile]')) { const f = e.target.files[0]; e.target.value = ''; if (f) openCut(f); return; }
  if (e.target.matches('[data-gk],[data-gtext],[data-ghex]')) { cc.commit(); if (e.target.matches('[data-gtext],[data-ghex]')) cc.renderPanel(); }
});
P.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('[data-gtext],[data-ghex]')) e.target.blur(); });
const typing = el => /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && el.type !== 'range';
document.addEventListener('keydown', e => {
  if (cc.tool !== 'gfx' || typing(e.target) || e.ctrlKey || e.metaKey || e.altKey || cutOpen()) return;
  const s = selected();
  if (!s) return;
  const step = e.shiftKey ? 2 : .5, mv = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
  if (mv) { e.preventDefault(); s.it.x = r1(s.it.x + mv[0]); s.it.y = r1(s.it.y + mv[1]); cc.render(); cc.commit(); }
  else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); items(s.slot).splice(items(s.slot).indexOf(s.it), 1); cc.ui.gsel = null; cc.render(); cc.renderPanel(); cc.commit(); cc.say('그래픽을 지웠어요 (되돌리기 가능)'); }
  else if (e.key === 'Escape') select(null);
});
// pictures in: paste anywhere, or drop on the page
document.addEventListener('paste', e => {
  if (typing(e.target) || cutOpen()) return;
  const f = [...(e.clipboardData ? e.clipboardData.items : [])].find(i => i.type.startsWith('image/'));
  if (f) { e.preventDefault(); openCut(f.getAsFile()); }
});
const wrap = $('.stage-wrap');
document.addEventListener('dragover', e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); wrap.classList.add('dropping'); } });
document.addEventListener('dragleave', e => { if (!e.relatedTarget) wrap.classList.remove('dropping'); });
document.addEventListener('drop', e => {
  wrap.classList.remove('dropping');
  const f = e.dataTransfer && [...e.dataTransfer.files].find(x => x.type.startsWith('image/'));
  if (!f) return;
  e.preventDefault();
  if (!cutOpen()) openCut(f);
});

/* ---------- print files ---------- */
async function exportPrint() {
  const names = { top: '상의', bottom: '하의' };
  let n = 0;
  for (const slot of ['top', 'bottom']) {
    const g = cc.state[slot];
    if (!g) continue;
    for (const area in AREAS[slot]) {
      if (!items(slot).some(it => it.a === area && !it.hid)) continue;
      const A = AREAS[slot][area], c = canvas(A.w * PRINT_PX, A.h * PRINT_PX);
      drawArea(c.getContext('2d'), slot, area, PRINT_PX);
      const b = await toBlob(c);
      if (!b) continue;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = `고쳐입기_${names[slot]}-${cc.NAME[g.kind]}_${A.n}_${A.w}x${A.h}cm_150dpi.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      n++;
      await new Promise(r => setTimeout(r, 350));
    }
  }
  cc.say(n ? `인쇄용 파일 ${n}개를 받았어요` : '받을 그래픽이 없어요');
}

/* ---------- cut-out window ---------- */
// background removal model, run in the browser (Apache-2.0, commercial use allowed); pictures never leave the device
const TF_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0/dist/transformers.min.js';
const MODEL = { id: 'onnx-community/ormbg-ONNX', size: navigator.gpu ? '88MB' : '44MB' };
let seg = null, segLoading = null;
let X = null;   // the picture being cut out
const cutOpen = () => !!X;
const dlg = document.createElement('div');
dlg.className = 'cutx';
dlg.hidden = true;
dlg.setAttribute('role', 'dialog');
dlg.setAttribute('aria-modal', 'true');
dlg.setAttribute('aria-labelledby', 'cutx-t');
dlg.innerHTML = `<div class="cutx-box">
  <header class="cutx-head"><h2 id="cutx-t">배경 지우기</h2><span class="cutx-sub">남길 부분만 남기고 옷에 붙여요</span><button type="button" class="act" data-cx="cancel" aria-label="닫기">${SVG('<path d="m4 4 8 8M12 4l-8 8"/>')}</button></header>
  <div class="cutx-main">
    <div class="cutx-view" data-bg="check"><canvas class="cutx-cv"></canvas><div class="cutx-ring"></div><div class="cutx-busy" hidden><span class="spin"></span><b></b></div></div>
    <div class="cutx-side">
      <button type="button" class="cutx-auto" data-cx="auto">${SVG('<path d="M8 1.5 9.3 5l3.7.2-2.9 2.3 1 3.6L8 9l-3.1 2.1 1-3.6L3 5.2 6.7 5z"/>')}<span><b>배경 자동으로 지우기</b><i>사람·캐릭터·물건을 찾아서 남겨요</i></span></button>
      <p class="note cutx-msg" data-cxmsg>처음 한 번은 AI 모델(약 ${MODEL.size})을 내려받아요. 이미지는 내 기기 밖으로 나가지 않아요.</p>
      <span class="label-sm">손으로 다듬기</span>
      <div class="seg2" role="group" aria-label="다듬기 도구"><button type="button" class="chip" data-cxt="wand">마술봉</button><button type="button" class="chip" data-cxt="erase">지우개</button><button type="button" class="chip" data-cxt="keep">되살리기</button></div>
      <div data-cxpane="wand"><p class="note" style="margin:0 0 10px">지울 배경을 누르면 비슷한 색이 한 번에 지워져요.</p>
        <label class="row"><span class="lab">비슷한 색 범위<b data-cxout="tol"></b></span><input type="range" data-cxk="tol" min="2" max="90" step="1"></label>
        <div class="seg2" role="group" aria-label="마술봉 범위"><button type="button" class="chip" data-cxc="1">이어진 곳만</button><button type="button" class="chip" data-cxc="0">같은 색 전부</button></div></div>
      <div data-cxpane="brush" hidden><p class="note" style="margin:0 0 10px">문지르면 지워지거나(지우개) 원래대로 돌아와요(되살리기).</p>
        <label class="row"><span class="lab">붓 크기<b data-cxout="size"></b></span><input type="range" data-cxk="size" min="0.5" max="12" step="0.5"></label></div>
      <span class="label-sm">마무리</span>
      <label class="row"><span class="lab">가장자리 부드럽게<b data-cxout="feather"></b></span><input type="range" data-cxk="feather" min="0" max="4" step="0.5"></label>
      <span class="label-sm" style="margin-top:6px">스티커 테두리</span>
      <div class="chips" style="margin-bottom:10px"><button type="button" class="chip" data-cxo="">없음</button><button type="button" class="chip" data-cxo="#ffffff"><i class="dotc" style="background:#fff"></i>흰색</button><button type="button" class="chip" data-cxo="#161616"><i class="dotc" style="background:#161616"></i>검정</button><label class="chip cpick"><input type="color" data-cxcol value="#e8673f" aria-label="테두리 색 고르기"><i class="dotc" data-cxcolv></i>색 고르기</label></div>
      <label class="row" data-cxow><span class="lab">테두리 두께<b data-cxout="ow"></b></span><input type="range" data-cxk="ow" min="2" max="40" step="1"></label>
      <span class="label-sm" style="margin-top:6px">미리보기 바탕</span>
      <div class="seg2" role="group" aria-label="미리보기 바탕"><button type="button" class="chip" data-cxbg="check">투명</button><button type="button" class="chip" data-cxbg="light">흰 옷</button><button type="button" class="chip" data-cxbg="dark">검은 옷</button></div>
      <div class="btn-row"><button type="button" class="chip" data-cx="undo">되돌리기</button><button type="button" class="chip" data-cx="reset">처음 상태로</button></div>
    </div>
  </div>
  <footer class="cutx-foot"><span class="note" data-cxsize></span><button type="button" class="chip" data-cx="cancel">취소</button><button type="button" class="primary" data-cx="done"><span class="t">옷에 붙이기</span></button></footer>
</div>`;
document.body.appendChild(dlg);
const cv = dlg.querySelector('.cutx-cv'), view = dlg.querySelector('.cutx-view'), ring = dlg.querySelector('.cutx-ring'), busy = dlg.querySelector('.cutx-busy');
const cxMsg = t => { dlg.querySelector('[data-cxmsg]').textContent = t; };
const CXOUT = { tol: v => v, size: v => v + '%', feather: v => v ? v + 'px' : '없음', ow: v => v };

async function readFile(file) {
  const el = await createImageBitmap(file);
  const k = Math.min(1, MAX_SIDE / Math.max(el.width, el.height)), c = canvas(el.width * k, el.height * k);
  c.getContext('2d').drawImage(el, 0, 0, c.width, c.height);
  return c;
}
async function blobCanvas(blob) { const el = await createImageBitmap(blob), c = canvas(el.width, el.height); c.getContext('2d').drawImage(el, 0, 0); return c; }
async function openCut(arg) {
  let src, mask = null, opts = {};
  try {
    if (arg instanceof Blob) src = await readFile(arg);
    else {   // again, from the picture's saved original and mask
      const rec = await getRec(arg.id);
      if (rec && rec.src) { src = await blobCanvas(rec.src); if (rec.mask) mask = await blobCanvas(rec.mask); opts = rec.opts || {}; }
      else { const el = picture(arg.id); if (!el) return cc.say('이미지를 불러오는 중이에요. 잠시 뒤 다시 눌러 주세요'); src = canvas(el.width, el.height); src.getContext('2d').drawImage(el, 0, 0); }
    }
  } catch (e) { return cc.say('이미지를 열 수 없어요'); }
  const W = src.width, H = src.height, sx = src.getContext('2d', { willReadFrequently: true });
  const m = canvas(W, H), mx = m.getContext('2d', { willReadFrequently: true });
  if (mask) mx.drawImage(mask, 0, 0, W, H); else { mx.fillStyle = '#fff'; mx.fillRect(0, 0, W, H); }
  const data = sx.getImageData(0, 0, W, H).data;
  let clear = 0;
  for (let i = 3; i < data.length; i += 16) if (data[i] < 200) clear++;
  X = {
    src, data, W, H, m, mx, undo: [], item: arg instanceof Blob ? null : arg.item,
    tool: 'wand', tol: 26, contig: true, size: 3, feather: opts.feather ?? 1, outline: opts.outline ?? null, ow: opts.ow ?? 14, bg: 'check',
  };
  X.alreadyClear = clear / (data.length / 16) > .05;
  dlg.hidden = false;
  document.body.classList.add('modal-open');
  cxMsg(X.alreadyClear ? '이미 배경이 투명한 이미지예요. 그대로 붙여도 되고, 더 다듬어도 돼요.' : `처음 한 번은 AI 모델(약 ${MODEL.size})을 내려받아요. 이미지는 내 기기 밖으로 나가지 않아요.`);
  dlg.querySelector('[data-cxsize]').textContent = `${W} × ${H}px`;
  syncCut(); preview();
  dlg.querySelector('[data-cx="auto"]').focus();
}
function closeCut() { X = null; dlg.hidden = true; document.body.classList.remove('modal-open'); busy.hidden = true; }
function syncCut() {
  dlg.querySelectorAll('[data-cxt]').forEach(b => b.setAttribute('aria-pressed', b.dataset.cxt === X.tool));
  dlg.querySelector('[data-cxpane="wand"]').hidden = X.tool !== 'wand';
  dlg.querySelector('[data-cxpane="brush"]').hidden = X.tool === 'wand';
  dlg.querySelectorAll('[data-cxc]').forEach(b => b.setAttribute('aria-pressed', (b.dataset.cxc === '1') === X.contig));
  dlg.querySelectorAll('[data-cxbg]').forEach(b => b.setAttribute('aria-pressed', b.dataset.cxbg === X.bg));
  dlg.querySelectorAll('[data-cxo]').forEach(b => b.setAttribute('aria-pressed', (b.dataset.cxo || null) === X.outline));
  const custom = X.outline && !['#ffffff', '#161616'].includes(X.outline);
  dlg.querySelector('.cpick').setAttribute('aria-pressed', !!custom);
  dlg.querySelector('[data-cxcolv]').style.background = custom ? X.outline : 'conic-gradient(#e8673f,#f2c94c,#5fbf7a,#4a90d9,#a46bd6,#e8673f)';
  dlg.querySelector('[data-cxow]').hidden = !X.outline;
  dlg.querySelectorAll('[data-cxk]').forEach(el => {
    el.value = X[el.dataset.cxk];
    el.style.setProperty('--p', ((el.value - el.min) / (el.max - el.min) * 100).toFixed(1) + '%');
    const o = dlg.querySelector(`[data-cxout="${el.dataset.cxk}"]`);
    if (o) o.textContent = CXOUT[el.dataset.cxk](X[el.dataset.cxk]);
  });
  view.dataset.bg = X.bg;
  view.dataset.tool = X.tool;
}
// the cut picture: the original through the mask (soft edge), cropped to what is left, sticker outline round it
function cutResult(scale, crop) {
  const W = Math.round(X.W * scale), H = Math.round(X.H * scale), c = canvas(W, H), x = c.getContext('2d');
  x.drawImage(X.src, 0, 0, W, H);
  x.globalCompositeOperation = 'destination-in';
  if (X.feather) x.filter = `blur(${X.feather * scale * Math.max(1, X.W / 900)}px)`;
  x.drawImage(X.m, 0, 0, W, H);
  x.filter = 'none';
  x.globalCompositeOperation = 'source-over';
  let out = c, bx = [0, 0, W, H];
  if (crop) {
    const d = x.getImageData(0, 0, W, H).data;
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) for (let xx = 0; xx < W; xx++) if (d[(y * W + xx) * 4 + 3] > 8) { if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) return null;
    bx = [x0, y0, x1 - x0 + 1, y1 - y0 + 1];
    out = canvas(bx[2], bx[3]);
    out.getContext('2d').drawImage(c, -x0, -y0);
  }
  if (!X.outline) return out;
  const r = X.ow / 1000 * Math.max(X.W, X.H) * scale, p = Math.ceil(r) + 2;
  const sil = canvas(out.width, out.height), s = sil.getContext('2d');
  s.drawImage(out, 0, 0);
  s.globalCompositeOperation = 'source-in';
  s.fillStyle = X.outline; s.fillRect(0, 0, sil.width, sil.height);
  const o = canvas(out.width + p * 2, out.height + p * 2), ox = o.getContext('2d');
  const n = clamp(Math.round(r * 1.5), 12, 40);
  for (const rr of [r, r * .66, r * .33]) for (let i = 0; i < n; i++) {
    const a = i / n * PI * 2;
    ox.drawImage(sil, p + Math.cos(a) * rr, p + Math.sin(a) * rr);
  }
  ox.drawImage(sil, p, p);
  ox.drawImage(out, p, p);
  return o;
}
let pvRaf = 0;
function preview() {
  if (pvRaf) return;
  pvRaf = requestAnimationFrame(() => {
    pvRaf = 0;
    if (!X) return;
    const k = Math.min(1, 900 / Math.max(X.W, X.H)), r = cutResult(k, false);
    const pad = X.outline ? Math.ceil(X.ow / 1000 * Math.max(X.W, X.H) * k) + 2 : 0;
    cv.width = Math.round(X.W * k) + pad * 2; cv.height = Math.round(X.H * k) + pad * 2;
    X.vk = k; X.vpad = pad;
    const x = cv.getContext('2d');
    x.clearRect(0, 0, cv.width, cv.height);
    x.drawImage(r, X.outline ? 0 : 0, 0);
  });
}
function pushUndo() {
  const d = X.mx.getImageData(0, 0, X.W, X.H).data, a = new Uint8Array(X.W * X.H);
  for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3];
  X.undo.push(a);
  if (X.undo.length > 12) X.undo.shift();
}
function putMask(a) {
  const img = X.mx.createImageData(X.W, X.H), d = img.data;
  for (let i = 0; i < a.length; i++) { const j = i * 4; d[j] = d[j + 1] = d[j + 2] = 255; d[j + 3] = a[i]; }
  X.mx.putImageData(img, 0, 0);
}
// magic wand: clear the picture's pixels close in colour to the one pressed (joined to it, or anywhere)
function wand(px, py) {
  const { W, H, data } = X, i0 = py * W + px;
  if (data[i0 * 4 + 3] < 10) return;
  pushUndo();
  const md = X.mx.getImageData(0, 0, W, H), m = md.data;
  const r0 = data[i0 * 4], g0 = data[i0 * 4 + 1], b0 = data[i0 * 4 + 2], t = (X.tol * 2.6) ** 2, soft = (X.tol * 3.4) ** 2;
  const dist = i => { const j = i * 4, dr = data[j] - r0, dg = data[j + 1] - g0, db = data[j + 2] - b0; return dr * dr + dg * dg + db * db; };
  const clearPx = (i, d) => { const k = d <= t ? 0 : Math.round(255 * (d - t) / (soft - t)); m[i * 4 + 3] = Math.min(m[i * 4 + 3], k); };
  if (!X.contig) {
    for (let i = 0; i < W * H; i++) { const d = dist(i); if (d < soft) clearPx(i, d); }
  } else {
    const seen = new Uint8Array(W * H), st = new Int32Array(W * H);
    let n = 0;
    st[n++] = i0; seen[i0] = 1;
    while (n) {
      const i = st[--n], d = dist(i);
      clearPx(i, d);
      if (d > t) continue;   // the soft rim is cleared part-way, but the fill doesn't spread past it
      const x = i % W, y = (i - x) / W;
      if (x > 0 && !seen[i - 1]) { seen[i - 1] = 1; st[n++] = i - 1; }
      if (x < W - 1 && !seen[i + 1]) { seen[i + 1] = 1; st[n++] = i + 1; }
      if (y > 0 && !seen[i - W]) { seen[i - W] = 1; st[n++] = i - W; }
      if (y < H - 1 && !seen[i + W]) { seen[i + W] = 1; st[n++] = i + W; }
    }
  }
  X.mx.putImageData(md, 0, 0);
  preview();
}
function dab(a, b) {
  const x = X.mx, r = X.size / 100 * Math.max(X.W, X.H);
  x.save();
  x.globalCompositeOperation = X.tool === 'erase' ? 'destination-out' : 'source-over';
  x.strokeStyle = x.fillStyle = '#fff';
  x.lineWidth = r * 2; x.lineCap = 'round';
  x.beginPath(); x.moveTo(a[0], a[1]); x.lineTo(b[0], b[1]); x.stroke();
  x.restore();
  preview();
}
const imgPt = e => {
  const r = cv.getBoundingClientRect(), k = X.vk;
  return [((e.clientX - r.left) / r.width * cv.width - X.vpad) / k, ((e.clientY - r.top) / r.height * cv.height - X.vpad) / k];
};
let cdrag = null;
cv.addEventListener('pointerdown', e => {
  if (!X || e.button > 0) return;
  e.preventDefault();
  const p = imgPt(e);
  if (X.tool === 'wand') {
    const px = Math.floor(p[0]), py = Math.floor(p[1]);
    if (px >= 0 && py >= 0 && px < X.W && py < X.H) wand(px, py);
    return;
  }
  pushUndo();
  cdrag = p; dab(p, p);
  cv.setPointerCapture(e.pointerId);
});
cv.addEventListener('pointermove', e => {
  if (!X) return;
  if (X.tool !== 'wand') {
    const r = cv.getBoundingClientRect(), vr = view.getBoundingClientRect(), d = X.size / 100 * Math.max(X.W, X.H) * X.vk / cv.width * r.width * 2;
    ring.style.width = ring.style.height = d + 'px';
    ring.style.transform = `translate(${e.clientX - vr.left - d / 2}px, ${e.clientY - vr.top - d / 2}px)`;
    ring.classList.add('show');
  }
  if (!cdrag) return;
  const p = imgPt(e);
  dab(cdrag, p); cdrag = p;
});
const cend = () => { cdrag = null; };
cv.addEventListener('pointerup', cend);
cv.addEventListener('pointercancel', cend);
cv.addEventListener('pointerleave', () => ring.classList.remove('show'));

async function autoCut() {
  if (segLoading) return;
  busy.hidden = false;
  const say = t => { busy.querySelector('b').textContent = t; };
  say('AI 모델을 준비하는 중…');
  try {
    const T = await import(TF_URL);
    if (!seg) {
      const files = {};
      segLoading = T.pipeline('background-removal', MODEL.id, {
        device: navigator.gpu ? 'webgpu' : 'wasm', dtype: navigator.gpu ? 'fp16' : 'uint8',
        progress_callback: p => {
          if (p.status !== 'progress' || !p.total) return;
          files[p.file] = [p.loaded, p.total];
          const v = Object.values(files), l = v.reduce((a, b) => a + b[0], 0), t = v.reduce((a, b) => a + b[1], 0);
          say(`AI 모델 내려받는 중 ${Math.round(l / t * 100)}%`);
        },
      }).catch(async e => {   // WebGPU can fail on some machines: fall back to the CPU
        if (!navigator.gpu) throw e;
        return T.pipeline('background-removal', MODEL.id, { device: 'wasm', dtype: 'uint8' });
      });
      seg = await segLoading;
    }
    if (!X) return;
    say('배경을 지우는 중…');
    const res = await seg(T.RawImage.fromCanvas(X.src)), oc = (Array.isArray(res) ? res[0] : res).toCanvas();
    if (!X) return;
    pushUndo();
    X.mx.save();
    X.mx.globalCompositeOperation = 'copy';
    X.mx.drawImage(oc, 0, 0, X.W, X.H);
    X.mx.restore();
    preview();
    cxMsg('배경을 지웠어요. 남은 곳은 마술봉이나 지우개로, 잘못 지워진 곳은 되살리기로 다듬어요.');
  } catch (e) {
    console.error(e);
    cxMsg('자동으로 지우지 못했어요. 마술봉으로 배경을 눌러 지워 보세요.');
  } finally { segLoading = null; busy.hidden = true; }
}
async function doneCut() {
  const out = cutResult(1, true);
  if (!out) return cc.say('남은 부분이 없어요. 되돌리기로 돌아가 보세요');
  busy.hidden = false; busy.querySelector('b').textContent = '옷에 붙이는 중…';
  const id = 'img' + Date.now().toString(36);
  const webp = await toBlob(X.src, 'image/webp', .92);
  const rec = {
    out: await toBlob(out), mask: await toBlob(X.m), src: webp && webp.type === 'image/webp' ? webp : await toBlob(X.src),
    opts: { feather: X.feather, outline: X.outline, ow: X.ow },
  };
  await putRec(id, rec);
  IMG[id] = { el: await createImageBitmap(rec.out) };
  const ar = out.height / out.width, it = X.item;
  closeCut();
  if (it) {   // re-cut: a new picture id, so undo can still bring back the old one
    it.img = id; it.ar = ar;
    cc.render(); cc.renderPanel(); cc.commit(); cc.say('배경을 다시 다듬었어요');
  } else addPicture(id, ar);
}
dlg.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!X || !b) return;
  const d = b.dataset;
  if (d.cx === 'cancel') return closeCut();
  if (d.cx === 'done') return doneCut();
  if (d.cx === 'auto') return autoCut();
  if (d.cx === 'undo') { const a = X.undo.pop(); if (a) { putMask(a); preview(); } return; }
  if (d.cx === 'reset') { pushUndo(); X.mx.globalCompositeOperation = 'source-over'; X.mx.fillStyle = '#fff'; X.mx.fillRect(0, 0, X.W, X.H); preview(); return; }
  if (d.cxt) X.tool = d.cxt;
  else if (d.cxc) X.contig = d.cxc === '1';
  else if (d.cxbg) X.bg = d.cxbg;
  else if ('cxo' in d) X.outline = d.cxo || null;
  else return;
  syncCut(); preview();
});
dlg.addEventListener('input', e => {
  if (!X) return;
  const k = e.target.dataset.cxk;
  if (k) { X[k] = +e.target.value; syncCut(); if (k !== 'tol' && k !== 'size') preview(); return; }
  if (e.target.matches('[data-cxcol]')) { X.outline = e.target.value; syncCut(); preview(); }
});
dlg.addEventListener('keydown', e => {
  if (e.key === 'Escape') { e.stopPropagation(); closeCut(); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.stopPropagation(); const a = X && X.undo.pop(); if (a) { putMask(a); preview(); } }
});

/* ---------- start ---------- */
(async () => {
  // pictures saved before IndexedDB move over, then pictures no layer uses any more are dropped
  for (const [id, url] of Object.entries(cc.images)) {
    try { const blob = await (await fetch(url)).blob(); await putRec(id, { out: blob }); delete cc.images[id]; } catch (e) { /* keep it where it was */ }
  }
  cc.save();
  try {
    const used = new Set(['top', 'bottom'].flatMap(s => items(s).map(it => it.img).filter(Boolean)));
    for (const k of await idb('readonly', s => s.getAllKeys())) if (!used.has(k)) idb('readwrite', s => s.delete(k));
  } catch (e) { /* no IndexedDB */ }
})();

window.__gfx = {
  AREAS, panel, canvases, flat, select, selected, items, hOf, open: openCut,
  hitTest(slot, area, x, y) {   // the top-most layer under a point of a print area (cm)
    const list = items(slot);
    for (let i = list.length - 1; i >= 0; i--) {
      const it = list[i];
      if (it.a !== area || it.hid) continue;
      const a = -(it.r || 0) * PI / 180, dx = x - it.x, dy = y - it.y;
      const lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a);
      if (Math.abs(lx) <= it.w / 2 + .5 && Math.abs(ly) <= hOf(it) / 2 + .5) return it;
    }
    return null;
  },
  sync() { const s = selected(); if (s) syncOuts(s.it); },
};
if (cc.tool === 'gfx') cc.renderPanel();
cc.render();
