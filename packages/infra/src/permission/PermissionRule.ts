/**
 * 权限规则类型定义
 * 只包含顶层特有的类型，共享类型统一在 types/PermissionRule.ts 中定义
 */

/**
 * 权限规则条目（简单传输对象）
 * 用于运行时规则操作，区别于 types/PermissionRule 中的完整领域模型
 */
export type PermissionRuleEntry = {
  source: import('./types/PermissionRule.js').PermissionRuleSource;
  ruleBehavior: import('./types/PermissionRule.js').PermissionBehavior;
  ruleValue: import('./types/PermissionRule.js').PermissionRuleValue;
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
      rules: PermissionRuleEntry[];
    }
  | {
      type: 'replaceRules';
      destination: PermissionUpdateDestination;
      rules: PermissionRuleEntry[];
    }
  | {
      type: 'removeRules';
      destination: PermissionUpdateDestination;
      toolNames: string[];
    };
