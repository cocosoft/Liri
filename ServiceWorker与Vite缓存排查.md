# Service Worker 与 Vite 缓存问题排查

> 记录时间：2026-08-13
> 来源：sessionSlice 日志增强后浏览器实测（http://localhost:1420）发现——应用**白屏**且控制台报"模块不提供导出"，根因指向本地缓存层（Service Worker + Vite 模块图），非业务代码缺陷。

---

## 1. 问题现象

| 场景 | 现象 |
|------|------|
| 首次打开应用 | 白屏，`#root` 为空；控制台报错：`SyntaxError: The requested module '/src/utils/format.ts' does not provide an export named 'formatRelativeTime'` |
| 强制刷新（Ctrl+F5） | 报错变为：`SyntaxError: The requested module '/src/stores/chat/chat-toolcall.slice.ts' does not provide an export named 'reorderExplorationBlocks'`，白屏持续 |
| 注销 Service Worker 后 | 应用正常加载，会话操作（切换/新建/删除）无报错 |
| 再次刷新页面 | 白屏复现，报错回到"缺导出" |

关键矛盾点：**磁盘代码确实有对应导出**（已用 Read 确认），但浏览器拿到的模块没有——即浏览器加载的是**缓存的旧版本模块**。

---

## 2. 根因分析

### 2.1 Service Worker 缓存旧模块（主因）

[client/index.html](file:///e:/PY/Documents/CODES/PY_APP/client/index.html#L16-L18) 内联脚本**无条件注册**了 Service Worker：

```html
<script>
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js");
  }
</script>
```

- `/sw.js` 位于 `client/public/`，由 SW 脚本缓存静态资源与模块。
- 开发模式下 Vite 按需转换模块（`/src/xxx.ts`），SW 拦截请求并返回**首次缓存时的旧版本模块**——即使磁盘文件已更新。
- 结果：新增/修改的导出（如 `formatRelativeTime`、`reorderExplorationBlocks`）在浏览器侧不可见 → `SyntaxError: does not provide an export`。
- 每次注册的 SW 都会接管页面（`navigator.serviceWorker.controller` 非空），即使代码已修复，旧 SW 仍持续返回旧缓存。

### 2.2 Vite dev server 模块图缓存陈旧（次因）

- Vite dev server 维护模块图（module graph）；批量/高频修改文件时（尤其 Windows 下 watcher 事件可能丢失），模块图仍引用旧版本。
- 表现：磁盘有导出、`?import` 直接请求模块也正常，但页面加载走 dev server 模块图时仍报"缺导出"。

---

## 3. 解决方案

### 3.1 Service Worker

#### 方案 A（推荐）：开发模式跳过 SW 注册

修改 [client/index.html](file:///e:/PY/Documents/CODES/PY_APP/client/index.html#L16-L18)：

```html
<script>
  // 开发模式跳过 SW 注册，避免 SW 缓存旧模块导致白屏/缺导出；
  // 生产构建（vite build）仍保留 PWA 离线缓存能力
  if ("serviceWorker" in navigator && !import.meta.env.DEV) {
    navigator.serviceWorker.register("/sw.js");
  }
</script>
```

> 注意：`index.html` 内联脚本默认不支持 `import.meta.env`（非模块脚本）。若不能使用 `import.meta.env`，改用环境判断：

```html
<script>
  // 仅生产环境注册；localhost 开发模式跳过（vite dev server 默认 hostname 为 localhost）
  if ("serviceWorker" in navigator && location.hostname !== "localhost") {
    navigator.serviceWorker.register("/sw.js");
  }
</script>
```

#### 方案 B：立即恢复（不修改代码，适用于当前 dev 会话）

在浏览器 DevTools → Application → Service Workers：
1. 点击 **Unregister** 注销当前 SW；
2. 勾选 **Bypass for network**（跳过 SW 走网络）；
3. 刷新页面。

或直接在控制台执行一次性注销脚本：

```js
navigator.serviceWorker.getRegistrations().then((rs) =>
  rs.forEach((r) => r.unregister()),
);
// 清理 SW 持有的旧缓存
caches.keys().then((keys) => keys.forEach((k) => caches.delete(k)));
```

#### 方案 C：彻底移除（若 SW 已是早期 PWA 尝试残留）

- 删除 [index.html](file:///e:/PY/Documents/CODES/PY_APP/client/index.html#L16-L18) 的注册脚本；
- 删除/停用 `client/public/sw.js`；
- 生产端如有 PWA 需求，改用 `vite-plugin-pwa` 统一管理（而非手写 SW）。

### 3.2 Vite 缓存

#### 方式一：重启 dev server（推荐）

```powershell
# 停掉当前 vite dev server（Ctrl+C）后重新启动
cd e:\PY\Documents\CODES\PY_APP\client
bun run dev
```

#### 方式二：强制清缓存启动

```powershell
bun run dev --force   # vite --force：强制重新预构建依赖，清除模块图缓存
```

#### 方式三：手动删除 Vite 缓存目录

```powershell
# 删除 vite 预构建缓存后重启
Remove-Item -Recurse -Force .\node_modules\.vite -ErrorAction SilentlyContinue
bun run dev
```

---

## 4. 排查步骤（复现与验证）

```text
1. 复现：打开 http://localhost:1420 → 白屏，控制台报"模块不提供导出"
2. 确认是 SW 缓存：DevTools → Application → Service Workers →
   Unregister + 勾选 Bypass for network → 刷新 → 页面恢复
   （恢复即证明主因是 SW 旧缓存）
3. 确认磁盘代码正确：Vite 下直接请求模块 ?import
   http://localhost:1420/src/stores/chat/chat-toolcall.slice.ts?import
   → 返回内容包含报错中"缺失"的导出，即磁盘代码无问题
4. 确认 Vite 模块图陈旧：注销 SW 后仍报"缺导出" → 重启 dev server
   （bun run dev --force）→ 刷新恢复
5. 验证修复：按 3.1 方案 A 修改后，重启 dev server，
   连续刷新 3 次无白屏、控制台无缺导出报错 → 修复完成
```

---

## 5. 涉及文件

| 文件 | 说明 |
|------|------|
| [client/index.html](file:///e:/PY/Documents/CODES/PY_APP/client/index.html#L16-L18) | SW 注册入口（无条件注册 → 改为生产环境注册） |
| `client/public/sw.js` | SW 缓存策略实现（评估是否仍需要） |
| `client/node_modules/.vite/` | Vite 预构建缓存（删除后强制重建） |
| [client/vite.config.ts](file:///e:/PY/Documents/CODES/PY_APP/client/vite.config.ts#L30-L37) | dev server 配置（port 1420） |

---

## 6. 注意事项

- 上述问题**不是业务代码 bug**（磁盘代码导出正确，验证代理与 typecheck 均通过），属本地开发缓存层问题。
- 涉及会话系统的新增日志（`loadChatSessions:` / `switchChatSession:` / `deleteChatSession:` 等）在注销 SW 后可正常观察。
- 生产构建（`vite build`）不受 Vite dev 模块图问题影响；SW 缓存问题在生产环境属于预期行为（PWA 离线缓存），只需确保 SW 版本策略正确（如版本化缓存名、`skipWaiting`）。
