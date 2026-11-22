/**
 * 未来预测：本金录入 → 权重 / 总本金自动计算 的实测。
 * 从 index.html 提取真实预测页 DOM，AM 打桩，eval 真实 forecast.js。
 */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const ROOT = path.dirname(__dirname);
const html = fs.readFileSync(path.join(ROOT, 'static/index.html'), 'utf8');
const m = html.match(/<section class="page" id="page-forecast">[\s\S]*?<\/section>/);
if (!m) { console.error('未找到预测页 DOM'); process.exit(1); }
const code = fs.readFileSync(path.join(ROOT, 'static/js/forecast.js'), 'utf8');

const dom = new JSDOM('<!DOCTYPE html><body>' + m[0] + '</body>', { runScripts: 'outside-only' });
const w = dom.window, d = w.document;

const CATALOG = [
  { group: 'A股', color: '#000', items: [
    { secid: '1.000300', name: '沪深300' },
    { secid: '1.518880', name: '黄金ETF（人民币计价）' },
    { secid: '1.511260', name: '十年国债ETF' },
  ] },
  { group: '美股', color: '#000', items: [{ secid: '100.SPX', name: '标普500' }] },
];
const fmtMoney = (v, dec) => {
  const n = Number(v) || 0, a = Math.abs(n);
  let s = a, unit = '';
  if (a >= 1e8) { s = a / 1e8; unit = '亿'; } else if (a >= 1e4) { s = a / 1e4; unit = '万'; }
  const dd = dec === undefined ? (s >= 1000 ? 0 : s >= 100 ? 1 : 2) : dec;
  return (n < 0 ? '-¥' : '¥') + s.toFixed(dd) + unit;
};
w.AM = {
  $: s => d.querySelector(s), $$: s => Array.from(d.querySelectorAll(s)),
  state: {}, save() {}, toast() {}, setNet() {},
  fmtMoney, fmtFull(v) { return '¥' + Math.round(Number(v) || 0).toLocaleString('zh-CN'); },
  fmtPct(v, dec) { return (v > 0 ? '+' : '') + Number(v || 0).toFixed(dec === undefined ? 2 : dec) + '%'; },
  fmtNum(v, dec) { return Number(v || 0).toFixed(dec === undefined ? 2 : dec); },
  api(name) { return Promise.resolve(name === 'catalog' ? { catalog: CATALOG } : {}); },
  apiPost() { return Promise.resolve({}); },
  loadSnapshot() { return Promise.resolve(); },
  probeSource() {}, sourceLabel() { return ''; }, getDataMode() { return 'api'; },
  today() { return '2026-11-22'; }, yearsAgo() { return '2023-11-22'; },
  ymd() { return '2026-11-22'; }, ymdCompact(s) { return (s || '').replace(/-/g, ''); },
  chart() {}, resizeCharts() {}, GRID: {}, AXIS_STYLE: {},
  mean() { return 0; }, stdev() { return 0; }, quantile() { return 0; },
  toReturns() { return []; }, maxDrawdown() { return 0; }, cagr() { return 0; },
  mulberry32() { return () => 0.5; }, gaussFactory() { return () => 0; },
};
w.confirm = () => true;

w.eval(code);
w.Forecast.init();

const checks = [];
const fire = (el, type) => el.dispatchEvent(new w.Event(type, { bubbles: true }));

setTimeout(() => {
  const q = s => d.querySelector(s);
  const rows = d.querySelectorAll('#tblMachine tbody tr');
  const caps = d.querySelectorAll('#tblMachine .fc-capital');
  const wts = d.querySelectorAll('#tblMachine .fc-wauto');

  checks.push(['机器表默认 4 行', rows.length === 4, rows.length]);
  checks.push(['每行都有本金输入框', caps.length === 4, caps.length]);
  checks.push(['每行都有权重显示', wts.length === 4, wts.length]);
  checks.push(['顶部本金只读', q('#fcInit').readOnly === true, q('#fcInit').readOnly]);
  checks.push(['权重只读(机器计算)', Array.from(wts).every(x => x.readOnly), '']);
  checks.push(['默认总本金 100000', q('#fcInit').value === '100000', q('#fcInit').value]);
  checks.push(['默认各权重 25%', Array.from(wts).every(x => x.value === '25.00%'), wts[0] && wts[0].value]);
  checks.push(['权重合计 100%', q('#cWeightSum').textContent === '100%', q('#cWeightSum').textContent]);
  checks.push(['合计行本金 ¥10万', q('#cCapitalSum').textContent.includes('万'), q('#cCapitalSum').textContent]);
  checks.push(['手动表也有本金列', d.querySelectorAll('#tblManual thead th').length === 6, '']);

  // 切到机器模式，改第一行本金为 50000
  const seg = q('#fcMode .seg[data-mode="machine"]');
  if (seg) seg.click();
  caps[0].value = '50000';
  fire(caps[0], 'input');
  checks.push(['改本金后总额 125000', q('#fcInit').value === '125000', q('#fcInit').value]);
  checks.push(['该行权重 40%', wts[0].value === '40.00%', wts[0].value]);
  checks.push(['其余行权重 20%', wts[1].value === '20.00%' && wts[3].value === '20.00%', wts[1].value]);
  checks.push(['合计仍 100%', q('#cWeightSum').textContent === '100%', q('#cWeightSum').textContent]);

  // 千分位输入
  caps[0].value = '100,000';
  fire(caps[0], 'input');
  checks.push(['千分位本金可识别', q('#fcInit').value === '175000', q('#fcInit').value]);
  checks.push(['权重随之变化', wts[0].value !== '40.00%', wts[0].value]);

  console.log('--- 未来预测本金/权重自动化实测 ---');
  let bad = 0;
  checks.forEach(([l, ok, ex]) => { if (!ok) bad++; console.log('  ' + (ok ? '✓' : '✗') + ' ' + l + (ex !== '' && ex !== undefined ? '  [' + ex + ']' : '')); });
  console.log('\n结论:', bad === 0 ? '全部通过' : bad + ' 项未通过');
  process.exit(bad === 0 ? 0 : 1);
}, 400);
