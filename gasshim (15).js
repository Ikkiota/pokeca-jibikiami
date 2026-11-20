// GitHub の上で、Googleのツール（コード.gs）を「そのまま」動かすための土台
// ・シートの値と設定は、Googleのツールに頼んで読む（読むだけ）
// ・eBay と仕入れ先へのアクセスは curl で直接
// ・シートへの書き込みは、決まった記録用シートの「行を足す」だけ Google に送り返す（ほかの書き込みはしない）
'use strict';
const Z_GH_VER = 'v260';   // GitHub は、この印がいちばん新しい gasshim*.js を使う
const vm = require('vm'), fs = require('fs'), cp = require('child_process'), crypto = require('crypto');

function curl(url, opt) {
  opt = opt || {};
  const m0 = String(opt.method || 'GET').toUpperCase();
  // POST は -X を付けない（Googleのツールは 302 で別の住所に案内し、そこは GET でしか受けないため。curl は -X なしなら案内先を GET で開く）
  const args = ['-sS', '-L', '--max-time', String(opt.timeout || 120), '-w', '\n__HTTP__%{http_code}', '-D', '-'];
  if (m0 !== 'GET' && m0 !== 'POST') args.push('-X', m0);
  Object.keys(opt.headers || {}).forEach(h => args.push('-H', h + ': ' + opt.headers[h]));
  let input;
  if (opt.payload !== undefined && opt.payload !== null) { args.push('--data-binary', '@-'); input = Array.isArray(opt.payload) ? Buffer.from(opt.payload.map(x => x & 255)) : Buffer.from(String(opt.payload), 'utf8'); }
  args.push(url);
  const r = cp.spawnSync('curl', args, { input: input, maxBuffer: 300 * 1024 * 1024 });
  if (r.error) return { code: 0, text: String(r.error.message), headers: {} };
  const buf = r.stdout || Buffer.alloc(0), lat = buf.toString('latin1');
  const m = lat.match(/\n__HTTP__(\d{3})$/);
  const code = m ? Number(m[1]) : 0, end = m ? m.index : buf.length;
  // -D - で先頭にヘッダーが入る（リダイレクトのたびに）。最後のヘッダーの後ろが本文
  let headers = {}, pos = 0;
  while (/^HTTP\/[\d.]+ \d{3}/.test(lat.slice(pos, pos + 16))) {
    let e = lat.indexOf('\r\n\r\n', pos), sep = 4; const e2 = lat.indexOf('\n\n', pos); if (e < 0 || (e2 >= 0 && e2 < e)) { e = e2; sep = 2; }
    if (e < 0 || e >= end) break;
    headers = {}; lat.slice(pos, e).split(/\r?\n/).slice(1).forEach(l => { const k = l.indexOf(':'); if (k > 0) { const n = l.slice(0, k).trim(), v = l.slice(k + 1).trim(); headers[n] = v; headers[n.toLowerCase()] = v; } });
    pos = e + sep;
  }
  const body = buf.slice(pos, end), ct = String(headers['content-type'] || '');
  const o = { code: code, text: body.toString('utf8'), headers: headers };
  if (ct && !/text|json|xml|javascript|html/i.test(ct)) o.b64 = body.toString('base64');
  return o;
}

function makeGas(url, token) {
  return function gas(data) {
    const payload = 'token=' + encodeURIComponent(token) + '&data=' + encodeURIComponent(JSON.stringify(data));
    for (let i = 0; i < 3; i++) {
      const r = curl(url, { method: 'POST', payload: payload, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 330 });
      try { return JSON.parse(r.text); } catch (e) {
        if (i === 2) throw new Error('Googleのツールの返事が読めません（デプロイを新しいバージョンにしたか、GAS_URL・GAS_TOKEN を確かめてください）: HTTP ' + r.code + ' ' + String(r.text).slice(0, 200));
        sleepMs(5000);
      }
    }
  };
}
function sleepMs(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.max(0, ms)); }

// コンテキストの中で動く部分（Date・Array などが Googleのツールのコードと同じ世界になるように、中で作る）
const INSIDE = String.raw`
(function () {
  const H = __host;
  const W = H.mode() === 'w';   // v245：書き込みもする（判定・出品）
  const OPS = []; let skipNext = false;
  const ser = v => { if (v instanceof Date) return { __d: v.getTime() }; if (typeof v === 'function') { skipNext = true; return null; } if (Array.isArray(v)) return v.map(ser); if (v && typeof v === 'object') { if (v.__rt) return v; try { return JSON.parse(JSON.stringify(v)); } catch (e) { skipNext = true; return null; } } return v; };
  const queue = o => { skipNext = false; o.a = (o.a || []).map(ser); if (skipNext) o.skip = true; skipNext = false; OPS.push(o); };
  const parse = s => JSON.parse(s, (k, v) => (v && typeof v === 'object' && v.__d !== undefined) ? new Date(v.__d) : v);
  const chain = () => { const f = function () { return p; }; const p = new Proxy(f, { get: (t, k) => k === 'then' ? undefined : (k === Symbol.toPrimitive ? () => '' : chain()), apply: () => p }); return p; };
  // ---- シート ----
  const META = parse(H.meta());
  const SHEETS = {}, STS = {};
  function flushAll() { if (!W || !OPS.length) return; const ops = OPS.splice(0, OPS.length); const res = parse(H.write(JSON.stringify(ops))); (res.meta || []).forEach(x => { if (STS[x.name]) STS[x.name].sync(x); }); }
  const appended = [];
  function colNum(s) { let n = 0; for (const ch of s.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64); return n; }
  function a1(sheet, s) {
    s = String(s).replace(/^.*!/, '').replace(/\$/g, '');
    const one = x => { const m = x.match(/^([A-Za-z]*)(\d*)$/); return { c: m[1] ? colNum(m[1]) : null, r: m[2] ? Number(m[2]) : null }; };
    const [a, b] = s.split(':'); const A = one(a), B = b ? one(b) : A;
    const r1 = A.r || 1, c1 = A.c || 1, r2 = B.r || Math.max(sheet.getLastRow(), r1), c2 = B.c || Math.max(sheet.getLastColumn(), c1);
    return [r1, c1, r2 - r1 + 1, c2 - c1 + 1];
  }
  function mkSheet(name, m) {
    const st = { dirty: false, name: name, rows: m ? m.rows : 0, cols: m ? m.cols : 0, maxRows: m ? m.maxRows : 1000, maxCols: m ? m.maxCols : 26, full: null, rc: {}, extra: [] };
    const big = () => st.rows * st.cols > 150000;
    function read(r, c, nr, nc, kind) {
      if (W && (st.dirty || kind || (!st.full && OPS.some(o => o.s === name)))) flushAll();
      if (!kind && !big() && st.rows > 0) {
        if (!st.full) { const x = H.range(name, 1, 1, Math.max(1, st.rows), Math.max(1, st.cols), ''); st.full = x ? parse(x).values : []; }
        const out = [];
        for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) { const R = st.full[r - 1 + i]; let v = R ? R[c - 1 + j] : undefined; if (v === undefined) { const e = st.extra[r - 1 + i - st.rows]; v = e ? e[c - 1 + j] : undefined; } row.push(v === undefined ? '' : v); } out.push(row); }
        return out;
      }
      const key = [r, c, nr, nc, kind || ''].join(',');
      if (!st.rc[key]) {
        const nr2 = Math.max(1, Math.min(nr, Math.max(1, st.rows - r + 1)));
        const x = st.rows >= r ? H.range(name, r, c, nr2, nc, kind || '') : null;
        let vals = x ? (parse(x)[kind === 'links' ? 'links' : kind === 'display' ? 'display' : 'values'] || []) : [];
        while (vals.length < nr) vals.push(new Array(nc).fill(''));
        st.rc[key] = vals;
      }
      return st.rc[key].map(row => row.slice());
    }
    function range(r, c, nr, nc) {
      nr = nr || 1; nc = nc || 1;
      const rg = new Proxy({
        getValues: () => read(r, c, nr, nc), getValue: () => read(r, c, 1, 1)[0][0],
        getDisplayValues: () => read(r, c, nr, nc, 'display'), getDisplayValue: () => String(read(r, c, 1, 1, 'display')[0][0]),
        getRichTextValues: () => read(r, c, nr, nc, 'links').map(row => row.map(u => ({ getLinkUrl: () => u || null, getText: () => '', getRuns: () => [{ getLinkUrl: () => u || null, getText: () => '' }] }))),
        getRichTextValue: () => { const u = read(r, c, 1, 1, 'links')[0][0]; return { getLinkUrl: () => u || null, getText: () => '', getRuns: () => [{ getLinkUrl: () => u || null }] }; },
        getFormulas: () => read(r, c, nr, nc).map(row => row.map(() => '')), getFormula: () => '',
        getNumRows: () => nr, getNumColumns: () => nc, getRow: () => r, getColumn: () => c, getLastRow: () => r + nr - 1, getLastColumn: () => c + nc - 1,
        getSheet: () => sheet, getA1Notation: () => '', isBlank: () => read(r, c, nr, nc).every(row => row.every(v => v === '')),
        getBackgrounds: () => read(r, c, nr, nc).map(row => row.map(() => '#ffffff')), getBackground: () => '#ffffff',
        offset: (dr, dc, a, b) => range(r + dr, c + dc, a || nr, b || nc),
      }, { get: (t, k) => k in t ? t[k] : (k === 'then' ? undefined : (W && /^(set[A-Z]\w*|clear\w*|insertCheckboxes|removeCheckboxes|merge\w*|breakApart|check|uncheck)$/.test(String(k)) ? (...a) => { queue({ t: 'r', s: name, r: r, c: c, nr: nr, nc: nc, m: k, a: a }); localSet(r, c, nr, nc, k, a); return rg; } : () => rg)) });   // setValue などの書き込みは、何もしない
      return rg;
    }
    function localSet(r, c, nr, nc, k, a) {
      st.rc = {};
      if (k === 'setValue' || k === 'setValues') {
        if (!st.full) return;
        const vals = k === 'setValue' ? Array.from({ length: nr }, () => new Array(nc).fill(a[0])) : a[0];
        for (let i = 0; i < nr; i++) { const R = r - 1 + i; while (st.full.length <= R) st.full.push(new Array(Math.max(st.cols, c + nc - 1)).fill('')); for (let j = 0; j < nc; j++) st.full[R][c - 1 + j] = vals[i] ? vals[i][j] : ''; }
        st.rows = Math.max(st.rows, r + nr - 1); st.cols = Math.max(st.cols, c + nc - 1); return;
      }
      if (/^(clear|setFormula|setRichText|insertCheckboxes|removeCheckboxes|merge|breakApart|check|uncheck)/.test(k)) st.dirty = true;
    }
    st.sync = x => { st.rows = x.rows; st.cols = x.cols; st.maxRows = x.maxRows; st.maxCols = x.maxCols; if (st.dirty) { st.full = null; st.dirty = false; } st.rc = {}; };
    const sheet = new Proxy({
      getName: () => name, getLastRow: () => { if (W && st.dirty) flushAll(); return st.rows + st.extra.length; }, getLastColumn: () => { if (W && st.dirty) flushAll(); return st.cols; }, getMaxRows: () => st.maxRows, getMaxColumns: () => st.maxCols,
      getRange: (a, b, c2, d) => typeof a === 'string' ? range(...a1(sheet, a)) : range(a, b, c2, d),
      getDataRange: () => range(1, 1, Math.max(1, st.rows), Math.max(1, st.cols)),
      appendRow: row => { if (W) { queue({ t: 's', s: name, m: 'appendRow', a: [row] }); if (st.full) st.full.push(row.slice()); st.rows++; st.cols = Math.max(st.cols, row.length); st.rc = {}; return sheet; } st.extra.push(row); appended.push({ sheet: name, row: row.map(v => v instanceof Date ? { __d: v.getTime() } : v) }); return sheet; },
      getSheetId: () => 0, getIndex: () => 0, getParent: () => SS,
    }, { get: (t, k) => k in t ? t[k] : (k === 'then' ? undefined : (W && /^(deleteRows?|insertRows?|insertRowAfter|insertRowBefore|insertRowsAfter|insertRowsBefore|insertColumnAfter|insertColumnsAfter|setFrozenRows|setFrozenColumns|setColumnWidths?|setRowHeights?|hideSheet|showSheet|clear|clearContents|clearFormats|setTabColor|autoResizeColumns?|hideColumns|showColumns|hideRows|showRows)$/.test(String(k)) ? (...a) => { queue({ t: 's', s: name, m: k, a: a }); if (/^(delete|insert|clear)/.test(k)) { st.dirty = true; st.rc = {}; } return sheet; } : () => sheet)) });
    st.sheet = sheet; STS[name] = st;
    return sheet;
  }
  META.sheets.forEach(m => { SHEETS[m.name] = mkSheet(m.name, m); });
  // v255：別のスプレッドシート（正式 ebay の計算式）は読むだけで開く
  const OTHERS = {};
  function otherSS(id) {
    if (OTHERS[id]) return OTHERS[id];
    const meta = parse(H.meta2(id)); if (meta.error) throw new Error(meta.error);
    const sh = {};
    (meta.sheets || []).forEach(m => {
      const cache = {};
      const rd = (r, c, nr, nc, kind) => { const k = [r, c, nr, nc, kind || ''].join(','); if (!cache[k]) { const x = H.range2(id, m.name, r, c, nr, nc, kind || ''); const o = x ? parse(x) : {}; let v = o[kind === 'display' ? 'display' : 'values'] || []; while (v.length < nr) v.push(new Array(nc).fill('')); cache[k] = v; } return cache[k].map(x => x.slice()); };
      const sheet = new Proxy({ getName: () => m.name, getLastRow: () => m.rows, getLastColumn: () => m.cols, getMaxRows: () => m.maxRows, getMaxColumns: () => m.maxCols,
        getRange: (a, b, c2, d) => { const [r, c, nr, nc] = typeof a === 'string' ? a1(sheet, a) : [a, b, c2 || 1, d || 1];
          const rg = new Proxy({ getValues: () => rd(r, c, nr, nc), getValue: () => rd(r, c, 1, 1)[0][0], getDisplayValues: () => rd(r, c, nr, nc, 'display'), getDisplayValue: () => String(rd(r, c, 1, 1, 'display')[0][0]), getNumRows: () => nr, getNumColumns: () => nc, getRow: () => r, getColumn: () => c },
            { get: (t, k) => k in t ? t[k] : (k === 'then' ? undefined : () => rg) }); return rg; },
        getDataRange: () => sheet.getRange(1, 1, Math.max(1, m.rows), Math.max(1, m.cols)) }, { get: (t, k) => k in t ? t[k] : (k === 'then' ? undefined : () => sheet) });
      sh[m.name] = sheet;
    });
    const book = new Proxy({ getSheetByName: n => sh[n] || null, getSheets: () => Object.keys(sh).map(k => sh[k]), getId: () => id }, { get: (t, k) => k in t ? t[k] : (k === 'then' ? undefined : () => book) });
    return (OTHERS[id] = book);
  }
  const SS = new Proxy({
    getSheetByName: n => SHEETS[n] || null, getSheets: () => Object.keys(SHEETS).map(k => SHEETS[k]),
    insertSheet: n => { if (W) queue({ t: 'ss', m: 'insertSheet', a: [n] }); return (SHEETS[n] = mkSheet(n, null)); }, getId: () => META.ssId, getUrl: () => 'https://docs.google.com/spreadsheets/d/' + META.ssId + '/edit', getName: () => 'ポケカ専門店',
    getActiveSheet: () => null,
  }, { get: (t, k) => k in t ? t[k] : (k === 'then' ? undefined : () => SS) });
  const rtb = () => { const o = { text: '', links: [] }; const b = { setText: t => { o.text = String(t); return b; }, setLinkUrl: (x, y, z) => { o.links.push(z !== undefined ? [x, y, z] : [x]); return b; }, setTextStyle: () => b, build: () => ({ __rt: o, getText: () => o.text, getLinkUrl: () => (o.links[0] || [])[o.links[0] && o.links[0].length === 3 ? 2 : 0] || null }) }; return b; };
  globalThis.SpreadsheetApp = new Proxy({ getActiveSpreadsheet: () => SS, getActive: () => SS, openById: id => (!id || id === META.ssId ? SS : otherSS(String(id))), openByUrl: u => { const m = String(u).match(/\/d\/([\w-]+)/); return m && m[1] !== META.ssId ? otherSS(m[1]) : SS; }, flush: () => flushAll(), getUi: () => chain(), newRichTextValue: rtb }, { get: (t, k) => k in t ? t[k] : chain() });
  // ---- 設定（Properties）・キャッシュ ----
  const PR = parse(H.props());
  const props = PR.props || {};
  const P = { getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); if (W) queue({ t: 'p', m: 'set', k: k, v: String(v) }); return P; }, deleteProperty: k => { delete props[k]; if (W) queue({ t: 'p', m: 'del', k: k }); return P; },
    getProperties: () => Object.assign({}, props), setProperties: o => { Object.keys(o).forEach(k => P.setProperty(k, o[k])); return P; }, getKeys: () => Object.keys(props), deleteAllProperties: () => P };
  globalThis.PropertiesService = { getScriptProperties: () => P, getUserProperties: () => P, getDocumentProperties: () => P };
  const cache = { tok_app: PR.appToken || '' }; if (PR.userToken) cache.tok_user = PR.userToken;
  const C = { get: k => (k in cache ? cache[k] : (W && (k === 'tok_user' || k === 'tok_app') ? (cache[k] = parse(H.token(k.slice(4))).t || null) : null)), put: (k, v) => { cache[k] = String(v); }, remove: k => { delete cache[k]; }, getAll: ks => { const o = {}; ks.forEach(k => { if (k in cache) o[k] = cache[k]; }); return o; }, putAll: o => { Object.assign(cache, o); }, removeAll: ks => ks.forEach(k => delete cache[k]) };
  globalThis.CacheService = { getScriptCache: () => C, getUserCache: () => C, getDocumentCache: () => C };
  // ---- ネット ----
  function mkBlob(bytes, ct, nm) { const b = { getBytes: () => bytes.slice(), getDataAsString: () => JSON.parse(H.utf8(JSON.stringify(bytes))), getContentType: () => ct, setContentType: x => { ct = x; return b; }, getName: () => nm, setName: x => { nm = x; return b; }, copyBlob: () => mkBlob(bytes, ct, nm) }; return b; }
  function resp(x) { const o = parse(x); let bb = null; const bytes = () => bb || (bb = JSON.parse(H.b64d(o.b64 !== undefined ? o.b64 : H.b64(JSON.stringify(o.text), false)))); return { getContent: () => bytes().slice(), getResponseCode: () => o.code, getContentText: () => o.text, getHeaders: () => o.headers, getAllHeaders: () => o.headers, getBlob: () => mkBlob(bytes(), o.headers['content-type'] || '', 'blob') }; }
  // v250：シートへの書き込みを Google に送るのは、eBay で「何かを変える」問い合わせの前だけ（読むだけの問い合わせの前には送らない＝速くする）。
  //       出品・値段の変更・取り下げ・メッセージの送信などの前には必ず送るので、二重出品を防ぐ記録は今までどおり先に残る
  const mutating = (url, p) => { url = String(url); const hd = p.headers || {}, cn = String(hd['X-EBAY-API-CALL-NAME'] || hd['x-ebay-api-call-name'] || ''), m = String(p.method || 'get').toLowerCase();
    if (cn) return !/^(Get|Find|Search|GeteBay)/.test(cn);           // Trading API：GetXxx は読むだけ
    if (/ebay\.com/i.test(url)) return m !== 'get' && !/\/search|item_summary|identity\/v1\/oauth2\/token/.test(url);   // REST：GET 以外（検索・鍵の取り直しは除く）
    return false; };                                                     // Yahoo!・Claude などは送らない
  globalThis.UrlFetchApp = {
    fetch: (url, p) => { p = p || {}; if (W && mutating(url, p)) flushAll(); const h = Object.assign({}, p.headers || {}); if (p.contentType) h['Content-Type'] = p.contentType;
      let pl = p.payload; if (Array.isArray(pl)) pl = pl.slice(); else if (pl && typeof pl === 'object' && pl.getBytes) pl = pl.getBytes(); else if (pl && typeof pl === 'object') { pl = Object.keys(pl).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(pl[k])).join('&'); if (!h['Content-Type']) h['Content-Type'] = 'application/x-www-form-urlencoded'; }
      const r = resp(H.fetch(String(url), JSON.stringify({ method: p.method || 'get', headers: h, payload: pl })));
      if (!p.muteHttpExceptions && r.getResponseCode() >= 400) throw new Error('Request failed for ' + url + ' returned code ' + r.getResponseCode());
      return r; },
    fetchAll: reqs => reqs.map(q => globalThis.UrlFetchApp.fetch(q.url, Object.assign({}, q, { muteHttpExceptions: true }))),
  };
  // ---- そのほか ----
  const pad = (n, w) => String(n).padStart(w, '0');
  function partsIn(d, tz) { const f = new Intl.DateTimeFormat('en-US', { timeZone: tz || 'Asia/Tokyo', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', weekday: 'short', hourCycle: 'h23' });
    const o = {}; f.formatToParts(d).forEach(x => o[x.type] = x.value); return o; }
  globalThis.Utilities = {
    formatDate: (d, tz, fmt) => { const o = partsIn(new Date(d), tz); const y = Number(o.year), M = Number(o.month), D = Number(o.day), h = Number(o.hour) % 24, m = Number(o.minute), s = Number(o.second);
      return String(fmt).replace(/yyyy|yy|MM|M|dd|d|HH|H|mm|ss|EEE|E|'([^']*)'/g, t => ({ yyyy: y, yy: pad(y % 100, 2), MM: pad(M, 2), M: M, dd: pad(D, 2), d: D, HH: pad(h, 2), H: h, mm: pad(m, 2), ss: pad(s, 2), EEE: o.weekday, E: o.weekday })[t] ?? t.replace(/'/g, '')); },
    sleep: ms => H.sleep(ms), getUuid: () => H.uuid(),
    computeDigest: (alg, s) => JSON.parse(H.digest(String(alg), String(s))),
    base64Encode: s => H.b64(JSON.stringify(s), false), base64EncodeWebSafe: s => H.b64(JSON.stringify(s), true), base64Decode: s => JSON.parse(H.b64d(String(s))), newBlob: (s, ct, nm) => mkBlob(Array.isArray(s) ? s.slice() : JSON.parse(H.b64d(H.b64(JSON.stringify(String(s == null ? '' : s)), false))), ct || 'text/plain', nm || 'blob'),
    parseCsv: s => String(s).split(/\r?\n/).map(l => l.split(',')),
    DigestAlgorithm: { MD5: 'md5', SHA_1: 'sha1', SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
  };
  const LK = { tryLock: () => true, waitLock: () => {}, releaseLock: () => {}, hasLock: () => true };
  globalThis.LockService = { getScriptLock: () => LK, getDocumentLock: () => LK, getUserLock: () => LK };
  globalThis.Session = { getEffectiveUser: () => ({ getEmail: () => '' }), getActiveUser: () => ({ getEmail: () => '' }), getScriptTimeZone: () => 'Asia/Tokyo' };
  globalThis.ScriptApp = new Proxy({ getProjectTriggers: () => [], deleteTrigger: () => {} }, { get: (t, k) => k in t ? t[k] : chain() });
  globalThis.MailApp = { sendEmail: (...a) => { if (W) queue({ t: 'mail', a: a }); else H.log('（メールは送らない）'); }, getRemainingDailyQuota: () => 100 }; globalThis.GmailApp = chain();
  globalThis.Logger = { log: x => H.log(String(x)) }; globalThis.console = { log: x => H.log(String(x)), error: x => H.log(String(x)) };
  globalThis.ContentService = { createTextOutput: s => ({ setMimeType: function () { return this; }, getContent: () => s }), MimeType: { JSON: 'json', TEXT: 'text' } };
  // v247：XmlService（eBay の Trading API の返事を読む）・LanguageApp（翻訳は Google に頼む）
  const xdec = t => String(t).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(Number(d))).replace(/&amp;/g, '&');
  function xparse(src) {
    const root = { children: [] }, stack = [root];
    const re = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/([^\s>]+)\s*>|<([^\s>\/!?]+)((?:\s+[^\s=>\/]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
    let m; src = String(src).replace(/^﻿/, '');
    while ((m = re.exec(src))) { const top = stack[stack.length - 1];
      if (m[1] !== undefined) top.children.push({ t: m[1] });
      else if (m[2]) { if (stack.length > 1) stack.pop(); }
      else if (m[3]) { const el = { name: m[3].replace(/^.*:/, ''), attrs: {}, children: [] }; (m[4] || '').replace(/([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g, (x, k, q, a, b) => { el.attrs[k] = xdec(a !== undefined ? a : b); }); top.children.push(el); if (!m[5]) stack.push(el); }
      else if (m[6] !== undefined) top.children.push({ t: xdec(m[6]) });
    }
    return root.children.find(c => c.name);
  }
  function xel(e) { if (!e) return null; const kids = () => e.children.filter(c => c.name), txt = n => n.children.filter(c => c.t !== undefined).map(c => c.t).join(''), val = n => n.children.map(c => c.t !== undefined ? c.t : val(c)).join('');
    const o = { getName: () => e.name, getText: () => txt(e), getTextTrim: () => txt(e).trim(), getValue: () => val(e), getNamespace: () => ({ getURI: () => e.attrs.xmlns || '', getPrefix: () => '' }),
      getChild: n => xel(kids().find(c => c.name === n)), getChildren: n => (n ? kids().filter(c => c.name === n) : kids()).map(xel),
      getChildText: n => { const c = kids().find(x => x.name === n); return c ? txt(c) : null; },
      getAttribute: n => (n in e.attrs ? { getValue: () => e.attrs[n], getName: () => n } : null), getAttributes: () => Object.keys(e.attrs).map(k => ({ getName: () => k, getValue: () => e.attrs[k] })),
      getContentSize: () => e.children.length };
    return o; }
  globalThis.XmlService = { parse: s => { const r = xel(xparse(s)); if (!r) throw new Error('XMLを読めない'); return { getRootElement: () => r }; }, getNamespace: (a, b) => ({ getURI: () => (b !== undefined ? b : a), getPrefix: () => (b !== undefined ? a : '') }) };
  globalThis.LanguageApp = { translate: (t, f, to) => (H.mode() === 'w' ? parse(H.tr(JSON.stringify([String(t), String(f || ''), String(to || 'ja')]))).t || '' : '') };
  globalThis.HtmlService = chain(); globalThis.DriveApp = chain(); globalThis.Drive = chain();
  globalThis.__flush = flushAll; globalThis.__opsLeft = () => OPS.length;
  globalThis.__appended = appended; globalThis.__parse = parse; globalThis.__set = a => new Set(a || []);
})();
`;

function load(codePath, gas, opts) {
  opts = opts || {};
  const meta = gas({ kind: 'ghxmeta' });
  if (meta.error) throw new Error('ghxmeta：' + meta.error + '（v238 をデプロイしたか確かめてください）');
  const pr = opts.secrets || gas({ kind: 'ghxprops' });
  if (pr.error) throw new Error('ghxprops：' + pr.error);
  let calls = 0;
  const host = {
    meta: () => JSON.stringify(meta), props: () => JSON.stringify(pr), mode: () => (opts.write ? 'w' : ''),
    write: ops => { calls++; const x = gas({ kind: 'ghxwrite', ops: JSON.parse(ops) }); if (x.error) throw new Error('ghxwrite：' + x.error); return JSON.stringify(x); },
    token: k => JSON.stringify(gas({ kind: 'ghxtoken', k: k })),
    tr: j => { const a = JSON.parse(j); return JSON.stringify(gas({ kind: 'ghxtr', t: a[0], f: a[1], to: a[2] })); },
    utf8: j => JSON.stringify(Buffer.from(JSON.parse(j).map(x => x & 255)).toString('utf8')),
    meta2: id => JSON.stringify(gas({ kind: 'ghxmeta', ssid: id })),
    range2: (id, sheet, r, c, nr, nc, kind) => { calls++; const x = gas({ kind: 'ghxrange', ssid: id, reqs: [{ id: 1, sheet: sheet, r: r, c: c, nr: nr, nc: nc, display: kind === 'display' }] }); const o = (x.ranges || [])[0] || {}; return o.missing || o.tooBig ? null : JSON.stringify(o); },
    range: (sheet, r, c, nr, nc, kind) => { calls++; const x = gas({ kind: 'ghxrange', reqs: [{ id: 1, sheet: sheet, r: r, c: c, nr: nr, nc: nc, display: kind === 'display', links: kind === 'links' }] }); const o = (x.ranges || [])[0] || {}; return o.missing || o.tooBig ? null : JSON.stringify(o); },
    fetch: (url, p) => { const o = JSON.parse(p); const r = curl(url, { method: o.method, headers: o.headers, payload: o.payload, timeout: o.timeout }); return JSON.stringify(r); },
    sleep: ms => sleepMs(ms), uuid: () => crypto.randomUUID(),
    digest: (alg, s) => JSON.stringify(Array.from(crypto.createHash(alg).update(s, 'utf8').digest()).map(b => b > 127 ? b - 256 : b)),
    b64: (j, web) => { const v = JSON.parse(j); const b = Array.isArray(v) ? Buffer.from(v.map(x => x & 255)) : Buffer.from(String(v), 'utf8'); const t = b.toString('base64'); return web ? t.replace(/\+/g, '-').replace(/\//g, '_') : t; }, b64d: s => JSON.stringify(Array.from(Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')).map(x => x > 127 ? x - 256 : x)), log: s => console.log('  [ツール] ' + s),
  };
  const ctx = vm.createContext({ __host: host });
  vm.runInContext(INSIDE, ctx, { filename: 'gasshim-inside.js' });
  vm.runInContext(fs.readFileSync(codePath, 'utf8'), ctx, { filename: 'コード.gs' });
  ctx.__calls = () => calls;
  return ctx;
}

module.exports = { load, curl, makeGas, sleepMs };
