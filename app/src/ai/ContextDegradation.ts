/**
 * ContextDegradation — 上下文溢出渐进降级探测
 *
 * P1-7: 对标 hermes-agent context_limit_handler.py 的 6 级降级链。
 * 当 LLM API 返回 context_length_exceeded 错误时，自动逐级降低上下文窗口并重试，
 * 而非直接返回错误给用户。
 *
 * 降级链（auto-detect → next lower tier）:
 *   256K → 128K → 64K → 32K → 16K → 8K
 *
 * 安全门槛: MINIMUM 64K — 低于此门槛视为降级失败，不再继续。
 *
 * parse_context_limit_from_error: 从 API 错误消息中提取实际的上下文限制值。
 */

import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';

const logger = getLogger('ai:contextDegradation');

/** 降级链（从高到低） */
const DEGRADATION_CHAIN: number[] = [
  256_000, 128_000, 64_000, 32_000, 16_000, 8_000,
];

/** 最小可接受上下文窗口 */
const MINIMUM_CONTEXT = 64_000;

/** 保存原始上下文窗口的 Symbol */
const ORIGINAL_CONTEXT_KEY = Symbol('degradation:originalContext');

export interface DegradationState {
  /** 当前降级层级索引（0 = 原始值，即 256K） */
  tierIndex: number;
  /** 当前使用的上下文窗口大小 */
  currentLimit: number;
  /** 原始上下文窗口（首次调用时的值） */
  originalLimit: number;
  /** 是否已触底（无法继续降级） */
  exhausted: boolean;
  /** 降级次数 */
  degradationCount: number;
}

export interface DegradationResult {
  /** 降级后的限制（若不需要降级则返回原始值） */
  limit: number;
  /** 是否需要重试 */
  shouldRetry: boolean;
  /** 状态快照 */
  state: DegradationState;
}

/**
 * 创建降级状态
 */
export function createDegradationState(initialLimit: number): DegradationState {
  return {
    tierIndex: 0,
    currentLimit: initialLimit,
    originalLimit: initialLimit,
    exhausted: false,
    degradationCount: 0,
  };
}

/**
 * P1-7: 尝试降级上下文窗口
 *
 * 在 API 返回 context_length_exceeded 错误后调用。
 * 从降级链中找出比当前限制更小的下一级，返回新的限制。
 *
 * @param state 当前降级状态（会被原地修改）
 * @param error 触发降级的错误（用于分析）
 * @returns 降级结果
 */
export function tryDegradeContext(
  state: DegradationState,
  error?: Error | string | { message?: string } | unknown
): DegradationResult {
  // 从未降级过 → 首次初始化
  if (state.tierIndex === 0) {
    const autoDetected = parseContextLimitFromError(error);
    if (autoDetected && autoDetected < state.currentLimit) {
      const tierIndex = findTierIndex(autoDetected);
      if (tierIndex >= 0) {
        state.tierIndex = tierIndex;
        state.currentLimit = autoDetected;
      }
    }
  }

  // 找到当前限制在降级链中的位置
  let currentTierIndex = findTierIndex(state.currentLimit);
  if (currentTierIndex < 0) {
    // 不在标准链中，寻找低于当前值的最近一级
    currentTierIndex = findNextLowerTier(state.currentLimit);
  }

  // 尝试下一级
  const nextTierIndex = currentTierIndex + 1;
  if (nextTierIndex >= DEGRADATION_CHAIN.length) {
    state.exhausted = true;
    void handleError(new Error('contextDegradation:exhausted'), {
      module: 'ai:context',
      action: 'degradation:exhausted',
    });
    return { limit: state.currentLimit, shouldRetry: false, state };
  }

  const nextLimit = DEGRADATION_CHAIN[nextTierIndex];

  // 最低门槛检查
  if (nextLimit < MINIMUM_CONTEXT && state.originalLimit >= MINIMUM_CONTEXT) {
    logger.warn('contextDegradation:minimum_reached', {
      currentLimit: state.currentLimit,
      nextLimit,
      minimum: MINIMUM_CONTEXT,
    });
    state.exhausted = true;
    return { limit: state.currentLimit, shouldRetry: false, state };
  }

  // 执行降级
  state.tierIndex = nextTierIndex;
  state.currentLimit = nextLimit;
  state.degradationCount++;

  logger.warn('contextDegradation:degrading', {
    from: DEGRADATION_CHAIN[currentTierIndex],
    to: nextLimit,
    tierIndex: nextTierIndex,
    degradationCount: state.degradationCount,
    original: state.originalLimit,
  });

  return { limit: nextLimit, shouldRetry: true, state };
}

/**
 * P1-7: 从 API 错误消息中解析上下文限制
 *
 * 支持解析以下格式的错误消息：
 * - "maximum context length is 128000 tokens"
 * - "input length too long (131072 > 128000)"
 * - "context_length_exceeded: max 65536, got 72345"
 * - Anthropic: "prompt is too long: 200000 tokens > 200000 maximum"
 *
 * @param error 错误对象（可选）
 * @returns 解析出的限制值（tokens），若无法解析则返回 null
 */
export function parseContextLimitFromError(
  error?: Error | string | { message?: string } | unknown
): number | null {
  const message = getErrorMessage(
    error as Error | string | { message?: string }
  );
  if (!message) return null;

  // Pattern 1: "maximum context length is NNN tokens"
  let match = message.match(
    /maximum\s+context\s+length\s+is\s+(\d[\d,]*)\s*(?:tokens?)?/i
  );
  if (match) return parseInt(match[1].replace(/,/g, ''), 10);

  // Pattern 2: "input length too long (NNN > NNN)"
  match = message.match(/too\s+long\s*\(?(\d[\d,]*)\s*>\s*(\d[\d,]*)\)?/i);
  if (match) return parseInt(match[2].replace(/,/g, ''), 10);

  // Pattern 3: "context_length_exceeded: max NNN, got NNN"
  match = message.match(/context(?:_length)?\s*exceeded.*?max\s+(\d[\d,]*)/i);
  if (match) return parseInt(match[1].replace(/,/g, ''), 10);

  // Pattern 4: "prompt is too long: NNN tokens > NNN maximum"
  match = message.match(
    /prompt\s+is\s+too\s+long.*?(\d[\d,]*)\s*(?:tokens?)?\s*>\s*(\d[\d,]*)\s*maximum/i
  );
  if (match) return parseInt(match[2].replace(/,/g, ''), 10);

  // Pattern 5: Anthropic "Your request of NNN tokens exceeds the maximum of NNN"
  match = message.match(/exceeds\s+(?:the\s+)?maximum\s+(?:of\s+)?(\d[\d,]*)/i);
  if (match) return parseInt(match[1].replace(/,/g, ''), 10);

  // Pattern 6: Generic "max_tokens: NNN"
  match = message.match(
    /(?:max|maximum)[_\s-]*(?:tokens?|context)[_\s:]*(\d[\d,]*)/i
  );
  if (match) return parseInt(match[1].replace(/,/g, ''), 10);

  return null;
}

/**
 * 在降级链中查找指定限制值对应的层级索引
 */
function findTierIndex(limit: number): number {
  return DEGRADATION_CHAIN.indexOf(limit);
}

/**
 * 查找降级链中低于指定值的最近一级
 */
function findNextLowerTier(limit: number): number {
  for (let i = DEGRADATION_CHAIN.length - 1; i >= 0; i--) {
    if (DEGRADATION_CHAIN[i] < limit) return i;
  }
  return DEGRADATION_CHAIN.length - 1;
}

/**
 * 从 Error/string/object 中提取消息
 */
function getErrorMessage(
  error?: Error | string | { message?: string }
): string {
  if (!error) return '';
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  if (error.message) return error.message;
  return String(error);
}

/**
 * 当上下文降级超过原始窗口的 50% 时，生成用户可见的警告
 */
export function getDegradationWarning(state: DegradationState): string | null {
  if (state.degradationCount === 0) return null;

  const ratio = state.currentLimit / state.originalLimit;
  if (ratio <= 0.5) {
    return `上下文窗口已从 ${formatTokens(state.originalLimit)} 降至 ${formatTokens(state.currentLimit)}（${Math.round(ratio * 100)}%）。长对话可能受影响。`;
  }

  if (state.degradationCount >= 2) {
    return `上下文窗口已降级 ${state.degradationCount} 次，当前为 ${formatTokens(state.currentLimit)}。`;
  }

  return null;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}
