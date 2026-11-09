# -*- coding: utf-8 -*-
"""选「不定投」时把定投金额真正归零，并确保计算链路各处都不计入。

预测侧的根因：FREQ.none 的 step=9999，但 `k % step === 0` 在 k=0 时
恒成立，所以每年仍会投一笔。必须显式判断 none。
"""
# ---------- 回测 ----------
p = 'static/js/backtest.js'
s = open(p, encoding='utf-8').read()

old = """      a.disabled = off;
      a.classList.toggle('disabled-input', off);"""
new = """      a.disabled = off;
      a.classList.toggle('disabled-input', off);
      if (off) a.value = '0';        // 不定投：金额归零，避免仍被计入"""
assert old in s, 'backtest syncDca 未匹配'
s = s.replace(old, new, 1)

old2 = "dcaAmt: Number($('#btDcaAmt').value) || 0,"
new2 = "dcaAmt: $('#btDcaFreq').value === 'none' ? 0 : (Number($('#btDcaAmt').value) || 0),"
assert old2 in s, 'backtest dcaAmt 未匹配'
s = s.replace(old2, new2, 1)
open(p, 'w', encoding='utf-8').write(s)
print('backtest.js: 不定投金额归零 + 读取时强制为 0')

# ---------- 预测 ----------
p2 = 'static/js/forecast.js'
t = open(p2, encoding='utf-8').read()

old3 = """      a.disabled = off;
      a.classList.toggle('disabled-input', off);"""
new3 = """      a.disabled = off;
      a.classList.toggle('disabled-input', off);
      if (off) a.value = '0';        // 不定投：金额归零"""
assert old3 in t, 'forecast syncFc 未匹配'
t = t.replace(old3, new3, 1)

repl = [
    ("if (k % step === 0) { v += perAmount; invested += perAmount; }",
     "if (freq !== 'none' && k % step === 0) { v += perAmount; invested += perAmount; }"),
    ("if (k % step === 0) { v += annual; invested += annual; }   // 期初投入",
     "if (contribMode !== 'none' && k % step === 0) { v += annual; invested += annual; }   // 期初投入"),
    ("if (k % step === 0) { base += annual; invested += annual; }",
     "if (contribMode !== 'none' && k % step === 0) { base += annual; invested += annual; }"),
    ("const annual = Number($('#fcAnnual').value) || 0;",
     "const annual = $('#fcContribMode').value === 'none' ? 0 : (Number($('#fcAnnual').value) || 0);"),
    ("const per = Number($('#fcAnnual').value) || 0;",
     "const per = $('#fcContribMode').value === 'none' ? 0 : (Number($('#fcAnnual').value) || 0);"),
]
for a, b in repl:
    assert a in t, 'forecast 片段未匹配: ' + a[:48]
    t = t.replace(a, b, 1)

open(p2, 'w', encoding='utf-8').write(t)
print('forecast.js: 修复 k%step 在 k=0 恒成立导致的误投；金额归零；读取时强制为 0')
