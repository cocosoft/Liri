/**
 * 【已合并】权限模块 shim 层
 * 向后兼容：从 @modules/permission 重新导出所有公共 API
 * 新代码请直接使用 @modules/permission/* 路径
 */

export {
  PERMISSION_MODES,
  PERMISSION_MODE_NAMES,
  PERMISSION_MODE_SYMBOLS,
  shouldAvoidPermissionPrompts,
  type PermissionMode,
} from '@modules/permission/PermissionMode';

export type {
  PermissionBehavior,
  PermissionRuleSource,
  PermissionRuleValue,
  PermissionRule,
  PermissionUpdateDestination,
  PermissionUpdate,
} from '@modules/permission/PermissionRule';

export {
  permissionRuleValueFromString,
  permissionRuleValueToString,
} from '@modules/permission/PermissionRule';

export type {
  PermissionDecisionReason,
  PermissionResult,
  PermissionAllowDecision,
  PermissionDenyDecision,
  PermissionAskDecision,
  PermissionPassthroughDecision,
  PermissionDecision,
} from '@modules/permission/PermissionResult';

export {
  getRuleBehaviorDescription,
  createAllowDecision,
  createDenyDecision,
  createAskDecision,
  createPassthroughDecision,
} from '@modules/permission/PermissionResult';

export {
  getEmptyToolPermissionContext,
  getAllowRules,
  getDenyRules,
  getAskRules,
  getRuleByContentsForToolName,
  hasPermissionsToUseTool,
  type ToolPermissionContext,
} from '@modules/permission/permissions';

export {
  checkReadPermissionForTool,
  checkWritePermissionForTool,
  isDangerousFile,
  isInDangerousDirectory,
  containsPathTraversal,
  isWithinWorkingDirectory,
  DANGEROUS_FILES,
  DANGEROUS_DIRECTORIES,
} from '@modules/permission/filesystem';

export {
  loadPermissionsFromSettings,
  loadAllPermissionSettings,
} from '@modules/permission/permissionsLoader';

export {
  applyPermissionUpdate,
  persistPermissionUpdates,
  type PermissionUpdateOperation,
} from '@modules/permission/PermissionUpdateSchema';

export * from '@modules/permission/EnhancedPermissionEngine.js';

export {
  PermissionCacheKey,
  PermissionCacheItem,
  PermissionCache,
  PermissionRuleValidator,
  permissionCache,
  generateInputHash,
  checkPermissionsWithCache,
} from '@modules/permission/cache/PermissionCache';

export {
  checkDangerousCommand,
  validatePath,
  checkFileOperationPermission,
  checkNetworkOperationPermission,
  checkProcessOperationPermission,
  PermissionPolicyManager,
} from '@modules/permission/policies/PermissionPolicies';
