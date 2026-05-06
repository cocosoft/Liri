/**
 * 权限模块索引
 * 从 src/permissions 重新导出
 */

export {
  PermissionMode,
  permissionModeTitle,
  isAutoMode,
  shouldAvoidPermissionPrompts,
} from '@modules/permissions/PermissionMode';

export {
  createAllowDecision,
  createDenyDecision,
  createAskDecision,
  createPassthroughDecision,
  type PermissionDecision,
  type PermissionResult,
} from '@modules/permissions/PermissionResult';

export {
  parsePermissionRule,
  serializePermissionRule,
  ruleMatches,
  type PermissionRule,
} from '@modules/permissions/PermissionRule';

export {
  permissionCache,
  PermissionRuleValidator,
  generateInputHash,
} from '@modules/permissions/permissionCache';

export { PermissionPolicyManager } from '@modules/permissions/permissionPolicies';

export {
  hasPermissionsToUseTool,
  type ToolPermissionContext,
  type ToolUseContext,
} from '@modules/permissions/permissions';

export { createPermissionManager } from '@modules/permission/PermissionManager';
