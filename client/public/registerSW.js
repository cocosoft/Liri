// 仅**浏览器部署**注册 Service Worker；桌面端（Tauri）必须跳过。
//
// 2026-11-22（真机实测，v0.1.0 / v0.1.1 两次复现）：原实现只排除 `localhost` / `127.*`，
// 而 Tauri 生产环境的 host 是 `tauri.localhost` ⇒ 未被排除 ⇒ 桌面端也注册了 `sw.js`。
// `sw.js` 对同源静态资源是 **cache-first**，升级后仍返回旧版 `index.html` / JS chunk，
// 与新区块不匹配 ⇒ 白屏，界面只剩 SW 的兜底响应体 `offline`。
// 故本地/桌面环境一律**不注册**，并幂等注销历史残留（Rust 侧另按版本清理 Service Worker 目录，
// 用于打断"旧页面被缓存 ⇒ 新脚本根本没机会执行"的死锁）。
//
// 独立为外部文件：CSP script-src 'self' 不依赖 'unsafe-inline'。
(function () {
  if (!("serviceWorker" in navigator)) return;

  var host = location.hostname;
  var isLocalHost =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "[::1]" ||
    host === "::1" ||
    host.slice(-10) === ".localhost"; // 含 tauri.localhost

  if (isLocalHost || location.protocol === "tauri:") {
    // 幂等清理：若历史版本注册过 SW，这里注销并清空其缓存
    navigator.serviceWorker
      .getRegistrations()
      .then(function (regs) {
        regs.forEach(function (r) {
          r.unregister();
        });
      })
      .catch(function () {});
    if (window.caches && caches.keys) {
      caches
        .keys()
        .then(function (keys) {
          keys.forEach(function (k) {
            caches.delete(k);
          });
        })
        .catch(function () {});
    }
    return;
  }

  navigator.serviceWorker.register("/sw.js");
})();
