/* 功能：投资回顾
   只考虑「投入时点与金额」和「结算时点与金额」，不考虑过程与定投。
   逐项给出净盈亏 / 盈亏比例 / 年化，并按最早投入日~最晚结算日算总资产年化；
   另补充资金加权收益率 XIRR、胜率、最佳最差、盈亏贡献等专业分析。 */
window.Review = (function () {
  'use strict';
  const A = window.AM;
  const $ = s => document.querySelector(s);

  const DAY = 86400000;
  const YEAR = 365.25;
  const POS = '#e5484d';   // 涨/盈利：红
  const NEG = '#12a594';   // 跌/亏损：绿

  let uid = 1;
  const nid = () => 'rv' + Date.now().toString(36) + (uid++).toString(36);

  const DEMO = [
    { name: '沪深300指数基金', start: '2019-01-04', amount: 100000, end: '2024-12-31', final: 138000 },
    { name: '某科技股', start: '2020-06-15', amount: 50000, end: '2024-12-31', final: 32500 },
    { name: '黄金ETF', start: '2021-03-10', amount: 60000, end: '2024-12-31', final: 91000 },
    { name: '银行理财', start: '2018-05-20', amount: 80000, end: '2024-12-31', final: 97400 },
  ];

  function rows() {
    if (!Array.isArray(A.state.reviewRows)) A.state.reviewRows = [];
    return A.state.reviewRows;
  }
  function addRow(data) {
    const r = Object.assign({
      id: nid(), name: '', start: A.yearsAgo(3), amount: 10000,
      end: A.today(), final: 12000,
    }, data || {});
    rows().push(r);
    return r;
  }
  const num = v => { const n = Number(v); return isFinite(n) ? n : 0; };
  const ms = s => { const t = new Date((s || '') + 'T00:00:00').getTime(); return isFinite(t) ? t : NaN; };
  const yearsBetween = (a, b) => (ms(b) - ms(a)) / (YEAR * DAY);

  /* ---------- 资金加权收益率 XIRR ---------- */
  function xirr(flows) {
    if (!flows.length) return null;
    const d0 = Math.min.apply(null, flows.map(f => f.d));
    if (!flows.some(f => f.v > 0) || !flows.some(f => f.v < 0)) return null;
    const npv = rate => flows.reduce((s, f) =>
      s + f.v / Math.pow(1 + rate, (f.d - d0) / (YEAR * DAY)), 0);
    let lo = -0.9999, hi = 10, flo = npv(lo), fhi = npv(hi);
    if (!isFinite(flo) || !isFinite(fhi) || flo * fhi > 0) return null;
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2, fm = npv(mid);
      if (Math.abs(fm) < 1e-7) return mid;
      if (flo * fm <= 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; }
    }
    return (lo + hi) / 2;
  }

  /* ---------- 录入表格 ---------- */
  function render() {
    const tbody = $('#tblReview tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    const frag = document.createDocumentFragment();
    const list = rows();

    list.forEach(r => {
      const tr = document.createElement('tr');

      const cell = (child, cls) => {
        const td = document.createElement('td');
        if (cls) td.className = cls;
        td.appendChild(child);
        return td;
      };

      const iName = document.createElement('input');
      iName.type = 'text'; iName.value = r.name || ''; iName.placeholder = '资产名称';
      iName.oninput = () => { r.name = iName.value; A.save(); };

      /* 金额：纯文本框，没有上下调节按钮；允许粘贴 "100,000" 这类写法。
         输入过程中只更新数据、不回写 value，避免光标被顶到末尾（老坑）。
         失焦时才把规范化后的值写回。 */
      const moneyInput = (key) => {
        const i = document.createElement('input');
        i.type = 'text'; i.inputMode = 'decimal'; i.className = 'num rv-money';
        i.value = r[key] == null ? '' : String(r[key]);
        i.placeholder = '0';
        const parse = s => {
          const t = String(s == null ? '' : s).replace(/[,，\s¥￥]/g, '');
          if (!/^-?\d*\.?\d*$/.test(t) || t === '' || t === '-' || t === '.') return null;
          const n = parseFloat(t);
          return isFinite(n) ? Math.max(0, n) : null;
        };
        i.oninput = () => {
          const v = parse(i.value);
          if (v !== null) { r[key] = v; A.save(); }
        };
        i.onblur = () => { i.value = String(r[key]); };
        return i;
      };

      /* 日期：文本框可直接键入 YYYY-MM-DD，右侧日历按钮用原生选择器选日期。
         两者双向同步，非法输入在失焦时回退到上一次的有效值。 */
      const validDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && isFinite(ms(s));
      const dateBox = (key, title) => {
        const box = document.createElement('div');
        box.className = 'rv-datebox';

        const txt = document.createElement('input');
        txt.type = 'text'; txt.className = 'rv-datetext';
        txt.placeholder = 'YYYY-MM-DD'; txt.value = r[key] || '';
        txt.setAttribute('aria-label', title + '（可手动输入）');

        const pick = document.createElement('input');
        pick.type = 'date'; pick.className = 'rv-datepick';
        pick.title = title + '（点此选择日期）';
        pick.setAttribute('aria-label', title + '（点此选择日期）');
        if (validDate(r[key])) pick.value = r[key];

        txt.oninput = () => {
          const v = txt.value.trim();
          if (validDate(v)) { r[key] = v; pick.value = v; A.save(); }
        };
        txt.onblur = () => { if (!validDate(txt.value.trim())) txt.value = r[key] || ''; };
        pick.onchange = () => {
          if (pick.value) { r[key] = pick.value; txt.value = pick.value; A.save(); }
        };

        box.append(txt, pick);
        return box;
      };

      const bDel = document.createElement('button');
      bDel.className = 'del'; bDel.textContent = '×'; bDel.title = '删除';
      bDel.onclick = () => {
        const arr = rows(), i = arr.findIndex(x => x.id === r.id);
        if (i >= 0) arr.splice(i, 1);
        render(); A.save();
      };

      tr.append(
        cell(iName),
        cell(dateBox('start', '投资起始日期')),
        cell(moneyInput('amount')),
        cell(dateBox('end', '结算时间')),
        cell(moneyInput('final')),
        cell(bDel)
      );
      frag.appendChild(tr);
    });

    if (!list.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 6;
      td.style.cssText = 'color:#9aa5b6;text-align:center;padding:16px';
      td.textContent = '暂无记录，点击「+ 添加资产」开始录入';
      tr.appendChild(td); frag.appendChild(tr);
    }
    tbody.appendChild(frag);
  }

  /* ---------- 分析 ---------- */
  function analyze() {
    const list = rows();
    const state = $('#rvState');
    const show = (t, bad) => { if (state) { state.textContent = t; state.className = 'runstate' + (bad ? ' bad' : ' ok'); } };

    if (!list.length) { show('请先添加至少一项资产', true); A.toast('请先添加至少一项资产'); return; }

    const items = [];
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      const d0 = ms(r.start), d1 = ms(r.end);
      const amt = num(r.amount), fin = num(r.final);
      const label = (r.name || '').trim() || ('资产 ' + (i + 1));
      if (!isFinite(d0) || !isFinite(d1) || d1 <= d0) {
        show('第 ' + (i + 1) + ' 项「' + label + '」的结算时间必须晚于起始日期', true);
        A.toast('日期填写有误，请检查'); return;
      }
      if (amt <= 0) {
        show('第 ' + (i + 1) + ' 项「' + label + '」的初始投资金额需大于 0', true);
        A.toast('金额填写有误，请检查'); return;
      }
      const yrs = (d1 - d0) / (YEAR * DAY);
      const pnl = fin - amt;
      const ret = pnl / amt;
      const ann = fin > 0 ? Math.pow(fin / amt, 1 / yrs) - 1 : -1;
      items.push({
        name: label, start: r.start, amount: amt, end: r.end, final: fin,
        days: Math.round((d1 - d0) / DAY), years: yrs,
        pnl, ret, ann, d0, d1,
      });
    }

    const invested = items.reduce((s, x) => s + x.amount, 0);
    const finalVal = items.reduce((s, x) => s + x.final, 0);
    const net = finalVal - invested;
    const totalRet = invested > 0 ? net / invested : 0;

    // 总资产年化：按最早投入日 ~ 最晚结算日（用户指定口径）
    const first = Math.min.apply(null, items.map(x => x.d0));
    const last = Math.max.apply(null, items.map(x => x.d1));
    const spanYears = (last - first) / (YEAR * DAY);
    const totalAnn = (spanYears > 0 && finalVal > 0 && invested > 0)
      ? Math.pow(finalVal / invested, 1 / spanYears) - 1 : -1;

    // 资金加权收益率 XIRR（考虑各笔资金实际进出时点）
    const flows = [];
    items.forEach(x => { flows.push({ d: x.d0, v: -x.amount }); flows.push({ d: x.d1, v: x.final }); });
    const xr = xirr(flows);

    const winners = items.filter(x => x.pnl > 0);
    const losers = items.filter(x => x.pnl < 0);
    const best = items.slice().sort((a, b) => b.ret - a.ret)[0];
    const worst = items.slice().sort((a, b) => a.ret - b.ret)[0];
    const absPnl = items.reduce((s, x) => s + Math.abs(x.pnl), 0);
    const avgYears = items.reduce((s, x) => s + x.years * x.amount, 0) / (invested || 1);

    renderResult({
      items, invested, finalVal, net, totalRet, totalAnn, spanYears, xr,
      winners, losers, best, worst, absPnl, avgYears, first, last,
    });
    const card = $('#rvResultCard');
    if (card) {
      card.hidden = false;
      try { card.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) {}
    }
    setTimeout(A.resizeCharts, 80);
    show('分析完成 · 共 ' + items.length + ' 项资产', false);
  }

  const signCls = v => v > 0 ? 'rv-pos' : (v < 0 ? 'rv-neg' : '');
  const money = v => (v > 0 ? '+' : '') + A.fmtMoney(v, 2);
  const pct = v => A.fmtPct(v * 100, 2);

  function kpi(label, val, sub, cls) {
    return '<div class="kpi"><span class="kpi-label">' + label + '</span>' +
      '<span class="kpi-val ' + (cls || '') + '">' + val + '</span>' +
      '<span class="kpi-sub">' + (sub || '') + '</span></div>';
  }

  function renderResult(R) {
    const win = R.net > 0;
    // 图表库不可用时（如无 canvas 环境）只跳过图，文字结果照常出
    const safeChart = (id, opt) => {
      try { A.chart(id, opt); }
      catch (e) { console.warn('[投资回顾] 图表渲染跳过:', e && e.message); }
    };
    const kpis = $('#rvKpis');
    if (kpis) {
      kpis.innerHTML =
        kpi('总投入', A.fmtFull(R.invested), R.items.length + ' 项资产合计') +
        kpi('最终资产', A.fmtFull(R.finalVal), '各资产截止金额合计') +
        kpi('净盈亏', money(R.net), win ? '整体盈利' : (R.net < 0 ? '整体亏损' : '持平'), signCls(R.net)) +
        kpi('总盈亏比例', pct(R.totalRet), '净盈亏 ÷ 总投入', signCls(R.totalRet)) +
        kpi('总资产年化', R.totalAnn <= -1 ? '—' : pct(R.totalAnn),
          '最早投入 ~ 最晚结算 · ' + R.spanYears.toFixed(2) + ' 年', signCls(R.totalAnn)) +
        kpi('资金加权收益率 XIRR', R.xr === null ? '—' : pct(R.xr),
          '考虑各笔资金实际进出时点', R.xr === null ? '' : signCls(R.xr));
    }

    const concl = $('#rvConcl');
    if (concl) {
      const tag = win ? '<b class="rv-pos">整体盈利</b>'
        : (R.net < 0 ? '<b class="rv-neg">整体亏损</b>' : '<b>整体持平</b>');
      concl.innerHTML =
        '<div class="rv-concl-main">' + tag + ' <strong>' + money(R.net) + '</strong>' +
        '<span class="hint">（收益率 ' + pct(R.totalRet) + '）</span></div>' +
        '<div class="rv-concl-grid">' +
        '<div><span>盈利 / 亏损 / 持平</span><b>' + R.winners.length + ' / ' + R.losers.length +
        ' / ' + (R.items.length - R.winners.length - R.losers.length) + ' 项</b></div>' +
        '<div><span>胜率（按笔数）</span><b>' + (R.items.length ? (R.winners.length / R.items.length * 100).toFixed(1) : 0) + '%</b></div>' +
        '<div><span>加权平均持有期</span><b>' + R.avgYears.toFixed(2) + ' 年</b></div>' +
        '<div><span>统计区间</span><b>' + new Date(R.first).toISOString().slice(0, 10) + ' ~ ' +
        new Date(R.last).toISOString().slice(0, 10) + '</b></div>' +
        '<div><span>表现最佳</span><b class="rv-pos">' + (R.best ? R.best.name + ' ' + pct(R.best.ret) : '—') + '</b></div>' +
        '<div><span>表现最差</span><b class="rv-neg">' + (R.worst ? R.worst.name + ' ' + pct(R.worst.ret) : '—') + '</b></div>' +
        '</div>';
    }

    const tb = $('#tblReviewResult tbody');
    if (tb) {
      tb.innerHTML = R.items.map(x => {
        const contrib = R.absPnl > 0 ? x.pnl / R.absPnl : 0;
        return '<tr><td>' + x.name + '</td>' +
          '<td>' + x.start + '</td><td class="num">' + A.fmtFull(x.amount) + '</td>' +
          '<td>' + x.end + '</td><td class="num">' + A.fmtFull(x.final) + '</td>' +
          '<td class="num">' + x.years.toFixed(2) + '</td>' +
          '<td class="num ' + signCls(x.pnl) + '">' + money(x.pnl) + '</td>' +
          '<td class="num ' + signCls(x.ret) + '">' + pct(x.ret) + '</td>' +
          '<td class="num ' + signCls(x.ann) + '">' + (x.ann <= -1 ? '—' : pct(x.ann)) + '</td>' +
          '<td class="num">' + (contrib * 100).toFixed(1) + '%</td></tr>';
      }).join('') +
        '<tr class="rv-total"><td colspan="2"><b>合计</b></td>' +
        '<td class="num"><b>' + A.fmtFull(R.invested) + '</b></td><td></td>' +
        '<td class="num"><b>' + A.fmtFull(R.finalVal) + '</b></td><td></td>' +
        '<td class="num ' + signCls(R.net) + '"><b>' + money(R.net) + '</b></td>' +
        '<td class="num ' + signCls(R.totalRet) + '"><b>' + pct(R.totalRet) + '</b></td>' +
        '<td class="num ' + signCls(R.totalAnn) + '"><b>' + (R.totalAnn <= -1 ? '—' : pct(R.totalAnn)) + '</b></td>' +
        '<td></td></tr>';
    }

    // 图 1：各资产净盈亏（红盈绿亏）
    safeChart('chartReviewPnl', {
      tooltip: { trigger: 'axis', valueFormatter: v => A.fmtMoney(v, 2) },
      grid: Object.assign({}, A.GRID, { bottom: 56 }),
      xAxis: Object.assign({ type: 'category', data: R.items.map(x => x.name) }, A.AXIS_STYLE,
        { axisLabel: { color: '#7b8798', fontSize: 11, interval: 0, rotate: R.items.length > 5 ? 24 : 0 } }),
      yAxis: Object.assign({ type: 'value', name: '净盈亏 (¥)' }, A.AXIS_STYLE,
        { axisLabel: { color: '#7b8798', fontSize: 11 } }),
      series: [{
        type: 'bar', barMaxWidth: 46,
        data: R.items.map(x => ({ value: +x.pnl.toFixed(2), itemStyle: { color: x.pnl >= 0 ? POS : NEG } })),
        label: { show: true, position: 'top', fontSize: 10, formatter: p => A.fmtMoney(p.value, 0) },
      }],
    });

    // 图 2：各资产盈亏比例 vs 年化收益率
    safeChart('chartReviewAnn', {
      tooltip: { trigger: 'axis', valueFormatter: v => (+v).toFixed(2) + '%' },
      legend: { top: 0, textStyle: { fontSize: 11, color: '#475569' } },
      grid: Object.assign({}, A.GRID, { top: 40, bottom: 56 }),
      xAxis: Object.assign({ type: 'category', data: R.items.map(x => x.name) }, A.AXIS_STYLE,
        { axisLabel: { color: '#7b8798', fontSize: 11, interval: 0, rotate: R.items.length > 5 ? 24 : 0 } }),
      yAxis: Object.assign({ type: 'value', name: '%' }, A.AXIS_STYLE,
        { axisLabel: { color: '#7b8798', fontSize: 11, formatter: '{value}%' } }),
      series: [
        {
          name: '总盈亏比例', type: 'bar', barMaxWidth: 28,
          itemStyle: { color: '#2563eb', opacity: .85 },
          data: R.items.map(x => +(x.ret * 100).toFixed(2)),
        },
        {
          name: '年化收益率', type: 'bar', barMaxWidth: 28,
          itemStyle: { color: '#f5a524', opacity: .9 },
          data: R.items.map(x => +(x.ann * 100).toFixed(2)),
        },
      ],
    });
  }

  function bind() {
    const add = $('#btnRvAdd');
    if (add) add.onclick = () => { addRow(); render(); A.save(); };

    const run = $('#btnRvAnalyze');
    if (run) run.onclick = analyze;

    const demo = $('#btnRvDemo');
    if (demo) demo.onclick = () => {
      A.state.reviewRows = DEMO.map(x => Object.assign({ id: nid() }, x));
      render(); A.save(); A.toast('已填入示例，点「一键分析」查看结果');
    };

    const clear = $('#btnRvClear');
    if (clear) clear.onclick = () => {
      if (!confirm('确认清空全部投资记录？')) return;
      A.state.reviewRows = [];
      const card = $('#rvResultCard'); if (card) card.hidden = true;
      const st = $('#rvState'); if (st) { st.textContent = ''; st.className = 'runstate'; }
      render(); A.save(); A.toast('已清空');
    };
  }

  return {
    init: function () { render(); bind(); },
    analyze, render,
  };
})();
