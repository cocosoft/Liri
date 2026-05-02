/**
 * 权限模式定义
 */

export type PermissionMode =
  | 'default'
  | 'auto'
  | 'acceptEdits'
  | 'dontAsk'
  | 'plan';

/**
 * 权限模式配置
 */
export interface PermissionModeConfig {
  mode: PermissionMode;
  shouldAvoidPermissionPrompts?: boolean;
}

/**
 * 获取权限模式的显示名称
 */
export function permissionModeTitle(mode: PermissionMode): string {
  switch (mode) {
    case 'default':
      return 'Default';
    case 'auto':
      return 'Auto';
    case 'acceptEdits':
      return 'Accept Edits';
    case 'dontAsk':
      return "Don't Ask";
    case 'plan':
      return 'Plan';
    default:
      return mode;
  }
}

/**
 * 检查权限模式是否允许自动操作
 */
export function isAutoMode(mode: PermissionMode): boolean {
  return mode === 'auto' || mode === 'acceptEdits';
}

/**
 * 检查权限模式是否应该避免权限提示
 */
export function shouldAvoidPermissionPrompts(mode: PermissionMode): boolean {
  return mode === 'dontAsk';
}
