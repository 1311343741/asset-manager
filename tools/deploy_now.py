# -*- coding: utf-8 -*-
"""触发 Render 重新部署，并等待它变成 live。"""
import json
import os
import sys
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KEY = open(os.path.join(ROOT, '.render_key'), encoding='utf-8').read().strip()
API = 'https://api.render.com/v1'
SVC = 'srv-dbilbp3bc2fs73al9udg'
GH = json.load(open(os.path.join(ROOT, '.gh_token'), encoding='utf-8'))['token'] \
    if os.path.exists(os.path.join(ROOT, '.gh_token')) else None


def render(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(API + path, data=data, method=method)
    r.add_header('Authorization', 'Bearer ' + KEY)
    r.add_header('Accept', 'application/json')
    if data:
        r.add_header('Content-Type', 'application/json')
    try:
        resp = urllib.request.urlopen(r, timeout=60)
        return resp.status, json.loads(resp.read() or b'{}')
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode('utf-8', 'ignore') or '{}')


def gh_latest():
    if not GH:
        return None, None
    r = urllib.request.Request('https://api.github.com/repos/1311343741/asset-manager/commits?per_page=1',
                               headers={'Authorization': 'Bearer ' + GH,
                                        'Accept': 'application/vnd.github+json'})
    c = json.loads(urllib.request.urlopen(r, timeout=60).read())[0]
    return c['sha'][:8], c['commit']['message'][:60]


def main():
    sha, msg = gh_latest()
    if sha:
        print('GitHub 最新 commit: %s  %s' % (sha, msg))

    st, d = render('POST', '/services/%s/deploys' % SVC, {})
    if st not in (200, 201):
        print('触发失败: %s %s' % (st, d))
        sys.exit(1)
    x = d.get('deploy', d)
    print('部署已触发: %s' % x.get('id'))
    print('  本次 commit: %s' % ((x.get('commit') or {}).get('id', '')[:8]))

    for i in range(40):
        time.sleep(15)
        st, lst = render('GET', '/services/%s/deploys?limit=1' % SVC)
        if st != 200:
            continue
        cur = (lst[0].get('deploy', lst[0]) if lst else {})
        status = cur.get('status')
        print('  [%2d] %s' % (i + 1, status))
        if status in ('live', 'failed', 'canceled', 'deactivated'):
            print('\n最终状态: %s' % status)
            return 0 if status == 'live' else 1
    print('等待超时')
    return 1


if __name__ == '__main__':
    sys.exit(main())
