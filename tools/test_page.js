/**
 * 真实加载线上页面并检查三个板块是否可用。
 * 只看文件是否部署到位不够——脚本报错会让页面"看起来在"但功能全挂。
 * 注意：必须带会话 cookie，否则会被 auth.js 重定向到登录页，
 * 那样所有检查都会是 0，但并不是页面坏了。
 * 用法：node tools/test_page.js [host]
 */
const { JSDOM, VirtualConsole, CookieJar } = require('jsdom');
const https = require('https');

const HOST = process.argv[2] || 'https://asset-manager-vsf2.onrender.com';

function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const u = new URL(HOST + path);
    const req = https.request({
      hostname: u.hostname, path: u.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, res => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
    });
    req.on('error', reject);
    req.write(data); req.end();
  });
}

(async () => {
  const r = await post('/api/login', { user: 'admin', pass: '12345678' });
  const raw = (r.headers['set-cookie'] || []);
  console.log('登录:', r.status, '| set-cookie 条数:', raw.length);
  if (!raw.length) { console.log('没拿到会话，后续检查无意义'); return; }

  const jar = new CookieJar();
  raw.forEach(c => {
    try { jar.setCookieSync(c.split(';')[0], HOST); } catch (e) {}
  });

  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push('jsdomError: ' + (e.message || e)));
  vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));

  const dom = await JSDOM.fromURL(HOST + '/', {
    runScripts: 'dangerously',
    resources: 'usable',
    virtualConsole: vc,
    pretendToBeVisual: true,
    cookieJar: jar,
  });

  await new Promise(res => setTimeout(res, 10000));

  const w = dom.window, d = w.document;
  const q = s => d.querySelector(s);
  const count = s => d.querySelectorAll(s).length;

  const isLogin = /login/i.test(w.location.pathname || '') || !!q('#btnLogin');
  console.log('落地页:', w.location.pathname, isLogin ? '← 仍是登录页!' : '');

  const checks = [
    ['现金流入分类行', count('#cfInGrid .cf-row')],
    ['现金流出分类行', count('#cfOutGrid .cf-row')],
    ['回测资产池条目', count('.catalog .chip')],
    ['回测开始按钮', q('#btnRunBacktest') ? 1 : 0],
    ['预测开始按钮', (q('#btnRunForecast') || q('#btnForecastRun')) ? 1 : 0],
  ];

  console.log('\n--- 渲染检查 ---');
  checks.forEach(([label, n]) => console.log('  ' + (n > 0 ? '✓' : '✗') + ' ' + label + ': ' + n));

  console.log('\n--- 现金流三大数字 ---');
  ['#cfIncome', '#cfExpense', '#cfNet'].forEach(s => {
    const el = q(s);
    console.log('  ' + s + ': ' + (el ? el.textContent : '(元素不存在)'));
  });

  console.log('\n--- 脚本错误 ---');
  if (!errors.length) console.log('  无');
  else errors.slice(0, 12).forEach(e => console.log('  ' + e.slice(0, 170)));

  w.close();
})().catch(e => { console.error('测试失败:', e.message); process.exit(1); });
