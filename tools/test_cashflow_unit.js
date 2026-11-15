/**
 * 现金流：两栏占比（收入/支出各自单算）+ 净现金流时间折算 的数值实测。
 * 最小 DOM + AM 桩，直接 eval 真实 cashflow.js，不依赖网络。
 */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const ROOT = path.dirname(__dirname);
const code = fs.readFileSync(path.join(ROOT, 'static/js/cashflow.js'), 'utf8');

const dom = new JSDOM(`<!DOCTYPE html><body>
  <table id="tblCashflow"><tbody></tbody>
    <tfoot><tr>
      <td id="cfSumMonth"></td><td id="cfSumYear"></td>
      <td id="cfSumInPct"></td><td id="cfSumOutPct"></td>
    </tr></tfoot>
  </table>
  <button id="btnCfAdd"></button><button id="btnCfCalc"></button>
  <button id="btnCfDemo"></button><button id="btnCfClear"></button>
  <span id="cfIncome"></span><span id="cfIncomeSub"></span>
  <span id="cfExpense"></span><span id="cfExpenseSub"></span>
  <span id="cfNet"></span><span id="cfNetSub"></span>
  <b id="cfPerDay"></b><b id="cfPerHour"></b>
  <b id="cfPerMin"></b><b id="cfPerSec"></b>
</body>`, { runScripts: 'outside-only' });

const w = dom.window, d = w.document;
const fmtMoney = (v, dec) => {
  const n = Number(v) || 0, a = Math.abs(n);
  let s = a, unit = '';
  if (a >= 1e8) { s = a / 1e8; unit = '亿'; }
  else if (a >= 1e4) { s = a / 1e4; unit = '万'; }
  const dd = dec === undefined ? (s >= 1000 ? 0 : s >= 100 ? 1 : 2) : dec;
  return (n < 0 ? '-¥' : '¥') + s.toFixed(dd) + unit;
};
w.AM = {
  $: s => d.querySelector(s),
  state: { cashflow: [] },
  save() {}, toast() {}, fmtMoney,
  fmtPct(v, dec) { return (v > 0 ? '+' : '') + Number(v || 0).toFixed(dec === undefined ? 2 : dec) + '%'; },
};
w.confirm = () => true;

w.eval(code);
w.Cashflow.init();
d.querySelector('#btnCfDemo').click();
d.querySelector('#btnCfCalc').click();

const txt = id => (d.querySelector(id) ? d.querySelector(id).textContent : '');
const inPct = Array.from(d.querySelectorAll('#tblCashflow [data-cf-in-pct]')).map(e => e.textContent);
const outPct = Array.from(d.querySelectorAll('#tblCashflow [data-cf-out-pct]')).map(e => e.textContent);

// 示例：月流入 25,500 / 月流出 10,350 / 年净 181,800
const checks = [
  ['录入 8 行', d.querySelectorAll('#tblCashflow tbody tr').length === 8, ''],
  ['占收入比栏 8 格', inPct.length === 8, inPct.length],
  ['占支出比栏 8 格', outPct.length === 8, outPct.length],
  ['收入行占收入比 70.6%', inPct[0] === '70.6%', inPct[0]],
  ['收入行占支出比为 —', outPct[0] === '—', outPct[0]],
  ['支出行占收入比为 —', inPct[4] === '—', inPct[4]],
  ['支出行占支出比 38.6%', outPct[4] === '38.6%', outPct[4]],
  ['收入栏合计 100.0%', txt('#cfSumInPct') === '100.0%', txt('#cfSumInPct')],
  ['支出栏合计 100.0%', txt('#cfSumOutPct') === '100.0%', txt('#cfSumOutPct')],
  ['收入栏仅 4 项有值', inPct.filter(x => x !== '—').length === 4, ''],
  ['支出栏仅 4 项有值', outPct.filter(x => x !== '—').length === 4, ''],
  ['全年总收入 ¥30.60万', txt('#cfIncome').includes('30.60万'), txt('#cfIncome')],
  ['全年总支出 ¥12.42万', txt('#cfExpense').includes('12.42万'), txt('#cfExpense')],
  ['年净现金流 ¥18.18万', txt('#cfNet').includes('18.18万'), txt('#cfNet')],
  ['平均每天 ¥497.74', txt('#cfPerDay') === '¥497.74', txt('#cfPerDay')],
  ['每小时 ¥20.74', txt('#cfPerHour') === '¥20.74', txt('#cfPerHour')],
  ['每分钟 ¥0.3457', txt('#cfPerMin') === '¥0.3457', txt('#cfPerMin')],
  ['每秒钟 ¥0.005761', txt('#cfPerSec') === '¥0.005761', txt('#cfPerSec')],
  ['时间折算为正值色', d.querySelector('#cfPerSec').className.includes('pos'), ''],
];

console.log('--- 现金流优化实测 ---');
let bad = 0;
checks.forEach(([l, ok, ex]) => { if (!ok) bad++; console.log('  ' + (ok ? '✓' : '✗') + ' ' + l + (ex ? '  [' + ex + ']' : '')); });
console.log('\n--- 右侧时间折算 ---');
['#cfPerDay', '#cfPerHour', '#cfPerMin', '#cfPerSec'].forEach(id => console.log('  ' + id + ': ' + txt(id)));
console.log('\n结论:', bad === 0 ? '全部通过' : (bad + ' 项未通过'));
process.exit(bad === 0 ? 0 : 1);
