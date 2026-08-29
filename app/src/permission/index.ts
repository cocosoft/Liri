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
  getBaseCommand,
  toolCallApprovalKey,
  isToolCallApproved,
} from './ApprovedCommandRegistry';

// Risk classification (Phase 3: OpenWorker-style)
export {
  RiskClass,
  inferRiskClass,
  detectChainedCommand,
} from './types/RiskClass';
export type { RiskOverrides } from './types/RiskClass';

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
