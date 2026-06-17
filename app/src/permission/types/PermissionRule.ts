/**
 * 权限行为枚举
 */

import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { handleError } from '@modules/error/handleError';

const logger = new Logger({ level: LogLevel.INFO });

export enum PermissionBehavior {
  /**
   * 允许使用工具
   */
  ALLOW = 'allow',

  /**
   * 拒绝使用工具
   */
  DENY = 'deny',

  /**
   * 询问是否使用工具
   */
  ASK = 'ask',

  /**
   * 透传（不拦截，放行）
   */
  PASSTHROUGH = 'passthrough',
}

/**
 * 权限规则来源枚举（8个来源）
 */
export enum PermissionRuleSource {
  /**
   * 用户设置
   */
  USER_SETTINGS = 'userSettings',

  /**
   * 项目设置
   */
  PROJECT_SETTINGS = 'projectSettings',

  /**
   * 本地设置
   */
  LOCAL_SETTINGS = 'localSettings',

  /**
   * 标志设置
   */
  FLAG_SETTINGS = 'flagSettings',

  /**
   * 策略设置
   */
  POLICY_SETTINGS = 'policySettings',

  /**
   * CLI参数
   */
  CLI_ARG = 'cliArg',

  /**
   * 命令
   */
  COMMAND = 'command',

  /**
   * 系统
   */
  SYSTEM = 'system',

  /**
   * 会话
   */
  SESSION = 'session',
}

/**
 * 权限规则接口
 */
export interface PermissionRule {
  /**
   * 规则ID
   */
  id: string;

  /**
   * 权限行为
   */
  behavior: PermissionBehavior;

  /**
   * 工具名称
   */
  toolName: string;

  /**
   * 内容模式（可选）
   */
  contentPattern?: string;

  /**
   * 规则来源
   */
  source: PermissionRuleSource;

  /**
   * 规则优先级
   */
  priority: number;

  /**
   * 创建时间
   */
  createdAt: Date;

  /**
   * 更新时间
   */
  updatedAt: Date;
}

/**
 * 创建权限规则
 * @param params 规则参数
 * @returns 权限规则对象
 */
export function createPermissionRule(params: {
  behavior: PermissionBehavior;
  toolName: string;
  contentPattern?: string;
  source?: PermissionRuleSource;
  priority?: number;
}): PermissionRule {
  const now = new Date();
  return {
    id: `rule_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    behavior: params.behavior,
    toolName: params.toolName,
    contentPattern: params.contentPattern,
    source: params.source || PermissionRuleSource.USER_SETTINGS,
    priority: params.priority || 1,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * 权限规则值（用于规则解析）
 */
export interface PermissionRuleValue {
  /**
   * 工具名称
   */
  toolName: string;

  /**
   * 规则内容（可选）
   */
  ruleContent?: string;
}

/**
 * 权限规则匹配选项
 */
export interface RuleMatchOptions {
  /**
   * 是否启用 glob 模式匹配
   * @default true
   */
  enableGlob?: boolean;
}

/**
 * 将 glob 模式转换为正则表达式
 * @param glob glob 模式
 * @returns 正则表达式
 */
export function globToRegex(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
}

/**
 * 检查字符串是否匹配 glob 模式
 * @param str 要检查的字符串
 * @param pattern glob 模式
 * @returns 是否匹配
 */
export function matchGlob(str: string, pattern: string): boolean {
  const regex = globToRegex(pattern);
  return regex.test(str);
}

/**
 * 从字符串解析权限规则值
 * 格式："ToolName" 或 "ToolName(content)" 或 "ToolName*" (glob模式)
 * @param ruleString 规则字符串
 * @returns 权限规则值
 */
export function permissionRuleValueFromString(
  ruleString: string
): PermissionRuleValue {
  const trimmed = ruleString.trim();

  // 检查是否有括号格式
  const openParenIndex = trimmed.indexOf('(');
  const closeParenIndex = trimmed.lastIndexOf(')');

  if (
    openParenIndex !== -1 &&
    closeParenIndex !== -1 &&
    closeParenIndex > openParenIndex
  ) {
    const toolName = trimmed.substring(0, openParenIndex).trim();
    const ruleContent = trimmed
      .substring(openParenIndex + 1, closeParenIndex)
      .trim();
    return { toolName, ruleContent };
  }

  // 简单格式，只有工具名称
  return { toolName: trimmed };
}

/**
 * 将权限规则值转换为字符串
 * @param ruleValue 权限规则值
 * @returns 规则字符串
 */
export function permissionRuleValueToString(
  ruleValue: PermissionRuleValue
): string {
  if (ruleValue.ruleContent) {
    return `${ruleValue.toolName}(${ruleValue.ruleContent})`;
  }
  return ruleValue.toolName;
}

/**
 * 检查权限规则是否匹配工具和输入
 * @param rule 权限规则
 * @param toolName 工具名称
 * @param input 工具输入
 * @param options 匹配选项
 * @returns 是否匹配
 */
export function isRuleMatch(
  rule: PermissionRule,
  toolName: string,
  input: Record<string, unknown>,
  options: RuleMatchOptions = {}
): boolean {
  const enableGlob = options.enableGlob !== false;

  // 检查工具名称是否匹配
  if (
    enableGlob &&
    (rule.toolName.includes('*') || rule.toolName.includes('?'))
  ) {
    // 使用 glob 模式匹配
    if (!matchGlob(toolName, rule.toolName)) {
      return false;
    }
  } else {
    // 精确匹配
    if (rule.toolName !== toolName) {
      return false;
    }
  }

  // 如果没有内容模式，则匹配所有输入
  if (!rule.contentPattern) {
    return true;
  }

  // 检查内容模式是否匹配
  try {
    const inputString = JSON.stringify(input);
    const pattern = new RegExp(rule.contentPattern);
    return pattern.test(inputString);
  } catch (error) {
    void handleError(error, {
      module: 'permission:rule',
      action: 'check_rule_match',
    });
    return false;
  }
}

/**
 * 检查工具名称是否匹配规则（支持 glob 模式）
 * @param toolName 工具名称
 * @param rulePattern 规则模式
 * @returns 是否匹配
 */
export function isToolNameMatch(
  toolName: string,
  rulePattern: string
): boolean {
  if (rulePattern.includes('*') || rulePattern.includes('?')) {
    return matchGlob(toolName, rulePattern);
  }
  return toolName === rulePattern;
}
