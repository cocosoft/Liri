/**
 * 权限规则定义
 */

export type PermissionBehavior = 'allow' | 'deny' | 'ask';

export type PermissionRuleSource =
  | 'default'
  | 'env'
  | 'file'
  | 'runtime'
  | 'cliArg'
  | 'command'
  | 'session';

export interface PermissionRuleValue {
  toolName: string;
  ruleContent?: string;
}

export interface PermissionRule {
  source: PermissionRuleSource;
  ruleBehavior: PermissionBehavior;
  ruleValue: PermissionRuleValue;
}

/**
 * 解析权限规则字符串
 */
export function parsePermissionRule(
  ruleString: string
): PermissionRuleValue | null {
  const match = ruleString.match(/^([^\(]+)(?:\((.*)\))?$/);
  if (!match) {
    return null;
  }

  const [, toolName, ruleContent] = match;
  return {
    toolName: toolName.trim(),
    ruleContent: ruleContent ? ruleContent.trim() : undefined,
  };
}

/**
 * 序列化权限规则为字符串
 */
export function serializePermissionRule(rule: PermissionRuleValue): string {
  if (rule.ruleContent) {
    return `${rule.toolName}(${rule.ruleContent})`;
  }
  return rule.toolName;
}

/**
 * 检查权限规则是否匹配
 */
export function ruleMatches(
  rule: PermissionRule,
  toolName: string,
  content?: string
): boolean {
  if (rule.ruleValue.toolName !== toolName) {
    return false;
  }

  if (rule.ruleValue.ruleContent === undefined) {
    return true;
  }

  if (content === undefined) {
    return false;
  }

  // 简单的字符串匹配，实际应用中可能需要更复杂的匹配逻辑
  return content.includes(rule.ruleValue.ruleContent);
}
