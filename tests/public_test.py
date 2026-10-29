# -*- coding: utf-8 -*-
"""公网端到端验证：登录 -> 取目录 -> 批量拉行情（含补全）"""
import json
import sys
import time
import urllib.error
import urllib.request

HOST = sys.argv[1] if len(sys.argv) > 1 else 'https://13ddaa73.r9.cpolar.top'


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


def req(path, method='GET', body=None, cookie=None, timeout=90):
    data = json.dumps(body).encode() if body else None
    r = urllib.request.Request(HOST + path, data=data, method=method)
    if data:
        r.add_header('Content-Type', 'application/json')
    if cookie:
        r.add_header('Cookie', cookie)
    op = urllib.request.build_opener(NoRedirect)
    try:
        resp = op.open(r, timeout=timeout)
        return resp.status, dict(resp.headers), resp.read().decode('utf-8', 'ignore')
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read().decode('utf-8', 'ignore')


ok = True


def check(name, got, want):
    global ok
    good = got == want
    ok = ok and good
    print('  %s  %-26s -> %s (期望 %s)' % ('PASS' if good else 'FAIL', name, got, want))


print('公网地址:', HOST)
print('=== 未登录 ===')
check('首页', req('/')[0], 302)
check('行情 API', req('/api/catalog')[0], 401)

print('=== 登录 ===')
t0 = time.time()
st, hd, bd = req('/api/login', 'POST', {'user': 'admin', 'pass': '12345678'})
check('正确密码', st, 200)
print('  登录耗时 %.2fs' % (time.time() - t0))
cookie = (hd.get('Set-Cookie') or '').split(';')[0]
check('拿到会话', bool(cookie), True)

print('=== 登录后 ===')
check('首页', req('/', cookie=cookie)[0], 200)
st, hd, bd = req('/api/catalog', cookie=cookie)
check('资产目录', st, 200)
try:
    cat = json.loads(bd).get('catalog', [])
    print('  目录分组数: %d' % len(cat))
except Exception:
    pass

t0 = time.time()
st, hd, bd = req('/api/batch?secids=1.000300,100.NDX100,124.HSTECH,1.518880,1.511090'
                 '&start=20161001&end=20261028&period=day', cookie=cookie)
check('批量行情', st, 200)
print('  耗时 %.2fs' % (time.time() - t0))
try:
    d = json.loads(bd)
    print('  取到标的: %d, 失败: %s' % (len(d.get('series', {})), d.get('errors') or '无'))
    for k, v in d.get('series', {}).items():
        print('    %-16s %-8s 真实起点 %s' % (v['name'], v['source'], v['realStart']))
except Exception as e:
    print('  解析失败:', e)

st, hd, bd = req('/api/diag', cookie=cookie)
check('数据体检', st, 200)
try:
    items = json.loads(bd).get('items', [])
    bad = [x for x in items if not x.get('ok')]
    print('  体检: 共 %d 项，异常 %d 项' % (len(items), len(bad)))
except Exception:
    pass

print('\n结果：', '公网端到端全部通过' if ok else '存在失败')
