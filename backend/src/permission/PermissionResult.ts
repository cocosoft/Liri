/**
 * 权限决策结果类型定义（基于CC源码 types/permissions.ts）
 */

export type PermissionBehavior = 'allow' | 'deny' | 'ask';

export type PermissionDecisionReason =
  | { type: 'rule'; rule: PermissionRule; source: PermissionRuleSource }
  | { type: 'config'; source: string }
  | { type: 'hook'; hookName: string; reason?: string }
  | { type: 'classifier'; classifier: string; reason?: string }
  | { type: 'default' };

export type PermissionResult<Input = Record<string, unknown>> = {
  behavior: PermissionBehavior;
  updatedInput?: Input;
  decisionReason?: PermissionDecisionReason;
  message?: string;
};

export type PermissionAllowDecision<Input = Record<string, unknown>> =
  PermissionResult<Input> & { behavior: 'allow' };

export type PermissionDenyDecision<Input = Record<string, unknown>> =
  PermissionResult<Input> & { behavior: 'deny' };

export type PermissionAskDecision<Input = Record<string, unknown>> =
  PermissionResult<Input> & { behavior: 'ask' };

export type PermissionDecision<Input = Record<string, unknown>> =
  | PermissionAllowDecision<Input>
  | PermissionDenyDecision<Input>
  | PermissionAskDecision<Input>;

import type { PermissionRule, PermissionRuleSource } from './PermissionRule';

export function getRuleBehaviorDescription(behavior: PermissionBehavior): string {
  switch (behavior) {
    case 'allow':
      return 'allowed';
    case 'deny':
      return 'denied';
    default:
      return 'asked for confirmation for';
  }
}
