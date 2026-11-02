# -*- coding: utf-8 -*-
"""本轮两处改动：
1) forecast.js：投入频率支持「不定投」，选中时把每次投入金额置灰
2) server.py：模拟 K 线防归零——长序列随机游走的累积乘积会把早期价格推到接近 0
"""

# ---- 1) forecast.js ----
p = 'static/js/forecast.js'
s = open(p, encoding='utf-8').read()

OLD_FREQ = """  const FREQ = {
    month: { times: 12, step: 1, label: '每月' },
    quarter: { times: 4, step: 3, label: '每季' },
    year: { times: 1, step: 12, label: '每年' },
  };"""
NEW_FREQ = """  const FREQ = {
    none: { times: 0, step: 9999, label: '不定投' },
    month: { times: 12, step: 1, label: '每月' },
    quarter: { times: 4, step: 3, label: '每季' },
    year: { times: 1, step: 12, label: '每年' },
  };"""
assert OLD_FREQ in s, 'FREQ 未匹配'
s = s.replace(OLD_FREQ, NEW_FREQ)

OLD_BIND = "  function bind() {"
NEW_BIND = """  function bind() {
    // 选择「不定投」时把每次投入金额置灰
    const syncFc = () => {
      const f = $('#fcContribMode'), a = $('#fcAnnual'), hint = $('#fcContribHint');
      if (!f || !a) return;
      const off = f.value === 'none';
      a.disabled = off;
      a.classList.toggle('disabled-input', off);
      if (hint) hint.textContent = off ? '当前：不定投，仅起始本金参与预测' : '';
    };
    if ($('#fcContribMode')) { $('#fcContribMode').onchange = syncFc; syncFc(); }
"""
assert OLD_BIND in s, 'bind 未匹配'
s = s.replace(OLD_BIND, NEW_BIND, 1)
open(p, 'w', encoding='utf-8').write(s)
print('forecast.js: 已支持不定投并联动置灰')

# ---- 2) server.py ----
p2 = 'server.py'
t = open(p2, encoding='utf-8').read()

OLD_SYNTH = """    q = [0.0] * len(idx)
    q[-1] = float(real["close"][0])
    for i in range(len(idx) - 1, 0, -1):
        r = rng.gauss(mu_d, sd_d)
        q[i - 1] = q[i] / max(0.5, 1.0 + r)"""

NEW_SYNTH = """    q = [0.0] * len(idx)
    q[-1] = float(real["close"][0])
    for i in range(len(idx) - 1, 0, -1):
        r = rng.gauss(mu_d, sd_d)
        # 单日收益裁剪到 ±25%：长序列若不裁剪，几百上千步的累积乘积会把
        # 早期价格推到接近 0，界面上就表现为「模拟资产直接归零」。
        r = max(-0.25, min(0.25, r))
        q[i - 1] = q[i] / (1.0 + r)
    # 兜底：绝不允许出现 0 或负值，否则后面算份额、净值时会除零
    floor = q[-1] * 0.05
    for i in range(len(q)):
        if not (q[i] > 0) or q[i] < floor:
            q[i] = floor"""

assert OLD_SYNTH in t, 'backfill_with_synth 未匹配'
t = t.replace(OLD_SYNTH, NEW_SYNTH)
open(p2, 'w', encoding='utf-8').write(t)
print('server.py: 模拟 K 线已加防归零保护')
