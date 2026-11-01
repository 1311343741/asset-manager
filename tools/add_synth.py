# -*- coding: utf-8 -*-
"""
为板块 ETF 配置「模拟 K 线」画像，并让模拟补全优先于代理回溯。

背景：板块 ETF 普遍只有几年真实数据（备用源更是只有 3 年），
用户要求这类标的用模拟 K 线代替，而不是简单沿用宽基指数走势。
"""
import os

P = 'server.py'
S = open(P, encoding='utf-8').read()

# 1) 扩展画像：按板块自身的波动特征给参数
OLD_PROF = '''SYNTH_PROFILE = {
    "bond": {"mu": 0.035, "sigma": 0.030, "label": "中债利率债典型走势"},
}'''
NEW_PROF = '''SYNTH_PROFILE = {
    "bond": {"mu": 0.035, "sigma": 0.030, "label": "中债利率债典型走势"},
    "broadETF": {"mu": 0.070, "sigma": 0.220, "label": "宽基指数典型走势"},
    "tech": {"mu": 0.090, "sigma": 0.350, "label": "科技板块典型走势"},
    "pharm": {"mu": 0.080, "sigma": 0.280, "label": "医药板块典型走势"},
    "consume": {"mu": 0.090, "sigma": 0.250, "label": "消费板块典型走势"},
    "cyclical": {"mu": 0.060, "sigma": 0.300, "label": "周期资源板块典型走势"},
    "newenergy": {"mu": 0.100, "sigma": 0.400, "label": "新能源板块典型走势"},
    "fin": {"mu": 0.060, "sigma": 0.240, "label": "金融地产板块典型走势"},
    "defense": {"mu": 0.070, "sigma": 0.300, "label": "军工传媒板块典型走势"},
    "hk": {"mu": 0.070, "sigma": 0.300, "label": "港股板块典型走势"},
}'''
assert OLD_PROF in S, 'SYNTH_PROFILE 未匹配'
S = S.replace(OLD_PROF, NEW_PROF)

# 2) 给板块分组打上画像
start = S.index('CATALOG = [')
end = S.index('\n]\n', start) + 2
ns = {}
exec(S[start:end], ns)
CAT = ns['CATALOG']

GROUP_SYNTH = {
    "A股 · 宽基ETF": "broadETF",
    "A股 · 科技ETF": "tech",
    "A股 · 医药ETF": "pharm",
    "A股 · 消费ETF": "consume",
    "A股 · 周期/资源ETF": "cyclical",
    "A股 · 新能源/制造ETF": "newenergy",
    "A股 · 金融/地产ETF": "fin",
    "A股 · 军工/传媒/环保ETF": "defense",
    "港股 · 中概ETF": "hk",
}
n_add = 0
for g in CAT:
    prof = GROUP_SYNTH.get(g['group'])
    if not prof:
        continue
    for it in g['items']:
        if it.get('fixed') is not None:
            continue
        it['synth'] = prof
        n_add += 1


def fmt(cat):
    lines = ['CATALOG = [']
    for g in cat:
        lines.append('    {"group": "%s", "color": "%s", "items": [' % (g['group'], g['color']))
        for it in g['items']:
            parts = ['"secid": "%s"' % it['secid'], '"name": "%s"' % it['name']]
            if it.get('proxy'):
                parts.append('"proxy": "%s"' % it['proxy'])
            if it.get('synth'):
                parts.append('"synth": "%s"' % it['synth'])
            if it.get('fixed') is not None:
                parts.append('"fixed": %s' % it['fixed'])
            lines.append('        {%s},' % ', '.join(parts))
        lines.append('    ]},')
    lines.append(']')
    return '\n'.join(lines)


S = S[:start] + fmt(CAT) + S[end:]

# 3) 模拟 K 线优先于代理回溯
OLD_ORDER = '''    # 4) 历史不足：先试代理回溯（代理自身若也不足，会递归补全）
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
                         "早于 %s 为模拟（按「%s」随机游走合成）" % (real_start, prof["label"]))'''

NEW_ORDER = '''    # 4) 历史不足：优先按板块画像做模拟 K 线补全。
    #    板块 ETF 真实数据普遍只有几年，用带板块波动特征的随机游走回溯，
    #    比直接沿用宽基指数走势更能体现该板块自身的风险收益特征。
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

    # 5) 无画像时退化到代理回溯（沿用相关指数的真实走势）
    pid = proxy_of(secid)
    if pid and pid != secid:
        p = get_series(pid, klt, need_start=need_start, _depth=_depth + 1)
        if p and p["dates"] and p["dates"][0] < real_start:
            dt, cl = backfill_with_proxy(real, p, need_start)
            if dt:
                return _meta(secid, real["name"], dt, cl, "mixed", real_start, p["name"],
                             "早于 %s 为模拟（沿用「%s」真实走势回溯）" % (real_start, p["name"]))'''

assert OLD_ORDER in S, '补全顺序块未匹配'
S = S.replace(OLD_ORDER, NEW_ORDER)

open(P, 'w', encoding='utf-8').write(S)
print('已为 %d 个标的配置模拟 K 线画像；补全顺序改为「模拟优先、代理兜底」' % n_add)
