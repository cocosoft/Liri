export * from './types.js';
export { createLSPClient } from './LSPClient.js';
export type { LSPClient } from './LSPClient.js';
export { createLSPServerInstance } from './LSPServerInstance.js';
export type { LSPServerInstance } from './LSPServerInstance.js';
export { createLSPServerManager } from './LSPServerManager.js';
export type { LSPServerManager } from './LSPServerManager.js';
export {
  registerPendingLSPDiagnostic,
  checkForLSPDiagnostics,
  clearLSPDiagnostics,
} from './LSPDiagnosticRegistry.js';
export type { PendingLSPDiagnostic } from './LSPDiagnosticRegistry.js';
export {
  formatDiagnosticsForAttachment,
  registerLSPNotificationHandlers,
} from './passiveFeedback.js';
export type { HandlerRegistrationResult } from './passiveFeedback.js';

// 导出增强功能
export * from './EnhancedLSPManager.js';
export * from './IntelligentLSPAnalyzer.js';

// 导出Zod Schema验证
export * from './schemas.js';
export {
  DiagnosticsContextAdapter,
  getDiagnosticsContextAdapter,
} from './DiagnosticsContextAdapter';
export type {
  AgentDiagnosticEntry,
  AgentDiagnosticLevel,
  DiagnosticsAdapterConfig,
} from './DiagnosticsContextAdapter';

// 导出多语言 Server 配置注册表
export {
  LSPServerConfigRegistry,
  getDefaultConfigRegistry,
  createConfigRegistry,
} from './LSPServerConfigRegistry.js';
export type { LanguageServerRegistration } from './LSPServerConfigRegistry.js';

// 导出诊断展示工具
export {
  LSPDiagnosticDisplay,
  getDefaultDiagnosticDisplay,
  createDiagnosticDisplay,
} from './LSPDiagnosticDisplay.js';
export type {
  DisplayDiagnostic,
  DiagnosticSummary,
  GroupedDiagnostics,
  DiagnosticFormat,
} from './LSPDiagnosticDisplay.js';
