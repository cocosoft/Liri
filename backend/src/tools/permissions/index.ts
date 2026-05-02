/**
 * 权限模块索引
 * 从 src/permissions 重新导出
 */

export {
  PermissionMode,
  permissionModeTitle,
  isAutoMode,
  shouldAvoidPermissionPrompts,
} from '../../permissions/PermissionMode';

export {
  createAllowDecision,
  createDenyDecision,
  createAskDecision,
  createPassthroughDecision,
  type PermissionDecision,
  type PermissionResult,
} from '../../permissions/PermissionResult';

export {
  parsePermissionRule,
  serializePermissionRule,
  ruleMatches,
  type PermissionRule,
} from '../../permissions/PermissionRule';

export {
  permissionCache,
  PermissionRuleValidator,
  generateInputHash,
} from '../../permissions/permissionCache';

export { PermissionPolicyManager } from '../../permissions/permissionPolicies';

export {
  hasPermissionsToUseTool,
  type ToolPermissionContext,
  type ToolUseContext,
} from '../../permissions/permissions';

export { createPermissionManager } from '../../permission/PermissionManager';
