/* 功能二：多资产历史回测 */
window.Backtest = (function () {
  'use strict';
  const A = window.AM;
  const { $, $$ } = A;

  let CATALOG = [];
  let basket = [];               // {secid, name, weight}
  let lastResult = null;         // 供预测模块复用

  const PERIODS_PER_YEAR = { day: 252, week: 52, month: 12 };
  const RF = 0.02;               // 无风险利率假设

  /* ---------------- 资产池 ---------------- */
  function loadCatalog() {
    return A.api('catalog').then(d => {
      CATALOG = d.catalog || [];
      renderCatalog();
      renderBenchOptions();
    }).catch(e => { A.setNet('err', '目录加载失败'); });
  }

  function renderCatalog() {
    const box = $('#catalog');
    if (!box) return;
    box.innerHTML = '';
    CATALOG.forEach(g => {
      const wrap = document.createElement('div');
      wrap.className = 'cgroup';
      const t = document.createElement('div');
      t.className = 'cgroup-t';
      t.textContent = g.group;
      wrap.appendChild(t);
      g.items.forEach(it => {
        const row = document.createElement('div');
        row.className = 'citem' + (basket.some(b => b.secid === it.secid) ? ' on' : '');
        const nm = document.createElement('span');
        nm.textContent = it.name;
        const pl = document.createElement('span');
        pl.className = 'plus';
        pl.textContent = basket.some(b => b.secid === it.secid) ? '✓' : '+';
        row.append(nm, pl);
        row.onclick = () => toggle(it.secid, it.name);
        wrap.appendChild(row);
      });
      box.appendChild(wrap);
    });
  }

  function toggle(secid, name) {
    const i = basket.findIndex(b => b.secid === secid);
    if (i >= 0) { basket.splice(i, 1); }
    else { basket.push({ secid, name: name || secid, weight: 0 }); }
    normalize();
    renderBasket();
    renderCatalog();
    renderBenchOptions();
    A.state.basket = basket;
    A.save();
  }

  /** 权重归一化：新加入（权重为 0）的标的先继承当前平均权重，再整体缩放到 100% */
  function normalize() {
    const n = basket.length;
    if (!n) return;
    let sum = basket.reduce((s, b) => s + (Number(b.weight) || 0), 0);
    if (sum <= 0) {
      const eq = +(100 / n).toFixed(2);
      basket.forEach(b => { b.weight = eq; });
      sum = basket.reduce((s, b) => s + b.weight, 0);
    } else {
      const zeros = basket.filter(b => !b.weight);
      if (zeros.length) {
        const held = n - zeros.length;
        const avg = held > 0 ? sum / held : 100 / n;
        zeros.forEach(b => { b.weight = avg; });
        sum += avg * zeros.length;
      }
    }
    if (sum > 0 && Math.abs(sum - 100) > 0.01) {
      basket.forEach(b => { b.weight = +(b.weight / sum * 100).toFixed(2); });
    }
  }

  function renderBasket() {
    const box = $('#basket');
    if (!box) return;
    box.innerHTML = '';
    $('#selCount').textContent = '已选 ' + basket.length;
    if (!basket.length) {
      box.innerHTML = '<div class="empty-note">从左侧资产池点选标的，或搜索添加</div>';
      updateWeightTip();
      return;
    }
    basket.forEach((b, idx) => {
      const row = document.createElement('div');
      row.className = 'brow';

      const nm = document.createElement('div');
      nm.className = 'bname';
      const dot = document.createElement('span');
      dot.className = 'tag';
      dot.textContent = String(idx + 1);
      const txt = document.createElement('span');
      txt.textContent = b.name;
      txt.style.overflow = 'hidden';
      txt.style.textOverflow = 'ellipsis';
      txt.style.whiteSpace = 'nowrap';
      nm.append(dot, txt);

      const wcell = document.createElement('div');
      wcell.className = 'wcell';
      const rg = document.createElement('input');
      rg.type = 'range'; rg.min = '0'; rg.max = '100'; rg.step = '1'; rg.value = b.weight;
      const wv = document.createElement('span');
      wv.className = 'wval'; wv.textContent = b.weight.toFixed(0) + '%';
      rg.oninput = () => { b.weight = Number(rg.value); wv.textContent = b.weight + '%'; updateWeightTip(); A.save(); };
      wcell.append(rg, wv);

      const del = document.createElement('button');
      del.className = 'del'; del.textContent = '×';
      del.onclick = () => toggle(b.secid, b.name);

      row.append(nm, wcell, del);
      box.appendChild(row);
    });
    updateWeightTip();
  }

  function updateWeightTip() {
    const sum = basket.reduce((s, b) => s + (Number(b.weight) || 0), 0);
    const el = $('#weightTip');
    if (!el) return;
    el.textContent = '权重合计 ' + sum.toFixed(0) + '%';
    el.style.color = Math.abs(sum - 100) < 0.5 ? '#12a594' : '#e5484d';
  }

  function renderBenchOptions() {
    const sel = $('#btBench');
    if (!sel) return;
    const keep = sel.value;
    sel.innerHTML = '';
    const list = basket.slice();
    if (!list.some(b => b.secid === '1.000300')) list.push({ secid: '1.000300', name: '沪深300（基准）' });
    list.forEach(b => {
      const o = document.createElement('option');
      o.value = b.secid; o.textContent = b.name;
      sel.appendChild(o);
    });
    if (keep && list.some(b => b.secid === keep)) sel.value = keep;
  }

  /* ---------------- 搜索 ---------------- */
  function bindSearch() {
    const input = $('#assetSearch'), box = $('#suggestBox');
    let timer = null;
    input.oninput = () => {
      clearTimeout(timer);
      const q = input.value.trim();
      if (!q) { box.classList.remove('show'); return; }
      timer = setTimeout(() => {
        A.api('search', { q }).then(d => {
          const rs = d.results || [];
          box.innerHTML = '';
          if (!rs.length) {
            box.innerHTML = '<div style="color:#9aa5b6">未找到相关标的</div>';
            box.classList.add('show'); return;
          }
          rs.forEach(r => {
            const el = document.createElement('div');
            el.innerHTML = '<span>' + r.name + '</span><small>' + r.type + ' · ' + r.code + '</small>';
            el.onclick = () => {
              if (!basket.some(b => b.secid === r.secid)) basket.push({ secid: r.secid, name: r.name, weight: 0 });
              normalize(); renderBasket(); renderCatalog(); renderBenchOptions();
              A.state.basket = basket; A.save();
              box.classList.remove('show'); input.value = '';
              A.toast('已添加：' + r.name);
            };
            box.appendChild(el);
          });
          box.classList.add('show');
        });
      }, 260);
    };
    document.addEventListener('click', e => {
      if (!e.target.closest('.searchbox')) box.classList.remove('show');
    });
  }

  /* ---------------- 数据对齐 ---------------- */
  /**
   * 输入 {secid:{name,dates,close,...}}，返回 {dates, prices, firstDate}
   *
   * 关键：区间取**并集**（最早起点 ~ 最晚终点），不再被历史最短的标的压缩。
   * 某标的在其首个交易日之前的价格记 null，由 simulate() 做“逐步纳入”处理。
   * 已有价格之后缺失的日期沿用前值（前值填充）。
   */
  function align(seriesMap) {
    const ids = Object.keys(seriesMap).filter(id => (seriesMap[id].dates || []).length);
    if (!ids.length) return null;

    let start = '9999-99-99', end = '0000-00-00';
    ids.forEach(id => {
      const d = seriesMap[id].dates;
      if (d[0] < start) start = d[0];
      if (d[d.length - 1] > end) end = d[d.length - 1];
    });
    if (start > end) return null;

    const set = new Set();
    ids.forEach(id => seriesMap[id].dates.forEach(d => { if (d >= start && d <= end) set.add(d); }));
    const dates = Array.from(set).sort();

    const prices = {}, firstDate = {};
    ids.forEach(id => {
      const s = seriesMap[id];
      const m = new Map();
      s.dates.forEach((d, i) => m.set(d, s.close[i]));
      firstDate[id] = s.dates[0];
      const arr = [];
      let last = null;
      for (const d of dates) {
        if (m.has(d)) last = m.get(d);      // 首个交易日之前保持 null
        arr.push(last);
      }
      prices[id] = arr;
    });
    return { dates, prices, firstDate, start, end };
  }

  /* ---------------- 组合模拟 ----------------
   * 单位净值用标准 TWR 递推：unit_t = unit_{t-1} × nav_t' / nav_{t-1}
   * （nav_t' 为仅由价格变动产生的市值，现金流单独计入），
   * 这样外部申赎不会影响收益率曲线，也不受“初始本金为 0”的限制。
   *
   * 支持“逐步纳入”：某标的在其首个交易日之前价格为 null，
   * 这段时间它不参与组合；一旦出现，按目标权重做一次建仓。
   */
  function simulate(al, weights, cfg) {
    const { dates, prices } = al;
    const ids = Object.keys(prices);
    const n = dates.length;

    const wRaw = {};
    ids.forEach(id => { wRaw[id] = Math.max(0, (weights[id] || 0) / 100); });

    const shares = {};
    ids.forEach(id => { shares[id] = 0; });

    const pick = t => ids.filter(id => prices[id][t] != null);
    const wsumOf = list => list.reduce((s, id) => s + wRaw[id], 0) || 1;
    const navOf = (t, list) => list.reduce((s, id) => s + shares[id] * prices[id][t], 0);

    /** 按目标权重重新分配持仓（权重在当期可投标的内部归一化） */
    function rebalance(t, list) {
      const total = navOf(t, list), ws = wsumOf(list);
      list.forEach(id => {
        shares[id] = prices[id][t] > 0 ? total * (wRaw[id] / ws) / prices[id][t] : 0;
      });
      return total;
    }

    const freqHit = (cur, prev, freq) => {
      if (freq === 'none') return false;
      const cy = cur.slice(0, 4), py = prev.slice(0, 4);
      const cm = cur.slice(5, 7), pm = prev.slice(5, 7);
      if (freq === 'year') return cy !== py;
      if (freq === 'quarter') return cy !== py || (Math.floor((+cm - 1) / 3) !== Math.floor((+pm - 1) / 3));
      if (freq === 'month') return cy !== py || cm !== pm;
      return false;
    };

    const navSeries = new Array(n), unitSeries = new Array(n), investSeries = new Array(n);
    const active = {};
    ids.forEach(id => { active[id] = false; });

    let invested = cfg.init;
    let unit = 1;

    const act0 = pick(0);
    if (!act0.length) return null;
    act0.forEach(id => { active[id] = true; });
    // 初始建仓：按当期可投标的内部归一化权重分配
    const ws0 = wsumOf(act0);
    act0.forEach(id => {
      shares[id] = prices[id][0] > 0 ? cfg.init * (wRaw[id] / ws0) / prices[id][0] : 0;
    });

    let prevNav = cfg.init;
    navSeries[0] = cfg.init; unitSeries[0] = 1; investSeries[0] = invested;
    const flows = [];
    if (cfg.init > 0) flows.push({ d: new Date(dates[0]), v: -cfg.init });

    for (let t = 1; t < n; t++) {
      const act = pick(t);
      if (!act.length) {
        navSeries[t] = prevNav; unitSeries[t] = unit; investSeries[t] = invested;
        continue;
      }

      // 1) 价格变动带来的市值变化（TWR 递推）
      let nav = navOf(t, act);
      if (prevNav > 0) unit *= nav / prevNav;

      // 2) 新标的首次可交易 -> 按权重纳入（相当于该资产上市/数据起点）
      const newly = act.filter(id => !active[id]);
      if (newly.length) {
        newly.forEach(id => { active[id] = true; });
        nav = rebalance(t, act);
      }

      // 3) 定投
      if (cfg.dcaFreq !== 'none' && cfg.dcaAmt > 0 && freqHit(dates[t], dates[t - 1], cfg.dcaFreq)) {
        const ws = wsumOf(act), cash = cfg.dcaAmt;
        act.forEach(id => {
          if (prices[id][t] > 0) shares[id] += cash * (wRaw[id] / ws) / prices[id][t];
        });
        nav += cash; invested += cash;
        flows.push({ d: new Date(dates[t]), v: -cash });
      }

      // 4) 再平衡
      if (cfg.rebal !== 'none' && freqHit(dates[t], dates[t - 1], cfg.rebal)) {
        nav = rebalance(t, act);
      }

      prevNav = nav;
      navSeries[t] = nav; unitSeries[t] = unit; investSeries[t] = invested;
    }

    flows.push({ d: new Date(dates[n - 1]), v: prevNav });

    return { navSeries, unitSeries, investSeries, flows, dates, invested, final: prevNav };
  }

  function xirr(flows) {
    const t0 = flows[0].d.getTime();
    const yrs = d => (d.getTime() - t0) / (365.25 * 86400000);
    const npv = r => {
      let s = 0;
      for (const f of flows) {
        const y = yrs(f.d);
        s += f.v / Math.pow(1 + r, Math.abs(y) < 1e-9 ? 0.0001 : y);
      }
      return s;
    };
    let lo = -0.9999, hi = 10;
    let flo = npv(lo), fhi = npv(hi);
    if (flo * fhi > 0) return null;
    for (let i = 0; i < 300; i++) {
      const mid = (lo + hi) / 2, fm = npv(mid);
      if (Math.abs(fm) < 1e-7) return mid;
      if (flo * fm <= 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; }
    }
    return (lo + hi) / 2;
  }

  /* ---------------- 指标 ---------------- */
  function metrics(unitSeries, dates, period, flows, invested, finalNav) {
    const ppy = PERIODS_PER_YEAR[period] || 252;
    const rets = A.toReturns(unitSeries);
    const totalRet = unitSeries[unitSeries.length - 1] / unitSeries[0] - 1;
    const years = (new Date(dates[dates.length - 1]) - new Date(dates[0])) / (365.25 * 86400000);
    const cagrV = A.cagr(totalRet, years);
    const dd = A.maxDrawdown(unitSeries);
    const vol = A.stdev(rets) * Math.sqrt(ppy);
    const sharpe = vol > 0 ? (cagrV - RF) / vol : 0;
    const calmar = dd.mdd < 0 ? cagrV / Math.abs(dd.mdd) : 0;
    const irr = xirr(flows);

    // 最长回撤修复
    let maxRepair = 0, inDd = false, ddStart = 0;
    const peakRef = [];
    let pk = unitSeries[0];
    unitSeries.forEach(v => { if (v > pk) pk = v; peakRef.push(pk); });
    for (let i = 0; i < unitSeries.length; i++) {
      if (unitSeries[i] < peakRef[i] - 1e-12) { if (!inDd) { inDd = true; ddStart = i; } }
      else if (inDd) { inDd = false; maxRepair = Math.max(maxRepair, i - ddStart); }
    }
    if (inDd) maxRepair = Math.max(maxRepair, unitSeries.length - 1 - ddStart);

    return {
      totalRet, cagr: cagrV, mdd: dd.mdd, vol, sharpe, calmar,
      years, irr, invested, finalNav,
      profit: finalNav - invested,
      roi: invested > 0 ? finalNav / invested - 1 : 0,
      maxRepairDays: maxRepair,
      ddPeak: dates[dd.peakIdx], ddTrough: dates[dd.troughIdx],
    };
  }

  function yearlyReturns(unitSeries, dates) {
    const out = [];
    let curY = null, startVal = unitSeries[0];
    for (let i = 1; i < dates.length; i++) {
      const y = dates[i].slice(0, 4);
      if (y !== curY) {
        if (curY !== null) out.push({ year: curY, ret: startVal > 0 ? unitSeries[i - 1] / startVal - 1 : 0 });
        curY = y; startVal = unitSeries[i - 1];
      }
    }
    if (curY !== null) out.push({ year: curY, ret: startVal > 0 ? unitSeries[unitSeries.length - 1] / startVal - 1 : 0 });
    return out;
  }

  /* ---------------- 运行 ---------------- */
  function run() {
    if (basket.length < 1) { A.toast('请先选择至少一个标的'); return; }
    const btn = $('#btnRunBacktest');
    btn.disabled = true;
    const st = $('#btState');
    st.className = 'runstate'; st.textContent = '正在拉取行情…';
    A.setNet('busy', '拉取行情中…');

    const period = $('#btPeriod').value;
    const start = $('#btStart').value || '1990-01-01';
    const end = $('#btEnd').value || A.today();
    const secids = basket.map(b => b.secid).join(',');
    const bench = $('#btBench').value;

    const allIds = Array.from(new Set(basket.map(b => b.secid).concat([bench])));

    A.api('batch', { secids: allIds.join(','), start: A.ymdCompact(start), end: A.ymdCompact(end), period })
      .then(d => {
        const series = d.series || {};
        const bad = Object.keys(d.errors || {});
        const ok = allIds.filter(id => (series[id] && series[id].close && series[id].close.length > 2));
        if (!ok.length) { throw new Error('所选标的无有效行情数据'); }

        const al = align(series);
        if (!al || al.dates.length < 5) throw new Error('共同交易区间过短，请扩大时间范围');

        const weights = {};
        basket.forEach(b => weights[b.secid] = Number(b.weight) || 0);

        const cfg = {
          init: Number($('#btInit').value) || 0,
          dcaFreq: $('#btDcaFreq').value,
          dcaAmt: Number($('#btDcaAmt').value) || 0,
          rebal: $('#btRebal').value,
        };

        const sim = simulate(al, weights, cfg);
        if (!sim) throw new Error('所选标的在回测区间内无有效数据');
        const m = metrics(sim.unitSeries, al.dates, period, sim.flows, sim.invested, sim.final);

        // 基准（买入持有，不定投）
        const benchFull = al.prices[bench];
        let benchUnit = null, benchM = null;
        if (benchFull) {
          const bs = benchFull.findIndex(v => v != null);
          if (bs >= 0) {
            const bv = benchFull.slice(bs), bd = al.dates.slice(bs);
            benchUnit = benchFull.map((v, i) => (v == null ? null : v / bv[0]));
            benchM = metrics(bv.map(v => v / bv[0]), bd, period,
              [{ d: new Date(bd[0]), v: -1 }, { d: new Date(bd[bd.length - 1]), v: bv[bv.length - 1] / bv[0] }],
              1, bv[bv.length - 1] / bv[0]);
          }
        }

        // 单资产表现（各自从自己首个有效数据点起算）
        const details = [];
        Object.keys(al.prices).forEach(id => {
          const full = al.prices[id];
          const s0 = full.findIndex(v => v != null);
          if (s0 < 0) return;
          const p = full.slice(s0), dts = al.dates.slice(s0);
          if (p.length < 2) return;
          const u = p.map(v => v / p[0]);
          const mm = metrics(u, dts, period,
            [{ d: new Date(dts[0]), v: -1 }, { d: new Date(dts[dts.length - 1]), v: u[u.length - 1] }],
            1, u[u.length - 1]);
          const w = (weights[id] || 0) / 100;
          const meta = series[id] || {};
          details.push({
            secid: id, name: meta.name || id,
            weight: weights[id] || 0, ret: mm.totalRet, cagr: mm.cagr,
            mdd: mm.mdd, vol: mm.vol, contrib: w * mm.totalRet,
            from: dts[0],
            source: meta.source || 'real',
            realStart: meta.realStart || dts[0],
            proxyName: meta.proxyName,
            note: meta.note,
            estimated: !!meta.realStart && meta.realStart > dts[0],
          });
        });
        details.sort((a, b) => b.weight - a.weight);

        lastResult = { al, weights, period, m, bench, benchUnit, benchM, details, sim, series };
        renderResult(lastResult, bad);
        st.className = 'runstate ok';
        st.textContent = '完成 · ' + al.dates.length + ' 个数据点（' + al.dates[0] + ' ~ ' + al.dates[al.dates.length - 1] + '）'
          + (bad.length ? ' · ' + bad.length + ' 个标的取数失败' : '');
        A.sourceLabel();
      })
      .catch(e => {
        st.className = 'runstate err';
        st.textContent = '失败：' + e.message;
        A.setNet('err', '取数失败');
        A.toast('回测失败：' + e.message);
      })
      .finally(() => { btn.disabled = false; });
  }

  function renderResult(r, bad) {
    $('#btResultCard').hidden = false;
    const m = r.m;

    const kpi = (label, val, sub, cls) =>
      '<div class="kpi"><span class="kpi-label">' + label + '</span>' +
      '<span class="kpi-val ' + (cls || '') + '">' + val + '</span>' +
      '<span class="kpi-sub">' + (sub || '') + '</span></div>';

    const upCls = v => v >= 0 ? '' : 'danger';
    $('#btKpis').innerHTML =
      kpi('期末市值', A.fmtMoney(m.finalNav), '累计投入 ' + A.fmtMoney(m.invested)) +
      kpi('净收益', A.fmtMoney(m.profit), '投入回报率 ' + A.fmtPct(m.roi * 100, 1), upCls(m.profit)) +
      kpi('组合年化', A.fmtPct(m.cagr * 100, 2), '净值增长 ' + A.fmtPct(m.totalRet * 100, 1), upCls(m.cagr)) +
      kpi('资金加权 IRR', m.irr === null ? '—' : A.fmtPct(m.irr * 100, 2), '含定投现金流') +
      kpi('最大回撤', A.fmtPct(m.mdd * 100, 2), m.ddPeak + ' → ' + m.ddTrough, 'danger') +
      kpi('年化波动 / 夏普', A.fmtPct(m.vol * 100, 1) + ' / ' + A.fmtNum(m.sharpe), '卡玛 ' + A.fmtNum(m.calmar));

    $('#btRangeNote').textContent =
      r.al.dates[0] + ' ~ ' + r.al.dates[r.al.dates.length - 1] + ' · ' + m.years.toFixed(1) + ' 年';

    /* 数据来源说明 */
    const estTar = r.details.filter(d => d.estimated);
    const proxyTar = r.details.filter(d => d.source === 'proxy' || d.source === 'synthetic');
    const lateTar = r.details.filter(d => d.from > r.al.dates[0] && !d.estimated);
    let noteHtml = '';
    if (proxyTar.length) {
      noteHtml += '<div class="datanote warn"><b>整段为替代序列</b>：' +
        proxyTar.map(d => d.name + '（取数失败，已用「' + (d.proxyName || '同类资产') + '」走势代替）').join('、') +
        '，回测结果仅供示意。</div>';
    }
    if (estTar.length) {
      noteHtml += '<div class="datanote"><b>部分区间含模拟数据</b>：' +
        estTar.map(d => d.name + ' 真实数据自 <b>' + d.realStart + '</b> 起，之前由「' +
          (d.proxyName || '同类资产') + '」历史走势回溯补全').join('；') + '。</div>';
    }
    if (lateTar.length) {
      noteHtml += '<div class="datanote"><b>后期纳入</b>：' +
        lateTar.map(d => d.name + ' 自 ' + d.from + ' 起才有数据，此前该权重分配给组合内其他标的').join('；') + '。</div>';
    }
    $('#btDataNote').innerHTML = noteHtml;

    /* 净值曲线（缺失段用 null 断开） */
    const base = 100;
    const series = [{
      name: '投资组合', type: 'line', showSymbol: false, smooth: false,
      lineStyle: { width: 2.4, color: '#2563eb' },
      areaStyle: { color: 'rgba(37,99,235,.08)' },
      data: r.sim.unitSeries.map(v => +(v / r.sim.unitSeries[0] * base).toFixed(3)),
      z: 5,
    }];
    if (r.benchUnit) {
      series.push({
        name: '基准 · ' + ((r.series[r.bench] && r.series[r.bench].name) || r.bench),
        type: 'line', showSymbol: false, connectNulls: false,
        lineStyle: { width: 1.6, color: '#94a3b8', type: 'dashed' },
        data: r.benchUnit.map(v => (v == null ? null : +(v * base).toFixed(3))),
      });
    }
    const colors = ['#e5484d', '#12a594', '#f5a524', '#8b5cf6', '#0ea5e9', '#ec4899', '#84cc16', '#f97316'];
    Object.keys(r.al.prices).forEach((id, i) => {
      if (id === r.bench) return;
      const p = r.al.prices[id];
      const f0 = p.find(v => v != null);
      if (f0 == null) return;
      series.push({
        name: (r.series[id] && r.series[id].name) || id,
        type: 'line', showSymbol: false, connectNulls: false,
        lineStyle: { width: 1, color: colors[i % colors.length], opacity: .75 },
        data: p.map(v => (v == null ? null : +(v / f0 * base).toFixed(3))),
      });
    });

    A.chart('chartBtNav', {
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'line' },
        valueFormatter: v => (+v).toFixed(1),
      },
      legend: { top: 0, itemWidth: 14, itemHeight: 8, textStyle: { fontSize: 11, color: '#475569' }, type: 'scroll' },
      grid: Object.assign({}, A.GRID, { top: 46, left: 50, bottom: 56 }),
      xAxis: Object.assign({ type: 'category', data: r.al.dates, boundaryGap: false }, A.AXIS_STYLE,
        { axisLabel: { color: '#7b8798', fontSize: 11, formatter: v => v.slice(0, 7) } }),
      yAxis: Object.assign({ type: 'value', scale: true }, A.AXIS_STYLE,
        { axisLabel: { color: '#7b8798', fontSize: 11 } }),
      dataZoom: [{ type: 'inside' }, { type: 'slider', height: 16, bottom: 6, borderColor: 'transparent' }],
      series,
    });

    /* 回撤 */
    const ddSeries = [];
    let pk = r.sim.unitSeries[0];
    r.sim.unitSeries.forEach(v => { if (v > pk) pk = v; ddSeries.push(+((v / pk - 1) * 100).toFixed(3)); });
    A.chart('chartBtDd', {
      tooltip: { trigger: 'axis', valueFormatter: v => (+v).toFixed(2) + '%' },
      grid: Object.assign({}, A.GRID, { top: 14, left: 48, right: 16, bottom: 26 }),
      xAxis: Object.assign({ type: 'category', data: r.al.dates, boundaryGap: false }, A.AXIS_STYLE,
        { axisLabel: { color: '#7b8798', fontSize: 10, formatter: v => v.slice(0, 7) }, splitLine: { show: false } }),
      yAxis: Object.assign({ type: 'value', max: 0 }, A.AXIS_STYLE,
        { axisLabel: { color: '#7b8798', fontSize: 10, formatter: '{value}%' } }),
      series: [{
        type: 'line', data: ddSeries, showSymbol: false,
        lineStyle: { width: 1, color: '#e5484d' },
        areaStyle: { color: 'rgba(229,72,77,.16)' },
      }],
    });

    /* 年度收益 */
    const yr = yearlyReturns(r.sim.unitSeries, r.al.dates);
    A.chart('chartBtYear', {
      tooltip: { trigger: 'axis', valueFormatter: v => (+v).toFixed(2) + '%' },
      grid: Object.assign({}, A.GRID, { top: 14, left: 48, right: 16, bottom: 26 }),
      xAxis: Object.assign({ type: 'category', data: yr.map(y => y.year) }, A.AXIS_STYLE,
        { axisLabel: { color: '#7b8798', fontSize: 10, interval: Math.max(0, Math.floor(yr.length / 10)) }, splitLine: { show: false } }),
      yAxis: Object.assign({ type: 'value' }, A.AXIS_STYLE,
        { axisLabel: { color: '#7b8798', fontSize: 10, formatter: '{value}%' } }),
      series: [{
        type: 'bar', barWidth: '58%',
        data: yr.map(y => ({
          value: +(y.ret * 100).toFixed(2),
          itemStyle: { color: y.ret >= 0 ? '#e5484d' : '#12a594' },   // 涨红跌绿
        })),
      }],
    });

    /* 明细 */
    const tb = $('#tblBtDetail tbody');
    const srcCell = d => {
      const tip = ' title="' + (d.note || '').replace(/"/g, '') + '"';
      if (d.source === 'proxy' || d.source === 'synthetic') {
        return '<span class="tag est"' + tip + '>整段替代：' + (d.proxyName || '同类资产') + '</span>';
      }
      if (d.estimated) {
        return '<span class="tag est"' + tip + '>' + d.realStart + ' 起，之前为模拟</span>';
      }
      if (d.from > r.al.dates[0]) {
        return '<span class="tag late">' + d.from + ' 起纳入</span>';
      }
      return d.from;
    };
    tb.innerHTML = r.details.map(d =>
      '<tr><td>' + d.name + '</td>' +
      '<td class="num">' + d.weight.toFixed(0) + '%</td>' +
      '<td class="num" style="color:' + (d.ret >= 0 ? '#e5484d' : '#12a594') + '">' + A.fmtPct(d.ret * 100, 1) + '</td>' +
      '<td class="num">' + A.fmtPct(d.cagr * 100, 2) + '</td>' +
      '<td class="num" style="color:#12a594">' + A.fmtPct(d.mdd * 100, 1) + '</td>' +
      '<td class="num">' + A.fmtPct(d.vol * 100, 1) + '</td>' +
      '<td class="num">' + (d.contrib * 100).toFixed(1) + '%</td>' +
      '<td>' + srcCell(d) + '</td></tr>'
    ).join('');
  }

  /* ---------------- 参数 & 初始化 ---------------- */
  function setRangeYears(y) {
    const end = A.today();
    const start = y > 0 ? A.yearsAgo(y) : '1990-01-01';
    $('#btStart').value = start;
    $('#btEnd').value = end;
  }

  function bind() {
    $('#btnRunBacktest').onclick = run;

    $$('#btRanges .chip').forEach(c => {
      c.onclick = () => {
        $$('#btRanges .chip').forEach(x => x.classList.remove('active'));
        c.classList.add('active');
        setRangeYears(Number(c.dataset.y));
      };
    });

    $('#btnEqual').onclick = () => {
      if (!basket.length) return;
      const eq = +(100 / basket.length).toFixed(2);
      basket.forEach(b => b.weight = eq);
      renderBasket(); A.save();
    };
    $('#btnNorm').onclick = () => {
      const s = basket.reduce((a, b) => a + (Number(b.weight) || 0), 0);
      if (!basket.length || s <= 0) return;
      basket.forEach(b => b.weight = +(b.weight / s * 100).toFixed(2));
      renderBasket(); A.save();
    };
    $('#btnClassic6040').onclick = () => applyPreset([
      ['1.000300', '沪深300', 60], ['1.511260', '十年国债ETF', 40],
    ]);
    $('#btnAllWeather').onclick = () => applyPreset([
      ['1.000300', '沪深300', 30], ['1.511260', '十年国债ETF', 40],
      ['1.518880', '黄金ETF（人民币计价）', 15], ['100.SPX', '标普500', 15],
    ]);
    $('#btnClearBasket').onclick = () => {
      basket = []; A.state.basket = basket; A.save();
      renderBasket(); renderCatalog(); renderBenchOptions();
    };
    $('#btnDiag').onclick = () => {
      const box = $('#diagBox');
      if (!box) return;
      box.hidden = false;
      box.innerHTML = '<div class="hint">正在体检各标的数据状况…</div>';
      A.api('diag')
        .then(d => {
          const items = d.items || [];
          const bad = items.filter(x => !x.ok);
          const row = x => {
            if (x.kind === 'fixed') {
              return '<tr><td>' + x.name + '</td><td class="num">—</td><td class="num">—</td>' +
                '<td class="num">固定 ' + x.rate + '%</td><td><span class="tag late">现金类</span></td></tr>';
            }
            if (!x.ok) {
              return '<tr><td>' + x.name + '</td><td class="num">0</td><td class="num">—</td>' +
                '<td class="num">—</td><td><span class="tag est">取数失败</span></td></tr>';
            }
            const est = x.realStart && x.first && x.realStart > x.first;
            const st = est
              ? '<span class="tag est" title="' + (x.note || '') + '">含模拟（' + x.realStart + ' 起真实）</span>'
              : '<span class="tag late">完整</span>';
            return '<tr><td>' + x.name + '</td><td class="num">' + x.points + '</td>' +
              '<td class="num">' + x.first + '</td><td class="num">' + (x.realStart || x.first) + '</td>' +
              '<td>' + st + '</td></tr>';
          };
          box.innerHTML =
            '<div class="datanote' + (bad.length ? ' warn' : '') + '">共 ' + items.length +
            ' 项标的，' + (bad.length ? '<b>' + bad.length + ' 项取数失败</b>' : '全部可取数') +
            '。历史不足的标的会在回测时自动用同类资产走势补全，并标注。</div>' +
            '<div class="tbl-wrap h240"><table class="tbl"><thead><tr><th>标的</th><th>点数</th>' +
            '<th>数据起点</th><th>真实起点</th><th>状态</th></tr></thead><tbody>' +
            items.map(row).join('') + '</tbody></table></div>';
        })
        .catch(() => {
          box.innerHTML = '<div class="datanote warn">当前为离线快照模式，无法联网体检；' +
            '离线数据同样可用于回测与预测。</div>';
        });
    };

    $('#btnBtToForecast').onclick = () => {
      if (!lastResult) { A.toast('请先完成一次回测'); return; }
      if (window.Forecast) Forecast.adopt(lastResult);
      document.querySelector('.tab[data-tab="forecast"]').click();
      A.toast('组合已带入未来预测');
    };
  }

  function applyPreset(list) {
    basket = list.map(x => ({ secid: x[0], name: x[1], weight: x[2] }));
    A.state.basket = basket; A.save();
    renderBasket(); renderCatalog(); renderBenchOptions();
    A.toast('已套用预设组合');
  }

  const DEFAULT_BASKET = [
    { secid: '1.000300', name: '沪深300', weight: 30 },
    { secid: '100.SPX', name: '标普500', weight: 25 },
    { secid: '1.518880', name: '黄金ETF（人民币计价）', weight: 15 },
    { secid: '124.HSTECH', name: '恒生科技指数', weight: 10 },
    { secid: '1.511260', name: '十年国债ETF', weight: 20 },
  ];

  function init() {
    if (A.state.basket && A.state.basket.length) basket = A.state.basket;
    else basket = DEFAULT_BASKET.map(x => Object.assign({}, x));
    normalize();
    setRangeYears(5);
    bind();
    bindSearch();
    renderBasket();
    loadCatalog();
  }

  return {
    init,
    getBasket: () => basket,
    getResult: () => lastResult,
    setBasket: b => { basket = b.slice(); A.state.basket = basket; A.save(); normalize(); renderBasket(); renderCatalog(); renderBenchOptions(); },
  };
})();
