/**
 * 投资回顾：纯计算逻辑实测（不依赖网络/服务/canvas）。
 * 用最小 DOM + AM 桩加载真实 review.js，跑「填入示例 → 一键分析」并校验数值。
 */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const ROOT = path.dirname(__dirname);
const code = fs.readFileSync(path.join(ROOT, 'static/js/review.js'), 'utf8');

const dom = new JSDOM(`<!DOCTYPE html><body>
  <table id="tblReview"><tbody></tbody></table>
  <button id="btnRvAdd"></button><button id="btnRvAnalyze"></button>
  <button id="btnRvDemo"></button><button id="btnRvClear"></button>
  <span id="rvState"></span>
  <div id="rvResultCard" hidden>
    <div id="rvKpis"></div><div id="rvConcl"></div>
    <table id="tblReviewResult"><tbody></tbody></table>
    <div id="chartReviewPnl"></div><div id="chartReviewAnn"></div>
  </div>
</body>`, { runScripts: 'outside-only' });

const w = dom.window;
const d = w.document;

function fmtMoney(v, dec) {
  const n = Number(v) || 0, neg = n < 0, a = Math.abs(n);
  let s, unit = '';
  if (a >= 1e8) { s = a / 1e8; unit = '亿'; }
  else if (a >= 1e4) { s = a / 1e4; unit = '万'; }
  else { s = a; unit = ''; }
  const dd = dec === undefined ? (s >= 1000 ? 0 : s >= 100 ? 1 : 2) : dec;
  return (neg ? '-¥' : '¥') + s.toFixed(dd) + unit;
}

w.AM = {
  $: s => d.querySelector(s),
  $$: s => Array.from(d.querySelectorAll(s)),
  state: { reviewRows: [] },
  save() {}, toast() {},
  today() { return '2026-11-11'; },
  yearsAgo() { return '2023-11-11'; },
  fmtMoney,
  fmtFull(v) { const n = Number(v) || 0; return (n < 0 ? '-' : '') + '¥' + Math.abs(n).toLocaleString('zh-CN', { maximumFractionDigits: 0 }); },
  fmtPct(v, dec) { const n = Number(v) || 0; return (n > 0 ? '+' : '') + n.toFixed(dec === undefined ? 2 : dec) + '%'; },
  chart() {}, resizeCharts() {},
  GRID: {}, AXIS_STYLE: {},
};
w.confirm = () => true;

w.eval(code);
w.Review.init();
d.querySelector('#btnRvDemo').click();
const rowCount = d.querySelectorAll('#tblReview tbody tr').length;
d.querySelector('#btnRvAnalyze').click();

const kpi = d.querySelector('#rvKpis').textContent;
const concl = d.querySelector('#rvConcl').textContent;
const tbl = d.querySelector('#tblReviewResult').textContent;
const state = d.querySelector('#rvState').textContent;
const shown = !d.querySelector('#rvResultCard').hidden;
const kpiCount = d.querySelectorAll('#rvKpis .kpi').length;

const checks = [
  ['示例录入 4 行', rowCount === 4, rowCount],
  ['结果卡展开', shown, ''],
  ['KPI 6 张', kpiCount === 6, kpiCount],
  ['结果明细 5 行(含合计)', d.querySelectorAll('#tblReviewResult tbody tr').length === 5, ''],
  ['总投入 ¥290,000', kpi.includes('¥290,000'), ''],
  ['最终资产 ¥358,900', kpi.includes('¥358,900'), ''],
  ['净盈亏 +¥6.89万', kpi.includes('+¥6.89万'), ''],
  ['总盈亏比例 +23.76%', kpi.includes('+23.76%'), ''],
  ['整体盈利', concl.includes('整体盈利'), ''],
  ['盈利/亏损/持平 3/1/0', /3\s*\/\s*1\s*\/\s*0/.test(concl), ''],
  ['沪深300 +38.00%', tbl.includes('+38.00%'), ''],
  ['科技股 -35.00%', tbl.includes('-35.00%'), ''],
  ['黄金 +51.67%', tbl.includes('+51.67%'), ''],
  ['表现最佳为黄金ETF', concl.includes('黄金ETF'), ''],
  ['XIRR 有值', /XIRR/.test(kpi) && !/XIRR\s*—/.test(kpi), ''],
  ['无 NaN / Infinity', !/NaN|Infinity/.test(kpi + concl + tbl), ''],
  ['状态=分析完成', state.includes('分析完成'), state],
];

// --- 输入控件交互检查（放在数值校验之后，避免影响上面的示例结果）---
const moneyInputs = d.querySelectorAll('#tblReview .rv-money');
const dateInputs = d.querySelectorAll('#tblReview .rv-date');
const leftovers = d.querySelectorAll('#tblReview .rv-datepick, #tblReview .rv-datetext, #tblReview .rv-datebox');
checks.push(['金额框为纯文本无调节按钮', moneyInputs.length === 8 && Array.from(moneyInputs).every(i => i.type === 'text'), moneyInputs.length + ' 个']);
checks.push(['日期为原生日期栏', dateInputs.length === 8 && Array.from(dateInputs).every(i => i.type === 'date'), dateInputs.length + ' 个']);
checks.push(['多余空白日期方块已删除', leftovers.length === 0, leftovers.length + ' 个残留']);

const fire = (el, type) => el.dispatchEvent(new w.Event(type, { bubbles: true }));
checks.push(['日期栏初始值来自数据', dateInputs[0].value === '2019-01-04', dateInputs[0].value]);

moneyInputs[0].value = '123,456';
fire(moneyInputs[0], 'input');
checks.push(['金额手输含千分位被正确解析', w.AM.state.reviewRows[0].amount === 123456, w.AM.state.reviewRows[0].amount]);

dateInputs[0].value = '2020-03-08';
fire(dateInputs[0], 'change');
checks.push(['日期栏选择生效', w.AM.state.reviewRows[0].start === '2020-03-08', w.AM.state.reviewRows[0].start]);

dateInputs[0].value = '2021-07-01';
fire(dateInputs[0], 'input');
checks.push(['日期栏分段键入生效', w.AM.state.reviewRows[0].start === '2021-07-01', w.AM.state.reviewRows[0].start]);

checks.push(['结果表无空白单元格', !d.querySelector('#tblReviewResult').innerHTML.includes('<td></td>'), '']);

console.log('--- 投资回顾计算实测 ---');
let bad = 0;
checks.forEach(([l, ok, ex]) => { if (!ok) bad++; console.log('  ' + (ok ? '✓' : '✗') + ' ' + l + (ex ? '  [' + ex + ']' : '')); });
console.log('\n--- KPI ---');
d.querySelectorAll('#rvKpis .kpi').forEach(k => {
  console.log('  ' + k.querySelector('.kpi-label').textContent + ': ' +
    k.querySelector('.kpi-val').textContent + '   (' + k.querySelector('.kpi-sub').textContent + ')');
});
console.log('\n结论:', bad === 0 ? '全部通过' : (bad + ' 项未通过'));
process.exit(bad === 0 ? 0 : 1);
