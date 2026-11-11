/**
 * 权限上下文类型
 * 参考CC_CODE的权限系统设计，适应backend现有架构
 */

import type { PermissionMode } from '../../common/permissionMode';

/**
 * 权限模式类型（2026-11-11：**不再本地定义**）
 *
 * 旧值域 `'default' | 'auto' | 'strict' | 'bypass'` 是第三套副本 —— 含已废弃的 `strict`，
 * 又缺真实判定在用的 `plan` / `dontAsk`，与 `PERMISSION_MODES` 长期不一致。
 * 现在同名转出 `common/permissionMode` 的唯一真源（5 档），消费方 import 路径不变。
 */
export type ToolPermissionMode = PermissionMode;

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
 * ⚠️ 本文件 L9 的 `ToolPermissionMode` 已于 2026-11-11 改为 `common/permissionMode` 的
 * 同名转出（值域同源，5 档）；不再保留本地副本。
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
