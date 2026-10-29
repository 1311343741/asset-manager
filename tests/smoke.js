/* 冒烟测试：用 jsdom 加载页面，跑通三大功能的真实计算链路
 *
 * 跑两遍：
 *   1) live      —— 后端在线，走 /api 实时接口
 *   2) offline   —— 后端不可用，验证自动降级到 static/data/snapshot.json
 *
 * 运行：
 *   npm install jsdom
 *   NODE_PATH=<ws>/node_modules JSDOM_PATH=<ws>/node_modules/jsdom node tests/smoke.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require(process.env.JSDOM_PATH || 'jsdom');

const ROOT = path.resolve(__dirname, '..');
const HOST = 'http://127.0.0.1:8765';
const SNAP = path.join(ROOT, 'static', 'data', 'snapshot.json');
const html = fs.readFileSync(path.join(ROOT, 'static', 'index.html'), 'utf8')
  .replace(/<script src="vendor\/echarts\.min\.js"><\/script>/, '');

const JS_FILES = ['auth.js', 'core.js', 'networth.js', 'backtest.js', 'forecast.js', 'main.js'];

function boot(offline, cookie) {
  const errors = [];
  const chartCalls = {};
  const dom = new JSDOM(html, { url: HOST + '/', runScripts: 'outside-only', pretendToBeVisual: true });
  const win = dom.window;

  // 模拟“已登录”，否则 auth.js 守卫会把页面重定向到 login.html
  try { win.sessionStorage.setItem('am_auth', '1'); } catch (e) {}

  win.echarts = {
    init(el) {
      const id = el && el.id;
      return { setOption(opt) { chartCalls[id] = opt; }, resize() {}, dispose() {} };
    },
  };
  win.fetch = (u, o) => {
    const url = String(u);
    o = Object.assign({}, o);
    o.headers = Object.assign({}, o.headers || {});
    if (cookie) o.headers.Cookie = cookie;      // 服务已启用登录认证
    if (offline && url.indexOf('/api/') >= 0) return Promise.reject(new Error('backend offline'));
    if (url.indexOf('snapshot.json') >= 0) {
      if (!fs.existsSync(SNAP)) return Promise.resolve({ ok: false, status: 404 });
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve(JSON.parse(fs.readFileSync(SNAP, 'utf8'))),
      });
    }
    const full = url.startsWith('http') ? url : HOST + '/' + url.replace(/^\//, '');
    return globalThis.fetch(full, o);
  };
  win.addEventListener('error', e => errors.push('window.error: ' + (e.message || e.error)));
  win.console.error = (...a) => errors.push('console.error: ' + a.join(' '));

  const ctx = dom.getInternalVMContext();
  JS_FILES.forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT, 'static', 'js', f), 'utf8'), ctx, { filename: f }));

  return { win, errors, chartCalls };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function suite(offline, cookie) {
  const label = offline ? '离线快照模式' : '实时接口模式';
  console.log('\n############  ' + label + '  ############');

  const { win, errors, chartCalls } = boot(offline, cookie);
  const $ = s => win.document.querySelector(s);
  const txt = s => { const e = $(s); return e ? e.textContent.trim() : '<missing ' + s + '>'; };
  const assert = (cond, msg) => {
    console.log((cond ? '  PASS  ' : '  FAIL  ') + msg);
    if (!cond) errors.push('assert(' + label + '): ' + msg);
  };

  win.document.dispatchEvent(new win.Event('DOMContentLoaded'));
  await sleep(600);

  console.log('\n=== ① 资产负债 ===');
  assert(!!win.NetWorth, 'NetWorth 模块已加载');
  $('#btnDemo').click();
  await sleep(150);
  const t = win.NetWorth.totals();
  assert(t.ta === 2660000, '总资产 = 2,660,000');
  assert(t.td === 1025000, '总负债 = 1,025,000');
  assert(t.net === 1635000, '净资产 = 1,635,000');
  assert(Math.abs(t.ratio - 1025000 / 2660000) < 1e-9, '资产负债率 = ' + (t.ratio * 100).toFixed(2) + '%');
  assert(txt('#kNetAsset').includes('163.5万'), 'KPI 净资产显示：' + txt('#kNetAsset'));
  assert(txt('#kTotalAsset').includes('266万'), 'KPI 总资产显示：' + txt('#kTotalAsset'));
  assert(chartCalls['chartAssetPie'] && chartCalls['chartAssetPie'].series[0].data.length === 6, '资产结构饼图有 6 项');

  // 需求①：明细级占比（每行百分比 + 旭日图）
  const pctOf = (kind, name) => {
    const list = kind === 'asset' ? win.AM.state.assets : win.AM.state.debts;
    const r = list.find(x => x.name === name);
    if (!r) return null;
    const el = win.document.querySelector('[data-pct="' + r.id + '"] span');
    return el ? el.textContent : null;
  };
  const pctElsA = [...win.document.querySelectorAll('#tblAsset tbody [data-pct]')];
  const pctElsD = [...win.document.querySelectorAll('#tblDebt tbody [data-pct]')];
  assert(pctElsA.length === 6, '资产明细每行都有占比条（' + pctElsA.length + ' 行）');
  assert(pctElsD.length === 2, '负债明细每行都有占比条（' + pctElsD.length + ' 行）');
  console.log('  明细占比：' + win.AM.state.assets.map(a => a.name + ' ' + pctOf('asset', a.name)).join(' | '));
  assert(pctOf('asset', '活期存款') === '2.3%', '活期存款 = 6万/266万 = 2.3%');
  assert(pctOf('asset', '自住房') === '67.7%', '自住房 = 180万/266万 = 67.7%');
  assert(pctOf('debt', '住房按揭') === '95.6%', '住房按揭 = 98万/102.5万 = 95.6%');
  const sumPct = win.AM.state.assets.reduce((s, a) => s + parseFloat(pctOf('asset', a.name) || 0), 0);
  assert(Math.abs(sumPct - 100) < 0.5, '各明细占比合计 ≈ 100%（' + sumPct.toFixed(1) + '%）');

  const sun = chartCalls['chartAssetSun'];
  assert(sun && sun.series[0].type === 'sunburst', '新增旭日图（类别→明细）');
  assert(sun && sun.series[0].data.length === 6, '旭日图内圈 6 个类别');
  assert(sun && sun.series[0].data.reduce((s, d) => s + d.children.length, 0) === 6, '旭日图外圈 6 个单项');
  assert(chartCalls['chartDebtPie'] && chartCalls['chartDebtPie'].series[0].data.length === 2, '负债结构饼图 2 项');

  console.log('\n=== ② 历史回测 ===');
  await sleep(offline ? 600 : 1600);
  assert($('#catalog').children.length > 0, '资产池目录渲染 ' + $('#catalog').children.length + ' 组');
  assert(win.Backtest.getBasket().length === 5, '默认组合 5 个标的（首屏即有内容）');
  $('#btnClearBasket').click();
  await sleep(80);

  [...win.document.querySelectorAll('#catalog .citem')].forEach(el => {
    const nm = el.firstChild.textContent;
    if (['沪深300', '标普500', '黄金ETF（人民币计价）', '十年国债ETF'].includes(nm)) el.click();
  });
  await sleep(120);
  const basket = win.Backtest.getBasket();
  console.log('  组合：' + basket.map(b => b.name + ' ' + b.weight + '%').join(' | '));
  assert(basket.length === 4, '已选 4 个标的');
  assert(Math.abs(basket.reduce((s, b) => s + b.weight, 0) - 100) < 0.5, '权重合计 100%');
  assert(basket.every(b => Math.abs(b.weight - 25) < 0.5), '新增标的后自动均分（各 25%）');

  $('#btStart').value = '2021-01-01';
  $('#btEnd').value = '2026-10-27';
  $('#btnRunBacktest').click();
  for (let i = 0; i < 90; i++) {
    await sleep(1000);
    const st = txt('#btState');
    if (st.startsWith('完成') || st.startsWith('失败')) break;
  }
  const btState = txt('#btState');
  console.log('  状态：' + btState);
  assert(btState.startsWith('完成'), '回测执行成功');

  const r = win.Backtest.getResult();
  if (r) {
    const m = r.m;
    console.log('  区间 %s ~ %s（%s 年）', r.al.dates[0], r.al.dates[r.al.dates.length - 1], m.years.toFixed(2));
    console.log('  期末=%d 投入=%d 净收益=%d', Math.round(m.finalNav), Math.round(m.invested), Math.round(m.profit));
    console.log('  年化=%s%% IRR=%s 最大回撤=%s%% 波动=%s%% 夏普=%s',
      (m.cagr * 100).toFixed(2), m.irr === null ? '-' : (m.irr * 100).toFixed(2),
      (m.mdd * 100).toFixed(2), (m.vol * 100).toFixed(2), m.sharpe.toFixed(2));
    let months = 0;
    for (let i = 1; i < r.al.dates.length; i++) {
      if (r.al.dates[i].slice(0, 7) !== r.al.dates[i - 1].slice(0, 7)) months++;
    }
    assert(r.al.dates[0] <= '2021-02-01', '起始日期未被日期格式 BUG 吞掉：' + r.al.dates[0]);
    assert(m.years > 4 && m.years < 6.5, '回测年限约 5 年');
    assert(m.invested === 100000 + 2000 * months, '累计投入 = 10万 + 2000×' + months + ' 期 = ' + m.invested);
    assert(m.mdd <= 0 && m.mdd > -1, '最大回撤在 (-100%, 0]');
    assert(m.irr !== null && m.irr > -0.5 && m.irr < 0.5, 'IRR 可解且合理');
    assert(r.details.length === 4, '明细表 4 个标的');
    assert(chartCalls['chartBtNav'].series.length === 5, '净值曲线 5 条（组合+基准+3 个标的）');
    assert(chartCalls['chartBtYear'].series[0].data.length >= 5, '年度收益柱状图 >= 5 年');
  }

  // ---- 需求②：短历史标的不得压缩回测区间 ----
  $('#btnClearBasket').click();
  await sleep(80);
  [...win.document.querySelectorAll('#catalog .citem')].forEach(el => {
    if (['沪深300', '30年国债ETF'].includes(el.firstChild.textContent)) el.click();
  });
  await sleep(120);
  $('#btStart').value = '2016-01-01';
  $('#btEnd').value = '2026-10-27';
  $('#btnRunBacktest').click();
  for (let i = 0; i < 90; i++) {
    await sleep(1000);
    if (txt('#btState').startsWith('完成') || txt('#btState').startsWith('失败')) break;
  }
  const rShort = win.Backtest.getResult();
  if (rShort) {
    console.log('  短历史组合区间：%s ~ %s', rShort.al.dates[0], rShort.al.dates[rShort.al.dates.length - 1]);
    assert(rShort.al.dates[0] <= '2016-02-01',
      '区间未被 3 年历史的「30年国债ETF」压缩（起点 ' + rShort.al.dates[0] + '）');
    const d30 = rShort.details.find(d => d.secid === '1.511090');
    assert(!!d30, '明细含 30年国债ETF');
    if (!offline) {
      assert(d30 && d30.estimated, '标注为「含模拟数据」');
      assert(d30 && d30.realStart === '2023-06-13', '真实数据起点 = ' + (d30 && d30.realStart));
      assert($('#btDataNote').textContent.includes('模拟'), '结果区显示模拟数据说明');
    } else {
      assert(d30 && d30.from === '2023-06-13', '离线模式标注「自 2023-06-13 起纳入」');
    }
  }

  console.log('\n=== ③ 未来预测（手动） ===');
  $('#btnPresetBalanced').click();
  await sleep(250);
  $('#fcInit').value = '1000000';
  $('#fcContribMode').value = 'year';      // 每年一次
  $('#fcYears').value = '30';
  $('#fcAnnual').value = '60000';
  $('#btnRunForecast').click();
  await sleep(500);
  const mres = win.Forecast.getLast();
  assert(mres && mres.kind === 'manual', '手动模式产出结果');
  if (mres) {
    const last = mres.yearly[mres.yearly.length - 1];
    console.log('  组合年化=%s%%  30 年后：中性=%d 乐观=%d 悲观=%d',
      mres.annualized.toFixed(2), Math.round(last.value), Math.round(mres.opt[30].value), Math.round(mres.pess[30].value));
    assert(mres.yearly.length === 31 && mres.yearly[30].year === 30, '推演 0~30 年共 31 个节点');
    assert(mres.opt[30].value > last.value && last.value > mres.pess[30].value, '乐观 > 中性 > 悲观');
    assert(Math.abs(last.invested - (1000000 + 60000 * 30)) < 1,
      '按年：累计投入 = 100万 + 6万×30期 = ' + last.invested);

    // 需求③：累计投入 = 每次金额 × 期数（三种频率应互相印证）
    const contribCases = [
      ['month', 5000, 12, '按月 5000×120 期'],
      ['quarter', 15000, 4, '按季 15000×40 期'],
      ['year', 60000, 1, '按年 60000×10 期'],
    ];
    for (const [fr, per, times, label] of contribCases) {
      $('#fcContribMode').value = fr;
      $('#fcAnnual').value = String(per);
      $('#fcYears').value = '10';
      $('#btnRunForecast').click();
      await sleep(320);
      const rr = win.Forecast.getLast();
      const want = 1000000 + per * times * 10;      // 三种频率每年都是 6 万
      const got = rr.yearly[rr.yearly.length - 1].invested;
      console.log('  %s -> 累计投入 %d（预期 %d）', label, Math.round(got), want);
      assert(Math.abs(got - want) < 1, label + ' 累计投入正确');
    }
    assert(Math.abs(win.document.querySelector('#fcContribHint').textContent.length) > 0, '输入区显示累计投入提示');

    $('#fcContribMode').value = 'year';
    $('#fcAnnual').value = '0';
    $('#fcYears').value = '10';
    $('#btnRunForecast').click();
    await sleep(350);
    const r2 = win.Forecast.getLast();
    const ann = r2.annualized / 100;
    const expect = 1000000 * Math.pow(Math.pow(1 + ann, 1 / 12), 120);
    const got = r2.yearly[10].value;
    console.log('  复利校验（10 年，年化 %s%%）：期望 %d 实际 %d', (ann * 100).toFixed(3), Math.round(expect), Math.round(got));
    assert(Math.abs(got - expect) / expect < 1e-6, '按月复利计算精确');
  }

  console.log('\n=== ④ 未来预测（机器） ===');
  $('#fcMode .seg[data-mode="machine"]').click();
  await sleep(120);
  assert($('#fcYears').getAttribute('max') === '30', '机器模式年限上限 30');
  $('#fcYears').value = '30';
  $('#btnMachineFromBasket').click();
  await sleep(400);
  for (let i = 0; i < 60; i++) {
    await sleep(800);
    if (txt('#fcState').includes('已更新') || txt('#fcState').includes('失败')) break;
  }
  console.log('  统计：' + txt('#fcState'));
  assert(txt('#fcState').includes('已更新'), '拉取历史统计成功');

  $('#fcInit').value = '1000000';
  $('#fcContribMode').value = 'month';
  $('#fcYears').value = '20';
  $('#fcAnnual').value = '50000';
  $('#fcMethod').value = 'boot';
  $('#fcPaths').value = '2000';
  $('#fcTarget').value = '5000000';
  $('#btnRunForecast').click();
  await sleep(3000);
  const cres = win.Forecast.getLast();
  assert(cres && cres.kind === 'machine', '机器模式产出结果');
  if (cres) {
    console.log('  μ=%s%% σ=%s%%  20 年：P10=%d P50=%d P90=%d',
      (cres.mu * 100).toFixed(2), (cres.sigma * 100).toFixed(2),
      Math.round(cres.p10), Math.round(cres.p50), Math.round(cres.p90));
    assert(cres.yearly.length === 20, '预测 20 年');
    assert(cres.finals.length === 2000, '模拟 2000 条路径');
    const wantInv = 1000000 + 50000 * 12 * 20;      // 每月 5 万 × 240 期
    console.log('  机器模式累计投入 %d（预期 %d）', Math.round(cres.investedTotal), wantInv);
    assert(Math.abs(cres.investedTotal - wantInv) < 1, '机器模式累计投入 = 100万 + 5万×240 期');
    assert(cres.p10 < cres.p50 && cres.p50 < cres.p90, '分位数有序 P10 < P50 < P90');
    assert(cres.sigma >= 0 && cres.sigma < 1.5, '波动率合理');
    assert(chartCalls['chartForecast'] && chartCalls['chartForecast'].series.length === 6, '预测图 6 条系列');
    assert($('#fcKpis').textContent.includes('达成'), '含达成目标概率');
  }

  if (offline) {
    console.log('\n=== ⑤ 离线降级检查 ===');
    assert(win.AM.getDataMode() === 'snapshot', '数据来源标记为离线快照');
    assert(txt('#netNote').includes('离线快照'), '顶栏提示：' + txt('#netNote'));
  } else {
    assert(win.AM.getDataMode() === 'live', '数据来源标记为实时接口');
  }

  return errors;
}

/** 登录守卫：没有任何会话标记时，auth.js 必须把页面重定向到 login.html */
function checkGuard() {
  const code = fs.readFileSync(path.join(ROOT, 'static', 'js', 'auth.js'), 'utf8');
  const sandbox = {
    document: { cookie: '' },
    sessionStorage: { getItem: () => null },
    localStorage: { getItem: () => null },
    location: { replace: (u) => { sandbox.__nav = u; } },
  };
  sandbox.window = sandbox;
  try {
    vm.runInNewContext(code, sandbox);
  } catch (e) {
    return false;
  }
  return sandbox.__nav === 'login.html';
}

(async () => {
  if (!fs.existsSync(SNAP)) {
    console.error('缺少 static/data/snapshot.json，请先运行：python tools/build_snapshot.py');
    process.exit(1);
  }
  // 服务启用了登录认证，先取会话再跑
  let cookie = '';
  try {
    const r = await globalThis.fetch(HOST + '/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: 'admin', pass: '12345678' }),
    });
    const sc = (r.headers && r.headers.get ? r.headers.get('set-cookie') : '') || '';
    cookie = sc.split(';')[0];
  } catch (e) { /* 服务未启用认证时留空 */ }
  console.log('登录会话：' + (cookie ? '已获取' : '无（服务未启用认证）'));

  const all = [];
  all.push(...await suite(false, cookie));
  all.push(...await suite(true, cookie));

  // 登录守卫：未登录应被重定向到 login.html
  const guard = checkGuard();
  (guard ? [] : ['登录守卫未生效']).forEach(m => all.push(m));
  console.log('登录守卫：' + (guard ? 'PASS 未登录时跳转 login.html' : 'FAIL'));

  console.log('\n============ 结果 ============');
  if (all.length) {
    console.log('存在 ' + all.length + ' 个问题：');
    all.forEach(e => console.log('  - ' + e));
    process.exitCode = 1;
  } else {
    console.log('两套模式全部通过，无 JS 错误。');
  }
  process.exit(process.exitCode || 0);
})().catch(e => { console.error('测试异常：', e); process.exit(1); });
