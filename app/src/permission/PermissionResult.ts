import { PermissionBehavior } from './types/PermissionRule';
import type { PermissionRuleSource } from './types/PermissionRule';
import type { PermissionRuleEntry } from './PermissionRule';

export type PermissionDecisionReason =
  | { type: 'rule'; rule: PermissionRuleEntry; source: PermissionRuleSource }
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
  PermissionResult<Input> & { behavior: PermissionBehavior.ALLOW };

export type PermissionDenyDecision<Input = Record<string, unknown>> =
  PermissionResult<Input> & { behavior: PermissionBehavior.DENY };

export type PermissionAskDecision<Input = Record<string, unknown>> =
  PermissionResult<Input> & {
    behavior: PermissionBehavior.ASK;
    suggestions?: Array<{ value: string; label: string }>;
  };

export type PermissionPassthroughDecision<Input = Record<string, unknown>> =
  PermissionResult<Input> & { behavior: PermissionBehavior.PASSTHROUGH };

export type PermissionDecision<Input = Record<string, unknown>> =
  | PermissionAllowDecision<Input>
  | PermissionDenyDecision<Input>
  | PermissionAskDecision<Input>
  | PermissionPassthroughDecision<Input>;

export function getRuleBehaviorDescription(
  behavior: PermissionBehavior
): string {
  switch (behavior) {
    case PermissionBehavior.ALLOW:
      return 'allowed';
    case PermissionBehavior.DENY:
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
    behavior: PermissionBehavior.ALLOW,
    updatedInput,
    decisionReason: reason,
  };
}

export function createDenyDecision<Input = Record<string, unknown>>(
  message?: string,
  reason?: PermissionDecisionReason
): PermissionDenyDecision<Input> {
  return {
    behavior: PermissionBehavior.DENY,
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
    behavior: PermissionBehavior.ASK,
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
    behavior: PermissionBehavior.PASSTHROUGH,
    message,
    decisionReason: reason,
  };
}
