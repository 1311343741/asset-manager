/* 功能：现金流统计（挂在「资产现状」板块内）
   流入记正、流出记负；月与年互相换算，右侧给出总收入 / 总支出 / 净现金流三个汇总数。 */
window.Cashflow = (function () {
  const A = window.App;
  const $ = s => document.querySelector(s);

  // 非投资收益（流入）
  const IN_CATS = [
    '工资收入', '奖金', '公积金', '房租收租',
    '物品租赁（车租等）', '退休金', '分红', '其他收入',
  ];
  // 非投资开支（流出）
  const OUT_CATS = [
    '日常生活开支', '吃穿用度', '物业费', '车位费', '房租',
    '租金支出', '水电燃气', '交通出行', '医疗健康', '教育培训', '其他支出',
  ];

  const DEMO = {
    '工资收入': 18000, '奖金': 2500, '公积金': 2000, '房租收租': 3000, '其他收入': 500,
    '日常生活开支': 4000, '吃穿用度': 2500, '物业费': 350, '车位费': 400,
    '房租': 3500, '水电燃气': 320, '交通出行': 800, '医疗健康': 300,
  };

  /* 状态里只存「月」值，年恒等于 月×12，避免两处口径对不上 */
  function store() {
    if (!A.state.cashflow) A.state.cashflow = {};
    return A.state.cashflow;
  }
  const getM = c => Number(store()[c]) || 0;
  function setM(c, v) {
    const s = store();
    if (v > 0) s[c] = Math.round(v * 100) / 100;
    else delete s[c];
  }

  function renderGrid(box, cats) {
    if (!box) return;
    box.innerHTML = '';
    cats.forEach(c => {
      const row = document.createElement('div');
      row.className = 'cf-row';

      const nm = document.createElement('span');
      nm.className = 'cf-name';
      nm.textContent = c;
      nm.title = c;

      const m0 = getM(c);

      const im = document.createElement('input');
      im.type = 'number'; im.min = '0'; im.step = '100'; im.placeholder = '月';
      im.value = m0 ? String(m0) : '';

      const iy = document.createElement('input');
      iy.type = 'number'; iy.min = '0'; iy.step = '1000'; iy.placeholder = '年';
      iy.value = m0 ? String(Math.round(m0 * 12)) : '';

      im.oninput = () => {
        const v = parseFloat(im.value);
        const ok = isFinite(v) && v > 0;
        setM(c, ok ? v : 0);
        iy.value = ok ? String(Math.round(v * 12)) : '';
        A.save();
      };
      iy.oninput = () => {
        const v = parseFloat(iy.value);
        const mv = (isFinite(v) && v > 0) ? v / 12 : 0;
        setM(c, mv);
        im.value = mv ? String(Math.round(mv)) : '';
        A.save();
      };

      row.append(nm, im, iy);
      box.appendChild(row);
    });
  }

  function calc() {
    let inc = 0, exp = 0;
    IN_CATS.forEach(c => inc += getM(c));
    OUT_CATS.forEach(c => exp += getM(c));
    const yIn = inc * 12, yOut = exp * 12, yNet = yIn - yOut;

    const set = (id, txt) => { const el = $(id); if (el) el.textContent = txt; };
    set('#cfIncome', A.fmtMoney(yIn));
    set('#cfIncomeSub', '全年 · 月均 ' + A.fmtMoney(inc));
    set('#cfExpense', A.fmtMoney(yOut));
    set('#cfExpenseSub', '全年 · 月均 ' + A.fmtMoney(exp));
    set('#cfNet', (yNet < 0 ? '-' : '') + A.fmtMoney(Math.abs(yNet)));
    set('#cfNetSub', '全年盈余 · 月均 ' + A.fmtMoney(inc - exp));

    const nv = $('#cfNet');
    if (nv) nv.classList.toggle('up', yNet >= 0);

    A.save();
    return { inc, exp, yIn, yOut, yNet };
  }

  function bind() {
    const b = $('#btnCfCalc');
    if (b) b.onclick = () => {
      const r = calc();
      A.toast('已统计：全年净现金流 ' + A.fmtMoney(r.yNet));
    };

    const d = $('#btnCfDemo');
    if (d) d.onclick = () => {
      Object.keys(DEMO).forEach(c => setM(c, DEMO[c]));
      renderGrid($('#cfInGrid'), IN_CATS);
      renderGrid($('#cfOutGrid'), OUT_CATS);
      calc();
      A.toast('已填入示例现金流');
    };

    const c = $('#btnCfClear');
    if (c) c.onclick = () => {
      if (!confirm('确认清空全部现金流数据？')) return;
      A.state.cashflow = {};
      renderGrid($('#cfInGrid'), IN_CATS);
      renderGrid($('#cfOutGrid'), OUT_CATS);
      calc(); A.save(); A.toast('已清空现金流');
    };
  }

  return {
    init: function () {
      renderGrid($('#cfInGrid'), IN_CATS);
      renderGrid($('#cfOutGrid'), OUT_CATS);
      bind();
      calc();
    },
    calc, IN_CATS, OUT_CATS,
  };
})();
