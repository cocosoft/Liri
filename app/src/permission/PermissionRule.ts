/**
 * 权限规则类型定义（基于CC源码 types/permissions.ts + utils/permissions/PermissionRule.ts）
 */

export type PermissionBehavior = 'allow' | 'deny' | 'ask';

export type PermissionRuleSource =
  | 'userSettings'
  | 'projectSettings'
  | 'localSettings'
  | 'flagSettings'
  | 'policySettings'
  | 'cliArg'
  | 'command'
  | 'session';

export type PermissionRuleValue = {
  toolName: string;
  ruleContent?: string;
};

export type PermissionRule = {
  source: PermissionRuleSource;
  ruleBehavior: PermissionBehavior;
  ruleValue: PermissionRuleValue;
};

export type PermissionUpdateDestination =
  | 'userSettings'
  | 'projectSettings'
  | 'localSettings'
  | 'session'
  | 'cliArg';

export type PermissionUpdate =
  | {
      type: 'addRules';
      destination: PermissionUpdateDestination;
      rules: PermissionRule[];
    }
  | {
      type: 'replaceRules';
      destination: PermissionUpdateDestination;
      rules: PermissionRule[];
    }
  | {
      type: 'removeRules';
      destination: PermissionUpdateDestination;
      toolNames: string[];
    };

export function permissionRuleValueFromString(
  ruleString: string
): PermissionRuleValue {
  const matches = ruleString.match(/^([^(]+)(?:\(([^)]+)\))?$/);
  if (!matches) {
    return { toolName: ruleString };
  }
  return {
    toolName: matches[1],
    ruleContent: matches[2],
  };
}

export function permissionRuleValueToString(
  ruleValue: PermissionRuleValue
): string {
  if (ruleValue.ruleContent) {
    return `${ruleValue.toolName}(${ruleValue.ruleContent})`;
  }
  return ruleValue.toolName;
}
