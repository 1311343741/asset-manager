# -*- coding: utf-8 -*-
"""
逐个探测候选标的（东财限流很凶：连续请求会 "Remote end closed connection"）。
策略：一次一个、间隔 4 秒、失败指数退避重试 4 次，结果实时落盘 results.json，
中断后重跑会跳过已探测过的。
"""
import json
import os
import random
import time
import urllib.parse
import urllib.request

UA = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                 "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Referer": "https://quote.eastmoney.com/",
}
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RESULT = os.path.join(ROOT, "tools", "probe_results.json")

# 待探测候选 (secid, 预期名称)
CANDIDATES = [
    ("1.512000", "券商ETF"), ("1.512170", "医疗ETF"), ("1.512010", "医药ETF"),
    ("0.159992", "创新药ETF"), ("1.512690", "酒ETF"), ("0.159928", "消费ETF"),
    ("0.159996", "家电ETF"), ("1.512400", "有色金属ETF"), ("1.515220", "煤炭ETF"),
    ("1.515210", "钢铁ETF"), ("0.159825", "农业ETF"), ("1.516160", "新能源ETF"),
    ("1.515790", "光伏ETF"), ("0.159755", "电池ETF"), ("1.512660", "军工ETF"),
    ("1.512980", "传媒ETF"), ("1.512200", "房地产ETF"), ("1.512580", "环保ETF"),
    ("1.516950", "基建ETF"), ("1.513050", "中概互联网ETF"), ("1.513180", "恒生科技ETF"),
    ("1.513130", "恒生科技30ETF"), ("1.513330", "恒生互联网ETF"), ("1.513060", "恒生医疗ETF"),
    ("1.513970", "恒生消费ETF"),
]


def fetch(url, retry=4, timeout=20):
    last = None
    for i in range(retry):
        try:
            req = urllib.request.Request(url, headers=UA)
            r = urllib.request.urlopen(req, timeout=timeout)
            return json.loads(r.read().decode('utf-8', 'ignore'))
        except Exception as e:
            last = e
            time.sleep(2.0 * (i + 1) + random.random())
    raise last


def kline(secid):
    url = ("https://push2his.eastmoney.com/api/qt/stock/kline/get?"
           "secid=%s&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f53&"
           "klt=101&fqt=1&beg=19700101&end=20501231&lmt=100000"
           % urllib.parse.quote(secid))
    d = fetch(url)
    node = d.get("data") or {}
    k = node.get("klines") or []
    return (node.get("name") or ""), len(k), \
           (k[0].split(",")[0] if k else ""), (k[-1].split(",")[0] if k else "")


def main():
    done = {}
    if os.path.exists(RESULT):
        try:
            done = json.load(open(RESULT, encoding='utf-8'))
        except Exception:
            done = {}

    todo = [(s, w) for s, w in CANDIDATES if s not in done]
    print('待探测 %d 个（已完成 %d 个）\n' % (len(todo), len(done)))

    for i, (secid, want) in enumerate(todo, 1):
        try:
            name, n, first, last = kline(secid)
            done[secid] = {'ok': n > 0, 'name': name, 'points': n,
                           'first': first, 'last': last,
                           'err': '' if n > 0 else '无历史数据'}
            print('  %-3d %s %-12s %-26s %s'
                  % (i, 'OK' if n > 0 else '--', secid, name or want,
                     ('%d点 %s ~ %s' % (n, first, last)) if n > 0 else '无数据'))
        except Exception as e:
            done[secid] = {'ok': False, 'name': '', 'points': 0,
                           'first': '', 'last': '', 'err': str(e)[:60]}
            print('  %-3d -- %-12s %-26s %s' % (i, secid, want, str(e)[:40]))
        json.dump(done, open(RESULT, 'w', encoding='utf-8'),
             ensure_ascii=False, indent=1)
        time.sleep(4)

    good = [(s, v) for s, v in done.items() if v.get('ok')]
    bad = [s for s, v in done.items() if not v.get('ok')]
    print('\n=== 汇总 ===')
    print('可用 %d 个，无数据 %d 个' % (len(good), len(bad)))
    if bad:
        print('无数据:', ', '.join(bad))


if __name__ == '__main__':
    main()
