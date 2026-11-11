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
    beforeParse(window) {
      // jsdom 不实现 fetch，借用 Node 的全局 fetch，否则页面脚本会在这里中断
      window.fetch = (...a) => fetch(...a);
      window.Headers = Headers; window.Request = Request; window.Response = Response;
    },
  });

  await new Promise(res => setTimeout(res, 20000));

  const w = dom.window, d = w.document;
  const q = s => d.querySelector(s);
  const count = s => d.querySelectorAll(s).length;

  const isLogin = /login/i.test(w.location.pathname || '') || !!q('#btnLogin');
  console.log('落地页:', w.location.pathname, isLogin ? '← 仍是登录页!' : '');

  // 模拟点击「添加现金流」，验证能生成带下拉的可编辑行
  const cfAdd = q('#btnCfAdd');
  if (cfAdd) cfAdd.click();
  await new Promise(res => setTimeout(res, 300));

  // 交互：选「不定投」后，回测与预测的定投金额都应自动归零
  const btF = q('#btDcaFreq'), fcF = q('#fcContribMode');
  const Ev = w.Event;
  if (btF) { btF.value = 'none'; btF.dispatchEvent(new Ev('change')); }
  if (fcF) { fcF.value = 'none'; fcF.dispatchEvent(new Ev('change')); }
  await new Promise(res => setTimeout(res, 200));

  const checks = [
    ['回测定投金额归零', (q('#btDcaAmt') && q('#btDcaAmt').value === '0') ? 1 : 0],
    ['预测定投金额归零', (q('#fcAnnual') && q('#fcAnnual').value === '0') ? 1 : 0],
    ['占总现金流列', count('#tblCashflow [data-cf-pct]')],
    ['现金流表格行', count('#tblCashflow tbody tr')],
    ['添加现金流按钮', q('#btnCfAdd') ? 1 : 0],
    ['分类下拉', count('#tblCashflow select')],
    ['回测资产池条目', q('#catalog') ? q('#catalog').children.length : 0],
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
