# -*- coding: utf-8 -*-
"""登录认证流程测试：未登录拦截 / 错误密码拒绝 / 登录后放行"""
import json
import urllib.error
import urllib.request

H = 'http://127.0.0.1:8765'


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


def req(path, method='GET', body=None, cookie=None):
    data = json.dumps(body).encode() if body else None
    r = urllib.request.Request(H + path, data=data, method=method)
    if data:
        r.add_header('Content-Type', 'application/json')
    if cookie:
        r.add_header('Cookie', cookie)
    op = urllib.request.build_opener(NoRedirect)
    try:
        resp = op.open(r, timeout=30)
        return resp.status, dict(resp.headers), resp.read().decode('utf-8', 'ignore')[:120]
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read().decode('utf-8', 'ignore')[:120]


ok = True


def check(name, got, want):
    global ok
    good = (got == want)
    ok = ok and good
    print('  %s  %-28s -> %s (期望 %s)' % ('PASS' if good else 'FAIL', name, got, want))


print('=== 未登录 ===')
check('访问首页 /', req('/')[0], 302)
check('访问 /index.html', req('/index.html')[0], 302)
check('访问 /api/catalog', req('/api/catalog')[0], 401)
check('访问 /api/diag', req('/api/diag')[0], 401)
check('访问登录页', req('/login.html')[0], 200)
check('访问 /css/app.css', req('/css/app.css')[0], 200)
check('访问 /js/auth.js', req('/js/auth.js')[0], 200)
check('访问 /data/snapshot.json', req('/data/snapshot.json')[0], 200)

print('=== 登录 ===')
check('错误密码', req('/api/login', 'POST', {'user': 'admin', 'pass': 'wrong'})[0], 401)
check('错误用户名', req('/api/login', 'POST', {'user': 'root', 'pass': '12345678'})[0], 401)
st, hd, bd = req('/api/login', 'POST', {'user': 'admin', 'pass': '12345678'})
check('正确密码', st, 200)
sc = hd.get('Set-Cookie', '')
print('   Set-Cookie: %s' % sc[:52])
print('   HttpOnly  : %s' % ('HttpOnly' in sc))
token = sc.split(';')[0]

print('=== 已登录 ===')
check('带会话访问首页', req('/', cookie=token)[0], 200)
check('带会话访问 /api/catalog', req('/api/catalog', cookie=token)[0], 200)
check('带会话访问 /api/diag', req('/api/diag', cookie=token)[0], 200)

print('\n结果：', '全部通过' if ok else '存在失败')
