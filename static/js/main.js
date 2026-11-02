/* 应用入口：路由 + 初始化 */
(function () {
  'use strict';
  const A = window.AM;
  const { $, $$ } = A;

  function switchTab(name) {
    $$('#mainTabs .tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    $$('.page').forEach(p => p.classList.toggle('active', p.id === 'page-' + name));
    setTimeout(A.resizeCharts, 60);
    try { location.hash = name; } catch (e) {}
  }

  function bindTabs() {
    $$('#mainTabs .tab').forEach(t => {
      t.onclick = () => switchTab(t.dataset.tab);
    });
    const h = (location.hash || '').replace('#', '');
    if (['worth', 'backtest', 'forecast'].indexOf(h) >= 0) switchTab(h);
  }

  document.addEventListener('DOMContentLoaded', async () => {
    A.load();
    bindTabs();
    // 先备好离线快照：后端不可用（静态打开 / 服务未启动）时自动降级，功能不残缺
    await A.loadSnapshot();
    // 逐个 try：任一模块自己出错，不该连带把其余板块全部拖挂
    [['资产现状', NetWorth], ['现金流', Cashflow], ['历史回测', Backtest], ['未来预测', Forecast]]
      .forEach(function (pair) {
        try { pair[1].init(); }
        catch (e) { console.error('[' + pair[0] + '] 初始化失败:', e); }
      });
    A.probeSource();
  });
})();
