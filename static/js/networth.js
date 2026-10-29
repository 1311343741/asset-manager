/* 功能一：资产负债 / 净资产核算 */
window.NetWorth = (function () {
  'use strict';
  const A = window.AM;
  const { $, $$ } = A;

  const ASSET_CATS = ['现金及活期', '存款 / 理财', '股票', '基金 / ETF', '房产', '车辆', '贵金属', '保险 / 年金', '其他资产'];
  const DEBT_CATS = ['房贷', '车贷', '消费贷', '信用卡', '经营贷', '其他负债'];

  let uid = 1;
  const nid = () => 'x' + Date.now().toString(36) + (uid++).toString(36);

  function rows(kind) { return kind === 'asset' ? A.state.assets : A.state.debts; }

  function makeRow(kind, data) {
    const r = Object.assign({ id: nid(), name: '', cat: (kind === 'asset' ? ASSET_CATS : DEBT_CATS)[0], amount: 0, note: '' }, data || {});
    rows(kind).push(r);
    return r;
  }

  function render() {
    renderTable('asset');
    renderTable('debt');
    renderKpis();
    renderCharts();
    A.save();
  }

  function renderTable(kind) {
    const list = rows(kind);
    const cats = kind === 'asset' ? ASSET_CATS : DEBT_CATS;
    const tbody = $('#tbl' + (kind === 'asset' ? 'Asset' : 'Debt') + ' tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    const frag = document.createDocumentFragment();

    list.forEach(r => {
      const tr = document.createElement('tr');

      const tdName = document.createElement('td');
      const iName = document.createElement('input');
      iName.value = r.name; iName.placeholder = '名称';
      iName.oninput = () => { r.name = iName.value; A.save(); renderCharts(); };
      tdName.appendChild(iName);

      const tdCat = document.createElement('td');
      const sel = document.createElement('select');
      cats.forEach(c => { const o = document.createElement('option'); o.value = c; o.textContent = c; if (c === r.cat) o.selected = true; sel.appendChild(o); });
      sel.onchange = () => { r.cat = sel.value; A.save(); renderCharts(); };
      tdCat.appendChild(sel);

      const tdAmt = document.createElement('td');
      const iAmt = document.createElement('input');
      iAmt.type = 'number'; iAmt.className = 'num'; iAmt.value = r.amount; iAmt.min = '0'; iAmt.step = '1000';
      iAmt.oninput = () => {
        r.amount = Number(iAmt.value) || 0;
        A.save(); renderKpis(); renderCharts(); updateSums(); updatePct();
      };
      tdAmt.appendChild(iAmt);

      // 单项占比（占总资产 / 占总负债）
      const tdPct = document.createElement('td');
      const bar = document.createElement('div');
      bar.className = 'pctbar' + (kind === 'debt' ? ' debt' : '');
      bar.setAttribute('data-pct', r.id);
      const fill = document.createElement('i');
      const lab = document.createElement('span');
      bar.append(fill, lab);
      tdPct.appendChild(bar);

      const tdNote = document.createElement('td');
      const iNote = document.createElement('input');
      iNote.value = r.note; iNote.placeholder = '备注';
      iNote.oninput = () => { r.note = iNote.value; A.save(); };
      tdNote.appendChild(iNote);

      const tdDel = document.createElement('td');
      const bDel = document.createElement('button');
      bDel.className = 'del'; bDel.textContent = '×'; bDel.title = '删除';
      bDel.onclick = () => {
        const arr = rows(kind);
        const i = arr.findIndex(x => x.id === r.id);
        if (i >= 0) arr.splice(i, 1);
        render();
      };
      tdDel.appendChild(bDel);

      tr.append(tdName, tdCat, tdAmt, tdPct, tdNote, tdDel);
      frag.appendChild(tr);
    });

    if (!list.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 6; td.style.color = '#9aa5b6'; td.style.textAlign = 'center'; td.style.padding = '14px';
      td.textContent = '暂无记录，点击右上角「+ 新增」';
      tr.appendChild(td); frag.appendChild(tr);
    }
    tbody.appendChild(frag);
    updateSums();
    updatePct();
  }

  function updateSums() {
    const sa = A.state.assets.reduce((s, x) => s + (Number(x.amount) || 0), 0);
    const sd = A.state.debts.reduce((s, x) => s + (Number(x.amount) || 0), 0);
    const e1 = $('#sumAsset'), e2 = $('#sumDebt');
    if (e1) e1.textContent = A.fmtFull(sa);
    if (e2) e2.textContent = A.fmtFull(sd);
  }

  /** 刷新每行“单项占比”进度条（金额变动时其他行的占比也会变） */
  function updatePct() {
    ['asset', 'debt'].forEach(kind => {
      const list = rows(kind);
      const total = list.reduce((s, x) => s + (Number(x.amount) || 0), 0);
      list.forEach(r => {
        const el = document.querySelector('[data-pct="' + r.id + '"]');
        if (!el) return;
        const p = total > 0 ? (Number(r.amount) || 0) / total * 100 : 0;
        const fill = el.querySelector('i'), lab = el.querySelector('span');
        if (fill) fill.style.width = p.toFixed(1) + '%';
        if (lab) lab.textContent = p.toFixed(1) + '%';
      });
    });
  }

  function totals() {
    const ta = A.state.assets.reduce((s, x) => s + (Number(x.amount) || 0), 0);
    const td = A.state.debts.reduce((s, x) => s + (Number(x.amount) || 0), 0);
    return { ta, td, net: ta - td, ratio: ta > 0 ? td / ta : 0 };
  }

  function renderKpis() {
    const { ta, td, net, ratio } = totals();
    $('#kTotalAsset').textContent = A.fmtMoney(ta);
    $('#kTotalDebt').textContent = A.fmtMoney(td);
    $('#kNetAsset').textContent = A.fmtMoney(net);
    $('#kDebtRatio').textContent = (ratio * 100).toFixed(1) + '%';
    $('#kAssetCount').textContent = A.state.assets.length + ' 项';
    $('#kDebtCount').textContent = A.state.debts.length + ' 项';
    const h = $('#kDebtHealth');
    if (ta <= 0) { h.textContent = '—'; }
    else if (ratio < 0.3) { h.textContent = '健康区间'; }
    else if (ratio < 0.5) { h.textContent = '中等杠杆'; }
    else if (ratio < 0.7) { h.textContent = '杠杆偏高'; }
    else { h.textContent = '高杠杆，注意风险'; }
  }

  /** 按类别分组，同时保留每个类别下的单项明细 */
  function groupByCat(list) {
    const m = new Map();
    list.forEach(r => {
      const v = Number(r.amount) || 0;
      if (v <= 0) return;
      if (!m.has(r.cat)) m.set(r.cat, { cat: r.cat, total: 0, items: [] });
      const g = m.get(r.cat);
      g.total += v;
      g.items.push({ name: r.name || '(未命名)', value: v });
    });
    return Array.from(m.values()).sort((a, b) => b.total - a.total);
  }

  /** 明细占比旭日图：内圈类别、外圈单项 */
  function renderSunburst(id, list, total) {
    const groups = groupByCat(list);
    A.chart(id, {
      tooltip: {
        formatter: p => {
          const pct = total > 0 ? (p.value / total * 100).toFixed(1) : '0';
          return '<b>' + p.name + '</b><br/>' + A.fmtFull(p.value) + ' · 占比 ' + pct + '%';
        },
      },
      series: [{
        type: 'sunburst',
        radius: [0, '94%'],
        center: ['50%', '50%'],
        sort: null,
        itemStyle: { borderColor: '#fff', borderWidth: 1.5 },
        label: { minAngle: 8 },
        levels: [
          {},
          {
            r0: '16%', r: '46%',
            itemStyle: { borderWidth: 2 },
            label: { rotate: 'tangential', fontSize: 11, color: '#fff', fontWeight: 600 },
          },
          {
            r0: '48%', r: '94%',
            label: { fontSize: 9.5, color: '#fff', overflow: 'truncate' },
            itemStyle: { opacity: .92 },
          },
        ],
        data: groups.length ? groups.map((g, i) => ({
          name: g.cat,
          itemStyle: { color: A.PALETTE[i % A.PALETTE.length] },
          children: g.items.map(it => ({ name: it.name, value: +it.value.toFixed(2) })),
        })) : [{ name: '暂无数据', value: 1, itemStyle: { color: '#eef1f6' }, label: { color: '#9aa5b6' } }],
      }],
    });
  }

  function renderCharts() {
    const { ta, td, net } = totals();
    const groups = groupByCat(A.state.assets);
    const dgroups = groupByCat(A.state.debts);
    const total = groups.reduce((s, x) => s + x.total, 0);
    const dtotal = dgroups.reduce((s, x) => s + x.total, 0);

    A.chart('chartAssetPie', {
      tooltip: {
        trigger: 'item',
        formatter: p => p.name + '<br/>' + A.fmtFull(p.value) + '（' + p.percent + '%）',
      },
      legend: { bottom: 0, itemWidth: 9, itemHeight: 9, textStyle: { fontSize: 11, color: '#475569' } },
      series: [{
        type: 'pie', radius: ['46%', '70%'], center: ['50%', '44%'],
        avoidLabelOverlap: true,
        itemStyle: { borderColor: '#fff', borderWidth: 2 },
        label: { show: false },
        data: groups.length
          ? groups.map((g, i) => ({
              name: g.cat, value: +g.total.toFixed(2),
              itemStyle: { color: A.PALETTE[i % A.PALETTE.length] },
            }))
          : [{ name: '暂无数据', value: 1, itemStyle: { color: '#eef1f6' } }],
      }],
      title: total > 0 ? {
        text: A.fmtMoney(total), subtext: '资产合计',
        left: 'center', top: '38%',
        textStyle: { fontSize: 18, fontWeight: 700, color: '#0f172a' },
        subtextStyle: { fontSize: 11, color: '#7b8798' },
      } : undefined,
    });

    // 明细占比旭日图
    renderSunburst('chartAssetSun', A.state.assets, total);

    // 负债结构
    A.chart('chartDebtPie', {
      tooltip: { trigger: 'item', formatter: p => p.name + '<br/>' + A.fmtFull(p.value) + '（' + p.percent + '%）' },
      legend: { bottom: 0, itemWidth: 9, itemHeight: 9, textStyle: { fontSize: 11, color: '#475569' } },
      series: [{
        type: 'pie', radius: ['44%', '68%'], center: ['50%', '44%'],
        itemStyle: { borderColor: '#fff', borderWidth: 2 },
        label: { show: false },
        data: dgroups.length
          ? dgroups.map((g, i) => ({
              name: g.cat, value: +g.total.toFixed(2),
              itemStyle: { color: ['#e5484d', '#f97316', '#f5a524', '#ec4899', '#a855f7', '#64748b'][i % 6] },
            }))
          : [{ name: '暂无负债', value: 1, itemStyle: { color: '#eef1f6' } }],
      }],
      title: dtotal > 0 ? {
        text: A.fmtMoney(dtotal), subtext: '负债合计',
        left: 'center', top: '37%',
        textStyle: { fontSize: 17, fontWeight: 700, color: '#e5484d' },
        subtextStyle: { fontSize: 11, color: '#7b8798' },
      } : undefined,
    });

    A.chart('chartAssetBar', {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: v => A.fmtFull(v) },
      grid: Object.assign({}, A.GRID, { left: 70, bottom: 26, top: 26 }),
      xAxis: { type: 'value', axisLabel: { color: '#7b8798', fontSize: 11, formatter: v => A.fmtMoney(v, 0) }, splitLine: { lineStyle: { color: '#f0f3f8' } } },
      yAxis: {
        type: 'category', data: ['净资产', '总负债', '总资产'],
        axisLine: { lineStyle: { color: '#dfe4ee' } }, axisLabel: { color: '#475569', fontSize: 12 },
      },
      series: [{
        type: 'bar', barWidth: 20,
        data: [
          { value: +net.toFixed(2), itemStyle: { color: '#2563eb', borderRadius: [0, 4, 4, 0] } },
          { value: +td.toFixed(2), itemStyle: { color: '#e5484d', borderRadius: [0, 4, 4, 0] } },
          { value: +ta.toFixed(2), itemStyle: { color: '#cbd5e1', borderRadius: [0, 4, 4, 0] } },
        ],
        label: { show: true, position: 'right', fontSize: 11, color: '#475569', formatter: p => A.fmtMoney(p.value) },
      }],
    });
  }

  /* ---------- 交互 ---------- */
  function bind() {
    $$('[data-add]').forEach(b => {
      b.onclick = () => { makeRow(b.dataset.add, {}); render(); };
    });

    $('#btnDemo').onclick = () => {
      A.state.assets = [
        { id: nid(), name: '活期存款', cat: '现金及活期', amount: 60000, note: '日常备用金' },
        { id: nid(), name: '货币基金', cat: '存款 / 理财', amount: 150000, note: 'T+0' },
        { id: nid(), name: 'A股账户', cat: '股票', amount: 320000, note: '沪深300 + 红利' },
        { id: nid(), name: '场外基金', cat: '基金 / ETF', amount: 210000, note: '纳指 / 黄金ETF' },
        { id: nid(), name: '自住房', cat: '房产', amount: 1800000, note: '市值' },
        { id: nid(), name: '家用车', cat: '车辆', amount: 120000, note: '' },
      ];
      A.state.debts = [
        { id: nid(), name: '住房按揭', cat: '房贷', amount: 980000, note: '剩余本金，利率 3.2%' },
        { id: nid(), name: '车贷', cat: '车贷', amount: 45000, note: '' },
      ];
      render(); A.toast('已载入示例数据');
    };

    $('#btnClear').onclick = () => {
      if (!confirm('确认清空全部资产与负债记录？')) return;
      A.state.assets = []; A.state.debts = []; render(); A.toast('已清空');
    };

    $('#btnExport').onclick = () => {
      const blob = new Blob([JSON.stringify({ assets: A.state.assets, debts: A.state.debts }, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = '资产管家_资产负债_' + A.today() + '.json';
      a.click(); URL.revokeObjectURL(a.href);
    };

    const fi = $('#fileImport');
    $('#btnImport').onclick = () => fi.click();
    fi.onchange = () => {
      const f = fi.files && fi.files[0];
      if (!f) return;
      const rd = new FileReader();
      rd.onload = () => {
        try {
          const o = JSON.parse(rd.result);
          if (Array.isArray(o.assets)) A.state.assets = o.assets.map(x => Object.assign({ id: nid() }, x));
          if (Array.isArray(o.debts)) A.state.debts = o.debts.map(x => Object.assign({ id: nid() }, x));
          render(); A.toast('导入成功');
        } catch (e) { A.toast('文件格式有误'); }
      };
      rd.readAsText(f); fi.value = '';
    };

    $('#btnSendForecast').onclick = () => {
      const { net } = totals();
      if (net <= 0) { A.toast('净资产为 0，无法带入'); return; }
      if (window.Forecast) Forecast.setInitial(net);
      document.querySelector('.tab[data-tab="forecast"]').click();
      A.toast('已把净资产 ' + A.fmtMoney(net) + ' 带入未来预测');
    };
  }

  return { init: function () { bind(); render(); }, render, totals, ASSET_CATS, DEBT_CATS };
})();
