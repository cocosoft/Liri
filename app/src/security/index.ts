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

// ==================== 安全审计日志 ====================
export {
  logSecurityAuditEvent,
  queryAuditLogs,
  getAuditLogStats,
  clearAuditLogs,
  truncateCommand,
} from './SecurityAuditLogger';
export type {
  SecurityAuditEvent,
  AuditSessionContext,
  AuditLogFilter,
} from './SecurityAuditLogger';

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

// 沙箱管理（security/SandboxManager 已删除：零消费遗留，P0 清理）

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
  CredentialManager,
  credentialManager,
} from './services';
export type {
  EncryptionOptions,
  SensitiveError,
  SensitiveDataConfig,
  Credential,
  CredentialType,
  CredentialScope,
  EncryptedCredential,
  CredentialAuditEntry,
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

// ==================== 回滚模块 ====================
export type { RollbackPermissionCheckFn } from './rollback';

export type {
  FileChange,
  FileChangeType,
  FileStat,
  ScanStatus,
  SnapshotStatus,
  RoundSnapshot,
  UndoResult,
  TimelineEntry,
  StorageUsage,
  SnapshotCleanupPolicy,
  UndoGuardState,
  RedoConflict,
  WalEntry,
  SessionIndexEntry,
  InjectStrategy,
  FileOperation,
  RedoResult,
} from './rollback';
export {
  FileOperationTracker,
  createRoundSnapshot,
  loadSnapshot,
  deleteRoundSnapshot,
  listSessionSnapshots,
  updateSessionIndex,
  getTotalSnapshotSize,
  cleanupInterruptedRounds,
  cleanupRoundTempFiles,
  enforceSnapshotQuota,
  onApplicationStart,
  executeUndo,
  previewUndo,
  detectRedoConflicts,
  recoverFromCrash,
  detectUserModifications,
  findDependentRounds,
  cleanupOrphanFiles,
  executeRedo,
  canRedo,
  generateUndoContext,
  generateDetailedUndoContext,
  shouldInjectContext,
  RollbackIntegration,
  xxHash,
  encodeFilePath,
  xxHashBuffer,
} from './rollback';

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
