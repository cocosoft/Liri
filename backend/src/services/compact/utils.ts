/**
 * 压缩服务工具函数
 * 基于CC源码 cc_code/backend/services/compact/ 实现
 *
 * 使用Rust原生库进行精确的token估算（编译时零依赖C FFI）
 * 当原生库不可用时自动降级为启发式估算
 */

let nativeEstimateTokens: ((text: string, model?: string) => number) | null = null;

function lazyInitNative() {
  if (nativeEstimateTokens === undefined) {
    try {
      const native = require('../../../native');
      if (native && typeof native.estimateTokens === 'function') {
        nativeEstimateTokens = (text, model) => native.estimateTokens(text, model);
      } else {
        nativeEstimateTokens = null;
      }
    } catch {
      nativeEstimateTokens = null;
    }
  }
  return nativeEstimateTokens;
}

export const DEFAULT_MAX_OUTPUT_TOKENS_FOR_SUMMARY = 20000;
export const DEFAULT_AUTO_COMPACT_BUFFER_TOKENS = 13000;
export const DEFAULT_WARNING_THRESHOLD_BUFFER_TOKENS = 20000;
export const DEFAULT_ERROR_THRESHOLD_BUFFER_TOKENS = 20000;
export const DEFAULT_MANUAL_COMPACT_BUFFER_TOKENS = 3000;
export const MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3;

const CONTEXT_WINDOW_MAP: Record<string, number> = {
  'claude-3-5-sonnet': 200000,
  'claude-3-5-sonnet-20241022': 200000,
  'claude-3-opus': 200000,
  'claude-3-sonnet': 200000,
  'claude-3-haiku': 200000,
  'claude-2': 100000,
  'claude-instant': 100000,
};

const MAX_OUTPUT_TOKENS_MAP: Record<string, number> = {
  'claude-3-5-sonnet': 8192,
  'claude-3-5-sonnet-20241022': 8192,
  'claude-3-opus': 4096,
  'claude-3-sonnet': 4096,
  'claude-3-haiku': 4096,
  'claude-2': 4096,
  'claude-instant': 4096,
};

export function getContextWindowForModel(model: string): number {
  return CONTEXT_WINDOW_MAP[model] || 100000;
}

export function getMaxOutputTokensForModel(model: string): number {
  return MAX_OUTPUT_TOKENS_MAP[model] || 4096;
}

export function getEffectiveContextWindowFromModel(model: string): number {
  const maxOutputTokens = Math.min(
    getMaxOutputTokensForModel(model),
    DEFAULT_MAX_OUTPUT_TOKENS_FOR_SUMMARY
  );
  return getContextWindowForModel(model) - maxOutputTokens;
}

export function getAutoCompactThreshold(model: string): number {
  const effectiveContextWindow = getEffectiveContextWindowFromModel(model);
  return effectiveContextWindow - DEFAULT_AUTO_COMPACT_BUFFER_TOKENS;
}

export function getWarningThreshold(autoCompactThreshold: number): number {
  return (
    autoCompactThreshold -
    (DEFAULT_AUTO_COMPACT_BUFFER_TOKENS -
      DEFAULT_WARNING_THRESHOLD_BUFFER_TOKENS)
  );
}

export function getErrorThreshold(autoCompactThreshold: number): number {
  return (
    autoCompactThreshold -
    (DEFAULT_AUTO_COMPACT_BUFFER_TOKENS - DEFAULT_ERROR_THRESHOLD_BUFFER_TOKENS)
  );
}

export function getBlockingLimit(effectiveContextWindow: number): number {
  return effectiveContextWindow - DEFAULT_MANUAL_COMPACT_BUFFER_TOKENS;
}

export interface TokenWarningState {
  percentLeft: number;
  isAboveWarningThreshold: boolean;
  isAboveErrorThreshold: boolean;
  isAboveAutoCompactThreshold: boolean;
  isAtBlockingLimit: boolean;
}

export function calculateTokenWarningState(
  tokenUsage: number,
  model: string,
  effectiveContextWindow: number
): TokenWarningState {
  const autoCompactThreshold = getAutoCompactThreshold(model);
  const threshold = effectiveContextWindow;

  const percentLeft = Math.max(
    0,
    Math.round(((threshold - tokenUsage) / threshold) * 100)
  );

  const warningThreshold = threshold - DEFAULT_WARNING_THRESHOLD_BUFFER_TOKENS;
  const errorThreshold = threshold - DEFAULT_ERROR_THRESHOLD_BUFFER_TOKENS;

  const isAboveWarningThreshold = tokenUsage >= warningThreshold;
  const isAboveErrorThreshold = tokenUsage >= errorThreshold;
  const isAboveAutoCompactThreshold = tokenUsage >= autoCompactThreshold;
  const isAtBlockingLimit = tokenUsage >= getBlockingLimit(threshold);

  return {
    percentLeft,
    isAboveWarningThreshold,
    isAboveErrorThreshold,
    isAboveAutoCompactThreshold,
    isAtBlockingLimit,
  };
}

export function roughTokenCountEstimation(text: string): number {
  const native = lazyInitNative();
  if (native) {
    return native(text);
  }
  return Math.ceil(text.length / 4);
}

export function roughTokenCountEstimationForMessages(messages: any[]): number {
  let total = 0;
  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      total += roughTokenCountEstimation(msg.content);
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === 'text' && block.text) {
          total += roughTokenCountEstimation(block.text);
        }
      }
    }
  }
  return total;
}
