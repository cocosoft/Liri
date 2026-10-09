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
export * from './EnhancedSandboxManager.js';
export * from './IntelligentSandboxAnalyzer.js';
export * from './SandboxSecurityChecker.js';

// Docker 沙箱（容器级隔离）
export { DockerSandbox, DOCKER_CONFIG_KEYS } from './docker/index';
export type { DockerVolumeMount } from './docker/index';
export { PTYSandbox } from './PTYSandbox';
export type { PTYSandboxConfig } from './PTYSandbox';
export { SSHSandbox } from './SSHSandbox';
export type { SSHSandboxConfig, SSHConnectionStatus } from './SSHSandbox';
// ── 沙箱「实例层」—— 2026-09-29 **整层下线**（台账 **D-16 / D-25**）──
// 已删：`SandboxPruner` / `WorkerSandbox` / `PluginHealthMonitor` / `SandboxImpl`
//（含 `SandboxManagerImpl` / `createSandboxManager` / 各平台沙箱类）、`tools/sandbox/ToolSandboxRouter`
// —— 它们**全仓零消费者**（仅经各自 barrel 可达；`SandboxImpl` 的唯一构造方是 `ToolSandboxRouter`）。
// 现**活**的沙箱面是**路径级**：`sandbox/landlock/*`（bash / code_run）、`SandboxSecurityChecker`、
// `utils/PathRestrictions` —— 本文件下方这些导出**保持不动**。
export { ProcessRegistry, processRegistry } from './ProcessRegistry';
export type { ProcessInfo, ProcessQuery } from './ProcessRegistry';
// R21（2026-10-09）：进程树终止（取消/中止时防孤儿进程）
export { killProcessTree } from './utils/killProcessTree';
export type {
  KillableChild,
  KillProcessTreeDeps,
} from './utils/killProcessTree';

// 资源限制管理器（per-plugin CPU/内存/并发控制）
export {
  ResourceLimitManager,
  resourceLimitManager,
} from './ResourceLimitManager';
export type {
  PluginResourceLimits,
  PluginResourceUsage,
  ExecutionContext,
} from './ResourceLimitManager';

// 插件健康监控器（心跳检测 + 崩溃恢复）—— 2026-09-29 随「沙箱实例层」一并下线（**零消费者**，台账 D-25）。
// 注：**通道**侧的自愈是**活的** `channels/monitoring/ChannelRealtimeMonitor`（与本体无关）。

// 文件系统与网络隔离管理器
export {
  IsolationManager,
  isolationManager,
  FileOperation,
  NetworkOperation,
} from './IsolationManager';
export type {
  PathAccessRule,
  NetworkAccessRule,
  IsolationPolicy,
  PathAccessResult,
  NetworkAccessResult,
} from './IsolationManager';
export {
  // G1-A（2026-09-26）：bash 接入 Landlock 需复用 B1 的"逐块按剩余量切片"助手（截断口径单一来源）
  appendWithinLimit,
} from './SandboxPolicy';
// 2026-09-29（台账 D-42）：原此处还再导出 `createSandboxPolicy` / `isToolAllowed` / `getAllowedTools` /
// `validateToolAccess` / `PRODUCTION_SANDBOX_POLICY`（值）与 `SandboxToolPolicy` / `SandboxMode` /
// `SandboxGlobalPolicy`（类型）—— 这些属**零消费者死门禁**，已随 `SandboxPolicy.ts` 整段清理一并删除。

// 导出阶段 A 新增组件
export { WorkspaceBase } from './WorkspaceBase';
export type { WorkspaceFileInfo, WorkspaceListResult } from './WorkspaceBase';
export { WorkspaceManager, globalWorkspaceManager } from './WorkspaceManager';
export type { WorkspaceCreateOptions } from './WorkspaceManager';
export { LocalWorkspace } from './adapters/LocalWorkspace';
export { DockerWorkspace } from './adapters/DockerWorkspace';
export { SSHWorkspace } from './adapters/SSHWorkspace';

export { SandboxConfigBuilder } from './SandboxConfigBuilder';

// 2026-08-30 R03-002 收敛：SandboxImpl / landlock 统一出口
// 2026-09-29：`SandboxImpl`（`SandboxManagerImpl` / `createSandboxManager` / 各平台沙箱类）
// 已随「沙箱实例层」下线（唯一构造方 `ToolSandboxRouter` 亦零消费者，台账 D-25）；
// landlock 出口**保持不动**（见下方）。
export { LandlockDetector } from './landlock';
export {
  buildLandlockArgv,
  runWithLandlock,
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
