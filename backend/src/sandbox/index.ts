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
