/* 访问守卫：未登录直接跳登录页。
 * 有后端时服务端会校验 Cookie（真正的安全边界）；
 * 静态部署（无后端）时依赖登录页写入的本地会话标记。
 */
(function () {
  'use strict';
  var SESSION_KEY = 'am_auth';
  var COOKIE = 'am_session';

  function hasCookie(name) {
    return document.cookie.split(';').some(function (c) {
      return c.trim().indexOf(name + '=') === 0;
    });
  }

  function authed() {
    try { if (sessionStorage.getItem(SESSION_KEY) === '1') return true; } catch (e) {}
    try { if (localStorage.getItem(SESSION_KEY) === '1') return true; } catch (e) {}
    return hasCookie(COOKIE);
  }

  if (!authed()) {
    location.replace('login.html');
    return;
  }

  window.Auth = {
    logout: function () {
      try { sessionStorage.removeItem(SESSION_KEY); } catch (e) {}
      try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
      try { fetch('api/logout', { method: 'POST' }); } catch (e) {}
      // 清掉后端 Cookie
      document.cookie = COOKIE + '=; Max-Age=0; path=/';
      location.replace('login.html');
    }
  };
})();
