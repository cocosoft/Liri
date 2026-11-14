# 全局悬浮窗（G8 一期）

> 立项：2026-11-14（方案 `dev_docs/20261113/建议落地方案-20261114.md` §2 · G8）
> 一期口径：**Tauri 2 既有能力**实现的置顶小窗（后台操作状态）；**不做**系统级全局快捷键（二期，需新依赖）。

## 1. 取证（2026-11-14）

| 事实 | 证据 |
|---|---|
| Tauri 2.11，且 `tray-icon` 已启用（托盘已实现） | `client/src-tauri/Cargo.toml:20`；`client/src-tauri/src/lib.rs`（`TrayIconBuilder` + 菜单） |
| 前端 Tauri API 已在依赖内 | `client/package.json`：`@tauri-apps/api ~2.11.0` ⇒ `WebviewWindow` 可直接用，**零新增依赖** |
| 当前只有主窗口 | `client/src-tauri/tauri.conf.json` `app.windows` 仅 1 个；capabilities 仅 `default.json`（`windows: ["main"]`） |
| 全局快捷键插件**未安装** | `Cargo.toml` 无 `tauri-plugin-global-shortcut`；`package.json` 无对应 npm 包 ⇒ 系统级快捷键属新增外部依赖 |
| 可复用的状态源 | `useOperationProgressStore`（SSE 驱动、`_init` 幂等）+ `OperationStatusBar`（全局后台操作进度） |
| 主界面用 `BrowserRouter` | `client/src/main.tsx` ⇒ 副窗口**不**挂 Router，改用查询参数入口 |

## 2. 一期交付

| 件 | 内容 |
|---|---|
| `client/src/lib/floatingWindow.ts` 🆕 | `isFloatingEntry(search)` / `isTauriRuntime()` / `openFloatingWindow()`（已存在 ⇒ `show+setFocus`）/ `closeFloatingWindow()` / `focusMainWindow()`；**非 Tauri 环境一律安全 no-op**（便于 Web 预览与单测） |
| `client/src/components/Floating/FloatingPanel.tsx` 🆕 | 悬浮面板：拖拽区（`data-tauri-drag-region`）+ 关闭；内容复用 `OperationStatusBar`（空 ⇒ 提示文案）；底部「回到主窗口」 |
| `client/src/main.tsx` | `?floating=1` 入口只渲染 `FloatingPanel`（不挂 Router/App） |
| `client/src/hooks/useKeyboard.ts` | `Ctrl+Shift+F` 打开/聚焦悬浮窗（主窗口内快捷键；**非**系统级） |
| `client/src-tauri/capabilities/{default,floating}.json` | 主窗口加 `core:webview:allow-create-webview-window` / `allow-show` / `allow-set-focus`；新增 `floating` capability：只给自身 `show/hide/close/set-focus/start-dragging` |
| i18n `zh|en misc.ts` | `floating.title / empty / close / backToMain` |
| `client/src/tests/floating-{window,panel}.*` 🆕 | 7 条（入口解析 / 非 Tauri no-op / 空态 / 复用状态条 / 两个动作接线） |

窗口参数：`360×220`、`alwaysOnTop`、`decorations: false`、`resizable`、`skipTaskbar`、`center`。

## 3. 边界（如实）

| 项 | 口径 |
|---|---|
| 触发方式 | 主窗口内 `Ctrl+Shift+F`（**应用内**快捷键）；系统级全局快捷键 = 二期 |
| 内容 | 只读 `useOperationProgressStore`（后台操作进度）；不新建状态源、不做轮询 |
| 窗口能力 | 最小权限集（新增独立 `floating` capability）；主窗口只多一个「创建窗口」+ 显示/聚焦 |
| 未验证项 | **未真机运行**：`cargo build` / 桌面启动未执行（本轮只做前端 typecheck + vitest + 配置静态核对）⇒ 首次真机需确认窗口创建、拖拽与权限是否如预期 |
| 不做 | 系统托盘菜单项（Rust 改动，本轮不做）、悬浮窗位置记忆、多显示器定位、透明度/毛玻璃 |

## 4. 验收

| 验收项 | 判据 |
|---|---|
| 入口解析 | `?floating=1` / `?floating` / `?x=1&floating=true` ⇒ true；空 / 无关参数 ⇒ false（1 条用例） |
| 无 Tauri 安全 | `openFloatingWindow() === 'unsupported'`；关闭/聚焦不抛错（2 条） |
| 面板空态 | 无操作 ⇒ 显示"暂无进行中的操作。"（1 条） |
| 复用单一来源 | 有操作 ⇒ 显示 `OperationStatusBar` 的标签，空态消失（1 条） |
| 动作接线 | 关闭 ⇒ `closeFloatingWindow`；回到主窗口 ⇒ `focusMainWindow`（1 条） |
| 静态校验 | `tsc --noEmit` 绿；`eslint` 0 error |

## 5. 二期前置（未做，如实登记）

1. **系统级全局快捷键**：需 `tauri-plugin-global-shortcut`（Rust crate + npm 包）+ 快捷键冲突处理与用户可配置；
2. **托盘菜单开关**：`lib.rs` 的 `create_tray_menu` 增加「悬浮窗」项（Rust 改动，需真机验证）；
3. **内容增强**：当前会话 / 运行中目标（需在副窗口拉取会话与目标数据，或走 SSE 同步）；
4. **窗口体验**：位置记忆、多显示器、置顶层级、点击穿透（不遮挡主窗口交互）。

## 6. 二期已交付（托盘菜单项）

| 件 | 内容 |
|---|---|
| `client/src-tauri/src/lib.rs` | 托盘菜单新增「悬浮窗」项（`show` / `hide` 之后）；菜单事件**只转发意图**：`main.eval("window.dispatchEvent(new CustomEvent('liri:toggle-floating'))")` —— 窗口构建仍由 JS 的 `openFloatingWindow` **单点实现**（不在 Rust 侧再写一份，避免双轨） |
| `client/src/App.tsx` | 监听 `liri:toggle-floating` ⇒ `openFloatingWindow()`（已存在则 `show+setFocus`） |

### 仍未做（如实）

1. **系统级全局快捷键**：需 `tauri-plugin-global-shortcut`（Rust crate + npm 包）**新增外部依赖**，本批未引入；当前触发仍是应用内 `Ctrl+Shift+F` 与托盘菜单。（**已由 §7 三期补齐**）
2. **Rust 未编译验证**：本机无 `cargo`（不在 PATH）⇒ 只做了源码级改动与前端 typecheck/lint；首次 `tauri build` / CI 构建需确认菜单项与 `eval` 调用可编译。
3. 内容增强（当前会话 / 运行中目标）与窗口体验（位置记忆 / 多显示器 / 点击穿透）未做。

## 7. 三期已交付（系统级全局快捷键）

把触发面从「应用内 + 托盘」扩到**系统级**：应用未聚焦（最小化 / 在托盘）时 `Ctrl+Shift+F` 仍可唤起悬浮窗。

| 件 | 内容 |
|---|---|
| `client/src-tauri/Cargo.toml` | ➕ `tauri-plugin-global-shortcut = "2"`（官方 Tauri 2 插件；**唯一新增外部依赖**） |
| `client/src-tauri/src/lib.rs` | ➕ `floating_shortcut()`（`Ctrl+Shift+F`，与主窗口内一致）；➕ `dispatch_toggle_floating()`（托盘菜单与全局快捷键**共用**，仍只 `eval` 派发 `liri:toggle-floating`）；插件在 `Builder` 上注册 handler（仅 `ShortcutState::Pressed`）；`setup` 内 `global_shortcut().register(...)`，**失败只 `warn`**（被其他应用占用也不阻断启动） |
| `client/src/lib/floatingWindow.ts` | 文档口径更新（二期已接；窗口创建仍单点在本文件） |

**边界（如实）**：
- **无新增 capability**：注册走 Rust API，不经 JS 插件命令 ⇒ `capabilities/*.json` 权限不扩；
- **快捷键不可配置**：固定 `Ctrl+Shift+F`；与主窗口内快捷键**同键**，同时触发两次也只等价于「新建 → 聚焦」（`openFloatingWindow` 幂等）；
- **Rust 未编译验证**：本机无 `cargo` ⇒ 仅源码级改动 + 前端 `tsc`/`eslint`/`vitest`（139 文件 / 966 用例）全绿；**`Cargo.lock` 未在本机重生成**（首次 `cargo build` / `tauri build` 自动补全）；
- 仍**不做**：快捷键用户可配置、内容增强（当前会话 / 运行中目标）、窗口体验（位置记忆 / 多显示器 / 点击穿透）。
