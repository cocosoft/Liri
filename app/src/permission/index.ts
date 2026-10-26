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
 * 权限系统模块统一导出
 */

export {
  PermissionMode,
  PERMISSION_MODES,
  PERMISSION_MODE_NAMES,
  PERMISSION_MODE_SYMBOLS,
  getPermissionModeDescription,
  shouldAvoidPermissionPrompts,
} from './PermissionMode';

export {
  PermissionBehavior,
  PermissionRuleSource,
} from './types/PermissionRule';

export type {
  PermissionRuleValue,
  PermissionRule,
} from './types/PermissionRule';

// LRO-07（2026-10-26）：规则拒绝的结构化回传（工具结果 `metadata.permissionDeny`）
export type { PermissionDenyInfo } from './types/PermissionDecision';

export type {
  PermissionRuleEntry,
  PermissionUpdateDestination,
  PermissionUpdate,
} from './PermissionRule';

export type {
  PermissionDecisionReason,
  PermissionResult,
  PermissionAllowDecision,
  PermissionDenyDecision,
  PermissionAskDecision,
  PermissionPassthroughDecision,
  PermissionDecision,
} from './PermissionResult';

export {
  getRuleBehaviorDescription,
  createAllowDecision,
  createDenyDecision,
  createAskDecision,
  createPassthroughDecision,
} from './PermissionResult';

export {
  getEmptyToolPermissionContext,
  getAllowRules,
  getDenyRules,
  getAskRules,
  getRuleByContentsForToolName,
  hasPermissionsToUseTool,
  type ToolPermissionContext,
} from './permissions';

export {
  checkReadPermissionForTool,
  checkWritePermissionForTool,
  isDangerousFile,
  isInDangerousDirectory,
  containsPathTraversal,
  isWithinWorkingDirectory,
  DANGEROUS_FILES,
  DANGEROUS_DIRECTORIES,
} from './filesystem';

export {
  loadPermissionsFromSettings,
  loadAllPermissionSettings,
} from './permissionsLoader';

export {
  applyPermissionUpdate,
  persistPermissionUpdates,
  type PermissionUpdateOperation,
} from './PermissionUpdateSchema';

export * from './EnhancedPermissionEngine.js';

export {
  ShadowedRuleDetector,
  shadowedRuleDetector,
} from './utils/ShadowedRuleDetector';
export type {
  ShadowedRuleInfo,
  ShadowedRuleDetectionResult,
} from './utils/ShadowedRuleDetector';

export {
  PermissionCache,
  PermissionRuleValidator,
  permissionCache,
  generateInputHash,
  checkPermissionsWithCache,
} from './PermissionCache';

export {
  checkDangerousCommand,
  validatePath,
  checkFileOperationPermission,
  checkNetworkOperationPermission,
  checkProcessOperationPermission,
  PermissionPolicyManager,
} from './PermissionPolicies';

// 工具执行审批链路（P0-3/P0-6）：已批准命令放行缓存
export {
  ApprovedCommandRegistry,
  getApprovedCommandRegistry,
  normalizeCommand,
  hashCommand,
  hashCommandForExecution,
  hashEnvForApproval,
  computeScopeDigest,
  getBaseCommand,
  toolCallApprovalKey,
  isToolCallApproved,
  hashApprovalFingerprint,
} from './ApprovedCommandRegistry';
export type {
  ApprovalEntry,
  ApprovalScope,
  ApprovalSnapshot,
} from './ApprovedCommandRegistry';

// PR-2（2026-10-23）：授权维度（工具+参数指纹）与「始终允许」规则
export {
  resolveApprovalFingerprint,
  normalizeApprovalPath,
  previewApprovalFingerprint,
} from './approvalFingerprint';
export type { ApprovalFingerprintDeclaringTool } from './approvalFingerprint';

// PR-1（2026-10-23）：审批卡提交前去重（同指纹复用，防僵尸卡）
export { findPendingApprovalId } from './inboxApprovalDedupe';
export type { PendingApprovalLookup } from './inboxApprovalDedupe';

// Risk classification (Phase 3: OpenWorker-style)
export {
  RiskClass,
  inferRiskClass,
  resolveRiskClass,
  detectChainedCommand,
} from './types/RiskClass';

export { DenialTracker, denialTracker } from './trackers/DenialTracker';

export {
  PermissionMetricsStore,
  permissionMetrics,
} from './metrics/PermissionMetricsStore';

// 2026-08-30 R03-002 收敛：PermissionManager / FineGrainedPermissionManager / RuleManager / Permission 统一出口
export {
  PermissionManager,
  createPermissionManager,
} from './PermissionManager';
// D2（2026-10-11）：权限管理器注入断言（生产 fail-fast，G9）
export { assertPermissionManagerInjected } from './assertPermissionInjected';
export {
  FineGrainedPermissionManager,
  createFineGrainedPermissionManager,
} from './FineGrainedPermissionManager';
export { RuleManager, deduplicateRules } from './RuleManager';
export type { RuleContext } from './RuleManager';
export {
  ResourceType,
  OperationType,
  PermissionAction,
  RoleType,
} from './Permission';
