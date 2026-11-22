# -*- coding: utf-8 -*-
"""未来预测本金改造的界面部分：表头、只读总本金、合计行、样式。"""
# ---------- index.html ----------
p = 'static/index.html'
h = open(p, encoding='utf-8').read()

old_m_head = '<thead><tr><th>资产</th><th style="width:14%">权重 %</th><th style="width:34%">预期年化涨幅 %</th><th style="width:16%">区间示例</th><th style="width:44px"></th></tr></thead>'
new_m_head = '<thead><tr><th>资产</th><th style="width:17%">起始本金 ¥</th><th style="width:13%">权重 %<span class="fc-auto-tag">自动</span></th><th style="width:29%">预期年化涨幅 %</th><th style="width:15%">区间示例</th><th style="width:44px"></th></tr></thead>'
assert old_m_head in h, '手动表头未匹配'
h = h.replace(old_m_head, new_m_head, 1)

old_m_foot = '<tfoot><tr><td>合计</td><td class="num" id="mWeightSum">0%</td><td class="num" id="mReturnAvg">—</td><td colspan="2"></td></tr></tfoot>'
new_m_foot = '<tfoot><tr><td>合计</td><td class="num" id="mCapitalSum">¥0</td><td class="num" id="mWeightSum">0%</td><td class="num" id="mReturnAvg">—</td><td colspan="2"></td></tr></tfoot>'
assert old_m_foot in h, '手动表尾未匹配'
h = h.replace(old_m_foot, new_m_foot, 1)

old_c_head = '<thead><tr><th>资产</th><th style="width:12%">权重 %</th><th style="width:16%">年化收益 μ</th><th style="width:14%">波动率 σ</th><th style="width:16%">手动微调 μ(%)</th><th style="width:44px"></th></tr></thead>'
new_c_head = '<thead><tr><th>资产</th><th style="width:15%">起始本金 ¥</th><th style="width:12%">权重 %<span class="fc-auto-tag">自动</span></th><th style="width:14%">年化收益 μ</th><th style="width:12%">波动率 σ</th><th style="width:15%">手动微调 μ(%)</th><th style="width:44px"></th></tr></thead>'
assert old_c_head in h, '机器表头未匹配'
h = h.replace(old_c_head, new_c_head, 1)

old_c_foot = '<tfoot><tr><td>合计</td><td class="num" id="cWeightSum">0%</td><td class="num" id="cReturnAvg">—</td><td class="num" id="cVolAvg">—</td><td colspan="2"></td></tr></tfoot>'
new_c_foot = '<tfoot><tr><td>合计</td><td class="num" id="cCapitalSum">¥0</td><td class="num" id="cWeightSum">0%</td><td class="num" id="cReturnAvg">—</td><td class="num" id="cVolAvg">—</td><td colspan="2"></td></tr></tfoot>'
assert old_c_foot in h, '机器表尾未匹配'
h = h.replace(old_c_foot, new_c_foot, 1)

old_init = '<label class="fld"><span>起始本金 (¥)</span><input type="number" id="fcInit" value="100000" step="10000" min="0" /></label>'
new_init = ('<label class="fld"><span>起始本金 (¥) <em class="fc-auto-tag">自动合计</em></span>'
            '<input type="text" id="fcInit" value="100000" readonly '
            'title="由下方各项资产的起始本金自动合计，无需手填" /></label>')
assert old_init in h, 'fcInit 未匹配'
h = h.replace(old_init, new_init, 1)
open(p, 'w', encoding='utf-8').write(h)
print('index.html: 本金列 / 只读总本金 / 合计行 已更新')

# ---------- forecast.js：合计行补上本金总额 ----------
p2 = 'static/js/forecast.js'
s = open(p2, encoding='utf-8').read()
a = "  function updateManualSum() {\n"
assert a in s
s = s.replace(a, a + "    const mCap = $('#mCapitalSum');\n    if (mCap) mCap.textContent = A.fmtMoney(manualRows.reduce((t, r) => t + (Number(r.capital) || 0), 0));\n", 1)
b = "  function updateMachineSum() {\n"
assert b in s
s = s.replace(b, b + "    const cCap = $('#cCapitalSum');\n    if (cCap) cCap.textContent = A.fmtMoney(machineRows.reduce((t, r) => t + (Number(r.capital) || 0), 0));\n", 1)
open(p2, 'w', encoding='utf-8').write(s)
print('forecast.js: 合计行本金总额已更新')

# ---------- CSS ----------
p3 = 'static/css/app.css'
c = open(p3, encoding='utf-8').read()
add = '''

/* ---------- 未来预测：本金录入 / 权重自动 ---------- */
#tblManual input, #tblMachine input{width:100%;padding:5px 7px;font-size:13px;
  border:1px solid var(--line-strong);border-radius:6px;background:#fff;color:var(--ink)}
#tblManual input.num, #tblMachine input.num{text-align:right;font-variant-numeric:tabular-nums}
#tblManual input:focus, #tblMachine input:focus{outline:none;border-color:var(--brand);
  box-shadow:0 0 0 2px var(--brand-soft)}
.fc-capital{font-weight:600}
.fc-wauto{background:#f1f4f9!important;color:#64748b;cursor:default;border-style:dashed}
.fc-wauto:focus{box-shadow:none!important;border-color:var(--line-strong)!important}
.fc-auto-tag{font-size:10px;font-weight:400;color:var(--muted);margin-left:4px;font-style:normal}
#fcInit[readonly]{background:#f1f4f9;color:#64748b;cursor:default;font-weight:700}
'''
if '.fc-wauto{' not in c:
    open(p3, 'w', encoding='utf-8').write(c + add)
    print('app.css: 样式已追加')
