// 한글 놀이터 겹침·넘침 전수조사 (Playwright)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE || 'http://127.0.0.1:8765/play/';   // 저장소 루트에서: python3 -m http.server 8765
const OUT = path.join(__dirname, 'audit-out');   // 결과: findings.json + shots/ (git에 넣지 않음)
fs.mkdirSync(path.join(OUT, 'shots'), { recursive: true });

const APPS = {
  받침놀이: '받침놀이/outputs/받침놀이.html?guest=1',
  자모놀이: '자모놀이/outputs/자모놀이.html?guest=1',
  낱말놀이: '낱말놀이/outputs/낱말놀이.html?guest=1',
  단어카드: '단어카드/outputs/단어카드.html?guest=1',
  낱말잇기: '낱말잇기/outputs/낱말잇기.html?guest=1',
};
const VARIANTS = [
  { name: 'board915', w: 915, h: 495, scale: 1 },
  { name: 'board915-big', w: 915, h: 495, scale: 1.3 },
  { name: 'tab1280', w: 1280, h: 800, scale: 1 },
  { name: 'phone390', w: 390, h: 844, scale: 1 },
];
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const VONLY = process.env.VONLY ? process.env.VONLY.split(',') : null;

// ---------- 페이지 안에서 도는 측정 함수 ----------
const AUDIT_FN = `
window.__audit = function (label) {
  const vw = innerWidth, vh = innerHeight;
  const bodyScroll = getComputedStyle(document.body).overflowY === 'auto' || getComputedStyle(document.body).overflowY === 'scroll';
  let roots = [...document.querySelectorAll('#celebrate.active, .modal.active, #overlay.on, #bankModal.open, #teacherMenu.open')];
  if (!roots.length) roots = [...document.querySelectorAll('.screen.active, #navbar, #turnToast.on')];
  const atoms = [];
  function textRect(el) {
    let r = null;
    for (const n of el.childNodes) {
      if (n.nodeType !== 3 || !n.textContent.trim()) continue;
      const rg = document.createRange(); rg.selectNodeContents(n);
      for (const rr of rg.getClientRects()) {
        if (rr.width <= 0 || rr.height <= 0) continue;
        r = r ? { left: Math.min(r.left, rr.left), top: Math.min(r.top, rr.top), right: Math.max(r.right, rr.right), bottom: Math.max(r.bottom, rr.bottom) } : { left: rr.left, top: rr.top, right: rr.right, bottom: rr.bottom };
      }
    }
    return r;
  }
  function desc(el) {
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    if (el.classList.length) s += '.' + [...el.classList].filter(c => !['active','on','now','done','cur','filled','right','wrong','hint','speaking','multi','link','pop','good','bad','used','no','old','show','open','two','choosing'].includes(c)).join('.');
    const t = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join('').slice(0, 14);
    if (t) s += ' "' + t + '"';
    else if (el.tagName === 'IMG') s += ' [img ' + (el.alt || '').slice(0, 10) + ']';
    return s;
  }
  function walk(el) {
    if (!(el instanceof Element)) return;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return;
    const tag = el.tagName.toLowerCase();
    if (tag === 'style' || tag === 'script') return;
    const br = el.getBoundingClientRect();
    const hasText = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
    if (br.width > 0 && br.height > 0) {
      if (tag === 'img' || tag === 'canvas') atoms.push({ el, r: { left: br.left, top: br.top, right: br.right, bottom: br.bottom }, kind: tag, d: desc(el) });
      else if (hasText) { const tr = textRect(el); if (tr) atoms.push({ el, r: tr, kind: 'text', d: desc(el) }); }
    }
    for (const c of el.children) walk(c);
  }
  roots.forEach(walk);
  const out = [];
  const area = r => Math.max(0, r.right - r.left) * Math.max(0, r.bottom - r.top);
  // 1) 쌍 겹침
  for (let i = 0; i < atoms.length; i++) for (let j = i + 1; j < atoms.length; j++) {
    const a = atoms[i], b = atoms[j];
    if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
    const ix = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
    const iy = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
    if (ix > 3 && iy > 3 && ix * iy > 0.08 * Math.min(area(a.r), area(b.r))) {
      out.push({ label, type: 'overlap', a: a.d, b: b.d, ix: Math.round(ix), iy: Math.round(iy) });
    }
  }
  // 2) 상자 밖으로 넘침
  function boxOf(el) {
    let p = el.parentElement;
    while (p && p !== document.body) {
      const cs = getComputedStyle(p);
      const bw = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderLeftWidth);
      const bg = cs.backgroundColor;
      const hasBg = bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent';
      if (!p.classList.contains('screen') && (bw > 0 || hasBg || cs.overflow !== 'visible' || cs.overflowX !== 'visible')) return p;
      p = p.parentElement;
    }
    return null;
  }
  for (const a of atoms) {
    const box = boxOf(a.el);
    if (box) {
      const b = box.getBoundingClientRect();
      const bcs = getComputedStyle(box);
      const sx = /auto|scroll/.test(bcs.overflowX) || /auto|scroll/.test(bcs.overflow), sy = /auto|scroll/.test(bcs.overflowY) || /auto|scroll/.test(bcs.overflow);
      const ov = { l: sx ? 0 : b.left - a.r.left, r: sx ? 0 : a.r.right - b.right, t: sy ? 0 : b.top - a.r.top, b: sy ? 0 : a.r.bottom - b.bottom };
      const m = Math.max(ov.l, ov.r, ov.t, ov.b);
      if (m > 2) out.push({ label, type: 'overflow', a: a.d, b: desc(box), px: Math.round(m), side: Object.keys(ov).filter(k => ov[k] > 2).join('') });
    }
    // 3) 화면 밖
    const scrollAnc = (() => { let p = a.el.parentElement; while (p && p !== document.body) { const cs = getComputedStyle(p); if (/auto|scroll/.test(cs.overflowX) || /auto|scroll/.test(cs.overflowY)) return p; p = p.parentElement; } return null; })();
    const outX = a.r.right > vw + 1 || a.r.left < -1;
    const outY = !bodyScroll && (a.r.bottom > vh + 1 || a.r.top < -1);
    if ((outX || outY) && !scrollAnc) out.push({ label, type: 'offscreen', a: a.d, px: Math.round(Math.max(a.r.right - vw, -a.r.left, outY ? a.r.bottom - vh : 0, outY ? -a.r.top : 0)), side: (outX ? 'x' : '') + (outY ? 'y' : '') });
    else if ((outX || outY) && scrollAnc) out.push({ label, type: 'scrolled', a: a.d, b: desc(scrollAnc), px: Math.round(Math.max(a.r.right - vw, -a.r.left, a.r.bottom - vh)) });
  }
  return out;
};
`;

async function settle(page, ms = 0) {
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  if (ms) await page.waitForTimeout(ms);
}

const findings = [];
const shotTaken = new Set();
async function audit(page, ctx, label) {
  await settle(page);
  const res = await page.evaluate(l => window.__audit(l), label);
  for (const f of res) {
    f.app = ctx.app; f.variant = ctx.variant;
    findings.push(f);
  }
  // 대표 스크린샷: (앱, 변형, 유형, a, b)별 첫 사례
  for (const f of res) {
    const key = [ctx.app, ctx.variant, f.type, f.a.replace(/".*"/, ''), (f.b || '').replace(/".*"/, '')].join('|');
    if (shotTaken.has(key) || shotTaken.size > 400) continue;
    shotTaken.add(key);
    const file = `${ctx.app}_${ctx.variant}_${label}`.replace(/[^\w가-힣ㄱ-ㅎㅏ-ㅣ.\-]/g, '_').slice(0, 120) + '.png';
    const p = path.join(OUT, 'shots', file);
    if (!fs.existsSync(p)) { try { await page.screenshot({ path: p }); } catch (e) {} }
    f.shot = file;
  }
}

// ---------- 앱별 드라이버 ----------
const DRIVERS = {
  async 받침놀이(page, ctx) {
    for (const t of ['h', 's', 'g']) { await page.evaluate(t => { homeTab = t; show('home'); }, t); await audit(page, ctx, `home/${t}`); }
    const units = await page.evaluate(() => UNITS.map(u => u.ch));
    for (const ch of units) {
      await page.evaluate(ch => openLearn(ch), ch); await audit(page, ctx, `learn/${ch}`);
      // 🎲 랜덤이 보여줄 수 있는 그림창고 낱말까지 3장씩
      const chunks = await page.evaluate(ch => {
        const all = [...new Set([...unitWords(ch), ...Object.keys(PICBANK).filter(w => batOf(w) === ch)])];
        const out = []; for (let i = 0; i < all.length; i += 3) out.push(all.slice(i, i + 3)); return out;
      }, ch);
      for (const c of chunks) { await page.evaluate(c => renderLearnCards(c), c); await audit(page, ctx, `learn-bank/${ch}/${c.join('·')}`); }
      const words = await page.evaluate(ch => unitWords(ch), ch);
      for (const w of words) {
        for (const mode of ['yn', 'pair', 'fill']) {
          await page.evaluate(([ch, w, mode]) => {
            quiz = { ch, mode, round: mode === 'pair' ? 2 : 0, correct: 0, target: null, rounds: 3, targets: [w, w, w] };
            show('quiz');
            document.getElementById('quizTitle').textContent = mode === 'yn' ? '있다 없다' : mode === 'pair' ? '맞는 낱말 찾기' : '받침 넣기';
            renderStage('stageQuiz', mode === 'yn' ? 2 : mode === 'pair' ? 3 : 4); renderProgress(); nextRound();
          }, [ch, w, mode]);
          await audit(page, ctx, `${mode}/${w}`);
        }
      }
      await page.evaluate(ch => { const pool = [...new Set(UNITS.flatMap(u => unitWords(u.ch)))]; startQuiz(ch, 'review', pool); }, ch); await audit(page, ctx, `review/${ch}`);
      await page.evaluate(ch => startWriting(ch), ch); await audit(page, ctx, `write/${ch}`);
    }
    await commonScreens(page, ctx, { celebrate: `celebrateDone('ㅁ', '받침 ㅁ 성공! 🎉')` });
  },
  async 자모놀이(page, ctx) {
    for (const t of ['v1', 'c1', 'c2', 'v2', 'v3']) { await page.evaluate(t => { homeTab = t; show('home'); }, t); await audit(page, ctx, `home/${t}`); }
    const chs = await page.evaluate(() => JAMO.map(j => j.ch));
    for (const ch of chs) {
      await page.evaluate(ch => openLearn(ch), ch); await audit(page, ctx, `learn/${ch}`);
      for (const mode of ['same', 'sound']) {
        await page.evaluate(([ch, mode]) => { quiz = { ch, mode, round: 2, correct: 0, target: ch, rounds: 5 }; show('quiz'); document.getElementById('quizTitle').textContent = mode; renderStage('stageQuiz', mode === 'same' ? 2 : 3); renderProgress(); nextRound(); }, [ch, mode]);
        await audit(page, ctx, `${mode}/${ch}`);
      }
      const comp = await page.evaluate(ch => composable(byCh[ch]), ch);
      if (comp) { await page.evaluate(ch => startQuiz(ch, 'build'), ch); await audit(page, ctx, `build/${ch}`); }
      await page.evaluate(ch => startWriting(ch), ch); await audit(page, ctx, `write/${ch}`);
    }
    await page.evaluate(() => startQuiz('ㄱ', 'review', JAMO.map(j => j.ch))); await audit(page, ctx, 'review');
    await commonScreens(page, ctx, { celebrate: `celebrateDone('ㄱ', '기역 성공! 🎉')` });
  },
  async 낱말놀이(page, ctx) {
    for (const t of ['body', 'animal', 'thing', 'nature']) { await page.evaluate(t => { homeTab = t; show('home'); }, t); await audit(page, ctx, `home/${t}`); }
    const ws = await page.evaluate(() => ALLW.map(x => x.w));
    for (const w of ws) {
      await page.evaluate(w => openLearn(w), w); await audit(page, ctx, `learn/${w}`);
      for (const mode of ['pic', 'read']) {
        await page.evaluate(([w, mode]) => { quiz = { w, mode, round: 2, correct: 0, target: w, rounds: 5 }; show('quiz'); renderStage('stageQuiz', mode === 'pic' ? 2 : 3); renderProgress(); nextRound(); }, [w, mode]);
        await audit(page, ctx, `${mode}/${w}`);
      }
    }
    await page.evaluate(() => { quiz = { w: '어머니', mode: 'read', round: 2, correct: 0, target: '어머니', rounds: 5 }; show('quiz'); renderStage('stageQuiz', 3); renderProgress(); nextRound(); [...document.querySelectorAll('#quizChoices .cword')].forEach((e, i) => e.textContent = ['어머니', '다람쥐', '지우개'][i]); });
    await audit(page, ctx, 'read-worst/3음절×3');
    await page.evaluate(() => startQuiz('아기', 'review', ALLW.map(x => x.w))); await audit(page, ctx, 'review');
    await commonScreens(page, ctx, { celebrate: `celebrateDone('아기', '아기 성공! 🎉')` });
  },
  async 단어카드(page, ctx) {
    const groups = await page.evaluate(() => GROUPS);
    for (const g of groups) { await page.evaluate(g => { homeTab = g; show('home'); }, g); await audit(page, ctx, `home/${g}`); }
    const ws = await page.evaluate(() => ALLW.map(x => x.w));
    for (const w of ws) {
      await page.evaluate(w => openLearn(w), w); await audit(page, ctx, `learn/${w}`);
      await page.evaluate(w => startPuzzle(w), w); await audit(page, ctx, `puzzle/${w}`);
      await page.evaluate(w => startColoring(w), w); await settle(page, 60); await audit(page, ctx, `color/${w}`);
    }
    await page.evaluate(() => { const pool = ALLW.map(x => x.w); review = { w: pool[0], pool, round: 0, correct: 0, targets: pool.slice(0, 5), rounds: 5 }; show('review'); renderStage('stageReview', 4); rvProgress(); rvRound(); });
    await audit(page, ctx, 'review');
    await commonScreens(page, ctx, { celebrate: `celebrateDone('가구', '가구 성공! 🎉')` });
  },
  async 낱말잇기(page, ctx) {
    await page.evaluate(() => { showScreen('scr-home'); setLevel('ga'); setPage = 0; renderHome(); }); await audit(page, ctx, 'home/ga/1');
    await page.evaluate(() => { setPage = 1; renderHome(); }); await audit(page, ctx, 'home/ga/2');
    await page.evaluate(() => setLevel('na')); await audit(page, ctx, 'home/na');
    await page.evaluate(() => setLevel('da')); await audit(page, ctx, 'home/da');
    const sets = await page.evaluate(() => SETS.map(s => s.words));
    for (let i = 0; i < sets.length; i++) {
      await page.evaluate(i => startSet(i), i);
      for (let wi = 0; wi < sets[i].length; wi++) {
        await page.evaluate(wi => { cur.wi = wi; startWord(); }, wi);
        await audit(page, ctx, `ga/${sets[i][0]}/${wi}-${sets[i][wi]}`);
        // 받침 단계(끝소리 고르기)까지
        await page.evaluate(() => { const w = cur.words[cur.wi]; const i = cur.wi > 0 ? 1 : 0; const t = decompose(w[i]); cur.si = i; cur.built[i] = { cho: t.cho, jung: t.jung, jong: null }; cur.part = t.jong ? 'jong' : 'jung'; renderSlots(); renderTray(); });
        await audit(page, ctx, `ga-mid/${sets[i][0]}/${wi}-${sets[i][wi]}`);
      }
      await page.evaluate(() => setDone()); await audit(page, ctx, `done/${sets[i][0]}`);
      await page.evaluate(() => document.getElementById('overlay').classList.remove('on'));
    }
    const starts = await page.evaluate(() => NA_WORDS.filter(w => planChain(w).length >= 4).slice(0, 12));
    for (const w of starts) { await page.evaluate(w => startNa(w), w); await audit(page, ctx, `na/${w}`); }
    // 나 단계: 기차가 4칸 찬 상태의 고르기 화면
    await page.evaluate(w => { startNa(w); const plan = planChain(w); cur.words = plan.slice(0, 4); cur.wi = 4; chooseNext(); }, starts[0]); await audit(page, ctx, `na-long/${starts[0]}`);
    for (const big of [false, true]) {
      await page.evaluate(big => { OPT.daBig = big; startDa(1); }, big); await settle(page, 50); await audit(page, ctx, `da/1p/${big ? '9x9' : '7x7'}`);
      await page.evaluate(() => startDa(2, true)); await settle(page, 1500); await audit(page, ctx, `da/2p/${big ? '9x9' : '7x7'}`);
    }
    await page.evaluate(() => { OPT.daBig = false; document.getElementById('pairModal').classList.add('active'); }); await audit(page, ctx, 'pairModal');
    await page.evaluate(() => document.getElementById('pairModal').classList.remove('active'));
    await commonScreens(page, ctx, { chain: true });
  },
};

async function commonScreens(page, ctx, opt = {}) {
  if (opt.chain) await page.evaluate(() => showScreen('scr-student')); else await page.evaluate(() => show('student'));
  await audit(page, ctx, 'student');
  if (!opt.chain) {
    await page.evaluate(() => show('stickers')); await audit(page, ctx, 'stickers');
    await page.evaluate(() => show('edit')); await audit(page, ctx, 'edit');
    if (await page.evaluate(() => !!document.getElementById('bankModal'))) {
      await page.evaluate(() => { try { renderBank(); } catch (e) {} document.getElementById('bankModal').classList.add('open'); }); await audit(page, ctx, 'bank');
      await page.evaluate(() => document.getElementById('bankModal').classList.remove('open'));
    }
  }
  await page.evaluate(() => document.getElementById('teacherMenu').classList.add('open')); await audit(page, ctx, 'teacherMenu');
  await page.evaluate(() => document.getElementById('teacherMenu').classList.remove('open'));
  await page.evaluate(() => document.getElementById('settingsModal').classList.add('active')); await audit(page, ctx, 'settings');
  await page.evaluate(() => document.getElementById('settingsModal').classList.remove('active'));
  if (opt.celebrate) {
    await page.evaluate(opt.celebrate); await settle(page, 100); await audit(page, ctx, 'celebrate-pop');
    await page.evaluate(() => { const p = document.getElementById('celPop'); if (p) p.style.display = 'none'; }); await audit(page, ctx, 'celebrate');
    await page.evaluate(() => document.getElementById('celebrate').classList.remove('active'));
  }
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  for (const [app, url] of Object.entries(APPS)) {
    if (ONLY && !ONLY.includes(app)) continue;
    for (const v of VARIANTS) {
      if (VONLY && !VONLY.includes(v.name)) continue;
      const context = await browser.newContext({ viewport: { width: v.w, height: v.h }, deviceScaleFactor: 1 });
      const page = await context.newPage();
      page.on('pageerror', e => errors.push({ app, variant: v.name, msg: String(e).slice(0, 200) }));
      await page.addInitScript(`
        try { speechSynthesis.speak = function(){}; speechSynthesis.cancel = function(){}; } catch(e){}
        document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = '*,*::before,*::after{animation:none!important;transition:none!important}'; document.head.appendChild(s); });
      `);
      const t0 = Date.now();
      await page.goto(BASE + url, { waitUntil: 'load', timeout: 120000 });
      await page.evaluate(AUDIT_FN);
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(s => document.documentElement.style.setProperty('--scale', s), v.scale);
      const ctx = { app, variant: v.name };
      const before = findings.length;
      try { await DRIVERS[app](page, ctx); } catch (e) { errors.push({ app, variant: v.name, msg: 'driver: ' + String(e).slice(0, 300) }); }
      console.log(`${app} ${v.name}: ${findings.length - before} findings, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
      await context.close();
    }
  }
  await browser.close();
  fs.writeFileSync(path.join(OUT, 'findings.json'), JSON.stringify({ findings, errors }, null, 1));
  console.log('total', findings.length, 'errors', errors.length);
})();
