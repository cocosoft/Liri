/**
 * 权限上下文类型
 * 参考CC_CODE的权限系统设计，适应backend现有架构
 */

/**
 * 权限模式类型
 */
export type PermissionMode = 'default' | 'auto' | 'strict' | 'bypass';

/**
 * 额外工作目录类型
 */
export interface AdditionalWorkingDirectory {
  path: string;
  isReadOnly: boolean;
  isAllowed: boolean;
}

/**
 * 工具权限规则按来源分类
 */
export type ToolPermissionRulesBySource = Record<string, any[]>;

/**
 * 工具权限上下文类型
 */
export interface ToolPermissionContext {
  /**
   * 权限模式
   */
  mode: PermissionMode;

  /**
   * 额外工作目录
   */
  additionalWorkingDirectories: Map<string, AdditionalWorkingDirectory>;

  /**
   * 始终允许的规则
   */
  alwaysAllowRules: ToolPermissionRulesBySource;

  /**
   * 始终拒绝的规则
   */
  alwaysDenyRules: ToolPermissionRulesBySource;

  /**
   * 始终询问的规则
   */
  alwaysAskRules: ToolPermissionRulesBySource;

  /**
   * 是否可以使用绕过权限模式
   */
  isBypassPermissionsModeAvailable: boolean;

  /**
   * 是否可以使用自动模式
   */
  isAutoModeAvailable?: boolean;

  /**
   * 剥离的危险规则
   */
  strippedDangerousRules?: ToolPermissionRulesBySource;

  /**
   * 是否应该避免权限提示
   */
  shouldAvoidPermissionPrompts?: boolean;

  /**
   * 是否应该在对话框前等待自动检查
   */
  awaitAutomatedChecksBeforeDialog?: boolean;

  /**
   * 计划模式前的权限模式
   */
  prePlanMode?: PermissionMode;
}

/**
 * 获取空工具权限上下文
 */
export function getEmptyToolPermissionContext(): ToolPermissionContext {
  return {
    mode: 'default',
    additionalWorkingDirectories: new Map(),
    alwaysAllowRules: {},
    alwaysDenyRules: {},
    alwaysAskRules: {},
    isBypassPermissionsModeAvailable: false,
  };
}
