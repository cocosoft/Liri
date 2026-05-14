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

// 对齐 OpenClaw 的新组件
export { DockerSandbox } from './DockerSandbox';
export type { DockerSandboxConfig, DockerSandboxResult } from './DockerSandbox';
export { PTYSandbox } from './PTYSandbox';
export type { PTYSandboxConfig } from './PTYSandbox';
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
