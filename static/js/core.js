/* 资产管家 · 基础工具层 */
window.AM = (function () {
  'use strict';

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  const PALETTE = ['#2563eb', '#e5484d', '#12a594', '#f5a524', '#8b5cf6', '#0ea5e9',
    '#ec4899', '#84cc16', '#f97316', '#14b8a6', '#6366f1', '#a855f7'];

  /* ---------- 数字格式化 ---------- */
  function fmtMoney(v, dec) {
    const n = Number(v) || 0;
    const neg = n < 0;
    const a = Math.abs(n);
    let s, unit = '';
    if (a >= 1e8) { s = a / 1e8; unit = '亿'; }
    else if (a >= 1e4) { s = a / 1e4; unit = '万'; }
    else { s = a; unit = ''; }
    const d = dec === undefined ? (s >= 1000 ? 0 : s >= 100 ? 1 : 2) : dec;
    let out = s.toFixed(d);
    if (dec === undefined && out.indexOf('.') >= 0) out = out.replace(/0+$/, '').replace(/\.$/, '');
    return (neg ? '-¥' : '¥') + out + unit;
  }
  function fmtFull(v) {
    const n = Number(v) || 0;
    return (n < 0 ? '-' : '') + '¥' + Math.abs(n).toLocaleString('zh-CN', { maximumFractionDigits: 0 });
  }
  function fmtPct(v, dec) {
    const n = Number(v) || 0;
    return (n > 0 ? '+' : '') + n.toFixed(dec === undefined ? 2 : dec) + '%';
  }
  function fmtNum(v, dec) {
    return (Number(v) || 0).toFixed(dec === undefined ? 2 : dec);
  }

  /* ---------- 存储 ---------- */
  const KEY = 'am.state.v1';
  const state = {
    assets: [],
    debts: [],
    basket: [],      // 回测/预测共用：{secid,name,weight}
    btParams: null,
    fcParams: null,
  };

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return;
      const o = JSON.parse(raw);
      Object.keys(state).forEach(k => { if (o[k] !== undefined) state[k] = o[k]; });
    } catch (e) { console.warn('load fail', e); }
  }
  let _saveTimer = null;
  function save() {
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => {
      try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
    }, 200);
  }

  /* ---------- 提示 ---------- */
  let _toastTimer = null;
  function toast(msg) {
    const el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }

  function setNet(status, text) {
    const dot = $('#netDot'), note = $('#netNote');
    if (dot) dot.className = 'dot' + (status === 'err' ? ' err' : status === 'busy' ? ' busy' : '');
    if (note && text) note.textContent = text;
  }

  /* ---------- 站点根路径（用于定位离线快照） ---------- */
  const BASE_URL = (function () {
    try {
      const s = document.currentScript && document.currentScript.src;
      if (s) return s.slice(0, s.lastIndexOf('/') + 1).replace(/\/js\/$/, '/');
    } catch (e) {}
    return '';
  })();

  /* ---------- API：后端不可用时自动回退到离线快照 ---------- */
  let snapshot = null;
  let snapshotLoading = null;
  let dataMode = 'live';          // live | snapshot

  function loadSnapshot() {
    if (snapshot) return Promise.resolve(snapshot);
    if (snapshotLoading) return snapshotLoading;
    snapshotLoading = fetch(BASE_URL + 'data/snapshot.json')
      .then(r => { if (!r.ok) throw new Error('no snapshot'); return r.json(); })
      .then(d => { snapshot = d; return d; })
      .catch(() => { snapshot = null; snapshotLoading = null; return null; });
    return snapshotLoading;
  }

  const SNAP_EPOCH = new Date(2000, 0, 1).getTime();
  function dayToDate(n) {
    return ymd(new Date(SNAP_EPOCH + n * 86400000));
  }

  /** 解压快照中的单条序列 */
  function snapSeries(secid) {
    if (!snapshot || !snapshot.series) return null;
    const s = snapshot.series[secid];
    if (!s) return null;
    const dates = [dayToDate(s.d0)];
    let cur = s.d0;
    for (let i = 0; i < s.days.length; i++) { cur += s.days[i]; dates.push(dayToDate(cur)); }
    return { secid: secid, name: s.name, dates: dates, close: s.close.slice() };
  }

  /** 降采样（快照只存日线） */
  function downsample(series, period) {
    if (!period || period === 'day') return series;
    const dates = [], close = [];
    let lastKey = null;
    for (let i = 0; i < series.dates.length; i++) {
      const d = series.dates[i];
      const key = period === 'month' ? d.slice(0, 7) : weekKey(d);
      if (key !== lastKey) {
        dates.push(d); close.push(series.close[i]); lastKey = key;
      } else {
        dates[dates.length - 1] = d; close[close.length - 1] = series.close[i];
      }
    }
    return { secid: series.secid, name: series.name, dates: dates, close: close };
  }

  function weekKey(d) {
    return String(Math.floor(new Date(d).getTime() / (7 * 86400000)));
  }

  function cut(series, start, end) {
    if (!start && !end) return series;
    const dates = [], close = [];
    for (let i = 0; i < series.dates.length; i++) {
      const d = series.dates[i];
      if (start && d < start) continue;
      if (end && d > end) continue;
      dates.push(d); close.push(series.close[i]);
    }
    return { secid: series.secid, name: series.name, dates: dates, close: close };
  }

  function norm(d) {
    if (!d) return null;
    d = String(d).trim();
    return d.length === 8 && /^\d+$/.test(d) ? d.slice(0, 4) + '-' + d.slice(4, 6) + '-' + d.slice(6) : d;
  }

  /** 离线快照版接口；返回 undefined 表示该接口没有离线实现 */
  function localApi(path, params) {
    params = params || {};
    if (path === 'catalog') {
      return { catalog: (snapshot && snapshot.catalog) || [] };
    }
    if (path === 'kline') {
      const s = snapSeries(params.secid);
      if (!s) return undefined;
      const c = cut(downsample(s, params.period), norm(params.start), norm(params.end));
      return { secid: params.secid, name: s.name, dates: c.dates, close: c.close, full: s.dates.length };
    }
    if (path === 'batch') {
      const ids = String(params.secids || '').split(',').filter(Boolean);
      const series = {}, errors = {};
      ids.forEach(id => {
        const s = snapSeries(id);
        if (!s) { errors[id] = '离线快照中无此标的'; return; }
        const c = cut(downsample(s, params.period), norm(params.start), norm(params.end));
        series[id] = { name: s.name, dates: c.dates, close: c.close, full: s.dates.length };
      });
      return { series: series, errors: errors };
    }
    if (path === 'search') {
      const q = String(params.q || '').trim();
      if (!q || !snapshot || !snapshot.catalog) return { results: [] };
      const out = [];
      snapshot.catalog.forEach(g => g.items.forEach(it => {
        if (it.name.indexOf(q) >= 0 || it.secid.indexOf(q) >= 0) {
          out.push({ secid: it.secid, name: it.name, code: it.secid.split('.')[1], type: g.group });
        }
      }));
      return { results: out.slice(0, 12) };
    }
    return undefined;
  }

  async function api(path, params, opts) {
    opts = opts || {};
    if (!opts.snapshotOnly) {
      try {
        const qs = params ? '?' + new URLSearchParams(params).toString() : '';
        const r = await fetch('/api/' + path + qs);
        if (r.ok) {
          const j = await r.json();
          dataMode = 'live';
          return j;
        }
      } catch (e) { /* 后端不可用，走离线 */ }
    }
    const local = localApi(path, params);
    if (local !== undefined) {
      dataMode = 'snapshot';
      return local;
    }
    throw new Error('行情服务不可用，且本地无对应数据');
  }

  function apiPost(path, body) {
    return fetch('/api/' + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    }).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }

  /** 按当前数据来源刷新顶栏（各模块取数成功后调用，避免写死“实时”） */
  function sourceLabel() {
    if (dataMode === 'live') {
      setNet('ok', '行情源：东方财富 · 实时');
    } else if (snapshot && snapshot.series) {
      setNet('busy', '离线快照 · 截至 ' + String(snapshot.generated_at || '').slice(0, 10));
    } else {
      setNet('err', '行情不可用');
    }
  }

  /** 探测数据来源并更新顶栏 */
  async function probeSource() {
    try {
      const r = await fetch('/api/health');
      if (r.ok) {
        dataMode = 'live';
        sourceLabel();
        return 'live';
      }
    } catch (e) { /* ignore */ }
    const s = await loadSnapshot();
    if (s && s.series && Object.keys(s.series).length) {
      dataMode = 'snapshot';
      sourceLabel();
      return 'snapshot';
    }
    if (location.protocol === 'file:') {
      setNet('err', '请用「启动资产管家.bat」打开');
      toast('双击 index.html 会被浏览器安全策略拦截，请运行启动脚本后访问 http://127.0.0.1:8765');
    } else {
      setNet('err', '行情不可用');
    }
    return 'none';
  }

  /* ---------- 统计 ---------- */
  function mean(a) {
    if (!a.length) return 0;
    let s = 0; for (let i = 0; i < a.length; i++) s += a[i];
    return s / a.length;
  }
  function stdev(a) {
    if (a.length < 2) return 0;
    const m = mean(a);
    let s = 0; for (let i = 0; i < a.length; i++) s += (a[i] - m) * (a[i] - m);
    return Math.sqrt(s / (a.length - 1));
  }
  function quantile(sorted, q) {
    if (!sorted.length) return 0;
    const pos = (sorted.length - 1) * q;
    const lo = Math.floor(pos), hi = Math.ceil(pos);
    if (lo === hi) return sorted[lo];
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }
  /** 收盘价 -> 简单收益率序列 */
  function toReturns(close) {
    const r = [];
    for (let i = 1; i < close.length; i++) {
      if (close[i - 1] > 0) r.push(close[i] / close[i - 1] - 1);
    }
    return r;
  }
  /** 最大回撤（输入净值序列） */
  function maxDrawdown(nav) {
    let peak = nav[0] || 1, mdd = 0, peakIdx = 0, troughIdx = 0, curPeakIdx = 0;
    for (let i = 0; i < nav.length; i++) {
      if (nav[i] > peak) { peak = nav[i]; curPeakIdx = i; }
      const dd = nav[i] / peak - 1;
      if (dd < mdd) { mdd = dd; peakIdx = curPeakIdx; troughIdx = i; }
    }
    return { mdd, peakIdx, troughIdx };
  }
  /** 年化（CAGR） */
  function cagr(totalReturn, years) {
    if (years <= 0) return 0;
    return Math.pow(Math.max(1e-12, 1 + totalReturn), 1 / years) - 1;
  }

  /* ---------- 随机数（可复现） ---------- */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  /** Box-Muller 标准正态 */
  function gaussFactory(rand) {
    let spare = null;
    return function () {
      if (spare !== null) { const v = spare; spare = null; return v; }
      let u = 0, v = 0, s = 0;
      do {
        u = rand() * 2 - 1; v = rand() * 2 - 1; s = u * u + v * v;
      } while (s === 0 || s >= 1);
      const m = Math.sqrt(-2 * Math.log(s) / s);
      spare = v * m;
      return u * m;
    };
  }

  /* ---------- ECharts ---------- */
  const charts = {};
  function chart(id, option, opts) {
    const el = document.getElementById(id);
    if (!el) return null;
    if (!charts[id]) charts[id] = echarts.init(el, null, { renderer: 'canvas' });
    charts[id].setOption(option, true);
    return charts[id];
  }
  function resizeCharts() {
    Object.values(charts).forEach(c => { try { c.resize(); } catch (e) {} });
  }
  window.addEventListener('resize', () => {
    clearTimeout(window.__rz);
    window.__rz = setTimeout(resizeCharts, 160);
  });

  const GRID = { left: 56, right: 22, top: 34, bottom: 34 };
  const AXIS_STYLE = {
    axisLine: { lineStyle: { color: '#dfe4ee' } },
    axisLabel: { color: '#7b8798', fontSize: 11 },
    splitLine: { lineStyle: { color: '#f0f3f8' } },
  };

  /* ---------- 日期 ---------- */
  function ymd(d) {
    const p = n => (n < 10 ? '0' : '') + n;
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function ymdCompact(s) { return (s || '').replace(/-/g, ''); }
  function yearsAgo(n) {
    const d = new Date(); d.setFullYear(d.getFullYear() - n);
    return ymd(d);
  }
  function today() { return ymd(new Date()); }

  return {
    $, $$, PALETTE, fmtMoney, fmtFull, fmtPct, fmtNum,
    state, load, save, toast, setNet, api, apiPost,
    loadSnapshot, probeSource, sourceLabel, getDataMode: () => dataMode,
    mean, stdev, quantile, toReturns, maxDrawdown, cagr,
    mulberry32, gaussFactory, chart, resizeCharts, GRID, AXIS_STYLE,
    ymd, ymdCompact, yearsAgo, today,
  };
})();
