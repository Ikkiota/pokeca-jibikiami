// GitHubの地引網（ポケカ専門店）v239：ページを読む＋判定まで GitHub で
// ・v239：Yahoo!ショッピング・楽天市場（公式API）も、ここで探す（前は Googleのツールで1時間ごと）
// ・v240：楽天は GitHub からだと断られる（403）ので、楽天への問い合わせだけ Google に頼む
// ・v241：楽天は言葉をまとめて1回で Google に頼む（速くする）
// ・Yahoo!フリマ・ヤフオク（即決）を、人が見る速さ（20〜30秒あけて）で開く
// ・判定は、Googleのツールと同じプログラム（tool.gs ＝ コード.gs の写し）をここで動かす（きまりは今と同じ）
// ・合格した品だけ商品ページを開き、Googleのツールに送って「出品候補（0円）」に入れる（出品・購入・ログインはしない）
'use strict';
const Z_GH_VER = 'v241';   // GitHub は、この印がいちばん新しい jibikiami*.js を動かす
const path = require('path');
const { load, curl, makeGas, sleepMs } = require('./gasshim');

const GAS_URL = (process.env.GAS_URL || '').trim(), GAS_TOKEN = (process.env.GAS_TOKEN || '').trim();
const SMALL = process.env.SMALL === '1';
const MAX_SEARCH = SMALL ? 4 : Number(process.env.MAX_SEARCH || 24);
const MAX_PAGES = SMALL ? 3 : Number(process.env.MAX_PAGES || 20);
const MINUTES = Number(process.env.MINUTES || 25);
const SHOP_MAX = SMALL ? 5 : Number(process.env.SHOP_MAX || 80), SHOP_MIN = Number(process.env.SHOP_MINUTES || 6);
const CODE = process.env.TOOL_CODE || path.join(__dirname, 'tool.gs');
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', 'Accept-Language': 'ja' };
const BLOCK = [403, 429, 503, 999];
const rest = () => sleepMs(20000 + Math.random() * 10000);

// v239：お店API（Yahoo!ショッピング・楽天市場）。やり方は Googleのツールの zShopApiTick_ と同じ（判定のきまりも同じ）
function shopApi(g, gas, known, listedNow) {
  const plan = gas({ kind: 'ghxshopplan', max: SHOP_MAX });
  if (plan.off || plan.error) { console.log('お店API：動かさない（' + (plan.off || plan.error) + '）'); return; }
  const k = plan.keys || {};
  if (k.ys) console.log('::add-mask::' + k.ys);   // 鍵はログに出さない
  const P = g.PropertiesService.getScriptProperties();
  if (k.ys) P.setProperty('YAHOO_SHOPPING_APP_ID', k.ys);
  const st = g.kwSettings_(), minPh = g.zPhotoSettings_().min, tEnd = Date.now() + SHOP_MIN * 60000;
  const rows = [], models = [], seen = [], counts = {}, cnt = x => { counts[x] = (counts[x] || 0) + 1; };
  let n = 0, found = 0, err = '';
  const rkBy = {};   // v241：楽天はまとめて Google に頼む（40語ずつ）
  try { const all = (plan.qs || []).map(q => q.q);
    for (let i = 0; i < all.length && Date.now() < tEnd; i += 40) { const rr = gas({ kind: 'ghxrk', qs: all.slice(i, i + 40) }); if (rr.error) throw new Error(rr.error); Object.assign(rkBy, rr.byQ || {}); }
  } catch (e) { err = '楽天：' + String(e.message).slice(0, 100); }
  console.log('お店API：楽天の結果', Object.keys(rkBy).length, '語分を受け取った');
  for (const q of plan.qs || []) {
    if (Date.now() > tEnd) break;
    n++;
    let items = [];
    try { const fb = g.kwFetchBothFast_(q.q, st, 'ys'); items = fb.items || []; if ((fb.errs || []).length && !err) err = fb.errs.join('・'); } catch (e) { cnt('APIのエラー（Yahoo!）'); }
    const rr = rkBy[q.q]; if (rr) { items = items.concat(g.__parse(JSON.stringify(rr.items || []))); if ((rr.errs || []).length && err.indexOf('楽天') < 0) err = (err ? err + '・' : '') + rr.errs.join('・'); }
    found += items.length;
    for (const it of items) {
      const u = String(it.url).split('?')[0];
      if (known.has(u) || g.kwSeenSkip_(u, it.price)) { cnt('もう見た品'); continue; }
      g.kwSeenAdd_(u, it.price); seen.push([u, Number(it.price) || 0]);
      let j, dm, yen;
      try {
        dm = g.zDomShip_({ url: it.url, text: it.desc, freeShip: it.freeShip, shopShip: st.ship, box: g.zIsSealedBox_(g.zNorm_(it.title)) });
        yen = it.price + dm.yen - (g.zPointsOn_() ? (Number(it.pt) || 0) : 0); j = g.kwJudge_(it, st, yen);
      } catch (e) { cnt('判定でエラー'); console.log('  お店API 判定でエラー：', String(e.message).slice(0, 160)); continue; }
      if (!j.ok) { cnt(j.why.replace(/（.*$/, '').replace(/上限 [\d,]+円を [\d,]+円こえる/, '仕入れ上限をこえる')); continue; }
      const num = g.zCardNo_(j.key || '').num, lk = num ? num.toLowerCase() + '|' + (j.grade === '未鑑定' ? 'u' : 'g') : '';
      if (lk && listedNow.has(lk)) { g.zBackupSrc_(it.store || 'お店', j.key, it); cnt('もう出品中のカード（予備へ）'); continue; }
      known.add(u);
      let ph = it.images || []; try { ph = g.zMergePhotos_(g.zPagePhotos_(it.url), ph); } catch (e) {}
      rows.push([false, ph.length < minPh ? '写真が少ない（' + ph.length + '枚・' + minPh + '枚以上の品だけ GO できる）' : '', '', 'お店API（GitHub）「' + q.q.slice(0, 30) + '」', it.title, yen, j.cap, j.low, j.key, j.grade, j.why + '（' + dm.note + '）・写真 ' + ph.length + '枚', it.store, it.url, it.cond || '中古', ph.join('\n')]);
      if (j.key) models.push({ key: j.key, en: j.en || '', ja: g.kwJaName_(it.title), grade: j.grade === '未鑑定' ? '未鑑定' : j.grade, low: j.low, cap: j.cap, memo: '追加候補（お店API・GitHubで見つけた）' });
      console.log('   お店API 合格：', String(it.title).slice(0, 40), yen, '円');
    }
  }
  const a = gas({ kind: 'ghxshop', q: n, found: found, counts: counts, cur: plan.len ? (Number(plan.start) + n) % plan.len : null, seen: seen, rows: JSON.parse(JSON.stringify(rows)), models: JSON.parse(JSON.stringify(models)), err: err });
  console.log('お店API：', n, '語・見つけた', found, '品・候補に入れた', a.added || 0, '品', err ? '（' + err + '）' : '', '外した理由', JSON.stringify(counts));
}

function main() {
  if (!GAS_URL || !GAS_TOKEN) throw new Error('GitHub の Secrets に GAS_URL と GAS_TOKEN を入れてください');
  const gas = makeGas(GAS_URL, GAS_TOKEN), tEnd = Date.now() + MINUTES * 60000;
  const plan = gas({ kind: 'ghq', max: MAX_SEARCH, maxPages: MAX_PAGES });
  if (plan.stop) console.log('Yahoo!フリマ・ヤフオクは今回は動かしません：', plan.stop);
  console.log('判定の準備（Googleのツールから設定を読む）…');
  const g = load(CODE, gas);
  const lk = gas({ kind: 'ghxlisted' });
  const listedNow = g.__set(lk.keys), known = new Set(lk.known || []);
  const kst = g.kwSettings_();
  let seen0 = []; try { seen0 = JSON.parse(g.PropertiesService.getScriptProperties().getProperty('ZYS_SEEN') || '[]'); } catch (e) {}
  const seen = new Set(seen0), newSeen = [];
  const counts = {}, cnt = k => { counts[k] = (counts[k] || 0) + 1; };
  try { shopApi(g, gas, known, listedNow); } catch (e) { console.log('お店API：エラー', String(e.message).slice(0, 200)); }
  const searches = plan.searches || []; let pagesLeft = Number(plan.maxPages || MAX_PAGES);
  const done = { searches: 0, pages: 0, blocked: '' }; let found = 0;
  console.log('検索', searches.length, '件・商品ページは最大', pagesLeft, '回');
  try {
    for (const s of searches) {
      if (Date.now() > tEnd || done.blocked) break;
      const r = curl(s.url, { headers: UA, timeout: 60 }); done.searches++;
      console.log(s.siteName, s.q, 'HTTP', r.code, r.text.length, '文字');
      if (BLOCK.includes(r.code)) { done.blocked = '検索ページ HTTP ' + r.code; gas({ kind: 'ghblock', why: done.blocked }); break; }
      const pages = [];
      if (r.code !== 200) cnt('検索ページ HTTP ' + r.code);
      else {
        const items = g.zYsParse_(s.site, r.text); found += items.length;
        const sIn = g.__parse(JSON.stringify(s));
        for (const it of items) {
          if (seen.has(it.id) || known.has(it.url)) { cnt('もう見た品'); continue; }
          seen.add(it.id); newSeen.push(it.id);
          if (s.cap && it.price > s.cap * 1.2 && !s.broad) { cnt('仕入れ上限をこえる'); continue; }
          let j; try { j = g.zSrcJudge_(it, sIn.siteName, sIn.siteName + '（GitHub）「' + String(sIn.q || '').slice(0, 30) + '」', kst, listedNow); } catch (e) { cnt('判定でエラー'); console.log('  判定でエラー：', String(e.message).slice(0, 160)); continue; }
          if (!j.ok) { cnt(j.why); continue; }
          pages.push({ site: s.site, siteName: s.siteName, q: s.q, id: it.id, url: it.url, title: it.title, price: it.price });
        }
      }
      console.log('  読めた品', found, '（累計）・商品ページを見る', pages.length, '品');
      rest();
      for (const p of pages) {
        if (pagesLeft <= 0 || Date.now() > tEnd) break;
        const pr = curl(p.url, { headers: UA, timeout: 60 }); pagesLeft--; done.pages++;
        if (BLOCK.includes(pr.code)) { done.blocked = '商品ページ HTTP ' + pr.code; gas({ kind: 'ghblock', why: done.blocked }); break; }
        const a = gas({ kind: 'ghpage', p: p, code: pr.code, html: pr.code === 200 ? pr.text : '' });
        console.log('   ', String(p.title).slice(0, 40), p.price, '円 →', a.result || a.error || '');
        rest();
      }
    }
  } finally {
    gas({ kind: 'ghxjudged', searches: done.searches, found: found, counts: counts, seen: newSeen });
    const rows = (g.__appended || []).filter(x => ['0円の自動化の記録', '予備の仕入れ先'].includes(x.sheet));
    for (let i = 0; i < rows.length; i += 150) gas({ kind: 'ghxappend', rows: JSON.parse(JSON.stringify(rows.slice(i, i + 150))) });
    gas({ kind: 'ghdone', done: done });
    console.log('おわり', JSON.stringify(done), '外した理由', JSON.stringify(counts), 'Googleへの読み取り', g.__calls(), '回');
  }
}
try { main(); } catch (e) { console.error('止まりました：', e.message); process.exit(1); }
