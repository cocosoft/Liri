/**
 * 权限系统模块统一导出
 */

export {
  PERMISSION_MODES,
  PERMISSION_MODE_NAMES,
  PERMISSION_MODE_SYMBOLS,
  type PermissionMode,
} from './PermissionMode';

export type {
  PermissionBehavior,
  PermissionRuleSource,
  PermissionRuleValue,
  PermissionRule,
  PermissionUpdateDestination,
  PermissionUpdate,
} from './PermissionRule';

export {
  permissionRuleValueFromString,
  permissionRuleValueToString,
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
  PermissionCacheKey,
  PermissionCacheItem,
  PermissionCache,
  PermissionRuleValidator,
  permissionCache,
  generateInputHash,
  checkPermissionsWithCache,
} from './cache/PermissionCache';

export {
  checkDangerousCommand,
  validatePath,
  checkFileOperationPermission,
  checkNetworkOperationPermission,
  checkProcessOperationPermission,
  PermissionPolicyManager,
} from './policies/PermissionPolicies';
