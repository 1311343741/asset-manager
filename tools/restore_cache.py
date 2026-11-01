# -*- coding: utf-8 -*-
"""
从内置快照恢复被截短的缓存。

背景：备用源（腾讯/新浪）只给最近约 3 年，一旦东财限流、缓存过期，
就会用它覆盖掉宽基指数几十年历史，导致长周期回测区间塌掉。
这里用快照里更长的序列把缓存补回来（只在快照更长时才覆盖）。
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server


def main():
    snap = json.load(open(os.path.join(ROOT, 'static', 'data', 'snapshot.json'),
                         encoding='utf-8'))
    restored, kept = [], []
    for secid in (snap.get('series') or {}):
        cur = server._read_cache(secid, 101, max_age_hours=10 ** 9)
        cur_n = len((cur or {}).get('dates') or [])
        s = server.snapshot_series(secid)
        if not s or not s.get('close'):
            continue
        snap_n = len(s['dates'])
        if cur_n >= snap_n:
            kept.append((secid, cur_n))
            continue
        server._write_cache(secid, 101, s)
        restored.append((secid, cur_n, snap_n))

    print('已恢复 %d 个：' % len(restored))
    for secid, a, b in restored:
        it = server._ALL_ITEMS.get(secid) or {}
        print('   %-26s %5d 点 -> %5d 点' % (it.get('name', secid), a, b))
    print('缓存已更长、未动的：%d 个' % len(kept))


if __name__ == '__main__':
    main()
