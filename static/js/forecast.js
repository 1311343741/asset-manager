/* 功能三：未来资产走势预测（手动假设 + 机器预测） */
window.Forecast = (function () {
  'use strict';
  const A = window.AM;
  const { $, $$ } = A;

  let mode = 'manual';
  let manualRows = [];        // {id,name,secid,weight,ret}
  let machineRows = [];       // {id,name,secid,weight,mu,sigma,adj}
  let CATALOG = [];
  let statsCache = {};        // secid -> {mu, sigma, months}
  let monthlyCache = {};      // secid -> {months:[], rets:[]}
  let lastSim = null;

  const nid = () => 'f' + Math.random().toString(36).slice(2, 9);

  function loadCatalog() {
    return A.api('catalog').then(d => {
      CATALOG = d.catalog || [];
      buildDatalist();
    }).catch(() => {});
  }

  function flatItems() {
    const out = [];
    CATALOG.forEach(g => g.items.forEach(it => out.push(Object.assign({ group: g.group }, it))));
    return out;
  }

  function buildDatalist() {
    let dl = $('#assetList');
    if (!dl) {
      dl = document.createElement('datalist');
      dl.id = 'assetList';
      document.body.appendChild(dl);
    }
    dl.innerHTML = flatItems().map(it => '<option value="' + it.name + '">' + it.group + '</option>').join('');
  }

  function findByName(n) {
    return flatItems().find(it => it.name === n) || null;
  }

  /* ---------------- 手动模式 ---------------- */
  function renderManual() {
    const tb = $('#tblManual tbody');
    if (!tb) return;
    tb.innerHTML = '';
    manualRows.forEach(r => {
      const tr = document.createElement('tr');

      const td1 = document.createElement('td');
      const inp = document.createElement('input');
      inp.value = r.name; inp.setAttribute('list', 'assetList'); inp.placeholder = '资产名称';
      inp.oninput = () => { r.name = inp.value; const f = findByName(r.name); if (f) r.secid = f.secid; };
      td1.appendChild(inp);

      const td2 = document.createElement('td');
      const iw = document.createElement('input');
      iw.type = 'number'; iw.className = 'num'; iw.value = r.weight; iw.min = '0'; iw.max = '100'; iw.step = '1';
      iw.oninput = () => { r.weight = Number(iw.value) || 0; updateManualSum(); };
      td2.appendChild(iw);

      const td3 = document.createElement('td');
      const cell = document.createElement('div');
      cell.className = 'slider-cell';
      const rg = document.createElement('input');
      rg.type = 'range'; rg.min = '-20'; rg.max = '30'; rg.step = '0.1'; rg.value = r.ret;
      const b = document.createElement('b');
      b.textContent = r.ret.toFixed(1) + '%';
      rg.oninput = () => { r.ret = Number(rg.value); b.textContent = r.ret.toFixed(1) + '%'; updateManualSum(); };
      cell.append(rg, b);
      td3.appendChild(cell);

      const td4 = document.createElement('td');
      td4.style.fontSize = '12px';
      td4.style.color = '#7b8798';
      td4.textContent = (r.ret - Math.abs(r.ret) * 0.3).toFixed(1) + '% ~ ' + (r.ret + Math.abs(r.ret) * 0.3).toFixed(1) + '%';

      const td5 = document.createElement('td');
      const del = document.createElement('button');
      del.className = 'del'; del.textContent = '×';
      del.onclick = () => { manualRows = manualRows.filter(x => x.id !== r.id); renderManual(); };
      td5.appendChild(del);

      tr.append(td1, td2, td3, td4, td5);
      tb.appendChild(tr);
    });
    if (!manualRows.length) {
      tb.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#9aa5b6;padding:14px">暂无资产，点击下方「+ 添加资产」或「沿用回测组合」</td></tr>';
    }
    updateManualSum();
  }

  function updateManualSum() {
    const ws = manualRows.reduce((s, r) => s + (Number(r.weight) || 0), 0);
    const wAvg = ws > 0 ? manualRows.reduce((s, r) => s + r.weight * r.ret, 0) / ws : 0;
    $('#mWeightSum').textContent = ws.toFixed(0) + '%';
    $('#mWeightSum').style.color = Math.abs(ws - 100) < 0.5 ? '#12a594' : '#e5484d';
    $('#mReturnAvg').textContent = '加权 ' + wAvg.toFixed(2) + '%';
  }

  function addManualRow(data) {
    manualRows.push(Object.assign({ id: nid(), name: '', secid: '', weight: 0, ret: 5 }, data || {}));
    if (manualRows.length === 1) manualRows[0].weight = 100;
    renderManual();
  }

  /** 投入频率 -> 每年期数 / 间隔月数 */
  const FREQ = {
    month: { times: 12, step: 1, label: '每月' },
    quarter: { times: 4, step: 3, label: '每季' },
    year: { times: 1, step: 12, label: '每年' },
  };
  function freqOf(v) { return FREQ[v] || FREQ.month; }

  /** 累计投入 = 起始本金 + 每次金额 × 期数，期数 = 每年期数 × 年数 */
  function totalContrib(init, perAmount, freq, years) {
    return init + perAmount * freqOf(freq).times * Math.max(0, years);
  }

  /* 手动推演：按月复利；每到投入月，先投后计息 */
  function projectManual(rows, init, years, perAmount, freq, shock) {
    const N = Math.max(1, Math.min(500, Math.round(years)));
    const step = freqOf(freq).step;
    const ws = rows.reduce((s, r) => s + (Number(r.weight) || 0), 0) || 1;
    let r = rows.reduce((s, x) => s + (x.weight / ws) * x.ret, 0) / 100;
    if (shock) r = rows.reduce((s, x) => {
      const rr = x.ret + shock * Math.abs(x.ret);
      return s + (x.weight / ws) * rr;
    }, 0) / 100;

    const monthly = Math.pow(1 + r, 1 / 12) - 1;
    const out = [];
    let v = init, invested = init;
    out.push({ year: 0, value: v, invested, contrib: 0 });

    for (let y = 1; y <= N; y++) {
      for (let k = 0; k < 12; k++) {
        if (k % step === 0) { v += perAmount; invested += perAmount; }
        v *= (1 + monthly);
      }
      out.push({ year: y, value: v, invested, contrib: perAmount * freqOf(freq).times });
    }
    return out;
  }

  /* ---------------- 机器模式 ---------------- */
  function renderMachine() {
    const tb = $('#tblMachine tbody');
    if (!tb) return;
    tb.innerHTML = '';
    machineRows.forEach(r => {
      const tr = document.createElement('tr');

      const td1 = document.createElement('td');
      const sel = document.createElement('select');
      const seen = new Set(machineRows.map(x => x.secid));
      CATALOG.forEach(g => {
        const og = document.createElement('optgroup');
        og.label = g.group;
        g.items.forEach(it => {
          if (it.secid !== r.secid && seen.has(it.secid)) return;
          const o = document.createElement('option');
          o.value = it.secid; o.textContent = it.name;
          if (it.secid === r.secid) o.selected = true;
          og.appendChild(o);
        });
        sel.appendChild(og);
      });
      sel.onchange = () => {
        const it = flatItems().find(x => x.secid === sel.value);
        r.secid = sel.value; r.name = it ? it.name : sel.value;
        if (it && it.fixed !== undefined) {
          r.mu = it.fixed; r.sigma = 0; r.fixed = true;
          statsCache[r.secid] = { mu: it.fixed, sigma: 0, months: 0 };
        } else {
          r.fixed = false;
          const s = statsCache[r.secid];
          if (s) { r.mu = +(s.mu * 100).toFixed(2); r.sigma = +(s.sigma * 100).toFixed(2); }
        }
        renderMachine();
      };
      td1.appendChild(sel);

      const td2 = document.createElement('td');
      const iw = document.createElement('input');
      iw.type = 'number'; iw.className = 'num'; iw.value = r.weight; iw.min = '0'; iw.max = '100'; iw.step = '1';
      iw.oninput = () => { r.weight = Number(iw.value) || 0; updateMachineSum(); };
      td2.appendChild(iw);

      const td3 = document.createElement('td');
      td3.className = 'num';
      td3.innerHTML = '<span style="color:' + (r.mu >= 0 ? '#e5484d' : '#12a594') + '">' + (r.mu === null ? '—' : r.mu.toFixed(2) + '%') + '</span>';

      const td4 = document.createElement('td');
      td4.className = 'num';
      td4.textContent = r.sigma === null ? '—' : r.sigma.toFixed(2) + '%';

      const td5 = document.createElement('td');
      const cell = document.createElement('div');
      cell.className = 'slider-cell';
      const rg = document.createElement('input');
      rg.type = 'range'; rg.min = '-5'; rg.max = '5'; rg.step = '0.1'; rg.value = r.adj || 0;
      const b = document.createElement('b');
      b.textContent = ((r.adj || 0) >= 0 ? '+' : '') + (r.adj || 0).toFixed(1) + '%';
      rg.oninput = () => { r.adj = Number(rg.value); b.textContent = ((r.adj >= 0 ? '+' : '') + r.adj.toFixed(1) + '%'); updateMachineSum(); };
      cell.append(rg, b);
      td5.appendChild(cell);

      const td6 = document.createElement('td');
      const del = document.createElement('button');
      del.className = 'del'; del.textContent = '×';
      del.onclick = () => { machineRows = machineRows.filter(x => x.id !== r.id); renderMachine(); };
      td6.appendChild(del);

      tr.append(td1, td2, td3, td4, td5, td6);
      tb.appendChild(tr);
    });
    if (!machineRows.length) {
      tb.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#9aa5b6;padding:14px">暂无资产，点击「+ 添加资产」或「沿用回测组合」</td></tr>';
    }
    updateMachineSum();
  }

  function updateMachineSum() {
    const ws = machineRows.reduce((s, r) => s + (Number(r.weight) || 0), 0) || 1;
    const mu = machineRows.reduce((s, r) => s + (r.weight / ws) * ((r.mu || 0) + (r.adj || 0)), 0);
    const sg = machineRows.reduce((s, r) => s + (r.weight / ws) * (r.sigma || 0), 0);
    $('#cWeightSum').textContent = ws.toFixed(0) + '%';
    $('#cWeightSum').style.color = Math.abs(ws - 100) < 0.5 ? '#12a594' : '#e5484d';
    $('#cReturnAvg').textContent = '加权 ' + mu.toFixed(2) + '%';
    $('#cVolAvg').textContent = '≈ ' + sg.toFixed(2) + '%';
  }

  function addMachineRow(secid) {
    const it = flatItems().find(x => x.secid === (secid || '1.000300')) || flatItems()[0];
    const s = statsCache[it.secid];
    machineRows.push({
      id: nid(), secid: it.secid, name: it.name, weight: 0,
      mu: it.fixed !== undefined ? it.fixed : (s ? +(s.mu * 100).toFixed(2) : null),
      sigma: it.fixed !== undefined ? 0 : (s ? +(s.sigma * 100).toFixed(2) : null),
      adj: 0, fixed: it.fixed !== undefined,
    });
    const ws = machineRows.reduce((a, b) => a + b.weight, 0);
    if (ws <= 0) {
      const eq = +(100 / machineRows.length).toFixed(2);
      machineRows.forEach(r => r.weight = eq);
    }
    renderMachine();
  }

  /* 历史统计：日线 -> 月度收益 */
  function monthlyReturns(series) {
    const map = new Map();
    series.dates.forEach((d, i) => map.set(d.slice(0, 7), series.close[i]));
    const months = Array.from(map.keys()).sort();
    const rets = [];
    for (let i = 1; i < months.length; i++) {
      const a = map.get(months[i - 1]), b = map.get(months[i]);
      if (a > 0) rets.push(b / a - 1);
    }
    return { months: months.slice(1), rets, last: map.get(months[months.length - 1]) };
  }

  function pullStats() {
    const ids = Array.from(new Set(machineRows.map(r => r.secid))).filter(id => !isFixedId(id));
    if (!ids.length) { A.toast('当前均为固定利率资产，无需拉取'); return Promise.resolve(); }
    const st = $('#fcState');
    st.className = 'runstate'; st.textContent = '正在拉取历史行情…';
    A.setNet('busy', '拉取行情中…');
    const yrs = Number($('#fcSample').value) || 0;
    const start = yrs > 0 ? A.yearsAgo(yrs) : '1980-01-01';
    return A.api('batch', { secids: ids.join(','), start: A.ymdCompact(start), end: A.ymdCompact(A.today()), period: 'day' })
      .then(d => {
        const s = d.series || {};
        Object.keys(s).forEach(id => {
          if (!s[id] || s[id].close.length < 30) return;
          const mr = monthlyReturns(s[id]);
          if (mr.rets.length < 6) return;
          const growth = mr.rets.reduce((a, r) => a * (1 + r), 1);
          const years = mr.rets.length / 12;
          const mu = years > 0 ? Math.pow(growth, 1 / years) - 1 : 0;
          const sigma = A.stdev(mr.rets) * Math.sqrt(12);
          statsCache[id] = { mu: Math.min(0.6, Math.max(-0.6, mu)), sigma: Math.min(1.2, sigma), months: mr.rets.length };
          monthlyCache[id] = mr;
        });
        machineRows.forEach(r => {
          const c = statsCache[r.secid];
          if (c) { r.mu = +(c.mu * 100).toFixed(2); r.sigma = +(c.sigma * 100).toFixed(2); }
        });
        renderMachine();
        st.className = 'runstate ok';
        st.textContent = '已更新 ' + Object.keys(statsCache).length + ' 项历史统计';
        A.sourceLabel();
      })
      .catch(e => {
        st.className = 'runstate err'; st.textContent = '拉取失败：' + e.message;
        A.setNet('err', '取数失败');
      });
  }

  function isFixedId(id) { return /^(CASH|DEP1|MMF)$/.test(id); }

  /* 组合层面 μ / σ（含相关系数；固定利率资产不参与随机） */
  function portfolioStats(rows) {
    const ws = rows.reduce((s, r) => s + (Number(r.weight) || 0), 0) || 1;
    const w = rows.map(r => (r.weight || 0) / ws);
    const mu = rows.reduce((s, r, i) => s + w[i] * ((r.mu || 0) + (r.adj || 0)), 0) / 100;

    // 无风险（固定利率）部分
    const muFixed = rows.reduce((s, r, i) => isFixedId(r.secid) ? s + w[i] * ((r.mu || 0) + (r.adj || 0)) / 100 : s, 0);
    const wRisk = rows.reduce((s, r, i) => !isFixedId(r.secid) ? s + w[i] : s, 0);

    // 风险资产在其子组合内的归一化权重
    const riskIdx = rows.map((r, i) => i).filter(i => !isFixedId(rows[i].secid));
    const subW = i => (wRisk > 0 ? w[i] / wRisk : 0);

    const real = riskIdx.map(i => ({ i, id: rows[i].secid })).filter(x => monthlyCache[x.id]);
    let sigma;
    if (real.length >= 2) {
      // 共同月份
      const monthSets = real.map(x => new Set(monthlyCache[x.id].months));
      let common = Array.from(monthSets[0]);
      monthSets.forEach(ms => { common = common.filter(m => ms.has(m)); });
      if (common.length >= 12) {
        const idxMap = real.map(x => {
          const m = new Map();
          monthlyCache[x.id].months.forEach((mm, i) => m.set(mm, i));
          return m;
        });
        const k = real.length;
        const cov = [];
        for (let a = 0; a < k; a++) {
          cov.push([]);
          for (let b = 0; b < k; b++) {
            const ra = [], rb = [];
            common.forEach(mm => {
              ra.push(monthlyCache[real[a].id].rets[idxMap[a].get(mm)]);
              rb.push(monthlyCache[real[b].id].rets[idxMap[b].get(mm)]);
            });
            const ma = A.mean(ra), mb = A.mean(rb);
            let s = 0;
            for (let t = 0; t < ra.length; t++) s += (ra[t] - ma) * (rb[t] - mb);
            cov[a].push(s / (ra.length - 1) * 12);   // 年化协方差
          }
        }
        let v = 0;
        for (let a = 0; a < k; a++) {
          for (let b = 0; b < k; b++) {
            v += subW(real[a].i) * subW(real[b].i) * cov[a][b];
          }
        }
        sigma = Math.sqrt(Math.max(0, v));
      }
    }
    if (sigma === undefined) {
      // 退化为子组合内加权平均波动（忽略相关性，偏保守）
      sigma = real.reduce((s, x) => s + subW(x.i) * ((rows[x.i].sigma || 0) / 100), 0);
    }
    sigma = Math.min(1.5, Math.max(0, sigma)) * wRisk;   // 按风险仓位折算到组合层面
    const muRisk = real.length
      ? real.reduce((s, x) => s + subW(x.i) * ((rows[x.i].mu || 0) + (rows[x.i].adj || 0)) / 100, 0)
      : 0;
    return {
      mu: Math.min(0.6, Math.max(-0.6, mu)), sigma,
      muRisk: Math.min(0.6, Math.max(-0.6, muRisk)), wRisk, muFixed,
    };
  }

  /* 蒙特卡洛 */
  function simulateMachine(rows, init, years, annual, contribMode, method, paths) {
    const N = Math.max(1, Math.min(30, Math.round(years)));
    const ps = portfolioStats(rows);
    const { mu, sigma, muRisk, wRisk, muFixed } = ps;
    const sigmaRisk = wRisk > 0 ? sigma / wRisk : 0;          // 风险部分自身年化波动
    const sigmaM = sigmaRisk / Math.sqrt(12);
    const driftM = Math.log(1 + Math.max(-0.99, muRisk)) / 12;
    const fixedMonthly = muFixed / 12;                        // 无风险部分月贡献

    const rand = A.mulberry32(20261027);
    const gauss = A.gaussFactory(rand);

    // bootstrap 用联合历史月收益
    let bootMatrix = null, commonIdx = null, bootW = null;
    if (method === 'boot' || method === 'bootmix') {
      const real = rows.filter(r => !isFixedId(r.secid) && monthlyCache[r.secid]);
      if (real.length) {
        const wsum = real.reduce((s, r) => s + (Number(r.weight) || 0), 0) || 1;
        bootW = real.map(r => (r.weight || 0) / wsum);        // 子组合内归一化
        const sets = real.map(r => new Set(monthlyCache[r.secid].months));
        let common = Array.from(sets[0]);
        sets.forEach(s => { common = common.filter(m => s.has(m)); });
        if (common.length >= 12) {
          const imaps = real.map(r => {
            const m = new Map();
            monthlyCache[r.secid].months.forEach((mm, i) => m.set(mm, i));
            return m;
          });
          bootMatrix = common.map(mm => real.map((r, j) => monthlyCache[r.secid].rets[imaps[j].get(mm)]));
        }
      }
    }

    const yearly = [];   // {year, p10,p25,p50,p75,p90, invested}
    const finals = [];
    const tracks = [];
    const step = freqOf(contribMode).step;

    for (let p = 0; p < paths; p++) {
      let v = init;
      let invested = init;
      const snap = [];
      for (let y = 0; y < N; y++) {
        for (let k = 0; k < 12; k++) {
          if (k % step === 0) { v += annual; invested += annual; }   // 期初投入
          let rm;
          if (method === 'boot' && bootMatrix) {
            const row = bootMatrix[Math.floor(rand() * bootMatrix.length)];
            rm = row.reduce((s, x, j) => s + bootW[j] * x, 0);
          } else {
            rm = Math.exp(driftM - 0.5 * sigmaM * sigmaM + sigmaM * gauss()) - 1;
          }
          const rPort = wRisk * rm + fixedMonthly;
          v *= (1 + rPort);
          if (v < 0) v = 0;
        }
        snap.push({ year: y + 1, value: v, invested });
      }
      finals.push(v);
      tracks.push(snap);
    }

    for (let y = 0; y < N; y++) {
      const vals = tracks.map(t => t[y].value).sort((a, b) => a - b);
      const inv = tracks[0][y].invested;
      yearly.push({
        year: y + 1,
        invested: inv,
        p10: A.quantile(vals, 0.10),
        p25: A.quantile(vals, 0.25),
        p50: A.quantile(vals, 0.50),
        p75: A.quantile(vals, 0.75),
        p90: A.quantile(vals, 0.90),
      });
    }

    finals.sort((a, b) => a - b);
    const investedTotal = yearly.length ? yearly[yearly.length - 1].invested : init;

    return {
      yearly, finals, mu, sigma, N,
      investedTotal,
      p50: A.quantile(finals, 0.5),
      p10: A.quantile(finals, 0.1),
      p90: A.quantile(finals, 0.9),
      mean: A.mean(finals),
    };
  }

  /* 趋势外推（解析解） */
  function simulateTrend(rows, init, years, annual, contribMode) {
    const N = Math.max(1, Math.min(30, Math.round(years)));
    const { mu, sigma } = portfolioStats(rows);
    const out = [];
    const step = freqOf(contribMode).step;
    const mm = Math.pow(1 + mu, 1 / 12) - 1;
    let base = init, invested = init;
    out.push({ year: 0, value: base, invested });
    for (let y = 1; y <= N; y++) {
      for (let k = 0; k < 12; k++) {
        if (k % step === 0) { base += annual; invested += annual; }
        base *= (1 + mm);
      }
      const t = y;
      const sd = sigma * Math.sqrt(t);
      const med = base;
      const q = z => med * Math.exp(z * sd);
      out.push({
        year: y, invested,
        p10: q(-1.2816), p25: q(-0.6745), p50: med, p75: q(0.6745), p90: q(1.2816),
      });
    }
    return { yearly: out, mu, sigma, N, investedTotal: invested, p50: out[out.length - 1].p50, p10: out[out.length - 1].p10, p90: out[out.length - 1].p90, finals: [] };
  }

  /** 累计投入的构成说明：本金 + 每期金额 × 期数 */
  function contribSub(res, invested) {
    const per = res.perAmount || 0;
    if (per <= 0) return '仅起始本金';
    const times = freqOf(res.freq).times * res.N;
    return '本金 ' + A.fmtMoney(res.init) + ' + ' + times + ' 期 × ' + A.fmtMoney(per);
  }

  /** 输入区的实时提示 */
  function updateContribHint() {
    const el = $('#fcContribHint');
    if (!el) return;
    const init = Number($('#fcInit').value) || 0;
    const per = Number($('#fcAnnual').value) || 0;
    const f = freqOf($('#fcContribMode').value);
    const yrs = Math.max(0, Number($('#fcYears').value) || 0);
    if (per <= 0) { el.textContent = '不追加投入'; return; }
    const times = f.times * yrs;
    el.textContent = f.label + '投入，共 ' + times + ' 期 → 追加 ' + A.fmtMoney(per * times)
      + '，累计投入 ' + A.fmtMoney(totalContrib(init, per, $('#fcContribMode').value, yrs));
  }

  /* ---------------- 结果渲染 ---------------- */
  function renderResult(res) {
    $('#fcResultCard').hidden = false;
    const isManual = res.kind === 'manual';
    const years = res.N;
    const last = res.yearly[res.yearly.length - 1] || { value: 0, invested: 0, p50: 0 };

    const endVal = isManual ? last.value : last.p50;
    const invested = isManual ? last.invested : res.investedTotal;

    $('#fcStartEcho').textContent = A.fmtMoney(res.init);
    $('#fcYearsEcho').textContent = years + ' 年';
    $('#fcModeEcho').textContent = isManual ? '手动假设' : '机器预测 · ' + res.methodLabel;
    $('#fcEndEcho').textContent = A.fmtMoney(endVal);
    $('#fcInvestEcho').textContent = A.fmtMoney(invested);
    $('#fcGainEcho').textContent = '净收益 ' + A.fmtMoney(endVal - invested);
    $('#fcProfitEcho').textContent = '投入回报 ' + A.fmtPct(invested > 0 ? (endVal / invested - 1) * 100 : 0, 1);

    /* 主图（手动模式跳过第 0 年起点） */
    const rowsY = isManual ? res.yearly.slice(1) : res.yearly;
    const xLabels = rowsY.map(d => '第' + d.year + '年');
    if (!isManual) xLabels.unshift('起点');

    const series = [];
    if (isManual) {
      series.push({
        name: '累计投入', type: 'line', showSymbol: false,
        lineStyle: { width: 1.4, color: '#94a3b8', type: 'dashed' },
        data: rowsY.map(d => +d.invested.toFixed(0)),
      });
      if (res.opt) series.push({
        name: '乐观情景', type: 'line', showSymbol: false,
        lineStyle: { width: 1.6, color: '#e5484d' },
        areaStyle: { color: 'rgba(229,72,77,.06)' },
        data: res.opt.slice(1).map(d => +d.value.toFixed(0)),
      });
      series.push({
        name: '中性（设定值）', type: 'line', showSymbol: false,
        lineStyle: { width: 2.6, color: '#2563eb' },
        areaStyle: { color: 'rgba(37,99,235,.09)' },
        data: rowsY.map(d => +d.value.toFixed(0)),
      });
      if (res.pess) series.push({
        name: '悲观情景', type: 'line', showSymbol: false,
        lineStyle: { width: 1.6, color: '#12a594' },
        data: res.pess.slice(1).map(d => +d.value.toFixed(0)),
      });
    } else {
      const pre = (f) => [res.init].concat(res.yearly.map(f));
      series.push({
        name: '累计投入', type: 'line', showSymbol: false,
        lineStyle: { width: 1.4, color: '#94a3b8', type: 'dashed' },
        data: [res.init].concat(res.yearly.map(d => +d.invested.toFixed(0))),
      });
      series.push({
        name: 'P10（悲观）下界', type: 'line', showSymbol: false, stack: 'b90',
        lineStyle: { opacity: 0 }, areaStyle: { opacity: 0 }, silent: true,
        data: pre(d => +d.p10.toFixed(0)),
      });
      series.push({
        name: 'P10–P90 区间', type: 'line', showSymbol: false, stack: 'b90',
        lineStyle: { opacity: 0 }, areaStyle: { color: 'rgba(37,99,235,.13)' }, silent: true,
        data: [0].concat(res.yearly.map(d => +(d.p90 - d.p10).toFixed(0))),
      });
      series.push({
        name: 'P25 下界', type: 'line', showSymbol: false, stack: 'b50',
        lineStyle: { opacity: 0 }, areaStyle: { opacity: 0 }, silent: true,
        data: pre(d => +d.p25.toFixed(0)),
      });
      series.push({
        name: 'P25–P75 区间', type: 'line', showSymbol: false, stack: 'b50',
        lineStyle: { opacity: 0 }, areaStyle: { color: 'rgba(37,99,235,.22)' }, silent: true,
        data: [0].concat(res.yearly.map(d => +(d.p75 - d.p25).toFixed(0))),
      });
      series.push({
        name: '中位数 P50', type: 'line', showSymbol: false, z: 6,
        lineStyle: { width: 2.6, color: '#2563eb' },
        data: pre(d => +d.p50.toFixed(0)),
      });
    }

    A.chart('chartForecast', {
      tooltip: { trigger: 'axis', valueFormatter: v => A.fmtMoney(v) },
      legend: {
        top: 0, itemWidth: 14, itemHeight: 8, textStyle: { fontSize: 11, color: '#475569' },
        // 隐藏用于构造区间的辅助下界系列，只保留可读名称
        data: isManual
          ? ['累计投入', '乐观情景', '中性（设定值）', '悲观情景']
          : ['累计投入', 'P10–P90 区间', 'P25–P75 区间', '中位数 P50'],
      },
      grid: Object.assign({}, A.GRID, { top: 46, left: 66 }),
      xAxis: Object.assign({ type: 'category', data: xLabels, boundaryGap: false }, A.AXIS_STYLE,
        { axisLabel: { color: '#7b8798', fontSize: 11, interval: Math.max(0, Math.floor(xLabels.length / 12)) }, splitLine: { show: false } }),
      yAxis: Object.assign({ type: 'value', scale: true }, A.AXIS_STYLE,
        { axisLabel: { color: '#7b8798', fontSize: 11, formatter: v => A.fmtMoney(v, 0) } }),
      series,
    });

    /* 直方图 */
    if (!isManual && res.finals && res.finals.length) {
      const n = res.finals.length;
      const lo = res.finals[0], hi = res.finals[n - 1];
      const bins = 34, w = (hi - lo) / bins || 1;
      const cnt = new Array(bins).fill(0);
      res.finals.forEach(v => {
        let i = Math.floor((v - lo) / w);
        if (i >= bins) i = bins - 1; if (i < 0) i = 0;
        cnt[i]++;
      });
      const labels = cnt.map((_, i) => A.fmtMoney(lo + w * (i + 0.5), 0));
      const medIdx = Math.floor((res.p50 - lo) / w);
      A.chart('chartFcHist', {
        tooltip: { trigger: 'axis', formatter: p => p[0].name + '<br/>出现 ' + p[0].value + ' 次（' + (p[0].value / n * 100).toFixed(1) + '%）' },
        grid: Object.assign({}, A.GRID, { top: 14, left: 46, right: 14, bottom: 30 }),
        xAxis: Object.assign({ type: 'category', data: labels }, A.AXIS_STYLE,
          { axisLabel: { color: '#7b8798', fontSize: 9, interval: Math.floor(bins / 6) }, splitLine: { show: false } }),
        yAxis: Object.assign({ type: 'value' }, A.AXIS_STYLE, { axisLabel: { color: '#7b8798', fontSize: 10 } }),
        series: [{
          type: 'bar', barWidth: '92%',
          data: cnt.map((c, i) => ({
            value: c,
            itemStyle: { color: Math.abs(i - medIdx) <= 1 ? '#2563eb' : '#bfd3f7' },
          })),
        }],
      });
    } else {
      const el = document.getElementById('chartFcHist');
      if (el && A.chart) {
        A.chart('chartFcHist', {
          title: { text: '手动模式为确定性推演，无概率分布', left: 'center', top: 'middle', textStyle: { fontSize: 12, color: '#9aa5b6', fontWeight: 400 } },
          xAxis: { show: false }, yAxis: { show: false },
          series: [{ type: 'bar', data: [] }],
        });
      }
    }

    /* 明细表 */
    const tb = $('#tblFcDetail tbody');
    tb.innerHTML = rowsY.map(d => {
      const v = isManual ? d.value : d.p50;
      const lo = isManual ? '' : A.fmtMoney(d.p10);
      const hi = isManual ? '' : A.fmtMoney(d.p90);
      return '<tr><td>第 ' + d.year + ' 年</td><td class="num">' + A.fmtMoney(d.invested) + '</td>' +
        '<td class="num"><b>' + A.fmtMoney(v) + '</b></td>' +
        '<td class="num" style="color:#12a594">' + lo + '</td>' +
        '<td class="num" style="color:#e5484d">' + hi + '</td>' +
        '<td class="num" style="color:' + (v - d.invested >= 0 ? '#e5484d' : '#12a594') + '">' + A.fmtMoney(v - d.invested) + '</td></tr>';
    }).join('');

    /* KPI */
    const kpi = (l, v, s, c) => '<div class="kpi"><span class="kpi-label">' + l + '</span><span class="kpi-val ' + (c || '') + '">' + v + '</span><span class="kpi-sub">' + (s || '') + '</span></div>';
    let html = '';
    const lossProb = (!isManual && res.finals.length)
      ? res.finals.filter(v => v < invested).length / res.finals.length * 100 : null;
    if (isManual) {
      const mOpt = res.opt ? res.opt[res.opt.length - 1].value : endVal;
      const mPess = res.pess ? res.pess[res.pess.length - 1].value : endVal;
      html += kpi('中性期末', A.fmtMoney(endVal), '年化 ' + res.annualized.toFixed(2) + '%');
      html += kpi('乐观期末', A.fmtMoney(mOpt), '年化 ' + (res.annualized * 1.3).toFixed(2) + '%');
      html += kpi('悲观期末', A.fmtMoney(mPess), '年化 ' + (res.annualized * 0.7).toFixed(2) + '%');
      html += kpi('累计投入', A.fmtMoney(invested), contribSub(res, invested));
      html += kpi('净收益', A.fmtMoney(endVal - invested), '', endVal - invested >= 0 ? '' : 'danger');
      html += kpi('投入回报率', A.fmtPct(invested > 0 ? (endVal / invested - 1) * 100 : 0, 1), '倍数 ' + (invested > 0 ? (endVal / invested).toFixed(2) : '—') + '×');
    } else {
      const target = Number($('#fcTarget').value) || 0;
      const prob = m => res.finals.length ? res.finals.filter(v => v >= m).length / res.finals.length * 100 : 0;
      html += kpi('期末中位 P50', A.fmtMoney(res.p50), '年化 μ ' + (res.mu * 100).toFixed(2) + '%');
      html += kpi('悲观 P10', A.fmtMoney(res.p10), '10% 概率低于此', 'danger');
      html += kpi('乐观 P90', A.fmtMoney(res.p90), '10% 概率高于此');
      html += kpi('波动率 σ', A.fmtNum(res.sigma * 100, 1) + '%', '组合年化波动');
      html += kpi('累计投入', A.fmtMoney(invested), contribSub(res, invested));
      html += kpi(target > 0 ? '达成 ' + A.fmtMoney(target) : '亏损概率',
        target > 0 ? prob(target).toFixed(1) + '%' : (lossProb === null ? '—' : lossProb.toFixed(1) + '%'),
        target > 0 ? '基于 ' + res.finals.length + ' 条路径' : '终值低于累计投入');
      if (target > 0 && lossProb !== null) {
        html += kpi('亏损概率', lossProb.toFixed(1) + '%', '终值低于累计投入', lossProb > 30 ? 'danger' : '');
      }
    }
    $('#fcKpis').innerHTML = html;
  }

  /* ---------------- 运行 ---------------- */
  function run() {
    const init = Number($('#fcInit').value) || 0;
    const years = Number($('#fcYears').value) || 1;
    const annual = Number($('#fcAnnual').value) || 0;
    const contribMode = $('#fcContribMode').value;

    if (mode === 'manual') {
      if (!manualRows.length) { A.toast('请先添加至少一个资产'); return; }
      const N = Math.max(1, Math.min(500, Math.round(years)));
      const base = projectManual(manualRows, init, N, annual, contribMode, 0);
      const opt = projectManual(manualRows, init, N, annual, contribMode, +0.3);
      const pess = projectManual(manualRows, init, N, annual, contribMode, -0.3);
      const ws = manualRows.reduce((s, r) => s + (Number(r.weight) || 0), 0) || 1;
      const annRet = manualRows.reduce((s, r) => s + (r.weight / ws) * r.ret, 0);
      const res = {
        kind: 'manual', N, init, yearly: base, opt, pess, annualized: annRet,
        perAmount: annual, freq: contribMode,
      };
      lastSim = res;
      renderResult(res);
      $('#mOpt').textContent = A.fmtMoney(opt[opt.length - 1].value);
      $('#mBase').textContent = A.fmtMoney(base[base.length - 1].value);
      $('#mPess').textContent = A.fmtMoney(pess[pess.length - 1].value);
      $('#fcNote').textContent = '确定性推演 · ' + N + ' 年 · 组合年化 ' + annRet.toFixed(2) + '%';
      A.toast('预测完成');
    } else {
      if (!machineRows.length) { A.toast('请先添加至少一个资产'); return; }
      const need = machineRows.some(r => !isFixedId(r.secid) && (r.mu === null || monthlyCache[r.secid] === undefined));
      const go = () => {
        const method = $('#fcMethod').value;
        const paths = Number($('#fcPaths').value) || 2000;
        const N = Math.max(1, Math.min(30, Math.round(years)));
        let res;
        if (method === 'trend') {
          res = simulateTrend(machineRows, init, N, annual, contribMode);
          res.finals = [];
        } else {
          res = simulateMachine(machineRows, init, N, annual, contribMode, method, paths);
        }
        res.kind = 'machine'; res.init = init;
        res.perAmount = annual; res.freq = contribMode;
        res.methodLabel = method === 'gbm' ? '蒙特卡洛 GBM' : method === 'boot' ? '历史自助抽样' : '趋势外推';
        lastSim = res;
        renderResult(res);
        $('#fcNote').textContent = res.methodLabel + ' · ' + N + ' 年 · μ=' + (res.mu * 100).toFixed(2) + '% σ=' + (res.sigma * 100).toFixed(2) + '%';
        A.toast('预测完成');
      };
      if (need) {
        $('#fcState').className = 'runstate'; $('#fcState').textContent = '先拉取历史统计…';
        pullStats().then(go);
      } else go();
    }
  }

  /* ---------------- 外部接口 ---------------- */
  function setInitial(v) {
    $('#fcInit').value = Math.round(v);
    $('#fcStartEcho').textContent = A.fmtMoney(v);
  }

  function adopt(btResult) {
    const basketIds = (window.Backtest ? Backtest.getBasket() : []).map(x => x.secid);
    let rows;
    if (btResult && btResult.details) {
      rows = btResult.details.filter(d => basketIds.indexOf(d.secid) >= 0)
        .map(d => ({ secid: d.secid, name: d.name, weight: d.weight, cagr: d.cagr }));
    }
    if (!rows || !rows.length) {
      rows = (window.Backtest ? Backtest.getBasket() : []).map(x => ({ secid: x.secid, name: x.name, weight: x.weight, cagr: 0.06 }));
    }
    if (!rows.length) { A.toast('暂无可用组合'); return; }
    // 手动：默认年化用回测年化
    manualRows = rows.map(r => ({
      id: nid(), name: r.name, secid: r.secid, weight: r.weight,
      ret: +(Math.max(-15, Math.min(25, r.cagr * 100))).toFixed(1),
    }));
    machineRows = rows.map(r => ({ id: nid(), name: r.name, secid: r.secid, weight: r.weight, mu: null, sigma: null, adj: 0, fixed: isFixedId(r.secid) }));
    renderManual(); renderMachine();
    pullStats();
  }

  function adoptBasket() {
    const b = window.Backtest ? Backtest.getBasket() : [];
    if (!b.length) { A.toast('回测组合为空'); return; }
    adopt({ details: b.map(x => ({ secid: x.secid, name: x.name, weight: x.weight, cagr: 0.06 })) });
  }

  /* ---------------- 绑定 ---------------- */
  function bind() {
    $$('#fcMode .seg').forEach(s => {
      s.onclick = () => {
        $$('#fcMode .seg').forEach(x => x.classList.remove('active'));
        s.classList.add('active');
        mode = s.dataset.mode;
        $('#pane-manual').classList.toggle('active', mode === 'manual');
        $('#pane-machine').classList.toggle('active', mode === 'machine');
        const yi = $('#fcYears');
        if (mode === 'manual') { yi.removeAttribute('max'); yi.setAttribute('title', '可填任意年数'); }
        else { yi.setAttribute('max', '30'); if (Number(yi.value) > 30) yi.value = 30; }
        $('#fcYearsFld').querySelector('span').textContent = mode === 'manual' ? '预测年数（不限）' : '预测年数（≤30）';
      };
    });

    $('#btnRunForecast').onclick = run;
    ['#fcInit', '#fcAnnual', '#fcContribMode', '#fcYears'].forEach(sel => {
      const el = $(sel);
      if (el) el.addEventListener('input', updateContribHint);
      if (el) el.addEventListener('change', updateContribHint);
    });
    updateContribHint();
    $('#btnUseNetAsset').onclick = () => {
      const v = window.NetWorth ? NetWorth.totals().net : 0;
      if (v <= 0) { A.toast('净资产为 0，请先在「资产负债」录入'); return; }
      setInitial(v); A.toast('已使用净资产 ' + A.fmtMoney(v));
    };
    $('#btnManualAdd').onclick = () => addManualRow();
    $('#btnMachineAdd').onclick = () => addMachineRow();
    $('#btnManualFromBasket').onclick = adoptBasket;
    $('#btnMachineFromBasket').onclick = adoptBasket;
    $('#btnPullStats').onclick = () => pullStats();

    const presets = {
      '#btnPresetConservative': [['沪深300', 20], ['十年国债ETF', 55], ['黄金ETF（人民币计价）', 10], ['现金 / 活期', 15]],
      '#btnPresetBalanced': [['沪深300', 35], ['标普500', 20], ['恒生科技指数', 10], ['黄金ETF（人民币计价）', 10], ['十年国债ETF', 25]],
      '#btnPresetAggressive': [['中证A500', 25], ['创业板指', 20], ['纳斯达克100', 25], ['恒生科技指数', 15], ['黄金ETF（人民币计价）', 10], ['中证红利', 5]],
    };
    Object.keys(presets).forEach(k => {
      const el = $(k);
      if (!el) return;
      el.onclick = () => {
        manualRows = presets[k].map(x => {
          const it = findByName(x[0]);
          return { id: nid(), name: x[0], secid: it ? it.secid : '', weight: x[1], ret: defaultRet(x[0]) };
        });
        renderManual();
        A.toast('已套用预设');
      };
    });
  }

  function defaultRet(name) {
    const M = {
      '沪深300': 7, '中证A500': 7.5, '创业板指': 9, '科创50': 9, '中证红利': 8,
      '标普500': 9, '纳斯达克100': 11, '恒生科技指数': 8, '恒生指数': 5,
      '黄金ETF（人民币计价）': 6, '十年国债ETF': 3, '现金 / 活期': 0.3,
      '定期存款 / 大额存单': 2, '货币基金 / 理财': 1.8,
    };
    return M[name] !== undefined ? M[name] : 6;
  }

  function init() {
    bind();
    // 手动模式年数不设上限
    $('#fcYears').removeAttribute('max');
    $('#fcYearsFld').querySelector('span').textContent = '预测年数（不限）';
    loadCatalog().then(() => {
      renderManual();
      if (!machineRows.length) {
        addMachineRow('1.000300');
        addMachineRow('100.SPX');
        addMachineRow('1.518880');
        addMachineRow('1.511260');
      }
      renderMachine();
    });
    $('#fcStartEcho').textContent = A.fmtMoney($('#fcInit').value);
  }

  return { init, setInitial, adopt, adoptBasket, getLast: () => lastSim };
})();
