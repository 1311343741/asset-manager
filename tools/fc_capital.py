# -*- coding: utf-8 -*-
"""未来预测：改为「逐项填写起始本金 → 权重与总本金自动计算」。"""
p = 'static/js/forecast.js'
s = open(p, encoding='utf-8').read()

# 1) 辅助函数
anchor = '  function renderManual() {'
helper = '''  /* 本金输入框：可手动键入、无上下调节按钮。
     输入过程中只更新数据并重算，不回写自身 value，避免光标被打断。 */
  function moneyCell(r, after) {
    const i = document.createElement('input');
    i.type = 'text'; i.inputMode = 'decimal'; i.className = 'num fc-capital';
    i.value = (Number(r.capital) || 0) ? String(r.capital) : '';
    i.placeholder = '本金';
    const parse = v => {
      const t = String(v == null ? '' : v).replace(/[,，\\s¥￥]/g, '');
      if (!/^\\d*\\.?\\d*$/.test(t) || t === '' || t === '.') return null;
      const n = parseFloat(t);
      return isFinite(n) ? n : null;
    };
    i.oninput = () => {
      const v = parse(i.value);
      r.capital = v === null ? 0 : v;
      after();
    };
    i.onblur = () => { i.value = String(Number(r.capital) || 0); };
    return i;
  }

  // 顶部总本金 = 当前模式各项本金之和（只读，机器计算）
  function syncInitFromRows() {
    const list = (mode === 'manual') ? manualRows : machineRows;
    const total = list.reduce((s, r) => s + (Number(r.capital) || 0), 0);
    const el = $('#fcInit');
    if (el) el.value = Math.round(total);
    const echo = $('#fcStartEcho');
    if (echo) echo.textContent = A.fmtMoney(total);
    return total;
  }

  // 权重 = 该项本金 / 总本金，机器计算，输入框只读
  function recalcWeights() {
    [['Manual', manualRows], ['Machine', machineRows]].forEach(function (pair) {
      const suffix = pair[0], list = pair[1];
      const total = list.reduce((s, r) => s + (Number(r.capital) || 0), 0);
      list.forEach(r => {
        r.weight = total > 0 ? (Number(r.capital) || 0) / total * 100 : 0;
        const el = document.querySelector('#tbl' + suffix + ' [data-fc-w="' + r.id + '"]');
        if (el) el.value = total > 0 ? r.weight.toFixed(2) + '%' : '—';
      });
    });
    syncInitFromRows();
    updateManualSum();
    updateMachineSum();
  }

'''
assert anchor in s, 'renderManual 未匹配'
s = s.replace(anchor, helper + anchor, 1)

NEW_CELLS = """      const tdCap = document.createElement('td');
      tdCap.appendChild(moneyCell(r, recalcWeights));

      const td2 = document.createElement('td');
      const iw = document.createElement('input');
      iw.type = 'text'; iw.className = 'num fc-wauto'; iw.readOnly = true;
      iw.setAttribute('data-fc-w', r.id);
      iw.value = (Number(r.weight) || 0).toFixed(2) + '%';
      iw.title = '权重由各项起始本金自动计算，无需手填';
      td2.appendChild(iw);"""

OLD_TPL = """      const td2 = document.createElement('td');
      const iw = document.createElement('input');
      iw.type = 'number'; iw.className = 'num'; iw.value = r.weight; iw.min = '0'; iw.max = '100'; iw.step = '1';
      iw.oninput = () => { r.weight = Number(iw.value) || 0; %s };
      td2.appendChild(iw);"""

# 2) 手动表
old_manual = OLD_TPL % 'updateManualSum();'
assert old_manual in s, '手动权重单元格未匹配'
s = s.replace(old_manual, NEW_CELLS, 1)
s = s.replace('      tr.append(td1, td2, td3, td4, td5);',
              '      tr.append(td1, tdCap, td2, td3, td4, td5);', 1)

# 3) 机器表（注意空态列数先改 6->7，再改手动的 5->6，避免互相误伤）
old_machine = OLD_TPL % 'updateMachineSum();'
assert old_machine in s, '机器权重单元格未匹配'
s = s.replace(old_machine, NEW_CELLS, 1)
s = s.replace('      tr.append(td1, td2, td3, td4, td5, td6);',
              '      tr.append(td1, tdCap, td2, td3, td4, td5, td6);', 1)
s = s.replace('colspan="6" style="text-align:center;color:#9aa5b6;padding:14px">暂无资产',
              'colspan="7" style="text-align:center;color:#9aa5b6;padding:14px">暂无资产', 1)
s = s.replace('colspan="5" style="text-align:center;color:#9aa5b6;padding:14px">暂无资产',
              'colspan="6" style="text-align:center;color:#9aa5b6;padding:14px">暂无资产', 1)

# 4) 渲染后统一重算（renderManual/renderMachine 末尾）
a = '    updateManualSum();\n  }\n\n  function updateManualSum()'
assert a in s, 'renderManual 末尾未匹配'
s = s.replace(a, '    recalcWeights();\n  }\n\n  function updateManualSum()', 1)
b = '    updateMachineSum();\n  }\n\n  function updateMachineSum()'
assert b in s, 'renderMachine 末尾未匹配'
s = s.replace(b, '    recalcWeights();\n  }\n\n  function updateMachineSum()', 1)

# 5) 新增行默认本金；去掉手填权重的平均分配
s = s.replace("manualRows.push(Object.assign({ id: nid(), name: '', secid: '', weight: 0, ret: 5 }, data || {}));\n    if (manualRows.length === 1) manualRows[0].weight = 100;",
              "manualRows.push(Object.assign({ id: nid(), name: '', secid: '', weight: 0, capital: 10000, ret: 5 }, data || {}));", 1)
s = s.replace("      id: nid(), secid: it.secid, name: it.name, weight: 0,",
              "      id: nid(), secid: it.secid, name: it.name, weight: 0, capital: 10000,", 1)
old_avg = """    const ws = machineRows.reduce((a, b) => a + b.weight, 0);
    if (ws <= 0) {
      const eq = +(100 / machineRows.length).toFixed(2);
      machineRows.forEach(r => r.weight = eq);
    }
    renderMachine();"""
assert old_avg in s, '平均权重块未匹配'
s = s.replace(old_avg, '    renderMachine();', 1)

# 6) setInitial：净资产按本金比例分摊回各项
old_si = """  function setInitial(v) {
    $('#fcInit').value = Math.round(v);
    $('#fcStartEcho').textContent = A.fmtMoney(v);
  }"""
new_si = """  function setInitial(v) {
    // 起始本金由各项资产本金合计而来，带入净资产需分摊到每一行
    const list = (mode === 'manual') ? manualRows : machineRows;
    if (!list.length) {
      addManualRow({ name: '我的资产', capital: Math.round(v), ret: 6 });
    } else {
      const total = list.reduce((s, r) => s + (Number(r.capital) || 0), 0);
      if (total > 0) {
        list.forEach(r => { r.capital = Math.round((Number(r.capital) || 0) / total * v); });
      } else {
        const each = Math.round(v / list.length);
        list.forEach(r => { r.capital = each; });
      }
    }
    renderManual(); renderMachine();
    A.toast('已按各资产本金比例分摊 ' + A.fmtMoney(v));
  }"""
assert old_si in s, 'setInitial 未匹配'
s = s.replace(old_si, new_si, 1)

# 7) 沿用回测组合 / 预设：由权重反推本金
old_adopt = """    manualRows = rows.map(r => ({
      id: nid(), name: r.name, secid: r.secid, weight: r.weight,
      ret: +(Math.max(-15, Math.min(25, r.cagr * 100))).toFixed(1),
    }));
    machineRows = rows.map(r => ({ id: nid(), name: r.name, secid: r.secid, weight: r.weight, mu: null, sigma: null, adj: 0, fixed: isFixedId(r.secid) }));"""
new_adopt = """    const base = Number($('#fcInit').value) || 100000;
    manualRows = rows.map(r => ({
      id: nid(), name: r.name, secid: r.secid, weight: r.weight,
      capital: Math.round(base * r.weight / 100),
      ret: +(Math.max(-15, Math.min(25, r.cagr * 100))).toFixed(1),
    }));
    machineRows = rows.map(r => ({ id: nid(), name: r.name, secid: r.secid, weight: r.weight, capital: Math.round(base * r.weight / 100), mu: null, sigma: null, adj: 0, fixed: isFixedId(r.secid) }));"""
assert old_adopt in s, 'adopt 未匹配'
s = s.replace(old_adopt, new_adopt, 1)

old_pre = "          return { id: nid(), name: x[0], secid: it ? it.secid : '', weight: x[1], ret: defaultRet(x[0]) };"
new_pre = "          return { id: nid(), name: x[0], secid: it ? it.secid : '', weight: x[1], capital: Math.round((Number($('#fcInit').value) || 100000) * x[1] / 100), ret: defaultRet(x[0]) };"
assert old_pre in s, '预设未匹配'
s = s.replace(old_pre, new_pre, 1)

# 8) 切模式刷新顶部本金；默认 4 行各 25000（合计 10 万）
s = s.replace("        mode = s.dataset.mode;", "        mode = s.dataset.mode;\n        syncInitFromRows();", 1)
s = s.replace("        addMachineRow('1.511260');\n      }",
              "        addMachineRow('1.511260');\n        machineRows.forEach(r => { r.capital = 25000; });   // 默认合计 10 万\n      }", 1)

open(p, 'w', encoding='utf-8').write(s)
print('forecast.js: 本金录入 + 权重/总额自动计算 已完成')
