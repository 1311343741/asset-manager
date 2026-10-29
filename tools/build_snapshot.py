# -*- coding: utf-8 -*-
"""
生成离线行情快照 static/data/snapshot.json

用途：当页面脱离 Python 后端（静态预览、直接分发 HTML）时，
      前端可回退到这份内置数据，回测与预测功能依然可用。

用法：
    python tools/build_snapshot.py            # 增量：已有缓存直接用，缺失才联网
    python tools/build_snapshot.py --force    # 强制全部重拉
"""
import os
import sys
import json
import time
import argparse

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from server import CATALOG, fetch_kline, slice_series, norm_date   # noqa: E402

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(BASE, "static", "data", "snapshot.json")
START = "2006-01-01"        # 快照起点（约 20 年，足够回测与预测使用）
END = time.strftime("%Y-%m-%d")


def build(force=False):
    items = []
    for g in CATALOG:
        for it in g["items"]:
            if it.get("fixed") is not None:
                continue        # 现金类无行情
            items.append((it["secid"], it["name"], g["group"]))

    out = {
        "generated": int(time.time()),
        "generated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "source": "东方财富",
        "range": [START, END],
        "catalog": CATALOG,
        "series": {},
        "failed": [],
    }

    def pack(secid, name, group):
        s = fetch_kline(secid, 101, force=force, retry=6)   # 批量任务不急，多试几次
        d, c = slice_series(s, norm_date(START.replace("-", "")), norm_date(END.replace("-", "")))
        if len(d) < 60:
            raise RuntimeError("数据点过少: %d" % len(d))
        # 紧凑存储：日期取相对 2000-01-01 的天数（差分），收盘保留 4 位小数
        base = time.mktime(time.strptime("2000-01-01", "%Y-%m-%d")) / 86400.0
        days = [int(round(time.mktime(time.strptime(ds, "%Y-%m-%d")) / 86400.0 - base)) for ds in d]
        out["series"][secid] = {
            "name": s.get("name") or name,
            "group": group,
            "d0": days[0],
            "days": [days[k] - days[k - 1] for k in range(1, len(days))],
            "close": [round(v, 4) for v in c],
            "n": len(days),
            "first": d[0],
            "last": d[-1],
        }
        return d

    pending = list(items)
    for i, (secid, name, group) in enumerate(items, 1):
        try:
            d = pack(secid, name, group)
            print("[%2d/%d] OK   %-26s %s ~ %s  %d 点" % (i, len(items), name, d[0], d[-1], len(d)))
            pending.remove((secid, name, group))
        except Exception as e:
            print("[%2d/%d] FAIL %-26s %s" % (i, len(items), name, e))

    # 多轮补拉：东财会限流，失败项隔一段时间再试
    for rnd in range(1, 5):
        if not pending:
            break
        print("\n-- 第 %d 轮补拉，剩余 %d 项，等待 20 秒 --" % (rnd, len(pending)))
        time.sleep(20)
        still = []
        for (secid, name, group) in pending:
            try:
                d = pack(secid, name, group)
                print("   OK   %-26s %s ~ %s  %d 点" % (name, d[0], d[-1], len(d)))
            except Exception as e:
                print("   FAIL %-26s %s" % (name, e))
                still.append((secid, name, group))
        pending = still

    out["failed"] = [{"secid": s, "name": n, "error": "多次重试仍未取到"} for (s, n, g) in pending]

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    size = os.path.getsize(OUT) / 1024.0
    print("\n完成：%s（%.0f KB），成功 %d / 失败 %d"
          % (OUT, size, len(out["series"]), len(out["failed"])))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="忽略缓存强制重拉")
    a = ap.parse_args()
    build(force=a.force)
