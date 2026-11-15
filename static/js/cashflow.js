/* 现金流统计：表格模式（下拉选分类 + 自定义名称 + 增删行）
   流入记正、流出记负；月与年互相换算；右侧给出三个全年汇总大数字。 */
window.Cashflow = (function () {
  const A = window.AM;
  const $ = s => document.querySelector(s);

  // 非投资收益（流入为正）
  const IN_CATS = [
    '工资收入', '奖金', '公积金', '房租收租',
    '物品租赁（车租等）', '退休金', '分红', '其他收入',
  ];
  // 非投资开支（流出为负）
  const OUT_CATS = [
    '日常生活开支', '吃穿用度', '物业费', '车位费', '房租',
    '租金支出', '水电燃气', '交通出行', '医疗健康', '教育培训', '其他支出',
  ];

  const DEMO = [
    { name: '每月工资', cat: '工资收入', month: 18000 },
    { name: '年终奖分摊', cat: '奖金', month: 2500 },
    { name: '公积金', cat: '公积金', month: 2000 },
    { name: '出租房收租', cat: '房租收租', month: 3000 },
    { name: '日常开销', cat: '日常生活开支', month: 4000 },
    { name: '吃穿用度', cat: '吃穿用度', month: 2500 },
    { name: '物业费', cat: '物业费', month: 350 },
    { name: '住房租金', cat: '房租', month: 3500 },
  ];

  let uid = 1;
  const nid = () => 'cf' + Date.now().toString(36) + (uid++).toString(36);
  const isIn = cat => IN_CATS.indexOf(cat) >= 0;

  /* 状态是数组：{ id, name, cat, month }。只存月值，年恒等于 月×12 */
  function rows() {
    if (!Array.isArray(A.state.cashflow)) A.state.cashflow = [];
    return A.state.cashflow;
  }
  function addRow(data) {
    const r = Object.assign({ id: nid(), name: '', cat: IN_CATS[0], month: 0 }, data || {});
    rows().push(r);
    return r;
  }

  function mkInput(type, value, ph) {
    const i = document.createElement('input');
    i.type = type; i.min = '0';
    i.className = 'num';
    i.step = type === 'number' ? '100' : '100';
    i.value = value || '';
    i.placeholder = ph;
    return i;
  }

  function render() {
    const tbody = $('#tblCashflow tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    const frag = document.createDocumentFragment();
    const list = rows();

    list.forEach(r => {
      const tr = document.createElement('tr');

      // 自定义名称
      const tdName = document.createElement('td');
      const iName = document.createElement('input');
      iName.value = r.name || '';
      iName.placeholder = '自定义名称';
      iName.oninput = () => { r.name = iName.value; A.save(); };
      tdName.appendChild(iName);

      // 分类下拉：按流入 / 流出分组
      const tdCat = document.createElement('td');
      const sel = document.createElement('select');
      const group = (label, cats) => {
        const g = document.createElement('optgroup');
        g.label = label;
        cats.forEach(c => {
          const o = document.createElement('option');
          o.value = c; o.textContent = c;
          if (c === r.cat) o.selected = true;
          g.appendChild(o);
        });
        sel.appendChild(g);
      };
      group('流入（收入）', IN_CATS);
      group('流出（支出）', OUT_CATS);
      sel.onchange = () => { r.cat = sel.value; A.save(); calc(); };
      tdCat.appendChild(sel);

      // 月 / 年，任一输入自动换算另一个
      const m0 = Number(r.month) || 0;
      const iM = mkInput('number', m0 ? m0 : '', '月');
      const iY = mkInput('number', m0 ? Math.round(m0 * 12) : '', '年');
      iM.oninput = () => {
        const v = parseFloat(iM.value);
        r.month = (isFinite(v) && v > 0) ? v : 0;
        iY.value = r.month ? Math.round(r.month * 12) : '';
        A.save(); calc();
      };
      iY.oninput = () => {
        const v = parseFloat(iY.value);
        r.month = (isFinite(v) && v > 0) ? v / 12 : 0;
        iM.value = r.month ? Math.round(r.month) : '';
        A.save(); calc();
      };
      const tdM = document.createElement('td'); tdM.appendChild(iM);
      const tdY = document.createElement('td'); tdY.appendChild(iY);

      // 收入 / 支出占比分两栏，各自单独计算（数值由 calc 统一刷新）
      const tdInPct = document.createElement('td');
      tdInPct.className = 'num cf-pct-in';
      tdInPct.setAttribute('data-cf-in-pct', r.id);
      tdInPct.textContent = '—';
      const tdOutPct = document.createElement('td');
      tdOutPct.className = 'num cf-pct-out';
      tdOutPct.setAttribute('data-cf-out-pct', r.id);
      tdOutPct.textContent = '—';

      // 删除
      const tdDel = document.createElement('td');
      const b = document.createElement('button');
      b.className = 'del'; b.textContent = '×'; b.title = '删除';
      b.onclick = () => {
        const arr = rows();
        const i = arr.findIndex(x => x.id === r.id);
        if (i >= 0) arr.splice(i, 1);
        render(); calc(); A.save();
      };
      tdDel.appendChild(b);

      tr.append(tdName, tdCat, tdM, tdY, tdInPct, tdOutPct, tdDel);
      frag.appendChild(tr);
    });

    if (!list.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 7;
      td.style.cssText = 'color:#9aa5b6;text-align:center;padding:14px';
      td.textContent = '暂无记录，点击「+ 添加现金流」';
      tr.appendChild(td); frag.appendChild(tr);
    }
    tbody.appendChild(frag);
  }

  function calc() {
    let inc = 0, exp = 0;
    rows().forEach(r => {
      const m = Number(r.month) || 0;
      if (isIn(r.cat)) inc += m; else exp += m;
    });
    const yIn = inc * 12, yOut = exp * 12, yNet = yIn - yOut;
    const set = (id, t) => { const e = $(id); if (e) e.textContent = t; };

    set('#cfIncome', A.fmtMoney(yIn));
    set('#cfIncomeSub', '全年 · 月均 ' + A.fmtMoney(inc));
    set('#cfExpense', A.fmtMoney(yOut));
    set('#cfExpenseSub', '全年 · 月均 ' + A.fmtMoney(exp));
    set('#cfNet', (yNet < 0 ? '-' : '') + A.fmtMoney(Math.abs(yNet)));
    set('#cfNetSub', '全年盈余 · 月均 ' + A.fmtMoney(inc - exp));
    set('#cfSumMonth', A.fmtMoney(inc - exp));
    set('#cfSumYear', A.fmtMoney(yNet));

    // 占比：收入与支出分开算，各自以「本类合计」为分母，另一栏显示 —
    const list = rows();
    const fillPct = (attr, denom, wantIncome) => {
      document.querySelectorAll('#tblCashflow [data-' + attr + ']').forEach(el => {
        const rec = list.find(x => x.id === el.getAttribute('data-' + attr));
        if (!rec) return;
        const m = Number(rec.month) || 0;
        const mine = wantIncome ? isIn(rec.cat) : !isIn(rec.cat);
        el.textContent = (mine && denom > 0) ? (m / denom * 100).toFixed(1) + '%' : '—';
      });
    };
    fillPct('cf-in-pct', inc, true);
    fillPct('cf-out-pct', exp, false);
    set('#cfSumInPct', inc > 0 ? '100.0%' : '—');
    set('#cfSumOutPct', exp > 0 ? '100.0%' : '—');

    // 净现金流按时间折算：年净额 → 日 → 时 → 分 → 秒
    // 秒级金额很小，按量级动态给小数位，避免一律显示 ¥0.00
    const fmtTiny = v => {
      const a = Math.abs(v);
      if (a === 0) return '¥0';
      const t = a >= 1000 ? a.toFixed(0)
        : a >= 1 ? a.toFixed(2)
          : a >= 0.01 ? a.toFixed(4) : a.toFixed(6);
      return (v < 0 ? '-¥' : '¥') + t;
    };
    const perDay = yNet / 365.25;
    [['#cfPerDay', perDay], ['#cfPerHour', perDay / 24],
     ['#cfPerMin', perDay / 1440], ['#cfPerSec', perDay / 86400]]
      .forEach(pair => {
        const e = $(pair[0]);
        if (e) {
          e.textContent = fmtTiny(pair[1]);
          e.className = 'cf-time-val ' + (pair[1] > 0 ? 'pos' : (pair[1] < 0 ? 'neg' : ''));
        }
      });

    A.save();
    return { inc, exp, yIn, yOut, yNet };
  }

  function bind() {
    const add = $('#btnCfAdd');
    if (add) add.onclick = () => { addRow(); render(); calc(); A.save(); };

    const b = $('#btnCfCalc');
    if (b) b.onclick = () => {
      const r = calc();
      A.toast('已统计：全年净现金流 ' + A.fmtMoney(r.yNet));
    };

    const d = $('#btnCfDemo');
    if (d) d.onclick = () => {
      A.state.cashflow = DEMO.map(x => Object.assign({ id: nid() }, x));
      render(); calc(); A.toast('已填入示例现金流');
    };

    const c = $('#btnCfClear');
    if (c) c.onclick = () => {
      if (!confirm('确认清空全部现金流记录？')) return;
      A.state.cashflow = [];
      render(); calc(); A.save(); A.toast('已清空现金流');
    };
  }

  return {
    init: function () { render(); bind(); calc(); },
    calc, IN_CATS, OUT_CATS,
  };
})();
