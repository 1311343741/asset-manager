# -*- coding: utf-8 -*-
"""资产池加入港股/A股龙头个股，并让它们走后复权。"""
p = 'server.py'
s = open(p, encoding='utf-8').read()

start = s.index('CATALOG = [')
end = s.index('\n]\n', start) + 2
ns = {}
exec(s[start:end], ns)
CAT = ns['CATALOG']

HK = [
    {"secid": "116.00700", "name": "腾讯控股", "fq": 2, "synth": "tech"},
    {"secid": "116.03690", "name": "美团-W", "fq": 2, "synth": "tech"},
    {"secid": "116.09988", "name": "阿里巴巴-W", "fq": 2, "synth": "tech"},
    {"secid": "116.01810", "name": "小米集团-W", "fq": 2, "synth": "tech"},
    {"secid": "116.09992", "name": "泡泡玛特", "fq": 2, "synth": "consume"},
    {"secid": "116.09626", "name": "哔哩哔哩-W", "fq": 2, "synth": "tech"},
]
CN = [
    {"secid": "1.600519", "name": "贵州茅台", "fq": 2, "synth": "consume"},
    {"secid": "0.300750", "name": "宁德时代", "fq": 2, "synth": "newenergy"},
    {"secid": "0.000858", "name": "五粮液", "fq": 2, "synth": "consume"},
    {"secid": "1.600036", "name": "招商银行", "fq": 2, "synth": "fin"},
    {"secid": "1.601318", "name": "中国平安", "fq": 2, "synth": "fin"},
    {"secid": "0.002594", "name": "比亚迪", "fq": 2, "synth": "newenergy"},
    {"secid": "0.000333", "name": "美的集团", "fq": 2, "synth": "consume"},
    {"secid": "1.600900", "name": "长江电力", "fq": 2, "synth": "broadETF"},
]

if not any(g['group'] == '港股 · 龙头个股' for g in CAT):
    idx = next(i for i, g in enumerate(CAT) if g['group'].startswith('现金类'))
    CAT[idx:idx] = [
        {"group": "港股 · 龙头个股", "color": "#8b5cf6", "items": HK},
        {"group": "A股 · 龙头个股", "color": "#e5484d", "items": CN},
    ]


def fmt(cat):
    lines = ['CATALOG = [']
    for g in cat:
        lines.append('    {"group": "%s", "color": "%s", "items": [' % (g['group'], g['color']))
        for it in g['items']:
            parts = ['"secid": "%s"' % it['secid'], '"name": "%s"' % it['name']]
            for k in ('proxy', 'synth', 'fq', 'fixed'):
                if it.get(k) is not None:
                    v = it[k]
                    parts.append('"%s": %s' % (k, ('"%s"' % v) if isinstance(v, str) else v))
            lines.append('        {%s},' % ', '.join(parts))
        lines.append('    ]},')
    lines.append(']')
    return '\n'.join(lines)


s = s[:start] + fmt(CAT) + s[end:]

# 前复权在长期高分红个股上会得到负价（茅台 2001 年 -312.47），
# 回测会直接算错。带 fq=2 的标的改走后复权，价格始终为正且含分红再投收益。
OLD_URL = '''    url = ("https://push2his.eastmoney.com/api/qt/stock/kline/get?"
           "secid=%s&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f53&"
           "klt=%s&fqt=1&beg=19700101&end=20501231&lmt=100000" % (urllib.parse.quote(secid), klt))'''
NEW_URL = '''    fq = (_ALL_ITEMS.get(secid) or {}).get("fq", 1)
    url = ("https://push2his.eastmoney.com/api/qt/stock/kline/get?"
           "secid=%s&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f53&"
           "klt=%s&fqt=%d&beg=19700101&end=20501231&lmt=100000"
           % (urllib.parse.quote(secid), klt, fq))'''
assert OLD_URL in s, 'fetch_kline URL 未匹配'
s = s.replace(OLD_URL, NEW_URL, 1)

# 备用源支持港股：东财 116.00700 -> 腾讯 hk00700
OLD_ALT = """    market, _, code = secid.partition('.')
    if code.isdigit():
        if market == '1':
            return 'sh' + code
        if market == '0':
            return 'sz' + code
    return None"""
NEW_ALT = """    market, _, code = secid.partition('.')
    if code.isdigit():
        if market == '1':
            return 'sh' + code
        if market == '0':
            return 'sz' + code
        if market == '116':
            return 'hk' + code.zfill(5)
    return None"""
assert OLD_ALT in s, '_alt_symbol 未匹配'
s = s.replace(OLD_ALT, NEW_ALT, 1)

open(p, 'w', encoding='utf-8').write(s)
print('已加入 %d 只港股 + %d 只 A 股龙头；个股走后复权；备用源支持港股' % (len(HK), len(CN)))
