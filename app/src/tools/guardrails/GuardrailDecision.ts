/**
 * 护栏决策类型
 * 对标 Hermes 的 GuardrailDecision
 */
import type { ToolUseContext } from '../../tools/types';

/**
 * 护栏动作
 */
export type GuardrailAction = 'allow' | 'warn' | 'block' | 'confirm';

/**
 * 护栏规则条件
 */
export interface GuardrailCondition {
  /** 工具名称匹配（正则） */
  toolNamePattern: string;
  /** 参数键匹配（可选） */
  paramKeyPattern?: string;
  /** 参数值匹配（可选） */
  paramValuePattern?: string;
}

/**
 * 护栏决策
 */
export interface GuardrailDecision {
  /** 决策唯一 ID */
  id: string;
  /** 决策时间 */
  timestamp: number;
  /** 是否允许执行 */
  allowed: boolean;
  /** 执行动作 */
  action: GuardrailAction;
  /** 拒绝原因 */
  reason?: string;
  /** 匹配的规则名称 */
  matchedRule?: string;
  /** 工具使用上下文 */
  context?: ToolUseContext;
}

/**
 * 创建允许的决策
 * @param context 工具使用上下文
 * @returns 决策对象
 */
export function createAllowDecision(
  context?: ToolUseContext
): GuardrailDecision {
  return {
    id: `gd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
    allowed: true,
    action: 'allow',
    context,
  };
}

/**
 * 创建警告的决策（允许但记录）
 * @param reason 警告原因
 * @param ruleName 规则名称
 * @param context 工具使用上下文
 * @returns 决策对象
 */
export function createWarnDecision(
  reason: string,
  ruleName: string,
  context?: ToolUseContext
): GuardrailDecision {
  return {
    id: `gd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
    allowed: true,
    action: 'warn',
    reason,
    matchedRule: ruleName,
    context,
  };
}

/**
 * 创建阻止的决策
 * @param reason 阻止原因
 * @param ruleName 规则名称
 * @param context 工具使用上下文
 * @returns 决策对象
 */
export function createBlockDecision(
  reason: string,
  ruleName: string,
  context?: ToolUseContext
): GuardrailDecision {
  return {
    id: `gd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
    allowed: false,
    action: 'block',
    reason,
    matchedRule: ruleName,
    context,
  };
}

/**
 * 创建确认的决策（需要用户确认）
 * @param reason 确认原因
 * @param ruleName 规则名称
 * @param context 工具使用上下文
 * @returns 决策对象
 */
export function createConfirmDecision(
  reason: string,
  ruleName: string,
  context?: ToolUseContext
): GuardrailDecision {
  return {
    id: `gd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
    allowed: false,
    action: 'confirm',
    reason,
    matchedRule: ruleName,
    context,
  };
}
