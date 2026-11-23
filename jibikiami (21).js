// GitHubの地引網（ポケカ専門店）v239：ページを読む＋判定まで GitHub で
// ・v239：Yahoo!ショッピング・楽天市場（公式API）も、ここで探す（前は Googleのツールで1時間ごと）
// ・v240：楽天は GitHub からだと断られる（403）ので、楽天への問い合わせだけ Google に頼む
// ・v241：楽天は言葉をまとめて1回で Google に頼む（速くする）
// ・Yahoo!フリマ・ヤフオク（即決）を、人が見る速さ（20〜30秒あけて）で開く
// ・判定は、Googleのツールと同じプログラム（tool.gs ＝ コード.gs の写し）をここで動かす（きまりは今と同じ）
// ・合格した品だけ商品ページを開き、Googleのツールに送って「出品候補（0円）」に入れる（出品・購入・ログインはしない）
'use strict';
const Z_GH_VER = 'v261';   // GitHub は、この印がいちばん新しい jibikiami*.js を動かす
const path = require('path');
const fs = require('fs');
// v245：gasshim*.js も、中の印がいちばん新しいものを使う（ファイル名に (1) が付いても動く）
const pickF = re => fs.readdirSync(__dirname).filter(f => re.test(f)).map(f => { const m = fs.readFileSync(path.join(__dirname, f), 'utf8').match(/Z_GH_VER\s*=\s*.v(\d+)/); return [m ? Number(m[1]) : 0, f]; }).sort((a, b) => b[0] - a[0])[0][1];
const SHIM = pickF(/^gasshim.*\.js$/);
const { load, curl, makeGas, sleepMs } = require(path.join(__dirname, SHIM));

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
const restQ = () => sleepMs(10000 + Math.random() * 5000);   // v253：検索の一覧は10〜15秒あける（商品ページは今までどおり20〜30秒）

// v239：お店API（Yahoo!ショッピング・楽天市場）。やり方は Googleのツールの zShopApiTick_ と同じ（判定のきまりも同じ）
function shopApi(g, gas, known, listedNow, opt) {
  opt = opt || {};
  const plan = gas({ kind: 'ghxshopplan', max: opt.max || SHOP_MAX, models: !!opt.models, dayMax: opt.dayMax });
  if (plan.off || plan.error) { console.log('お店API：動かさない（' + (plan.off || plan.error) + '）'); return; }
  const k = plan.keys || {};
  if (k.ys) console.log('::add-mask::' + k.ys);   // 鍵はログに出さない
  const P = g.PropertiesService.getScriptProperties();
  if (k.ys) P.setProperty('YAHOO_SHOPPING_APP_ID', k.ys);
  const st = g.kwSettings_(), minPh = g.zPhotoSettings_().min, tEnd = Date.now() + (opt.minutes || SHOP_MIN) * 60000;
  const rows = [], models = [], seen = [], counts = {}, cnt = x => { counts[x] = (counts[x] || 0) + 1; };
  let n = 0, found = 0, err = '';
  const jerr = [];   // v251：判定でエラーの中身
  const samples = [];   // v244：「eBayに同じカードの出品がない」の見本（読み取りの失敗か調べる）
  const rkBy = {}, allQ = (plan.qs || []).map(q => q.q); let rkFail = false;   // v241：楽天はまとめて Google に頼む（40語ずつ）・v252：40語ごとに、その分だけ頼む（全部を先に頼むと時間が足りないため）
  const rkFetch = i => { if (rkFail) return; try { const rr = gas({ kind: 'ghxrk', qs: allQ.slice(i, i + 40) }); if (rr.error) throw new Error(rr.error); Object.assign(rkBy, rr.byQ || {}); } catch (e) { rkFail = true; err = (err ? err + '・' : '') + '楽天：' + String(e.message).slice(0, 100); } };
  let qi = -1;
  for (const q of plan.qs || []) {
    if (Date.now() > tEnd) break;
    qi++; if (qi % 40 === 0) rkFetch(qi);
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
      } catch (e) { cnt('判定でエラー'); jerr.push(String(e.message).slice(0, 160)); console.log('  お店API 判定でエラー：', String(e.message).slice(0, 160)); continue; }
      if (!j.ok && j.retry) { try { delete g.kwSeenLoad_()[u]; } catch (e) {} seen.pop(); cnt('eBayの相場を読めなかった（あとで調べ直す）'); continue; }   // v249
      if (!j.ok) { if (/^eBayに同じカード/.test(j.why) && samples.length < 20) samples.push(String(it.title).slice(0, 50) + ' → ' + j.why.slice(0, 60)); cnt(j.why.replace(/（.*$/, '').replace(/上限 [\d,]+円を [\d,]+円こえる/, '仕入れ上限をこえる')); continue; }
      const num = g.zCardNo_(j.key || '').num, lk = num ? num.toLowerCase() + '|' + (j.grade === '未鑑定' ? 'u' : 'g') : '';
      if (lk && listedNow.has(lk)) { g.zBackupSrc_(it.store || 'お店', j.key, it); cnt('もう出品中のカード（予備へ）'); continue; }
      known.add(u);
      let ph = it.images || []; try { ph = g.zMergePhotos_(g.zPagePhotos_(it.url), ph); } catch (e) {}
      rows.push([false, ph.length < minPh ? '写真が少ない（' + ph.length + '枚・' + minPh + '枚以上の品だけ GO できる）' : (j.go60 ? '' : g.zGo60Note_()), '', 'お店API（GitHub）「' + q.q.slice(0, 30) + '」', it.title, yen, j.cap, j.low, j.key, j.grade, j.why + '（' + dm.note + '）・写真 ' + ph.length + '枚', it.store, it.url, it.cond || '中古', ph.join('\n')]);
      if (j.key) models.push({ key: j.key, en: j.en || '', ja: g.kwJaName_(it.title), grade: j.grade === '未鑑定' ? '未鑑定' : j.grade, low: j.low, cap: j.cap, memo: '追加候補（お店API・GitHubで見つけた）' });
      console.log('   お店API 合格：', String(it.title).slice(0, 40), yen, '円');
    }
  }
  const a = gas({ kind: 'ghxshop', q: n, found: found, counts: counts, cur: plan.len ? (Number(plan.start) + n) % plan.len : null, seen: seen, rows: JSON.parse(JSON.stringify(rows)), models: JSON.parse(JSON.stringify(models)), err: err });
  if (jerr.length) { const u = {}; jerr.forEach(x => { u[x] = (u[x] || 0) + 1; }); g.zLog_('お店APIの判定エラー', Object.keys(u).slice(0, 5).map(k => u[k] + '件：' + k).join('｜')); }
  if (samples.length) { console.log('お店API：eBayに相場なしの見本\n  ' + samples.join('\n  ')); g.zLog_('お店APIの見本（eBayに相場なし）', samples.join('｜')); }
  console.log('お店API：', n, '語・見つけた', found, '品・候補に入れた', a.added || 0, '品', err ? '（' + err + '）' : '', '外した理由', JSON.stringify(counts));
}

function main() {
  if (!GAS_URL || !GAS_TOKEN) throw new Error('GitHub の Secrets に GAS_URL と GAS_TOKEN を入れてください');
  const gas = makeGas(GAS_URL, GAS_TOKEN), tEnd = Date.now() + MINUTES * 60000;
  const WATCH = process.env.MODE === 'watch';   // v248：② 当たりやすい型番だけを見張る回（MODE=watch も main で動く）
  const plan = gas({ kind: 'ghq', max: MAX_SEARCH, maxPages: MAX_PAGES, watch: WATCH, watchMax: Number(process.env.WATCH_MAX || 15) });
  if (plan.stop) console.log('Yahoo!フリマ・ヤフオクは今回は動かしません：', plan.stop);
  console.log('判定の準備（Googleのツールから設定を読む）…');
  const g = load(CODE, gas);
  const lk = gas({ kind: 'ghxlisted' });
  const listedNow = g.__set(lk.keys), known = new Set(lk.known || []);
  const kst = g.kwSettings_();
  let seen0 = []; try { seen0 = JSON.parse(g.PropertiesService.getScriptProperties().getProperty('ZYS_SEEN') || '[]'); } catch (e) {}
  const seen = new Set(seen0), newSeen = [];
  const counts = {}, cnt = k => { counts[k] = (counts[k] || 0) + 1; }, errs = [], c2 = {}, cnt2 = k => { c2[k] = (c2[k] || 0) + 1; };   // errs：v251 判定でエラーの中身（記録に残す）
  if (false) try { shopApi(g, gas, known, listedNow); } catch (e) {   // v252：お店APIは別の回（MODE=shop・毎時）でする
   console.log('お店API：エラー', String(e.message).slice(0, 200)); }
  const searches = plan.searches || []; let pagesLeft = Number(plan.maxPages || MAX_PAGES);
  const done = { searches: 0, pages: 0, blocked: '' }, perQ = {}; let found = 0;   // perQ：③ 検索語ごとの成績
  console.log('検索', searches.length, '件・商品ページは最大', pagesLeft, '回');
  try {
    for (const s of searches) {
      if (Date.now() > tEnd || done.blocked) break;
      const r = curl(s.url, { headers: UA, timeout: 60 }); done.searches++;
      console.log(s.siteName, s.q, 'HTTP', r.code, r.text.length, '文字', s.filtered ? '（値段の条件つき）' : '（値段の条件なし）'); if (s.filtered) cnt2('値段の条件つきの検索'); else cnt2('値段の条件なしの検索');
      if (BLOCK.includes(r.code)) { done.blocked = '検索ページ HTTP ' + r.code; gas({ kind: 'ghblock', why: done.blocked }); break; }
      const pages = [];
      if (r.code !== 200) cnt('検索ページ HTTP ' + r.code);
      else {
        const items = g.zYsParse_(s.site, r.text); found += items.length; pages.__found = items.length;
        const sIn = g.__parse(JSON.stringify(s));
        for (const it of items) {
          if (seen.has(it.id) || known.has(it.url)) { cnt('もう見た品'); continue; }
          seen.add(it.id); newSeen.push(it.id);
          if (s.cap && it.price > s.cap * 1.2 * g.zMktX_() && !s.broad) { cnt('仕入れ上限をこえる'); continue; }
          let j; try { j = g.zSrcJudge_(it, sIn.siteName, sIn.siteName + '（GitHub）「' + String(sIn.q || '').slice(0, 30) + '」', kst, listedNow); } catch (e) { cnt('判定でエラー'); errs.push(String(e.message).slice(0, 160)); console.log('  判定でエラー：', String(e.message).slice(0, 160)); continue; }
          if (!j.ok) { if (j.retry) { seen.delete(it.id); const k = newSeen.lastIndexOf(it.id); if (k >= 0) newSeen.splice(k, 1); } cnt(j.why); continue; }   // v249：eBayを読めなかった品は、次の回にもう一度
          pages.push({ site: s.site, siteName: s.siteName, q: s.q, id: it.id, url: it.url, title: it.title, price: it.price });
        }
      }
      { const k = String(s.q || ''); perQ[k] = perQ[k] || { s: 0, f: 0, p: 0 }; perQ[k].s++; perQ[k].p += pages.length; if (r.code === 200) perQ[k].f += (pages.__found || 0); }
      console.log('  読めた品', found, '（累計）・商品ページを見る', pages.length, '品');
      restQ();
      for (const p of pages) {
        if (pagesLeft <= 0 || Date.now() > tEnd) break;
        const pr = curl(p.url, { headers: UA, timeout: 60 }); pagesLeft--; done.pages++;
        if (BLOCK.includes(pr.code)) { done.blocked = '商品ページ HTTP ' + pr.code; gas({ kind: 'ghblock', why: done.blocked }); break; }
        const a = gas({ kind: 'ghpage', p: p, code: pr.code, html: pr.code === 200 ? pr.text : '' });
        console.log('   ', String(p.title).slice(0, 40), p.price, '円 →', a.result || a.error || '');
        rest();
      }
    }
    // v254：カード店（遊々亭）。あなたの「A」：候補に入れるだけ（自動GO しない・店の写真は出品に使わない）
    if ((plan.store || []).length && Date.now() < tEnd) {
      const srows = [], smodels = [], sc = {}, scnt = k => { sc[k] = (sc[k] || 0) + 1; }; let sq = 0, sf = 0;
      for (const w of plan.store) {
        if (Date.now() > tEnd || done.blocked) break;
        const r = curl('https://yuyu-tei.jp/sell/poc/s/search?search_word=' + encodeURIComponent(w), { headers: UA, timeout: 60 }); sq++;
        console.log('遊々亭', w, 'HTTP', r.code, r.text.length, '文字');
        if (BLOCK.includes(r.code)) { scnt('遊々亭 HTTP ' + r.code); break; }
        if (r.code === 200) {
          const its = g.zYytParse_(r.text); sf += its.length;
          for (const it of its) {
            if (seen.has(it.id) || known.has(it.url)) { scnt('もう見た品'); continue; }
            seen.add(it.id); newSeen.push(it.id);
            let j; try { j = g.zSrcJudge_(g.__parse(JSON.stringify(it)), '遊々亭', '遊々亭（GitHub）「' + w + '」', kst, listedNow); } catch (e) { scnt('判定でエラー'); continue; }
            if (!j.ok) { if (j.retry) { seen.delete(it.id); newSeen.pop(); } scnt(j.why); continue; }
            const jj = j.j; srows.push([false, '店の写真1枚・自動GOしない（仕入れ先の参考。GOするならこのセルを空にしてGO）', '', '遊々亭（GitHub）「' + w + '」', it.title, j.yen, jj.cap, jj.low, jj.key, jj.grade, jj.why + '（' + j.dm.note + '）・在庫 ' + it.stock, '遊々亭', it.url, '新品同様（店頭）', it.images.join('\n')]);
            if (jj.key) smodels.push({ key: jj.key, en: jj.en || '', ja: g.kwJaName_(it.title), grade: '未鑑定', low: jj.low, cap: jj.cap, memo: '追加候補（遊々亭で見つけた）' });
          }
        }
        restQ();
      }
      try { gas({ kind: 'ghxstore', q: sq, found: sf, counts: sc, rows: JSON.parse(JSON.stringify(srows)), models: JSON.parse(JSON.stringify(smodels)) }); } catch (e) { console.log('遊々亭の結果を送れなかった', String(e.message).slice(0, 120)); }
    }
  } finally {
    try { if (Object.keys(c2).length) g.zLog_('GitHubの地引網（検索の形）', JSON.stringify(c2)); } catch (e) {}   // v253：値段の条件が本当に使えたか
    if (errs.length) try { const u = {}; errs.forEach(x => { u[x] = (u[x] || 0) + 1; }); g.zLog_('GitHubの判定エラー', Object.keys(u).slice(0, 5).map(k => u[k] + '件：' + k).join('｜')); } catch (e) {}
    gas({ kind: 'ghxjudged', searches: done.searches, found: found, counts: counts, seen: newSeen, perQ: perQ });
    const rows = (g.__appended || []).filter(x => ['0円の自動化の記録', '予備の仕入れ先'].includes(x.sheet));
    for (let i = 0; i < rows.length; i += 150) gas({ kind: 'ghxappend', rows: JSON.parse(JSON.stringify(rows.slice(i, i + 150))) });
    gas({ kind: 'ghdone', done: done });
    console.log('おわり', JSON.stringify(done), '外した理由', JSON.stringify(counts), 'Googleへの読み取り', g.__calls(), '回');
  }
}
// v245：判定・利益計算・出品（MODE=judge）。Googleのツールと同じプログラム（まとめ判定・送った品の処理・出品のやり直し）を、ここで動かす
function judgeMain() {
  if (!GAS_URL || !GAS_TOKEN) throw new Error('GitHub の Secrets に GAS_URL と GAS_TOKEN を入れてください');
  const gas = makeGas(GAS_URL, GAS_TOKEN), JMIN = Number(process.env.JUDGE_MINUTES || 20), tEnd = Date.now() + JMIN * 60000;
  const sec = gas({ kind: 'ghxsecrets', mode: 'judge' });
  if (sec.off) { console.log('判定・出品は動かしません：', sec.off); return; }
  if (sec.error) throw new Error(sec.error);
  const P0 = sec.props || {};
  [sec.userToken, sec.appToken].concat(Object.keys(P0).filter(k => /SECRET|TOKEN|KEY|CERT|APP_?ID|DEV|RU_?NAME|CLIENT|PASS|WEBAPP_URL/i.test(k)).map(k => P0[k]))
    .filter(v => v && String(v).length >= 6).forEach(v => String(v).split(/\r?\n/).forEach(x => x.trim() && console.log('::add-mask::' + x.trim())));   // 鍵はログに出さない
  console.log('使うプログラム：', path.basename(CODE), '／', SHIM);
  const g = load(CODE, gas, { write: true, secrets: sec });
  g.Z_GH_RUNNER_ = true;              // listRow_ を GitHub に回さない（ここで出品する）
  g.zTimeLeft_ = () => 1e9;           // Googleの1日の時間の上限は、GitHub では関係ない
  const sum = { judged: 0, retry: 0, intake: 0, listed: 0 }, t0 = Date.now();
  try {
    for (let round = 0; Date.now() < tEnd; round++) {
      gas({ kind: 'ghxbeat', mode: 'judge' });
      let did = 0;
      try { const lr = g.zLockRetry_(); if (lr && lr.tried) { did += lr.tried; sum.retry += lr.tried; sum.listed += lr.ok || 0; console.log('順番待ちの出品：', JSON.stringify(lr)); } } catch (e) { console.log('順番待ちの出品でエラー：', String(e.message).slice(0, 200)); }
      g.__flush();
      const q = g.queueCount_();
      if (q > 0) { console.log('まとめ判定待ち', q, '件'); try { g.batchJudgeCore_(); } catch (e) { console.log('まとめ判定でエラー：', String(e.message).slice(0, 200)); } did++; sum.judged += Math.max(0, q - g.queueCount_()); }
      g.__flush();
      if (round === 0) {
        try { const r = g.processIntake_(8); if (r && (r.ok || r.rej || r.err)) { sum.intake++; console.log('送った品の処理：', JSON.stringify(r).slice(0, 300)); } } catch (e) { console.log('送った品の処理でエラー：', String(e.message).slice(0, 200)); }
        if (new Date().getMinutes() < 15) { try { const r = g.zListRetry_(4); if (r && r.tried) { console.log('出品のやり直し：', JSON.stringify(r)); g.zLog_('出品のやり直し', JSON.stringify(r)); } } catch (e) {} }   // 1時間に1回（今までと同じ回数）
        g.__flush();
      }
      if (!did) break;
    }
    try { if (g.queueCount_() === 0) g.batchDigest(); } catch (e) {}
    // v247：お客さん・注文まわり（「追加の設定」F322 がオンのとき）。今までと同じ間隔：メッセージ・売れた品などは30分ごと、オファーの返事は1時間ごと、毎朝の報告は7時
    if (sec.cust) {
      const PR = g.PropertiesService.getScriptProperties(), now = Date.now(), jst = new Date(now + 9 * 3600000), day = jst.toISOString().slice(0, 10).replace(/-/g, ''), h = jst.getUTCHours();
      const due = (k, min) => { const last = Number(PR.getProperty(k) || 0); if (now - last < min * 60000 - 90000) return false; PR.setProperty(k, String(now)); return true; };
      const cs = (name, fn) => { try { const r = fn(); console.log(name, '：', String(r === undefined ? 'OK' : JSON.stringify(r)).slice(0, 200)); sum.cust = (sum.cust || 0) + 1; } catch (e) { console.log(name, 'でエラー：', String(e.message).slice(0, 200)); } g.__flush(); gas({ kind: 'ghxbeat', mode: 'cust' }); };
      gas({ kind: 'ghxbeat', mode: 'cust' });
      if (due('ZGHU_AUTO', 30)) cs('メッセージ・売れた品・購入後などのメッセージ', () => g.autoRunCore_());
      if (due('ZGHU_OFFER', 60)) cs('オファーの通知と自動の返事', () => g.offerAutoRespond());
      if (h >= 7 && PR.getProperty('ZT_report') !== day) { PR.setProperty('ZT_report', day); cs('毎朝の報告メール', () => g.zDailyReport_()); }
    }
  } finally {
    try { const msg = (sum.cust ? 'お客さん対応 ' + sum.cust + '件・' : '') + '判定 ' + sum.judged + '件・順番待ちの出品 ' + sum.retry + '件（出品できた ' + sum.listed + '件）・' + Math.round((Date.now() - t0) / 60000) + '分'; if (sum.judged || sum.retry || sum.intake || sum.cust) g.zLog_('GitHubの判定・出品', msg); console.log('おわり', msg); } catch (e) {}
    g.__flush();
  }
}
// v246：出品中の品の手入れ（MODE=care・1時間ごと）。Googleのツールと同じプログラムを、ここで動かす
function careMain() {
  if (!GAS_URL || !GAS_TOKEN) throw new Error('GitHub の Secrets に GAS_URL と GAS_TOKEN を入れてください');
  const gas = makeGas(GAS_URL, GAS_TOKEN), CMIN = Number(process.env.CARE_MINUTES || 22), tEnd = Date.now() + CMIN * 60000;
  const sec = gas({ kind: 'ghxsecrets', mode: 'care' });
  if (sec.off) { console.log('手入れは動かしません：', sec.off); return; }
  if (sec.error) throw new Error(sec.error);
  const P0 = sec.props || {};
  [sec.userToken, sec.appToken].concat(Object.keys(P0).filter(k => /SECRET|TOKEN|KEY|CERT|APP_?ID|DEV|RU_?NAME|CLIENT|PASS|WEBAPP_URL/i.test(k)).map(k => P0[k]))
    .filter(v => v && String(v).length >= 6).forEach(v => String(v).split(/\r?\n/).forEach(x => x.trim() && console.log('::add-mask::' + x.trim())));
  console.log('使うプログラム：', path.basename(CODE), '／', SHIM);
  const g = load(CODE, gas, { write: true, secrets: sec });
  g.Z_GH_RUNNER_ = true;
  g.zTimeLeft_ = () => 1e9;
  g.zTimed_ = (name, fn) => fn();     // Googleの1日の時間に数えない
  const PR = g.PropertiesService.getScriptProperties();
  g.stopUpgrade_ = () => PR.setProperty('ZGHC_UPGRADE', 'done');   // 出品文の作り直しが全部終わった印（Google側の15分ごとの仕組みを止める）
  const jst = new Date(Date.now() + 9 * 3600000), day = jst.toISOString().slice(0, 10).replace(/-/g, ''), h = jst.getUTCHours();
  const done = [], left = () => Date.now() < tEnd;
  const step = (name, fn) => { if (!left()) return; const t0 = Date.now(); try { const r = fn(); if (r !== undefined) done.push(name + '：' + String(typeof r === 'string' ? r : JSON.stringify(r)).slice(0, 120)); else done.push(name); } catch (e) { done.push(name + '：エラー ' + String(e.message).slice(0, 100)); } g.__flush(); console.log(name, Math.round((Date.now() - t0) / 1000) + '秒'); gas({ kind: 'ghxbeat', mode: 'care' }); };
  const once = k => { const key = (/^(sr|addm3)/.test(k) ? 'ZGHC_' : 'ZT_') + k; if (PR.getProperty(key) === day) return false; PR.setProperty(key, day); return true; };   // 1日1回の仕事は、Googleのツールと同じ印（ZT_）を使う（同じ日に2回しない）
  try {
    step('判定し直し（v260）', () => g.zRejudgeRateOnce_());
    // v257：出品中の品も教科書の式に（1回だけ・順番に）
    for (let i = 0; i < 12 && left(); i++) { let r; step('教科書の式に変更（出品中）', () => (r = g.zTbApplyStep_())); if (!r || /^オフ/.test(r)) break; if (/おわり/.test(r)) break; }
    // ① 値段の見直し（1時間に10件・1日100件まで。今までと同じ）
    step('値段の見直し', () => { g.repriceAuto(); });
    // ② 在庫チェック：0・6・12・18時に始めて、残りは続きから
    if ([0, 6, 12, 18].includes(h) && once('sr' + h)) step('在庫アラート', () => { g.stockReport(); });
    for (let i = 0; i < 20 && left(); i++) { let q = []; try { q = JSON.parse(PR.getProperty('AUTO_STOCK_QUEUE') || '[]'); } catch (e) {} if (!q.length) break; step('在庫チェック（残り ' + q.length + '件）', () => { g.autoStockCheck(); }); }
    // ③ 1日1回の仕事（今までと同じ時刻以降）
    if (h >= 1 && once('ofon')) { step('オファーを全部オン', () => { g.zOfferOnJob(); }); for (let i = 0; i < 10 && left(); i++) { let r; step('オファーを全部オン（出品一覧）', () => (r = g.zOfferAllListings_())); if (!r || !r.more) break; } step('ウォッチしている人へのオファー', () => { g.zSendOffersJob(); }); }
    if (h >= 2 && once('rmp')) for (let i = 0; i < 10 && left(); i++) { let r; step('最低利益までの値上げ', () => (r = g.zRaiseToMinProfit_())); if (r) g.zLog_('最低利益までの値上げ', JSON.stringify(r)); if (!r || !r.more) break; }
    if (h >= 3 && once('hpr')) step('相場の2倍以上の値段の見直し', () => { g.zHighPriceReviewJob(); });
    // ④ 自動点検担当（毎朝4時から・今までと同じ順番）
    for (let i = 0; i < 12 && left(); i++) { let r; step('自動点検担当', () => (r = g.zInspTick_(false))); if (!r || !r.worked) break; }
    // ⑥ v253：型番リストを育てる（3時間ごと・1日の上限は今までどおり「追加の設定」の数）
    if (h % 3 === 0 && once('addm3_' + h)) step('売れる型番を型番リストに足す', () => { const r = g.zAddSellModels_(g.zAddModelSettings_().addPerDay); g.zLog_('売れる型番を3時間ごとに追加', JSON.stringify({ added: r.added, rejected: r.rejected, checked: r.pool, doneToday: r.doneToday })); return { added: r.added }; });
    // ⑤ 出品文の作り直し（Google側で「する」になっているときだけ）
    for (let i = 0; i < 4 && left() && PR.getProperty('ZGHC_UPGRADE') === '1'; i++) step('出品文の作り直し', () => { g.upgradeAllListings(); });
  } finally {
    try { g.zLog_('GitHubの手入れ', done.join('｜').slice(0, 900) || '（することがなかった）'); } catch (e) {}
    g.__flush();
    console.log('おわり', done.join(' / '));
  }
}
// v252：お店の地引網（MODE=shop・毎時）。カード型番リストの型番を、楽天・Yahoo!ショッピングの公式APIで順番に全部（ページは開かない）
function shopMain() {
  if (!GAS_URL || !GAS_TOKEN) throw new Error('GitHub の Secrets に GAS_URL と GAS_TOKEN を入れてください');
  const gas = makeGas(GAS_URL, GAS_TOKEN);
  console.log('判定の準備（Googleのツールから設定を読む）…');
  const g = load(CODE, gas);
  const lk = gas({ kind: 'ghxlisted' });
  const listedNow = g.__set(lk.keys), known = new Set(lk.known || []);
  try { shopApi(g, gas, known, listedNow, { models: true, max: Number(process.env.SHOP_MAX || 1200), minutes: Number(process.env.SHOP_MINUTES || 22), dayMax: Number(process.env.SHOP_DAYMAX || 6000) }); }
  catch (e) { console.log('お店API：エラー', String(e.message).slice(0, 200)); }
  const rows = (g.__appended || []).filter(x => ['0円の自動化の記録', '予備の仕入れ先'].includes(x.sheet));
  for (let i = 0; i < rows.length; i += 150) gas({ kind: 'ghxappend', rows: JSON.parse(JSON.stringify(rows.slice(i, i + 150))) });
}
try { if (process.env.MODE === 'shop') shopMain(); else if (process.env.MODE === 'judge') judgeMain(); else if (process.env.MODE === 'care') careMain(); else main(); } catch (e) { console.error('止まりました：', e.message); process.exit(1); }
