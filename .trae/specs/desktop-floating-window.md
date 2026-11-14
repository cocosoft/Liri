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
- 仍**不做**：快捷键用户可配置、内容增强（当前会话 / 运行中目标）、点击穿透（位置记忆与多显示器校正**已由 §8 补齐**）。

## 8. 四期已交付（窗口体验：几何记忆 + 多显示器边界校正）

| 件 | 内容 |
|---|---|
| `client/src/lib/floatingGeometry.ts` 🆕 | 纯函数 `parseFloatingGeometry` / `serializeFloatingGeometry`（取整）/ `clampToMonitors` / `isRectVisible` + `loadFloatingGeometry` / `saveFloatingGeometry`（`localStorage`，键 `liri-floating-geometry`）；坐标统一为**逻辑像素** |
| `client/src/lib/floatingWindow.ts` | `openFloatingWindow` 新建前恢复**上次几何**并夹进可见显示器（无历史 ⇒ 维持"默认尺寸 + 居中"）；🆕 `initFloatingWindowGeometry()`：在悬浮窗自身内挂载时校正一次 + `onMoved`/`onResized` 防抖 300ms 写回 |
| `client/src/components/Floating/FloatingPanel.tsx` | 挂载即 `initFloatingWindowGeometry()`（非悬浮窗/非 Tauri ⇒ no-op） |
| `capabilities/default.json` / `floating.json` | ➕ `core:window:allow-available-monitors`（主窗口创建前取显示器）/ `allow-outer-position` `allow-inner-size` `allow-scale-factor` `allow-set-position`（悬浮窗自身读几何与自校正）—— **仍为最小权限**，未加拖拽/穿透类新能力 |
| `client/src/tests/floating-geometry.test.ts` 🆕 | 11 条：解析容错（空/坏 JSON/缺字段/非正尺寸）/ 序列化往返 / 屏内原样 / 部分越界夹到最小可见 / 上边界拉回 / 尺寸超屏收缩 / 副屏保持 / 全屏外居中兜底 / 无显示器原样 / `isRectVisible` 交集语义 + 无信息不误判 |

**边界校正规则（确定性）**：
- 与任何显示器**都无交集**（拔掉副屏）⇒ 居中到**第一个**显示器，避免只剩一条缝；
- 否则目标屏 = 中心点所在 > 重叠最大 > 第一个；尺寸不超过目标屏；
- 位置保证**水平至少 48px 可见** + **标题栏不高于屏幕上边界**（拖拽区始终可达）。

**边界（如实）**：
- **未真机验证**：本机无 `cargo`、无窗口自动化 ⇒ 只做了 `tsc` + `eslint` + 977 条 vitest（含 11 条几何用例）；`availableMonitors` / `onMoved` 等 Tauri 调用未在真实桌面跑过；
- **跨 DPI 混合缩放未验证**：按各显示器 `scaleFactor` 换算逻辑像素，缩放大跨度（100%/200% 混排）需真机校准；
- **点击穿透已由 §10 交付**（进入点按钮、退出复用 `Ctrl+Shift+F`）；
- **内容增强已由 §9 补齐**（当前会话 + 运行中目标）。

## 9. 五期已交付（内容增强：当前会话 + 运行中目标）

悬浮窗是**独立 webview**，拿不到主窗口内存 store ⇒ 数据全部走**既有单一来源**（不新建状态源）：

| 件 | 内容 |
|---|---|
| `client/src/lib/floatingContext.ts` 🆕 | 纯函数 `readPersistedCurrentSessionId`（读根 store 持久化快照的 `state.currentSessionId`）/ `pickSessionTitle`（只在**同一 id** 命中时取标题，否则 `null`）/ `buildFloatingContext`（目标归一：去空白、预算缺省 `null`）+ IO 入口 `loadFloatingContext`（`sessionService.list()` + `goalService.list({ activeOnly: true })`；失败 ⇒ `unavailable`，**不伪装成"没有目标"**） |
| `client/src/components/Floating/useFloatingContext.ts` 🆕 | 刷新时机 = **挂载 + 窗口聚焦 + 手动**；**不做后台轮询**（副窗口不常驻定时器） |
| `client/src/components/Floating/FloatingPanel.tsx` | 头部下新增「当前会话」+「运行中目标」区块（目标显示 `已用/预算 tokens`），并带「刷新」按钮 |
| `client/src/constants/storage.ts` / `stores/root-store/index.ts` | persist 键上收 `STORAGE_KEYS.rootStore`（主窗口写入端与悬浮窗读取端**同源**，防改名漂移） |
| i18n `zh/en misc.ts` | `floating.*` ➕ 9 项（当前会话 / 未选择 / 未命名 / 目标 / 无目标 / 不可用 / 刷新 / tokens） |
| `client/src/tests/floating-context.test.ts` 🆕 + `floating-panel.test.tsx` | 5 条纯函数用例（快照容错 / 标题命中 / 无会话不回落 / 目标归一 / unavailable 透传）+ 4 条面板用例（会话与目标渲染 / 空态 / 不可用态 / 手动刷新） |

**边界（如实）**：
- **未真机验证**：`sessionService.list()` / `goalService.list()` 在副窗口内的真实调用未跑（测试用 mock），后端不可达时界面显示"暂时读不到"；
- **会话标题来自列表 API**：`chatSessions` 不持久化 ⇒ 必须请求 `/v1/sessions`（悬浮窗打开时一次，聚焦/手动时再取）；
- **只展示会话级目标**（`task_goals`）：PDCA `/goal` 的 `goal_metrics` 按 `goalService` 既有边界**不混放**；
- **不轮询**：主窗口切换会话后，悬浮窗需**重新聚焦或点刷新**才同步（有意为之，避免副窗口常驻定时器）。

## 10. 六期已交付（点击穿透）

穿透态下窗口**不接收鼠标事件**（点击落到下层应用），因此关键在**退出路径不能依赖点击该窗口**。

| 件 | 内容 |
|---|---|
| `client/src/lib/floatingWindow.ts` | 🆕 `setFloatingPassthrough(enabled)`（`setIgnoreCursorEvents`；非 Tauri / 窗口不存在 / 平台不支持 ⇒ **如实返回 `false`**）；`openFloatingWindow` 对已存在窗口**先关闭穿透**再 show+focus ⇒ 复用既有 `Ctrl+Shift+F` / 托盘「悬浮窗」作为**退出路径** |
| `client/src/components/Floating/FloatingPanel.tsx` | 头部新增「穿透」按钮；成功后显示**退出提示横幅**（`点击穿透中 · 按 Ctrl+Shift+F 退出`）、按钮置灰；失败显示「当前环境不支持点击穿透」；收到 `focus` 即复位本地状态（外部已关闭穿透，避免残留横幅） |
| `capabilities/default.json` / `floating.json` | ➕ `core:window:allow-set-ignore-cursor-events`（主窗口退出穿透 / 悬浮窗自身进入穿透） |
| i18n `zh/en misc.ts` | ➕ 4 项（穿透 / 提示 / 穿透中 / 不支持） |
| `client/src/tests/floating-window.test.ts` / `floating-panel.test.tsx` | ➕ 1 条（非 Tauri 返回 false）+ 2 条（成功显示横幅并禁用按钮 / 失败如实提示且按钮仍可用） |

**UX 取舍（为什么这样设计）**：
- **进入**靠点面板按钮（此刻窗口仍可点）；
- **退出**靠 `Ctrl+Shift+F`（系统级 + 应用内，已存在）或托盘「悬浮窗」—— 二者都走 `openFloatingWindow`，其中已内置"关闭穿透"；
- **瞬态、不持久化**：关闭/重开窗口一定是可点击的，避免"下次打开无法操作"。

**边界（如实）**：
- **未真机验证**：`setIgnoreCursorEvents` 的平台差异（macOS/Windows/Linux）未实测；不可用时界面如实提示，不会静默假装成功；
- **穿透期间无法拖动/关闭/看操作细节**（鼠标事件不进入该窗口）⇒ 必须先退出穿透；
- **不新增全局快捷键**：退出复用既有 `Ctrl+Shift+F`，避免再占一个系统级组合键。

## 11. 真机验证记录（2026-11-14：本机被系统策略阻断）

**结论：本机无法完成 GUI 真机验证**（不是代码问题，是 Windows 安全策略阻止编译）。

| 项 | 结果 |
|---|---|
| MSVC Build Tools | ✅ 已存在（VS 2022 BuildTools + `VC.Tools.x86.x64`） |
| Rust 工具链 | ✅ 已安装：rustup 1.29.3 + `stable-x86_64-pc-windows-msvc` 1.100.0（默认工具链已设） |
| 安装注意 | `rustup-init` 默认下载路径在本机**停滞**（0 字节进度）⇒ 必须 `RUSTUP_USE_CURL=1` 才成功；`--no-modify-path` 不改系统 PATH |
| **阻断** | ❌ **Smart App Control 阻止 `rustc.exe`**：事件日志 `Microsoft-Windows-CodeIntegrity/Operational` 3077 / 3033 / 3118 —— `rustc.exe` 加载 `rustc_driver-*.dll` 未达签名级别（Policy ID `{0283ac0f-…}`），进程退出码 `0xC0E90002` ⇒ **`cargo check` / `tauri dev` 均无法进行** |
| 现存二进制 | `client/src-tauri/target/release/liri_client.exe` 构建于 **2026-09-10**（早于本轮全部改动）⇒ 启动它也验证不到 G8 四/五/六期 |

**本机已完成的替代核对（可复核）**：
1. `capabilities/{default,floating}.json` 的 **24 条权限 id 全部命中** `client/src-tauri/gen/schemas/desktop-schema.json` 的 `const` 清单；
2. `Cargo.lock` **无** `tauri-plugin-global-shortcut` 条目 ⇒ 印证"未重生成"；
3. 前端 `tsc` 0 错误 / `eslint` 0 error / `vitest` 141 文件 / 990 用例全绿。

**待真机项（解除阻断后逐条验）**：
1. `Ctrl+Shift+F` 系统级唤起（未聚焦时）+ 注册失败仅告警；
2. 悬浮窗几何记忆（移动/缩放后重开）+ 拔副屏后自动回到主屏；
3. 当前会话 / 运行中目标在副窗口的真实 HTTP 读取（后端不可达时显示"暂时读不到"）；
4. 点击穿透进入 + `Ctrl+Shift+F` 退出（穿透期间点击落到下层应用）；
5. `Cargo.lock` 生成 `tauri-plugin-global-shortcut` 条目后提交。

**解除方式（需用户决定，均不在本批擅自动手）**：
- 关闭 Windows「智能应用控制」（设置 → 隐私和安全性 → Windows 安全中心 → 应用和浏览器控制）；**该开关关闭后不可再开启**（除重装系统）；
- 或在另一台未启用该策略的机器 / 由 CI（tag 触发 `release.yml`）构建安装包后再真机验证。
