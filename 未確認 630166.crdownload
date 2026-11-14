# GitHubの地引網（ポケカ専門店）
# Yahoo!フリマ・ヤフオク（即決）のページを、人が見る速さで開いて、
# そのページをそのまま Googleのツール（スプレッドシート）に送るだけのプログラムです。
# 何を探すか・判定・候補シートへの書き込みは、すべて Googleのツール側でやります。
# 出品・購入・ログインはしません。
import json, os, random, sys, time, urllib.parse, urllib.request

GAS_URL = os.environ.get("GAS_URL", "").strip()
GAS_TOKEN = os.environ.get("GAS_TOKEN", "").strip()
SMALL = os.environ.get("SMALL", "") == "1"          # 手で動かしたときの試し（少しだけ）
MAX_SEARCH = 4 if SMALL else int(os.environ.get("MAX_SEARCH", "24"))
MAX_PAGES = 3 if SMALL else int(os.environ.get("MAX_PAGES", "20"))
MINUTES = 25                                          # 1回の実行は最大25分
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      "Accept-Language": "ja"}
BLOCK = (403, 429, 503, 999)


def gas(data):
    body = urllib.parse.urlencode({"token": GAS_TOKEN, "data": json.dumps(data, ensure_ascii=False)}).encode("utf-8")
    req = urllib.request.Request(GAS_URL, data=body, headers={"Content-Type": "application/x-www-form-urlencoded"})
    with urllib.request.urlopen(req, timeout=300) as r:
        txt = r.read().decode("utf-8", "replace")
    try:
        return json.loads(txt)
    except Exception:
        raise SystemExit("Googleのツールの返事が読めません（デプロイを新しいバージョンにしたか、GAS_URL・GAS_TOKEN を確かめてください）: " + txt[:300])


def fetch(url):
    try:
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, ""
    except Exception as e:
        return 0, str(e)[:200]


def rest():
    time.sleep(random.uniform(20, 30))                # ページの間は20〜30秒あける


def main():
    if not GAS_URL or not GAS_TOKEN:
        raise SystemExit("GitHub の Secrets に GAS_URL と GAS_TOKEN を入れてください")
    t_end = time.time() + MINUTES * 60
    plan = gas({"kind": "ghq", "max": MAX_SEARCH, "maxPages": MAX_PAGES})
    if plan.get("stop"):
        print("今回は動かしません：", plan["stop"]); return
    searches, pages_left = plan.get("searches", []), int(plan.get("maxPages", MAX_PAGES))
    done = {"searches": 0, "pages": 0, "blocked": ""}
    print("検索", len(searches), "件・商品ページは最大", pages_left, "回")
    for s in searches:
        if time.time() > t_end or done["blocked"]:
            break
        code, html = fetch(s["url"]); done["searches"] += 1
        print(s["siteName"], s["q"], "HTTP", code, len(html), "文字")
        if code in BLOCK:
            done["blocked"] = "検索ページ HTTP %d" % code
            gas({"kind": "ghblock", "why": done["blocked"]}); break
        r = gas({"kind": "ghsearch", "i": s, "code": code, "html": html if code == 200 else ""})
        print("  読めた", r.get("found", 0), "品・商品ページを見る", len(r.get("pages", [])), "品")
        rest()
        for p in r.get("pages", []):
            if pages_left <= 0 or time.time() > t_end:
                break
            code, html = fetch(p["url"]); pages_left -= 1; done["pages"] += 1
            if code in BLOCK:
                done["blocked"] = "商品ページ HTTP %d" % code
                gas({"kind": "ghblock", "why": done["blocked"]}); break
            a = gas({"kind": "ghpage", "p": p, "code": code, "html": html if code == 200 else ""})
            print("   ", p["title"][:40], p["price"], "円 →", a.get("result", ""))
            rest()
    gas({"kind": "ghdone", "done": done})
    print("おわり", done)


if __name__ == "__main__":
    main()
