# -*- coding: utf-8 -*-
"""让现金类（fixed 利率）在回测中也能产生收益。

原先 /api/batch 对 CASH / DEMAND / DEP1 / MMF 会走行情拉取 → 失败 →
"无可用数据"，回测里等于没有这部分收益。这里按固定年化利率合成一条
复利曲线（借 A 股交易日历），使回测能把现金类的收益算进去。
"""
p = 'server.py'
s = open(p, encoding='utf-8').read()

FIXED_FN = '''def _fixed_series(secid, klt=101, need_start=None):
    """现金类：无行情，按固定年化利率合成复利净值曲线（起点 1.0）"""
    rate = is_fixed(secid)
    if rate is None:
        return None
    ref = None
    try:
        ref = get_series("1.000300", klt, None, 2)      # 借 A 股交易日历
    except Exception:
        ref = None
    cal = (ref or {}).get("dates") or []
    if len(cal) < 60:
        return None
    daily = (float(rate) / 100.0) / 252.0
    dates, close = [], []
    for i, d in enumerate(cal):
        dates.append(d)
        close.append(round((1.0 + daily) ** i, 6))
    return _meta(secid, _cat_name(secid), dates, close, "fixed", dates[0], None,
                 "现金类，按年化 %s%% 固定利率模拟" % rate)


'''

anchor = 'def get_series(secid, klt=101, need_start=None, _depth=0):\n    """带内存缓存的入口'
assert anchor in s, 'get_series 未匹配'
s = s.replace(anchor, FIXED_FN + anchor, 1)

old_head = 'def get_series(secid, klt=101, need_start=None, _depth=0):\n    """带内存缓存的入口：回测反复用同一区间时不必重复做补全计算"""\n    key = (secid, klt, need_start)'
new_head = ('def get_series(secid, klt=101, need_start=None, _depth=0):\n'
            '    """带内存缓存的入口：回测反复用同一区间时不必重复做补全计算"""\n'
            '    if is_fixed(secid) is not None:          # 现金类：直接给固定利率曲线\n'
            '        return _fixed_series(secid, klt, need_start)\n'
            '    key = (secid, klt, need_start)')
assert old_head in s, 'get_series 函数头未匹配'
s = s.replace(old_head, new_head, 1)

open(p, 'w', encoding='utf-8').write(s)
print('现金类已可在回测中按固定利率模拟收益')
