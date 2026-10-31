# -*- coding: utf-8 -*-
"""
通过 GitHub API 创建仓库并上传本地 git 仓库的全部文件。
绕过 git push（本机网络连不上 github.com，但 api.github.com 可达）。

用法：
    python tools/deploy_github.py <github_token> [仓库名]
"""
import base64
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

API = 'https://api.github.com'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO_NAME = sys.argv[2] if len(sys.argv) > 2 else 'asset-manager'


def api(method, path, token, body=None, raw=False):
    url = API + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header('Authorization', 'Bearer ' + token)
    req.add_header('Accept', 'application/vnd.github+json')
    if data:
        req.add_header('Content-Type', 'application/json')
    try:
        r = urllib.request.urlopen(req, timeout=60)
        payload = r.read()
        return r.status, (payload if raw else (json.loads(payload) if payload else {}))
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode('utf-8', 'ignore'))


def blob_sha(content):
    """git blob 的 sha1，与 GitHub Contents API 返回的 sha 可直接比对"""
    import hashlib
    return hashlib.sha1(b'blob %d\0' % len(content) + content).hexdigest()


def local_files():
    # core.quotepath=false：否则中文路径会被转义成 "345\205\254..." 
    out = subprocess.check_output(
        ['git', '-c', 'core.quotepath=false', 'ls-files'], cwd=ROOT, text=True)
    return [l.strip().strip('"') for l in out.splitlines() if l.strip()]


def main():
    token = sys.argv[1] if len(sys.argv) > 1 else ''
    if not token:
        sys.exit('缺少 GitHub token')
    token = token.strip()

    # 1) 身份
    st, me = api('GET', '/user', token)
    if st != 200:
        sys.exit('token 无效: %s %s' % (st, me))
    owner = me['login']
    print('GitHub 账号: %s' % owner)

    # 2) 创建仓库（公开 —— Render 拉取公开仓库更顺畅）
    st, rep = api('GET', '/repos/%s/%s' % (owner, REPO_NAME), token)
    if st == 200:
        print('仓库已存在: %s' % rep['html_url'])
    else:
        st, rep = api('POST', '/user/repos', token, {
            'name': REPO_NAME, 'private': False,
            'description': 'Asset Manager: net-worth, backtest, forecast',
            'auto_init': False,
        })
        if st not in (201, 200):
            sys.exit('创建仓库失败: %s %s' % (st, rep))
        print('仓库已创建: %s' % rep['html_url'])

    # 3) 上传文件
    #    空仓库不能用 Git Data API（blob 会 409 "Git Repository is empty"），
    #    改用 Contents API 逐个写入；已存在的文件要带上 sha 才能覆盖。
    files = local_files()
    print('待上传文件: %d 个' % len(files))

    changed = 0
    for i, path in enumerate(files, 1):
        with open(os.path.join(ROOT, path), 'rb') as f:
            content = f.read()
        p = path.replace('\\', '/')
        # 比对 git blob sha：内容没变就跳过，否则每次都要重传 2MB 的快照和 echarts
        st0, existing = api('GET', '/repos/%s/%s/contents/%s' % (owner, REPO_NAME, urllib.parse.quote(p)), token)
        if st0 == 200 and isinstance(existing, dict) and existing.get('sha') == blob_sha(content):
            print('  [%2d/%d] %s (未变更，跳过)' % (i, len(files), p))
            continue
        body = {
            'message': 'Asset Manager: net-worth / backtest / forecast',
            'content': base64.b64encode(content).decode(),
        }
        if st0 == 200 and isinstance(existing, dict) and existing.get('sha'):
            body['sha'] = existing['sha']
        st, res = api('PUT', '/repos/%s/%s/contents/%s' % (owner, REPO_NAME, urllib.parse.quote(p)), token, body)
        if st not in (200, 201):
            sys.exit('上传失败 %s: %s %s' % (p, st, res))
        changed += 1
        print('  [%2d/%d] %s (%.1f KB) 已更新' % (i, len(files), p, len(content) / 1024))

    print('实际更新 %d 个文件' % changed)

    print('代码已提交到默认分支')

    print('\n仓库地址: %s' % rep['html_url'])
    print('Render 用: https://github.com/%s/%s' % (owner, REPO_NAME))


if __name__ == '__main__':
    main()
