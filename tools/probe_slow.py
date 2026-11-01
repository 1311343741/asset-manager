# -*- coding: utf-8 -*-
"""
慢速逐个探测候选标的 + 自动重建快照。

东财限流很凶（连续请求会 "Remote end closed connection"），
所以这里：一次一个、间隔 8 秒、失败指数退避重试 6 次。
结果实时写入 tools/probe_results.json，中断后重跑会跳过已完成的。
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

# (secid, 预期名称, 建议代理)
CANDIDATES = [
    ("1.512000", "券商ETF", "1.000300"),
    ("1.512170", "医疗ETF", "0.399006"),
    ("1.512010", "医药ETF", "0.399006"),
    ("0.159992", "创新药ETF", "0.399006"),
    ("1.512690", "酒ETF", "1.000300"),
    ("0.159928", "消费ETF", "1.000300"),
    ("0.159996", "家电ETF", "1.000300"),
    ("1.512400", "有色金属ETF", "1.000300"),
    ("1.515220", "煤炭ETF", "1.000300"),
    ("1.515210", "钢铁ETF", "1.000300"),
    ("0.159825", "农业ETF", "1.000300"),
    ("1.516160", "新能源ETF", "0.399006"),
    ("1.515790", "光伏ETF", "0.399006"),
    ("0.159755", "电池ETF", "0.399006"),
    ("1.512660", "军工ETF", "1.000300"),
    ("1.512980", "传媒ETF", "0.399006"),
    ("1.512200", "房地产ETF", "1.000300"),
    ("1.512580", "环保ETF", "0.399006"),
    ("1.516950", "基建ETF", "1.000300"),
]

RESULT = RESULT  # keep


def fetch(url, retry=6, timeout=25):
    last = None
    for i in range(retry):
        try:
            req = urllib.request.Request(url, headers=UA)
            r = urllib.request.urlopen(req, timeout=timeout)
            return json.loads(r.read().decode('utf-8', 'ignore'))
        except Exception as e:
            last = e
            time.sleep(3.0 * (i + 1) + random.random())
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


CHUNK = 6


def main():
    done = {}
    if os.path.exists(RESULT):
        try:
            done = json.load(open(RESULT, encoding='utf-8'))
        except Exception:
            done = {}

    todo = [c for c in CANDIDATES if c[0] not in done]
    print('待探测 %d 个（已完成 %d 个）\n' % (len(todo), len(done)))

    for i, (secid, want, proxy) in enumerate(todo, 1):
        try:
            name, n, first, last = kline(secid)
            if n > 0:
                done[secid] = {'ok': True, 'name': name, 'points': n,
                           'first': first, 'last': last, 'proxy': proxy, 'err': ''}
                print('  %-3d OK  %-12s %-24s %5d点 %s ~ %s'
                      % (i, secid, name or want, n, first, last), flush=True)
            else:
                done[secid] = {'ok': False, 'name': '', 'points': 0,
                           'first': '', 'last': '', 'proxy': proxy, 'err': '无历史数据'}
                print('  %-3d --  %-12s %-24s 无数据' % (i, secid, want), flush=True)
        except Exception as e:
            done[secid] = {'ok': False, 'name': '', 'points': 0,
                           'first': '', 'last': '', 'proxy': proxy, 'err': str(e)[:60]}
            print('  %-3d --  %-12s %-24s %s' % (i, secid, want, str(e)[:40]), flush=True)
        json.dump(done, open(RESULT, 'w', encoding='utf-8'),
             ensure_ascii=False, indent=1)
        time.sleep(8)

    good = [s for s, v in done.items() if v.get('ok')]
    bad = [s for s, v in done.items() if not v.get('ok')]
    print('\n=== 汇总 ===')
    print('可用 %d 个，无数据 %d 个' % (len(good), len(bad)))
    if bad:
        print('无数据:', ', '.join(bad))
    if good:
        print('\n可用于 CATALOG（含建议代理）：')
        for s in good:
            print('  {"secid": "%s", "name": "%s", "proxy": "%s"},'
                  % (s, done[s].get('name'), done[s].get('proxy')))


if __name__ == '__main__':
    main()
