// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
/**
 * 沙箱模块统一入口
 * 导出所有沙箱相关的类型和类
 */
export * from './SandboxTypes';
export { SandboxManager } from './SandboxManager';
export {
  checkDangerousCommand,
  containsExcludedCommand,
  matchesExcludedPattern,
  splitCompoundCommand,
} from './utils/DangerousCommandChecker';
export {
  checkPathAccess,
  checkReadPathAccess,
  checkWritePathAccess,
  normalizePath,
  matchPathPattern,
} from './utils/PathRestrictions';
export {
  executeWithTimeout,
  TimeoutController,
  TimeoutError,
} from './utils/TimeoutController';

// 导出增强功能
// 2026-10-08（P1-续 S3）：原 `export * from './EnhancedSandboxManager.js'` /
// `'./IntelligentSandboxAnalyzer.js'` —— 两者**零外部消费者**（仅本 barrel 转出）⇒ 连同文件删除。
// 注：`EnhancedSandboxManager` 曾是**唯一**"超限即拒绝"的沙箱侧实现（死面内 ⇒ 无运行期效果）。
export * from './SandboxSecurityChecker.js';

// Docker 沙箱 / PTY / SSH —— 2026-10-08（P1-续 S4）**整批删除**：三者均**零外部消费者**
// （sandbox 目录外无实例化；`DockerSandbox` 在 `AgentCleanup` 仅为**未使用导入**），
// 属"未接线的隔离后端"。其专属测试（`tests/sandbox/docker*.test.ts` / `outputLimits.test.ts`
// / `networkPolicyDeclaration.test.ts`）同批删除。**实际生效的隔离 = Landlock 路径门禁**（见 §9.1）。
// ── 沙箱「实例层」—— 2026-09-29 **整层下线**（台账 **D-16 / D-25**）──
// 已删：`SandboxPruner` / `WorkerSandbox` / `PluginHealthMonitor` / `SandboxImpl`
//（含 `SandboxManagerImpl` / `createSandboxManager` / 各平台沙箱类）、`tools/sandbox/ToolSandboxRouter`
// —— 它们**全仓零消费者**（仅经各自 barrel 可达；`SandboxImpl` 的唯一构造方是 `ToolSandboxRouter`）。
// 现**活**的沙箱面是**路径级**：`sandbox/landlock/*`（bash / code_run）、`SandboxSecurityChecker`、
// `utils/PathRestrictions` —— 本文件下方这些导出**保持不动**。
// 2026-10-08（P1-续 S7）**整批删除**：`ProcessRegistry`（**无任何生产者** ⇒ `getStats()` 恒空）与
// `ResourceLimitManager`（执行 API `acquireExecution`/`releaseExecution`/`cleanStaleContexts` 零调用
// ⇒ `getSummary()` 恒空）—— 二者**只**服务于 `GET /v1/sandbox/status` 的投影字段
// （`processStats` / `resourceSummary`，已随本轮一并删除）。

// 插件健康监控器（心跳检测 + 崩溃恢复）—— 2026-09-29 随「沙箱实例层」一并下线（**零消费者**，台账 D-25）。
// 注：**通道**侧的自愈是**活的** `channels/monitoring/ChannelRealtimeMonitor`（与本体无关）。

// 文件系统与网络隔离管理器 —— 2026-10-08（P1-续 S2）**整文件删除**：
// `IsolationManager`（448 行，插件 fs/网络隔离策略）+ 单例 `isolationManager` **零外部消费者**
// （`registerPolicy`/`checkFileAccess`/`checkNetworkAccess` 无任何调用点）⇒ 插件隔离从未启用。
export {
  // G1-A（2026-09-26）：bash 接入 Landlock 需复用 B1 的"逐块按剩余量切片"助手（截断口径单一来源）
  appendWithinLimit,
} from './SandboxPolicy';
// 2026-09-29（台账 D-42）：原此处还再导出 `createSandboxPolicy` / `isToolAllowed` / `getAllowedTools` /
// `validateToolAccess` / `PRODUCTION_SANDBOX_POLICY`（值）与 `SandboxToolPolicy` / `SandboxMode` /
// `SandboxGlobalPolicy`（类型）—— 这些属**零消费者死门禁**，已随 `SandboxPolicy.ts` 整段清理一并删除。

// 导出阶段 A 新增组件 —— 2026-10-08（P1-续 S1）**整层删除**：`WorkspaceBase` / `WorkspaceManager`
// / `globalWorkspaceManager` / `LocalWorkspace`（`create()` 全仓零调用 ⇒ 工作区 Map 恒空；
// S4 已删 Docker/SSH 两个 adapter）。SPI `workspaces` 面随之删除（见 core/spi/SandboxService.ts）。

// 2026-10-08（P1-续）：原 `export { SandboxConfigBuilder }` 已删 —— `toolType → SandboxPermissions`
// 的**策略库**，全仓**零生产消费者**（真实 `code_run` 走 `LinuxSandboxRunner.buildBunLandlockPolicy`；
// `bash` 走 `buildBashLandlockPolicy`）。其唯一消费者是 `tests/sandbox/landlockSensitivePathGuard.test.ts`
// 的 A 段，该段**测的是一条不存在的路径** ⇒ 已改写为断言**真实策略**。

// 2026-08-30 R03-002 收敛：SandboxImpl / landlock 统一出口
// 2026-09-29：`SandboxImpl`（`SandboxManagerImpl` / `createSandboxManager` / 各平台沙箱类）
// 已随「沙箱实例层」下线（唯一构造方 `ToolSandboxRouter` 亦零消费者，台账 D-25）；
// landlock 出口**保持不动**（见下方）。
export { LandlockDetector } from './landlock';
export {
  buildLandlockArgv,
  // 2026-10-08（P1-续 S5）：原 `runWithLandlock` 已删 —— **无任何调用点**（bash/code_run 均
  // 直接 `buildLandlockArgv` + `spawn`，绕过它）。其**活部件**（`buildLandlockArgv` /
  // `isSandboxInitFailure`）保留。
  isSandboxInitFailure,
  // G1-A（2026-09-26）：bash 接入 Landlock 需读同一份配置（不另建配置面）
  readLandlockConfig,
  resolveLandlockConfig,
  DEFAULT_LANDLOCK_CONFIG,
  // P0-4 ②（2026-10-04）：评测期强制 bash 走 Landlock 的意图开关（capability 门控在下游 gate）
  ENV_EVAL_BASH_LANDLOCK,
  isEvalBashLandlockForced,
} from './landlock';
export type {
  LandlockPolicy,
  LandlockConfig,
  LandlockCapability,
  LandlockFsRule,
  LandlockFsAccess,
} from './landlock';
