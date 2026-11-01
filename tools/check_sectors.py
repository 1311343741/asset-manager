# -*- coding: utf-8 -*-
"""
逐个检查目录里每个标的当前能拿到什么数据。
real/mixed = 真实数据（mixed 表示早期由代理回溯补全）
snapshot/cached = 用本地缓存/快照
proxy = 取数失败，整段用代理走势代替（这会让回测看起来像指数，而不是板块本身）
"""
import json
import os
import sys
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOST = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8765'


class NoRed(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


op = urllib.request.build_opener(NoRed)


def req(path, method='GET', body=None, cookie=None, timeout=240):
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


def catalog():
    src = open(os.path.join(ROOT, 'server.py'), encoding='utf-8').read()
    start = src.index('CATALOG = [')
    end = src.index('\n]\n', start) + 2
    ns = {}
    exec(src[start:end], ns)
    return ns['CATALOG']


def main():
    st, hd, bd = req('/api/login', 'POST', {'user': 'admin', 'pass': '12345678'})
    if st != 200:
        sys.exit('登录失败 %s' % st)
    cookie = (hd.get('Set-Cookie') or '').split(';')[0]

    stats = {}
    for g in catalog():
        gname = g['group']
        rows = []
        for it in g['items']:
            if it.get('fixed') is not None:
                continue
            sid = it['secid']
            st, hd, bd = req('/api/batch?secids=%s&start=20161101&end=20261030&period=day' % sid,
                             cookie=cookie, timeout=240)
            try:
                d = json.loads(bd)
                ser = d.get('series') or {}
                if ser:
                    v = list(ser.values())[0]
                    rows.append((it['name'], v['source'], v.get('realStart'), len(v['dates'])))
                else:
                    rows.append((it['name'], 'FAIL', (d.get('errors') or {}).get(sid, '')[:30], 0))
            except Exception as e:
                rows.append((it['name'], 'ERR', str(e)[:30], 0))
        print('\n【%s】' % gname)
        for name, src_, rs, n in rows:
            stats[src_] = stats.get(src_, 0) + 1
            mark = {'real': '真实', 'mixed': '真实+补全', 'cached': '缓存',
                    'snapshot': '快照', 'proxy': '⚠代理', 'FAIL': '✗失败'}.get(src_, src_)
            extra = ('  起点 %s' % rs) if rs else ''
            print('   %-26s %-12s %5d点%s' % (name, mark, n, extra))

    print('\n=== 汇总 ===')
    for k, v in sorted(stats.items(), key=lambda x: -x[1]):
        print('  %-10s %d 个' % (k, v))


if __name__ == '__main__':
    main()
