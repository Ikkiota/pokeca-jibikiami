// GitHubの地引網（ポケカ専門店）v238：ページを読む＋判定まで GitHub で
// ・Yahoo!フリマ・ヤフオク（即決）を、人が見る速さ（20〜30秒あけて）で開く
// ・判定は、Googleのツールと同じプログラム（tool.gs ＝ コード.gs の写し）をここで動かす（きまりは今と同じ）
// ・合格した品だけ商品ページを開き、Googleのツールに送って「出品候補（0円）」に入れる（出品・購入・ログインはしない）
'use strict';
const path = require('path');
const { load, curl, makeGas, sleepMs } = require('./gasshim');

const GAS_URL = (process.env.GAS_URL || '').trim(), GAS_TOKEN = (process.env.GAS_TOKEN || '').trim();
const SMALL = process.env.SMALL === '1';
const MAX_SEARCH = SMALL ? 4 : Number(process.env.MAX_SEARCH || 24);
const MAX_PAGES = SMALL ? 3 : Number(process.env.MAX_PAGES || 20);
const MINUTES = Number(process.env.MINUTES || 25);
const CODE = process.env.TOOL_CODE || path.join(__dirname, 'tool.gs');
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', 'Accept-Language': 'ja' };
const BLOCK = [403, 429, 503, 999];
const rest = () => sleepMs(20000 + Math.random() * 10000);

function main() {
  if (!GAS_URL || !GAS_TOKEN) throw new Error('GitHub の Secrets に GAS_URL と GAS_TOKEN を入れてください');
  const gas = makeGas(GAS_URL, GAS_TOKEN), tEnd = Date.now() + MINUTES * 60000;
  const plan = gas({ kind: 'ghq', max: MAX_SEARCH, maxPages: MAX_PAGES });
  if (plan.stop) { console.log('今回は動かしません：', plan.stop); return; }
  console.log('判定の準備（Googleのツールから設定を読む）…');
  const g = load(CODE, gas);
  const lk = gas({ kind: 'ghxlisted' });
  const listedNow = g.__set(lk.keys), known = new Set(lk.known || []);
  const kst = g.kwSettings_();
  let seen0 = []; try { seen0 = JSON.parse(g.PropertiesService.getScriptProperties().getProperty('ZYS_SEEN') || '[]'); } catch (e) {}
  const seen = new Set(seen0), newSeen = [];
  const counts = {}, cnt = k => { counts[k] = (counts[k] || 0) + 1; };
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
