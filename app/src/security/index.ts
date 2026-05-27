/**
 * 安全模块导出
 *
 * 使用向导：
 *   ✅ 推荐：外部代码使用 completeSecuritySystem（完整安全系统门面）
 *   ✅ 类型：使用 ICompleteSecuritySystem / SecurityCheckResult 等类型接口
 *   ⚠️ 内部组件通过门面方法访问，不直接引用
 *
 *   import { completeSecuritySystem } from '@modules/security';
 *   import type { ICompleteSecuritySystem } from '@modules/security';
 */

// ==================== 门面 API ====================
export {
  CompleteSecuritySystem,
  completeSecuritySystem,
} from './CompleteSecuritySystem';
export type {
  ICompleteSecuritySystem,
  SecurityCheckResult,
  AuditRecord,
  SecurityConfig,
  SecurityReport,
} from './CompleteSecuritySystem';
export { SecurityLevel } from './CompleteSecuritySystem';

// ==================== 桥接接口（供内部使用，外部通过门面访问） ====================
export {
  SecurityIntegrationService,
  securityIntegrationService,
} from './SecurityIntegration';

// ==================== 向后兼容导出（@deprecated — 请使用门面 API 替代） ====================
// Bash 安全分析
export { BashSecurityAnalyzer } from './BashSecurityAnalyzer';
export {
  isPathTraversal,
  sanitizePath,
  preExecutionCheck,
  sanitizeInput,
  encrypt,
  decrypt,
  generateEncryptionKey,
} from './securityUtils';

// 沙箱管理
export { SandboxManager } from './SandboxManager';

// 权限管理
export { PermissionManager } from './PermissionManager';

// 审计
export { SecurityAudit } from './SecurityAudit';
export { runSecurityAudit } from './audit';
export type { SecurityAuditReport } from './audit';

// 加密与敏感数据处理
export {
  CryptoUtils,
  ENCRYPTION_ALGORITHMS,
  DEFAULT_ENCRYPTION_OPTIONS,
  SensitiveDataService,
  sensitiveDataService,
  SensitiveErrorType,
} from './services';
export type {
  EncryptionOptions,
  SensitiveError,
  SensitiveDataConfig,
} from './services';

// ==================== 策略模块 ====================
export {
  filterMcpServersByPolicy,
  doesEnterpriseMcpConfigExist,
  excludeCommandsByServer,
  excludeResourcesByServer,
  ChannelPermissionRelay,
  getChannelPermissionRelay,
  clearChannelPermissionRelay,
  createChannelPermissionCallbacks,
  isChannelPermissionRelayEnabled,
  sendChannelPermissionRequest,
  setChannelPermissionConfig,
  getChannelPermissionConfig,
  removeChannelPermissionConfig,
  checkResourcePermission,
  checkToolPermission,
  isResourceAccessAllowed,
  isToolAccessAllowed,
} from './policy';
export type {
  MCPServerPolicy,
  PermissionBehavior,
  ResourcePermission,
  ToolPermission,
  ChannelPermissionConfig,
  ChannelPermissionResponse,
  ChannelPermissionCallbacks,
  DefaultChannelPermissionCallbacks,
} from './policy';

// ==================== 扫描模块 ====================
export {
  scanMemoryForSecrets,
  containsSecrets,
  sanitizeSecrets,
} from './scanner/secret';
export type { MemorySecretMatch } from './scanner/secret';

// ==================== 类型导出 ====================
export type {
  SecurityAnalysisResult,
  SecurityPattern,
  SecurityBehavior,
  RiskLevel,
  SecurityCheckContext,
  SecurityDecision,
} from './types';
export type {
  CommandSemantic,
  CommandSemanticPattern,
} from './commandSemantics';
export type { DestructiveCommandConfig } from './destructiveCommandWarning';
export type { ReadOnlyValidationOptions } from './readOnlyValidation';
export type {
  PermissionBehavior as PermissionCheckBehavior,
  PermissionCheckResult,
  PermissionCheckFn,
  PermissionDenialRecord,
  PermissionDenialSummary,
} from './PermissionWrapper';
export type { RedactConfig, RedactMode } from './redact';
export type {
  InjectionSeverity,
  InjectionDetectionResult,
  DetectionLevel,
  DetectionResult,
  ThreatMatch,
  InvisibleCharMatch,
  UnicodeSanitizeResult,
  ContextFileType,
  ContextFileEntry,
} from './injection';
export type {
  SecurityPatternEntry,
  PatternUpdateEvent,
  PatternLibraryConfig,
} from './patterns';
export type { RedactResult, ObjectRedactResult } from './redact';
export type { RedactStats } from './redact';
