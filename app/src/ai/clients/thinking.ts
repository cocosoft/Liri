/**
 * Extended Thinking 配置类型定义
 * 支持 Claude extended thinking 配置，包含 effort 值（low/medium/high）和 thinking budget token 控制
 */

export type ThinkingEffort = 'low' | 'medium' | 'high';

export type ThinkingConfig =
  | { type: 'adaptive' }
  | { type: 'enabled'; budgetTokens: number }
  | { type: 'disabled' };

import { configManager } from '@modules/config';

export interface ThinkingOptions {
  effort?: ThinkingEffort;
  budgetTokens?: number;
  enabled?: boolean;
}

export const DEFAULT_THINKING_BUDGET_TOKENS = 16000;
export const DEFAULT_THINKING_EFFORT: ThinkingEffort = 'medium';

export const EFFORT_TO_BUDGET: Record<ThinkingEffort, number> = {
  low: 4000,
  medium: 16000,
  high: 32000,
};

export function buildThinkingConfig(
  options: ThinkingOptions = {},
  model?: string
): ThinkingConfig {
  if (options.enabled === false) {
    return { type: 'disabled' };
  }

  // 有 model 时使用模型感知的动态 budget 计算
  const budgetTokens = model
    ? getThinkingBudgetForModel(model, options.effort, options.budgetTokens)
    : (options.budgetTokens ??
      EFFORT_TO_BUDGET[options.effort ?? DEFAULT_THINKING_EFFORT]);

  return {
    type: 'enabled',
    budgetTokens,
  };
}

export function parseEffortArg(
  effort: string | undefined
): ThinkingEffort | undefined {
  if (!effort) return undefined;

  const normalized = effort.toLowerCase().trim();
  if (
    normalized === 'low' ||
    normalized === 'medium' ||
    normalized === 'high'
  ) {
    return normalized as ThinkingEffort;
  }

  if (
    normalized === 'off' ||
    normalized === 'none' ||
    normalized === 'disabled'
  ) {
    return undefined;
  }

  const numeric = parseInt(normalized, 10);
  if (!isNaN(numeric)) {
    if (numeric <= 4000) return 'low';
    if (numeric <= 16000) return 'medium';
    return 'high';
  }

  return undefined;
}

/**
 * 计算 thinking budget（effort 映射，budget 由配置/effort 决定）
 * 说明：模型是否支持 thinking 由模型体系 capabilities 判定（DB model_registry），
 * 此处不按模型名硬编码。
 */
export function getThinkingBudgetForModel(
  _model: string,
  effort?: ThinkingEffort,
  overrideBudget?: number
): number {
  if (overrideBudget !== undefined && overrideBudget > 0) {
    return overrideBudget;
  }

  const eff = effort ?? DEFAULT_THINKING_EFFORT;
  return EFFORT_TO_BUDGET[eff] ?? DEFAULT_THINKING_BUDGET_TOKENS;
}

export function shouldEnableThinkingByDefault(): boolean {
  if (configManager.env('MAX_THINKING_TOKENS')) {
    return parseInt(configManager.env('MAX_THINKING_TOKENS')!, 10) > 0;
  }

  if (
    configManager.env('DISABLE_THINKING') === 'true' ||
    configManager.env('DISABLE_THINKING') === '1'
  ) {
    return false;
  }

  return true;
}

export const THINKING_BUDGET = {
  xhigh: 32000,
  high: 16000,
  medium: 8000,
  low: 4000,
} as const;

export const ADAPTIVE_EFFORT_MAP: Record<string, string> = {
  max: 'max',
  xhigh: 'xhigh',
  high: 'high',
  medium: 'medium',
  low: 'low',
  minimal: 'low',
};

export const ANTHROPIC_OUTPUT_LIMITS: Record<string, number> = {};

export function resolveAnthropicMaxTokens(model: string): number {
  const normalized = model.toLowerCase().replace(/_/g, '-');
  for (const [key, limit] of Object.entries(ANTHROPIC_OUTPUT_LIMITS)) {
    if (normalized.includes(key)) return limit;
  }
  return 4_096;
}
