/**
 * 权限决策结果类型定义（基于CC源码 types/permissions.ts）
 */

export type PermissionBehavior = 'allow' | 'deny' | 'ask' | 'passthrough';

export type PermissionDecisionReason =
  | { type: 'rule'; rule: PermissionRule; source: PermissionRuleSource }
  | { type: 'config'; source: string }
  | { type: 'hook'; hookName: string; reason?: string }
  | { type: 'classifier'; classifier: string; reason?: string }
  | { type: 'safetyCheck'; reason: string }
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
  PermissionResult<Input> & {
    behavior: 'ask';
    suggestions?: Array<{ value: string; label: string }>;
  };

export type PermissionPassthroughDecision<Input = Record<string, unknown>> =
  PermissionResult<Input> & { behavior: 'passthrough' };

export type PermissionDecision<Input = Record<string, unknown>> =
  | PermissionAllowDecision<Input>
  | PermissionDenyDecision<Input>
  | PermissionAskDecision<Input>
  | PermissionPassthroughDecision<Input>;

import type { PermissionRule, PermissionRuleSource } from './PermissionRule';

export function getRuleBehaviorDescription(
  behavior: PermissionBehavior
): string {
  switch (behavior) {
    case 'allow':
      return 'allowed';
    case 'deny':
      return 'denied';
    default:
      return 'asked for confirmation for';
  }
}

export function createAllowDecision<Input = Record<string, unknown>>(
  updatedInput?: Input,
  reason?: PermissionDecisionReason
): PermissionAllowDecision<Input> {
  return {
    behavior: 'allow',
    updatedInput,
    decisionReason: reason,
  };
}

export function createDenyDecision<Input = Record<string, unknown>>(
  message?: string,
  reason?: PermissionDecisionReason
): PermissionDenyDecision<Input> {
  return {
    behavior: 'deny',
    message,
    decisionReason: reason,
  };
}

export function createAskDecision<Input = Record<string, unknown>>(
  message?: string,
  reason?: PermissionDecisionReason,
  suggestions?: Array<{
    value: string;
    label: string;
  }>
): PermissionAskDecision<Input> {
  return {
    behavior: 'ask',
    message,
    decisionReason: reason,
    suggestions,
  };
}

export function createPassthroughDecision<Input = Record<string, unknown>>(
  message?: string,
  reason?: PermissionDecisionReason
): PermissionPassthroughDecision<Input> {
  return {
    behavior: 'passthrough',
    message,
    decisionReason: reason,
  };
}
