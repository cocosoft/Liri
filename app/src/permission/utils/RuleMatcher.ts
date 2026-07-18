/**
 * 规则匹配器
 * 实现工具级和内容级的规则匹配
 *
 * 参考CC源码实现: cc_code/backend/utils/permissions/shellRuleMatching.ts
 */
import {
  PermissionRule,
  PermissionBehavior,
  PermissionRuleSource,
  PermissionRuleValue,
  permissionRuleValueFromString,
  isRuleMatch,
  createPermissionRule,
} from '../types/PermissionRule';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({ module: 'permission:utils:RuleMatcher', level: LogLevel.INFO });

/**
 * 通配符模式类型
 */
export type WildcardPatternType = 'exact' | 'prefix' | 'wildcard';

/**
 * 解析后的权限规则
 */
export interface ParsedPermissionRule {
  type: WildcardPatternType;
  command?: string;
  prefix?: string;
  pattern?: string;
  rawRule: string;
}

/**
 * 工具权限上下文
 */
export interface ToolPermissionContext {
  /**
   * 总是允许的规则（按来源分组）
   */
  alwaysAllowRules: Partial<Record<PermissionRuleSource, string[]>>;

  /**
   * 总是拒绝的规则（按来源分组）
   */
  alwaysDenyRules: Partial<Record<PermissionRuleSource, string[]>>;

  /**
   * 总是询问的规则（按来源分组）
   */
  alwaysAskRules: Partial<Record<PermissionRuleSource, string[]>>;
}

/**
 * 规则匹配结果
 */
export interface RuleMatchResult {
  matched: boolean;
  matchedPortion?: string;
  pattern?: string;
}

/**
 * 转义占位符
 */
const ESCAPED_STAR_PLACEHOLDER = '\x00ESCAPED_STAR\x00';
const ESCAPED_BACKSLASH_PLACEHOLDER = '\x00ESCAPED_BACKSLASH\x00';
const ESCAPED_STAR_PLACEHOLDER_RE = /\x00ESCAPED_STAR\x00/g;
const ESCAPED_BACKSLASH_PLACEHOLDER_RE = /\x00ESCAPED_BACKSLASH\x00/g;

/**
 * 转义通配符
 * @param pattern 模式
 * @returns 转义后的模式
 */
export function escapeWildcards(pattern: string): string {
  return pattern
    .replace(/\\/g, ESCAPED_BACKSLASH_PLACEHOLDER)
    .replace(/\*/g, ESCAPED_STAR_PLACEHOLDER);
}

/**
 * 取消转义
 * @param pattern 模式
 * @returns 取消转义后的模式
 */
export function unescapeWildcards(pattern: string): string {
  return pattern
    .replace(ESCAPED_BACKSLASH_PLACEHOLDER_RE, '\\')
    .replace(ESCAPED_STAR_PLACEHOLDER_RE, '*');
}

/**
 * 从权限规则字符串中提取前缀（用于:*语法）
 * @param permissionRule 权限规则
 * @returns 前缀或null
 */
export function permissionRuleExtractPrefix(
  permissionRule: string
): string | null {
  const match = permissionRule.match(/^(.+):\*$/);
  return match?.[1] ?? null;
}

/**
 * 检查模式是否包含未转义的通配符
 * @param pattern 模式
 * @returns 是否包含通配符
 */
export function hasWildcards(pattern: string): boolean {
  if (pattern.endsWith(':*')) {
    return false;
  }

  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] === '*') {
      let backslashCount = 0;
      let j = i - 1;
      while (j >= 0 && pattern[j] === '\\') {
        backslashCount++;
        j--;
      }
      if (backslashCount % 2 === 0) {
        return true;
      }
    }
  }
  return false;
}

/**
 * 解析权限规则字符串
 * @param rule 规则字符串
 * @returns 解析后的规则
 */
export function parsePermissionRule(rule: string): ParsedPermissionRule {
  const trimmedRule = rule.trim();

  if (trimmedRule.endsWith(':*')) {
    return {
      type: 'prefix',
      prefix: trimmedRule.slice(0, -2),
      rawRule: trimmedRule,
    };
  }

  if (hasWildcards(trimmedRule)) {
    return {
      type: 'wildcard',
      pattern: trimmedRule,
      rawRule: trimmedRule,
    };
  }

  return {
    type: 'exact',
    command: trimmedRule,
    rawRule: trimmedRule,
  };
}

/**
 * 匹配前缀规则
 * @param command 命令
 * @param prefix 前缀
 * @returns 是否匹配
 */
export function matchPrefix(command: string, prefix: string): boolean {
  return command.startsWith(prefix + ' ') || command === prefix;
}

/**
 * 将通配符模式转换为正则表达式
 * @param pattern 通配符模式
 * @returns 正则表达式
 */
export function wildcardToRegex(pattern: string): RegExp {
  let regexStr = escapeWildcards(pattern);

  regexStr = regexStr
    .replace(ESCAPED_STAR_PLACEHOLDER_RE, 'SPLACEHOLDER')
    .replace(ESCAPED_BACKSLASH_PLACEHOLDER_RE, 'BPLACEHOLDER');

  regexStr = regexStr
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/SPLACEHOLDER/g, '.*')
    .replace(/BPLACEHOLDER/g, '\\\\');

  return new RegExp(`^${regexStr}$`);
}

/**
 * 匹配通配符规则
 * @param command 命令
 * @param wildcardPattern 通配符模式
 * @returns 匹配结果
 */
export function matchWildcard(
  command: string,
  wildcardPattern: string
): RuleMatchResult {
  try {
    const regex = wildcardToRegex(wildcardPattern);
    const match = command.match(regex);

    if (match) {
      return {
        matched: true,
        matchedPortion: match[0],
        pattern: wildcardPattern,
      };
    }
  } catch (err) {

    // Invalid regex pattern

    logger.debug("Operation skipped", { context: "Invalid regex pattern", error: err instanceof Error ? err.message : String(err) });

  }

  return { matched: false };
}

/**
 * 匹配权限规则
 * @param rule 权限规则字符串
 * @param command 命令
 * @returns 匹配结果
 */
export function matchPermissionRule(
  rule: string,
  command: string
): RuleMatchResult {
  const parsed = parsePermissionRule(rule);

  switch (parsed.type) {
    case 'exact':
      return {
        matched: command === parsed.command,
        pattern: parsed.command,
      };

    case 'prefix':
      return {
        matched: matchPrefix(command, parsed.prefix!),
        pattern: parsed.prefix,
      };

    case 'wildcard':
      return matchWildcard(command, parsed.pattern!);

    default:
      return { matched: false };
  }
}

/**
 * 规则来源列表（按优先级排序）
 */
export const PERMISSION_RULE_SOURCES: PermissionRuleSource[] = [
  PermissionRuleSource.USER_SETTINGS,
  PermissionRuleSource.PROJECT_SETTINGS,
  PermissionRuleSource.LOCAL_SETTINGS,
  PermissionRuleSource.FLAG_SETTINGS,
  PermissionRuleSource.POLICY_SETTINGS,
  PermissionRuleSource.CLI_ARG,
  PermissionRuleSource.COMMAND,
  PermissionRuleSource.SESSION,
];

/**
 * 获取指定行为的所有规则
 * @param context 权限上下文
 * @param behavior 规则行为
 * @returns 规则列表
 */
export function getRules(
  context: ToolPermissionContext,
  behavior: PermissionBehavior
): PermissionRule[] {
  return PERMISSION_RULE_SOURCES.flatMap((source) => {
    let ruleStrings: string[] | undefined;

    switch (behavior) {
      case PermissionBehavior.ALLOW:
        ruleStrings = context.alwaysAllowRules[source];
        break;
      case PermissionBehavior.DENY:
        ruleStrings = context.alwaysDenyRules[source];
        break;
      case PermissionBehavior.ASK:
        ruleStrings = context.alwaysAskRules[source];
        break;
    }

    if (!ruleStrings) {
      return [];
    }

    return ruleStrings.map((ruleString) => {
      const ruleValue = permissionRuleValueFromString(ruleString);
      return createPermissionRule({
        behavior,
        toolName: ruleValue.toolName,
        contentPattern: ruleValue.ruleContent,
        source,
        priority: 1,
      });
    });
  });
}

/**
 * 获取所有允许规则
 * @param context 权限上下文
 * @returns 允许规则列表
 */
export function getAllowRules(
  context: ToolPermissionContext
): PermissionRule[] {
  return getRules(context, PermissionBehavior.ALLOW);
}

/**
 * 获取所有拒绝规则
 * @param context 权限上下文
 * @returns 拒绝规则列表
 */
export function getDenyRules(context: ToolPermissionContext): PermissionRule[] {
  return getRules(context, PermissionBehavior.DENY);
}

/**
 * 获取所有询问规则
 * @param context 权限上下文
 * @returns 询问规则列表
 */
export function getAskRules(context: ToolPermissionContext): PermissionRule[] {
  return getRules(context, PermissionBehavior.ASK);
}

/**
 * 检查工具是否匹配规则（工具级匹配）
 * @param toolName 工具名称
 * @param rule 权限规则
 * @returns 是否匹配
 */
export function toolMatchesRule(
  toolName: string,
  rule: PermissionRule
): boolean {
  // 如果规则有ruleContent，不匹配整个工具
  if (rule.contentPattern) {
    return false;
  }

  // 直接工具名称匹配
  return rule.toolName === toolName;
}

/**
 * 检查工具是否在alwaysAllow规则中
 * @param context 权限上下文
 * @param toolName 工具名称
 * @returns 匹配的规则，或null
 */
export function toolAlwaysAllowedRule(
  context: ToolPermissionContext,
  toolName: string
): PermissionRule | null {
  return (
    getAllowRules(context).find((rule) => toolMatchesRule(toolName, rule)) ||
    null
  );
}

/**
 * 检查工具是否在alwaysDeny规则中
 * @param context 权限上下文
 * @param toolName 工具名称
 * @returns 匹配的规则，或null
 */
export function getDenyRuleForTool(
  context: ToolPermissionContext,
  toolName: string
): PermissionRule | null {
  return (
    getDenyRules(context).find((rule) => toolMatchesRule(toolName, rule)) ||
    null
  );
}

/**
 * 检查工具是否在alwaysAsk规则中
 * @param context 权限上下文
 * @param toolName 工具名称
 * @returns 匹配的规则，或null
 */
export function getAskRuleForTool(
  context: ToolPermissionContext,
  toolName: string
): PermissionRule | null {
  return (
    getAskRules(context).find((rule) => toolMatchesRule(toolName, rule)) || null
  );
}

/**
 * 获取工具的内容级规则映射
 * @param context 权限上下文
 * @param toolName 工具名称
 * @param behavior 规则行为
 * @returns 规则内容到规则的映射
 */
export function getRuleByContentsForTool(
  context: ToolPermissionContext,
  toolName: string,
  behavior: PermissionBehavior
): Map<string, PermissionRule> {
  const ruleByContents = new Map<string, PermissionRule>();
  const rules = getRules(context, behavior);

  for (const rule of rules) {
    if (
      rule.toolName === toolName &&
      rule.contentPattern &&
      rule.behavior === behavior
    ) {
      ruleByContents.set(rule.contentPattern, rule);
    }
  }

  return ruleByContents;
}

/**
 * 匹配规则（完整匹配：先工具级，后内容级）
 * @param context 权限上下文
 * @param toolName 工具名称
 * @param input 工具输入
 * @returns 匹配的规则，按优先级排序
 */
export function matchRules(
  context: ToolPermissionContext,
  toolName: string,
  input: Record<string, unknown>
): {
  allow: PermissionRule | null;
  deny: PermissionRule | null;
  ask: PermissionRule | null;
} {
  // 先检查工具级规则
  const allowToolRule = toolAlwaysAllowedRule(context, toolName);
  const denyToolRule = getDenyRuleForTool(context, toolName);
  const askToolRule = getAskRuleForTool(context, toolName);

  if (allowToolRule || denyToolRule || askToolRule) {
    return {
      allow: allowToolRule,
      deny: denyToolRule,
      ask: askToolRule,
    };
  }

  // 再检查内容级规则
  const allRules = [
    ...getAllowRules(context),
    ...getDenyRules(context),
    ...getAskRules(context),
  ];

  let allowRule: PermissionRule | null = null;
  let denyRule: PermissionRule | null = null;
  let askRule: PermissionRule | null = null;

  for (const rule of allRules) {
    if (isRuleMatch(rule, toolName, input)) {
      switch (rule.behavior) {
        case PermissionBehavior.ALLOW:
          if (!allowRule) allowRule = rule;
          break;
        case PermissionBehavior.DENY:
          if (!denyRule) denyRule = rule;
          break;
        case PermissionBehavior.ASK:
          if (!askRule) askRule = rule;
          break;
      }
    }
  }

  return { allow: allowRule, deny: denyRule, ask: askRule };
}
