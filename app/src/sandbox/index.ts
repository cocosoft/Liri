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
export * from './types/SandboxTypes';
export { SandboxManager } from './managers/SandboxManager';
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
export { SandboxPruner } from './SandboxPruner';
export type {
  SandboxInstance,
  PruneResult,
  PruneStrategy,
} from './SandboxPruner';
export { ProcessRegistry, processRegistry } from './ProcessRegistry';
export type { ProcessInfo, ProcessQuery } from './ProcessRegistry';

// Worker Threads 沙箱（进程级隔离）
export { WorkerSandbox } from './WorkerSandbox';
export type { WorkerSandboxConfig } from './WorkerSandbox';

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

// 插件健康监控器（心跳检测 + 崩溃恢复）
export { PluginHealthMonitor, PluginHealthStatus } from './PluginHealthMonitor';
export type {
  HeartbeatRecord,
  CrashEvent,
  RecoveryStrategy,
  RecoveryHandler,
  PluginHealthMonitorConfig,
} from './PluginHealthMonitor';

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
  createSandboxPolicy,
  isToolAllowed,
  getAllowedTools,
  validateToolAccess,
  PRODUCTION_SANDBOX_POLICY,
} from './SandboxPolicy';
export type {
  SandboxToolPolicy,
  SandboxMode,
  SandboxGlobalPolicy,
} from './SandboxPolicy';

// 导出阶段 A 新增组件
export { WorkspaceBase } from './WorkspaceBase';
export type { WorkspaceFileInfo, WorkspaceListResult } from './WorkspaceBase';
export { WorkspaceManager, globalWorkspaceManager } from './WorkspaceManager';
export type { WorkspaceCreateOptions } from './WorkspaceManager';
export { LocalWorkspace } from './adapters/LocalWorkspace';
export { DockerWorkspace } from './adapters/DockerWorkspace';
export { SSHWorkspace } from './adapters/SSHWorkspace';

export { SandboxConfigBuilder } from './SandboxConfigBuilder';
