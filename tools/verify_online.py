# -*- coding: utf-8 -*-
"""核对线上（Render）文件是否已包含各项改动。"""
import json
import sys
import urllib.error
import urllib.request

HOST = sys.argv[1] if len(sys.argv) > 1 else 'https://asset-manager-vsf2.onrender.com'


class NoRed(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


op = urllib.request.build_opener(NoRed)


def req(path, method='GET', body=None, cookie=None, timeout=120):
    data = json.dumps(body).encode() if body else None
    r = urllib.request.Request(HOST + path, data=data, method=method)
    if data:
        r.add_header('Content-Type', 'application/json')
    if cookie:
        r.add_header('Cookie', cookie)
    try:
        resp = op.open(r, timeout=timeout)
        return resp.status, dict(resp.headers), resp.read().decode('utf-8', 'ignore')
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read().decode('utf-8', 'ignore')


CHECKS = [
    # 回测界面（上一轮）
    ('/', '最大涨幅'),
    ('/js/backtest.js', 'colorOf'),
    ('/js/backtest.js', 'maxGain'),
    ('/js/backtest.js', "name: '百分位'"),
    ('/js/backtest.js', "name: '日期'"),
    ('/css/app.css', '.wnum'),
    # 本轮：手机适配 / 定投置灰 / 实际预测线
    ('/css/app.css', 'max-width:760px'),
    ('/css/app.css', 'disabled-input'),
    ('/js/backtest.js', 'syncDca'),
    ('/', 'dcaHint'),
    ('/js/forecast.js', '实际预测线'),
    ('/js/forecast.js', 'rawFinals'),
    # 本轮：资产类别 / 导入落盘 / 权重输入 / 100% 校验 / 预测不定投
    ('/js/networth.js', '中短债'),
    ('/js/networth.js', '导入成功'),
    ('/js/backtest.js', 'writeBack'),
    ('/js/backtest.js', '没有配置完整'),
    ('/js/forecast.js', 'times: 0'),
    ('/js/forecast.js', 'syncFc'),
]


def main():
    st, hd, bd = req('/api/login', 'POST', {'user': 'admin', 'pass': '12345678'})
    print('登录:', st)
    if st != 200:
        sys.exit('登录失败')
    cookie = (hd.get('Set-Cookie') or '').split(';')[0]

    bad = []
    for path, kw in CHECKS:
        st, hd, bd = req(path, cookie=cookie, timeout=120)
        hit = kw in bd
        if not hit:
            bad.append((path, kw))
        print('  %-20s 含「%s」: %s' % (path, kw, hit))
    print('\n线上核对:', '全部生效' if not bad else '未生效: %s' % bad)


if __name__ == '__main__':
    main()
