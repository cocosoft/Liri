/**
 * 钩子系统入口
 * 提供钩子执行、配置和管理功能
 */

// 导出类型
export * from './types/index.js';

// 导出管理器
export { HookExecutor, hookExecutor } from './executors/HookExecutor.js';
export { CommandHookExecutor } from './executors/CommandHookExecutor.js';
export { PromptHookExecutor } from './executors/PromptHookExecutor.js';
export { HttpHookExecutor } from './executors/HttpHookExecutor.js';
export { AgentHookExecutor } from './executors/AgentHookExecutor.js';

// 导出工具
export { AsyncHookRegistry, asyncHookRegistry } from './utils/AsyncHookRegistry.js';
export { EnvironmentManager, environmentManager } from './utils/EnvironmentManager.js';
export { DiagnosticManager, diagnosticManager } from './utils/DiagnosticManager.js';
export { SecurityManager, securityManager } from './utils/SecurityManager.js';
export { PerformanceManager, performanceManager } from './utils/PerformanceManager.js';

// 导出钩子管理器
export { HookManager } from './managers/HookManager.js';
export { HookConfigManager } from './managers/HookConfigManager.js';
export { SessionHookManager, sessionHookManager } from './managers/SessionHookManager.js';
