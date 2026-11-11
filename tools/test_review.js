/**
 * 投资回顾功能实测：模拟「填入示例 → 一键分析」，校验计算结果。
 * 用法：node tools/test_review.js [host]
 */
const { JSDOM, VirtualConsole, CookieJar } = require('jsdom');
const http = require('http');
const https = require('https');

const HOST = process.argv[2] || 'http://127.0.0.1:8765';

function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const u = new URL(HOST + path);
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request({
      hostname: u.hostname, port: u.port || undefined, path: u.pathname, method: 'POST',
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
  const raw = r.headers['set-cookie'] || [];
  console.log('登录:', r.status, raw.length ? '(已取得会话)' : '(无 cookie)');

  const jar = new CookieJar();
  raw.forEach(c => { try { jar.setCookieSync(c.split(';')[0], HOST); } catch (e) {} });

  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push('jsdomError: ' + (e.message || e)));
  vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));

  const dom = await JSDOM.fromURL(HOST + '/', {
    runScripts: 'dangerously', resources: 'usable', virtualConsole: vc,
    pretendToBeVisual: true, cookieJar: jar,
    beforeParse(window) {
      window.fetch = (...a) => fetch(...a);
      window.Headers = Headers; window.Request = Request; window.Response = Response;
    },
  });

  await new Promise(res => setTimeout(res, 12000));
  const w = dom.window, d = w.document;
  const q = s => d.querySelector(s);
  const count = s => d.querySelectorAll(s).length;

  const checks = [];
  const push = (label, n, extra) => checks.push([label, n, extra || '']);

  push('投资回顾入口', count('.tab[data-tab="review"]'));
  push('独立页面', q('#page-review') ? 1 : 0);
  push('录入表格', q('#tblReview') ? 1 : 0);
  push('添加资产按钮', q('#btnRvAdd') ? 1 : 0);
  push('一键分析按钮', q('#btnRvAnalyze') ? 1 : 0);

  // 切到投资回顾并运行示例分析
  const tab = q('.tab[data-tab="review"]');
  if (tab) tab.click();
  const demo = q('#btnRvDemo');
  if (demo) demo.click();
  await new Promise(res => setTimeout(res, 250));
  push('示例记录行数', count('#tblReview tbody tr'));

  const run = q('#btnRvAnalyze');
  if (run) run.click();
  await new Promise(res => setTimeout(res, 400));

  const card = q('#rvResultCard');
  push('结果卡已展开', card && !card.hidden ? 1 : 0);
  push('KPI 卡片数', count('#rvKpis .kpi'));
  push('结果明细行(含合计)', count('#tblReviewResult tbody tr'));

  const kpiText = q('#rvKpis') ? q('#rvKpis').textContent : '';
  const concl = q('#rvConcl') ? q('#rvConcl').textContent : '';
  const tbl = q('#tblReviewResult') ? q('#tblReviewResult').textContent : '';
  const state = q('#rvState') ? q('#rvState').textContent : '';

  console.log('\n--- 渲染检查 ---');
  checks.forEach(([l, n, ex]) => console.log('  ' + (n > 0 ? '✓' : '✗') + ' ' + l + ': ' + n + (ex ? '  ' + ex : '')));

  console.log('\n--- 数值校验（示例应为 总投入 290,000 / 最终 358,900 / 净盈亏 +68,900 / +23.76%）---');
  const numChecks = [
    ['总投入 ¥290,000', kpiText.includes('¥290,000')],
    ['最终资产 ¥358,900', kpiText.includes('¥358,900')],
    ['净盈亏含 68,900', kpiText.includes('6.89万') || kpiText.includes('68,900')],
    ['总盈亏比例 +23.76%', kpiText.includes('+23.76%')],
    ['整体盈利结论', concl.includes('整体盈利')],
    ['盈利/亏损 3 / 1', /3\s*\/\s*1\s*\/\s*0/.test(concl)],
    ['明细含沪深300 +38.00%', tbl.includes('+38.00%')],
    ['明细含科技股 -35.00%', tbl.includes('-35.00%')],
    ['明细含黄金 +51.67%', tbl.includes('+51.67%')],
    ['无 NaN/Infinity', !/NaN|Infinity/.test(kpiText + concl + tbl)],
    ['XIRR 已计算', /资金加权收益率 XIRR/.test(kpiText) && !kpiText.includes('XIRR—')],
    ['状态提示', state.includes('分析完成')],
  ];
  numChecks.forEach(([l, ok]) => console.log('  ' + (ok ? '✓' : '✗') + ' ' + l));

  console.log('\n--- KPI 摘要 ---');
  if (q('#rvKpis')) {
    q('#rvKpis').querySelectorAll('.kpi').forEach(k => {
      console.log('  ' + k.querySelector('.kpi-label').textContent + ': ' +
        k.querySelector('.kpi-val').textContent + '  (' + k.querySelector('.kpi-sub').textContent + ')');
    });
  }

  console.log('\n--- 脚本错误（canvas 类可忽略）---');
  const real = errors.filter(e => !/canvas|getContext|clearRect/.test(e));
  if (!real.length) console.log('  无实质错误');
  else real.slice(0, 8).forEach(e => console.log('  ' + e.slice(0, 160)));

  dom.window.close();
})().catch(e => { console.error('测试失败:', e.stack || e.message); process.exit(1); });
