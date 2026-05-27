/**
 * 权限工具模块导出
 */

export {
  PermissionUpdateValidator,
  PermissionUpdateManager,
  permissionUpdateManager,
} from './PermissionUpdate.js';
export type {
  PermissionUpdate,
  PermissionUpdateType,
  PermissionUpdateScope,
  PermissionUpdateValidation,
  PermissionUpdateConfig,
} from './PermissionUpdate.js';

export {
  ShadowedRuleDetector,
  shadowedRuleDetector,
} from './ShadowedRuleDetector.js';
export type {
  ShadowedRuleInfo,
  ShadowedRuleDetectionResult,
} from './ShadowedRuleDetector.js';

export {
  BypassPermissionsKillswitch,
  bypassPermissionsKillswitch,
} from './BypassPermissionsKillswitch.js';
export type {
  BypassKillswitchConfig,
  BypassEvent,
  BypassStats,
} from './BypassPermissionsKillswitch.js';
