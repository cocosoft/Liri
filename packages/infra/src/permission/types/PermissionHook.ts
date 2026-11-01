/**
 * 权限钩子类型定义
 */

/**
 * 权限钩子决策类型
 */
export type PermissionHookBehavior = 'allow' | 'deny' | 'ask' | 'passthrough';

/**
 * 权限钩子决策
 */
export interface PermissionHookDecision {
  /**
   * 决策行为
   */
  behavior: PermissionHookBehavior;

  /**
   * 更新后的输入（可选）
   */
  updatedInput?: Record<string, unknown>;

  /**
   * 决策消息（可选）
   */
  message?: string;

  /**
   * 更新的权限规则（可选）
   */
  updatedPermissions?: PermissionUpdate[];
}

/**
 * 权限更新
 */
export interface PermissionUpdate {
  /**
   * 规则行为
   */
  behavior: 'allow' | 'deny' | 'ask';

  /**
   * 工具名称
   */
  toolName: string;

  /**
   * 规则内容（可选）
   */
  ruleContent?: string;

  /**
   * 规则来源（可选）
   */
  source?: string;
}

/**
 * 权限钩子执行上下文
 */
export interface PermissionHookContext {
  /**
   * 工具名称
   */
  toolName: string;

  /**
   * 工具使用ID
   */
  toolUseID: string;

  /**
   * 工具输入
   */
  input: Record<string, unknown>;

  /**
   * 权限上下文
   */
  context: any;

  /**
   * 权限模式
   */
  permissionMode?: string;

  /**
   * 建议的权限更新
   */
  suggestions?: PermissionUpdate[];

  /**
   * 终止信号
   */
  abortSignal?: AbortSignal;
}

/**
 * 权限钩子类型
 */
export type PermissionHook = (
  context: PermissionHookContext
) => Promise<PermissionHookDecision | null>;

/**
 * 权限钩子元数据
 */
export interface PermissionHookMetadata {
  /**
   * 钩子名称
   */
  name: string;

  /**
   * 钩子描述
   */
  description?: string;

  /**
   * 钩子优先级（数字越小优先级越高）
   */
  priority?: number;

  /**
   * 是否启用
   */
  enabled?: boolean;
}

/**
 * 注册的权限钩子
 */
export interface RegisteredPermissionHook {
  /**
   * 钩子元数据
   */
  metadata: PermissionHookMetadata;

  /**
   * 钩子函数
   */
  hook: PermissionHook;
}
