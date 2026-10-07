# Spec：事件循环同步子进程调用 —— **清单外残留登记**（V-2）

> 版本 1.0 ｜ 创建 2026-10-07 ｜ 状态：✅ **登记完成（登记类文档，零代码）**
> 来源：台账 **§10.5 V-2**「事件循环阻塞-运行时探针」的**收尾子项** ——「四批共收敛 57 处同步子进程调用 ⇒ **本清单内已收敛完毕**；全仓另有**清单外管理/安装类** `execSync` 站点，**另册登记**；**不得读作"全仓零同步子进程"**」。
> 性质：**只读取证 + 登记**（不视为新模块/接口/数据模型变更，不触发 GR15 实施面）。
> 关联：`query/verifyProject.ts`（热路径已收敛）· `diagnostics/DependenciesChecker.ts`（`spawnSync 3853ms` 第一大来源，已收敛）· `monitoring/metrics/SystemMetricsCollector.ts:206`（同源注释）。

---

## 1. 背景与口径（如实）

- **已收敛（清单内，2026-10-04，四批共 57 处）**：热路径 3 · worktree/workspace 14 · 启动/诊断/CLI/命令 36 · 收尾 4 ⇒ 本册**不重复登记**。
- **本册范围**：全仓 `app/src` 内**仍在调用**的**同步**子进程 API（`execSync` / `spawnSync`）中，**不在上述 57 处之内**的残留站点。
- **取证方法**：`Grep` 全仓 `app/src` 的 `execSync` / `spawnSync` ⇒ **逐条判定"真实调用 vs 注释/正则/字符串"**（后者不计入）。

---

## 2. 清单外残留 —— **真实调用点**（逐条）

| # | 站点（file:line） | 调用数 | 类别 | 调用时机 | 阻塞评估（如实） |
|:--:|---|:--:|---|---|---|
| R-1 | [subagent/types/TmuxSubAgent.ts](file:///e:/PY/Documents/CODES/PY_APP/app/src/subagent/types/TmuxSubAgent.ts#L63) `:63/78/117/164/212/317/361` | **7** | **子代理管理**（tmux：`--version` / `new-session` / `kill-session` / `list-sessions` / `capture-pane` / `has-session`） | 子代理生命周期（`start`/`stop`/`getOutput`…） | ⚠️ **最需关注**：由 `SubAgentManager` → `SubAgentFactory.createTmuxSubAgent` **生产可达**（仅当配置 tmux 型子代理）；且 **7 处均未设 `timeout`** ⇒ 极端下可**无限期**同步阻塞。**Windows 无 tmux** ⇒ 该后端在本机不可用（`--version` 失败即抛 `Tmux is not installed`） |
| R-2 | [main.ts](file:///e:/PY/Documents/CODES/PY_APP/app/src/main.ts#L136) `:136`（`chcp 65001`）· `:178`（`netstat -ano -p tcp`） | **2** | **启动期**：控制台码页切换 / 僵尸进程端口探测 | 启动（`setupWindowsSecurity` / `isProcessListeningOnAnyPort`） | ⬇ 启动期一次性；两处**均有 timeout**（3000ms / 5000ms）⇒ 有界 |
| R-3 | [services/voice/services/commandTTSProvider.ts](file:///e:/PY/Documents/CODES/PY_APP/app/src/services/voice/services/commandTTSProvider.ts#L79) `:79/84`（`which espeak` / `which festival`） | **2** | **后端探测**（Linux） | 首次探测（结果缓存于 `detectedBackend`） | ⬇ 探测期；**无 timeout**（`which` 极快，风险低） |
| R-4 | [services/voice/services/piperTTSProvider.ts](file:///e:/PY/Documents/CODES/PY_APP/app/src/services/voice/services/piperTTSProvider.ts#L171) `:171`（`--help`） | **1** | **后端探测** | 探测期 | ⬇ 同上（无 timeout） |
| R-5 | [system/auth/oauthConfig.ts](file:///e:/PY/Documents/CODES/PY_APP/app/src/system/auth/oauthConfig.ts#L50) `:49-50`（macOS `security find-generic-password`） | **1** | **凭据读取**（Keychain） | 配置解析（启动） | ⬇ 仅 macOS + 启动期；**无 timeout**；⚠️ **同时是全仓唯一的 `require('child_process')`**（`lint:arch` R00-003「动态跨层引用 …其中 `require('…')` 形式 **1 处**」记的就是它） |
| R-6 | [scripts/batch-test-all.ts](file:///e:/PY/Documents/CODES/PY_APP/app/src/scripts/batch-test-all.ts#L146) `:146`（`spawnSync`） | **1** | **开发脚本**（非生产入口） | 手动运行 | ➖ 非运行时路径，不构成生产阻塞面 |

> **合计**：`execSync` **13 处**（R-1 七 + R-2 两 + R-3 两 + R-4 一 + R-5 一）· `spawnSync` **1 处**（R-6，脚本）。

---

## 3. 非调用命中（**不计入**，防误读）

| 文件 | 性质 |
|---|---|
| `plugins/utils/pluginSecurityScanner.ts:84` | **安全扫描正则**（`/(exec|execSync|spawn|spawnSync|…)\s*\(/`）—— 用于**检测插件里的**子进程调用 |
| `security/scanners/SecurityScanner.ts:277/279` | 同上（扫描正则） |
| `sandbox/docker/dockerCli.ts:5/47`、`sandbox/docker/DockerImageManager.ts:5`、`sandbox/docker/DockerSandbox.ts:82/203/349`、`tools/bash/bashLandlockExec.ts:294`、`query/verifyProject.ts:28-29`、`evals/sourceTask.ts:355`、`workspaces/*`、`plugins/install/*`、`tools/DocGenerateTool/*`、`tools/VideoAnalysisTool/*`、`commands/backup/BackupCommand.ts`、`services/voice/services/{recorder,recordingDetector}.ts`、`tools/ClipboardTool/ClipboardTool.ts` 等 | **已收敛站点的注释**（说明"原 `execSync`/`spawnSync` 已改异步"）⇒ 是**收敛证据**，非残留 |

---

## 4. 顺带发现（**未改**，如实登记）

| 发现 | 位置 | 说明 |
|---|---|---|
| **未使用的 `execSync` 导入** | [tools/environments/PersistentTerminalVm.ts](file:///e:/PY/Documents/CODES/PY_APP/app/src/tools/environments/PersistentTerminalVm.ts#L2) `:2` | 全文件**仅 import、零调用**（`Grep execSync` 只命中第 2 行）⇒ **死导入**。按「死代码只报告不删除」**未动**；是否清理并入「死代码处置」家族裁定 |

---

## 5. 裁定与触发条件（CS03）

**裁定**：**不收敛**（本轮**登记**，零代码）。
**理由**：R-1…R-5 均**不在请求热路径**（启动 / 探测 / 凭据读取 / 子代理管理）；R-6 为开发脚本。为"理论上可能的阻塞"改写 13 处调用会引入签名漂移与回归风险，收益未证（CS03：不为不可观场景加机制）。

**触发条件（任一条成立即按既有 4 批手法转异步，并回报本册）**：
1. `loop-probe` 阶段级归因 **或** `Event Loop 滞后` 转储中，出现指向 **R-1…R-5 任一站点**的自记阻塞（≥2 份一致）；
2. R-1（tmux）在**生产被实际启用**且其调用落入请求/流式路径；
3. 任一站点被移到请求热路径（如 TTS 探测改为按请求探测）。

**兜底观察点（现状即可用）**：`TurnLivenessWatchdog` 的采样跳变告警 + `diagnostics:loop-probe` 的阶段级归因（R-1 若触发，最可能先在此出现）。

---

## 6. 合规（对照 workspace rules）

| 规则 | 落点 |
|---|---|
| **CS01 归一化** | ✅ 不新建扫描器/工具；直接以 `Grep` 取证并复用既有 V-2 账簿口径 |
| **CS03 回退最小化** | ✅ 不为未证场景改写 13 处调用；给出**触发条件** |
| **CS06 证据驱动** | ✅ 每站点带 `file:line`；**区分"真实调用 vs 注释/正则"**（防把收敛证据误读为残留） |
| 死代码纪律 | ✅ `PersistentTerminalVm.ts:2` 死导入**只报告不删除** |
| `project_rules §1.3` 无兼容包袱 | ✅ 本册零代码，不涉 |
| GR15 Spec-Driven | ➖ 本册为**登记类文档**（非模块/接口/数据模型变更）⇒ 不触发实施面 |
