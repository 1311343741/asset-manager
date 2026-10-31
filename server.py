# -*- coding: utf-8 -*-
"""
资产管家 · 行情数据服务
纯 Python 标准库实现：东方财富行情代理（限流 + 重试 + 磁盘缓存）+ 静态站点托管
"""
import argparse
import datetime
import hashlib
import json
import math
import os
import random
import secrets
import sys
import threading
import time
import urllib.parse
import urllib.request
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

# ---------------------------------------------------------------- 访问控制
AUTH_USER = os.environ.get("AUTH_USER", "admin")
AUTH_PASS = os.environ.get("AUTH_PASS", "12345678")
AUTH_SALT = "asset-manager-2026"
AUTH_ENABLED = os.environ.get("AUTH", "1") != "0"
COOKIE_NAME = "am_session"
_SESSION_SECRET = secrets.token_hex(16)


def _cred_hash(user, password):
    """与登录页本地校验使用同一算法，保证有/无后端两种模式一致"""
    return hashlib.sha256(("%s:%s:%s" % (AUTH_SALT, user, password)).encode()).hexdigest()


AUTH_HASH = _cred_hash(AUTH_USER, AUTH_PASS)
SESSION_TOKEN = hashlib.sha256((AUTH_HASH + ":" + _SESSION_SECRET).encode()).hexdigest()

# 未登录也可访问：登录页本身 + 它依赖的静态资源
PUBLIC_PATHS = ("/login.html", "/css/", "/js/", "/vendor/", "/data/", "/api/health")

BASE = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE, "static")
CACHE_DIR = os.path.join(BASE, "data", "cache")
os.makedirs(CACHE_DIR, exist_ok=True)

PORT = int(os.environ.get("PORT", "8765"))
# 监听地址：默认只本机；要对外（局域网 / 内网穿透 / 公网部署）请设 BIND=0.0.0.0
BIND = os.environ.get("BIND", "127.0.0.1")

UA = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/122.0 Safari/537.36",
    "Referer": "https://quote.eastmoney.com/",
    "Accept": "*/*",
}

KLT = {"day": 101, "week": 102, "month": 103}

# ---------------------------------------------------------------- 网络层
_net_lock = threading.Lock()
_last_req = [0.0]
MIN_GAP = 0.35          # 全局最小请求间隔，规避风控


def _throttle():
    with _net_lock:
        gap = time.time() - _last_req[0]
        if gap < MIN_GAP:
            time.sleep(MIN_GAP - gap)
        _last_req[0] = time.time()


def fetch_json(url, retry=6, timeout=20):
    """带退避重试的 JSON 拉取。东财对高频请求会直接断连，退避必须足够长。"""
    last = None
    for i in range(retry):
        _throttle()
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read().decode("utf-8", "ignore"))
        except Exception as e:          # noqa
            last = e
            if i < retry - 1:
                # 约 1.5 / 3.8 / 6.6 / 9.9 / 13.7 秒，带抖动避免整齐重试
                time.sleep(1.5 * (i + 1) + i * 0.8 + (time.time() % 0.7))
    raise RuntimeError("上游请求失败: %s" % last)


def _cache_path(secid, klt):
    safe = secid.replace(".", "_").replace("/", "_")
    return os.path.join(CACHE_DIR, "%s_%s.json" % (safe, klt))


CACHE_MAX_AGE_HOURS = 24        # 指数/ETF 收盘价一天一变，24 小时足够新鲜
_last_user_req = [0.0]          # 最近一次用户请求时间，供预热线程让路


def _read_cache(secid, klt, max_age_hours=None):
    p = _cache_path(secid, klt)
    if not os.path.exists(p):
        return None
    if max_age_hours is None:
        max_age_hours = CACHE_MAX_AGE_HOURS
    if time.time() - os.path.getmtime(p) > max_age_hours * 3600:
        return None
    try:
        with open(p, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def _write_cache(secid, klt, payload):
    try:
        with open(_cache_path(secid, klt), "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
    except Exception:
        pass


def fetch_kline(secid, klt=101, force=False, retry=3):
    """
    拉取全量历史 K 线（收盘价序列），带磁盘缓存。
    网络失败时降级到「过期缓存」——避免缓存刚过期就遇上东财限流，导致用户干等重试。
    """
    if not force:
        c = _read_cache(secid, klt)
        if c and c.get("close"):
            return c
    stale = None if force else _read_cache(secid, klt, max_age_hours=CACHE_MAX_AGE_HOURS * 400)
    url = ("https://push2his.eastmoney.com/api/qt/stock/kline/get?"
           "secid=%s&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f53&"
           "klt=%s&fqt=1&beg=19700101&end=20501231&lmt=100000" % (urllib.parse.quote(secid), klt))
    try:
        data = fetch_json(url, retry=retry)
    except Exception:
        if stale and stale.get("close"):
            # 取数失败但有过旧缓存：先顶上，并刷新 mtime，
            # 否则每次请求都会重新去撞限流，用户一直干等。
            stale["staleServed"] = int(time.time())
            _write_cache(secid, klt, stale)
            return stale
        raise
    node = data.get("data") or {}
    klines = node.get("klines") or []
    dates, close = [], []
    for line in klines:
        parts = line.split(",")
        if len(parts) < 2:
            continue
        try:
            v = float(parts[1])
        except ValueError:
            continue
        if v <= 0:
            continue
        dates.append(parts[0])
        close.append(v)
    out = {
        "secid": secid,
        "name": node.get("name") or secid,
        "dates": dates,
        "close": close,
        "updated": int(time.time()),
    }
    if not dates and stale and stale.get("close"):
        return stale
    if dates:
        _write_cache(secid, klt, out)
    return out


def norm_date(s):
    """把 8 位紧凑日期 20210101 规范为 2021-01-01，与 K 线日期格式一致"""
    if not s:
        return None
    s = str(s).strip()
    if len(s) == 8 and s.isdigit():
        return s[:4] + "-" + s[4:6] + "-" + s[6:]
    return s


def slice_series(series, start=None, end=None):
    dates, close = series["dates"], series["close"]
    idx = range(len(dates))
    if start:
        idx = [i for i in idx if dates[i] >= start]
    if end:
        idx = [i for i in idx if dates[i] <= end]
    return [dates[i] for i in idx], [close[i] for i in idx]


# ---------------------------------------------------------------- 数据降级 + 回溯补全
_SNAPSHOT_CACHE = {"mtime": 0, "data": None}
SNAPSHOT_PATH = os.path.join(BASE, "static", "data", "snapshot.json")
_CAL_BASE = datetime.date(2000, 1, 1)


def proxy_of(secid):
    it = _ALL_ITEMS.get(secid)
    return it.get("proxy") if it else None


def synth_of(secid):
    it = _ALL_ITEMS.get(secid)
    return it.get("synth") if it else None


def _load_snapshot():
    """读取离线快照（static/data/snapshot.json）"""
    if not os.path.exists(SNAPSHOT_PATH):
        return None
    mt = os.path.getmtime(SNAPSHOT_PATH)
    if _SNAPSHOT_CACHE["data"] is not None and _SNAPSHOT_CACHE["mtime"] == mt:
        return _SNAPSHOT_CACHE["data"]
    try:
        with open(SNAPSHOT_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        _SNAPSHOT_CACHE["data"] = data
        _SNAPSHOT_CACHE["mtime"] = mt
        return data
    except Exception:
        return None


def snapshot_series(secid):
    snap = _load_snapshot()
    if not snap or secid not in (snap.get("series") or {}):
        return None
    s = snap["series"][secid]
    # 注意全部转字符串：早期这里第一个日期是 date 对象、其余是 str，
    # 混在同一个列表里，一旦拿去做 `need_start <= d` 比较就会抛
    # "'>' not supported between instances of 'datetime.date' and 'str'"
    dates = [(_CAL_BASE + datetime.timedelta(days=s["d0"])).isoformat()]
    cur = s["d0"]
    for step in s["days"]:
        cur += step
        dates.append((_CAL_BASE + datetime.timedelta(days=cur)).isoformat())
    return {"secid": secid, "name": s["name"], "dates": dates, "close": s["close"]}


def _meta(secid, name, dates, close, source, real_start, proxy=None, note=None):
    return {
        "secid": secid, "name": name, "dates": dates, "close": close,
        "source": source,             # real | cached | snapshot | mixed | proxy | synthetic
        "realStart": real_start,      # 真实数据的起始日；None 表示整段均为估计值
        "proxyName": proxy,
        "note": note,
    }


def backfill_with_proxy(real, proxy, need_start):
    """用代理资产的真实日收益，把序列向前回溯到 need_start，并与真实段无缝衔接"""
    p_dates, p_close = proxy["dates"], proxy["close"]
    d0 = real["dates"][0]
    k = j = None
    for i in range(len(p_dates) - 1, -1, -1):
        if p_dates[i] < d0:
            k = i
            break
    for i in range(len(p_dates)):
        if p_dates[i] >= need_start:
            j = i
            break
    if k is None or j is None or j > k - 1:
        return None, None
    n = k - j + 1
    q = [0.0] * n
    q[n - 1] = float(real["close"][0])
    for i in range(k, j, -1):
        prev = q[i - j] * p_close[i - 1] / p_close[i]
        q[i - j - 1] = prev if prev > 0 else q[i - j]
    return p_dates[j:k + 1] + list(real["dates"]), q + list(real["close"])


def backfill_with_synth(real, need_start, prof, calendar):
    """无代理时，按参数化随机游走向前回溯"""
    if not prof or not calendar:
        return None, None
    idx = [d for d in calendar if need_start <= d < real["dates"][0]]
    if len(idx) < 40:
        return None, None
    mu_d = prof["mu"] / 252.0
    sd_d = prof["sigma"] / math.sqrt(252.0)
    rng = random.Random(abs(hash(real["secid"])) % (2 ** 31))
    q = [0.0] * len(idx)
    q[-1] = float(real["close"][0])
    for i in range(len(idx) - 1, 0, -1):
        r = rng.gauss(mu_d, sd_d)
        q[i - 1] = q[i] / max(0.5, 1.0 + r)
    # 与真实段拼接（idx 的最后一天严格早于真实起点）
    return idx + list(real["dates"]), q + list(real["close"])


_SERIES_MEM = {}      # (secid, klt, need_start) -> (ts, result)，1 小时内复用


def get_series(secid, klt=101, need_start=None, _depth=0):
    """带内存缓存的入口：回测反复用同一区间时不必重复做补全计算"""
    key = (secid, klt, need_start)
    hit = _SERIES_MEM.get(key)
    if hit and time.time() - hit[0] < 3600:
        return dict(hit[1])
    res = _get_series(secid, klt, need_start, _depth)
    _SERIES_MEM[key] = (time.time(), res)
    return dict(res)


def _get_series(secid, klt=101, need_start=None, _depth=0):
    """
    获取日线序列，并尽量补足到 need_start。
    降级链：实时 -> 过期缓存 -> 离线快照 -> 代理回溯 / 参数化补全 -> 整段代理
    """
    real, src = None, None
    try:
        real = fetch_kline(secid, klt)
        if not real.get("close"):
            real = None
        else:
            src = "real"
    except Exception:
        real = None
    if real is None:                                     # 1) 过期缓存
        c = _read_cache(secid, klt, max_age_hours=10 ** 7)
        if c and c.get("close"):
            real, src = c, "cached"
    if real is None:                                     # 2) 离线快照
        s = snapshot_series(secid)
        if s and s.get("close"):
            real, src = s, "snapshot"

    if real is None:                                     # 3) 完全没有真实数据
        if _depth < 2:
            pid = proxy_of(secid)
            if pid and pid != secid:
                p = get_series(pid, klt, None, _depth + 1)
                if p and p["close"]:
                    return _meta(secid, catalog_name(secid) or secid, p["dates"], p["close"],
                                 "proxy", None, p["name"],
                                 "取数失败，整段沿用「%s」的历史走势" % p["name"])
        return None

    real_start = real["dates"][0]
    need = need_start and real_start > need_start
    if not need or _depth >= 2:
        return _meta(secid, real["name"], real["dates"], real["close"], src, real_start,
                     None, None if not need else "历史数据仅到 %s，更早区间缺失" % real_start)

    # 4) 历史不足：先试代理回溯（代理自身若也不足，会递归补全）
    #    只要代理比本资产更早，就值得拿它来回溯一段
    pid = proxy_of(secid)
    if pid and pid != secid:
        p = get_series(pid, klt, need_start=need_start, _depth=_depth + 1)
        if p and p["dates"] and p["dates"][0] < real_start:
            dt, cl = backfill_with_proxy(real, p, need_start)
            if dt:
                return _meta(secid, real["name"], dt, cl, "mixed", real_start, p["name"],
                             "早于 %s 为模拟（沿用「%s」真实走势回溯）" % (real_start, p["name"]))

    # 5) 再退化：按画像做参数化补全
    prof = SYNTH_PROFILE.get(synth_of(secid) or "")
    cal = None
    if prof:
        ref = get_series("1.000300", klt, None, _depth + 1)      # 借 A 股日历
        cal = (ref or {}).get("dates")
    if prof and cal:
        dt, cl = backfill_with_synth(real, need_start, prof, cal)
        if dt:
            return _meta(secid, real["name"], dt, cl, "mixed", real_start, prof["label"],
                         "早于 %s 为模拟（按「%s」随机游走合成）" % (real_start, prof["label"]))

    return _meta(secid, real["name"], real["dates"], real["close"], src, real_start,
                 None, "历史数据仅到 %s，更早区间缺失" % real_start)


# ---------------------------------------------------------------- 资产目录
# proxy：历史数据偏短时，用哪个标的的真实走势向前回溯补全
# synth：无合适代理时，按参数化随机游走补全
CATALOG = [
    {"group": "A股 · 宽基指数", "color": "#e5484d", "items": [
        {"secid": "1.000300", "name": "沪深300"},
        {"secid": "1.000510", "name": "中证A500"},
        {"secid": "2.930050", "name": "中证A50", "proxy": "1.000300"},
        {"secid": "1.000016", "name": "上证50"},
        {"secid": "1.000905", "name": "中证500"},
        {"secid": "1.000852", "name": "中证1000"},
        {"secid": "0.399006", "name": "创业板指"},
        {"secid": "1.000688", "name": "科创50", "proxy": "0.399006"},
        {"secid": "0.399001", "name": "深证成指"},
        {"secid": "0.899050", "name": "北证50", "proxy": "1.000852"},
    ]},
    {"group": "A股 · 红利/策略", "color": "#f5a524", "items": [
        {"secid": "1.000922", "name": "中证红利"},
        {"secid": "1.000015", "name": "上证红利"},
        {"secid": "1.510880", "name": "红利ETF（华泰柏瑞）"},
        {"secid": "1.512890", "name": "红利低波ETF（华泰柏瑞）", "proxy": "1.510880"},
    ]},
    {"group": "中国香港股市", "color": "#0090ff", "items": [
        {"secid": "100.HSI", "name": "恒生指数"},
        {"secid": "124.HSTECH", "name": "恒生科技指数", "proxy": "100.HSI"},
        {"secid": "100.HSCEI", "name": "恒生国企指数"},
        {"secid": "124.HSHDYI", "name": "恒生高股息率指数"},
    ]},
    {"group": "美国股市", "color": "#8b5cf6", "items": [
        {"secid": "100.NDX100", "name": "纳斯达克100", "proxy": "100.NDX"},
        {"secid": "100.NDX", "name": "纳斯达克综合指数"},
        {"secid": "100.SPX", "name": "标普500"},
        {"secid": "100.DJIA", "name": "道琼斯工业指数"},
    ]},
    {"group": "黄金 / 商品", "color": "#d4a72c", "items": [
        {"secid": "122.XAU", "name": "伦敦金（美元/盎司）"},
        {"secid": "101.GC00Y", "name": "COMEX黄金"},
        {"secid": "1.518880", "name": "黄金ETF（人民币计价）", "proxy": "122.XAU"},
        {"secid": "122.XAG", "name": "伦敦银（美元/盎司）"},
        {"secid": "102.CL00Y", "name": "NYMEX原油"},
    ]},
    {"group": "债券 / 固收", "color": "#12a594", "items": [
        {"secid": "1.511260", "name": "十年国债ETF", "synth": "bond"},
        {"secid": "1.511090", "name": "30年国债ETF", "proxy": "1.511260"},
    ]},
    {"group": "现金类（无行情，按固定利率）", "color": "#64748b", "items": [
        {"secid": "CASH", "name": "现金 / 活期", "fixed": 0.30},
        {"secid": "DEP1", "name": "定期存款 / 大额存单", "fixed": 2.00},
        {"secid": "MMF", "name": "货币基金 / 理财", "fixed": 1.80},
    ]},
]

# 参数化合成画像：年化收益 / 年化波动
SYNTH_PROFILE = {
    "bond": {"mu": 0.035, "sigma": 0.030, "label": "中债利率债典型走势"},
}

_ALL_ITEMS = {}
for _g in CATALOG:
    for _it in _g["items"]:
        _ALL_ITEMS[_it["secid"]] = _it


def is_fixed(secid):
    for g in CATALOG:
        for it in g["items"]:
            if it["secid"] == secid:
                return it.get("fixed")
    return None


def catalog_name(secid):
    for g in CATALOG:
        for it in g["items"]:
            if it["secid"] == secid:
                return it["name"]
    return None


def search_asset(keyword):
    url = ("https://searchapi.eastmoney.com/api/suggest/get?input=%s&type=14"
           "&token=D43BF722C8E33BDC906FB84D85E326E8&count=12"
           % urllib.parse.quote(keyword))
    data = fetch_json(url, retry=3)
    rows = (data.get("QuotationCodeTable") or {}).get("Data") or []
    out = []
    for r in rows:
        code, mkt = r.get("Code"), r.get("MktNum")
        if not code or not mkt:
            continue
        t = r.get("SecurityTypeName") or ""
        if t not in ("指数", "基金", "ETF", "美股", "港股", "期货", "现货"):
            continue
        out.append({"secid": "%s.%s" % (mkt, code), "name": r.get("Name"),
                    "code": code, "type": t})
    return out


def realtime_quotes(secids):
    url = ("https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&secids=%s"
           "&fields=f12,f13,f14,f2,f3,f4" % urllib.parse.quote(",".join(secids)))
    data = fetch_json(url, retry=3)
    return (data.get("data") or {}).get("diff") or []


# ---------------------------------------------------------------- HTTP
class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=STATIC_DIR, **kw)

    def log_message(self, fmt, *args):
        sys.stderr.write("[%s] %s\n" % (time.strftime("%H:%M:%S"), fmt % args))

    def _send(self, obj, code=200, headers=None):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        if headers:
            for k, v in headers.items():
                self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _send_static(self, path):
        try:
            full = os.path.join(STATIC_DIR, path.lstrip("/"))
            with open(full, "rb") as f:
                body = f.read()
            ctype = "text/html; charset=utf-8"
            if full.endswith(".css"):
                ctype = "text/css; charset=utf-8"
            elif full.endswith(".js"):
                ctype = "application/javascript; charset=utf-8"
            elif full.endswith(".svg"):
                ctype = "image/svg+xml"
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except Exception:
            self.send_error(404)

    # ---- 访问控制 ----
    def _authed(self):
        if not AUTH_ENABLED:
            return True
        cookie = self.headers.get("Cookie") or ""
        return ("%s=%s" % (COOKIE_NAME, SESSION_TOKEN)) in cookie

    def _redirect(self, loc):
        self.send_response(302)
        self.send_header("Location", loc)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _guard(self, path):
        """返回 True 表示请求被拦截（已响应）"""
        if not AUTH_ENABLED or self._authed():
            return False
        if path == "/" or path == "" or path == "/index.html":
            self._redirect("/login.html")
            return True
        if not path.startswith(PUBLIC_PATHS):
            if path.startswith("/api/"):
                self._send({"error": "unauthorized", "needLogin": True}, 401)
            else:
                self._redirect("/login.html")
            return True
        return False

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        try:
            ln = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            ln = 0
        raw = self.rfile.read(ln) if ln else b""
        try:
            body = json.loads(raw.decode("utf-8", "ignore")) if raw else {}
        except Exception:
            body = {}

        if path == "/api/login":
            user = str(body.get("user") or "").strip()
            password = str(body.get("pass") or "")
            if user == AUTH_USER and _cred_hash(user, password) == AUTH_HASH:
                # HttpOnly：会话标记不可被 JS 读取；登录页会另外写入 sessionStorage
                self._send({"ok": True, "user": user}, 200, {
                    "Set-Cookie": "%s=%s; Path=/; Max-Age=%d; HttpOnly; SameSite=Lax"
                                  % (COOKIE_NAME, SESSION_TOKEN, 7 * 86400),
                })
            else:
                self._send({"ok": False, "error": "用户名或密码错误"}, 401)
            return

        if path == "/api/logout":
            self._send({"ok": True}, 200,
                       {"Set-Cookie": "%s=; Path=/; Max-Age=0" % COOKIE_NAME})
            return

        if self._guard(path):
            return
        self._send({"error": "unknown api"}, 404)

    def do_GET(self):
        _last_user_req[0] = time.time()      # 预热线程据此让路
        parsed = urllib.parse.urlparse(self.path)
        path, qs = parsed.path, urllib.parse.parse_qs(parsed.query)
        one = lambda k, d=None: (qs.get(k) or [d])[0]

        if self._guard(path):
            return

        try:
            if path == "/" or path == "":
                return self._send_static("index.html")

            if path == "/api/health":
                return self._send({"ok": True, "ts": int(time.time())})

            if path == "/api/catalog":
                return self._send({"catalog": CATALOG})

            if path == "/api/search":
                kw = one("q", "")
                if not kw:
                    return self._send({"results": []})
                try:
                    return self._send({"results": search_asset(kw)})
                except Exception as e:
                    return self._send({"results": [], "error": str(e)})

            if path == "/api/kline":
                secid = one("secid")
                klt = KLT.get(one("period", "day"), 101)
                if not secid:
                    return self._send({"error": "missing secid"}, 400)
                start, end = norm_date(one("start")), norm_date(one("end"))
                s = get_series(secid, klt, need_start=start)
                if not s:
                    return self._send({"error": "无可用数据"}, 502)
                d, c = slice_series(s, start, end)
                return self._send({"secid": secid, "name": s["name"],
                                   "dates": d, "close": c,
                                   "full": len(s["dates"]),
                                   "source": s["source"], "realStart": s["realStart"],
                                   "proxyName": s["proxyName"], "note": s["note"],
                                   "updated": int(time.time())})

            if path == "/api/batch":
                secids = [x for x in (one("secids", "") or "").split(",") if x]
                klt = KLT.get(one("period", "day"), 101)
                start, end = norm_date(one("start")), norm_date(one("end"))
                out, errors = {}, {}
                for sid in secids:
                    try:
                        s = get_series(sid, klt, need_start=start)
                        if not s:
                            errors[sid] = "无可用数据"
                            continue
                        d, c = slice_series(s, start, end)
                        out[sid] = {
                            "name": s["name"], "dates": d, "close": c,
                            "full": len(s["dates"]),
                            "source": s["source"], "realStart": s["realStart"],
                            "proxyName": s["proxyName"], "note": s["note"],
                        }
                    except Exception as e:
                        errors[sid] = str(e)
                return self._send({"series": out, "errors": errors})

            if path == "/api/diag":
                return self._send({"items": diagnose()})

            if path == "/api/quote":
                secids = [x for x in (one("secids", "") or "").split(",") if x]
                try:
                    return self._send({"quotes": realtime_quotes(secids)})
                except Exception as e:
                    return self._send({"quotes": [], "error": str(e)})

            if path.startswith("/api/"):
                return self._send({"error": "unknown api"}, 404)

            return self._send_static(path)
        except Exception as e:
            return self._send({"error": str(e)}, 500)


def warmup(rounds=2):
    """
    后台预热：逐个拉取目录内标的填充磁盘缓存。
    东财对高频请求会断连，预热用慢速串行 + 多轮重试，
    让用户真正点「开始回测」时大概率命中缓存，不再出现“拉不出来”。
    """
    def run():
        try:
            ids = []
            for g in CATALOG:
                for it in g["items"]:
                    if it.get("fixed") is not None:
                        continue
                    ids.append(it["secid"])
            for rnd in range(rounds):
                todo = []
                for sid in ids:
                    c = _read_cache(sid, 101)
                    if c and c.get("close"):
                        continue
                    # 用户在操作时主动让路，别抢限速器
                    while time.time() - _last_user_req[0] < 8:
                        time.sleep(2)
                    try:
                        s = fetch_kline(sid, 101, retry=2)
                        if not s.get("close"):
                            todo.append(sid)
                    except Exception:
                        todo.append(sid)
                    time.sleep(1.2)
                ids = todo
                if not ids:
                    break
                if rnd < rounds - 1:
                    time.sleep(25)
            if ids:
                print("[warmup] 完成，仍有 %d 项未取到（会走降级）：%s" % (len(ids), ",".join(ids)))
            else:
                print("[warmup] 完成，全部标的已缓存")
        except Exception as e:
            print("[warmup] 异常：%s" % e)

    if os.environ.get("WARMUP", "1") == "0":
        return
    threading.Thread(target=run, daemon=True).start()


def diagnose():
    """
    逐个体检标的数据状况，用于排查“拉不出来 / 数据不完整”。
    只读本地（磁盘缓存 + 离线快照），绝不触发联网——否则遇上东财限流，
    每个标的都要等满重试，整个接口会卡死几分钟。
    """
    out = []
    for g in CATALOG:
        for it in g["items"]:
            secid = it["secid"]
            if it.get("fixed") is not None:
                out.append({"secid": secid, "name": it["name"], "group": g["group"],
                            "kind": "fixed", "rate": it["fixed"], "ok": True})
                continue
            pid = proxy_of(secid)
            rec = {"secid": secid, "name": it["name"], "group": g["group"], "kind": "series",
                   "proxyName": catalog_name(pid) if pid else None,
                   "synth": SYNTH_PROFILE.get(synth_of(secid) or "", {}).get("label")}

            s = _read_cache(secid, 101)
            src = "cache"
            if not (s and s.get("dates")):
                s = _read_cache(secid, 101, max_age_hours=CACHE_MAX_AGE_HOURS * 400)
                src = "cache(过期)"
            if not (s and s.get("dates")):
                s = snapshot_series(secid)
                src = "snapshot"

            if s and s.get("dates"):
                rec.update({"ok": True, "source": src, "points": len(s["dates"]),
                            "first": s["dates"][0], "last": s["dates"][-1],
                            "realStart": s.get("realStart") or s["dates"][0]})
            else:
                rec.update({"ok": False, "error": "本地无缓存，首次回测时会自动联网获取"})
            out.append(rec)
    return out


def main():
    port = PORT
    for attempt in range(20):
        try:
            srv = ThreadingHTTPServer((BIND, port), Handler)
            break
        except OSError:
            port += 1
    else:
        raise SystemExit("no free port")

    print("资产管家 running at http://127.0.0.1:%d" % port)
    print("监听: %s:%d   登录认证: %s" % (BIND, port, "开" if AUTH_ENABLED else "关"))
    if BIND in ("0.0.0.0", "::"):
        try:
            import socket
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(("8.8.8.8", 80))
            ip = s.getsockname()[0]
            s.close()
            print("局域网访问: http://%s:%d" % (ip, port))
        except Exception:
            pass
        print("提示: 已对外监听，请确认已有登录认证或防火墙策略")
    print("static dir:", STATIC_DIR)
    warmup()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("bye")
        srv.shutdown()


if __name__ == "__main__":
    main()
