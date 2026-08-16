// 仅生产环境注册 Service Worker：dev 模式（localhost）跳过——
// SW 会缓存旧版本模块导致白屏/"模块不提供导出"（见根目录
// ServiceWorker与Vite缓存排查.md）。生产构建仍保留 PWA 离线缓存能力。
// 独立为外部文件：CSP script-src 'self' 不依赖 'unsafe-inline'。
if (
  "serviceWorker" in navigator &&
  location.hostname !== "localhost" &&
  !location.hostname.startsWith("127.")
) {
  navigator.serviceWorker.register("/sw.js");
}
