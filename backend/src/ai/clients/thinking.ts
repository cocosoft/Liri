/**
 * Extended Thinking 配置类型定义
 * 支持 Claude extended thinking 配置，包含 effort 值（low/medium/high）和 thinking budget token 控制
 */

export type ThinkingEffort = 'low' | 'medium' | 'high';

export type ThinkingConfig =
  | { type: 'adaptive' }
  | { type: 'enabled'; budgetTokens: number }
  | { type: 'disabled' };

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
  options: ThinkingOptions = {}
): ThinkingConfig {
  if (options.enabled === false) {
    return { type: 'disabled' };
  }

  const budgetTokens =
    options.budgetTokens ??
    EFFORT_TO_BUDGET[options.effort ?? DEFAULT_THINKING_EFFORT];

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

  if (canonical.includes('claude-3')) {
    return false;
  }

  if (
    canonical.includes('deepseek') ||
    canonical.includes('gpt-') ||
    canonical.includes('o1') ||
    canonical.includes('o3')
  ) {
    return false;
  }

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
  return EFFORT_TO_BUDGET[eff] ?? DEFAULT_THINKING_BUDGET_TOKENS;
}

export function shouldEnableThinkingByDefault(): boolean {
  if (process.env.MAX_THINKING_TOKENS) {
    return parseInt(process.env.MAX_THINKING_TOKENS, 10) > 0;
  }

  if (
    process.env.DISABLE_THINKING === 'true' ||
    process.env.DISABLE_THINKING === '1'
  ) {
    return false;
  }

  return true;
}
