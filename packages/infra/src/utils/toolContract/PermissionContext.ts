/**
 * 权限上下文类型
 * 参考CC_CODE的权限系统设计，适应backend现有架构
 */

/**
 * 权限模式类型
 */
export type ToolPermissionMode = 'default' | 'auto' | 'strict' | 'bypass';

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
 * 工具**执行期**权限上下文类型
 *
 * 2026-10-01 数据契约专项 U5（#2）：原名 `ToolPermissionContext`，与**权限域事实源**
 * `permission/permissions.ts:11` **同名不同物** —— 本版为「超集 + 类型劣化」
 * （`additionalWorkingDirectories` 为 `Map<string, AdditionalWorkingDirectory>`（对方 `string[]`）；
 * `always*Rules` 为 `Record<string, any[]>`（对方 `Record<PermissionRuleSource, string[]>`）；
 * 另多 5 个执行期开关）⇒ 依 §9.2 原则 2「一名一规范落点」**改名**为
 * **`ToolRuntimePermissionContext`**（权限域那份保留 `ToolPermissionContext`）。
 *
 * ⚠️ 本文件 L9 的 `PermissionMode` 亦与 `permission/PermissionMode.ts` **同名两份**
 * （待 U5 后续处置：本地应改为从 `permission` 再导出，值域须同源）。
 */
export interface ToolRuntimePermissionContext {
  /**
   * 权限模式
   */
  mode: ToolPermissionMode;

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
  prePlanMode?: ToolPermissionMode;
}

/**
 * 获取空工具权限上下文
 */
export function getEmptyToolPermissionContext(): ToolRuntimePermissionContext {
  return {
    mode: 'default',
    additionalWorkingDirectories: new Map(),
    alwaysAllowRules: {},
    alwaysDenyRules: {},
    alwaysAskRules: {},
    isBypassPermissionsModeAvailable: false,
  };
}
