/**
 * 权限检查结果定义
 */

import type { PermissionRule } from './PermissionRule.js';
import type { PermissionMode } from './PermissionMode.js';

export interface PermissionDecisionReason {
  type: 'rule' | 'hook' | 'classifier' | 'mode' | 'safetyCheck' | 'other';
  rule?: PermissionRule;
  hookName?: string;
  classifier?: string;
  mode?: PermissionMode;
  reason?: string;
  classifierApprovable?: boolean;
}

export interface PermissionAllowDecision {
  behavior: 'allow';
  updatedInput?: { [key: string]: unknown };
  decisionReason?: PermissionDecisionReason;
}

export interface PermissionDenyDecision {
  behavior: 'deny';
  message?: string;
  decisionReason?: PermissionDecisionReason;
}

export interface PermissionAskDecision {
  behavior: 'ask';
  message?: string;
  decisionReason?: PermissionDecisionReason;
  suggestions?: Array<{
    value: string;
    label: string;
  }>;
}

export interface PermissionPassthroughDecision {
  behavior: 'passthrough';
  message?: string;
  decisionReason?: PermissionDecisionReason;
}

export type PermissionDecision =
  | PermissionAllowDecision
  | PermissionDenyDecision
  | PermissionAskDecision
  | PermissionPassthroughDecision;

export type PermissionResult = PermissionDecision;

/**
 * 创建允许的权限决策
 */
export function createAllowDecision(
  updatedInput?: { [key: string]: unknown },
  reason?: PermissionDecisionReason
): PermissionAllowDecision {
  return {
    behavior: 'allow',
    updatedInput,
    decisionReason: reason,
  };
}

/**
 * 创建拒绝的权限决策
 */
export function createDenyDecision(
  message?: string,
  reason?: PermissionDecisionReason
): PermissionDenyDecision {
  return {
    behavior: 'deny',
    message,
    decisionReason: reason,
  };
}

/**
 * 创建询问的权限决策
 */
export function createAskDecision(
  message?: string,
  reason?: PermissionDecisionReason,
  suggestions?: Array<{
    value: string;
    label: string;
  }>
): PermissionAskDecision {
  return {
    behavior: 'ask',
    message,
    decisionReason: reason,
    suggestions,
  };
}

/**
 * 创建传递的权限决策
 */
export function createPassthroughDecision(
  message?: string,
  reason?: PermissionDecisionReason
): PermissionPassthroughDecision {
  return {
    behavior: 'passthrough',
    message,
    decisionReason: reason,
  };
}
