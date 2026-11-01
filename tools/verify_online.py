# -*- coding: utf-8 -*-
"""核对线上（Render）提供的文件是否已包含本次改动。"""
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


def main():
    st, hd, bd = req('/api/login', 'POST', {'user': 'admin', 'pass': '12345678'})
    print('登录:', st)
    if st != 200:
        sys.exit('登录失败')
    cookie = (hd.get('Set-Cookie') or '').split(';')[0]

    checks = [
        ('/', '最大涨幅'),
        ('/', 'wnum'),
        ('/js/backtest.js', 'colorOf'),
        ('/js/backtest.js', 'maxGain'),
        ('/js/backtest.js', "name: '百分位'"),
        ('/js/backtest.js', "name: '日期'"),
        ('/css/app.css', '.wnum'),
    ]
    ok = True
    for path, kw in checks:
        st, hd, bd = req(path, cookie=cookie, timeout=120)
        hit = kw in bd
        ok = ok and hit
        print('  %-18s HTTP %d  含「%s」: %s' % (path, st, kw, hit))
    print('\n线上核对:', '全部生效' if ok else '仍有未生效项')


if __name__ == '__main__':
    main()
