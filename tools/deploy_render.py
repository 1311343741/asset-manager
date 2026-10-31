# -*- coding: utf-8 -*-
"""
用 Render API 从 GitHub 仓库创建 Web Service 并跟踪部署状态。

用法：
    python tools/deploy_render.py <render_api_key> <github_repo_url> [github_token]
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request

RENDER = 'https://api.render.com/v1'
GITHUB = 'https://api.github.com'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def http(method, url, token, body=None, label='render'):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header('Authorization', 'Bearer ' + token)
    req.add_header('Accept', 'application/json')
    if data:
        req.add_header('Content-Type', 'application/json')
    try:
        r = urllib.request.urlopen(req, timeout=60)
        raw = r.read()
        return r.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw.decode('utf-8', 'ignore'))
        except Exception:
            return e.code, {'raw': raw.decode('utf-8', 'ignore')[:400]}


def main():
    rkey = sys.argv[1] if len(sys.argv) > 1 else ''
    repo = sys.argv[2] if len(sys.argv) > 2 else ''
    gtoken = sys.argv[3] if len(sys.argv) > 3 else ''
    if not rkey or not repo:
        sys.exit('用法: deploy_render.py <render_api_key> <github_repo_url> [github_token]')

    # 1) 仓库默认分支
    branch = 'main'
    if gtoken and repo.startswith('https://github.com/'):
        slug = repo.replace('https://github.com/', '').strip('/')
        st, info = http('GET', GITHUB + '/repos/' + slug, gtoken, label='github')
        if st == 200:
            branch = info.get('default_branch', 'main')
            print('仓库默认分支: %s' % branch)
        else:
            print('无法查询默认分支(%s)，假定 main' % st)

    # 2) workspace
    st, owners = http('GET', RENDER + '/owners?limit=5', rkey)
    owner_id = ''
    if st == 200 and owners:
        owner_id = (owners[0].get('owner') or owners[0]).get('id', '')
        print('workspace: %s' % owner_id)

    # 3) 创建服务
    # 注意字段位置：envVars 在顶层，运行时配置在 serviceDetails 里
    payload = {
        'type': 'web_service',
        'name': 'asset-manager',
        'ownerId': owner_id,
        'repo': repo,
        'branch': branch,
        'autoDeployTrigger': 'commit',
        'envVars': [
            {'key': 'BIND', 'value': '0.0.0.0'},
            {'key': 'AUTH_USER', 'value': 'admin'},
            {'key': 'AUTH_PASS', 'value': '12345678'},
            {'key': 'PYTHON_VERSION', 'value': '3.11.9'},
            {'key': 'WARMUP', 'value': '1'},
        ],
        'serviceDetails': {
            'runtime': 'python',
            'envSpecificDetails': {
                'plan': 'free',
                'region': 'singapore',
                'buildCommand': 'pip install -r requirements.txt',
                'startCommand': 'python -u server.py',
                'healthCheckPath': '/api/health',
            },
        },
    }
    st, svc = http('POST', RENDER + '/services', rkey, payload)
    if st not in (200, 201):
        print('创建服务失败: HTTP %s' % st)
        print(json.dumps(svc, ensure_ascii=False)[:600])
        sys.exit(1)

    sid = svc.get('service', {}).get('id') or svc.get('id')
    sname = (svc.get('service') or svc).get('name')
    url = (svc.get('service') or svc).get('serviceDetails', {}).get('url') \
        or (svc.get('service') or svc).get('url') or ''
    print('服务已创建: %s (id=%s)' % (sname, sid))
    if url:
        print('网址: https://%s' % url)

    # 4) 跟踪首次部署
    print('\n等待首次部署…')
    for i in range(60):
        time.sleep(15)
        st, deploys = http('GET', RENDER + '/services/%s/deploys?limit=1' % sid, rkey)
        if st != 200:
            print('  查询部署失败: %s' % st)
            continue
        items = deploys if isinstance(deploys, list) else deploys.get('deploys', [])
        if not items:
            continue
        d = (items[0].get('deploy') or items[0])
        status = d.get('status')
        print('  [%2d] %s' % (i + 1, status))
        if status in ('live', 'failed', 'canceled', 'deactivated'):
            print('\n最终状态: %s' % status)
            if status == 'live':
                print('部署成功！')
            break

    # 5) 再次确认网址
    st, svc2 = http('GET', RENDER + '/services/%s' % sid, rkey)
    if st == 200:
        s = svc2.get('service') or svc2
        url2 = s.get('serviceDetails', {}).get('url') or s.get('url') or url
        print('\n=== 公网网址 ===')
        print('https://%s' % url2)


if __name__ == '__main__':
    main()
