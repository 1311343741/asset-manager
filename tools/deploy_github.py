# -*- coding: utf-8 -*-
"""
把本地 git 仓库的已跟踪文件同步到 GitHub 仓库。

要点：
- 空仓库不能用 Git Data API 建 blob（409 "Git Repository is empty"），
  所以文件写入统一用 Contents API（PUT）。
- **比对远端是否已变更用 Git Data API 的 tree**（GET /git/trees/<branch>?recursive=1）：
  它只返回 path/sha，不含文件内容。若改用 Contents API 的 GET，
  1MB 级的 snapshot.json 会把完整 base64 内容传回来，容易 IncompleteRead。
- 本地 git blob sha 的计算方式：sha1("blob <len>\0" + content)，与 GitHub 一致。

用法：
    python tools/deploy_github.py <github_token> [仓库名]
"""
import base64
import hashlib
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

API = 'https://api.github.com'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO_NAME = sys.argv[2] if len(sys.argv) > 2 else 'asset-manager'


def api(method, path, token, body=None, retry=3):
    url = API + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header('Authorization', 'Bearer ' + token)
    req.add_header('Accept', 'application/vnd.github+json')
    if data:
        req.add_header('Content-Type', 'application/json')
    last = None
    for i in range(retry):
        try:
            r = urllib.request.urlopen(req, timeout=60)
            raw = r.read()
            return r.status, (json.loads(raw) if raw else {})
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read().decode('utf-8', 'ignore') or '{}')
        except Exception as e:
            last = e
            time.sleep(1.5 * (i + 1))
    raise last


def blob_sha(content):
    return hashlib.sha1(b'blob %d\0' % len(content) + content).hexdigest()


def local_files():
    out = subprocess.check_output(
        ['git', '-c', 'core.quotepath=false', 'ls-files'], cwd=ROOT, text=True)
    return [l.strip().strip('"') for l in out.splitlines() if l.strip()]


def remote_tree(owner, repo, token):
    """拿到远端每个文件的 blob sha（不含文件内容）"""
    st, d = api('GET', '/repos/%s/%s/git/trees/main?recursive=1' % (owner, repo), token)
    out = {}
    if st == 200:
        for it in (d.get('tree') or []):
            if it.get('type') == 'blob':
                out[it['path']] = it['sha']
    return out


def main():
    token = (sys.argv[1] if len(sys.argv) > 1 else '').strip()
    if not token:
        sys.exit('缺少 GitHub token')

    st, me = api('GET', '/user', token)
    if st != 200:
        sys.exit('token 无效: %s %s' % (st, me))
    owner = me['login']
    print('GitHub 账号:', owner)

    st, rep = api('GET', '/repos/%s/%s' % (owner, REPO_NAME), token)
    if st == 200:
        print('仓库已存在:', rep['html_url'])
        tree = remote_tree(owner, REPO_NAME, token)
        print('远端已有 %d 个文件' % len(tree))
    else:
        st, rep = api('POST', '/user/repos', token, {
            'name': REPO_NAME, 'private': False,
            'description': 'Asset Manager: net-worth, backtest, forecast',
            'auto_init': False,
        })
        if st not in (201, 200):
            sys.exit('创建仓库失败: %s %s' % (st, rep))
        print('仓库已创建:', rep['html_url'])
        tree = {}

    files = local_files()
    print('待处理 %d 个文件' % len(files))

    changed = 0
    for i, path in enumerate(files, 1):
        fp = os.path.join(ROOT, path)
        if not os.path.exists(fp):          # 已跟踪但本地删掉了，别硬读
            print('  [%2d/%d] %s (本地已不存在，跳过)' % (i, len(files), path))
            continue
        with open(fp, 'rb') as f:
            content = f.read()
        p = path.replace('\\', '/')
        if tree.get(p) == blob_sha(content):
            print('  [%2d/%d] %s (未变更，跳过)' % (i, len(files), p))
            continue
        body = {'message': 'Asset Manager: net-worth / backtest / forecast',
                'content': base64.b64encode(content).decode()}
        if p in tree:
            body['sha'] = tree[p]
        st, res = api('PUT', '/repos/%s/%s/contents/%s'
                      % (owner, REPO_NAME, urllib.parse.quote(p)), token, body, retry=4)
        if st not in (200, 201):
            sys.exit('上传失败 %s: %s %s' % (p, st, str(res)[:150]))
        changed += 1
        print('  [%2d/%d] %s (%.1f KB) 已更新' % (i, len(files), p, len(content) / 1024))
        time.sleep(0.3)

    print('实际更新 %d 个文件' % changed)
    print('\n仓库地址: https://github.com/%s/%s' % (owner, REPO_NAME))


if __name__ == '__main__':
    main()
