/**
 * 权限模块索引
 * 从 @modules/permission 重新导出（合并后）
 */

import {
  PERMISSION_MODES,
  PERMISSION_MODE_NAMES,
  shouldAvoidPermissionPrompts as newShouldAvoidPermissionPrompts,
  type PermissionMode as NewPermissionMode,
} from '@modules/permission/PermissionMode';

import {
  permissionRuleValueFromString,
  permissionRuleValueToString,
  type PermissionRule as NewPermissionRule,
  type PermissionRuleValue,
} from '@modules/permission/PermissionRule';

export {
  createAllowDecision,
  createDenyDecision,
  createAskDecision,
  createPassthroughDecision,
  type PermissionDecision,
  type PermissionResult,
  type PermissionBehavior,
  type PermissionDecisionReason,
} from '@modules/permission/PermissionResult';

export type { PermissionRule } from '@modules/permission/PermissionRule';

export {
  permissionCache,
  PermissionRuleValidator,
  generateInputHash,
  checkPermissionsWithCache,
} from '@modules/permission/cache/PermissionCache';

export { PermissionPolicyManager } from '@modules/permission/policies/PermissionPolicies';

export {
  hasPermissionsToUseTool,
  getEmptyToolPermissionContext,
  getAllowRules,
  getDenyRules,
  getAskRules,
  getRuleByContentsForToolName,
  type ToolPermissionContext,
} from '@modules/permission/permissions';

export { createPermissionManager } from '@modules/permission/PermissionManager';

export type { PermissionMode } from '@modules/permission/PermissionMode';
export { PERMISSION_MODES, PERMISSION_MODE_NAMES };

export function permissionModeTitle(mode: NewPermissionMode): string {
  return PERMISSION_MODE_NAMES[mode] || mode;
}

export function isAutoMode(mode: NewPermissionMode): boolean {
  return mode === 'acceptEdits';
}

export function shouldAvoidPermissionPrompts(mode: NewPermissionMode): boolean {
  return newShouldAvoidPermissionPrompts(mode);
}

export function parsePermissionRule(
  ruleString: string
): PermissionRuleValue | null {
  return permissionRuleValueFromString(ruleString);
}

export function serializePermissionRule(rule: PermissionRuleValue): string {
  return permissionRuleValueToString(rule);
}

export function ruleMatches(
  rule: NewPermissionRule,
  toolName: string,
  input?: Record<string, unknown>
): boolean {
  if (rule.ruleValue.toolName === '*' || rule.ruleValue.toolName === toolName) {
    return true;
  }
  if (rule.ruleValue.toolName.startsWith('mcp__') && toolName === 'mcp') {
    return (
      input?.['serverName'] === rule.ruleValue.toolName.replace('mcp__', '')
    );
  }
  return false;
}
