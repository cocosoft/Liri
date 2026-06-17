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

/**
 * 模型感知的 budget 乘数
 * 根据模型能力动态放大 thinking budget，充分发挥高端模型潜力
 */
export const MODEL_BUDGET_MULTIPLIERS: Record<string, number> = {
  'claude-opus-4': 2.0, // effort=high → 64K
  'claude-sonnet-4': 1.5, // effort=high → 48K
  'claude-3.5-sonnet': 1.0, // 32K（与当前 high 值一致）
};

/**
 * 各模型的 thinking budget 硬上限（token）
 * 防止乘数放大导致超出模型实际支持范围
 */
export const MAX_BUDGET_PER_MODEL: Record<string, number> = {
  'claude-opus-4': 64000,
  'claude-sonnet-4': 48000,
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

export function modelSupportsThinking(model: string): boolean {
  const canonical = model.toLowerCase();

  // Claude 3（不含 3.5+）不支持 extended thinking
  if (canonical.includes('claude-3') && !canonical.includes('claude-3.5')) {
    return false;
  }

  // DeepSeek、OpenAI o1/o3 等通过 reasoning_content 支持推理内容展示
  return true;
}

export function modelSupportsAdaptiveThinking(model: string): boolean {
  const canonical = model.toLowerCase();

  if (canonical.includes('opus') && canonical.includes('4')) {
    return true;
  }
  if (canonical.includes('sonnet') && canonical.includes('4')) {
    return true;
  }

  return false;
}

export function getThinkingBudgetForModel(
  model: string,
  effort?: ThinkingEffort,
  overrideBudget?: number
): number {
  if (overrideBudget !== undefined && overrideBudget > 0) {
    return overrideBudget;
  }

  const eff = effort ?? DEFAULT_THINKING_EFFORT;
  const base = EFFORT_TO_BUDGET[eff] ?? DEFAULT_THINKING_BUDGET_TOKENS;

  // 根据模型型号动态计算 budget
  const canonicalModel = model.toLowerCase();
  const multiplier =
    Object.entries(MODEL_BUDGET_MULTIPLIERS).find(([key]) =>
      canonicalModel.includes(key)
    )?.[1] ?? 1.0;

  const computed = Math.floor(base * multiplier);

  // 应用硬上限
  const maxBudget =
    Object.entries(MAX_BUDGET_PER_MODEL).find(([key]) =>
      canonicalModel.includes(key)
    )?.[1] ?? 64000;

  return Math.min(computed, maxBudget);
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
