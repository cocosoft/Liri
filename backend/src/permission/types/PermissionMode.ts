/**
 * 权限模式枚举
 */
export enum PermissionMode {
  /**
   * 默认模式，根据规则和工具特性决定
   */
  DEFAULT = 'default',

  /**
   * 自动模式，使用AI分类器进行决策
   */
  AUTO = 'auto',

  /**
   * 询问模式，每次都询问用户
   */
  ASK = 'ask',

  /**
   * 总是询问模式，强制询问（即使有规则允许）
   */
  ALWAYS_ASK = 'alwaysAsk',

  /**
   * 不询问模式，直接拒绝
   */
  DONT_ASK = 'dontAsk',

  /**
   * 绕过权限检查
   */
  BYPASS_PERMISSIONS = 'bypassPermissions',

  /**
   * 计划模式
   */
  PLAN = 'plan',

  /**
   * 接受编辑模式，自动批准编辑类操作
   */
  ACCEPT_EDITS = 'acceptEdits',
}

/**
 * 获取权限模式的描述
 * @param mode 权限模式
 * @returns 权限模式的描述
 */
export function getPermissionModeDescription(mode: PermissionMode): string {
  switch (mode) {
    case PermissionMode.DEFAULT:
      return '默认模式，根据规则和工具特性决定';
    case PermissionMode.AUTO:
      return '自动模式，使用AI分类器进行决策';
    case PermissionMode.ASK:
      return '询问模式，每次都询问用户';
    case PermissionMode.ALWAYS_ASK:
      return '总是询问模式，强制询问（即使有规则允许）';
    case PermissionMode.DONT_ASK:
      return '不询问模式，直接拒绝';
    case PermissionMode.BYPASS_PERMISSIONS:
      return '绕过权限检查';
    case PermissionMode.PLAN:
      return '计划模式';
    default:
      return '未知权限模式';
  }
}
